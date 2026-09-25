import { apiClient, getAuthToken, getDynamicUrl, isStoredTokenExpired, type ApiRequestOptions } from '../api/client';
import { API_V2_BASE_URL } from '../config/api';
import {
  getCommittedBrokerAccountSessionScope,
  getCommittedBrokerAccountSessionScopeKey,
  onCommittedBrokerAccountSessionScopeChange,
  onSessionChange,
} from './brokerSession';

interface InstrumentRequest {
  promise: Promise<unknown>;
  controller: AbortController;
  consumers: number;
  settled: boolean;
}

const inFlight = new Map<string, InstrumentRequest>();
// Returning to an earlier account must not rejoin its previous session's read.
onCommittedBrokerAccountSessionScopeChange(() => inFlight.clear());
onSessionChange(() => inFlight.clear());

const shareableOptions = new Set(['baseUrl', 'authToken', 'requestContext', 'skipDynamicUrl', 'signal', 'timeoutMs']);
const abortError = () => new DOMException('The request was aborted.', 'AbortError');

/** Shares only concurrent, identical authorized catalog reads; never stores a result. */
export const loadSharedAuthenticatedInstruments = (
  options: ApiRequestOptions,
  capturedScope?: { accountId: string; brokerId: string },
): Promise<unknown> => {
  const signal = options.signal;
  if (signal?.aborted) return Promise.reject(signal.reason ?? abortError());
  const scope = getCommittedBrokerAccountSessionScope();
  const token = options.authToken === undefined ? getAuthToken() : options.authToken;
  const storedRefreshToken = typeof window === 'undefined' ? null
    : localStorage.getItem('refresh_token') || sessionStorage.getItem('refresh_token');
  const refreshToken = options.requestContext ? options.requestContext.refreshToken : storedRefreshToken;
  const rawUrl = `${options.baseUrl || API_V2_BASE_URL}/instruments`;
  const url = options.skipDynamicUrl ? rawUrl : getDynamicUrl(rawUrl);
  const baseUrl = url.slice(0, -'/instruments'.length);
  const refreshEndpoint = options.requestContext?.refreshEndpoint
    ?? getDynamicUrl(`${API_V2_BASE_URL}/auth/refresh`);

  if (!scope.authenticated || !scope.accountId || !scope.brokerId || !scope.serverUrl || !token
    || Object.keys(options).some((key) => !shareableOptions.has(key))
    || (options.authToken === undefined && isStoredTokenExpired())
    || (capturedScope && (capturedScope.accountId !== scope.accountId
      || capturedScope.brokerId.trim().toLowerCase() !== scope.brokerId))) {
    return apiClient.get<unknown>('/instruments', options);
  }

  // Credentials stay in memory only for the lifetime of this pending request.
  // Include refresh inputs and deadline so different recovery policies never join.
  const key = JSON.stringify([
    getCommittedBrokerAccountSessionScopeKey(scope), url, token, refreshToken,
    refreshEndpoint, options.timeoutMs ?? 30_000,
  ]);
  let request = inFlight.get(key);
  if (!request) {
    const controller = new AbortController();
    const promise = new Promise<unknown>((resolve) => {
      resolve(apiClient.get<unknown>('/instruments', {
        ...options, baseUrl, skipDynamicUrl: true, signal: controller.signal,
      }));
    });
    request = { promise, controller, consumers: 0, settled: false };
    inFlight.set(key, request);
    const started = request;
    const finish = () => {
      started.settled = true;
      if (inFlight.get(key) === started) inFlight.delete(key);
    };
    void promise.then(finish, finish);
  }

  const shared = request;
  shared.consumers += 1;
  return new Promise((resolve, reject) => {
    let active = true;
    const release = () => {
      if (!active) return false;
      active = false;
      signal?.removeEventListener('abort', onAbort);
      shared.consumers -= 1;
      if (shared.consumers === 0 && !shared.settled) {
        if (inFlight.get(key) === shared) inFlight.delete(key);
        shared.controller.abort();
      }
      return true;
    };
    const onAbort = () => {
      if (release()) reject(signal?.reason ?? abortError());
    };
    signal?.addEventListener('abort', onAbort, { once: true });
    shared.promise.then(
      (value) => { if (release()) resolve(value); },
      (error) => { if (release()) reject(error); },
    );
  });
};
