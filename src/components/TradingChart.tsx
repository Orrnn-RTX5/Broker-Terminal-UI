import { createChartDataSnapshot, type ChartDataSnapshot } from '../services/chartDataSnapshot';
import { DEFAULT_CHART_TIMEFRAME } from '../constants/chartDefaults';
import { useUiTranslation } from '../hooks/useUiTranslation';
import i18n from '../i18n';
/**
 * Clean MT5-Style Trading Chart
 * - Loads historical OHLC from Swagger candle endpoints
 * - WebSocket live tick updates
 * - Single price line (MT5 style)
 * - Proper candle aggregation
 */

import React, { useEffect, useLayoutEffect, useRef, useState, useCallback, useMemo, useId } from 'react';
import { createChartRuler, rulerMetrics } from '../drawing-tools/chartRuler';
import { ColorType, TickMarkType, MismatchDirection, CandlestickSeries, LineSeries, BarSeries, AreaSeries, HistogramSeries } from 'lightweight-charts';
import type { IChartApi, IPriceLine, ISeriesApi, Logical, SeriesType, Time } from 'lightweight-charts';
import { useCrosshair } from '../hooks/useCrosshair';
import { installChartCursorInteractions } from '../drawing-tools/chartCursorInteractions';
import { buildAreaPointHoverLabel, installChartAreaHover } from '../drawing-tools/chartAreaHover';
import { buildChartValuesTooltip, installChartValuesTooltip, nearestCandle } from '../drawing-tools/chartValuesTooltip';
import { chartCursorShowsCrosshair, useChartCursorStore } from '../store/useChartCursorStore';
import { useQuoteSubscription } from '../hooks/useQuoteSubscription';
import { useSymbolMarketStatus } from '../hooks/useSymbolMarketStatus';
import { useSelectedHistoryRequestOwner } from '../hooks/useSelectedHistoryRequestOwner';
import { useActiveChartRuntimeEffect } from '../hooks/useActiveChartRuntimeEffect';
import { useBrokerAccountSessionScope } from '../hooks/useBrokerAccountSessionScope';
import { useTradingChartVisibleRuntime } from '../hooks/useTradingChartVisibleRuntime';
import { createChartInteractionOwnership } from '../utils/chartInteractionOwnership';
import { createChartPostInteractionCoordinator } from '../utils/chartPostInteractionCoordinator';
import { buildChartSelectionPresentationKey, createChartSelectionPresentationGate, isChartSelectionLivePaintAllowed, releaseChartSelectionLivePaint, selectChartPresentation } from '../utils/chartSelectionPresentation';
import { canRetainPublicChartOnLogin, getChartMarketSourceIdentity } from '../utils/chartLoginTransition';
import { RTX_ADVANCED_VIEW_CHANGE_EVENT } from '../utils/advancedViewRootClasses';
import { scheduleChartThemeTransition } from '../utils/chartThemeTransition';
import { refreshLightweightChartSurface } from '../utils/lightweightChartSurface';
import { isLikelyAlwaysOpenCryptoSymbol } from '../utils/marketStatus';
import { setLiveMarketDataFrozen } from '../services/liveTickDispatcher';
import { drawingManager } from '../services/drawingManager';
import { requestChartTradeOverlayRefresh } from '../services/tradeOverlayRefreshEvents';
import { projectDrawingTimeAtLogical } from '../drawing-tools/geometry/drawingTimeProjection';
import { candleAggregationService, getTimeframeSeconds, type OHLCV, type Timeframe as AggTimeframe } from '../services/candleAggregationService';
import { useAppStore } from '../store/useAppStore';
import { isDesktopBackendTarget } from '../config/backendTarget.js';
import { commandBus } from '../services/commandBus';
import { formatChartAxisPrice, getPricePointFromDigits, resolveSymbolPriceDigits } from '../utils/chartPriceScale';
import { SquareChartGridPrimitive } from '../utils/squareChartGridPrimitive';
import { getChartGridRenderingOptions } from '../utils/chartGridOptions';
import { createChartGridTimeProjection, type ChartGridTimeProjection } from '../utils/chartGridTimeProjection';
import { getChartCandleCountdownText } from '../utils/chartCandleCountdown';
import type { PeriodSeparator } from '../utils/periodSeparators';
import { IndicatorManager, type IndicatorConfig } from '../services/indicatorManager';
import { candleCache } from '../services/candleCache';
import { createChartHistoryBackfillDiagnostics, createSelectedTimeframeHistoryCoordinator, resolveDeferredVisibleRangeHistoryAction, type ChartHistoryBackfillDiagnostics } from '../services/chartHistoryLoader';
import { getChartPriceFromQuote, createRenderedPriceReference, isPriceCompatibleWithReference, normalizeCandlesToReference, resetLiveQuoteGuardState, type RenderedPriceReference } from '../services/chartPriceGuards';
import { ChartOverlayGeometryPrimitive } from '../utils/chartOverlayGeometryPrimitive';
import { getRawQuoteSides } from '../utils/spreadMarkup';
import { getEffectiveChartColors, useChartSettingsStore } from '../store/useChartSettingsStore';
import { defaultChartObjectState, getChartObjectState, useChartObjectStateStore } from '../store/useChartObjectStateStore';
import { getTradingChartDefaultVisibleBars, getTradingChartShiftRightOffset, formatTradingChartCrosshairLabel, formatTradingChartTickLabel, getTradingChartTickMarkCharacterLength, shouldTradingChartFooterPromoteLeftEdgeDateLabel } from '../utils/chartTimeFormat';
import { getSynchronizedMarketNowMs, synchronizeMarketClock, type SynchronizedMarketClockAnchor } from '../utils/synchronizedMarketClock';
import { bindChartKeyboardScroll } from '../utils/chartKeyboardScroll';
import { isChartLegendPainted, paintChartLegend } from '../utils/chartLegend';
import { activateActiveChartSource, bindActiveChartSourceInteractions, findLargestChartCanvas, getActiveChartSource, registerActiveChartSource } from '../services/activeChartSource';
import { formatHistoryForOhlcv, getVisibleLogicalRangeForDataRender, upsertCandleIntoHistory, type LogicalRangeLike } from '../utils/candleHistory';
import { formatChartSeriesData, getAreaTrendDirection, getAreaTrendSeriesOptions, getDisplayVolume, getLeftVisibleTimeFromLogicalRange, getLivePriceOverlayColors, getLivePriceSeriesColor, getRenderedPrependedBarCount, getSeparatorPriority, getVisibleLogicalRangeAnchoredToTime, isDenseMinuteSeparatorTimeframe, isPotentialMarketClosedPlaceholderCandle, shouldRestoreProtectedHistoryForFullRender, shouldApplyVisibleRangeResetForRender, TRADING_CHART_TIME_SCALE_LIVE_SHIFT_OPTIONS } from './TradingChart.helpers';
import type { Candle, ChartType, Timeframe } from '../types/chart';
import { resolveChartIndicatorType, type AddChartIndicatorRequest } from '../features/trading-chart/model/indicatorRequest';
import { cancelBrowserIdleCallback, HISTORY_RENDER_IDLE_TIMEOUT_MS, HISTORY_VISIBLE_RANGE_SUPPRESSION_MS, mergeCandleCollections, requestBrowserIdleCallback, shouldBuildVolumeData, shouldScrollToRealtime } from '../features/trading-chart/runtime/chartRuntime';
import type { ChartDataRenderRequest } from '../features/trading-chart/runtime/chartRuntimeContracts';
import { useTradingChartLiveCandleRuntime } from '../features/trading-chart/runtime/useTradingChartLiveCandleRuntime';
import { useTradingChartInitialization } from '../features/trading-chart/runtime/useTradingChartInitialization';
import { useTradingChartReconfiguration } from '../features/trading-chart/runtime/useTradingChartReconfiguration';
import { useTradingChartPriceScaleSettings } from '../features/trading-chart/runtime/useTradingChartPriceScaleSettings';
import { useTradingChartPriceFormat } from '../features/trading-chart/runtime/useTradingChartPriceFormat';
import { useTradingChartCommands } from '../features/trading-chart/runtime/useTradingChartCommands';
import { useTradingChartDrawingCommands } from '../features/trading-chart/runtime/useTradingChartDrawingCommands';
import { useTradingChartHistoryCache } from '../features/trading-chart/runtime/useTradingChartHistoryCache';
import { useTradingChartHistoryLoading } from '../features/trading-chart/runtime/useTradingChartHistoryLoading';
import { useTradingChartContextMenuController, useTradingChartContextMenuState } from '../features/trading-chart/runtime/useTradingChartContextMenu';
import { useTradingChartViewportReset } from '../features/trading-chart/runtime/useTradingChartViewportReset';
import { TRADING_VIEW_HANDLE_SCALE, TRADING_VIEW_HANDLE_SCROLL } from '../features/trading-chart/runtime/chartInteractionOptions';
import { useTradingChartTradeRuntime, type ActiveTradeSnapshot } from '../features/trading-chart/runtime/useTradingChartTradeRuntime';
import { buildChartTheme, CHART_AXIS_FONT_FAMILY, isLightChartBackground, LIGHT_CHART_AXIS_FONT_FAMILY, MINUTE_SEPARATOR_PIXEL_DEDUP_DISTANCE, readChartAxisFontSize } from '../features/trading-chart/presentation/chartTheme';
import { TradingChartView } from '../features/trading-chart/presentation/TradingChartView';
import { useTradingChartLivePriceOverlay } from '../features/trading-chart/presentation/useTradingChartLivePriceOverlay';
import { useTradingChartLoadingPresentation } from '../features/trading-chart/presentation/useTradingChartLoadingPresentation';
import { getCurrentClosedMarketRenderCandles, getCurrentClosedMarketSessionCloseSeconds } from '../utils/currentClosedMarketTail';

export type { ChartType, Timeframe } from '../types/chart';

interface PendingChartDataRender {
  selectionKey: string;
  chartType?: ChartType;
  prependedBars: number;
  resetVisibleRange: boolean;
  suppressGlobalVisibleRangeReset: boolean;
  releaseLivePaintAfterRender: boolean;
  finishLoadingAfterRender: boolean;
  cachedBaseline: boolean;
  reason: string;
}

interface TradingChartProps {
  symbol: string;
  timeframe?: Timeframe;
  chartType?: ChartType;
  panelId?: string;
  tradeAllowed?: boolean;
  isActive?: boolean;
  /** Broker-authoritative quote precision from the authorized instrument catalog. */
  priceDigits?: number;
  /** Broker-authoritative lot constraints for this exact execution symbol. */
  minVolume?: number;
  maxVolume?: number;
  volumeStep?: number;
}

export const TradingChart = React.memo(function TradingChart({
  symbol,
  timeframe = DEFAULT_CHART_TIMEFRAME,
  chartType = 'candlestick',
  panelId,
  tradeAllowed = false,
  isActive = true,
  priceDigits,
  minVolume,
  maxVolume,
  volumeStep,
}: TradingChartProps) {
  const tr = useUiTranslation();
  const resolvedPriceDigits = resolveSymbolPriceDigits(symbol, priceDigits);
  const resolvedPricePoint = getPricePointFromDigits(resolvedPriceDigits);
  const resolvedPriceDigitsRef = useRef(resolvedPriceDigits);
  const resolvedPricePointRef = useRef(resolvedPricePoint);
  resolvedPriceDigitsRef.current = resolvedPriceDigits;
  resolvedPricePointRef.current = resolvedPricePoint;
  const authToken = useAppStore((state) => state.authToken);
  const brokerAccountSessionScope = useBrokerAccountSessionScope();
  const chartMarketSource = getChartMarketSourceIdentity();
  const previousChartLoginPresentationRef = useRef({
    sessionScope: brokerAccountSessionScope,
    marketSource: chartMarketSource,
    symbol,
    timeframe,
  });
  const retainedPublicChartSurfaceRef = useRef(false);
  const [retainedPublicChartSurface, setRetainedPublicChartSurface] = useState(false);
  const discardRetainedPublicChartSurface = useCallback(() => {
    if (!retainedPublicChartSurfaceRef.current) return;
    retainedPublicChartSurfaceRef.current = false;
    setRetainedPublicChartSurface(false);
  }, []);
  const chartSelectionPresentationKey = useMemo(
    () => buildChartSelectionPresentationKey({
      sessionScope: brokerAccountSessionScope,
      symbol,
      timeframe,
    }),
    [brokerAccountSessionScope, symbol, timeframe],
  );
  const chartSelectionPresentationRef = useRef(
    createChartSelectionPresentationGate(chartSelectionPresentationKey),
  );
  const canPaintLivePrice = useCallback(() => isChartSelectionLivePaintAllowed(
    chartSelectionPresentationRef.current, chartSelectionPresentationKey,
  ), [chartSelectionPresentationKey]);
  const visibleRuntime = useTradingChartVisibleRuntime({
    active: isActive,
    hasSymbol: Boolean(symbol),
  });
  const chartInstanceId = useId().replace(/[^a-zA-Z0-9_-]/g, '');
  const [activeTimeframe, setActiveTimeframe] = useState<Timeframe>(timeframe);
  const activeChartSourceId = useMemo(
    () => `trading-chart:${panelId || chartInstanceId}`,
    [chartInstanceId, panelId],
  );
  const localIndicatorManagerRef = useRef<IndicatorManager | null>(null);
  if (!localIndicatorManagerRef.current) {
    localIndicatorManagerRef.current = new IndicatorManager();
  }
  const localIndicatorManager = localIndicatorManagerRef.current;
  const chartObjectState = useChartObjectStateStore((state) => (
    state.byContext[activeChartSourceId] ?? defaultChartObjectState
  ));
  const indicatorStorageScope = useMemo(() => (
    [
      brokerAccountSessionScope || 'default-account',
      panelId || activeChartSourceId,
      symbol.trim().toUpperCase() || 'UNKNOWN',
      activeTimeframe,
    ]
      .map(part => encodeURIComponent(part))
      .join(':')
  ), [activeChartSourceId, activeTimeframe, brokerAccountSessionScope, panelId, symbol]);
  const indicatorStorageScopeRef = useRef(indicatorStorageScope);
  indicatorStorageScopeRef.current = indicatorStorageScope;
  const loadedIndicatorStorageScopeRef = useRef<string | null>(null);
  const indicatorSequenceRef = useRef(0);
  const drawingAccountScope = !isDesktopBackendTarget() ? brokerAccountSessionScope : undefined;
  const chartQuoteSourceId = useMemo(() => {
    // FIX: Demand ownership retains the exact broker symbol, including suffixes.
    const normalizedSymbol = encodeURIComponent(symbol.trim().toUpperCase() || 'UNKNOWN');
    return `chart:${panelId || chartInstanceId}:${normalizedSymbol}`;
  }, [chartInstanceId, panelId, symbol]);

  const marketStatus = useSymbolMarketStatus(symbol, {
    enabled: visibleRuntime.status,
  });
  // FIX: Trading permission and market-data ingestion are separate concerns.
  // Unknown/closed trade status may disable orders, but valid broker ticks and
  // authoritative final candles must continue to repair/display chart history.
  const marketClosedForPresentation = marketStatus.status === 'closed'
    && !isLikelyAlwaysOpenCryptoSymbol(symbol);
  const liveMarketDataFrozen = false;
  // Keep quote demand even when trading is blocked. Weekend/forex-closed status
  // must not hide a live crypto chart (BTCUSD) that the feed is still streaming.
  useQuoteSubscription(symbol ? [symbol] : [], chartQuoteSourceId, { enabled: visibleRuntime.quote });

  // Debug: Log ACTUAL mount (not every re-render)
  useEffect(() => {
    console.log(`[TradingChart] MOUNTED: symbol=${symbol}, timeframe=${timeframe}`);
    return () => console.log(`[TradingChart]  UNMOUNTED: symbol=${symbol}`);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const containerRef = useRef<HTMLDivElement>(null); // Main chart refs
  const chartRef = useRef<IChartApi | null>(null);
  const timeScaleTimeframeRef = useRef(timeframe);
  timeScaleTimeframeRef.current = timeframe;
  const seriesRef = useRef<ISeriesApi<SeriesType> | null>(null);
  const volumeRef = useRef<ISeriesApi<SeriesType> | null>(null);
  const squareGridHostSeriesRef = useRef<ISeriesApi<'Line'> | null>(null);
  const squareGridPrimitiveRef = useRef<SquareChartGridPrimitive | null>(null);
  const chartGridTimeProjectionRef = useRef<ChartGridTimeProjection | null>(null);
  const priceLineRef = useRef<IPriceLine | null>(null);
  const askPriceLineRef = useRef<IPriceLine | null>(null);
  const lastPriceLineRef = useRef<IPriceLine | null>(null);
  const initialChartSettingsSnapshot = useChartSettingsStore.getState();
  const autoScrollEnabledRef = useRef(
    initialChartSettingsSnapshot.symbolProperties[symbol]?.chartAutoScroll
    ?? initialChartSettingsSnapshot.globalProperties.chartAutoScroll
  );
  // Tracks current active drawing tool — used inside event-handler closures
  const activeToolRef = useRef<string | null>(null);
  const drawingCommandTargetRef = useRef<string | null>(null);
  const drawingRuntimeContextRef = useRef({
    contextId: activeChartSourceId,
    accountScope: drawingAccountScope,
    symbol,
    timeframe: activeTimeframe,
  });
  drawingRuntimeContextRef.current = {
    contextId: activeChartSourceId,
    accountScope: drawingAccountScope,
    symbol,
    timeframe: activeTimeframe,
  };
  const overlayRef = useRef<HTMLDivElement>(null);
  const periodSeparatorsRef = useRef<PeriodSeparator[]>([]);
  const firstRenderedCandleTimeRef = useRef<number | null>(null);
  const lastRenderedCandlesRef = useRef<Candle[]>([]);
  const getDrawingSeriesData = useCallback(() => lastRenderedCandlesRef.current, []);
  const hasDisplayedHistoryRef = useRef(false);
  const protectedDisplayedHistoryRef = useRef<Candle[]>([]);
  const periodSeparatorNodesRef = useRef<HTMLDivElement[]>([]);
  const periodSeparatorRenderPendingRef = useRef(false);
  const chartExportMetadataRef = useRef({ symbol, timeframe: activeTimeframe });
  const bindDrawingManagerToChart = useCallback((): boolean => {
    const chart = chartRef.current;
    const series = seriesRef.current;
    const overlay = overlayRef.current;
    if (!chart || !series || !overlay) return false;

    const drawingContext = drawingRuntimeContextRef.current;
    drawingManager.setChart(
      chart,
      series,
      drawingContext.symbol,
      1,
      overlay,
      drawingContext.timeframe,
      drawingContext.contextId,
      drawingContext.accountScope,
      getDrawingSeriesData,
    );
    return true;
  }, [getDrawingSeriesData]);
  const isChartCommandTarget = useCallback((payload?: {
    targetContextId?: string;
    panelId?: string;
  }): boolean => {
    const explicitTargetContextId = payload?.targetContextId
      ?? (payload?.panelId ? `trading-chart:${payload.panelId}` : undefined);
    const resolvedTargetContextId = explicitTargetContextId ?? getActiveChartSource()?.id;
    return Boolean(
      resolvedTargetContextId
      && resolvedTargetContextId === drawingRuntimeContextRef.current.contextId
    );
  }, []);
  const isDrawingCommandTarget = useCallback((targetContextId?: string): boolean => (
    isChartCommandTarget({ targetContextId })
  ), [isChartCommandTarget]);
  const liveMarketDataFrozenRef = useRef(liveMarketDataFrozen);
  const marketClosedForPresentationRef = useRef(marketClosedForPresentation);
  const isActiveRef = useRef(isActive);
  isActiveRef.current = isActive;

  useEffect(() => {
    liveMarketDataFrozenRef.current = liveMarketDataFrozen;
  }, [liveMarketDataFrozen]);

  useEffect(() => {
    marketClosedForPresentationRef.current = marketClosedForPresentation;
  }, [marketClosedForPresentation]);

  useEffect(() => {
    setLiveMarketDataFrozen(activeChartSourceId, symbol, false);
    return () => {
      setLiveMarketDataFrozen(activeChartSourceId, symbol, false);
    };
  }, [activeChartSourceId, symbol]);

  const clearPeriodSeparators = useCallback(() => {
    for (const marker of periodSeparatorNodesRef.current) {
      try {
        marker.remove();
      } catch {
        // Ignore detached marker nodes.
      }
    }
    periodSeparatorNodesRef.current = [];
  }, []);

  // Custom crosshair follows the shared Cursors flyout. Cross and Dot show it.
  const cursorMode = useChartCursorStore((state) => state.mode);
  const crosshairEnabled = chartCursorShowsCrosshair(cursorMode);
  const crosshairEnabledRef = useRef(crosshairEnabled);
  crosshairEnabledRef.current = crosshairEnabled;

  useEffect(() => useChartCursorStore.subscribe((state) => {
    crosshairEnabledRef.current = chartCursorShowsCrosshair(state.mode);
  }), []);

  useEffect(() => commandBus.subscribe('TOGGLE_CROSSHAIR', (payload) => {
    if (!isChartCommandTarget(payload)) return;
    const mode = useChartCursorStore.getState().mode;
    useChartCursorStore.getState().setMode(chartCursorShowsCrosshair(mode) ? 'arrow' : 'cross');
  }), [isChartCommandTarget]);

  useEffect(() => {
    const wrapper = containerRef.current?.closest<HTMLElement>('.rtx-chart-wrapper') ?? null;
    if (!wrapper) return undefined;
    return installChartCursorInteractions(wrapper);
  }, []);
  const [brokerTimeOffsetSec, setBrokerTimeOffsetSec] = useState(0);
  const brokerTimeOffsetSecRef = useRef(0);

  useEffect(() => {
    brokerTimeOffsetSecRef.current = brokerTimeOffsetSec;
  }, [brokerTimeOffsetSec]);

  const { vertLineRef, horizLineRef, centerRef, timeLabelRef, priceLabelRef } = useCrosshair({
    chartRef,
    seriesRef,
    containerRef,
    enabled: isActive && crosshairEnabled,
    marker: cursorMode === 'dot' ? 'dot' : 'cross',
    digits: resolvedPriceDigits,
    timeframe,
    brokerOffsetSeconds: brokerTimeOffsetSec,
  });

  useEffect(() => {
    chartExportMetadataRef.current = { symbol, timeframe: activeTimeframe };
  }, [activeTimeframe, symbol]);

  const dataWindowReaderRef = useRef<() => ChartDataSnapshot | null>(() => null);
  const dataWindowHoverTimeRef = useRef<number | null>(null);

  useEffect(() => {
    const unregister = registerActiveChartSource({
      id: activeChartSourceId,
      getDataWindowData: () => dataWindowReaderRef.current(),
      getContainer: () => containerRef.current,
      getCanvas: () => findLargestChartCanvas(containerRef.current),
      getSymbol: () => chartExportMetadataRef.current.symbol,
      getTimeframe: () => chartExportMetadataRef.current.timeframe,
      getDateRange: () => {
        const range = chartRef.current?.timeScale().getVisibleRange();
        if (!range) return undefined;
        const toDate = (time: typeof range.from) => typeof time === 'number'
          ? new Date(time * 1000)
          : typeof time === 'string' ? new Date(time)
            : new Date(Date.UTC(time.year, time.month - 1, time.day));
        return { from: toDate(range.from), to: toDate(range.to) };
      },
    });

    const container = containerRef.current;
    const unbind = container ? bindActiveChartSourceInteractions(activeChartSourceId, container) : undefined;

    return () => {
      unbind?.();
      unregister();
    };
  }, [activeChartSourceId]);

  useEffect(() => {
    if (!isActive) return;
    activateActiveChartSource(activeChartSourceId);
  }, [activeChartSourceId, isActive]);

  const ohlcOpenRef = useRef<HTMLSpanElement>(null);
  const ohlcHighRef = useRef<HTMLSpanElement>(null);
  const ohlcLowRef = useRef<HTMLSpanElement>(null);
  const ohlcCloseRef = useRef<HTMLSpanElement>(null);
  const ohlcVolumeRef = useRef<HTMLSpanElement>(null);
  const legendRefs = useMemo(() => ({
    open: ohlcOpenRef, high: ohlcHighRef, low: ohlcLowRef,
    close: ohlcCloseRef, volume: ohlcVolumeRef,
  }), []);
  const legendRenderFrameRef = useRef<number | null>(null);
  const pendingLegendRenderRef = useRef<{
    signature: string;
    open: string;
    high: string;
    low: string;
    close: string;
    volume: string;
  } | null>(null);
  const renderedLegendSignatureRef = useRef<string | null>(null);

  const updateLegendDOM = useCallback((o: number, h: number, l: number, c: number, v: number) => {
    const digits = resolvedPriceDigitsRef.current;
    const pending = {
      open: o.toFixed(digits),
      high: h.toFixed(digits),
      low: l.toFixed(digits),
      close: c.toFixed(digits),
      volume: Math.round(v).toLocaleString(),
      signature: '',
    };
    pending.signature = `${pending.open}|${pending.high}|${pending.low}|${pending.close}|${pending.volume}`;
    pendingLegendRenderRef.current = pending;

    // Crosshair and live-tick callbacks can both request the same legend during
    // a single browser frame. Paint only the latest values, and do no DOM work
    // when those formatted strings are already visible.
    if (legendRenderFrameRef.current !== null) return;
    if (renderedLegendSignatureRef.current === pending.signature && isChartLegendPainted(legendRefs, pending)) {
      pendingLegendRenderRef.current = null;
      return;
    }

    const flushLegendDOM = () => {
      legendRenderFrameRef.current = null;
      const next = pendingLegendRenderRef.current;
      pendingLegendRenderRef.current = null;
      if (!next || (renderedLegendSignatureRef.current === next.signature && isChartLegendPainted(legendRefs, next))) return;

      // Hidden/unmounted labels must never be recorded as successfully painted.
      if (paintChartLegend(legendRefs, next)) renderedLegendSignatureRef.current = next.signature;
    };

    if (typeof window === 'undefined') {
      flushLegendDOM();
      return;
    }
    legendRenderFrameRef.current = window.requestAnimationFrame(flushLegendDOM);
  }, [legendRefs]);

  useEffect(() => {
    renderedLegendSignatureRef.current = null;
    return () => {
      if (typeof window !== 'undefined' && legendRenderFrameRef.current !== null) {
        window.cancelAnimationFrame(legendRenderFrameRef.current);
      }
      legendRenderFrameRef.current = null;
      pendingLegendRenderRef.current = null;
      renderedLegendSignatureRef.current = null;
    };
  }, [resolvedPriceDigits, symbol]);

  const {
    loadingMessageIdx, loadingMessages, loadingPhase, markCandlesReady,
    setApiError, setLoadingPhase,
  } = useTradingChartLoadingPresentation({
    activeTimeframe, intervalEnabled: visibleRuntime.interval, isActive, symbol,
  });
  const [showOneClick, setShowOneClick] = useState(
    initialChartSettingsSnapshot.symbolProperties[symbol]?.showQuickTradingButtons
    ?? initialChartSettingsSnapshot.globalProperties.showQuickTradingButtons,
  );
  // Inline text-input overlay for the text drawing tool (replaces browser prompt)
  const [textInputOverlay, setTextInputOverlay] = useState<{ x: number; y: number; time: number; price: number } | null>(null);
  const [textInputValue, setTextInputValue] = useState('');

  const [currentIndicators, setCurrentIndicators] = useState<IndicatorConfig[]>([]);
  const {
    ctxAutoScroll,
    ctxChartShift,
    ctxMenu,
    ctxShowTradeHistory,
    ctxShowTradeHistoryLine,
    ctxShowTradeLevels,
    localChartType,
    setCtxAutoScroll,
    setCtxChartShift,
    setCtxMenu,
    setCtxShowTradeHistory,
    setCtxShowTradeHistoryLine,
    setCtxShowTradeLevels,
    setLocalChartType,
    setTemplateDialogMode,
    setTemplateDialogOpen,
    templateDialogMode,
    templateDialogOpen,
  } = useTradingChartContextMenuState(symbol, chartType);

  const toggleOneClickTrading = useCallback(() => {
    setShowOneClick((current) => {
      const visible = !current;
      useChartSettingsStore.getState().updateSymbolProperty(symbol, 'showQuickTradingButtons', visible);
      return visible;
    });
  }, [symbol]);

  const [candlesLoadedRev, setCandlesLoadedRev] = useState(0);
  const candlesRef = useRef<Candle[]>([]);
  const currentCandleRef = useRef<Candle | null>(null);
  dataWindowReaderRef.current = () => {
    const hoverTime = dataWindowHoverTimeRef.current;
    const candle = hoverTime === null ? (currentCandleRef.current ?? candlesRef.current.at(-1) ?? null) :
      candlesRef.current.find(item => item.time === hoverTime) ?? currentCandleRef.current;
    return createChartDataSnapshot(candle, symbol, activeTimeframe, resolvedPriceDigitsRef.current, brokerTimeOffsetSecRef.current);
  };
  useEffect(() => { dataWindowHoverTimeRef.current = null; }, [symbol, activeTimeframe, brokerAccountSessionScope]);
  useEffect(() => {
    const wrapper = containerRef.current?.closest<HTMLElement>('.rtx-chart-wrapper') ?? null;
    if (!wrapper) return undefined;
    return installChartValuesTooltip(wrapper, (point) => buildChartValuesTooltip({
      symbol,
      timeframe: activeTimeframe,
      digits: resolvedPriceDigitsRef.current,
      offsetSeconds: brokerTimeOffsetSecRef.current,
      candles: candlesRef.current,
      clientX: point.clientX,
      chartLeft: containerRef.current?.getBoundingClientRect().left ?? point.clientX,
      coordinateToTime: (x) => {
        const time = chartRef.current?.timeScale().coordinateToTime(x);
        return typeof time === 'number' ? time : null;
      },
      indicatorRows: (time) => localIndicatorManager.getReadoutAt(time),
    }));
  }, [activeTimeframe, localIndicatorManager, symbol]);

  const liveCandleMutationGenerationRef = useRef(0);
  const liveCandleMutationGenerationByTimeRef = useRef(new Map<number, number>());
  const prevPriceRef = useRef<number | null>(null);
  const synchronizedMarketClockRef = useRef<SynchronizedMarketClockAnchor | null>(null);
  const isDisposedRef = useRef(false);
  const isRebuildingRef = useRef(false);
  // Tracks the last completed M1 candle time (seconds) received from the server store.
  // Shared between the 100ms poll interval and loadHistory so both stay in sync.
  const lastStoreCandleSecRef = useRef(0);
  const resetVisibleRangeOnNextDataRef = useRef(true);
  const lastVisibleLogicalRangeRef = useRef<LogicalRangeLike | null>(null);
  const isLoadingMoreRef = useRef(false);
  const hasReachedBeginningRef = useRef(false);
  const historyBackfillDiagnosticsRef = useRef<ChartHistoryBackfillDiagnostics>(
    createChartHistoryBackfillDiagnostics()
  );
  const ctxChartShiftRef = useRef(ctxChartShift);
  const latestCandleJumpPendingRef = useRef(false);

  const refreshCurrentIndicators = useCallback(() => {
    const indicators = localIndicatorManager.getIndicators().map(indicator => ({
      ...indicator,
      parameters: { ...indicator.parameters },
    }));
    setCurrentIndicators(indicators);
    window.dispatchEvent(new CustomEvent('indicators:changed', {
      detail: { contextId: activeChartSourceId, count: indicators.length },
    }));
  }, [activeChartSourceId, localIndicatorManager]);

  const persistCurrentIndicators = useCallback(() => {
    localIndicatorManager.saveToStorage(
      loadedIndicatorStorageScopeRef.current ?? indicatorStorageScopeRef.current
    );
  }, [localIndicatorManager]);

  const addLocalIndicator = useCallback((request: AddChartIndicatorRequest): boolean => {
    if (!chartRef.current) return false;

    const indicatorType = resolveChartIndicatorType(request);
    if (!indicatorType) {
      console.warn(`[TradingChart] Unsupported indicator requested: ${request.name}`);
      return false;
    }

    const parameters = { ...(request.params ?? {}) };
    if (
      (indicatorType === 'bb' || indicatorType === 'bollinger')
      && parameters.stdDev === undefined
      && parameters.deviation !== undefined
    ) {
      parameters.stdDev = parameters.deviation;
    }

    const existingIds = new Set(localIndicatorManager.getIndicators().map(indicator => indicator.id));
    const requestedId = request.id?.trim() || `${indicatorType}-${Date.now()}`;
    let id = requestedId;
    while (existingIds.has(id)) {
      indicatorSequenceRef.current += 1;
      id = `${requestedId}-${indicatorSequenceRef.current}`;
    }

    localIndicatorManager.addIndicator({
      id,
      name: request.name,
      type: indicatorType,
      parameters,
      visible: true,
      color: typeof parameters.color === 'string' ? parameters.color : undefined,
    });
    refreshCurrentIndicators();
    persistCurrentIndicators();
    return true;
  }, [localIndicatorManager, persistCurrentIndicators, refreshCurrentIndicators]);

  const clearLocalIndicators = useCallback(() => {
    localIndicatorManager.clearAll();
    refreshCurrentIndicators();
    persistCurrentIndicators();
  }, [localIndicatorManager, persistCurrentIndicators, refreshCurrentIndicators]);

  useEffect(() => {
    localIndicatorManager.setHidden(chartObjectState.indicatorsHidden);
  }, [chartObjectState.indicatorsHidden, localIndicatorManager]);

  useEffect(() => {
    drawingManager.setDrawingsVisible(activeChartSourceId, !chartObjectState.drawingsHidden);
  }, [activeChartSourceId, chartObjectState.drawingsHidden]);

  useEffect(() => drawingManager.registerMagnetSnapSource(
    activeChartSourceId,
    (time) => localIndicatorManager.getSnapValuesAt(time),
  ), [activeChartSourceId, localIndicatorManager]);

  // Broker/source time remains authoritative across timeframe changes. A symbol
  // switch must wait for that instrument's own first source timestamp before
  // wall-clock-independent candle reconciliation can begin.
  useEffect(() => {
    synchronizedMarketClockRef.current = null;
  }, [symbol]);

  const getSynchronizedChartMarketNowMs = useCallback((): number => {
    const monotonicNowMs = typeof performance !== 'undefined'
      ? performance.now()
      : Number.NaN;
    return getSynchronizedMarketNowMs(
      synchronizedMarketClockRef.current,
      Date.now(),
      monotonicNowMs,
    );
  }, []);

  const synchronizeChartMarketClock = useCallback((sourceTimestamp: unknown): void => {
    const numericSourceTimestamp = Number(sourceTimestamp);
    if (!Number.isFinite(numericSourceTimestamp) || numericSourceTimestamp <= 0) return;
    const monotonicNowMs = typeof performance !== 'undefined'
      ? performance.now()
      : Number.NaN;
    synchronizedMarketClockRef.current = synchronizeMarketClock(
      synchronizedMarketClockRef.current,
      numericSourceTimestamp,
      monotonicNowMs,
    );
  }, []);

  useEffect(() => {
    if (marketStatus.serverTimeMs) {
      synchronizeChartMarketClock(marketStatus.serverTimeMs);
    }
  }, [marketStatus.serverTimeMs, symbol, synchronizeChartMarketClock]);

  const chartSettings = useChartSettingsStore(state =>
    state.symbolProperties[symbol] || state.globalProperties
  );
  const chartSettingsRef = useRef(chartSettings);
  const {
    applyLivePriceHorizontalGeometry,
    areaTrendDirectionRef,
    getLivePriceDirectionalColor,
    hideLivePriceOverlay,
    lastLivePriceDirectionalColorRef,
    livePriceBadgeRef,
    livePriceColorPaletteRef,
    livePriceCountdownRef,
    livePriceLineRef,
    livePriceOverlayColorsRef,
    livePriceRef,
    livePriceValueRef,
    repaintLivePriceOverlayFromCurrentPrice,
    syncSupplementalPriceLines,
    useEnterpriseLightPricePaletteRef,
  } = useTradingChartLivePriceOverlay({
    askPriceLineRef,
    canPaintLivePrice,
    chartSettingsRef,
    chartType,
    currentCandleRef,
    isDisposedRef,
    lastPriceLineRef,
    resolvedPriceDigitsRef,
    seriesRef,
  });
  const repaintTradeOverlayGeometryRef = useRef<() => void>(() => undefined);
  const leftVisibleTimeRef = useRef<number | null>(null);
  const lastAcceptedQuoteRef = useRef<number | null>(null);
  const incompatibleQuoteCountRef = useRef(0);
  const renderedPriceReferenceRef = useRef<RenderedPriceReference>(createRenderedPriceReference([]));
  const pendingChartRenderRef = useRef<PendingChartDataRender | null>(null);
  const chartRenderFrameRef = useRef<number | null>(null);
  const chartRenderIdleRef = useRef<number | null>(null);
  const drawingRenderFrameRef = useRef<number | null>(null);
  const drawingRenderSettledFrameRef = useRef<number | null>(null);
  const visibleRangeHistoryLoadSuppressedUntilRef = useRef(0);
  const visibleRangeHistoryUserInitiatedRef = useRef(false);
  const isChartInteractionActiveRef = useRef(false);
  const isChartUserInteractingRef = useRef(false);
  const chartInteractionOwnershipRef = useRef<ReturnType<typeof createChartInteractionOwnership> | null>(null);
  const settleAutoScrollPolicyRef = useRef<() => void>(() => undefined);
  const clearLocalChartPointerStateRef = useRef<() => void>(() => undefined);
  const postInteractionCallbacksRef = useRef({
    consumeHistory: () => undefined,
    prepareLiveModel: () => undefined,
    paintModel: (): boolean => false,
    paintLive: (() => undefined) as (fullModelPainted: boolean) => void,
    paintSeparators: () => undefined,
    layoutOverlay: () => undefined,
  });
  const postInteractionCoordinatorRef = useRef<ReturnType<typeof createChartPostInteractionCoordinator> | null>(null);
  if (postInteractionCoordinatorRef.current === null) {
    postInteractionCoordinatorRef.current = createChartPostInteractionCoordinator({
      consumeHistory: () => postInteractionCallbacksRef.current.consumeHistory(),
      prepareLiveModel: () => postInteractionCallbacksRef.current.prepareLiveModel(),
      paintModel: () => postInteractionCallbacksRef.current.paintModel(),
      paintLive: fullModelPainted => postInteractionCallbacksRef.current.paintLive(fullModelPainted),
      paintSeparators: () => postInteractionCallbacksRef.current.paintSeparators(),
      layoutOverlay: () => postInteractionCallbacksRef.current.layoutOverlay(),
    });
  }

  const forceSettleInteraction = useCallback(() => {
    isChartUserInteractingRef.current = false;
    chartInteractionOwnershipRef.current?.forceSettle();
    isChartInteractionActiveRef.current = false;
    // The installed chart policy always cancels an old timer and only rearms
    // when this chart is still active, visible, and eligible for auto-scroll.
    settleAutoScrollPolicyRef.current();
  }, []);

  const resetLiveQuotePriceGuard = useCallback(() => {
    const reset = resetLiveQuoteGuardState();
    lastAcceptedQuoteRef.current = reset.lastAcceptedQuote;
    incompatibleQuoteCountRef.current = reset.incompatibleQuoteCount;
  }, []);

  const mergeCandleIntoRef = useCallback((incoming: Candle) => {
    candlesRef.current = upsertCandleIntoHistory(candlesRef.current, incoming).candles;
  }, []);

  const {
    applyInitialVisibleLogicalRange,
    rememberVisibleLogicalRange,
  } = useTradingChartViewportReset({
    chartRef,
    chartSettingsRef,
    containerRef,
    contextId: drawingRuntimeContextRef.current.contextId,
    isDisposedRef,
    lastRenderedCandlesRef,
    lastVisibleLogicalRangeRef,
    seriesRef,
    timeframe,
  });

  const refreshTradeOverlayGeometry = useCallback(() => {
    requestChartTradeOverlayRefresh(drawingRuntimeContextRef.current.contextId, 'geometry');
  }, []);

  const refreshVisibleChartLayout = useCallback((forceRepaint = false) => {
    if (isDisposedRef.current) return;

    const chart = chartRef.current;
    const container = containerRef.current;
    if (chart && container) {
      const { offsetWidth, offsetHeight } = container;
      if (offsetWidth > 0 && offsetHeight > 0) {
        refreshLightweightChartSurface(chart, offsetWidth, offsetHeight, { forceRepaint });
      }
    }

    refreshTradeOverlayGeometry();
  }, [refreshTradeOverlayGeometry]);

  const resetEmptyHistoryState = useCallback((activeTf: Timeframe) => {
    candlesRef.current = [];
    currentCandleRef.current = null;
    prevPriceRef.current = null;
    resetVisibleRangeOnNextDataRef.current = true;
    hideLivePriceOverlay();
    leftVisibleTimeRef.current = null;
    lastVisibleLogicalRangeRef.current = null;
    hasReachedBeginningRef.current = false;
    isLoadingMoreRef.current = false;
    lastStoreCandleSecRef.current = 0;
    periodSeparatorsRef.current = [];
    firstRenderedCandleTimeRef.current = null;
    lastRenderedCandlesRef.current = [];
    hasDisplayedHistoryRef.current = false;
    protectedDisplayedHistoryRef.current = [];
    clearPeriodSeparators();
    resetLiveQuotePriceGuard();
    renderedPriceReferenceRef.current = createRenderedPriceReference([]);
    candleAggregationService.loadHistoricalCandles(
      symbol,
      activeTf as AggTimeframe,
      [],
      brokerTimeOffsetSecRef.current,
    );
  }, [clearPeriodSeparators, hideLivePriceOverlay, resetLiveQuotePriceGuard, symbol]);

  // Infinite scroll tracking
  const loadMoreHistoryRef = useRef<(() => Promise<void>) | null>(null);
  const historyRequestCoordinatorRef = useRef(createSelectedTimeframeHistoryCoordinator());
  const initialHistoryLoadSequenceRef = useRef(0);
  const initialHistoryLoadPendingRef = useRef(true);
  const loadedHistorySessionScopeRef = useRef(brokerAccountSessionScope);
  // Exposes scheduleBoundaryTimer from inside the live-tick effect so loadHistory
  // can kick it as soon as currentCandleRef is populated (they run in parallel).
  const scheduleBoundaryTimerRef = useRef<(() => void) | null>(null);
  useEffect(() => {
    chartSettingsRef.current = chartSettings;
    setCtxShowTradeLevels(chartSettings.showTradeLevels);
    setCtxShowTradeHistory(chartSettings.showTradeHistoryArrows);
    setCtxShowTradeHistoryLine(chartSettings.showTradeHistory);
    setShowOneClick(chartSettings.showQuickTradingButtons);
  }, [chartSettings, setCtxShowTradeHistory, setCtxShowTradeHistoryLine, setCtxShowTradeLevels]);

  useEffect(() => {
    if (!chartSettings.showAskPriceLine) {
      try {
        askPriceLineRef.current?.applyOptions({ lineVisible: false, axisLabelVisible: false });
      } catch {
        askPriceLineRef.current = null;
      }
    }
    if (!chartSettings.showLastPriceLine) {
      try {
        lastPriceLineRef.current?.applyOptions({ lineVisible: false, axisLabelVisible: false });
      } catch {
        lastPriceLineRef.current = null;
      }
    }

    if (!chartSettings.showBidPriceLine) {
      hideLivePriceOverlay(false);
    } else if (currentCandleRef.current) {
      repaintLivePriceOverlayFromCurrentPrice(currentCandleRef.current);
    }
  }, [
    chartSettings.showAskPriceLine,
    chartSettings.showBidPriceLine,
    chartSettings.showLastPriceLine,
    hideLivePriceOverlay,
    repaintLivePriceOverlayFromCurrentPrice,
  ]);

  const [isAdvancedUntitledLight, setIsAdvancedUntitledLight] = useState(() => {
    if (typeof document === 'undefined') return false;
    const root = document.documentElement;
    return root.classList.contains('rtx-advanced-view') && root.classList.contains('rtx-skin-untitled-light');
  });

  const [chartAxisFontSize, setChartAxisFontSize] = useState(readChartAxisFontSize);

  useLayoutEffect(() => {
    const root = document.documentElement;
    const syncSkinState = () => {
      setChartAxisFontSize(readChartAxisFontSize());
      setIsAdvancedUntitledLight(
        root.classList.contains('rtx-advanced-view') && root.classList.contains('rtx-skin-untitled-light')
      );
    };
    const handleAdvancedViewChange = (event: Event) => {
      const detail = (event as CustomEvent<{ isAdvancedUntitledLight?: boolean }>).detail;
      if (typeof detail?.isAdvancedUntitledLight === 'boolean') {
        setIsAdvancedUntitledLight(detail.isAdvancedUntitledLight);
        setChartAxisFontSize(readChartAxisFontSize());
        return;
      }
      syncSkinState();
    };
    syncSkinState();
    const observer = new MutationObserver(syncSkinState);
    observer.observe(root, { attributes: true, attributeFilter: ['class', 'style'] });
    window.addEventListener(RTX_ADVANCED_VIEW_CHANGE_EVENT, handleAdvancedViewChange);
    return () => {
      observer.disconnect();
      window.removeEventListener(RTX_ADVANCED_VIEW_CHANGE_EVENT, handleAdvancedViewChange);
    };
  }, []);

  useEffect(() => {
    if (!chartSettings.showOHLC || !currentCandleRef.current) return;
    const candle = currentCandleRef.current;
    updateLegendDOM(
      candle.open,
      candle.high,
      candle.low,
      candle.close,
      getDisplayVolume(candle, chartSettings),
    );
  }, [chartSettings, updateLegendDOM, isAdvancedUntitledLight]);

  const chartColors = useMemo(
    () => getEffectiveChartColors(chartSettings, { isAdvancedUntitledLight }),
    [chartSettings, isAdvancedUntitledLight],
  );
  const useEnterpriseLightChartPalette = isAdvancedUntitledLight
    && chartSettings.colorScheme !== 'Custom' && chartSettings.colorScheme !== 'Green and White';
  useEnterpriseLightPricePaletteRef.current = useEnterpriseLightChartPalette;
  const initialLivePriceOverlayColors = useMemo(
    () => getLivePriceOverlayColors(
      chartColors,
      chartSettings.colorScheme === 'Green and White' ? chartColors.bidPriceLine : getLivePriceSeriesColor(chartColors, chartType, 'up'),
      useEnterpriseLightChartPalette,
    ),
    [chartColors, chartSettings.colorScheme, chartType, useEnterpriseLightChartPalette],
  );
  const chartTheme = useMemo(
    () => buildChartTheme(chartColors, chartSettings.showGrid, useEnterpriseLightChartPalette, chartSettings.gridLineStyle, chartSettings.gridType, chartSettings.colorScheme),
    [chartColors, chartSettings.showGrid, chartSettings.gridLineStyle, chartSettings.gridType, chartSettings.colorScheme, useEnterpriseLightChartPalette],
  );
  const chartThemeRef = useRef(chartTheme);
  const previousAdvancedUntitledLightRef = useRef(isAdvancedUntitledLight);

  useEffect(() => {
    livePriceColorPaletteRef.current = chartColors;
    lastLivePriceDirectionalColorRef.current = getLivePriceSeriesColor(chartColors, chartType, 'up');
    const overlayColors = getLivePriceOverlayColors(chartColors, getLivePriceDirectionalColor(), useEnterpriseLightChartPalette);
    livePriceOverlayColorsRef.current = overlayColors;
    if (livePriceLineRef.current) {
      livePriceLineRef.current.style.borderTopColor = overlayColors.lineColor;
    }
    if (livePriceBadgeRef.current) {
      livePriceBadgeRef.current.style.background = overlayColors.badgeBackground;
      livePriceBadgeRef.current.style.color = overlayColors.badgeTextColor;
    }
  }, [
    chartColors,
    chartType,
    getLivePriceDirectionalColor,
    lastLivePriceDirectionalColorRef,
    livePriceBadgeRef,
    livePriceColorPaletteRef,
    livePriceLineRef,
    livePriceOverlayColorsRef,
    useEnterpriseLightChartPalette,
  ]);

  useLayoutEffect(() => {
    chartThemeRef.current = chartTheme;
  }, [chartTheme]);

  useEffect(() => {
    const wrapper = containerRef.current?.closest<HTMLElement>('.rtx-chart-wrapper') ?? null;
    if (!wrapper) return undefined;
    return installChartAreaHover(wrapper, ({ clientX, clientY }) => {
      if ((prevChartTypeRef.current || chartType) !== 'area') return null;
      if (wrapper.dataset.trendDrawingActive === 'true') return null;
      const chart = chartRef.current;
      const series = seriesRef.current;
      const container = containerRef.current;
      if (!chart || !series || !container) return null;

      const chartRect = container.getBoundingClientRect();
      const localX = clientX - chartRect.left;
      const localY = clientY - chartRect.top;
      const priceScaleWidth = series.priceScale().width();
      const timeScaleHeight = chart.timeScale().height();
      const plotHeight = Math.max(0, chartRect.height - timeScaleHeight);
      if (localX < 0 || localX > chartRect.width - priceScaleWidth || localY < 0 || localY > plotHeight) return null;
      const time = chart.timeScale().coordinateToTime(localX);
      if (typeof time !== 'number') return null;
      const candle = nearestCandle(candlesRef.current, time);
      if (!candle) return null;
      const barX = chart.timeScale().timeToCoordinate(candle.time as Time);
      const barY = series.priceToCoordinate(candle.close);
      if (barX === null || barY === null) return null;

      const label = buildAreaPointHoverLabel(
        candle.time,
        candle.close,
        resolvedPriceDigitsRef.current,
        prevTimeframeRef.current || activeTimeframe,
        brokerTimeOffsetSecRef.current,
        i18n.resolvedLanguage || 'en',
      );
      if (!label) return null;

      const wrapperRect = wrapper.getBoundingClientRect();
      const originLeft = chartRect.left - wrapperRect.left;
      const originTop = chartRect.top - wrapperRect.top;
      const theme = chartThemeRef.current;
      const direction = areaTrendDirectionRef.current ?? 'up';
      return {
        ...label,
        x: originLeft + barX,
        y: originTop + barY,
        color: direction === 'down' ? theme.areaDownLine : theme.areaUpLine,
        plotTop: originTop,
        plotBottom: originTop + plotHeight,
        plotLeft: originLeft,
        plotRight: originLeft + Math.max(0, chartRect.width - priceScaleWidth),
      };
    });
  }, [activeTimeframe, chartType]);

  const isChartSurfaceLight = useCallback(() => (
    isLightChartBackground(chartThemeRef.current.background)
  ), []);

  const renderPeriodSeparators = useCallback(() => {
    clearPeriodSeparators();

    if (isDisposedRef.current || !chartRef.current || !overlayRef.current) return;
    if (!chartSettingsRef.current.showPeriodSeparators) return;

    const separators = periodSeparatorsRef.current;
    if (separators.length === 0) return;

    const chart = chartRef.current;
    const timeScale = chart.timeScale();
    const chartWidth = containerRef.current?.offsetWidth ?? overlayRef.current.offsetWidth;
    const color = isChartSurfaceLight()
      ? 'rgba(71, 84, 103, 0.26)'
      : 'rgba(226, 232, 240, 0.30)';

    const resolveSeparatorCoordinate = (separator: PeriodSeparator): number | null => {
      const directCoordinate = timeScale.timeToCoordinate(separator.time as Time);
      if (directCoordinate != null && Number.isFinite(directCoordinate)) return directCoordinate;

      const activeTf = prevTimeframeRef.current || timeframe;
      const timeframeSeconds = getTimeframeSeconds(activeTf as AggTimeframe);
      const maxDistanceSeconds = Number.isFinite(timeframeSeconds) && timeframeSeconds > 0
        ? timeframeSeconds * 1.5
        : Number.POSITIVE_INFINITY;
      let nearest: Candle | null = null;
      let nearestDistance = Number.POSITIVE_INFINITY;

      for (const candle of candlesRef.current) {
        const distance = Math.abs(candle.time - separator.time);
        if (distance < nearestDistance) {
          nearest = candle;
          nearestDistance = distance;
        }
      }

      if (!nearest || nearestDistance > maxDistanceSeconds) return null;
      const fallbackCoordinate = chart.timeScale().timeToCoordinate(nearest.time as Time);
      return fallbackCoordinate != null && Number.isFinite(fallbackCoordinate)
        ? fallbackCoordinate
        : null;
    };

    const rawRenderCandidates: Array<{ separator: PeriodSeparator; x: number }> = [];
    separators.forEach(separator => {
      const x = resolveSeparatorCoordinate(separator);
      if (x == null || !Number.isFinite(x) || x < -2 || x > chartWidth + 2) return;
      rawRenderCandidates.push({ separator, x });
    });

    const activeTf = prevTimeframeRef.current || timeframe;
    const renderCandidates = isDenseMinuteSeparatorTimeframe(activeTf)
      ? rawRenderCandidates
        .sort((left, right) => left.x - right.x)
        .reduce<Array<{ separator: PeriodSeparator; x: number }>>((deduped, candidate) => {
          const previous = deduped[deduped.length - 1];
          if (!previous || Math.abs(candidate.x - previous.x) > MINUTE_SEPARATOR_PIXEL_DEDUP_DISTANCE) {
            deduped.push(candidate);
            return deduped;
          }

          const candidatePriority = getSeparatorPriority(candidate.separator);
          const previousPriority = getSeparatorPriority(previous.separator);
          if (
            candidatePriority > previousPriority ||
            (candidatePriority === previousPriority && candidate.separator.time > previous.separator.time)
          ) {
            deduped[deduped.length - 1] = candidate;
          }
          return deduped;
        }, [])
      : rawRenderCandidates;

    renderCandidates.forEach(({ separator, x }) => {

      const marker = document.createElement('div');
      marker.className = `rtx-period-separator rtx-period-separator--${separator.type}`;
      marker.title = `Period separator: ${separator.type.replace('_', ' ')}`;
      marker.setAttribute('aria-hidden', 'true');
      marker.dataset.separatorTime = String(separator.time);
      marker.dataset.separatorType = separator.type;
      marker.style.cssText = `
        position: absolute;
        top: 0;
        bottom: 0;
        left: ${Math.round(x)}px;
        width: 1px;
        background-image: repeating-linear-gradient(to bottom, ${color} 0 2px, transparent 2px 6px);
        background-repeat: repeat-y;
        opacity: 1;
        z-index: 25;
        pointer-events: none;
        transform: translateX(-0.5px);
      `;

      overlayRef.current?.appendChild(marker);
      periodSeparatorNodesRef.current.push(marker);
    });
  }, [clearPeriodSeparators, isChartSurfaceLight]);

  postInteractionCallbacksRef.current.paintSeparators = renderPeriodSeparators;

  const schedulePeriodSeparatorRender = useCallback(() => {
    if (typeof window === 'undefined') {
      renderPeriodSeparators();
      return;
    }

    if (isChartInteractionActiveRef.current) {
      postInteractionCoordinatorRef.current?.request({ separators: true });
      return;
    }

    if (periodSeparatorRenderPendingRef.current) return;
    periodSeparatorRenderPendingRef.current = true;

    window.requestAnimationFrame(() => {
      periodSeparatorRenderPendingRef.current = false;
      renderPeriodSeparators();
      window.requestAnimationFrame(renderPeriodSeparators);
      window.setTimeout(renderPeriodSeparators, 80);
    });
  }, [renderPeriodSeparators]);

  useEffect(() => {
    if (chartSettings.showPeriodSeparators) {
      schedulePeriodSeparatorRender();
      return;
    }
    clearPeriodSeparators();
  }, [chartSettings.showPeriodSeparators, clearPeriodSeparators, schedulePeriodSeparatorRender]);

  const isPotentialMarketClosedPlaceholder = useCallback((candle: Candle): boolean => {
    return isPotentialMarketClosedPlaceholderCandle(candle, {
      symbol: prevSymbolRef.current || symbol,
      timeframe: prevTimeframeRef.current || timeframe,
      brokerOffsetSeconds: brokerTimeOffsetSecRef.current,
    });
  }, [symbol, timeframe]);

  const getClosedMarketRenderCandles = useCallback((candles: Candle[]): Candle[] => {
    return getCurrentClosedMarketRenderCandles(candles, {
      // FIX: Closed-session presentation may hide placeholders without freezing
      // incoming backend corrections or pre/after-market quote data.
      isMarketClosed: marketClosedForPresentationRef.current,
      sessionCloseTimeMs: marketStatus.sessionCloseTimeMs,
    });
  }, [marketStatus.sessionCloseTimeMs]);

  const getLatestRenderableCandle = useCallback((candles: Candle[]): Candle | null => {
    const renderCandles = getClosedMarketRenderCandles(candles);
    return renderCandles[renderCandles.length - 1] ?? null;
  }, [getClosedMarketRenderCandles]);

  const normalizeChartTimeToUnixSeconds = useCallback((time: Time): number | null => {
    if (typeof time === 'number') {
      return time;
    }

    if (typeof time === 'string') {
      const businessDayMatch = /^(\d{4})-(\d{2})-(\d{2})$/.exec(time);
      if (businessDayMatch) {
        const [, year, month, day] = businessDayMatch;
        return Math.floor(Date.UTC(Number(year), Number(month) - 1, Number(day)) / 1000);
      }

      const parsed = new Date(time);
      return Number.isNaN(parsed.getTime()) ? null : Math.floor(parsed.getTime() / 1000);
    }

    if (time && typeof time === 'object' && 'year' in time && 'month' in time && 'day' in time) {
      return Math.floor(Date.UTC(time.year, time.month - 1, time.day) / 1000);
    }

    return null;
  }, []);
  const resolveCurrentQuote = useCallback((): number | null => {
    // FIX: Never collapse punctuation-distinct instruments into one live key.
    const normalizedSymbol = symbol.trim().toUpperCase();
    const ticks = useAppStore.getState().ticks;
    const tick = ticks[symbol]
      ?? ticks[normalizedSymbol];

    // Candle-scale checks compare against the raw feed bid, never the
    // account's spread-markup widened quote.
    return getChartPriceFromQuote(getRawQuoteSides(tick));
  }, [symbol]);

  const getCachedRenderedPriceReference = useCallback((): RenderedPriceReference => {
    const current = renderedPriceReferenceRef.current;
    if (current.price !== null || candlesRef.current.length === 0) return current;

    const rebuilt = createRenderedPriceReference(candlesRef.current);
    renderedPriceReferenceRef.current = rebuilt;
    return rebuilt;
  }, []);

  const reconcileCandlesWithLiveQuote = useCallback((candles: Candle[], context: string): Candle[] => {
    const referencePrice = resolveCurrentQuote();
    const renderedReferencePrice = getCachedRenderedPriceReference().price;
    const result = referencePrice
      ? normalizeCandlesToReference(candles, referencePrice)
      : normalizeCandlesToReference(candles, renderedReferencePrice);

    if (result.status === 'incompatible') {
      const source = referencePrice
        ? `live quote ${referencePrice}`
        : renderedReferencePrice
          ? `rendered candle reference ${renderedReferencePrice}`
          : 'the backend candle sequence';
      // FIX: Broker OHLC values are authoritative. A decimal-band mismatch is
      // rejected and diagnosed instead of multiplying prices to fit another feed.
      console.warn(`[Chart] Ignoring ${symbol} ${context} candles because their exact price range is incompatible with ${source}.`);
      setApiError(`${symbol} candle range differs from ${referencePrice ? 'live quote' : 'rendered chart'}; waiting for matching ${timeframe} data.`);
    } else if (result.status === 'partial') {
      // FIX: Render every exact candle that belongs to the externally verified
      // symbol price band while rejecting contaminated rows; gaps stay visible
      // exactly as supplied instead of being filled or price-scaled locally.
      console.warn(
        `[Chart] Rejected ${result.discardedCount ?? 0} incompatible ${symbol} ${context} candle(s); `
        + `kept ${result.candles.length} exact candle(s) matching ${referencePrice ? `live quote ${referencePrice}` : `rendered candle reference ${renderedReferencePrice}`}.`,
      );
    }

    return result.candles as Candle[];
  }, [getCachedRenderedPriceReference, resolveCurrentQuote, setApiError, symbol, timeframe]);

  const isLivePriceSafeForCandles = useCallback((price: number): boolean => {
    if (candlesRef.current.length === 0) return true;
    return isPriceCompatibleWithReference(price, getCachedRenderedPriceReference());
  }, [getCachedRenderedPriceReference]);

  const syncLeftVisibleTime = useCallback(() => {
    const chart = chartRef.current;
    const renderedCandles = lastRenderedCandlesRef.current;

    if (!chart || renderedCandles.length === 0) {
      leftVisibleTimeRef.current = null;
      lastVisibleLogicalRangeRef.current = null;
      return;
    }

    const visibleRange = chart.timeScale().getVisibleLogicalRange();
    if (!visibleRange) {
      leftVisibleTimeRef.current = renderedCandles[0]?.time ?? null;
      return;
    }
    rememberVisibleLogicalRange(visibleRange as LogicalRangeLike);

    leftVisibleTimeRef.current = getLeftVisibleTimeFromLogicalRange(
      renderedCandles,
      visibleRange as LogicalRangeLike,
    );
  }, [rememberVisibleLogicalRange]);
  const formatCrosshairTime = useCallback(
    (time: Time) => formatTradingChartCrosshairLabel(time, timeframe, brokerTimeOffsetSec, i18n.resolvedLanguage || 'en'),
    [brokerTimeOffsetSec, timeframe, tr],
  );
  const formatTimeScaleTick = useCallback(
    (time: Time, tickMarkType: TickMarkType) => {
      const timeSeconds = normalizeChartTimeToUnixSeconds(time);
      const forceDateLabel = shouldTradingChartFooterPromoteLeftEdgeDateLabel(timeframe)
        && timeSeconds != null
        && leftVisibleTimeRef.current != null
        && timeSeconds === leftVisibleTimeRef.current
        && (tickMarkType === TickMarkType.Time || tickMarkType === TickMarkType.TimeWithSeconds);

      return formatTradingChartTickLabel(
        time,
        timeframe,
        tickMarkType,
        brokerTimeOffsetSec,
        { forceDateLabel, locale: i18n.resolvedLanguage || 'en' },
      );
    },
    [brokerTimeOffsetSec, normalizeChartTimeToUnixSeconds, timeframe, tr],
  );

  const suppressVisibleRangeHistoryLoad = useCallback((durationMs = HISTORY_VISIBLE_RANGE_SUPPRESSION_MS) => {
    visibleRangeHistoryLoadSuppressedUntilRef.current = Math.max(
      visibleRangeHistoryLoadSuppressedUntilRef.current,
      Date.now() + durationMs,
    );
  }, []);

  const isVisibleRangeHistoryLoadSuppressed = useCallback((): boolean => (
    Date.now() < visibleRangeHistoryLoadSuppressedUntilRef.current
  ), []);

  const cancelQueuedChartRender = useCallback(() => {
    pendingChartRenderRef.current = null;

    if (typeof window === 'undefined') return;

    if (chartRenderFrameRef.current !== null) {
      window.cancelAnimationFrame(chartRenderFrameRef.current);
      chartRenderFrameRef.current = null;
    }

    if (chartRenderIdleRef.current !== null) {
      cancelBrowserIdleCallback(chartRenderIdleRef.current);
      chartRenderIdleRef.current = null;
    }
  }, []);

  const cancelScheduledDrawingRender = useCallback(() => {
    if (typeof window === 'undefined') return;

    if (drawingRenderFrameRef.current !== null) {
      window.cancelAnimationFrame(drawingRenderFrameRef.current);
      drawingRenderFrameRef.current = null;
    }

    if (drawingRenderSettledFrameRef.current !== null) {
      window.cancelAnimationFrame(drawingRenderSettledFrameRef.current);
      drawingRenderSettledFrameRef.current = null;
    }
  }, []);

  const scheduleDrawingRenderAfterChartData = useCallback((activeSymbol: string, activeTf: Timeframe) => {
    if (typeof window === 'undefined') {
      drawingManager.renderContext(overlayRef.current);
      return;
    }

    cancelScheduledDrawingRender();
    drawingRenderFrameRef.current = window.requestAnimationFrame(() => {
      drawingRenderFrameRef.current = null;
      drawingRenderSettledFrameRef.current = window.requestAnimationFrame(() => {
        drawingRenderSettledFrameRef.current = null;
        if (isDisposedRef.current || !chartRef.current || !seriesRef.current || !overlayRef.current) return;

        drawingManager.setChart(
          chartRef.current,
          seriesRef.current,
          activeSymbol,
          1,
          overlayRef.current,
          activeTf,
          activeChartSourceId,
          drawingRuntimeContextRef.current.accountScope,
          getDrawingSeriesData,
        );
        drawingManager.renderContext(overlayRef.current);
      });
    });
  }, [cancelScheduledDrawingRender]);

  const getCandlesForFullRender = useCallback((): Candle[] => {
    const current = currentCandleRef.current;
    if (!current) return candlesRef.current;
    return upsertCandleIntoHistory(candlesRef.current, current).candles;
  }, []);

  const getLatestCandleScrollOffset = useCallback((): number => {
    const activeTf = prevTimeframeRef.current || timeframe;
    return ctxChartShiftRef.current ? getTradingChartShiftRightOffset(activeTf, true) : 0;
  }, [timeframe]);

  const scrollToLatestCandleNow = useCallback((chart: IChartApi | null = chartRef.current): void => {
    if (!chart) return;
    chart.timeScale().scrollToPosition(getLatestCandleScrollOffset(), false);
  }, [getLatestCandleScrollOffset]);

  // TradingView-style Area coloring: the line and gradient follow the change
  // over the timeframe's period (daily change on M1, five days on M5, a year
  // on D1, …) — bull color while price sits at or above that period's
  // reference close, bear color while below — instead of a fixed series color.
  const applyAreaTrendColors = useCallback((latestClose?: number) => {
    if (isDisposedRef.current) return;
    const series = seriesRef.current;
    if (!series) return;
    if ((prevChartTypeRef.current || 'candlestick') !== 'area') return;

    const direction = getAreaTrendDirection(
      lastRenderedCandlesRef.current,
      brokerTimeOffsetSecRef.current,
      latestClose ?? currentCandleRef.current?.close,
      prevTimeframeRef.current || undefined,
    );
    if (!direction || direction === areaTrendDirectionRef.current) return;
    areaTrendDirectionRef.current = direction;
    try {
      series.applyOptions(getAreaTrendSeriesOptions(chartThemeRef.current, direction));
      // History can change the period direction without another quote arriving.
      // Recolor the overlay without moving it during a chart interaction.
      const colors = livePriceColorPaletteRef.current;
      const overlayColors = getLivePriceOverlayColors(
        colors,
        getLivePriceSeriesColor(colors, 'area', direction),
        useEnterpriseLightPricePaletteRef.current,
      );
      livePriceOverlayColorsRef.current = overlayColors;
      if (livePriceLineRef.current) {
        livePriceLineRef.current.style.borderTopColor = overlayColors.lineColor;
      }
      if (livePriceBadgeRef.current) {
        livePriceBadgeRef.current.style.background = overlayColors.badgeBackground;
        livePriceBadgeRef.current.style.color = overlayColors.badgeTextColor;
      }
    } catch {
      // The series can be disposed during a rapid symbol or chart-type switch.
    }
  }, [
    areaTrendDirectionRef,
    livePriceBadgeRef,
    livePriceColorPaletteRef,
    livePriceLineRef,
    livePriceOverlayColorsRef,
    useEnterpriseLightPricePaletteRef,
  ]);

  const flushQueuedChartRender = useCallback((allowDuringInteraction = false): boolean => {
    if (
      isDisposedRef.current
      || !isActiveRef.current
      || (isChartInteractionActiveRef.current && !allowDuringInteraction)
    ) return false;

    const pending = pendingChartRenderRef.current;
    if (!pending) return false;
    if (pending.selectionKey !== chartSelectionPresentationRef.current.selectionKey) {
      pendingChartRenderRef.current = null;
      return false;
    }

    const chart = chartRef.current;
    const series = seriesRef.current;
    if (!chart || !series) return false;

    pendingChartRenderRef.current = null;

    // Keep the public guest pixels until a usable baseline for the new account
    // is ready. Fresh ticks still enter the new, cleared model.
    if (retainedPublicChartSurfaceRef.current && !pending.finishLoadingAfterRender) return false;

    const activeType = pending.chartType || prevChartTypeRef.current || 'candlestick';
    const activeTimeframe = prevTimeframeRef.current || timeframe;
    const activeSymbol = prevSymbolRef.current || symbol;
    const settings = chartSettingsRef.current;
    const includeVolumeData = shouldBuildVolumeData(settings);
    let candlesForRender = getCandlesForFullRender();
    const timeScale = chart.timeScale();
    const shouldPreserveVisibleRange = !pending.resetVisibleRange;
    const visibleRangeFromChart = shouldPreserveVisibleRange
      ? timeScale.getVisibleLogicalRange() as LogicalRangeLike | null
      : null;
    rememberVisibleLogicalRange(visibleRangeFromChart);
    const visibleRangeBeforeRender = visibleRangeFromChart ?? (
      shouldPreserveVisibleRange ? lastVisibleLogicalRangeRef.current : null
    );
    const scrollPositionBeforeRender = shouldPreserveVisibleRange
      ? timeScale.scrollPosition()
      : null;
    const liveRightOffset = getTradingChartShiftRightOffset(activeTimeframe, settings.chartShift);
    // A delayed snapshot can append many bars at once. Decide whether to keep
    // following before setData moves the live edge away from the old viewport.
    const wasFollowingRealtimeBeforeRender = shouldPreserveVisibleRange
      && pending.prependedBars === 0
      && !pending.suppressGlobalVisibleRangeReset
      && shouldScrollToRealtime(
        chart,
        autoScrollEnabledRef.current,
        settings.chartAutoScroll,
        liveRightOffset,
      );
    const previousLatestRenderedTime = lastRenderedCandlesRef.current[lastRenderedCandlesRef.current.length - 1]?.time ?? null;
    const previousFirstRenderedTime = pending.prependedBars > 0 && shouldPreserveVisibleRange
      ? firstRenderedCandleTimeRef.current
      : null;
    const leftVisibleTimeFromRenderedData = shouldPreserveVisibleRange
      ? getLeftVisibleTimeFromLogicalRange(lastRenderedCandlesRef.current, visibleRangeBeforeRender)
      : null;
    const leftVisibleTimeBeforeRender = shouldPreserveVisibleRange
      ? leftVisibleTimeFromRenderedData ?? leftVisibleTimeRef.current
      : null;
    const protectedHistory = protectedDisplayedHistoryRef.current;
    if (shouldRestoreProtectedHistoryForFullRender({
      activeTimeframe,
      incomingCount: candlesForRender.length,
      protectedCount: protectedHistory.length,
      resetVisibleRange: pending.resetVisibleRange,
      defaultVisibleBars: getTradingChartDefaultVisibleBars(activeTimeframe),
    })) {
      console.warn(
        `[Chart] Prevented ${activeSymbol} ${activeTimeframe} render from replacing protected history ` +
        `(${protectedHistory.length} bars) with a tiny ${candlesForRender.length}-bar batch for ${pending.reason}.`,
      );
      candlesForRender = mergeCandleCollections(protectedHistory, candlesForRender);
      candlesRef.current = candlesForRender;
      renderedPriceReferenceRef.current = createRenderedPriceReference(candlesForRender);
      reloadAggregationCandles(candlesForRender, activeTimeframe);
    }
    candlesForRender = getClosedMarketRenderCandles(candlesForRender);

    const { sortedCandles, seriesData, volumeData, periodSeparators } = formatChartSeriesData(
      candlesForRender,
      activeType,
      chartThemeRef.current,
      settings,
      {
        symbol: activeSymbol,
        timeframe: activeTimeframe,
        brokerOffsetSeconds: brokerTimeOffsetSecRef.current,
      },
      { includeVolumeData, assumeSortedUnique: true },
    );
    periodSeparatorsRef.current = periodSeparators;

    try {
      if (seriesData.length > 0) {
        suppressVisibleRangeHistoryLoad();
      }

      series.setData(seriesData);
      if (volumeRef.current) {
        if (includeVolumeData) {
          volumeRef.current.setData(volumeData);
        } else {
          volumeRef.current.setData([]);
        }
      }
      if (pending.finishLoadingAfterRender && seriesData.length > 0) {
        discardRetainedPublicChartSurface();
        chartSelectionPresentationRef.current = releaseChartSelectionLivePaint(
          chartSelectionPresentationRef.current,
          pending.selectionKey,
        );
        markCandlesReady();
        if (pending.cachedBaseline) setLoadingPhase('hidden');
      } else if (pending.releaseLivePaintAfterRender && seriesData.length > 0) {
        // A sparse live baseline may update behind the opaque loading surface
        // while authoritative history is still in flight. Release direct live
        // series updates after that baseline, but do not reveal the chart yet.
        chartSelectionPresentationRef.current = releaseChartSelectionLivePaint(
          chartSelectionPresentationRef.current,
          pending.selectionKey,
        );
      }
      schedulePeriodSeparatorRender();

      const totalBars = seriesData.length;
      const shouldResetVisibleRange = shouldApplyVisibleRangeResetForRender({
        resetVisibleRange: pending.resetVisibleRange,
        resetVisibleRangeOnNextData: resetVisibleRangeOnNextDataRef.current,
        suppressGlobalVisibleRangeReset: pending.suppressGlobalVisibleRangeReset,
      });
      if (totalBars > 0 && latestCandleJumpPendingRef.current && !pending.suppressGlobalVisibleRangeReset) {
        latestCandleJumpPendingRef.current = false;
        scrollToLatestCandleNow(chart);
        rememberVisibleLogicalRange(timeScale.getVisibleLogicalRange() as LogicalRangeLike | null);
      } else if (totalBars > 0 && shouldResetVisibleRange) {
        series.priceScale().applyOptions({ autoScale: true });
        resetVisibleRangeOnNextDataRef.current = !applyInitialVisibleLogicalRange(
          chart,
          totalBars,
          activeTimeframe,
        );
      } else {
        const renderedPrependedBars = getRenderedPrependedBarCount(
          sortedCandles,
          previousFirstRenderedTime,
          pending.prependedBars,
        );
        const preservedRange = getVisibleLogicalRangeForDataRender(
          visibleRangeBeforeRender,
          {
            resetVisibleRange: false,
            prependedBars: renderedPrependedBars,
          },
        );
        const timeAnchoredRange = getVisibleLogicalRangeAnchoredToTime(
          sortedCandles,
          leftVisibleTimeBeforeRender,
          visibleRangeBeforeRender,
          {
            wasFollowing: wasFollowingRealtimeBeforeRender,
            previousLatestTime: previousLatestRenderedTime,
            rightOffset: liveRightOffset,
          },
        );
        const nextVisibleRange = timeAnchoredRange ?? preservedRange;
        if (nextVisibleRange) {
          timeScale.setVisibleLogicalRange(nextVisibleRange);
          rememberVisibleLogicalRange(nextVisibleRange);
        } else if (
          !pending.suppressGlobalVisibleRangeReset &&
          scrollPositionBeforeRender !== null &&
          Number.isFinite(scrollPositionBeforeRender)
        ) {
          timeScale.scrollToPosition(scrollPositionBeforeRender, false);
          rememberVisibleLogicalRange(timeScale.getVisibleLogicalRange() as LogicalRangeLike | null);
        }
      }

      syncLeftVisibleTime();
      localIndicatorManager.setOHLCData(sortedCandles.map(c => ({
        time: c.time as Time,
        open: c.open,
        high: c.high,
        low: c.low,
        close: c.close,
        volume: c.volume
      })));
      renderedPriceReferenceRef.current = createRenderedPriceReference(candlesForRender);
      lastRenderedCandlesRef.current = sortedCandles;
      firstRenderedCandleTimeRef.current = sortedCandles[0]?.time ?? null;
      applyAreaTrendColors();
      if (seriesData.length > 1) {
        hasDisplayedHistoryRef.current = true;
        if (candlesForRender.length >= protectedDisplayedHistoryRef.current.length) {
          protectedDisplayedHistoryRef.current = candlesForRender;
        }
      }
      if (allowDuringInteraction) {
        postInteractionCoordinatorRef.current?.request({ overlay: true });
      } else {
        setCandlesLoadedRev(r => r + 1);
        scheduleDrawingRenderAfterChartData(activeSymbol, activeTimeframe);
      }
      return true;
    } catch (e) {
      console.warn(`[Chart] Error setting chart data for ${pending.reason}:`, e);
      return false;
    }
  }, [applyAreaTrendColors, applyInitialVisibleLogicalRange, discardRetainedPublicChartSurface, getCandlesForFullRender, getClosedMarketRenderCandles, markCandlesReady, rememberVisibleLogicalRange, scheduleDrawingRenderAfterChartData, schedulePeriodSeparatorRender, scrollToLatestCandleNow, setLoadingPhase, suppressVisibleRangeHistoryLoad, symbol, syncLeftVisibleTime, timeframe]);

  postInteractionCallbacksRef.current.paintModel = () => flushQueuedChartRender(true);

  const scheduleQueuedChartRenderFlush = useCallback((immediate = false) => {
    if (!pendingChartRenderRef.current) return;
    if (!immediate && isChartInteractionActiveRef.current) return;
    if (chartRenderFrameRef.current !== null) return;

    // A background/settings render can own the idle handle before history
    // arrives. Promote an urgent first paint instead of waiting for its timeout.
    if (immediate && chartRenderIdleRef.current !== null) {
      cancelBrowserIdleCallback(chartRenderIdleRef.current);
      chartRenderIdleRef.current = null;
    }
    if (chartRenderIdleRef.current !== null) return;

    const scheduleFrame = () => {
      chartRenderIdleRef.current = null;

      if (typeof window === 'undefined') {
        flushQueuedChartRender();
        return;
      }

      chartRenderFrameRef.current = window.requestAnimationFrame(() => {
        chartRenderFrameRef.current = null;
        flushQueuedChartRender();
      });
    };

    if (immediate || typeof window === 'undefined') {
      scheduleFrame();
      return;
    }

    chartRenderIdleRef.current = requestBrowserIdleCallback(
      scheduleFrame,
      HISTORY_RENDER_IDLE_TIMEOUT_MS,
    );
  }, [flushQueuedChartRender]);

  const requestChartDataRender = useCallback((request: ChartDataRenderRequest = {}) => {
    const selectionKey = chartSelectionPresentationRef.current.selectionKey;
    const pending = pendingChartRenderRef.current;
    const existing = pending?.selectionKey === selectionKey ? pending : null;
    pendingChartRenderRef.current = {
      selectionKey,
      chartType: request.chartType ?? existing?.chartType,
      prependedBars: (existing?.prependedBars ?? 0) + Math.max(0, request.prependedBars ?? 0),
      resetVisibleRange: request.resetVisibleRange === true || existing?.resetVisibleRange === true,
      suppressGlobalVisibleRangeReset: request.suppressGlobalVisibleRangeReset ?? existing?.suppressGlobalVisibleRangeReset ?? false,
      releaseLivePaintAfterRender: request.releaseLivePaintAfterRender === true || existing?.releaseLivePaintAfterRender === true,
      finishLoadingAfterRender: request.finishLoadingAfterRender === true || existing?.finishLoadingAfterRender === true,
      cachedBaseline: request.cachedBaseline === true || existing?.cachedBaseline === true,
      reason: request.reason ?? existing?.reason ?? 'chart-data',
    };

    if (isChartInteractionActiveRef.current) {
      postInteractionCoordinatorRef.current?.request({ model: true });
      return;
    }

    if (request.cachedBaseline) {
      flushQueuedChartRender();
      return;
    }

    scheduleQueuedChartRenderFlush(request.immediate === true);
  }, [flushQueuedChartRender, scheduleQueuedChartRenderFlush]);

  useLayoutEffect(() => {
    const nextGate = selectChartPresentation(
      chartSelectionPresentationRef.current,
      chartSelectionPresentationKey,
    );
    if (nextGate === chartSelectionPresentationRef.current) return;

    const chartLoginPresentation = {
      sessionScope: brokerAccountSessionScope, marketSource: chartMarketSource, symbol, timeframe,
    };
    const retainPublicSurface = lastRenderedCandlesRef.current.length > 0
      && canRetainPublicChartOnLogin(previousChartLoginPresentationRef.current, chartLoginPresentation);
    previousChartLoginPresentationRef.current = chartLoginPresentation;
    retainedPublicChartSurfaceRef.current = retainPublicSurface;
    setRetainedPublicChartSurface(retainPublicSurface);

    // Close the previous selection before normal effects (including the live
    // tick loop) run. An already queued old-symbol RAF cannot paint; a same
    // market guest login keeps only its public canvas behind the progress badge.
    chartSelectionPresentationRef.current = nextGate;
    initialHistoryLoadSequenceRef.current += 1;
    initialHistoryLoadPendingRef.current = true;
    liveCandleMutationGenerationRef.current = 0;
    liveCandleMutationGenerationByTimeRef.current.clear();
    historyRequestCoordinatorRef.current.abort();
    cancelQueuedChartRender();
    postInteractionCoordinatorRef.current?.clear();
    hideLivePriceOverlay();
    setLoadingPhase('connecting');
  }, [
    cancelQueuedChartRender,
    chartSelectionPresentationKey,
    brokerAccountSessionScope,
    chartMarketSource,
    symbol,
    timeframe,
    hideLivePriceOverlay,
    setLoadingPhase,
  ]);

  const consumeDeferredVisibleRangeHistory = useCallback(() => {
    const visibleRange = chartRef.current?.timeScale().getVisibleLogicalRange() as LogicalRangeLike | null;
    const historyAction = resolveDeferredVisibleRangeHistoryAction({
      pending: !isDisposedRef.current,
      logicalFrom: visibleRange?.from,
      suppressed: isVisibleRangeHistoryLoadSuppressed(),
      userInitiated: visibleRangeHistoryUserInitiatedRef.current,
    });
    if (historyAction === 'load') {
      loadMoreHistoryRef.current?.();
    }
  }, [isVisibleRangeHistoryLoadSuppressed]);

  postInteractionCallbacksRef.current.consumeHistory = consumeDeferredVisibleRangeHistory;

  const flushPostInteractionWork = useCallback((): boolean => {
    if (isDisposedRef.current || !isActiveRef.current) return false;
    const wasMarkedActive = isChartInteractionActiveRef.current;
    if (!wasMarkedActive) {
      isChartInteractionActiveRef.current = true;
    }
    try {
      return postInteractionCoordinatorRef.current?.flush() ?? false;
    } finally {
      if (!wasMarkedActive) {
        isChartInteractionActiveRef.current = false;
      }
    }
  }, []);

  useEffect(() => {
    if (!isActive) {
      clearLocalChartPointerStateRef.current();
      forceSettleInteraction();
      return;
    }
    // Work queued while a split-chart tab was inactive must paint the latest
    // model as soon as that tab becomes visible again.
    flushPostInteractionWork();
    scheduleQueuedChartRenderFlush(true);
  }, [flushPostInteractionWork, forceSettleInteraction, isActive, scheduleQueuedChartRenderFlush]);

  useEffect(() => {
    return () => {
      historyRequestCoordinatorRef.current.abort();
      cancelQueuedChartRender();
      cancelScheduledDrawingRender();
      isChartInteractionActiveRef.current = false;
      postInteractionCoordinatorRef.current?.clear();
    };
  }, [cancelQueuedChartRender, cancelScheduledDrawingRender]);

  // Initialize chart
useTradingChartInitialization({
    activeChartSourceId,
    applyLivePriceHorizontalGeometry,
    askPriceLineRef,
    autoScrollEnabledRef,
    brokerTimeOffsetSecRef,
    cancelQueuedChartRender,
    chartAxisFontSize,
    chartInteractionOwnershipRef,
    chartRef,
    chartSettings,
    chartSettingsRef,
    chartTheme,
    clearLocalChartPointerStateRef,
    clearPeriodSeparators,
    containerRef,
    ctxChartShift,
    currentCandleRef,
    dataWindowHoverTimeRef,
    drawingRenderFrameRef,
    drawingRenderSettledFrameRef,
    drawingRuntimeContextRef,
    flushPostInteractionWork,
    forceSettleInteraction,
    getDrawingSeriesData,
    historyRequestCoordinatorRef,
    indicatorStorageScopeRef,
    isActiveRef,
    isAdvancedUntitledLight,
    isChartInteractionActiveRef,
    isChartUserInteractingRef,
    isDisposedRef,
    isVisibleRangeHistoryLoadSuppressed,
    lastPriceLineRef,
    latestCandleJumpPendingRef,
    loadMoreHistoryRef,
    livePriceBadgeRef,
    livePriceLineRef,
    livePriceRef,
    loadedIndicatorStorageScopeRef,
    localIndicatorManager,
    overlayRef,
    postInteractionCoordinatorRef,
    priceLineRef,
    repaintTradeOverlayGeometryRef,
    resolvedPriceDigitsRef,
    resolvedPricePointRef,
    scheduleDrawingRenderAfterChartData,
    scheduleQueuedChartRenderFlush,
    seriesRef,
    settleAutoScrollPolicyRef,
    squareGridHostSeriesRef,
    squareGridPrimitiveRef,
    symbol,
    timeframe,
    timeScaleTimeframeRef,
    updateLegendDOM,
    visibleRangeHistoryUserInitiatedRef,
    volumeRef,
  });

  // Indicator ownership is panel-local. Persist the previous account/panel
  // scope before hydrating another one, while the chart series are still live.
  useEffect(() => {
    if (isDisposedRef.current || !chartRef.current) return;
    if (loadedIndicatorStorageScopeRef.current === indicatorStorageScope) return;

    if (loadedIndicatorStorageScopeRef.current) {
      localIndicatorManager.saveToStorage(loadedIndicatorStorageScopeRef.current);
      localIndicatorManager.clearAll();
    }

    localIndicatorManager.loadFromStorage(indicatorStorageScope);
    loadedIndicatorStorageScopeRef.current = indicatorStorageScope;
    refreshCurrentIndicators();
  }, [indicatorStorageScope, localIndicatorManager, refreshCurrentIndicators]);

  useEffect(() => commandBus.subscribe('ADD_INDICATOR', payload => {
    if (!isChartCommandTarget(payload)) return;
    if (payload.symbol && payload.symbol.trim().toUpperCase() !== symbol.trim().toUpperCase()) return;
    addLocalIndicator({
      id: payload.id,
      name: payload.name,
      indicatorType: payload.indicatorType,
      params: payload.params,
    });
  }), [addLocalIndicator, isChartCommandTarget, symbol]);

  useEffect(() => commandBus.subscribe('REMOVE_ALL_INDICATORS', payload => {
    if (!isChartCommandTarget(payload)) return;
    if (getChartObjectState(
      useChartObjectStateStore.getState().byContext,
      drawingRuntimeContextRef.current.contextId,
    ).indicatorsLocked) return;
    clearLocalIndicators();
  }), [clearLocalIndicators, isChartCommandTarget]);

  // Update chart with candles helper
  const updateChartData = useCallback((candles: Candle[], currentChartType?: ChartType, request: ChartDataRenderRequest = {}) => {
    console.log(`[Chart] updateChartData called with ${candles?.length || 0} candles, type=${currentChartType}`);

    if (isDisposedRef.current) {
      console.log('[Chart] Cannot update - chart disposed');
      return;
    }
    if (!seriesRef.current) {
      console.log('[Chart] Cannot update - series not ready');
      return;
    }

    requestChartDataRender({
      ...request,
      chartType: currentChartType,
      immediate: request.immediate ?? resetVisibleRangeOnNextDataRef.current,
      reason: request.reason ?? 'update-chart-data',
    });
  }, [requestChartDataRender]);

  const reloadAggregationCandles = useCallback((
    candles: Candle[],
    activeTf: Timeframe,
    boundaryOffsetSeconds = brokerTimeOffsetSecRef.current,
  ) => {
    const ohlcvCandles: OHLCV[] = formatHistoryForOhlcv(candles);
    candleAggregationService.loadHistoricalCandles(
      symbol,
      activeTf as AggTimeframe,
      ohlcvCandles,
      boundaryOffsetSeconds,
    );
  }, [symbol]);

  useEffect(() => {
    if (!marketClosedForPresentation) return;

    const activeTf = prevTimeframeRef.current || timeframe;
    let nextCandles = candlesRef.current;
    let finalizedCurrentCandle = false;
    const currentCandle = currentCandleRef.current;
    const sessionCloseSeconds = getCurrentClosedMarketSessionCloseSeconds(marketStatus.sessionCloseTimeMs);
    const currentStartsBeforeClose = currentCandle && (
      sessionCloseSeconds === null ||
      !Number.isFinite(currentCandle.time) ||
      currentCandle.time < sessionCloseSeconds
    );

    if (currentCandle && currentStartsBeforeClose) {
      nextCandles = upsertCandleIntoHistory(candlesRef.current, currentCandle).candles;
      candlesRef.current = nextCandles;
      renderedPriceReferenceRef.current = createRenderedPriceReference(nextCandles);
      reloadAggregationCandles(nextCandles, activeTf);
      finalizedCurrentCandle = true;

      if (nextCandles.length >= protectedDisplayedHistoryRef.current.length) {
        protectedDisplayedHistoryRef.current = nextCandles;
      }
    }

    const latestRenderableCandle = getLatestRenderableCandle(nextCandles);
    if (latestRenderableCandle) {
      currentCandleRef.current = latestRenderableCandle;
      prevPriceRef.current = latestRenderableCandle.close;
      updateLegendDOM(
        latestRenderableCandle.open,
        latestRenderableCandle.high,
        latestRenderableCandle.low,
        latestRenderableCandle.close,
        getDisplayVolume(latestRenderableCandle, chartSettingsRef.current),
      );
    }

    requestChartDataRender({
      immediate: true,
      resetVisibleRange: false,
      suppressGlobalVisibleRangeReset: true,
      reason: finalizedCurrentCandle ? 'market-closed-freeze-finalize' : 'market-closed-freeze',
    });
  }, [
    getLatestRenderableCandle,
    marketClosedForPresentation,
    marketStatus.sessionCloseTimeMs,
    reloadAggregationCandles,
    requestChartDataRender,
    timeframe,
    updateLegendDOM,
  ]);

  // Previous selection refs are shared by history, reconfiguration, and live-candle runtimes.
  const prevChartTypeRef = useRef<ChartType>(chartType);
  const prevSymbolRef = useRef<string>(symbol);
  const prevTimeframeRef = useRef<Timeframe>(timeframe);

  const {
    buildHistoryCacheTarget,
    fetchOlderHistoryPage,
    hydrateHistoryFromCache,
    mergeHistoryCache,
    restoreProtectedDisplayedHistory,
    setHistoryCache,
    validateRenderedCandlesAgainstLivePrice,
  } = useTradingChartHistoryCache({
    brokerTimeOffsetSecRef,
    candlesRef,
    cancelQueuedChartRender,
    chartSettingsRef,
    clearPeriodSeparators,
    currentCandleRef,
    firstRenderedCandleTimeRef,
    getCachedRenderedPriceReference,
    getLatestRenderableCandle,
    hasDisplayedHistoryRef,
    hasReachedBeginningRef,
    isLoadingMoreRef,
    lastRenderedCandlesRef,
    lastStoreCandleSecRef,
    lastVisibleLogicalRangeRef,
    liveCandleMutationGenerationByTimeRef,
    periodSeparatorsRef,
    prevPriceRef,
    protectedDisplayedHistoryRef,
    reloadAggregationCandles,
    renderedPriceReferenceRef,
    resetVisibleRangeOnNextDataRef,
    scheduleBoundaryTimerRef,
    setApiError,
    symbol,
    timeframe,
    updateChartData,
    updateLegendDOM,
  });

  const { loadHistory, loadMoreHistory } = useTradingChartHistoryLoading({
    discardRetainedPublicChartSurface,
    brokerTimeOffsetSec,
    brokerTimeOffsetSecRef,
    buildHistoryCacheTarget,
    candlesRef,
    chartRef,
    chartSettingsRef,
    currentCandleRef,
    fetchOlderHistoryPage,
    getLatestRenderableCandle,
    hasDisplayedHistoryRef,
    hasReachedBeginningRef,
    historyBackfillDiagnosticsRef,
    historyRequestCoordinatorRef,
    hydrateHistoryFromCache,
    initialHistoryLoadPendingRef,
    initialHistoryLoadSequenceRef,
    isDisposedRef,
    isLoadingMoreRef,
    isVisibleRangeHistoryLoadSuppressed,
    lastStoreCandleSecRef,
    liveCandleMutationGenerationByTimeRef,
    liveCandleMutationGenerationRef,
    mergeHistoryCache,
    prevPriceRef,
    prevTimeframeRef,
    protectedDisplayedHistoryRef,
    reconcileCandlesWithLiveQuote,
    reloadAggregationCandles,
    renderedPriceReferenceRef,
    requestChartDataRender,
    resetEmptyHistoryState,
    resetLiveQuotePriceGuard,
    resetVisibleRangeOnNextDataRef,
    restoreProtectedDisplayedHistory,
    scheduleBoundaryTimerRef,
    seriesRef,
    setApiError,
    setHistoryCache,
    setLoadingPhase,
    symbol,
    timeframe,
    updateChartData,
    updateLegendDOM,
    volumeRef,
  });

  // Keep the chart initialization listener pointed at the latest paged-history loader.
  useEffect(() => {
    loadMoreHistoryRef.current = loadMoreHistory;
  }, [loadMoreHistory]);

  useEffect(() => {
    setActiveTimeframe(timeframe);
  }, [timeframe]);

  // Builds the price series for a chart type with the current theme and symbol precision.
  const createPriceSeries = useCallback((chart: IChartApi, type: ChartType): ISeriesApi<SeriesType> => {
    let series: ISeriesApi<SeriesType>;
    const priceFormatOpts = {
      type: 'price' as const,
      precision: resolvedPriceDigitsRef.current,
      minMove: resolvedPricePointRef.current,
    };
    const theme = chartThemeRef.current;

    switch (type) {
      case 'candlestick':
        series = chart.addSeries(CandlestickSeries, {
          upColor: theme.candleUp,
          downColor: theme.candleDown,
          borderVisible: true,
          wickVisible: true,
          borderUpColor: theme.barUp,
          borderDownColor: theme.barDown,
          wickUpColor: theme.wickUp,
          wickDownColor: theme.wickDown,
          priceFormat: priceFormatOpts,
          priceLineVisible: false,  // Hide built-in dashed last-value line
          lastValueVisible: false,  // Hide built-in axis label
        });
        break;
      case 'bar':
        series = chart.addSeries(BarSeries, {
          upColor: theme.barUp,
          downColor: theme.barDown,
          priceFormat: priceFormatOpts,
          priceLineVisible: false,
          lastValueVisible: false,
        });
        break;
      case 'line':
        series = chart.addSeries(LineSeries, {
          color: theme.line,
          lineWidth: 2,
          priceFormat: priceFormatOpts,
          priceLineVisible: false,
          lastValueVisible: false,
        });
        break;
      case 'area': {
        // TradingView-style trend coloring; the direction is recomputed as soon
        // as data renders, so the previous direction only bridges the rebuild.
        const areaDirection = areaTrendDirectionRef.current ?? 'up';
        areaTrendDirectionRef.current = areaDirection;
        series = chart.addSeries(AreaSeries, {
          ...getAreaTrendSeriesOptions(theme, areaDirection),
          lineWidth: 2,
          priceFormat: priceFormatOpts,
          priceLineVisible: false,
          lastValueVisible: false,
        });
        break;
      }
      default:
        series = chart.addSeries(CandlestickSeries, {
          upColor: theme.candleUp,
          downColor: theme.candleDown,
          priceFormat: priceFormatOpts,
          priceLineVisible: false,
          lastValueVisible: false,
        });
    }
    series.attachPrimitive(new ChartOverlayGeometryPrimitive(() => {
      if (isDisposedRef.current || !isActiveRef.current || seriesRef.current !== series) return;
      repaintTradeOverlayGeometryRef.current();
    }));
    return series;
  }, [areaTrendDirectionRef]);

  // Switch the chart type in place: swap only the price/volume series and paint
  // the cached candles synchronously. This avoids the full rebuild path (which
  // resets the zoom and waits a frame for data), so the new type shows instantly.
  const applyChartTypeInPlace = useCallback((type: ChartType): boolean => {
    const chart = chartRef.current;
    if (isDisposedRef.current || !chart || !seriesRef.current) return false;
    if (prevChartTypeRef.current === type) return true;

    const visibleRange = chart.timeScale().getVisibleLogicalRange() as LogicalRangeLike | null;
    rememberVisibleLogicalRange(visibleRange);
    isRebuildingRef.current = true;

    // The retained guest pixels belong to the series being removed. Cover the
    // replacement until its own account baseline is available.
    discardRetainedPublicChartSurface();

    try { chart.removeSeries(seriesRef.current); } catch { /* chart may be rebuilding */ }
    seriesRef.current = null;
    askPriceLineRef.current = null;
    lastPriceLineRef.current = null;
    if (volumeRef.current) {
      try { chart.removeSeries(volumeRef.current); } catch { /* chart may be rebuilding */ }
      volumeRef.current = null;
    }

    const series = createPriceSeries(chart, type);
    seriesRef.current = series;
    const volSeries = chart.addSeries(HistogramSeries, {
      color: chartThemeRef.current.volumeUp,
      priceScaleId: '',
      priceFormat: { type: 'volume' },
      lastValueVisible: false,
      priceLineVisible: false,
      visible: shouldBuildVolumeData(chartSettingsRef.current),
    });
    volSeries.priceScale().applyOptions({ scaleMargins: { top: 0.68, bottom: 0 } });
    volumeRef.current = volSeries;
    prevChartTypeRef.current = type;

    drawingManager.setChart(
      chart,
      series,
      prevSymbolRef.current || symbol,
      1,
      overlayRef.current,
      prevTimeframeRef.current || timeframe,
      activeChartSourceId,
      drawingRuntimeContextRef.current.accountScope,
      getDrawingSeriesData,
    );

    isRebuildingRef.current = false;

    if (candlesRef.current.length > 0) {
      requestChartDataRender({ chartType: type, immediate: true, reason: 'chart-type-switch' });
      flushQueuedChartRender();
      if (visibleRange && Number.isFinite(visibleRange.from) && Number.isFinite(visibleRange.to)) {
        try { chart.timeScale().setVisibleLogicalRange(visibleRange); } catch { /* chart may be rebuilding */ }
      }
    }
    return true;
  }, [activeChartSourceId, createPriceSeries, discardRetainedPublicChartSurface, flushQueuedChartRender, getDrawingSeriesData, rememberVisibleLogicalRange, requestChartDataRender, symbol, timeframe]);

  // Create series when chart type, symbol, or timeframe changes
  useTradingChartReconfiguration({
    activeChartSourceId,
    activeToolRef,
    applyChartTypeInPlace,
    askPriceLineRef,
    bindDrawingManagerToChart,
    brokerTimeOffsetSecRef,
    cancelQueuedChartRender,
    candlesRef,
    chartInteractionOwnershipRef,
    chartRef,
    chartThemeRef,
    chartType,
    clearLocalChartPointerStateRef,
    clearPeriodSeparators,
    containerRef,
    createPriceSeries,
    currentCandleRef,
    drawingCommandTargetRef,
    drawingRuntimeContextRef,
    firstRenderedCandleTimeRef,
    getDrawingSeriesData,
    hasDisplayedHistoryRef,
    hasReachedBeginningRef,
    hydrateHistoryFromCache,
    isChartInteractionActiveRef,
    isChartUserInteractingRef,
    isDisposedRef,
    isLoadingMoreRef,
    isRebuildingRef,
    lastPriceLineRef,
    lastRenderedCandlesRef,
    lastStoreCandleSecRef,
    lastVisibleLogicalRangeRef,
    overlayRef,
    periodSeparatorsRef,
    postInteractionCoordinatorRef,
    prevChartTypeRef,
    prevPriceRef,
    prevSymbolRef,
    prevTimeframeRef,
    protectedDisplayedHistoryRef,
    renderedPriceReferenceRef,
    resetLiveQuotePriceGuard,
    resetVisibleRangeOnNextDataRef,
    resolvedPriceDigits,
    resolvedPricePoint,
    seriesRef,
    setTextInputOverlay,
    setTextInputValue,
    symbol,
    timeframe,
    updateChartData,
    volumeRef,
  });

  // Future whitespace supplies native time-axis ticks and matching grid marks
  // when panning beyond the last candle, without inventing price data.
  useEffect(() => {
    const chart = chartRef.current;
    const series = seriesRef.current;
    const hostSeries = squareGridHostSeriesRef.current;
    if (!chart || !series || !hostSeries) return;
    const timeScale = chart.timeScale();
    const projection = createChartGridTimeProjection({
      timeScale,
      hostSeries,
      getLatestPoint: () => {
        const latest = series.dataByIndex(Number.MAX_SAFE_INTEGER, MismatchDirection.NearestLeft);
        if (!latest || typeof latest.time !== 'number' || !Number.isFinite(latest.time)) return null;
        const index = timeScale.timeToIndex(latest.time, false);
        return index === null ? null : { time: latest.time, index };
      },
      getTimeframe: () => timeframe,
      getBoundaryOffsetSeconds: () => brokerTimeOffsetSecRef.current,
      isEnabled: () => chartSettingsRef.current.showGrid && chartSettingsRef.current.gridType === 'scale',
    });
    chartGridTimeProjectionRef.current = projection;
    series.subscribeDataChanged(projection.refresh);
    return () => {
      series.unsubscribeDataChanged(projection.refresh);
      projection.dispose();
      if (chartGridTimeProjectionRef.current === projection) chartGridTimeProjectionRef.current = null;
    };
  }, [brokerAccountSessionScope, symbol, timeframe, chartType, localChartType]);

  useEffect(() => {
    chartGridTimeProjectionRef.current?.refresh();
  }, [chartSettings.showGrid, chartSettings.gridType, brokerTimeOffsetSec]);


  // The authorized instrument catalog can resolve after the chart mounts.
  // Hot-apply its precision without rebuilding the series or resetting data.
  useTradingChartPriceFormat({
    seriesRef, squareGridHostSeriesRef, isDisposedRef,
    digits: resolvedPriceDigits, point: resolvedPricePoint,
  });
  useEffect(() => {
    if (isDisposedRef.current || !seriesRef.current) return;
    try {
      const currentCandle = currentCandleRef.current;
      if (currentCandle) {
        updateLegendDOM(
          currentCandle.open,
          currentCandle.high,
          currentCandle.low,
          currentCandle.close,
          getDisplayVolume(currentCandle, chartSettingsRef.current),
        );
        repaintLivePriceOverlayFromCurrentPrice(currentCandle);
      }
    } catch {
      // The series can be disposed during fast chart/tab switches.
    }
  }, [repaintLivePriceOverlayFromCurrentPrice, resolvedPriceDigits, resolvedPricePoint, updateLegendDOM]);



  // ── Chart Shift (standalone effect) ───────────────────────────────────
  // Listens for rtx:chartShift window events and applies rightOffset directly.
  // Completely independent of command bus lifecycle.
  useEffect(() => {
    const handleShift = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      if (!isChartCommandTarget(detail)) return;
      const enabled = detail?.enabled === true;
      ctxChartShiftRef.current = enabled;
      setCtxChartShift(enabled);
    };
    window.addEventListener('rtx:chartShift', handleShift);
    return () => window.removeEventListener('rtx:chartShift', handleShift);
  }, [isChartCommandTarget, setCtxChartShift]);

  // Apply chart shift when ctxChartShift changes
  useEffect(() => {
    if (!chartRef.current || isDisposedRef.current) return;
    ctxChartShiftRef.current = ctxChartShift;
    const rightOffset = getTradingChartShiftRightOffset(timeframe, ctxChartShift);
    console.log(`[Chart] Applying chart shift: ${ctxChartShift}, rightOffset: ${rightOffset}`);
    chartRef.current.timeScale().applyOptions({
      ...TRADING_CHART_TIME_SCALE_LIVE_SHIFT_OPTIONS,
      rightOffset,
      fixRightEdge: false,
    });
  }, [ctxChartShift, timeframe]);

  useEffect(() => {
    autoScrollEnabledRef.current = chartSettings.chartAutoScroll;
    setCtxAutoScroll(chartSettings.chartAutoScroll);
  }, [chartSettings.chartAutoScroll, setCtxAutoScroll]);

  useEffect(() => {
    ctxChartShiftRef.current = chartSettings.chartShift;
    setCtxChartShift(chartSettings.chartShift);
  }, [chartSettings.chartShift, setCtxChartShift]);

  useEffect(() => {
    if (!chartRef.current || isDisposedRef.current) return;

    chartRef.current.applyOptions({
      localization: {
        priceFormatter: price => formatChartAxisPrice(price, resolvedPriceDigitsRef.current),
        timeFormatter: formatCrosshairTime,
      },
      timeScale: {
        ...TRADING_CHART_TIME_SCALE_LIVE_SHIFT_OPTIONS,
        tickMarkMaxCharacterLength: getTradingChartTickMarkCharacterLength(timeframe),
        tickMarkFormatter: formatTimeScaleTick,
      },
    });
  }, [formatCrosshairTime, formatTimeScaleTick, timeframe]);

  useEffect(() => {
    if (!chartRef.current || isDisposedRef.current) {
      leftVisibleTimeRef.current = null;
      return;
    }

    const handleVisibleRangeChange = () => {
      syncLeftVisibleTime();
      if (isChartInteractionActiveRef.current) {
        postInteractionCoordinatorRef.current?.request({ separators: true });
        return;
      }
      schedulePeriodSeparatorRender();
    };

    syncLeftVisibleTime();
    chartRef.current.timeScale().subscribeVisibleLogicalRangeChange(handleVisibleRangeChange);

    return () => {
      try {
        chartRef.current?.timeScale().unsubscribeVisibleLogicalRangeChange(handleVisibleRangeChange);
      } catch { /* chart may be disposed */ }
    };
  }, [schedulePeriodSeparatorRender, syncLeftVisibleTime, timeframe, candlesLoadedRev]);

  // Watch chart settings and hot-apply to chart without unmounting
  useTradingChartPriceScaleSettings({ chartRef, isDisposedRef, chartSettings, symbol, timeframe });

  useLayoutEffect(() => {
    if (!chartRef.current || isDisposedRef.current) return;
    const chart = chartRef.current;

    // Apply global layout and grid
    const gridRenderingOptions = getChartGridRenderingOptions(chartSettings, chartTheme);
    chart.applyOptions({
      layout: {
        background: { type: ColorType.Solid, color: chartTheme.background },
        textColor: chartTheme.axisText,
        fontFamily: isAdvancedUntitledLight ? LIGHT_CHART_AXIS_FONT_FAMILY : CHART_AXIS_FONT_FAMILY,
        fontSize: chartAxisFontSize,
      },
      grid: gridRenderingOptions.nativeGrid,
      crosshair: {
        vertLine: { color: chartTheme.crosshair },
        horzLine: { color: chartTheme.crosshair },
      },
      handleScroll: TRADING_VIEW_HANDLE_SCROLL,
      handleScale: TRADING_VIEW_HANDLE_SCALE,
      rightPriceScale: {
        borderColor: chartTheme.scaleBorder,
        textColor: chartSettings.showGrid && chartSettings.gridType === 'mt5' ? 'transparent' : chartTheme.axisText,
        alignLabels: false,
      },
      timeScale: {
        ...TRADING_CHART_TIME_SCALE_LIVE_SHIFT_OPTIONS,
        borderColor: chartTheme.scaleBorder,
      },
    });

    squareGridPrimitiveRef.current?.applyOptions(gridRenderingOptions.fixedGrid);

    // Update Series colors for the series currently on the chart (a chart-type
    // switch can swap it before the chartType prop catches up).
    const renderedChartType = prevChartTypeRef.current || chartType;
    if (seriesRef.current) {
      if (renderedChartType === 'candlestick') {
        seriesRef.current.applyOptions({
          upColor: chartTheme.candleUp,
          downColor: chartTheme.candleDown,
          wickUpColor: chartTheme.wickUp,
          wickDownColor: chartTheme.wickDown,
          borderUpColor: chartTheme.barUp,
          borderDownColor: chartTheme.barDown,
        });
      } else if (renderedChartType === 'bar') {
        seriesRef.current.applyOptions({
          upColor: chartTheme.barUp,
          downColor: chartTheme.barDown,
        });
      } else if (renderedChartType === 'line') {
        seriesRef.current.applyOptions({
          color: chartTheme.line,
        });
      } else if (renderedChartType === 'area') {
        seriesRef.current.applyOptions(
          getAreaTrendSeriesOptions(chartTheme, areaTrendDirectionRef.current ?? 'up'),
        );
      }
    }

    // Toggle volumes and apply colors if it exists
    if (volumeRef.current) {
      const volumeVisible = shouldBuildVolumeData(chartSettings);
      volumeRef.current.applyOptions({
        visible: volumeVisible,
        color: chartTheme.volumeUp
      });
      if (volumeVisible) {
        // Volume menu changes need only the histogram, not an idle repaint of
        // price history and every indicator.
        volumeRef.current.setData(lastRenderedCandlesRef.current.map(candle => ({
          time: candle.time as Time,
          value: getDisplayVolume(candle, chartSettings),
          color: candle.close >= candle.open ? chartTheme.volumeUp : chartTheme.volumeDown,
        })));
      } else {
        volumeRef.current.setData([]);
        schedulePeriodSeparatorRender();
      }
      const current = currentCandleRef.current;
      if (current) {
        updateLegendDOM(current.open, current.high, current.low, current.close, getDisplayVolume(current, chartSettings));
      }
    }

    requestChartTradeOverlayRefresh(drawingRuntimeContextRef.current.contextId, 'rebuild');
  }, [areaTrendDirectionRef, chartAxisFontSize, chartSettings, chartTheme, chartType, requestChartDataRender, schedulePeriodSeparatorRender, symbol, timeframe, updateLegendDOM]);

  useLayoutEffect(() => {
    if (previousAdvancedUntitledLightRef.current === isAdvancedUntitledLight) return;
    if (!isActive || isDisposedRef.current || !chartRef.current || !seriesRef.current) return;

    previousAdvancedUntitledLightRef.current = isAdvancedUntitledLight;
    return scheduleChartThemeTransition({
      refreshSurface: () => {
        refreshVisibleChartLayout(true);
        schedulePeriodSeparatorRender();
      },
    });
  }, [
    isActive,
    isAdvancedUntitledLight,
    refreshVisibleChartLayout,
    schedulePeriodSeparatorRender,
  ]);

  // getTimeframeSeconds is imported from candleAggregationService (module scope)
  // so it is never a stale closure value after a timeframe switch.

  const clearBrokerSessionCandleScope = useCallback((activeTf: Timeframe) => {
    // Abort ownership first so an old broker response cannot repopulate any ref
    // after the scope is cleared.
    historyRequestCoordinatorRef.current.abort();
    cancelQueuedChartRender();
    candleCache.clearAll();
    resetEmptyHistoryState(activeTf);
    candleAggregationService.clearSymbol(symbol);

    brokerTimeOffsetSecRef.current = 0;
    setBrokerTimeOffsetSec(0);
    historyBackfillDiagnosticsRef.current = createChartHistoryBackfillDiagnostics();
    pendingLegendRenderRef.current = null;
    renderedLegendSignatureRef.current = null;
    if (typeof window !== 'undefined' && legendRenderFrameRef.current !== null) {
      window.cancelAnimationFrame(legendRenderFrameRef.current);
      legendRenderFrameRef.current = null;
    }

    if (!retainedPublicChartSurfaceRef.current) {
      try { seriesRef.current?.setData([]); } catch { /* chart may be rebuilding */ }
      try { volumeRef.current?.setData([]); } catch { /* chart may be rebuilding */ }
    }
    if (ohlcOpenRef.current) ohlcOpenRef.current.textContent = '';
    if (ohlcHighRef.current) ohlcHighRef.current.textContent = '';
    if (ohlcLowRef.current) ohlcLowRef.current.textContent = '';
    if (ohlcCloseRef.current) ohlcCloseRef.current.textContent = '';
    if (ohlcVolumeRef.current) ohlcVolumeRef.current.textContent = '';
    setLoadingPhase('connecting');
  }, [cancelQueuedChartRender, resetEmptyHistoryState, setLoadingPhase, symbol]);

  const loadSelectedHistory = useCallback((selection: { symbol: string; timeframe: string }) => {
    const selectedTimeframe = selection.timeframe as Timeframe;
    if (loadedHistorySessionScopeRef.current !== brokerAccountSessionScope) {
      clearBrokerSessionCandleScope(selectedTimeframe);
      loadedHistorySessionScopeRef.current = brokerAccountSessionScope;
    }
    return loadHistory(selection.symbol, selectedTimeframe);
  }, [brokerAccountSessionScope, clearBrokerSessionCandleScope, loadHistory]);

  useSelectedHistoryRequestOwner({
    symbol,
    timeframe,
    enabled: visibleRuntime.history,
    scopeRevision: brokerAccountSessionScope,
    load: loadSelectedHistory,
    abort: () => historyRequestCoordinatorRef.current.abort(),
  });

  const activeTradeSnapshotsRef = useRef<Map<string, ActiveTradeSnapshot>>(new Map());
  const lastCrossRefreshDispatchAtRef = useRef(0);
  const tradeLevelCrossRefreshPendingRef = useRef<Set<string>>(new Set());

  // ─── Live tick subscription + candle rollover ─────────────────────────────
useTradingChartLiveCandleRuntime({
    discardRetainedPublicChartSurface,
    activeTradeSnapshotsRef,
    applyAreaTrendColors,
    authToken,
    autoScrollEnabledRef,
    brokerAccountSessionScope,
    brokerTimeOffsetSecRef,
    cancelQueuedChartRender,
    candlesRef,
    chartRef,
    chartSelectionPresentationKey,
    chartSelectionPresentationRef,
    chartSettingsRef,
    chartThemeRef,
    clearPeriodSeparators,
    currentCandleRef,
    drawingRenderFrameRef,
    drawingRenderSettledFrameRef,
    drawingRuntimeContextRef,
    firstRenderedCandleTimeRef,
    flushPostInteractionWork,
    getSynchronizedChartMarketNowMs,
    hasDisplayedHistoryRef,
    hideLivePriceOverlay,
    incompatibleQuoteCountRef,
    initialHistoryLoadPendingRef,
    isActive,
    isActiveRef,
    isChartInteractionActiveRef,
    isDisposedRef,
    isLivePriceSafeForCandles,
    isPotentialMarketClosedPlaceholder,
    isRebuildingRef,
    lastAcceptedQuoteRef,
    lastCrossRefreshDispatchAtRef,
    lastRenderedCandlesRef,
    lastStoreCandleSecRef,
    lastVisibleLogicalRangeRef,
    leftVisibleTimeRef,
    liveCandleMutationGenerationByTimeRef,
    liveCandleMutationGenerationRef,
    liveMarketDataFrozenRef,
    mergeCandleIntoRef,
    mergeHistoryCache,
    periodSeparatorsRef,
    postInteractionCallbacksRef,
    postInteractionCoordinatorRef,
    prevChartTypeRef,
    prevPriceRef,
    prevSymbolRef,
    prevTimeframeRef,
    protectedDisplayedHistoryRef,
    reconcileCandlesWithLiveQuote,
    repaintLivePriceOverlayFromCurrentPrice,
    renderedPriceReferenceRef,
    requestChartDataRender,
    resetLiveQuotePriceGuard,
    resetVisibleRangeOnNextDataRef,
    restoreProtectedDisplayedHistory,
    scheduleBoundaryTimerRef,
    scheduleDrawingRenderAfterChartData,
    seriesRef,
    setApiError,
    setHistoryCache,
    symbol,
    syncSupplementalPriceLines,
    synchronizeChartMarketClock,
    synchronizedMarketClockRef,
    timeframe,
    tradeLevelCrossRefreshPendingRef,
    updateChartData,
    updateLegendDOM,
    validateRenderedCandlesAgainstLivePrice,
    visibleRuntime,
    volumeRef,
  });

  // The primary tick aggregation interval handles all live OHLCV updates perfectly.

  // Keep the active candle countdown inside the right price-scale badge, matching
  // TradingView without adding timer text back to the chart HUD.
  useActiveChartRuntimeEffect(visibleRuntime.interval, () => {
    if (!isActive || !symbol) return;

    const updateLivePriceCountdown = () => {
      const countdown = livePriceCountdownRef.current;
      if (!countdown) return;
      const hasCurrentPrice = livePriceRef.current !== null
        && Number.isFinite(livePriceRef.current)
        && currentCandleRef.current !== null
        && livePriceBadgeRef.current?.style.display === 'block';
      const text = hasCurrentPrice ? getChartCandleCountdownText(
        getSynchronizedChartMarketNowMs(),
        activeTimeframe,
        brokerTimeOffsetSecRef.current,
      ) : '';
      countdown.textContent = text;
      countdown.style.display = text ? 'block' : 'none';
    };

    updateLivePriceCountdown();
    const interval = window.setInterval(updateLivePriceCountdown, 1000);
    const handleCountdownVisibilityChange = () => {
      if (document.visibilityState === 'visible') updateLivePriceCountdown();
    };
    document.addEventListener('visibilitychange', handleCountdownVisibilityChange);
    return () => {
      window.clearInterval(interval);
      document.removeEventListener('visibilitychange', handleCountdownVisibilityChange);
      if (livePriceCountdownRef.current) {
        livePriceCountdownRef.current.textContent = '';
        livePriceCountdownRef.current.style.display = 'none';
      }
    };
  }, [activeTimeframe, getSynchronizedChartMarketNowMs, symbol]);

  // ── Tab-visibility fix ──────────────────────────────────────────────
  // Charts initialised inside an invisible tab (opacity:0, pointerEvents:none)
  // will never receive a proper layout from lightweight-charts' autoSize.
  // When the tab becomes visible we force a resize + re-render.
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting && chartRef.current && !isDisposedRef.current) {
            // Force chart to recompute its size
            const { offsetWidth, offsetHeight } = el;
            if (offsetWidth > 0 && offsetHeight > 0) {
              refreshLightweightChartSurface(chartRef.current, offsetWidth, offsetHeight, { forceRepaint: false });
              if (resetVisibleRangeOnNextDataRef.current) {
                const totalBars = getCandlesForFullRender().length;
                resetVisibleRangeOnNextDataRef.current = !applyInitialVisibleLogicalRange(
                  chartRef.current,
                  totalBars,
                  prevTimeframeRef.current || timeframe,
                );
              }
              console.log(`[TradingChart] Tab became visible — resized to ${offsetWidth}x${offsetHeight}`);
              refreshTradeOverlayGeometry();
              schedulePeriodSeparatorRender();
            }
          }
        }
      },
      { threshold: 0.1 }
    );

    observer.observe(el);
    return () => observer.disconnect();
  }, [applyInitialVisibleLogicalRange, refreshTradeOverlayGeometry, getCandlesForFullRender, schedulePeriodSeparatorRender, timeframe]);

  useEffect(() => {
    if (!isActive) return;

    const refreshLayoutAndGaps = () => {
      refreshVisibleChartLayout();
      schedulePeriodSeparatorRender();
    };

    refreshLayoutAndGaps();
    let secondFrameId: number | null = null;
    const firstFrameId = window.requestAnimationFrame(() => {
      refreshLayoutAndGaps();
      secondFrameId = window.requestAnimationFrame(refreshLayoutAndGaps);
    });
    const timeoutId = window.setTimeout(refreshLayoutAndGaps, 120);

    return () => {
      window.cancelAnimationFrame(firstFrameId);
      if (secondFrameId !== null) window.cancelAnimationFrame(secondFrameId);
      window.clearTimeout(timeoutId);
    };
  }, [isActive, refreshVisibleChartLayout, schedulePeriodSeparatorRender, symbol, timeframe]);

  // Native autoSize handles resizing internally

  // Keyboard navigation retains the user's viewport while live prices update.
  useEffect(() => bindChartKeyboardScroll({
    getChart: () => isDisposedRef.current || !isActiveRef.current ? null : chartRef.current,
    isTarget: isChartCommandTarget,
    beforeScroll: () => {
      autoScrollEnabledRef.current = false;
      latestCandleJumpPendingRef.current = false;
      visibleRangeHistoryUserInitiatedRef.current = true;
      setCtxAutoScroll(false);
      settleAutoScrollPolicyRef.current();
      useChartSettingsStore.getState().updateSymbolProperty(prevSymbolRef.current || symbol, 'chartAutoScroll', false);
    },
    onScrolled: (range) => {
      rememberVisibleLogicalRange(range);
      leftVisibleTimeRef.current = getLeftVisibleTimeFromLogicalRange(lastRenderedCandlesRef.current, range);
      schedulePeriodSeparatorRender();
    },
  }), [isChartCommandTarget, rememberVisibleLogicalRange, schedulePeriodSeparatorRender, setCtxAutoScroll, symbol]);

  // All zoom buttons use the chart's live time scale, shared by candles and volume.
useTradingChartCommands({
    applyChartTypeInPlace,
    autoScrollEnabledRef,
    brokerTimeOffsetSecRef,
    cancelQueuedChartRender,
    candlesRef,
    chartInteractionOwnershipRef,
    chartRef,
    clearLocalChartPointerStateRef,
    clearPeriodSeparators,
    ctxChartShiftRef,
    currentCandleRef,
    drawingRuntimeContextRef,
    firstRenderedCandleTimeRef,
    getCandlesForFullRender,
    hasDisplayedHistoryRef,
    historyRequestCoordinatorRef,
    hydrateHistoryFromCache,
    isChartCommandTarget,
    isChartInteractionActiveRef,
    isChartUserInteractingRef,
    isDisposedRef,
    lastRenderedCandlesRef,
    lastVisibleLogicalRangeRef,
    latestCandleJumpPendingRef,
    leftVisibleTimeRef,
    liveCandleMutationGenerationByTimeRef,
    liveCandleMutationGenerationRef,
    panelId,
    periodSeparatorsRef,
    postInteractionCoordinatorRef,
    prevSymbolRef,
    prevTimeframeRef,
    protectedDisplayedHistoryRef,
    reconcileCandlesWithLiveQuote,
    renderedPriceReferenceRef,
    resetVisibleRangeOnNextDataRef,
    scrollToLatestCandleNow,
    seriesRef,
    setActiveTimeframe,
    setCtxAutoScroll,
    setCtxChartShift,
    setLoadingPhase,
    symbol,
    syncLeftVisibleTime,
    timeframe,
    updateChartData,
    volumeRef,
  });

  // Handle SELECT_TOOL command — bridge toolbar buttons to drawingManager
useTradingChartDrawingCommands({
    activeToolRef,
    bindDrawingManagerToChart,
    chartRef,
    containerRef,
    crosshairEnabledRef,
    drawingCommandTargetRef,
    drawingRuntimeContextRef,
    seriesRef,
    setTextInputOverlay,
  });

  // Ruler measurements are temporary and never enter the drawing manager's
  // persistence or undo history. Keep the interaction owned by this chart.
  useEffect(() => {
    const container = containerRef.current, chart = chartRef.current;
    if (!container || !chart) return;
    const contextId = drawingRuntimeContextRef.current.contextId;
    const select = () => commandBus.dispatch({ type: 'SELECT_TOOL', payload: { tool: 'ruler', targetContextId: contextId } });
    const finish = () => commandBus.dispatch({ type: 'SELECT_TOOL', payload: { tool: 'cursor', targetContextId: contextId } });
    const ruler = createChartRuler({
      container,
      select,
      finish,
      canStartShortcut: () => getActiveChartSource()?.id === contextId && !activeToolRef.current && !drawingManager.getActiveDrawing(contextId),
      point: (x, y) => {
        const series = seriesRef.current, scale = chart.timeScale();
        if (!series) return null;
        const logical = scale.coordinateToLogical(x), price = series.coordinateToPrice(y);
        if (logical === null || price === null || !Number.isFinite(price)) return null;
        const index = Math.round(logical);
        const actualTime = series.dataByIndex(index)?.time;
        const time = typeof actualTime === 'number' ? actualTime : projectDrawingTimeAtLogical(series, scale, index, getTimeframeSeconds(drawingRuntimeContextRef.current.timeframe as AggTimeframe));
        if (time === null || !Number.isFinite(time)) return null;
        return { logical: index, time, price: Number(price.toFixed(resolvedPriceDigitsRef.current)) };
      },
      resolve: point => {
        const scale = chart.timeScale();
        const exact = scale.timeToIndex(point.time as Time, false);
        if (exact !== null) return { ...point, logical: exact };
        const nearest = scale.timeToIndex(point.time as Time, true);
        const anchorTime = nearest === null ? null : seriesRef.current?.dataByIndex(nearest)?.time;
        if (nearest !== null && typeof anchorTime === 'number') {
          return { ...point, logical: nearest + Math.round((point.time - anchorTime) / getTimeframeSeconds(drawingRuntimeContextRef.current.timeframe as AggTimeframe)) };
        }
        return point;
      },
      geometry: () => {
        const series = seriesRef.current;
        if (!series || isDisposedRef.current) return null;
        return {
          width: container.clientWidth - chart.priceScale('right').width(),
          height: container.clientHeight - chart.timeScale().height(),
          totalWidth: container.clientWidth, totalHeight: container.clientHeight,
          useLightPalette: useEnterpriseLightPricePaletteRef.current,
          x: index => chart.timeScale().logicalToCoordinate(index as Logical),
          y: price => series.priceToCoordinate(price),
          formatPrice: price => series.priceFormatter().format(price),
          formatTime: time => formatTradingChartCrosshairLabel(time as Time, drawingRuntimeContextRef.current.timeframe, brokerTimeOffsetSecRef.current),
        };
      },
      metrics: (start, end) => rulerMetrics(start, end, lastRenderedCandlesRef.current, resolvedPriceDigitsRef.current, getPricePointFromDigits(resolvedPriceDigitsRef.current)),
    });
    const unsubscribe = commandBus.subscribe('SELECT_TOOL', payload => {
      ruler.select(payload.tool === 'ruler' && (payload.targetContextId ?? getActiveChartSource()?.id) === contextId);
    });
    chart.timeScale().subscribeVisibleLogicalRangeChange(ruler.refresh);
    // Price autoscaling and live volume can change without a logical-range event.
    const timer = window.setInterval(ruler.refresh, 250);
    return () => {
      unsubscribe(); window.clearInterval(timer);
      try { chart.timeScale().unsubscribeVisibleLogicalRangeChange(ruler.refresh); } catch { /* Chart has been disposed. */ }
      ruler.destroy();
    };
  }, [symbol, activeTimeframe, drawingAccountScope]);

  // Handle UNDO / REDO / DELETE commands from toolbar
  useEffect(() => {
    const runForDrawingContext = (targetContextId: string | undefined, action: () => void): boolean => {
      if (!isDrawingCommandTarget(targetContextId) || !bindDrawingManagerToChart()) return false;
      action();
      return true;
    };

    const unsubUndo = commandBus.subscribe('UNDO', (payload) => {
      if (runForDrawingContext(payload.targetContextId, () => drawingManager.undo(drawingRuntimeContextRef.current.contextId))) {
        console.log('[Chart] Undo drawing');
      }
    });

    const unsubRedo = commandBus.subscribe('REDO', (payload) => {
      if (runForDrawingContext(payload.targetContextId, () => drawingManager.redo(drawingRuntimeContextRef.current.contextId))) {
        console.log('[Chart] Redo drawing');
      }
    });

    const unsubDeleteSelected = commandBus.subscribe('DELETE_SELECTED_DRAWING', (payload) => {
      if (runForDrawingContext(payload.targetContextId, () => drawingManager.deleteSelected(drawingRuntimeContextRef.current.contextId))) {
        console.log('[Chart] Deleted selected drawings');
      }
    });

    const unsubDeleteById = commandBus.subscribe('DELETE_DRAWING', (payload) => {
      if (runForDrawingContext(undefined, () => drawingManager.deleteDrawing(payload.id, drawingRuntimeContextRef.current.contextId))) {
        console.log(`[Chart] Deleted drawing: ${payload.id}`);
      }
    });

    return () => {
      unsubUndo();
      unsubRedo();
      unsubDeleteSelected();
      unsubDeleteById();
    };
  }, [bindDrawingManagerToChart, isDrawingCommandTarget]);

  // Crosshair state is local to each chart and only the targeted chart toggles.

  // The global shortcut manager owns keyboard input. Keep only the dashboard
  // event bridge here so one keystroke cannot execute twice for the active chart.
  useEffect(() => {
    if (!isActive) return;

    // Listen for toggle-one-click-trading event from dashboard toolbar
    const handleToggleOneClick = (event: Event) => {
      if (!isActiveRef.current) return;
      if (!isChartCommandTarget((event as CustomEvent).detail)) return;
      toggleOneClickTrading();
    };
    window.addEventListener('toggle-one-click-trading', handleToggleOneClick);

    return () => {
      window.removeEventListener('toggle-one-click-trading', handleToggleOneClick);
    };
  }, [isActive, isChartCommandTarget, toggleOneClickTrading]);

  // ─── Trade Annotations on Chart (MT5-style entry/exit markers + live trails) ───
useTradingChartTradeRuntime({
    activeChartSourceId,
    activeToolRef,
    activeTradeSnapshotsRef,
    applyLivePriceHorizontalGeometry,
    brokerAccountSessionScope,
    brokerTimeOffsetSec,
    candlesLoadedRev,
    candlesRef,
    chartRef,
    chartSettingsRef,
    chartThemeRef,
    containerRef,
    currentCandleRef,
    drawingRuntimeContextRef,
    getDrawingSeriesData,
    hideLivePriceOverlay,
    isActive,
    isActiveRef,
    isChartInteractionActiveRef,
    isChartSurfaceLight,
    isDisposedRef,
    isLivePriceSafeForCandles,
    livePriceBadgeRef,
    lastRenderedCandlesRef,
    livePriceLineRef,
    livePriceOverlayColorsRef,
    livePriceRef,
    overlayRef,
    postInteractionCallbacksRef,
    postInteractionCoordinatorRef,
    prevSymbolRef,
    prevTimeframeRef,
    repaintTradeOverlayGeometryRef,
    resolvedPriceDigits,
    resolvedPriceDigitsRef,
    seriesRef,
    symbol,
    timeframe,
    tr,
    tradeAllowed,
    tradeLevelCrossRefreshPendingRef,
    visibleRuntime,
  });


  // Relabel existing overlays in place. Changing the interface language must
  // not recreate the chart, reset its viewport, or interrupt a level drag.

  const {
    closeCtxMenu,
    handleContextMenu,
    handleCtxChartTypeChange,
    handleCtxGridTypeChange,
    handleCtxGridLineStyleChange,
    handleCtxDeleteIndicators,
    handleCtxOpenDOM,
    handleCtxOpenNewOrder,
    handleCtxOpenProperties,
    handleCtxRefresh,
    handleCtxSaveAsPicture,
    handleCtxTimeframeChange,
    handleCtxToggleAutoScroll,
    handleCtxToggleChartShift,
    handleCtxToggleGrid,
    handleCtxToggleOHLC,
    handleCtxToggleTradeHistory,
    handleCtxToggleTradeHistoryLine,
    handleCtxToggleTradeLevels,
    handleCtxToggleVolumes,
    handleCtxZoomIn,
    handleCtxZoomOut,
    handleLoadTemplate,
    handleOpenTemplateDialog,
  } = useTradingChartContextMenuController({
    activeChartSourceId,
    activeTimeframe,
    addLocalIndicator,
    applyChartTypeInPlace,
    chartSettingsRef,
    clearLocalIndicators,
    loadHistory,
    localIndicatorManager,
    panelId,
    persistCurrentIndicators,
    prevTimeframeRef,
    refreshCurrentIndicators,
    setCtxAutoScroll,
    setCtxChartShift,
    setCtxMenu,
    setCtxShowTradeHistory,
    setCtxShowTradeHistoryLine,
    setCtxShowTradeLevels,
    setLocalChartType,
    setTemplateDialogMode,
    setTemplateDialogOpen,
    symbol,
    timeframe,
  });

  // ── Render ─────────────────────────────────────────────────────────────────
return (
    <TradingChartView
      activeChartSourceId={activeChartSourceId}
      activeTimeframe={activeTimeframe}
      addLocalIndicator={addLocalIndicator}
      bindDrawingManagerToChart={bindDrawingManagerToChart}
      centerRef={centerRef}
      chartSettings={chartSettings}
      chartTheme={chartTheme}
      closeCtxMenu={closeCtxMenu}
      containerRef={containerRef}
      ctxAutoScroll={ctxAutoScroll}
      ctxChartShift={ctxChartShift}
      ctxMenu={ctxMenu}
      ctxShowTradeHistory={ctxShowTradeHistory}
      ctxShowTradeHistoryLine={ctxShowTradeHistoryLine}
      ctxShowTradeLevels={ctxShowTradeLevels}
      currentIndicators={currentIndicators}
      drawingRuntimeContextRef={drawingRuntimeContextRef}
      handleContextMenu={handleContextMenu}
      handleCtxChartTypeChange={handleCtxChartTypeChange}
      handleCtxGridTypeChange={handleCtxGridTypeChange}
      handleCtxGridLineStyleChange={handleCtxGridLineStyleChange}
      handleCtxDeleteIndicators={handleCtxDeleteIndicators}
      handleCtxOpenDOM={handleCtxOpenDOM}
      handleCtxOpenNewOrder={handleCtxOpenNewOrder}
      handleCtxOpenProperties={handleCtxOpenProperties}
      handleCtxRefresh={handleCtxRefresh}
      handleCtxSaveAsPicture={handleCtxSaveAsPicture}
      handleCtxTimeframeChange={handleCtxTimeframeChange}
      handleCtxToggleAutoScroll={handleCtxToggleAutoScroll}
      handleCtxToggleChartShift={handleCtxToggleChartShift}
      handleCtxToggleGrid={handleCtxToggleGrid}
      handleCtxToggleOHLC={handleCtxToggleOHLC}
      handleCtxToggleTradeHistory={handleCtxToggleTradeHistory}
      handleCtxToggleTradeHistoryLine={handleCtxToggleTradeHistoryLine}
      handleCtxToggleTradeLevels={handleCtxToggleTradeLevels}
      handleCtxToggleVolumes={handleCtxToggleVolumes}
      handleCtxZoomIn={handleCtxZoomIn}
      handleCtxZoomOut={handleCtxZoomOut}
      handleLoadTemplate={handleLoadTemplate}
      handleOpenTemplateDialog={handleOpenTemplateDialog}
      horizLineRef={horizLineRef}
      initialLivePriceOverlayColors={initialLivePriceOverlayColors}
      isAdvancedUntitledLight={isAdvancedUntitledLight}
      livePriceBadgeRef={livePriceBadgeRef}
      livePriceCountdownRef={livePriceCountdownRef}
      livePriceLineRef={livePriceLineRef}
      livePriceValueRef={livePriceValueRef}
      loadingMessageIdx={loadingMessageIdx}
      loadingMessages={loadingMessages}
      retainedPublicChartSurface={retainedPublicChartSurface}
      loadingPhase={loadingPhase}
      localChartType={localChartType}
      marketStatus={marketStatus}
      maxVolume={maxVolume}
      minVolume={minVolume}
      ohlcCloseRef={ohlcCloseRef}
      ohlcHighRef={ohlcHighRef}
      ohlcLowRef={ohlcLowRef}
      ohlcOpenRef={ohlcOpenRef}
      overlayRef={overlayRef}
      panelId={panelId}
      priceLabelRef={priceLabelRef}
      setTemplateDialogOpen={setTemplateDialogOpen}
      setTextInputOverlay={setTextInputOverlay}
      setTextInputValue={setTextInputValue}
      showOneClick={showOneClick}
      symbol={symbol}
      templateDialogMode={templateDialogMode}
      templateDialogOpen={templateDialogOpen}
      textInputOverlay={textInputOverlay}
      textInputValue={textInputValue}
      timeframe={timeframe}
      timeLabelRef={timeLabelRef}
      toggleOneClickTrading={toggleOneClickTrading}
      tradeAllowed={tradeAllowed}
      tr={tr}
      useEnterpriseLightChartPalette={useEnterpriseLightChartPalette}
      vertLineRef={vertLineRef}
      volumeStep={volumeStep}
    />
  );
});
