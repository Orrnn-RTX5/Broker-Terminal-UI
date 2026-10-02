import { toLocalDevProxyUrl } from '../config/localDevProxy';
import { fetchEarlyPublicStartup } from '../startup/earlyPublicStartup';
import { assertBrokerRequestAllowed } from '../api/brokerRequestGuard';
import { getRuntimeBrokerConfiguration } from '../config/backendTarget.js';

interface PublicCatalogRequest {
  controller: AbortController;
  promise: Promise<unknown>;
  consumers: number;
  settled: boolean;
  timeout: ReturnType<typeof setTimeout>;
  allowStartupHandoff: boolean;
  handoffExpiresAt?: number;
  handoffTimeout?: ReturnType<typeof setTimeout>;
}

const sharedRequests = new Map<string, PublicCatalogRequest>();
const REQUEST_TIMEOUT_MS = 30_000;
const STARTUP_HANDOFF_MS = 1_000;
const abortError = () => new DOMException('The request was aborted.', 'AbortError');
const evictRequest = (url: string, request: PublicCatalogRequest) => {
  clearTimeout(request.timeout);
  clearTimeout(request.handoffTimeout);
  if (sharedRequests.get(url) === request) sharedRequests.delete(url);
};

const requestPublicMarketCatalog = (
  baseUrl: string,
  signal?: AbortSignal,
  preloadOnly = false,
): Promise<unknown> => {
  if (signal?.aborted) return Promise.reject(signal.reason ?? abortError());
  const deployment = getRuntimeBrokerConfiguration();
  const gateway = deployment.publicMarketApi !== 'mt5-bridge-v1';
  const path = gateway ? '/api/v2/instruments' : '/api/v1/market/symbols';
  const url = toLocalDevProxyUrl(`${baseUrl.replace(/\/+$/, '')}${path}`);
  const requestKey = `${deployment.brokerId}\u0000${deployment.publicMarketApi}\u0000${url}`;
  try { assertBrokerRequestAllowed(url); } catch (error) { return Promise.reject(error); }
  let request = sharedRequests.get(requestKey);
  if (request?.handoffExpiresAt !== undefined && Date.now() >= request.handoffExpiresAt) {
    evictRequest(requestKey, request);
    request = undefined;
  }
  if (!request) {
    const controller = new AbortController();
    const timeout = setTimeout(() => {
      controller.abort(new DOMException('Market data request timed out after 30 seconds.', 'TimeoutError'));
    }, REQUEST_TIMEOUT_MS);
    // Promise construction also captures a synchronous transport failure so
    // the timeout and map entry follow the normal rejection cleanup.
    const readResponse = async (response: Response, endpoint: string): Promise<unknown> => {
      if (!response.ok) {
        const detail = await response.json().catch(() => null) as { error?: string } | null;
        if (detail?.error === 'BROKER_SCOPE_UNAVAILABLE') {
          throw new Error('Broker API configuration error (BROKER_SCOPE_UNAVAILABLE): broker market-data scope is unavailable.');
        }
        if (detail?.error === 'BROKER_MISMATCH') {
          throw new Error('Broker API configuration error (BROKER_MISMATCH): the gateway identity differs from this deployment.');
        }
        if (response.status === 404 || response.status === 405 || response.status === 501) {
          throw new Error(`Broker API compatibility error: this deployment does not expose GET ${endpoint}. Configure its supported public market API and backend routing.`);
        }
        throw new Error(response.status === 401 || response.status === 403
          ? 'This broker requires login to view market data.'
          : 'Market data is temporarily unavailable. Retrying…');
      }
      return response.json();
    };
    const promise = new Promise<unknown>((resolve) => {
      const instruments = fetchEarlyPublicStartup('symbols', url, controller.signal,
        gateway ? { 'X-Broker-ID': deployment.brokerId } : undefined)
        .then(response => readResponse(response, path));
      if (!gateway) { resolve(instruments); return; }
      const quotesUrl = toLocalDevProxyUrl(`${baseUrl.replace(/\/+$/, '')}/api/v2/quotes`);
      assertBrokerRequestAllowed(quotesUrl);
      const quotes = fetch(quotesUrl, {
        signal: controller.signal, credentials: 'omit', cache: 'no-store', redirect: 'error',
        headers: { 'X-Broker-ID': deployment.brokerId },
      }).then(response => readResponse(response, '/api/v2/quotes'));
      resolve(Promise.all([instruments, quotes]).then(([catalog, snapshot]) => {
        const rows = (value: unknown, key: string): unknown[] | null => {
          if (Array.isArray(value)) return value;
          if (value && typeof value === 'object') {
            const record = value as Record<string, unknown>;
            const nested = record[key] ?? record.data;
            if (Array.isArray(nested)) return nested;
          }
          return null;
        };
        const instrumentRows = rows(catalog, 'instruments');
        const quoteRows = rows(snapshot, 'quotes');
        if (!instrumentRows || !quoteRows) throw new Error('The broker returned an invalid gateway market catalog.');
        const quotesBySymbol = new Map(quoteRows.map(value => {
          const row = value && typeof value === 'object' ? value as Record<string, unknown> : {};
          return [String(row.symbol ?? '').trim(), row] as const;
        }));
        return { symbols: instrumentRows.map(value => {
          const instrument = value && typeof value === 'object' ? value as Record<string, unknown> : {};
          const symbol = String(instrument.symbol ?? instrument.name ?? '').trim();
          return { ...instrument, ...quotesBySymbol.get(symbol), symbol };
        }).filter(row => row.symbol) };
      }));
    }).then(value => {
      if (deployment.pinned) {
        assertBrokerRequestAllowed(url);
        const current = getRuntimeBrokerConfiguration();
        if (current.brokerId !== deployment.brokerId || current.publicMarketApi !== deployment.publicMarketApi) {
          throw new DOMException('The broker configuration changed while loading market data.', 'AbortError');
        }
      }
      return value;
    });
    request = { controller, promise, timeout, consumers: 0, settled: false, allowStartupHandoff: preloadOnly };
    sharedRequests.set(requestKey, request);
    const startedRequest = request;
    const finish = (succeeded: boolean) => {
      startedRequest.settled = true;
      clearTimeout(startedRequest.timeout);
      if (succeeded && startedRequest.allowStartupHandoff) {
        // A fast public response can precede App's module download. Keep this
        // one startup result briefly, retaining every original quote timestamp.
        startedRequest.handoffExpiresAt = Date.now() + STARTUP_HANDOFF_MS;
        startedRequest.handoffTimeout = setTimeout(() => evictRequest(requestKey, startedRequest), STARTUP_HANDOFF_MS);
      } else {
        if (!succeeded) startedRequest.controller.abort();
        evictRequest(requestKey, startedRequest);
      }
    };
    void promise.then(() => finish(true), () => finish(false));
  }

  const sharedRequest = request;
  if (!preloadOnly && sharedRequest.allowStartupHandoff) {
    sharedRequest.allowStartupHandoff = false;
    if (sharedRequest.settled) {
      clearTimeout(sharedRequest.handoffTimeout);
      sharedRequest.handoffExpiresAt = undefined;
      // Catalog and guest quotes join during the same React effect batch.
      // Later polls get fresh data, even before the original TTL would expire.
      queueMicrotask(() => evictRequest(requestKey, sharedRequest));
    }
  }
  sharedRequest.consumers += 1;
  return new Promise((resolve, reject) => {
    let active = true;
    const release = () => {
      if (!active) return false;
      active = false;
      signal?.removeEventListener('abort', onAbort);
      sharedRequest.consumers -= 1;
      if (sharedRequest.consumers === 0 && !sharedRequest.settled) {
        evictRequest(requestKey, sharedRequest);
        sharedRequest.controller.abort();
      }
      return true;
    };
    const onAbort = () => {
      if (release()) reject(signal?.reason ?? abortError());
    };
    signal?.addEventListener('abort', onAbort, { once: true });
    sharedRequest.promise.then(
      (value) => { if (release()) resolve(value); },
      (error) => { if (release()) reject(error); },
    );
  });
};

/** Share concurrent public reads only; regular loads never retain results. */
export const loadPublicMarketCatalog = (baseUrl: string, signal?: AbortSignal): Promise<unknown> => (
  requestPublicMarketCatalog(baseUrl, signal)
);

/** One-use startup handoff, capped at one second; never persisted or renewed. */
export const preloadPublicMarketCatalog = (baseUrl: string): Promise<unknown> => (
  requestPublicMarketCatalog(baseUrl, undefined, true)
);
