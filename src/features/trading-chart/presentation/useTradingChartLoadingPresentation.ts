import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { useActiveChartRuntimeEffect } from '../../../hooks/useActiveChartRuntimeEffect';
import { useUiTranslation } from '../../../hooks/useUiTranslation';
import { useTerminalStartupReady } from '../../../startup/TerminalStartupBoundary';
import type { Timeframe } from '../../../types/chart';

export type TradingChartLoadingPhase = 'connecting' | 'receiving' | 'ready' | 'hidden';

interface UseTradingChartLoadingPresentationOptions {
  activeTimeframe: Timeframe;
  intervalEnabled: boolean;
  isActive: boolean;
  symbol: string;
}

export function useTradingChartLoadingPresentation({
  activeTimeframe,
  intervalEnabled,
  isActive,
  symbol,
}: UseTradingChartLoadingPresentationOptions) {
  const tr = useUiTranslation();
  const [loadingPhase, setLoadingPhase] = useState<TradingChartLoadingPhase>('connecting');
  const [loadingMessageIdx, setLoadingMessageIdx] = useState(0);
  const [, setApiError] = useState<string | null>(null);
  const marketDataReadySymbolRef = useRef<string | null>(null);
  const loadingMessages = useMemo(() => (
    loadingPhase === 'connecting'
      ? [tr('Connecting to market data…')]
      : [
        `${symbol} ${activeTimeframe} · ${tr('Loading…')}`,
        tr('Aggregating M1 candles…'),
        tr('Preparing chart…'),
      ]
  ), [activeTimeframe, loadingPhase, symbol, tr]);

  useTerminalStartupReady('chart', loadingPhase === 'ready' || loadingPhase === 'hidden');

  const markCandlesReady = useCallback(() => {
    marketDataReadySymbolRef.current = symbol;
    setApiError(null);
    setLoadingPhase(previous => (
      previous === 'connecting' || previous === 'receiving' ? 'ready' : previous
    ));
  }, [symbol]);

  // Keep the surface mounted through its CSS fade, then release it entirely.
  useActiveChartRuntimeEffect(intervalEnabled, () => {
    if (loadingPhase !== 'ready') return;
    const timer = window.setTimeout(() => setLoadingPhase('hidden'), 180);
    return () => window.clearTimeout(timer);
  }, [loadingPhase]);

  useEffect(() => {
    // This resets transient presentation state when a hidden chart loses ownership.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (!isActive) setLoadingMessageIdx(0);
  }, [isActive]);

  useEffect(() => {
    // Selection changes always restart the first loading message.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLoadingMessageIdx(0);
  }, [activeTimeframe, loadingPhase, symbol]);

  // Rotate honest progress states while the initial history request is pending.
  useActiveChartRuntimeEffect(intervalEnabled, () => {
    if (loadingPhase === 'ready' || loadingPhase === 'hidden' || loadingMessages.length <= 1) {
      setLoadingMessageIdx(0);
      return;
    }
    const interval = window.setInterval(() => {
      setLoadingMessageIdx(index => (index + 1) % loadingMessages.length);
    }, 2500);
    return () => window.clearInterval(interval);
  }, [loadingMessages.length, loadingPhase]);

  return {
    loadingMessageIdx,
    loadingMessages,
    loadingPhase,
    markCandlesReady,
    setApiError,
    setLoadingPhase,
  };
}
