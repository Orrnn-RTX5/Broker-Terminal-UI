// @vitest-environment jsdom

import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { IChartApi } from 'lightweight-charts';
import { defaultChartProperties } from '../../../store/useChartSettingsStore';
import { useChartZoomStore } from '../../../store/useChartZoomStore';
import type { Timeframe } from '../../../types/chart';
import type { LogicalRangeLike } from '../../../utils/candleHistory';
import { shouldScrollToRealtime } from './chartRuntime';
import { useTradingChartViewportReset } from './useTradingChartViewportReset';

afterEach(() => {
  cleanup();
  useChartZoomStore.setState({ byContext: {} });
});

const createFixture = (chartShift: boolean, timeframe: Timeframe = 'M1') => {
  let latestIndex = 499;
  let range: LogicalRangeLike = { from: 460, to: 499 };
  const timeScale = {
    setVisibleLogicalRange: vi.fn((next: LogicalRangeLike) => { range = next; }),
    scrollPosition: () => range.to - latestIndex,
  };
  const chart = { timeScale: () => timeScale, priceScale: () => ({ width: () => 60 }) } as unknown as IChartApi;
  const settingsRef = { current: { ...defaultChartProperties, chartShift } };
  const remembered = { current: null as LogicalRangeLike | null };
  const { result } = renderHook(() => useTradingChartViewportReset({
    chartRef: { current: chart },
    chartSettingsRef: settingsRef,
    containerRef: { current: { offsetWidth: 1000 } as HTMLDivElement },
    contextId: 'viewport-test',
    isDisposedRef: { current: false },
    lastRenderedCandlesRef: { current: [] },
    lastVisibleLogicalRangeRef: remembered,
    seriesRef: { current: null },
    timeframe,
  }));
  return { result, chart, timeScale, settingsRef, remembered, getRange: () => range, setLatestIndex: (index: number) => { latestIndex = index; } };
};

describe('latest candle viewport', () => {
  it.each(['M1', 'H1', 'D1', 'W1', 'MN'] as Timeframe[])('starts %s at the latest candle and follows live updates with either shift setting', (timeframe) => {
    for (const chartShift of [false, true]) {
      const fixture = createFixture(chartShift, timeframe);
      act(() => {
        expect(fixture.result.current.applyInitialVisibleLogicalRange(fixture.chart, 500, timeframe)).toBe(true);
      });
      expect(fixture.timeScale.scrollPosition()).toBe(chartShift ? 8 : 0);
      expect(fixture.getRange().from).toBeLessThan(499);
      expect(fixture.getRange().to).toBeGreaterThanOrEqual(499);
      expect(fixture.remembered.current).toEqual(fixture.getRange());
      expect(shouldScrollToRealtime(fixture.chart, true, true, chartShift ? 8 : 0)).toBe(true);
    }
  });

  it('uses a changed Chart Shift setting when the viewport resets again', () => {
    const fixture = createFixture(false);
    act(() => { fixture.result.current.applyInitialVisibleLogicalRange(fixture.chart, 500, 'M1'); });
    const originalSpan = fixture.getRange().to - fixture.getRange().from;
    fixture.settingsRef.current = { ...fixture.settingsRef.current, chartShift: true };
    act(() => { fixture.result.current.applyInitialVisibleLogicalRange(fixture.chart, 500, 'M1'); });
    expect(fixture.timeScale.scrollPosition()).toBe(8);
    expect(fixture.getRange().to - fixture.getRange().from).toBe(originalSpan + 8);
  });

  it('keeps the first sparse live candle inside the plot and leaves an empty chart alone', () => {
    const fixture = createFixture(false);
    fixture.setLatestIndex(0);
    act(() => { fixture.result.current.applyInitialVisibleLogicalRange(fixture.chart, 1, 'M1'); });
    expect(fixture.getRange().to).toBe(0);
    expect(fixture.getRange().from).toBeLessThan(0);
    fixture.timeScale.setVisibleLogicalRange.mockClear();
    act(() => { expect(fixture.result.current.applyInitialVisibleLogicalRange(fixture.chart, 0, 'M1')).toBe(false); });
    expect(fixture.timeScale.setVisibleLogicalRange).not.toHaveBeenCalled();
  });
});
