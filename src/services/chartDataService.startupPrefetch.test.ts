import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ChartDataService } from './chartDataService';
import { StartupHistorySessionChangedError } from '../startup/authenticatedHistoryPrefetch';

const takePrefetch = vi.hoisted(() => vi.fn());
const takeAuthenticatedPrefetch = vi.hoisted(() => vi.fn());
vi.mock('../startup/publicHistoryPrefetch', () => ({ takePublicStartupHistory: takePrefetch }));
vi.mock('../startup/authenticatedHistoryPrefetch', async importOriginal => ({
  ...await importOriginal<typeof import('../startup/authenticatedHistoryPrefetch')>(),
  takeAuthenticatedStartupHistory: takeAuthenticatedPrefetch,
}));

const candle = { time: 1789479000, open: 100, high: 105, low: 98, close: 102, volume: 10 };
const payload = { symbol: 'BTCUSD', timeframe: 'M1', candles: [candle] };
let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  takePrefetch.mockReset();
  takePrefetch.mockReturnValue(null);
  takeAuthenticatedPrefetch.mockReset();
  takeAuthenticatedPrefetch.mockReturnValue(null);
  fetchMock = vi.fn(async () => new Response(JSON.stringify(payload)));
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  localStorage.clear();
  sessionStorage.clear();
});

describe('chart startup history prefetch integration', () => {
  it('does not retry an old chart request under a different authenticated session', async () => {
    takeAuthenticatedPrefetch.mockReturnValueOnce(Promise.reject(new StartupHistorySessionChangedError()));
    await expect(new ChartDataService().fetchCandles({ symbol: 'BTCUSD', timeframe: 'M1', count: 500 }))
      .rejects.toBeInstanceOf(StartupHistorySessionChangedError);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('uses the guest 500-candle handoff and reports provenance only after validating nonempty candles', async () => {
    let resolvePrefetch!: (value: unknown) => void;
    takePrefetch.mockReturnValueOnce(new Promise((resolve) => { resolvePrefetch = resolve; }));
    const onStartupPrefetchConsumed = vi.fn();
    const signal = new AbortController().signal;
    const history = new ChartDataService().fetchCandles({
      symbol: 'BTCUSD', timeframe: 'M1', count: 500, signal, onStartupPrefetchConsumed,
    });
    expect(takePrefetch).toHaveBeenCalledWith(
      expect.stringMatching(/\/api\/v2\/candles\/BTCUSD\?timeframe=M1&limit=500$/), signal,
    );
    expect(onStartupPrefetchConsumed).not.toHaveBeenCalled();
    resolvePrefetch({
      symbol: 'BTCUSD', timeframe: 'M1',
      candles: [{ ...candle, time: candle.time * 1000, open: '100', closed: true }],
    });

    await expect(history).resolves.toEqual([expect.objectContaining({ ...candle, closed: true })]);
    expect(onStartupPrefetchConsumed).toHaveBeenCalledOnce();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each(['empty', 'rejected', 'wrong symbol', 'malformed'] as const)(
    'falls back to fresh history without reporting prefetch consumption after a %s handoff',
    async (kind) => {
      takePrefetch.mockReturnValueOnce(kind === 'rejected'
        ? Promise.reject(new Error('Speculative transport failed'))
        : Promise.resolve(kind === 'empty' ? { candles: [] }
          : kind === 'wrong symbol' ? { ...payload, symbol: 'EURUSD' }
            : { candles: [{ time: candle.time, open: 'invalid' }] }));
      const onStartupPrefetchConsumed = vi.fn();
      const signal = new AbortController().signal;
      const history = await new ChartDataService().fetchCandles({
        symbol: 'BTCUSD', timeframe: 'M1', count: 500, signal, onStartupPrefetchConsumed,
      });

      expect(history).toEqual([expect.objectContaining(candle)]);
      expect(fetchMock).toHaveBeenCalledExactlyOnceWith(
        expect.stringMatching(/\/api\/v2\/candles\/BTCUSD\?timeframe=M1&limit=500$/),
        expect.objectContaining({ signal, credentials: 'omit', cache: 'no-store', headers: undefined }),
      );
      expect(onStartupPrefetchConsumed).not.toHaveBeenCalled();
    },
  );

  it('always uses the authenticated broker request when an account token exists', async () => {
    localStorage.setItem('auth_token', 'startup-test-access-token');
    const onStartupPrefetchConsumed = vi.fn();
    const history = await new ChartDataService().fetchCandles({
      symbol: 'BTCUSD', timeframe: 'M1', count: 500, onStartupPrefetchConsumed,
    });

    expect(history).toEqual([expect.objectContaining(candle)]);
    expect(takePrefetch).not.toHaveBeenCalled();
    expect(onStartupPrefetchConsumed).not.toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledExactlyOnceWith(
      expect.stringMatching(/\/api\/v2\/candles\/BTCUSD\?timeframe=M1&limit=500$/),
      expect.objectContaining({ headers: { Authorization: 'Bearer startup-test-access-token' } }),
    );
  });
});
