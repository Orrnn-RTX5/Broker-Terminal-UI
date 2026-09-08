import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  readMarketWatchDailyChange,
  rememberMarketWatchDailyChange,
  resetMarketWatchDailyChangeCacheForTests,
} from '../services/marketWatchDailyChangeCache';
import {
  CLOSED_MARKET_DAILY_CHANGE_MAX_CONCURRENCY,
  useClosedMarketDailyChanges,
} from './useClosedMarketDailyChanges';

const chartHarness = vi.hoisted(() => ({
  fetchCandles: vi.fn(),
}));

vi.mock('../services/chartDataService', () => ({
  chartDataService: {
    fetchCandles: chartHarness.fetchCandles,
  },
}));

const neverResolving = () => new Promise<never>(() => undefined);

const deferred = <T,>() => {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
};

const dailyCandle = (isoDate: string, close: number) => ({
  time: Date.parse(isoDate) / 1000,
  open: close,
  high: close,
  low: close,
  close,
  volume: 1,
  closed: true,
});

describe('useClosedMarketDailyChanges', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetMarketWatchDailyChangeCacheForTests();
  });

  afterEach(() => {
    cleanup();
    resetMarketWatchDailyChangeCacheForTests();
  });

  it('hydrates normalized symbols from the scoped cache immediately and preserves zero', () => {
    rememberMarketWatchDailyChange('broker-a/account-1', 'eurusd.raw', 0, Date.now(), 'quote');
    chartHarness.fetchCandles.mockImplementation(neverResolving);

    const { result, unmount } = renderHook(() => useClosedMarketDailyChanges({
      enabled: true,
      scopeKey: 'broker-a/account-1',
      symbols: [' eurusd.raw ', 'EURUSD.RAW'],
    }));

    expect(result.current.has('EURUSD.RAW')).toBe(true);
    expect(result.current.get('EURUSD.RAW')).toBe(0);
    expect(chartHarness.fetchCandles).toHaveBeenCalledTimes(1);

    unmount();
  });

  it('computes, persists, and publishes the last completed D1 change including zero', async () => {
    chartHarness.fetchCandles.mockResolvedValue([
      dailyCandle('2026-09-03T00:00:00.000Z', 100),
      dailyCandle('2026-09-04T00:00:00.000Z', 100),
    ]);

    const { result, unmount } = renderHook(() => useClosedMarketDailyChanges({
      enabled: true,
      scopeKey: 'broker-a/account-1',
      symbols: ['XAUUSD'],
    }));

    await waitFor(() => expect(result.current.has('XAUUSD')).toBe(true));
    expect(result.current.get('XAUUSD')).toBe(0);
    expect(readMarketWatchDailyChange('broker-a/account-1', 'XAUUSD')).toBe(0);
    expect(chartHarness.fetchCandles).toHaveBeenCalledWith({
      symbol: 'XAUUSD',
      timeframe: 'D1',
      count: 8,
      signal: expect.any(AbortSignal),
    });

    unmount();
  });

  it('aborts the old request and never leaks values across a scope or symbol change', async () => {
    const eurusdHistory = deferred<ReturnType<typeof dailyCandle>[]>();
    chartHarness.fetchCandles.mockImplementation(({ symbol }: { symbol: string }) => (
      symbol === 'EURUSD' ? eurusdHistory.promise : neverResolving()
    ));
    rememberMarketWatchDailyChange('scope-a', 'EURUSD', 1.25, Date.now(), 'quote');
    rememberMarketWatchDailyChange('scope-b', 'GBPUSD', -0.75, Date.now(), 'quote');

    const { result, rerender, unmount } = renderHook(
      ({ scopeKey, symbols }) => useClosedMarketDailyChanges({
        enabled: true,
        scopeKey,
        symbols,
      }),
      { initialProps: { scopeKey: 'scope-a', symbols: ['EURUSD'] } },
    );

    expect(result.current.get('EURUSD')).toBe(1.25);
    const oldSignal = chartHarness.fetchCandles.mock.calls[0][0].signal as AbortSignal;

    rerender({ scopeKey: 'scope-b', symbols: ['GBPUSD'] });

    expect(oldSignal.aborted).toBe(true);
    expect(result.current.has('EURUSD')).toBe(false);
    expect(result.current.get('GBPUSD')).toBe(-0.75);

    await act(async () => {
      eurusdHistory.resolve([
        dailyCandle('2026-09-03T00:00:00.000Z', 100),
        dailyCandle('2026-09-04T00:00:00.000Z', 110),
      ]);
      await eurusdHistory.promise;
    });

    expect(result.current.has('EURUSD')).toBe(false);
    expect(result.current.get('GBPUSD')).toBe(-0.75);

    unmount();
  });

  it('limits concurrent D1 requests to four workers', async () => {
    const requests = Array.from({ length: 6 }, () => deferred<ReturnType<typeof dailyCandle>[]>());
    let requestIndex = 0;
    chartHarness.fetchCandles.mockImplementation(() => {
      const request = requests[requestIndex];
      requestIndex += 1;
      return request.promise;
    });

    const { unmount } = renderHook(() => useClosedMarketDailyChanges({
      enabled: true,
      scopeKey: 'scope-a',
      symbols: ['A', 'B', 'C', 'D', 'E', 'F'],
    }));

    expect(chartHarness.fetchCandles).toHaveBeenCalledTimes(
      CLOSED_MARKET_DAILY_CHANGE_MAX_CONCURRENCY,
    );

    await act(async () => {
      requests[0].resolve([]);
      await requests[0].promise;
    });

    await waitFor(() => expect(chartHarness.fetchCandles).toHaveBeenCalledTimes(5));
    unmount();
  });
});
