import type { IChartApi } from 'lightweight-charts';

type RefreshableChart = Pick<IChartApi, 'applyOptions' | 'autoSizeActive' | 'resize'>;

export const refreshLightweightChartSurface = (
  chart: RefreshableChart,
  width: number,
  height: number,
): boolean => {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    return false;
  }

  const nextWidth = Math.floor(width);
  const nextHeight = Math.floor(height);
  let restoreAutoSize = false;

  try {
    restoreAutoSize = chart.autoSizeActive();
    if (restoreAutoSize) {
      // Lightweight Charts ignores explicit dimensions while autoSize is active.
      // Briefly detach its ResizeObserver so a same-size theme transition can
      // force a real canvas repaint instead of leaving a cleared surface behind.
      chart.applyOptions({ autoSize: false, width: nextWidth, height: nextHeight });
    }

    chart.resize(nextWidth, nextHeight, true);
    chart.applyOptions({});
    return true;
  } catch {
    return false;
  } finally {
    if (restoreAutoSize) {
      try {
        chart.applyOptions({ autoSize: true });
      } catch {
        // The chart may have been disposed during a fast workspace switch.
      }
    }
  }
};
