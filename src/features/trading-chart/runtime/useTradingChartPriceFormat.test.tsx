// @vitest-environment jsdom
import { cleanup, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useTradingChartPriceFormat } from './useTradingChartPriceFormat';

afterEach(cleanup);

type Options = Parameters<typeof useTradingChartPriceFormat>[0];

function fixture() {
  const series = { applyOptions: vi.fn() };
  const host = { applyOptions: vi.fn() };
  const options = {
    seriesRef: { current: series }, squareGridHostSeriesRef: { current: host },
    isDisposedRef: { current: false }, digits: 2, point: 0.01,
  } as unknown as Options;
  return { options, series, host };
}

describe('instrument price formatting', () => {
  it('updates both axis and candle precision when switching from crypto to FX and receiving broker metadata', () => {
    const { options, series, host } = fixture();
    const view = renderHook(useTradingChartPriceFormat, { initialProps: options });
    for (const [digits, point] of [[5, 0.00001], [4, 0.0001], [3, 0.001], [2, 0.01]] as const) {
      view.rerender({ ...options, digits, point });
      for (const source of [series, host]) {
        expect(source.applyOptions).toHaveBeenLastCalledWith({
          priceFormat: { type: 'price', precision: digits, minMove: point },
        });
      }
    }
    // Applying only format options preserves the user's chosen scale range.
    expect(host.applyOptions.mock.calls.every(([update]) => Object.keys(update).join() === 'priceFormat')).toBe(true);
  });

  it('updates the grid host when the visible series has not mounted yet', () => {
    const { options, host } = fixture();
    renderHook(useTradingChartPriceFormat, { initialProps: {
      ...options, seriesRef: { current: null }, digits: 5, point: 0.00001,
    } });
    expect(host.applyOptions).toHaveBeenCalledWith({ priceFormat: {
      type: 'price', precision: 5, minMove: 0.00001,
    } });
  });

  it('does not touch a disposed chart', () => {
    const { options, series, host } = fixture();
    renderHook(useTradingChartPriceFormat, { initialProps: {
      ...options, isDisposedRef: { current: true },
    } });
    expect(series.applyOptions).not.toHaveBeenCalled();
    expect(host.applyOptions).not.toHaveBeenCalled();
  });
});
