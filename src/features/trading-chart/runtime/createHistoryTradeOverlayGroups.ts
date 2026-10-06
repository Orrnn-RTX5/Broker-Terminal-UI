import type { RefObject } from 'react';
import { getTradeHistoryExecutionSide } from '../../../utils/chartTradeHistoryPresentation';
import { createActiveTradeOverlayGroups, type ActiveTradeOverlayGroupPlan } from './createActiveTradeOverlayGroups';
import type { ClosedTradeSnapshot, OverlayNodeData } from './tradeRuntimeContracts';

export function createHistoryTradeOverlayRenderPlans(options: {
  trades: readonly ClosedTradeSnapshot[];
  presentationSignature: string;
  showLines: boolean;
  showArrows: boolean;
  lineOpacity: number;
  resolveLineColor: (trade: ClosedTradeSnapshot) => string;
}) {
  if (!options.showLines && !options.showArrows) return [];
  // Preserve the model's insertion order, including optimistic/reconciled rows.
  return options.trades.map(trade => {
    const exitSide = getTradeHistoryExecutionSide(trade.side, 'CLOSE');
    const lineColor = options.resolveLineColor(trade);
    const signature = JSON.stringify([
      options.presentationSignature, options.showLines, options.showArrows, options.lineOpacity,
      trade.key, trade.symbol, trade.side, exitSide, trade.volume,
      trade.entryPrice, trade.entryTime, trade.entryExecutionTime,
      trade.exitPrice, trade.exitTime, trade.exitExecutionTime,
      trade.profit, trade.source, lineColor,
    ]);
    return { trade, exitSide, lineColor, signature };
  });
}

/** History owns DOM/geometry slices only; active valuation updaters stay separate. */
export function createHistoryTradeOverlayGroups(options: {
  nodes: RefObject<HTMLElement[]>;
  data: RefObject<OverlayNodeData[]>;
}) {
  const groups = createActiveTradeOverlayGroups({ ...options, updaters: { current: [] } });
  return {
    // Close events reconcile exact descriptors; explicit full refresh still
    // discards cached nodes to repair styles/context outside those descriptors.
    reconcile(plans: readonly ActiveTradeOverlayGroupPlan[], force = false) { groups.reconcile(plans, force); },
    dispose: groups.dispose,
  };
}
