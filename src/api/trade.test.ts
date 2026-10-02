import { afterEach, beforeEach, describe, expect, expectTypeOf, it, vi } from 'vitest';
import { installTestBrokerRuntime } from '../test/brokerRuntime';
import { API_ENDPOINTS, RTX5_API_URL } from '../config/api';
import { apiClient, ApiError, removeToken, setToken } from './client';
import { marketApi } from './endpoints';
import type { CandleParams, HistoryCandleParams } from '../types/api';
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

type TestWindow = Window & { electronAPI?: unknown };

const createDeferred = <T,>() => {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
};

const abortLifecycleCalls = [
  {
    method: 'GET',
    invoke: (signal: AbortSignal) => apiClient.get('/abort-lifecycle', {
      baseUrl: 'https://broker.example',
      skipDynamicUrl: true,
      signal,
    }),
  },
  {
    method: 'POST',
    invoke: (signal: AbortSignal) => apiClient.post('/abort-lifecycle', { value: 1 }, {
      baseUrl: 'https://broker.example',
      skipDynamicUrl: true,
      signal,
    }),
  },
  {
    method: 'PUT',
    invoke: (signal: AbortSignal) => apiClient.put('/abort-lifecycle', { value: 1 }, {
      baseUrl: 'https://broker.example',
      skipDynamicUrl: true,
      signal,
    }),
  },
  {
    method: 'PATCH',
    invoke: (signal: AbortSignal) => apiClient.patch('/abort-lifecycle', { value: 1 }, {
      baseUrl: 'https://broker.example',
      skipDynamicUrl: true,
      signal,
    }),
  },
  {
    method: 'DELETE',
    invoke: (signal: AbortSignal) => apiClient.delete('/abort-lifecycle', {
      baseUrl: 'https://broker.example',
      skipDynamicUrl: true,
      signal,
    }),
  },
] as const;

describe('trade v2 API contract calls', () => {
  let restoreBrokerRuntime: () => void;
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn().mockImplementation(() => Promise.resolve(jsonResponse({ ok: true }))));
    delete (window as TestWindow).electronAPI;
    localStorage.clear();
    removeToken();
    restoreBrokerRuntime = installTestBrokerRuntime();
    localStorage.setItem('broker_id', 'test-broker');
    localStorage.setItem('server_url', 'https://broker.example');
  });

  afterEach(() => {
    delete (window as TestWindow).electronAPI;
    restoreBrokerRuntime();
    vi.unstubAllGlobals();
  });

  it('posts direct broker login credentials to the public v2 auth endpoint and persists returned tokens', async () => {
    const runtimePassword = crypto.randomUUID();
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse({
      token: 'jwt-token',
      refresh_token: 'refresh-token',
      expires_at: 1770000000,
      account_login: 123456,
      broker_id: 'test-broker',
    }));

    await authV2Api.login({
      username: 123456,
      broker_id: 'test-broker',
      password: runtimePassword,
    });

    const request = lastFetchCall();
    expect(request.url).toBe(`${RTX5_API_URL}/api/v2/auth/login`);
    expect(request.init.method).toBe('POST');
    expect(request.headers.Authorization).toBeUndefined();
    expect(request.body).toEqual({
      login: 123456,
      broker_id: 'test-broker',
      password: runtimePassword,
    });
    expect(localStorage.getItem('auth_token')).toBe('jwt-token');
    expect(localStorage.getItem('refresh_token')).toBe('refresh-token');
  });

  it('returns a deferred login response without persisting tokens when the dialog owns session completion', async () => {
    const response = createDeferred<Response>();
    vi.mocked(fetch).mockReturnValueOnce(response.promise);

    const login = authV2Api.login({
      username: 123456,
      broker_id: 'test-broker',
      password: 'FixturePassword123',
    }, { persistSession: false });

    response.resolve(jsonResponse({
      token: 'late-login-token',
      refresh_token: 'late-refresh-token',
      expires_at: 1770000000,
      account_login: 123456,
    }));

    await expect(login).resolves.toMatchObject({
      access_token: 'late-login-token',
      token: 'late-login-token',
      account_login: 123456,
    });
    expect(localStorage.getItem('auth_token')).toBeNull();
    expect(localStorage.getItem('refresh_token')).toBeNull();
    expect(localStorage.getItem('token_expires_at')).toBeNull();
  });

  it.each(['other-broker', 'TEST-BROKER'])('rejects login to %s before sending credentials', async brokerId => {
    await expect(authV2Api.login({ username: '123456', password: 'Password1', broker_id: brokerId }))
      .rejects.toThrow('only accepts accounts for its configured broker');
    expect(fetch).not.toHaveBeenCalled();
  });

  it.each(['other-broker', 'TEST-BROKER'])('does not save tokens returned for %s', async brokerId => {
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse({ token: 'wrong-token', broker_id: brokerId }));
    await expect(authV2Api.login({ username: '123456', password: 'Password1' }))
      .rejects.toThrow('different broker');
    expect(lastFetchCall().body.broker_id).toBe('test-broker');
    expect(localStorage.getItem('auth_token')).toBeNull();
  });

  it('does not save a login response after broker deployment changes', async () => {
    const deferred = createDeferred<Response>();
    vi.mocked(fetch).mockReturnValueOnce(deferred.promise);
    const request = authV2Api.login({ username: '123456', password: 'Password1' });
    const rejection = expect(request).rejects.toThrow();
    (window as Window & { __RTX_RUNTIME_CONFIG__?: Record<string, unknown> }).__RTX_RUNTIME_CONFIG__!.BROKER_ID = 'new-broker';
    deferred.resolve(jsonResponse({ token: 'old-token', broker_id: 'test-broker' }));
    await rejection;
    expect(localStorage.getItem('auth_token')).toBeNull();
  });

  it('does not retry direct broker login with legacy user/server credentials', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse({
      code: 'MT_RET_ERR_PARAMS',
      message: 'Login and password are required',
    }, { status: 400 }));

    await expect(authV2Api.login({
      username: '100001',
      password: 'FixturePassword123',
      broker_id: 'test-broker',
    })).rejects.toMatchObject({
      name: 'ApiError',
      status: 400,
    } satisfies Partial<ApiError>);

    expect(vi.mocked(fetch)).toHaveBeenCalledOnce();
    expect(lastFetchCall().body).toEqual({
      login: 100001,
      password: 'FixturePassword123',
      broker_id: 'test-broker',
    });
    expect(localStorage.getItem('auth_token')).toBeNull();
  });

  it('retries one completed 502 login response and persists the recovered session', async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(jsonResponse({ message: 'Bad gateway' }, { status: 502 }))
      .mockResolvedValueOnce(jsonResponse({
        access_token: 'recovered-access-token',
        refresh_token: 'recovered-refresh-token',
      }));

    const response = await authV2Api.login({
      username: '200001',
      password: 'FixturePassword123',
      broker_id: 'test-broker',
    });

    expect(vi.mocked(fetch)).toHaveBeenCalledTimes(2);
    expect(response.access_token).toBe('recovered-access-token');
    expect(localStorage.getItem('auth_token')).toBe('recovered-access-token');
    expect(localStorage.getItem('refresh_token')).toBe('recovered-refresh-token');
  });

  it('stops after one retry when login returns 502 twice', async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(jsonResponse({ message: 'Bad gateway' }, { status: 502 }))
      .mockResolvedValueOnce(jsonResponse({ message: 'Bad gateway' }, { status: 502 }));

    await expect(authV2Api.login({
      username: '200001',
      password: 'FixturePassword123',
      broker_id: 'test-broker',
    })).rejects.toMatchObject({
      name: 'ApiError',
      status: 502,
    } satisfies Partial<ApiError>);

    expect(vi.mocked(fetch)).toHaveBeenCalledTimes(2);
    expect(localStorage.getItem('auth_token')).toBeNull();
  });

  it.each([401, 403, 500])('does not retry a %s login response', async (status) => {
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse({ message: 'Login failed' }, { status }));

    await expect(authV2Api.login({
      username: '200001',
      password: 'FixturePassword123',
      broker_id: 'test-broker',
    })).rejects.toMatchObject({
      name: 'ApiError',
      status,
    } satisfies Partial<ApiError>);

    expect(vi.mocked(fetch)).toHaveBeenCalledOnce();
  });

  it('does not clear a newer token when an older protected request returns 401 late', async () => {
    let unauthorizedEvents = 0;
    window.addEventListener('auth:unauthorized', () => {
      unauthorizedEvents += 1;
    });
    setToken('old-token');
    vi.mocked(fetch).mockImplementationOnce(() => {
      setToken('new-token');
      return Promise.resolve(jsonResponse({ message: 'expired' }, { status: 401 }));
    });

    await expect(marketV2Api.getStatus()).rejects.toThrow(ApiError);

    expect(localStorage.getItem('auth_token')).toBe('new-token');
    expect(unauthorizedEvents).toBe(0);
  });

  it('stops after one authenticated retry when refreshed credentials are also rejected', async () => {
    setToken('expired-access-token');
    localStorage.setItem('refresh_token', 'refresh-token');
    vi.mocked(fetch)
      .mockResolvedValueOnce(jsonResponse({ message: 'expired' }, { status: 401 }))
      .mockResolvedValueOnce(jsonResponse({ access_token: 'refreshed-access-token' }))
      .mockResolvedValueOnce(jsonResponse({ message: 'still unauthorized' }, { status: 401 }));

    await expect(apiClient.get('/protected-after-refresh', {
      baseUrl: 'https://broker.example/api/v2',
      skipDynamicUrl: true,
    })).rejects.toMatchObject({
      name: 'ApiError',
      status: 401,
      message: 'Unauthorized',
    } satisfies Partial<ApiError>);

    expect(vi.mocked(fetch)).toHaveBeenCalledTimes(3);
    expect(String(vi.mocked(fetch).mock.calls[1]?.[0]))
      .toMatch(/\/api\/v2\/auth\/refresh$/);
    expect(new Headers(vi.mocked(fetch).mock.calls[2]?.[1]?.headers).get('Authorization'))
      .toBe('Bearer refreshed-access-token');
  });

  it.each(abortLifecycleCalls)(
    'keeps $method abort active after headers arrive and while the body is parsing',
    async ({ invoke }) => {
      const body = createDeferred<unknown>();
      const json = vi.fn(() => body.promise);
      vi.mocked(fetch).mockResolvedValueOnce({
        ok: true,
        status: 200,
        url: 'https://broker.example/abort-lifecycle',
        json,
      } as unknown as Response);
      const controller = new AbortController();
      const request = invoke(controller.signal);

      await vi.waitFor(() => expect(json).toHaveBeenCalledOnce());
      const rejection = expect(request).rejects.toMatchObject({ status: 0 });
      controller.abort();
      await rejection;
      body.resolve({ ok: true });

      expect(vi.mocked(fetch)).toHaveBeenCalledOnce();
    },
  );

  it('reports the internal request deadline as a timeout instead of an unexplained abort', async () => {
    vi.useFakeTimers();
    try {
      vi.mocked(fetch).mockImplementationOnce((_input, init) => new Promise((_resolve, reject) => {
        const signal = init?.signal;
        signal?.addEventListener('abort', () => reject(signal.reason), { once: true });
      }));

      const request = apiClient.get('/slow-request', {
        baseUrl: 'https://broker.example',
        skipDynamicUrl: true,
        skipAuth: true,
      });
      const observedResult = request.catch(error => error);

      await vi.advanceTimersByTimeAsync(30_000);
      await expect(observedResult).resolves.toMatchObject({
        status: 0,
        message: 'Request timed out after 30 seconds',
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it('lets authentication finish after the default 30-second API deadline', async () => {
    vi.useFakeTimers();
    try {
      let authSignal: AbortSignal | undefined;
      vi.mocked(fetch).mockImplementationOnce((_input, init) => new Promise((resolve, reject) => {
        authSignal = init?.signal ?? undefined;
        const responseTimer = setTimeout(() => resolve(jsonResponse({
          access_token: 'delayed-access-token',
          refresh_token: 'delayed-refresh-token',
          account_login: 200001,
        })), 31_000);
        authSignal?.addEventListener('abort', () => {
          clearTimeout(responseTimer);
          reject(authSignal?.reason);
        }, { once: true });
      }));

      const request = authV2Api.login({
        username: '200001',
        password: crypto.randomUUID(),
        broker_id: 'test-broker',
      });

      await vi.advanceTimersByTimeAsync(30_000);
      expect(authSignal?.aborted).toBe(false);

      await vi.advanceTimersByTimeAsync(1_000);
      await expect(request).resolves.toMatchObject({
        access_token: 'delayed-access-token',
        account_login: 200001,
      });
      expect(authSignal?.aborted).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it('uses the dedicated 90-second authentication deadline', async () => {
    vi.useFakeTimers();
    try {
      let authSignal: AbortSignal | undefined;
      vi.mocked(fetch).mockImplementationOnce((_input, init) => new Promise((_resolve, reject) => {
        authSignal = init?.signal ?? undefined;
        authSignal?.addEventListener('abort', () => reject(authSignal?.reason), { once: true });
      }));

      const request = authV2Api.login({
        username: '200001',
        password: crypto.randomUUID(),
        broker_id: 'test-broker',
      });
      const observedResult = request.catch(error => error);

      await vi.advanceTimersByTimeAsync(89_999);
      expect(authSignal?.aborted).toBe(false);

      await vi.advanceTimersByTimeAsync(1);
      await expect(observedResult).resolves.toMatchObject({
        status: 0,
        message: 'Request timed out after 90 seconds',
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it.each(abortLifecycleCalls)(
    'aborts the $method 401 refresh body and does not retry with refreshed credentials',
    async ({ invoke }) => {
      setToken('original-access-token');
      localStorage.setItem('refresh_token', 'original-refresh-token');
      const refreshBody = createDeferred<unknown>();
      const refreshJson = vi.fn(() => refreshBody.promise);
      vi.mocked(fetch)
        .mockResolvedValueOnce({
          ok: false,
          status: 401,
          url: 'https://broker.example/api/v2/abort-lifecycle',
          json: vi.fn(),
        } as unknown as Response)
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          url: 'https://broker.example/api/v2/auth/refresh',
          json: refreshJson,
        } as unknown as Response);
      const controller = new AbortController();
      const request = invoke(controller.signal);

      await vi.waitFor(() => expect(refreshJson).toHaveBeenCalledOnce());
      const rejection = expect(request).rejects.toMatchObject({ status: 0 });
      controller.abort();
      await rejection;
      refreshBody.resolve({ access_token: 'must-not-be-used' });

      expect(vi.mocked(fetch)).toHaveBeenCalledTimes(2);
      expect(localStorage.getItem('auth_token')).toBe('original-access-token');
    },
  );

  it('removes an aborted request from the 401 refresh queue before authenticated retries run', async () => {
    setToken('original-access-token');
    localStorage.setItem('refresh_token', 'original-refresh-token');
    const refreshBody = createDeferred<Record<string, string>>();
    const refreshJson = vi.fn(() => refreshBody.promise);
    let protectedCalls = 0;
    vi.mocked(fetch).mockImplementation((input, init) => {
      const url = String(input);
      if (url.includes('/auth/refresh')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          url,
          json: refreshJson,
        } as unknown as Response);
      }
      protectedCalls += 1;
      const authorization = new Headers(init?.headers).get('Authorization');
      if (authorization === 'Bearer refreshed-access-token') {
        return Promise.resolve({
          ok: true,
          status: 200,
          url,
          json: () => Promise.resolve({ ok: true }),
        } as unknown as Response);
      }
      return Promise.resolve({
        ok: false,
        status: 401,
        url,
        json: () => Promise.resolve({ message: 'expired' }),
      } as unknown as Response);
    });

    const firstController = new AbortController();
    const firstRequest = apiClient.get<{ ok: boolean }>('/protected-a', {
      baseUrl: 'https://broker.example/api/v2',
      skipDynamicUrl: true,
      signal: firstController.signal,
    });
    await vi.waitFor(() => expect(refreshJson).toHaveBeenCalledOnce());

    const queuedController = new AbortController();
    const queuedRequest = apiClient.get('/protected-b', {
      baseUrl: 'https://broker.example/api/v2',
      skipDynamicUrl: true,
      signal: queuedController.signal,
    });
    await vi.waitFor(() => expect(protectedCalls).toBe(2));
    const queuedRejection = expect(queuedRequest).rejects.toMatchObject({ status: 0 });
    queuedController.abort();
    await queuedRejection;

    refreshBody.resolve({ access_token: 'refreshed-access-token' });
    await expect(firstRequest).resolves.toEqual({ ok: true });
    expect(protectedCalls).toBe(3);
  });

  it('allows a queued 401 waiter to succeed when the request that started the shared refresh aborts', async () => {
    setToken('original-access-token');
    localStorage.setItem('refresh_token', 'original-refresh-token');
    const refreshBody = createDeferred<Record<string, string>>();
    const refreshJson = vi.fn(() => refreshBody.promise);
    let protectedCalls = 0;
    vi.mocked(fetch).mockImplementation((input, init) => {
      const url = String(input);
      if (url.includes('/auth/refresh')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          url,
          json: refreshJson,
        } as unknown as Response);
      }
      protectedCalls += 1;
      const authorization = new Headers(init?.headers).get('Authorization');
      if (authorization === 'Bearer refreshed-access-token') {
        return Promise.resolve({
          ok: true,
          status: 200,
          url,
          json: () => Promise.resolve({ ok: true }),
        } as unknown as Response);
      }
      return Promise.resolve({
        ok: false,
        status: 401,
        url,
        json: () => Promise.resolve({ message: 'expired' }),
      } as unknown as Response);
    });

    const leaderController = new AbortController();
    const leaderRequest = apiClient.get('/protected-leader', {
      baseUrl: 'https://broker.example/api/v2',
      skipDynamicUrl: true,
      signal: leaderController.signal,
    });
    await vi.waitFor(() => expect(refreshJson).toHaveBeenCalledOnce());

    const waiterRequest = apiClient.get<{ ok: boolean }>('/protected-waiter', {
      baseUrl: 'https://broker.example/api/v2',
      skipDynamicUrl: true,
    });
    await vi.waitFor(() => expect(protectedCalls).toBe(2));

    const leaderRejection = expect(leaderRequest).rejects.toMatchObject({ status: 0 });
    leaderController.abort();
    await leaderRejection;
    refreshBody.resolve({ access_token: 'refreshed-access-token' });

    await expect(waiterRequest).resolves.toEqual({ ok: true });
    expect(protectedCalls).toBe(3);
  });

  it('stops requestWithRetry immediately when aborted during backoff', async () => {
    vi.mocked(fetch).mockRejectedValue(new TypeError('offline'));
    const controller = new AbortController();
    const request = apiClient.requestWithRetry(
      'get',
      '/retry-abort',
      undefined,
      {
        baseUrl: 'https://broker.example',
        skipDynamicUrl: true,
        skipAuth: true,
        signal: controller.signal,
      },
    );

    await vi.waitFor(() => expect(fetch).toHaveBeenCalledOnce());
    const rejection = expect(request).rejects.toMatchObject({ name: 'AbortError' });
    controller.abort();

    await rejection;
    expect(fetch).toHaveBeenCalledOnce();
  });

  it('treats authToken null as explicitly unauthenticated on a 401 response', async () => {
    setToken('stored-access-token');
    localStorage.setItem('refresh_token', 'stored-refresh-token');
    let unauthorizedEvents = 0;
    const onUnauthorized = () => {
      unauthorizedEvents += 1;
    };
    window.addEventListener('auth:unauthorized', onUnauthorized);
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: false,
      status: 401,
      url: 'https://broker.example/api/v2/public-probe',
      json: () => Promise.resolve({ message: 'unauthorized' }),
    } as unknown as Response);

    try {
      await expect(apiClient.get('/public-probe', {
        baseUrl: 'https://broker.example/api/v2',
        skipDynamicUrl: true,
        authToken: null,
      })).rejects.toMatchObject({ status: 401 });

      expect(fetch).toHaveBeenCalledOnce();
      expect(new Headers(lastFetchCall().init.headers).get('Authorization')).toBeNull();
      expect(localStorage.getItem('auth_token')).toBe('stored-access-token');
      expect(localStorage.getItem('refresh_token')).toBe('stored-refresh-token');
      expect(unauthorizedEvents).toBe(0);
    } finally {
      window.removeEventListener('auth:unauthorized', onUnauthorized);
    }
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

    expect(lastFetchCall().body).toMatchObject({
      login: 123456,
    });
    expect(response.token).toBe('access-jwt-token');
    expect(response.access_token).toBe('access-jwt-token');
    expect(localStorage.getItem('auth_token')).toBe('access-jwt-token');
  });

  it('serializes numeric account usernames with the backend login field', async () => {
    const runtimePassword = crypto.randomUUID();
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse({
      access_token: 'access-jwt-token',
    }));

    await authV2Api.login({
      username: '100001',
      broker_id: 'test-broker',
      password: runtimePassword,
    });

    expect(lastFetchCall().body).toEqual({
      login: 100001,
      broker_id: 'test-broker',
      password: runtimePassword,
    });
  });

  it('preserves an explicit auth login baseUrl when a stale dynamic server is stored', async () => {
    (window as TestWindow).electronAPI = {};
    localStorage.setItem('server_url', 'https://stale-broker.example');
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse({
      access_token: 'access-jwt-token',
    }));

    await authV2Api.login({
      login: 100001,
      email: 'ignored@example.com',
      broker_id: 'testorrnn',
      password: 'FixturePassword123',
    }, { baseUrl: 'https://selected-broker.example/api/v2' });

    const request = lastFetchCall();
    expect(request.url).toBe('https://selected-broker.example/api/v2/auth/login');
    expect(request.body).toEqual({
      login: 100001,
      password: 'FixturePassword123',
      broker_id: 'testorrnn',
    });
    expect(request.body).not.toHaveProperty('username');
    expect(request.body).not.toHaveProperty('email');
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

  it('normalizes v2 candle aliases, millisecond ranges, and max limits', async () => {
    setToken('jwt-token');

    await marketV2Api.getCandles('EUR/USD', {
      timeframe: '15m',
      from: 1777593600000,
      to: 1780271999000,
      limit: 10_000,
    } as unknown as CandleParams);

    expect(lastFetchCall().url).toBe(
      `${RTX5_API_URL}/api/v2/candles/EUR%2FUSD?timeframe=M15&from=1777593600&to=1780271999&limit=5000`
    );

    await historyV2Api.getCandles('GBPUSD', {
      timeframe: '1h',
      from: 1777593600000,
      to: 1780271999000,
      limit: 6000,
    } as unknown as HistoryCandleParams);

    expect(lastFetchCall().url).toBe(
      `${RTX5_API_URL}/api/v2/candles/GBPUSD?timeframe=H1&from=1777593600&to=1780271999&limit=5000`
    );

    await marketApi.getOHLC('EUR/USD', '5m', 10_000);

    expect(lastFetchCall().url).toBe(
      `${RTX5_API_URL}/api/v2/candles/EUR%2FUSD?timeframe=M5&limit=5000`
    );
  });

  it('normalizes fallback instrument identity and trading flags', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse({
      symbols: [
        {
          id: 101,
          name: 'XAUUSD',
          description: 'Gold vs US Dollar',
          category: 'Metals',
          digits: 2,
          bid: 2330.12,
          ask: 2330.45,
          trading_enabled: false,
        },
      ],
    }));

    await expect(marketV2Api.getInstruments()).resolves.toEqual([
      expect.objectContaining({
        symbol: 'XAUUSD',
        name: 'XAUUSD',
        id: 101,
        description: 'Gold vs US Dollar',
        category: 'Metals',
        digits: 2,
        bid: 2330.12,
        ask: 2330.45,
        enabled: false,
      }),
    ]);
    expect(lastFetchCall().url).toBe(`${RTX5_API_URL}/api/v2/instruments`);
  });

  it('uses only authenticated v2 instruments for trade authorization symbols', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse({
      instruments: [
        { symbol: 'BTCUSD', enabled: true },
      ],
    }));

    await expect(marketV2Api.getAuthorizedInstruments()).resolves.toEqual([
      expect.objectContaining({ symbol: 'BTCUSD' }),
    ]);

    expect(vi.mocked(fetch)).toHaveBeenCalledTimes(1);
    expect(lastFetchCall().url).toBe(`${RTX5_API_URL}/api/v2/instruments`);
  });

  it('loads the account-scoped per-symbol specification resource', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse({
      symbol: 'XAUUSD',
      calc_mode: 'cfd_leverage',
      sessions: {
        monday: {
          quotes: [{ start: '00:00', end: '23:00' }],
          trade: [{ start: '00:00', end: '23:00' }],
        },
      },
    }));

    await expect(marketV2Api.getInstrumentSpecification(' xauusd ', 123456)).resolves.toEqual(
      expect.objectContaining({ symbol: 'XAUUSD', calc_mode: 'cfd_leverage' }),
    );
    expect(lastFetchCall().url).toBe(
      `${RTX5_API_URL}/api/v2/instruments/XAUUSD/specification?account_login=123456`,
    );
    expect(lastFetchCall().init.cache).toBe('no-store');
  });

  it('unwraps a specification response envelope without inventing catalog defaults', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse({
      data: {
        symbol: 'INTC',
        isin: 'US4581401001',
        trade_mode: 4,
      },
    }));

    const specification = await marketV2Api.getInstrumentSpecification('INTC', 123456);

    expect(specification).toEqual({
      symbol: 'INTC',
      isin: 'US4581401001',
      trade_mode: 4,
    });
    expect(specification).not.toHaveProperty('description');
    expect(specification).not.toHaveProperty('enabled');
    expect(specification).not.toHaveProperty('name');
    expect(specification).not.toHaveProperty('id');
  });

  it('rejects a mismatched symbol from the per-symbol specification resource', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse({
      symbol: 'EURUSD',
      digits: 5,
    }));

    await expect(marketV2Api.getInstrumentSpecification('XAUUSD', 123456)).resolves.toBeNull();
  });

  it('falls back to the exact catalog row when the detail contract is not deployed', async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(jsonResponse({ detail: 'Not Found' }, { status: 404 }))
      .mockResolvedValueOnce(jsonResponse([
      { symbol: 'EURUSD', digits: 5 },
      {
        symbol: 'XAUUSD',
        calc_mode: 'cfd_leverage',
        specification: {
          exchange: 'Orrnn',
          sessions: {
            monday: {
              quotes: [{ start: '00:00', end: '23:00' }],
              trade: [{ start: '00:00', end: '23:00' }],
            },
          },
        },
      },
      ]));

    await expect(marketV2Api.getInstrumentSpecification(' xauusd ')).resolves.toEqual(
      expect.objectContaining({
        symbol: 'XAUUSD',
        calc_mode: 'cfd_leverage',
        specification: expect.objectContaining({ exchange: 'Orrnn' }),
      }),
    );
    expect(lastFetchCall().url).toBe(
      `${RTX5_API_URL}/api/v2/instruments?symbol=XAUUSD&include=specification`,
    );
    expect(lastFetchCall().init.cache).toBe('no-store');
  });

  it('returns null when a specification fallback omits the requested symbol', async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(jsonResponse({ detail: 'Not Found' }, { status: 404 }))
      .mockResolvedValueOnce(jsonResponse([{ symbol: 'EURUSD' }]));

    await expect(marketV2Api.getInstrumentSpecification('XAUUSD')).resolves.toBeNull();
  });

  it('normalizes legacy market symbols with snake_case trading flags', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse({
      symbols: [
        {
          symbol: 'XAGUSD',
          description: 'Silver vs US Dollar',
          trading_enabled: false,
        },
      ],
    }));

    await expect(marketApi.getSymbols()).resolves.toEqual([
      expect.objectContaining({
        id: 'XAGUSD',
        name: 'XAGUSD',
        tradingEnabled: false,
      }),
    ]);
    expect(lastFetchCall().url).toBe(`${RTX5_API_URL}/api/v2/instruments`);
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

  it('does not mirror the bearer token into X-API-Key for normal session requests', async () => {
    setToken('jwt-token');

    await marketV2Api.getStatus();

    const request = lastFetchCall();
    expect(request.headers.Authorization).toBe('Bearer jwt-token');
    expect(request.headers['X-API-Key']).toBeUndefined();
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

    await historyV2Api.getCandles('EUR/USD', { timeframe: 'H1', limit: 500 });
    expect(lastFetchCall().url).toBe(`${RTX5_API_URL}/api/v2/candles/EUR%2FUSD?timeframe=H1&limit=500`);
    expect(lastFetchCall().headers.Authorization).toBeUndefined();

    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse([
      { time: 1760000000, open: 1, high: 2, low: 0.5, close: 1.5, volume: 5 },
    ]));
    await historyV2Api.getLatestCandle('EURUSD', 'M5');
    expect(lastFetchCall().url).toBe(`${RTX5_API_URL}/api/v2/candles/EURUSD?timeframe=M5&limit=5`);

    await historyV2Api.getTicks('EURUSD', { from: 1760000000, to: 1760000900, limit: 1000 });
    expect(lastFetchCall().url).toBe(
      `${RTX5_API_URL}/api/v2/ticks/EURUSD?from=1760000000&to=1760000900&limit=1000`
    );

    await watchlistV2Api.update(['EURUSD', 'XAUUSD']);
    expect(lastFetchCall()).toMatchObject({
      url: `${RTX5_API_URL}/api/v2/watchlist`,
      body: [
        { symbol: 'EURUSD', sort_order: 0 },
        { symbol: 'XAUUSD', sort_order: 1 },
      ],
    });
    expect(Array.isArray(lastFetchCall().body)).toBe(true);

    await watchlistV2Api.add('EUR/USD');
    expect(lastFetchCall().url).toBe(`${RTX5_API_URL}/api/v2/watchlist/EUR%2FUSD`);

    await watchlistV2Api.remove('EUR/USD');
    expect(lastFetchCall().url).toBe(`${RTX5_API_URL}/api/v2/watchlist/EUR%2FUSD`);
    expect(lastFetchCall().init.method).toBe('DELETE');
  });

  it('gets latest candles through the supported authenticated v2 candle route', async () => {
    setToken('jwt-token');
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse([
      { time: 1760000000, open: 1, high: 2, low: 0.5, close: 1.5, volume: 5 },
      { time: 1760003600, open: 1.5, high: 2.1, low: 1.4, close: 2, volume: 8 },
    ]));

    await expect(historyV2Api.getLatestCandle('EURUSD', 'H1')).resolves.toMatchObject({
      time: 1760003600,
      close: 2,
    });

    expect(vi.mocked(fetch).mock.calls.map(([url]) => String(url))).toEqual([
      `${RTX5_API_URL}/api/v2/candles/EURUSD?timeframe=H1&limit=5`,
    ]);
    expect(lastFetchCall().headers.Authorization).toBe('Bearer jwt-token');
  });

  it('propagates v2 candle history failures', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse(
      { message: 'Gateway candles unavailable' },
      { status: 503 }
    ));

    await expect(historyV2Api.getLatestCandle('EURUSD', 'H1')).rejects.toMatchObject({
      name: 'ApiError',
      status: 503,
      message: 'Gateway candles unavailable',
    } satisfies Partial<ApiError>);

    expect(vi.mocked(fetch)).toHaveBeenCalledOnce();
    expect(lastFetchCall().url).toBe(`${RTX5_API_URL}/api/v2/candles/EURUSD?timeframe=H1&limit=5`);
  });

  it('fails latest candle reads clearly when the v2 candle route returns no rows', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse([]));

    await expect(historyV2Api.getLatestCandle('EURUSD', 'H1')).rejects.toMatchObject({
      name: 'ApiError',
      status: 404,
      message: 'No candles returned by /api/v2/candles',
    } satisfies Partial<ApiError>);
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

    await tradingV2Api.modifyPosition(998877, { price_sl: 2320, price_tp: 2360, comment: 'updated-comment' });
    expect(lastFetchCall()).toMatchObject({
      url: `${RTX5_API_URL}/api/v2/positions/998877`,
      body: { price_sl: 2320, price_tp: 2360, comment: 'updated-comment' },
    });

    await tradingV2Api.cancelPendingOrder(112233);
    expect(lastFetchCall()).toMatchObject({
      url: `${RTX5_API_URL}/api/v2/orders/pending/112233`,
    });
    expect(lastFetchCall().init.method).toBe('DELETE');
  });

  it('posts the exact full-position close contract to the configured broker', async () => {
    setToken('close-access-token');

    vi.mocked(fetch).mockImplementationOnce(async (_url, init) => {
      const sent = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>;
      return jsonResponse({ ticket: 998877, status: 'closed', client_order_id: sent.client_order_id });
    });
    await tradingV2Api.closePosition(998877);

    const request = lastFetchCall();
    expect(request.url).toBe(`${RTX5_API_URL}/api/v2/positions/998877/close`);
    expect(request.init.method).toBe('POST');
    expect(new Headers(request.init.headers).get('Authorization')).toBe('Bearer close-access-token');
    expect(request.body.volume).toBe(0);
    expect(request.body.client_order_id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    );
  });

  it('normalizes pending order create payloads to backend-readable field names', async () => {
    await tradingV2Api.placePendingOrder({
      login: 123456,
      symbol: 'XAUUSD',
      side: 'buy',
      volume: 0.1,
      type: 'buy_limit',
      price: 2300,
      price_sl: 2290,
      price_tp: 2325,
      expiration: 1770000000,
      comment: 'pending-create',
    });

    expect(lastFetchCall()).toMatchObject({
      url: `${RTX5_API_URL}/api/v2/orders/pending`,
      body: {
        account_login: 123456,
        symbol: 'XAUUSD',
        side: 'buy',
        volume: 0.1,
        type: 'buy_limit',
        price: 2300,
        sl: 2290,
        tp: 2325,
        expiry: 1770000000,
        comment: 'pending-create',
      },
    });
    expect(lastFetchCall().body).not.toHaveProperty('login');
    expect(lastFetchCall().body).not.toHaveProperty('price_sl');
    expect(lastFetchCall().body).not.toHaveProperty('price_tp');
    expect(lastFetchCall().body).not.toHaveProperty('expiration');
  });

  it('normalizes pending order modify payloads to backend-readable aliases', async () => {
    await tradingV2Api.modifyPendingOrder(112233, {
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
