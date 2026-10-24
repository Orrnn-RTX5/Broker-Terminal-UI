import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { installTestBrokerRuntime } from '../test/brokerRuntime';

import { useAppStore } from '../store/useAppStore';
import { useMarketDataStore } from '../store/useMarketDataStore';
import { useWatchlistStore } from '../store/useWatchlistStore';
import { ApiError } from '../api/client';
import {
  ACTIVE_MARKET_SYMBOLS_STORAGE_KEY_PREFIX,
  extractActiveMarketSymbols,
  getActiveMarketSymbolsStorageKey,
  getLiveQuoteRestBatches,
  getStaleQuoteFailure,
  hasAuthoritativeMarketSymbolStatus,
  LIVE_QUOTES_REST_BATCH_SIZE,
  normalizeInstrumentEnabled,
  readCachedActiveMarketSymbols,
  useActiveMarketSymbols,
  useMarketInstruments,
  useLiveQuotes,
  useRemoteWatchlistSync,
  applySpreadMarkupToOrderBook,
} from './useLiveMarketData';
import {
  getAccountSpreadMarkup,
  getAccountSpreadMarkupMap,
  resetAccountSpreadMarkupForTests,
} from '../services/accountSpreadMarkup';
import { commitBrokerAccountSessionScope } from '../services/brokerSession';
import {
  registerDailyChangePriceModes,
  resetDailyChangePriceModeRegistryForTests,
} from '../services/dailyChangePriceModeRegistry';

const apiGet = vi.hoisted(() => vi.fn());
const apiPut = vi.hoisted(() => vi.fn());
const enqueueSnapshotTick = vi.hoisted(() => vi.fn());
const useQuoteSubscriptionMock = vi.hoisted(() => vi.fn());

vi.mock('../api/client', () => {
  class ApiError extends Error {
    constructor(
      public status: number,
      message: string,
      public data?: unknown
    ) {
      super(message);
      this.name = 'ApiError';
    }
  }

  return {
    ApiError,
    apiClient: {
      get: apiGet,
      put: apiPut,
    },
  };
});

vi.mock('../services/liveTickDispatcher', () => ({
  enqueueSnapshotTick,
}));

// Keep one ordered request fixture for the hook's two independent sources.
// The public transport's real credential/cancellation behavior is exercised
// separately in publicMarketCatalog.test.ts.
vi.mock('../services/publicMarketCatalog', () => ({
  loadPublicMarketCatalog: (baseUrl: string, signal: AbortSignal) => apiGet('/api/v1/market/symbols', {
    baseUrl, signal, skipAuth: true, skipDynamicUrl: true,
  }),
}));

// The shared transport has dedicated scope and cancellation tests.
vi.mock('../services/authenticatedInstruments', () => ({
  loadSharedAuthenticatedInstruments: (options: unknown) => apiGet('/instruments', options),
}));

vi.mock('./useQuoteSubscription', () => ({
  useQuoteSubscription: useQuoteSubscriptionMock,
}));

const flushPromises = async () => {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
};

const setMajorWatchlistSymbols = (symbols: string[]) => {
  useWatchlistStore.getState().reorderSymbols('majors', symbols);
  useWatchlistStore.getState().setActiveWatchlist('majors');
};

describe('remote watchlist synchronization', () => {
  let restoreBrokerRuntime: () => void;
  beforeEach(() => {
    vi.useFakeTimers();
    apiGet.mockReset();
    apiPut.mockReset();
    apiPut.mockResolvedValue([]);
    const brokerId = `watchlist-test-${crypto.randomUUID()}`;
    restoreBrokerRuntime = installTestBrokerRuntime({ BROKER_ID: brokerId });
    localStorage.setItem('broker_id', brokerId);
    localStorage.setItem('server_url', 'https://broker.example');
    localStorage.setItem('auth_token', 'watchlist-test-token');
    setMajorWatchlistSymbols(['EURUSD']);
  });

  afterEach(() => {
    useAppStore.setState({ isAuthenticated: false, accountId: null });
    localStorage.removeItem('auth_token');
    localStorage.removeItem('broker_id');
    localStorage.removeItem('server_url');
    restoreBrokerRuntime();
    vi.useRealTimers();
  });

  it('hydrates deterministically and preserves an add made while GET is pending', async () => {
    let resolveHydration: ((value: unknown) => void) | undefined;
    apiGet.mockImplementationOnce(() => new Promise((resolve) => {
      resolveHydration = resolve;
    }));
    useAppStore.setState({ isAuthenticated: true, accountId: 'watchlist-account-1' });

    const { unmount } = renderHook(() => useRemoteWatchlistSync('majors'));
    expect(apiPut).not.toHaveBeenCalled();

    act(() => setMajorWatchlistSymbols(['EURUSD', 'ETHUSD']));
    expect(apiPut).not.toHaveBeenCalled();

    await act(async () => {
      resolveHydration?.([
        { symbol: 'XAUUSD', sort_order: 2 },
        { symbol: 'eurusd', sort_order: 0 },
        { symbol: 'EURUSD', sort_order: 1 },
      ]);
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(useWatchlistStore.getState().getWatchlistById('majors')?.symbols)
      .toEqual(['EURUSD', 'ETHUSD', 'XAUUSD']);
    expect(apiPut).not.toHaveBeenCalled();

    await act(async () => {
      vi.advanceTimersByTime(500);
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(apiPut).toHaveBeenCalledWith('/watchlist', [
      { symbol: 'EURUSD', sort_order: 0 },
      { symbol: 'ETHUSD', sort_order: 1 },
      { symbol: 'XAUUSD', sort_order: 2 },
    ], expect.any(Object));
    unmount();
  });

  it('serializes PUTs and coalesces changes made while a write is in flight', async () => {
    let resolveFirstWrite: ((value: unknown) => void) | undefined;
    apiGet.mockResolvedValueOnce([{ symbol: 'EURUSD', sort_order: 0 }]);
    apiPut.mockImplementationOnce(() => new Promise((resolve) => {
      resolveFirstWrite = resolve;
    })).mockResolvedValueOnce([]);
    useAppStore.setState({ isAuthenticated: true, accountId: 'watchlist-account-2' });

    const { unmount } = renderHook(() => useRemoteWatchlistSync('majors'));
    await flushPromises();
    act(() => setMajorWatchlistSymbols(['EURUSD', 'ETHUSD']));
    await act(async () => {
      vi.advanceTimersByTime(500);
      await Promise.resolve();
    });
    expect(apiPut).toHaveBeenCalledTimes(1);

    act(() => setMajorWatchlistSymbols(['EURUSD', 'ETHUSD', 'USDJPY']));
    await act(async () => {
      vi.advanceTimersByTime(500);
      await Promise.resolve();
    });
    expect(apiPut).toHaveBeenCalledTimes(1);

    await act(async () => {
      resolveFirstWrite?.([]);
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(apiPut).toHaveBeenCalledTimes(2);
    expect(apiPut.mock.calls[1]?.[1]).toEqual([
      { symbol: 'EURUSD', sort_order: 0 },
      { symbol: 'ETHUSD', sort_order: 1 },
      { symbol: 'USDJPY', sort_order: 2 },
    ]);
    unmount();
  });

  it('cancels an account A delayed write and restores it only after switching back to A', async () => {
    apiGet
      .mockResolvedValueOnce([{ symbol: 'EURUSD', sort_order: 0 }])
      .mockResolvedValueOnce([{ symbol: 'USDJPY', sort_order: 0 }])
      .mockResolvedValueOnce([{ symbol: 'EURUSD', sort_order: 0 }]);
    useAppStore.setState({ isAuthenticated: true, accountId: 'watchlist-account-a' });
    const { unmount } = renderHook(() => useRemoteWatchlistSync('majors'));
    await flushPromises();

    act(() => setMajorWatchlistSymbols(['EURUSD', 'ETHUSD']));
    act(() => useAppStore.setState({ accountId: 'watchlist-account-b' }));
    await flushPromises();
    await act(async () => {
      vi.advanceTimersByTime(500);
      await Promise.resolve();
    });
    expect(apiPut).not.toHaveBeenCalled();

    act(() => useAppStore.setState({ accountId: 'watchlist-account-a' }));
    await flushPromises();
    await act(async () => {
      vi.advanceTimersByTime(500);
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(apiPut).toHaveBeenCalledTimes(1);
    expect(apiPut.mock.calls[0]?.[1]).toEqual([
      { symbol: 'EURUSD', sort_order: 0 },
      { symbol: 'ETHUSD', sort_order: 1 },
    ]);
    unmount();
  });

  it('retains a failed PUT snapshot and retries it after the scope is revisited', async () => {
    apiGet
      .mockResolvedValueOnce([{ symbol: 'EURUSD', sort_order: 0 }])
      .mockResolvedValueOnce([{ symbol: 'USDJPY', sort_order: 0 }])
      .mockResolvedValueOnce([{ symbol: 'EURUSD', sort_order: 0 }]);
    apiPut
      .mockRejectedValueOnce(new ApiError(503, 'Watchlist unavailable'))
      .mockResolvedValueOnce([]);
    useAppStore.setState({ isAuthenticated: true, accountId: 'watchlist-failed-a' });
    const { result, unmount } = renderHook(() => useRemoteWatchlistSync('majors'));
    await flushPromises();
    act(() => setMajorWatchlistSymbols(['EURUSD', 'ETHUSD']));
    await act(async () => {
      vi.advanceTimersByTime(500);
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(result.current.error).toBe('Watchlist unavailable');

    act(() => useAppStore.setState({ accountId: 'watchlist-failed-b' }));
    await flushPromises();
    act(() => useAppStore.setState({ accountId: 'watchlist-failed-a' }));
    await flushPromises();
    await act(async () => {
      vi.advanceTimersByTime(500);
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(apiPut).toHaveBeenCalledTimes(2);
    expect(apiPut.mock.calls[1]?.[1]).toEqual(apiPut.mock.calls[0]?.[1]);
    unmount();
  });

  it('waits for an in-flight PUT before reload and does not apply the older GET snapshot', async () => {
    let resolveWrite: ((value: unknown) => void) | undefined;
    apiGet
      .mockResolvedValueOnce([{ symbol: 'EURUSD', sort_order: 0 }])
      .mockResolvedValueOnce([{ symbol: 'EURUSD', sort_order: 0 }]);
    apiPut.mockImplementationOnce(() => new Promise((resolve) => {
      resolveWrite = resolve;
    }));
    useAppStore.setState({ isAuthenticated: true, accountId: 'watchlist-reload-a' });
    const { result, unmount } = renderHook(() => useRemoteWatchlistSync('majors'));
    await flushPromises();
    act(() => setMajorWatchlistSymbols(['EURUSD', 'ETHUSD']));
    await act(async () => {
      vi.advanceTimersByTime(500);
      await Promise.resolve();
    });
    expect(apiPut).toHaveBeenCalledTimes(1);

    let reloadPromise: Promise<void> | undefined;
    act(() => {
      reloadPromise = result.current.reload();
    });
    expect(apiGet).toHaveBeenCalledTimes(1);

    await act(async () => {
      resolveWrite?.([]);
      await reloadPromise;
    });
    expect(apiGet).toHaveBeenCalledTimes(2);
    expect(useWatchlistStore.getState().getWatchlistById('majors')?.symbols)
      .toEqual(['EURUSD', 'ETHUSD']);
    unmount();
  });
});

describe('useLiveQuotes REST fallback batching', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    apiGet.mockReset();
    apiPut.mockReset();
    enqueueSnapshotTick.mockReset();
    useQuoteSubscriptionMock.mockReset();
    apiGet.mockResolvedValue({ quotes: [] });
    useQuoteSubscriptionMock.mockReturnValue({ isConnected: true });
    useAppStore.setState({ isAuthenticated: true, ticks: {}, tickLookup: {} });
    useMarketDataStore.getState().clearAllData();
    commitBrokerAccountSessionScope({
      authenticated: true,
      accountId: 'live-quote-test',
      brokerId: 'live-quote-test',
      serverUrl: 'https://live-quote.test',
    });
    resetDailyChangePriceModeRegistryForTests();
  });

  afterEach(() => {
    useAppStore.setState({ isAuthenticated: false, ticks: {}, tickLookup: {} });
    useMarketDataStore.getState().clearAllData();
    commitBrokerAccountSessionScope({ authenticated: false, brokerId: '', serverUrl: '' });
    resetDailyChangePriceModeRegistryForTests();
    vi.useRealTimers();
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it('splits quote symbols into bounded REST batches', () => {
    const symbols = Array.from({ length: LIVE_QUOTES_REST_BATCH_SIZE * 2 + 5 }, (_, index) => `S${index}`);

    const batches = getLiveQuoteRestBatches(symbols);

    expect(batches.map((batch) => batch.length)).toEqual([
      LIVE_QUOTES_REST_BATCH_SIZE,
      LIVE_QUOTES_REST_BATCH_SIZE,
      5,
    ]);
    expect(batches.flat()).toEqual(symbols);
  });

  it('normalizes the broker daily_change_pct field from the REST quote snapshot', async () => {
    apiGet.mockResolvedValueOnce({
      quotes: [{
        symbol: 'XAUUSD',
        bid: 4604.44,
        ask: 4604.54,
        daily_change_pct: 0.45,
        daily_open: 4583.88,
        previous_close: 0,
        timestamp_ms: 1_777_000_000_000,
      }],
    });

    const { unmount } = renderHook(() => useLiveQuotes(['XAUUSD']));
    await flushPromises();

    expect(enqueueSnapshotTick).toHaveBeenCalledWith('XAUUSD', expect.objectContaining({
      bid: 4604.44,
      ask: 4604.54,
      dailyChange: 0.45,
    }));

    unmount();
  });

  it('uses Last chart mode and clearing price for the REST Daily Change fallback', async () => {
    apiGet.mockResolvedValueOnce({
      quotes: [{
        symbol: 'FUTURE.LAST',
        bid: 110,
        ask: 111,
        last: 120,
        chart_mode: 'SYMBOL_CHART_MODE_LAST',
        clearing_price: 80,
        previous_close: 100,
        timestamp_ms: 1_777_000_000_000,
      }],
    });

    const { unmount } = renderHook(() => useLiveQuotes(['FUTURE.LAST']));
    await flushPromises();

    expect(enqueueSnapshotTick).toHaveBeenCalledWith('FUTURE.LAST', expect.objectContaining({
      dailyChange: 50,
    }));

    unmount();
  });

  it('accepts an explicit Last-mode REST row without Bid/Ask', async () => {
    apiGet.mockResolvedValueOnce({
      quotes: [{
        symbol: 'FUTURE.LAST-ONLY',
        last_price: 120,
        chartMode: 1,
        settlement_price: 80,
        previous_close: 100,
        timestamp_ms: 1_777_000_000_000,
      }],
    });

    const { unmount } = renderHook(() => useLiveQuotes(['FUTURE.LAST-ONLY']));
    await flushPromises();

    expect(enqueueSnapshotTick).toHaveBeenCalledWith('FUTURE.LAST-ONLY', expect.objectContaining({
      bid: 0,
      ask: 0,
      last: 120,
      dailyChange: 50,
    }));

    unmount();
  });

  it('uses wrapped REST chart mode before catalog mode while preserving child authority', async () => {
    registerDailyChangePriceModes([
      { symbol: 'REST.WRAPPED.BID', brokerSpecification: { chart_mode: 1 } },
      { symbol: 'REST.WRAPPED.LAST', brokerSpecification: { chart_mode: 0 } },
      { symbol: 'REST.CHILD.LAST', brokerSpecification: { chart_mode: 0 } },
      { symbol: 'REST.CHILD.UNKNOWN', brokerSpecification: { chart_mode: 0 } },
    ]);
    apiGet.mockResolvedValueOnce({
      quotes: [
        {
          chart_mode: 0,
          data: { quote: {
            symbol: 'REST.WRAPPED.BID',
            bid: 110,
            ask: 111,
            last: 120,
            previous_close: 100,
            timestamp_ms: 1_777_000_000_000,
          } },
        },
        {
          chart_mode: 1,
          data: { quote: {
            symbol: 'REST.WRAPPED.LAST',
            bid: 110,
            ask: 111,
            last: 120,
            previous_close: 100,
            timestamp_ms: 1_777_000_000_000,
          } },
        },
        {
          chart_mode: 0,
          data: { quote: {
            symbol: 'REST.CHILD.LAST',
            bid: 110,
            ask: 111,
            last: 120,
            chart_mode: 1,
            previous_close: 100,
            timestamp_ms: 1_777_000_000_000,
          } },
        },
        {
          chart_mode: 1,
          data: { quote: {
            symbol: 'REST.CHILD.UNKNOWN',
            bid: 110,
            ask: 111,
            last: 120,
            chart_mode: 'future-mode',
            previous_close: 100,
            timestamp_ms: 1_777_000_000_000,
          } },
        },
      ],
    });

    const { unmount } = renderHook(() => useLiveQuotes([
      'REST.WRAPPED.BID',
      'REST.WRAPPED.LAST',
      'REST.CHILD.LAST',
      'REST.CHILD.UNKNOWN',
    ]));
    await flushPromises();

    expect(enqueueSnapshotTick.mock.calls.map(([, tick]) => tick.dailyChange)).toEqual([10, 20, 20, 10]);
    unmount();
  });

  it('composes wrapped REST Daily Change fields by nearest semantic alias group', async () => {
    apiGet.mockResolvedValueOnce({
      quotes: [
        {
          daily_change_pct: 0.75,
          data: { quote: {
            symbol: 'REST.OUTER.PERCENT',
            bid: 110,
            ask: 111,
            previous_close: 100,
            timestamp_ms: 1_777_000_000_000,
          } },
        },
        {
          daily_change_pct: 0.75,
          data: { quote: {
            symbol: 'REST.CHILD.PERCENT',
            bid: 110,
            ask: 111,
            dailyChangePct: 0.25,
            previous_close: 100,
            timestamp_ms: 1_777_000_000_000,
          } },
        },
        {
          chart_mode: 1,
          last: 120,
          settlement_price: 80,
          previous_close: 100,
          data: { quote: {
            symbol: 'REST.OUTER.BASELINE',
            bid: 110,
            ask: 111,
            timestamp_ms: 1_777_000_000_000,
          } },
        },
        {
          previous_close: 100,
          data: { quote: {
            symbol: 'REST.CHILD.BLOCKS.CLOSE',
            bid: 110,
            ask: 111,
            previousClose: 'unknown',
            timestamp_ms: 1_777_000_000_000,
          } },
        },
      ],
    });

    const { unmount } = renderHook(() => useLiveQuotes([
      'REST.OUTER.PERCENT',
      'REST.CHILD.PERCENT',
      'REST.OUTER.BASELINE',
      'REST.CHILD.BLOCKS.CLOSE',
    ]));
    await flushPromises();

    expect(enqueueSnapshotTick.mock.calls.map(([, tick]) => ({
      dailyChange: tick.dailyChange,
      last: tick.last,
    }))).toEqual([
      { dailyChange: 0.75, last: undefined },
      { dailyChange: 0.25, last: undefined },
      { dailyChange: 50, last: 120 },
      { dailyChange: undefined, last: undefined },
    ]);
    unmount();
  });

  it('preserves intermediate REST metadata, invalid blockers, symbols, and broker time', async () => {
    apiGet.mockResolvedValueOnce({
      quotes: [
        {
          daily_change_pct: 0.9,
          timestamp: 1_725_000_000,
          data: {
            daily_change_pct: 0.75,
            timestamp: 1_725_000_001,
            quote: {
              symbol: 'REST.NESTED.PERCENT',
              bid: 110,
              ask: 111,
              previous_close: 100,
            },
          },
        },
        {
          daily_change_pct: 0.9,
          data: {
            dailyChangePct: 'unknown',
            timestamp: 1_725_000_002,
            quote: {
              symbol: 'REST.NESTED.BLOCK',
              bid: 110,
              ask: 111,
              previous_close: 100,
            },
          },
        },
        {
          chart_mode: 0,
          data: {
            symbol: 'REST.NESTED.LAST',
            bid: 90,
            ask: 91,
            chart_mode: 1,
            last: 120,
            settlement_price: 80,
            timestamp: 1_725_000_003,
            quote: { bid: 110, ask: 111 },
          },
        },
      ],
    });

    const { unmount } = renderHook(() => useLiveQuotes([
      'REST.NESTED.PERCENT',
      'REST.NESTED.BLOCK',
      'REST.NESTED.LAST',
    ]));
    await flushPromises();

    expect(enqueueSnapshotTick.mock.calls.map(([symbol, tick]) => ({
      symbol,
      bid: tick.bid,
      dailyChange: tick.dailyChange,
      last: tick.last,
      sourceTimestamp: tick.sourceTimestamp,
    }))).toEqual([
      {
        symbol: 'REST.NESTED.PERCENT',
        bid: 110,
        dailyChange: 0.75,
        last: undefined,
        sourceTimestamp: 1_725_000_001_000,
      },
      {
        symbol: 'REST.NESTED.BLOCK',
        bid: 110,
        dailyChange: 10,
        last: undefined,
        sourceTimestamp: 1_725_000_002_000,
      },
      {
        symbol: 'REST.NESTED.LAST',
        bid: 110,
        dailyChange: 50,
        last: 120,
        sourceTimestamp: 1_725_000_003_000,
      },
    ]);
    unmount();
  });

  it('does not infer Last chart mode for an ambiguous Last-only REST row', async () => {
    apiGet.mockResolvedValueOnce({
      quotes: [{
        symbol: 'AMBIGUOUS.LAST-ONLY',
        last: 120,
        previous_close: 100,
        timestamp_ms: 1_777_000_000_000,
      }],
    });

    const { unmount } = renderHook(() => useLiveQuotes(['AMBIGUOUS.LAST-ONLY']));
    await flushPromises();
    expect(enqueueSnapshotTick).toHaveBeenCalledTimes(1);
    expect(enqueueSnapshotTick.mock.calls[0][1]).toMatchObject({ bid: 0, ask: 0, dailyChange: undefined, dailyChangeInput: { mode: undefined, last: 120 } });

    unmount();
  });

  it('preserves detailed REST quote aliases without inventing volume', async () => {
    apiGet.mockResolvedValueOnce({
      quotes: [{
        symbol: 'XAUUSD',
        bid: 4411.09,
        ask: 4411.2,
        last_price: 4411.15,
        liquidity_provider: 'FXTrust',
        high_24h: 4420.5,
        low_24h: 4398.25,
        daily_open: 4400,
        previous_close: 4399,
        timestamp: 1_788_250_045,
      }],
    });

    const { unmount } = renderHook(() => useLiveQuotes(['XAUUSD']));
    await flushPromises();

    expect(enqueueSnapshotTick).toHaveBeenCalledWith('XAUUSD', expect.objectContaining({
      last: 4411.15,
      lp: 'FXTrust',
      high24h: 4420.5,
      low24h: 4398.25,
      open: 4400,
      close: 4399,
      volume: undefined,
    }));

    unmount();
  });

  it('loads all initial REST batches once without polling while leaving websocket demand on all symbols', async () => {
    const symbols = Array.from({ length: LIVE_QUOTES_REST_BATCH_SIZE * 2 + 1 }, (_, index) => `S${index}`);

    const { unmount } = renderHook(() => useLiveQuotes(symbols));
    await flushPromises();

    expect(useQuoteSubscriptionMock).toHaveBeenCalledWith(
      symbols,
      expect.stringMatching(/^live-quotes:/),
    );
    expect(apiGet).toHaveBeenCalledTimes(3);
    expect(apiGet.mock.calls.map(([, options]) => options?.params?.symbols.split(','))).toEqual([
      symbols.slice(0, LIVE_QUOTES_REST_BATCH_SIZE),
      symbols.slice(LIVE_QUOTES_REST_BATCH_SIZE, LIVE_QUOTES_REST_BATCH_SIZE * 2),
      symbols.slice(LIVE_QUOTES_REST_BATCH_SIZE * 2),
    ]);

    await act(async () => {
      vi.advanceTimersByTime(60_000);
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(apiGet).toHaveBeenCalledTimes(3);

    unmount();
  });

  it('does not dispatch a timestamp-less REST snapshot over an existing websocket source tick', async () => {
    const websocketTick = {
      symbol: 'EURUSD',
      bid: 1.105,
      ask: 1.1052,
      spread: 0.0002,
      timestamp: 1_788_250_050_000,
      sourceTimestamp: 1_788_250_045_000,
    };
    useAppStore.getState().setTick('EURUSD', websocketTick);
    useMarketDataStore.setState((state) => ({
      symbolData: {
        ...state.symbolData,
        EURUSD: {
          ...state.symbolData.EURUSD,
          currentTick: websocketTick,
        },
      },
    }));
    apiGet.mockResolvedValueOnce({
      quotes: [{
        symbol: 'EURUSD',
        bid: 1.09,
        ask: 1.0902,
      }],
    });

    const { unmount } = renderHook(() => useLiveQuotes(['EURUSD']));
    await flushPromises();

    expect(apiGet).toHaveBeenCalledTimes(1);
    expect(enqueueSnapshotTick).not.toHaveBeenCalled();
    expect(useMarketDataStore.getState().symbolData.EURUSD?.currentTick).toEqual(websocketTick);
    expect(useAppStore.getState().ticks.EURUSD).toMatchObject(websocketTick);

    unmount();
  });

  it('gives concurrent quote consumers independent demand source ids', () => {
    const { unmount } = renderHook(() => {
      useLiveQuotes(['EURUSD']);
      useLiveQuotes(['XAUUSD']);
    });

    const recentCalls = useQuoteSubscriptionMock.mock.calls.slice(-2);
    expect(recentCalls[0][0]).toEqual(['EURUSD']);
    expect(recentCalls[1][0]).toEqual(['XAUUSD']);
    expect(recentCalls[0][1]).toMatch(/^live-quotes:/);
    expect(recentCalls[1][1]).toMatch(/^live-quotes:/);
    expect(recentCalls[0][1]).not.toBe(recentCalls[1][1]);

    unmount();
  });

  it('tracks guest public quote demand without issuing account quote requests', async () => {
    // A stale stored token must not turn the guest quote snapshot into an
    // account-scoped request while the application is logged out.
    localStorage.setItem('auth_token', 'expired-account-token');
    useAppStore.setState({ isAuthenticated: false, authToken: null, refreshToken: null, accountId: null });
    const { unmount } = renderHook(() => useLiveQuotes(['btcusd']));
    await flushPromises();

    expect(apiGet).not.toHaveBeenCalled();
    expect(useQuoteSubscriptionMock).toHaveBeenCalledWith(['BTCUSD'], expect.stringMatching(/^live-quotes:/));
    expect(useMarketDataStore.getState().subscribedSymbols.has('BTCUSD')).toBe(true);
    expect(apiPut).not.toHaveBeenCalled();

    unmount();
    localStorage.removeItem('auth_token');
    expect(useMarketDataStore.getState().subscribedSymbols.has('BTCUSD')).toBe(false);
  });

  it('retains public quote demand after logout and ignores an older account response', async () => {
    let resolveAccountSnapshot: ((value: unknown) => void) | undefined;
    apiGet.mockImplementationOnce(() => new Promise((resolve) => {
      resolveAccountSnapshot = resolve;
    }));
    const { unmount } = renderHook(() => useLiveQuotes(['EURUSD']));
    await flushPromises();

    act(() => useAppStore.setState({ isAuthenticated: false, authToken: null, accountId: null }));
    await flushPromises();
    expect(apiGet).toHaveBeenCalledTimes(1);
    expect(useMarketDataStore.getState().subscribedSymbols.has('EURUSD')).toBe(true);

    await act(async () => {
      resolveAccountSnapshot?.({ quotes: [{ symbol: 'EURUSD', bid: 1.1, ask: 1.11 }] });
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(enqueueSnapshotTick).not.toHaveBeenCalled();
    unmount();
  });

  it.each(['desktop', 'direct'])('streams newly added browser guest symbols with a %s backend target', async (backendTarget) => {
    vi.stubEnv('BACKEND_TARGET', backendTarget);
    useAppStore.setState({ isAuthenticated: false, authToken: null, refreshToken: null, accountId: null });
    const { rerender, unmount } = renderHook(({ symbols }) => useLiveQuotes(symbols), {
      initialProps: { symbols: ['BTCUSD'] },
    });
    await flushPromises();

    expect(useQuoteSubscriptionMock).toHaveBeenLastCalledWith(['BTCUSD'], expect.stringMatching(/^live-quotes:/));
    expect(useMarketDataStore.getState().subscribedSymbols.has('BTCUSD')).toBe(true);

    rerender({ symbols: ['BTCUSD', 'xauusd'] });
    await flushPromises();

    expect(useQuoteSubscriptionMock).toHaveBeenLastCalledWith(['BTCUSD', 'XAUUSD'], expect.stringMatching(/^live-quotes:/));
    expect(useMarketDataStore.getState().subscribedSymbols.has('XAUUSD')).toBe(true);
    expect(apiGet).not.toHaveBeenCalled();
    expect(apiPut).not.toHaveBeenCalled();

    unmount();
    expect(useMarketDataStore.getState().subscribedSymbols.size).toBe(0);
  });

  it('subscribes newly added Electron symbols without waiting for account login or chart selection', async () => {
    vi.stubEnv('BACKEND_TARGET', 'desktop');
    vi.stubGlobal('electronAPI', {});
    useAppStore.setState({ isAuthenticated: false, authToken: null, refreshToken: null, accountId: null });
    const { result, rerender, unmount } = renderHook(({ symbols }) => useLiveQuotes(symbols), {
      initialProps: { symbols: ['BTCUSD'] },
    });
    await flushPromises();

    expect(apiGet).not.toHaveBeenCalled();
    expect(useQuoteSubscriptionMock).toHaveBeenLastCalledWith(['BTCUSD'], expect.stringMatching(/^live-quotes:/));
    expect(useMarketDataStore.getState().subscribedSymbols.has('BTCUSD')).toBe(true);
    expect(result.current.loading).toBe(false);

    rerender({ symbols: ['BTCUSD', 'xauusd'] });
    await flushPromises();

    expect(useQuoteSubscriptionMock).toHaveBeenLastCalledWith(['BTCUSD', 'XAUUSD'], expect.stringMatching(/^live-quotes:/));
    expect(useMarketDataStore.getState().subscribedSymbols.has('XAUUSD')).toBe(true);
    expect(apiGet).not.toHaveBeenCalled();
    expect(apiPut).not.toHaveBeenCalled();

    unmount();
    expect(useMarketDataStore.getState().subscribedSymbols.size).toBe(0);
  });
});

describe('useMarketInstruments normalization', () => {
  beforeEach(() => {
    apiGet.mockReset();
    apiPut.mockReset();
    enqueueSnapshotTick.mockReset();
    useQuoteSubscriptionMock.mockReset();
    localStorage.setItem('auth_token', 'instrument-test-token');
    localStorage.setItem('refresh_token', 'instrument-test-refresh');
    useAppStore.setState({
      isAuthenticated: true,
      accountId: 'instrument-test-account',
      authToken: 'instrument-test-token',
      refreshToken: 'instrument-test-refresh',
      ticks: {},
      tickLookup: {},
    });
  });

  afterEach(() => {
    useAppStore.setState({
      isAuthenticated: false,
      accountId: null,
      authToken: null,
      refreshToken: null,
      ticks: {},
      tickLookup: {},
    });
    localStorage.removeItem('auth_token');
    localStorage.removeItem('refresh_token');
  });

  it('normalizes enabled and status fields without treating missing flags as disabled', () => {
    expect(normalizeInstrumentEnabled({ trading_enabled: 'false' })).toBe(false);
    expect(normalizeInstrumentEnabled({ tradingEnabled: 'enabled' })).toBe(true);
    expect(normalizeInstrumentEnabled({ is_enabled: 0 })).toBe(false);
    expect(normalizeInstrumentEnabled({ status: 'ACTIVE' })).toBe(true);
    expect(normalizeInstrumentEnabled({ status: 'disabled' })).toBe(false);
    expect(normalizeInstrumentEnabled({ symbol: 'EURUSD' })).toBeUndefined();
  });

  it('waits for session restoration before starting either public or authenticated catalogs', async () => {
    apiGet.mockImplementation(async (endpoint: string) => endpoint === '/instruments'
      ? { symbols: [{ symbol: 'EURUSD', trading_enabled: true }] }
      : { symbols: [{ symbol: 'EURUSD', bid: 1.1, ask: 1.2 }] });
    useAppStore.setState({ isAuthenticated: false, accountId: null });
    const { result, rerender, unmount } = renderHook(({ enabled }) => useMarketInstruments(enabled), {
      initialProps: { enabled: false },
    });
    await flushPromises();
    await act(async () => result.current.reload());
    expect(apiGet).not.toHaveBeenCalled();
    expect(result.current.loading).toBe(true);
    expect(result.current.authorizationSettled).toBe(false);

    act(() => useAppStore.setState({ isAuthenticated: true, accountId: 'restored-account' }));
    expect(apiGet).not.toHaveBeenCalled();
    rerender({ enabled: true });
    await flushPromises();
    expect(apiGet.mock.calls.map(([endpoint]) => endpoint)).toEqual(['/api/v1/market/symbols', '/instruments']);
    expect(result.current.authorizedSymbols).toEqual(['EURUSD']);
    expect(result.current.chartCatalogCurrent).toBe(true);
    unmount();
  });

  it('aborts this consumer and rejects its late catalog result when disabled', async () => {
    const requests: Array<{ signal: AbortSignal; resolve: (value: unknown) => void }> = [];
    apiGet.mockImplementation((_endpoint: string, options: { signal: AbortSignal }) => new Promise(resolve => {
      requests.push({ signal: options.signal, resolve });
    }));
    const { result, rerender, unmount } = renderHook(({ enabled }) => useMarketInstruments(enabled), {
      initialProps: { enabled: true },
    });
    expect(requests).toHaveLength(2);
    rerender({ enabled: false });
    expect(requests.every(request => request.signal.aborted)).toBe(true);
    await act(async () => {
      requests.forEach(request => request.resolve({ symbols: [{ symbol: 'OLD', trading_enabled: true, bid: 10, ask: 11 }] }));
    });
    expect(result.current.symbols).toEqual([]);
    expect(result.current.authorizedSymbols).toEqual([]);
    expect(result.current.authorizationSettled).toBe(false);
    expect(result.current.loading).toBe(true);
    unmount();
  });

  it('does not pause another enabled catalog consumer', async () => {
    apiGet.mockResolvedValue({ symbols: [{ symbol: 'EURUSD', trading_enabled: true }] });
    const { result, unmount } = renderHook(() => ({
      paused: useMarketInstruments(false),
      active: useMarketInstruments(),
    }));
    await flushPromises();
    expect(apiGet).toHaveBeenCalledTimes(2);
    expect(result.current.paused.authorizedSymbols).toEqual([]);
    expect(result.current.paused.loading).toBe(true);
    expect(result.current.active.authorizedSymbols).toEqual(['EURUSD']);
    expect(result.current.active.loading).toBe(false);
    unmount();
  });

  it('preserves broker specification fields in the public fallback instrument', async () => {
    apiGet.mockResolvedValueOnce({
      symbols: [{
        symbol: 'XAUUSD',
        bid: '4425.90',
        ask: '4426.05',
        spread: '0.15',
        digits: '2',
        contract_size: '100',
        tick_size: '0.01',
        min_volume: '0.01',
        max_volume: '50',
        volume_step: '0.01',
        margin_rate: '0.02',
        swap_long: '-2.5',
        swap_short: '1.25',
        commission: '3',
      }],
    }).mockResolvedValueOnce({
      symbols: [{ symbol: 'XAUUSD', trading_enabled: true }],
    });

    const { result, unmount } = renderHook(() => useMarketInstruments());
    await flushPromises();

    expect(result.current.symbols).toEqual([
      expect.objectContaining({
        symbol: 'XAUUSD',
        bid: 4425.9,
        ask: 4426.05,
        spread: 0.15,
        digits: 2,
        contractSize: 100,
        tickSize: 0.01,
        minVolume: 0.01,
        maxVolume: 50,
        volumeStep: 0.01,
        marginRate: 0.02,
        swapLong: -2.5,
        swapShort: 1.25,
        commission: 3,
      }),
    ]);

    unmount();
  });

  it('retains authenticated broker volume constraints for order controls', async () => {
    apiGet.mockResolvedValueOnce({
      symbols: [{ symbol: 'BTCUSD', bid: 108000, ask: 108010 }],
    }).mockResolvedValueOnce({
      symbols: [{
        symbol: 'BTCUSD',
        trading_enabled: true,
        volume_min: '0.001',
        volume_max: '25',
        volume_step: '0.001',
      }],
    });

    const { result, unmount } = renderHook(() => useMarketInstruments());
    await flushPromises();

    // FIX regression: authenticated min/max/step metadata must survive the
    // authorization request instead of being reduced to a symbol-name list.
    expect(result.current.authorizedInstruments).toEqual([
      expect.objectContaining({
        symbol: 'BTCUSD',
        minVolume: 0.001,
        maxVolume: 25,
        volumeStep: 0.001,
      }),
    ]);

    unmount();
  });

  it('retains the complete authenticated broker row for symbol specification', async () => {
    const brokerSpecification = {
      symbol: 'XAUUSD',
      trading_enabled: true,
      volume_min: '0.01',
      trade_mode: 'full_access',
      execution_mode: 'market',
      specification: {
        calculation_mode: 'cfd_leverage',
        stops_level: 0,
        swap_rollover_day: 'wednesday',
      },
      sessions: {
        monday: [{ from: '00:00', to: '23:00' }],
      },
      margin_rates: [{ order_type: 'market_buy', initial: 1, maintenance: 1 }],
    };
    apiGet.mockResolvedValueOnce({
      symbols: [{ symbol: 'XAUUSD', bid: 4300, ask: 4300.2 }],
    }).mockResolvedValueOnce({
      symbols: [brokerSpecification],
    });

    const { result, unmount } = renderHook(() => useMarketInstruments());
    await flushPromises();

    const retained = result.current.authorizedInstruments[0].brokerSpecification;
    expect(retained).toEqual(brokerSpecification);
    expect(retained).not.toBe(brokerSpecification);
    expect(Object.isFrozen(retained)).toBe(true);
    expect(retained?.sessions).toEqual(brokerSpecification.sessions);
    expect(retained?.margin_rates).toEqual(brokerSpecification.margin_rates);

    unmount();
  });

  it('loads a fresh exact-symbol specification with the captured account session', async () => {
    apiGet
      .mockResolvedValueOnce({ symbols: [{ symbol: 'XAU/USD', bid: 4300, ask: 4300.2 }] })
      .mockResolvedValueOnce({ symbols: [{ symbol: 'XAU/USD', trading_enabled: true }] });

    const { result, unmount } = renderHook(() => useMarketInstruments());
    await flushPromises();

    apiGet.mockResolvedValueOnce({
      symbol: 'XAU/USD',
      specification: {
        calc_mode: 'cfd_leverage',
        swap_long: -12.6,
      },
    });
    const controller = new AbortController();
    let loaded: Readonly<Record<string, unknown>> | null = null;
    await act(async () => {
      loaded = await result.current.loadSymbolSpecification?.('xau/usd', controller.signal) ?? null;
    });

    expect(apiGet).toHaveBeenLastCalledWith(
      '/instruments/XAU%2FUSD/specification',
      expect.objectContaining({
        authToken: 'instrument-test-token',
        signal: controller.signal,
        params: expect.objectContaining({ account_login: 'instrument-test-account' }),
      }),
    );
    expect(loaded).toEqual(expect.objectContaining({
      symbol: 'XAU/USD',
      specification: expect.objectContaining({ swap_long: -12.6 }),
    }));
    expect(Object.isFrozen(loaded)).toBe(true);

    unmount();
  });

  it('does not invent specification values when the broker omits them', async () => {
    apiGet.mockResolvedValueOnce({
      symbols: [{
        symbol: 'EURUSD',
        bid: 1.10101,
        ask: 1.10123,
        contract_size: '',
        min_volume: null,
      }],
    }).mockResolvedValueOnce({
      symbols: [{ symbol: 'EURUSD', trading_enabled: true }],
    });

    const { result, unmount } = renderHook(() => useMarketInstruments());
    await flushPromises();

    expect(result.current.symbols[0]).toMatchObject({
      symbol: 'EURUSD',
      contractSize: undefined,
      minVolume: undefined,
      maxVolume: undefined,
      volumeStep: undefined,
      marginRate: undefined,
      swapLong: undefined,
      swapShort: undefined,
      commission: undefined,
    });

    unmount();
  });

  it('accepts the broker specification aliases used by terminal data sources', async () => {
    apiGet.mockResolvedValueOnce({
      symbols: [{
        symbol: 'BTCUSD',
        bid: 108000,
        ask: 108010,
        contractSize: '1',
        pointSize: '0.01',
        volume_min: '0.001',
        volume_max: '25',
        lotStep: '0.001',
        initialMargin: '0.1',
        swapLong: '0',
        swapShort: '-1.5',
        commissionPerLot: '2.25',
      }],
    }).mockResolvedValueOnce({
      symbols: [{ symbol: 'BTCUSD', tradingEnabled: true }],
    });

    const { result, unmount } = renderHook(() => useMarketInstruments());
    await flushPromises();

    expect(result.current.symbols[0]).toMatchObject({
      contractSize: 1,
      tickSize: 0.01,
      minVolume: 0.001,
      maxVolume: 25,
      volumeStep: 0.001,
      marginRate: 0.1,
      swapLong: 0,
      swapShort: -1.5,
      commission: 2.25,
    });

    unmount();
  });

  it('loads the public priced catalog while keeping authenticated trade authorization separate', async () => {
    apiGet.mockResolvedValueOnce({
      symbols: [
        { symbol: 'EURUSD', bid: '1.10101', ask: '1.10123', digits: 5, time: 1_700_000_000 },
        { symbol: 'GBPUSD', bid: 1.26789, ask: 1.26801 },
        { symbol: 'XAUUSD', bid: 2345.1, ask: 2345.6 },
      ],
    }).mockResolvedValueOnce({
      symbols: [
        { symbol: 'EURUSD', trading_enabled: true },
        { symbol: 'GBPUSD' },
        { symbol: 'XAUUSD', status: 'disabled' },
      ],
    });

    const { result, unmount } = renderHook(() => useMarketInstruments());
    await flushPromises();

    expect(apiGet.mock.calls[0]).toEqual([
      '/api/v1/market/symbols',
      expect.objectContaining({ skipAuth: true, skipDynamicUrl: true }),
    ]);
    expect(result.current.symbols.map((item) => item.symbol)).toEqual(['EURUSD', 'GBPUSD', 'XAUUSD']);
    expect(result.current.authorizedSymbols).toEqual(['EURUSD', 'GBPUSD']);
    expect(result.current.disabledSymbols).toEqual(['XAUUSD']);
    expect(result.current.authorizationSettled).toBe(true);
    expect(enqueueSnapshotTick).toHaveBeenCalledTimes(3);
    expect(enqueueSnapshotTick).toHaveBeenCalledWith('EURUSD', expect.objectContaining({
      symbol: 'EURUSD',
      bid: 1.10101,
      ask: 1.10123,
      spread: expect.any(Number),
      digits: 5,
      timestamp: 1_700_000_000_000,
    }));
    expect(enqueueSnapshotTick).toHaveBeenCalledWith('GBPUSD', expect.objectContaining({
      symbol: 'GBPUSD',
      bid: 1.26789,
      ask: 1.26801,
    }));

    unmount();
  });

  it('never flashes the public catalog to a logged-in account while its catalogue loads', async () => {
    let resolveAuthorization!: (value: unknown) => void;
    apiGet
      .mockResolvedValueOnce({
        symbols: [
          { symbol: 'XAUUSD', bid: 4425.9, ask: 4426.05 },
          { symbol: 'BTCUSD', bid: 108000, ask: 108010 },
        ],
      })
      .mockImplementationOnce(() => new Promise((resolve) => {
        resolveAuthorization = resolve;
      }));

    const { result, unmount } = renderHook(() => useMarketInstruments());
    await flushPromises();

    expect(result.current.symbols).toEqual([]);
    expect(result.current.loading).toBe(true);
    expect(result.current.accountCatalogStatus).toBe('loading');
    expect(result.current.authorizedSymbols).toEqual([]);
    expect(result.current.authorizationSettled).toBe(false);
    expect(result.current.chartCatalogCurrent).toBe(false);
    expect(enqueueSnapshotTick).not.toHaveBeenCalled();

    await act(async () => {
      resolveAuthorization({
        symbols: [{ symbol: 'XAUUSD', trading_enabled: true }],
      });
      await Promise.resolve();
      await Promise.resolve();
    });

    // Only the account's group symbols; BTCUSD from the public list is gone.
    expect(result.current.symbols.map((item) => item.symbol)).toEqual(['XAUUSD']);
    expect(result.current.symbols[0]).toMatchObject({ bid: 4425.9, ask: 4426.05 });
    expect(result.current.loading).toBe(false);
    expect(result.current.accountCatalogStatus).toBe('loaded');
    expect(result.current.authorizedSymbols).toEqual(['XAUUSD']);
    expect(result.current.authorizationSettled).toBe(true);
    expect(result.current.chartCatalogCurrent).toBe(true);
    expect(enqueueSnapshotTick).toHaveBeenCalledTimes(1);
    expect(enqueueSnapshotTick).toHaveBeenCalledWith('XAUUSD', expect.anything());
    unmount();
  });

  it('uses the account catalogue in backend order as the symbol universe', async () => {
    apiGet.mockResolvedValueOnce({
      symbols: [
        { symbol: 'BTCUSD', bid: 108000, ask: 108010 },
        { symbol: 'EURUSD', bid: 1.1, ask: 1.2, description: 'Euro vs US Dollar' },
        { symbol: 'US30', bid: 40000, ask: 40002 },
        { symbol: 'XAUUSD', bid: 2345.1, ask: 2345.6 },
      ],
    }).mockResolvedValueOnce({
      symbols: [
        { symbol: 'XAUUSD', trading_enabled: true },
        { symbol: 'GER40', trading_enabled: true },
        { symbol: 'EURUSD', trading_enabled: false },
      ],
    });

    const { result, unmount } = renderHook(() => useMarketInstruments());
    await flushPromises();

    expect(result.current.symbols.map((item) => item.symbol)).toEqual(['XAUUSD', 'GER40', 'EURUSD']);
    expect(result.current.symbols[2]).toMatchObject({ description: 'Euro vs US Dollar', tradingEnabled: false });
    expect(result.current.authorizedSymbols).toEqual(['XAUUSD', 'GER40']);
    expect(result.current.disabledSymbols).toEqual(['EURUSD']);
    expect(result.current.accountCatalogStatus).toBe('loaded');
    // Only account symbols are seeded into the quote store.
    expect(enqueueSnapshotTick.mock.calls.map(([symbol]) => symbol).sort()).toEqual(['EURUSD', 'XAUUSD']);
    unmount();
  });

  it('still loads the account catalogue when the public catalog is unavailable', async () => {
    apiGet.mockRejectedValueOnce(new ApiError(503, 'Public catalog unavailable'))
      .mockResolvedValueOnce({ symbols: [{ symbol: 'EURUSD', trading_enabled: true }] });

    const { result, unmount } = renderHook(() => useMarketInstruments());
    await flushPromises();

    expect(result.current.symbols.map((item) => item.symbol)).toEqual(['EURUSD']);
    expect(result.current.accountCatalogStatus).toBe('loaded');
    expect(result.current.error).toBeNull();
    unmount();
  });

  it('hides the previous account universe immediately on logout and account switch', async () => {
    apiGet.mockResolvedValueOnce({ symbols: [{ symbol: 'XAUUSD' }, { symbol: 'BTCUSD' }] })
      .mockResolvedValueOnce({ symbols: [{ symbol: 'XAUUSD', trading_enabled: true }] });
    const { result, unmount } = renderHook(() => useMarketInstruments());
    await flushPromises();
    expect(result.current.symbols.map((item) => item.symbol)).toEqual(['XAUUSD']);

    apiGet.mockImplementation(() => new Promise(() => {}));
    act(() => {
      useAppStore.setState({ accountId: 'instrument-other-account' });
    });
    expect(result.current.symbols).toEqual([]);
    expect(result.current.accountCatalogStatus).toBe('loading');

    act(() => {
      useAppStore.setState({ isAuthenticated: false, accountId: null });
    });
    expect(result.current.symbols).toEqual([]);
    expect(result.current.accountCatalogStatus).toBe('none');
    unmount();
  });

  it('does not permit saved-chart replacement when catalog authorization fails', async () => {
    apiGet.mockResolvedValueOnce({ symbols: [{ symbol: 'AAPL.US' }] })
      .mockRejectedValueOnce(new ApiError(503, 'Catalog unavailable'));
    const { result, unmount } = renderHook(() => useMarketInstruments());
    await flushPromises();
    expect(result.current.authorizationSettled).toBe(true);
    // Read-only public fallback; trading stays unauthorized.
    expect(result.current.symbols.map(item => item.symbol)).toEqual(['AAPL.US']);
    expect(result.current.accountCatalogStatus).toBe('failed');
    expect(result.current.authorizedSymbols).toEqual([]);
    expect(result.current.chartCatalogCurrent).toBe(false);
    unmount();
  });

  it('starts authorization immediately and renders its catalog while public quotes are pending', async () => {
    let resolvePublic!: (value: unknown) => void;
    apiGet.mockImplementationOnce(() => new Promise((resolve) => {
      resolvePublic = resolve;
    })).mockResolvedValueOnce({ symbols: [
      { symbol: 'XAUUSD', trading_enabled: true, min_volume: 0.01 },
      { symbol: 'EURUSD', trading_enabled: false },
    ] });

    const { result, unmount } = renderHook(() => useMarketInstruments());
    expect(apiGet.mock.calls.map(([endpoint]) => endpoint)).toEqual([
      '/api/v1/market/symbols', '/instruments',
    ]);
    await flushPromises();

    expect(result.current.loading).toBe(false);
    expect(result.current.symbols.map((item) => item.symbol)).toEqual(['XAUUSD', 'EURUSD']);
    expect(result.current.authorizedSymbols).toEqual(['XAUUSD']);
    expect(result.current.disabledSymbols).toEqual(['EURUSD']);
    expect(result.current.authorizationSettled).toBe(true);
    expect(result.current.chartCatalogCurrent).toBe(false);

    await act(async () => {
      resolvePublic({ symbols: [
        { symbol: 'XAUUSD', bid: 4425.9, ask: 4426.05 },
        { symbol: 'BTCUSD', bid: 108000, ask: 108010 },
      ] });
    });

    expect(result.current.symbols[0]).toMatchObject({ symbol: 'XAUUSD', bid: 4425.9 });
    // The public catalogue only enriches the account universe; a public-only
    // symbol never enters a logged-in account's symbol list.
    expect(result.current.symbols.map((item) => item.symbol)).toEqual(['XAUUSD', 'EURUSD']);
    expect(result.current.accountCatalogStatus).toBe('loaded');
    expect(result.current.chartCatalogCurrent).toBe(true);
    expect(result.current.authorizedSymbols).toEqual(['XAUUSD']);
    expect(result.current.authorizedInstruments[0].minVolume).toBe(0.01);
    unmount();
  });

  it.each(['before', 'after'] as const)(
    'keeps authenticated results when the public catalog fails %s authorization resolves',
    async (failureOrder) => {
      let rejectPublic!: (reason: unknown) => void;
      let resolveAuthorization!: (value: unknown) => void;
      apiGet.mockImplementationOnce(() => new Promise((_resolve, reject) => {
        rejectPublic = reject;
      })).mockImplementationOnce(() => new Promise((resolve) => {
        resolveAuthorization = resolve;
      }));

      const { result, unmount } = renderHook(() => useMarketInstruments());
      const failPublic = async () => {
        await act(async () => rejectPublic(new ApiError(503, 'Public catalog unavailable')));
      };
      const finishAuthorization = async () => {
        await act(async () => resolveAuthorization({ symbols: [
          { symbol: 'XAUUSD.raw', trading_enabled: true, volume_step: 0.1 },
          { symbol: 'EURUSD.raw', trading_enabled: false },
        ] }));
      };
      if (failureOrder === 'before') {
        await failPublic();
        expect(result.current.authorizedSymbols).toEqual([]);
        expect(result.current.authorizationSettled).toBe(false);
        await finishAuthorization();
      } else {
        await finishAuthorization();
        await failPublic();
      }

      expect(result.current.symbols.map((item) => item.symbol)).toEqual(['XAUUSD.RAW', 'EURUSD.RAW']);
      expect(result.current.authorizedSymbols).toEqual(['XAUUSD.RAW']);
      expect(result.current.disabledSymbols).toEqual(['EURUSD.RAW']);
      expect(result.current.authorizedInstruments[0].volumeStep).toBe(0.1);
      expect(result.current.authorizationSettled).toBe(true);
      expect(result.current.chartCatalogCurrent).toBe(true);
      expect(result.current.loading).toBe(false);
      expect(result.current.error).toBeNull();
      unmount();
    },
  );

  it('invalidates successful catalog ownership before another broker/account request resolves', async () => {
    apiGet.mockResolvedValueOnce({ symbols: [{ symbol: 'XAUUSD.raw' }] })
      .mockResolvedValueOnce({ symbols: [{ symbol: 'XAUUSD.raw', trading_enabled: true }] });
    const { result, unmount } = renderHook(() => useMarketInstruments());
    await flushPromises();
    expect(result.current.chartCatalogCurrent).toBe(true);
    apiGet.mockImplementation(() => new Promise(() => {}));
    act(() => {
      localStorage.setItem('broker_id', 'achiever-financials');
      useAppStore.setState({ accountId: 'changed-catalog-account' });
    });
    expect(result.current.chartCatalogCurrent).toBe(false);
    unmount();
  });

  it('loads and seeds the public priced catalog without an authenticated account', async () => {
    localStorage.removeItem('auth_token');
    localStorage.removeItem('refresh_token');
    useAppStore.setState({
      isAuthenticated: false,
      accountId: null,
      authToken: null,
      refreshToken: null,
    });
    apiGet.mockResolvedValueOnce({
      symbols: [
        { symbol: 'EURUSD', bid: 1.10101, ask: 1.10123 },
        { symbol: 'BTCUSD', bid: 108000, ask: 108010 },
      ],
    });

    const { result, unmount } = renderHook(() => useMarketInstruments());
    await flushPromises();

    expect(apiGet).toHaveBeenCalledTimes(1);
    expect(apiGet).toHaveBeenCalledWith(
      '/api/v1/market/symbols',
      expect.objectContaining({ skipAuth: true, skipDynamicUrl: true }),
    );
    expect(result.current.symbols.map((item) => item.symbol)).toEqual(['EURUSD', 'BTCUSD']);
    expect(result.current.accountCatalogStatus).toBe('none');
    expect(result.current.authorizedSymbols).toEqual([]);
    expect(result.current.disabledSymbols).toEqual([]);
    expect(result.current.authorizationSettled).toBe(true);
    expect(enqueueSnapshotTick).toHaveBeenCalledTimes(2);

    unmount();
  });

  it('keeps public requests unauthenticated and ignores the previous account response after a switch', async () => {
    let resolveFirstAccount: ((value: unknown) => void) | undefined;
    let resolveFirstAuthorization: ((value: unknown) => void) | undefined;
    apiGet
      .mockImplementationOnce(() => new Promise((resolve) => {
        resolveFirstAccount = resolve;
      }))
      .mockImplementationOnce(() => new Promise((resolve) => {
        resolveFirstAuthorization = resolve;
      }))
      .mockResolvedValueOnce({
        symbols: [{ symbol: 'USDJPY', bid: 163.05, ask: 163.051 }],
      })
      .mockResolvedValueOnce({
        symbols: [{ symbol: 'USDJPY', trading_enabled: true }],
      });
    localStorage.setItem('auth_token', 'instrument-account-a-token');
    localStorage.setItem('refresh_token', 'instrument-account-a-refresh');
    useAppStore.setState({
      accountId: 'instrument-account-a',
      authToken: 'instrument-account-a-token',
      refreshToken: 'instrument-account-a-refresh',
    });

    const { result, unmount } = renderHook(() => useMarketInstruments());
    await flushPromises();

    expect(apiGet.mock.calls[0]).toEqual([
      '/api/v1/market/symbols',
      expect.objectContaining({
        skipAuth: true,
        skipDynamicUrl: true,
      }),
    ]);

    localStorage.setItem('auth_token', 'instrument-account-b-token');
    localStorage.setItem('refresh_token', 'instrument-account-b-refresh');
    act(() => {
      useAppStore.setState({
        accountId: 'instrument-account-b',
        authToken: 'instrument-account-b-token',
        refreshToken: 'instrument-account-b-refresh',
      });
    });
    await flushPromises();

    expect(apiGet.mock.calls[0]?.[1].signal.aborted).toBe(true);
    expect(apiGet.mock.calls[1]?.[1].signal.aborted).toBe(true);
    expect(apiGet.mock.calls[2]).toEqual([
      '/api/v1/market/symbols',
      expect.objectContaining({ skipAuth: true, skipDynamicUrl: true }),
    ]);
    expect(apiGet.mock.calls[3]?.[1]).toEqual(expect.objectContaining({
      authToken: 'instrument-account-b-token',
      requestContext: expect.objectContaining({
        refreshToken: 'instrument-account-b-refresh',
      }),
    }));
    expect(result.current.symbols.map((item) => item.symbol)).toEqual(['USDJPY']);

    await act(async () => {
      resolveFirstAccount?.({
        symbols: [{ symbol: 'EURUSD', bid: 1.1, ask: 1.2 }],
      });
      resolveFirstAuthorization?.({
        symbols: [{ symbol: 'EURUSD', trading_enabled: true }],
      });
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(result.current.symbols.map((item) => item.symbol)).toEqual(['USDJPY']);
    expect(result.current.authorizedSymbols).toEqual(['USDJPY']);
    unmount();
  });
});

describe('active market symbol status cache', () => {
  beforeEach(() => {
    localStorage.clear();
    apiGet.mockReset();
    apiPut.mockReset();
    enqueueSnapshotTick.mockReset();
    useQuoteSubscriptionMock.mockReset();
    useQuoteSubscriptionMock.mockReturnValue({ isConnected: true });
    useAppStore.setState({ isAuthenticated: true, ticks: {}, tickLookup: {} });
    useMarketDataStore.getState().clearAllData();
  });

  afterEach(() => {
    useAppStore.setState({ isAuthenticated: false, ticks: {}, tickLookup: {} });
    useMarketDataStore.getState().clearAllData();
  });

  it('extracts active symbols from per-symbol feed status rows', () => {
    const active = extractActiveMarketSymbols({
      symbol_status: [
        { symbol: 'eurusd', has_data: true, silent: false },
        { symbol: 'xauusd', has_data: true, silent: true },
        { symbol: 'gbpusd', has_data: false, silent: false },
        { symbol: 'btcusd', has_data: true, silent: false },
      ],
      available_symbols: ['EURUSD', 'XAUUSD', 'GBPUSD', 'BTCUSD'],
      silent_symbols: ['XAUUSD'],
    });

    expect(active).toEqual(['EURUSD', 'BTCUSD']);
  });

  it('keeps only fresh feed rows when tick age is present', () => {
    const active = extractActiveMarketSymbols({
      symbol_status: [
        { symbol: 'EURUSD', has_data: true, last_tick_age_sec: 25 },
        { symbol: 'XAUUSD', has_data: true, last_tick_age_sec: 90 },
        { symbol: 'BTCUSD', has_data: true, last_tick_age_sec: 91 },
        { symbol: 'US30', has_data: false, last_tick_age_sec: 5 },
        { symbol: 'US500', has_data: true, last_tick_age_sec: -1 },
      ],
    });

    expect(active).toEqual(['EURUSD', 'XAUUSD']);
  });

  it('normalizes status timestamps supplied in Unix seconds or milliseconds', () => {
    const now = Date.now();
    const active = extractActiveMarketSymbols({
      symbol_status: [
        { symbol: 'EURUSD', has_data: true, timestamp: Math.floor((now - 30_000) / 1000), bid: 1.1 },
        { symbol: 'XAUUSD', has_data: true, timestamp: now - 30_000, bid: 2400 },
        { symbol: 'BTCUSD', has_data: true, timestamp: Math.floor((now - 301_000) / 1000), bid: 65000 },
        { symbol: 'SOLUSD', has_data: true, timestamp: now - 301_000, bid: 180 },
      ],
    });

    expect(active).toEqual(['EURUSD', 'XAUUSD']);
  });

  it('does not fall back to available symbols when every authoritative row is stale', () => {
    const response = {
      symbol_status: [
        { symbol: '0001.HK', has_data: true, quote_status: 'stale', bid: 71.11, ask: 71.16 },
        { symbol: '0002.HK', has_data: true, is_stale: true, bid: 77.29, ask: 77.34 },
      ],
      available_symbols: ['0001.HK', '0002.HK'],
      silent_symbols: [],
    };

    expect(hasAuthoritativeMarketSymbolStatus(response)).toBe(true);
    expect(extractActiveMarketSymbols(response)).toEqual([]);
  });

  it('keeps authoritative stale status in control even when the app store has a recent tick', async () => {
    useAppStore.getState().setTick('0001.HK', {
      symbol: '0001.HK',
      bid: 71.11,
      ask: 71.16,
      spread: 0.05,
      timestamp: Date.now(),
    });
    apiGet.mockResolvedValueOnce({
      symbol_status: [
        { symbol: '0001.HK', quote_status: 'stale', bid: 71.11, ask: 71.16 },
      ],
    });

    const { result, unmount } = renderHook(() => useActiveMarketSymbols());
    await flushPromises();

    expect(result.current.symbols).toEqual([]);
    unmount();
  });

  it('accepts symbol rows with explicit live quote values', () => {
    const active = extractActiveMarketSymbols({
      symbol_status: [
        { symbol: 'BTCUSD', has_quote: true, bid: 65000, ask: 65012 },
        { symbol: 'XAUUSD', has_quote: true, bid: 0, ask: 4362 },
        { symbol: 'AEX', has_quote: false, bid: 0, ask: 0 },
        { symbol: 'DE30', time: 0, bid: 0, ask: 0 },
      ],
    });

    expect(active).toEqual(['BTCUSD', 'XAUUSD']);
  });

  it('falls back to available minus silent symbols when row status is not present', () => {
    const active = extractActiveMarketSymbols({
      available_symbols: ['EURUSD', 'XAUUSD', 'BTCUSD'],
      silent_symbols: ['XAUUSD'],
    });

    expect(active).toEqual(['EURUSD', 'BTCUSD']);
  });

  it('does not treat an unqualified available-symbol list as live market data', () => {
    const active = extractActiveMarketSymbols({
      available_symbols: ['EURUSD', 'XAUUSD', 'BTCUSD'],
      upstream_connected: true,
    });

    expect(active).toEqual([]);
  });

  it('reads normalized cached active symbols from broker-scoped local storage', () => {
    const key = getActiveMarketSymbolsStorageKey('gta_broker');
    expect(key).toBe(`${ACTIVE_MARKET_SYMBOLS_STORAGE_KEY_PREFIX}:gta_broker`);

    localStorage.setItem(key, JSON.stringify({
      symbols: ['eurusd', 'EURUSD', 'xauusd'],
      updatedAt: 1710000000000,
    }));

    expect(readCachedActiveMarketSymbols('gta_broker')).toEqual({
      symbols: ['EURUSD', 'XAUUSD'],
      updatedAt: 1710000000000,
      availableCount: undefined,
      silentCount: undefined,
    });
  });

  it('loads active feed symbols from the runtime API root without auth or dynamic URL rewrite', async () => {
    apiGet.mockResolvedValueOnce({
      symbol_status: [
        { symbol: 'EURUSD', has_data: true, silent: false },
        { symbol: 'XAUUSD', has_data: true, silent: true },
      ],
      available_symbols: ['EURUSD', 'XAUUSD'],
      silent_symbols: ['XAUUSD'],
    });

    const { result, unmount } = renderHook(() => useActiveMarketSymbols());
    expect(result.current.settled).toBe(false);
    expect(result.current.current).toBe(false);
    await flushPromises();

    expect(apiGet).toHaveBeenCalledWith('/ws/feed/status', expect.objectContaining({
      skipAuth: true,
      skipDynamicUrl: true,
    }));
    expect(result.current.settled).toBe(true);
    expect(result.current.current).toBe(true);
    expect(result.current.symbols).toEqual(['EURUSD']);

    unmount();
  });

  it('loads authoritative feed freshness before login without attaching a stored account token', async () => {
    useAppStore.setState({ isAuthenticated: false, accountId: null, authToken: null, refreshToken: null });
    localStorage.setItem('auth_token', 'stale-guest-account-token');
    apiGet.mockResolvedValueOnce({
      symbol_status: [
        { symbol: 'BTCUSD', has_data: true, last_tick_age_sec: 0, fresh: true, stale: false, silent: false },
        { symbol: 'EURUSD', has_data: true, last_tick_age_sec: 1, fresh: true, stale: false, silent: false },
        { symbol: '1U1D.DE', has_data: true, last_tick_age_sec: 591, fresh: false, stale: true, silent: true },
      ],
      available_symbols: ['BTCUSD', 'EURUSD', '1U1D.DE'],
      silent_symbols: ['1U1D.DE'],
    });

    const { result, unmount } = renderHook(() => useActiveMarketSymbols());
    await flushPromises();

    expect(apiGet).toHaveBeenCalledTimes(1);
    expect(apiGet).toHaveBeenCalledWith('/ws/feed/status', expect.objectContaining({
      skipAuth: true,
      skipDynamicUrl: true,
    }));
    expect(apiGet.mock.calls[0][1].authToken).toBeUndefined();
    expect(result.current).toMatchObject({
      current: true,
      settled: true,
      loading: false,
      error: null,
      symbols: ['BTCUSD', 'EURUSD'],
    });
    expect(apiPut).not.toHaveBeenCalled();
    unmount();
    localStorage.removeItem('auth_token');
  });

  it('keeps cached symbols for display but marks them non-current after status failure', async () => {
    localStorage.setItem(getActiveMarketSymbolsStorageKey(), JSON.stringify({
      symbols: ['EURUSD', 'XAUUSD'],
      updatedAt: Date.now(),
    }));
    apiGet.mockRejectedValueOnce(new ApiError(503, 'Feed status unavailable'));

    const { result, unmount } = renderHook(() => useActiveMarketSymbols());
    await flushPromises();

    expect(result.current.symbols).toEqual(['EURUSD', 'XAUUSD']);
    expect(result.current.settled).toBe(true);
    expect(result.current.current).toBe(false);
    expect(result.current.error).toBe('Feed status unavailable');

    unmount();
  });

  it('removes 0001.HK and clears its cache on an authoritative stale response', async () => {
    const storageKey = getActiveMarketSymbolsStorageKey();
    localStorage.setItem(storageKey, JSON.stringify({
      symbols: ['0001.HK', '0002.HK'],
      updatedAt: 1710000000000,
    }));
    apiGet.mockResolvedValueOnce({
      symbol_status: [
        { symbol: '0001.HK', has_data: true, stale: true, bid: 71.11, ask: 71.16 },
        { symbol: '0002.HK', has_data: true, has_quote: false },
      ],
      available_symbols: ['0001.HK', '0002.HK'],
      silent_symbols: [],
    });

    const { result, unmount } = renderHook(() => useActiveMarketSymbols());
    expect(result.current.symbols).toEqual([]);
    await flushPromises();

    expect(result.current.symbols).toEqual([]);
    expect(result.current.error).toBeNull();
    expect(readCachedActiveMarketSymbols()).toEqual(expect.objectContaining({ symbols: [] }));

    unmount();
  });

  it('parses the exact stale quote error without removing unrelated batch symbols', () => {
    const failure = getStaleQuoteFailure(
      new ApiError(409, 'Quote is stale for 0001.HK', {
        symbols: ['0001.HK', '0002.HK'],
      }),
      ['0001.HK', '0002.HK'],
    );

    expect(failure).toEqual({ isStale: true, symbols: ['0001.HK'] });
    expect(getStaleQuoteFailure(
      new ApiError(503, 'Quote service is unavailable'),
      ['0001.HK'],
    )).toEqual({ isStale: false, symbols: [] });
  });

  it('does not remove a shorter leading-zero symbol contained in the stale symbol', () => {
    expect(getStaleQuoteFailure(
      new ApiError(409, 'Quote is stale for 0001.HK'),
      ['001.HK', '0001.HK'],
    )).toEqual({ isStale: true, symbols: ['0001.HK'] });
  });

  it('does not remove an unsuffixed symbol when the suffixed symbol is stale', () => {
    expect(getStaleQuoteFailure(
      new ApiError(409, 'Quote is stale for eurusd.r'),
      ['EURUSD', 'EURUSD.r'],
    )).toEqual({ isStale: true, symbols: ['EURUSD.R'] });
  });

  it('removes a quote-stale symbol immediately, refreshes status, and allows it back once fresh', async () => {
    let resolveStaleStatus: ((value: unknown) => void) | undefined;
    const staleStatus = new Promise<unknown>((resolve) => {
      resolveStaleStatus = resolve;
    });

    apiGet
      .mockResolvedValueOnce({
        symbol_status: [
          { symbol: '0001.HK', has_quote: true, bid: 71.11, ask: 71.16 },
          { symbol: '0002.HK', has_quote: true, bid: 77.29, ask: 77.34 },
        ],
      })
      .mockRejectedValueOnce(new ApiError(409, 'Quote is stale for 0001.HK'))
      .mockImplementationOnce(() => staleStatus);

    const { result, unmount } = renderHook(() => ({
      active: useActiveMarketSymbols(),
      quotes: useLiveQuotes(['0001.HK', '0002.HK']),
    }));
    await flushPromises();

    expect(result.current.active.symbols).toEqual(['0002.HK']);
    expect(readCachedActiveMarketSymbols().symbols).toEqual(['0002.HK']);
    expect(apiGet).toHaveBeenCalledTimes(3);

    await act(async () => {
      resolveStaleStatus?.({
        symbol_status: [
          { symbol: '0001.HK', quote_status: 'stale', bid: 71.11, ask: 71.16 },
          { symbol: '0002.HK', has_quote: true, bid: 77.29, ask: 77.34 },
        ],
      });
      await staleStatus;
    });
    expect(result.current.active.symbols).toEqual(['0002.HK']);

    apiGet.mockResolvedValueOnce({
      symbol_status: [
        { symbol: '0001.HK', fresh: true, bid: 71.12, ask: 71.17 },
        { symbol: '0002.HK', fresh: true, bid: 77.3, ask: 77.35 },
      ],
    });
    await act(async () => {
      await result.current.active.reload();
    });

    expect(result.current.active.symbols).toEqual(['0001.HK', '0002.HK']);
    unmount();
  });

  it('keeps a stale quote failure through symbol eviction and clears it only after that symbol recovers', async () => {
    let statusMode: 'initial' | 'evicted' | 'recovered' = 'initial';
    let quoteRequestCount = 0;

    apiGet.mockImplementation((endpoint: string, options?: { params?: { symbols?: string } }) => {
      if (endpoint === '/ws/feed/status') {
        const symbols = statusMode === 'evicted'
          ? ['0002.HK']
          : ['0001.HK', '0002.HK'];
        return Promise.resolve({
          symbol_status: symbols.map((symbol) => ({
            symbol,
            fresh: true,
            bid: symbol === '0001.HK' ? 71.12 : 77.3,
            ask: symbol === '0001.HK' ? 71.17 : 77.35,
          })),
        });
      }

      if (endpoint === '/quotes') {
        quoteRequestCount += 1;
        if (quoteRequestCount === 1) {
          statusMode = 'evicted';
          return Promise.reject(new ApiError(409, 'Quote is stale for 0001.HK'));
        }

        const requestedSymbols = options?.params?.symbols?.split(',') ?? [];
        return Promise.resolve({
          quotes: requestedSymbols.map((symbol) => ({
            symbol,
            bid: symbol === '0001.HK' ? 71.12 : 77.3,
            ask: symbol === '0001.HK' ? 71.17 : 77.35,
            timestamp: Date.now(),
          })),
        });
      }

      return Promise.reject(new Error(`Unexpected endpoint: ${endpoint}`));
    });

    const { result, unmount } = renderHook(() => {
      const active = useActiveMarketSymbols();
      const quotes = useLiveQuotes(active.symbols);
      return { active, quotes };
    });

    await waitFor(() => {
      expect(result.current.active.symbols).toEqual(['0002.HK']);
      expect(result.current.quotes.error).toBe('Quote is stale for 0001.HK');
    });
    expect(quoteRequestCount).toBeGreaterThanOrEqual(2);

    statusMode = 'recovered';
    await act(async () => {
      await result.current.active.reload();
    });

    await waitFor(() => {
      expect(result.current.active.symbols).toEqual(['0001.HK', '0002.HK']);
      expect(result.current.quotes.error).toBeNull();
    });

    unmount();
  });

  it('does not clear a failed-symbol stale error when only an unrelated websocket tick is fresh', async () => {
    apiGet.mockRejectedValueOnce(new ApiError(409, 'Quote is stale for XAUUSD'));

    const { result, unmount } = renderHook(() => useLiveQuotes(['EURUSD', 'XAUUSD']));
    await waitFor(() => {
      expect(result.current.error).toBe('Quote is stale for XAUUSD');
    });

    act(() => {
      useMarketDataStore.setState((state) => ({
        symbolData: {
          ...state.symbolData,
          EURUSD: {
            ...state.symbolData.EURUSD,
            currentTick: {
              symbol: 'EURUSD',
              bid: 1.14,
              ask: 1.1401,
              spread: 0.0001,
              timestamp: Date.now(),
            },
          },
        },
      }));
    });
    expect(result.current.error).toBe('Quote is stale for XAUUSD');

    act(() => {
      useMarketDataStore.setState((state) => ({
        symbolData: {
          ...state.symbolData,
          XAUUSD: {
            ...state.symbolData.XAUUSD,
            currentTick: {
              symbol: 'XAUUSD',
              bid: 4116.8,
              ask: 4117.1,
              spread: 0.3,
              timestamp: Date.now(),
              sourceTimestamp: Date.now(),
            },
          },
        },
      }));
    });
    await waitFor(() => {
      expect(result.current.error).toBeNull();
    });

    unmount();
  });

  it('requires an explicit strictly newer websocket source timestamp to clear a stale error', async () => {
    const failureTimestamp = Date.now() - 10_000;
    const newerTimestamp = failureTimestamp + 1_000;

    useMarketDataStore.setState((state) => ({
      symbolData: {
        ...state.symbolData,
        XAUUSD: {
          ...state.symbolData.XAUUSD,
          currentTick: {
            symbol: 'XAUUSD',
            bid: 4116.8,
            ask: 4117.1,
            spread: 0.3,
            timestamp: failureTimestamp,
            sourceTimestamp: failureTimestamp,
          },
        },
      },
    }));
    apiGet.mockRejectedValueOnce(new ApiError(409, 'Quote is stale for XAUUSD'));

    const { result, unmount } = renderHook(() => useLiveQuotes(['XAUUSD']));
    await waitFor(() => {
      expect(result.current.error).toBe('Quote is stale for XAUUSD');
    });

    const setWebSocketTick = (timestamp: number, sourceTimestamp?: number) => {
      act(() => {
        useMarketDataStore.setState((state) => ({
          symbolData: {
            ...state.symbolData,
            XAUUSD: {
              ...state.symbolData.XAUUSD,
              currentTick: {
                symbol: 'XAUUSD',
                bid: 4117,
                ask: 4117.3,
                spread: 0.3,
                timestamp,
                sourceTimestamp,
              },
            },
          },
        }));
      });
    };

    setWebSocketTick(Date.now());
    expect(result.current.error).toBe('Quote is stale for XAUUSD');

    setWebSocketTick(Date.now(), failureTimestamp - 1);
    expect(result.current.error).toBe('Quote is stale for XAUUSD');

    setWebSocketTick(Date.now(), failureTimestamp);
    expect(result.current.error).toBe('Quote is stale for XAUUSD');

    setWebSocketTick(Date.now(), newerTimestamp);
    await waitFor(() => {
      expect(result.current.error).toBeNull();
    });

    unmount();
  });

  it('requires newer source timestamps for every failed symbol before REST clears a stale error', async () => {
    const failureTimestamp = Date.now() - 10_000;
    const olderTimestamp = failureTimestamp - 1_000;
    const newerTimestamp = failureTimestamp + 1_000;

    useMarketDataStore.setState((state) => ({
      symbolData: {
        ...state.symbolData,
        EURUSD: {
          ...state.symbolData.EURUSD,
          currentTick: {
            symbol: 'EURUSD',
            bid: 1.14,
            ask: 1.1401,
            spread: 0.0001,
            timestamp: failureTimestamp,
          },
        },
        XAUUSD: {
          ...state.symbolData.XAUUSD,
          currentTick: {
            symbol: 'XAUUSD',
            bid: 4116.8,
            ask: 4117.1,
            spread: 0.3,
            timestamp: failureTimestamp,
          },
        },
      },
    }));

    apiGet
      .mockRejectedValueOnce(new ApiError(409, 'Quote is stale for EURUSD and XAUUSD'))
      .mockResolvedValueOnce({
        quotes: [
          { symbol: 'EURUSD', bid: 1.1402, ask: 1.1403, timestamp: olderTimestamp },
          { symbol: 'XAUUSD', bid: 4117.2, ask: 4117.5, timestamp: olderTimestamp },
        ],
      })
      .mockResolvedValueOnce({
        quotes: [
          { symbol: 'EURUSD', bid: 1.1403, ask: 1.1404, timestamp: failureTimestamp },
          { symbol: 'XAUUSD', bid: 4117.3, ask: 4117.6, timestamp: failureTimestamp },
        ],
      })
      .mockResolvedValueOnce({
        quotes: [
          { symbol: 'EURUSD', bid: 1.1404, ask: 1.1405 },
          { symbol: 'XAUUSD', bid: 4117.4, ask: 4117.7 },
        ],
      })
      .mockResolvedValueOnce({
        quotes: [
          { symbol: 'EURUSD', bid: 1.1405, ask: 1.1406, timestamp: newerTimestamp },
          { symbol: 'XAUUSD', bid: 4117.5, ask: 4117.8, timestamp: newerTimestamp },
        ],
      });

    const { result, rerender, unmount } = renderHook(
      ({ symbols }: { symbols: string[] }) => useLiveQuotes(symbols),
      { initialProps: { symbols: ['EURUSD', 'XAUUSD'] } },
    );
    await waitFor(() => {
      expect(result.current.error).toBe('Quote is stale for EURUSD and XAUUSD');
    });

    rerender({ symbols: ['EURUSD', 'XAUUSD', 'GBPUSD'] });
    await waitFor(() => expect(apiGet).toHaveBeenCalledTimes(2));
    expect(result.current.error).toBe('Quote is stale for EURUSD and XAUUSD');

    rerender({ symbols: ['EURUSD', 'XAUUSD', 'SOLUSD'] });
    await waitFor(() => expect(apiGet).toHaveBeenCalledTimes(3));
    expect(result.current.error).toBe('Quote is stale for EURUSD and XAUUSD');

    rerender({ symbols: ['EURUSD', 'XAUUSD', 'BTCUSD'] });
    await waitFor(() => expect(apiGet).toHaveBeenCalledTimes(4));
    expect(result.current.error).toBe('Quote is stale for EURUSD and XAUUSD');
    expect(enqueueSnapshotTick).toHaveBeenNthCalledWith(5, 'EURUSD', expect.objectContaining({
      timestamp: failureTimestamp,
    }));
    expect(enqueueSnapshotTick).toHaveBeenNthCalledWith(6, 'XAUUSD', expect.objectContaining({
      timestamp: failureTimestamp,
    }));

    rerender({ symbols: ['EURUSD', 'XAUUSD', 'GBPUSD', 'SOLUSD'] });
    await waitFor(() => {
      expect(apiGet).toHaveBeenCalledTimes(5);
      expect(result.current.error).toBeNull();
    });

    unmount();
  });

  it('preserves a stale error when its symbol leaves scope and clears it on logout', async () => {
    apiGet.mockRejectedValueOnce(new ApiError(409, 'Quote is stale for XAUUSD'));

    const { result, rerender, unmount } = renderHook(
      ({ symbols }: { symbols: string[] }) => useLiveQuotes(symbols),
      { initialProps: { symbols: ['EURUSD', 'XAUUSD'] } },
    );
    await waitFor(() => {
      expect(result.current.error).toBe('Quote is stale for XAUUSD');
    });

    rerender({ symbols: ['EURUSD'] });
    expect(result.current.error).toBe('Quote is stale for XAUUSD');

    act(() => {
      useAppStore.setState({ isAuthenticated: false });
    });
    await waitFor(() => {
      expect(result.current.error).toBeNull();
    });

    unmount();
  });

  it('ignores a stale response from a cancelled quote request', async () => {
    let rejectOlderRequest: ((reason: unknown) => void) | undefined;
    const olderRequest = new Promise<unknown>((_resolve, reject) => {
      rejectOlderRequest = reject;
    });
    apiGet
      .mockImplementationOnce(() => olderRequest)
      .mockResolvedValueOnce({ quotes: [] });

    const { result, rerender, unmount } = renderHook(
      ({ symbols }: { symbols: string[] }) => useLiveQuotes(symbols),
      { initialProps: { symbols: ['XAUUSD'] } },
    );
    await act(async () => {
      await Promise.resolve();
    });

    rerender({ symbols: ['EURUSD'] });
    await flushPromises();

    await act(async () => {
      rejectOlderRequest?.(new ApiError(409, 'Quote is stale for XAUUSD'));
      try {
        await olderRequest;
      } catch {
        // The hook owns this rejection; the assertion below verifies cleanup.
      }
    });

    expect(result.current.error).toBeNull();
    unmount();
  });

  it('ignores an older status response that resolves after a newer reload', async () => {
    let resolveOlder: ((value: unknown) => void) | undefined;
    let resolveNewer: ((value: unknown) => void) | undefined;
    const older = new Promise<unknown>((resolve) => {
      resolveOlder = resolve;
    });
    const newer = new Promise<unknown>((resolve) => {
      resolveNewer = resolve;
    });
    apiGet
      .mockImplementationOnce(() => older)
      .mockImplementationOnce(() => newer);

    const { result, unmount } = renderHook(() => useActiveMarketSymbols());
    await act(async () => {
      void result.current.reload();
      await Promise.resolve();
    });

    await act(async () => {
      resolveNewer?.({
        symbol_status: [{ symbol: '0002.HK', fresh: true, bid: 77.3, ask: 77.35 }],
      });
      await newer;
    });
    expect(result.current.symbols).toEqual(['0002.HK']);

    await act(async () => {
      resolveOlder?.({
        symbol_status: [{ symbol: '0001.HK', fresh: true, bid: 71.12, ask: 71.17 }],
      });
      await older;
    });
    expect(result.current.symbols).toEqual(['0002.HK']);
    unmount();
  });
});

describe('account spread markup from the authenticated catalogue', () => {
  beforeEach(() => {
    apiGet.mockReset();
    enqueueSnapshotTick.mockReset();
    useQuoteSubscriptionMock.mockReset();
    resetAccountSpreadMarkupForTests();
    localStorage.setItem('auth_token', 'markup-test-token');
    localStorage.setItem('refresh_token', 'markup-test-refresh');
    useAppStore.setState({
      isAuthenticated: true,
      accountId: 'markup-test-account',
      authToken: 'markup-test-token',
      refreshToken: 'markup-test-refresh',
      ticks: {},
      tickLookup: {},
    });
  });

  afterEach(() => {
    resetAccountSpreadMarkupForTests();
    useAppStore.setState({
      isAuthenticated: false,
      accountId: null,
      authToken: null,
      refreshToken: null,
      ticks: {},
      tickLookup: {},
    });
    localStorage.removeItem('auth_token');
    localStorage.removeItem('refresh_token');
  });

  it('publishes the account markup before seeding quotes, with public tick size fallback', async () => {
    apiGet.mockResolvedValueOnce({
      symbols: [
        { symbol: 'XAUUSD', bid: 4425.9, ask: 4426.05, digits: 2, tick_size: 0.01 },
        { symbol: 'EURUSD', bid: 1.1, ask: 1.10012, digits: 5, spread_markup: 9 },
      ],
    }).mockResolvedValueOnce({
      symbols: [
        { symbol: 'XAUUSD', trading_enabled: true, spread_markup: 5 },
        { symbol: 'EURUSD', trading_enabled: true },
      ],
    });
    let markupAtSeed: unknown = 'not-seeded';
    enqueueSnapshotTick.mockImplementation((symbol: string) => {
      if (symbol === 'XAUUSD') markupAtSeed = getAccountSpreadMarkup('XAUUSD');
    });

    const { result, unmount } = renderHook(() => useMarketInstruments());
    await flushPromises();

    expect(result.current.authorizedInstruments).toEqual(expect.arrayContaining([
      expect.objectContaining({ symbol: 'XAUUSD', spreadMarkup: 5 }),
    ]));
    expect(getAccountSpreadMarkup('XAUUSD')).toEqual({ points: 5, tickSize: 0.01, digits: 2 });
    expect(markupAtSeed).toEqual({ points: 5, tickSize: 0.01, digits: 2 });
    // The public catalogue can never contribute markup to an account.
    expect(getAccountSpreadMarkup('EURUSD')).toBeUndefined();
    unmount();
  });

  it('never carries markup into guest mode', async () => {
    useAppStore.setState({ isAuthenticated: false, accountId: null, authToken: null, refreshToken: null });
    apiGet.mockResolvedValueOnce({
      symbols: [{ symbol: 'XAUUSD', bid: 4425.9, ask: 4426.05, digits: 2, spread_markup: 5 }],
    });

    const { unmount } = renderHook(() => useMarketInstruments());
    await flushPromises();

    expect(getAccountSpreadMarkupMap().size).toBe(0);
    unmount();
  });

  it('widens depth-of-market levels like the top-of-book quote', () => {
    const map = new Map([['EURUSD', { points: 5, tickSize: 0.00001, digits: 5 }]]);
    const book = {
      symbol: 'EURUSD',
      bids: [{ price: 1.1, volume: 1, total: 1 }],
      asks: [{ price: 1.10012, volume: 1, total: 1 }],
      spread: 0.00012,
      spreadPips: 1.2,
      timestamp: 1,
    };
    const widened = applySpreadMarkupToOrderBook(book, map);
    expect(widened?.bids[0].price).toBe(1.09995);
    expect(widened?.asks[0].price).toBe(1.10017);
    expect(widened?.spread).toBe(0.00022);
    expect(applySpreadMarkupToOrderBook(book, new Map())).toBe(book);
  });
});
