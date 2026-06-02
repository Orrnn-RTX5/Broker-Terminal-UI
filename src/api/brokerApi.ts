/**
 * High-Performance BrokerAPI Client Singleton
 * Enforces dynamic broker server routing, proactive token refreshes (<60s expiry),
 * coalesced requests, reactive 401 retries, and custom trading error mappings.
 */

import { useAppStore } from '../store/useAppStore';
import { normalizeBrokerServerUrl, normalizeServerUrl, toLocalDevProxyUrl } from '../config/api';

export interface BrokerApiRequestOptions extends RequestInit {
  params?: Record<string, any>;
  skipAuth?: boolean;
}

export class BrokerApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public data?: unknown
  ) {
    super(message);
    this.name = 'BrokerApiError';
  }
}

// Maps server-side error keys to customer-friendly messages
export function mapBrokerError(errorStrOrCode: string): string {
  const code = String(errorStrOrCode || '').toUpperCase().trim();
  switch (code) {
    case 'UNAUTHORIZED':
      return 'Session expired or invalid credentials. Please log in again.';
    case 'BROKER_INACTIVE':
      return 'The selected broker server is currently offline. Please try again later.';
    case 'LICENSE_EXPIRED':
      return 'Your license has expired. Please renew your trading license to proceed.';
    case 'INSUFFICIENT_MARGIN':
      return 'Insufficient margin. You do not have enough funds to open this position.';
    case 'MARKET_CLOSED':
      return 'Trading is disabled. The market is currently closed for this symbol.';
    case 'INVALID_SL_TP':
      return 'Invalid Stop Loss or Take Profit levels. Please check your price offsets.';
    default:
      return errorStrOrCode || 'An unexpected trading error occurred.';
  }
}

export class BrokerAPI {
  private refreshPromise: Promise<string> | null = null;

  // Resolve base server URL from localStorage dynamically
  private getBaseUrl(): string {
    const url = localStorage.getItem('server_url');
    if (url) {
      return toLocalDevProxyUrl(normalizeBrokerServerUrl(url));
    }

    const brokerServer = localStorage.getItem('rtx_broker_server');
    if (brokerServer) {
      return toLocalDevProxyUrl(normalizeBrokerServerUrl(brokerServer));
    }

    const fallback = localStorage.getItem('api_base_url')
      || import.meta.env.VITE_RTX5_API_URL as string
      || import.meta.env.VITE_API_V2_URL as string
      || import.meta.env.VITE_API_URL as string
      || import.meta.env.VITE_BACKEND_URL as string
      || '';

    return toLocalDevProxyUrl(normalizeServerUrl(fallback));
  }

  // Prepend base URL to relative endpoints, append query params
  private buildUrl(endpoint: string, params?: Record<string, any>): string {
    const base = this.getBaseUrl();
    const cleanEndpoint = endpoint.startsWith('/') ? endpoint : `/${endpoint}`;
    
    let url = `${base}${cleanEndpoint}`;
    if (params && Object.keys(params).length > 0) {
      const qs = new URLSearchParams();
      Object.entries(params).forEach(([key, value]) => {
        if (value !== undefined && value !== null) {
          qs.append(key, String(value));
        }
      });
      const str = qs.toString();
      if (str) {
        url += `?${str}`;
      }
    }
    return url;
  }

  // Check if JWT token is expiring within 60s and refresh proactively
  public async checkAndProactiveRefresh(): Promise<string | null> {
    if (typeof window === 'undefined') return null;

    const expiresAtStr = localStorage.getItem('token_expires_at');
    const refreshToken = localStorage.getItem('refresh_token');
    const accessToken = localStorage.getItem('auth_token');

    if (!expiresAtStr || !refreshToken || !accessToken) {
      return accessToken;
    }

    let expiresAtMs = 0;
    if (/^\d+$/.test(expiresAtStr)) {
      const num = parseInt(expiresAtStr, 10);
      // Check if stored in seconds or milliseconds
      expiresAtMs = num < 100000000000 ? num * 1000 : num;
    } else {
      expiresAtMs = Date.parse(expiresAtStr);
    }

    const timeRemaining = expiresAtMs - Date.now();
    if (timeRemaining < 60 * 1000) {
      console.log(`[BrokerAPI] Proactive token refresh triggered. Time remaining: ${Math.round(timeRemaining / 1000)}s`);
      return this.coalesceRefresh(refreshToken);
    }

    return accessToken;
  }

  // Coalesce concurrent refresh triggers into a single shared Promise
  private coalesceRefresh(refreshToken: string): Promise<string> {
    if (this.refreshPromise) {
      return this.refreshPromise;
    }

    this.refreshPromise = (async () => {
      try {
        const url = `${this.getBaseUrl()}/api/v2/auth/refresh`;
        const response = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ refresh_token: refreshToken }),
        });

        if (!response.ok) {
          throw new Error(`Refresh request failed with HTTP ${response.status}`);
        }

        const data = await response.json();
        const nextToken = data.access_token || data.token;
        if (!nextToken) {
          throw new Error('Refresh response did not return an access token');
        }

        // Store tokens securely
        localStorage.setItem('auth_token', nextToken);
        if (data.refresh_token) {
          localStorage.setItem('refresh_token', data.refresh_token);
        }
        if (data.expires_at) {
          localStorage.setItem('token_expires_at', String(data.expires_at));
        } else if (data.expires_in) {
          localStorage.setItem('token_expires_at', String(Date.now() + data.expires_in * 1000));
        }

        // Update global Zustand store
        const expiresAtNum = data.expires_at ? (typeof data.expires_at === 'number' ? data.expires_at : Date.parse(data.expires_at)) : undefined;
        useAppStore.getState().setAuthTokens(nextToken, data.refresh_token, expiresAtNum);

        console.log('[BrokerAPI] Proactive token refresh succeeded');
        return nextToken;
      } catch (err) {
        console.error('[BrokerAPI] Token refresh failed. Logging out...', err);
        this.forceLogout();
        throw err;
      } finally {
        this.refreshPromise = null;
      }
    })();

    return this.refreshPromise;
  }

  private forceLogout() {
    localStorage.removeItem('auth_token');
    localStorage.removeItem('refresh_token');
    localStorage.removeItem('token_expires_at');
    useAppStore.getState().logout();
    window.dispatchEvent(new CustomEvent('auth:unauthorized'));
  }

  // Handle Response Parsing & Error Code Mapping
  private async handleResponse<T>(response: Response): Promise<T> {
    if (!response.ok) {
      let errCode = 'HTTP_ERROR';
      let errMsg = `HTTP Error: ${response.status}`;
      let errData: any = null;

      try {
        errData = await response.json();
        errCode = errData.error || errData.code || errCode;
        errMsg = errData.message || errData.error || errMsg;
      } catch (e) {
        // Fallback for non-JSON or blank responses
      }

      const friendlyMessage = mapBrokerError(errCode || errMsg);
      throw new BrokerApiError(response.status, errCode, friendlyMessage, errData);
    }

    if (response.status === 204) {
      return undefined as T;
    }

    return response.json() as Promise<T>;
  }

  // Execute Core HTTP Fetch
  private async executeFetch(
    url: string,
    options: RequestInit,
    skipAuth = false
  ): Promise<Response> {
    const headers = new Headers(options.headers || {});
    if (!headers.has('Content-Type') && !(options.body instanceof FormData)) {
      headers.set('Content-Type', 'application/json');
    }

    if (!skipAuth) {
      // 1. Proactive Refresh Check
      const activeToken = await this.checkAndProactiveRefresh();
      if (activeToken) {
        headers.set('Authorization', `Bearer ${activeToken}`);
      }
    }

    const mergedOptions: RequestInit = {
      ...options,
      headers,
    };

    return fetch(url, mergedOptions);
  }

  // Master Request pipeline with dynamic base, proactive refresh, and reactive 401 retry
  public async request<T>(
    method: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH',
    endpoint: string,
    body?: unknown,
    options?: BrokerApiRequestOptions
  ): Promise<T> {
    const url = this.buildUrl(endpoint, options?.params);
    const skipAuth = options?.skipAuth ?? false;

    const requestInit: RequestInit = {
      method,
      ...options,
    };
    if (body !== undefined) {
      requestInit.body = body instanceof FormData ? body : JSON.stringify(body);
    }

    try {
      let response = await this.executeFetch(url, requestInit, skipAuth);

      // Reactive 401 Handling & Retry Exactly Once
      if (response.status === 401 && !skipAuth) {
        console.warn(`[BrokerAPI] 401 Unauthorized received on ${endpoint}. Attempting reactive refresh...`);
        const refreshToken = localStorage.getItem('refresh_token');
        if (refreshToken) {
          try {
            await this.coalesceRefresh(refreshToken);
            // Retry the original request
            response = await this.executeFetch(url, requestInit, skipAuth);
          } catch (refreshErr) {
            console.error('[BrokerAPI] Reactive refresh failed, throwing 401 error.', refreshErr);
            this.forceLogout();
            throw new BrokerApiError(401, 'UNAUTHORIZED', mapBrokerError('UNAUTHORIZED'));
          }
        } else {
          this.forceLogout();
          throw new BrokerApiError(401, 'UNAUTHORIZED', mapBrokerError('UNAUTHORIZED'));
        }
      }

      return await this.handleResponse<T>(response);
    } catch (err) {
      if (err instanceof BrokerApiError) throw err;
      const message = err instanceof Error ? err.message : 'Network communication failure';
      throw new BrokerApiError(0, 'NETWORK_ERROR', message);
    }
  }

  public get<T>(endpoint: string, options?: BrokerApiRequestOptions): Promise<T> {
    return this.request<T>('GET', endpoint, undefined, options);
  }

  public post<T>(endpoint: string, body?: unknown, options?: BrokerApiRequestOptions): Promise<T> {
    return this.request<T>('POST', endpoint, body, options);
  }

  public put<T>(endpoint: string, body?: unknown, options?: BrokerApiRequestOptions): Promise<T> {
    return this.request<T>('PUT', endpoint, body, options);
  }

  public delete<T>(endpoint: string, options?: BrokerApiRequestOptions): Promise<T> {
    return this.request<T>('DELETE', endpoint, undefined, options);
  }
}

export const brokerApi = new BrokerAPI();
export default brokerApi;
