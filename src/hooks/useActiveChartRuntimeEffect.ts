import { useEffect, useRef, type DependencyList, type EffectCallback } from 'react';

/**
 * Runs a chart-owned runtime only while its dock surface is visible.
 *
 * Keeping setup in a ref lets callers declare the same concrete dependencies
 * they would pass to useEffect without restarting for callback identity churn.
 */
export const useActiveChartRuntimeEffect = (
  enabled: boolean,
  setup: EffectCallback,
  dependencies: DependencyList,
): void => {
  const setupRef = useRef(setup);
  setupRef.current = setup;

  useEffect(() => {
    if (!enabled) return undefined;
    return setupRef.current();
    // The caller-provided list deliberately owns the concrete runtime inputs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, ...dependencies]);
};
