import { getPublicBackendTarget, isDesktopBackendTarget } from '../config/backendTarget.js';
import { toLocalDevProxyUrl } from '../config/localDevProxy';
import { DEFAULT_CHART_SYMBOL, DEFAULT_CHART_TIMEFRAME, FIRST_PAINT_HISTORY_COUNT } from '../constants/chartDefaults';
import { fetchEarlyPublicStartup } from './earlyPublicStartup';

type Prefetch = {
  controller: AbortController;
  promise: Promise<unknown>;
  expiresAt?: number;
  timer: ReturnType<typeof setTimeout>;
};
const pending = new Map<string, Prefetch>();
const COMPLETED_HANDOFF_MS = 1_000;

const clearEntry = (url: string, entry: Prefetch) => {
  if (pending.get(url) === entry) pending.delete(url);
  clearTimeout(entry.timer);
};

/** Public first viewport only. Never prefetch with account credentials. */
export function preloadPublicStartupHistory(): void {
  if (typeof window === 'undefined' || isDesktopBackendTarget()) return;
  try {
    for (const storage of [window.localStorage, window.sessionStorage]) {
      if (storage.getItem('auth_token') || storage.getItem('refresh_token')) return;
    }
  } catch { return; }
  const query = new URLSearchParams({ timeframe: DEFAULT_CHART_TIMEFRAME, limit: String(FIRST_PAINT_HISTORY_COUNT) });
  const url = toLocalDevProxyUrl(`${getPublicBackendTarget()}/api/v2/candles/${encodeURIComponent(DEFAULT_CHART_SYMBOL)}?${query}`);
  if (pending.has(url)) return;
  const controller = new AbortController();
  const entry: Prefetch = {
    controller,
    promise: new Promise<Response>((resolve) => resolve(
      fetchEarlyPublicStartup('candles', url, controller.signal),
    )).then(response => {
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return response.json();
    }),
    timer: setTimeout(() => {
      clearEntry(url, entry);
      controller.abort();
    }, 10_000),
  };
  pending.set(url, entry);
  void entry.promise.then(() => {
    clearTimeout(entry.timer);
    if (pending.get(url) !== entry) return;
    entry.expiresAt = Date.now() + COMPLETED_HANDOFF_MS;
    entry.timer = setTimeout(() => clearEntry(url, entry), COMPLETED_HANDOFF_MS);
  }, () => clearEntry(url, entry));
}

/** The chart takes ownership once; later refreshes always reach the broker. */
export function takePublicStartupHistory(url: string, signal?: AbortSignal): Promise<unknown> | null {
  if (signal?.aborted) return null;
  const entry = pending.get(url);
  if (!entry) return null;
  if (entry.expiresAt !== undefined && Date.now() >= entry.expiresAt) {
    clearEntry(url, entry);
    return null;
  }
  // The chart now owns cancellation; the speculative timeout must not restart
  // a slow active history request or couple another chart to this AbortSignal.
  pending.delete(url);
  clearTimeout(entry.timer);
  return new Promise((resolve, reject) => {
    let active = true;
    const finish = () => {
      if (!active) return false;
      active = false;
      signal?.removeEventListener('abort', onAbort);
      clearTimeout(entry.timer);
      return true;
    };
    const onAbort = () => {
      if (!finish()) return;
      entry.controller.abort();
      reject(signal?.reason ?? new DOMException('The request was aborted.', 'AbortError'));
    };
    signal?.addEventListener('abort', onAbort, { once: true });
    entry.promise.then(value => { if (finish()) resolve(value); }, error => { if (finish()) reject(error); });
  });
}
