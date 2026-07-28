import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

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
  LIVE_QUOTES_REST_POLL_INTERVAL_MS,
  normalizeInstrumentEnabled,
  readCachedActiveMarketSymbols,
  useActiveMarketSymbols,
  useMarketInstruments,
  useLiveQuotes,
  useRemoteWatchlistSync,
} from './useLiveMarketData';

const apiGet = vi.hoisted(() => vi.fn());
const apiPut = vi.hoisted(() => vi.fn());
const enqueueLiveTick = vi.hoisted(() => vi.fn());
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
  enqueueLiveTick,
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
  beforeEach(() => {
    vi.useFakeTimers();
    apiGet.mockReset();
    apiPut.mockReset();
    apiPut.mockResolvedValue([]);
    localStorage.setItem('broker_id', `watchlist-test-${crypto.randomUUID()}`);
    localStorage.setItem('auth_token', 'watchlist-test-token');
    setMajorWatchlistSymbols(['EURUSD']);
  });

  afterEach(() => {
    useAppStore.setState({ isAuthenticated: false, accountId: null });
    localStorage.removeItem('auth_token');
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
    enqueueLiveTick.mockReset();
    useQuoteSubscriptionMock.mockReset();
    apiGet.mockResolvedValue({ quotes: [] });
    useQuoteSubscriptionMock.mockReturnValue({ isConnected: true });
    useAppStore.setState({ isAuthenticated: true, ticks: {}, tickLookup: {} });
  });

  afterEach(() => {
    useAppStore.setState({ isAuthenticated: false, ticks: {}, tickLookup: {} });
    vi.useRealTimers();
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

  it('polls one REST batch per interval while leaving websocket demand on all symbols', async () => {
    const symbols = Array.from({ length: LIVE_QUOTES_REST_BATCH_SIZE + 3 }, (_, index) => `S${index}`);

    const { unmount } = renderHook(() => useLiveQuotes(symbols));
    await flushPromises();

    expect(useQuoteSubscriptionMock).toHaveBeenCalledWith(symbols, 'live-quotes');
    expect(apiGet).toHaveBeenCalledTimes(1);
    expect(apiGet.mock.calls[0][1]?.params?.symbols.split(',')).toEqual(
      symbols.slice(0, LIVE_QUOTES_REST_BATCH_SIZE)
    );

    await act(async () => {
      vi.advanceTimersByTime(LIVE_QUOTES_REST_POLL_INTERVAL_MS);
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(apiGet).toHaveBeenCalledTimes(2);
    expect(apiGet.mock.calls[1][1]?.params?.symbols.split(',')).toEqual(
      symbols.slice(LIVE_QUOTES_REST_BATCH_SIZE)
    );

    unmount();
  });
});

describe('useMarketInstruments normalization', () => {
  beforeEach(() => {
    apiGet.mockReset();
    apiPut.mockReset();
    enqueueLiveTick.mockReset();
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

  it('filters explicitly disabled instruments and enqueues REST bid/ask snapshots', async () => {
    apiGet.mockResolvedValueOnce({
      symbols: [
        { symbol: 'EURUSD', bid: '1.10101', ask: '1.10123', trading_enabled: true, digits: 5 },
        { symbol: 'GBPUSD', bid: 1.26789, ask: 1.26801 },
        { symbol: 'XAUUSD', bid: 2345.1, ask: 2345.6, status: 'disabled' },
      ],
    });

    const { result, unmount } = renderHook(() => useMarketInstruments());
    await flushPromises();

    expect(result.current.symbols.map((item) => item.symbol)).toEqual(['EURUSD', 'GBPUSD']);
    expect(result.current.disabledSymbols).toEqual(['XAUUSD']);
    expect(enqueueLiveTick).toHaveBeenCalledTimes(2);
    expect(enqueueLiveTick).toHaveBeenCalledWith('EURUSD', expect.objectContaining({
      symbol: 'EURUSD',
      bid: 1.10101,
      ask: 1.10123,
      spread: expect.any(Number),
      digits: 5,
    }));
    expect(enqueueLiveTick).toHaveBeenCalledWith('GBPUSD', expect.objectContaining({
      symbol: 'GBPUSD',
      bid: 1.26789,
      ask: 1.26801,
    }));

    unmount();
  });

  it('captures the switched account session and ignores the previous account response', async () => {
    let resolveFirstAccount: ((value: unknown) => void) | undefined;
    apiGet
      .mockImplementationOnce(() => new Promise((resolve) => {
        resolveFirstAccount = resolve;
      }))
      .mockResolvedValueOnce({
        symbols: [{ symbol: 'USDJPY', bid: 163.05, ask: 163.051 }],
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

    expect(apiGet.mock.calls[0]?.[1]).toEqual(expect.objectContaining({
      authToken: 'instrument-account-a-token',
      requestContext: expect.objectContaining({
        refreshToken: 'instrument-account-a-refresh',
      }),
    }));

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

    expect(apiGet.mock.calls[1]?.[1]).toEqual(expect.objectContaining({
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
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(result.current.symbols.map((item) => item.symbol)).toEqual(['USDJPY']);
    unmount();
  });
});

describe('active market symbol status cache', () => {
  beforeEach(() => {
    localStorage.clear();
    apiGet.mockReset();
    apiPut.mockReset();
    enqueueLiveTick.mockReset();
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
    expect(enqueueLiveTick).toHaveBeenNthCalledWith(5, 'EURUSD', expect.objectContaining({
      timestamp: failureTimestamp,
    }));
    expect(enqueueLiveTick).toHaveBeenNthCalledWith(6, 'XAUUSD', expect.objectContaining({
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
