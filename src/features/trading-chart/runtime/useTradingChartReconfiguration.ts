import { useEffect, type Dispatch, type RefObject, type SetStateAction } from 'react';
import {
  HistogramSeries,
  type Coordinate,
  type IChartApi,
  type IPriceLine,
  type ISeriesApi,
  type Logical,
  type SeriesType,
  type Time,
} from 'lightweight-charts';
import { getAnnotationTool } from '../../../drawing-tools/annotationToolCatalog';
import { usesDirectDrawingPointerInput } from '../../../drawing-tools/drawingInteractionPriority';
import { projectDrawingTimeAtLogical } from '../../../drawing-tools/geometry/drawingTimeProjection';
import {
  candleAggregationService,
  getTimeframeSeconds,
  type Timeframe as AggTimeframe,
} from '../../../services/candleAggregationService';
import { createRenderedPriceReference, type RenderedPriceReference } from '../../../services/chartPriceGuards';
import { drawingManager } from '../../../services/drawingManager';
import type { ChartInteractionOwnership } from '../../../utils/chartInteractionOwnership';
import type { ChartPostInteractionCoordinator } from '../../../utils/chartPostInteractionCoordinator';
import type { LogicalRangeLike } from '../../../utils/candleHistory';
import type { PeriodSeparator } from '../../../utils/periodSeparators';
import type {
  Candle,
  ChartType,
  Timeframe,
  TradingViewChartTheme,
} from '../../../types/chart';
import {
  DRAWING_LOCK_HANDLE_SCALE,
  DRAWING_LOCK_HANDLE_SCROLL,
  TRADING_VIEW_HANDLE_SCALE,
  TRADING_VIEW_HANDLE_SCROLL,
} from './chartInteractionOptions';
import type { ChartDataRenderRequest } from './chartRuntimeContracts';

interface TextInputOverlay {
  x: number;
  y: number;
  time: number;
  price: number;
}

type ChartMouseParam = Parameters<Parameters<IChartApi['subscribeClick']>[0]>[0] & {
  drawingPointerInput?: boolean;
};

type ChartWithDrawingCleanup = IChartApi & { _cleanupDrawings?: () => void };

interface UseTradingChartReconfigurationOptions {
  activeChartSourceId: string;
  activeToolRef: RefObject<string | null>;
  applyChartTypeInPlace: (type: ChartType) => boolean;
  askPriceLineRef: RefObject<IPriceLine | null>;
  bindDrawingManagerToChart: () => boolean;
  brokerTimeOffsetSecRef: RefObject<number>;
  cancelQueuedChartRender: () => void;
  candlesRef: RefObject<Candle[]>;
  chartInteractionOwnershipRef: RefObject<ChartInteractionOwnership | null>;
  chartRef: RefObject<IChartApi | null>;
  chartThemeRef: RefObject<TradingViewChartTheme>;
  chartType: ChartType;
  clearLocalChartPointerStateRef: RefObject<() => void>;
  clearPeriodSeparators: () => void;
  containerRef: RefObject<HTMLDivElement | null>;
  createPriceSeries: (chart: IChartApi, type: ChartType) => ISeriesApi<SeriesType>;
  currentCandleRef: RefObject<Candle | null>;
  drawingCommandTargetRef: RefObject<string | null>;
  drawingRuntimeContextRef: RefObject<{
    contextId: string;
    accountScope?: string;
    symbol: string;
    timeframe: Timeframe;
  }>;
  firstRenderedCandleTimeRef: RefObject<number | null>;
  getDrawingSeriesData: () => Candle[];
  hasDisplayedHistoryRef: RefObject<boolean>;
  hasReachedBeginningRef: RefObject<boolean>;
  hydrateHistoryFromCache: (activeTimeframe: Timeframe, reason: string) => boolean;
  isChartInteractionActiveRef: RefObject<boolean>;
  isChartUserInteractingRef: RefObject<boolean>;
  isDisposedRef: RefObject<boolean>;
  isLoadingMoreRef: RefObject<boolean>;
  isRebuildingRef: RefObject<boolean>;
  lastPriceLineRef: RefObject<IPriceLine | null>;
  lastRenderedCandlesRef: RefObject<Candle[]>;
  lastStoreCandleSecRef: RefObject<number>;
  lastVisibleLogicalRangeRef: RefObject<LogicalRangeLike | null>;
  overlayRef: RefObject<HTMLDivElement | null>;
  periodSeparatorsRef: RefObject<PeriodSeparator[]>;
  postInteractionCoordinatorRef: RefObject<ChartPostInteractionCoordinator | null>;
  prevChartTypeRef: RefObject<ChartType>;
  prevPriceRef: RefObject<number | null>;
  prevSymbolRef: RefObject<string>;
  prevTimeframeRef: RefObject<Timeframe>;
  protectedDisplayedHistoryRef: RefObject<Candle[]>;
  renderedPriceReferenceRef: RefObject<RenderedPriceReference | null>;
  resetLiveQuotePriceGuard: () => void;
  resetVisibleRangeOnNextDataRef: RefObject<boolean>;
  resolvedPriceDigits: number;
  resolvedPricePoint: number;
  seriesRef: RefObject<ISeriesApi<SeriesType> | null>;
  setTextInputOverlay: Dispatch<SetStateAction<TextInputOverlay | null>>;
  setTextInputValue: Dispatch<SetStateAction<string>>;
  symbol: string;
  timeframe: Timeframe;
  updateChartData: (candles: Candle[], currentChartType?: ChartType, request?: ChartDataRenderRequest) => void;
  volumeRef: RefObject<ISeriesApi<SeriesType> | null>;
}

export const useTradingChartReconfiguration = (options: UseTradingChartReconfigurationOptions): void => {
  const {
    activeChartSourceId, activeToolRef, applyChartTypeInPlace, askPriceLineRef,
    bindDrawingManagerToChart, brokerTimeOffsetSecRef, cancelQueuedChartRender, candlesRef,
    chartInteractionOwnershipRef, chartRef, chartThemeRef, chartType,
    clearLocalChartPointerStateRef, clearPeriodSeparators, containerRef, createPriceSeries,
    currentCandleRef, drawingCommandTargetRef, drawingRuntimeContextRef,
    firstRenderedCandleTimeRef, getDrawingSeriesData, hasDisplayedHistoryRef,
    hasReachedBeginningRef, hydrateHistoryFromCache, isChartInteractionActiveRef,
    isChartUserInteractingRef, isDisposedRef, isLoadingMoreRef, isRebuildingRef,
    lastPriceLineRef, lastRenderedCandlesRef, lastStoreCandleSecRef, lastVisibleLogicalRangeRef,
    overlayRef, periodSeparatorsRef, postInteractionCoordinatorRef, prevChartTypeRef,
    prevPriceRef, prevSymbolRef, prevTimeframeRef, protectedDisplayedHistoryRef,
    renderedPriceReferenceRef, resetLiveQuotePriceGuard, resetVisibleRangeOnNextDataRef,
    resolvedPriceDigits, resolvedPricePoint, seriesRef, setTextInputOverlay,
    setTextInputValue, symbol, timeframe, updateChartData, volumeRef,
  } = options;

useEffect(() => {
    if (isDisposedRef.current || !chartRef.current) return;

    // Check what changed
    const typeChanged = prevChartTypeRef.current !== chartType;
    const symbolChanged = prevSymbolRef.current !== symbol;
    const timeframeChanged = prevTimeframeRef.current !== timeframe;

    if (seriesRef.current && typeChanged && !symbolChanged && !timeframeChanged) {
      if (applyChartTypeInPlace(chartType)) return;
    }

    if (seriesRef.current && !typeChanged) {
      if (!symbolChanged && !timeframeChanged) {
        // Nothing changed
        console.log(`[TradingChart] Series already exists for ${chartType}/${symbol}/${timeframe}, skipping`);
        if (candlesRef.current.length > 0) {
          updateChartData(candlesRef.current, chartType);
        }
        return;
      } else if (timeframeChanged && !symbolChanged) {
        // ONLY timeframe changed — clear old data and reload for new timeframe
        console.log(`[TradingChart] Timeframe changed to ${timeframe}, clearing old data and reloading`);

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
        hasReachedBeginningRef.current = false;
        isLoadingMoreRef.current = false;
        resetLiveQuotePriceGuard();
        prevTimeframeRef.current = timeframe;
        // Reset the store candle cursor so first tick on new TF
        // doesn't compare against a stale old-TF boundary.
        lastStoreCandleSecRef.current = 0;

        drawingManager.setChart(
          chartRef.current,
          seriesRef.current,
          symbol,
          1,
          overlayRef.current,
          timeframe,
          activeChartSourceId,
          drawingRuntimeContextRef.current.accountScope,
          getDrawingSeriesData,
        );

        const hydratedFromCache = hydrateHistoryFromCache(timeframe, 'cached-timeframe-change');
        if (!hydratedFromCache) {
          // Clear existing visual data only when there is no cached replacement.
          seriesRef.current.setData([]);
          if (volumeRef.current) volumeRef.current.setData([]);

          // Reset aggregation service for new timeframe (pass empty array to trigger clear)
          candleAggregationService.loadHistoricalCandles(
            symbol,
            timeframe as AggTimeframe,
            [],
            brokerTimeOffsetSecRef.current,
          );
        }

        return;
      } else {
        // ONLY symbol changed. Do NOT destroy the series! (Prevents Lightweight Charts disposal bug)
        console.log(`[TradingChart] Symbol changed to ${symbol}, updating existing series format`);

        cancelQueuedChartRender();
        candlesRef.current = [];
        currentCandleRef.current = null;
        prevPriceRef.current = null;
        renderedPriceReferenceRef.current = createRenderedPriceReference([]);
        periodSeparatorsRef.current = [];
        firstRenderedCandleTimeRef.current = null;
        lastRenderedCandlesRef.current = [];
        hasDisplayedHistoryRef.current = false;
        protectedDisplayedHistoryRef.current = [];
        clearPeriodSeparators();
        resetVisibleRangeOnNextDataRef.current = true;
        lastVisibleLogicalRangeRef.current = null;
        hasReachedBeginningRef.current = false;
        isLoadingMoreRef.current = false;
        resetLiveQuotePriceGuard();
        prevSymbolRef.current = symbol;
        prevTimeframeRef.current = timeframe;

        // Apply new precision
        const digits = resolvedPriceDigits;
        const minMove = resolvedPricePoint;
        seriesRef.current.applyOptions({
          priceFormat: { type: 'price', precision: digits, minMove }
        });

        // Clear existing visual data
        seriesRef.current.setData([]);
        if (volumeRef.current) volumeRef.current.setData([]);

        // Update drawing manager with new symbol context — pass overlay div directly
        drawingManager.setChart(
          chartRef.current,
          seriesRef.current,
          symbol,
          1,
          overlayRef.current,
          timeframe,
          activeChartSourceId,
          drawingRuntimeContextRef.current.accountScope,
        );

        return;
      }
    }

    // If we're here, chart type changed or it's the very first time. Rebuild required.
    prevChartTypeRef.current = chartType;
    prevSymbolRef.current = symbol;
    prevTimeframeRef.current = timeframe;
    resetVisibleRangeOnNextDataRef.current = true;
    lastVisibleLogicalRangeRef.current = null;

    const hasCachedData = candlesRef.current.length > 0;

    if (symbolChanged && !seriesRef.current) {
      cancelQueuedChartRender();
      candlesRef.current = [];
      currentCandleRef.current = null;
      prevPriceRef.current = null;
      renderedPriceReferenceRef.current = createRenderedPriceReference([]);
      periodSeparatorsRef.current = [];
      firstRenderedCandleTimeRef.current = null;
      lastRenderedCandlesRef.current = [];
      hasDisplayedHistoryRef.current = false;
      protectedDisplayedHistoryRef.current = [];
      clearPeriodSeparators();
      resetVisibleRangeOnNextDataRef.current = true;
      lastVisibleLogicalRangeRef.current = null;
      resetLiveQuotePriceGuard();
    }

    // Only block ticks during rebuild when we DON'T have cached data
    // (With cached data, setData happens synchronously — no tick window)
    if (!hasCachedData) {
      isRebuildingRef.current = true;
    }

    // Remove old series
    if (seriesRef.current) {
      try { chartRef.current!.removeSeries(seriesRef.current); } catch { /* chart may be rebuilding */ }
      seriesRef.current = null;
      askPriceLineRef.current = null;
      lastPriceLineRef.current = null;
    }
    if (volumeRef.current) {
      try { chartRef.current!.removeSeries(volumeRef.current); } catch { /* chart may be rebuilding */ }
      volumeRef.current = null;
    }

    // Create new series
    const chart = chartRef.current;
    console.log(`[TradingChart] Creating series for chartType=${chartType}, symbol=${symbol}, digits=${resolvedPriceDigits}`);
    const series = createPriceSeries(chart, chartType);
    const theme = chartThemeRef.current;

    seriesRef.current = series;
    console.log(`[TradingChart] Series created and stored in ref`);

    // Create volume series
    const volSeries = chart.addSeries(HistogramSeries, {
      color: theme.volumeUp,
      priceScaleId: '',
      priceFormat: { type: 'volume' },
      lastValueVisible: false,
      priceLineVisible: false,
    });
    volSeries.priceScale().applyOptions({ scaleMargins: { top: 0.68, bottom: 0 } });
    volumeRef.current = volSeries;

    // (price line removed — live DOM badge replaces it)

    // Update drawing manager before data render so saved drawings are loaded, then
    // re-rendered after setData/visible-range application settles.
    drawingManager.setChart(
      chart,
      series,
      symbol,
      1,
      overlayRef.current,
      timeframe,
      activeChartSourceId,
      drawingRuntimeContextRef.current.accountScope,
      getDrawingSeriesData,
    );

    // Set data if available
    if (candlesRef.current.length > 0) {
      console.log(`[TradingChart] Setting existing ${candlesRef.current.length} candles`);
      updateChartData(candlesRef.current, chartType);
    }

    // ✅ CRITICAL: Always unblock the tick-polling interval after series is ready.
    // isRebuildingRef was set to true above to prevent ticks landing on a null series.
    // Now that seriesRef.current points to the new series, it is safe to resume ticks.
    isRebuildingRef.current = false;
    console.log('[TradingChart] Series ready — tick polling resumed');

    // Register scroll lock callbacks so drag on a drawing doesn't pan the chart
    const unregisterDrawingScrollLock = drawingManager.setScrollLockCallbacks(
      activeChartSourceId,
      () => {
        // Disable chart's pressedMouseMove when a drawing is being dragged
        if (!isDisposedRef.current && chartRef.current) {
          try {
            chartRef.current.applyOptions({
              handleScroll: DRAWING_LOCK_HANDLE_SCROLL,
              handleScale: DRAWING_LOCK_HANDLE_SCALE,
            });
          } catch { /* disposed */ }
        }
      },
      () => {
        // Re-enable chart pressedMouseMove after drag ends (cursor mode)
        if (!isDisposedRef.current && chartRef.current) {
          try {
            chartRef.current.applyOptions({
              handleScroll: TRADING_VIEW_HANDLE_SCROLL,
              handleScale: TRADING_VIEW_HANDLE_SCALE,
            });
          } catch { /* disposed */ }
        }
      }
    );

    let isDrawingContinuous = false;
    let continuousPointerId: number | null = null;
    let continuousDrawingId: string | null = null;

    /**
     * coordinateToFractionalLogical -- pixel X to true fractional bar index.
     * lightweight-charts' coordinateToLogical() always snaps to integers (bar centres).
     * We fix this by measuring how far x falls between two adjacent bar pixel centres,
     * then adding that fraction to the integer bar index.
     * Example: cursor is 37pct of the way from bar 489 to bar 490 -- returns 489.37.
     */
    const coordinateToFractionalLogical = (x: number): number | null => {
      const ts = chart.timeScale();
      const intBar = ts.coordinateToLogical(x);
      if (intBar === null) return null;
      const c0 = ts.logicalToCoordinate(intBar);
      const c1 = ts.logicalToCoordinate((intBar + 1) as Logical);
      if (c0 === null || c1 === null) return intBar;
      const barWidth = c1 - c0;
      if (Math.abs(barWidth) < 0.5) return intBar;
      const fraction = (x - c0) / barWidth;
      return intBar + fraction;
    };
    let ignoreNextDrawingClick = false;
    let drawingMousePointerActive = false;
    const clickHandler = (param: ChartMouseParam) => {
      // Mouse trend tools commit on press. The chart's later click is the same
      // gesture and must not add another anchor (or clear the new selection).
      if (ignoreNextDrawingClick) {
        ignoreNextDrawingClick = false;
        return;
      }
      const drawingContext = drawingRuntimeContextRef.current;
      const contextId = drawingContext.contextId;
      console.log(`[TradingChart] 🖱️ CLICK on chart: time=${param.time}, point=${!!param.point}, series=${!!seriesRef.current}, activeToolRef=${activeToolRef.current}`);
      if (!param.point || !seriesRef.current) {
        console.log(`[TradingChart] ❌ Click rejected: point=${!!param.point}, series=${!!seriesRef.current}`);
        return;
      }

      if (!drawingManager.ownsActiveDrawing(contextId)) {
        // A plain canvas click clears this chart's selection, including clicks
        // in future whitespace where lightweight-charts supplies no time.
        if (!activeToolRef.current) drawingManager.unselectAll(contextId);
        return;
      }
      if (drawingCommandTargetRef.current !== contextId) return;

      // Symbol/timeframe fast paths retain these listeners. Rebind from the
      // current runtime rather than the values captured when the series began.
      if (!bindDrawingManagerToChart()) return;

      const drawingLogical = coordinateToFractionalLogical(param.point.x)
        ?? chart.timeScale().coordinateToLogical(param.point.x);
      let time = param.time;
      if (!time && param.point) {
        time = projectDrawingTimeAtLogical(
          seriesRef.current,
          chart.timeScale(),
          drawingLogical,
          getTimeframeSeconds(drawingContext.timeframe as AggTimeframe),
        ) as Time;
      }

      if (!time) {
        console.log(`[TradingChart] ❌ Click rejected: time is undefined and could not be projected`);
        return;
      }

      const activeDrawing = drawingManager.getActiveDrawing(contextId);
      console.log(`[TradingChart] 📐 activeDrawing=${!!activeDrawing}, type=${activeDrawing?.type}, points=${activeDrawing?.points?.length}`);
      if (activeDrawing && activeDrawing.type !== 'freehand') {
        const price = seriesRef.current.coordinateToPrice(param.point.y);
        if (price !== null) {
          const rect = containerRef.current?.getBoundingClientRect();
          const clientX = rect ? rect.left + param.point.x : param.point.x;
          const clientY = rect ? rect.top + param.point.y : param.point.y;

          // Each annotation opens its editor after its own anchor sequence completes.
          if (activeDrawing.type === 'text') {
            const annotationTool = getAnnotationTool(activeDrawing);
            drawingManager.updateActiveDrawing({ text: annotationTool?.editOnCreate ? annotationTool.label : '' });
            const complete = drawingManager.addPoint(time as number, price, undefined, contextId);
            if (complete && annotationTool?.editOnCreate) drawingManager.editAnnotation(activeDrawing.id, contextId, true);
            return;
          }

          // Callout tool: place first point normally, show text input on second click
          if (activeDrawing.type === 'callout' && activeDrawing.points.length === 1) {
            // Place the second point first (label box position)
            drawingManager.addPoint(time as number, price, undefined, contextId);
            // Now prompt for the label text
            setTextInputOverlay({ x: clientX, y: clientY - 40, time: time as number, price });
            setTextInputValue('');
            return;
          }

          if (activeDrawing.type === 'vline') {
            const rawX = (param.sourceEvent && containerRef.current)
              ? (param.sourceEvent.clientX - containerRef.current.getBoundingClientRect().left)
              : param.point.x;
            // Vertical and cross lines retain their exact within-bar X placement.
            const logical = chart.timeScale().coordinateToLogical(param.point.x);
            const barCenterX = logical !== null ? chart.timeScale().logicalToCoordinate(logical) : null;
            const pixelXOffset = barCenterX !== null ? rawX - barCenterX : 0;
            drawingManager.addPointWithLogical(
              (time || Date.now() / 1000) as number,
              price,
              pixelXOffset,
              contextId,
            );
          } else {
            // Every other tool stays anchored in time/price space so endpoint and
            // whole-drawing drags do not accidentally use vertical-line semantics.
            drawingManager.addPoint(
              (time || Date.now() / 1000) as number,
              price,
              undefined,
              contextId,
              drawingLogical ?? undefined,
              Boolean(param.sourceEvent?.shiftKey),
            );
          }
        }
      }
    };
    // lightweight-charts intentionally omits MouseEvent.detail from its
    // sourceEvent payload. Capture the native second click to complete open
    // paths. Mouse anchors are already recorded on pointerdown; the manager
    // ignores the duplicate final press. Touch retains chart-click placement.
    const handleGhostFeedClickCapture = (event: MouseEvent) => {
      const contextId = drawingRuntimeContextRef.current.contextId;
      if (event.detail < 2) return;
      if (drawingCommandTargetRef.current !== contextId) return;
      const activeDrawing = drawingManager.getActiveDrawing(contextId);
      const isPath = activeDrawing?.type === 'shapes' && ['path', 'polyline'].includes(activeDrawing.subtype!);
      if (!isPath && (activeDrawing?.type !== 'measure' || activeDrawing.subtype !== 'ghost_feed')) return;
      drawingManager.finishDrawing(contextId);
    };
    if (containerRef.current) {
      containerRef.current.addEventListener('click', handleGhostFeedClickCapture, true);
    }
    chart.subscribeClick(clickHandler);

    const handlePointerDown = (e: PointerEvent) => {
      ignoreNextDrawingClick = false;
      drawingMousePointerActive = e.pointerType === 'mouse';
      const drawingContext = drawingRuntimeContextRef.current;
      const contextId = drawingContext.contextId;
      if (drawingCommandTargetRef.current !== contextId) return;
      if (!e.isPrimary || e.button !== 0 || isDrawingContinuous) return;
      const activeDrawing = drawingManager.getActiveDrawing(contextId);
      if (
        e.pointerType === 'mouse'
        && activeDrawing
        && activeDrawing.type !== 'freehand'
        && usesDirectDrawingPointerInput(activeDrawing)
        && containerRef.current
      ) {
        const container = containerRef.current;
        const rect = container.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;
        const plotWidth = container.clientWidth - chart.priceScale('right').width();
        const plotHeight = container.clientHeight - chart.timeScale().height();
        if (x < 0 || y < 0 || x >= plotWidth || y >= plotHeight) return;

        // TradingView records each anchor on mouse-down, even if the user
        // moves before releasing. Native chart clicks discard that gesture.
        // Suppress compatibility mouse-down so the final anchor cannot also
        // start a chart pan after drawing:saved restores scrolling.
        e.preventDefault();
        clickHandler({
          point: { x: x as Coordinate, y: y as Coordinate },
          time: chart.timeScale().coordinateToTime(x),
          seriesData: new Map(),
          sourceEvent: e as unknown as ChartMouseParam['sourceEvent'],
        });
        ignoreNextDrawingClick = true;
        return;
      }
      if (activeDrawing?.type === 'freehand') {
        const container = containerRef.current;
        if (!container || !bindDrawingManagerToChart()) return;
        const rect = container.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;
        if (x < 0 || y < 0 || x >= container.clientWidth - chart.priceScale('right').width()
          || y >= container.clientHeight - chart.timeScale().height()) return;
        e.preventDefault();
        ignoreNextDrawingClick = true;
        isDrawingContinuous = true;
        continuousPointerId = e.pointerId;
        continuousDrawingId = activeDrawing.id;
        drawingManager.addFreehandPoint(x, y, contextId, true);
        try { container.setPointerCapture(e.pointerId); } catch { /* Detached synthetic pointer. */ }
      }
    };

    if (containerRef.current) {
      containerRef.current.addEventListener('pointerdown', handlePointerDown as EventListener);
    }


    const handlePointerUp = (event: PointerEvent) => {
      if (isDrawingContinuous) {
        const contextId = drawingRuntimeContextRef.current.contextId;
        if (continuousPointerId !== null && event.pointerId !== continuousPointerId) return;
        const activeDrawing = drawingManager.getActiveDrawing(contextId);
        const ownsStroke = activeDrawing?.id === continuousDrawingId;
        if (ownsStroke && Number.isFinite(event.clientX) && Number.isFinite(event.clientY)) {
          handleDrawingPointerMove(event);
        }
        isDrawingContinuous = false;
        continuousPointerId = null;
        continuousDrawingId = null;
        try { containerRef.current?.releasePointerCapture(event.pointerId); } catch { /* Already released. */ }
        if (!ownsStroke) return;
        if (activeDrawing && activeDrawing.points.length > 0) {
          drawingManager.finishDrawing(contextId);
        } else if (activeDrawing) {
          drawingManager.cancelDrawing(contextId);
        }
      }
    };
    const handlePointerCancel = (event: PointerEvent) => {
      if (!isDrawingContinuous) return;
      if (continuousPointerId !== null && event.pointerId !== continuousPointerId) return;
      isDrawingContinuous = false;
      continuousPointerId = null;
      const contextId = drawingRuntimeContextRef.current.contextId;
      if (drawingManager.getActiveDrawing(contextId)?.id === continuousDrawingId) {
        drawingManager.cancelDrawing(drawingRuntimeContextRef.current.contextId);
      }
      continuousDrawingId = null;
    };
    window.addEventListener('pointerup', handlePointerUp);
    window.addEventListener('pointercancel', handlePointerCancel);

    const crosshairHandler = (param: ChartMouseParam) => {
      const drawingContext = drawingRuntimeContextRef.current;
      const contextId = drawingContext.contextId;
      const ownsDrawingContext = drawingCommandTargetRef.current === contextId;
      const activeDrawing = ownsDrawingContext
        ? drawingManager.getActiveDrawing(contextId)
        : null;
      const needsDrawingPreview = Boolean(
        ownsDrawingContext
        && (activeDrawing || activeToolRef.current || isDrawingContinuous)
      );

      // Cursor-mode crosshair events are owned entirely by lightweight-charts.
      // Avoid canvas queries, coordinate conversion and drawing-manager work
      // until a drawing tool actually needs a live preview.
      if (!needsDrawingPreview) return;
      // Brush samples belong exclusively to native pointer events, including
      // pen/touch input. Hidden crosshair events can be snapped or duplicated.
      if (activeDrawing?.type === 'freehand') return;

      // Anchor tools use native pointer movement, including movement with the
      // button held. Ignore native crosshair resets as well: only a real DOM
      // pointerleave should hide a mouse-owned preview's coordinate labels.
      if (usesDirectDrawingPointerInput(activeDrawing)
        && drawingMousePointerActive && !param.drawingPointerInput) return;
      if (!param.point) {
        drawingManager.hidePreviewCursor(contextId);
        return;
      }

      // lightweight-charts re-applies cursor:crosshair on every crosshair event.
      // Enforce the correct cursor here every frame so it doesn't flicker back.
      if (!activeToolRef.current && containerRef.current) {
        containerRef.current.querySelectorAll('canvas').forEach((c) => {
          if ((c as HTMLElement).style.cursor !== 'default') {
            (c as HTMLElement).style.cursor = 'default';
          }
        });
      }

      if (param.point && seriesRef.current) {
        // Project time if undefined (hovering in future blank margin)
        const drawingLogical = coordinateToFractionalLogical(param.point.x)
          ?? chart.timeScale().coordinateToLogical(param.point.x);
        let time = param.time;
        if (!time && param.point) {
          time = projectDrawingTimeAtLogical(
            seriesRef.current,
            chart.timeScale(),
            drawingLogical,
            getTimeframeSeconds(drawingContext.timeframe as AggTimeframe),
          ) as Time;
        }

        if (time) {
          const price = seriesRef.current.coordinateToPrice(param.point.y);
          if (price !== null) {
            if (!bindDrawingManagerToChart()) return;

            if (isDrawingContinuous) {
              drawingManager.addPoint(
                Number(time),
                price,
                undefined,
                contextId,
                drawingLogical ?? undefined,
              );
            } else {
              if (activeDrawing && activeDrawing.type === 'vline') {
                const rawX = (param.sourceEvent && containerRef.current)
                  ? (param.sourceEvent.clientX - containerRef.current.getBoundingClientRect().left)
                  : param.point.x;
                const logical = chart.timeScale().coordinateToLogical(param.point.x);
                const barCenterX = logical !== null ? chart.timeScale().logicalToCoordinate(logical) : null;
                const pixOff = barCenterX !== null ? rawX - barCenterX : 0;
                drawingManager.updatePreviewPointWithLogical(
                  Number(time),
                  price,
                  pixOff,
                  contextId,
                );
              } else {
                drawingManager.updatePreviewPoint(
                  Number(time),
                  price,
                  contextId,
                  drawingLogical ?? undefined,
                  Boolean(param.sourceEvent?.shiftKey),
                );
              }
            }
          }
        }
      }

    };
    chart.subscribeCrosshairMove(crosshairHandler);

    const handleDrawingPointerMove = (e: PointerEvent) => {
      const contextId = drawingRuntimeContextRef.current.contextId;
      if (drawingCommandTargetRef.current !== contextId) return;
      const drawing = drawingManager.getActiveDrawing(contextId);
      const container = containerRef.current;
      if (!usesDirectDrawingPointerInput(drawing) || !container) return;
      if (drawing?.type === 'freehand') {
        if (!isDrawingContinuous || e.pointerId !== continuousPointerId || drawing.id !== continuousDrawingId) return;
        if (!bindDrawingManagerToChart()) return;
        const rect = container.getBoundingClientRect();
        const samples = e.getCoalescedEvents?.() ?? [];
        // Include the dispatched event as well as coalesced pen samples: it
        // contains the final release position on pointerup.
        for (const sample of [...samples, e]) {
          const x = sample.clientX - rect.left;
          const y = sample.clientY - rect.top;
          if (x < 0 || y < 0 || x >= container.clientWidth - chart.priceScale('right').width()
            || y >= container.clientHeight - chart.timeScale().height()) continue;
          drawingManager.addFreehandPoint(x, y, contextId, e.type === 'pointerup');
        }
        return;
      }
      if (e.pointerType !== 'mouse') return;
      const rect = container.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      if (x < 0 || y < 0
        || x >= container.clientWidth - chart.priceScale('right').width()
        || y >= container.clientHeight - chart.timeScale().height()) {
        drawingManager.hidePreviewCursor(contextId);
        return;
      }
      drawingMousePointerActive = true;
      crosshairHandler({
        point: { x: x as Coordinate, y: y as Coordinate },
        time: chart.timeScale().coordinateToTime(x),
        seriesData: new Map(),
        sourceEvent: e as unknown as ChartMouseParam['sourceEvent'],
        drawingPointerInput: true,
      });
    };
    containerRef.current?.addEventListener('pointermove', handleDrawingPointerMove);
    const handleDrawingPointerLeave = () => {
      drawingManager.hidePreviewCursor(drawingRuntimeContextRef.current.contextId);
    };
    containerRef.current?.addEventListener('pointerleave', handleDrawingPointerLeave);

    const handleDrawingShiftChange = (event: KeyboardEvent) => {
      const currentContext = drawingRuntimeContextRef.current.contextId;
      const active = drawingManager.getActiveDrawing(currentContext);
      const editable = event.target instanceof Element && Boolean(event.target.closest('input, textarea, select, [contenteditable="true"]'));
      if (!editable && event.type === 'keydown' && drawingCommandTargetRef.current === currentContext && active?.type === 'shapes') {
        if (event.key === 'Enter' && ['path', 'polyline'].includes(active.subtype!)) { event.preventDefault(); drawingManager.finishDrawing(currentContext); return; }
        if (event.key === 'Escape') { event.preventDefault(); drawingManager.cancelDrawing(currentContext); return; }
      }
      if (!editable && event.type === 'keydown' && drawingCommandTargetRef.current === currentContext && active?.type === 'measure') {
        if (event.key === 'Enter' && active.subtype === 'ghost_feed') { event.preventDefault(); drawingManager.finishDrawing(currentContext); return; }
        if (event.key === 'Escape') { event.preventDefault(); drawingManager.cancelDrawing(currentContext); return; }
      }
      const contextId = drawingRuntimeContextRef.current.contextId;
      if (event.key !== 'Shift' || drawingCommandTargetRef.current !== contextId) return;
      drawingManager.setPreviewShiftPressed(event.type === 'keydown', contextId);
    };
    document.addEventListener('keydown', handleDrawingShiftChange);
    document.addEventListener('keyup', handleDrawingShiftChange);

    setTimeout(() => {
      if (!activeToolRef.current && containerRef.current) {
        containerRef.current.querySelectorAll('canvas').forEach((c) => {
          (c as HTMLElement).style.cursor = 'default';
        });
      }
    }, 0);

    const drawingOverlayContainer = overlayRef.current;
    let drawingRenderFrame: number | null = null;
    const timeRangeHandler = () => {
      if (!drawingManager.hasRenderableContent(drawingOverlayContainer)) return;
      if (drawingRenderFrame !== null) return;
      drawingRenderFrame = window.requestAnimationFrame(() => {
        drawingRenderFrame = null;
        drawingManager.renderContext(drawingOverlayContainer);
      });
    };

    // Save cleanup functions to chart object or local scope for unmount
    (chart as ChartWithDrawingCleanup)._cleanupDrawings = () => {
      chart.unsubscribeClick(clickHandler);
      chart.unsubscribeCrosshairMove(crosshairHandler);
      containerRef.current?.removeEventListener('pointermove', handleDrawingPointerMove);
      containerRef.current?.removeEventListener('pointerleave', handleDrawingPointerLeave);
      try { chart.timeScale().unsubscribeVisibleLogicalRangeChange(timeRangeHandler); } catch { /* chart may be disposed */ }
      unregisterDrawingScrollLock();
      if (drawingRenderFrame !== null) {
        window.cancelAnimationFrame(drawingRenderFrame);
        drawingRenderFrame = null;
      }
      if (containerRef.current) {
        containerRef.current.removeEventListener('click', handleGhostFeedClickCapture, true);
        containerRef.current.removeEventListener('pointerdown', handlePointerDown as EventListener);
      }
      window.removeEventListener('pointerup', handlePointerUp);
      window.removeEventListener('pointercancel', handlePointerCancel);
      document.removeEventListener('keydown', handleDrawingShiftChange);
      document.removeEventListener('keyup', handleDrawingShiftChange);
    };

    // Re-render drawings on every zoom/pan so they stay pinned to the chart
    chart.timeScale().subscribeVisibleLogicalRangeChange(timeRangeHandler);

    isRebuildingRef.current = false; // Safe to resume ticks and resizes
  }, [applyChartTypeInPlace, cancelQueuedChartRender, chartType, createPriceSeries, symbol, resetLiveQuotePriceGuard, updateChartData, clearPeriodSeparators, hydrateHistoryFromCache, timeframe]);
};
