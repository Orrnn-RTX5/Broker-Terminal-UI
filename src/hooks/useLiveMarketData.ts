/**
 * Stable public surface for market-data hooks and normalization helpers.
 *
 * Runtime responsibilities live under `features/market-data`; keeping this
 * facade preserves the long-standing import path used throughout the terminal.
 */
export type {
  ActiveMarketSymbolsCache,
  LiveOrderBook,
  MarketInstrument,
  MarketInstrumentsSnapshot,
  OrderBookLevel,
  StaleQuoteFailure,
} from '../features/market-data/marketDataTypes';

export {
  buildAccountSpreadMarkupMap,
  getStaleQuoteFailure,
  MARKET_SYMBOLS_STALE_EVENT,
  normalizeInstrumentEnabled,
  normalizeOrderBook,
} from '../features/market-data/marketDataNormalization';

export {
  ACTIVE_MARKET_SYMBOLS_REFRESH_INTERVAL_MS,
  ACTIVE_MARKET_SYMBOLS_STORAGE_KEY_PREFIX,
  extractActiveMarketSymbols,
  getActiveMarketSymbolsStorageKey,
  getLiveQuoteRestBatches,
  getMarketSymbolFreshness,
  hasAuthoritativeMarketSymbolStatus,
  LIVE_QUOTES_REST_BATCH_SIZE,
  MARKET_SYMBOLS_REFRESH_REQUESTED_EVENT,
  readCachedActiveMarketSymbols,
  requestMarketSymbolsRefresh,
  useActiveMarketSymbols,
} from '../features/market-data/useActiveMarketSymbols';
export type { MarketSymbolFreshness } from '../features/market-data/useActiveMarketSymbols';

export { useMarketInstruments } from '../features/market-data/useMarketInstruments';
export { useLiveQuotes } from '../features/market-data/useLiveQuotes';
export {
  applySpreadMarkupToOrderBook,
  useLiveOrderBook,
} from '../features/market-data/useLiveOrderBook';
export { useRemoteWatchlistSync } from '../features/market-data/useRemoteWatchlistSync';
