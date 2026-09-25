import { afterEach, expect, it, vi } from 'vitest';
import { loadPublicQuotes } from './publicMarket';

const runtime = vi.hoisted(() => ({ host: 'https://nexa.orrnn.com' }));
vi.mock('../config/backendTarget.js', () => ({ getPublicBackendTarget: () => runtime.host }));
vi.mock('../config/localDevProxy', () => ({ toLocalDevProxyUrl: (url: string) => url }));
afterEach(() => { vi.unstubAllGlobals(); localStorage.clear(); });

it.each(['https://nexa.orrnn.com', 'https://service.achieverfinancials.com', 'https://fxtrustbrokerbackend.orrnn.com'])('uses the configured broker %s without credentials', async host => {
  runtime.host = host;
  localStorage.setItem('auth_token', 'must-not-be-sent');
  const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ symbols: [{ symbol: 'EURUSD', bid: 1.1, ask: 1.2 }] })));
  vi.stubGlobal('fetch', fetchMock);
  const signal = new AbortController().signal;
  expect(await loadPublicQuotes(signal)).toEqual([{ symbol: 'EURUSD', bid: 1.1, ask: 1.2, time: undefined }]);
  expect(fetchMock).toHaveBeenCalledWith(`${host}/api/v1/market/symbols`, {
    signal: expect.any(AbortSignal), cache: 'no-store', credentials: 'omit',
  });
});

it('reports broker login requirements instead of accessing account credentials', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('', { status: 403 })));
  await expect(loadPublicQuotes(new AbortController().signal)).rejects.toThrow('requires login');
});
