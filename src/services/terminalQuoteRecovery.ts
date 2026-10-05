import { apiClient } from '../api/client';
import { toLocalDevProxyUrl } from '../config/api';
import { captureApiSession, getApiSessionDescriptor, getCapturedRequestOptions } from '../features/market-data/marketDataSession';
import { useAppStore } from '../store/useAppStore';
import { getCommittedBrokerAccountSessionScope, getCommittedBrokerAccountSessionScopeKey,
  onCommittedBrokerAccountSessionScopeChange, onSessionChange } from './brokerSession';
import { enqueueLiveTick } from './liveTickDispatcher';
import { processIncomingQuotePayload } from './quotePayloadNormalizer';
import { getQuoteSocketManager } from './quoteSocketManager';
import { getTerminalQuoteFreshness, getTerminalQuoteSession, hasExplicitQuoteSides, terminalQuoteFreshnessEnabled } from './terminalQuoteFreshness';

const POLL_MS = 500;
const REQUEST_TIMEOUT_MS = 2000;
const MAX_CONCURRENT = 2;
const MAX_TRACKED = 32;
const normalize = (value: string) => value.trim().toUpperCase();

function captureOwner() {
  const state = useAppStore.getState();
  const scope = getCommittedBrokerAccountSessionScope();
  if (!state.isAuthenticated || !scope.authenticated || !scope.accountId
    || String(state.accountId) !== scope.accountId || !scope.brokerId || !scope.serverUrl) return null;
  const descriptor = getApiSessionDescriptor(scope.accountId);
  if (descriptor.brokerId.trim().toLowerCase() !== scope.brokerId.trim().toLowerCase()
    || descriptor.apiRootBaseUrl !== toLocalDevProxyUrl(scope.serverUrl).replace(/\/+$/, '')) return null;
  const request = captureApiSession(descriptor, state.authToken, state.refreshToken);
  if (!request) return null;
  return { request, key: `${getCommittedBrokerAccountSessionScopeKey(scope)}|${request.runtimeKey}|${getTerminalQuoteSession()}` };
}

/** One app-owned data recovery loop. It never captures, submits or retries trades. */
export function startTerminalQuoteRecovery(): () => void {
  if (!terminalQuoteFreshnessEnabled()) return () => {};
  const states = new Map<string, { nextAt: number; failures: number }>();
  const pending = new Map<string, AbortController>();
  let disposed = false;
  let ownerKey = '';
  let nextLaunchAt = 0;
  const suspended = () => document.visibilityState === 'hidden' || navigator.onLine === false;
  const invalidate = () => {
    ownerKey = '';
    states.clear();
    pending.forEach(controller => controller.abort());
    // Keep aborted requests counted until they settle: session churn cannot
    // create an unbounded number of concurrent requests.
  };
  const demanded = () => new Set(getQuoteSocketManager().getActiveSymbols().map(normalize).filter(Boolean));
  const current = (key: string, symbol: string, controller: AbortController) => !disposed
    && !controller.signal.aborted && !suspended() && demanded().has(symbol) && captureOwner()?.key === key;

  const poll = () => {
    if (disposed) return;
    if (suspended() || !terminalQuoteFreshnessEnabled()) { invalidate(); return; }
    const owner = captureOwner();
    if (!owner) { invalidate(); return; }
    if (owner.key !== ownerKey) { invalidate(); ownerKey = owner.key; }
    const now = performance.now();
    const demand = demanded();
    const app = useAppStore.getState();
    // The chart and positions come first; a large watchlist must not overwhelm
    // the gateway or starve the symbols the user is trying to trade or close.
    const prioritized = new Set([normalize(app.selectedSymbol), ...app.positions.map(row => normalize(row.symbol)), ...demand]);
    const wanted = new Set([...prioritized].filter(symbol => demand.has(symbol)).slice(0, MAX_TRACKED));
    for (const [symbol, controller] of pending) if (!wanted.has(symbol)) controller.abort();
    for (const symbol of states.keys()) if (!wanted.has(symbol)) states.delete(symbol);
    for (const symbol of wanted) {
      const freshness = getTerminalQuoteFreshness(symbol);
      if (freshness.reason !== 'stale' && freshness.reason !== 'unavailable') {
        states.delete(symbol);
        continue;
      }
      let state = states.get(symbol);
      if (!state) {
        // Give a new subscription time to seed itself through the primary feed.
        state = { nextAt: now + 1000, failures: 0 };
        states.set(symbol, state);
      }
      if (now < state.nextAt || now < nextLaunchAt || pending.has(symbol) || pending.size >= MAX_CONCURRENT) continue;
      const controller = new AbortController();
      pending.set(symbol, controller);
      nextLaunchAt = now + POLL_MS; // At most two new GETs/second across all symbols.
      const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
      const capturedState = state;
      const run = async () => {
        try {
          const raw = await apiClient.get<unknown>(`/quotes/${encodeURIComponent(symbol)}`, {
            ...getCapturedRequestOptions(owner.request, owner.request.v2BaseUrl, controller.signal),
            cache: 'no-store', timeoutMs: REQUEST_TIMEOUT_MS,
          });
          if (!current(owner.key, symbol, controller)) return;
          // This gateway route returns one flat Redis quote. Do not let a
          // wrapper/channel relabel a foreign symbol, or an omitted tradable
          // field hide an explicit conflicting broker identity.
          if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return;
          const row = raw as Record<string, unknown>;
          if (typeof row.symbol !== 'string' || normalize(row.symbol) !== symbol) return;
          if (!hasExplicitQuoteSides(row) || ['data', 'tick', 'quote', 'price', 'payload', 'message', 'prices', 'ticks']
            .some(key => row[key] !== null && (typeof row[key] === 'object' || typeof row[key] === 'string'))) return;
          if (row.broker_id !== undefined && (typeof row.broker_id !== 'string'
            || row.broker_id.trim().toLowerCase() !== owner.request.brokerId.trim().toLowerCase())) return;
          const ticks = processIncomingQuotePayload(raw);
          if (ticks.length !== 1 || ticks[0].symbol !== symbol) return;
          const tick = ticks[0];
          const broker = tick.tradingStatus?.brokerId;
          if (broker && broker !== owner.request.brokerId.trim().toLowerCase()) return;
          // The ordinary dispatcher applies account markup and rejects invalid,
          // duplicate, older or future evidence. Receipt time is never a tick.
          enqueueLiveTick(symbol, tick, { transport: 'rest', receiptMonoMs: performance.now() });
        } catch {
          // Auth, permission, outage and backend stale responses grant no evidence.
        } finally {
          clearTimeout(timeout);
          if (pending.get(symbol) === controller) pending.delete(symbol);
          if (states.get(symbol) === capturedState && ownerKey === owner.key) {
            const recovered = getTerminalQuoteFreshness(symbol).live;
            capturedState.failures = recovered ? 0 : Math.min(4, capturedState.failures + 1);
            capturedState.nextAt = performance.now() + Math.min(30000, 5000 * 2 ** Math.max(0, capturedState.failures - 1));
          }
        }
      };
      void run();
    }
  };
  const unsubscribe = onSessionChange(invalidate);
  const unsubscribeScope = onCommittedBrokerAccountSessionScopeChange(invalidate);
  const visibility = () => { if (suspended()) invalidate(); else poll(); };
  document.addEventListener('visibilitychange', visibility);
  window.addEventListener('offline', invalidate);
  window.addEventListener('online', poll);
  const timer = setInterval(poll, POLL_MS);
  poll();
  return () => {
    disposed = true;
    clearInterval(timer);
    invalidate();
    unsubscribe(); unsubscribeScope();
    document.removeEventListener('visibilitychange', visibility);
    window.removeEventListener('offline', invalidate);
    window.removeEventListener('online', poll);
  };
}
