import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const runtime = vi.hoisted(() => ({ desktop: false, host: 'https://broker.example', brokerId: 'Fixture' }));
vi.mock('../config/backendTarget.js', () => ({
  getPublicBackendTarget: () => runtime.host,
  isDesktopBackendTarget: () => runtime.desktop,
  getRuntimeBrokerConfiguration: () => ({ brokerId: runtime.brokerId }),
}));
vi.mock('../config/localDevProxy', () => ({ toLocalDevProxyUrl: (url: string) => url }));

type Pending = { signal: AbortSignal; resolve: (response: Response) => void; reject: (error: unknown) => void };
let requests: Pending[];
let fetchMock: ReturnType<typeof vi.fn>;
let prefetch: typeof import('./publicHistoryPrefetch');
const url = 'https://broker.example/api/v2/candles/BTCUSD?timeframe=M1&limit=500';
const payload = { candles: [{ time: 1789479000, open: 1, high: 2, low: 1, close: 2, volume: 10 }] };
const response = () => new Response(JSON.stringify(payload));

beforeEach(async () => {
  vi.useFakeTimers();
  vi.resetModules();
  runtime.desktop = false;
  runtime.host = 'https://broker.example';
  runtime.brokerId = 'Fixture';
  localStorage.clear(); sessionStorage.clear();
  requests = [];
  fetchMock = vi.fn((_url: string, options: RequestInit) => new Promise<Response>((resolve, reject) => {
    const signal = options.signal as AbortSignal;
    signal.addEventListener('abort', () => reject(signal.reason), { once: true });
    requests.push({ signal, resolve, reject });
  }));
  vi.stubGlobal('fetch', fetchMock);
  prefetch = await import('./publicHistoryPrefetch');
});

afterEach(() => {
  vi.clearAllTimers(); vi.useRealTimers(); vi.unstubAllGlobals();
  localStorage.clear(); sessionStorage.clear();
});

describe('public startup history handoff', () => {
  it('does not fetch relative candles when the deployment origin is unavailable', () => {
    runtime.host = '';
    prefetch.preloadPublicStartupHistory();
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it('starts one credential-free first viewport request and hands it to exactly one chart', async () => {
    prefetch.preloadPublicStartupHistory();
    prefetch.preloadPublicStartupHistory();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(0);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith(url, {
      signal: expect.any(AbortSignal), credentials: 'omit', cache: 'no-store', redirect: 'error', headers: { 'X-Broker-ID': 'Fixture' },
    });
    const result = prefetch.takePublicStartupHistory(url);
    expect(result).not.toBeNull();
    expect(prefetch.takePublicStartupHistory(url)).toBeNull();
    requests[0].resolve(response());
    await expect(result).resolves.toEqual(payload);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('isolates pending and claimed history when broker ID changes case on the same origin', async () => {
    prefetch.preloadPublicStartupHistory();
    const previous = prefetch.takePublicStartupHistory(url);
    const rejected = expect(previous).rejects.toMatchObject({ name: 'AbortError' });
    runtime.brokerId = 'fixture';
    expect(prefetch.takePublicStartupHistory(url)).toBeNull();
    prefetch.preloadPublicStartupHistory();
    const current = prefetch.takePublicStartupHistory(url);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[1][1].headers).toEqual({ 'X-Broker-ID': 'fixture' });
    requests[0].resolve(response());
    requests[1].resolve(new Response(JSON.stringify({ candles: [] })));
    await rejected;
    await expect(current).resolves.toEqual({ candles: [] });
  });

  it.each(['symbol', 'timeframe', 'count', 'broker'])('does not serve another %s request', async kind => {
    prefetch.preloadPublicStartupHistory();
    await vi.advanceTimersByTimeAsync(0);
    const other = { symbol: url.replace('BTCUSD', 'EURUSD'), timeframe: url.replace('M1', 'H1'), count: url.replace('500', '3'), broker: url.replace('broker.example', 'other.example') }[kind]!;
    expect(prefetch.takePublicStartupHistory(other)).toBeNull();
    const result = prefetch.takePublicStartupHistory(url);
    requests[0].resolve(response());
    await expect(result).resolves.toEqual(payload);
  });

  it('retains a completed result briefly then expires it without changing timestamps', async () => {
    prefetch.preloadPublicStartupHistory();
    await vi.advanceTimersByTimeAsync(0);
    requests[0].resolve(response());
    await vi.advanceTimersByTimeAsync(500);
    await expect(prefetch.takePublicStartupHistory(url)).resolves.toEqual(payload);
    prefetch.preloadPublicStartupHistory();
    await vi.advanceTimersByTimeAsync(0);
    requests[1].resolve(response());
    await vi.advanceTimersByTimeAsync(1001);
    expect(prefetch.takePublicStartupHistory(url)).toBeNull();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('gives the chart cancellation ownership without retaining an aborted request', async () => {
    prefetch.preloadPublicStartupHistory();
    await vi.advanceTimersByTimeAsync(0);
    const controller = new AbortController();
    const result = prefetch.takePublicStartupHistory(url, controller.signal);
    const rejected = expect(result).rejects.toMatchObject({ name: 'AbortError' });
    controller.abort();
    await rejected;
    expect(requests[0].signal.aborted).toBe(true);
    expect(prefetch.takePublicStartupHistory(url)).toBeNull();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('evicts failures and aborts unused work after its timeout', async () => {
    prefetch.preloadPublicStartupHistory();
    await vi.advanceTimersByTimeAsync(0);
    requests[0].reject(new Error('offline'));
    await vi.advanceTimersByTimeAsync(0);
    expect(prefetch.takePublicStartupHistory(url)).toBeNull();
    prefetch.preloadPublicStartupHistory();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(requests[1].signal.aborted).toBe(true);
    expect(prefetch.takePublicStartupHistory(url)).toBeNull();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('leaves a claimed slow request under chart cancellation ownership', async () => {
    prefetch.preloadPublicStartupHistory();
    await vi.advanceTimersByTimeAsync(0);
    const result = prefetch.takePublicStartupHistory(url);
    await vi.advanceTimersByTimeAsync(10001);
    expect(requests[0].signal.aborted).toBe(false);
    requests[0].resolve(response());
    await expect(result).resolves.toEqual(payload);
  });

  it.each(['local-auth', 'session-auth', 'local-refresh', 'session-refresh', 'desktop'])('skips %s sessions', async kind => {
    if (kind === 'desktop') runtime.desktop = true;
    else (kind.startsWith('local') ? localStorage : sessionStorage).setItem(kind.endsWith('refresh') ? 'refresh_token' : 'auth_token', 'test-only');
    prefetch.preloadPublicStartupHistory();
    await vi.advanceTimersByTimeAsync(0);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
