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
  const recoverTransport = () => window.dispatchEvent(new CustomEvent('rtx:trade-stream-recovered', {
    detail: { reason: 'transport-reconnect' },
  }));

  it('recovery fast path checks an unchanged revision without reloading verified same-scope permissions', async () => {
    const { result, unmount } = renderHook(() => useMarketInstruments());
    await flushPromises();
    expect(result.current.authorizedSymbols).toEqual(['BTCUSD']);
    const before = apiGet.mock.calls.length;
    act(recoverTransport);
    await flushPromises();
    try {
      expect(apiGet.mock.calls.slice(before).map(([endpoint]) => endpoint)).toEqual(['/instruments/revision']);
      expect(result.current.authorizedSymbols).toEqual(['BTCUSD']);
      expect(result.current.authorizationSettled).toBe(true);
    } finally {
      unmount();
    }
  });

  it('ignores ordinary state flushes and coalesces recovery with a pending revision check', async () => {
    const original = apiGet.getMockImplementation()!;
    const { result, unmount } = renderHook(() => useMarketInstruments());
    await flushPromises();
    const before = apiGet.mock.calls.length;
    act(() => window.dispatchEvent(new Event('rtx:trade-stream-recovered')));
    act(() => window.dispatchEvent(new CustomEvent('rtx:trade-stream-recovered', { detail: { reason: 'state-update' } })));
    expect(apiGet.mock.calls).toHaveLength(before);
    let resolveRevision!: (value: unknown) => void;
    apiGet.mockImplementation((endpoint: string, ...args: unknown[]) => endpoint === '/instruments/revision'
      ? new Promise(resolve => { resolveRevision = resolve; }) : original(endpoint, ...args));
    act(recoverTransport);
    act(recoverTransport);
    await act(async () => { await vi.advanceTimersByTimeAsync(5000); });
    expect(apiGet.mock.calls.slice(before).map(([endpoint]) => endpoint)).toEqual(['/instruments/revision']);
    expect(result.current.authorizedSymbols).toEqual(['BTCUSD']);
    await act(async () => { resolveRevision({ revision }); });
    expect(result.current.authorizedSymbols).toEqual(['BTCUSD']);
    unmount();
  });

  it('recovery and polling do not abort or restart the pending initial catalogue', async () => {
    const original = apiGet.getMockImplementation()!;
    let resolveCatalogue!: (value: unknown) => void;
    let signal!: AbortSignal;
    apiGet.mockImplementation((endpoint: string, options: { signal?: AbortSignal }, ...args: unknown[]) => endpoint === '/instruments'
      ? new Promise(resolve => { resolveCatalogue = resolve; signal = options.signal!; })
      : original(endpoint, options, ...args));
    const { result, unmount } = renderHook(() => useMarketInstruments());
    await flushPromises();
    act(recoverTransport);
    await act(async () => { await vi.advanceTimersByTimeAsync(5000); });
    expect(apiGet.mock.calls.map(([endpoint]) => endpoint)).toEqual(['/api/v1/market/symbols', '/instruments']);
    expect(signal.aborted).toBe(false);
    expect(result.current.authorizedSymbols).toEqual([]);
    expect(result.current.authorizationSettled).toBe(false);
    await act(async () => { resolveCatalogue({ revision, instruments: [...instruments] }); });
    expect(result.current.authorizedSymbols).toEqual(['BTCUSD']);
    expect(result.current.authorizationSettled).toBe(true);
    expect(apiGet.mock.calls.filter(([endpoint]) => endpoint === '/instruments')).toHaveLength(1);
    unmount();
  });

  it('still checks and revokes authorization while public enrichment remains pending', async () => {
    const original = apiGet.getMockImplementation()!;
    let resolvePublic!: (value: unknown) => void;
    let publicSignal!: AbortSignal;
    let publicReads = 0;
    apiGet.mockImplementation((endpoint: string, options: { signal?: AbortSignal }, ...args: unknown[]) => {
      if (endpoint === '/api/v1/market/symbols' && ++publicReads === 1) {
        return new Promise(resolve => { resolvePublic = resolve; publicSignal = options.signal!; });
      }
      return original(endpoint, options, ...args);
    });
    const { result, unmount } = renderHook(() => useMarketInstruments());
    await flushPromises();
    expect(result.current.authorizedSymbols).toEqual(['BTCUSD']);
    expect(result.current.authorizationSettled).toBe(true);
    expect(publicSignal.aborted).toBe(false);
    revision = '2';
    instruments = [{ symbol: 'BTCUSD', trading_enabled: false }];
    let resolveRevoked!: (value: unknown) => void;
    apiGet.mockImplementation((endpoint: string, ...args: unknown[]) => endpoint === '/instruments'
      ? new Promise(resolve => { resolveRevoked = resolve; }) : original(endpoint, ...args));
    await act(async () => { await vi.advanceTimersByTimeAsync(5000); });
    expect(apiGet.mock.calls.filter(([endpoint]) => endpoint === '/instruments/revision')).toHaveLength(1);
    expect(publicSignal.aborted).toBe(true);
    expect(result.current.authorizedSymbols).toEqual([]);
    await act(async () => { resolveRevoked({ revision, instruments: [...instruments] }); });
    expect(result.current.authorizedSymbols).toEqual([]);
    expect(result.current.disabledSymbols).toEqual(['BTCUSD']);
    await act(async () => { resolvePublic({ symbols: [{ symbol: 'BTCUSD' }] }); });
    expect(result.current.authorizedSymbols).toEqual([]);
    unmount();
  });

  it('checks a second revision while public enrichment from the first revision reload is pending', async () => {
    const original = apiGet.getMockImplementation()!;
    const { result, unmount } = renderHook(() => useMarketInstruments());
    await flushPromises();
    let resolvePublic!: (value: unknown) => void;
    let publicSignal!: AbortSignal;
    apiGet.mockImplementation((endpoint: string, options: { signal?: AbortSignal }, ...args: unknown[]) => endpoint === '/api/v1/market/symbols'
      ? new Promise(resolve => { resolvePublic = resolve; publicSignal = options.signal!; })
      : original(endpoint, options, ...args));
    revision = '2';
    act(recoverTransport);
    await flushPromises();
    expect(result.current.authorizedSymbols).toEqual(['BTCUSD']);
    expect(publicSignal.aborted).toBe(false);
    const firstPublicSignal = publicSignal;
    const finishFirstPublic = resolvePublic;
    revision = '3';
    instruments = [{ symbol: 'BTCUSD', trading_enabled: false }];
    apiGet.mockImplementation(original);
    await act(async () => { await vi.advanceTimersByTimeAsync(5000); });
    expect(apiGet.mock.calls.filter(([endpoint]) => endpoint === '/instruments/revision')).toHaveLength(2);
    expect(firstPublicSignal.aborted).toBe(true);
    expect(result.current.authorizedSymbols).toEqual([]);
    expect(result.current.disabledSymbols).toEqual(['BTCUSD']);
    await act(async () => { finishFirstPublic({ symbols: [{ symbol: 'BTCUSD' }] }); });
    expect(result.current.authorizedSymbols).toEqual([]);
    unmount();
  });

  it('an obsolete authenticated request cannot release the newer session pending guard', async () => {
    const original = apiGet.getMockImplementation()!;
    const pending: Array<(value: unknown) => void> = [];
    apiGet.mockImplementation((endpoint: string, ...args: unknown[]) => endpoint === '/instruments'
      ? new Promise(resolve => { pending.push(resolve); }) : original(endpoint, ...args));
    const { result, unmount } = renderHook(() => useMarketInstruments());
    await flushPromises();
    act(() => useAppStore.setState({ accountId: '200002' }));
    await flushPromises();
    expect(pending).toHaveLength(2);
    await act(async () => { pending[0]({ revision: '1', instruments: [{ symbol: 'BTCUSD', trading_enabled: true }] }); });
    act(recoverTransport);
    await act(async () => { await vi.advanceTimersByTimeAsync(5000); });
    expect(apiGet.mock.calls.filter(([endpoint]) => endpoint === '/instruments/revision')).toHaveLength(0);
    expect(pending).toHaveLength(2);
    expect(result.current.authorizedSymbols).toEqual([]);
    await act(async () => { pending[1]({ revision: '2', instruments: [{ symbol: 'XAUUSD', trading_enabled: true }] }); });
    expect(result.current.authorizedSymbols).toEqual(['XAUUSD']);
    unmount();
  });

  it('clears on changed recovery revision and preserves the server revoked permission', async () => {
    const original = apiGet.getMockImplementation()!;
    const { result, unmount } = renderHook(() => useMarketInstruments());
    await flushPromises();
    revision = '2';
    let resolveCatalogue!: (value: unknown) => void;
    apiGet.mockImplementation((endpoint: string, ...args: unknown[]) => endpoint === '/instruments'
      ? new Promise(resolve => { resolveCatalogue = resolve; }) : original(endpoint, ...args));
    act(recoverTransport);
    await flushPromises();
    expect(result.current.authorizedSymbols).toEqual([]);
    expect(result.current.authorizationSettled).toBe(false);
    const pendingReads = apiGet.mock.calls.length;
    act(recoverTransport);
    await act(async () => { await vi.advanceTimersByTimeAsync(5000); });
    expect(apiGet.mock.calls).toHaveLength(pendingReads);
    await act(async () => { resolveCatalogue({ revision, instruments: [{ symbol: 'BTCUSD', trading_enabled: false }] }); });
    expect(result.current.authorizedSymbols).toEqual([]);
    expect(result.current.disabledSymbols).toEqual(['BTCUSD']);
    unmount();
  });

  it('real catalogue notification clears immediately and ignores an older failed revision check', async () => {
    const original = apiGet.getMockImplementation()!;
    const { result, unmount } = renderHook(() => useMarketInstruments());
    await flushPromises();
    let rejectRevision!: (error: Error) => void;
    apiGet.mockImplementation((endpoint: string, ...args: unknown[]) => endpoint === '/instruments/revision'
      ? new Promise((_resolve, reject) => { rejectRevision = reject; }) : original(endpoint, ...args));
    act(recoverTransport);
    revision = '2';
    act(() => window.dispatchEvent(new CustomEvent('rtx:instrument-catalogue-changed', { detail: { revision } })));
    expect(result.current.authorizedSymbols).toEqual([]);
    await flushPromises();
    expect(result.current.authorizedSymbols).toEqual(['BTCUSD']);
    await act(async () => { rejectRevision(new Error('obsolete request failed')); });
    expect(result.current.authorizedSymbols).toEqual(['BTCUSD']);
    expect(result.current.error).toBeNull();
    unmount();
  });

  it('recovery revision failure clears permissions and later success fully reloads them', async () => {
    const original = apiGet.getMockImplementation()!;
    const { result, unmount } = renderHook(() => useMarketInstruments());
    await flushPromises();
    apiGet.mockImplementation((endpoint: string, ...args: unknown[]) => endpoint === '/instruments/revision'
      ? Promise.reject(new Error('unavailable')) : original(endpoint, ...args));
    act(recoverTransport);
    await flushPromises();
    expect(result.current.authorizedSymbols).toEqual([]);
    const reads = apiGet.mock.calls.filter(([endpoint]) => endpoint === '/instruments').length;
    apiGet.mockImplementation(original);
    act(recoverTransport);
    await flushPromises();
    expect(apiGet.mock.calls.filter(([endpoint]) => endpoint === '/instruments')).toHaveLength(reads + 1);
    expect(result.current.authorizedSymbols).toEqual(['BTCUSD']);
    unmount();
  });

  it.each([undefined, '', '   '])('cannot reuse an empty or missing loaded revision on recovery (%j)', async (loadedRevision) => {
    const original = apiGet.getMockImplementation()!;
    apiGet.mockImplementation((endpoint: string, ...args: unknown[]) => endpoint === '/instruments'
      ? Promise.resolve({ revision: loadedRevision, instruments: [...instruments] }) : original(endpoint, ...args));
    const { result, unmount } = renderHook(() => useMarketInstruments());
    await flushPromises();
    expect(result.current.authorizedSymbols).toEqual(['BTCUSD']);
    const reads = apiGet.mock.calls.filter(([endpoint]) => endpoint === '/instruments').length;
    act(recoverTransport);
    await flushPromises();
    expect(apiGet.mock.calls.filter(([endpoint]) => endpoint === '/instruments')).toHaveLength(reads + 1);
    unmount();
  });

  it('ignores a pending prior-session revision after account change', async () => {
    const original = apiGet.getMockImplementation()!;
    const { result, unmount } = renderHook(() => useMarketInstruments());
    await flushPromises();
    let resolveRevision!: (value: unknown) => void;
    apiGet.mockImplementation((endpoint: string, ...args: unknown[]) => endpoint === '/instruments/revision'
      ? new Promise(resolve => { resolveRevision = resolve; }) : original(endpoint, ...args));
    act(recoverTransport);
    revision = '2';
    instruments = [{ symbol: 'XAUUSD', trading_enabled: true }];
    act(() => useAppStore.setState({ accountId: '200002' }));
    expect(result.current.authorizedSymbols).toEqual([]);
    await flushPromises();
    expect(result.current.authorizedSymbols).toEqual(['XAUUSD']);
    const reads = apiGet.mock.calls.filter(([endpoint]) => endpoint === '/instruments').length;
    await act(async () => { resolveRevision({ revision: '1' }); });
    expect(result.current.authorizedSymbols).toEqual(['XAUUSD']);
    expect(apiGet.mock.calls.filter(([endpoint]) => endpoint === '/instruments')).toHaveLength(reads);
    unmount();
  });

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
