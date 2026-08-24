import { DEFAULT_MARKET_WATCH_SYMBOLS, resolveMarketWatchSymbolInput } from './marketWatchSource';

export const normalizeSymbolName = (value: unknown): string => String(value ?? '').trim().toUpperCase();

export const getInstrumentSymbolName = (instrument: unknown): string => {
  if (instrument && typeof instrument === 'object') {
    const record = instrument as Record<string, unknown>;
    return normalizeSymbolName(record.symbol ?? record.name ?? record.id);
  }
  return normalizeSymbolName(instrument);
};

export const getUniqueSymbolNames = (symbols: unknown[]): string[] => {
  return Array.from(new Set((Array.isArray(symbols) ? symbols : []).map(getInstrumentSymbolName).filter(Boolean)));
};

export const buildChartEligibleSymbolNames = (
  instrumentSymbols: unknown[],
  _activeFeedSymbols: unknown[],
): string[] => {
  void _activeFeedSymbols;
  // An authorized chart is allowed to create its own quote demand. Requiring an
  // already-active feed here would prevent a stale/evicted symbol from ever
  // recovering after the user opens it.
  return getUniqueSymbolNames(instrumentSymbols);
};

export const buildTradeEligibleSymbolNames = (
  instrumentSymbols: unknown[],
  activeFeedSymbols: unknown[],
): string[] => {
  const activeFeedSymbolSet = new Set(getUniqueSymbolNames(activeFeedSymbols));
  return getUniqueSymbolNames(instrumentSymbols).filter((symbol) => activeFeedSymbolSet.has(symbol));
};

/**
 * Resolves chart navigation against the broker-authorized catalog. Feed
 * freshness is deliberately not an input because opening the chart creates
 * the demand that can restore a stale or evicted feed subscription.
 */
export const resolveAuthorizedChartSymbol = (
  requestedSymbol: unknown,
  authorizedSymbols: unknown[],
): string => {
  const normalizedRequest = normalizeSymbolName(requestedSymbol);
  if (!normalizedRequest) return '';

  return resolveMarketWatchSymbolInput(
    getUniqueSymbolNames(authorizedSymbols),
    normalizedRequest,
  ) ?? '';
};

/**
 * Pick the chart symbol that can actually render right now.
 * A saved/requested symbol wins only when it is currently live. Otherwise
 * prefer the product default watchlist order among live feed symbols so a
 * weekend session opens BTCUSD instead of a blank EURUSD/XAUUSD chart.
 */
export const pickPreferredChartSymbol = (
  authorizedSymbols: unknown[],
  liveFeedSymbols: unknown[] = [],
  requestedSymbol?: unknown,
): string => {
  const authorized = getUniqueSymbolNames(authorizedSymbols);
  const live = getUniqueSymbolNames(liveFeedSymbols).filter((symbol) => (
    authorized.length === 0 || authorized.includes(symbol)
  ));
  const requested = resolveAuthorizedChartSymbol(requestedSymbol, authorized.length > 0 ? authorized : live);

  if (requested && (live.length === 0 || live.includes(requested))) {
    return requested;
  }

  for (const symbol of DEFAULT_MARKET_WATCH_SYMBOLS) {
    if (live.includes(symbol)) return symbol;
  }

  if (live[0]) return live[0];
  if (requested) return requested;
  return authorized[0] || '';
};
