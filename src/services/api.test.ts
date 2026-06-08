import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { authApi as endpointAuthApi } from '../api/endpoints';
import { API_V2_BASE_URL, RTX5_API_URL, isCleartextDowngradeAllowedHost, normalizeBrokerServerUrl } from '../config/api';
import { api, journalApi } from './api';

const jsonResponse = (body: unknown, init: ResponseInit = {}) =>
  new Response(JSON.stringify(body), {
    status: init.status ?? 200,
    headers: { 'Content-Type': 'application/json', ...init.headers },
  });

const lastFetchCall = () => {
  const call = vi.mocked(fetch).mock.calls.at(-1);
  if (!call) throw new Error('Expected fetch to be called');
  return {
    url: String(call[0]),
    init: call[1] as RequestInit,
    body: call[1]?.body ? JSON.parse(String(call[1].body)) : undefined,
    headers: call[1]?.headers as Record<string, string>,
  };
};

const expectedLoginUrl = (baseUrl: string) =>
  `${normalizeBrokerServerUrl(baseUrl)}/api/v2/auth/login`;

describe('broker server URL normalization', () => {
  it('preserves explicit HTTPS broker URLs unless HTTP-only mode is enabled', () => {
    expect(normalizeBrokerServerUrl('https://103.91.186.142:443')).toBe('https://103.91.186.142:443');
    expect(normalizeBrokerServerUrl('http://103.91.186.142:443')).toBe('http://103.91.186.142:443');
    expect(normalizeBrokerServerUrl('https://103.91.186.142:8443')).toBe('https://103.91.186.142:8443');
  });
});

// fe-webterminal-ui-07: opt-in (VITE_FORCE_HTTP_ONLY) https→http downgrade must
// never strip TLS from a public broker. Only loopback / RFC1918 / link-local
// targets may be downgraded to cleartext.
describe('cleartext downgrade host allow-list', () => {
  it('allows loopback and private/link-local hosts', () => {
    for (const host of [
      'localhost', 'app.localhost', '127.0.0.1', '0.0.0.0', '::1',
      '10.0.0.5', '172.16.4.2', '172.31.255.1', '192.168.1.10', '169.254.1.1',
      'fc00::1', 'fd12:3456::7', 'fe80::1',
    ]) {
      expect(isCleartextDowngradeAllowedHost(host)).toBe(true);
    }
  });

  it('refuses to downgrade public hostnames and routable IPs', () => {
    for (const host of [
      '103.91.186.142', '8.8.8.8', '172.32.0.1', '172.15.0.1', '11.0.0.1',
      'services.growtradingacademy.com', 'rtxbackend.tradecopier.org',
      'example.com', '2606:4700::1',
    ]) {
      expect(isCleartextDowngradeAllowedHost(host)).toBe(false);
    }
  });

  it('handles empty / malformed input safely', () => {
    expect(isCleartextDowngradeAllowedHost('')).toBe(false);
    expect(isCleartextDowngradeAllowedHost(undefined as unknown as string)).toBe(false);
  });
});

describe('normalizeBrokerServerUrl under FORCE_HTTP_ONLY', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it('downgrades private targets but keeps TLS for public brokers', async () => {
    vi.stubEnv('VITE_FORCE_HTTP_ONLY', 'true');
    // Simulate a non-https (Electron-style) page origin.
    Object.defineProperty(window, 'location', {
      value: { ...window.location, protocol: 'file:' },
      configurable: true,
    });
    vi.resetModules();
    const mod = await import('../config/api');

    // Private/loopback: cleartext downgrade permitted.
    expect(mod.normalizeBrokerServerUrl('https://192.168.1.10:443')).toBe('http://192.168.1.10');
    expect(mod.normalizeBrokerServerUrl('https://localhost:8443')).toBe('http://localhost:8443');
    // Public broker: TLS preserved despite FORCE_HTTP_ONLY.
    expect(mod.normalizeBrokerServerUrl('https://103.91.186.142:8091')).toBe('https://103.91.186.142:8091');
    expect(mod.normalizeBrokerServerUrl('https://services.growtradingacademy.com')).toBe('https://services.growtradingacademy.com');
  });
});

type TestWindow = Window & { electronAPI?: unknown };

describe('login payload normalization', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({
      access_token: 'access-token',
      refresh_token: 'refresh-token',
      broker_id: 'testorrnn',
      account_login: 100001,
    })));
    delete (window as TestWindow).electronAPI;
    localStorage.clear();
  });

  it('strips legacy server credentials from the lower auth endpoint payload', async () => {
    await endpointAuthApi.login({
      username: '100001',
      password: 'FixturePassword123',
      broker_id: 'testorrnn',
      server: 'https://legacy-payload.example',
    }, { baseUrl: 'https://testbroker.example' });

    const request = lastFetchCall();
    expect(request.url).toBe(expectedLoginUrl('https://testbroker.example'));
    expect(request.body).toEqual({
      username: '100001',
      password: 'FixturePassword123',
      broker_id: 'testorrnn',
    });
    expect(request.body).not.toHaveProperty('server');
  });

  it('maps lower auth login aliases to username and emits only whitelisted fields', async () => {
    await endpointAuthApi.login({
      login: 100001,
      email: 'ignored@example.com',
      password: 'FixturePassword123',
      broker_id: 'testorrnn',
      server: 'https://legacy-payload.example',
    }, { baseUrl: 'https://testbroker.example' });

    const request = lastFetchCall();
    expect(request.body).toEqual({
      username: 100001,
      password: 'FixturePassword123',
      broker_id: 'testorrnn',
    });
    expect(request.body).not.toHaveProperty('login');
    expect(request.body).not.toHaveProperty('email');
    expect(request.body).not.toHaveProperty('server');
  });

  it('routes api.auth.login to the selected broker base without stale server rewrite or aliases', async () => {
    (window as TestWindow).electronAPI = {};
    localStorage.setItem('server_url', 'https://stale-broker.example');

    await api.auth.login('100001', 'FixturePassword123', {
      broker_id: 'testorrnn',
      server: 'https://testbroker.example',
    });

    const request = lastFetchCall();
    expect(request.url).toBe('https://testbroker.example/api/v2/auth/login');
    expect(request.headers.Authorization).toBeUndefined();
    expect(request.body).toEqual({
      username: '100001',
      password: 'FixturePassword123',
      broker_id: 'testorrnn',
    });
    expect(request.body).not.toHaveProperty('login');
    expect(request.body).not.toHaveProperty('server');
    expect(localStorage.getItem('server_url')).toBe('https://testbroker.example');
  });
});

describe('pending order payload normalization', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ ok: true })));
    localStorage.clear();
  });

  it('maps UI pending create fields to backend account_login/sl/tp/expiry names', async () => {
    await api.orders.placePendingOrder({
      login: 100001,
      symbol: 'XAUUSD',
      side: 'buy',
      volume: 0.1,
      type: 'buy_limit',
      price: 2300,
      price_sl: 2290,
      price_tp: 2325,
      expiration: 1770000000,
    });

    expect(lastFetchCall()).toMatchObject({
      url: `${RTX5_API_URL}/api/v2/orders/pending`,
      body: {
        account_login: 100001,
        symbol: 'XAUUSD',
        side: 'buy',
        volume: 0.1,
        type: 'buy_limit',
        price: 2300,
        sl: 2290,
        tp: 2325,
        expiry: 1770000000,
      },
    });
  });

  it('preserves the pending create expiry alias from the high-level wrapper', async () => {
    await api.orders.placePendingOrder({
      login: 100001,
      symbol: 'XAUUSD',
      side: 'sell',
      volume: 0.2,
      type: 'sell_stop',
      price: 2285,
      sl: 2300,
      tp: 2250,
      expiry: 1770000600,
    });

    expect(lastFetchCall()).toMatchObject({
      url: `${RTX5_API_URL}/api/v2/orders/pending`,
      body: {
        account_login: 100001,
        symbol: 'XAUUSD',
        side: 'sell',
        volume: 0.2,
        type: 'sell_stop',
        price: 2285,
        sl: 2300,
        tp: 2250,
        expiry: 1770000600,
      },
    });
  });

  it('maps UI pending modify fields to backend sl/tp/expiry names', async () => {
    await api.orders.modifyPendingOrder(112233, {
      price: 2301,
      price_sl: 2291,
      price_tp: 2326,
      expiration: 1770000900,
    });

    expect(lastFetchCall()).toMatchObject({
      url: `${RTX5_API_URL}/api/v2/orders/pending/112233`,
      body: {
        price: 2301,
        sl: 2291,
        tp: 2326,
        expiry: 1770000900,
      },
    });
    expect(lastFetchCall().body).not.toHaveProperty('price_sl');
    expect(lastFetchCall().body).not.toHaveProperty('price_tp');
    expect(lastFetchCall().body).not.toHaveProperty('expiration');
  });

  it('preserves pending modify sl/tp/expiry aliases from the high-level wrapper', async () => {
    await api.orders.modifyPendingOrder(112233, {
      price: 2302,
      sl: 2292,
      tp: 2327,
      expiry: 1770001200,
    });

    expect(lastFetchCall()).toMatchObject({
      url: `${RTX5_API_URL}/api/v2/orders/pending/112233`,
      body: {
        price: 2302,
        sl: 2292,
        tp: 2327,
        expiry: 1770001200,
      },
    });
    expect(lastFetchCall().body).not.toHaveProperty('price_sl');
    expect(lastFetchCall().body).not.toHaveProperty('price_tp');
    expect(lastFetchCall().body).not.toHaveProperty('expiration');
  });
});

describe('broker config bootstrap', () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({
      broker_name: 'RTX5 Trading',
      marginMode: 'HEDGING',
    })));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('loads broker config from the v2 endpoint without auth during bootstrap', async () => {
    localStorage.setItem('auth_token', 'stale-token');

    await api.config.getConfig();

    const request = lastFetchCall();
    expect(request.url).toBe(`${API_V2_BASE_URL}/broker/config`);
    expect(request.headers.Authorization).toBeUndefined();
  });
});

describe('analytics export endpoint wiring', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ positions: [{ ticket: 11, symbol: 'XAUUSD' }] })));
    localStorage.clear();
  });

  it('quarantines unavailable PDF and performance exports without calling missing routes', async () => {
    await expect(api.analytics.exportPDF('100001', '2026-01-01', '2026-01-31'))
      .rejects.toThrow('PDF export is unavailable');
    await expect(api.analytics.getPerformanceReport('100001', '2026-01-01', '2026-01-31'))
      .rejects.toThrow('Performance export is unavailable');

    expect(fetch).not.toHaveBeenCalled();
  });

  it('routes positions CSV export to the v2 positions endpoint', async () => {
    await expect(api.analytics.exportCSV('100001', '2026-01-01', '2026-01-31', 'positions'))
      .resolves.toContain('ticket,symbol');

    const request = lastFetchCall();
    expect(request.url).toBe(`${RTX5_API_URL}/api/v2/positions/100001?limit=500&offset=0`);
    expect(request.url).not.toContain('/api/analytics/export/csv');
  });

  it('routes trade CSV export to the v2 deals endpoint', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse({ deals: [{ ticket: 21, symbol: 'EURUSD', time: 1767225600 }] }));

    await expect(api.analytics.exportCSV('100001', '2026-01-01', '2026-01-31', 'trades'))
      .resolves.toContain('ticket,symbol,time');

    const request = lastFetchCall();
    expect(request.url).toBe(`${RTX5_API_URL}/api/v2/deals/100001?limit=500&offset=0`);
    expect(request.url).not.toContain('/api/trades');
  });
});

// fe-webterminal-ui-06: journalApi.getLogs must authenticate (Bearer JWT) and
// must not call a hardcoded cross-broker origin.
describe('journalApi.getLogs authentication', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ count: 0, logs: [] })));
    delete (window as TestWindow).electronAPI;
    localStorage.clear();
  });

  it('attaches the stored Bearer token when present', async () => {
    localStorage.setItem('auth_token', 'journal-jwt');

    await journalApi.getLogs({ mode: 0 });

    const request = lastFetchCall();
    expect(request.headers.Authorization).toBe('Bearer journal-jwt');
    expect(request.url).not.toContain('rtxbackend.tradecopier.org');
  });

  it('omits Authorization when no token is stored (no credential leak)', async () => {
    await journalApi.getLogs();

    const request = lastFetchCall();
    expect(request.headers.Authorization).toBeUndefined();
    expect(request.url).not.toContain('rtxbackend.tradecopier.org');
  });
});
