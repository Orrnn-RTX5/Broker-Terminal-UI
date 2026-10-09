// @vitest-environment jsdom
import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { commandBus } from '../../../services/commandBus';
import { emitSessionChange } from '../../../services/brokerSession';
import { chartDataService } from '../../../services/chartDataService';
import { captureHistoryGapRequestScope } from '../../../services/chartHistoryGapRequests';
import * as chartHistoryLoader from '../../../services/chartHistoryLoader';
import type { OHLCData } from '../../../types/chartData';
import type { ChartType } from '../../../types/chart';
import { useTradingChartCommands } from './useTradingChartCommands';

type Options = Parameters<typeof useTradingChartCommands>[0];
const ref = <T,>(current: T) => ({ current });

const createHarness = (overrides: Partial<Options> = {}) => {
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
    ...overrides,
  } as unknown as Options;
  const view = renderHook(() => useTradingChartCommands(options));
  return { options, timeScale, chart, view };
};

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe('chart controls immediate feedback', () => {
  it('leaves timeframe model and cache painting to the committed selection owner', () => {
    const { options } = createHarness({
      setActiveTimeframe: vi.fn(), hydrateHistoryFromCache: vi.fn(),
      cancelQueuedChartRender: vi.fn(),
    });
    act(() => { commandBus.dispatch({ type: 'SET_TIMEFRAME', payload: { timeframe: 'M5', targetContextId: 'chart-a' } }); });
    expect(options.setActiveTimeframe).toHaveBeenCalledExactlyOnceWith('M5');
    expect(options.prevTimeframeRef.current).toBe('M1');
    expect(options.hydrateHistoryFromCache).not.toHaveBeenCalled();
    expect(options.cancelQueuedChartRender).not.toHaveBeenCalled();
  });
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

  it('captures the reset gap session and boundary before waiting for history', async () => {
    vi.spyOn(chartDataService, 'getCandleCacheScope').mockReturnValue('reset-test-endpoint');
    const initialScope = captureHistoryGapRequestScope('reset-test-endpoint');
    let resolveHistory!: (rows: OHLCData[]) => void;
    const history = new Promise<OHLCData[]>(resolve => { resolveHistory = resolve; });
    const controller = new AbortController();
    const { options } = createHarness({
      isChartCommandTarget: () => true,
      prevSymbolRef: ref('BTCUSD'), symbol: 'BTCUSD', brokerTimeOffsetSecRef: ref(3600),
      protectedDisplayedHistoryRef: ref([]), lastRenderedCandlesRef: ref([]),
      liveCandleMutationGenerationRef: ref(0), setLoadingPhase: vi.fn(),
      historyRequestCoordinatorRef: ref({
        start: () => ({ result: history, signal: controller.signal, isCurrent: () => true }),
      } as unknown as Options['historyRequestCoordinatorRef']['current']),
    });
    const backfill = vi.spyOn(chartHistoryLoader, 'backfillRecentInteriorHistoryGaps').mockImplementation(async () => {
      options.isDisposedRef.current = true;
      return { candles: [], requestedGaps: 0, failedGaps: 0, addedCandles: 0 };
    });
    act(() => { commandBus.dispatch({ type: 'RESET_CHART_VIEWPORT', payload: {} }); });
    options.brokerTimeOffsetSecRef.current = 7200;
    emitSessionChange('account_change');
    await act(async () => {
      resolveHistory([600, 780].map(time => ({ time, open: 100, high: 101, low: 99, close: 100, volume: 1 })));
      await history;
    });
    expect(backfill).toHaveBeenCalledWith(expect.objectContaining({
      requestScope: initialScope, boundaryOffsetSeconds: 3600,
    }));
    expect(captureHistoryGapRequestScope('reset-test-endpoint').generation).not.toBe(initialScope.generation);
  });
});
