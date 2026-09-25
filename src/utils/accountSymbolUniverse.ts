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
import { selectDefaultMarketWatchSymbols } from './marketWatchGroups';

/**
 * Lifecycle of the authenticated account catalogue.
 * - `none`: no authenticated account (guest / signed-out) -> public catalogue.
 * - `loading`: account catalogue requested but not yet known.
 * - `loaded`: account catalogue known; it is the symbol universe.
 * - `failed`: account catalogue could not be loaded; read-only surfaces fall
 *   back to the public catalogue while trading stays gated (no authorized symbols).
 */
export type AccountCatalogStatus = 'none' | 'loading' | 'loaded' | 'failed';

/** Catalogues at or below this size are shown in full, in backend order, as default Market Watch rows. */
export const ACCOUNT_DEFAULT_MARKET_WATCH_FULL_CATALOG_LIMIT = 50;

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
 * Default Market Watch rows for a logged-in account. Small group catalogues
 * are shown in full in the order configured for the group; large catalogues
 * keep the curated core-per-category selection.
 */
export const selectAccountDefaultMarketWatchSymbols = (
  accountCatalog: readonly unknown[],
  metadataSources: readonly unknown[] = accountCatalog,
  fullCatalogLimit = ACCOUNT_DEFAULT_MARKET_WATCH_FULL_CATALOG_LIMIT,
): string[] => {
  const names = getUniqueSymbolNames([...accountCatalog]);
  if (names.length <= fullCatalogLimit) return names;
  return pruneSymbolsToUniverse(
    selectDefaultMarketWatchSymbols(accountCatalog, metadataSources),
    names,
  );
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
