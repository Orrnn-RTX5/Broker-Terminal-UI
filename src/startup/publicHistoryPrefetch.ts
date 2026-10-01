import { getPublicBackendTarget, getRuntimeBrokerConfiguration, isDesktopBackendTarget } from '../config/backendTarget.js';
import { toLocalDevProxyUrl } from '../config/localDevProxy';
import { DEFAULT_CHART_SYMBOL, DEFAULT_CHART_TIMEFRAME, FIRST_PAINT_HISTORY_COUNT } from '../constants/chartDefaults';
import { fetchEarlyPublicStartup } from './earlyPublicStartup';

type Prefetch = {
  brokerId: string;
  backend: string;
  controller: AbortController;
  promise: Promise<unknown>;
  expiresAt?: number;
  timer: ReturnType<typeof setTimeout>;
};
const pending = new Map<string, Prefetch>();
const COMPLETED_HANDOFF_MS = 1_000;

const clearEntry = (key: string, entry: Prefetch) => {
  if (pending.get(key) === entry) pending.delete(key);
  clearTimeout(entry.timer);
};
const requestKey = (url: string): string => `${getRuntimeBrokerConfiguration().brokerId}\u0000${url}`;
const isCurrentOwner = (entry: Prefetch): boolean => !isDesktopBackendTarget()
  && entry.brokerId === getRuntimeBrokerConfiguration().brokerId
  && entry.backend === getPublicBackendTarget();
const assertCurrentOwner = (entry: Prefetch) => {
  if (!isCurrentOwner(entry)) throw new DOMException('The deployment broker changed.', 'AbortError');
};

/** Public first viewport only. Never prefetch with account credentials. */
export function preloadPublicStartupHistory(): void {
  if (typeof window === 'undefined' || isDesktopBackendTarget()) return;
  try {
    for (const storage of [window.localStorage, window.sessionStorage]) {
      if (storage.getItem('auth_token') || storage.getItem('refresh_token')) return;
    }
  } catch { return; }
  const backend = getPublicBackendTarget();
  if (!backend) return;
  const query = new URLSearchParams({ timeframe: DEFAULT_CHART_TIMEFRAME, limit: String(FIRST_PAINT_HISTORY_COUNT) });
  const url = toLocalDevProxyUrl(`${backend}/api/v2/candles/${encodeURIComponent(DEFAULT_CHART_SYMBOL)}?${query}`);
  const brokerId = getRuntimeBrokerConfiguration().brokerId;
  const key = requestKey(url);
  if (pending.has(key)) return;
  const controller = new AbortController();
  const entry: Prefetch = {
    brokerId,
    backend,
    controller,
    promise: new Promise<Response>((resolve) => resolve(
      fetchEarlyPublicStartup('candles', url, controller.signal, { 'X-Broker-ID': brokerId }),
    )).then(async response => {
      assertCurrentOwner(entry);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const result = await response.json();
      assertCurrentOwner(entry);
      return result;
    }),
    timer: setTimeout(() => {
      clearEntry(key, entry);
      controller.abort();
    }, 10_000),
  };
  pending.set(key, entry);
  void entry.promise.then(() => {
    clearTimeout(entry.timer);
    if (pending.get(key) !== entry) return;
    entry.expiresAt = Date.now() + COMPLETED_HANDOFF_MS;
    entry.timer = setTimeout(() => clearEntry(key, entry), COMPLETED_HANDOFF_MS);
  }, () => clearEntry(key, entry));
}

/** The chart takes ownership once; later refreshes always reach the broker. */
export function takePublicStartupHistory(url: string, signal?: AbortSignal): Promise<unknown> | null {
  if (signal?.aborted) return null;
  const key = requestKey(url);
  const entry = pending.get(key);
  if (!entry) return null;
  if (!isCurrentOwner(entry)) {
    clearEntry(key, entry);
    entry.controller.abort();
    return null;
  }
  if (entry.expiresAt !== undefined && Date.now() >= entry.expiresAt) {
    clearEntry(key, entry);
    return null;
  }
  // The chart now owns cancellation; the speculative timeout must not restart
  // a slow active history request or couple another chart to this AbortSignal.
  pending.delete(key);
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
    entry.promise.then(value => {
      if (finish()) {
        if (isCurrentOwner(entry)) resolve(value);
        else reject(new DOMException('The deployment broker changed.', 'AbortError'));
      }
    }, error => { if (finish()) reject(error); });
  });
}
