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
import { getWorkerManager } from '../services/aggregationWorkerManager';

const MARKET_DATA_DEBUG = import.meta.env.VITE_WS_DEBUG === 'true';

// ============================================
// Types
// ============================================

export interface Tick {
  symbol: string;
  bid: number;
  ask: number;
  spread: number;
  timestamp: number;
  /** Upstream event time, distinct from a local receipt-time fallback. */
  sourceTimestamp?: number;
  lp?: string;
  volume?: number;
}

export interface OHLCV {
  timestamp: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

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
}

export interface UpdateTickOptions {
  syncAppStore?: boolean;
}

interface MarketDataState {
  // Symbol data organized by symbol for efficient access
  symbolData: Record<string, SymbolData>;

  // Subscription tracking
  subscribedSymbols: Set<string>;

  // Actions
  updateTick: (symbol: string, tick: Tick, options?: UpdateTickOptions) => void;
  updateCandle: (update: CandleUpdate) => void;
  updateBulkTicks: (ticks: Tick[]) => void;
  subscribeSymbol: (symbol: string) => void;
  unsubscribeSymbol: (symbol: string) => void;
  aggregateOHLCV: (symbol: string) => void;
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

  ticks.forEach((tick) => {
    const bucketTime = Math.floor(tick.timestamp / timeframeMs) * timeframeMs;
    const midPrice = (tick.bid + tick.ask) / 2;
    const volume = tick.volume || 1;

    if (!ohlcvMap.has(bucketTime)) {
      ohlcvMap.set(bucketTime, {
        timestamp: bucketTime,
        open: midPrice,
        high: midPrice,
        low: midPrice,
        close: midPrice,
        volume: volume,
      });
    } else {
      const ohlcv = ohlcvMap.get(bucketTime)!;
      ohlcv.high = Math.max(ohlcv.high, midPrice);
      ohlcv.low = Math.min(ohlcv.low, midPrice);
      ohlcv.close = midPrice;
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
          const { syncAppStore = true } = options;

          set((state) => {
            const data = state.symbolData[symbol] || createEmptySymbolData();

            // Update ticks
            const previousTick = data.currentTick;
            const currentTick = tick;

            // Add to tick buffer (keep last 10,000 ticks per symbol)
            const tickBuffer = [...data.tickBuffer, tick];
            if (tickBuffer.length > 10000) {
              tickBuffer.shift();
            }

            // PERFORMANCE FIX: Aggregate OHLCV in Web Worker (async, non-blocking)
            const now = Date.now();
            const shouldAggregate = now - data.lastAggregation > 60000;

            const ohlcv1m = data.ohlcv1m;
            const ohlcv5m = data.ohlcv5m;
            const ohlcv15m = data.ohlcv15m;
            const ohlcv1h = data.ohlcv1h;

            if (shouldAggregate && tickBuffer.length > 0) {
              // Offload to Web Worker (non-blocking)
              const worker = getWorkerManager();
              worker.aggregateMultipleTimeframes(
                tickBuffer,
                [
                  { name: '1m', ms: 60 * 1000 },
                  { name: '5m', ms: 5 * 60 * 1000 },
                  { name: '15m', ms: 15 * 60 * 1000 },
                  { name: '1h', ms: 60 * 60 * 1000 },
                ],
                (results) => {
                  // Update store with worker results (async)
                  set((state) => {
                    const currentData = state.symbolData[symbol];
                    if (!currentData) return state;

                    return {
                      symbolData: {
                        ...state.symbolData,
                        [symbol]: {
                          ...currentData,
                          ohlcv1m: [...currentData.ohlcv1m, ...results['1m']].slice(-1000),
                          ohlcv5m: [...currentData.ohlcv5m, ...results['5m']].slice(-500),
                          ohlcv15m: [...currentData.ohlcv15m, ...results['15m']].slice(-300),
                          ohlcv1h: [...currentData.ohlcv1h, ...results['1h']].slice(-200),
                        },
                      },
                    };
                  });
                }
              );
            }

            // Stats scan the rolling buffer, so avoid doing that work for every
            // high-frequency tick while keeping UI stats fresh.
            const shouldUpdateStats = !data.stats || now - data.stats.lastUpdate > 1000;
            const stats = shouldUpdateStats
              ? calculateStats(symbol, currentTick, previousTick, tickBuffer, ohlcv1h)
              : data.stats;

            return {
              symbolData: {
                ...state.symbolData,
                [symbol]: {
                  ...data,
                  currentTick,
                  previousTick,
                  stats,
                  tickBuffer,
                  lastAggregation: shouldAggregate ? now : data.lastAggregation,
                },
              },
            };
          });

          // ─── Cross-store sync: TradingChart polls useAppStore.ticks ───────────
          // Dynamically import to avoid circular dep. Fire-and-forget.
          if (syncAppStore) {
            import('../store/useAppStore').then(({ useAppStore }) => {
              useAppStore.getState().setTick(symbol, tick as any);
            }).catch(() => {/* ignore */});
          }
        },


        updateCandle: (update) => {
          if (MARKET_DATA_DEBUG) {
            console.log(`[Store updateCandle] ${update.symbol} ${update.timeframe} O=${update.open} H=${update.high} L=${update.low} C=${update.close} time=${update.time}`);
          }
          set((state) => {
            const data = state.symbolData[update.symbol] || createEmptySymbolData();

            // Only handling 1m for now as per backend
            if (update.timeframe === 'M1') {
              const ohlcv = data.ohlcv1m;
              const lastCandle = ohlcv[ohlcv.length - 1];

              const newOHLCV = [...ohlcv];
              if (lastCandle && lastCandle.timestamp === update.time * 1000) {
                // Update existing
                newOHLCV[newOHLCV.length - 1] = {
                  timestamp: update.time * 1000,
                  open: update.open,
                  high: update.high,
                  low: update.low,
                  close: update.close,
                  volume: update.volume
                };
              } else {
                // New candle
                newOHLCV.push({
                  timestamp: update.time * 1000,
                  open: update.open,
                  high: update.high,
                  low: update.low,
                  close: update.close,
                  volume: update.volume
                });
                if (newOHLCV.length > 1000) newOHLCV.shift();
              }

              if (MARKET_DATA_DEBUG) {
                console.log(`[Store updateCandle] ${update.symbol} now has ${newOHLCV.length} candles`);
              }

              return {
                symbolData: {
                  ...state.symbolData,
                  [update.symbol]: {
                    ...data,
                    ohlcv1m: newOHLCV,
                    // Note: We don't update lastAggregation here as this is from server
                  }
                }
              };
            }
            return state;
          });
        },

        updateBulkTicks: (ticks) => {
          // Group ticks by symbol for efficient processing
          const ticksBySymbol = ticks.reduce((acc, tick) => {
            if (!acc[tick.symbol]) {
              acc[tick.symbol] = [];
            }
            acc[tick.symbol].push(tick);
            return acc;
          }, {} as Record<string, Tick[]>);

          // Update each symbol
          Object.entries(ticksBySymbol).forEach(([symbol, symbolTicks]) => {
            // Process only the latest tick for each symbol
            const latestTick = symbolTicks[symbolTicks.length - 1];
            get().updateTick(symbol, latestTick);
          });
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
          set((state) => {
            const data = state.symbolData[symbol];
            if (!data || data.tickBuffer.length === 0) return state;

            const ohlcv1m = aggregateTicksToOHLCV(data.tickBuffer, 60 * 1000);
            const ohlcv5m = aggregateTicksToOHLCV(data.tickBuffer, 5 * 60 * 1000);
            const ohlcv15m = aggregateTicksToOHLCV(data.tickBuffer, 15 * 60 * 1000);
            const ohlcv1h = aggregateTicksToOHLCV(data.tickBuffer, 60 * 60 * 1000);

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
          set((state) => {
            const newData = { ...state.symbolData };
            delete newData[symbol];
            return { symbolData: newData };
          });
        },

        clearAllData: () => {
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
      { name: 'MarketDataStore' }
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
