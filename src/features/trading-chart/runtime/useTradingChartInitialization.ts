import { useEffect, type RefObject } from 'react';
import {
  ColorType,
  CrosshairMode,
  LineSeries,
  createChartEx,
  type IChartApi,
  type IPriceLine,
  type ISeriesApi,
  type LogicalRange,
  type MouseEventParams,
  type SeriesType,
  type Time,
} from 'lightweight-charts';
import { drawingManager } from '../../../services/drawingManager';
import type { IndicatorManager } from '../../../services/indicatorManager';
import type { SelectedTimeframeHistoryCoordinator } from '../../../services/chartHistoryLoader';
import type { ChartProperties } from '../../../store/useChartSettingsStore';
import { useChartZoomStore } from '../../../store/useChartZoomStore';
import type { ChartInteractionOwnership } from '../../../utils/chartInteractionOwnership';
import { createChartInteractionOwnership } from '../../../utils/chartInteractionOwnership';
import type { ChartPostInteractionCoordinator } from '../../../utils/chartPostInteractionCoordinator';
import { resolveVisibleRangeHistoryAction } from '../../../services/chartHistoryLoader';
import { computeMinimumVisiblePriceSpan } from '../../../utils/chartPriceScale';
import { computePriceAxisDragRange } from '../../../utils/priceAxisDragZoom';
import { createChartWheelSmoothing } from '../../../utils/chartWheelSmoothing';
import {
  getTradingChartShiftRightOffset,
  getTradingChartTickMarkCharacterLength,
} from '../../../utils/chartTimeFormat';
import { TradingChartTimeScaleBehavior } from '../../../utils/chartTimeScaleBehavior';
import {
  SquareChartGridPrimitive,
} from '../../../utils/squareChartGridPrimitive';
import { getChartGridRenderingOptions } from '../../../utils/chartGridOptions';
import type {
  Candle,
  Timeframe,
  TradingViewChartTheme,
} from '../../../types/chart';
import {
  getDisplayVolume,
  TRADING_CHART_TIME_SCALE_LIVE_SHIFT_OPTIONS,
} from '../../../components/TradingChart.helpers';
import {
  HISTORY_RENDER_INTERACTION_IDLE_MS,
  shouldScrollToRealtime,
} from './chartRuntime';
import {
  TRADING_VIEW_HANDLE_SCALE,
  TRADING_VIEW_HANDLE_SCROLL,
} from './chartInteractionOptions';
import { getFixedChartPriceRange } from '../model/indicatorRequest';
import {
  CHART_AXIS_FONT_FAMILY,
  CHART_AXIS_FONT_SIZE,
  LIGHT_CHART_AXIS_FONT_FAMILY,
} from '../presentation/chartTheme';

interface UseTradingChartInitializationOptions {
  activeChartSourceId: string;
  applyLivePriceHorizontalGeometry: (measuredScaleWidth: number) => void;
  askPriceLineRef: RefObject<IPriceLine | null>;
  autoScrollEnabledRef: RefObject<boolean>;
  brokerTimeOffsetSecRef: RefObject<number>;
  cancelQueuedChartRender: () => void;
  chartAxisFontSize: number;
  chartInteractionOwnershipRef: RefObject<ChartInteractionOwnership | null>;
  chartRef: RefObject<IChartApi | null>;
  chartSettings: ChartProperties;
  chartSettingsRef: RefObject<ChartProperties>;
  chartTheme: TradingViewChartTheme;
  clearLocalChartPointerStateRef: RefObject<() => void>;
  clearPeriodSeparators: () => void;
  containerRef: RefObject<HTMLDivElement | null>;
  ctxChartShift: boolean;
  currentCandleRef: RefObject<Candle | null>;
  dataWindowHoverTimeRef: RefObject<number | null>;
  drawingRenderFrameRef: RefObject<number | null>;
  drawingRenderSettledFrameRef: RefObject<number | null>;
  drawingRuntimeContextRef: RefObject<{
    contextId: string;
    accountScope?: string;
    symbol: string;
    timeframe: Timeframe;
  }>;
  flushPostInteractionWork: () => boolean;
  forceSettleInteraction: () => void;
  getDrawingSeriesData: () => Candle[];
  historyRequestCoordinatorRef: RefObject<SelectedTimeframeHistoryCoordinator>;
  indicatorStorageScopeRef: RefObject<string>;
  isActiveRef: RefObject<boolean>;
  isAdvancedUntitledLight: boolean;
  isChartInteractionActiveRef: RefObject<boolean>;
  isChartUserInteractingRef: RefObject<boolean>;
  isDisposedRef: RefObject<boolean>;
  isVisibleRangeHistoryLoadSuppressed: () => boolean;
  lastPriceLineRef: RefObject<IPriceLine | null>;
  latestCandleJumpPendingRef: RefObject<boolean>;
  livePriceBadgeRef: RefObject<HTMLDivElement | null>;
  livePriceLineRef: RefObject<HTMLDivElement | null>;
  livePriceRef: RefObject<number | null>;
  loadedIndicatorStorageScopeRef: RefObject<string | null>;
  loadMoreHistoryRef: RefObject<(() => Promise<void>) | null>;
  localIndicatorManager: IndicatorManager;
  overlayRef: RefObject<HTMLDivElement | null>;
  postInteractionCoordinatorRef: RefObject<ChartPostInteractionCoordinator | null>;
  priceLineRef: RefObject<unknown>;
  repaintTradeOverlayGeometryRef: RefObject<() => void>;
  resolvedPricePointRef: RefObject<number>;
  scheduleDrawingRenderAfterChartData: (activeSymbol: string, activeTimeframe: Timeframe) => void;
  scheduleQueuedChartRenderFlush: (immediate?: boolean) => void;
  seriesRef: RefObject<ISeriesApi<SeriesType> | null>;
  settleAutoScrollPolicyRef: RefObject<() => void>;
  squareGridHostSeriesRef: RefObject<ISeriesApi<'Line'> | null>;
  squareGridPrimitiveRef: RefObject<SquareChartGridPrimitive | null>;
  symbol: string;
  timeframe: Timeframe;
  timeScaleTimeframeRef: RefObject<Timeframe>;
  updateLegendDOM: (open: number, high: number, low: number, close: number, volume: number) => void;
  visibleRangeHistoryUserInitiatedRef: RefObject<boolean>;
  volumeRef: RefObject<ISeriesApi<SeriesType> | null>;
}

interface ChartLegendSeriesValue {
  open?: number;
  high?: number;
  low?: number;
  close?: number;
  value?: number;
}

type ChartWithDrawingCleanup = IChartApi & { _cleanupDrawings?: () => void };

export const useTradingChartInitialization = (options: UseTradingChartInitializationOptions): void => {
  const {
    activeChartSourceId, applyLivePriceHorizontalGeometry, askPriceLineRef, autoScrollEnabledRef,
    brokerTimeOffsetSecRef, cancelQueuedChartRender, chartAxisFontSize, chartInteractionOwnershipRef,
    chartRef, chartSettings, chartSettingsRef, chartTheme, clearLocalChartPointerStateRef,
    clearPeriodSeparators, containerRef, ctxChartShift, currentCandleRef, dataWindowHoverTimeRef,
    drawingRenderFrameRef, drawingRenderSettledFrameRef, drawingRuntimeContextRef,
    flushPostInteractionWork, forceSettleInteraction, getDrawingSeriesData,
    historyRequestCoordinatorRef, indicatorStorageScopeRef, isActiveRef, isAdvancedUntitledLight,
    isChartInteractionActiveRef, isChartUserInteractingRef, isDisposedRef,
    isVisibleRangeHistoryLoadSuppressed, lastPriceLineRef, latestCandleJumpPendingRef,
    livePriceBadgeRef, livePriceLineRef, livePriceRef, loadedIndicatorStorageScopeRef,
    loadMoreHistoryRef, localIndicatorManager, overlayRef, postInteractionCoordinatorRef,
    priceLineRef, repaintTradeOverlayGeometryRef, resolvedPricePointRef,
    scheduleDrawingRenderAfterChartData, scheduleQueuedChartRenderFlush, seriesRef,
    settleAutoScrollPolicyRef, squareGridHostSeriesRef, squareGridPrimitiveRef, symbol, timeframe,
    timeScaleTimeframeRef, updateLegendDOM, visibleRangeHistoryUserInitiatedRef, volumeRef,
  } = options;

useEffect(() => {
    console.log(`[TradingChart] Chart init effect running`);
    // Guard against double-mount (React StrictMode) and existing chart
    if (!containerRef.current) {
      console.log(`[TradingChart] No container ref, skipping chart init`);
      return;
    }
    if (chartRef.current) {
      console.log(`[TradingChart] Chart already exists, skipping creation`);
      return;
    }
    const drawingManagerOverlayContainer = overlayRef.current;
    isDisposedRef.current = false;
    visibleRangeHistoryUserInitiatedRef.current = false;

    console.log(`[TradingChart] Container size: ${containerRef.current.offsetWidth}x${containerRef.current.offsetHeight}`);

    // Footer tick steps follow the timeframe (M1 → 1m, M5 → 5m, ...).
    const timeScaleBehavior = new TradingChartTimeScaleBehavior({
      getTimeframe: () => timeScaleTimeframeRef.current,
      getDisplayOffsetSeconds: () => brokerTimeOffsetSecRef.current,
    });
    const gridRenderingOptions = getChartGridRenderingOptions(chartSettings, chartTheme);
    const chart = createChartEx(containerRef.current, timeScaleBehavior, {
      autoSize: true,
      localization: { dateFormat: "dd MMM 'yy" },
      layout: {
        background: { type: ColorType.Solid, color: chartTheme.background },
        textColor: chartTheme.axisText,
        fontFamily: isAdvancedUntitledLight ? LIGHT_CHART_AXIS_FONT_FAMILY : CHART_AXIS_FONT_FAMILY,
        fontSize: chartAxisFontSize,
        attributionLogo: false,
      },
      // Both grid types paint below candles. Only the selected renderer is visible.
      grid: gridRenderingOptions.nativeGrid,
      crosshair: {
        mode: CrosshairMode.Normal,
        // Native crosshair lines stay hidden. Explicit Crosshair mode uses the
        // custom overlay below; drawing tools only place and preview geometry.
        vertLine: { visible: false, color: chartTheme.crosshair, width: 1, style: 2, labelVisible: false },
        horzLine: { visible: false, color: chartTheme.crosshair, width: 1, style: 2, labelVisible: false },
      },
      handleScroll: TRADING_VIEW_HANDLE_SCROLL,
      handleScale: TRADING_VIEW_HANDLE_SCALE,
      kineticScroll: {
        touch: true,
        mouse: true,
      },
      rightPriceScale: {
        borderColor: chartTheme.scaleBorder,
        textColor: chartSettings.showGrid && chartSettings.gridType === 'mt5' ? 'transparent' : chartTheme.axisText,
        scaleMargins: { top: 0.05, bottom: 0.28 },
        autoScale: !chartSettings.scaleFixOneToOne && getFixedChartPriceRange(chartSettings) === null,
        // Trade price-line labels must stay on their real price coordinate.
        // Close prices intentionally overlap instead of being collision-shifted.
        alignLabels: false,
      },
      timeScale: {
        ...TRADING_CHART_TIME_SCALE_LIVE_SHIFT_OPTIONS,
        borderColor: chartTheme.scaleBorder,
        timeVisible: true,
        secondsVisible: false,
        tickMarkMaxCharacterLength: getTradingChartTickMarkCharacterLength(timeframe),
        barSpacing: 8,
        minBarSpacing: 0.5,
        rightOffset: getTradingChartShiftRightOffset(timeframe, ctxChartShift),
        fixLeftEdge: false,
        fixRightEdge: false,
        // Future whitespace must participate in time-axis ticks and grid marks.
        ignoreWhitespaceIndices: false,
      },
    }) as IChartApi;

    chartRef.current = chart;
    // This transparent host supplies only future whitespace in scale-grid mode
    // and gives the Square and Fine grids a stable `bottom` layer below candles.
    const squareGridHostSeries = chart.addSeries(LineSeries, {
      visible: true,
      color: 'rgba(0, 0, 0, 0)',
      priceScaleId: 'right',
      priceLineVisible: false,
      lastValueVisible: false,
      crosshairMarkerVisible: false,
    });
    const squareGridPrimitive = new SquareChartGridPrimitive(gridRenderingOptions.fixedGrid, {
      labelAt: (coordinate) => {
        const series = seriesRef.current;
        if (!series) return null;
        const price = series.coordinateToPrice(coordinate);
        return price === null || !Number.isFinite(price) ? null : series.priceFormatter().format(price);
      },
      appearance: () => {
        const layout = chart.options().layout;
        return { color: layout.textColor, fontSize: layout.fontSize, fontFamily: layout.fontFamily };
      },
    });
    squareGridHostSeries.attachPrimitive(squareGridPrimitive);
    squareGridHostSeriesRef.current = squareGridHostSeries;
    squareGridPrimitiveRef.current = squareGridPrimitive;
    localIndicatorManager.setChart(chart);

    // Initial setup handled by autoSize: true

    // ─── MT5-style Auto-Scroll (Snap back to live after 3s of inactivity) ───
    let autoScrollTimer: ReturnType<typeof setTimeout> | null = null;
    const interactionOwnership = createChartInteractionOwnership({
      idleMs: HISTORY_RENDER_INTERACTION_IDLE_MS,
      onActive: () => {
        isChartInteractionActiveRef.current = true;
        latestCandleJumpPendingRef.current = false;
      },
      onIdle: () => {
        if (!isDisposedRef.current && isActiveRef.current) {
          // Keep interaction ownership marked active while settling so any
          // synchronous range callbacks join this same ordered pass.
          flushPostInteractionWork();
        }
        isChartInteractionActiveRef.current = false;
        if (isActiveRef.current) {
          scheduleQueuedChartRenderFlush();
        }
      },
    });
    chartInteractionOwnershipRef.current = interactionOwnership;
    // autoScrollEnabled is now managed by autoScrollEnabledRef

    const resetAutoScrollTimer = () => {
      if (autoScrollTimer) {
        clearTimeout(autoScrollTimer);
        autoScrollTimer = null;
      }
      if (
        isDisposedRef.current
        || !isActiveRef.current
        || document.visibilityState === 'hidden'
        || !chartRef.current
        || !autoScrollEnabledRef.current
        || !chartSettingsRef.current.chartAutoScroll
      ) return;

      autoScrollTimer = setTimeout(() => {
        if (
          !isDisposedRef.current &&
          chartRef.current &&
          !isChartUserInteractingRef.current &&
          shouldScrollToRealtime(
            chartRef.current,
            autoScrollEnabledRef.current,
            chartSettingsRef.current.chartAutoScroll,
            getTradingChartShiftRightOffset(timeframe, chartSettingsRef.current.chartShift),
          )
        ) {
          chartRef.current.timeScale().scrollToPosition(
            getTradingChartShiftRightOffset(timeframe, chartSettingsRef.current.chartShift),
            false,
          );
        }
        autoScrollTimer = null;
      }, 3000); // 3 seconds after last interaction
    };
    settleAutoScrollPolicyRef.current = resetAutoScrollTimer;

    let heldChartPointerId: number | null = null;
    let rightPriceScalePointerId: number | null = null;
    let rightPriceScaleDragStartY: number | null = null;
    let rightPriceScaleDragStartRange: { from: number; to: number } | null = null;
    let rightPriceScaleDragGeometry: { paneHeight: number; startY: number } | null = null;
    let priceBoundOverlayGeometryRepaintFrame: number | null = null;

    const getMinimumVisiblePriceSpan = (): number => {
      const configuredPoint = Number(
        (seriesRef.current?.options().priceFormat as { minMove?: number } | undefined)?.minMove,
      );
      const point = Number.isFinite(configuredPoint) && configuredPoint > 0
        ? configuredPoint
        : resolvedPricePointRef.current;

      try {
        const surfaceHeight = containerRef.current?.getBoundingClientRect().height ?? 0;
        const paneHeight = Math.max(0, surfaceHeight - chart.timeScale().height());
        const scaleMargins = chart.priceScale('right').options().scaleMargins;
        const chartFontSize = Number(chart.options().layout.fontSize);
        const minimumSpan = computeMinimumVisiblePriceSpan({
          point,
          paneHeight,
          fontSize: Number.isFinite(chartFontSize) && chartFontSize > 0
            ? chartFontSize
            : CHART_AXIS_FONT_SIZE,
          topMargin: Number(scaleMargins?.top),
          bottomMargin: Number(scaleMargins?.bottom),
        });
        return minimumSpan > 0 ? minimumSpan : point;
      } catch {
        return point;
      }
    };

    const isRightPriceScalePointer = (event: PointerEvent): boolean => {
      const surface = containerRef.current;
      if (!surface) return false;

      const rect = surface.getBoundingClientRect();
      const scaleWidth = chart.priceScale('right').width();
      const timeScaleHeight = chart.timeScale().height();
      if (scaleWidth <= 0 || rect.width <= 0 || rect.height <= 0) return false;

      const axisLeft = rect.right - scaleWidth;
      const paneBottom = rect.bottom - Math.max(0, timeScaleHeight);
      return event.clientX >= axisLeft
        && event.clientX <= rect.right
        && event.clientY >= rect.top
        && event.clientY < paneBottom;
    };

    const isChartPaneWheel = (event: WheelEvent): boolean => {
      const surface = containerRef.current;
      if (!surface) return false;

      const rect = surface.getBoundingClientRect();
      const scaleWidth = Math.max(0, chart.priceScale('right').width());
      const timeScaleHeight = Math.max(0, chart.timeScale().height());
      if (rect.width <= 0 || rect.height <= 0) return false;

      return event.clientX >= rect.left
        && event.clientX < rect.right - scaleWidth
        && event.clientY >= rect.top
        && event.clientY < rect.bottom - timeScaleHeight;
    };

    const handleWheelInteractionStart = (event: WheelEvent) => {
      if (!event.cancelable || !isChartPaneWheel(event)) return;
      const target = event.target;
      if (target instanceof Element && target.closest('button, input, select, textarea, a, [role="button"], [role="menu"], [role="dialog"]')) return;
      const rect = containerRef.current?.getBoundingClientRect();
      if (!rect || !wheelSmoothing.handleWheel(event, event.clientX - rect.left)) return;
      // Consume only plot gestures claimed by the controller. Native axis,
      // touch/pinch, and locked drawing interactions retain their own handlers.
      event.preventDefault();
      event.stopPropagation();
    };

    const repaintLivePriceOverlayGeometry = () => {
      if (isDisposedRef.current || !isActiveRef.current) return;

      const livePrice = livePriceRef.current;
      const series = seriesRef.current;
      const line = livePriceLineRef.current;
      const badge = livePriceBadgeRef.current;
      if (livePrice === null || !Number.isFinite(livePrice) || !series || !line || !badge) return;

      try {
        const y = series.priceToCoordinate(livePrice);
        if (y === null || !Number.isFinite(y)) return;

        const scaleWidth = chart.priceScale('right').width();
        applyLivePriceHorizontalGeometry(scaleWidth);
        line.style.top = `${y}px`;
        badge.style.top = `${y}px`;
      } catch {
        // The chart can be disposed between the pointer event and this frame.
      }
    };

    const queuePriceBoundOverlayGeometryRepaint = () => {
      if (priceBoundOverlayGeometryRepaintFrame !== null) return;
      priceBoundOverlayGeometryRepaintFrame = window.requestAnimationFrame(() => {
        priceBoundOverlayGeometryRepaintFrame = null;
        repaintLivePriceOverlayGeometry();
        // Active/history trade overlays are DOM nodes, so Lightweight Charts
        // cannot reposition them when only the price range changes. Keep their
        // cached price-to-coordinate geometry in the same frame as the canvas.
        repaintTradeOverlayGeometryRef.current();
        // SVG drawings use the same price transform. A price-axis drag does
        // not emit a time-range change, so it must also queue their repaint.
        if (drawingManager.hasRenderableContent(drawingManagerOverlayContainer)
          && drawingRenderFrameRef.current === null && drawingRenderSettledFrameRef.current === null) {
          const drawingContext = drawingRuntimeContextRef.current;
          scheduleDrawingRenderAfterChartData(drawingContext.symbol, drawingContext.timeframe as Timeframe);
        }
      });
    };

    // Lightweight Charts has no direct price-scale width event. A right-axis
    // width change resizes the time-scale surface, though, so repaint one frame
    // later after the library has committed its new axis geometry. This also
    // covers static/closed charts where no next quote would otherwise repaint.
    const handleTimeScaleSizeChange = () => queuePriceBoundOverlayGeometryRepaint();
    chart.timeScale().subscribeSizeChange(handleTimeScaleSizeChange);

    const wheelSmoothing = createChartWheelSmoothing({
      chart,
      canInteract: () => !isDisposedRef.current && isActiveRef.current
        && chartRef.current === chart && !interactionOwnership.isHeld()
        && document.visibilityState !== 'hidden',
      onActivity: () => {
        visibleRangeHistoryUserInitiatedRef.current = true;
        interactionOwnership.noteWheelActivity();
        if (autoScrollTimer) {
          clearTimeout(autoScrollTimer);
          autoScrollTimer = null;
        }
      },
      onFrame: queuePriceBoundOverlayGeometryRepaint,
    });

    const handlePointerInteractionStart = (event: PointerEvent) => {
      wheelSmoothing.cancel();
      if (!interactionOwnership.beginPointer({
        pointerId: event.pointerId,
        button: event.button,
        isPrimary: event.isPrimary,
      })) return;
      heldChartPointerId = event.pointerId;
      rightPriceScalePointerId = isRightPriceScalePointer(event) ? event.pointerId : null;
      rightPriceScaleDragStartY = null;
      rightPriceScaleDragStartRange = null;
      rightPriceScaleDragGeometry = null;
      if (rightPriceScalePointerId !== null) {
        // Anchor the MT5-style axis zoom on the range captured at press time.
        try {
          const startRange = chart.priceScale('right').getVisibleRange();
          const startFrom = Number(startRange?.from);
          const startTo = Number(startRange?.to);
          if (Number.isFinite(startFrom) && Number.isFinite(startTo) && startTo > startFrom) {
            rightPriceScaleDragStartY = event.clientY;
            rightPriceScaleDragStartRange = { from: startFrom, to: startTo };
            const rect = containerRef.current?.getBoundingClientRect() ?? { height: 0, top: 0 };
            rightPriceScaleDragGeometry = {
              paneHeight: Math.max(1, rect.height - chart.timeScale().height()),
              startY: event.clientY - rect.top,
            };
          }
        } catch {
          // Chart may be mid-teardown; the drag then only repaints geometry.
        }
      }
      visibleRangeHistoryUserInitiatedRef.current = true;
      isChartUserInteractingRef.current = true;
      if (autoScrollTimer) clearTimeout(autoScrollTimer);
    };

    const handleRightPriceScalePointerMove = (event: PointerEvent) => {
      if (rightPriceScalePointerId !== event.pointerId || (event.buttons & 1) === 0) return;
      if (rightPriceScaleDragStartY !== null && rightPriceScaleDragStartRange !== null) {
        const dragDeltaY = event.clientY - rightPriceScaleDragStartY;
        if (Math.abs(dragDeltaY) >= 1) {
          const nextRange = computePriceAxisDragRange({
            startFrom: rightPriceScaleDragStartRange.from,
            startTo: rightPriceScaleDragStartRange.to,
            dragDeltaY,
            minSpan: getMinimumVisiblePriceSpan(),
            ...rightPriceScaleDragGeometry,
          });
          if (nextRange) {
            try {
              chart.priceScale('right').setVisibleRange(nextRange);
            } catch {
              // The chart can be disposed between the pointer event and this update.
            }
          }
        }
      }
    };

    const handleHeldChartPointerMove = (event: PointerEvent) => {
      if (isDisposedRef.current || !isActiveRef.current) return;
      if (heldChartPointerId !== event.pointerId || (event.buttons & 1) === 0) return;

      // Lightweight Charts can shift both price and time coordinates while a
      // pointer is held anywhere in the plot. Apply our axis-only zoom when
      // applicable, then repaint every price-bound DOM overlay in the next
      // animation frame, after the library has processed this move. The shared
      // queue coalesces repeated events to one RAF.
      handleRightPriceScalePointerMove(event);
      queuePriceBoundOverlayGeometryRepaint();
    };

    const handlePointerInteractionEnd = (event: PointerEvent) => {
      const endedHeldChartPointer = heldChartPointerId === event.pointerId;
      if (endedHeldChartPointer) {
        heldChartPointerId = null;
      }
      if (rightPriceScalePointerId === event.pointerId) {
        rightPriceScalePointerId = null;
        rightPriceScaleDragStartY = null;
        rightPriceScaleDragStartRange = null;
        rightPriceScaleDragGeometry = null;
      }
      if (endedHeldChartPointer) {
        queuePriceBoundOverlayGeometryRepaint();
      }
      if (!interactionOwnership.releasePointer(event.pointerId)) return;
      isChartUserInteractingRef.current = false;
      resetAutoScrollTimer();
    };

    const handleLostPointerCapture = (event: PointerEvent) => {
      // LWC normally releases capture with pointerup. Only treat an early lost
      // capture as release when the primary button is no longer physically held.
      if ((event.buttons & 1) !== 0) return;
      handlePointerInteractionEnd(event);
    };

    const handleTouchInteractionStart = (event: TouchEvent) => {
      wheelSmoothing.cancel();
      visibleRangeHistoryUserInitiatedRef.current = true;
      interactionOwnership.setTouchFallbackHeld(event.touches.length > 0);
      isChartUserInteractingRef.current = true;
      if (autoScrollTimer) clearTimeout(autoScrollTimer);
    };

    const handleTouchInteractionEnd = (event: TouchEvent) => {
      const hasRemainingTouches = event.touches.length > 0;
      interactionOwnership.setTouchFallbackHeld(hasRemainingTouches);
      if (!hasRemainingTouches) {
        isChartUserInteractingRef.current = false;
        resetAutoScrollTimer();
      }
    };

    const handleWheelInteraction = (event: WheelEvent) => {
      if (!isChartPaneWheel(event)) return;
      queuePriceBoundOverlayGeometryRepaint();
    };

    const clearLocalChartPointerState = () => {
      wheelSmoothing.cancel();
      heldChartPointerId = null;
      rightPriceScalePointerId = null;
      rightPriceScaleDragStartY = null;
      rightPriceScaleDragStartRange = null;
      rightPriceScaleDragGeometry = null;
    };
    clearLocalChartPointerStateRef.current = clearLocalChartPointerState;

    const forceSettleLocalPointerInteraction = () => {
      clearLocalChartPointerState();
      forceSettleInteraction();
    };

    const handleDocumentVisibilityChange = () => {
      if (document.visibilityState === 'hidden') {
        forceSettleLocalPointerInteraction();
      }
    };

    const chartContainer = containerRef.current;

    if (chartContainer) {
      // Track pointer/drag interactions for auto-scroll timer
      chartContainer.addEventListener('pointerdown', handlePointerInteractionStart, true);
      chartContainer.addEventListener('lostpointercapture', handleLostPointerCapture);
      chartContainer.addEventListener('pointerleave', interactionOwnership.notePointerLeave);
      chartContainer.addEventListener('touchstart', handleTouchInteractionStart, { passive: true, capture: true });
      chartContainer.addEventListener('wheel', handleWheelInteractionStart, { passive: false, capture: true });
      chartContainer.addEventListener('wheel', handleWheelInteraction, { passive: true });
      window.addEventListener('pointermove', handleHeldChartPointerMove, { passive: true });
      window.addEventListener('pointerup', handlePointerInteractionEnd, true);
      window.addEventListener('pointercancel', handlePointerInteractionEnd, true);
      window.addEventListener('touchend', handleTouchInteractionEnd, true);
      window.addEventListener('touchcancel', handleTouchInteractionEnd, true);
      window.addEventListener('blur', forceSettleLocalPointerInteraction);
      document.addEventListener('visibilitychange', handleDocumentVisibilityChange);
    } // end if (chartContainer)

    // Crosshair move for legend and the active chart Data Window.
    const crosshairHandler = (param: MouseEventParams<Time>) => {
      dataWindowHoverTimeRef.current = typeof param.time === 'number' ? param.time : null;
      if (param.time && seriesRef.current) {
        const data = param.seriesData.get(seriesRef.current) as ChartLegendSeriesValue | undefined;
        const volData = volumeRef.current
          ? param.seriesData.get(volumeRef.current) as ChartLegendSeriesValue | undefined
          : null;
        if (data) {
          updateLegendDOM(
            data.open || 0,
            data.high || 0,
            data.low || 0,
            data.close || data.value || 0,
            (volData && volData.value) ? volData.value : 0
          );
          return;
        }
      }
      // Projected future times have no price-series row. Restore the latest
      // candle just as for a pointer outside the chart, rather than stale hover OHLC.
      const c = currentCandleRef.current;
      if (c) {
        updateLegendDOM(c.open, c.high, c.low, c.close, getDisplayVolume(c, chartSettingsRef.current));
      }
    };
    chart.subscribeCrosshairMove(crosshairHandler);

    // Infinite scroll range handler
    const logicalRangeHandler = (logicalRange: LogicalRange | null) => {
      const contextId = drawingRuntimeContextRef.current.contextId;
      const zoomStore = useChartZoomStore.getState();
      if (logicalRange && zoomStore.byContext[contextId]) {
        zoomStore.syncSpacing(
          contextId,
          chart.timeScale().options().barSpacing,
        );
      }
      // Kinetic scrolling can keep changing the visible range after pointerup.
      // Re-arm the idle window until the final range change has settled.
      interactionOwnership.noteRangeActivity();
      const historyAction = resolveVisibleRangeHistoryAction({
        logicalFrom: logicalRange?.from,
        suppressed: isVisibleRangeHistoryLoadSuppressed(),
        interactionActive: isChartInteractionActiveRef.current,
        userInitiated: visibleRangeHistoryUserInitiatedRef.current,
      });
      if (historyAction === 'defer') {
        postInteractionCoordinatorRef.current?.request({ history: true });
        return;
      }
      if (historyAction === 'load') {
        loadMoreHistoryRef.current?.();
      }
    };
    chart.timeScale().subscribeVisibleLogicalRangeChange(logicalRangeHandler);

    return () => {
      const activeIndicatorStorageScope = loadedIndicatorStorageScopeRef.current
        ?? indicatorStorageScopeRef.current;
      localIndicatorManager.saveToStorage(activeIndicatorStorageScope);
      localIndicatorManager.clearAll();
      localIndicatorManager.setChart(null);
      isDisposedRef.current = true;
      useChartZoomStore.getState().clearContext(drawingRuntimeContextRef.current.contextId);
      visibleRangeHistoryUserInitiatedRef.current = false;
      isChartInteractionActiveRef.current = false;
      isChartUserInteractingRef.current = false;
      if (autoScrollTimer) {
        clearTimeout(autoScrollTimer);
        autoScrollTimer = null;
      }
      if (settleAutoScrollPolicyRef.current === resetAutoScrollTimer) {
        settleAutoScrollPolicyRef.current = () => undefined;
      }
      wheelSmoothing.dispose();
      interactionOwnership.dispose();
      postInteractionCoordinatorRef.current?.clear();
      if (chartInteractionOwnershipRef.current === interactionOwnership) {
        chartInteractionOwnershipRef.current = null;
      }
      clearLocalChartPointerState();
      if (clearLocalChartPointerStateRef.current === clearLocalChartPointerState) {
        clearLocalChartPointerStateRef.current = () => undefined;
      }
      if (priceBoundOverlayGeometryRepaintFrame !== null) {
        window.cancelAnimationFrame(priceBoundOverlayGeometryRepaintFrame);
        priceBoundOverlayGeometryRepaintFrame = null;
      }
      if (chartContainer) {
        chartContainer.removeEventListener('pointerdown', handlePointerInteractionStart, true);
        chartContainer.removeEventListener('lostpointercapture', handleLostPointerCapture);
        chartContainer.removeEventListener('pointerleave', interactionOwnership.notePointerLeave);
        chartContainer.removeEventListener('touchstart', handleTouchInteractionStart, true);
        chartContainer.removeEventListener('wheel', handleWheelInteractionStart, true);
        chartContainer.removeEventListener('wheel', handleWheelInteraction);
      }
      window.removeEventListener('pointermove', handleHeldChartPointerMove);
      window.removeEventListener('pointerup', handlePointerInteractionEnd, true);
      window.removeEventListener('pointercancel', handlePointerInteractionEnd, true);
      window.removeEventListener('touchend', handleTouchInteractionEnd, true);
      window.removeEventListener('touchcancel', handleTouchInteractionEnd, true);
      window.removeEventListener('blur', forceSettleLocalPointerInteraction);
      document.removeEventListener('visibilitychange', handleDocumentVisibilityChange);
      historyRequestCoordinatorRef.current.abort();
      cancelQueuedChartRender();
      chart.unsubscribeCrosshairMove(crosshairHandler);
      chart.timeScale().unsubscribeSizeChange(handleTimeScaleSizeChange);
      chart.timeScale().unsubscribeVisibleLogicalRangeChange(logicalRangeHandler);
      clearPeriodSeparators();

      // Detach this panel from the singleton before lightweight-charts is
      // disposed, so commands and drag callbacks cannot target stale refs.
      if (drawingManagerOverlayContainer) {
        drawingManager.setChart(
          null,
          null,
          symbol,
          1,
          drawingManagerOverlayContainer,
          timeframe,
          activeChartSourceId,
          drawingRuntimeContextRef.current.accountScope,
          getDrawingSeriesData,
        );
      }

      // Delay cleanup to allow any pending lightweight-charts requestAnimationFrame
      // loops to finish, preventing "Object is disposed" runtime panics.
      const chartToDispose = chartRef.current;
      if (chartToDispose) {
        (chartToDispose as ChartWithDrawingCleanup)._cleanupDrawings?.();

        setTimeout(() => {
          try {
            chartToDispose.remove();
            console.log(`[TradingChart] Chart explicitly removed inside setTimeout.`);
          } catch {
            // Ignore late disposal errors
          }
        }, 16); // 16ms = roughly 1 frame
      }

      try {
        if (squareGridHostSeriesRef.current && squareGridPrimitiveRef.current) {
          squareGridHostSeriesRef.current.detachPrimitive(squareGridPrimitiveRef.current);
        }
      } catch {
        // Chart disposal may already have detached the primitive.
      }

      chartRef.current = null;
      seriesRef.current = null;
      volumeRef.current = null;
      squareGridHostSeriesRef.current = null;
      squareGridPrimitiveRef.current = null;
      priceLineRef.current = null;
      askPriceLineRef.current = null;
      lastPriceLineRef.current = null;
    };
  }, []);
};
