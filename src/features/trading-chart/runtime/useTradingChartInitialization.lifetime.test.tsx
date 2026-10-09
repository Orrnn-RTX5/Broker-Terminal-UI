// @vitest-environment jsdom
import { StrictMode } from 'react';
import { cleanup, renderHook } from '@testing-library/react';
import { createChartEx, type IChartApi } from 'lightweight-charts';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { drawingManager } from '../../../services/drawingManager';
import { useTradingChartInitialization } from './useTradingChartInitialization';

vi.mock('lightweight-charts', async (original) => ({
  ...await original<typeof import('lightweight-charts')>(), createChartEx: vi.fn(),
}));
vi.mock('../../../services/drawingManager', () => ({ drawingManager: { setChart: vi.fn() } }));

const ref = <T,>(current: T) => ({ current });
type Options = Parameters<typeof useTradingChartInitialization>[0];

const createOptions = (): Options => ({
  activeChartSourceId: 'chart-test', symbol: 'BTCUSD', timeframe: 'M1',
  chartRef: ref(null), containerRef: ref(document.createElement('div')),
  overlayRef: ref(document.createElement('div')), isDisposedRef: ref(false),
  visibleRangeHistoryUserInitiatedRef: ref(false), timeScaleTimeframeRef: ref('M1'),
  brokerTimeOffsetSecRef: ref(0), chartSettings: { showGrid: false }, chartSettingsRef: ref({}),
  chartTheme: {}, isAdvancedUntitledLight: false, chartAxisFontSize: 12, ctxChartShift: false,
  squareGridHostSeriesRef: ref(null), squareGridPrimitiveRef: ref(null), seriesRef: ref(null),
  localIndicatorManager: { setChart: vi.fn(), saveToStorage: vi.fn(), clearAll: vi.fn() },
  chartInteractionOwnershipRef: ref(null), settleAutoScrollPolicyRef: ref(() => undefined),
  clearLocalChartPointerStateRef: ref(() => undefined), loadedIndicatorStorageScopeRef: ref('account-a:chart-test'),
  indicatorStorageScopeRef: ref('account-a:chart-test'),
  drawingRuntimeContextRef: ref({ contextId: 'chart-test', accountScope: 'account-a', symbol: 'BTCUSD', timeframe: 'M1' }),
  isActiveRef: ref(true), isChartInteractionActiveRef: ref(false), isChartUserInteractingRef: ref(false),
  postInteractionCoordinatorRef: ref({ clear: vi.fn() }), historyRequestCoordinatorRef: ref({ abort: vi.fn() }),
  cancelQueuedChartRender: vi.fn(), clearPeriodSeparators: vi.fn(), getDrawingSeriesData: () => [],
  volumeRef: ref(null), priceLineRef: ref(null), askPriceLineRef: ref(null), lastPriceLineRef: ref(null),
  latestCandleJumpPendingRef: ref(false), currentCandleRef: ref(null),
  flushPostInteractionWork: vi.fn(), forceSettleInteraction: vi.fn(), scheduleQueuedChartRenderFlush: vi.fn(),
} as unknown as Options);

beforeEach(() => { vi.useFakeTimers(); vi.clearAllMocks(); });
afterEach(async () => {
  cleanup();
  await Promise.resolve();
  vi.runOnlyPendingTimers();
  vi.useRealTimers();
});

describe('imperative chart resources during effect replay', () => {
  it('creates one canvas owner and retains indicators and subscriptions until actual unmount', async () => {
    const scale = {
      subscribeSizeChange: vi.fn(), subscribeVisibleLogicalRangeChange: vi.fn(),
      unsubscribeSizeChange: vi.fn(), unsubscribeVisibleLogicalRangeChange: vi.fn(),
    };
    const hostSeries = { attachPrimitive: vi.fn(), detachPrimitive: vi.fn() };
    const chart = {
      addSeries: vi.fn(() => hostSeries), timeScale: () => scale,
      subscribeCrosshairMove: vi.fn(), unsubscribeCrosshairMove: vi.fn(),
      _cleanupDrawings: vi.fn(), remove: vi.fn(),
    };
    vi.mocked(createChartEx).mockReturnValue(chart as unknown as ReturnType<typeof createChartEx>);
    const options = createOptions();
    const addEvent = vi.spyOn(options.containerRef.current!, 'addEventListener');
    const removeEvent = vi.spyOn(options.containerRef.current!, 'removeEventListener');
    const view = renderHook(() => useTradingChartInitialization(options), { wrapper: StrictMode });

    expect(createChartEx).toHaveBeenCalledTimes(1);
    expect(chart.addSeries).toHaveBeenCalledTimes(1);
    expect(options.chartRef.current).toBe(chart);
    expect(options.squareGridHostSeriesRef.current).toBe(hostSeries);
    expect(options.chartInteractionOwnershipRef.current).not.toBeNull();
    expect(options.isDisposedRef.current).toBe(false);
    expect(addEvent.mock.calls.filter(([type]) => type === 'pointerdown')).toHaveLength(1);
    expect(scale.subscribeVisibleLogicalRangeChange).toHaveBeenCalledTimes(1);
    await Promise.resolve();
    expect(options.localIndicatorManager.clearAll).not.toHaveBeenCalled();
    expect(options.localIndicatorManager.setChart).toHaveBeenCalledExactlyOnceWith(chart);
    expect(removeEvent).not.toHaveBeenCalled();
    expect(drawingManager.setChart).not.toHaveBeenCalled();

    view.unmount();
    expect(options.isDisposedRef.current).toBe(true);
    expect(options.chartRef.current).toBe(chart);
    await Promise.resolve();
    expect(options.localIndicatorManager.saveToStorage).toHaveBeenCalledExactlyOnceWith('account-a:chart-test');
    expect(options.localIndicatorManager.clearAll).toHaveBeenCalledTimes(1);
    expect(options.localIndicatorManager.setChart).toHaveBeenLastCalledWith(null);
    expect(options.chartInteractionOwnershipRef.current).toBeNull();
    expect(options.chartRef.current).toBeNull();
    expect(options.squareGridHostSeriesRef.current).toBeNull();
    expect(scale.unsubscribeVisibleLogicalRangeChange).toHaveBeenCalledTimes(1);
    expect(removeEvent.mock.calls.filter(([type]) => type === 'pointerdown')).toHaveLength(1);
    expect(chart._cleanupDrawings).toHaveBeenCalledTimes(1);
    expect(chart.remove).not.toHaveBeenCalled();

    // A late removal belongs to the released instance, never a replacement.
    const replacement = { remove: vi.fn() };
    options.chartRef.current = replacement as unknown as IChartApi;
    vi.advanceTimersByTime(16);
    expect(chart.remove).toHaveBeenCalledTimes(1);
    expect(replacement.remove).not.toHaveBeenCalled();
    expect(options.chartRef.current).toBe(replacement);
  });
});
