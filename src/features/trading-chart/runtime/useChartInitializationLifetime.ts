import { useEffect, useRef, type RefObject } from 'react';
import type { IChartApi } from 'lightweight-charts';

interface ChartLifetimeRefs {
  chartRef: RefObject<IChartApi | null>;
  containerRef: RefObject<HTMLDivElement | null>;
  isDisposedRef: RefObject<boolean>;
}

type InitializeChart = () => (() => void) | undefined;

interface ChartLifetime {
  setupIdentity: object;
  container: HTMLDivElement;
  chart: IChartApi;
  generation: number;
  dispose: () => void;
}

/** Retain imperative resources only across the same effect's immediate replay. */
export const createChartInitializationLifetime = ({
  chartRef, containerRef, isDisposedRef,
}: ChartLifetimeRefs) => {
  let current: ChartLifetime | null = null;

  const dispose = (lifetime: ChartLifetime) => {
    if (current !== lifetime) return;
    current = null;
    isDisposedRef.current = true;
    lifetime.dispose();
  };

  return {
    acquire(setupIdentity: object, initialize: InitializeChart): (() => void) | undefined {
      const container = containerRef.current;
      if (current && (
        current.setupIdentity !== setupIdentity
        || current.container !== container
        || current.chart !== chartRef.current
      )) {
        // Fast Refresh supplies a new effect closure. Its listeners must not
        // retain old code, even if React retained the refs and DOM container.
        dispose(current);
      }
      if (!container) return;

      isDisposedRef.current = false;
      if (!current) {
        const cleanup = initialize();
        if (!cleanup) return;
        const chart = chartRef.current;
        if (!chart) {
          isDisposedRef.current = true;
          cleanup();
          return;
        }
        current = { setupIdentity, container, chart, generation: 0, dispose: cleanup };
      }

      const lifetime = current;
      const acquiredGeneration = ++lifetime.generation;
      return () => {
        if (current !== lifetime || lifetime.generation !== acquiredGeneration) return;
        // Async chart work stops immediately on a real unmount. StrictMode's
        // synchronous reacquire restores this flag before the next microtask.
        isDisposedRef.current = true;
        const releasedGeneration = ++lifetime.generation;
        queueMicrotask(() => {
          if (current === lifetime && lifetime.generation === releasedGeneration) {
            dispose(lifetime);
          }
        });
      };
    },
  };
};

export const useChartInitializationLifetime = (
  initialize: InitializeChart,
  refs: ChartLifetimeRefs,
): void => {
  const lifetimeRef = useRef<ReturnType<typeof createChartInitializationLifetime> | null>(null);
  if (!lifetimeRef.current) lifetimeRef.current = createChartInitializationLifetime(refs);

  useEffect(function setupChartLifetime() {
    return lifetimeRef.current!.acquire(setupChartLifetime, initialize);
  }, []);
};
