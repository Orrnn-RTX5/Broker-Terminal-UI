import { getActiveChartCommandTarget, getPanelIdFromChartContextId } from './chartCommandTarget';
import { useDockLayoutStore } from '../store/useDockLayoutStore';

export const CHART_TIMEFRAMES = ['M1', 'M5', 'M15', 'M30', 'H1', 'H4', 'D1', 'W1', 'MN'] as const;
export type ChartCommandTimeframe = typeof CHART_TIMEFRAMES[number];

/** Apply a timeframe to its dock panel without changing sibling chart props. */
export function applyChartTimeframeCommand(
  payload: { timeframe?: unknown; targetContextId?: string; panelId?: string } | undefined,
  setDefaultTimeframe: (timeframe: ChartCommandTimeframe) => void,
): boolean {
  if (!payload || !CHART_TIMEFRAMES.includes(payload.timeframe as ChartCommandTimeframe)) return false;
  const timeframe = payload.timeframe as ChartCommandTimeframe;
  const activeTarget = getActiveChartCommandTarget();
  const targetContextId = payload.targetContextId ?? (payload.panelId ? undefined : activeTarget.targetContextId);
  const panelId = getPanelIdFromChartContextId(targetContextId) ?? payload.panelId;
  if (panelId) {
    // Only the panel's timeframe is updated; its opaque broker symbol stays intact.
    useDockLayoutStore.getState().updatePanelProps(panelId, { props: { timeframe } });
  } else if (!targetContextId || targetContextId === activeTarget.targetContextId) {
    // A legacy non-dock chart still consumes the App-level default prop.
    setDefaultTimeframe(timeframe);
  }
  return true;
}
