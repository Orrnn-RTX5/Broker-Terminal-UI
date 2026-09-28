import { useEffect, useRef } from 'react';
import type { ChartSelectionIdentity } from '../types/chart';

export type SelectedHistoryRequestSelection = ChartSelectionIdentity<string>;

interface SelectedHistoryRequestOwnerOptions extends SelectedHistoryRequestSelection {
  enabled?: boolean;
  scopeRevision?: string | number;
  load: (selection: SelectedHistoryRequestSelection) => void | Promise<void>;
  abort: () => void;
}

/**
 * Owns the one automatic selected-history request for a chart selection.
 * Loader identity is intentionally excluded from the effect dependencies:
 * auth/cache/market-status churn updates the ref without refetching the same pair.
 */
export const useSelectedHistoryRequestOwner = ({
  symbol,
  timeframe,
  enabled = true,
  scopeRevision = 0,
  load,
  abort,
}: SelectedHistoryRequestOwnerOptions): void => {
  const loadRef = useRef(load);
  const abortRef = useRef(abort);

  useEffect(() => {
    loadRef.current = load;
    abortRef.current = abort;
  }, [abort, load]);

  useEffect(() => {
    if (!enabled || !symbol) return;

    let cancelled = false;
    let started = false;

    // React StrictMode performs a setup -> cleanup -> setup replay in
    // development. Deferring one microtask lets that discarded setup cancel
    // before it creates a real backend request.
    queueMicrotask(() => {
      if (cancelled) return;
      started = true;
      void loadRef.current({ symbol, timeframe });
    });

    return () => {
      cancelled = true;
      if (started) abortRef.current();
    };
  }, [enabled, scopeRevision, symbol, timeframe]);
};
