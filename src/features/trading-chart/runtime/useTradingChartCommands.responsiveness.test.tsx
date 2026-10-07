// @vitest-environment jsdom
import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { commandBus } from '../../../services/commandBus';
import type { ChartType } from '../../../types/chart';
import { useTradingChartCommands } from './useTradingChartCommands';

type Options = Parameters<typeof useTradingChartCommands>[0];
const ref = <T,>(current: T) => ({ current });

const createHarness = () => {
  const timeScale = { applyOptions: vi.fn(), scrollToRealTime: vi.fn() };
  const chart = { timeScale: () => timeScale };
  const options = {
    applyChartTypeInPlace: vi.fn(() => true),
    isChartCommandTarget: (payload: { targetContextId?: string }) => payload.targetContextId === 'chart-a',
    isDisposedRef: ref(false), chartRef: ref(chart),
    getCandlesForFullRender: () => Array.from({ length: 100 }, (_, time) => ({ time })),
    prevTimeframeRef: ref('M1'), timeframe: 'M1',
    scrollToLatestCandleNow: vi.fn(), autoScrollEnabledRef: ref(false),
    ctxChartShiftRef: ref(false), setCtxAutoScroll: vi.fn(), setCtxChartShift: vi.fn(),
  } as unknown as Options;
  const view = renderHook(() => useTradingChartCommands(options));
  return { options, timeScale, chart, view };
};

afterEach(cleanup);

describe('chart controls immediate feedback', () => {
  it.each(['bar', 'candlestick', 'line', 'area'] as ChartType[])('paints %s synchronously on the targeted chart', type => {
    const { options } = createHarness();
    act(() => {
      commandBus.dispatch({ type: 'SET_CHART_TYPE', payload: { chartType: type, targetContextId: 'chart-a' } });
      // No timer, idle callback, React prop hydration, or network turn is needed.
      expect(options.applyChartTypeInPlace).toHaveBeenCalledExactlyOnceWith(type);
    });
  });

  it('rejects sibling and disposed charts and releases its subscription on unmount', () => {
    const { options, view } = createHarness();
    act(() => { commandBus.dispatch({ type: 'SET_CHART_TYPE', payload: { chartType: 'area', targetContextId: 'chart-b' } }); });
    options.isDisposedRef.current = true;
    act(() => { commandBus.dispatch({ type: 'SET_CHART_TYPE', payload: { chartType: 'line', targetContextId: 'chart-a' } }); });
    expect(options.applyChartTypeInPlace).not.toHaveBeenCalled();
    options.isDisposedRef.current = false;
    view.unmount();
    commandBus.dispatch({ type: 'SET_CHART_TYPE', payload: { chartType: 'bar', targetContextId: 'chart-a' } });
    expect(options.applyChartTypeInPlace).not.toHaveBeenCalled();
  });

  it.each(['SET_AUTO_SCROLL', 'SET_CHART_SHIFT'] as const)('applies %s and jumps without starting a scrolling animation', type => {
    const { options, timeScale, chart } = createHarness();
    act(() => {
      commandBus.dispatch({ type, payload: { enabled: true, targetContextId: 'chart-a' } });
      expect(options.scrollToLatestCandleNow).toHaveBeenCalledExactlyOnceWith(chart);
    });
    expect(timeScale.scrollToRealTime).not.toHaveBeenCalled();
    if (type === 'SET_CHART_SHIFT') expect(timeScale.applyOptions).toHaveBeenCalledWith(expect.objectContaining({ rightOffset: 8 }));
  });

  it('does not jump when Auto Scroll is disabled', () => {
    const { options } = createHarness();
    act(() => { commandBus.dispatch({ type: 'SET_AUTO_SCROLL', payload: { enabled: false, targetContextId: 'chart-a' } }); });
    expect(options.autoScrollEnabledRef.current).toBe(false);
    expect(options.scrollToLatestCandleNow).not.toHaveBeenCalled();
  });

  it('scrolls a sparse startup chart immediately instead of fetching reset history', () => {
    const { options, chart } = createHarness();
    options.getCandlesForFullRender = () => [{ time: 1000 }] as never;
    act(() => {
      commandBus.dispatch({ type: 'SET_AUTO_SCROLL', payload: { enabled: true, targetContextId: 'chart-a' } });
      expect(options.scrollToLatestCandleNow).toHaveBeenCalledExactlyOnceWith(chart);
    });
  });
});
