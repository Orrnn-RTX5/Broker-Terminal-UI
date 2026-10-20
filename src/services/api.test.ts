import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { authApi as endpointAuthApi } from '../api/endpoints';
import { API_V2_BASE_URL, RTX5_API_URL, isCleartextDowngradeAllowedHost, normalizeBrokerServerUrl, updateDynamicUrls } from '../config/api';
import { api, journalApi, normalizeJournalResponse } from './api';

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

const originalWindowLocation = window.location;

const clearStoredRouting = () => {
  delete (window as Window & { electronAPI?: unknown }).electronAPI;
  delete (window as Window & { __RTX_RUNTIME_CONFIG__?: Record<string, unknown> }).__RTX_RUNTIME_CONFIG__;
  Object.defineProperty(window, 'location', {
    value: originalWindowLocation,
    configurable: true,
  });
  localStorage.clear();
  (window as Window & { __RTX_RUNTIME_CONFIG__?: Record<string, unknown> }).__RTX_RUNTIME_CONFIG__ = {
    BACKEND_TARGET: 'desktop', API_HOST: 'https://broker.example', WS_HOST: 'wss://broker.example',
    BROKER_ID: 'Fixture', DEFAULT_MT5_SERVER: 'Fixture-Live',
  };
  localStorage.setItem('server_url', 'https://broker.example');
  localStorage.setItem('broker_id', 'Fixture');
  updateDynamicUrls();
};

describe('broker server URL normalization', () => {
  it('preserves explicit HTTPS broker URLs unless HTTP-only mode is enabled', () => {
    expect(normalizeBrokerServerUrl('https://103.91.186.142:443')).toBe('https://103.91.186.142:443');
    expect(normalizeBrokerServerUrl('http://103.91.186.142:443')).toBe('http://103.91.186.142:443');
    expect(normalizeBrokerServerUrl('https://103.91.186.142:8443')).toBe('https://103.91.186.142:8443');
  });
});

describe('position close adapter', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn().mockImplementation((_url: string, init?: RequestInit) => {
      const parsedBody = init?.body ? JSON.parse(String(init.body)) : {};
      return Promise.resolve(jsonResponse({
        status: 'closed',
        client_order_id: parsedBody.client_order_id,
        position_id: '900719925474099312345',
        ticket: '900719925474099312345',
      }));
    }));
    clearStoredRouting();
  });

  it('preserves a positive decimal ticket and sends the full-close contract', async () => {
    const ticket = '900719925474099312345';

    await api.positions.closePosition(ticket);

    expect(lastFetchCall()).toMatchObject({
      url: `${API_V2_BASE_URL}/positions/${ticket}/close`,
      body: expect.objectContaining({
        client_order_id: expect.any(String),
      }),
    });
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
    clearStoredRouting();
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
      login: 100001,
      password: 'FixturePassword123',
      broker_id: 'testorrnn',
    });
    expect(request.body).not.toHaveProperty('server');
  });

  it('allows the backend to identify the broker when no broker id is configured', async () => {
    delete (window as Window & { __RTX_RUNTIME_CONFIG__?: Record<string, unknown> }).__RTX_RUNTIME_CONFIG__!.BROKER_ID;
    localStorage.removeItem('broker_id');
    await api.auth.login('100001', 'FixturePassword123', { server: 'https://new-broker.example' });
    expect(lastFetchCall().body).toEqual({ login: 100001, password: 'FixturePassword123' });
    expect(localStorage.getItem('broker_id')).toBe('testorrnn');
  });

  it('preserves numeric account login and emits only whitelisted fields', async () => {
    await endpointAuthApi.login({
      login: 100001,
      email: 'ignored@example.com',
      password: 'FixturePassword123',
      broker_id: 'testorrnn',
      server: 'https://legacy-payload.example',
    }, { baseUrl: 'https://testbroker.example' });

    const request = lastFetchCall();
    expect(request.body).toEqual({
      login: 100001,
      password: 'FixturePassword123',
      broker_id: 'testorrnn',
    });
    expect(request.body).not.toHaveProperty('username');
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
      login: 100001,
      password: 'FixturePassword123',
      broker_id: 'testorrnn',
    });
    expect(request.body).not.toHaveProperty('username');
    expect(request.body).not.toHaveProperty('server');
    expect(localStorage.getItem('server_url')).toBe('https://testbroker.example');
  });
});

describe('pending order payload normalization', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ ok: true })));
    clearStoredRouting();
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
    clearStoredRouting();
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

  it('falls back to neutral broker values (never code literals) when v2 config is not deployed', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse({ error: 'not found' }, { status: 404 }));

    await expect(api.config.getConfig()).resolves.toEqual({
      brokerName: '',
      priceFeedLP: '',
      executionMode: '',
      defaultLeverage: 0,
      defaultBalance: 0,
      marginMode: '',
      maxTicksPerSymbol: 0,
    });
  });
});

describe('analytics export endpoint wiring', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ positions: [{ ticket: 11, symbol: 'XAUUSD' }] })));
    clearStoredRouting();
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
    clearStoredRouting();
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

  it('routes to the active broker and sends only the documented mode/type query', async () => {
    (window as Window & { __RTX_RUNTIME_CONFIG__?: Record<string, unknown> }).__RTX_RUNTIME_CONFIG__ = {
      BACKEND_TARGET: 'web',
      API_HOST: 'https://fxtrustbrokerbackend.orrnn.com',
      WS_HOST: 'wss://fxtrustbrokerbackend.orrnn.com', BROKER_ID: 'Fixture', DEFAULT_MT5_SERVER: 'Fixture-Live',
    };
    localStorage.setItem('server_url', 'https://fxtrustbrokerbackend.orrnn.com');
    localStorage.setItem('auth_token', 'journal-jwt');
    updateDynamicUrls();

    await journalApi.getLogs();

    const request = lastFetchCall();
    expect(request.url).toBe('https://fxtrustbrokerbackend.orrnn.com/api/v2/journal?mode=2&type=0');
    expect(request.url).not.toContain('filter=');
    expect(request.url).not.toContain('from=');
    expect(request.headers.Authorization).toBe('Bearer journal-jwt');
    expect(request.headers.accept).toBe('application/json');
  });

  it('refreshes a 401 through the active broker v2 auth route and retries once', async () => {
    (window as Window & { __RTX_RUNTIME_CONFIG__?: Record<string, unknown> }).__RTX_RUNTIME_CONFIG__ = {
      BACKEND_TARGET: 'web',
      API_HOST: 'https://fxtrustbrokerbackend.orrnn.com',
      WS_HOST: 'wss://fxtrustbrokerbackend.orrnn.com', BROKER_ID: 'Fixture', DEFAULT_MT5_SERVER: 'Fixture-Live',
    };
    localStorage.setItem('server_url', 'https://fxtrustbrokerbackend.orrnn.com');
    localStorage.setItem('auth_token', 'expired-journal-jwt');
    localStorage.setItem('refresh_token', 'journal-refresh-token');
    updateDynamicUrls();
    vi.mocked(fetch)
      .mockResolvedValueOnce(jsonResponse({ error: 'expired' }, { status: 401 }))
      .mockResolvedValueOnce(jsonResponse({
        access_token: 'renewed-journal-jwt',
        refresh_token: 'renewed-journal-refresh-token',
      }))
      .mockResolvedValueOnce(jsonResponse({ count: 0, logs: [] }));

    await journalApi.getLogs();

    const calls = vi.mocked(fetch).mock.calls;
    expect(String(calls[0][0])).toBe('https://fxtrustbrokerbackend.orrnn.com/api/v2/journal?mode=2&type=0');
    expect(String(calls[1][0])).toBe('https://fxtrustbrokerbackend.orrnn.com/api/v2/auth/refresh');
    expect(JSON.parse(String(calls[1][1]?.body))).toEqual({ refresh_token: 'journal-refresh-token' });
    expect(new Headers(calls[2][1]?.headers).get('Authorization')).toBe('Bearer renewed-journal-jwt');
    expect(localStorage.getItem('auth_token')).toBe('renewed-journal-jwt');
  });
});

describe('position REST display normalization', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
    clearStoredRouting();
  });

  it.each([
    ['missing', {}, false],
    ['zero', { profit: 0, price_current: 0 }, true],
    ['numeric strings', { unrealized_pnl: '-1.25', current_price: '82000.5' }, true],
    ['invalid', { profit: 'invalid', price_current: false }, false],
    ['unavailable snapshot', { profit: 3, price_current: 82000, pnl_available: false }, false],
    ['previous placeholders', { profit: 0, price_current: 0, hasBackendProfit: false, hasBackendCurrentPrice: false }, false],
  ])('preserves %s provenance and position versions through REST normalization', async (_name, display, available) => {
    const raw = { ticket: 41, symbol: 'BTCUSD', price_open: 81000, state_version: '9007199254740993123', ...display };
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse([raw]));
    const first = await api.positions.getPositions(100001);
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse(first));
    const second = await api.positions.getPositions(100001);
    for (const result of [first[0], second[0]]) {
      expect(result).toMatchObject({
        ticket: 41,
        state_version: raw.state_version,
        hasBackendProfit: available,
        hasBackendCurrentPrice: available,
      });
      if (!available) expect(result).toMatchObject({ currentPrice: 0, unrealizedPnL: 0 });
    }
  });
});

describe('normalizeJournalResponse', () => {
  it('normalizes the live count/logs shape without dropping the backend id', () => {
    expect(normalizeJournalResponse({
      count: '1',
      logs: [{
        id: 42,
        code: '0',
        code_text: 'OK',
        type: '6',
        type_text: 'Trade',
        datetime: '1787639000',
        source: 'gateway',
        message: 'Position opened',
      }],
    })).toEqual({
      count: 1,
      logs: [{
        id: 42,
        code: 0,
        code_text: 'OK',
        type: 6,
        type_text: 'Trade',
        datetime: 1787639000,
        source: 'gateway',
        message: 'Position opened',
      }],
    });
  });

  it('rejects a payload that is not the journal contract', () => {
    expect(() => normalizeJournalResponse({ data: [] })).toThrow('Invalid Journal API response');
  });

  it('unwraps a v2 data envelope around the journal contract', () => {
    const response = normalizeJournalResponse({
      data: { count: 1, logs: [{ code: 0, type: 2, type_text: 'System', datetime: 1, source: 'Gateway', message: 'ok' }] },
    });
    expect(response.count).toBe(1);
    expect(response.logs[0]?.message).toBe('ok');
  });

  it('retains canonical backend latency and correlation for identical burst rows', () => {
    const commonLog = {
      code: 0,
      code_text: 'OK',
      type: 6,
      type_text: 'Trade',
      datetime: 1787754656,
      source: 'Gateway',
      message: 'Order sell XAUUSD 0.01 filled',
    };

    const response = normalizeJournalResponse({
      count: 2,
      logs: [
        {
          ...commonLog,
          id: 'fill-a',
          latency_ms: '8.125',
          client_order_id: 'client-a',
          request_id: 'request-a',
          order_ticket: '81001',
          position_ticket: 91001,
        },
        {
          ...commonLog,
          id: 'fill-b',
          latency_ms: 17.4,
          client_order_id: 'client-b',
          request_id: 'request-b',
          order_ticket: '81002',
          position_ticket: 91002,
        },
      ],
    });

    expect(response.logs).toEqual([
      expect.objectContaining({
        id: 'fill-a',
        latency_ms: 8.125,
        client_order_id: 'client-a',
        request_id: 'request-a',
        order_ticket: '81001',
        position_ticket: 91001,
      }),
      expect.objectContaining({
        id: 'fill-b',
        latency_ms: 17.4,
        client_order_id: 'client-b',
        request_id: 'request-b',
        order_ticket: '81002',
        position_ticket: 91002,
      }),
    ]);
  });

  it('omits missing or invalid latency instead of manufacturing zero', () => {
    const commonLog = {
      code: 0,
      code_text: 'OK',
      type: 6,
      type_text: 'Trade',
      datetime: 1787754656,
      source: 'Gateway',
      message: 'Order filled',
    };
    const response = normalizeJournalResponse({
      count: 6,
      logs: [
        { ...commonLog, id: 'missing' },
        { ...commonLog, id: 'empty', latency_ms: '' },
        { ...commonLog, id: 'null', latency_ms: null },
        { ...commonLog, id: 'negative', latency_ms: -1 },
        { ...commonLog, id: 'not-finite', latency_ms: 'Infinity' },
        { ...commonLog, id: 'zero', latency_ms: '0' },
      ],
    });

    for (const log of response.logs.slice(0, 5)) {
      expect(log).not.toHaveProperty('latency_ms');
    }
    expect(response.logs[5]).toHaveProperty('latency_ms', 0);
  });

  it('moves known Gateway trade durations from Message into Latency', () => {
    const commonLog = {
      code: 0,
      code_text: 'OK',
      type: 6,
      type_text: 'Trade',
      datetime: 1787754656,
      source: 'Gateway',
    };
    const response = normalizeJournalResponse({
      count: 10,
      logs: [
        { ...commonLog, id: 'fill', message: 'Order buy XAUUSD 0.01 filled in 286ms' },
        { ...commonLog, id: 'timing', message: 'Timing buy XAUUSD 0.01: prep 0ns · exec 286ms · total 286ms' },
        { ...commonLog, id: 'close', message: 'Close sell BTCUSD ticket 4318 profit -0.96 in 423ms' },
        { ...commonLog, id: 'modify', message: 'Modify BTCUSD ticket 24137 in 10ms' },
        { ...commonLog, id: 'close-filled', message: 'Order close 1354736 BTCUSD 0.00 filled in 37ms' },
        { ...commonLog, id: 'close-succeeded', message: 'Order close 1354741 BTCUSD 0.01 succeeded in 94ms' },
        { ...commonLog, id: 'close-timing', message: 'Timing close 1354736 BTCUSD 0.00: prep 3ms · exec 33ms · total 37ms' },
        { ...commonLog, id: 'microseconds', message: 'Order sell EURUSD 0.01 filled in 750µs' },
        { ...commonLog, id: 'nanoseconds', message: 'Order sell USDJPY 0.01 filled in 900ns' },
        { ...commonLog, id: 'seconds', message: 'Order buy GBPUSD 0.01 filled in 1.25s' },
      ],
    });

    expect(response.logs).toEqual([
      expect.objectContaining({ id: 'fill', latency_ms: 286, message: 'Order buy XAUUSD 0.01 filled' }),
      expect.objectContaining({ id: 'timing', latency_ms: 286, message: 'Timing buy XAUUSD 0.01' }),
      expect.objectContaining({ id: 'close', latency_ms: 423, message: 'Close sell BTCUSD ticket 4318 profit -0.96' }),
      expect.objectContaining({ id: 'modify', latency_ms: 10, message: 'Modify BTCUSD ticket 24137' }),
      expect.objectContaining({ id: 'close-filled', latency_ms: 37, message: 'Order close 1354736 BTCUSD 0.00 filled' }),
      expect.objectContaining({ id: 'close-succeeded', latency_ms: 94, message: 'Order close 1354741 BTCUSD 0.01 succeeded' }),
      expect.objectContaining({ id: 'close-timing', latency_ms: 37, message: 'Timing close 1354736 BTCUSD 0.00' }),
      expect.objectContaining({ id: 'microseconds', latency_ms: 0.75, message: 'Order sell EURUSD 0.01 filled' }),
      expect.objectContaining({ id: 'nanoseconds', latency_ms: 0.0009, message: 'Order sell USDJPY 0.01 filled' }),
      expect.objectContaining({ id: 'seconds', latency_ms: 1250, message: 'Order buy GBPUSD 0.01 filled' }),
    ]);
  });

  it('never treats a quote-age rejection as order latency', () => {
    const message = 'Order rejected buy BTCUSD 0.01: Quote is stale for BTCUSD in 2556ms';
    const response = normalizeJournalResponse({
      count: 1,
      logs: [{
        id: 'stale-quote',
        code: 1,
        code_text: 'ERROR',
        type: 6,
        type_text: 'Trade',
        datetime: 1787754656,
        source: 'Gateway',
        message,
      }],
    });

    expect(response.logs[0]).not.toHaveProperty('latency_ms');
    expect(response.logs[0]?.message).toBe(message);
  });

  it('prefers canonical backend latency while still cleaning the known message suffix', () => {
    const response = normalizeJournalResponse({
      count: 1,
      logs: [{
        id: 'canonical',
        latency_ms: 12.5,
        code: 0,
        code_text: 'OK',
        type: 6,
        type_text: 'Trade',
        datetime: 1787754656,
        source: 'Gateway',
        message: 'Order sell XAUUSD 0.01 filled in 286ms',
      }],
    });

    expect(response.logs[0]).toEqual(expect.objectContaining({
      latency_ms: 12.5,
      message: 'Order sell XAUUSD 0.01 filled',
    }));
  });
});
