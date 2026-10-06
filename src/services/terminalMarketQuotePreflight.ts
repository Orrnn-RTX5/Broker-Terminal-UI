import { toLocalDevProxyUrl } from '../config/api';
import { captureApiSession, getApiSessionDescriptor } from '../features/market-data/marketDataSession';
import { useAppStore } from '../store/useAppStore';
import { getCommittedBrokerAccountSessionScope, getCommittedBrokerAccountSessionScopeKey,
  onCommittedBrokerAccountSessionScopeChange, onSessionChange } from './brokerSession';
import { assertTerminalMarketOrderQuote, getTerminalQuoteFreshness, getTerminalQuoteSession,
  subscribeTerminalQuoteFreshness, terminalQuoteFreshnessEnabled } from './terminalQuoteFreshness';

export const TERMINAL_MARKET_QUOTE_WAIT_MS = 1500;

function ownerKey(): string | null {
  const state = useAppStore.getState();
  const scope = getCommittedBrokerAccountSessionScope();
  if (!state.isAuthenticated || !scope.authenticated || !scope.accountId
    || String(state.accountId) !== scope.accountId || !scope.brokerId || !scope.serverUrl) return null;
  const descriptor = getApiSessionDescriptor(scope.accountId);
  if (descriptor.brokerId.trim().toLowerCase() !== scope.brokerId.trim().toLowerCase()
    || descriptor.apiRootBaseUrl !== toLocalDevProxyUrl(scope.serverUrl).replace(/\/+$/, '')) return null;
  const request = captureApiSession(descriptor, state.authToken, state.refreshToken);
  return request ? `${getCommittedBrokerAccountSessionScopeKey(scope)}|${request.runtimeKey}|${getTerminalQuoteSession()}` : null;
}

/** Before the first submission only: briefly await live evidence, never send or retry an order. */
export function prepareTerminalMarketQuote(symbol: string, isCurrent: () => boolean): Promise<void> | undefined {
  if (!terminalQuoteFreshnessEnabled()) return;
  let originalError: unknown;
  try {
    // Preserve the synchronous fast path, including server-authoritative uncertain age.
    assertTerminalMarketOrderQuote(symbol);
    return;
  } catch (error) {
    if (!error || typeof error !== 'object' || !('code' in error) || error.code !== 'QUOTE_STALE') throw error;
    originalError = error;
  }

  const owner = ownerKey();
  const active = () => document.visibilityState !== 'hidden' && navigator.onLine !== false
    && isCurrent() && owner !== null && ownerKey() === owner;
  const cancelled = () => Object.assign(new Error('Trade preparation cancelled because the trading context changed.'), {
    code: 'ORDER_PREPARATION_CANCELLED', symbol,
  });
  if (!active()) throw cancelled();
  const deadline = performance.now() + TERMINAL_MARKET_QUOTE_WAIT_MS;

  return new Promise<void>((resolve, reject) => {
    let settled = false;
    const cleanups: Array<() => void> = [];
    const finish = (error?: unknown) => {
      if (settled) return;
      settled = true;
      cleanups.forEach(cleanup => cleanup());
      if (error !== undefined) reject(error);
      else resolve();
    };
    const check = () => {
      if (settled) return;
      if (!active()) { finish(cancelled()); return; }
      // A delayed event-loop callback must not extend the user's preparation window.
      if (performance.now() >= deadline) { finish(originalError); return; }
      const state = getTerminalQuoteFreshness(symbol);
      if (state.live) { finish(); return; }
      // Time becoming uncertain while waiting is not fresh recovery evidence.
      if (state.reason === 'stale' || state.reason === 'time-unverified') return;
      try { assertTerminalMarketOrderQuote(symbol); } catch (error) { finish(error); }
    };
    const invalidate = () => finish(cancelled());
    cleanups.push(subscribeTerminalQuoteFreshness(check));
    cleanups.push(onSessionChange(invalidate));
    cleanups.push(onCommittedBrokerAccountSessionScopeChange(invalidate));
    cleanups.push(useAppStore.subscribe(check));
    document.addEventListener('visibilitychange', check);
    window.addEventListener('offline', invalidate);
    window.addEventListener('pagehide', invalidate);
    cleanups.push(() => document.removeEventListener('visibilitychange', check));
    cleanups.push(() => window.removeEventListener('offline', invalidate));
    cleanups.push(() => window.removeEventListener('pagehide', invalidate));
    const timeout = setTimeout(() => finish(originalError), TERMINAL_MARKET_QUOTE_WAIT_MS);
    cleanups.push(() => clearTimeout(timeout));
    check();
  });
}
