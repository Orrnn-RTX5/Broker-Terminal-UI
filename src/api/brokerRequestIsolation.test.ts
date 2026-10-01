// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { apiClient } from './client';
import { BrokerAPI } from './brokerApi';
import { loadPublicMarketCatalog } from '../services/publicMarketCatalog';
import { loadBrokerPresentation } from '../services/brokerPresentation';
import { ChartDataService } from '../services/chartDataService';
import { drawingApi } from '../services/drawingApi';
import { submitBugReport } from '../services/bugReportService';
import { authApi } from './endpoints';
import { authApi as terminalAuthApi } from '../services/api';

type RuntimeWindow = Window & { __RTX_RUNTIME_CONFIG__?: Record<string, unknown>; RUNTIME_CONFIG?: Record<string, unknown>; __RUNTIME_CONFIG__?: Record<string, unknown> };
const runtime = window as RuntimeWindow;
const achiever = 'https://service.achiever.orrnn.com';
const configure = (origin = achiever, id = 'achiever') => {
  runtime.__RTX_RUNTIME_CONFIG__ = {
    BACKEND_TARGET: 'web', API_HOST: origin, API_HOST_EXT: origin,
    WS_HOST: origin.replace('https:', 'wss:'), BROKER_ID: id,
    FEED_BROKER_ID: id, DEFAULT_MT5_SERVER: `${id}-Live`,
  };
};
const bindSession = (origin = achiever, id = 'achiever') => {
  localStorage.setItem('server_url', origin);
  localStorage.setItem('broker_id', id);
  localStorage.setItem('auth_token', 'bound-access');
  localStorage.setItem('refresh_token', 'bound-refresh');
};
let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  localStorage.clear(); sessionStorage.clear();
  delete window.electron;
  delete runtime.RUNTIME_CONFIG; delete runtime.__RUNTIME_CONFIG__;
  configure();
  fetchMock = vi.fn().mockImplementation(async () => new Response(JSON.stringify([])));
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => {
  localStorage.clear(); sessionStorage.clear();
  delete runtime.__RTX_RUNTIME_CONFIG__;
  vi.unstubAllGlobals(); vi.unstubAllEnvs();
});

describe('deployment-bound outgoing broker requests', () => {
  it.each([achiever, 'https://api.independent-markets.net', 'https://gateway.previously-unknown.example'])('reads the configured broker %s without a domain naming rule', async origin => {
    configure(origin, 'Configured'); bindSession(origin, 'Configured');
    await apiClient.get('/api/v2/account');
    expect(fetchMock).toHaveBeenCalledWith(`${origin}/api/v2/account`, expect.objectContaining({ headers: expect.objectContaining({ Authorization: 'Bearer bound-access' }) }));
  });

  it('does not attach stale Orrnn credentials to the pinned Achiever broker', async () => {
    vi.stubEnv('VITE_BACKEND_URL', 'https://service.orrnn.com');
    vi.stubEnv('VITE_API_URL', 'https://service.orrnn.com');
    bindSession('https://service.orrnn.com', 'Orrnn');
    localStorage.setItem('api_base_url', 'https://service.orrnn.com');
    await apiClient.get('/api/v2/account');
    expect(fetchMock).toHaveBeenCalledWith(`${achiever}/api/v2/account`, expect.objectContaining({ headers: { 'Content-Type': 'application/json' } }));
  });

  it.each([
    {},
    { API_HOST: 'http://service.achiever.orrnn.com', BROKER_ID: 'achiever' },
    { API_HOST: 'https://user:password@service.achiever.orrnn.com', BROKER_ID: 'achiever' },
    { API_HOST: achiever, WS_HOST: 'wss://different.example', BROKER_ID: 'achiever' },
  ])('starts no transport for missing, malformed, or inconsistent runtime configuration %j', async configuration => {
    runtime.__RTX_RUNTIME_CONFIG__ = configuration;
    bindSession('https://service.orrnn.com', 'Orrnn');
    await expect(apiClient.post('/api/v2/auth/login', { username: 'test', password: 'never-send' })).rejects.toThrow();
    await expect(new BrokerAPI().get('/api/v2/account')).rejects.toThrow();
    await expect(loadPublicMarketCatalog(achiever)).rejects.toThrow();
    await expect(drawingApi.saveDrawing({ id: 'test', type: 'line', points: [] }, 'XAUUSD')).rejects.toThrow();
    await expect(submitBugReport({ form: { title: 'Test', description: 'Configuration transport test', category: 'other', severity: 'low' } })).rejects.toThrow();
    await new ChartDataService().fetchCandles({ symbol: 'XAUUSD', timeframe: 'M1', count: 1 });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('rejects an explicit cross-broker request even when dynamic routing is disabled', async () => {
    bindSession();
    await expect(apiClient.post('/api/v2/auth/login', { password: 'never-send' }, { baseUrl: 'https://service.orrnn.com', skipDynamicUrl: true })).rejects.toThrow('configured deployment broker');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('rejects a stale explicit token after a broker change rather than forwarding it to the new broker', async () => {
    bindSession();
    await expect(apiClient.get('/api/v2/account', { authToken: 'old-broker-token' })).rejects.toThrow('active deployment broker session');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('does not fetch cached branding from another broker', async () => {
    await expect(loadBrokerPresentation({ broker_id: 'Orrnn', server_url: 'https://service.orrnn.com' })).resolves.toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('does not forward an explicit refresh token from a previous broker', async () => {
    bindSession();
    await expect(authApi.refresh('previous-broker-refresh')).rejects.toThrow('active deployment broker session');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('does not store a delayed refresh response after a same-origin broker switch', async () => {
    bindSession();
    let complete!: (response: Response) => void;
    fetchMock.mockImplementation(() => new Promise<Response>(resolve => { complete = resolve; }));
    const pending = terminalAuthApi.refresh('bound-refresh');
    configure(achiever, 'NewBroker'); bindSession(achiever, 'NewBroker');
    localStorage.setItem('auth_token', 'new-broker-token');
    complete(new Response(JSON.stringify({ access_token: 'previous-broker-refreshed-token', refresh_token: 'previous-broker-refreshed-refresh' })));
    await expect(pending).rejects.toThrow('session changed during token refresh');
    expect(localStorage.getItem('auth_token')).toBe('new-broker-token');
    expect(localStorage.getItem('refresh_token')).toBe('bound-refresh');
  });

  it('discards delayed branding when the configured broker changes on the same origin', async () => {
    let complete!: (response: Response) => void;
    fetchMock.mockImplementation(() => new Promise<Response>(resolve => { complete = resolve; }));
    const pending = loadBrokerPresentation({ broker_id: 'achiever', server_url: achiever });
    configure(achiever, 'NewBroker');
    complete(new Response(JSON.stringify({ broker_name: 'Previous broker' })));
    await expect(pending).resolves.toBeNull();
  });

  it('keeps a missing symbols route as a contract error on the same broker', async () => {
    fetchMock.mockResolvedValue(new Response('', { status: 404 }));
    await expect(loadPublicMarketCatalog(achiever)).rejects.toThrow('Broker API compatibility error');
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls.map(call => String(call[0]))).toEqual([`${achiever}/api/v2/instruments`, `${achiever}/api/v2/quotes`]);
  });

  it('prevents cross-origin redirects from forwarding login passwords', async () => {
    await apiClient.post('/api/v2/auth/login', { username: 'test', password: 'placeholder' });
    expect(fetchMock).toHaveBeenCalledWith(`${achiever}/api/v2/auth/login`, expect.objectContaining({ redirect: 'error' }));
  });

  it('joins broker-scoped gateway instruments and quotes without credentials or fabricated timeframe metadata', async () => {
    localStorage.setItem('auth_token', 'stale-other-broker-token');
    fetchMock.mockImplementation(async (url: string) => new Response(JSON.stringify(url.endsWith('/instruments')
      ? [{ symbol: 'EURUSD.a', digits: 5, contract_size: 100000, min_volume: 0.01 }]
      : [{ symbol: 'EURUSD.a', bid: 1.1, ask: 1.2, time: 1790000000, previous_close: 1.09 }, { symbol: 'OTHER', bid: 999 }])));
    await expect(loadPublicMarketCatalog(achiever)).resolves.toEqual({ symbols: [{ symbol: 'EURUSD.a', digits: 5, contract_size: 100000, min_volume: 0.01, bid: 1.1, ask: 1.2, time: 1790000000, previous_close: 1.09 }] });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    for (const call of fetchMock.mock.calls) expect(call[1]).toMatchObject({ credentials: 'omit', redirect: 'error', headers: { 'X-Broker-ID': 'achiever' } });
  });

  it('uses the legacy bridge only when this deployment explicitly configures it', async () => {
    runtime.__RTX_RUNTIME_CONFIG__!.PUBLIC_MARKET_API = 'mt5-bridge-v1';
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ symbols: [] })));
    await expect(loadPublicMarketCatalog(achiever)).resolves.toEqual({ symbols: [] });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0][0])).toBe(`${achiever}/api/v1/market/symbols`);
  });

  it.each([[503, 'BROKER_SCOPE_UNAVAILABLE'], [403, 'BROKER_MISMATCH']] as const)('reports backend %s/%s as a configuration failure without endpoint or broker fallback', async (status, code) => {
    fetchMock.mockImplementation(async () => new Response(JSON.stringify({ error: code }), { status }));
    await expect(loadPublicMarketCatalog(achiever)).rejects.toThrow(code);
    expect(fetchMock.mock.calls.map(call => String(call[0]))).toEqual([`${achiever}/api/v2/instruments`, `${achiever}/api/v2/quotes`]);
  });

  it('isolates pending catalog requests when the configured broker changes on the same origin', async () => {
    const complete: Array<(response: Response) => void> = [];
    fetchMock.mockImplementation(() => new Promise<Response>(resolve => { complete.push(resolve); }));
    const previous = loadPublicMarketCatalog(achiever);
    const discarded = expect(previous).rejects.toMatchObject({ name: 'AbortError' });
    configure(achiever, 'NewBroker');
    const current = loadPublicMarketCatalog(achiever);
    expect(fetchMock).toHaveBeenCalledTimes(4);
    complete[0](new Response(JSON.stringify([{ symbol: 'OLD' }])));
    complete[1](new Response(JSON.stringify([{ symbol: 'OLD', bid: 1 }])));
    complete[2](new Response(JSON.stringify([{ symbol: 'NEW' }])));
    complete[3](new Response(JSON.stringify([{ symbol: 'NEW', bid: 2 }])));
    await discarded;
    await expect(current).resolves.toEqual({ symbols: [{ symbol: 'NEW', bid: 2 }] });
  });
});
