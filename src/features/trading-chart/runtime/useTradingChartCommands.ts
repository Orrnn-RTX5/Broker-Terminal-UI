import { useEffect, type Dispatch, type RefObject, type SetStateAction } from 'react';
import type { IChartApi, ISeriesApi, SeriesType } from 'lightweight-charts';
import { chartDataService } from '../../../services/chartDataService';
import {
  backfillRecentInteriorHistoryGaps,
  type SelectedTimeframeHistoryCoordinator,
} from '../../../services/chartHistoryLoader';
import { createRenderedPriceReference, type RenderedPriceReference } from '../../../services/chartPriceGuards';
import { commandBus } from '../../../services/commandBus';
import { useDockLayoutStore } from '../../../store/useDockLayoutStore';
import { useChartZoomStore } from '../../../store/useChartZoomStore';
import {
  mergeAuthoritativeCandleHistory,
  mergeHistoricalCandlesWithBufferedLive,
  selectCandlesMutatedAfterGeneration,
  type LogicalRangeLike,
} from '../../../utils/candleHistory';
import type { ChartInteractionOwnership } from '../../../utils/chartInteractionOwnership';
import type { ChartPostInteractionCoordinator } from '../../../utils/chartPostInteractionCoordinator';
import { applyChartTimeZoom } from '../../../utils/chartTimeZoom';
import type { PeriodSeparator } from '../../../utils/periodSeparators';
import {
  getTradingChartDefaultVisibleBars,
  getTradingChartShiftRightOffset,
} from '../../../utils/chartTimeFormat';
import type { Candle, ChartType, Timeframe } from '../../../types/chart';
import {
  getValidSortedCandles,
  TRADING_CHART_TIME_SCALE_LIVE_SHIFT_OPTIONS,
} from '../../../components/TradingChart.helpers';
import {
  applyBrokerTimeOffset,
  getInitialHistoryCount,
  isAbortError,
  mergeCandleCollections,
} from './chartRuntime';
import type { ChartDataRenderRequest } from './chartRuntimeContracts';

type LoadingPhase = 'connecting' | 'receiving' | 'ready' | 'hidden';

interface UseTradingChartCommandsOptions {
  applyChartTypeInPlace: (type: ChartType) => boolean;
  autoScrollEnabledRef: RefObject<boolean>;
  brokerTimeOffsetSecRef: RefObject<number>;
  cancelQueuedChartRender: () => void;
  candlesRef: RefObject<Candle[]>;
  chartInteractionOwnershipRef: RefObject<ChartInteractionOwnership | null>;
  chartRef: RefObject<IChartApi | null>;
  clearLocalChartPointerStateRef: RefObject<() => void>;
  clearPeriodSeparators: () => void;
  ctxChartShiftRef: RefObject<boolean>;
  currentCandleRef: RefObject<Candle | null>;
  drawingRuntimeContextRef: RefObject<{ contextId: string; accountScope?: string; symbol: string; timeframe: Timeframe }>;
  firstRenderedCandleTimeRef: RefObject<number | null>;
  getCandlesForFullRender: () => Candle[];
  hasDisplayedHistoryRef: RefObject<boolean>;
  historyRequestCoordinatorRef: RefObject<SelectedTimeframeHistoryCoordinator>;
  hydrateHistoryFromCache: (activeTimeframe: Timeframe, reason: string) => boolean;
  isChartCommandTarget: (payload?: { targetContextId?: string; panelId?: string }) => boolean;
  isChartInteractionActiveRef: RefObject<boolean>;
  isChartUserInteractingRef: RefObject<boolean>;
  isDisposedRef: RefObject<boolean>;
  lastRenderedCandlesRef: RefObject<Candle[]>;
  lastVisibleLogicalRangeRef: RefObject<LogicalRangeLike | null>;
  latestCandleJumpPendingRef: RefObject<boolean>;
  leftVisibleTimeRef: RefObject<number | null>;
  liveCandleMutationGenerationByTimeRef: RefObject<Map<number, number>>;
  liveCandleMutationGenerationRef: RefObject<number>;
  panelId?: string;
  periodSeparatorsRef: RefObject<PeriodSeparator[]>;
  postInteractionCoordinatorRef: RefObject<ChartPostInteractionCoordinator | null>;
  prevSymbolRef: RefObject<string>;
  prevTimeframeRef: RefObject<Timeframe>;
  protectedDisplayedHistoryRef: RefObject<Candle[]>;
  reconcileCandlesWithLiveQuote: (candles: Candle[], context: string) => Candle[];
  renderedPriceReferenceRef: RefObject<RenderedPriceReference | null>;
  resetVisibleRangeOnNextDataRef: RefObject<boolean>;
  scrollToLatestCandleNow: (chart?: IChartApi | null) => void;
  seriesRef: RefObject<ISeriesApi<SeriesType> | null>;
  setActiveTimeframe: Dispatch<SetStateAction<Timeframe>>;
  setCtxAutoScroll: Dispatch<SetStateAction<boolean>>;
  setCtxChartShift: Dispatch<SetStateAction<boolean>>;
  setLoadingPhase: Dispatch<SetStateAction<LoadingPhase>>;
  symbol: string;
  syncLeftVisibleTime: () => void;
  timeframe: Timeframe;
  updateChartData: (candles: Candle[], currentChartType?: ChartType, request?: ChartDataRenderRequest) => void;
  volumeRef: RefObject<ISeriesApi<SeriesType> | null>;
}

export const useTradingChartCommands = (options: UseTradingChartCommandsOptions): void => {
  const {
    applyChartTypeInPlace, autoScrollEnabledRef, brokerTimeOffsetSecRef, cancelQueuedChartRender, candlesRef,
    chartInteractionOwnershipRef, chartRef, clearLocalChartPointerStateRef,
    clearPeriodSeparators, ctxChartShiftRef, currentCandleRef, drawingRuntimeContextRef,
    firstRenderedCandleTimeRef, getCandlesForFullRender, hasDisplayedHistoryRef,
    historyRequestCoordinatorRef, hydrateHistoryFromCache, isChartCommandTarget,
    isChartInteractionActiveRef, isChartUserInteractingRef, isDisposedRef,
    lastRenderedCandlesRef, lastVisibleLogicalRangeRef, latestCandleJumpPendingRef,
    leftVisibleTimeRef, liveCandleMutationGenerationByTimeRef, liveCandleMutationGenerationRef,
    panelId, periodSeparatorsRef, postInteractionCoordinatorRef, prevSymbolRef,
    prevTimeframeRef, protectedDisplayedHistoryRef, reconcileCandlesWithLiveQuote,
    renderedPriceReferenceRef, resetVisibleRangeOnNextDataRef, scrollToLatestCandleNow,
    seriesRef, setActiveTimeframe, setCtxAutoScroll, setCtxChartShift, setLoadingPhase,
    symbol, syncLeftVisibleTime, timeframe, updateChartData, volumeRef,
  } = options;

useEffect(() => {
    // App owns persistence and dock props; paint the series in this command
    // turn so visible feedback does not wait for its next React commit.
    const unsubChartType = commandBus.subscribe('SET_CHART_TYPE', (payload) => {
      if (!isChartCommandTarget(payload) || isDisposedRef.current) return;
      const type = payload.chartType;
      if (type === 'bar' || type === 'candlestick' || type === 'line' || type === 'area') {
        applyChartTypeInPlace(type);
      }
    });
    const handleZoom = (payload: { targetContextId?: string; panelId?: string }, direction: 'in' | 'out') => {
      if (!isChartCommandTarget(payload)) return;
      if (isDisposedRef.current || !chartRef.current) return;
      try {
        const chart = chartRef.current;
        if (!chart.timeScale().getVisibleLogicalRange()) return;
        const contextId = drawingRuntimeContextRef.current.contextId;
        const { syncSpacing } = useChartZoomStore.getState();
        syncSpacing(contextId, chart.timeScale().options().barSpacing);
        applyChartTimeZoom(chart, direction);
      } catch { /* disposed */ }
    };

    const unsub1 = commandBus.subscribe('ZOOM_IN', (payload) => handleZoom(payload, 'in'));
    const unsub2 = commandBus.subscribe('ZOOM_OUT', (payload) => handleZoom(payload, 'out'));

    const handleScrollToRealtime = () => {
      if (isDisposedRef.current || !chartRef.current) return;
      try {
        // Scrolling acts on the loaded chart, including a sparse live baseline.
        // Explicit RESET_CHART_VIEWPORT owns requests for additional history.
        scrollToLatestCandleNow(chartRef.current);
      } catch { /* disposed */ }
    };

    const unsubScrollToRealtime = commandBus.subscribe('SCROLL_TO_REALTIME', (payload) => {
      if (!isChartCommandTarget(payload)) return;
      handleScrollToRealtime();
    });

    const handleJumpToLatestCandle = () => {
      if (isDisposedRef.current || !chartRef.current) return;
      try {
        latestCandleJumpPendingRef.current = true;
        leftVisibleTimeRef.current = null;
        lastVisibleLogicalRangeRef.current = null;
        scrollToLatestCandleNow(chartRef.current);
        syncLeftVisibleTime();
      } catch { /* disposed */ }
    };

    const unsubJumpToLatestCandle = commandBus.subscribe('JUMP_TO_LATEST_CANDLE', (payload) => {
      if (!isChartCommandTarget(payload)) return;
      handleJumpToLatestCandle();
    });

    const handleResetChartViewport = async () => {
      if (isDisposedRef.current || !chartRef.current) return;
      try {
        const activeSymbol = prevSymbolRef.current || symbol;
        const activeTf = prevTimeframeRef.current || timeframe;
        const currentCandles = getCandlesForFullRender();
        const resetHistory = protectedDisplayedHistoryRef.current.length > 1
          ? protectedDisplayedHistoryRef.current
          : lastRenderedCandlesRef.current;
        const minimumResetBars = getTradingChartDefaultVisibleBars(activeTf);
        const prepareResetRender = () => {
          cancelQueuedChartRender();
          isChartInteractionActiveRef.current = false;
          chartInteractionOwnershipRef.current?.reset();
          postInteractionCoordinatorRef.current?.clear();
        };
        const renderResetCandles = (candles: Candle[], reason: string): boolean => {
          if (candles.length < minimumResetBars) return false;

          prepareResetRender();
          candlesRef.current = candles;
          renderedPriceReferenceRef.current = createRenderedPriceReference(candles);
          hasDisplayedHistoryRef.current = true;
          protectedDisplayedHistoryRef.current = candles;
          resetVisibleRangeOnNextDataRef.current = true;
          updateChartData(candles, undefined, {
            immediate: true,
            resetVisibleRange: true,
            finishLoadingAfterRender: true,
            reason,
          });
          return true;
        };

        if (activeSymbol) {
          setLoadingPhase('connecting');
          try {
            const resetHistoryLiveGenerationAtRequestStart = liveCandleMutationGenerationRef.current;
            const resetHistoryRequest = historyRequestCoordinatorRef.current.start({
              symbol: activeSymbol,
              timeframe: activeTf,
              count: getInitialHistoryCount(activeTf),
            }, options => chartDataService.fetchCandles(options));
            let fetchedCandles = getValidSortedCandles(await resetHistoryRequest.result);
            const isCurrentResetHistoryLoad = () => (
              !isDisposedRef.current
              && resetHistoryRequest.isCurrent()
              && (prevSymbolRef.current || symbol) === activeSymbol
              && (prevTimeframeRef.current || timeframe) === activeTf
            );
            if (!isCurrentResetHistoryLoad()) return;

            if (activeTf === 'M1' && fetchedCandles.length > 1) {
              const resetGapBackfill = await backfillRecentInteriorHistoryGaps({
                symbol: activeSymbol,
                timeframe: activeTf,
                candles: fetchedCandles,
                signal: resetHistoryRequest.signal,
              });
              if (!isCurrentResetHistoryLoad()) return;
              fetchedCandles = resetGapBackfill.candles as Candle[];
            }
            fetchedCandles = reconcileCandlesWithLiveQuote(fetchedCandles, 'reset viewport history');
            if (brokerTimeOffsetSecRef.current !== 0) {
              fetchedCandles = applyBrokerTimeOffset(
                fetchedCandles,
                brokerTimeOffsetSecRef.current,
              );
            }

            const resetBaseline = mergeCandleCollections(
              resetHistory,
              getCandlesForFullRender(),
            );
            const resetBufferedLiveCandles = (
              liveCandleMutationGenerationRef.current > resetHistoryLiveGenerationAtRequestStart
            ) ? selectCandlesMutatedAfterGeneration(mergeCandleCollections(
              getCandlesForFullRender(),
              currentCandleRef.current ? [currentCandleRef.current] : [],
            ), liveCandleMutationGenerationByTimeRef.current, resetHistoryLiveGenerationAtRequestStart) : [];
            // FIX: Replace the backend-covered interval first, then replay only
            // ticks that arrived after this request began. Reversing this order
            // allowed the REST page to erase a genuinely newer forming candle.
            let resetCandles = mergeAuthoritativeCandleHistory(resetBaseline, fetchedCandles);
            if (resetBufferedLiveCandles.length > 0) {
              resetCandles = mergeHistoricalCandlesWithBufferedLive(
                resetCandles,
                resetBufferedLiveCandles,
              );
            }
            if (renderResetCandles(resetCandles, 'reset-chart-viewport-fetch')) {
              return;
            }
          } catch (error) {
            if (isAbortError(error)) return;
            console.warn('[Chart] Reset viewport history fetch failed:', error);
          }
        }

        const restoredCandles = mergeCandleCollections(
          resetHistory,
          currentCandles,
          lastRenderedCandlesRef.current,
        );
        if (renderResetCandles(restoredCandles, 'reset-chart-viewport-cache')) {
          return;
        }

        setLoadingPhase('receiving');
      } catch { /* disposed */ }
    };


    const unsubResetChartViewport = commandBus.subscribe('RESET_CHART_VIEWPORT', (payload) => {
      if (!isChartCommandTarget(payload)) return;
      void handleResetChartViewport();
    });

    // Auto-Scroll (Snap to live edge)
    const unsubAutoScroll = commandBus.subscribe('SET_AUTO_SCROLL', (payload) => {
      if (!isChartCommandTarget(payload)) return;
      if (isDisposedRef.current || !chartRef.current) return;
      try {
        const enabled = payload?.enabled === true;
        autoScrollEnabledRef.current = enabled;
        setCtxAutoScroll(enabled);
        if (enabled) {
          handleScrollToRealtime();
        }
      } catch { /* disposed */ }
    });

    // Chart Shift (Right Margin) — MT5-style gap pushes candles left
    const applyChartShift = (enabled: boolean) => {
      if (isDisposedRef.current || !chartRef.current) return;
      try {
        const rightOffset = getTradingChartShiftRightOffset(prevTimeframeRef.current || timeframe, enabled);
        console.log(`[Chart] Chart shift ${enabled ? 'ENABLED' : 'DISABLED'}, setting rightOffset: ${rightOffset}`);
        ctxChartShiftRef.current = enabled;
        setCtxChartShift(enabled);
        chartRef.current.timeScale().applyOptions({
          ...TRADING_CHART_TIME_SCALE_LIVE_SHIFT_OPTIONS,
          rightOffset,
          fixRightEdge: false,
        });
        if (enabled) handleScrollToRealtime();
      } catch { /* disposed */ }
    };

    const unsubChartShift = commandBus.subscribe('SET_CHART_SHIFT', (payload) => {
      if (!isChartCommandTarget(payload)) return;
      applyChartShift(payload?.enabled === true);
    });

    // Direct window event fallback (more reliable than command bus lifecycle)
    const handleChartShiftEvent = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      if (!isChartCommandTarget(detail)) return;
      const enabled = detail?.enabled === true;
      applyChartShift(enabled);
    };
    window.addEventListener('rtx:chartShift', handleChartShiftEvent);

    // Timeframe Change from Top Bar
    const unsubTimeframe = commandBus.subscribe('SET_TIMEFRAME', (payload) => {
      if (isDisposedRef.current || !chartRef.current) return;
      if (!isChartCommandTarget(payload)) return;

      // Strict targeted event mapping
      if (panelId && payload?.panelId && panelId !== payload.panelId) return;

      // Global event mapping (from TopToolbar)
      if (!payload?.panelId) {
        // Only the active/visible chart(s) should respond to global toolbar clicks.
        const store = useDockLayoutStore.getState();

        interface VisibleDockNode {
          id?: string;
          type?: string;
          activeTab?: string;
          children?: VisibleDockNode[];
        }
        const isPanelVisible = (id: string, node: VisibleDockNode | null | undefined): boolean => {
          if (!node) return false;
          if (node.id === id) return true; // Panel is raw and visible
          if (node.type === 'tabs') {
            // Is it in this tab group?
            const isChild = node.children?.some((child) => child.id === id);
            if (isChild) {
              const activeTabId = node.activeTab || node.children?.[0]?.id;
              return activeTabId === id;
            }
          }
          if (node.children) {
            return node.children.some((child) => isPanelVisible(id, child));
          }
          return false;
        };

        if (panelId) {
          const inRoot = isPanelVisible(panelId, store.layout.root);
          const inFloating = store.layout.floatingPanels.some((panel) => panel.id === panelId);

          // If it's not currently visible on the screen, ignore the command
          if (!inRoot && !inFloating) {
            return;
          }
        }

      }

      // Targeted and active-source commands both keep the dock tab's own
      // timeframe in sync without mutating sibling chart panels.
      if (panelId && payload.timeframe) {
        // A symbol-tab switch can precede this subscriber's next render.
        // Keep the store's current symbol; this command only owns timeframe.
        useDockLayoutStore.getState().updatePanelProps(panelId, {
          props: { timeframe: payload.timeframe },
        });
      }

      const newTimeframe = payload?.timeframe as Timeframe | undefined;
      if (newTimeframe && newTimeframe !== prevTimeframeRef.current) {
        console.log(`[Chart] Timeframe changing from ${prevTimeframeRef.current} to ${newTimeframe}`);
        prevTimeframeRef.current = newTimeframe;
        setActiveTimeframe(newTimeframe as Timeframe);
        // Clear existing data and reload
        clearLocalChartPointerStateRef.current();
        isChartUserInteractingRef.current = false;
        isChartInteractionActiveRef.current = false;
        chartInteractionOwnershipRef.current?.reset();
        postInteractionCoordinatorRef.current?.clear();
        cancelQueuedChartRender();
        candlesRef.current = [];
        currentCandleRef.current = null;
        renderedPriceReferenceRef.current = createRenderedPriceReference([]);
        periodSeparatorsRef.current = [];
        firstRenderedCandleTimeRef.current = null;
        lastRenderedCandlesRef.current = [];
        hasDisplayedHistoryRef.current = false;
        protectedDisplayedHistoryRef.current = [];
        clearPeriodSeparators();
        resetVisibleRangeOnNextDataRef.current = true;
        lastVisibleLogicalRangeRef.current = null;
        const hydratedFromCache = hydrateHistoryFromCache(newTimeframe as Timeframe, 'cached-timeframe-command');
        if (!hydratedFromCache) {
          if (seriesRef.current) {
            try { seriesRef.current.setData([]); } catch { /* chart may be rebuilding */ }
          }
          if (volumeRef.current) {
            try { volumeRef.current.setData([]); } catch { /* chart may be rebuilding */ }
          }
          setLoadingPhase('receiving');
        }
        // The panel-prop update above drives the dedicated symbol/timeframe
        // history effect. Keeping that effect as the only switch owner avoids
        // a second request from this command path.
      }
    });

    return () => {
      unsubChartType();
      unsub1();
      unsub2();
      unsubScrollToRealtime();
      unsubJumpToLatestCandle();
      unsubResetChartViewport();
      unsubAutoScroll();
      unsubChartShift();
      unsubTimeframe();
      window.removeEventListener('rtx:chartShift', handleChartShiftEvent);
    };
  }, [applyChartTypeInPlace, isChartCommandTarget, scrollToLatestCandleNow]);
};
