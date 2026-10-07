import { useEffect, type RefObject } from 'react';
import type { IChartApi } from 'lightweight-charts';
import type { ChartProperties } from '../../../store/useChartSettingsStore';
import type { Timeframe } from '../../../types/chart';
import { getFixedChartPriceRange } from '../model/indicatorRequest';

interface PriceScaleSettingsOptions {
  chartRef: RefObject<IChartApi | null>;
  isDisposedRef: RefObject<boolean>;
  chartSettings: ChartProperties;
  symbol: string;
  timeframe: Timeframe;
}

export function useTradingChartPriceScaleSettings({
  chartRef,
  isDisposedRef,
  chartSettings: { scaleFixOneToOne, scaleFix, fixedMinimum, fixedMaximum },
  symbol,
  timeframe,
}: PriceScaleSettingsOptions) {
  // Applying autoScale again discards a range selected by dragging the price
  // axis. Only explicit scale settings or a new chart context should do that;
  // chart-type, theme, grid and volume changes must keep the user's zoom.
  useEffect(() => {
    const chart = chartRef.current;
    if (!chart || isDisposedRef.current) return;

    const fixedPriceRange = getFixedChartPriceRange({ scaleFix, fixedMinimum, fixedMaximum });
    try {
      const scale = chart.priceScale('right');
      scale.applyOptions({ autoScale: !scaleFixOneToOne && fixedPriceRange === null });
      if (fixedPriceRange) scale.setVisibleRange(fixedPriceRange);
    } catch {
      // The chart can be disposed during a rapid tab or symbol switch.
    }
  }, [chartRef, isDisposedRef, scaleFixOneToOne, scaleFix, fixedMinimum, fixedMaximum, symbol, timeframe]);
}
