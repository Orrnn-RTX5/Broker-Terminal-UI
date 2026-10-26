// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { MouseEvent as ReactMouseEvent } from 'react';
import type { ISeriesApi, SeriesType } from 'lightweight-charts';
import type { IndicatorManager } from '../../../services/indicatorManager';
import { useChartSettingsStore } from '../../../store/useChartSettingsStore';
import { useTradingChartContextMenuController } from './useTradingChartContextMenu';

const makeController = (overrides: {
  seriesRef?: { current: unknown };
  containerRef?: { current: unknown };
  setCtxMenu?: ReturnType<typeof vi.fn>;
} = {}) => {
  const noop = vi.fn();
  const setCtxMenu = overrides.setCtxMenu ?? vi.fn();
  const hook = renderHook(() => useTradingChartContextMenuController({
    activeChartSourceId: 'click-price-test',
    activeTimeframe: 'M1',
    addLocalIndicator: () => false,
    applyChartTypeInPlace: () => true,
    chartSettingsRef: { current: useChartSettingsStore.getState().globalProperties },
    clearLocalIndicators: noop,
    loadHistory: async () => undefined,
    localIndicatorManager: {} as IndicatorManager,
    persistCurrentIndicators: noop,
    prevTimeframeRef: { current: 'M1' },
    refreshCurrentIndicators: noop,
    setCtxAutoScroll: noop,
    setCtxChartShift: noop,
    setCtxMenu: setCtxMenu as never,
    setCtxShowTradeHistory: noop,
    setCtxShowTradeHistoryLine: noop,
    setCtxShowTradeLevels: noop,
    setLocalChartType: noop,
    setTemplateDialogMode: noop,
    setTemplateDialogOpen: noop,
    symbol: 'EURUSD',
    timeframe: 'M1',
    // Optional chart refs for click-price conversion (fail-closed when absent).
    // Cast through unknown so the mocked series/container match the hook types.
    ...(overrides.seriesRef !== undefined
      ? { seriesRef: overrides.seriesRef as never }
      : {}),
    ...(overrides.containerRef !== undefined
      ? { containerRef: overrides.containerRef as never }
      : {}),
  }));
  return { ...hook, setCtxMenu };
};

const makeContextMenuEvent = (clientX: number, clientY: number): ReactMouseEvent => ({
  preventDefault: vi.fn(),
  clientX,
  clientY,
  target: document.createElement('div'),
} as unknown as ReactMouseEvent);

describe('chart context menu click price (T10)', () => {
  it('carries the series-converted click price into ctxMenu for limit/stop drafts', () => {
    const coordinateToPrice = vi.fn((y: number) => 1.2345 + y * 0);
    const seriesRef = {
      current: { coordinateToPrice } as unknown as ISeriesApi<SeriesType>,
    };
    const containerRef = {
      current: {
        getBoundingClientRect: () => ({ top: 50, left: 0, width: 800, height: 600 }),
      } as unknown as HTMLDivElement,
    };
    const { result, setCtxMenu } = makeController({ seriesRef, containerRef });

    act(() => result.current.handleContextMenu(makeContextMenuEvent(200, 150)));

    expect(setCtxMenu).toHaveBeenCalledTimes(1);
    // clientY 150 - rect.top 50 = pane-relative y 100
    expect(coordinateToPrice).toHaveBeenCalledWith(100);
    expect(setCtxMenu).toHaveBeenCalledWith(
      expect.objectContaining({ visible: true, x: 200, y: 150, clickPrice: 1.2345 }),
    );
  });

  it('leaves clickPrice undefined when the series ref is missing (fail-closed)', () => {
    const containerRef = {
      current: {
        getBoundingClientRect: () => ({ top: 50, left: 0, width: 800, height: 600 }),
      } as unknown as HTMLDivElement,
    };
    const { result, setCtxMenu } = makeController({
      seriesRef: { current: null },
      containerRef,
    });

    act(() => result.current.handleContextMenu(makeContextMenuEvent(200, 150)));

    expect(setCtxMenu).toHaveBeenCalledWith(
      expect.objectContaining({ visible: true, clickPrice: undefined }),
    );
  });

  it('leaves clickPrice undefined when the container ref is missing (fail-closed)', () => {
    const coordinateToPrice = vi.fn(() => 1.2345);
    const seriesRef = {
      current: { coordinateToPrice } as unknown as ISeriesApi<SeriesType>,
    };
    const { result, setCtxMenu } = makeController({
      seriesRef,
      containerRef: { current: null },
    });

    act(() => result.current.handleContextMenu(makeContextMenuEvent(200, 150)));

    expect(coordinateToPrice).not.toHaveBeenCalled();
    expect(setCtxMenu).toHaveBeenCalledWith(
      expect.objectContaining({ visible: true, clickPrice: undefined }),
    );
  });

  it.each([
    ['NaN', NaN],
    ['zero', 0],
    ['negative', -1.5],
    ['null', null],
  ])('leaves clickPrice undefined for non-positive conversion result %s (fail-closed)', (_label, raw) => {
    const coordinateToPrice = vi.fn(() => raw);
    const seriesRef = {
      current: { coordinateToPrice } as unknown as ISeriesApi<SeriesType>,
    };
    const containerRef = {
      current: {
        getBoundingClientRect: () => ({ top: 50, left: 0, width: 800, height: 600 }),
      } as unknown as HTMLDivElement,
    };
    const { result, setCtxMenu } = makeController({ seriesRef, containerRef });

    act(() => result.current.handleContextMenu(makeContextMenuEvent(200, 150)));

    expect(setCtxMenu).toHaveBeenCalledWith(
      expect.objectContaining({ visible: true, clickPrice: undefined }),
    );
  });

  it('leaves clickPrice undefined when coordinateToPrice throws (fail-closed, menu still opens)', () => {
    const coordinateToPrice = vi.fn(() => { throw new Error('disposed'); });
    const seriesRef = {
      current: { coordinateToPrice } as unknown as ISeriesApi<SeriesType>,
    };
    const containerRef = {
      current: {
        getBoundingClientRect: () => ({ top: 50, left: 0, width: 800, height: 600 }),
      } as unknown as HTMLDivElement,
    };
    const { result, setCtxMenu } = makeController({ seriesRef, containerRef });

    act(() => result.current.handleContextMenu(makeContextMenuEvent(200, 150)));

    expect(setCtxMenu).toHaveBeenCalledWith(
      expect.objectContaining({ visible: true, x: 200, y: 150, clickPrice: undefined }),
    );
  });
});
