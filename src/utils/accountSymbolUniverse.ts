/**
 * Account symbol universe.
 *
 * When a trading account is logged in, the account catalogue returned by the
 * authenticated `GET /api/v2/instruments` (already filtered server-side by the
 * account's group) is the single symbol universe of the terminal: Market Watch
 * rows, search, symbol groups, chart pickers/eligibility and the order ticket.
 * Guest mode keeps using the public broker catalogue.
 *
 * Everything here is pure so the rules can be unit tested independently of
 * React state and network timing.
 */
import { buildChartEligibleSymbolNames, buildTradeEligibleSymbolNames, getUniqueSymbolNames, normalizeSymbolName } from './symbolEligibility';
import { resolveMarketWatchSymbolInput } from './marketWatchSource';

/**
 * Lifecycle of the authenticated account catalogue.
 * - `none`: no authenticated account (guest / signed-out) -> public catalogue.
 * - `loading`: account catalogue requested but not yet known.
 * - `loaded`: account catalogue known; it is the symbol universe.
 * - `failed`: account catalogue could not be loaded; read-only surfaces fall
 *   back to the public catalogue while trading stays gated (no authorized symbols).
 */
export type AccountCatalogStatus = 'none' | 'loading' | 'loaded' | 'failed';

/**
 * True when the account catalogue (possibly still empty while loading) is the
 * symbol universe. While loading this deliberately yields an empty universe so
 * the public catalogue is never flashed to a logged-in account.
 */
export const isAccountSymbolUniverseActive = (
  isAuthenticated: boolean,
  status: AccountCatalogStatus | undefined,
): boolean => isAuthenticated && (status === 'loading' || status === 'loaded');

type SymbolRecord = { symbol: string };

type UnknownRecord = Record<string, unknown>;

const asRecord = (value: unknown): UnknownRecord | undefined => (
  value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as UnknownRecord
    : undefined
);

const mergeDefinedRecordFields = (
  fallback: UnknownRecord,
  authoritative: UnknownRecord,
): UnknownRecord => {
  const merged: UnknownRecord = { ...fallback };
  Object.entries(authoritative).forEach(([key, value]) => {
    if (value !== undefined) merged[key] = value;
  });
  return merged;
};

const CHART_MODE_KEYS = ['chart_mode', 'chartMode'] as const;

const hasExplicitChartMode = (record: UnknownRecord): boolean => {
  if (CHART_MODE_KEYS.some((key) => (
    Object.prototype.hasOwnProperty.call(record, key) && record[key] !== undefined
  ))) return true;

  const nested = asRecord(record.specification);
  return Boolean(nested && CHART_MODE_KEYS.some((key) => (
    Object.prototype.hasOwnProperty.call(nested, key) && nested[key] !== undefined
  )));
};

/**
 * Merge the raw broker snapshots retained by `normalizeInstrument`.
 *
 * Account rows are authoritative, while the public row may fill omitted
 * metadata such as `chart_mode`. `specification` is the one nested broker
 * section that is field-merged because chart mode is published there by some
 * backends. If the account declares chart mode at either supported level, all
 * public chart-mode aliases are removed before the account value is restored;
 * this prevents a public direct value from shadowing an account nested value.
 */
const mergeBrokerSpecifications = (
  publicSpecification: UnknownRecord,
  accountSpecification: UnknownRecord,
): Readonly<UnknownRecord> => {
  const merged = mergeDefinedRecordFields(publicSpecification, accountSpecification);

  const publicNested = asRecord(publicSpecification.specification);
  const accountNested = asRecord(accountSpecification.specification);
  if (publicNested && accountNested) {
    merged.specification = mergeDefinedRecordFields(publicNested, accountNested);
  }

  if (hasExplicitChartMode(accountSpecification)) {
    CHART_MODE_KEYS.forEach((key) => delete merged[key]);
    const mergedNested = asRecord(merged.specification);
    if (mergedNested) {
      const withoutPublicMode = { ...mergedNested };
      CHART_MODE_KEYS.forEach((key) => delete withoutPublicMode[key]);
      merged.specification = withoutPublicMode;
    }

    CHART_MODE_KEYS.forEach((key) => {
      if (
        Object.prototype.hasOwnProperty.call(accountSpecification, key)
        && accountSpecification[key] !== undefined
      ) {
        merged[key] = accountSpecification[key];
      }
    });
    if (accountNested) {
      const restoredNested = { ...(asRecord(merged.specification) ?? {}) };
      CHART_MODE_KEYS.forEach((key) => {
        if (
          Object.prototype.hasOwnProperty.call(accountNested, key)
          && accountNested[key] !== undefined
        ) {
          restoredNested[key] = accountNested[key];
        }
      });
      merged.specification = restoredNested;
    }
  }

  return Object.freeze(merged);
};

/**
 * Account catalogue rows in backend order, enriched with public-catalogue
 * fields (prices, specifications, descriptions) the account row omits.
 * Account values always win; public-only symbols are never added.
 */
export const mergeAccountCatalogWithPublic = <T extends SymbolRecord>(
  accountCatalog: readonly T[],
  publicCatalog: readonly T[],
): T[] => {
  const publicBySymbol = new Map<string, T>();
  publicCatalog.forEach((instrument) => {
    const symbol = normalizeSymbolName(instrument?.symbol);
    if (symbol && !publicBySymbol.has(symbol)) publicBySymbol.set(symbol, instrument);
  });

  const seen = new Set<string>();
  const merged: T[] = [];
  accountCatalog.forEach((instrument) => {
    const symbol = normalizeSymbolName(instrument?.symbol);
    if (!symbol || seen.has(symbol)) return;
    seen.add(symbol);
    const publicInstrument = publicBySymbol.get(symbol);
    if (!publicInstrument) {
      merged.push({ ...instrument, symbol });
      return;
    }
    const next: Record<string, unknown> = { ...publicInstrument };
    Object.entries(instrument).forEach(([key, value]) => {
      if (value !== undefined) next[key] = value;
    });
    const publicSpecification = asRecord((publicInstrument as UnknownRecord).brokerSpecification);
    const accountSpecification = asRecord((instrument as UnknownRecord).brokerSpecification);
    if (publicSpecification && accountSpecification) {
      next.brokerSpecification = mergeBrokerSpecifications(publicSpecification, accountSpecification);
    }
    next.symbol = symbol;
    merged.push(next as T);
  });
  return merged;
};

/**
 * Keeps only symbols belonging to `universe` (exact broker symbols plus the
 * Market Watch input aliases, e.g. legacy `EUROUSD` -> `EURUSD`), preserving
 * input order and removing duplicates.
 */
export const pruneSymbolsToUniverse = (
  symbols: readonly unknown[],
  universe: readonly unknown[],
): string[] => {
  const universeNames = getUniqueSymbolNames([...universe]);
  if (universeNames.length === 0) return [];
  const result: string[] = [];
  const seen = new Set<string>();
  symbols.forEach((symbol) => {
    const normalized = normalizeSymbolName(symbol);
    if (!normalized) return;
    const resolved = resolveMarketWatchSymbolInput(universeNames, normalized);
    if (!resolved || seen.has(resolved)) return;
    seen.add(resolved);
    result.push(resolved);
  });
  return result;
};

/** Exact-match filter used by the persisted watchlist store (no alias rewriting). */
export const filterSymbolsExactlyInUniverse = (
  symbols: readonly string[],
  universe: readonly unknown[],
): string[] => {
  const allowed = new Set(getUniqueSymbolNames([...universe]));
  return symbols.filter((symbol) => allowed.has(normalizeSymbolName(symbol)));
};

/**
 * Default Market Watch rows for a logged-in account: always the complete
 * account catalogue in backend order. Members are resolved with
 * `getUniqueSymbolNames`, which de-duplicates repeated names without alias or
 * suffix rewriting and preserves first-seen order; no curated subset, category
 * re-grouping or group-level default is applied (the instrument payload exposes
 * no group Market Watch default field).
 *
 * The trailing arguments are accepted only for compatibility with the shared
 * Market Watch model call site and never change the returned symbols.
 */
export const selectAccountDefaultMarketWatchSymbols = (
  accountCatalog: readonly unknown[],
  metadataSources?: readonly unknown[],
  fullCatalogLimit?: number,
): string[] => {
  // Retained only so existing callers keep their arity; neither argument may
  // shrink or reorder the account catalogue.
  void metadataSources;
  void fullCatalogLimit;
  return getUniqueSymbolNames([...accountCatalog]);
};

export interface ChartEligibleSymbolInput {
  accountUniverseActive: boolean;
  /** Account catalogue (authorized + trade-disabled symbols), backend order. */
  accountSymbols: readonly unknown[];
  /** Symbols the authenticated catalogue authorizes for trading. */
  authorizedSymbols: readonly unknown[];
  publicSymbols: readonly unknown[];
  activeFeedSymbols: readonly unknown[];
}

/**
 * Symbols a chart may be opened for. A logged-in account can only chart its
 * own catalogue (never the public union); guests and the account-catalogue
 * failure fallback keep the previous public/feed based behaviour.
 */
export const resolveChartEligibleSymbolNames = ({
  accountUniverseActive,
  accountSymbols,
  authorizedSymbols,
  publicSymbols,
  activeFeedSymbols,
}: ChartEligibleSymbolInput): string[] => {
  if (accountUniverseActive) return getUniqueSymbolNames([...accountSymbols]);
  const chartCatalog = buildChartEligibleSymbolNames(
    [...authorizedSymbols, ...publicSymbols],
    [...activeFeedSymbols],
  );
  if (chartCatalog.length > 0) return chartCatalog;
  return getUniqueSymbolNames([...activeFeedSymbols]);
};

export interface TradeEligibleSymbolInput {
  isAuthenticated: boolean;
  feedCurrent: boolean;
  authorizedSymbols: readonly unknown[];
  activeFeedSymbols: readonly unknown[];
}

/**
 * Symbols that may be offered for trading. An authenticated account never
 * falls back to the raw feed list: only symbols its catalogue authorizes.
 */
export const resolveTradeEligibleSymbolNames = ({
  isAuthenticated,
  feedCurrent,
  authorizedSymbols,
  activeFeedSymbols,
}: TradeEligibleSymbolInput): string[] => {
  if (!feedCurrent) return [];
  const fromCatalog = buildTradeEligibleSymbolNames([...authorizedSymbols], [...activeFeedSymbols]);
  if (fromCatalog.length > 0 || isAuthenticated) return fromCatalog;
  return getUniqueSymbolNames([...activeFeedSymbols]);
};

export interface OrderTicketSymbolOption {
  symbol: string;
  disabled: boolean;
}

/**
 * Order ticket symbol dropdown. With an account catalogue the options are the
 * account's tradable symbols; the current symbol is kept visible (disabled)
 * when it is not tradable so the select never misrepresents its value.
 * Without a catalogue (legacy callers) the quote-store keys are used.
 */
export const buildOrderTicketSymbolOptions = ({
  accountSymbols,
  tickSymbols,
  currentSymbol,
}: {
  accountSymbols?: readonly unknown[];
  tickSymbols: readonly string[];
  currentSymbol: string;
}): OrderTicketSymbolOption[] => {
  const current = normalizeSymbolName(currentSymbol);
  if (accountSymbols === undefined) {
    const legacy = tickSymbols.length > 0 ? [...tickSymbols] : [currentSymbol];
    return legacy.filter(Boolean).map((symbol) => ({ symbol, disabled: false }));
  }
  const names = getUniqueSymbolNames([...accountSymbols]);
  const options = names.map((symbol) => ({ symbol, disabled: false }));
  if (current && !names.includes(current)) options.unshift({ symbol: current, disabled: true });
  return options;
};
