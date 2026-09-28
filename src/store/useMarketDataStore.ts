/**
 * Optimized Market Data Store with Real-Time Aggregation
 * - Efficient selectors to prevent re-renders
 * - Real-time OHLCV calculation (Web Worker powered)
 * - VWAP and moving averages
 * - High/Low tracking
 * - Performance optimized with proper partitioning
 * PERFORMANCE FIX: OHLCV aggregation offloaded to Web Worker (50-100ms → <5ms main thread)
 */

import { create } from 'zustand';
import { devtools, subscribeWithSelector } from 'zustand/middleware';
import { cancelPendingAggregations, getWorkerManager, type SymbolAggregationRequest, type SymbolAggregationResult } from '../services/aggregationWorkerManager';
import type { CandleUpdateSource, OHLCV, Tick } from '../types/marketData';
import {
  isStructurallyValidPriceCandle,
  repairPriceCandle,
} from '../services/chartPriceGuards';
import {
  areCanonicalUpstreamTicksEqual,
  coalesceFreshestTickEntries,
  compareCanonicalTickFreshness,
  getCanonicalTickTimestamp,
} from '../utils/liveTickSemantics';

const MARKET_DATA_DEBUG = import.meta.env.VITE_WS_DEBUG === 'true';

// ============================================
// Types
// ============================================

export type { CandleUpdateSource, OHLCV, Tick } from '../types/marketData';

export interface SymbolStats {
  symbol: string;
  currentPrice: number;
  high24h: number;
  low24h: number;
  change24h: number;
  changePercent24h: number;
  volume24h: number;
  vwap: number;
  sma20: number;
  ema20: number;
  lastUpdate: number;
}

interface SymbolData {
  currentTick: Tick | null;
  previousTick: Tick | null;
  stats: SymbolStats | null;
  ohlcv1m: OHLCV[];
  ohlcv5m: OHLCV[];
  ohlcv15m: OHLCV[];
  ohlcv1h: OHLCV[];
  tickBuffer: Tick[];
  lastAggregation: number;
}

export interface CandleUpdate {
  symbol: string;
  timeframe: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  time: number;
  /** Required so locally aggregated candles are never confused with authoritative backend OHLC. */
  source: CandleUpdateSource;
  /** Optional backend revision/event time, in seconds or milliseconds. */
  sourceTimestamp?: number;
  /** Optional authoritative finality carried by the candle websocket frame. */
  closed?: boolean;
}

export interface UpdateTickOptions {
  syncAppStore?: boolean;
}

export type MarketTickEntry = readonly [symbol: string, tick: Tick];

interface MarketDataState {
  // Symbol data organized by symbol for efficient access
  symbolData: Record<string, SymbolData>;

  // Subscription tracking
  subscribedSymbols: Set<string>;

  // Actions
  updateTick: (symbol: string, tick: Tick, options?: UpdateTickOptions) => void;
  updateTicksBatch: (ticks: readonly MarketTickEntry[], options?: UpdateTickOptions) => void;
  updateCandle: (update: CandleUpdate) => void;
  updateBulkTicks: (ticks: Tick[]) => void;
  subscribeSymbol: (symbol: string) => void;
  unsubscribeSymbol: (symbol: string) => void;
  aggregateOHLCV: (symbol: string) => void;
  clearTickBuffer: (symbol: string) => void;
  clearSymbolData: (symbol: string) => void;
  clearAllData: () => void;

  // Selectors (computed properties)
  getCurrentTick: (symbol: string) => Tick | null;
  getSymbolStats: (symbol: string) => SymbolStats | null;
  getOHLCV: (symbol: string, timeframe: '1m' | '5m' | '15m' | '1h') => OHLCV[];
}

// ============================================
// Helper Functions
// ============================================

function createEmptySymbolData(): SymbolData {
  return {
    currentTick: null,
    previousTick: null,
    stats: null,
    ohlcv1m: [],
    ohlcv5m: [],
    ohlcv15m: [],
    ohlcv1h: [],
    tickBuffer: [],
    lastAggregation: 0,
  };
}

const normalizeMarketSymbol = (symbol: unknown): string => (
  String(symbol || '').trim().toUpperCase()
);

const normalizePositiveTimestampMs = (value: unknown): number | undefined => {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) return undefined;
  return Math.floor(numeric < 1_000_000_000_000 ? numeric * 1000 : numeric);
};

const areOHLCVRowsEqual = (left: OHLCV, right: OHLCV): boolean => (
  left.timestamp === right.timestamp
  && left.open === right.open
  && left.high === right.high
  && left.low === right.low
  && left.close === right.close
  && left.volume === right.volume
  && left.source === right.source
  && left.sourceTimestamp === right.sourceTimestamp
  && left.closed === right.closed
);

const toStoredCandle = (update: CandleUpdate): OHLCV | null => {
  const timestamp = normalizePositiveTimestampMs(update.time);
  if (timestamp === undefined) return null;

  const prices = {
    open: Number(update.open),
    high: Number(update.high),
    low: Number(update.low),
    close: Number(update.close),
  };
  const acceptedPrices = update.source === 'server'
    ? (isStructurallyValidPriceCandle(prices) ? prices : null)
    : repairPriceCandle(prices);
  if (!acceptedPrices || !isStructurallyValidPriceCandle(acceptedPrices)) return null;

  const numericVolume = Number(update.volume);
  const sourceTimestamp = normalizePositiveTimestampMs(update.sourceTimestamp);
  return {
    timestamp,
    ...acceptedPrices,
    volume: Number.isFinite(numericVolume) && numericVolume >= 0 ? numericVolume : 0,
    source: update.source,
    ...(sourceTimestamp === undefined ? {} : { sourceTimestamp }),
    // FIX: Do not discard final/closed metadata at the enhanced socket/store
    // boundary; exact server corrections can now retain bucket lifecycle state.
    ...(update.closed === undefined ? {} : { closed: update.closed }),
  };
};

const mergeCandleRow = (
  candles: readonly OHLCV[],
  incoming: OHLCV,
  limit: number,
): OHLCV[] => {
  const existingIndex = candles.findIndex((candle) => candle.timestamp === incoming.timestamp);
  let replacement = incoming;

  if (existingIndex >= 0) {
    const existing = candles[existingIndex];

    // FIX: Backend OHLC is authoritative. Replace the exact bucket verbatim so
    // a correction can narrow a previously wrong wick; reject older revisions
    // and never let a delayed local-worker result overwrite a server row.
    if (existing.source === 'server' && incoming.source === 'local') return candles as OHLCV[];
    if (
      existing.sourceTimestamp !== undefined
      && (
        incoming.sourceTimestamp === undefined
        || incoming.sourceTimestamp < existing.sourceTimestamp
      )
    ) {
      return candles as OHLCV[];
    }

    if (incoming.source === 'local') {
      const sealed = repairPriceCandle({
        open: existing.open,
        high: Math.max(existing.high, incoming.high),
        low: Math.min(existing.low, incoming.low),
        close: incoming.close,
      });
      if (!sealed || !isStructurallyValidPriceCandle(sealed)) return candles as OHLCV[];
      replacement = { ...incoming, ...sealed };
    }

    if (areOHLCVRowsEqual(existing, replacement)) return candles as OHLCV[];
    const updated = [...candles];
    updated[existingIndex] = replacement;
    return updated.sort((left, right) => left.timestamp - right.timestamp).slice(-limit);
  }

  return [...candles, replacement]
    .sort((left, right) => left.timestamp - right.timestamp)
    .slice(-limit);
};

const mergeLocalAggregation = (
  existing: readonly OHLCV[],
  aggregated: readonly OHLCV[],
  limit: number,
): OHLCV[] => {
  const byTimestamp = new Map(existing.map((candle) => [candle.timestamp, candle]));

  aggregated.forEach((candle) => {
    const repaired = repairPriceCandle(candle);
    if (!repaired || !isStructurallyValidPriceCandle(repaired)) return;

    const previous = byTimestamp.get(repaired.timestamp);
    if (previous?.source === 'server') return;

    if (!previous) {
      byTimestamp.set(repaired.timestamp, { ...repaired, source: 'local' });
      return;
    }

    const sealed = repairPriceCandle({
      open: previous.open,
      high: Math.max(previous.high, repaired.high),
      low: Math.min(previous.low, repaired.low),
      close: repaired.close,
    });
    if (!sealed || !isStructurallyValidPriceCandle(sealed)) return;
    byTimestamp.set(repaired.timestamp, { ...repaired, ...sealed, source: 'local' });
  });

  return Array.from(byTimestamp.values())
    .sort((left, right) => left.timestamp - right.timestamp)
    .slice(-limit);
};

export const MARKET_TICK_BUFFER_LIMIT = 10_000;

/**
 * Treat only byte-for-byte-equivalent enumerable payloads as duplicates.
 * In particular, a newer timestamp at the same price is not a duplicate: it
 * still carries freshness and aggregation semantics.
 */
export function areMarketTicksIdentical(previous: Tick | null, next: Tick): boolean {
  return previous !== null && areCanonicalUpstreamTicksEqual(previous, next);
}

export function appendBoundedTick(
  ticks: readonly Tick[],
  tick: Tick,
  limit = MARKET_TICK_BUFFER_LIMIT,
): Tick[] {
  if (limit <= 0) return [];
  if (ticks.length < limit) return [...ticks, tick];
  const firstRetainedIndex = Math.max(0, ticks.length - limit + 1);
  return [...ticks.slice(firstRetainedIndex), tick];
}

interface PendingAggregation extends SymbolAggregationRequest {
  owner: number;
  revision: number;
}

let aggregationSession = 0;
let aggregationRevision = 0;
const latestAggregationRevision = new Map<string, number>();
const aggregationOwners = new Map<string, number>();

const ownPendingAggregation = (request: SymbolAggregationRequest, isCorrection: boolean): PendingAggregation => {
  const revision = ++aggregationRevision;
  // An equal-time correction replaces a tick in the same buffer. Its pending
  // predecessor is known obsolete and must not seed a wrong local wick/open.
  const owner = (isCorrection ? undefined : aggregationOwners.get(request.symbol)) ?? revision;
  aggregationOwners.set(request.symbol, owner);
  return { ...request, owner, revision };
};

const replaceSameTimestampTick = (ticks: readonly Tick[], tick: Tick): Tick[] => {
  const timestamp = getCanonicalTickTimestamp(tick);
  if (timestamp === null) return [...ticks];
  for (let index = ticks.length - 1; index >= 0; index -= 1) {
    if (getCanonicalTickTimestamp(ticks[index]) !== timestamp) continue;
    const next = [...ticks];
    next[index] = tick;
    return next;
  }
  return appendBoundedTick(ticks, tick);
};

const findLastStrictlyOlderTick = (ticks: readonly Tick[], timestamp: number | null): Tick | null => {
  if (timestamp === null) return null;
  for (let index = ticks.length - 1; index >= 0; index -= 1) {
    const candidateTimestamp = getCanonicalTickTimestamp(ticks[index]);
    if (candidateTimestamp !== null && candidateTimestamp < timestamp) return ticks[index];
  }
  return null;
};

function calculateVWAP(ticks: Tick[]): number {
  if (ticks.length === 0) return 0;

  let totalVolume = 0;
  let totalValue = 0;

  ticks.forEach((tick) => {
    const price = (tick.bid + tick.ask) / 2;
    const volume = tick.volume || 1;
    totalValue += price * volume;
    totalVolume += volume;
  });

  return totalVolume > 0 ? totalValue / totalVolume : 0;
}

function calculateSMA(prices: number[], period: number): number {
  if (prices.length < period) return prices[prices.length - 1] || 0;

  const slice = prices.slice(-period);
  const sum = slice.reduce((acc, price) => acc + price, 0);
  return sum / period;
}

function calculateEMA(prices: number[], period: number, prevEMA?: number): number {
  if (prices.length === 0) return 0;
  if (prices.length < period) return calculateSMA(prices, prices.length);

  const latestPrice = prices[prices.length - 1];
  if (!prevEMA) {
    return calculateSMA(prices, period);
  }

  const multiplier = 2 / (period + 1);
  return (latestPrice - prevEMA) * multiplier + prevEMA;
}

function aggregateTicksToOHLCV(ticks: Tick[], timeframeMs: number): OHLCV[] {
  if (ticks.length === 0) return [];

  const ohlcvMap = new Map<number, OHLCV>();

  // FIX: Sort by authoritative source time so delayed delivery cannot regress
  // Close, and use Bid-only OHLC to match the chart/worker/backend contract.
  [...ticks].sort((left, right) => (
    (getCanonicalTickTimestamp(left) ?? 0) - (getCanonicalTickTimestamp(right) ?? 0)
  )).forEach((tick) => {
    const eventTime = getCanonicalTickTimestamp(tick);
    if (eventTime === null) return;
    const bucketTime = Math.floor(eventTime / timeframeMs) * timeframeMs;
    const bid = Number.isFinite(tick.bid) && tick.bid > 0 ? tick.bid : null;
    const ask = Number.isFinite(tick.ask) && tick.ask > 0 ? tick.ask : null;
    const chartPrice = bid ?? ask;
    if (chartPrice === null) return;
    const volume = tick.volume || 1;

    if (!ohlcvMap.has(bucketTime)) {
      ohlcvMap.set(bucketTime, {
        timestamp: bucketTime,
        open: chartPrice,
        high: chartPrice,
        low: chartPrice,
        close: chartPrice,
        volume: volume,
      });
    } else {
      const ohlcv = ohlcvMap.get(bucketTime)!;
      ohlcv.high = Math.max(ohlcv.high, chartPrice);
      ohlcv.low = Math.min(ohlcv.low, chartPrice);
      ohlcv.close = chartPrice;
      ohlcv.volume += volume;
    }
  });

  return Array.from(ohlcvMap.values()).sort((a, b) => a.timestamp - b.timestamp);
}

function calculateStats(
  symbol: string,
  currentTick: Tick,
  previousTick: Tick | null,
  tickBuffer: Tick[],
  ohlcv1h: OHLCV[]
): SymbolStats {
  const now = Date.now();
  const twentyFourHoursAgo = now - 24 * 60 * 60 * 1000;

  // Get ticks from last 24 hours
  const ticks24h = tickBuffer.filter((t) => t.timestamp >= twentyFourHoursAgo);

  // Calculate high/low
  let high24h = currentTick.bid;
  let low24h = currentTick.ask;
  let volume24h = 0;

  ticks24h.forEach((tick) => {
    high24h = Math.max(high24h, tick.bid, tick.ask);
    low24h = Math.min(low24h, tick.bid, tick.ask);
    volume24h += tick.volume || 0;
  });

  // Calculate change
  const currentPrice = (currentTick.bid + currentTick.ask) / 2;
  const price24hAgo = ticks24h.length > 0 ? (ticks24h[0].bid + ticks24h[0].ask) / 2 : currentPrice;
  const change24h = currentPrice - price24hAgo;
  const changePercent24h = price24hAgo > 0 ? (change24h / price24hAgo) * 100 : 0;

  // Calculate VWAP
  const vwap = calculateVWAP(ticks24h);

  // Calculate moving averages from OHLCV data
  const closePrices = ohlcv1h.map((candle) => candle.close);
  const sma20 = calculateSMA(closePrices, 20);
  const ema20 = calculateEMA(closePrices, 20);

  return {
    symbol,
    currentPrice,
    high24h,
    low24h,
    change24h,
    changePercent24h,
    volume24h,
    vwap,
    sma20,
    ema20,
    lastUpdate: now,
  };
}

const applyMarketTick = (
  symbol: string,
  tick: Tick,
  data: SymbolData,
  now: number,
): { data: SymbolData; aggregation: SymbolAggregationRequest | null; isCorrection: boolean } | null => {
  const freshness = data.currentTick
    ? compareCanonicalTickFreshness(data.currentTick, tick)
    : 1;
  if (freshness < 0) return null;
  if (freshness === 0 && areMarketTicksIdentical(data.currentTick, tick)) return null;

  const isCorrection = freshness === 0;
  const tickTimestamp = getCanonicalTickTimestamp(tick);
  const previousTick = isCorrection
    ? findLastStrictlyOlderTick(data.tickBuffer, tickTimestamp) ?? data.previousTick
    : data.currentTick;
  const tickBuffer = isCorrection
    ? replaceSameTimestampTick(data.tickBuffer, tick)
    : appendBoundedTick(data.tickBuffer, tick);
  const shouldAggregate = isCorrection || now - data.lastAggregation > 60_000;
  const shouldUpdateStats = isCorrection || !data.stats || now - data.stats.lastUpdate > 1_000;
  const stats = shouldUpdateStats
    ? calculateStats(symbol, tick, previousTick, tickBuffer, data.ohlcv1h)
    : data.stats;

  return {
    isCorrection,
    data: {
      ...data,
      currentTick: tick,
      previousTick,
      stats,
      tickBuffer,
      lastAggregation: shouldAggregate ? now : data.lastAggregation,
    },
    aggregation: shouldAggregate ? { symbol, tickBuffer } : null,
  };
};

const schedulePendingAggregations = (
  requests: readonly PendingAggregation[],
  session: number,
  commit: (results: SymbolAggregationResult[]) => void,
): void => {
  if (requests.length === 0 || session !== aggregationSession) return;
  const ownedRequests = requests.filter(({ symbol, owner }) => aggregationOwners.get(symbol) === owner);
  if (ownedRequests.length === 0) return;
  const revisions = new Map(ownedRequests.map(request => [request.symbol, request]));
  try {
    getWorkerManager().aggregateSymbols(ownedRequests, [
      { name: '1m', ms: 60 * 1_000 },
      { name: '5m', ms: 5 * 60 * 1_000 },
      { name: '15m', ms: 15 * 60 * 1_000 },
      { name: '1h', ms: 60 * 60 * 1_000 },
    ], (results) => {
      if (session !== aggregationSession) return;
      const currentResults = results.filter(({ symbol, error }) => {
        if (error) console.error(`[MarketDataStore] Worker result failed for ${symbol}:`, error);
        const request = revisions.get(symbol);
        return !error && request && request.owner === aggregationOwners.get(symbol)
          && request.revision > (latestAggregationRevision.get(symbol) ?? 0);
      });
      if (currentResults.length > 0) {
        // Mark before publishing: a synchronous subscriber can trigger another
        // aggregation. FIFO replies still retain older buckets when a later
        // request has trimmed its rolling buffer, while stale replies cannot
        // overwrite an already committed correction.
        currentResults.forEach(({ symbol }) => latestAggregationRevision.set(symbol, revisions.get(symbol)!.revision));
        commit(currentResults);
      }
    });
  } catch (error) {
    console.error('[MarketDataStore] Worker scheduling failed:', error);
  }
};

// ============================================
// Store
// ============================================

export const useMarketDataStore = create<MarketDataState>()(
  subscribeWithSelector(
    devtools(
      (set, get) => ({
        symbolData: {},
        subscribedSymbols: new Set(),

        updateTick: (symbol, tick, options = {}) => {
          get().updateTicksBatch([[symbol, tick]], options);
        },

        updateTicksBatch: (ticks, options = {}) => {
          const session = aggregationSession;
          const { syncAppStore = true } = options;
          const latestTicks = coalesceFreshestTickEntries(ticks, (symbol, error) => {
            console.error(`[MarketDataStore] Ignoring invalid tick for ${symbol}:`, error);
          });
          if (latestTicks.length === 0) return;

          const pendingAggregations: PendingAggregation[] = [];
          const now = Date.now();
          set((state) => {
            let nextSymbolData = state.symbolData;
            let changed = false;

            latestTicks.forEach(([symbol, tick]) => {
              try {
                const currentData = nextSymbolData[symbol] || createEmptySymbolData();
                const transition = applyMarketTick(symbol, tick, currentData, now);
                if (!transition) return;

                if (!changed) nextSymbolData = { ...state.symbolData };
                nextSymbolData[symbol] = transition.data;
                changed = true;
                // Capture ownership before set() notifies subscribers. A
                // reentrant correction/clear must supersede this exact snapshot.
                if (transition.aggregation) pendingAggregations.push(ownPendingAggregation(transition.aggregation, transition.isCorrection));
              } catch (error) {
                console.error(`[MarketDataStore] Tick transition failed for ${symbol}:`, error);
              }
            });

            return changed ? { symbolData: nextSymbolData } : state;
          });

          schedulePendingAggregations(pendingAggregations, session, (rows) => {
            set((state) => {
              let symbolData = state.symbolData;
              rows.forEach(({ symbol, results }) => {
                const currentData = symbolData[symbol];
                if (!currentData || !results) return;
                try {
                  const nextData = {
                    ...currentData,
                    // Backend rows remain authoritative even if they arrived
                    // between the worker request and this batched response.
                    ohlcv1m: mergeLocalAggregation(currentData.ohlcv1m, results['1m'], 1000),
                    ohlcv5m: mergeLocalAggregation(currentData.ohlcv5m, results['5m'], 500),
                    ohlcv15m: mergeLocalAggregation(currentData.ohlcv15m, results['15m'], 300),
                    ohlcv1h: mergeLocalAggregation(currentData.ohlcv1h, results['1h'], 200),
                  };
                  if (symbolData === state.symbolData) symbolData = { ...state.symbolData };
                  symbolData[symbol] = nextData;
                } catch (error) {
                  console.error(`[MarketDataStore] Worker result failed for ${symbol}:`, error);
                }
              });
              return symbolData === state.symbolData ? state : { symbolData };
            });
          });

          // Keep the circular dependency asynchronous, but publish a whole
          // frame to the app store in one state transition.
          if (syncAppStore) {
            import('../store/useAppStore').then(({ useAppStore }) => {
              if (session !== aggregationSession) return;
              useAppStore.getState().setTicksBatch(latestTicks);
            }).catch(() => {/* ignore */});
          }
        },

        updateCandle: (update) => {
          const symbol = normalizeMarketSymbol(update.symbol);
          const timeframe = String(update.timeframe || '').trim().toUpperCase();
          if (!symbol || timeframe !== 'M1') return;

          // FIX: Server OHLC is validated and stored exactly, never repaired.
          // repairPriceCandle remains limited to explicitly local aggregation.
          const incoming = toStoredCandle(update);
          if (!incoming) return;
          if (MARKET_DATA_DEBUG) {
            console.log(`[Store updateCandle] ${symbol} ${timeframe} O=${incoming.open} H=${incoming.high} L=${incoming.low} C=${incoming.close} time=${incoming.timestamp}`);
          }
          set((state) => {
            const data = state.symbolData[symbol] || createEmptySymbolData();
            const newOHLCV = mergeCandleRow(data.ohlcv1m, incoming, 1000);
            if (newOHLCV === data.ohlcv1m) return state;

            if (MARKET_DATA_DEBUG) {
              console.log(`[Store updateCandle] ${symbol} now has ${newOHLCV.length} candles`);
            }

            return {
              symbolData: {
                ...state.symbolData,
                [symbol]: {
                  ...data,
                  ohlcv1m: newOHLCV,
                  // Note: Server candles do not change local aggregation cadence.
                }
              }
            };
          });
        },

        updateBulkTicks: (ticks) => {
          get().updateTicksBatch(ticks.map((tick) => [tick.symbol, tick] as const));
        },

        subscribeSymbol: (symbol) => {
          set((state) => ({
            subscribedSymbols: new Set([...state.subscribedSymbols, symbol]),
            symbolData: {
              ...state.symbolData,
              [symbol]: state.symbolData[symbol] || createEmptySymbolData(),
            },
          }));
        },

        unsubscribeSymbol: (symbol) => {
          set((state) => {
            const newSubscribed = new Set(state.subscribedSymbols);
            newSubscribed.delete(symbol);
            return { subscribedSymbols: newSubscribed };
          });
        },

        aggregateOHLCV: (symbol) => {
          aggregationOwners.delete(symbol);
          latestAggregationRevision.delete(symbol);
          set((state) => {
            const data = state.symbolData[symbol];
            if (!data || data.tickBuffer.length === 0) return state;

            // FIX: Manual local aggregation also merges by bucket so it cannot
            // discard server history outside the tick buffer or replace it.
            const ohlcv1m = mergeLocalAggregation(data.ohlcv1m, aggregateTicksToOHLCV(data.tickBuffer, 60 * 1000), 1000);
            const ohlcv5m = mergeLocalAggregation(data.ohlcv5m, aggregateTicksToOHLCV(data.tickBuffer, 5 * 60 * 1000), 500);
            const ohlcv15m = mergeLocalAggregation(data.ohlcv15m, aggregateTicksToOHLCV(data.tickBuffer, 15 * 60 * 1000), 300);
            const ohlcv1h = mergeLocalAggregation(data.ohlcv1h, aggregateTicksToOHLCV(data.tickBuffer, 60 * 60 * 1000), 200);

            return {
              symbolData: {
                ...state.symbolData,
                [symbol]: {
                  ...data,
                  ohlcv1m,
                  ohlcv5m,
                  ohlcv15m,
                  ohlcv1h,
                  lastAggregation: Date.now(),
                },
              },
            };
          });
        },

        clearSymbolData: (symbol) => {
          aggregationOwners.delete(symbol);
          latestAggregationRevision.delete(symbol);
          set((state) => {
            const newData = { ...state.symbolData };
            delete newData[symbol];
            return { symbolData: newData };
          });
        },

        clearTickBuffer: (symbol) => {
          set((state) => {
            const data = state.symbolData[symbol];
            if (!data || data.tickBuffer.length === 0) return state;
            return {
              symbolData: {
                ...state.symbolData,
                [symbol]: {
                  ...data,
                  tickBuffer: [],
                },
              },
            };
          });
        },

        clearAllData: () => {
          aggregationSession += 1;
          aggregationOwners.clear();
          latestAggregationRevision.clear();
          cancelPendingAggregations();
          set({
            symbolData: {},
            subscribedSymbols: new Set(),
          });
        },

        // Selector functions
        getCurrentTick: (symbol) => {
          const data = get().symbolData[symbol];
          return data?.currentTick || null;
        },

        getSymbolStats: (symbol) => {
          const data = get().symbolData[symbol];
          return data?.stats || null;
        },

        getOHLCV: (symbol, timeframe) => {
          const data = get().symbolData[symbol];
          if (!data) return [];

          switch (timeframe) {
            case '1m':
              return data.ohlcv1m;
            case '5m':
              return data.ohlcv5m;
            case '15m':
              return data.ohlcv15m;
            case '1h':
              return data.ohlcv1h;
            default:
              return [];
          }
        },
      }),
      // Raw rolling buffers can contain 10,000 ticks per symbol. Keep this
      // high-frequency store out of Redux DevTools serialization.
      { name: 'MarketDataStore', enabled: false }
    )
  )
);

// ============================================
// Optimized Selectors
// ============================================

// Use these selectors in components to prevent unnecessary re-renders
export const useCurrentTick = (symbol: string) =>
  useMarketDataStore((state) => state.symbolData[symbol]?.currentTick);

export const useSymbolStats = (symbol: string) =>
  useMarketDataStore((state) => state.symbolData[symbol]?.stats);

export const useOHLCV = (symbol: string, timeframe: '1m' | '5m' | '15m' | '1h') =>
  useMarketDataStore((state) => {
    const data = state.symbolData[symbol];
    if (!data) return [];

    switch (timeframe) {
      case '1m':
        return data.ohlcv1m;
      case '5m':
        return data.ohlcv5m;
      case '15m':
        return data.ohlcv15m;
      case '1h':
        return data.ohlcv1h;
      default:
        return [];
    }
  });

export const useSubscribedSymbols = () =>
  useMarketDataStore((state) => Array.from(state.subscribedSymbols));

export const useRecentOHLCV = (symbol: string, timeframe: '1m') =>
  useMarketDataStore((state) => {
    const data = state.symbolData[symbol];
    if (!data) return null;
    if (timeframe === '1m' && data.ohlcv1m.length > 0) return data.ohlcv1m[data.ohlcv1m.length - 1];
    return null;
  });
