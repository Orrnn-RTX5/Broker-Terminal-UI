import { readRegisteredSymbolPriceSpec } from '../../services/dailyChangePriceModeRegistry';
import { useDockLayoutStore } from '../../store/useDockLayoutStore';
import { resolveTickFromLookup, useAppStore } from '../../store/useAppStore';
import { normalizeSymbolDescriptionText } from '../../utils/symbolDescription';
import { getInstrumentSymbolName } from '../../utils/symbolEligibility';
import { formatPrice, resolveSpecDigits } from '../../utils/symbolUtils';
import { inferObservedPriceDigits } from '../../utils/chartPriceScale';

/** Bottom tabs of the Market Watch window, in MT5 order. */
export const MARKET_WATCH_VIEWS = ['symbols', 'details', 'trading', 'ticks'] as const;
export type MarketWatchViewId = typeof MARKET_WATCH_VIEWS[number];

export interface ScopedManualSymbols {
  watchlistId: string;
  symbols: string[];
}

export interface FundamentalLink {
  label: string;
  url: string;
}

export const SYMBOL_GROUP_ROW_HEIGHT = 36;
export const SYMBOL_EXPLORER_ROW_HEIGHT = 48;
export const SYMBOL_EXPLORER_OVERSCAN = 6;
export const SYMBOL_EXPLORER_FALLBACK_HEIGHT = 288;
export const EMPTY_SORT_TICKS = {};

export const normalizeSymbol = (value: unknown): string => String(value ?? '').trim().toUpperCase();

export const readFiniteDailyChange = (value: unknown): number | null => {
  if (value === undefined || value === null || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

/** Return the newest real market-event time in normalized epoch milliseconds. */
export const getLatestMarketWatchTimestamp = (...values: unknown[]): number | undefined => {
  const timestamps = values.flatMap((value) => {
    const parsed = Number(value);
    if (!Number.isFinite(parsed) || parsed <= 0) return [];
    return [parsed < 1_000_000_000_000 ? parsed * 1_000 : parsed];
  });
  return timestamps.length > 0 ? Math.max(...timestamps) : undefined;
};

/** Broker quote precision published on one catalog row (normalized field, then raw broker spec). */
const readCatalogRowPriceDigits = (row: unknown): number | null => {
  if (!row || typeof row !== 'object' || Array.isArray(row)) return null;
  const record = row as Record<string, unknown>;
  const brokerSpecification = record.brokerSpecification;
  const specDigits = brokerSpecification && typeof brokerSpecification === 'object' && !Array.isArray(brokerSpecification)
    ? (brokerSpecification as Record<string, unknown>).digits
    : undefined;
  const nestedSpecification = record.specification;
  const nestedDigits = nestedSpecification && typeof nestedSpecification === 'object' && !Array.isArray(nestedSpecification)
    ? (nestedSpecification as Record<string, unknown>).digits
    : undefined;
  return resolveSpecDigits(record.digits, specDigits, nestedDigits);
};

/**
 * Per-symbol broker price digits from the published instrument catalogs, in
 * priority order (the first catalog that publishes digits for a symbol wins).
 * Rows without broker digits are left out; nothing is inferred from names.
 */
export const buildMarketWatchCatalogPriceDigits = (
  ...catalogs: ReadonlyArray<readonly unknown[] | undefined>
): ReadonlyMap<string, number> => {
  const digitsBySymbol = new Map<string, number>();
  catalogs.forEach((catalog) => catalog?.forEach((row) => {
    const symbol = normalizeSymbol(getInstrumentSymbolName(row));
    if (!symbol || digitsBySymbol.has(symbol)) return;
    const digits = readCatalogRowPriceDigits(row);
    if (digits !== null) digitsBySymbol.set(symbol, digits);
  }));
  return digitsBySymbol;
};

/**
 * Market Watch price precision from broker data only: the catalog row, then
 * the registered catalog spec, then the live tick. Null when none publishes
 * digits, so prices render raw instead of a guessed precision.
 */
export const resolveMarketWatchPriceDigits = (
  symbol: string,
  catalogDigits?: unknown,
  tickDigits?: unknown,
  ...observedPrices: readonly unknown[]
): number | null => {
  const specDigits = resolveSpecDigits(
    catalogDigits,
    readRegisteredSymbolPriceSpec(symbol).digits,
    tickDigits,
  );
  if (specDigits === null) return null;
  if (specDigits <= 2 && observedPrices.length > 0) {
    const hasSubUnitPrice = observedPrices.some((value) => {
      const num = typeof value === 'number' ? value : Number(value);
      return Number.isFinite(num) && num > 0 && num < 1;
    });
    if (hasSubUnitPrice) {
      const observed = inferObservedPriceDigits(null, observedPrices);
      if (observed !== null && observed > specDigits) {
        return observed;
      }
    }
  }
  return specDigits;
};

export const formatMarketWatchExportPrice = (
  symbol: string,
  value: unknown,
  catalogDigits?: unknown,
  tickDigits?: unknown,
): string => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed === 0) return '-';
  return formatPrice(parsed, resolveMarketWatchPriceDigits(symbol, catalogDigits, tickDigits));
};

export const uniqueSymbols = (symbols: unknown[]): string[] => (
  Array.from(new Set(symbols.map(normalizeSymbol).filter(Boolean)))
);

const findMarketWatchPanelId = (node: unknown): string | null => {
  if (!node || typeof node !== 'object') return null;
  const record = node as { id?: string; component?: string; children?: unknown[] };
  if (record.component === 'MarketWatch' && record.id) return record.id;
  if (!Array.isArray(record.children)) return null;
  for (const child of record.children) {
    const nestedId = findMarketWatchPanelId(child);
    if (nestedId) return nestedId;
  }
  return null;
};

export const closeMarketWatchDockPanel = (): void => {
  const { layout, removePanel } = useDockLayoutStore.getState();
  const panelId = findMarketWatchPanelId(layout.root)
    ?? layout.floatingPanels.map((panel) => findMarketWatchPanelId(panel)).find(Boolean)
    ?? null;
  if (panelId) removePanel(panelId);
};

export const toggleFloatMarketWatchDockPanel = (): void => {
  const { layout, floatPanel, redockPanel } = useDockLayoutStore.getState();
  const floatingId = layout.floatingPanels.map((panel) => findMarketWatchPanelId(panel)).find(Boolean) ?? null;
  if (floatingId) {
    redockPanel(floatingId);
    return;
  }
  const dockedId = findMarketWatchPanelId(layout.root);
  if (dockedId) floatPanel(dockedId);
};

export const getFundamentalLinks = (symbol: string, groupKey: string): FundamentalLink[] => {
  const ticker = normalizeSymbol(symbol);
  if (groupKey !== 'stocks' || !/^[A-Z]{1,5}$/.test(ticker)) return [];
  const encoded = encodeURIComponent(ticker);
  return [
    { label: 'Yahoo Finance', url: `https://finance.yahoo.com/quote/${encoded}` },
    { label: 'Google Finance', url: `https://www.google.com/finance/?q=${encoded}` },
    { label: 'Market Watch', url: `https://www.marketwatch.com/investing/stock/${encoded.toLowerCase()}` },
    { label: 'SEC EDGAR', url: `https://www.sec.gov/edgar/browse/?CIK=${encoded}&owner=exclude&action=getcompany` },
    { label: 'Finviz', url: `https://finviz.com/quote.ashx?t=${encoded}` },
    { label: 'Investing', url: `https://www.investing.com/search/?q=${encoded}` },
    { label: 'Bloomberg', url: `https://www.bloomberg.com/search?query=${encoded}` },
    { label: 'CNBC', url: `https://www.cnbc.com/quotes/${encoded}` },
    { label: 'Seeking Alpha', url: `https://seekingalpha.com/symbol/${encoded}` },
    { label: 'The Motley Fool', url: `https://www.fool.com/search/solr.aspx?q=${encoded}` },
    { label: 'Barrons', url: `https://www.barrons.com/search?query=${encoded}` },
    { label: 'Morningstar', url: `https://www.morningstar.com/search?query=${encoded}` },
  ];
};

export const openTrustedExternalLink = (url: string): void => {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return;
  }
  if (parsed.protocol !== 'https:') return;
  const electronOpenExternal = window.electron?.shell?.openExternal;
  if (electronOpenExternal) {
    void electronOpenExternal(parsed.toString());
    return;
  }
  window.open(parsed.toString(), '_blank', 'noopener,noreferrer');
};

export const readInstrumentDescription = (value: unknown, symbol: string): string => {
  if (!value || typeof value !== 'object') return '';
  const record = value as Record<string, unknown>;
  const hasExplicitSymbol = Boolean(String(record.symbol ?? record.id ?? '').trim());
  const candidates = [
    record.description,
    record.display_name,
    record.displayName,
    record.full_name,
    record.fullName,
    hasExplicitSymbol ? record.name : undefined,
  ];
  for (const candidate of candidates) {
    const description = normalizeSymbolDescriptionText(symbol, String(candidate ?? ''));
    if (description) return description;
  }
  return '';
};


export const findInstrumentBySymbol = (instruments: readonly unknown[], symbol: string): unknown => {
  const matches = instruments.filter((instrument) => getInstrumentSymbolName(instrument) === symbol);
  return matches.find((instrument) => instrument !== null && typeof instrument === 'object') ?? matches[0];
};

export const getBrokerSpecificationSource = (instrument: unknown): unknown => {
  if (!instrument || typeof instrument !== 'object' || Array.isArray(instrument)) return instrument;
  const brokerSpecification = (instrument as Record<string, unknown>).brokerSpecification;
  return brokerSpecification && typeof brokerSpecification === 'object' && !Array.isArray(brokerSpecification)
    ? brokerSpecification
    : instrument;
};

export const getPublicSpecificationSource = (instrument: unknown): unknown => {
  const source = getBrokerSpecificationSource(instrument);
  if (!source || typeof source !== 'object' || Array.isArray(source)) return source;

  // Public rows carry a live quote spread, not the broker's contract spread.
  const specification = { ...(source as Record<string, unknown>) };
  [
    'bid', 'ask', 'last', 'spread', 'open', 'high', 'low', 'close', 'volume',
    'dailyChange', 'daily_change', 'time', 'timestamp', 'has_quote', 'hasQuote',
  ].forEach((key) => delete specification[key]);
  return specification;
};

export const getTickSnapshot = (symbol: string) => {
  const state = useAppStore.getState();
  return resolveTickFromLookup(state.ticks, state.tickLookup, symbol);
};

export const hasMarketWatchQuote = (
  tick: { bid?: number; ask?: number } | null | undefined,
): boolean => Boolean(tick && (
  (Number.isFinite(tick.bid) && Number(tick.bid) > 0)
  || (Number.isFinite(tick.ask) && Number(tick.ask) > 0)
));

export const formatLastPriceTime = (asOf: number): string => (
  new Date(asOf).toUTCString().replace('GMT', 'UTC')
);
