import { useEffect, useRef, useState } from 'react';
import { getReconnectDelayMs } from '../services/serverReachability';

/**
 * While `unreachable` is true, call `retry` after a capped exponential
 * backoff (1 s, 2 s, 4 s, … 30 s) until the condition clears. A recovery
 * resets the backoff, so the next outage starts again from the first step.
 * The latest `retry` is always used without restarting the pending timer.
 */
export function useServerReconnect(unreachable: boolean, retry: () => void): void {
  const retryRef = useRef(retry);
  const attemptRef = useRef(0);
  const [cycle, setCycle] = useState(0);

  useEffect(() => {
    retryRef.current = retry;
  }, [retry]);

  useEffect(() => {
    if (!unreachable) {
      attemptRef.current = 0;
      return undefined;
    }
    const timer = setTimeout(() => {
      attemptRef.current += 1;
      retryRef.current();
      setCycle(value => value + 1);
    }, getReconnectDelayMs(attemptRef.current));
    return () => clearTimeout(timer);
  }, [unreachable, cycle]);
}
