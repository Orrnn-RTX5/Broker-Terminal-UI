import type { IChartApi } from 'lightweight-charts';

type RefreshableChart = Pick<IChartApi, 'applyOptions' | 'autoSizeActive' | 'resize'>
  & Partial<Pick<IChartApi, 'chartElement'>>;

export const refreshLightweightChartSurface = (
  chart: RefreshableChart,
  width: number,
  height: number,
  { forceRepaint = true }: { forceRepaint?: boolean } = {},
): boolean => {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    return false;
  }

  const nextWidth = Math.floor(width);
  const nextHeight = Math.floor(height);
  let restoreAutoSize = false;

  try {
    if (!forceRepaint) {
      // The public chart element holds the library's applied dimensions. Read
      // its inline values without forcing layout; Lightweight Charts rounds
      // both dimensions down to even pixels to keep the canvas inside its host.
      const style = chart.chartElement?.()?.style;
      if (style
        && Number.parseFloat(style.width) === nextWidth - nextWidth % 2
        && Number.parseFloat(style.height) === nextHeight - nextHeight % 2) {
        return true;
      }
    }

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
