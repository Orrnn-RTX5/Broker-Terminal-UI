// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { IPriceLine, ISeriesApi, SeriesType } from 'lightweight-charts';
import { useTradingChartLivePriceOverlay } from './useTradingChartLivePriceOverlay';
import { defaultChartProperties, normalizeChartProperties } from '../../../store/useChartSettingsStore';

describe('forming candle and chart price line alignment', () => {
  afterEach(() => vi.restoreAllMocks());

  it.each([
    ['Green and White', 99],
    ['Green and White', 101],
    ['Green and Blue', 99],
    ['Green and Blue', 101],
  ] as const)('keeps the configured slate bid line visible for %s with a candle closing at %s', (colorScheme, close) => {
    const settings = normalizeChartProperties({ colorScheme });
    const candle = { time: 1, open: 100, high: 102, low: 98, close, volume: 1 };
    const { result } = renderHook(() => useTradingChartLivePriceOverlay({
      canPaintLivePrice: () => true,
      askPriceLineRef: { current: null }, lastPriceLineRef: { current: null },
      chartSettingsRef: { current: settings }, chartType: 'candlestick',
      currentCandleRef: { current: candle }, isDisposedRef: { current: false },
      resolvedPriceDigitsRef: { current: 2 }, seriesRef: { current: null },
    }));
    result.current.livePriceColorPaletteRef.current = settings.colors;
    expect(result.current.getLivePriceDirectionalColor(candle.time, close)).toBe('#778899');
  });

  it.each([1.13025, 178.955, 4161.77, 84362.19])('paints the exact candle Close %s at its scale coordinate', close => {
    vi.spyOn(window, 'requestAnimationFrame').mockReturnValue(1);
    vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => undefined);
    const priceToCoordinate = vi.fn(() => 142.5);
    const candle = { time: 1_790_860_020, open: close - 1, high: close + 1, low: close - 2, close, volume: 1 };
    const { result } = renderHook(() => useTradingChartLivePriceOverlay({
      canPaintLivePrice: () => true,
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

describe('price line ownership during login', () => {
  afterEach(() => vi.restoreAllMocks());
  const setup = (canPaintLivePrice = () => true) => {
    const askApply = vi.fn();
    const lastApply = vi.fn();
    const ask = { current: { applyOptions: askApply } as unknown as IPriceLine };
    const last = { current: { applyOptions: lastApply } as unknown as IPriceLine };
    const createPriceLine = vi.fn();
    const priceToCoordinate = vi.fn(() => 143);
    const view = renderHook(() => useTradingChartLivePriceOverlay({
      canPaintLivePrice,
      askPriceLineRef: ask, lastPriceLineRef: last,
      chartSettingsRef: { current: normalizeChartProperties({ showAskPriceLine: true, showLastPriceLine: true }) },
      chartType: 'candlestick', currentCandleRef: { current: null },
      isDisposedRef: { current: false }, resolvedPriceDigitsRef: { current: 2 },
      seriesRef: { current: { createPriceLine, priceToCoordinate, priceScale: () => ({ width: () => 72 }) } as unknown as ISeriesApi<SeriesType> },
    }));
    return { ...view, ask, last, askApply, lastApply, createPriceLine, priceToCoordinate };
  };

  it('hides old ASK and LAST lines with the cleared price and restores them from a valid new quote', () => {
    const view = setup();
    const line = document.createElement('div');
    const badge = document.createElement('div');
    const value = document.createElement('span');
    view.result.current.livePriceLineRef.current = line;
    view.result.current.livePriceBadgeRef.current = badge;
    view.result.current.livePriceValueRef.current = value;
    view.result.current.livePriceRef.current = 100;
    value.textContent = '100';
    act(() => view.result.current.hideLivePriceOverlay());
    for (const apply of [view.askApply, view.lastApply]) {
      expect(apply).toHaveBeenLastCalledWith({ lineVisible: false, axisLabelVisible: false });
    }
    expect(line.style.display).toBe('none');
    expect(badge.style.top).toBe('-9999px');
    expect(value.textContent).toBe('');
    expect(view.result.current.livePriceRef.current).toBeNull();
    act(() => view.result.current.syncSupplementalPriceLines(102, 101));
    expect(view.askApply).toHaveBeenLastCalledWith(expect.objectContaining({
      price: 102, title: 'ASK', lineVisible: true, axisLabelVisible: true,
    }));
    expect(view.lastApply).toHaveBeenLastCalledWith(expect.objectContaining({
      price: 101, title: 'LAST', lineVisible: true, axisLabelVisible: true,
    }));
    expect(view.createPriceLine).not.toHaveBeenCalled();
  });

  it('preserves configured ASK and LAST lines when only the bid overlay is hidden', () => {
    const view = setup();
    act(() => view.result.current.hideLivePriceOverlay(false));
    expect(view.askApply).not.toHaveBeenCalled();
    expect(view.lastApply).not.toHaveBeenCalled();
  });

  it('clears the other line even when one canvas price line has been disposed', () => {
    const view = setup();
    view.askApply.mockImplementation(() => { throw new Error('disposed'); });
    act(() => view.result.current.hideLivePriceOverlay());
    expect(view.ask.current).toBeNull();
    expect(view.lastApply).toHaveBeenCalledWith({ lineVisible: false, axisLabelVisible: false });
  });

  it('keeps precision and setting-driven repaints behind the selection baseline', () => {
    vi.spyOn(window, 'requestAnimationFrame').mockReturnValue(1);
    vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => undefined);
    let allowed = false;
    const view = setup(() => allowed);
    const line = document.createElement('div');
    const badge = document.createElement('div');
    line.style.display = 'none';
    badge.style.display = 'none';
    view.result.current.livePriceLineRef.current = line;
    view.result.current.livePriceBadgeRef.current = badge;
    const candle = { time: 1, open: 100, high: 102, low: 99, close: 101, volume: 1 };
    act(() => {
      view.result.current.repaintLivePriceOverlayFromCurrentPrice(candle);
      view.result.current.syncSupplementalPriceLines(102, 101);
    });
    expect(view.priceToCoordinate).not.toHaveBeenCalled();
    expect(view.askApply).not.toHaveBeenCalled();
    expect(view.lastApply).not.toHaveBeenCalled();
    expect(view.result.current.livePriceRef.current).toBeNull();
    expect(line.style.display).toBe('none');
    allowed = true;
    act(() => view.result.current.repaintLivePriceOverlayFromCurrentPrice(candle));
    expect(view.priceToCoordinate).toHaveBeenCalledWith(101);
    expect(line.style.top).toBe('143px');
    expect(line.style.display).toBe('block');
  });

  it('does not let a queued old-selection repaint resurrect a hidden price line', () => {
    let frame: FrameRequestCallback | undefined;
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation(callback => { frame = callback; return 1; });
    vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => undefined);
    let allowed = true;
    const view = setup(() => allowed);
    const line = document.createElement('div');
    view.result.current.livePriceLineRef.current = line;
    view.result.current.livePriceBadgeRef.current = document.createElement('div');
    act(() => view.result.current.repaintLivePriceOverlayFromCurrentPrice({ time: 1, open: 100, high: 102, low: 99, close: 101, volume: 1 }));
    allowed = false;
    act(() => { view.result.current.hideLivePriceOverlay(); frame?.(0); });
    expect(view.priceToCoordinate).toHaveBeenCalledTimes(1);
    expect(view.result.current.livePriceRef.current).toBeNull();
    expect(line.style.display).toBe('none');
    expect(line.style.top).toBe('-9999px');
  });
});
