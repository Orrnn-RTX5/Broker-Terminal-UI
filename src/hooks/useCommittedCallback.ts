import { useCallback, useLayoutEffect, useRef } from 'react';

/** A stable event callback that always uses the latest committed account state. */
export function useCommittedCallback<Args extends unknown[], Result>(callback: (...args: Args) => Result) {
  const latest = useRef(callback);
  useLayoutEffect(() => { latest.current = callback; });
  return useCallback((...args: Args) => latest.current(...args), []);
}
