import { useRef } from 'react';
import { useActiveChartRuntimeEffect } from './useActiveChartRuntimeEffect';

export type TradingChartVisibleResource =
  | 'history'
  | 'status'
  | 'quote'
  | 'candle'
  | 'interval'
  | 'overlay';

interface TradingChartVisibleRuntimeOptions {
  active: boolean;
  hasSymbol: boolean;
  onAcquire?: (resource: TradingChartVisibleResource) => void;
  onRelease?: (resource: TradingChartVisibleResource) => void;
}

export interface TradingChartVisibleRuntime {
  history: boolean;
  status: boolean;
  quote: boolean;
  candle: boolean;
  interval: boolean;
  overlay: boolean;
}

const VISIBLE_RESOURCES: readonly TradingChartVisibleResource[] = [
  'history',
  'status',
  'quote',
  'candle',
  'interval',
  'overlay',
];

/**
 * One visibility boundary shared by every high-frequency TradingChart runtime.
 * Optional callbacks form a mounted behavioral seam without replacing the
 * production composition that TradingChart itself consumes.
 */
export const useTradingChartVisibleRuntime = ({
  active,
  hasSymbol,
  onAcquire,
  onRelease,
}: TradingChartVisibleRuntimeOptions): TradingChartVisibleRuntime => {
  const callbacksRef = useRef({ onAcquire, onRelease });
  callbacksRef.current = { onAcquire, onRelease };
  const enabled = active && hasSymbol;

  useActiveChartRuntimeEffect(enabled, () => {
    VISIBLE_RESOURCES.forEach(resource => callbacksRef.current.onAcquire?.(resource));
    return () => {
      VISIBLE_RESOURCES.forEach(resource => callbacksRef.current.onRelease?.(resource));
    };
  }, []);

  return {
    history: enabled,
    status: enabled,
    quote: enabled,
    candle: enabled,
    interval: enabled,
    overlay: enabled,
  };
};
