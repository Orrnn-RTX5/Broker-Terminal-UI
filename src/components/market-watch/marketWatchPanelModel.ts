import { useDockLayoutStore } from '../../store/useDockLayoutStore';
import { resolveTickFromLookup, useAppStore } from '../../store/useAppStore';
import { getInstrumentSymbolName } from '../../utils/symbolEligibility';
import { formatPrice } from '../../utils/symbolUtils';

/** Bottom tabs of the Market Watch window, in MT5 order. */
export const MARKET_WATCH_VIEWS = ['symbols', 'details', 'ticks'] as const;
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

const TWO_DECIMAL_MARKET_WATCH_SYMBOLS = new Set([
  'JPN225',
  'JPN225-F',
  'WHEAT',
  'GOLD-PERP',
  'NICKEL',
  'COCOA',
  'MAERSKB.DK',
  'COFFEE',
  'SPA35-F',
]);

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

export const getMarketWatchPriceDigits = (symbol: string): number | undefined => (
  TWO_DECIMAL_MARKET_WATCH_SYMBOLS.has(normalizeSymbol(symbol)) ? 2 : undefined
);

export const formatMarketWatchExportPrice = (symbol: string, value: unknown): string => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed === 0) return '-';
  return formatPrice(parsed, getMarketWatchPriceDigits(symbol) ?? symbol);
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
    const description = String(candidate ?? '').trim();
    if (description && normalizeSymbol(description) !== normalizeSymbol(symbol)) return description;
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
