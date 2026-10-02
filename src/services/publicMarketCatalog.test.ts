import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { loadPublicMarketCatalog, preloadPublicMarketCatalog } from './publicMarketCatalog';
import { loadPublicQuotes } from './publicMarket';

vi.mock('../config/backendTarget.js', () => ({ getPublicBackendTarget: () => 'https://nexa.orrnn.com', getRuntimeBrokerConfiguration: () => ({ brokerId: 'Fixture', publicMarketApi: 'mt5-bridge-v1' }) }));
vi.mock('../config/localDevProxy', () => ({ toLocalDevProxyUrl: (url: string) => url }));
// Transport-sharing unit tests; deployment ownership is covered by brokerRequestIsolation.test.ts.
vi.mock('../api/brokerRequestGuard', () => ({ assertBrokerRequestAllowed: () => undefined }));

type PendingRequest = {
  signal: AbortSignal;
  resolve: (response: Response) => void;
  reject: (error: unknown) => void;
};
let pending: PendingRequest[];
let fetchMock: ReturnType<typeof vi.fn>;
const host = 'https://nexa.orrnn.com';
const response = (bid = 1.1) => new Response(JSON.stringify({
  symbols: [{ symbol: 'EURUSD', bid, ask: bid + 0.1, time: 1_700_000_000 }],
}));

beforeEach(() => {
  pending = [];
  fetchMock = vi.fn((_url: string, options: RequestInit) => new Promise<Response>((resolve, reject) => {
    const signal = options.signal as AbortSignal;
    signal.addEventListener('abort', () => reject(signal.reason), { once: true });
    pending.push({ signal, resolve, reject });
  }));
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
  localStorage.clear();
});

describe('public market catalog request sharing', () => {
  it('joins prefetch, catalog, and guest quotes without sending stored credentials', async () => {
    localStorage.setItem('auth_token', 'must-not-be-sent');
    const prefetch = preloadPublicMarketCatalog(host);
    const catalog = loadPublicMarketCatalog(`${host}/`, new AbortController().signal);
    const quotes = loadPublicQuotes(new AbortController().signal);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith(`${host}/api/v1/market/symbols`, {
      signal: expect.any(AbortSignal), credentials: 'omit', cache: 'no-store', redirect: 'error',
    });
    pending[0].resolve(response());
    const [prefetched, displayed, quoteRows] = await Promise.all([prefetch, catalog, quotes]);
    expect(prefetched).toEqual(displayed);
    expect(quoteRows[0]).toMatchObject({ symbol: 'EURUSD', bid: 1.1, time: 1_700_000_000 });
  });

  it('isolates one consumer cancellation from the remaining catalog consumer', async () => {
    const first = new AbortController();
    const firstResult = loadPublicMarketCatalog(host, first.signal);
    const secondResult = loadPublicMarketCatalog(host, new AbortController().signal);
    const cancelled = expect(firstResult).rejects.toMatchObject({ name: 'AbortError' });
    first.abort();
    await cancelled;
    expect(pending[0].signal.aborted).toBe(false);
    pending[0].resolve(response());
    await expect(secondResult).resolves.toMatchObject({ symbols: [{ symbol: 'EURUSD' }] });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('hands a completed preload to both startup consumers once without changing quote timestamps', async () => {
    vi.useFakeTimers();
    const prefetch = preloadPublicMarketCatalog(host);
    pending[0].resolve(response());
    await prefetch;
    await vi.advanceTimersByTimeAsync(450);

    const catalog = loadPublicMarketCatalog(host);
    const quotes = loadPublicQuotes(new AbortController().signal);
    const [catalogRows, quoteRows] = await Promise.all([catalog, quotes]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(catalogRows).toMatchObject({ symbols: [{ time: 1_700_000_000 }] });
    expect(quoteRows[0].time).toBe(1_700_000_000);
    expect(vi.getTimerCount()).toBe(0);

    const poll = loadPublicQuotes(new AbortController().signal);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    pending[1].resolve(response(1.5));
    await expect(poll).resolves.toMatchObject([{ bid: 1.5 }]);
  });

  it('expires an unused completed preload at one second', async () => {
    vi.useFakeTimers();
    const prefetch = preloadPublicMarketCatalog(host);
    pending[0].resolve(response());
    await prefetch;
    await vi.advanceTimersByTimeAsync(1_000);
    const catalog = loadPublicMarketCatalog(host);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    pending[1].resolve(response(1.4));
    await catalog;
  });

  it('does not retain prefetch results when a real consumer already joined the pending request', async () => {
    const prefetch = preloadPublicMarketCatalog(host);
    const catalog = loadPublicMarketCatalog(host);
    pending[0].resolve(response());
    await Promise.all([prefetch, catalog]);
    const poll = loadPublicMarketCatalog(host);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    pending[1].resolve(response(1.4));
    await poll;
  });

  it('isolates cancellation between consumers of a completed startup handoff', async () => {
    const prefetch = preloadPublicMarketCatalog(host);
    pending[0].resolve(response());
    await prefetch;
    const cancelledController = new AbortController();
    const cancelled = loadPublicMarketCatalog(host, cancelledController.signal);
    const quotes = loadPublicQuotes(new AbortController().signal);
    const rejection = expect(cancelled).rejects.toMatchObject({ name: 'AbortError' });
    cancelledController.abort();
    await rejection;
    await expect(quotes).resolves.toMatchObject([{ symbol: 'EURUSD', time: 1_700_000_000 }]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('cancels unused upstream work and starts a new request after every consumer leaves', async () => {
    const first = new AbortController();
    const second = new AbortController();
    const results = Promise.allSettled([
      loadPublicMarketCatalog(host, first.signal), loadPublicMarketCatalog(host, second.signal),
    ]);
    first.abort();
    expect(pending[0].signal.aborted).toBe(false);
    second.abort();
    expect(pending[0].signal.aborted).toBe(true);
    const replacement = loadPublicMarketCatalog(host);
    await results;
    // Finishing the cancelled request must not evict its replacement.
    const replacementConsumer = loadPublicMarketCatalog(host);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    pending[1].resolve(response());
    await Promise.all([replacement, replacementConsumer]);
  });

  it('keeps different broker URLs independent', async () => {
    const first = loadPublicMarketCatalog(host);
    const second = loadPublicMarketCatalog('https://service.achieverfinancials.com');
    expect(fetchMock).toHaveBeenCalledTimes(2);
    pending[0].resolve(response(1.1));
    pending[1].resolve(response(1.3));
    const [firstCatalog, secondCatalog] = await Promise.all([first, second]);
    expect(firstCatalog).not.toEqual(secondCatalog);
  });

  it('never reuses completed prices or failed requests', async () => {
    const first = loadPublicMarketCatalog(host);
    pending[0].resolve(response(1.1));
    await first;
    const failed = loadPublicMarketCatalog(host);
    const failure = expect(failed).rejects.toThrow('unavailable');
    pending[1].resolve(new Response('', { status: 503 }));
    await failure;
    const third = loadPublicMarketCatalog(host);
    pending[2].resolve(response(1.5));
    await expect(third).resolves.toMatchObject({ symbols: [{ bid: 1.5 }] });
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('does not start a request for an already cancelled consumer', async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(loadPublicMarketCatalog(host, controller.signal)).rejects.toMatchObject({ name: 'AbortError' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('bounds stalled public requests without retaining their failed result', async () => {
    vi.useFakeTimers();
    const first = loadPublicMarketCatalog(host);
    const second = loadPublicMarketCatalog(host);
    const outcomes = Promise.allSettled([first, second]);
    await vi.advanceTimersByTimeAsync(30_000);
    expect(pending[0].signal.aborted).toBe(true);
    expect(await outcomes).toEqual([
      expect.objectContaining({ status: 'rejected', reason: expect.objectContaining({ name: 'TimeoutError' }) }),
      expect.objectContaining({ status: 'rejected', reason: expect.objectContaining({ name: 'TimeoutError' }) }),
    ]);
    const retry = loadPublicMarketCatalog(host);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    pending[1].resolve(response());
    await retry;
  });

  it('cleans up the timer and permits retry after a synchronous transport failure', async () => {
    vi.useFakeTimers();
    fetchMock.mockImplementationOnce(() => { throw new Error('Transport failed'); });
    await expect(loadPublicMarketCatalog(host)).rejects.toThrow('Transport failed');
    expect(vi.getTimerCount()).toBe(0);
    const retry = loadPublicMarketCatalog(host);
    pending[0].resolve(response());
    await retry;
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(vi.getTimerCount()).toBe(0);
  });
});
