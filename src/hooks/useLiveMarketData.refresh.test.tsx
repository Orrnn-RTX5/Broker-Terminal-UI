import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useAppStore } from '../store/useAppStore';
import {
  getMarketSymbolFreshness,
  MARKET_SYMBOLS_REFRESH_REQUESTED_EVENT,
  requestMarketSymbolsRefresh,
  useActiveMarketSymbols,
  useMarketInstruments,
} from './useLiveMarketData';

const apiGet = vi.hoisted(() => vi.fn());
vi.mock('../api/client', () => {
  class ApiError extends Error {
    constructor(public status: number, message: string, public data?: unknown) {
      super(message);
      this.name = 'ApiError';
    }
  }
  return { ApiError, apiClient: { get: apiGet } };
});
vi.mock('../services/liveTickDispatcher', () => ({ enqueueLiveTick: vi.fn() }));
vi.mock('../services/publicMarketCatalog', () => ({
  loadPublicMarketCatalog: (baseUrl: string, signal: AbortSignal) => apiGet('/api/v1/market/symbols', {
    baseUrl, signal, skipAuth: true, skipDynamicUrl: true,
  }),
}));
vi.mock('../services/authenticatedInstruments', () => ({
  loadSharedAuthenticatedInstruments: (options: unknown) => apiGet('/instruments', options),
}));
vi.mock('./useQuoteSubscription', () => ({ useQuoteSubscription: vi.fn() }));

const flushPromises = async () => {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
};

describe('on-demand feed status refresh', () => {
  beforeEach(() => {
    apiGet.mockReset();
    localStorage.setItem('broker_id', `refresh-test-${crypto.randomUUID()}`);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('refresh event reloads immediately and records per-symbol freshness', async () => {
    apiGet.mockResolvedValue({
      symbol_status: [
        { symbol: 'BTCUSD', has_data: true, fresh: true, stale: false, silent: false, last_tick_age_sec: 0 },
        { symbol: 'EURUSD', has_data: true, fresh: false, stale: true, silent: false, last_tick_age_sec: 42 },
      ],
    });

    const { result, unmount } = renderHook(() => useActiveMarketSymbols());
    await act(async () => { await flushPromises(); });
    expect(apiGet).toHaveBeenCalledTimes(1);
    expect(result.current.symbols).toEqual(['BTCUSD']);
    expect(getMarketSymbolFreshness('BTCUSD')?.fresh).toBe(true);
    expect(getMarketSymbolFreshness('EURUSD')?.ageSec).toBe(42);
    expect(getMarketSymbolFreshness('EURUSD')?.stale).toBe(true);

    await act(async () => {
      window.dispatchEvent(new Event(MARKET_SYMBOLS_REFRESH_REQUESTED_EVENT));
      await flushPromises();
    });
    expect(apiGet).toHaveBeenCalledTimes(2);
    unmount();
  });

  it('requestMarketSymbolsRefresh resolves once the poll settles', async () => {
    let resolveStatus: ((value: unknown) => void) | undefined;
    apiGet.mockImplementation(() => new Promise((resolve) => { resolveStatus = resolve; }));

    const { unmount } = renderHook(() => useActiveMarketSymbols());
    await act(async () => { await flushPromises(); });

    let settled = false;
    const pending = requestMarketSymbolsRefresh().then(() => { settled = true; });
    await act(async () => { await flushPromises(); });
    expect(settled).toBe(false);

    await act(async () => {
      resolveStatus?.({ symbol_status: [] });
      await flushPromises();
    });
    await pending;
    expect(settled).toBe(true);
    unmount();
  });
});

describe('live instrument catalogue updates', () => {
  let revision: string;
  let instruments: Array<Record<string, unknown>>;
  beforeEach(() => {
    vi.useFakeTimers();
    apiGet.mockReset();
    revision = '1';
    instruments = [{ symbol: 'BTCUSD', trading_enabled: true, min_volume: 0.01 }];
    localStorage.setItem('broker_id', `catalogue-${crypto.randomUUID()}`);
    localStorage.setItem('auth_token', 'catalogue-test-token');
    useAppStore.setState({ isAuthenticated: true, accountId: '200001', authToken: 'catalogue-test-token' });
    apiGet.mockImplementation(async (path: string) => {
      if (path === '/api/v1/market/symbols') return { symbols: [{ symbol: 'BTCUSD' }] };
      if (path === '/instruments/revision') return { revision };
      if (path === '/instruments') return { revision, instruments: [...instruments] };
      throw new Error(`Unexpected endpoint ${path}`);
    });
  });
  afterEach(() => {
    vi.useRealTimers();
    localStorage.removeItem('auth_token');
    useAppStore.setState({ isAuthenticated: false, accountId: null, authToken: null });
  });

  // Upstream moved read sharing into loadSharedAuthenticatedInstruments (mocked
  // here, covered by authenticatedInstruments.test.ts), so each mounted consumer
  // issues one transport call per reload and the catalogue must still converge.
  it('coalesces mounted consumers and updates added/disabled instruments in place', async () => {
    const { result, unmount } = renderHook(() => ({ first: useMarketInstruments(), second: useMarketInstruments() }));
    await flushPromises();
    expect(apiGet.mock.calls.filter(([path]) => path === '/instruments')).toHaveLength(2);
    expect(apiGet.mock.calls.find(([path]) => path === '/instruments')?.[1]).toEqual(expect.objectContaining({ params: { include_revision: true } }));
    expect(result.current.first.authorizedSymbols).toEqual(['BTCUSD']);
    revision = '2';
    instruments = [
      { symbol: 'BTCUSD', trading_enabled: false },
      { symbol: 'SOLUSD', trading_enabled: true, min_volume: 0.1, volume_step: 0.1 },
    ];
    act(() => window.dispatchEvent(new CustomEvent('rtx:instrument-catalogue-changed', { detail: { revision } })));
    await flushPromises();
    expect(result.current.first.authorizedSymbols).toEqual(['SOLUSD']);
    expect(result.current.second.authorizedSymbols).toEqual(['SOLUSD']);
    expect(result.current.first.disabledSymbols).toEqual(['BTCUSD']);
    expect(result.current.first.symbols.map(row => row.symbol)).toEqual(['BTCUSD', 'SOLUSD']);
    expect(result.current.first.authorizedInstruments[1].minVolume).toBe(0.1);
    expect(apiGet.mock.calls.filter(([path]) => path === '/instruments')).toHaveLength(4);
    unmount();
  });

  it('recovers a missed notification at the five-second revision check', async () => {
    const { result, unmount } = renderHook(() => useMarketInstruments());
    await flushPromises();
    revision = '9007199254740993';
    instruments.push({ symbol: 'ETHUSD', trading_enabled: true });
    await act(async () => { await vi.advanceTimersByTimeAsync(5000); });
    expect(result.current.authorizedSymbols).toEqual(['BTCUSD', 'ETHUSD']);
    const reads = apiGet.mock.calls.filter(([path]) => path === '/instruments').length;
    await act(async () => { await vi.advanceTimersByTimeAsync(5000); });
    expect(apiGet.mock.calls.filter(([path]) => path === '/instruments')).toHaveLength(reads);
    unmount();
  });

  it('revokes stale authorization on revision failure and automatically recovers', async () => {
    const original = apiGet.getMockImplementation()!;
    const { result, unmount } = renderHook(() => useMarketInstruments());
    await flushPromises();
    apiGet.mockImplementation((path: string, ...args: unknown[]) => path === '/instruments/revision'
      ? Promise.reject(new Error('offline')) : original(path, ...args));
    await act(async () => { await vi.advanceTimersByTimeAsync(5000); });
    expect(result.current.authorizedSymbols).toEqual([]);
    expect(result.current.error).toContain('Retrying automatically');
    expect(result.current.authorizedInstruments[0].minVolume).toBe(0.01);
    expect(result.current.symbols.map(row => row.symbol)).toEqual(['BTCUSD']);
    apiGet.mockImplementation(original);
    await act(async () => { await vi.advanceTimersByTimeAsync(5000); });
    expect(result.current.authorizedSymbols).toEqual(['BTCUSD']);
    unmount();
  });

  it('recovers an unchanged revision after a transient public catalogue failure', async () => {
    const original = apiGet.getMockImplementation()!;
    const { result, unmount } = renderHook(() => useMarketInstruments());
    await flushPromises();
    apiGet.mockImplementation((path: string, ...args: unknown[]) => path === '/api/v1/market/symbols'
      ? Promise.reject(new Error('offline')) : original(path, ...args));
    act(() => window.dispatchEvent(new Event('rtx:instrument-catalogue-changed')));
    await flushPromises();
    // Upstream loads the public and authorized catalogues independently: a
    // public outage no longer revokes authorization, but it must still force
    // the next revision check to reload although the revision is unchanged.
    expect(result.current.authorizedSymbols).toEqual(['BTCUSD']);
    expect(result.current.symbols.map(row => row.symbol)).toEqual(['BTCUSD']);
    const publicReads = apiGet.mock.calls.filter(([path]) => path === '/api/v1/market/symbols').length;
    apiGet.mockImplementation(original);
    await act(async () => { await vi.advanceTimersByTimeAsync(5000); });
    expect(apiGet.mock.calls.filter(([path]) => path === '/api/v1/market/symbols').length).toBeGreaterThan(publicReads);
    expect(result.current.authorizedSymbols).toEqual(['BTCUSD']);
    expect(result.current.error).toBeNull();
    unmount();
  });
});
