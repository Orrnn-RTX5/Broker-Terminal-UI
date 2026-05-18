import { beforeEach, describe, expect, expectTypeOf, it, vi } from 'vitest';
import { API_ENDPOINTS, RTX5_API_URL } from '../config/api';
import { ApiError, removeToken, setToken } from './client';
import {
  accountV2Api,
  authV2Api,
  brokerV2Api,
  historyV2Api,
  marketV2Api,
  tradingV2Api,
  watchlistV2Api,
  tradeApi,
} from './trade';

const jsonResponse = (body: unknown, init: ResponseInit = {}) =>
  new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
    ...init,
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

describe('trade v2 API contract calls', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn().mockImplementation(() => Promise.resolve(jsonResponse({ ok: true }))));
    localStorage.clear();
    removeToken();
  });

  it('posts login credentials to the public v2 auth endpoint and persists returned tokens', async () => {
    const runtimePassword = crypto.randomUUID();
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse({
      token: 'jwt-token',
      refresh_token: 'refresh-token',
      expires_at: 1770000000,
      account_login: 123456,
      broker_id: 'test_broker',
    }));

    await authV2Api.login({
      username: 123456,
      broker_id: 'test_broker',
      password: runtimePassword,
    });

    const request = lastFetchCall();
    expect(request.url).toBe(`${RTX5_API_URL}/api/v2/auth/login`);
    expect(request.init.method).toBe('POST');
    expect(request.headers.Authorization).toBeUndefined();
    expect(request.body).toEqual({
      username: 123456,
      broker_id: 'test_broker',
      password: runtimePassword,
    });
    expect(localStorage.getItem('auth_token')).toBe('jwt-token');
    expect(localStorage.getItem('refresh_token')).toBe('refresh-token');
  });

  it('also persists access_token-only login responses', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse({
      access_token: 'access-jwt-token',
      refresh_token: 'refresh-token',
    }));

    const response = await authV2Api.login({
      username: 123456,
      password: crypto.randomUUID(),
    });

    expect(response.token).toBe('access-jwt-token');
    expect(response.access_token).toBe('access-jwt-token');
    expect(localStorage.getItem('auth_token')).toBe('access-jwt-token');
  });

  it('uses v2 market-data paths and query names from the contract', async () => {
    setToken('jwt-token');

    await marketV2Api.getQuotes(['EURUSD', 'XAUUSD']);
    expect(lastFetchCall().url).toBe(`${RTX5_API_URL}/api/v2/quotes?symbols=EURUSD%2CXAUUSD`);

    await marketV2Api.getCandles('EUR/USD', {
      timeframe: 'M15',
      from: 1760000000,
      to: 1760000900,
      limit: 50,
    });

    const candleRequest = lastFetchCall();
    expect(candleRequest.url).toBe(
      `${RTX5_API_URL}/api/v2/candles/EUR%2FUSD?timeframe=M15&from=1760000000&to=1760000900&limit=50`
    );
    expect(candleRequest.headers.Authorization).toBe('Bearer jwt-token');
  });

  it('preserves protected auth, api key, and JSON content headers over custom headers', async () => {
    setToken('jwt-token');

    await marketV2Api.getDepth('EURUSD', undefined, {
      apiKey: 'runtime-api-key',
      headers: {
        Authorization: 'Bearer stale-token',
        'X-API-Key': 'stale-api-key',
        'Content-Type': 'text/plain',
      },
    });

    const request = lastFetchCall();
    expect(request.headers.Authorization).toBe('Bearer jwt-token');
    expect(request.headers['X-API-Key']).toBe('runtime-api-key');
    expect(request.headers['Content-Type']).toBe('application/json');
  });

  it('covers broker bootstrap, calculators, history, and watchlist contract endpoints', async () => {
    await brokerV2Api.getServers();
    expect(lastFetchCall().url).toBe(`${RTX5_API_URL}/api/v2/broker/servers`);
    expect(lastFetchCall().headers.Authorization).toBeUndefined();

    await brokerV2Api.getConfig('test_broker');
    expect(lastFetchCall().url).toBe(`${RTX5_API_URL}/api/v2/broker/config?broker_id=test_broker`);

    await marketV2Api.calculateMargin({
      account_login: 123456,
      symbol: 'XAUUSD',
      side: 'buy',
      volume: 0.1,
    });
    expect(lastFetchCall()).toMatchObject({
      url: `${RTX5_API_URL}/api/v2/calculate/margin`,
      body: { account_login: 123456, symbol: 'XAUUSD', side: 'buy', volume: 0.1 },
    });

    await marketV2Api.calculateProfit({
      symbol: 'XAUUSD',
      side: 'sell',
      volume: 0.1,
      open_price: 2330,
      close_price: 2320,
    });
    expect(lastFetchCall().url).toBe(`${RTX5_API_URL}/api/v2/calculate/profit`);

    await historyV2Api.getCandles('EUR/USD', { tf: 'H1', count: 500 });
    expect(lastFetchCall().url).toBe(`${RTX5_API_URL}/history/candles/EUR%2FUSD?tf=H1&count=500`);
    expect(lastFetchCall().headers.Authorization).toBeUndefined();

    await historyV2Api.getLatestCandle('EURUSD', 'M5');
    expect(lastFetchCall().url).toBe(`${RTX5_API_URL}/history/candles/EURUSD/latest?tf=M5`);

    await historyV2Api.getTicks('EURUSD', { from: 1760000000, to: 1760000900, limit: 1000 });
    expect(lastFetchCall().url).toBe(
      `${RTX5_API_URL}/history/ticks/EURUSD?from=1760000000&to=1760000900&limit=1000`
    );

    await watchlistV2Api.update(['EURUSD', 'XAUUSD']);
    expect(lastFetchCall()).toMatchObject({
      url: `${RTX5_API_URL}/api/v2/watchlist`,
      body: { symbols: ['EURUSD', 'XAUUSD'] },
    });

    await watchlistV2Api.add('EUR/USD');
    expect(lastFetchCall().url).toBe(`${RTX5_API_URL}/api/v2/watchlist/EUR%2FUSD`);

    await watchlistV2Api.remove('EUR/USD');
    expect(lastFetchCall().url).toBe(`${RTX5_API_URL}/api/v2/watchlist/EUR%2FUSD`);
    expect(lastFetchCall().init.method).toBe('DELETE');
  });

  it('falls back to v2 candle history when the history latest endpoint is unavailable', async () => {
    setToken('jwt-token');
    vi.mocked(fetch)
      .mockResolvedValueOnce(jsonResponse({ message: 'Bad gateway' }, { status: 502 }))
      .mockResolvedValueOnce(jsonResponse([
        { time: 1760000000, open: 1, high: 2, low: 0.5, close: 1.5, volume: 5 },
        { time: 1760003600, open: 1.5, high: 2.1, low: 1.4, close: 2, volume: 8 },
      ]));

    await expect(historyV2Api.getLatestCandle('EURUSD', 'H1')).resolves.toMatchObject({
      time: 1760003600,
      close: 2,
    });

    expect(vi.mocked(fetch).mock.calls.map(([url]) => String(url))).toEqual([
      `${RTX5_API_URL}/history/candles/EURUSD/latest?tf=H1`,
      `${RTX5_API_URL}/api/v2/candles/EURUSD?timeframe=H1&limit=5`,
    ]);
    expect(lastFetchCall().headers.Authorization).toBe('Bearer jwt-token');
  });

  it('does not fall back to v2 candle history for non-502 history latest errors', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse(
      { message: 'History request is forbidden' },
      { status: 403 }
    ));

    await expect(historyV2Api.getLatestCandle('EURUSD', 'H1')).rejects.toMatchObject({
      name: 'ApiError',
      status: 403,
      message: 'History request is forbidden',
    } satisfies Partial<ApiError>);

    expect(vi.mocked(fetch)).toHaveBeenCalledOnce();
    expect(lastFetchCall().url).toBe(`${RTX5_API_URL}/history/candles/EURUSD/latest?tf=H1`);
  });

  it('propagates v2 candle history fallback failures after a 502 history latest error', async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(jsonResponse({ message: 'Bad gateway' }, { status: 502 }))
      .mockResolvedValueOnce(jsonResponse(
        { message: 'Fallback candles unavailable' },
        { status: 503 }
      ));

    await expect(historyV2Api.getLatestCandle('EURUSD', 'H1')).rejects.toMatchObject({
      name: 'ApiError',
      status: 503,
      message: 'Fallback candles unavailable',
    } satisfies Partial<ApiError>);

    expect(vi.mocked(fetch).mock.calls.map(([url]) => String(url))).toEqual([
      `${RTX5_API_URL}/history/candles/EURUSD/latest?tf=H1`,
      `${RTX5_API_URL}/api/v2/candles/EURUSD?timeframe=H1&limit=5`,
    ]);
  });

  it('posts trading payloads to contract endpoints without reshaping order fields', async () => {
    const order = {
      login: 123456,
      symbol: 'XAUUSD',
      side: 'buy' as const,
      volume: 0.1,
      price_sl: 2310,
      price_tp: 2350,
      trailing_stop: 100,
      trailing_step: 10,
      comment: 'vitest-contract',
      magic: 42,
    };

    await tradingV2Api.placeOrder(order);
    expect(lastFetchCall()).toMatchObject({
      url: `${RTX5_API_URL}/api/v2/orders`,
      body: order,
    });

    await tradingV2Api.modifyPosition(998877, { price_sl: 2320, price_tp: 2360 });
    expect(lastFetchCall()).toMatchObject({
      url: `${RTX5_API_URL}/api/v2/positions/998877`,
      body: { price_sl: 2320, price_tp: 2360 },
    });

    await tradingV2Api.cancelPendingOrder(112233);
    expect(lastFetchCall()).toMatchObject({
      url: `${RTX5_API_URL}/api/v2/orders/pending/112233`,
    });
    expect(lastFetchCall().init.method).toBe('DELETE');
  });

  it('posts password updates to the v2 password endpoints without persisting secrets', async () => {
    await authV2Api.changePassword({
      current_password: 'old-runtime-password',
      new_password: 'new-runtime-password',
    });
    expect(lastFetchCall()).toMatchObject({
      url: `${RTX5_API_URL}/api/v2/auth/change-password`,
      body: {
        current_password: 'old-runtime-password',
        new_password: 'new-runtime-password',
      },
    });

    await accountV2Api.setInvestorPassword(123456, { password: 'investor-runtime-password' });
    expect(lastFetchCall()).toMatchObject({
      url: `${RTX5_API_URL}/api/v2/accounts/123456/investor-password`,
      body: { password: 'investor-runtime-password' },
    });

    expect(localStorage.getItem('old-runtime-password')).toBeNull();
    expect(localStorage.getItem('new-runtime-password')).toBeNull();
    expect(localStorage.getItem('investor-runtime-password')).toBeNull();
  });

  it('uses account-scoped paths for account, positions, deals, pending orders, and OCO', async () => {
    await accountV2Api.get(123456);
    expect(lastFetchCall().url).toBe(`${RTX5_API_URL}/api/v2/account/123456`);

    await accountV2Api.getBalanceHistory(123456, { limit: 25, offset: 50 });
    expect(lastFetchCall().url).toBe(
      `${RTX5_API_URL}/api/v2/accounts/123456/history?limit=25&offset=50`
    );

    await tradingV2Api.getPositions(123456, { limit: 20, offset: 0 });
    expect(lastFetchCall().url).toBe(
      `${RTX5_API_URL}/api/v2/positions/123456?limit=20&offset=0`
    );

    await tradingV2Api.getDeals(123456);
    expect(lastFetchCall().url).toBe(`${RTX5_API_URL}/api/v2/deals/123456`);

    await tradingV2Api.getPendingOrders(123456);
    expect(lastFetchCall().url).toBe(`${RTX5_API_URL}/api/v2/orders/pending/123456`);

    await tradingV2Api.getOcoPairs(123456);
    expect(lastFetchCall().url).toBe(`${RTX5_API_URL}/api/v2/orders/oco/123456`);
  });

  it('does not expose excluded non-trade v2 helper groups', () => {
    expect(authV2Api).not.toHaveProperty('register');
    expect(authV2Api).not.toHaveProperty('listApiKeys');
    expect(authV2Api).not.toHaveProperty('createApiKey');
    expect(authV2Api).not.toHaveProperty('revokeApiKey');
    expect(authV2Api).not.toHaveProperty('listSessions');
    expect(authV2Api).not.toHaveProperty('logoutAllSessions');
    expect(authV2Api).not.toHaveProperty('revokeSession');
    expect(accountV2Api).not.toHaveProperty('update');
    expect(accountV2Api).not.toHaveProperty('getAuditLog');
    expect(tradeApi).not.toHaveProperty('alerts');

    expect(API_ENDPOINTS.v2.auth).not.toHaveProperty('register');
    expect(API_ENDPOINTS.v2.auth).not.toHaveProperty('keys');
    expect(API_ENDPOINTS.v2.auth).not.toHaveProperty('sessions');
    expect(API_ENDPOINTS.v2.account).not.toHaveProperty('update');
    expect(API_ENDPOINTS.v2.account).not.toHaveProperty('audit');
    expect(API_ENDPOINTS.v2).not.toHaveProperty('alerts');
  });

  it('exposes close-all closed_count from the contract response while preserving closed compatibility', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse({
      closed_count: 3,
      message: 'Closed all positions',
    }));

    const response = await accountV2Api.closeAllPositions(123456);

    expect(lastFetchCall()).toMatchObject({
      url: `${RTX5_API_URL}/api/v2/accounts/123456/close-all`,
      body: {},
    });
    expect(response.closed_count).toBe(3);
    expectTypeOf(response.closed_count).toEqualTypeOf<number | undefined>();
    expectTypeOf(response.closed).toEqualTypeOf<number | undefined>();
  });

  it('raises ApiError with the backend error payload message', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse(
      { error: 'invalid_stops', message: 'SL/TP violates current market price' },
      { status: 400 }
    ));

    await expect(tradingV2Api.placeOrder({
      login: 123456,
      symbol: 'EURUSD',
      side: 'sell',
      volume: 0.2,
      price_sl: 1.1,
    })).rejects.toMatchObject({
      name: 'ApiError',
      status: 400,
      message: 'SL/TP violates current market price',
      data: { error: 'invalid_stops', message: 'SL/TP violates current market price' },
    } satisfies Partial<ApiError>);
  });
});
