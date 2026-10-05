// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ISeriesApi, SeriesType } from 'lightweight-charts';
import { useTradingChartLivePriceOverlay } from './useTradingChartLivePriceOverlay';
import { defaultChartProperties } from '../../../store/useChartSettingsStore';

describe('forming candle and chart price line alignment', () => {
  afterEach(() => vi.restoreAllMocks());

  it.each([1.13025, 178.955, 4161.77, 84362.19])('paints the exact candle Close %s at its scale coordinate', close => {
    vi.spyOn(window, 'requestAnimationFrame').mockReturnValue(1);
    vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => undefined);
    const priceToCoordinate = vi.fn(() => 142.5);
    const candle = { time: 1_790_860_020, open: close - 1, high: close + 1, low: close - 2, close, volume: 1 };
    const { result } = renderHook(() => useTradingChartLivePriceOverlay({
      diagnosticChartId: 'test-chart', symbol: 'BTCUSD', timeframe: 'M1',
      askPriceLineRef: { current: null }, lastPriceLineRef: { current: null },
      chartSettingsRef: { current: defaultChartProperties }, chartType: 'candlestick',
      currentCandleRef: { current: candle }, isDisposedRef: { current: false },
      resolvedPriceDigitsRef: { current: 5 },
      seriesRef: { current: { priceToCoordinate, priceScale: () => ({ width: () => 72 }) } as unknown as ISeriesApi<SeriesType> },
    }));
    const line = document.createElement('div');
    const badge = document.createElement('div');
    const value = document.createElement('span');
    result.current.livePriceLineRef.current = line;
    result.current.livePriceBadgeRef.current = badge;
    result.current.livePriceValueRef.current = value;
    act(() => result.current.repaintLivePriceOverlayFromCurrentPrice(candle));
    expect(priceToCoordinate).toHaveBeenCalledWith(close);
    expect(result.current.livePriceRef.current).toBe(close);
    expect(Number(value.textContent?.replace(/,/g, ''))).toBe(close);
    expect(line.style.top).toBe('142.5px');
    expect(badge.style.top).toBe('142.5px');
    expect(line.style.right).toBe('72px');
    expect(badge.style.width).toBe('72px');
  });
});
