import type { IChartApi } from 'lightweight-charts';
import { describe, expect, it, vi } from 'vitest';
import { applyChartTimeZoom } from './chartTimeZoom';

function chartFixture(initialSpacing: number, maximum = 400) {
  let spacing = initialSpacing;
  let pendingSpacing: number | null = null;
  const applyOptions = vi.fn((options: { barSpacing: number }) => {
    pendingSpacing = options.barSpacing;
  });
  const timeScale = {
    getVisibleLogicalRange: vi.fn(() => ({ from: 0, to: 100 } as { from: number; to: number } | null)),
    options: () => ({ barSpacing: spacing }),
    applyOptions,
  };
  return {
    chart: { timeScale: () => timeScale } as unknown as IChartApi,
    timeScale,
    setSpacing: (next: number) => { spacing = next; },
    flushFrame: () => {
      if (pendingSpacing !== null) spacing = Math.max(0.5, Math.min(maximum, pendingSpacing));
      pendingSpacing = null;
      return spacing;
    },
  };
}

describe('chart button zoom', () => {
  it('zooms candles and volume on the shared time scale beyond the old 30px ceiling', () => {
    const { chart, timeScale, flushFrame } = chartFixture(30);
    applyChartTimeZoom(chart, 'in');
    expect(timeScale.applyOptions).toHaveBeenCalledWith({ barSpacing: 36 });
    expect(timeScale.options().barSpacing).toBe(30);
    expect(flushFrame()).toBe(36);
    applyChartTimeZoom(chart, 'out');
    expect(flushFrame()).toBe(30);
  });

  it('starts from the current spacing after wheel zoom or resize instead of a cached value', () => {
    const { chart, setSpacing, flushFrame } = chartFixture(8);
    applyChartTimeZoom(chart, 'in');
    flushFrame();
    setSpacing(60);
    applyChartTimeZoom(chart, 'in');
    expect(flushFrame()).toBe(72);
    setSpacing(24);
    applyChartTimeZoom(chart, 'out');
    expect(flushFrame()).toBe(20);
  });

  it('lets the chart enforce native limits without sending other time scale options', () => {
    const { chart, flushFrame } = chartFixture(100, 100);
    applyChartTimeZoom(chart, 'in');
    expect(flushFrame()).toBe(100);
    const minimum = chartFixture(0.5);
    applyChartTimeZoom(minimum.chart, 'out');
    expect(minimum.flushFrame()).toBe(0.5);
  });

  it('does not zoom an empty chart or pass invalid spacing to the library', () => {
    const { chart, timeScale, setSpacing } = chartFixture(8);
    timeScale.getVisibleLogicalRange.mockReturnValue(null);
    applyChartTimeZoom(chart, 'in');
    timeScale.getVisibleLogicalRange.mockReturnValue({ from: 0, to: 100 });
    setSpacing(NaN);
    applyChartTimeZoom(chart, 'out');
    expect(timeScale.applyOptions).not.toHaveBeenCalled();
  });
});
