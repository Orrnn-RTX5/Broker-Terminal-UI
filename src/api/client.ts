import {
  API_V2_BASE_URL,
  BROKER_DISCOVERY_URL,
  DEV_BROKER_API_PROXY_PREFIX,
  DEV_BROKER_DISCOVERY_PROXY_PREFIX,
  normalizeBrokerServerUrl,
  toLocalDevProxyUrl,
} from '../config/api';
import { getBackendTarget, isDesktopBackendTarget, normalizeBrokerInfoForTarget } from '../config/backendTarget.js';
import { debugLog, redactUrlForDebugLog } from '../utils/debugLogging';

type DynamicBrokerTarget = {
  backend_url?: string;
  market_api_url?: string;
  server_url?: string;
  ws_url?: string;
  feed_url?: string;
};

type QueryParams = object;

const getDiscoveryHost = (): string => {
  try {
    return new URL(BROKER_DISCOVERY_URL).hostname || '';
  } catch {
    return '';
  }
};

export const getDynamicUrl = (url: string): string => {
  if (typeof window === 'undefined') return url;
  if (url.startsWith(DEV_BROKER_API_PROXY_PREFIX) || url.startsWith(DEV_BROKER_DISCOVERY_PROXY_PREFIX)) {
    return url;
  }

  const proxiedUrl = toLocalDevProxyUrl(url);
  if (proxiedUrl !== url) {
    return proxiedUrl;
  }

  const discoveryHost = getDiscoveryHost();
  if (discoveryHost && url.includes(discoveryHost)) {
    return url;
  }
  const targetBroker = normalizeBrokerInfoForTarget({
    backend_url: localStorage.getItem('backend_url') || '',
    market_api_url: localStorage.getItem('market_api_url') || '',
    server_url: localStorage.getItem('server_url') || localStorage.getItem('rtx_broker_server') || '',
    ws_url: localStorage.getItem('ws_url') || '',
    feed_url: localStorage.getItem('feed_url') || '',
  }) as DynamicBrokerTarget;
  const serverUrl = isDesktopBackendTarget()
    ? normalizeBrokerServerUrl(targetBroker.server_url || '')
    : String(targetBroker.server_url || '').trim().replace(/\/+$/, '');
  if (!serverUrl) return url;

  try {
    // If the URL is relative, prepend the serverUrl
    if (url.startsWith('/')) {
      const cleanServer = serverUrl.replace(/\/$/, '');
      return toLocalDevProxyUrl(`${cleanServer}${url}`);
    }

    // If it's a full URL, parse it
    const parsedUrl = new URL(url);
    const parsedServer = new URL(serverUrl);

    // Replace the protocol, host (hostname + port)
    parsedUrl.protocol = parsedServer.protocol;
    parsedUrl.host = parsedServer.host;

    return toLocalDevProxyUrl(parsedUrl.toString());
  } catch (e) {
    console.error('[Dynamic URL] Failed to parse URL:', url, e);
    return url;
  }
};


// Custom error class for API errors
export class ApiError extends Error {
  constructor(
    public status: number,
    public message: string,
    public data?: unknown
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

// Get auth token from localStorage
const getToken = (): string | null => {
  if (typeof window === 'undefined') return null;
  return localStorage.getItem('auth_token') || sessionStorage.getItem('auth_token');
};

export const getAuthToken = getToken;

const getRefreshToken = (): string | null => {
  if (typeof window === 'undefined') return null;
  return localStorage.getItem('refresh_token') || sessionStorage.getItem('refresh_token');
};

export const parseTokenExpiresAt = (expiresAt: unknown): number | null => {
  if (expiresAt === undefined || expiresAt === null || expiresAt === '') return null;

  if (typeof expiresAt === 'number' && Number.isFinite(expiresAt)) {
    return expiresAt < 100000000000 ? expiresAt * 1000 : expiresAt;
  }

  const raw = String(expiresAt).trim();
  if (/^\d+$/.test(raw)) {
    const numeric = Number(raw);
    return numeric < 100000000000 ? numeric * 1000 : numeric;
  }

  const parsed = Date.parse(raw);
  return Number.isNaN(parsed) ? null : parsed;
};

export const getStoredTokenExpiresAt = (): number | null => {
  if (typeof window === 'undefined') return null;
  return parseTokenExpiresAt(localStorage.getItem('token_expires_at') || sessionStorage.getItem('token_expires_at'));
};

export const isStoredTokenExpired = (skewMs = 0): boolean => {
  const expiresAt = getStoredTokenExpiresAt();
  return Boolean(expiresAt && expiresAt <= Date.now() + skewMs);
};

const dispatchTokenUpdated = (): void => {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new Event('auth:token-updated'));
};

// Set auth token in localStorage
export const setToken = (token: string): void => {
  if (typeof window === 'undefined') return;
  localStorage.setItem('auth_token', token);
  dispatchTokenUpdated();
};

export const setRefreshToken = (token: string): void => {
  if (typeof window === 'undefined') return;
  localStorage.setItem('refresh_token', token);
  dispatchTokenUpdated();
};

// Remove auth tokens from localStorage
export const removeToken = (): void => {
  if (typeof window === 'undefined') return;
  localStorage.removeItem('auth_token');
  localStorage.removeItem('refresh_token');
  localStorage.removeItem('token_expires_at');
  sessionStorage.removeItem('auth_token');
  sessionStorage.removeItem('refresh_token');
  sessionStorage.removeItem('token_expires_at');
  dispatchTokenUpdated();
};

// Build request headers
const buildHeaders = (
  customHeaders?: Record<string, string>,
  skipAuth?: boolean,
  authToken?: string | null,
): Record<string, string> => {
  const headers: Record<string, string> = {
    ...customHeaders,
    'Content-Type': 'application/json',
  };

  if (!skipAuth) {
    const token = authToken === undefined ? getToken() : authToken;
    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }
  }

  return headers;
};

// Endpoints that should NOT carry an existing Bearer token
// (they authenticate via credentials in the body, not via the Authorization header)
const AUTH_ENDPOINTS = ['/api/login', '/api/refresh', '/api/v2/auth/login', '/api/v2/auth/refresh', '/auth/login', '/auth/refresh'];

// Build query string from params object
const buildQueryString = (params?: QueryParams): string => {
  if (!params || Object.keys(params).length === 0) return '';
  const searchParams = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== null) {
      searchParams.append(key, String(value));
    }
  });
  const qs = searchParams.toString();
  return qs ? `?${qs}` : '';
};

export interface ApiRequestContext {
  /** Opaque identity for one backend + broker + authenticated session. */
  readonly key: string;
  readonly backendOrigin: string;
  readonly refreshEndpoint: string;
  readonly refreshToken: string | null;
}

interface RefreshState {
  promise: Promise<string>;
  controller: AbortController;
}

const refreshStates = new Map<string, RefreshState>();
const requestContextFingerprintSeed = Math.floor(Math.random() * 0xffffffff) >>> 0;

const getOpaqueRequestContextFingerprint = (...parts: Array<string | null>): string => {
  let hash = (0x811c9dc5 ^ requestContextFingerprintSeed) >>> 0;
  parts.forEach((part) => {
    const value = part ?? '';
    for (let index = 0; index < value.length; index += 1) {
      hash = Math.imul(hash ^ value.charCodeAt(index), 0x01000193) >>> 0;
    }
    hash = Math.imul(hash ^ 0xff, 0x01000193) >>> 0;
  });
  return hash.toString(36);
};

const getHeaderValue = (headers: HeadersInit | undefined, key: string): string | null => {
  if (!headers) return null;
  if (headers instanceof Headers) return headers.get(key);
  if (Array.isArray(headers)) {
    const found = headers.find(([name]) => name.toLowerCase() === key.toLowerCase());
    return found?.[1] ?? null;
  }
  return headers[key] ?? headers[key.toLowerCase()] ?? null;
};

const getRequestBearerToken = (request?: RequestInit): string | null => {
  const authHeader = getHeaderValue(request?.headers, 'Authorization');
  const match = authHeader?.match(/^Bearer\s+(.+)$/i);
  return match?.[1] ?? null;
};

const isStaleUnauthorized = (request?: RequestInit): boolean => {
  const requestToken = getRequestBearerToken(request);
  const currentToken = getToken();
  return Boolean(requestToken && currentToken && requestToken !== currentToken);
};

const dispatchUnauthorized = (request?: RequestInit): void => {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent('auth:unauthorized', {
    detail: {
      staleRequest: isStaleUnauthorized(request),
    },
  }));
};

const getAbortReason = (signal: AbortSignal): Error => {
  if (signal.reason instanceof Error) return signal.reason;
  return new DOMException('The operation was aborted', 'AbortError');
};

const throwIfAborted = (signal?: AbortSignal): void => {
  if (signal?.aborted) throw getAbortReason(signal);
};

const awaitWithAbort = <T>(promise: Promise<T>, signal?: AbortSignal): Promise<T> => {
  if (!signal) return promise;
  throwIfAborted(signal);

  return new Promise<T>((resolve, reject) => {
    const onAbort = () => {
      cleanup();
      reject(getAbortReason(signal));
    };
    const cleanup = () => signal.removeEventListener('abort', onAbort);
    signal.addEventListener('abort', onAbort, { once: true });
    promise.then(
      (value) => {
        cleanup();
        resolve(value);
      },
      (error: unknown) => {
        cleanup();
        reject(error);
      },
    );
  });
};

const readResponseJson = <T>(response: Response, signal?: AbortSignal): Promise<T> =>
  awaitWithAbort(response.json() as Promise<T>, signal);

interface CapturedRequest {
  readonly url: string;
  readonly init: RequestInit;
  readonly context: ApiRequestContext | null;
  readonly authRecoveryEnabled: boolean;
}

const withBearerToken = (
  request: CapturedRequest,
  token: string,
): CapturedRequest => {
  const headers = new Headers(request.init.headers);
  headers.set('Authorization', `Bearer ${token}`);
  return { ...request, init: { ...request.init, headers } };
};

const isRequestContextCurrent = (request: CapturedRequest): boolean => {
  const requestAccessToken = getRequestBearerToken(request.init);
  return Boolean(
    requestAccessToken
    && requestAccessToken === getToken()
    && request.context?.refreshToken
    && request.context.refreshToken === getRefreshToken()
  );
};

// Handle HTTP response while retaining the caller's abort lifecycle through
// response parsing, refresh, and any authenticated retry.
const handleResponse = async <T>(
  response: Response,
  originalRequest?: CapturedRequest,
): Promise<T> => {
  const signal = originalRequest?.init.signal ?? undefined;
  throwIfAborted(signal);

  if (!response.ok) {
    if (response.status === 401) {
      const responseUrl = response.url || originalRequest?.url || '';
      const isAuthEndpoint = AUTH_ENDPOINTS.some((endpoint) => responseUrl.includes(endpoint));
      if (isAuthEndpoint) {
        const errorData: Record<string, unknown> =
          await readResponseJson<Record<string, unknown>>(response, signal)
          .catch((error: unknown): Record<string, unknown> => {
            throwIfAborted(signal);
            if (error instanceof DOMException && error.name === 'AbortError') throw error;
            return {};
          });
        const errorMessage = typeof errorData.message === 'string'
          ? errorData.message
          : typeof errorData.error === 'string'
            ? errorData.error
            : 'Authentication failed';
        throwIfAborted(signal);
        throw new ApiError(
          response.status,
          errorMessage,
          errorData,
        );
      }

      throwIfAborted(signal);
      const refreshToken = originalRequest?.context?.refreshToken ?? null;

      if (isStaleUnauthorized(originalRequest?.init)) {
        throw new ApiError(response.status, 'Stale unauthorized response ignored');
      }

      if (originalRequest && !originalRequest.authRecoveryEnabled) {
        throw new ApiError(response.status, 'Unauthorized');
      }

      if (!originalRequest?.context || !refreshToken || responseUrl.includes('/api/refresh')) {
        throwIfAborted(signal);
        if (!originalRequest || isRequestContextCurrent(originalRequest)) removeToken();
        dispatchUnauthorized(originalRequest?.init);
        throw new ApiError(response.status, 'Unauthorized / Session Expired');
      }

      const context = originalRequest.context;
      let refreshState = refreshStates.get(context.key);
      if (!refreshState) {
        const refreshController = new AbortController();
        const refreshTimeoutId = setTimeout(() => refreshController.abort(), 30000);
        const refreshPromise = (async (): Promise<string> => {
          const refreshResponse = await fetch(context.refreshEndpoint, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ refresh_token: refreshToken }),
            signal: refreshController.signal,
          });

          if (!refreshResponse.ok) {
            throw new Error('Refresh failed');
          }

          const data = await readResponseJson<Record<string, unknown>>(
            refreshResponse,
            refreshController.signal,
          );

          const nextAccessToken = typeof data.access_token === 'string'
            ? data.access_token
            : typeof data.token === 'string'
              ? data.token
              : null;
          if (!nextAccessToken) {
            throw new Error('No access token in refresh response');
          }

          if (isRequestContextCurrent(originalRequest)) {
            setToken(nextAccessToken);
            if (typeof data.refresh_token === 'string') {
              setRefreshToken(data.refresh_token);
            }
            if (data.expires_at) {
              const expiresAt = parseTokenExpiresAt(data.expires_at);
              localStorage.setItem('token_expires_at', String(expiresAt || data.expires_at));
            } else if (data.expires_in) {
              const expiresIn = Number(data.expires_in);
              if (Number.isFinite(expiresIn)) {
                localStorage.setItem('token_expires_at', String(Date.now() + expiresIn * 1000));
              }
            }
            dispatchTokenUpdated();
          }
          return nextAccessToken;
        })();
        refreshState = { promise: refreshPromise, controller: refreshController };
        refreshStates.set(context.key, refreshState);
        void refreshPromise.finally(() => {
          clearTimeout(refreshTimeoutId);
          if (refreshStates.get(context.key)?.promise === refreshPromise) {
            refreshStates.delete(context.key);
          }
        }).catch(() => undefined);
      }

      let accessToken: string;
      try {
        accessToken = await awaitWithAbort(refreshState.promise, signal);
      } catch (error) {
        if (signal?.aborted) throw getAbortReason(signal);
        if (error instanceof ApiError && error.message === 'Stale unauthorized response ignored') {
          throw error;
        }
        if (isRequestContextCurrent(originalRequest)) removeToken();
        dispatchUnauthorized(originalRequest.init);
        throw new ApiError(401, 'Session Expired');
      }

      throwIfAborted(signal);
      const retryRequest = withBearerToken(originalRequest, accessToken);
      const retryResponse = await fetch(retryRequest.url, retryRequest.init);
      throwIfAborted(signal);
      return handleResponse<T>(retryResponse, {
        ...retryRequest,
        authRecoveryEnabled: false,
      });
    }

    const errorData: Record<string, unknown> =
      await readResponseJson<Record<string, unknown>>(response, signal)
      .catch((error: unknown): Record<string, unknown> => {
        throwIfAborted(signal);
        if (error instanceof DOMException && error.name === 'AbortError') throw error;
        return {};
      });
    const errorMessage = typeof errorData.message === 'string'
      ? errorData.message
      : typeof errorData.error === 'string'
        ? errorData.error
        : `HTTP Error: ${response.status}`;
    throwIfAborted(signal);
    throw new ApiError(
      response.status,
      errorMessage,
      errorData,
    );
  }

  if (response.status === 204) {
    return undefined as T;
  }

  return readResponseJson<T>(response, signal);
};

// Main API client
// Delay utility for retries
const delay = (ms: number, signal?: AbortSignal): Promise<void> => {
  if (!signal) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
  throwIfAborted(signal);

  return new Promise<void>((resolve, reject) => {
    const timeoutId = setTimeout(() => {
      cleanup();
      resolve();
    }, ms);
    const onAbort = () => {
      cleanup();
      reject(getAbortReason(signal));
    };
    const cleanup = () => {
      clearTimeout(timeoutId);
      signal.removeEventListener('abort', onAbort);
    };
    signal.addEventListener('abort', onAbort, { once: true });
  });
};

const RETRY_ATTEMPTS = 3;

// Main API client
export interface ApiRequestOptions extends RequestInit {
  params?: QueryParams;
  headers?: Record<string, string>;
  baseUrl?: string;
  apiKey?: string;
  /** If true, do NOT attach the stored Bearer token to this request */
  skipAuth?: boolean;
  /** If true, use the provided baseUrl exactly without proxying or replacing its host from localStorage.server_url */
  skipDynamicUrl?: boolean;
  /**
   * Immutable token captured for a scoped request. `undefined` keeps the
   * default dynamic token lookup; `null` explicitly sends no Bearer token.
   */
  authToken?: string | null;
  /** Immutable refresh/session inputs captured with the request. */
  requestContext?: ApiRequestContext;
}

// Use the backend URL directly only in Electron; in the browser, use
// relative paths so requests go through the Vite dev-server proxy and avoid CORS.
const BACKEND_URL = import.meta.env.VITE_API_URL as string || getBackendTarget();

const getBaseUrl = (): string => {
  if (typeof window === 'undefined') return BACKEND_URL;
  // Use URL stored by Login (setBaseUrl) if available
  const stored = localStorage.getItem('api_base_url');
  if (stored) return stored;
  return getBackendTarget();
};

// Set base URL in localStorage
export const setBaseUrl = (url: string): void => {
  if (typeof window === 'undefined') return;
  localStorage.setItem('api_base_url', url);
};

const normalizeEndpoint = (endpoint: string): string =>
  endpoint.startsWith('/') ? endpoint : `/${endpoint}`;

const withApiKey = (headers: Record<string, string> | undefined, apiKey?: string): Record<string, string> | undefined => {
  if (!apiKey) return headers;
  return { ...headers, 'X-API-Key': apiKey };
};

const toRequestInit = (options?: ApiRequestOptions): RequestInit => {
  if (!options) return {};
  const requestInit: ApiRequestOptions = { ...options };
  delete requestInit.params;
  delete requestInit.baseUrl;
  delete requestInit.apiKey;
  delete requestInit.skipAuth;
  delete requestInit.skipDynamicUrl;
  delete requestInit.authToken;
  delete requestInit.requestContext;
  return requestInit;
};

const buildRequestUrl = (
  baseUrl: string,
  normalizedEndpoint: string,
  options?: ApiRequestOptions
): string => {
  const rawUrl = `${baseUrl}${normalizedEndpoint}${buildQueryString(options?.params)}`;
  return options?.skipDynamicUrl ? rawUrl : getDynamicUrl(rawUrl);
};

const buildRequestConfig = (
  method: string,
  options: ApiRequestOptions | undefined,
  shouldSkipAuth: boolean,
  signal: AbortSignal,
  body?: unknown
): RequestInit => {
  if (!shouldSkipAuth && options?.authToken === undefined && getToken() && isStoredTokenExpired()) {
    removeToken();
    dispatchUnauthorized();
    throw new ApiError(401, 'Session Expired');
  }

  const requestInit = toRequestInit(options);
  const config: RequestInit = {
    ...requestInit,
    method,
    headers: buildHeaders(
      withApiKey(options?.headers, options?.apiKey),
      shouldSkipAuth,
      options?.authToken,
    ),
    signal,
  };

  if (body !== undefined) {
    config.body = JSON.stringify(body);
  }

  return config;
};

const getUrlOrigin = (url: string): string => {
  try {
    return new URL(url, typeof window === 'undefined' ? 'http://localhost' : window.location.origin).origin;
  } catch {
    return '';
  }
};

const createLegacyRequestContext = (
  url: string,
  normalizedEndpoint: string,
  accessToken: string | null,
): ApiRequestContext | null => {
  const refreshToken = getRefreshToken();
  if (!accessToken || !refreshToken) return null;
  const refreshEndpoint = getDynamicUrl(
    normalizedEndpoint.startsWith('/api/v2/') || url.includes('/api/v2/')
    ? `${API_V2_BASE_URL}/auth/refresh`
    : `${getBaseUrl()}/api/refresh`,
  );
  const backendOrigin = getUrlOrigin(url);
  const brokerId = typeof window === 'undefined'
    ? ''
    : localStorage.getItem('broker_id') || localStorage.getItem('rtx_broker_id') || '';
  return Object.freeze({
    key: `legacy:${getOpaqueRequestContextFingerprint(backendOrigin, brokerId, accessToken, refreshToken)}`,
    backendOrigin,
    refreshEndpoint,
    refreshToken,
  });
};

const createRequestController = (externalSignal?: AbortSignal): {
  controller: AbortController;
  cleanup: () => void;
} => {
  const controller = new AbortController();
  const relayAbort = () => controller.abort(externalSignal?.reason);

  if (externalSignal?.aborted) {
    relayAbort();
  } else {
    externalSignal?.addEventListener('abort', relayAbort, { once: true });
  }

  return {
    controller,
    cleanup: () => externalSignal?.removeEventListener('abort', relayAbort),
  };
};

const executeRequest = async <T>(
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE',
  endpoint: string,
  options?: ApiRequestOptions,
  body?: unknown,
): Promise<T> => {
  const baseUrl = options?.baseUrl || getBaseUrl();
  const normalizedEndpoint = normalizeEndpoint(endpoint);
  const url = buildRequestUrl(baseUrl, normalizedEndpoint, options);
  if (method === 'GET' || method === 'POST') {
    debugLog(`[API Client] ${method} URL:`, redactUrlForDebugLog(url));
  }
  const shouldSkipAuth = Boolean(
    options?.skipAuth || AUTH_ENDPOINTS.some((authEndpoint) => normalizedEndpoint === authEndpoint),
  );
  const { controller, cleanup } = createRequestController(options?.signal);
  const timeoutId = setTimeout(() => controller.abort(), 30000);

  try {
    const requestConfig = buildRequestConfig(method, options, shouldSkipAuth, controller.signal, body);
    const requestContext = options?.authToken === null
      ? null
      : options?.requestContext
        ?? createLegacyRequestContext(
          url,
          normalizedEndpoint,
          getRequestBearerToken(requestConfig) ?? (options?.authToken === undefined ? getToken() : null),
        );
    const response = await fetch(url, requestConfig);
    return await handleResponse<T>(response, {
      url,
      init: requestConfig,
      context: requestContext,
      authRecoveryEnabled: !shouldSkipAuth && options?.authToken !== null,
    });
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw new ApiError(0, error instanceof Error ? error.message : 'Network error');
  } finally {
    clearTimeout(timeoutId);
    cleanup();
  }
};

export const apiClient = {
  // GET request
  get: <T>(endpoint: string, options?: ApiRequestOptions): Promise<T> =>
    executeRequest<T>('GET', endpoint, options),

  // POST request
  post: <T>(endpoint: string, body: unknown, options?: ApiRequestOptions): Promise<T> =>
    executeRequest<T>('POST', endpoint, options, body),

  // PUT request
  put: <T>(endpoint: string, body: unknown, options?: ApiRequestOptions): Promise<T> =>
    executeRequest<T>('PUT', endpoint, options, body),

  // PATCH request
  patch: <T>(endpoint: string, body: unknown, options?: ApiRequestOptions): Promise<T> =>
    executeRequest<T>('PATCH', endpoint, options, body),

  // DELETE request
  delete: <T>(endpoint: string, options?: ApiRequestOptions): Promise<T> =>
    executeRequest<T>('DELETE', endpoint, options),

  // Request with retry logic
  requestWithRetry: async <T>(
    method: 'get' | 'post' | 'put' | 'patch' | 'delete',
    endpoint: string,
    body?: unknown,
    options?: ApiRequestOptions
  ): Promise<T> => {
    let lastError: ApiError | Error | undefined;

    for (let attempt = 0; attempt < RETRY_ATTEMPTS; attempt++) {
      throwIfAborted(options?.signal);
      try {
        switch (method) {
          case 'get':
            return await apiClient.get<T>(endpoint, options);
          case 'post':
            return await apiClient.post<T>(endpoint, body, options);
          case 'put':
            return await apiClient.put<T>(endpoint, body, options);
          case 'patch':
            return await apiClient.patch<T>(endpoint, body, options);
          case 'delete':
            return await apiClient.delete<T>(endpoint, options);
        }
      } catch (error) {
        lastError = error as Error;
        throwIfAborted(options?.signal);

        // Don't retry on 401 or 403
        if (error instanceof ApiError && (error.status === 401 || error.status === 403)) {
          throw error;
        }

        // Don't retry on the last attempt
        if (attempt < RETRY_ATTEMPTS - 1) {
          await delay(1000 * Math.pow(2, attempt), options?.signal); // Exponential backoff
        }
      }
    }
    throw lastError instanceof ApiError ? lastError : new ApiError(0, lastError?.message || 'Request failed');
  },
};

export default apiClient;
