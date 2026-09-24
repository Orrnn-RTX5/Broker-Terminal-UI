import { useMemo } from 'react';
import {
  applyLivePositionProfit,
  resolveTradeAccountMetrics,
  type TradeAccountMetricInput,
  type TradeAccountMetricResolution,
  type TradeProfitInput,
} from '../components/BottomDock.trade';

/**
 * Backend account metrics, kept live between snapshots by the streamed position
 * profit (see applyLivePositionProfit).
 */
export function useLiveAccountMetrics(
  account: TradeAccountMetricInput | null | undefined,
  positions: readonly TradeProfitInput[],
  now: number,
): TradeAccountMetricResolution {
  const resolved = useMemo(() => resolveTradeAccountMetrics(account, now), [account, now]);
  return useMemo(() => applyLivePositionProfit(resolved, positions), [resolved, positions]);
}
