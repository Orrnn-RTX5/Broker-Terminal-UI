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
  activeFeedSymbols: unknown[],
): string[] => {
  // Charts are read-only navigation and may be opened from either the account
  // catalog or the broker's current public feed. Trading remains protected by
  // the stricter intersection in buildTradeEligibleSymbolNames below.
  return getUniqueSymbolNames([...instrumentSymbols, ...activeFeedSymbols]);
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
 * During initial restoration, prefer a live broker-catalog symbol. Once that
 * preference is applied, keep an authorized selection even if its feed drops.
 */
export const pickPreferredChartSymbol = (
  authorizedSymbols: unknown[],
  liveFeedSymbols: unknown[] = [],
  requestedSymbol?: unknown,
  preferLiveSymbol = true,
): string => {
  const authorized = getUniqueSymbolNames(authorizedSymbols);
  const live = getUniqueSymbolNames(liveFeedSymbols).filter((symbol) => (
    authorized.length === 0 || authorized.includes(symbol)
  ));
  const requested = resolveAuthorizedChartSymbol(requestedSymbol, authorized.length > 0 ? authorized : live);

  if (requested && (!preferLiveSymbol || live.length === 0 || live.includes(requested))) {
    return requested;
  }

  if (live[0]) return live[0];
  if (requested) return requested;
  return authorized[0] || '';
};
