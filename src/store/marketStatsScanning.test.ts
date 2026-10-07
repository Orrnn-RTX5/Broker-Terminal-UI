// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('../services/aggregationWorkerManager', () => ({
  cancelPendingAggregations: vi.fn(),
  getWorkerManager: () => ({ aggregateSymbols: vi.fn() }),
}));
import { MARKET_TICK_BUFFER_LIMIT, useMarketDataStore, type OHLCV, type Tick } from './useMarketDataStore';

const NOW = Date.UTC(2026, 9, 5, 13);
const DAY = 86_400_000;
const tick = (index: number, overrides: Partial<Tick> = {}): Tick => ({
  symbol: 'BTCUSD', bid: 86_000 + index / 100, ask: 86_015 + index / 100,
  timestamp: NOW - 10_000 + index, sourceTimestamp: NOW - 10_000 + index,
  spread: 15, lp: 'test', volume: 1, ...overrides,
});

// Independent reference preserves the deployed ordered arithmetic, including
// distinct zero/missing-volume defaults for reported volume and VWAP.
function reference(buffer: Tick[], current: Tick, candles: OHLCV[], now: number) {
  const included = buffer.filter(item => item.timestamp >= now - DAY);
  let high = current.bid, low = current.ask, reportedVolume = 0;
  for (const item of included) {
    high = Math.max(high, item.bid, item.ask);
    low = Math.min(low, item.bid, item.ask);
    reportedVolume += item.volume || 0;
  }
  let value = 0, volume = 0;
  for (const item of included) {
    value += ((item.bid + item.ask) / 2) * (item.volume || 1);
    volume += item.volume || 1;
  }
  const price = (current.bid + current.ask) / 2;
  const first = included.length ? (included[0].bid + included[0].ask) / 2 : price;
  const closes = candles.map(item => item.close);
  const sma = closes.length < 20 ? closes.at(-1) || 0
    : closes.slice(-20).reduce((sum, close) => sum + close, 0) / 20;
  const ema = !closes.length ? 0 : closes.length < 20
    ? closes.reduce((sum, close) => sum + close, 0) / closes.length : sma;
  return { symbol: 'BTCUSD', currentPrice: price, high24h: high, low24h: low,
    change24h: price - first, changePercent24h: first > 0 ? (price - first) / first * 100 : 0,
    volume24h: reportedVolume, vwap: volume > 0 ? value / volume : 0,
    sma20: sma, ema20: ema, lastUpdate: now };
}

function seed(buffer: Tick[], candles: OHLCV[] = []) {
  const current = buffer.at(-1) ?? tick(-1);
  useMarketDataStore.getState().updateTick('BTCUSD', current, { syncAppStore: false });
  const data = useMarketDataStore.getState().symbolData.BTCUSD;
  useMarketDataStore.setState({ symbolData: { BTCUSD: {
    ...data, currentTick: current, tickBuffer: buffer, stats: null,
    ohlcv1h: candles, lastAggregation: Date.now(),
  } } });
}

describe('retained market tick statistics', () => {
  beforeEach(() => {
    vi.spyOn(Date, 'now').mockReturnValue(NOW);
    useMarketDataStore.getState().clearAllData();
  });
  afterEach(() => vi.restoreAllMocks());

  it('reads each retained historical price pair once when refreshing statistics', () => {
    let reads = 0;
    const historical = Array.from({ length: 128 }, (_, index) => {
      const item = tick(index);
      const { bid, ask } = item;
      Object.defineProperties(item, {
        bid: { enumerable: true, get: () => { reads += 1; return bid; } },
        ask: { enumerable: true, get: () => { reads += 1; return ask; } },
      });
      return item;
    });
    // Keep the first reference-price tick plain so only the scan is counted.
    seed([tick(-1), ...historical, tick(129)]);
    reads = 0;
    useMarketDataStore.getState().updateTick('BTCUSD', tick(130), { syncAppStore: false });
    expect(reads).toBe(128 * 2);
    expect(useMarketDataStore.getState().symbolData.BTCUSD.tickBuffer).toHaveLength(131);
  });

  it('matches the deployed arithmetic across raw timestamps, volumes, clock changes and moving averages', () => {
    const inputs = [
      [],
      [tick(0, { timestamp: NOW - DAY - 1 }), tick(1, { timestamp: NOW - DAY }), tick(2, { timestamp: NOW - DAY + 1 })],
      [tick(0, { timestamp: NOW }), tick(1, { timestamp: NOW - DAY - 1 }), tick(2, { timestamp: NOW - 1 })],
      [tick(0, { volume: 0 }), tick(1, { volume: undefined }), tick(2, { volume: -4 })],
      [tick(0, { timestamp: NaN }), tick(1, { timestamp: Infinity }), tick(2, { timestamp: -Infinity })],
      [tick(0, { bid: NaN }), tick(1, { volume: NaN }), tick(2, { volume: Infinity })],
    ];
    for (const buffer of inputs) for (const offset of [0, -DAY - 1, DAY + 1]) for (const count of [0, 1, 19, 20, 21]) {
      vi.mocked(Date.now).mockReturnValue(NOW + offset);
      const candles = Array.from({ length: count }, (_, index) => ({
        timestamp: NOW - index * 3_600_000, open: 100, high: 105, low: 95,
        close: 100 + (index % 7) / 10, volume: 1,
      }));
      useMarketDataStore.getState().clearAllData();
      seed(buffer, candles);
      const current = tick(100, { timestamp: NOW + 1, sourceTimestamp: NOW + 1 });
      useMarketDataStore.getState().updateTick('BTCUSD', current, { syncAppStore: false });
      expect(useMarketDataStore.getState().symbolData.BTCUSD.stats)
        .toStrictEqual(reference([...buffer, current], current, candles, NOW + offset));
    }
  });

  it('retains exact statistics after capacity eviction and equal-source-time correction, rejecting older ticks', () => {
    const buffer = Array.from({ length: MARKET_TICK_BUFFER_LIMIT }, (_, index) => tick(index));
    seed(buffer);
    const next = tick(MARKET_TICK_BUFFER_LIMIT);
    useMarketDataStore.getState().updateTick('BTCUSD', next, { syncAppStore: false });
    let data = useMarketDataStore.getState().symbolData.BTCUSD;
    expect(data.tickBuffer).toHaveLength(MARKET_TICK_BUFFER_LIMIT);
    expect(data.tickBuffer[0]).toBe(buffer[1]);
    expect(data.stats).toStrictEqual(reference(data.tickBuffer, next, [], NOW));
    const correction = { ...next, bid: 85_000, volume: 0 };
    useMarketDataStore.getState().updateTick('BTCUSD', correction, { syncAppStore: false });
    data = useMarketDataStore.getState().symbolData.BTCUSD;
    expect(data.tickBuffer).toHaveLength(MARKET_TICK_BUFFER_LIMIT);
    expect(data.stats).toStrictEqual(reference(data.tickBuffer, correction, [], NOW));
    const snapshot = useMarketDataStore.getState();
    useMarketDataStore.getState().updateTick('BTCUSD', tick(0, { bid: 1 }), { syncAppStore: false });
    expect(useMarketDataStore.getState()).toBe(snapshot);
  });
});
