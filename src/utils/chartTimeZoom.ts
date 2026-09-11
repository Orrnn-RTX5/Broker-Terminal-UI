import type { IChartApi } from 'lightweight-charts';

export const CHART_ZOOM_FACTOR = 1.2;

/** Candles, volume, and indicators share this scale, so their bars stay aligned. */
export function applyChartTimeZoom(chart: IChartApi, direction: 'in' | 'out'): void {
  const timeScale = chart.timeScale();
  if (!timeScale.getVisibleLogicalRange()) return;

  // Read the actual scale after wheel zoom, resizing, or a viewport restore.
  const currentSpacing = timeScale.options().barSpacing;
  if (!Number.isFinite(currentSpacing) || currentSpacing <= 0) return;

  // The library applies this on its next frame and enforces native spacing limits.
  timeScale.applyOptions({
    barSpacing: direction === 'in'
      ? currentSpacing * CHART_ZOOM_FACTOR
      : currentSpacing / CHART_ZOOM_FACTOR,
  });
}
