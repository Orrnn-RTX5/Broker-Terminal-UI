type EarlyPublicStartup = {
  symbolsUrl?: string;
  candlesUrl?: string;
  symbols?: Promise<Response> | null;
  candles?: Promise<Response> | null;
};

const abortError = () => new DOMException('The request was aborted.', 'AbortError');

const earlyStartup = (): EarlyPublicStartup | null => {
  if (typeof window === 'undefined') return null;
  return (window as Window & { __RTX_EARLY_PUBLIC_STARTUP__?: EarlyPublicStartup }).__RTX_EARLY_PUBLIC_STARTUP__ ?? null;
};

/** Use the page's startup request once, and only when it targets this exact URL. */
const takeEarlyResponse = (kind: 'symbols' | 'candles', url: string): Promise<Response> | null => {
  const early = earlyStartup();
  if (!early) return null;
  const expectedUrl = kind === 'symbols' ? early.symbolsUrl : early.candlesUrl;
  const request = kind === 'symbols' ? early.symbols : early.candles;
  if (!request || expectedUrl !== url) return null;
  if (kind === 'symbols') early.symbols = null;
  else early.candles = null;
  return request;
};

/**
 * Prefer the fetch the HTML started while JavaScript was still downloading.
 * A later abort stops this caller from using the result; it does not restart
 * the same public startup request.
 */
export const fetchEarlyPublicStartup = (
  kind: 'symbols' | 'candles',
  url: string,
  signal: AbortSignal,
): Promise<Response> => {
  const early = takeEarlyResponse(kind, url);
  if (!early) return fetch(url, { signal, credentials: 'omit', cache: 'no-store' });
  if (signal.aborted) return Promise.reject(signal.reason ?? abortError());
  return new Promise((resolve, reject) => {
    const onAbort = () => reject(signal.reason ?? abortError());
    signal.addEventListener('abort', onAbort, { once: true });
    early.then(
      (response) => {
        signal.removeEventListener('abort', onAbort);
        resolve(response);
      },
      (error) => {
        signal.removeEventListener('abort', onAbort);
        reject(error);
      },
    );
  });
};
