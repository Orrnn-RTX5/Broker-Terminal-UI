/**
 * Optimized Zustand Selectors for Performance
 * - Prevents unnecessary re-renders
 * - Memoized selectors
 * - Shallow equality checks
 */

import { useRef, useEffect } from 'react';
import { shallow } from 'zustand/shallow';

/**
 * Custom equality function for deep comparison
 */
function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;

  if (a == null || b == null) return false;

  if (typeof a !== 'object' || typeof b !== 'object') return false;

  const keysA = Object.keys(a as object);
  const keysB = Object.keys(b as object);

  if (keysA.length !== keysB.length) return false;

  for (const key of keysA) {
    if (!keysB.includes(key)) return false;

    const valueA = (a as Record<string, unknown>)[key];
    const valueB = (b as Record<string, unknown>)[key];

    if (!deepEqual(valueA, valueB)) return false;
  }

  return true;
}

/**
 * Memoized selector hook
 * Only re-renders when selected value actually changes
 */
export function useMemoizedSelector<T, U>(
  useStore: (selector: (state: T) => U, equalityFn?: (a: U, b: U) => boolean) => U,
  selector: (state: T) => U,
  equalityFn: (a: U, b: U) => boolean = shallow
): U {
  const useStoreWithType = useStore as (selector: (state: T) => U, equalityFn?: (a: U, b: U) => boolean) => U;
  return useStoreWithType(selector, equalityFn);
}

/**
 * Optimized selector for primitive values
 */
export function usePrimitiveSelector<T, U extends string | number | boolean>(
  useStore: (selector: (state: T) => U) => U,
  selector: (state: T) => U
): U {
  return useStore(selector);
}

/**
 * Optimized selector for arrays
 */
export function useArraySelector<T, U>(
  useStore: (selector: (state: T) => U[], equalityFn?: (a: U[], b: U[]) => boolean) => U[],
  selector: (state: T) => U[]
): U[] {
  const useStoreWithType = useStore as (selector: (state: T) => U[], equalityFn?: (a: U[], b: U[]) => boolean) => U[];
  return useStoreWithType(selector, (a, b) => {
    if (a.length !== b.length) return false;
    return a.every((item, index) => item === b[index]);
  });
}

/**
 * Optimized selector for objects with shallow comparison
 */
export function useShallowSelector<T, U extends object>(
  useStore: (selector: (state: T) => U, equalityFn?: (a: U, b: U) => boolean) => U,
  selector: (state: T) => U
): U {
  const useStoreWithType = useStore as (selector: (state: T) => U, equalityFn?: (a: U, b: U) => boolean) => U;
  return useStoreWithType(selector, shallow);
}

/**
 * Optimized selector for objects with deep comparison
 */
export function useDeepSelector<T, U>(
  useStore: (selector: (state: T) => U, equalityFn?: (a: U, b: U) => boolean) => U,
  selector: (state: T) => U
): U {
  const useStoreWithType = useStore as (selector: (state: T) => U, equalityFn?: (a: U, b: U) => boolean) => U;
  return useStoreWithType(selector, deepEqual);
}

/**
 * Selector that only updates when specified dependencies change
 */
export function useSelectWithDeps<T, U>(
  useStore: (selector: (state: T) => U, equalityFn?: (a: U, b: U) => boolean) => U,
  selector: (state: T) => U,
  deps: unknown[]
): U {
  const prevDepsRef = useRef<unknown[]>(deps);
  const prevValueRef = useRef<U | undefined>(undefined);

  const value = useStore(selector);

  // Check if dependencies changed
  const depsChanged = deps.some((dep, i) => dep !== prevDepsRef.current[i]);

  if (depsChanged || prevValueRef.current === undefined) {
    prevDepsRef.current = deps;
    prevValueRef.current = value;
  }

  return prevValueRef.current as U;
}

/**
 * Throttled selector - only updates at specified interval
 */
export function useThrottledSelector<T, U>(
  useStore: (selector: (state: T) => U, equalityFn?: (a: U, b: U) => boolean) => U,
  selector: (state: T) => U,
  throttleMs = 100
): U {
  const lastUpdateRef = useRef<number>(0);
  const valueRef = useRef<U | undefined>(undefined);

  const currentValue = useStore(selector);

  const now = Date.now();
  if (now - lastUpdateRef.current >= throttleMs || valueRef.current === undefined) {
    lastUpdateRef.current = now;
    valueRef.current = currentValue;
  }

  return valueRef.current as U;
}

/**
 * Debounced selector - only updates after value stops changing
 */
export function useDebouncedSelector<T, U>(
  useStore: (selector: (state: T) => U, equalityFn?: (a: U, b: U) => boolean) => U,
  selector: (state: T) => U,
  debounceMs = 300
): U {
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const valueRef = useRef<U | undefined>(undefined);

  const currentValue = useStore(selector);

  useEffect(() => {
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
    }

    timeoutRef.current = setTimeout(() => {
      valueRef.current = currentValue;
    }, debounceMs);

    return () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
    };
  }, [currentValue, debounceMs]);

  return (valueRef.current ?? currentValue) as U;
}

/**
 * Batched selector - accumulates updates and applies them in batches
 */
export function useBatchedSelector<T, U>(
  useStore: (selector: (state: T) => U[], equalityFn?: (a: U[], b: U[]) => boolean) => U[],
  selector: (state: T) => U[],
  batchSize = 10
): U[] {
  const batchRef = useRef<U[]>([]);
  const valueRef = useRef<U[]>([]);

  const currentValue = useStore(selector);

  // Accumulate changes
  batchRef.current.push(...currentValue);

  // Apply batch when size is reached
  if (batchRef.current.length >= batchSize) {
    valueRef.current = [...batchRef.current];
    batchRef.current = [];
  }

  return valueRef.current;
}

/**
 * Conditional selector - only evaluates selector when condition is met
 */
export function useConditionalSelector<T, U>(
  useStore: (selector: (state: T) => U, equalityFn?: (a: U, b: U) => boolean) => U,
  selector: (state: T) => U,
  condition: boolean,
  fallback: U
): U {
  return condition ? useStore(selector) : fallback;
}
