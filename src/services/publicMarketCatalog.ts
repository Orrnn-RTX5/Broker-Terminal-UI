import { toLocalDevProxyUrl } from '../config/localDevProxy';

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
  const url = toLocalDevProxyUrl(`${baseUrl.replace(/\/+$/, '')}/api/v1/market/symbols`);
  let request = sharedRequests.get(url);
  if (request?.handoffExpiresAt !== undefined && Date.now() >= request.handoffExpiresAt) {
    evictRequest(url, request);
    request = undefined;
  }
  if (!request) {
    const controller = new AbortController();
    const timeout = setTimeout(() => {
      controller.abort(new DOMException('Market data request timed out after 30 seconds.', 'TimeoutError'));
    }, REQUEST_TIMEOUT_MS);
    // Promise construction also captures a synchronous transport failure so
    // the timeout and map entry follow the normal rejection cleanup.
    const promise = new Promise<Response>((resolve) => {
      resolve(fetch(url, {
        signal: controller.signal,
        credentials: 'omit',
        cache: 'no-store',
      }));
    }).then((response) => {
      if (!response.ok) throw new Error(response.status === 401 || response.status === 403
        ? 'This broker requires login to view market data.'
        : 'Market data is temporarily unavailable. Retrying…');
      return response.json();
    });
    request = { controller, promise, timeout, consumers: 0, settled: false, allowStartupHandoff: preloadOnly };
    sharedRequests.set(url, request);
    const startedRequest = request;
    const finish = (succeeded: boolean) => {
      startedRequest.settled = true;
      clearTimeout(startedRequest.timeout);
      if (succeeded && startedRequest.allowStartupHandoff) {
        // A fast public response can precede App's module download. Keep this
        // one startup result briefly, retaining every original quote timestamp.
        startedRequest.handoffExpiresAt = Date.now() + STARTUP_HANDOFF_MS;
        startedRequest.handoffTimeout = setTimeout(() => evictRequest(url, startedRequest), STARTUP_HANDOFF_MS);
      } else {
        evictRequest(url, startedRequest);
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
      queueMicrotask(() => evictRequest(url, sharedRequest));
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
        evictRequest(url, sharedRequest);
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
