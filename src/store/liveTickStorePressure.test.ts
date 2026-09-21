// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const workerMocks = vi.hoisted(() => ({
  aggregateSymbols: vi.fn(),
}));
vi.mock('../services/aggregationWorkerManager', () => ({
  cancelPendingAggregations: vi.fn(),
  getWorkerManager: () => workerMocks,
}));

import {
  appendBoundedTick,
  areMarketTicksIdentical,
  MARKET_TICK_BUFFER_LIMIT,
  useMarketDataStore,
  type Tick as MarketTick,
} from './useMarketDataStore';
import {
  resolveTickFromLookup,
  selectTickCount,
  useAppStore,
  type Tick as AppTick,
} from './useAppStore';
import {
  enqueueLiveTick,
  resetLiveTickDispatcherForTests,
} from '../services/liveTickDispatcher';

const marketTick = (timestamp: number, overrides: Partial<MarketTick> = {}): MarketTick => ({
  symbol: 'XAUUSD',
  bid: 2_500,
  ask: 2_500.2,
  spread: 0.2,
  timestamp,
  sourceTimestamp: timestamp,
  lp: 'test',
  volume: 1,
  ...overrides,
});

const appTick = (timestamp: number, overrides: Partial<AppTick> = {}): AppTick => ({
  symbol: 'XAUUSD',
  bid: 2_500,
  ask: 2_500.2,
  spread: 0.2,
  timestamp,
  ...overrides,
});

describe('live tick store pressure guards', () => {
  beforeEach(() => {
    resetLiveTickDispatcherForTests();
    workerMocks.aggregateSymbols.mockReset();
    useMarketDataStore.getState().clearAllData();
    useAppStore.setState({ ticks: {}, tickLookup: {} });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('recognizes only fully identical market payloads as duplicates', () => {
    const original = marketTick(1_000);

    expect(areMarketTicksIdentical(original, { ...original })).toBe(true);
    expect(areMarketTicksIdentical(original, marketTick(1_001))).toBe(false);
    expect(areMarketTicksIdentical(original, marketTick(1_000, { volume: 2 }))).toBe(false);
  });

  it('does not publish or append an identical replay', () => {
    const tick = marketTick(1_000);
    useMarketDataStore.getState().updateTick('XAUUSD', tick, { syncAppStore: false });
    const snapshot = useMarketDataStore.getState();
    let notifications = 0;
    const unsubscribe = useMarketDataStore.subscribe(() => {
      notifications += 1;
    });

    useMarketDataStore.getState().updateTick('XAUUSD', { ...tick }, { syncAppStore: false });

    expect(useMarketDataStore.getState()).toBe(snapshot);
    expect(useMarketDataStore.getState().symbolData.XAUUSD.tickBuffer).toHaveLength(1);
    expect(notifications).toBe(0);
    unsubscribe();
  });

  it('retains newer same-price ticks for freshness and ordered history', () => {
    useMarketDataStore.getState().updateTick('XAUUSD', marketTick(1_000), { syncAppStore: false });
    useMarketDataStore.getState().updateTick('XAUUSD', marketTick(1_001), { syncAppStore: false });

    const data = useMarketDataStore.getState().symbolData.XAUUSD;
    expect(data.currentTick?.timestamp).toBe(1_001);
    expect(data.tickBuffer.map((tick) => tick.timestamp)).toEqual([1_000, 1_001]);
  });

  it('preserves chronological order while enforcing the buffer cap', () => {
    const bounded = [1, 2, 3, 4].reduce<MarketTick[]>(
      (ticks, timestamp) => appendBoundedTick(ticks, marketTick(timestamp), 3),
      [],
    );

    expect(bounded.map((tick) => tick.timestamp)).toEqual([2, 3, 4]);
  });

  it('rejects stale source events and replaces equal-time corrections in both stores', () => {
    const now = Date.now();
    const older = marketTick(now - 2, { bid: 100, ask: 100.2, sourceTimestamp: now - 2 });
    const newer = marketTick(now, { bid: 101, ask: 101.2, sourceTimestamp: now });
    useMarketDataStore.getState().updateTick('XAUUSD', older, { syncAppStore: false });
    useMarketDataStore.getState().updateTick('XAUUSD', newer, { syncAppStore: false });
    useAppStore.getState().setTick('XAUUSD', older);
    useAppStore.getState().setTick('XAUUSD', newer);

    const stale = marketTick(now + 10_000, {
      bid: 999,
      ask: 999.2,
      sourceTimestamp: now - 1,
    });
    useMarketDataStore.getState().updateTicksBatch([['XAUUSD', stale]], { syncAppStore: false });
    useAppStore.getState().setTicksBatch([['XAUUSD', stale]]);
    expect(useMarketDataStore.getState().symbolData.XAUUSD.currentTick?.bid).toBe(101);
    expect(useAppStore.getState().ticks.XAUUSD.bid).toBe(101);

    const correction = marketTick(now + 20_000, {
      bid: 99,
      ask: 99.2,
      sourceTimestamp: now,
      volume: 7,
      lp: 'corrected-lp',
    });
    workerMocks.aggregateSymbols.mockClear();
    useMarketDataStore.getState().updateTicksBatch([['XAUUSD', correction]], { syncAppStore: false });
    useAppStore.getState().setTicksBatch([['XAUUSD', correction]]);

    const market = useMarketDataStore.getState().symbolData.XAUUSD;
    const app = useAppStore.getState().ticks.XAUUSD;
    expect(market.tickBuffer).toHaveLength(2);
    expect(market.tickBuffer.map(item => item.sourceTimestamp)).toEqual([now - 2, now]);
    expect(market.currentTick).toMatchObject({ bid: 99, volume: 7, lp: 'corrected-lp' });
    expect(app).toMatchObject({ bid: 99, volume: 7, lp: 'corrected-lp' });
    expect(app.prevBid).toBe(100);
    expect(app.bidDirection).toBe('down');
    expect(workerMocks.aggregateSymbols).toHaveBeenCalledTimes(1);
  });

  it('keeps opaque suffix lookups exact while each contract retains its freshest tick', () => {
    useAppStore.getState().setTicksBatch([
      ['XAUUSD.raw', appTick(100, { symbol: 'XAUUSD.raw' })],
      ['XAUUSD.pro', appTick(100, { symbol: 'XAUUSD.pro' })],
    ]);
    expect(resolveTickFromLookup(
      useAppStore.getState().ticks,
      useAppStore.getState().tickLookup,
      'XAUUSD',
    )).toBeUndefined();
    expect(resolveTickFromLookup(
      useAppStore.getState().ticks,
      useAppStore.getState().tickLookup,
      'XAUUSD.raw',
    )?.timestamp).toBe(100);
    expect(resolveTickFromLookup(
      useAppStore.getState().ticks,
      useAppStore.getState().tickLookup,
      'XAUUSD.pro',
    )?.timestamp).toBe(100);

    useAppStore.getState().setTick('XAUUSD.pro', appTick(101, { symbol: 'XAUUSD.pro' }));
    useAppStore.getState().setTick('XAUUSD.raw', appTick(102, { symbol: 'XAUUSD.raw' }));
    expect(resolveTickFromLookup(
      useAppStore.getState().ticks,
      useAppStore.getState().tickLookup,
      'XAUUSD',
    )).toBeUndefined();
    expect(resolveTickFromLookup(
      useAppStore.getState().ticks,
      useAppStore.getState().tickLookup,
      'XAUUSD.raw',
    )?.timestamp).toBe(102);
    expect(resolveTickFromLookup(
      useAppStore.getState().ticks,
      useAppStore.getState().tickLookup,
      'XAUUSD.pro',
    )?.timestamp).toBe(101);
  });

  it('keeps the alias lookup reference stable on ordinary freshness updates', () => {
    useAppStore.getState().setTick('XAUUSD', appTick(1_000));
    const lookup = useAppStore.getState().tickLookup;
    const count = selectTickCount(useAppStore.getState());

    useAppStore.getState().setTick('XAUUSD', appTick(1_001));

    expect(useAppStore.getState().tickLookup).toBe(lookup);
    expect(useAppStore.getState().ticks.XAUUSD.timestamp).toBe(1_001);
    expect(selectTickCount(useAppStore.getState())).toBe(count);
  });

  it('publishes a complete catalog batch without mutating a previous lookup or accepting stale source data', () => {
    useAppStore.getState().setTick('XAUUSD.raw', appTick(100, {
      symbol: 'XAUUSD.raw', sourceTimestamp: 100, bid: 100, ask: 101,
    }));
    const previous = useAppStore.getState();
    Object.freeze(previous.tickLookup);
    Object.freeze(previous.ticks);
    const catalog = Array.from({ length: 701 }, (_, index) => {
      const symbol = `CATALOG${index}.raw`;
      return [symbol, appTick(200, { symbol, sourceTimestamp: 200 })] as const;
    });
    const published = vi.fn();
    const unsubscribe = useAppStore.subscribe(published);

    useAppStore.getState().setTicksBatch([
      ['XAUUSD.raw', appTick(150, { symbol: 'XAUUSD.raw', sourceTimestamp: 150, bid: 110, ask: 111 })],
      ...catalog,
      ['CATALOG700.raw', appTick(300, { symbol: 'CATALOG700.raw', sourceTimestamp: 199, bid: 999, ask: 1000 })],
    ]);

    unsubscribe();
    const next = useAppStore.getState();
    expect(published).toHaveBeenCalledOnce();
    expect(next.tickLookup).not.toBe(previous.tickLookup);
    expect(previous.tickLookup).toEqual({ 'XAUUSD.RAW': 'XAUUSD.raw', XAUUSD: 'XAUUSD.raw' });
    expect(previous.ticks['XAUUSD.raw'].bid).toBe(100);
    expect(Object.keys(next.ticks)).toHaveLength(702);
    expect(next.ticks['XAUUSD.raw']).toMatchObject({ bid: 110, prevBid: 100, bidDirection: 'up' });
    for (const [symbol] of catalog) {
      expect(resolveTickFromLookup(next.ticks, next.tickLookup, symbol.toUpperCase()))
        .toMatchObject({ symbol, sourceTimestamp: 200, bid: 2500 });
      expect(resolveTickFromLookup(next.ticks, next.tickLookup, symbol.split('.')[0])).toBeUndefined();
    }
  });

  it('retains optional quote metadata when a fresher price-only tick omits it', () => {
    useAppStore.getState().setTick('XAUUSD', appTick(1_000, {
      sourceTimestamp: 1_000,
      lp: 'Prime LP',
      volume: 321,
      last: 2_500.1,
      open: 2_480,
      close: 2_490,
      digits: 2,
    }));

    useAppStore.getState().setTick('XAUUSD', appTick(2_000, {
      bid: 2_501,
      ask: 2_501.2,
    }));

    expect(useAppStore.getState().ticks.XAUUSD).toMatchObject({
      bid: 2_501,
      ask: 2_501.2,
      lp: 'Prime LP',
      volume: 321,
      last: 2_500.1,
      open: 2_480,
      close: 2_490,
      digits: 2,
    });
    expect(useAppStore.getState().ticks.XAUUSD.sourceTimestamp).toBeUndefined();
  });

  it('publishes five full-buffer live ticks once per store in one animation frame', () => {
    const symbols = ['XAUUSD.raw', 'EURUSD', 'GBPUSD', 'USDJPY', 'BTCUSD'];
    const seededAt = Date.now();
    const symbolData = Object.fromEntries(symbols.map((symbol, symbolIndex) => {
      const tickBuffer = Array.from({ length: MARKET_TICK_BUFFER_LIMIT }, (_, index) => (
        marketTick(index + 1, {
          symbol,
          bid: 2_500 + symbolIndex,
          ask: 2_500.2 + symbolIndex,
        })
      ));

      return [symbol, {
        currentTick: tickBuffer[tickBuffer.length - 1],
        previousTick: tickBuffer[tickBuffer.length - 2],
        stats: {
          symbol,
          currentPrice: 2_500 + symbolIndex,
          high24h: 2_501 + symbolIndex,
          low24h: 2_499 + symbolIndex,
          change24h: 0,
          changePercent24h: 0,
          volume24h: MARKET_TICK_BUFFER_LIMIT,
          vwap: 2_500 + symbolIndex,
          sma20: 2_500 + symbolIndex,
          ema20: 2_500 + symbolIndex,
          lastUpdate: seededAt,
        },
        ohlcv1m: [],
        ohlcv5m: [],
        ohlcv15m: [],
        ohlcv1h: [],
        tickBuffer,
        lastAggregation: seededAt,
      }];
    }));

    useMarketDataStore.setState({
      symbolData: symbolData as any,
      subscribedSymbols: new Set(symbols),
    });
    useAppStore.setState({
      ticks: Object.fromEntries(symbols.map((symbol) => [
        symbol,
        appTick(MARKET_TICK_BUFFER_LIMIT, { symbol }),
      ])),
      tickLookup: {},
    });

    let animationFrame: FrameRequestCallback | undefined;
    vi.stubGlobal('requestAnimationFrame', vi.fn((callback: FrameRequestCallback) => {
      animationFrame = callback;
      return 1;
    }));

    let marketPublications = 0;
    let appPublications = 0;
    const unsubscribeMarket = useMarketDataStore.subscribe(() => { marketPublications += 1; });
    const unsubscribeApp = useAppStore.subscribe(() => { appPublications += 1; });

    symbols.forEach((symbol, symbolIndex) => {
      enqueueLiveTick(symbol, marketTick(MARKET_TICK_BUFFER_LIMIT + 1, {
        symbol,
        bid: 2_501 + symbolIndex,
        ask: 2_501.2 + symbolIndex,
      }));
    });
    // The dispatcher keeps only the latest XAUUSD.raw event in this frame.
    enqueueLiveTick('XAUUSD.raw', marketTick(MARKET_TICK_BUFFER_LIMIT + 2, {
      symbol: 'XAUUSD.raw',
      bid: 2_502,
      ask: 2_502.2,
    }));

    expect(animationFrame).toBeTypeOf('function');
    animationFrame?.(seededAt);

    expect(marketPublications).toBe(1);
    expect(appPublications).toBe(1);

    symbols.forEach((symbol) => {
      const data = useMarketDataStore.getState().symbolData[symbol];
      const expectedTimestamp = symbol === 'XAUUSD.raw'
        ? MARKET_TICK_BUFFER_LIMIT + 2
        : MARKET_TICK_BUFFER_LIMIT + 1;
      expect(data.tickBuffer).toHaveLength(MARKET_TICK_BUFFER_LIMIT);
      expect(data.tickBuffer[0].timestamp).toBe(2);
      expect(data.tickBuffer.at(-1)?.timestamp).toBe(expectedTimestamp);
      expect(data.currentTick?.timestamp).toBe(expectedTimestamp);
      expect(useAppStore.getState().ticks[symbol].timestamp).toBe(expectedTimestamp);
    });

    expect(resolveTickFromLookup(
      useAppStore.getState().ticks,
      useAppStore.getState().tickLookup,
      'XAUUSD',
    )).toBeUndefined();
    expect(resolveTickFromLookup(
      useAppStore.getState().ticks,
      useAppStore.getState().tickLookup,
      'XAUUSD.raw',
    )?.timestamp).toBe(MARKET_TICK_BUFFER_LIMIT + 2);

    unsubscribeMarket();
    unsubscribeApp();
  });
});
