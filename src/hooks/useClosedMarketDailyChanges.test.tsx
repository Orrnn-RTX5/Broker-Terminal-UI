import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  readMarketWatchDailyChange,
  readMarketWatchDailyChangeEntry,
  rememberMarketWatchDailyChange,
  resetMarketWatchDailyChangeCacheForTests,
} from '../services/marketWatchDailyChangeCache';
import {
  CLOSED_MARKET_DAILY_CHANGE_MAX_CONCURRENCY,
  hydrateClosedMarketDailyChanges,
  useClosedMarketDailyChanges,
} from './useClosedMarketDailyChanges';
import {
  commitBrokerAccountSessionScope,
  getCommittedBrokerAccountSessionScopeKey,
} from '../services/brokerSession';

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

const createRecentCompletedWeekdayTimestamps = (): [string, string] => {
  const d2 = new Date();
  d2.setUTCHours(0, 0, 0, 0);
  d2.setUTCDate(d2.getUTCDate() - 1);
  while (d2.getUTCDay() === 0 || d2.getUTCDay() === 6) {
    d2.setUTCDate(d2.getUTCDate() - 1);
  }
  const d1 = new Date(d2.getTime());
  d1.setUTCDate(d1.getUTCDate() - 1);
  while (d1.getUTCDay() === 0 || d1.getUTCDay() === 6) {
    d1.setUTCDate(d1.getUTCDate() - 1);
  }
  return [d1.toISOString(), d2.toISOString()];
};

describe('useClosedMarketDailyChanges', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetMarketWatchDailyChangeCacheForTests();
    commitBrokerAccountSessionScope({
      authenticated: false,
      brokerId: 'broker-a',
      serverUrl: 'https://broker-a.test',
    });
  });

  afterEach(() => {
    cleanup();
    resetMarketWatchDailyChangeCacheForTests();
    commitBrokerAccountSessionScope({ authenticated: false, brokerId: '', serverUrl: '' });
  });

  it('hydrates every requested export symbol while retaining scoped cached values', async () => {
    const [priorDate, lastDate] = createRecentCompletedWeekdayTimestamps();
    const scopeKey = getCommittedBrokerAccountSessionScopeKey(
      commitBrokerAccountSessionScope({
        authenticated: false,
        brokerId: 'broker-a',
        serverUrl: 'https://broker-a.test',
      }),
    );
    rememberMarketWatchDailyChange(scopeKey, 'EURUSD', 1.25, Date.now(), 'quote');
    chartHarness.fetchCandles.mockImplementation(({ symbol }: { symbol: string }) => Promise.resolve(
      symbol === 'GBPUSD'
        ? [dailyCandle(priorDate, 100), dailyCandle(lastDate, 110)]
        : [],
    ));

    const result = await hydrateClosedMarketDailyChanges({
      scopeKey,
      symbols: [' EURUSD ', 'GBPUSD', 'EURUSD'],
    });

    expect(result.get('EURUSD')).toBe(1.25);
    expect(result.get('GBPUSD')).toBeCloseTo(10);
    expect(chartHarness.fetchCandles.mock.calls.map(([request]) => request.symbol).sort()).toEqual([
      'EURUSD',
      'GBPUSD',
    ]);
    expect(readMarketWatchDailyChange(scopeKey, 'GBPUSD')).toBeCloseTo(10);
  });

  it('fails export hydration closed when its scope is stale or changes in flight', async () => {
    const scopeA = getCommittedBrokerAccountSessionScopeKey(
      commitBrokerAccountSessionScope({
        authenticated: false,
        brokerId: 'broker-a',
        serverUrl: 'https://broker-a.test',
      }),
    );
    rememberMarketWatchDailyChange(scopeA, 'EURUSD', 1.25, Date.now(), 'quote');
    commitBrokerAccountSessionScope({
      authenticated: false,
      brokerId: 'broker-b',
      serverUrl: 'https://broker-b.test',
    });

    await expect(hydrateClosedMarketDailyChanges({
      scopeKey: scopeA,
      symbols: ['EURUSD'],
    })).resolves.toEqual(new Map());
    expect(chartHarness.fetchCandles).not.toHaveBeenCalled();

    commitBrokerAccountSessionScope({
      authenticated: false,
      brokerId: 'broker-a',
      serverUrl: 'https://broker-a.test',
    });
    const pending = deferred<ReturnType<typeof dailyCandle>[]>();
    chartHarness.fetchCandles.mockImplementationOnce(() => pending.promise);
    const request = hydrateClosedMarketDailyChanges({
      scopeKey: scopeA,
      symbols: ['GBPUSD'],
    });
    commitBrokerAccountSessionScope({
      authenticated: false,
      brokerId: 'broker-b',
      serverUrl: 'https://broker-b.test',
    });
    const [priorDate, lastDate] = createRecentCompletedWeekdayTimestamps();
    pending.resolve([
      dailyCandle(priorDate, 100),
      dailyCandle(lastDate, 110),
    ]);

    await expect(request).resolves.toEqual(new Map());
    expect(readMarketWatchDailyChange(scopeA, 'GBPUSD')).toBeNull();
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
    const [priorDate, lastDate] = createRecentCompletedWeekdayTimestamps();
    const lastSessionStartedAt = Date.parse(lastDate);
    rememberMarketWatchDailyChange(
      'broker-a/account-1',
      'XAUUSD',
      4.5,
      lastSessionStartedAt + 12 * 60 * 60 * 1000,
      'quote',
    );
    chartHarness.fetchCandles.mockResolvedValue([
      dailyCandle(priorDate, 100),
      dailyCandle(lastDate, 100),
    ]);

    const { result, unmount } = renderHook(() => useClosedMarketDailyChanges({
      enabled: true,
      scopeKey: 'broker-a/account-1',
      symbols: ['XAUUSD'],
    }));

    await waitFor(() => expect(result.current.get('XAUUSD')).toBe(0));
    expect(result.current.get('XAUUSD')).toBe(0);
    expect(readMarketWatchDailyChange('broker-a/account-1', 'XAUUSD')).toBe(0);
    expect(readMarketWatchDailyChangeEntry('broker-a/account-1', 'XAUUSD')).toMatchObject({
      value: 0,
      asOf: lastSessionStartedAt,
      completedAt: lastSessionStartedAt + 24 * 60 * 60 * 1000,
      source: 'history',
    });
    expect(chartHarness.fetchCandles).toHaveBeenCalledWith({
      symbol: 'XAUUSD',
      timeframe: 'D1',
      count: 8,
      signal: expect.any(AbortSignal),
    });

    unmount();
  });

  it('aborts the old request and never leaks values across a scope or symbol change', async () => {
    const [priorDate, lastDate] = createRecentCompletedWeekdayTimestamps();
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
        dailyCandle(priorDate, 100),
        dailyCandle(lastDate, 110),
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
