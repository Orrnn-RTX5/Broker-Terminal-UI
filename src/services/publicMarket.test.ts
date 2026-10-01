import { afterEach, expect, it, vi } from 'vitest';
import { loadPublicQuotes } from './publicMarket';

const runtime = vi.hoisted(() => ({ host: 'https://nexa.orrnn.com' }));
vi.mock('../config/backendTarget.js', () => ({ getPublicBackendTarget: () => runtime.host, getRuntimeBrokerConfiguration: () => ({ brokerId: 'Fixture', publicMarketApi: 'mt5-bridge-v1' }) }));
vi.mock('../config/localDevProxy', () => ({ toLocalDevProxyUrl: (url: string) => url }));
vi.mock('../api/brokerRequestGuard', () => ({ assertBrokerRequestAllowed: () => undefined }));
afterEach(() => { vi.unstubAllGlobals(); localStorage.clear(); });

it.each(['https://nexa.orrnn.com', 'https://service.achieverfinancials.com', 'https://fxtrustbrokerbackend.orrnn.com'])('uses the configured broker %s without credentials', async host => {
  runtime.host = host;
  localStorage.setItem('auth_token', 'must-not-be-sent');
  const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ symbols: [{ symbol: 'EURUSD', bid: 1.1, ask: 1.2 }] })));
  vi.stubGlobal('fetch', fetchMock);
  const signal = new AbortController().signal;
  expect(await loadPublicQuotes(signal)).toMatchObject([{ symbol: 'EURUSD', bid: 1.1, ask: 1.2, time: undefined, dailyChangeInput: { bid: 1.1 } }]);
  expect(fetchMock).toHaveBeenCalledWith(`${host}/api/v1/market/symbols`, {
    signal: expect.any(AbortSignal), cache: 'no-store', credentials: 'omit', redirect: 'error',
  });
});

it('reports broker login requirements instead of accessing account credentials', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('', { status: 403 })));
  await expect(loadPublicQuotes(new AbortController().signal)).rejects.toThrow('requires login');
});

it('reports a missing public bridge contract without trying another endpoint or broker', async () => {
  const fetchMock = vi.fn().mockResolvedValue(new Response('', { status: 404 }));
  vi.stubGlobal('fetch', fetchMock);
  await expect(loadPublicQuotes(new AbortController().signal)).rejects.toThrow('GET /api/v1/market/symbols');
  expect(fetchMock).toHaveBeenCalledTimes(1);
  expect(String(fetchMock.mock.calls[0][0])).toBe(`${runtime.host}/api/v1/market/symbols`);
});

it('preserves provider, reference, basis and session fields from public broker snapshots', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ symbols: [{
    symbol: 'FUTURE.X', bid: 100, ask: 102, last: 105, time: 1790000000,
    previous_close: 95, settlement_price: 90, chart_mode: 'last',
    provider: 'feed-a', session_id: 'overnight', daily_change_pct: 1.25,
  }] }))));
  const [quote] = await loadPublicQuotes(new AbortController().signal);
  expect(quote.dailyChangeInput).toMatchObject({ bid: 100, last: 105, mode: 'last', provider: 'feed-a', sessionId: 'overnight', previousClose: 95, settlement: 90, upstreamPercent: 1.25 });
});
