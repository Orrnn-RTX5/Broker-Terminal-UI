import { useEffect, useSyncExternalStore } from 'react';
import { getActiveChartSource, getActiveChartSourceId, subscribeActiveChartSource } from '../../services/activeChartSource';
import { useHasMultipleVisibleChartWindows } from './StableChartHosts';

const getServerSnapshot = () => false;

/** Follow the command target without rerendering chart canvases on selection. */
export function ActiveChartWindowBorder({ panelId }: { panelId: string }) {
  const multipleVisibleWindows = useHasMultipleVisibleChartWindows();
  useEffect(() => {
    // Revealing a tab/restoring a window can hide the previous target without
    // a canvas click. Resolve the same visible fallback used by chart commands.
    getActiveChartSource();
  }, [panelId]);

  const selected = useSyncExternalStore(
    subscribeActiveChartSource,
    () => getActiveChartSourceId() === `trading-chart:${panelId}`,
    getServerSnapshot,
  );

  if (!multipleVisibleWindows) return null;

  return <div
    className="rtx-chart-window-focus"
    data-chart-window-focus={panelId}
    data-selected={selected ? 'true' : 'false'}
    aria-hidden="true"
  />;
}
