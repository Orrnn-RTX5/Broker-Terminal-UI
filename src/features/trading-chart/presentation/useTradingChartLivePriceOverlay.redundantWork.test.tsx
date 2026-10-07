// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { IPriceLine, ISeriesApi, PriceLineOptions, SeriesType } from 'lightweight-charts';
import { defaultChartProperties } from '../../../store/useChartSettingsStore';
import { useTradingChartLivePriceOverlay } from './useTradingChartLivePriceOverlay';

const setupLines = () => {
  let options = {} as PriceLineOptions;
  const applyOptions = vi.fn((next: Partial<PriceLineOptions>) => { options = { ...options, ...next }; });
  const line = { applyOptions, options: () => options } as IPriceLine;
  const createPriceLine = vi.fn((next: PriceLineOptions) => { options = { ...next }; return line; });
  const settings = { ...defaultChartProperties, colors: { ...defaultChartProperties.colors }, showAskPriceLine: true, showLastPriceLine: false };
  const { result } = renderHook(() => useTradingChartLivePriceOverlay({
    canPaintLivePrice: () => true,
    diagnosticChartId: 'redundancy-test', symbol: 'BTCUSD', timeframe: 'M1',
    askPriceLineRef: { current: null }, lastPriceLineRef: { current: null },
    chartSettingsRef: { current: settings }, chartType: 'candlestick', currentCandleRef: { current: null },
    isDisposedRef: { current: false }, resolvedPriceDigitsRef: { current: 2 },
    seriesRef: { current: { createPriceLine } as unknown as ISeriesApi<SeriesType> },
  }));
  return { result, line, applyOptions, createPriceLine, settings };
};

describe('supplemental price-line redundant invalidations', () => {
  it('does not ask the chart to invalidate identical line options on every 50ms poll', () => {
    const { result, applyOptions, createPriceLine } = setupLines();
    act(() => {
      for (let poll = 0; poll < 20; poll++) result.current.syncSupplementalPriceLines(86015, 86000);
    });
    expect(createPriceLine).toHaveBeenCalledOnce();
    expect(applyOptions).not.toHaveBeenCalled();
  });

  it('still updates executable Ask changes and restores externally hidden lines', () => {
    const { result, line, applyOptions } = setupLines();
    act(() => result.current.syncSupplementalPriceLines(86015, 86000));
    act(() => result.current.syncSupplementalPriceLines(86016, 86000));
    expect(line.options().price).toBe(86016);
    expect(applyOptions).toHaveBeenCalledOnce();
    line.applyOptions({ lineVisible: false, axisLabelVisible: false });
    act(() => result.current.syncSupplementalPriceLines(86016, 86000));
    expect(line.options()).toMatchObject({ lineVisible: true, axisLabelVisible: true, price: 86016 });
  });

  it('hides an existing line only once while disabled and restores it when enabled', () => {
    const { result, line, applyOptions, settings } = setupLines();
    act(() => result.current.syncSupplementalPriceLines(86015, 86000));
    settings.showAskPriceLine = false;
    act(() => {
      for (let poll = 0; poll < 20; poll++) result.current.syncSupplementalPriceLines(86015, 86000);
    });
    expect(applyOptions).toHaveBeenCalledOnce();
    expect(line.options()).toMatchObject({ lineVisible: false, axisLabelVisible: false });
    settings.showAskPriceLine = true;
    act(() => result.current.syncSupplementalPriceLines(86015, 86000));
    expect(applyOptions).toHaveBeenCalledTimes(2);
    expect(line.options()).toMatchObject({ lineVisible: true, axisLabelVisible: true });
  });

  it('applies color changes with an unchanged quote and recreates a broken line', () => {
    const { result, line, applyOptions, createPriceLine, settings } = setupLines();
    act(() => result.current.syncSupplementalPriceLines(86015, 86000));
    settings.colors.askPriceLine = '#123456';
    act(() => result.current.syncSupplementalPriceLines(86015, 86000));
    expect(applyOptions).toHaveBeenCalledOnce();
    expect(line.options().color).toBe('#123456');
    vi.spyOn(line, 'options').mockImplementationOnce(() => { throw new Error('disposed line'); });
    act(() => result.current.syncSupplementalPriceLines(86015, 86000));
    act(() => result.current.syncSupplementalPriceLines(86015, 86000));
    expect(createPriceLine).toHaveBeenCalledTimes(2);
  });
});
