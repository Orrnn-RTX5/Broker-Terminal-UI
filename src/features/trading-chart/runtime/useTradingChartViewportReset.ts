import { useCallback, useEffect } from 'react';
import type { MutableRefObject, RefObject } from 'react';
import type { IChartApi, ISeriesApi, SeriesType } from 'lightweight-charts';

import type { Candle, Timeframe } from '../../../types/chart';
import type { ChartProperties } from '../../../store/useChartSettingsStore';
import type { LogicalRangeLike } from '../../../utils/candleHistory';
import {
  getTradingChartDefaultVisibleBars,
  getTradingChartInitialLogicalRange,
  getTradingChartShiftRightOffset,
} from '../../../utils/chartTimeFormat';
import { useChartZoomStore } from '../../../store/useChartZoomStore';
import { computeAdaptiveVisibleBars } from './chartRuntime';

interface UseTradingChartViewportResetOptions {
  chartRef: MutableRefObject<IChartApi | null>;
  chartSettingsRef: RefObject<ChartProperties>;
  containerRef: RefObject<HTMLDivElement | null>;
  contextId: string;
  isDisposedRef: MutableRefObject<boolean>;
  lastRenderedCandlesRef: MutableRefObject<Candle[]>;
  lastVisibleLogicalRangeRef: MutableRefObject<LogicalRangeLike | null>;
  seriesRef: MutableRefObject<ISeriesApi<SeriesType> | null>;
  timeframe: Timeframe;
}

export function useTradingChartViewportReset({
  chartRef,
  chartSettingsRef,
  containerRef,
  contextId,
  isDisposedRef,
  lastRenderedCandlesRef,
  lastVisibleLogicalRangeRef,
  seriesRef,
  timeframe,
}: UseTradingChartViewportResetOptions) {
  const rememberVisibleLogicalRange = useCallback((range: LogicalRangeLike | null | undefined) => {
    if (!range || !Number.isFinite(range.from) || !Number.isFinite(range.to)) return;
    lastVisibleLogicalRangeRef.current = { from: range.from, to: range.to };
  }, [lastVisibleLogicalRangeRef]);

  const applyInitialVisibleLogicalRange = useCallback((
    chart: IChartApi,
    totalBars: number,
    activeTimeframe: Timeframe,
  ): boolean => {
    if (totalBars <= 0) return false;

    const visibleBars = computeAdaptiveVisibleBars(
      containerRef.current,
      chart,
      totalBars,
      getTradingChartDefaultVisibleBars(activeTimeframe),
    );
    if (visibleBars <= 0) return false;

    const initialRange = getTradingChartInitialLogicalRange({
      timeframe: activeTimeframe,
      totalBars,
      adaptiveVisibleBars: visibleBars,
    });
    if (!initialRange) return false;

    // Logical indexes start at zero. Keep the last actual candle fully inside
    // the plot, with extra space only when the user enables Chart Shift.
    const rightOffset = getTradingChartShiftRightOffset(activeTimeframe, chartSettingsRef.current.chartShift);
    const liveRange = { from: initialRange.from, to: totalBars - 1 + rightOffset };
    const timeScale = chart.timeScale();
    timeScale.setVisibleLogicalRange(liveRange);
    rememberVisibleLogicalRange(liveRange);

    // Capture a fresh zoom baseline after the new range settles on the chart.
    useChartZoomStore.getState().clearContext(contextId);
    return true;
  }, [chartSettingsRef, containerRef, contextId, rememberVisibleLogicalRange]);

  // Reset Layout restores the default candle zoom and scroll.
  useEffect(() => {
    const handleResetLayoutZoom = () => {
      const chart = chartRef.current;
      if (!chart || isDisposedRef.current) return;
      const totalBars = lastRenderedCandlesRef.current.length;
      seriesRef.current?.priceScale().applyOptions({ autoScale: true });
      applyInitialVisibleLogicalRange(chart, totalBars, timeframe);
    };

    window.addEventListener('resetLayout', handleResetLayoutZoom);
    return () => window.removeEventListener('resetLayout', handleResetLayoutZoom);
  }, [
    applyInitialVisibleLogicalRange,
    chartRef,
    isDisposedRef,
    lastRenderedCandlesRef,
    seriesRef,
    timeframe,
  ]);

  return {
    applyInitialVisibleLogicalRange,
    rememberVisibleLogicalRange,
  };
}
