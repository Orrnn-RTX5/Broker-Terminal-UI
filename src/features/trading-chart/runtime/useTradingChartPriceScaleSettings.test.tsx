// @vitest-environment jsdom
import { cleanup, renderHook } from '@testing-library/react';
import type { IChartApi } from 'lightweight-charts';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { defaultChartProperties } from '../../../store/useChartSettingsStore';
import { useTradingChartPriceScaleSettings } from './useTradingChartPriceScaleSettings';

afterEach(cleanup);

function fixture() {
  let autoScale = true;
  let visibleRange = { from: 90, to: 110 };
  const scale = {
    applyOptions: vi.fn((options: { autoScale: boolean }) => {
      autoScale = options.autoScale;
      if (autoScale) visibleRange = { from: 0, to: 200 };
    }),
    setVisibleRange: vi.fn((range: typeof visibleRange) => {
      autoScale = false;
      visibleRange = range;
    }),
  };
  const options: Parameters<typeof useTradingChartPriceScaleSettings>[0] = {
    chartRef: { current: { priceScale: () => scale } as unknown as IChartApi },
    isDisposedRef: { current: false },
    chartSettings: { ...defaultChartProperties },
    symbol: 'BTCUSD',
    timeframe: 'M1',
  };
  return { scale, options, getRange: () => visibleRange, isAutoScale: () => autoScale };
}

describe('chart price scale settings', () => {
  it('retains vertical zoom when switching to Area and receiving the chart-type prop update', () => {
    const runtime = fixture();
    const { rerender } = renderHook(
      ({ options }) => useTradingChartPriceScaleSettings(options),
      { initialProps: { options: runtime.options, chartType: 'candlestick' } },
    );
    const manualRange = { from: 98, to: 102 };
    runtime.scale.setVisibleRange(manualRange);
    runtime.scale.applyOptions.mockClear();

    rerender({ options: { ...runtime.options }, chartType: 'area' });
    rerender({ options: { ...runtime.options }, chartType: 'area' });

    expect(runtime.getRange()).toEqual(manualRange);
    expect(runtime.isAutoScale()).toBe(false);
    expect(runtime.scale.applyOptions).not.toHaveBeenCalled();
  });

  it('retains manual zoom when appearance settings change', () => {
    const runtime = fixture();
    const { rerender } = renderHook(useTradingChartPriceScaleSettings, { initialProps: runtime.options });
    runtime.scale.setVisibleRange({ from: 98, to: 102 });
    runtime.scale.applyOptions.mockClear();

    rerender({ ...runtime.options, chartSettings: {
      ...runtime.options.chartSettings,
      showGrid: !runtime.options.chartSettings.showGrid,
    } });

    expect(runtime.getRange()).toEqual({ from: 98, to: 102 });
    expect(runtime.scale.applyOptions).not.toHaveBeenCalled();
  });

  it('applies explicit fixed limits and resumes autoscale when they are disabled', () => {
    const runtime = fixture();
    const { rerender } = renderHook(useTradingChartPriceScaleSettings, { initialProps: runtime.options });
    rerender({ ...runtime.options, chartSettings: {
      ...runtime.options.chartSettings, scaleFix: true, fixedMinimum: 80, fixedMaximum: 120,
    } });
    expect(runtime.getRange()).toEqual({ from: 80, to: 120 });
    expect(runtime.isAutoScale()).toBe(false);

    rerender(runtime.options);
    expect(runtime.isAutoScale()).toBe(true);
  });

  it('keeps autoscale disabled for one-to-one scaling', () => {
    const runtime = fixture();
    renderHook(useTradingChartPriceScaleSettings, { initialProps: {
      ...runtime.options,
      chartSettings: { ...runtime.options.chartSettings, scaleFixOneToOne: true },
    } });
    expect(runtime.isAutoScale()).toBe(false);
  });

  it('starts a new scale for symbol and timeframe changes', () => {
    const runtime = fixture();
    const { rerender } = renderHook(useTradingChartPriceScaleSettings, { initialProps: runtime.options });
    runtime.scale.setVisibleRange({ from: 98, to: 102 });
    rerender({ ...runtime.options, symbol: 'EURUSD' });
    expect(runtime.isAutoScale()).toBe(true);
    runtime.scale.setVisibleRange({ from: 98, to: 102 });
    rerender({ ...runtime.options, symbol: 'EURUSD', timeframe: 'H1' });
    expect(runtime.isAutoScale()).toBe(true);
  });

  it('leaves an unavailable or disposed chart alone', () => {
    const runtime = fixture();
    renderHook(useTradingChartPriceScaleSettings, { initialProps: {
      ...runtime.options, isDisposedRef: { current: true },
    } });
    renderHook(useTradingChartPriceScaleSettings, { initialProps: {
      ...runtime.options, chartRef: { current: null },
    } });
    expect(runtime.scale.applyOptions).not.toHaveBeenCalled();
  });
});
