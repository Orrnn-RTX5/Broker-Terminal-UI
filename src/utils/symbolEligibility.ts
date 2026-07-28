import { resolveMarketWatchSymbolInput } from './marketWatchSource';

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
