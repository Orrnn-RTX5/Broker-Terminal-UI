import {
  API_V2_BASE_URL,
  BROKER_DISCOVERY_URL,
  DEV_BROKER_API_PROXY_PREFIX,
  DEV_BROKER_DISCOVERY_PROXY_PREFIX,
  normalizeBrokerServerUrl,
  toLocalDevProxyUrl,
} from '../config/api';
import { getBackendTarget, isDesktopBackendTarget, normalizeBrokerInfoForTarget } from '../config/backendTarget.js';

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
  return localStorage.getItem('auth_token');
};

export const getAuthToken = getToken;

const getRefreshToken = (): string | null => {
  if (typeof window === 'undefined') return null;
  return localStorage.getItem('refresh_token');
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
  return parseTokenExpiresAt(localStorage.getItem('token_expires_at'));
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
  dispatchTokenUpdated();
};

// Build request headers
const buildHeaders = (customHeaders?: Record<string, string>, skipAuth?: boolean): Record<string, string> => {
  const headers: Record<string, string> = {
    ...customHeaders,
    'Content-Type': 'application/json',
  };

  if (!skipAuth) {
    const token = getToken();
    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
      if (!headers['X-API-Key']) {
        headers['X-API-Key'] = token;
      }
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

// Token Refresh State
let isRefreshing = false;
let failedQueue: Array<{
  resolve: (value: Response | PromiseLike<Response>) => void;
  reject: (reason?: unknown) => void;
  config: RequestInit & { url: string };
}> = [];

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
      requestToken: getRequestBearerToken(request),
    },
  }));
};

const processQueue = (error: Error | null, token: string | null = null) => {
  failedQueue.forEach(prom => {
    if (error) {
      prom.reject(error);
    } else if (token) {
      if (!prom.config.headers) prom.config.headers = {};
      (prom.config.headers as Record<string, string>)['Authorization'] = 'Bearer ' + token;
      // Retry the original request
      fetch(prom.config.url, prom.config)
        .then(res => prom.resolve(res))
        .catch(err => prom.reject(err));
    }
  });
  failedQueue = [];
};

// Handle HTTP response
const handleResponse = async <T>(response: Response, originalRequest?: RequestInit & { url: string }): Promise<T> => {
  if (!response.ok) {
    // Handle 401 Unauthorized
    if (response.status === 401) {
      // Skip the token-clearing / refresh flow for login & refresh endpoints.
      // These endpoints authenticate via credentials, not Bearer tokens, so a 401
      // here means the credentials are wrong — NOT that the session expired.
      const isAuthEndpoint = AUTH_ENDPOINTS.some(ep => response.url.includes(ep));
      if (isAuthEndpoint) {
        const errorData = await response.json().catch(() => ({}));
        throw new ApiError(
          response.status,
          errorData.message || errorData.error || 'Authentication failed',
          errorData
        );
      }

      const refreshToken = getRefreshToken();

      if (isStaleUnauthorized(originalRequest)) {
        throw new ApiError(response.status, 'Stale unauthorized response ignored');
      }

      // If we don't have a refresh token or we failed on a refresh call itself
      if (!refreshToken || response.url.includes('/api/refresh')) {
        removeToken();
        dispatchUnauthorized(originalRequest);
        throw new ApiError(response.status, 'Unauthorized / Session Expired');
      }

      if (isRefreshing) {
        // Queue the request
        return new Promise<Response>((resolve, reject) => {
          if (originalRequest) {
            failedQueue.push({ resolve, reject, config: originalRequest });
          } else {
            reject(new ApiError(401, 'Unauthorized request dropped'));
          }
        }).then(retryResp => handleResponse<T>(retryResp));
      }

      isRefreshing = true;

      try {
        const refreshEndpoint = getDynamicUrl(response.url.includes('/api/v2/')
          ? `${API_V2_BASE_URL}/auth/refresh`
          : `${getBaseUrl()}/api/refresh`);
        const refreshResponse = await fetch(refreshEndpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ refresh_token: refreshToken }) // Note: Use the expected field name for your backend
        });

        if (!refreshResponse.ok) {
          throw new Error('Refresh failed');
        }

        const data = await refreshResponse.json();

        // Ensure new tokens are set
        const accessToken = data.access_token || data.token;
        if (accessToken) {
          setToken(accessToken);
          if (data.refresh_token) {
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

          processQueue(null, accessToken);

          // Retry the current failed request
          if (originalRequest) {
            if (!originalRequest.headers) originalRequest.headers = {};
            (originalRequest.headers as Record<string, string>)['Authorization'] = `Bearer ${accessToken}`;
            const retryResp = await fetch(originalRequest.url, originalRequest);
            isRefreshing = false;
            return handleResponse<T>(retryResp);
          }
        } else {
          throw new Error('No access token in refresh response');
        }
      } catch (err) {
        processQueue(err as Error, null);
        removeToken();
        dispatchUnauthorized(originalRequest);
        throw new ApiError(401, 'Session Expired');
      } finally {
        isRefreshing = false;
      }
    }

    const errorData = await response.json().catch(() => ({}));
    throw new ApiError(
      response.status,
      errorData.message || errorData.error || `HTTP Error: ${response.status}`,
      errorData
    );
  }

  // Handle empty responses
  if (response.status === 204) {
    return undefined as T;
  }

  return response.json() as Promise<T>;
};

// Main API client
// Delay utility for retries
const delay = (ms: number): Promise<void> =>
  new Promise(resolve => setTimeout(resolve, ms));

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
  if (!shouldSkipAuth && getToken() && isStoredTokenExpired()) {
    removeToken();
    dispatchUnauthorized();
    throw new ApiError(401, 'Session Expired');
  }

  const requestInit = toRequestInit(options);
  const config: RequestInit = {
    ...requestInit,
    method,
    headers: buildHeaders(withApiKey(options?.headers, options?.apiKey), shouldSkipAuth),
    signal,
  };

  if (body !== undefined) {
    config.body = JSON.stringify(body);
  }

  return config;
};

export const apiClient = {
  // GET request
  get: async <T>(endpoint: string, options?: ApiRequestOptions): Promise<T> => {
    const baseUrl = options?.baseUrl || getBaseUrl();
    // Ensure endpoint starts with / for proper URL construction
    const normalizedEndpoint = normalizeEndpoint(endpoint);
    const url = buildRequestUrl(baseUrl, normalizedEndpoint, options);
    console.log('[API Client] GET URL:', url);
    const shouldSkipAuth = options?.skipAuth || AUTH_ENDPOINTS.some(ep => normalizedEndpoint === ep);
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 30000);

    try {
      const reqConfig = buildRequestConfig('GET', options, shouldSkipAuth, controller.signal);
      const response = await fetch(url, reqConfig);
      clearTimeout(timeoutId);
      return handleResponse<T>(response, { url, ...reqConfig });
    } catch (error) {
      clearTimeout(timeoutId);
      if (error instanceof ApiError) throw error;
      throw new ApiError(0, error instanceof Error ? error.message : 'Network error');
    }
  },

  // POST request
  post: async <T>(endpoint: string, body: unknown, options?: ApiRequestOptions): Promise<T> => {
    const baseUrl = options?.baseUrl || getBaseUrl();
    // Ensure endpoint starts with / for proper URL construction
    const normalizedEndpoint = normalizeEndpoint(endpoint);
    const url = buildRequestUrl(baseUrl, normalizedEndpoint, options);
    console.log('[API Client] POST URL:', url);
    const shouldSkipAuth = options?.skipAuth || AUTH_ENDPOINTS.some(ep => normalizedEndpoint === ep);
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 30000);

    try {
      const reqConfig = buildRequestConfig('POST', options, shouldSkipAuth, controller.signal, body);
      const response = await fetch(url, reqConfig);
      clearTimeout(timeoutId);
      return handleResponse<T>(response, { url, ...reqConfig });
    } catch (error) {
      clearTimeout(timeoutId);
      if (error instanceof ApiError) throw error;
      throw new ApiError(0, error instanceof Error ? error.message : 'Network error');
    }
  },

  // PUT request
  put: async <T>(endpoint: string, body: unknown, options?: ApiRequestOptions): Promise<T> => {
    const baseUrl = options?.baseUrl || getBaseUrl();
    const normalizedEndpoint = normalizeEndpoint(endpoint);
    const url = buildRequestUrl(baseUrl, normalizedEndpoint, options);
    const shouldSkipAuth = options?.skipAuth || AUTH_ENDPOINTS.some(ep => normalizedEndpoint === ep);
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 30000);

    try {
      const reqConfig = buildRequestConfig('PUT', options, shouldSkipAuth, controller.signal, body);
      const response = await fetch(url, reqConfig);
      clearTimeout(timeoutId);
      return handleResponse<T>(response, { url, ...reqConfig });
    } catch (error) {
      clearTimeout(timeoutId);
      if (error instanceof ApiError) throw error;
      throw new ApiError(0, error instanceof Error ? error.message : 'Network error');
    }
  },

  // PATCH request
  patch: async <T>(endpoint: string, body: unknown, options?: ApiRequestOptions): Promise<T> => {
    const baseUrl = options?.baseUrl || getBaseUrl();
    const normalizedEndpoint = normalizeEndpoint(endpoint);
    const url = buildRequestUrl(baseUrl, normalizedEndpoint, options);
    const shouldSkipAuth = options?.skipAuth || AUTH_ENDPOINTS.some(ep => normalizedEndpoint === ep);
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 30000);

    try {
      const reqConfig = buildRequestConfig('PATCH', options, shouldSkipAuth, controller.signal, body);
      const response = await fetch(url, reqConfig);
      clearTimeout(timeoutId);
      return handleResponse<T>(response, { url, ...reqConfig });
    } catch (error) {
      clearTimeout(timeoutId);
      if (error instanceof ApiError) throw error;
      throw new ApiError(0, error instanceof Error ? error.message : 'Network error');
    }
  },

  // DELETE request
  delete: async <T>(endpoint: string, options?: ApiRequestOptions): Promise<T> => {
    const baseUrl = options?.baseUrl || getBaseUrl();
    const normalizedEndpoint = normalizeEndpoint(endpoint);
    const url = buildRequestUrl(baseUrl, normalizedEndpoint, options);
    const shouldSkipAuth = options?.skipAuth || AUTH_ENDPOINTS.some(ep => normalizedEndpoint === ep);
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 30000);

    try {
      const reqConfig = buildRequestConfig('DELETE', options, shouldSkipAuth, controller.signal);
      const response = await fetch(url, reqConfig);
      clearTimeout(timeoutId);
      return handleResponse<T>(response, { url, ...reqConfig });
    } catch (error) {
      clearTimeout(timeoutId);
      if (error instanceof ApiError) throw error;
      throw new ApiError(0, error instanceof Error ? error.message : 'Network error');
    }
  },

  // Request with retry logic
  requestWithRetry: async <T>(
    method: 'get' | 'post' | 'put' | 'patch' | 'delete',
    endpoint: string,
    body?: unknown,
    options?: ApiRequestOptions
  ): Promise<T> => {
    let lastError: ApiError | Error | undefined;

    for (let attempt = 0; attempt < RETRY_ATTEMPTS; attempt++) {
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

        // Don't retry on 401 or 403
        if (error instanceof ApiError && (error.status === 401 || error.status === 403)) {
          throw error;
        }

        // Don't retry on the last attempt
        if (attempt < RETRY_ATTEMPTS - 1) {
          await delay(1000 * Math.pow(2, attempt)); // Exponential backoff
        }
      }
    }
    throw lastError instanceof ApiError ? lastError : new ApiError(0, lastError?.message || 'Request failed');
  },
};

export default apiClient;
