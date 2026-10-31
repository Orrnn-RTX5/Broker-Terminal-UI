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
      // When the container has a fractional CSS box (e.g. 1105.59px),
      // ResizeObserver contentRect floors to 1104px while offsetWidth rounds
      // to 1106px. Treat an already-sized even surface within one even step
      // (<= 2px) as matching so autoSize is not detached and oscillated.
      const style = chart.chartElement?.()?.style;
      const currentWidth = style ? Number.parseFloat(style.width) : NaN;
      const currentHeight = style ? Number.parseFloat(style.height) : NaN;
      const targetEvenWidth = nextWidth - nextWidth % 2;
      const targetEvenHeight = nextHeight - nextHeight % 2;
      if (
        Number.isFinite(currentWidth)
        && Number.isFinite(currentHeight)
        && currentWidth > 0
        && currentHeight > 0
        && currentWidth % 2 === 0
        && currentHeight % 2 === 0
        && Math.abs(currentWidth - targetEvenWidth) <= 2
        && Math.abs(currentHeight - targetEvenHeight) <= 2
      ) {
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
