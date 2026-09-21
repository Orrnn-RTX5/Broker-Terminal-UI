import { getAuthToken } from '../api/client';
import { isDesktopBackendTarget } from '../config/backendTarget.js';
import { DEFAULT_CHART_SYMBOL, DEFAULT_CHART_TIMEFRAME, FIRST_PAINT_HISTORY_COUNT } from '../constants/chartDefaults';
import { getCommittedBrokerAccountSessionScope, getCommittedBrokerAccountSessionScopeKey, onSessionChange, onCommittedBrokerAccountSessionScopeChange } from '../services/brokerSession';
import type { FetchCandlesOptions, OHLCData } from '../services/chartDataService';

export class StartupHistorySessionChangedError extends Error {
  constructor() {
    super('Session changed while loading startup history');
    this.name = 'AbortError';
  }
}

type Handoff = {
  identity: string;
  sessionGeneration: number;
  controller: AbortController;
  promise: Promise<OHLCData[]>;
  timer: ReturnType<typeof setTimeout>;
  expiresAt?: number;
};
let pending: Handoff | null = null;
let sessionGeneration = 0;
const identity = (): string | null => {
  const scope = getCommittedBrokerAccountSessionScope();
  const token = getAuthToken();
  if (!scope.authenticated || !scope.accountId || !scope.brokerId || !scope.serverUrl || !token || isDesktopBackendTarget()) return null;
  return `${getCommittedBrokerAccountSessionScopeKey(scope)}\u0000${token}`;
};
const clear = () => {
  if (!pending) return;
  clearTimeout(pending.timer);
  pending.controller.abort();
  pending = null;
};
const invalidateSession = () => {
  sessionGeneration += 1;
  clear();
};
onSessionChange(invalidateSession);
onCommittedBrokerAccountSessionScopeChange(invalidateSession);

/** Called only after restore has validated and committed the active session. */
export function preloadAuthenticatedStartupHistory(load: (signal: AbortSignal) => Promise<OHLCData[]>): void {
  const key = identity();
  if (!key || pending?.identity === key) return;
  clear();
  const controller = new AbortController();
  const generation = sessionGeneration;
  const entry: Handoff = {
    identity: key,
    sessionGeneration: generation,
    controller,
    // Start transport in this turn. A queued promise callback runs after the
    // store's React flush and loses the network/render overlap we need here.
    promise: new Promise((resolve) => {
      if (identity() !== key || generation !== sessionGeneration || controller.signal.aborted) throw new StartupHistorySessionChangedError();
      resolve(load(controller.signal));
    }),
    timer: setTimeout(() => {
      if (pending === entry) pending = null;
      controller.abort();
    }, 10_000),
  };
  pending = entry;
  void entry.promise.then(() => {
    clearTimeout(entry.timer);
    if (pending !== entry) return;
    entry.expiresAt = Date.now() + 1_000;
    entry.timer = setTimeout(() => { if (pending === entry) clear(); }, 1_000);
  }, () => {
    clearTimeout(entry.timer);
    if (pending === entry) pending = null;
  });
}

/** One chart takes ownership; later history and refresh requests remain fresh. */
export function takeAuthenticatedStartupHistory(options: FetchCandlesOptions): Promise<OHLCData[]> | null {
  const entry = pending;
  if (!entry || options.signal?.aborted || options.symbol !== DEFAULT_CHART_SYMBOL
    || options.timeframe !== DEFAULT_CHART_TIMEFRAME || options.count !== FIRST_PAINT_HISTORY_COUNT
    || options.from !== undefined || options.to !== undefined) return null;
  if (entry.identity !== identity() || entry.sessionGeneration !== sessionGeneration || (entry.expiresAt !== undefined && Date.now() >= entry.expiresAt)) {
    clear();
    return null;
  }
  pending = null;
  // Once claimed, the chart's cancellation policy owns the request lifetime.
  clearTimeout(entry.timer);
  return new Promise((resolve, reject) => {
    const signal = options.signal;
    let active = true;
    const finish = () => {
      if (!active) return false;
      active = false;
      clearTimeout(entry.timer);
      signal?.removeEventListener('abort', abort);
      return true;
    };
    const abort = () => {
      if (!finish()) return;
      entry.controller.abort();
      reject(signal?.reason ?? new DOMException('The request was aborted.', 'AbortError'));
    };
    signal?.addEventListener('abort', abort, { once: true });
    entry.promise.then(value => {
      if (!finish()) return;
      if (entry.identity !== identity() || entry.sessionGeneration !== sessionGeneration) reject(new StartupHistorySessionChangedError());
      else resolve(value);
    }, error => {
      if (!finish()) return;
      reject(entry.identity !== identity() || entry.sessionGeneration !== sessionGeneration
        ? new StartupHistorySessionChangedError() : error);
    });
  });
}
