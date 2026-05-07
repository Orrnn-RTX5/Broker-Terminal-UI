import { API_BASE_URL } from '../config/api';

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

const getRefreshToken = (): string | null => {
  if (typeof window === 'undefined') return null;
  return localStorage.getItem('refresh_token');
};

// Set auth token in localStorage
export const setToken = (token: string): void => {
  if (typeof window === 'undefined') return;
  localStorage.setItem('auth_token', token);
};

export const setRefreshToken = (token: string): void => {
  if (typeof window === 'undefined') return;
  localStorage.setItem('refresh_token', token);
};

// Remove auth tokens from localStorage
export const removeToken = (): void => {
  if (typeof window === 'undefined') return;
  localStorage.removeItem('auth_token');
  localStorage.removeItem('refresh_token');
  localStorage.removeItem('token_expires_at');
};

// Build request headers
const buildHeaders = (customHeaders?: Record<string, string>, skipAuth?: boolean): Record<string, string> => {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...customHeaders,
  };

  if (!skipAuth) {
    const token = getToken();
    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }
  }

  return headers;
};

// Endpoints that should NOT carry an existing Bearer token
// (they authenticate via credentials in the body, not via the Authorization header)
const AUTH_ENDPOINTS = ['/api/login', '/api/refresh'];

// Build query string from params object
const buildQueryString = (params?: Record<string, any>): string => {
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
  resolve: (value?: any) => void;
  reject: (reason?: any) => void;
  config: RequestInit & { url: string };
}> = [];

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

      // If we don't have a refresh token or we failed on a refresh call itself
      if (!refreshToken || response.url.includes('/api/refresh')) {
        removeToken();
        window.dispatchEvent(new CustomEvent('auth:unauthorized'));
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
        const refreshResponse = await fetch(`${getBaseUrl()}/api/refresh`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ refresh_token: refreshToken }) // Note: Use the expected field name for your backend
        });

        if (!refreshResponse.ok) {
          throw new Error('Refresh failed');
        }

        const data = await refreshResponse.json();

        // Ensure new tokens are set
        if (data.access_token) {
          setToken(data.access_token);
          if (data.refresh_token) {
            setRefreshToken(data.refresh_token);
          }
          if (data.expires_at) {
            localStorage.setItem('token_expires_at', data.expires_at);
          }

          processQueue(null, data.access_token);

          // Retry the current failed request
          if (originalRequest) {
            if (!originalRequest.headers) originalRequest.headers = {};
            (originalRequest.headers as Record<string, string>)['Authorization'] = `Bearer ${data.access_token}`;
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
        window.dispatchEvent(new CustomEvent('auth:unauthorized'));
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
  params?: Record<string, any>;
  headers?: Record<string, string>;
  baseUrl?: string;
  /** If true, do NOT attach the stored Bearer token to this request */
  skipAuth?: boolean;
}

// Use the backend URL directly only in Electron; in the browser, use
// relative paths so requests go through the Vite dev-server proxy and avoid CORS.
const BACKEND_URL = 'https://rtxbackend.tradecopier.org';

const isElectronEnv = (): boolean => {
  if (typeof window === 'undefined') return false;
  return !!(window as any).electronAPI || window.location.protocol === 'file:' || navigator.userAgent.includes('Electron');
};

const getBaseUrl = (): string => {
  if (typeof window === 'undefined') return BACKEND_URL;
  // Use URL stored by Login (setBaseUrl) if available
  const stored = localStorage.getItem('api_base_url');
  if (stored) return stored;
  // In Electron, call backend directly; in browser, use Vite proxy (empty base)
  return isElectronEnv() ? BACKEND_URL : '';
};

// Set base URL in localStorage
export const setBaseUrl = (url: string): void => {
  if (typeof window === 'undefined') return;
  localStorage.setItem('api_base_url', url);
};

export const apiClient = {
  // GET request
  get: async <T>(endpoint: string, options?: ApiRequestOptions): Promise<T> => {
    const baseUrl = options?.baseUrl || getBaseUrl();
    // Ensure endpoint starts with / for proper URL construction
    const normalizedEndpoint = endpoint.startsWith('/') ? endpoint : `/${endpoint}`;
    const url = `${baseUrl}${normalizedEndpoint}${buildQueryString(options?.params)}`;
    console.log('[API Client] GET URL:', url);
    const shouldSkipAuth = options?.skipAuth || AUTH_ENDPOINTS.some(ep => normalizedEndpoint === ep);
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 30000);

    try {
      const reqConfig = {
        method: 'GET',
        headers: buildHeaders(options?.headers, shouldSkipAuth),
        signal: controller.signal,
        ...options,
      };
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
    const normalizedEndpoint = endpoint.startsWith('/') ? endpoint : `/${endpoint}`;
    const url = `${baseUrl}${normalizedEndpoint}${buildQueryString(options?.params)}`;
    console.log('[API Client] POST URL:', url);
    const shouldSkipAuth = options?.skipAuth || AUTH_ENDPOINTS.some(ep => normalizedEndpoint === ep);
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 30000);

    try {
      const reqConfig = {
        method: 'POST',
        headers: buildHeaders(options?.headers, shouldSkipAuth),
        body: JSON.stringify(body),
        signal: controller.signal,
        ...options,
      };
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
    const url = `${baseUrl}${endpoint}${buildQueryString(options?.params)}`;
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 30000);

    try {
      const reqConfig = {
        method: 'PUT',
        headers: buildHeaders(options?.headers),
        body: JSON.stringify(body),
        signal: controller.signal,
        ...options,
      };
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
    const url = `${baseUrl}${endpoint}${buildQueryString(options?.params)}`;
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 30000);

    try {
      const reqConfig = {
        method: 'PATCH',
        headers: buildHeaders(options?.headers),
        body: JSON.stringify(body),
        signal: controller.signal,
        ...options,
      };
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
    const url = `${baseUrl}${endpoint}${buildQueryString(options?.params)}`;
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 30000);

    try {
      const reqConfig = {
        method: 'DELETE',
        headers: buildHeaders(options?.headers),
        signal: controller.signal,
        ...options,
      };
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

  },
};

export default apiClient;
