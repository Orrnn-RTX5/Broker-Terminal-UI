import { useEffect, useRef, useState } from 'react';
import { getReconnectDelayMs } from '../services/serverReachability';

/** A recovery must hold this long before the next outage restarts the backoff. */
export const RECONNECT_RECOVERY_SETTLE_MS = 5_000;

/**
 * While `unreachable` is true, call `retry` after a capped exponential
 * backoff (1 s, 2 s, 4 s, … 30 s) until the condition clears.
 *
 * A retry usually clears its own error while the request is in flight, so
 * the condition is judged only after the retry settles: a failed retry keeps
 * growing the backoff, and only a recovery that holds for
 * RECONNECT_RECOVERY_SETTLE_MS resets it, so the next outage starts again
 * from the first step. The latest `retry` is always used.
 *
 * Returns true while reconnecting (unreachable, or a retry still in flight),
 * so the UI shows one steady state instead of flickering between attempts.
 */
export function useServerReconnect(unreachable: boolean, retry: () => unknown): boolean {
  const retryRef = useRef(retry);
  const attemptRef = useRef(0);
  const mountedRef = useRef(false);
  const [inFlight, setInFlight] = useState(false);

  useEffect(() => {
    retryRef.current = retry;
  }, [retry]);

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  useEffect(() => {
    if (inFlight) return undefined;
    if (!unreachable) {
      if (attemptRef.current === 0) return undefined;
      const settle = setTimeout(() => { attemptRef.current = 0; }, RECONNECT_RECOVERY_SETTLE_MS);
      return () => clearTimeout(settle);
    }
    const timer = setTimeout(() => {
      attemptRef.current += 1;
      setInFlight(true);
      Promise.resolve()
        .then(() => retryRef.current())
        .catch(() => undefined)
        .finally(() => {
          if (mountedRef.current) setInFlight(false);
        });
    }, getReconnectDelayMs(attemptRef.current));
    return () => clearTimeout(timer);
  }, [unreachable, inFlight]);

  return unreachable || inFlight;
}
