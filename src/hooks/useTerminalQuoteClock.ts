import { useEffect } from 'react';
import { apiClient } from '../api/client';
import { API_V2_BASE_URL } from '../config/api';
import { onSessionChange } from '../services/brokerSession';
import { getTerminalQuoteClockOwner } from '../services/terminalQuoteClockOwnership';
import { quoteDiagnosticsEnabled, recordQuoteDiagnostic } from '../services/quoteDiagnostics';
import {
  calibrateTerminalQuoteClock, getTerminalQuoteSession, isTerminalQuoteClockVerified,
  resetTerminalQuoteFreshness, terminalQuoteFreshnessEnabled, subscribeTerminalQuoteFreshness,
} from '../services/terminalQuoteFreshness';

// Mounted once by App. Clock samples never depend on the quote snapshot path.
export function useTerminalQuoteClock(): void {
  useEffect(() => {
    if (!terminalQuoteFreshnessEnabled()) return;
    let disposed = false;
    let generation = 0;
    let controller: AbortController | undefined;
    let scheduled: ReturnType<typeof setTimeout> | undefined;
    let lastVerified = false;
    // Bailing out must never end the loop. The anchor expires after 60 seconds;
    // prompt resampling restores verified local ages while execution remains
    // responsible for quote safety whenever browser time is uncertain.
    const scheduleNext = (delayMs: number) => {
      if (disposed) return;
      clearTimeout(scheduled);
      scheduled = setTimeout(() => { void refresh(); }, delayMs);
    };
    const refresh = async () => {
      if (disposed) return;
      if (controller || document.visibilityState === 'hidden') {
        scheduleNext(1000);
        return;
      }
      clearTimeout(scheduled);
      const request = ++generation;
      const owner = getTerminalQuoteSession();
      const clockOwner = getTerminalQuoteClockOwner();
      const active = new AbortController();
      controller = active;
      const startMono = performance.now();
      const startWall = Date.now();
      let accepted = false;
      try {
        const response = await apiClient.get<{ server_time_ms?: unknown }>('/time', {
          baseUrl: clockOwner?.apiBaseUrl ?? API_V2_BASE_URL, skipDynamicUrl: Boolean(clockOwner), skipAuth: true, signal: active.signal,
          cache: 'no-store', timeoutMs: 2000,
        });
        const currentSession = getTerminalQuoteSession();
        const discardReason = disposed ? 'hook-disposed'
          : active.signal.aborted ? 'request-aborted'
            : request !== generation ? 'request-superseded'
              : clockOwner !== getTerminalQuoteClockOwner() ? 'clock-owner-changed'
                : !clockOwner && owner !== currentSession ? 'unbound-session-changed' : undefined;
        if (discardReason) {
          if (quoteDiagnosticsEnabled()) recordQuoteDiagnostic({ kind: 'clock', accepted: false, reason: discardReason,
            requestMonoMs: startMono, responseMonoMs: performance.now(),
            browserGeneration: currentSession, expectedBrowserGeneration: owner });
          return;
        }
        // A quote transport reconnect advances quote generations, not the owner
        // of this pinned HTTP request. Accept its fresh clock sample only while
        // that exact broker/account/credential owner and hook request remain current.
        // Unbound requests still require the original quote generation.
        accepted = calibrateTerminalQuoteClock(response.server_time_ms, startMono, startWall, performance.now(), Date.now(),
          clockOwner ? currentSession : owner, clockOwner);
      } catch (error) {
        const timedOut = error instanceof Error && (error.name === 'TimeoutError' || /^Request timed out after /.test(error.message));
        const responseMono = performance.now();
        if (quoteDiagnosticsEnabled()) recordQuoteDiagnostic({ kind: 'clock', accepted: false,
          reason: active.signal.aborted ? 'request-aborted' : timedOut ? 'request-timeout' : 'request-failed',
          requestMonoMs: startMono, responseMonoMs: responseMono, rttMs: responseMono - startMono,
          browserGeneration: getTerminalQuoteSession(), expectedBrowserGeneration: owner });
        // A failed refresh cannot discard the bounded 60-second holdover.
      } finally {
        if (controller === active) controller = undefined;
        if (!disposed && request === generation) scheduleNext(accepted ? 5000 : 1000);
      }
    };
    const invalidate = () => {
      ++generation;
      controller?.abort();
      controller = undefined;
      clearTimeout(scheduled);
      resetTerminalQuoteFreshness();
      void refresh();
    };
    const refreshEvent = () => { void refresh(); };
    const visible = () => {
      if (document.visibilityState !== 'hidden') invalidate();
    };
    // The shared timer detects wall-clock discontinuities and expired holdover,
    // including periods without incoming quotes. Recalibrate without replaying orders.
    const unsubscribeClock = subscribeTerminalQuoteFreshness(() => {
      const verified = isTerminalQuoteClockVerified();
      if (lastVerified && !verified) refreshEvent();
      lastVerified = verified;
    });
    const unsubscribe = onSessionChange(invalidate);
    document.addEventListener('visibilitychange', visible);
    window.addEventListener('pageshow', invalidate);
    window.addEventListener('rtx:quote-clock-refresh', refreshEvent);
    window.addEventListener('offline', invalidate);
    window.addEventListener('online', invalidate);
    void refresh();
    return () => {
      disposed = true;
      ++generation;
      controller?.abort();
      clearTimeout(scheduled);
      unsubscribe(); unsubscribeClock();
      document.removeEventListener('visibilitychange', visible);
      window.removeEventListener('pageshow', invalidate);
      window.removeEventListener('rtx:quote-clock-refresh', refreshEvent);
      window.removeEventListener('offline', invalidate);
      window.removeEventListener('online', invalidate);
    };
  }, []);
}
