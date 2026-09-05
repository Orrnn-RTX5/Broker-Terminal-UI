// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const workerMocks = vi.hoisted(() => ({
  aggregateMultipleTimeframes: vi.fn(),
}));
vi.mock('./aggregationWorkerManager', () => ({
  getWorkerManager: () => workerMocks,
}));

import {
  enqueueLiveTick,
  isLiveMarketDataFrozen,
  resetLiveTickDispatcherForTests,
  setLiveMarketDataFrozen,
  type LiveTick,
} from './liveTickDispatcher';
import { useMarketDataStore } from '../store/useMarketDataStore';
import { useAppStore } from '../store/useAppStore';

const originalMarketBatch = useMarketDataStore.getState().updateTicksBatch;
const originalAppBatch = useAppStore.getState().setTicksBatch;

const tick = (symbol: string, bid: number, timestamp = 1_788_176_700_000): LiveTick => ({
  symbol,
  bid,
  ask: bid + 0.0002,
  spread: 0.0002,
  timestamp,
  sourceTimestamp: timestamp,
  volume: 1,
});

describe('liveTickDispatcher market data freeze', () => {
  beforeEach(() => {
    resetLiveTickDispatcherForTests();
    workerMocks.aggregateMultipleTimeframes.mockReset();
    window.rtxTickCache = new Map();
    useMarketDataStore.setState({ updateTicksBatch: originalMarketBatch });
    useAppStore.setState({ setTicksBatch: originalAppBatch });
    useMarketDataStore.getState().clearAllData();
    useAppStore.setState({ ticks: {}, tickLookup: {} });
  });

  afterEach(() => {
    resetLiveTickDispatcherForTests();
    useMarketDataStore.setState({ updateTicksBatch: originalMarketBatch });
    useAppStore.setState({ setTicksBatch: originalAppBatch });
    vi.restoreAllMocks();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('keeps the last cached tick while a symbol is frozen', () => {
    window.rtxTickCache.set('GBPUSD', tick('GBPUSD', 1.3349));

    setLiveMarketDataFrozen('test-chart-a', 'GBPUSD', true);
    enqueueLiveTick('GBPUSD', tick('GBPUSD', 1.3355));

    expect(isLiveMarketDataFrozen('GBPUSD')).toBe(true);
    expect(window.rtxTickCache.get('GBPUSD')?.bid).toBe(1.3349);
  });

  it('freezes only the exact broker symbol identity', () => {
    setLiveMarketDataFrozen('test-chart-a', 'EURUSD.r', true);
    enqueueLiveTick('EURUSD.r', tick('EURUSD.r', 1.125));
    enqueueLiveTick('EURUSD', tick('EURUSD', 1.126));

    expect(isLiveMarketDataFrozen('EURUSD.r')).toBe(true);
    expect(isLiveMarketDataFrozen('EURUSD')).toBe(false);
    expect(window.rtxTickCache.get('EURUSD.r')).toBeUndefined();
    expect(window.rtxTickCache.get('EURUSD')?.bid).toBe(1.126);
  });

  it('does not write punctuation-stripped aliases into the live tick cache', () => {
    enqueueLiveTick('EURUSD.r', tick('EURUSD.r', 1.125));

    expect(window.rtxTickCache.get('EURUSD.r')?.bid).toBe(1.125);
    expect(window.rtxTickCache.get('EURUSD.R')?.bid).toBe(1.125);
    expect(window.rtxTickCache.has('EURUSDR')).toBe(false);
  });

  it('keeps a symbol frozen until every source releases it', () => {
    setLiveMarketDataFrozen('test-chart-a', 'GBPUSD', true);
    setLiveMarketDataFrozen('test-chart-b', 'GBPUSD', true);

    setLiveMarketDataFrozen('test-chart-a', 'GBPUSD', false);
    expect(isLiveMarketDataFrozen('GBPUSD')).toBe(true);

    setLiveMarketDataFrozen('test-chart-b', 'GBPUSD', false);
    expect(isLiveMarketDataFrozen('GBPUSD')).toBe(false);
  });

  it('accepts ticks again after the symbol is unfrozen', () => {
    setLiveMarketDataFrozen('test-chart-a', 'GBPUSD', true);
    setLiveMarketDataFrozen('test-chart-a', 'GBPUSD', false);

    enqueueLiveTick('GBPUSD', tick('GBPUSD', 1.3351));

    expect(window.rtxTickCache.get('GBPUSD')?.bid).toBe(1.3351);
  });

  it('keeps the freshest in-frame tick and preserves a reentrant tick for one next frame', () => {
    const frames: FrameRequestCallback[] = [];
    const requestFrame = vi.fn((callback: FrameRequestCallback) => {
      frames.push(callback);
      return frames.length;
    });
    vi.stubGlobal('requestAnimationFrame', requestFrame);
    vi.stubGlobal('cancelAnimationFrame', vi.fn());

    const baseTimestamp = 1_788_176_700_000;
    let reentered = false;
    const unsubscribe = useMarketDataStore.subscribe(() => {
      if (reentered) return;
      reentered = true;
      enqueueLiveTick('EURUSD', tick('EURUSD', 1.2, baseTimestamp + 2));
    });

    enqueueLiveTick('EURUSD', tick('EURUSD', 1.1, baseTimestamp + 1));
    enqueueLiveTick('EURUSD', tick('EURUSD', 9.9, baseTimestamp));
    expect(requestFrame).toHaveBeenCalledTimes(1);
    frames.shift()?.(0);
    expect(requestFrame).toHaveBeenCalledTimes(2);
    expect(useAppStore.getState().ticks.EURUSD.bid).toBe(1.1);

    frames.shift()?.(16);
    expect(useMarketDataStore.getState().symbolData.EURUSD.currentTick?.bid).toBe(1.2);
    expect(useAppStore.getState().ticks.EURUSD.bid).toBe(1.2);
    expect(requestFrame).toHaveBeenCalledTimes(2);
    unsubscribe();
  });

  it.each(['market', 'app'] as const)('retries only the failed %s store with backoff', (target) => {
    vi.useFakeTimers();
    const frames: FrameRequestCallback[] = [];
    vi.stubGlobal('requestAnimationFrame', vi.fn((callback: FrameRequestCallback) => {
      frames.push(callback);
      return frames.length;
    }));
    vi.stubGlobal('cancelAnimationFrame', vi.fn());
    vi.spyOn(console, 'error').mockImplementation(() => undefined);

    const marketAction = originalMarketBatch;
    const appAction = originalAppBatch;
    const marketSpy = vi.spyOn(useMarketDataStore.getState(), 'updateTicksBatch');
    const appSpy = vi.spyOn(useAppStore.getState(), 'setTicksBatch');
    if (target === 'market') {
      marketSpy.mockImplementationOnce(() => { throw new Error('market batch failure'); });
      marketSpy.mockImplementation(marketAction);
    } else {
      appSpy.mockImplementationOnce(() => { throw new Error('app batch failure'); });
      appSpy.mockImplementation(appAction);
    }

    enqueueLiveTick('USDJPY', tick('USDJPY', 150));
    frames.shift()?.(0);
    expect(target === 'market' ? appSpy : marketSpy).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(100);
    expect(frames).toHaveLength(1);
    frames.shift()?.(16);

    expect(marketSpy).toHaveBeenCalledTimes(target === 'market' ? 2 : 1);
    expect(appSpy).toHaveBeenCalledTimes(target === 'app' ? 2 : 1);
    expect(useMarketDataStore.getState().symbolData.USDJPY.currentTick?.bid).toBe(150);
    expect(useAppStore.getState().ticks.USDJPY.bid).toBe(150);
  });

  it('keeps Market and App retry schedules independent', () => {
    vi.useFakeTimers();
    const frames: FrameRequestCallback[] = [];
    vi.stubGlobal('requestAnimationFrame', vi.fn((cb: FrameRequestCallback) => {
      frames.push(cb);
      return frames.length;
    }));
    vi.stubGlobal('cancelAnimationFrame', vi.fn());
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const runFrame = (time: number) => frames.shift()?.(time);

    let marketAttempts = 0;
    const marketSpy = vi.spyOn(useMarketDataStore.getState(), 'updateTicksBatch')
      .mockImplementation((entries, options) => {
        if (++marketAttempts <= 2) throw new Error('market failure');
        return originalMarketBatch(entries, options);
      });
    let appAttempts = 0;
    const appSpy = vi.spyOn(useAppStore.getState(), 'setTicksBatch')
      .mockImplementation((entries) => {
        if (++appAttempts === 3) throw new Error('app failure');
        return originalAppBatch(entries);
      });

    const at = 1_788_176_700_000;
    enqueueLiveTick('USDJPY', tick('USDJPY', 150, at));
    runFrame(0); // Market fails; App succeeds.
    vi.advanceTimersByTime(50);
    enqueueLiveTick('USDJPY', tick('USDJPY', 151, at + 1));
    runFrame(50); // Market waits; healthy App gets only the fresh live batch.
    expect([marketSpy.mock.calls.length, appSpy.mock.calls.length]).toEqual([1, 2]);

    vi.advanceTimersByTime(50);
    runFrame(100); // Market's 100 ms retry fails and starts its own 200 ms wait.
    expect([marketSpy.mock.calls.length, appSpy.mock.calls.length]).toEqual([2, 2]);
    vi.advanceTimersByTime(50);
    enqueueLiveTick('USDJPY', tick('USDJPY', 152, at + 2));
    runFrame(150); // Market still waits; App now fails for the first time.
    expect([marketSpy.mock.calls.length, appSpy.mock.calls.length]).toEqual([2, 3]);

    vi.advanceTimersByTime(99);
    expect(frames).toHaveLength(0);
    vi.advanceTimersByTime(1);
    runFrame(250); // App owns a fresh 100 ms retry, not Market's 200 ms delay.
    expect([marketSpy.mock.calls.length, appSpy.mock.calls.length]).toEqual([2, 4]);
    expect(useAppStore.getState().ticks.USDJPY.bid).toBe(152);

    vi.advanceTimersByTime(49);
    expect(frames).toHaveLength(0);
    vi.advanceTimersByTime(1);
    runFrame(300); // Market's 200 ms retry; App must not replay an old batch.
    expect([marketSpy.mock.calls.length, appSpy.mock.calls.length]).toEqual([3, 4]);
    expect(useMarketDataStore.getState().symbolData.USDJPY.currentTick?.bid).toBe(152);
  });
});
