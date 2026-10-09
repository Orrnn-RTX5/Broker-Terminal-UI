// @vitest-environment jsdom
import { cleanup, renderHook } from '@testing-library/react';
import { StrictMode, useEffect } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useTradingChartReconfiguration } from './useTradingChartReconfiguration';

vi.mock('../../../services/drawingManager', () => ({ drawingManager: {
  setChart: vi.fn(), setScrollLockCallbacks: vi.fn(() => () => {}),
} }));

afterEach(cleanup);

describe('chart command prop catch-up', () => {
  const options = () => ({
    isDisposedRef: { current: false }, chartRef: { current: {} }, seriesRef: { current: {} },
    prevChartTypeRef: { current: 'line' }, chartType: 'line',
    prevSymbolRef: { current: 'BTCUSD' }, symbol: 'BTCUSD',
    prevTimeframeRef: { current: 'M1' }, timeframe: 'M1',
    candlesRef: { current: [{ time: 1000 }] },
    applyChartTypeInPlace: vi.fn(() => true), updateChartData: vi.fn(),
  } as unknown as Parameters<typeof useTradingChartReconfiguration>[0]);

  const mountedOptions = () => {
    const runtime = options();
    const series = { setData: vi.fn(), priceScale: () => ({ applyOptions: vi.fn() }) };
    const chart = { addSeries: vi.fn(() => series), subscribeClick: vi.fn(), subscribeCrosshairMove: vi.fn(),
      timeScale: () => ({ subscribeVisibleLogicalRangeChange: vi.fn() }) };
    Object.assign(runtime, {
      chartRef: { current: null }, seriesRef: { current: null }, volumeRef: { current: null },
      containerRef: { current: document.createElement('div') }, overlayRef: { current: document.createElement('div') },
      drawingRuntimeContextRef: { current: { contextId: 'chart-a', symbol: 'BTCUSD', timeframe: 'M1' } },
      activeChartSourceId: 'chart-a', chartThemeRef: { current: {} },
      createPriceSeries: vi.fn(() => series), hydrateHistoryFromCache: vi.fn(() => true),
      clearPeriodSeparators: vi.fn(), resetLiveQuotePriceGuard: vi.fn(), cancelQueuedChartRender: vi.fn(),
      clearLocalChartPointerStateRef: { current: vi.fn() },
      activeToolRef: { current: null },
    });
    for (const key of ['isRebuildingRef', 'isChartUserInteractingRef', 'isChartInteractionActiveRef', 'hasDisplayedHistoryRef',
      'resetVisibleRangeOnNextDataRef', 'hasReachedBeginningRef', 'isLoadingMoreRef']) Object.assign(runtime, { [key]: { current: false } });
    for (const key of ['askPriceLineRef', 'lastPriceLineRef', 'currentCandleRef', 'prevPriceRef', 'chartInteractionOwnershipRef',
      'postInteractionCoordinatorRef', 'lastVisibleLogicalRangeRef', 'firstRenderedCandleTimeRef']) Object.assign(runtime, { [key]: { current: null } });
    for (const key of ['periodSeparatorsRef', 'lastRenderedCandlesRef', 'protectedDisplayedHistoryRef']) Object.assign(runtime, { [key]: { current: [] } });
    runtime.renderedPriceReferenceRef = { current: { price: null } } as never;
    runtime.lastStoreCandleSecRef = { current: 0 };
    runtime.brokerTimeOffsetSecRef = { current: 0 };
    return { runtime, chart, series };
  };

  it('creates the first series after passive chart initialization, including StrictMode replay', () => {
    const { runtime, chart, series } = mountedOptions();
    renderHook(() => {
      useEffect(() => { runtime.chartRef.current = chart as never; }, []);
      useTradingChartReconfiguration(runtime);
    }, { wrapper: StrictMode });
    expect(runtime.createPriceSeries).toHaveBeenCalledExactlyOnceWith(chart, 'line');
    expect(runtime.seriesRef.current).toBe(series);
    expect(runtime.updateChartData).toHaveBeenCalled();
  });

  it('restores a visited timeframe before passive work and resets interaction ownership first', () => {
    const { runtime, chart, series } = mountedOptions();
    runtime.chartRef.current = chart as never;
    runtime.seriesRef.current = series as never;
    runtime.timeframe = 'M5';
    runtime.isChartInteractionActiveRef.current = true;
    const observed = vi.fn();
    renderHook(() => {
      useTradingChartReconfiguration(runtime);
      useEffect(() => { observed(runtime.prevTimeframeRef.current); }, []);
    });
    expect(runtime.hydrateHistoryFromCache).toHaveBeenCalledExactlyOnceWith('M5', 'cached-timeframe-change');
    expect(runtime.isChartInteractionActiveRef.current).toBe(false);
    expect(observed).toHaveBeenCalledExactlyOnceWith('M5');
    expect(vi.mocked(runtime.hydrateHistoryFromCache).mock.invocationCallOrder[0]).toBeLessThan(observed.mock.invocationCallOrder[0]);
    expect(series.setData).not.toHaveBeenCalledWith([]);
  });

  it('does not repaint full history when the command already populated the series', () => {
    const runtime = options();
    renderHook(() => useTradingChartReconfiguration(runtime));
    expect(runtime.updateChartData).not.toHaveBeenCalled();
    expect(runtime.applyChartTypeInPlace).not.toHaveBeenCalled();
  });

  it('still applies a changed chart type received through props', () => {
    const runtime = options(); runtime.chartType = 'area';
    renderHook(() => useTradingChartReconfiguration(runtime));
    expect(runtime.applyChartTypeInPlace).toHaveBeenCalledExactlyOnceWith('area');
    expect(runtime.updateChartData).not.toHaveBeenCalled();
  });
});
