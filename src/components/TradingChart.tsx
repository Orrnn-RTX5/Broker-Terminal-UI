/**
 * Clean MT5-Style Trading Chart
 * - Loads historical OHLC from Swagger candle endpoints
 * - WebSocket live tick updates
 * - Single price line (MT5 style)
 * - Proper candle aggregation
 */

import React, { useEffect, useRef, useState, useCallback, useMemo, useId } from 'react';
import {
  createChart,
  createSeriesMarkers,
  ColorType,
  CrosshairMode,
  TickMarkType,
  CandlestickSeries,
  LineSeries,
  BarSeries,
  AreaSeries,
  HistogramSeries,
} from 'lightweight-charts';
import type { IChartApi, ISeriesApi, Time } from 'lightweight-charts';
import { useToolbarState } from '../hooks/useToolbarState';
import { useCrosshair } from '../hooks/useCrosshair';
import { useQuoteSubscription } from '../hooks/useQuoteSubscription';
import { useWebSocketStore } from '../store/useWebSocketStore';
import { drawingManager } from '../services/drawingManager';
import { getEnhancedWebSocketService } from '../services/websocket-enhanced';
import { candleAggregationService, getTimeframeSeconds, type OHLCV, type Timeframe as AggTimeframe } from '../services/candleAggregationService';
import { useAppStore } from '../store/useAppStore';
import api from '../services/api';
import { useDockLayoutStore } from '../store/useDockLayoutStore';
import { useMarketDataStore } from '../store/useMarketDataStore';
import { commandBus } from '../services/commandBus';
import { OneClickTrading } from './OneClickTrading';
import { DrawingContextMenu } from './DrawingContextMenu';
import { PriceDisplay } from './ui/PriceDisplay';
import { getSymbolDigits } from '../utils/symbolUtils';
import { ChartContextMenu } from './ChartContextMenu';
import { captureFullPage } from '../services/screenshotService';
import { indicatorManager } from '../services/indicatorManager';
import { chartDataService } from '../services/chartDataService';
import {
  getMedianCandlePrice,
  getReferenceScaleFactor,
  isPriceCompatibleWithCandles,
  normalizeCandlesToReference,
  normalizeCandlesToRenderedScale,
  resetLiveQuoteGuardState,
  scaleCandlePrices,
  updateLiveQuoteGuardState,
} from '../services/chartPriceGuards';
import { ChartTemplateDialog } from './ChartTemplateDialog';
import { type ChartTemplate } from '../store/useTemplateStore';
import { useChartSettingsStore } from '../store/useChartSettingsStore';
import {
  getTradingChartDefaultRightPadBars,
  getTradingChartDefaultVisibleBars,
  getTradingChartShiftRightOffset,
  formatTradingChartCrosshairLabel,
  formatTradingChartTickLabel,
  getTradingChartTickMarkCharacterLength,
  shouldTradingChartFooterPromoteLeftEdgeDateLabel,
} from '../utils/chartTimeFormat';
import { alignTimeframeBoundarySeconds } from '../utils/timeframeBoundary';
import {
  activateActiveChartSource,
  findLargestChartCanvas,
  registerActiveChartSource,
} from '../services/activeChartSource';

export type ChartType = 'candlestick' | 'bar' | 'line' | 'area';
export type Timeframe = 'M1' | 'M5' | 'M15' | 'M30' | 'H1' | 'H4' | 'D1' | 'W1' | 'MN';

// MT5-style "comfortable" candle width — used to compute how many bars to fit
// across the visible chart area on initial-load and on axis reset. Adapting to
// container width keeps the look consistent whether the panel is narrow or wide.
const TARGET_BAR_PX = 25;
const MIN_ADAPTIVE_BARS = 30;
const MAX_ADAPTIVE_BARS = 200;
const TRADE_LEVEL_OVERRIDES_STORAGE_KEY = 'rtx-trade-level-overrides-v1';
const TRADE_LEVEL_OVERRIDE_TTL_MS = 5 * 60 * 1000;

type TradeLevelRole = 'ENTRY' | 'SL' | 'TP';

interface TradeLevelOverride {
  sl: number;
  tp: number;
}

const computeAdaptiveVisibleBars = (
  container: HTMLElement | null,
  chart: IChartApi | null,
  totalBars: number,
  minBarsFloor: number,
): number => {
  const containerWidth = container?.offsetWidth || 1400;
  const axisWidth = chart?.priceScale('right').width() || 60;
  const chartWidth = Math.max(200, containerWidth - axisWidth);
  const adaptive = Math.floor(chartWidth / TARGET_BAR_PX);
  const floor = Math.max(MIN_ADAPTIVE_BARS, minBarsFloor);
  return Math.min(totalBars, Math.max(floor, Math.min(MAX_ADAPTIVE_BARS, adaptive)));
};

interface Candle {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

type TradeSide = 'BUY' | 'SELL';

interface ActiveTradeSnapshot {
  key: string;
  symbol: string;
  side: TradeSide;
  volume: number;
  entryPrice: number;
  entryTime: number;
  currentPrice: number;
  currentTime: number;
  sl?: number;
  tp?: number;
}

interface ClosedTradeSnapshot {
  key: string;
  symbol: string;
  side: TradeSide;
  volume: number;
  entryPrice: number;
  entryTime: number;
  exitPrice: number;
  exitTime: number;
  profit?: number;
  source: 'mt5-history' | 'app-history' | 'optimistic';
}

interface OverlayNodeData {
  kind: 'horizontal-line' | 'price-badge' | 'segment' | 'marker' | 'label';
  price?: number;
  time?: number;
  endPrice?: number;
  endTime?: number;
  markerSide?: TradeSide;
  labelOffsetX?: number;
  labelOffsetY?: number;
  resolveEndPrice?: () => number | null;
  resolveEndTime?: () => number | null;
}

interface PriceLevelOptions {
  tradeKey?: string;
  role?: TradeLevelRole;
  badgeOffsetIndex?: number;
  title?: string;
}

interface TradingChartProps {
  symbol: string;
  timeframe?: Timeframe;
  chartType?: ChartType;
  panelId?: string;
}

export const TradingChart = React.memo(function TradingChart({
  symbol,
  timeframe = 'M5',
  chartType = 'candlestick',
  panelId,
}: TradingChartProps) {
  const authToken = useAppStore((state) => state.authToken);
  const chartInstanceId = useId().replace(/[^a-zA-Z0-9_-]/g, '');
  const [activeTimeframe, setActiveTimeframe] = useState<Timeframe>(timeframe);
  const activeChartSourceId = useMemo(
    () => `trading-chart:${panelId || chartInstanceId}`,
    [chartInstanceId, panelId],
  );
  const chartQuoteSourceId = useMemo(() => {
    const normalizedSymbol = symbol.replace(/[^a-zA-Z0-9]/g, '').toUpperCase() || 'UNKNOWN';
    return `chart:${panelId || chartInstanceId}:${normalizedSymbol}`;
  }, [chartInstanceId, panelId, symbol]);

  useQuoteSubscription(symbol ? [symbol] : [], chartQuoteSourceId);

  // Debug: Log ACTUAL mount (not every re-render)
  useEffect(() => {
    console.log(`[TradingChart] MOUNTED: symbol=${symbol}, timeframe=${timeframe}`);
    return () => console.log(`[TradingChart]  UNMOUNTED: symbol=${symbol}`);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const containerRef = useRef<HTMLDivElement>(null); // Main chart refs
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<ISeriesApi<any> | null>(null);
  const volumeRef = useRef<ISeriesApi<any> | null>(null);
  const priceLineRef = useRef<any>(null); // Kept as 'any' as IPriceLine is not imported
  const autoScrollEnabledRef = useRef(useToolbarState().state.autoScrollEnabled);
  // Tracks current active drawing tool — used inside event-handler closures
  const activeToolRef = useRef<string | null>(null);
  const overlayRef = useRef<HTMLDivElement>(null);
  const chartExportMetadataRef = useRef({ symbol, timeframe: activeTimeframe });

  // Custom crosshair
  const [crosshairEnabled, setCrosshairEnabled] = useState(false);
  const crosshairEnabledRef = useRef(false);
  crosshairEnabledRef.current = crosshairEnabled;
  const { vertLineRef, horizLineRef, centerRef, timeLabelRef, priceLabelRef } = useCrosshair({
    chartRef,
    seriesRef,
    containerRef,
    enabled: crosshairEnabled,
    digits: getSymbolDigits(symbol),
    timeframe,
  });

  useEffect(() => {
    chartExportMetadataRef.current = { symbol, timeframe: activeTimeframe };
  }, [activeTimeframe, symbol]);

  useEffect(() => {
    const unregister = registerActiveChartSource({
      id: activeChartSourceId,
      getContainer: () => containerRef.current,
      getCanvas: () => findLargestChartCanvas(containerRef.current),
      getSymbol: () => chartExportMetadataRef.current.symbol,
      getTimeframe: () => chartExportMetadataRef.current.timeframe,
    });

    const activate = () => activateActiveChartSource(activeChartSourceId);
    const container = containerRef.current;
    activate();

    if (container) {
      container.addEventListener('pointerenter', activate);
      container.addEventListener('pointerdown', activate);
      container.addEventListener('focusin', activate);
    }

    return () => {
      if (container) {
        container.removeEventListener('pointerenter', activate);
        container.removeEventListener('pointerdown', activate);
        container.removeEventListener('focusin', activate);
      }
      unregister();
    };
  }, [activeChartSourceId]);

  const ohlcOpenRef = useRef<HTMLSpanElement>(null);
  const ohlcHighRef = useRef<HTMLSpanElement>(null);
  const ohlcLowRef = useRef<HTMLSpanElement>(null);
  const ohlcCloseRef = useRef<HTMLSpanElement>(null);
  const ohlcVolumeRef = useRef<HTMLSpanElement>(null);
  const countdownTextRef = useRef<HTMLSpanElement>(null);

  const updateLegendDOM = useCallback((o: number, h: number, l: number, c: number, v: number) => {
    const digits = getSymbolDigits(symbol);
    if (ohlcOpenRef.current) ohlcOpenRef.current.textContent = o.toFixed(digits);
    if (ohlcHighRef.current) ohlcHighRef.current.textContent = h.toFixed(digits);
    if (ohlcLowRef.current) ohlcLowRef.current.textContent = l.toFixed(digits);
    if (ohlcCloseRef.current) ohlcCloseRef.current.textContent = c.toFixed(digits);
    if (ohlcVolumeRef.current) ohlcVolumeRef.current.textContent = Math.round(v).toLocaleString();
  }, [symbol]);

  type LoadingPhase = 'connecting' | 'receiving' | 'ready' | 'hidden';
  const [loadingPhase, setLoadingPhase] = useState<LoadingPhase>('connecting');
  const [loadingMessageIdx, setLoadingMessageIdx] = useState(0);
  const loadingMessages = useMemo(() => [
    'Connecting to market data…',
    `Receiving ${symbol} candles…`,
    'Warming up the data feed…',
  ], [symbol]);
  const [showOneClick, setShowOneClick] = useState(true);
  const [apiError, setApiError] = useState<string | null>(null);
  // Inline text-input overlay for the text drawing tool (replaces browser prompt)
  const [textInputOverlay, setTextInputOverlay] = useState<{ x: number; y: number; time: number; price: number } | null>(null);
  const [textInputValue, setTextInputValue] = useState('');

  // ── Chart Context Menu state ──
  const [ctxMenu, setCtxMenu] = useState<{ visible: boolean; x: number; y: number }>({
    visible: false, x: 0, y: 0,
  });
  const [ctxAutoScroll, setCtxAutoScroll] = useState(() => {
    const state = useChartSettingsStore.getState();
    return state.symbolProperties[symbol]?.chartAutoScroll ?? state.globalProperties.chartAutoScroll;
  });
  const [ctxChartShift, setCtxChartShift] = useState(() => {
    const state = useChartSettingsStore.getState();
    return state.symbolProperties[symbol]?.chartShift ?? state.globalProperties.chartShift;
  });
  const [ctxShowTradeLevels, setCtxShowTradeLevels] = useState(() => {
    const state = useChartSettingsStore.getState();
    return state.symbolProperties[symbol]?.showTradeLevels ?? state.globalProperties.showTradeLevels;
  });
  const [localChartType, setLocalChartType] = useState<ChartType>(chartType);
  const [templateDialogOpen, setTemplateDialogOpen] = useState(false);
  const [templateDialogMode, setTemplateDialogMode] = useState<'save' | 'load'>('save');
  const [candlesLoadedRev, setCandlesLoadedRev] = useState(0);
  const [brokerTimeOffsetSec, setBrokerTimeOffsetSec] = useState(0);

  const markCandlesReady = useCallback(() => {
    setApiError(null);
    setLoadingPhase(prev => (prev === 'connecting' || prev === 'receiving' ? 'ready' : prev));
  }, []);

  const candlesRef = useRef<Candle[]>([]);
  const currentCandleRef = useRef<Candle | null>(null);
  const prevPriceRef = useRef<number | null>(null);
  const isDisposedRef = useRef(false);
  const isRebuildingRef = useRef(false);
  // Tracks the last completed M1 candle time (seconds) received from the server store.
  // Shared between the 100ms poll interval and loadHistory so both stay in sync.
  const lastStoreCandleSecRef = useRef(0);
  // Tracks whether the right-click context menu is open — read inside wheelHandler closure
  const ctxMenuOpenRef = useRef(false);
  // Tracks current bar spacing (px/bar) for the time-axis zoom gesture
  const pixelsPerBarRef = useRef(2);

  // ── Live crosshair line DOM refs (no React state, direct DOM for 60fps) ──
  const crosshairLineRef = useRef<HTMLDivElement | null>(null);
  const crosshairBadgeRef = useRef<HTMLDivElement | null>(null);

  // ── Live current-price line + badge (permanent, like MT5 last-price indicator) ──
  const livePriceLineRef = useRef<HTMLDivElement | null>(null);
  const livePriceBadgeRef = useRef<HTMLDivElement | null>(null);
  const livePriceRef = useRef<number | null>(null);
  const leftVisibleTimeRef = useRef<number | null>(null);
  const lastAcceptedQuoteRef = useRef<number | null>(null);
  const incompatibleQuoteCountRef = useRef(0);

  const resetLiveQuotePriceGuard = useCallback(() => {
    const reset = resetLiveQuoteGuardState();
    lastAcceptedQuoteRef.current = reset.lastAcceptedQuote;
    incompatibleQuoteCountRef.current = reset.incompatibleQuoteCount;
  }, []);

  const hideLivePriceOverlay = useCallback((clearPrice = true) => {
    if (clearPrice) livePriceRef.current = null;
    if (livePriceLineRef.current) {
      livePriceLineRef.current.style.display = 'none';
      livePriceLineRef.current.style.top = '-9999px';
    }
    if (livePriceBadgeRef.current) {
      livePriceBadgeRef.current.style.display = 'none';
      livePriceBadgeRef.current.style.top = '-9999px';
      if (clearPrice) livePriceBadgeRef.current.textContent = '';
    }
  }, []);

  const renderLivePriceOverlay = useCallback((bid: number) => {
    livePriceRef.current = bid;

    if (!livePriceLineRef.current || !livePriceBadgeRef.current || !seriesRef.current) return;

    const y = seriesRef.current.priceToCoordinate(bid);
    if (y === null || y === undefined) {
      hideLivePriceOverlay(false);
      return;
    }

    const digits = getSymbolDigits(symbol);
    const badgeColor = '#5A5A66'; // MT5-style solid gray
    const scaleW = seriesRef.current.priceScale().width();

    livePriceLineRef.current.style.top = `${y}px`;
    livePriceLineRef.current.style.right = `${scaleW}px`;
    livePriceLineRef.current.style.borderTopColor = badgeColor;
    livePriceLineRef.current.style.display = 'block';

    livePriceBadgeRef.current.style.top = `${y}px`;
    livePriceBadgeRef.current.style.width = `${scaleW}px`;
    livePriceBadgeRef.current.style.background = badgeColor;
    livePriceBadgeRef.current.textContent = bid.toFixed(digits);
    livePriceBadgeRef.current.style.display = 'block';
  }, [hideLivePriceOverlay, symbol]);

  const resetEmptyHistoryState = useCallback((activeTf: Timeframe) => {
    candlesRef.current = [];
    currentCandleRef.current = null;
    prevPriceRef.current = null;
    hideLivePriceOverlay();
    leftVisibleTimeRef.current = null;
    hasReachedBeginningRef.current = false;
    isLoadingMoreRef.current = false;
    lastStoreCandleSecRef.current = 0;
    resetLiveQuotePriceGuard();
    candleAggregationService.loadHistoricalCandles(symbol, activeTf as AggTimeframe, []);
  }, [hideLivePriceOverlay, resetLiveQuotePriceGuard, symbol]);

  // Keep ctxMenuOpenRef in sync so the wheelHandler (closed over the ref) can read it
  useEffect(() => {
    ctxMenuOpenRef.current = ctxMenu.visible;
  }, [ctxMenu.visible]);

  // Listen for Alt+T toggle-one-click-trading event from GlobalShortcuts
  useEffect(() => {
    const handler = () => setShowOneClick(prev => !prev);
    // window.addEventListener('toggle-one-click-trading', handler);
    return () => window.removeEventListener('toggle-one-click-trading', handler);
  }, []);

  // Infinite scroll tracking
  const isLoadingMoreRef = useRef(false);
  const hasReachedBeginningRef = useRef(false);
  const loadMoreHistoryRef = useRef<(() => Promise<void>) | null>(null);
  // Exposes scheduleBoundaryTimer from inside the live-tick effect so loadHistory
  // can kick it as soon as currentCandleRef is populated (they run in parallel).
  const scheduleBoundaryTimerRef = useRef<(() => void) | null>(null);
  // Exposes loadHistory so the boundary poller can trigger a silent chart re-fetch
  // at every minute rollover — guaranteed fallback when rollover() alone is not enough.
  const loadHistoryRef = useRef<(() => void) | null>(null);

  const chartSettings = useChartSettingsStore(state =>
    state.symbolProperties[symbol] || state.globalProperties
  );
  const chartSettingsRef = useRef(chartSettings);

  useEffect(() => {
    chartSettingsRef.current = chartSettings;
    setCtxShowTradeLevels(chartSettings.showTradeLevels);
  }, [chartSettings]);

  const [isAdvancedUntitledLight, setIsAdvancedUntitledLight] = useState(() => {
    if (typeof document === 'undefined') return false;
    const root = document.documentElement;
    return root.classList.contains('rtx-advanced-view') && root.classList.contains('rtx-skin-untitled-light');
  });

  useEffect(() => {
    const root = document.documentElement;
    const syncSkinState = () => {
      setIsAdvancedUntitledLight(
        root.classList.contains('rtx-advanced-view') && root.classList.contains('rtx-skin-untitled-light')
      );
    };
    syncSkinState();
    const observer = new MutationObserver(syncSkinState);
    observer.observe(root, { attributes: true, attributeFilter: ['class'] });
    return () => observer.disconnect();
  }, []);

  const chartColors = useMemo(() => {
    if (isAdvancedUntitledLight && chartSettings.colorScheme === 'Green on Black') {
      return {
        ...chartSettings.colors,
        background: '#ffffff',
        foreground: '#475467',
        grid: '#e5e7eb',
      };
    }
    return chartSettings.colors;
  }, [chartSettings.colors, chartSettings.colorScheme, isAdvancedUntitledLight]);

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
    const normalizedSymbol = symbol.replace(/[^a-zA-Z0-9]/g, '').toUpperCase();
    const ticks = useAppStore.getState().ticks;
    const tick = ticks[symbol]
      ?? ticks[symbol.toUpperCase()]
      ?? (() => {
        const key = Object.keys(ticks).find(k =>
          k.replace(/[^a-zA-Z0-9]/g, '').toUpperCase() === normalizedSymbol);
        return key ? ticks[key] : undefined;
      })();

    const bid = Number(tick?.bid ?? tick?.last);
    const ask = Number(tick?.ask ?? tick?.bid ?? tick?.last);
    if (Number.isFinite(bid) && Number.isFinite(ask) && bid > 0 && ask > 0) {
      return (bid + ask) / 2;
    }
    if (Number.isFinite(bid) && bid > 0) return bid;
    return null;
  }, [symbol]);

  const reconcileCandlesWithLiveQuote = useCallback((candles: Candle[], context: string): Candle[] => {
    const referencePrice = resolveCurrentQuote();
    const result = referencePrice
      ? normalizeCandlesToReference(candles, referencePrice)
      : normalizeCandlesToRenderedScale(candles, candlesRef.current);

    if (result.status === 'scaled') {
      const source = referencePrice ? 'live quote' : 'rendered candle';
      console.warn(`[Chart] Normalized ${symbol} ${context} candles by factor ${result.factor} to match ${source} scale.`);
    } else if (result.status === 'incompatible') {
      const source = referencePrice ? `live quote ${referencePrice}` : 'rendered candles';
      console.warn(`[Chart] Ignoring ${symbol} ${context} candles because their price range is incompatible with ${source}.`);
      setApiError(`${symbol} candle range differs from ${referencePrice ? 'live quote' : 'rendered chart'}; waiting for matching ${timeframe} data.`);
    }

    return result.candles as Candle[];
  }, [resolveCurrentQuote, symbol, timeframe]);

  const isLivePriceSafeForCandles = useCallback((price: number): boolean => {
    const candles = candlesRef.current;
    if (candles.length === 0) return true;
    return isPriceCompatibleWithCandles(price, candles);
  }, []);

  const syncLeftVisibleTime = useCallback(() => {
    const chart = chartRef.current;
    const candles = candlesRef.current;

    if (!chart || candles.length === 0) {
      leftVisibleTimeRef.current = null;
      return;
    }

    const visibleRange = chart.timeScale().getVisibleLogicalRange();
    if (!visibleRange) {
      leftVisibleTimeRef.current = candles[0]?.time ?? null;
      return;
    }

    const leftIndex = Math.max(0, Math.min(candles.length - 1, Math.floor(visibleRange.from)));
    leftVisibleTimeRef.current = candles[leftIndex]?.time ?? candles[0]?.time ?? null;
  }, []);
  const formatCrosshairTime = useCallback(
    (time: Time) => formatTradingChartCrosshairLabel(time, timeframe, brokerTimeOffsetSec),
    [brokerTimeOffsetSec, timeframe],
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
        { forceDateLabel },
      );
    },
    [brokerTimeOffsetSec, normalizeChartTimeToUnixSeconds, timeframe],
  );

  // Initialize chart
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
    isDisposedRef.current = false;

    const rootStyle = getComputedStyle(document.body);
    const textColor = rootStyle.getPropertyValue('--text-secondary').trim() || '#A1A1AA';

    console.log(`[TradingChart] Container size: ${containerRef.current.offsetWidth}x${containerRef.current.offsetHeight}`);

    const chart = createChart(containerRef.current, {
      autoSize: true,
      layout: {
        background: { type: ColorType.Solid, color: chartColors.background },
        textColor: chartColors.foreground,
        attributionLogo: false,
      },
      grid: {
        vertLines: { color: 'transparent' },
        horzLines: { color: 'transparent' },
      },
      crosshair: {
        mode: CrosshairMode.Normal,
        // Arrow/cursor is the default tool — hide crosshair lines until a drawing tool is selected
        vertLine: { visible: false, color: chartColors.foreground, width: 1, style: 2, labelVisible: false },
        horzLine: { visible: false, color: chartColors.foreground, width: 1, style: 2, labelVisible: false },
      },
      handleScroll: {
        vertTouchDrag: false,
        horzTouchDrag: true,
        mouseWheel: false,      // custom handler does the scrolling
        pressedMouseMove: true, // body drag pans the chart; auto-scroll snaps back after inactivity
      },
      handleScale: {
        axisPressedMouseMove: { time: false, price: true },  // MT5-style: drag price axis to zoom vertically
        axisDoubleClickReset: { time: false, price: false },  // handled manually below
        mouseWheel: false,      // wheel never zooms
        pinch: false,
      },
      rightPriceScale: {
        borderColor: chartColors.foreground,
        scaleMargins: { top: 0.05, bottom: 0.32 },
        autoScale: !chartSettings.scaleFixOneToOne,
      },
      timeScale: {
        borderColor: chartColors.foreground,
        timeVisible: true,
        secondsVisible: false,
        tickMarkMaxCharacterLength: getTradingChartTickMarkCharacterLength(timeframe),
        barSpacing: 2,
        minBarSpacing: 1,
        rightOffset: getTradingChartShiftRightOffset(timeframe, ctxChartShift),
        fixLeftEdge: false,
        fixRightEdge: !ctxChartShift,
      },
    });

    chartRef.current = chart;
    indicatorManager.setChart(chart);

    // Initial setup handled by autoSize: true

    // ─── MT5-style Auto-Scroll (Snap back to live after 3s of inactivity) ───
    let autoScrollTimer: ReturnType<typeof setTimeout> | null = null;
    let isUserInteracting = false;
    // autoScrollEnabled is now managed by autoScrollEnabledRef

    const resetAutoScrollTimer = () => {
      if (autoScrollTimer) clearTimeout(autoScrollTimer);
      if (isDisposedRef.current || !chartRef.current || !autoScrollEnabledRef.current || !chartSettings.chartAutoScroll) return;

      autoScrollTimer = setTimeout(() => {
        if (!isDisposedRef.current && chartRef.current && !isUserInteracting && autoScrollEnabledRef.current && chartSettings.chartAutoScroll) {
          chartRef.current.timeScale().scrollToRealTime();
        }
        autoScrollTimer = null;
      }, 3000); // 3 seconds after last interaction
    };

    const handleInteractionStart = () => {
      isUserInteracting = true;
      if (autoScrollTimer) clearTimeout(autoScrollTimer);
    };

    const handleInteractionEnd = () => {
      isUserInteracting = false;
      resetAutoScrollTimer();
    };

    let wheelEndTimer: ReturnType<typeof setTimeout> | null = null;
    const wheelHandler = (e: WheelEvent) => {
      // Block scroll while the right-click context menu is open
      if (ctxMenuOpenRef.current) return;

      // If scroll is happening inside a modal/dialog/popup, let the browser handle it natively
      const target = e.target as HTMLElement | null;
      if (target) {
        // Walk up the DOM — if we hit a dialog, modal overlay, or a scrollable container
        // that is NOT the chart, bail out immediately so the dialog can scroll normally.
        let node: HTMLElement | null = target;
        while (node && node !== document.body) {
          const tag = node.tagName?.toLowerCase();
          const role = node.getAttribute?.('role')?.toLowerCase();
          const cls = node.className || '';
          if (
            tag === 'dialog' ||
            role === 'dialog' ||
            role === 'listbox' ||
            (typeof cls === 'string' && (
              cls.includes('modal') ||
              cls.includes('overlay') ||
              cls.includes('popup') ||
              cls.includes('dialog') ||
              cls.includes('dropdown')
            ))
          ) {
            return; // Let the modal handle its own scroll
          }
          // Also allow scroll in any element that itself has overflow scrolling
          // and is NOT our chart container — this covers lists, grids, etc. inside dialogs
          if (node !== containerRef.current && node !== document.documentElement) {
            const style = window.getComputedStyle(node);
            const overflowY = style.overflowY;
            if ((overflowY === 'auto' || overflowY === 'scroll') && node.scrollHeight > node.clientHeight) {
              return; // Let this scrollable element scroll natively
            }
          }
          node = node.parentElement;
        }
      }

      // Check if cursor is over the chart area using position, not DOM contains()
      // contains() fails for overlays/legend that are siblings of containerRef
      if (!containerRef.current) return;
      const rect = containerRef.current.getBoundingClientRect();
      const overChart = e.clientX >= rect.left && e.clientX <= rect.right &&
        e.clientY >= rect.top && e.clientY <= rect.bottom;
      if (!overChart) return;


      e.preventDefault();
      e.stopPropagation();
      if (isDisposedRef.current || !chartRef.current) return;

      const timeScale = chartRef.current.timeScale();
      const visibleRange = timeScale.getVisibleLogicalRange();
      if (!visibleRange) return;

      // Scroll DOWN = pan left (older candles), Scroll UP = pan right (newer)
      const barsPerScroll = Math.max(1, Math.round(Math.abs(e.deltaY) / 20));
      const shift = e.deltaY > 0 ? -barsPerScroll : barsPerScroll;

      console.log(`[Chart] Wheel: deltaY=${e.deltaY}, shift=${shift}`);

      timeScale.setVisibleLogicalRange({
        from: visibleRange.from + shift,
        to: visibleRange.to + shift,
      });

      handleInteractionStart();
      if (wheelEndTimer) clearTimeout(wheelEndTimer);
      wheelEndTimer = setTimeout(() => {
        handleInteractionEnd();
        wheelEndTimer = null;
      }, 200);
    };
    // Attach to window with capture:true — fires BEFORE any other handler
    window.addEventListener('wheel', wheelHandler, { passive: false, capture: true });

    const chartContainer = containerRef.current;
    let priceAxisCleanup: (() => void) | null = null;
    let timeAxisCleanup: (() => void) | null = null;

    if (chartContainer) {
      // Track pointer/drag interactions for auto-scroll timer
      chartContainer.addEventListener('pointerdown', handleInteractionStart);
      chartContainer.addEventListener('pointerup', handleInteractionEnd);
      chartContainer.addEventListener('pointerleave', handleInteractionEnd);
      chartContainer.addEventListener('touchstart', handleInteractionStart, { passive: true });
      chartContainer.addEventListener('touchend', handleInteractionEnd);

      // ── Custom MT5-style price axis drag-to-zoom ─────────────────────
      // lightweight-charts' built-in axisPressedMouseMove can conflict
      // with handleScroll.pressedMouseMove:false, so we implement it manually.
      const priceAxisEl = (() => {
        // lightweight-charts v5 renders a table; the right price axis is the
        // last <td> in the first row of the chart table.
        const tables = chartContainer.querySelectorAll('table');
        for (const table of tables) {
          const tds = table.querySelectorAll('tr:first-child > td');
          if (tds.length >= 2) {
            return tds[tds.length - 1] as HTMLElement; // rightmost td = price axis
          }
        }
        return null;
      })();

      // ── Shared reset helpers (MT5-style double-click defaults) ──────────
      // These match the initial-load fit exactly so a reset truly returns the
      // chart to its starting view — not just changes one option in isolation.
      const resetPriceScaleToDefault = () => {
        if (isDisposedRef.current || !chartRef.current) return;
        chartRef.current.priceScale('right').applyOptions({
          autoScale: true,
          scaleMargins: { top: 0.05, bottom: 0.32 },
        });
      };

      const resetTimeScaleToDefault = () => {
        if (isDisposedRef.current || !chartRef.current) return;
        const tf = prevTimeframeRef.current || timeframe;
        const ts = chartRef.current.timeScale();
        ts.applyOptions({
          rightOffset: getTradingChartShiftRightOffset(tf, ctxChartShift),
        });
        const totalBars = candlesRef.current.length;
        if (totalBars > 0) {
          const visibleBars = computeAdaptiveVisibleBars(
            containerRef.current,
            chartRef.current,
            totalBars,
            getTradingChartDefaultVisibleBars(tf),
          );
          const rightPadBars = getTradingChartDefaultRightPadBars(tf);
          ts.setVisibleLogicalRange({
            from: totalBars - visibleBars,
            to: totalBars + rightPadBars,
          });
          // Keep pixelsPerBarRef in sync with the effective spacing so the next
          // time-axis drag starts from the visible spacing, not the legacy "2".
          const chartW = Math.max(200, (containerRef.current?.offsetWidth || 1400)
            - (chartRef.current.priceScale('right').width() || 60));
          pixelsPerBarRef.current = chartW / (visibleBars + rightPadBars);
        } else {
          pixelsPerBarRef.current = TARGET_BAR_PX;
        }
        ts.scrollToRealTime();
      };

      if (priceAxisEl) {
        const handlePriceAxisDown = (e: MouseEvent) => {
          if (e.button !== 0) return; // left click only
          e.preventDefault();
          e.stopPropagation();

          const startY = e.clientY;
          const priceScale = chart.priceScale('right');
          const opts = priceScale.options();
          const startTop = opts.scaleMargins?.top ?? 0.1;
          const startBottom = opts.scaleMargins?.bottom ?? 0.2;
          const sensitivity = 0.003; // how fast zoom changes per pixel

          // Disable autoScale so manual zoom takes effect
          priceScale.applyOptions({ autoScale: false });

          const onMove = (me: MouseEvent) => {
            const dy = me.clientY - startY; // positive = dragging down
            // Dragging DOWN = zoom out (increase margins)
            // Dragging UP = zoom in (decrease margins)
            const delta = dy * sensitivity;
            const newTop = Math.max(0.01, Math.min(0.45, startTop + delta));
            const newBottom = Math.max(0.01, Math.min(0.45, startBottom + delta));
            priceScale.applyOptions({
              scaleMargins: { top: newTop, bottom: newBottom },
            });
          };

          const onUp = () => {
            window.removeEventListener('mousemove', onMove);
            window.removeEventListener('mouseup', onUp);
          };

          window.addEventListener('mousemove', onMove);
          window.addEventListener('mouseup', onUp);
        };

        priceAxisEl.style.cursor = 'ns-resize';
        priceAxisEl.addEventListener('mousedown', handlePriceAxisDown);

        priceAxisCleanup = () => {
          priceAxisEl.removeEventListener('mousedown', handlePriceAxisDown);
        };
      }

      // ── MT5-style time-axis drag-to-zoom + unified dblclick reset ────────
      // Position-based hit-testing detects which region was double-clicked
      // (time axis / price axis / chart body) and resets accordingly. This
      // avoids the fragile DOM-selector approach for the price axis dblclick
      // and adds the missing chart-body reset.
      {
        const TIME_AXIS_PX = 36; // height of the time-axis strip in px
        const MIN_PX = 1;
        // Allow zoom-in well past the adaptive default (~25px) so users can
        // stretch candles much wider — matches MT5 where you can blow up a
        // single candle to fill a big chunk of the screen.
        const MAX_PX = 150;
        const SENSITIVITY = 0.005;

        const inTimeAxis = (e: MouseEvent) => {
          const r = chartContainer.getBoundingClientRect();
          return e.clientY >= r.bottom - TIME_AXIS_PX
            && e.clientX >= r.left && e.clientX <= r.right;
        };

        const inPriceAxis = (e: MouseEvent) => {
          const r = chartContainer.getBoundingClientRect();
          const w = chartRef.current?.priceScale('right').width() || 60;
          return e.clientX >= r.right - w
            && e.clientY >= r.top && e.clientY < r.bottom - TIME_AXIS_PX;
        };

        const handleTimeAxisDown = (e: MouseEvent) => {
          if (e.button !== 0 || !inTimeAxis(e)) return;
          e.preventDefault();
          e.stopPropagation();

          let localSpacing = pixelsPerBarRef.current;
          let pendingRaf = false;

          const onMove = (me: MouseEvent) => {
            if (me.movementX === 0) return;
            const clamped = Math.max(MIN_PX, Math.min(MAX_PX,
              localSpacing * Math.exp(-me.movementX * SENSITIVITY)));
            if (clamped === localSpacing) return;
            localSpacing = clamped;
            pixelsPerBarRef.current = clamped;
            if (!pendingRaf) {
              pendingRaf = true;
              requestAnimationFrame(() => {
                if (!isDisposedRef.current && chartRef.current) {
                  chartRef.current.timeScale().applyOptions({ barSpacing: localSpacing });
                }
                pendingRaf = false;
              });
            }
          };

          const onUp = () => {
            window.removeEventListener('mousemove', onMove);
            window.removeEventListener('mouseup', onUp);
            document.body.style.cursor = '';
            document.body.style.userSelect = '';
          };

          document.body.style.cursor = 'ew-resize';
          document.body.style.userSelect = 'none';
          window.addEventListener('mousemove', onMove);
          window.addEventListener('mouseup', onUp);
        };

        const handleContainerDblClick = (e: MouseEvent) => {
          if (!chartRef.current) return;
          const onTime = inTimeAxis(e);
          const onPrice = inPriceAxis(e);
          e.preventDefault();
          e.stopPropagation();
          if (onTime && !onPrice) {
            resetTimeScaleToDefault();
          } else if (onPrice && !onTime) {
            resetPriceScaleToDefault();
          } else {
            // Chart body OR corner (both axes) — reset both
            resetTimeScaleToDefault();
            resetPriceScaleToDefault();
          }
        };

        const handleTimeAxisHover = (e: MouseEvent) => {
          chartContainer.style.cursor = inTimeAxis(e) ? 'ew-resize' : '';
        };

        chartContainer.addEventListener('mousedown', handleTimeAxisDown, { capture: true });
        chartContainer.addEventListener('dblclick', handleContainerDblClick);
        chartContainer.addEventListener('mousemove', handleTimeAxisHover);

        timeAxisCleanup = () => {
          chartContainer.removeEventListener('mousedown', handleTimeAxisDown,
            { capture: true } as EventListenerOptions);
          chartContainer.removeEventListener('dblclick', handleContainerDblClick);
          chartContainer.removeEventListener('mousemove', handleTimeAxisHover);
        };
      }
    } // end if (chartContainer)

    // Crosshair move for legend
    const crosshairHandler = (param: any) => {
      if (param.time && seriesRef.current) {
        const data = param.seriesData.get(seriesRef.current) as any;
        const volData = volumeRef.current ? param.seriesData.get(volumeRef.current) as any : null;
        if (data) {
          updateLegendDOM(
            data.open || 0,
            data.high || 0,
            data.low || 0,
            data.close || data.value || 0,
            (volData && volData.value) ? volData.value : 0
          );
        }
      } else {
        const c = currentCandleRef.current;
        if (c) {
          updateLegendDOM(c.open, c.high, c.low, c.close, c.volume);
        }
      }
    };
    chart.subscribeCrosshairMove(crosshairHandler);

    // Infinite scroll range handler
    const logicalRangeHandler = (logicalRange: any) => {
      if (logicalRange && logicalRange.from < 50) {
        if (loadMoreHistoryRef.current) {
          loadMoreHistoryRef.current();
        }
      }
    };
    chart.timeScale().subscribeVisibleLogicalRangeChange(logicalRangeHandler);

    return () => {
      indicatorManager.setChart(null);
      isDisposedRef.current = true;
      if (autoScrollTimer) clearTimeout(autoScrollTimer);
      if (wheelEndTimer) clearTimeout(wheelEndTimer);
      // Remove window-level wheel handler
      window.removeEventListener('wheel', wheelHandler, { capture: true } as EventListenerOptions);
      if (chartContainer) {
        chartContainer.removeEventListener('pointerdown', handleInteractionStart);
        chartContainer.removeEventListener('pointerup', handleInteractionEnd);
        chartContainer.removeEventListener('pointerleave', handleInteractionEnd);
        chartContainer.removeEventListener('touchstart', handleInteractionStart);
        chartContainer.removeEventListener('touchend', handleInteractionEnd);
      }
      if (priceAxisCleanup) priceAxisCleanup();
      if (timeAxisCleanup) timeAxisCleanup();
      chart.unsubscribeCrosshairMove(crosshairHandler);
      chart.timeScale().unsubscribeVisibleLogicalRangeChange(logicalRangeHandler);

      // Delay cleanup to allow any pending lightweight-charts requestAnimationFrame 
      // loops to finish, preventing "Object is disposed" runtime panics.
      const chartToDispose = chartRef.current;
      if (chartToDispose) {
        if ((chartToDispose as any)._cleanupDrawings) {
          (chartToDispose as any)._cleanupDrawings();
        }

        setTimeout(() => {
          try {
            chartToDispose.remove();
            console.log(`[TradingChart] Chart explicitly removed inside setTimeout.`);
          } catch (e) {
            // Ignore late disposal errors
          }
        }, 16); // 16ms = roughly 1 frame
      }

      chartRef.current = null;
      seriesRef.current = null;
      volumeRef.current = null;
      priceLineRef.current = null;
    };
  }, []);

  // Update chart with candles helper
  const updateChartData = useCallback((candles: Candle[], currentChartType?: ChartType) => {
    console.log(`[Chart] updateChartData called with ${candles?.length || 0} candles, type=${currentChartType}`);

    if (isDisposedRef.current) {
      console.log('[Chart] Cannot update - chart disposed');
      return;
    }
    if (!seriesRef.current) {
      console.log('[Chart] Cannot update - series not ready');
      return;
    }
    if (!volumeRef.current) {
      console.log('[Chart] Cannot update - volume series not ready');
      return;
    }

    // Determine the active chart type
    const activeType = currentChartType || prevChartTypeRef.current || 'candlestick';
    const activeTimeframe = prevTimeframeRef.current || timeframe;

    // Deduplicate and strictly sort ascending by time (required by lightweight-charts)
    // Live tick aggregates can occasionally append duplicate times at the end of candlesRef
    const uniqueCandles = new Map<number, Candle>();
    candles.forEach(c => uniqueCandles.set(c.time, c));
    const sortedCandles = Array.from(uniqueCandles.values())
      .filter(c => c.open != null && c.high != null && c.low != null && c.close != null && !isNaN(c.open) && !isNaN(c.close))
      .sort((a, b) => (a.time as number) - (b.time as number));

    // Format data based on chart type
    let formatted: any[];
    if (activeType === 'line' || activeType === 'area') {
      // Line and Area series need { time, value }
      formatted = sortedCandles.map(c => ({
        time: c.time as Time,
        value: c.close,
      }));
    } else {
      // Candlestick and Bar series need { time, open, high, low, close }
      formatted = sortedCandles.map(c => ({
        time: c.time as Time,
        open: c.open,
        high: c.high,
        low: c.low,
        close: c.close,
      }));
    }

    const volumeData = sortedCandles.map(c => ({
      time: c.time as Time,
      value: c.volume,
      color: c.close >= c.open ? 'rgba(0,200,150,0.25)' : 'rgba(255,77,79,0.25)',
    }));

    try {
      seriesRef.current.setData(formatted);
      volumeRef.current.setData(volumeData);

      // Auto-fit to a comfortable MT5-style spacing — adapts to container width
      // so candles render at ~25px wide regardless of panel size.
      seriesRef.current.priceScale().applyOptions({ autoScale: true });
      const totalBars = formatted.length;
      if (totalBars > 0 && chartRef.current) {
        const visibleBars = computeAdaptiveVisibleBars(
          containerRef.current,
          chartRef.current,
          totalBars,
          getTradingChartDefaultVisibleBars(activeTimeframe),
        );
        const rightPadBars = getTradingChartDefaultRightPadBars(activeTimeframe);
        chartRef.current.timeScale().setVisibleLogicalRange({
          from: totalBars - visibleBars,
          to: totalBars + rightPadBars,
        });
        syncLeftVisibleTime();
      }

      // Force chart to take container size (needed inside Electron)
      if (containerRef.current && chartRef.current) {
        const { offsetWidth, offsetHeight } = containerRef.current;
        chartRef.current.applyOptions({ width: offsetWidth, height: offsetHeight });
      }

      indicatorManager.setOHLCData(sortedCandles.map(c => ({
        time: c.time as Time,
        open: c.open,
        high: c.high,
        low: c.low,
        close: c.close,
        volume: c.volume
      })));

      console.log('[Chart] Chart data updated successfully');
    } catch (e) {
      console.warn('[Chart] Error setting chart data:', e);
    }
  }, []);

  const reloadAggregationCandles = useCallback((candles: Candle[], activeTf: Timeframe) => {
    const ohlcvCandles: OHLCV[] = candles.map(c => ({
      time: c.time,
      open: c.open,
      high: c.high,
      low: c.low,
      close: c.close,
      volume: c.volume,
    }));
    candleAggregationService.loadHistoricalCandles(symbol, activeTf as AggTimeframe, ohlcvCandles);
  }, [symbol]);

  const normalizeRenderedCandlesToLivePrice = useCallback((price: number, activeTf: Timeframe): boolean => {
    const candles = candlesRef.current;
    if (candles.length === 0) return true;

    const factor = getReferenceScaleFactor(getMedianCandlePrice(candles), price);
    if (factor === null) return false;
    if (factor === 1) return true;

    console.warn(`[Chart] Normalizing existing ${symbol} candles by factor ${factor} before applying delayed live quote ${price}.`);

    candlesRef.current = candles.map(candle => scaleCandlePrices(candle, factor));
    if (currentCandleRef.current) {
      currentCandleRef.current = scaleCandlePrices(currentCandleRef.current, factor);
    }

    reloadAggregationCandles(candlesRef.current, activeTf);
    updateChartData(candlesRef.current);
    prevPriceRef.current = currentCandleRef.current?.close ?? candlesRef.current[candlesRef.current.length - 1]?.close ?? null;

    return true;
  }, [reloadAggregationCandles, symbol, updateChartData]);

  // Load historical data
  const loadHistory = useCallback(async () => {
    if (isDisposedRef.current || !symbol) {
      console.log('[Chart] Cannot load history - symbol not set or chart disposed');
      return;
    }

    setLoadingPhase('connecting');
    setApiError(null);
    resetLiveQuotePriceGuard();
    const activeTf = prevTimeframeRef.current || timeframe;
    console.log(`[Chart] Loading history for ${symbol}, timeframe: ${activeTf}`);

    try {
      let candles: Candle[] = await chartDataService.fetchCandles({
        symbol,
        timeframe: activeTf,
        count: 500,
      });
      console.log(`[Chart] Received ${candles.length} candles`);

      // If API returns empty candles, initialize series so live ticks can build candles
      if (candles.length === 0) {
        console.log(`[Chart] No historical candles for ${symbol} ${activeTf} — live-only mode`);
        resetEmptyHistoryState(activeTf);
        if (seriesRef.current) seriesRef.current.setData([]);
        if (volumeRef.current) volumeRef.current.setData([]);
        if (chartRef.current) chartRef.current.timeScale().scrollToRealTime();

        // Wait for the very first live tick to establish the true broker boundary.
        // DO NOT seed `currentCandleRef` using `Date.now()` here, because if the
        // PC clock is faster than the MT5 broker, all incoming ticks will be trapped
        // in the 'future' candle and the chart will never rollover (infinite volume bug).
        console.warn(`[Chart] No history for ${symbol} on ${activeTf} — live-only mode (waiting for first live tick)`);
        // Keep overlay up; advance phase so users see "Receiving candles…" instead of
        // a single live-tick candle behind a dismissed loader.
        setLoadingPhase('receiving');
        return;
      }

      // Sort by time ascending
      candles.sort((a, b) => (a.time as number) - (b.time as number));
      candles = reconcileCandlesWithLiveQuote(candles, 'history');

      if (candles.length === 0) {
        resetEmptyHistoryState(activeTf);
        if (seriesRef.current) seriesRef.current.setData([]);
        if (volumeRef.current) volumeRef.current.setData([]);
        setLoadingPhase('receiving');
        return;
      }

      // ── TIMEZONE AUTOCORRECTION ──────────────────────────────────────────────
      // MT5 REST backends often return history in broker time (EET, UTC+2/+3),
      // while live WebSocket ticks stream in UTC. If the REST history is placed
      // artificially in the 'future', it prevents the live ticks from ever 
      // rolling over the chart. We detect >5 min forward drift and shift it back.
      if (candles.length > 0) {
        const lastCandleTime = candles[candles.length - 1].time as number;
        const trueUtcSecs = Date.now() / 1000;
        let detectedBrokerOffsetSecs = 0;

        if (lastCandleTime > trueUtcSecs + 300) {
          const rawOffset = lastCandleTime - trueUtcSecs;
          // MT5 timezone differences are typically in full hour or half-hour increments.
          const offsetSecs = Math.round(rawOffset / 1800) * 1800; // Snap to 30 mins
          detectedBrokerOffsetSecs = offsetSecs;
          console.warn(`[Chart] 🕒 Timezone mismatch detected: REST history is ${offsetSecs / 3600}h ahead. Correcting timeline.`);

          candles.forEach(c => {
            c.time = (c.time as number) - offsetSecs;
          });
        }

        setBrokerTimeOffsetSec(detectedBrokerOffsetSecs);
      }

      candlesRef.current = candles;

      // Feed historical candles into the aggregation service
      // This enables proper candle building from where historical data ends
      const ohlcvCandles: OHLCV[] = candles.map(c => ({
        time: c.time,
        open: c.open,
        high: c.high,
        low: c.low,
        close: c.close,
        volume: c.volume,
      }));
      candleAggregationService.loadHistoricalCandles(symbol, activeTf as AggTimeframe, ohlcvCandles);
      console.log(`[Chart] Loaded ${ohlcvCandles.length} historical candles into aggregation service for ${symbol} ${activeTf}`);

      // Update chart - live data
      setApiError(null);
      updateChartData(candles);

      // Set current forming candle
      if (candles.length > 0) {
        const last = candles[candles.length - 1];

        // CRITICAL: normalize the forming candle's time to the TF boundary start.
        // The API may return a mid-minute timestamp (e.g. 10:30:45 instead of 10:30:00).
        // If we keep 10:30:45 as currentCandleRef.time, then expectedCandleTime (10:30:00)
        // is LESS than it, making the clockInterval condition (current < expected) FALSE:
        // the clock never fires and the forming candle never rolls over to a new bar.
        const tfSec = getTimeframeSeconds(activeTf as AggTimeframe);
        const normalizedTime = alignTimeframeBoundarySeconds(last.time, activeTf as AggTimeframe, tfSec);

        currentCandleRef.current = { ...last, time: normalizedTime };
        updateLegendDOM(last.open, last.high, last.low, last.close, last.volume);
        console.log(`[Chart] Last candle time: ${last.time} → normalized to TF boundary: ${normalizedTime} (${activeTf})`);

        // Advance the store candle cursor so the 100ms poll doesn't re-process
        // candles that were already loaded from the REST API.
        if (activeTf === 'M1' && normalizedTime > lastStoreCandleSecRef.current) {
          lastStoreCandleSecRef.current = normalizedTime;
          console.log(`[Chart] Store candle cursor advanced to ${normalizedTime} after history load`);
        }

        prevPriceRef.current = last.close;

        // Kick the boundary timer now that currentCandleRef is populated.
        // Without this, if the timer fired while history was still loading
        // (currentCandleRef was null), rollover() silently bailed and the chart
        // would stay frozen until the NEXT minute boundary — i.e. it only worked
        // after a page refresh because history was served instantly from cache.
        if (scheduleBoundaryTimerRef.current) {
          scheduleBoundaryTimerRef.current();
        }
      }

      // Full history rendered — let the overlay fade.
      setLoadingPhase('ready');
    } catch (err: any) {
      console.warn('[Chart] Failed to load history:', err);
      // REST failed: keep the overlay up, but advance the label so users know
      // we're still waiting on the WS snapshot rather than stuck connecting.
      setLoadingPhase(prev => (prev === 'connecting' ? 'receiving' : prev));
    } finally {
      setCandlesLoadedRev(r => r + 1);
    }
  }, [symbol, timeframe, reconcileCandlesWithLiveQuote, resetEmptyHistoryState, resetLiveQuotePriceGuard, updateChartData]);

  // Keep loadHistoryRef in sync so the boundary poller can trigger a silent refresh
  useEffect(() => {
    loadHistoryRef.current = loadHistory;
  }, [loadHistory]);

  // Fade the loading overlay out after candles arrive. 'ready' starts the CSS
  // opacity transition; after it finishes we unmount the overlay entirely.
  useEffect(() => {
    if (loadingPhase !== 'ready') return;
    const timer = window.setTimeout(() => setLoadingPhase('hidden'), 400);
    return () => window.clearTimeout(timer);
  }, [loadingPhase]);

  // Rotate the loading status text every 2.5s while the overlay is up, so all
  // three honest progress messages are visible before the snapshot lands on a
  // typical cold start. Index resets the moment we go ready/hidden.
  useEffect(() => {
    if (loadingPhase === 'ready' || loadingPhase === 'hidden') {
      setLoadingMessageIdx(0);
      return;
    }
    const interval = window.setInterval(() => {
      setLoadingMessageIdx(i => (i + 1) % 3);
    }, 2500);
    return () => window.clearInterval(interval);
  }, [loadingPhase]);

  // Load more historical data (infinite scroll)
  const loadMoreHistory = useCallback(async () => {
    if (isDisposedRef.current || !symbol || isLoadingMoreRef.current || hasReachedBeginningRef.current) return;

    const oldestCandle = candlesRef.current[0];
    if (!oldestCandle) return;

    isLoadingMoreRef.current = true;
    console.log(`[Chart] Infinite scroll: Fetching 5000 more candles before ${oldestCandle.time}`);

    try {
      const olderCandles: Candle[] = await chartDataService.fetchCandles({
        symbol,
        timeframe,
        count: 5000,
        to: Math.floor(oldestCandle.time),
      });

      if (olderCandles.length === 0) {
        console.log(`[Chart] Reached absolute beginning of chart history for ${symbol}`);
        hasReachedBeginningRef.current = true;
        return;
      }

      // If we got fewer than requested, we probably hit the beginning of the market data
      if (olderCandles.length < 4000) {
        hasReachedBeginningRef.current = true;
      }

      // Filter out overlapping candles
      const newCandles = olderCandles.filter(c => c.time < oldestCandle.time);
      if (newCandles.length === 0) {
        hasReachedBeginningRef.current = true;
        return;
      }

      newCandles.sort((a, b) => (a.time as number) - (b.time as number));
      console.log(`[Chart] Fetched ${newCandles.length} older candles`);

      // Filter out any candles with null/NaN OHLC values to prevent chart crashes
      const validNewCandles = newCandles.filter(c => c.open != null && c.high != null && c.low != null && c.close != null && !isNaN(c.open) && !isNaN(c.close));
      const reconciledNewCandles = reconcileCandlesWithLiveQuote(validNewCandles, 'older history');
      if (reconciledNewCandles.length === 0) {
        console.warn(`[Chart] Ignoring ${symbol} older history batch because no candles survived price reconciliation.`);
        return;
      }

      // Prepend to current array
      candlesRef.current = [...reconciledNewCandles, ...candlesRef.current];

      // Re-hydrate the chart with the new full array 
      // WITHOUT snapping the viewport to the right edge
      const activeType = prevChartTypeRef.current || 'candlestick';
      let formatted: any[];
      if (activeType === 'line' || activeType === 'area') {
        formatted = candlesRef.current.map(c => ({ time: c.time as Time, value: c.close }));
      } else {
        formatted = candlesRef.current.map(c => ({
          time: c.time as Time, open: c.open, high: c.high, low: c.low, close: c.close
        }));
      }

      const volumeData = candlesRef.current.map(c => ({
        time: c.time as Time,
        value: c.volume,
        color: c.close >= c.open ? 'rgba(0,200,150,0.25)' : 'rgba(255,77,79,0.25)',
      }));

      // Update series but maintain current left logical index so it visually stays in place
      if (seriesRef.current && volumeRef.current && chartRef.current) {
        // Temporarily save current range
        const timeScale = chartRef.current.timeScale();
        const currentPos = timeScale.scrollPosition();

        seriesRef.current.setData(formatted);
        volumeRef.current.setData(volumeData);

        // Shift position rightward so the view doesn't jump
        timeScale.scrollToPosition(currentPos + reconciledNewCandles.length, false);
      }

      // Update aggregation service history with these older ones too
      const ohlcvCandles: OHLCV[] = reconciledNewCandles.map(c => ({
        time: c.time,
        open: c.open,
        high: c.high,
        low: c.low,
        close: c.close,
        volume: c.volume,
      }));
      // We push strictly old candles so prepending isn't perfectly supported by the service,
      // but it mostly cares about building forward, so we can ignore adding historical prior to 0 here.

    } catch (err) {
      console.error('[Chart] Failed to load older history:', err);
    } finally {
      isLoadingMoreRef.current = false;
    }
  }, [symbol, timeframe, reconcileCandlesWithLiveQuote]);

  // Keep ref pointing to the latest loadMoreHistory
  useEffect(() => {
    loadMoreHistoryRef.current = loadMoreHistory;
  }, [loadMoreHistory]);

  // Track previous chart type, symbol, and timeframe to avoid unnecessary recreation
  const prevChartTypeRef = useRef<ChartType>(chartType);
  const prevSymbolRef = useRef<string>(symbol);
  const prevTimeframeRef = useRef<Timeframe>(timeframe);

  useEffect(() => {
    setActiveTimeframe(timeframe);
  }, [timeframe]);

  // Create series when chart type, symbol, or timeframe changes
  useEffect(() => {
    if (isDisposedRef.current || !chartRef.current) return;

    // Check what changed
    const typeChanged = prevChartTypeRef.current !== chartType;
    const symbolChanged = prevSymbolRef.current !== symbol;
    const timeframeChanged = prevTimeframeRef.current !== timeframe;

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

        candlesRef.current = [];
        currentCandleRef.current = null;
        hasReachedBeginningRef.current = false;
        isLoadingMoreRef.current = false;
        resetLiveQuotePriceGuard();
        prevTimeframeRef.current = timeframe;
        // Reset the store candle cursor so first tick on new TF
        // doesn't compare against a stale old-TF boundary.
        lastStoreCandleSecRef.current = 0;

        // Clear existing visual data
        seriesRef.current.setData([]);
        if (volumeRef.current) volumeRef.current.setData([]);

        // Reset aggregation service for new timeframe (pass empty array to trigger clear)
        candleAggregationService.loadHistoricalCandles(symbol, timeframe as AggTimeframe, []);

        // Trigger history load for new timeframe
        loadHistory();
        return;
      } else {
        // ONLY symbol changed. Do NOT destroy the series! (Prevents Lightweight Charts disposal bug)
        console.log(`[TradingChart] Symbol changed to ${symbol}, updating existing series format`);

        candlesRef.current = [];
        currentCandleRef.current = null;
        prevPriceRef.current = null;
        hasReachedBeginningRef.current = false;
        isLoadingMoreRef.current = false;
        resetLiveQuotePriceGuard();
        prevSymbolRef.current = symbol;
        prevTimeframeRef.current = timeframe;

        // Apply new precision
        const digits = getSymbolDigits(symbol);
        const minMove = 1 / Math.pow(10, digits);
        seriesRef.current.applyOptions({
          priceFormat: { type: 'price', precision: digits, minMove }
        });

        // Clear existing visual data
        seriesRef.current.setData([]);
        if (volumeRef.current) volumeRef.current.setData([]);

        // Update drawing manager with new symbol context — pass overlay div directly
        drawingManager.setChart(chartRef.current, seriesRef.current, symbol, 1, overlayRef.current);

        // Trigger history load for new symbol
        loadHistory();
        return;
      }
    }

    // If we're here, chart type changed or it's the very first time. Rebuild required.
    prevChartTypeRef.current = chartType;
    prevSymbolRef.current = symbol;
    prevTimeframeRef.current = timeframe;

    const hasCachedData = candlesRef.current.length > 0;

    if (symbolChanged && !seriesRef.current) {
      candlesRef.current = [];
      currentCandleRef.current = null;
      prevPriceRef.current = null;
      resetLiveQuotePriceGuard();
    }

    // Only block ticks during rebuild when we DON'T have cached data
    // (With cached data, setData happens synchronously — no tick window)
    if (!hasCachedData) {
      isRebuildingRef.current = true;
    }

    // Remove old series
    if (seriesRef.current) {
      try { chartRef.current!.removeSeries(seriesRef.current); } catch { }
      seriesRef.current = null;
    }
    if (volumeRef.current) {
      try { chartRef.current!.removeSeries(volumeRef.current); } catch { }
      volumeRef.current = null;
    }

    // Create new series
    const chart = chartRef.current;
    let series: ISeriesApi<any>;

    // Compute price format based on symbol
    const digits = getSymbolDigits(symbol);
    const minMove = 1 / Math.pow(10, digits); // e.g. 0.01 for 2 digits, 0.00001 for 5
    const priceFormatOpts = { type: 'price' as const, precision: digits, minMove };

    console.log(`[TradingChart] Creating series for chartType=${chartType}, symbol=${symbol}, digits=${digits}`);

    switch (chartType) {
      case 'candlestick':
        series = chart.addSeries(CandlestickSeries, {
          upColor: '#ffffff',       // White fill for bullish body
          downColor: '#000000',     // Black fill for bearish body (hollow look)
          borderVisible: true,
          wickVisible: true,
          borderColor: '#00ff00',
          borderUpColor: '#00ff00', // Lime green border for bullish
          borderDownColor: '#00ff00',// Lime green border for bearish
          wickUpColor: '#00ff00',   // Lime green wick
          wickDownColor: '#00ff00', // Lime green wick
          priceFormat: priceFormatOpts,
          priceLineVisible: false,  // Hide built-in dashed last-value line
          lastValueVisible: false,  // Hide built-in axis label
        });
        break;
      case 'bar':
        series = chart.addSeries(BarSeries, {
          upColor: '#00ff00',
          downColor: '#00ff00',
          priceFormat: priceFormatOpts,
          priceLineVisible: false,
          lastValueVisible: false,
        });
        break;
      case 'line':
        series = chart.addSeries(LineSeries, {
          color: '#2962FF',
          lineWidth: 2,
          priceFormat: priceFormatOpts,
          priceLineVisible: false,
          lastValueVisible: false,
        });
        break;
      case 'area':
        series = chart.addSeries(AreaSeries, {
          lineColor: '#2962FF',
          topColor: 'rgba(41, 98, 255, 0.4)',
          bottomColor: 'rgba(41, 98, 255, 0.0)',
          priceFormat: priceFormatOpts,
          priceLineVisible: false,
          lastValueVisible: false,
        });
        break;
      default:
        series = chart.addSeries(CandlestickSeries, {
          upColor: '#26a69a',
          downColor: '#ef5350',
          priceFormat: priceFormatOpts,
          priceLineVisible: false,
          lastValueVisible: false,
        });
    }


    seriesRef.current = series;
    console.log(`[TradingChart] Series created and stored in ref`);

    // Create volume series
    const volSeries = chart.addSeries(HistogramSeries, {
      color: '#26a69a',
      priceScaleId: '',
      priceFormat: { type: 'volume' },
      lastValueVisible: false,
      priceLineVisible: false,
    });
    volSeries.priceScale().applyOptions({ scaleMargins: { top: 0.68, bottom: 0 } });
    volumeRef.current = volSeries;

    // (price line removed — live DOM badge replaces it)

    // Set data if available
    if (candlesRef.current.length > 0) {
      console.log(`[TradingChart] Setting existing ${candlesRef.current.length} candles`);
      updateChartData(candlesRef.current, chartType);
    } else {
      // Try to load history now that series is ready
      console.log(`[TradingChart] No cached candles, triggering history load`);
      loadHistory();
    }

    // ✅ CRITICAL: Always unblock the tick-polling interval after series is ready.
    // isRebuildingRef was set to true above to prevent ticks landing on a null series.
    // Now that seriesRef.current points to the new series, it is safe to resume ticks.
    isRebuildingRef.current = false;
    console.log('[TradingChart] Series ready — tick polling resumed');

    // Fallback: only trigger if no data yet (not needed when chart type switching with cached data)
    if (!hasCachedData) {
      setTimeout(() => {
        if (candlesRef.current.length === 0 && seriesRef.current) {
          console.log(`[TradingChart] Fallback: triggering delayed history load`);
          loadHistory();
        }
      }, 500);
    }

    // Update drawing manager — pass overlay div directly
    drawingManager.setChart(chart, series, symbol, 1, overlayRef.current);

    // Register scroll lock callbacks so drag on a drawing doesn't pan the chart
    drawingManager.setScrollLockCallbacks(
      () => {
        // Disable chart's pressedMouseMove when a drawing is being dragged
        if (!isDisposedRef.current && chartRef.current) {
          try {
            chartRef.current.applyOptions({
              handleScroll: { mouseWheel: false, pressedMouseMove: false, horzTouchDrag: false },
            });
          } catch (e) { /* disposed */ }
        }
      },
      () => {
        // Re-enable chart pressedMouseMove after drag ends (cursor mode)
        if (!isDisposedRef.current && chartRef.current) {
          try {
            chartRef.current.applyOptions({
              handleScroll: { mouseWheel: false, pressedMouseMove: true, horzTouchDrag: true },
            });
          } catch (e) { /* disposed */ }
        }
      }
    );

    let isDrawingFreehand = false;

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
      const c1 = ts.logicalToCoordinate((intBar + 1) as any);
      if (c0 === null || c1 === null) return intBar;
      const barWidth = c1 - c0;
      if (Math.abs(barWidth) < 0.5) return intBar;
      const fraction = (x - c0) / barWidth;
      return intBar + fraction;
    };
    const clickHandler = (param: any) => {
      console.log(`[TradingChart] 🖱️ CLICK on chart: time=${param.time}, point=${!!param.point}, series=${!!seriesRef.current}, activeToolRef=${activeToolRef.current}`);
      if (!param.point || !seriesRef.current) {
        console.log(`[TradingChart] ❌ Click rejected: point=${!!param.point}, series=${!!seriesRef.current}`);
        return;
      }

      // Bind the interacted panel to drawingManager dynamically
      drawingManager.setChart(chart, seriesRef.current, symbol, 1, overlayRef.current, timeframe);

      let time = param.time;
      if (!time && param.point) {
        const logical = chart.timeScale().coordinateToLogical(param.point.x);
        if (logical !== null && candlesRef.current.length > 0) {
          const lastCandle = candlesRef.current[candlesRef.current.length - 1];
          const lastIndex = candlesRef.current.length - 1;
          const tfSec = getTimeframeSeconds(timeframe as AggTimeframe);
          time = lastCandle.time + (logical - lastIndex) * tfSec;
          console.log(`[TradingChart] Projected click time: logical=${logical}, lastIndex=${lastIndex}, time=${time}`);
        }
      }

      if (!time) {
        console.log(`[TradingChart] ❌ Click rejected: time is undefined and could not be projected`);
        return;
      }

      const activeDrawing = drawingManager.getActiveDrawing();
      console.log(`[TradingChart] 📐 activeDrawing=${!!activeDrawing}, type=${activeDrawing?.type}, points=${activeDrawing?.points?.length}`);
      if (activeDrawing && activeDrawing.type !== 'freehand') {
        const price = seriesRef.current.coordinateToPrice(param.point.y);
        if (price !== null) {
          const rect = containerRef.current?.getBoundingClientRect();
          const clientX = rect ? rect.left + param.point.x : param.point.x;
          const clientY = rect ? rect.top + param.point.y : param.point.y;

          // Text tool: show input on first click (before any point placed)
          if (activeDrawing.type === 'text' && activeDrawing.points.length === 0) {
            setTextInputOverlay({ x: clientX, y: clientY, time: time as number, price });
            setTextInputValue('');
            return; // Wait for text submission
          }

          // Callout tool: place first point normally, show text input on second click
          if (activeDrawing.type === 'callout' && activeDrawing.points.length === 1) {
            // Place the second point first (label box position)
            drawingManager.addPoint(time as number, price);
            // Now prompt for the label text
            setTextInputOverlay({ x: clientX, y: clientY - 40, time: time as number, price });
            setTextInputValue('');
            return;
          }

          const rawX = (param.sourceEvent && containerRef.current)
            ? (param.sourceEvent.clientX - containerRef.current.getBoundingClientRect().left)
            : param.point.x;
          // pixelXOffset = cursor pixel minus bar-centre pixel
          // Mirrors how hline stores price offset — continuous, no integer snapping
          const logical = chart.timeScale().coordinateToLogical(param.point.x);
          const barCenterX = logical !== null ? chart.timeScale().logicalToCoordinate(logical as any) : null;
          const pixelXOffset = barCenterX !== null ? rawX - barCenterX : 0;
          console.log('[VLine][1-CLICK] rawX=', rawX,
            '| barCenterX=', barCenterX,
            '| pixelXOffset=', pixelXOffset,
            '(decimal offset from bar centre)');
          drawingManager.addPointWithLogical((time || Date.now() / 1000) as number, price, pixelXOffset);
        }
      }
    };
    chart.subscribeClick(clickHandler);

    const handlePointerDown = (e: PointerEvent) => {
      const activeDrawing = drawingManager.getActiveDrawing();
      if (activeDrawing && activeDrawing.type === 'freehand') {
        isDrawingFreehand = true;
      }
    };

    if (containerRef.current) {
      containerRef.current.addEventListener('pointerdown', handlePointerDown as EventListener);
    }


    const handlePointerUp = () => {
      if (isDrawingFreehand) {
        isDrawingFreehand = false;
        const activeDrawing = drawingManager.getActiveDrawing();
        if (activeDrawing && activeDrawing.points.length > 1) {
          drawingManager.finishDrawing();
        } else if (activeDrawing) {
          drawingManager.cancelDrawing();
        }
      }
    };
    window.addEventListener('pointerup', handlePointerUp);

    const crosshairHandler = (param: any) => {
      // lightweight-charts re-applies cursor:crosshair on every crosshair event.
      // Enforce the correct cursor here every frame so it doesn't flicker back.
      if (!activeToolRef.current && containerRef.current) {
        containerRef.current.querySelectorAll('canvas').forEach((c) => {
          if ((c as HTMLElement).style.cursor !== 'default') {
            (c as HTMLElement).style.cursor = 'default';
          }
        });
      }

      const activeD = drawingManager.getActiveDrawing();
      if (param.point && seriesRef.current) {
        // Project time if undefined (hovering in future blank margin)
        let time = param.time;
        if (!time && param.point) {
          const logical = chart.timeScale().coordinateToLogical(param.point.x);
          if (logical !== null && candlesRef.current.length > 0) {
            const lastCandle = candlesRef.current[candlesRef.current.length - 1];
            const lastIndex = candlesRef.current.length - 1;
            const tfSec = getTimeframeSeconds(timeframe as AggTimeframe);
            time = lastCandle.time + (logical - lastIndex) * tfSec;
          }
        }

        if (time) {
          const price = seriesRef.current.coordinateToPrice(param.point.y);
          if (price !== null) {
            // Bind the active chart panel on mouse hover interaction
            drawingManager.setChart(chart, seriesRef.current, symbol, 1, overlayRef.current, timeframe);

            if (isDrawingFreehand) {
              drawingManager.addPoint(time, price);
            } else {
              const activeD2 = drawingManager.getActiveDrawing();
              if (activeD2 && (activeD2.type === 'vline' || activeD2.type === 'channel')) {
                const rawX = (param.sourceEvent && containerRef.current)
                  ? (param.sourceEvent.clientX - containerRef.current.getBoundingClientRect().left)
                  : param.point.x;
                const logical = chart.timeScale().coordinateToLogical(param.point.x);
                const barCenterX = logical !== null ? chart.timeScale().logicalToCoordinate(logical as any) : null;
                const pixOff = barCenterX !== null ? rawX - barCenterX : 0;
                drawingManager.updatePreviewPointWithLogical(time, price, pixOff);
              } else {
                drawingManager.updatePreviewPoint(time, price);
              }
            }
          }
        }
      }

    };
    chart.subscribeCrosshairMove(crosshairHandler);


    setTimeout(() => {
      if (!activeToolRef.current && containerRef.current) {
        containerRef.current.querySelectorAll('canvas').forEach((c) => {
          (c as HTMLElement).style.cursor = 'default';
        });
      }
    }, 0);

    // Save cleanup functions to chart object or local scope for unmount
    (chart as any)._cleanupDrawings = () => {
      chart.unsubscribeClick(clickHandler);
      chart.unsubscribeCrosshairMove(crosshairHandler);
      if (containerRef.current) {
        containerRef.current.removeEventListener('pointerdown', handlePointerDown as EventListener);
      }
      window.removeEventListener('pointerup', handlePointerUp);
    };

    // Re-render drawings on every zoom/pan so they stay pinned to the chart
    const timeRangeHandler = () => { drawingManager.renderAll(); };
    chart.timeScale().subscribeVisibleLogicalRangeChange(timeRangeHandler);

    isRebuildingRef.current = false; // Safe to resume ticks and resizes
  }, [chartType, symbol, loadHistory, resetLiveQuotePriceGuard, updateChartData]); // Note: intentional omit chartSettings



  // ── Chart Shift (standalone effect) ───────────────────────────────────
  // Listens for rtx:chartShift window events and applies rightOffset directly.
  // Completely independent of command bus lifecycle.
  useEffect(() => {
    const handleShift = (e: Event) => {
      const enabled = (e as CustomEvent).detail?.enabled === true;
      setCtxChartShift(enabled);
    };
    window.addEventListener('rtx:chartShift', handleShift);
    return () => window.removeEventListener('rtx:chartShift', handleShift);
  }, []);

  // Apply chart shift when ctxChartShift changes
  useEffect(() => {
    if (!chartRef.current || isDisposedRef.current) return;
    const rightOffset = getTradingChartShiftRightOffset(timeframe, ctxChartShift);
    console.log(`[Chart] Applying chart shift: ${ctxChartShift}, rightOffset: ${rightOffset}`);
    chartRef.current.timeScale().applyOptions({
      rightOffset,
      fixRightEdge: !ctxChartShift, // Must be false when shift is on, or rightOffset is blocked
    });
  }, [ctxChartShift, timeframe]);

  useEffect(() => {
    setCtxAutoScroll(chartSettings.chartAutoScroll);
  }, [chartSettings.chartAutoScroll]);

  useEffect(() => {
    setCtxChartShift(chartSettings.chartShift);
  }, [chartSettings.chartShift]);

  useEffect(() => {
    if (!chartRef.current || isDisposedRef.current) return;

    chartRef.current.applyOptions({
      localization: {
        timeFormatter: formatCrosshairTime,
      },
      timeScale: {
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
    };

    syncLeftVisibleTime();
    chartRef.current.timeScale().subscribeVisibleLogicalRangeChange(handleVisibleRangeChange);

    return () => {
      try {
        chartRef.current?.timeScale().unsubscribeVisibleLogicalRangeChange(handleVisibleRangeChange);
      } catch { }
    };
  }, [syncLeftVisibleTime, timeframe, candlesLoadedRev]);

  // Watch chart settings and hot-apply to chart without unmounting
  useEffect(() => {
    if (!chartRef.current || isDisposedRef.current) return;
    const chart = chartRef.current;

    // Apply global layout and grid
    chart.applyOptions({
      layout: {
        background: { type: ColorType.Solid, color: chartColors.background },
        textColor: chartColors.foreground,
      },
      grid: {
        vertLines: { color: 'transparent' },
        horzLines: { color: 'transparent' },
      },
      crosshair: {
        vertLine: { color: chartColors.foreground },
        horzLine: { color: chartColors.foreground },
      },
      handleScroll: {
        pressedMouseMove: true,
      },
      handleScale: {
        axisPressedMouseMove: { time: false, price: true },
        axisDoubleClickReset: { time: false, price: false },
      },
      rightPriceScale: {
        borderColor: chartColors.foreground,
        autoScale: !chartSettings.scaleFixOneToOne,
      },
      timeScale: {
        borderColor: chartColors.foreground,
      },
    });

    // Update Series colors
    if (seriesRef.current) {
      if (chartType === 'candlestick') {
        seriesRef.current.applyOptions({
          upColor: chartSettings.colors.bullCandle,
          downColor: chartSettings.colors.bearCandle,
          wickUpColor: chartSettings.colors.barUp,
          wickDownColor: chartSettings.colors.barDown,
          borderUpColor: chartSettings.colors.barUp,
          borderDownColor: chartSettings.colors.barDown,
        });
      } else if (chartType === 'bar') {
        seriesRef.current.applyOptions({
          upColor: chartSettings.colors.barUp,
          downColor: chartSettings.colors.barDown,
        });
      } else if (chartType === 'line' || chartType === 'area') {
        seriesRef.current.applyOptions({
          lineColor: chartSettings.colors.lineChart,
          color: chartSettings.colors.lineChart,
        });
      }
    }

    // Toggle volumes and apply colors if it exists
    if (volumeRef.current) {
      volumeRef.current.applyOptions({
        visible: chartSettings.showTickVolumes || chartSettings.showRealVolumes,
        color: chartSettings.colors.volumes
      });
    }

  }, [chartSettings, chartColors, chartType]);

  // getTimeframeSeconds is imported from candleAggregationService (module scope)
  // so it is never a stale closure value after a timeframe switch.

  // Load history when symbol/timeframe changes
  useEffect(() => {
    if (!symbol) {
      console.log('[Chart] No symbol, skipping history load');
      return;
    }
    // Load history even if series is not ready - data will be stored and applied when series is created
    console.log(`[Chart] Triggering history load for ${symbol} ${timeframe}`);
    loadHistory();
  }, [symbol, timeframe, loadHistory, loadMoreHistory]);

  // ─── Live tick subscription + candle rollover ─────────────────────────────
  useEffect(() => {
    if (!symbol) return;

    const normalizedSymbol = symbol.replace(/[^a-zA-Z0-9]/g, '').toUpperCase();

    // ── State (local to this effect closure) ──────────────────────────────────
    let lastTickKey = '';          // dedup: ts+price

    // ── pushCandleToChart ──────────────────────────────────────────────────────
    // Pushes one candle update to lightweight-charts.
    // isNewCandle=true → append new bar + scroll to realtime.
    // isNewCandle=false → update the last bar in-place.
    const push = (c: Candle, isNewCandle: boolean) => {
      if (isDisposedRef.current || !seriesRef.current) return;
      if (isNewCandle) {
        console.log(`[Push] 🆕 NEW candle → time=${new Date((c.time as number) * 1000).toISOString()}, O=${c.open} H=${c.high} L=${c.low} C=${c.close}`);
      }
      try {
        const ct = prevChartTypeRef.current || 'candlestick';
        if (ct === 'line' || ct === 'area') {
          seriesRef.current.update({ time: c.time as Time, value: c.close });
        } else {
          seriesRef.current.update({ time: c.time as Time, open: c.open, high: c.high, low: c.low, close: c.close });
        }
        if (volumeRef.current) {
          volumeRef.current.update({
            time: c.time as Time, value: c.volume,
            color: c.close >= c.open ? 'rgba(22,163,74,0.3)' : 'rgba(220,38,38,0.3)',
          });
        }
        updateLegendDOM(c.open, c.high, c.low, c.close, c.volume);
        markCandlesReady();
        if (isNewCandle && chartRef.current && !isDisposedRef.current) {
          try { chartRef.current.timeScale().scrollToRealTime(); } catch { }
        }
      } catch (e) {
        console.error(`[Push] ❌ series.update FAILED for t=${new Date((c.time as number) * 1000).toISOString()}:`, e, c);
      }
    };

    // ── rollover ───────────────────────────────────────────────────────────────
    // Opens a new candle at newTime. Does nothing if currentCandleRef is already
    // at or past newTime (idempotent — safe to call from multiple paths).
    const rollover = (newTime: number, openPrice?: number) => {
      console.log(`[Rollover] called → newTime=${new Date(newTime * 1000).toISOString()}, current=${currentCandleRef.current ? new Date((currentCandleRef.current.time as number) * 1000).toISOString() : 'null'}`);
      if (!currentCandleRef.current) { console.warn('[Rollover] BAIL: currentCandleRef is null'); return; }
      if ((currentCandleRef.current.time as number) >= newTime) { console.warn(`[Rollover] BAIL: current=${currentCandleRef.current.time} >= newTime=${newTime} (already rolled)`); return; }
      if (isDisposedRef.current || !seriesRef.current) { console.warn('[Rollover] BAIL: disposed or no series'); return; }

      // Archive the completed candle (once).
      const done = { ...currentCandleRef.current };
      const tail = candlesRef.current[candlesRef.current.length - 1];
      if (!tail || tail.time !== done.time) {
        candlesRef.current.push(done);
        if (candlesRef.current.length > 600) candlesRef.current = candlesRef.current.slice(-600);
      }

      const open = openPrice ?? done.close; // MT5 rule: open = previous close (no gap)
      const newCandle: Candle = { time: newTime, open, high: open, low: open, close: open, volume: 0 };
      currentCandleRef.current = newCandle;
      console.log(`[Chart] ✅ Rollover done → ${new Date(newTime * 1000).toISOString()}`);
      push(newCandle, true);
    };

    // (Local clock boundary pollers removed because they broke sequence synchronicity with the broker)
    scheduleBoundaryTimerRef.current = () => { /* no-op: tick loop handles it natively */ };

    // ── Main tick polling loop (100ms) ─────────────────────────────────────────
    const interval = setInterval(() => {
      if (isDisposedRef.current || isRebuildingRef.current || !seriesRef.current) return;
      const activeTf = prevTimeframeRef.current || timeframe;

      // Get the latest tick from window.rtxTickCache map first for high performance, fallback to Zustand store
      let tick = typeof window !== 'undefined' && window.rtxTickCache
        ? (window.rtxTickCache.get(symbol)
          ?? window.rtxTickCache.get(symbol.toUpperCase())
          ?? window.rtxTickCache.get(normalizedSymbol))
        : undefined;

      if (!tick) {
        const state = useAppStore.getState();
        tick = state.ticks[symbol]
          ?? state.ticks[symbol.toUpperCase()]
          ?? (() => {
            const key = Object.keys(state.ticks).find(k =>
              k.replace(/[^a-zA-Z0-9]/g, '').toUpperCase() === normalizedSymbol);
            return key ? state.ticks[key] : undefined;
          })();
      }

      // ── MIGRATED: Local clock-based boundary check removed ──────────
      // Rollovers are now driven strictly by `tick.timestamp` crossing the
      // boundaries or the server sending `update` WS messages, avoiding `Cannot update oldest data`
      // crash loops caused by local PC clocks running faster than the broker.

      if (!tick?.bid) return;

      const price = (tick.bid + (tick.ask ?? tick.bid)) / 2;
      const livePriceMatchesRenderedScale = normalizeRenderedCandlesToLivePrice(price, activeTf);
      if (!livePriceMatchesRenderedScale || !isLivePriceSafeForCandles(price)) {
        const guard = updateLiveQuoteGuardState({
          lastAcceptedQuote: lastAcceptedQuoteRef.current,
          incompatibleQuoteCount: incompatibleQuoteCountRef.current,
        }, false, price);
        lastAcceptedQuoteRef.current = guard.state.lastAcceptedQuote;
        incompatibleQuoteCountRef.current = guard.state.incompatibleQuoteCount;
        setApiError(`${symbol} live quote is outside the candle range; waiting for matching ${activeTf} data.`);

        // If the first live quotes consistently disagree with preloaded history,
        // the history is likely from a stale/wrong instrument. Drop it so live
        // ticks can rebuild the chart at the executable quote scale.
        if (guard.shouldDropCandles) {
          console.warn(`[Chart] Dropping incompatible ${symbol} candles after repeated live quote mismatch.`);
          candlesRef.current = [];
          currentCandleRef.current = null;
          prevPriceRef.current = null;
          leftVisibleTimeRef.current = null;
          lastStoreCandleSecRef.current = 0;
          try { seriesRef.current?.setData([]); } catch { }
          try { volumeRef.current?.setData([]); } catch { }
          hideLivePriceOverlay();
          candleAggregationService.loadHistoricalCandles(symbol, activeTf as AggTimeframe, []);
          resetLiveQuotePriceGuard();
        } else {
          return;
        }
      } else {
        const guard = updateLiveQuoteGuardState({
          lastAcceptedQuote: lastAcceptedQuoteRef.current,
          incompatibleQuoteCount: incompatibleQuoteCountRef.current,
        }, true, price);
        lastAcceptedQuoteRef.current = guard.state.lastAcceptedQuote;
        incompatibleQuoteCountRef.current = guard.state.incompatibleQuoteCount;
      }
      let ts = tick.timestamp;
      if (!ts) return;
      if (ts > 1_000_000_000_000) ts = Math.floor(ts / 1000); // ms → sec

      // ── SAFEGUARD: prevent laggy broker ticks from pulling chart backwards ──
      if (currentCandleRef.current && ts < currentCandleRef.current.time) {
        ts = currentCandleRef.current.time as number;
      }

      const tfs = getTimeframeSeconds(activeTf as AggTimeframe);
      const candleTime = alignTimeframeBoundarySeconds(ts, activeTf as AggTimeframe, tfs);

      // Dedup: same raw timestamp AND same price → skip (prevents 100ms poll from
      // re-processing the exact same tick repeatedly). candleTime is NOT used as the
      // dedup key — that would block same-price ticks in a new minute.
      const key = `${ts}:${price.toFixed(5)}`;
      if (key === lastTickKey) return;
      lastTickKey = key;

      // ── Update live price DOM line + badge ──
      if (livePriceLineRef.current && livePriceBadgeRef.current && seriesRef.current) {
        const y = seriesRef.current.priceToCoordinate(tick.bid);
        if (y !== null && y !== undefined) {
          const digits = getSymbolDigits(symbol);
          livePriceRef.current = tick.bid;

          const badgeColor = '#5A5A66'; // MT5-style solid gray

          // Match exact price-scale width so badge overlays the axis labels 1:1
          const scaleW = seriesRef.current.priceScale().width();

          livePriceLineRef.current.style.top = `${y}px`;
          livePriceLineRef.current.style.right = `${scaleW}px`;
          livePriceLineRef.current.style.borderTopColor = badgeColor;
          livePriceLineRef.current.style.display = 'block';

          livePriceBadgeRef.current.style.top = `${y}px`;
          livePriceBadgeRef.current.style.width = `${scaleW}px`;
          livePriceBadgeRef.current.style.background = badgeColor;
          livePriceBadgeRef.current.textContent = tick.bid.toFixed(digits);
          livePriceBadgeRef.current.style.display = 'block';
        }
      }


      // ── Candle rollover or update ──────────────────────────────────────────
      if (!currentCandleRef.current) {
        // Very first tick — create the forming candle.
        currentCandleRef.current = { time: candleTime, open: price, high: price, low: price, close: price, volume: 1 };
        push(currentCandleRef.current, true);
      } else if (candleTime > currentCandleRef.current.time) {
        // rollover() with real first tick price allows true gaps to render properly.
        rollover(candleTime, price);
        // The real first tick features will be correctly mapped implicitly during
        // the next tick loop cycle, or updated later by FIX update.
        if (currentCandleRef.current && currentCandleRef.current.time === candleTime) {
          currentCandleRef.current.volume = 1; // Mark as seen
        }
      } else {
        // Same candle — update OHLCV in-place.
        if (currentCandleRef.current.volume === 0) {
          // This is the true first tick of a candle opened prematurely by the clock timer.
          // Snap the OHLC to the real tick price to allow gaps to render correctly.
          currentCandleRef.current.open = price;
          currentCandleRef.current.high = price;
          currentCandleRef.current.low = price;
          currentCandleRef.current.close = price;
          currentCandleRef.current.volume = 1;
        } else {
          currentCandleRef.current.high = Math.max(currentCandleRef.current.high, price);
          currentCandleRef.current.low = Math.min(currentCandleRef.current.low, price);
          currentCandleRef.current.close = price;
          currentCandleRef.current.volume += 1;
        }
        push(currentCandleRef.current, false);
      }

      // Refresh after candle creation/update so the first live-only tick has a
      // price scale before we ask LightweightCharts for a coordinate.
      renderLivePriceOverlay(tick.bid);

      // ── Auto Close Trade on SL/TP Cross ──
      activeTradeSnapshotsRef.current.forEach((trade) => {
        if (tradeAutoClosePendingRef.current.has(trade.key)) return;

        let shouldClose = false;

        // Current snapshot has sl/tp defined by the backend.
        // We evaluate against live execution bounds for instant feedback.
        if (trade.side === 'BUY') {
          if (trade.sl != null && trade.sl > 0 && tick.bid <= trade.sl) shouldClose = true;
          if (trade.tp != null && trade.tp > 0 && tick.bid >= trade.tp) shouldClose = true;
        } else {
          const closePrice = tick.ask ?? tick.bid;
          if (trade.sl != null && trade.sl > 0 && closePrice >= trade.sl) shouldClose = true;
          if (trade.tp != null && trade.tp > 0 && closePrice <= trade.tp) shouldClose = true;
        }

        if (shouldClose) {
          tradeAutoClosePendingRef.current.add(trade.key);
          const pId = trade.key.replace('trade:', '');
          console.log(`[Chart] 🛑 Auto-closing trade ${pId} due to SL/TP cross`);

          api.positions.closePosition(String(pId)).then(() => {
            useAppStore.getState().setPositions(useAppStore.getState().positions.filter(p => p.id !== Number(pId)));
            window.dispatchEvent(new Event('rtx:force-refresh-positions'));
          }).catch(err => {
            console.warn(`[Chart] Auto-close failed:`, err);
            tradeAutoClosePendingRef.current.delete(trade.key);
          });
        }
      });

      // Keep aggregation service in sync (for higher-TF panels).
      candleAggregationService.processTick({ symbol, bid: tick.bid, ask: tick.ask ?? tick.bid, timestamp: ts * 1000, volume: 1 });
    }, 100);

    // ── FIX WebSocket: server-confirmed completed candles ──────────────────────
    const applyServerCandle = (c: Candle) => {
      if (isDisposedRef.current || isRebuildingRef.current) return;
      const [reconciled] = reconcileCandlesWithLiveQuote([c], 'stream update');
      if (!reconciled) return;
      c = reconciled;
      if (!normalizeRenderedCandlesToLivePrice(c.close, prevTimeframeRef.current || timeframe)) return;

      // 1. Is this an update to an older (already closed) bar?
      if (currentCandleRef.current && c.time < currentCandleRef.current.time) {
        // LightweightCharts cannot update historical datums via update(); merge the
        // authoritative server correction and repaint the full sorted set instead.
        candlesRef.current = chartDataService.mergeCandle(candlesRef.current, c, 1000) as Candle[];
        updateChartData(candlesRef.current);
        if (candlesRef.current.length > 0) markCandlesReady();
        return;
      }

      // 2. Is this an update to the CURRENTLY forming bar?
      if (currentCandleRef.current && c.time === currentCandleRef.current.time) {
        currentCandleRef.current = {
          time: c.time,
          open: c.open,
          high: c.high,
          low: c.low,
          close: c.close,
          volume: c.volume,
        };
        candlesRef.current = chartDataService.mergeCandle(candlesRef.current, currentCandleRef.current, 1000) as Candle[];
        push(currentCandleRef.current, false);
        return;
      }

      // 3. Server is telling us about a TRULY NEW candle (c.time > current.time)
      if (!currentCandleRef.current) {
        currentCandleRef.current = {
          time: c.time,
          open: c.open,
          high: c.high,
          low: c.low,
          close: c.close,
          volume: c.volume,
        };
        candlesRef.current = chartDataService.mergeCandle(candlesRef.current, currentCandleRef.current, 1000) as Candle[];
        push(currentCandleRef.current, true);
        return;
      }

      if (c.time > currentCandleRef.current.time) {
        // Let the idempotent rollover handle creating it
        rollover(c.time, c.open);

        // Immediately apply server's data to it
        if (currentCandleRef.current && currentCandleRef.current.time === c.time) {
          currentCandleRef.current = {
            time: c.time,
            open: c.open,
            high: c.high,
            low: c.low,
            close: c.close,
            volume: c.volume,
          };
          candlesRef.current = chartDataService.mergeCandle(candlesRef.current, currentCandleRef.current, 1000) as Candle[];
          push(currentCandleRef.current, false);
        }

        // We no longer need to reschedule boundary timer here!
        // The immortal Date.now() loop handles it automatically in the background.
      }
    };

    const streamTimeframe = prevTimeframeRef.current || activeTimeframe;
    const candleStream = chartDataService.subscribeCandles({
      symbol,
      timeframe: streamTimeframe,
      onSnapshot: (snapshot) => {
        if (isDisposedRef.current || isRebuildingRef.current || snapshot.length === 0) return;
        const reconciledSnapshot = reconcileCandlesWithLiveQuote(snapshot as Candle[], 'stream snapshot');
        if (reconciledSnapshot.length === 0) return;
        const latestClose = reconciledSnapshot[reconciledSnapshot.length - 1]?.close;
        if (latestClose && !normalizeRenderedCandlesToLivePrice(latestClose, prevTimeframeRef.current || streamTimeframe)) return;
        candlesRef.current = reconciledSnapshot.reduce(
          (acc, candle) => chartDataService.mergeCandle(acc, candle, 1000),
          candlesRef.current,
        ) as Candle[];
        updateChartData(candlesRef.current);
        currentCandleRef.current = candlesRef.current[candlesRef.current.length - 1] ?? currentCandleRef.current;
        // Snapshot is the authoritative full bar set — dismiss the loader if we
        // were still waiting on history (covers the cold-start path where REST
        // returned empty and the WS catches up ~tens of seconds later).
        setLoadingPhase(prev => (prev === 'connecting' || prev === 'receiving' ? 'ready' : prev));
      },
      onCandle: (candle) => applyServerCandle(candle),
      onError: (error) => setApiError(error.message),
    });

    return () => {
      clearInterval(interval);
      candleStream.close();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [symbol, activeTimeframe, authToken, markCandlesReady]);

  // ── Candle Countdown Timer ──
  useEffect(() => {
    if (!symbol) return;
    let lastIntervalNum = 0;

    const interval = setInterval(() => {
      const activeTf = prevTimeframeRef.current || timeframe;
      const tfs = getTimeframeSeconds(activeTf as AggTimeframe);

      if (tfs > 0 && tfs <= 14400) {
        const nowSec = Math.floor(Date.now() / 1000);
        const secInto = nowSec % tfs;
        const remaining = tfs - secInto;

        const m = Math.floor(remaining / 60);
        const s = remaining % 60;
        const h = Math.floor(m / 60);

        let val = '';
        if (h > 0) {
          val = `${h.toString().padStart(2, '0')}:${(m % 60).toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
        } else {
          val = `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
        }
        if (countdownTextRef.current) {
          countdownTextRef.current.textContent = val;
        }

        // We no longer trigger `window.location.reload()` here because Date.now() 
        // drifting from broker time causes infinite refresh loops.
        // We solely rely on tick timestamps now.
      } else {
        if (countdownTextRef.current) {
          countdownTextRef.current.textContent = '';
        }
      }
    }, 1000);
    return () => clearInterval(interval);
  }, [symbol, timeframe]);

  // The primary tick aggregation interval handles all live OHLCV updates perfectly.

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
              chartRef.current.applyOptions({ width: offsetWidth, height: offsetHeight });
              chartRef.current.timeScale().scrollToRealTime();
              console.log(`[TradingChart] Tab became visible — resized to ${offsetWidth}x${offsetHeight}`);
            }
          }
        }
      },
      { threshold: 0.1 }
    );

    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  // Native autoSize handles resizing internally

  // Handle ZOOM_IN / ZOOM_OUT commands from toolbar buttons only (no mouse wheel zoom)
  useEffect(() => {
    const handleZoomIn = () => {
      if (isDisposedRef.current || !chartRef.current) return;
      try {
        const newSpacing = Math.min(pixelsPerBarRef.current * 1.2, 30);
        pixelsPerBarRef.current = newSpacing;
        chartRef.current.timeScale().applyOptions({ barSpacing: newSpacing });
      } catch (e) { /* disposed */ }
    };

    const handleZoomOut = () => {
      if (isDisposedRef.current || !chartRef.current) return;
      try {
        const newSpacing = Math.max(pixelsPerBarRef.current / 1.2, 1);
        pixelsPerBarRef.current = newSpacing;
        chartRef.current.timeScale().applyOptions({ barSpacing: newSpacing });
      } catch (e) { /* disposed */ }
    };

    const unsub1 = commandBus.subscribe('ZOOM_IN', handleZoomIn);
    const unsub2 = commandBus.subscribe('ZOOM_OUT', handleZoomOut);

    // Auto-Scroll (Snap to live edge)
    const unsubAutoScroll = commandBus.subscribe('SET_AUTO_SCROLL' as any, (payload: any) => {
      if (isDisposedRef.current || !chartRef.current) return;
      try {
        const enabled = payload?.enabled === true;
        autoScrollEnabledRef.current = enabled;
        setCtxAutoScroll(enabled);
        if (enabled) {
          chartRef.current.timeScale().scrollToRealTime();
        }
      } catch (e) { /* disposed */ }
    });

    // Chart Shift (Right Margin) — MT5-style gap pushes candles left
    const applyChartShift = (enabled: boolean) => {
      if (isDisposedRef.current || !chartRef.current) return;
      try {
        const rightOffset = getTradingChartShiftRightOffset(prevTimeframeRef.current || timeframe, enabled);
        console.log(`[Chart] Chart shift ${enabled ? 'ENABLED' : 'DISABLED'}, setting rightOffset: ${rightOffset}`);
        setCtxChartShift(enabled);
        chartRef.current.timeScale().applyOptions({
          rightOffset,
          fixRightEdge: !enabled,
        });
        if (enabled) chartRef.current.timeScale().scrollToRealTime();
      } catch (e) { /* disposed */ }
    };

    const unsubChartShift = commandBus.subscribe('SET_CHART_SHIFT' as any, (payload: any) => {
      applyChartShift(payload?.enabled === true);
    });

    // Direct window event fallback (more reliable than command bus lifecycle)
    const handleChartShiftEvent = (e: Event) => {
      const enabled = (e as CustomEvent).detail?.enabled === true;
      applyChartShift(enabled);
    };
    window.addEventListener('rtx:chartShift', handleChartShiftEvent);

    // Timeframe Change from Top Bar
    const unsubTimeframe = commandBus.subscribe('SET_TIMEFRAME' as any, (payload: any) => {
      if (isDisposedRef.current || !chartRef.current) return;

      // Strict targeted event mapping
      if (panelId && payload?.panelId && panelId !== payload.panelId) return;

      // Global event mapping (from TopToolbar)
      if (!payload?.panelId) {
        // Only the active/visible chart(s) should respond to global toolbar clicks.
        const store = useDockLayoutStore.getState();

        const isPanelVisible = (id: string, node: any): boolean => {
          if (!node) return false;
          if (node.id === id) return true; // Panel is raw and visible
          if (node.type === 'tabs') {
            // Is it in this tab group?
            const isChild = node.children?.some((c: any) => c.id === id);
            if (isChild) {
              const activeTabId = node.activeTab || node.children?.[0]?.id;
              return activeTabId === id;
            }
          }
          if (node.children) {
            return node.children.some((child: any) => isPanelVisible(id, child));
          }
          return false;
        };

        if (panelId) {
          const inRoot = isPanelVisible(panelId, store.layout.root);
          const inFloating = store.layout.floatingPanels.some((p: any) => p.id === panelId);

          // If it's not currently visible on the screen, ignore the command
          if (!inRoot && !inFloating) {
            return;
          }
        }

        // Update the panel title so the Dock layout tab updates too
        if (panelId && payload.timeframe) {
          console.log(`[TradingChart] Global timeframe sync: updating tab title to ${symbol},${payload.timeframe}`);
          const store = useDockLayoutStore.getState();
          const currentPanel = store.layout.root.children?.find((c: any) => c.id === panelId) ||
            store.layout.floatingPanels.find((c: any) => c.id === panelId);

          store.updatePanelProps(panelId, {
            props: { ...((currentPanel as any)?.props || {}), symbol: symbol, timeframe: payload.timeframe },
            title: `${symbol},${payload.timeframe}`
          });
        }
      }

      const newTimeframe = payload?.timeframe;
      if (newTimeframe && newTimeframe !== prevTimeframeRef.current) {
        console.log(`[Chart] Timeframe changing from ${prevTimeframeRef.current} to ${newTimeframe}`);
        prevTimeframeRef.current = newTimeframe;
        setActiveTimeframe(newTimeframe as Timeframe);
        // Clear existing data and reload
        candlesRef.current = [];
        currentCandleRef.current = null;
        if (seriesRef.current) {
          try { seriesRef.current.setData([]); } catch (e) { }
        }
        if (volumeRef.current) {
          try { volumeRef.current.setData([]); } catch (e) { }
        }
        setLoadingPhase('connecting');
        loadHistory();
      }
    });

    return () => {
      unsub1();
      unsub2();
      unsubAutoScroll();
      unsubChartShift();
      unsubTimeframe();
      window.removeEventListener('rtx:chartShift', handleChartShiftEvent);
    };
  }, []);

  // Handle SELECT_TOOL command — bridge toolbar buttons to drawingManager
  useEffect(() => {
    console.log('[TradingChart] ✅ SELECT_TOOL subscriber REGISTERED, chartRef=', !!chartRef.current, 'containerRef=', !!containerRef.current);
    
    const handleSaved = () => {
      console.log('[TradingChart] Self-heal: drawing saved, returning to cursor mode');
      activeToolRef.current = null;
      if (chartRef.current) {
        chartRef.current.applyOptions({
          handleScroll: { mouseWheel: false, pressedMouseMove: true, horzTouchDrag: true },
          handleScale: { mouseWheel: false, pinch: false, axisPressedMouseMove: { time: false, price: true } },
          ...(!crosshairEnabledRef.current && { crosshair: { vertLine: { visible: false }, horzLine: { visible: false } } }),
        });
      }
      if (containerRef.current && !crosshairEnabledRef.current) {
        containerRef.current.style.cursor = 'default';
        containerRef.current.querySelectorAll('canvas').forEach((c) => {
          (c as HTMLCanvasElement).style.cursor = 'default';
        });
        const wrapper = containerRef.current.parentElement;
        if (wrapper) wrapper.setAttribute('data-cursor', 'select');
      }
    };

    window.addEventListener('drawing:saved', handleSaved);

    const unsubSelectTool = commandBus.subscribe('SELECT_TOOL', (payload) => {
      const tool = payload.tool;
      console.log(`[TradingChart] 🎯 SELECT_TOOL received: tool=${tool}, chartRef=${!!chartRef.current}, seriesRef=${!!seriesRef.current}`);

      // Cancel any active drawing + clear inline text input
      drawingManager.cancelDrawing();
      setTextInputOverlay(null);

      // Track tool in ref (accessible in closures without re-creating handlers)
      activeToolRef.current = tool === 'cursor' ? null : tool;

      if (tool === 'cursor') {
        // Cursor mode: restore pan/scroll, hide crosshair lines (MT5 behaviour)
        drawingManager.unselectAll();
        if (chartRef.current) {
          chartRef.current.applyOptions({
            handleScroll: { mouseWheel: false, pressedMouseMove: true, horzTouchDrag: true },
            handleScale: { mouseWheel: false, pinch: false, axisPressedMouseMove: { time: false, price: true } },
            // Hide the crosshair lines — arrow mode shows no crosshair (MT5 style)
            ...(!crosshairEnabledRef.current && { crosshair: { vertLine: { visible: false }, horzLine: { visible: false } } }),
          });
        }
        if (containerRef.current && !crosshairEnabledRef.current) {
          containerRef.current.style.cursor = 'default';
          containerRef.current.querySelectorAll('canvas').forEach((c) => {
            (c as HTMLCanvasElement).style.cursor = 'default';
          });
          const wrapper = containerRef.current.parentElement;
          if (wrapper) wrapper.setAttribute('data-cursor', 'select');
        }
        console.log('[Chart] Tool: cursor (selection mode — crosshair hidden)');
      } else {
        // Drawing mode: disable pressedMouseMove so drag doesn't pan, only click places points
        if (chartRef.current) {
          chartRef.current.applyOptions({
            handleScroll: { mouseWheel: false, pressedMouseMove: false, horzTouchDrag: false },
            handleScale: { mouseWheel: false, pinch: false, axisPressedMouseMove: false },
            // Show crosshair so user can precisely place drawing points
            ...(!crosshairEnabledRef.current && { crosshair: { vertLine: { visible: true }, horzLine: { visible: true } } }),
          });
        }
        if (containerRef.current && !crosshairEnabledRef.current) {
          containerRef.current.style.cursor = 'crosshair';
          containerRef.current.querySelectorAll('canvas').forEach((c) => {
            (c as HTMLCanvasElement).style.cursor = 'crosshair';
          });
          const wrapper = containerRef.current.parentElement;
          if (wrapper) wrapper.setAttribute('data-cursor', 'draw');
        }

        const validDrawingTypes = ['trendline', 'hline', 'vline', 'text', 'channel', 'fibonacci', 'shapes', 'rectangle', 'ellipse', 'fib_extension', 'measure', 'freehand', 'callout', 'stamp'];
        if (validDrawingTypes.includes(tool)) {
          const subtype = (payload as any).subtype as string | undefined;
          drawingManager.startDrawing(tool as any, '#3b82f6', subtype ? { subtype } : undefined);
          const activeAfter = drawingManager.getActiveDrawing();
          console.log(`[Chart] Tool: ${tool} — drawing started, activeDrawing=${!!activeAfter}, type=${activeAfter?.type}`);
        } else {
          console.log(`[Chart] Tool: ${tool} — not a drawing tool`);
        }
      }
    });

    return () => {
      unsubSelectTool();
      window.removeEventListener('drawing:saved', handleSaved);
    };
  }, []);

  // Handle UNDO / REDO / DELETE commands from toolbar
  useEffect(() => {
    const unsubUndo = commandBus.subscribe('UNDO', () => {
      drawingManager.undo();
      console.log('[Chart] Undo drawing');
    });

    const unsubRedo = commandBus.subscribe('REDO', () => {
      drawingManager.redo();
      console.log('[Chart] Redo drawing');
    });

    const unsubDeleteSelected = commandBus.subscribe('DELETE_SELECTED_DRAWING', () => {
      drawingManager.deleteSelected();
      console.log('[Chart] Deleted selected drawings');
    });

    const unsubDeleteById = commandBus.subscribe('DELETE_DRAWING', (payload) => {
      drawingManager.deleteDrawing(payload.id);
      console.log(`[Chart] Deleted drawing: ${payload.id}`);
    });

    return () => {
      unsubUndo();
      unsubRedo();
      unsubDeleteSelected();
      unsubDeleteById();
    };
  }, []);

  // Handle TOGGLE_CROSSHAIR command — toggles the crosshair button in the toolbar
  // When ON: show crosshair lines + set Magnet mode. When OFF: hide lines (arrow mode).
  useEffect(() => {
    const unsubCrosshair = commandBus.subscribe('TOGGLE_CROSSHAIR', () => {
      const next = !crosshairEnabledRef.current;
      crosshairEnabledRef.current = next;
      setCrosshairEnabled(next);
      console.log(`[Chart] Custom crosshair: ${next ? 'ON' : 'OFF'}`);
    });

    return () => {
      unsubCrosshair();
    };
  }, []);

  // Keyboard shortcuts for drawing tools + Alt+T one-click trading
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Skip if user is typing in an input/textarea
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;

      // Alt+T = Toggle One-Click Trading panel (show/hide)
      if (false && e.altKey && (e.key === 't' || e.key === 'T' || e.code === 'KeyT')) {
        e.preventDefault();
        setShowOneClick(prev => !prev);
        return;
      }

      // F9 = New Order
      if (false && e.key === 'F9') {
        e.preventDefault();
        window.dispatchEvent(new CustomEvent('openNewOrder'));
        return;
      }

      // F8 = Chart Properties
      if (e.key === 'F8') {
        e.preventDefault();
        window.dispatchEvent(new CustomEvent('openChartProperties'));
        return;
      }

      // Alt+1 = Bar Chart
      if (e.altKey && (e.key === '1' || e.code === 'Digit1')) {
        e.preventDefault();
        setLocalChartType('bar');
        commandBus.dispatch({ type: 'SET_CHART_TYPE', payload: { chartType: 'bar' } });
        return;
      }

      // Alt+2 = Candlesticks
      if (e.altKey && (e.key === '2' || e.code === 'Digit2')) {
        e.preventDefault();
        setLocalChartType('candlestick');
        commandBus.dispatch({ type: 'SET_CHART_TYPE', payload: { chartType: 'candlestick' } });
        return;
      }

      // Alt+3 = Line Chart
      if (e.altKey && (e.key === '3' || e.code === 'Digit3')) {
        e.preventDefault();
        setLocalChartType('area');
        commandBus.dispatch({ type: 'SET_CHART_TYPE', payload: { chartType: 'area' } });
        return;
      }

      // Alt+B = Depth of Market
      if (false && e.altKey && (e.key === 'b' || e.key === 'B' || e.code === 'KeyB')) {
        e.preventDefault();
        window.dispatchEvent(new CustomEvent('openDepthOfMarket', { detail: { symbol } }));
        return;
      }

      // Alt+G = Toggle Grid
      if (false && e.altKey && (e.key === 'g' || e.key === 'G' || e.code === 'KeyG')) {
        e.preventDefault();
        const currentGrid = useChartSettingsStore.getState().globalProperties.showGrid;
        useChartSettingsStore.getState().updateGlobalProperty('showGrid', !currentGrid);
        return;
      }

      // Ctrl+K = Toggle Volumes
      if (false && e.ctrlKey && (e.key === 'k' || e.key === 'K' || e.code === 'KeyK')) {
        e.preventDefault();
        const currentVols = useChartSettingsStore.getState().globalProperties.showTickVolumes;
        useChartSettingsStore.getState().updateGlobalProperty('showTickVolumes', !currentVols);
        return;
      }


      // Ctrl+Z = Undo
      if (e.ctrlKey && e.key === 'z') {
        e.preventDefault();
        drawingManager.undo();
        console.log('[Chart] Keyboard: Undo');
      }

      // Ctrl+Y = Redo
      if (e.ctrlKey && e.key === 'y') {
        e.preventDefault();
        drawingManager.redo();
        console.log('[Chart] Keyboard: Redo');
      }

      // Delete / Backspace = Delete selected drawing
      if (e.key === 'Delete' || e.key === 'Backspace') {
        // Only delete if not in an input field
        drawingManager.deleteSelected();
        console.log('[Chart] Keyboard: Delete selected');
      }

      // Escape = Cancel active drawing or deselect all
      if (e.key === 'Escape') {
        const active = drawingManager.getActiveDrawing();
        if (active) {
          drawingManager.cancelDrawing();
          setTextInputOverlay(null);
          // Reset tool back to cursor in toolbar
          commandBus.dispatch({ type: 'SELECT_TOOL', payload: { tool: 'cursor' } } as any);
          console.log('[Chart] Keyboard: Cancelled active drawing');
        } else {
          drawingManager.unselectAll();
          console.log('[Chart] Keyboard: Deselected all');
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);

    // Listen for toggle-one-click-trading event from dashboard toolbar
    const handleToggleOneClick = () => setShowOneClick(prev => !prev);
    window.addEventListener('toggle-one-click-trading', handleToggleOneClick);

    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('toggle-one-click-trading', handleToggleOneClick);
    };
  }, [symbol]);

  // ─── Trade Annotations on Chart (MT5-style entry/exit markers + live trails) ───
  const TRADE_BUY_COLOR = '#22c55e';
  const TRADE_SELL_COLOR = '#ef4444';
  const overlayNodesRef = useRef<HTMLElement[]>([]);
  const overlayNodeDataRef = useRef<OverlayNodeData[]>([]);
  const frozenEntryTimesRef = useRef<Map<number | string, number>>(new Map());
  const activeTradeSnapshotsRef = useRef<Map<string, ActiveTradeSnapshot>>(new Map());
  const optimisticClosedTradesRef = useRef<Map<string, ClosedTradeSnapshot>>(new Map());
  const tradeHistoryRefreshTimerRef = useRef<number | null>(null);
  const tradeOverlayRafRef = useRef<number | null>(null);
  const tradeAutoClosePendingRef = useRef<Set<string>>(new Set());
  const tradeLevelOverridesRef = useRef<Map<string, TradeLevelOverride>>(new Map());
  const tradeLevelOverridesHydratedRef = useRef(false);
  const lastTradeOverlaySignatureRef = useRef('');
  const positionLabelsRef = overlayNodesRef;
  const positionLabelDataRef = useRef<any[]>([]);

  const hydrateTradeLevelOverrides = useCallback(() => {
    if (tradeLevelOverridesHydratedRef.current || typeof window === 'undefined') return;
    tradeLevelOverridesHydratedRef.current = true;

    try {
      const raw = window.localStorage.getItem(TRADE_LEVEL_OVERRIDES_STORAGE_KEY);
      if (!raw) return;

      const rows = JSON.parse(raw);
      if (!Array.isArray(rows)) return;

      const now = Date.now();
      rows.forEach((row) => {
        const key = typeof row?.key === 'string' ? row.key : '';
        const savedAt = Number(row?.savedAt ?? 0);
        if (!key || !Number.isFinite(savedAt) || now - savedAt > TRADE_LEVEL_OVERRIDE_TTL_MS) return;

        const sl = Number(row?.sl) || 0;
        const tp = Number(row?.tp) || 0;
        if (sl > 0 || tp > 0) {
          tradeLevelOverridesRef.current.set(key, { sl, tp });
        }
      });
    } catch {
      // Ignore malformed local optimistic state.
    }
  }, []);

  const persistTradeLevelOverrides = useCallback(() => {
    if (typeof window === 'undefined') return;

    try {
      const savedAt = Date.now();
      const rows = Array.from(tradeLevelOverridesRef.current.entries())
        .filter(([, levels]) => (levels.sl || 0) > 0 || (levels.tp || 0) > 0)
        .map(([key, levels]) => ({
          key,
          sl: levels.sl || 0,
          tp: levels.tp || 0,
          savedAt,
        }));

      if (rows.length === 0) {
        window.localStorage.removeItem(TRADE_LEVEL_OVERRIDES_STORAGE_KEY);
      } else {
        window.localStorage.setItem(TRADE_LEVEL_OVERRIDES_STORAGE_KEY, JSON.stringify(rows));
      }
    } catch {
      // Local persistence is best-effort only.
    }
  }, []);

  const clearTradeOverlay = useCallback(() => {
    for (const node of overlayNodesRef.current) {
      try {
        node.remove();
      } catch {
        // Ignore detached nodes.
      }
    }
    overlayNodesRef.current = [];
    overlayNodeDataRef.current = [];
    lastTradeOverlaySignatureRef.current = '';
  }, []);

  const getNearestCandleByTime = useCallback((time: number): Candle | null => {
    const candles = candlesRef.current;
    if (!candles || candles.length === 0) return null;

    let lo = 0;
    let hi = candles.length - 1;
    let best = candles[0];

    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      const candidate = candles[mid];
      if (Math.abs(candidate.time - time) < Math.abs(best.time - time)) {
        best = candidate;
      }
      if (candidate.time <= time) {
        lo = mid + 1;
      } else {
        hi = mid - 1;
      }
    }

    return best;
  }, []);

  useEffect(() => {
    activeTradeSnapshotsRef.current.clear();
    optimisticClosedTradesRef.current.clear();
    frozenEntryTimesRef.current.clear();
    clearTradeOverlay();

    if (tradeHistoryRefreshTimerRef.current !== null) {
      window.clearTimeout(tradeHistoryRefreshTimerRef.current);
      tradeHistoryRefreshTimerRef.current = null;
    }

    window.dispatchEvent(new Event('rtx:force-refresh-positions'));
  }, [clearTradeOverlay, symbol]);

  const updateLabelPositions = useCallback(() => {
    if (!seriesRef.current || !chartRef.current) return;

    const series = seriesRef.current;
    const chart = chartRef.current;
    const nodes = overlayNodesRef.current;
    const data = overlayNodeDataRef.current;
    const chartWidth = containerRef.current?.offsetWidth || 0;
    const chartHeight = containerRef.current?.offsetHeight || 0;
    const priceScaleWidth = series.priceScale().width();

    for (let i = 0; i < nodes.length; i++) {
      const el = nodes[i];
      const node = data[i];
      if (!el || !node) continue;

      try {
        if (node.kind === 'horizontal-line' || node.kind === 'price-badge') {
          if (node.price == null) {
            el.style.display = 'none';
            continue;
          }

          const y = series.priceToCoordinate(node.price);
          if (y == null || y < -20 || y > chartHeight + 20) {
            el.style.display = 'none';
            continue;
          }

          el.style.display = 'block';
          el.style.top = `${y}px`;

          if (node.kind === 'horizontal-line') {
            el.style.left = '0px';
            el.style.right = `${priceScaleWidth}px`;
          } else {
            el.style.width = `${priceScaleWidth}px`;
          }

          continue;
        }

        if (node.kind === 'segment') {
          if (node.price == null || node.time == null) {
            el.style.display = 'none';
            continue;
          }

          const endPrice = node.resolveEndPrice?.() ?? node.endPrice ?? null;
          const endTime = node.resolveEndTime?.() ?? node.endTime ?? null;
          if (endPrice == null || endTime == null) {
            el.style.display = 'none';
            continue;
          }

          const x1 = chart.timeScale().timeToCoordinate(node.time as Time);
          const y1 = series.priceToCoordinate(node.price);
          const x2 = chart.timeScale().timeToCoordinate(endTime as Time);
          const y2 = series.priceToCoordinate(endPrice);
          if (x1 == null || y1 == null || x2 == null || y2 == null) {
            el.style.display = 'none';
            continue;
          }

          const dx = x2 - x1;
          const dy = y2 - y1;
          const length = Math.sqrt((dx * dx) + (dy * dy));
          if (!Number.isFinite(length) || length <= 0.5) {
            el.style.display = 'none';
            continue;
          }

          el.style.display = 'block';
          el.style.left = `${x1}px`;
          el.style.top = `${y1}px`;
          el.style.width = `${length}px`;
          el.style.transform = `rotate(${Math.atan2(dy, dx) * 180 / Math.PI}deg)`;
          el.style.transformOrigin = '0 0';
          continue;
        }

        if (node.price == null || node.time == null) {
          el.style.display = 'none';
          continue;
        }

        const x = chart.timeScale().timeToCoordinate(node.time as Time);
        const y = series.priceToCoordinate(node.price);
        if (x == null || y == null || x < -24 || x > chartWidth + 24 || y < -24 || y > chartHeight + 24) {
          el.style.display = 'none';
          continue;
        }

        el.style.display = 'block';

        if (node.kind === 'marker') {
          el.style.left = `${x}px`;
          el.style.top = `${y}px`;
          el.style.transform = node.markerSide === 'BUY'
            ? 'translate(-50%, 0)'
            : 'translate(-50%, -100%)';
          continue;
        }

        if (node.kind === 'label') {
          el.style.left = `${x + (node.labelOffsetX ?? 8)}px`;
          el.style.top = `${y + (node.labelOffsetY ?? -18)}px`;
        }
      } catch {
        el.style.display = 'none';
      }
    }

    if (livePriceRef.current !== null && livePriceLineRef.current && livePriceBadgeRef.current) {
      const y = series.priceToCoordinate(livePriceRef.current);
      if (y !== null && y !== undefined && y > 0) {
        livePriceLineRef.current.style.display = 'block';
        livePriceLineRef.current.style.top = `${y}px`;
        livePriceLineRef.current.style.right = `${priceScaleWidth}px`;
        livePriceBadgeRef.current.style.display = 'block';
        livePriceBadgeRef.current.style.top = `${y}px`;
        livePriceBadgeRef.current.style.width = `${priceScaleWidth}px`;
      }
    }
  }, []);

  useEffect(() => {
    if (isDisposedRef.current || !seriesRef.current || !chartRef.current || !symbol) return;

    hydrateTradeLevelOverrides();

    const normalizedChartSymbol = symbol.replace(/[^A-Za-z0-9]/g, '').toUpperCase();
    const digits = getSymbolDigits(symbol);

    const queueTradeOverlayRelayout = () => {
      if (tradeOverlayRafRef.current !== null) return;
      tradeOverlayRafRef.current = requestAnimationFrame(() => {
        tradeOverlayRafRef.current = null;
        updateLabelPositions();
      });
    };

    const normalizeUnixSeconds = (value: unknown): number | null => {
      if (value == null || value === '') return null;
      if (typeof value === 'number' && Number.isFinite(value)) {
        return value > 1_000_000_000_000 ? Math.floor(value / 1000) : Math.floor(value);
      }
      if (typeof value === 'string') {
        const numeric = Number(value);
        if (Number.isFinite(numeric) && value.trim() !== '') {
          return numeric > 1_000_000_000_000 ? Math.floor(numeric / 1000) : Math.floor(numeric);
        }
        const parsed = new Date(value).getTime();
        return Number.isNaN(parsed) ? null : Math.floor(parsed / 1000);
      }
      return null;
    };

    const pickPositiveNumber = (...values: unknown[]): number => {
      for (const value of values) {
        const numeric = Number(value);
        if (Number.isFinite(numeric) && numeric > 0) return numeric;
      }
      return 0;
    };

    const getTradeTicketLabel = (tradeKey: string): string => {
      const ticket = tradeKey.replace(/^trade:/, '');
      return ticket ? `#${ticket.slice(-6)}` : '';
    };

    const priceTolerance = Math.max(Math.pow(10, -digits), Number.EPSILON);

    const resolveSymbolTick = (ticks: Record<string, any>) => {
      if (ticks[symbol]) return ticks[symbol];
      if (ticks[symbol.toUpperCase()]) return ticks[symbol.toUpperCase()];
      const exactKey = Object.keys(ticks).find((key) =>
        key.replace(/[^A-Za-z0-9]/g, '').toUpperCase() === normalizedChartSymbol,
      );
      return exactKey ? ticks[exactKey] : null;
    };

    const mapTradeTimestampToChartTime = (rawTimestamp: unknown): number | null => {
      const normalizedTimestamp = normalizeUnixSeconds(rawTimestamp);
      if (normalizedTimestamp == null) return null;

      const activeTf = prevTimeframeRef.current || timeframe;
      const timeframeSeconds = getTimeframeSeconds(activeTf as AggTimeframe);
      if (!Number.isFinite(timeframeSeconds) || timeframeSeconds <= 0) return normalizedTimestamp;

      if (candlesRef.current.length === 0) {
        return alignTimeframeBoundarySeconds(normalizedTimestamp, activeTf as AggTimeframe, timeframeSeconds);
      }

      const candidates = new Set<number>();
      const addCandidate = (value: number | null) => {
        if (value == null || !Number.isFinite(value)) return;
        candidates.add(alignTimeframeBoundarySeconds(value, activeTf as AggTimeframe, timeframeSeconds));
      };

      addCandidate(normalizedTimestamp);
      if (brokerTimeOffsetSec !== 0) {
        addCandidate(normalizedTimestamp - brokerTimeOffsetSec);
        addCandidate(normalizedTimestamp + brokerTimeOffsetSec);
      }

      let bestTime: number | null = null;
      let bestDistance = Number.POSITIVE_INFINITY;

      for (const candidate of candidates) {
        const nearest = getNearestCandleByTime(candidate);
        if (!nearest) continue;
        const distance = Math.abs(nearest.time - candidate);
        if (distance < bestDistance) {
          bestDistance = distance;
          bestTime = nearest.time;
        }
      }

      return bestTime ?? alignTimeframeBoundarySeconds(normalizedTimestamp, activeTf as AggTimeframe, timeframeSeconds);
    };

    const formatTradeTime = (chartTimeSeconds: number) => {
      const date = new Date((chartTimeSeconds + brokerTimeOffsetSec) * 1000);
      if (Number.isNaN(date.getTime())) return '--:--';
      return `${String(date.getUTCHours()).padStart(2, '0')}:${String(date.getUTCMinutes()).padStart(2, '0')}`;
    };

    const getEntryColor = (side: TradeSide) => side === 'BUY' ? TRADE_BUY_COLOR : TRADE_SELL_COLOR;
    const getExitColor = (side: TradeSide) => side === 'BUY' ? TRADE_SELL_COLOR : TRADE_BUY_COLOR;
    const getLiveTrailTime = () =>
      currentCandleRef.current?.time
      ?? candlesRef.current[candlesRef.current.length - 1]?.time
      ?? null;
    const getLiveTrailPrice = (side: TradeSide, fallbackPrice: number): number | null => {
      const tick = resolveSymbolTick(useAppStore.getState().ticks);
      const quote = side === 'BUY'
        ? Number(tick?.bid ?? tick?.last ?? 0)
        : Number(tick?.ask ?? tick?.bid ?? tick?.last ?? 0);
      if (quote > 0 && isLivePriceSafeForCandles(quote)) return quote;
      return fallbackPrice > 0 ? fallbackPrice : null;
    };
    const deriveClosedTradeColor = (trade: ClosedTradeSnapshot) => {
      const pnl = trade.profit ?? (
        trade.side === 'BUY' ? trade.exitPrice - trade.entryPrice : trade.entryPrice - trade.exitPrice
      );
      return pnl >= 0 ? TRADE_BUY_COLOR : TRADE_SELL_COLOR;
    };
    const scheduleHistoryRefresh = () => {
      if (tradeHistoryRefreshTimerRef.current !== null) {
        window.clearTimeout(tradeHistoryRefreshTimerRef.current);
      }
      tradeHistoryRefreshTimerRef.current = window.setTimeout(() => {
        tradeHistoryRefreshTimerRef.current = null;
        window.dispatchEvent(new Event('rtx:force-refresh-positions'));
      }, 350);
    };

    const resolveTradeLevels = (trade: ActiveTradeSnapshot): TradeLevelOverride => {
      const override = tradeLevelOverridesRef.current.get(trade.key);
      if (!override) return { sl: trade.sl || 0, tp: trade.tp || 0 };

      const serverSl = trade.sl || 0;
      const serverTp = trade.tp || 0;
      const overrideSl = override.sl || 0;
      const overrideTp = override.tp || 0;
      const slSynced = overrideSl <= 0 || (serverSl > 0 && Math.abs(serverSl - overrideSl) <= priceTolerance);
      const tpSynced = overrideTp <= 0 || (serverTp > 0 && Math.abs(serverTp - overrideTp) <= priceTolerance);

      if (slSynced && tpSynced) {
        tradeLevelOverridesRef.current.delete(trade.key);
        persistTradeLevelOverrides();
        return { sl: serverSl, tp: serverTp };
      }

      return {
        sl: overrideSl > 0 ? overrideSl : serverSl,
        tp: overrideTp > 0 ? overrideTp : serverTp,
      };
    };

    const createCollisionOffsetFactory = () => {
      const offsets = new Map<string, number>();

      return (role: TradeLevelRole, price: number) => {
        const key = `${role}:${price.toFixed(digits)}`;
        const offsetIndex = offsets.get(key) ?? 0;
        offsets.set(key, offsetIndex + 1);
        return offsetIndex;
      };
    };

    const formatSignaturePrice = (value?: number) => (Number(value) || 0).toFixed(digits);

    const appendOverlayNode = (element: HTMLElement, node: OverlayNodeData) => {
      overlayRef.current?.appendChild(element);
      overlayNodesRef.current.push(element);
      overlayNodeDataRef.current.push(node);
    };

    const createArrowSvg = (side: TradeSide, color: string) => side === 'BUY'
      ? `<svg width="8" height="11" viewBox="0 0 12 16" fill="none"><path d="M6 1L11 6H8V15H4V6H1L6 1Z" fill="${color}" stroke="#e5edf4" stroke-width="0.85" stroke-linejoin="round"/></svg>`
      : `<svg width="8" height="11" viewBox="0 0 12 16" fill="none"><path d="M6 15L1 10H4V1H8V10H11L6 15Z" fill="${color}" stroke="#e5edf4" stroke-width="0.85" stroke-linejoin="round"/></svg>`;

    const createTradeMarker = (side: TradeSide, price: number, time: number, title: string, color: string) => {
      const marker = document.createElement('div');
      marker.title = title;
      marker.innerHTML = createArrowSvg(side, color);
      marker.style.cssText = 'position:absolute;z-index:14;pointer-events:none;';
      appendOverlayNode(marker, { kind: 'marker', price, time, markerSide: side });
    };

    const createTradeLabel = (side: TradeSide, price: number, time: number, text: string, borderColor: string) => {
      const label = document.createElement('div');
      label.textContent = text;
      const isLight = document.documentElement.classList.contains('rtx-skin-untitled-light');
      const bg = isLight ? 'rgba(255, 255, 255, 0.92)' : 'rgba(10,15,24,0.92)';
      const textCol = isLight ? '#101828' : '#e7edf5';
      label.style.cssText = `position:absolute;padding:1px 5px;background:${bg};border:1px solid ${borderColor}66;border-radius:2px;color:${textCol};font-size:10px;line-height:1.25;font-family:Consolas,'Courier New',monospace;white-space:nowrap;z-index:15;pointer-events:none;box-shadow:0 2px 6px rgba(0,0,0,0.35);`;
      appendOverlayNode(label, { kind: 'label', price, time, labelOffsetX: 10, labelOffsetY: side === 'BUY' ? 2 : -18 });
    };

    const createTradeSegment = (price: number, time: number, color: string, lineStyle: 'solid' | 'dashed', endPrice?: number, endTime?: number, resolveEndPrice?: () => number | null, resolveEndTime?: () => number | null) => {
      const line = document.createElement('div');
      line.style.cssText = `position:absolute;height:0;border-top:${lineStyle === 'solid' ? '1.5px solid' : '1px dashed'} ${color};z-index:${lineStyle === 'solid' ? 11 : 9};pointer-events:none;`;
      appendOverlayNode(line, { kind: 'segment', price, time, endPrice, endTime, resolveEndPrice, resolveEndTime });
    };

    const createPriceLevel = (labelText: string, price: number, color: string, options: PriceLevelOptions = {}) => {
      if (!(price > 0)) return;

      const line = document.createElement('div');
      line.style.cssText = `position:absolute;height:0;border-top:1px dashed ${color}66;z-index:5;pointer-events:none;`;
      appendOverlayNode(line, { kind: 'horizontal-line', price });

      const badge = document.createElement('div');
      badge.textContent = labelText;
      badge.className = 'rtx-trade-level-badge';
      if (options.title) badge.title = options.title;
      if (options.tradeKey && options.role) {
        badge.dataset.tradeKey = options.tradeKey;
        badge.dataset.role = options.role;
      }
      const isLight = document.documentElement.classList.contains('rtx-skin-untitled-light');
      const bg = isLight ? 'rgba(255, 255, 255, 0.92)' : 'rgba(20,24,34,0.92)';
      const borderCol = isLight ? '#e5e7eb' : '#3a4354';
      const offsetIndex = options.badgeOffsetIndex ?? 0;
      const offsetStep = Math.ceil(offsetIndex / 2) * 64;
      const offsetDirection = offsetIndex % 2 === 0 ? 1 : -1;
      const offsetX = offsetIndex === 0 ? 0 : offsetDirection * offsetStep;
      const canDrag = Boolean(options.tradeKey && options.role);
      badge.style.cssText = `position:absolute;left:50%;padding:1px 5px;background:${bg};border:1px solid ${borderCol};color:${color};font-size:10px;font-family:Consolas,'Courier New',monospace;font-weight:600;white-space:nowrap;z-index:6;pointer-events:${canDrag ? 'auto' : 'none'};cursor:${canDrag ? 'ns-resize' : 'default'};border-radius:2px;transform:translate(calc(-50% + ${offsetX}px), -50%);min-width:52px;text-align:center;`;
      appendOverlayNode(badge, { kind: 'price-badge', price });
    };

    const renderTradeOverlay = (force = false) => {
      if (isDisposedRef.current || !seriesRef.current || !overlayRef.current) return;

      const chartProperties = useChartSettingsStore.getState().symbolProperties[symbol]
        || useChartSettingsStore.getState().globalProperties;
      const showTradeLevels = chartProperties.showTradeLevels !== false;
      const showTradeHistory = chartProperties.showTradeHistory !== false;
      const appState = useAppStore.getState();
      const appPositions = Array.isArray(appState.positions) ? appState.positions : [];
      const appTrades = Array.isArray(appState.trades) ? appState.trades : [];
      const liveTrailTime = getLiveTrailTime();

      const normalizedAppPositions = appPositions.map((position: any) => ({
        id: position.id,
        symbol: position.symbol,
        side: position.side === 'SELL' ? 'SELL' as const : 'BUY' as const,
        volume: Number(position.volume) || 0,
        openPrice: Number(position.openPrice) || 0,
        currentPrice: Number(position.currentPrice) || 0,
        rawOpenTime: normalizeUnixSeconds(position.openTime),
        sl: pickPositiveNumber(position.sl, position.price_sl),
        tp: pickPositiveNumber(position.tp, position.price_tp),
      }));

      const matchingPositions = normalizedAppPositions.filter((position) => {
        const positionSymbol = String(position.symbol || '').replace(/[^A-Za-z0-9]/g, '').toUpperCase();
        return Number(position.volume) > 0 && (
          positionSymbol === normalizedChartSymbol
          || positionSymbol.startsWith(normalizedChartSymbol)
          || normalizedChartSymbol.startsWith(positionSymbol)
        );
      });

      const nextActiveSnapshots = new Map<string, ActiveTradeSnapshot>();

      for (const position of matchingPositions) {
        const key = `trade:${String(position.id)}`;
        const storedEntryTime = frozenEntryTimesRef.current.get(key);
        const rawEntryTime = storedEntryTime ?? position.rawOpenTime ?? normalizeUnixSeconds(Date.now());
        if (storedEntryTime == null && rawEntryTime != null) {
          frozenEntryTimesRef.current.set(key, rawEntryTime);
        }

        const entryTime = mapTradeTimestampToChartTime(rawEntryTime) ?? liveTrailTime ?? rawEntryTime ?? 0;
        const entryPrice = position.openPrice > 0 ? position.openPrice : position.currentPrice;
        if (!(entryTime > 0) || !(entryPrice > 0)) continue;

        nextActiveSnapshots.set(key, {
          key,
          symbol: normalizedChartSymbol,
          side: position.side,
          volume: position.volume,
          entryPrice,
          entryTime,
          currentPrice: getLiveTrailPrice(position.side, position.currentPrice || entryPrice) ?? entryPrice,
          currentTime: liveTrailTime ?? entryTime,
          sl: position.sl,
          tp: position.tp,
        });
        optimisticClosedTradesRef.current.delete(key);
      }

      activeTradeSnapshotsRef.current.forEach((previousTrade, key) => {
        if (previousTrade.symbol !== normalizedChartSymbol || nextActiveSnapshots.has(key)) return;
        if (!optimisticClosedTradesRef.current.has(key)) {
          optimisticClosedTradesRef.current.set(key, {
            key,
            symbol: previousTrade.symbol,
            side: previousTrade.side,
            volume: previousTrade.volume,
            entryPrice: previousTrade.entryPrice,
            entryTime: previousTrade.entryTime,
            exitPrice: getLiveTrailPrice(previousTrade.side, previousTrade.currentPrice || previousTrade.entryPrice) ?? previousTrade.entryPrice,
            exitTime: getLiveTrailTime() ?? previousTrade.currentTime ?? previousTrade.entryTime,
            source: 'optimistic',
          });
          scheduleHistoryRefresh();
        }
      });

      activeTradeSnapshotsRef.current = nextActiveSnapshots;

      const closedTrades = new Map<string, ClosedTradeSnapshot>();
      const registerClosedTrade = (trade: ClosedTradeSnapshot) => {
        if (trade.entryPrice > 0 && trade.exitPrice > 0 && trade.entryTime > 0 && trade.exitTime > 0) {
          closedTrades.set(trade.key, trade);
          optimisticClosedTradesRef.current.delete(trade.key);
        }
      };

      if (showTradeHistory) {
        appTrades.forEach((trade: any) => {
          const tradeSymbol = String(trade.symbol || '').replace(/[^A-Za-z0-9]/g, '').toUpperCase();
          if (tradeSymbol !== normalizedChartSymbol || trade.closePrice == null || trade.closeTime == null) return;

          registerClosedTrade({
            key: `trade:${String(trade.id)}`,
            symbol: normalizedChartSymbol,
            side: trade.side === 'SELL' ? 'SELL' : 'BUY',
            volume: Number(trade.volume) || 0,
            entryPrice: Number(trade.openPrice) || 0,
            entryTime: mapTradeTimestampToChartTime(trade.openTime) ?? (normalizeUnixSeconds(trade.openTime) || 0),
            exitPrice: Number(trade.closePrice) || 0,
            exitTime: mapTradeTimestampToChartTime(trade.closeTime) ?? (normalizeUnixSeconds(trade.closeTime) || 0),
            profit: Number(trade.profit ?? 0),
            source: 'app-history',
          });
        });

        optimisticClosedTradesRef.current.forEach((trade) => {
          if (trade.symbol === normalizedChartSymbol && !closedTrades.has(trade.key)) {
            closedTrades.set(trade.key, trade);
          }
        });
      }

      const activeSignature = showTradeLevels
        ? Array.from(nextActiveSnapshots.values())
          .sort((a, b) => a.key.localeCompare(b.key))
          .map((trade) => {
            const levels = resolveTradeLevels(trade);
            return [
              trade.key,
              trade.side,
              trade.volume,
              trade.entryTime,
              formatSignaturePrice(trade.entryPrice),
              formatSignaturePrice(levels.sl),
              formatSignaturePrice(levels.tp),
            ].join(':');
          }).join('|')
        : '';
      const closedSignature = showTradeHistory
        ? Array.from(closedTrades.values())
          .sort((a, b) => a.key.localeCompare(b.key))
          .map((trade) => [
            trade.key,
            trade.side,
            trade.volume,
            trade.entryTime,
            trade.exitTime,
            formatSignaturePrice(trade.entryPrice),
            formatSignaturePrice(trade.exitPrice),
            trade.source,
          ].join(':')).join('|')
        : '';
      const nextSignature = [
        normalizedChartSymbol,
        timeframe,
        showTradeLevels ? 'levels:on' : 'levels:off',
        showTradeHistory ? 'history:on' : 'history:off',
        activeSignature,
        closedSignature,
      ].join('\n');

      if (!force && nextSignature === lastTradeOverlaySignatureRef.current) {
        queueTradeOverlayRelayout();
        return;
      }

      clearTradeOverlay();
      lastTradeOverlaySignatureRef.current = nextSignature;

      if (showTradeLevels) {
        const nextLevelOffset = createCollisionOffsetFactory();
        nextActiveSnapshots.forEach((trade) => {
          const entryColor = getEntryColor(trade.side);
          const ticketLabel = getTradeTicketLabel(trade.key);
          const markerTitle = `${trade.side} ${trade.volume} ${ticketLabel} @ ${trade.entryPrice.toFixed(digits)}`.trim();
          createTradeMarker(trade.side, trade.entryPrice, trade.entryTime, markerTitle, entryColor);

          createPriceLevel(
            `${trade.side} ${trade.volume} ${ticketLabel}`.trim(),
            trade.entryPrice,
            entryColor,
            {
              tradeKey: trade.key,
              role: 'ENTRY',
              badgeOffsetIndex: nextLevelOffset('ENTRY', trade.entryPrice),
              title: `${markerTitle}. Drag above/below to create TP or SL.`,
            },
          );

          const levels = resolveTradeLevels(trade);
          if (levels.sl && levels.sl > 0) {
            createPriceLevel(`SL ${ticketLabel}`.trim(), levels.sl, TRADE_SELL_COLOR, {
              tradeKey: trade.key,
              role: 'SL',
              badgeOffsetIndex: nextLevelOffset('SL', levels.sl),
              title: `Stop Loss for ${ticketLabel || trade.key}`,
            });
          }
          if (levels.tp && levels.tp > 0) {
            createPriceLevel(`TP ${ticketLabel}`.trim(), levels.tp, TRADE_BUY_COLOR, {
              tradeKey: trade.key,
              role: 'TP',
              badgeOffsetIndex: nextLevelOffset('TP', levels.tp),
              title: `Take Profit for ${ticketLabel || trade.key}`,
            });
          }
        });
      }

      if (showTradeHistory) {
        closedTrades.forEach((trade) => {
          const entryColor = getEntryColor(trade.side);
          const exitSide: TradeSide = trade.side === 'BUY' ? 'SELL' : 'BUY';
          createTradeSegment(trade.entryPrice, trade.entryTime, deriveClosedTradeColor(trade), 'solid', trade.exitPrice, trade.exitTime);
          createTradeMarker(trade.side, trade.entryPrice, trade.entryTime, `${trade.side} ${trade.volume} @ ${trade.entryPrice.toFixed(digits)}`, entryColor);
          if (trade.source === 'optimistic') {
            createTradeLabel(trade.side, trade.entryPrice, trade.entryTime, `${trade.side} ${trade.entryPrice.toFixed(digits)} | ${formatTradeTime(trade.entryTime)}`, entryColor);
          }
          createTradeMarker(exitSide, trade.exitPrice, trade.exitTime, `${exitSide} ${trade.volume} @ ${trade.exitPrice.toFixed(digits)}`, getExitColor(trade.side));
        });
      }

      queueTradeOverlayRelayout();
    };

    renderTradeOverlay();

    const crosshairLabelUpdater = () => updateLabelPositions();
    chartRef.current.subscribeCrosshairMove(crosshairLabelUpdater);

    const timeScaleHandler = () => updateLabelPositions();
    chartRef.current.timeScale().subscribeVisibleLogicalRangeChange(timeScaleHandler);

    const unsubscribeAppStore = useAppStore.subscribe((state, previousState) => {
      const currentTick = resolveSymbolTick(state.ticks);
      const previousTick = resolveSymbolTick(previousState.ticks);

      if (state.positions !== previousState.positions || state.trades !== previousState.trades) {
        renderTradeOverlay();
        return;
      }

      if (currentTick !== previousTick && activeTradeSnapshotsRef.current.size > 0) {
        queueTradeOverlayRelayout();
      }
    });

    const unsubscribeChartSettings = useChartSettingsStore.subscribe((state, previousState) => {
      const currentProperties = state.symbolProperties[symbol] || state.globalProperties;
      const previousProperties = previousState.symbolProperties[symbol] || previousState.globalProperties;
      if (
        currentProperties.showTradeLevels !== previousProperties.showTradeLevels
        || currentProperties.showTradeHistory !== previousProperties.showTradeHistory
      ) {
        renderTradeOverlay(true);
      }
    });

    const handleForceRefresh = () => {
      window.setTimeout(() => {
        renderTradeOverlay();
      }, 500);
    };
    const handleRefreshTradeOverlay = () => renderTradeOverlay();
    const handleFlushTradeOverlay = () => renderTradeOverlay(true);
    window.addEventListener('rtx:force-refresh-positions', handleForceRefresh);
    window.addEventListener('rtx:refresh-trade-overlay', handleRefreshTradeOverlay);
    window.addEventListener('rtx:flush-trade-overlay', handleFlushTradeOverlay);

    return () => {
      unsubscribeAppStore();
      unsubscribeChartSettings();
      window.removeEventListener('rtx:force-refresh-positions', handleForceRefresh);
      window.removeEventListener('rtx:refresh-trade-overlay', handleRefreshTradeOverlay);
      window.removeEventListener('rtx:flush-trade-overlay', handleFlushTradeOverlay);

      if (tradeHistoryRefreshTimerRef.current !== null) {
        window.clearTimeout(tradeHistoryRefreshTimerRef.current);
        tradeHistoryRefreshTimerRef.current = null;
      }
      if (tradeOverlayRafRef.current !== null) {
        cancelAnimationFrame(tradeOverlayRafRef.current);
        tradeOverlayRafRef.current = null;
      }

      try { chartRef.current?.unsubscribeCrosshairMove(crosshairLabelUpdater); } catch { }
      try { chartRef.current?.timeScale().unsubscribeVisibleLogicalRangeChange(timeScaleHandler); } catch { }

      clearTradeOverlay();
    };
  }, [brokerTimeOffsetSec, clearTradeOverlay, getNearestCandleByTime, hydrateTradeLevelOverrides, isLivePriceSafeForCandles, persistTradeLevelOverrides, symbol, timeframe, updateLabelPositions]);

  useEffect(() => {
    if (candlesLoadedRev <= 0) return;
    window.dispatchEvent(new CustomEvent('rtx:refresh-trade-overlay'));
  }, [candlesLoadedRev]);

  // Subscribe to positions from the store and render price lines
  useEffect(() => {
    return;
    if (isDisposedRef.current || !seriesRef.current || !symbol) return;

    const cleanup = () => {
      // Remove all custom left-side labels and execution pins
      for (const label of positionLabelsRef.current) {
        try { label.remove(); } catch { }
      }
      positionLabelsRef.current = [];
      positionLabelDataRef.current = [];
    };

    const createPositionElement = (
      text: string,
      color: string,
      price: number,
      isDashed: boolean,
      openTime?: number,
      volume?: number,
    ) => {
      const overlayEl = overlayRef.current;
      if (!overlayEl || !seriesRef.current) return;
      const digits = getSymbolDigits(symbol);
      const isEntry = isDashed;

      // All lines: dashed gray — same visual weight as live crosshair
      const lineColor = isEntry ? 'rgba(160,160,180,0.55)' : `${color}55`;

      const line = document.createElement('div');
      line.className = 'rtx-position-line';
      line.style.cssText = `
        position: absolute;
        left: 0;
        right: 52px;
        height: 0;
        border-top: 1px dashed ${lineColor};
        z-index: 4;
        pointer-events: none;
      `;
      overlayEl.appendChild(line);
      positionLabelsRef.current.push(line);
      positionLabelDataRef.current.push({ price, text: '', color, time: openTime });

      if (isEntry) {
        const isBuyLabel = text.toUpperCase().includes('BUY');
        const labelColor = isBuyLabel ? '#26a69a' : '#ef5350';
        const dirLabel = isBuyLabel ? 'BUY' : 'SELL';
        const volStr = volume != null ? String(volume) : '';

        // Left: plain colored text — no background, no border
        const label = document.createElement('div');
        label.className = 'rtx-position-label';
        label.style.cssText = `
          position: absolute;
          left: 4px;
          padding: 0 2px;
          background: transparent;
          color: ${labelColor};
          font-size: 10px;
          font-family: Consolas, 'Courier New', monospace;
          font-weight: 600;
          white-space: nowrap;
          z-index: 5;
          pointer-events: none;
          line-height: 14px;
          letter-spacing: 0.02em;
        `;
        label.textContent = `${dirLabel} ${volStr}`;
        overlayEl.appendChild(label);
        positionLabelsRef.current.push(label);
        positionLabelDataRef.current.push({ price, text, color: labelColor });


      } else {
        // SL / TP: dashed line already drawn above; right-side text-only badge
        const upperText = text.toUpperCase();
        const slTpLabel = upperText.includes('TP') ? 'TP' : upperText.includes('SL') ? 'SL' : text;

        const badge = document.createElement('div');
        badge.className = 'rtx-position-badge';
        badge.style.cssText = `
          position: absolute;
          right: 0;
          padding: 1px 5px;
          background: #2a2a38;
          border: 1px solid #444460;
          color: ${color};
          font-size: 10px;
          font-family: Consolas, 'Courier New', monospace;
          font-weight: 600;
          white-space: nowrap;
          z-index: 6;
          pointer-events: none;
          border-radius: 2px;
          transform: translateY(-50%);
          letter-spacing: 0.02em;
          min-width: 52px;
          text-align: center;
        `;
        badge.textContent = slTpLabel;
        overlayEl.appendChild(badge);
        positionLabelsRef.current.push(badge);
        positionLabelDataRef.current.push({ price, text: '__badge__', color });
      }
    };

    const createHistoryPath = (entryPrice: number, entryTime: number, exitPrice: number, exitTime: number, isBuy: boolean, volume: number) => {
      const overlayEl = overlayRef.current;
      if (!overlayEl || !seriesRef.current || !chartRef.current) return;

      const isProfit = isBuy ? exitPrice >= entryPrice : entryPrice >= exitPrice;
      const color = isBuy ? '#2962FF' : '#ef5350';

      // The dashed connecting line
      const line = document.createElement('div');
      line.className = 'rtx-history-line';
      line.style.cssText = `
        position: absolute;
        height: 0;
        border-top: 1.5px dashed ${color}aa;
        z-index: 10;
        pointer-events: none;
      `;
      overlayEl.appendChild(line);
      positionLabelsRef.current.push(line);
      positionLabelDataRef.current.push({ price: entryPrice, time: entryTime, exitTime, exitPrice, text: '', color, isHistoryLine: true });

      // The Entry arrow — anchored to wick low (buy) or wick high (sell) via nearest candle
      const entryArrow = document.createElement('div');
      entryArrow.className = 'rtx-history-arrow-entry';
      entryArrow.title = `Trade IN: ${isBuy ? 'BUY' : 'SELL'} ${volume} @ ${entryPrice}`;
      entryArrow.innerHTML = isBuy
        ? `<svg width="14" height="14" viewBox="0 0 12 12"><polygon points="6,2 10,10 2,10" fill="#2962FF" stroke="#fff" stroke-width="1.5" stroke-linejoin="round"/></svg>`
        : `<svg width="14" height="14" viewBox="0 0 12 12"><polygon points="2,2 10,2 6,10" fill="#ef5350" stroke="#fff" stroke-width="1.5" stroke-linejoin="round"/></svg>`;
      entryArrow.style.cssText = `position: absolute; z-index: 12; pointer-events: none; filter: drop-shadow(0 0 3px ${color}99);`;
      overlayEl.appendChild(entryArrow);
      positionLabelsRef.current.push(entryArrow);
      positionLabelDataRef.current.push({ price: entryPrice, time: entryTime, text: '', color, isPin: true, isBuyDeal: isBuy });

      // The Exit arrow (opposite direction shape)
      const exitArrow = document.createElement('div');
      exitArrow.className = 'rtx-history-arrow-exit';
      exitArrow.title = `Trade OUT: ${isBuy ? 'SELL' : 'BUY'} ${volume} @ ${exitPrice}`;
      exitArrow.innerHTML = isBuy
        ? `<svg width="14" height="14" viewBox="0 0 12 12"><polygon points="2,2 10,2 6,10" fill="#ef5350" stroke="#fff" stroke-width="1.5" stroke-linejoin="round"/></svg>`
        : `<svg width="14" height="14" viewBox="0 0 12 12"><polygon points="6,2 10,10 2,10" fill="#2962FF" stroke="#fff" stroke-width="1.5" stroke-linejoin="round"/></svg>`;
      exitArrow.style.cssText = `position: absolute; z-index: 12; pointer-events: none; filter: drop-shadow(0 0 3px ${isBuy ? '#ef5350' : '#2962FF'}99);`;
      overlayEl.appendChild(exitArrow);
      positionLabelsRef.current.push(exitArrow);
      positionLabelDataRef.current.push({ price: exitPrice, time: exitTime, text: '', color: isBuy ? '#ef5350' : '#2962FF', isPin: true, isBuyDeal: !isBuy });
    };

    const createExecutionPin = (text: string, color: string, price: number, time: number, _isBuy: boolean, yOffset = 0) => {
      const overlayEl = overlayRef.current;
      if (!overlayEl || !seriesRef.current || !chartRef.current) return;

      const pin = document.createElement('div');
      pin.className = 'rtx-execution-pin-arrow';
      pin.title = text;

      pin.innerHTML = _isBuy
        ? `<svg width="12" height="12" viewBox="0 0 12 12"><polygon points="6,2 10,10 2,10" fill="#2962FF" stroke="#fff" stroke-width="1.5" stroke-linejoin="round"/></svg>`
        : `<svg width="12" height="12" viewBox="0 0 12 12"><polygon points="2,2 10,2 6,10" fill="#ef5350" stroke="#fff" stroke-width="1.5" stroke-linejoin="round"/></svg>`;

      pin.style.cssText = `
        position: absolute;
        width: 12px;
        height: 12px;
        z-index: 20;
        pointer-events: none;
        filter: drop-shadow(0 0 2px ${_isBuy ? '#2962FF' : '#ef5350'}88);
      `;

      overlayEl.appendChild(pin);
      positionLabelsRef.current.push(pin);
      positionLabelDataRef.current.push({ price, time, text, color, isPin: true, isBuyDeal: _isBuy, marginTop: yOffset });
    };

    const renderPositionLines = () => {
      if (isDisposedRef.current || !seriesRef.current) return;

      cleanup();

      const getCandleBoundaryTime = (timestamp: number) => {
        const tfs = getTimeframeSeconds(timeframe as AggTimeframe);
        const candleBoundary = alignTimeframeBoundarySeconds(timestamp, timeframe as AggTimeframe, tfs);
        let targetTime = candleBoundary;
        const candles = candlesRef.current;
        if (candles && candles.length > 0) {
          let lo = 0, hi = candles.length - 1, best = candles[0].time as number;
          while (lo <= hi) {
            const mid = (lo + hi) >> 1;
            if ((candles[mid].time as number) <= candleBoundary) {
              best = candles[mid].time as number;
              lo = mid + 1;
            } else { hi = mid - 1; }
          }
          targetTime = best;
        }
        return targetTime;
      };

      // Binary search for nearest candle by time (not exact match)
      const getNearestCandle = (time: number): any | null => {
        const candles = candlesRef.current;
        if (!candles || candles.length === 0) return null;
        let lo = 0, hi = candles.length - 1, best = candles[0] as any;
        while (lo <= hi) {
          const mid = (lo + hi) >> 1;
          const ct = candles[mid].time as number;
          if (Math.abs(ct - time) < Math.abs((best.time as number) - time)) best = candles[mid] as any;
          if (ct <= time) lo = mid + 1; else hi = mid - 1;
        }
        return best;
      };

      const state = useAppStore.getState();
      const appPositions = state.positions || [];
      const mt5State = { history: [] as any[] };
      const mt5Positions: any[] = ([] as any[]).map((p: any) => {
        const rawAction = p.action;
        const actionStr = String(rawAction ?? '').toUpperCase().trim();
        const isBuy = rawAction === 0 || actionStr === '0' || actionStr === 'BUY';

        let openTime: string | null = null;
        // Priority: time_create_msc > time_create > open_time_captured (our reliable registry) 
        // > time_setup_msc > time_setup > time > time_ms (last resort, may be tick time)
        if (p.time_create_msc && p.time_create_msc > 0) {
          openTime = new Date(p.time_create_msc).toISOString();
        } else if (p.time_create && p.time_create > 0) {
          openTime = new Date(p.time_create * 1000).toISOString();
        } else if ((p as any).open_time_captured && (p as any).open_time_captured > 0) {
          const ms = (p as any).open_time_captured;
          openTime = new Date(ms > 1_000_000_000_000 ? ms : ms * 1000).toISOString();
        } else if (p.time_setup_msc && p.time_setup_msc > 0) {
          openTime = new Date(p.time_setup_msc).toISOString();
        } else if (p.time_setup && p.time_setup > 0) {
          openTime = new Date(p.time_setup * 1000).toISOString();
        } else if (p.time && p.time > 0) {
          // time is typically seconds since epoch from MT5 REST API (true open time)
          const ms = p.time > 1_000_000_000_000 ? p.time : p.time * 1000;
          openTime = new Date(ms).toISOString();
        } else if (p.time_ms && p.time_ms > 0) {
          // Last resort: time_ms — may be last-tick time, but frozenEntryTimesRef
          // will ensure only the FIRST captured value is ever used for this ticket
          const ms = p.time_ms > 1_000_000_000_000 ? p.time_ms : p.time_ms * 1000;
          openTime = new Date(ms).toISOString();
        } else if (p.openTime) {
          openTime = p.openTime;
        }

        return {
          id: p.ticket,
          symbol: p.symbol,
          side: isBuy ? 'BUY' : 'SELL',
          volume: p.volume,
          openPrice: p.open_price || p.price_open || p.openPrice || p.current_price || 0,
          currentPrice: p.current_price || p.price_current || p.currentPrice || 0,
          openTime,
          sl: p.sl,
          tp: p.tp,
        };
      });

      const allIds = new Set(mt5Positions.map((p: any) => p.id));
      const positions = [
        ...mt5Positions,
        ...appPositions.filter((p: any) => !allIds.has(p.id)),
      ];

      const normalizedChartSymbol = symbol.replace(/[^a-zA-Z0-9]/g, '').toUpperCase();
      const myPositions = positions.filter(p => {
        const posSymbol = (p.symbol || '').replace(/[^a-zA-Z0-9]/g, '').toUpperCase();
        const matchesSymbol = posSymbol === normalizedChartSymbol || posSymbol.startsWith(normalizedChartSymbol) || normalizedChartSymbol.startsWith(posSymbol);
        const vol = Number(p.volume);
        return matchesSymbol && !isNaN(vol) && vol > 0;
      });

      // 1. Draw Active Positions
      // Track how many pins share the same (candle time, price) coordinate so we
      // can offset them vertically, making each one individually visible.
      const pinCollisionMap = new Map<string, number>(); // key: `${targetTime}_${entryPrice.toFixed(2)}` → count

      for (const pos of myPositions) {
        const isBuy = pos.side === 'BUY';
        const entryColor = isBuy ? '#26a69a' : '#ef5350';
        const volume = pos.volume != null ? Number(pos.volume) : 0;
        const entryPrice = Number(pos.openPrice) > 0 ? Number(pos.openPrice) : (Number(pos.currentPrice) || 0);
        const digits = getSymbolDigits(symbol);

        let openTimestamp = 0;
        const ticketKey = pos.id;

        // Check frozen map first — never update once set
        if (ticketKey && frozenEntryTimesRef.current.has(ticketKey)) {
          openTimestamp = frozenEntryTimesRef.current.get(ticketKey)!;
        } else if (pos.openTime) {
          if (typeof pos.openTime === 'string') {
            const parsed = Math.floor(new Date(pos.openTime).getTime() / 1000);
            if (parsed > 0) {
              openTimestamp = parsed;
            }
          } else {
            const raw = Number(pos.openTime);
            openTimestamp = raw > 1_000_000_000_000 ? Math.floor(raw / 1000) : raw;
          }
          // Freeze it for this ticket — never overwrite
          if (ticketKey && openTimestamp > 0) {
            frozenEntryTimesRef.current.set(ticketKey, openTimestamp);
          }
        }

        let targetTime: number | undefined = undefined;
        if (openTimestamp > 0) {
          targetTime = getCandleBoundaryTime(openTimestamp);
        }

        // Compute vertical stack offset for this pin (handles same-price same-candle)
        const collisionKey = `${targetTime ?? 'x'}_${entryPrice.toFixed(2)}_${isBuy ? 'B' : 'S'}`;
        const collisionIdx = pinCollisionMap.get(collisionKey) ?? 0;
        pinCollisionMap.set(collisionKey, collisionIdx + 1);
        // Each duplicate steps 20px further away from price (BUY: below, SELL: above)
        const pinYOffset = collisionIdx * 20;

        if (entryPrice > 0) {
          createPositionElement(
            `${isBuy ? 'BUY' : 'SELL'} ${volume}`,
            entryColor,
            entryPrice,
            true,
            targetTime,
            volume,
          );
        }

        if (pos.sl && pos.sl > 0) {
          createPositionElement(`SL ${pos.sl.toFixed(digits)}`, '#ef5350', pos.sl, false);
        }

        if (pos.tp && pos.tp > 0) {
          createPositionElement(`TP ${pos.tp.toFixed(digits)}`, '#26a69a', pos.tp, false);
        }

        if (targetTime && entryPrice > 0) {
          createExecutionPin(
            `${isBuy ? 'BUY' : 'SELL'} ${volume} @ ${entryPrice.toFixed(digits)}`,
            entryColor,
            entryPrice,
            targetTime,
            isBuy,
            pinYOffset,
          );
        }
      }

      // 2. Draw Historical Trades
      const historyConnections: { entryPrice: number; entryTime: number; exitPrice: number; exitTime: number; isBuy: boolean; volume: number }[] = [];
      const mt5HistoryDeals = Array.isArray(mt5State.history) ? mt5State.history : [];
      const historyByPosition = new Map<number, typeof mt5HistoryDeals>();

      mt5HistoryDeals.filter(d => (d.symbol || '').replace(/[^a-zA-Z0-9]/g, '').toUpperCase() === normalizedChartSymbol).forEach(d => {
        const pid = (d as any).position || (d as any).position_id;
        if (pid) {
          if (!historyByPosition.has(pid)) historyByPosition.set(pid, []);
          historyByPosition.get(pid)!.push(d);
        }
      });

      historyByPosition.forEach(deals => {
        const inDeals = deals.filter((d: any) => d.entry === '0' || d.entry === 'IN' || d.entry === 0);
        const outDeals = deals.filter((d: any) => d.entry === '1' || d.entry === 'OUT' || d.entry === 1);
        if (inDeals.length > 0 && outDeals.length > 0) {
          inDeals.forEach(inD => {
            outDeals.forEach(outD => {
              const typeRaw = (inD as any).type;
              const isBuy = String(typeRaw).toUpperCase().includes('BUY') || typeRaw === 0 || typeRaw === '0';
              historyConnections.push({
                entryPrice: inD.price,
                entryTime: Math.floor(inD.time_ms / 1000), // assumed to be ms
                exitPrice: outD.price,
                exitTime: Math.floor(outD.time_ms / 1000),
                isBuy,
                volume: outD.volume
              });
            });
          });
        }
      });

      const appTrades = Array.isArray(state.trades) ? state.trades : [];
      appTrades.filter((t: any) => (t.symbol || '').replace(/[^a-zA-Z0-9]/g, '').toUpperCase() === normalizedChartSymbol).forEach((t: any) => {
        if (t.closeTime && t.closePrice) {
          const entryTs = typeof t.openTime === 'string' ? Math.floor(new Date(t.openTime).getTime() / 1000) : t.openTime;
          const exitTs = typeof t.closeTime === 'string' ? Math.floor(new Date(t.closeTime).getTime() / 1000) : t.closeTime;
          historyConnections.push({
            entryPrice: t.openPrice,
            entryTime: entryTs,
            exitPrice: t.closePrice,
            exitTime: exitTs,
            isBuy: t.side === 'BUY',
            volume: t.volume
          });
        }
      });

      historyConnections.forEach(hc => {
        if (hc.entryTime > 0 && hc.exitTime > 0) {
          const entryTarget = getCandleBoundaryTime(hc.entryTime);
          const exitTarget = getCandleBoundaryTime(hc.exitTime);
          createHistoryPath(hc.entryPrice, entryTarget, hc.exitPrice, exitTarget, hc.isBuy, hc.volume);
        }
      });


      // Native lightweight charts markers have been removed to prevent messy stacking.
      // Replaced with overlapping HTML Execution Pins.

      // Position the dynamically created nodes immediately to prevent (0,0) flicker
      setTimeout(() => updateLabelPositions(), 0);
    };


    // Render immediately
    renderPositionLines();

    // Update label positions on every crosshair move
    const crosshairLabelUpdater = (_param: any) => {
      updateLabelPositions();
    };
    if (chartRef.current) {
      chartRef.current.subscribeCrosshairMove(crosshairLabelUpdater);
    }

    // Also update on time scale changes (scroll, zoom)
    const timeScaleHandler = () => {
      updateLabelPositions();
    };
    if (chartRef.current) {
      chartRef.current.timeScale().subscribeVisibleLogicalRangeChange(timeScaleHandler);
    }

    // Re-render when useAppStore positions change
    const unsubscribePositions = useAppStore.subscribe((state, prevState) => {
      if (state.positions !== prevState.positions) {
        console.log(`[TradingChart] AppStore positions updated, re-rendering lines for ${symbol}`);
        renderPositionLines();
      }
    });

    // Also listen for force-refresh event (fired after trade execution)
    // Use a small delay to give the API time to reflect the new position
    const handleForceRefresh = () => {
      setTimeout(() => {
        console.log(`[TradingChart] Force-refresh positions for ${symbol}`);
        renderPositionLines();
      }, 500);
    };
    window.addEventListener('rtx:force-refresh-positions', handleForceRefresh);

    return () => {
      unsubscribePositions();
      window.removeEventListener('rtx:force-refresh-positions', handleForceRefresh);
      if (chartRef.current) {
        try { chartRef.current.unsubscribeCrosshairMove(crosshairLabelUpdater); } catch { }
        try { chartRef.current.timeScale().unsubscribeVisibleLogicalRangeChange(timeScaleHandler); } catch { }
      }
      cleanup();
    };
  }, [symbol, chartType, updateLabelPositions, candlesLoadedRev]);


  // ── Context menu handlers ──────────────────────────────────────────────────
  const handleContextMenu = useCallback((e: React.MouseEvent) => {
    e.preventDefault(); // Block the browser's native right-click menu

    // If the right-click originated from a drawing SVG hit element, let the
    // DrawingContextMenu handle it — don't show the chart menu on top.
    let node: HTMLElement | null = e.target as HTMLElement;
    while (node) {
      // SVG drawing groups have data-id attribute; SVG overlay has class chart-svg-overlay
      if (node.hasAttribute?.('data-id') || (node as any).classList?.contains?.('chart-svg-overlay')) {
        return; // DrawingContextMenu will handle this right-click
      }
      node = node.parentElement;
    }

    setCtxMenu({ visible: true, x: e.clientX, y: e.clientY });
  }, []);

  const closeCtxMenu = useCallback(() => {
    setCtxMenu(prev => ({ ...prev, visible: false }));
  }, []);

  const handleCtxChartTypeChange = useCallback((type: ChartType) => {
    setLocalChartType(type);
    commandBus.dispatch({ type: 'SET_CHART_TYPE', payload: { chartType: type } });
  }, []);

  const handleCtxTimeframeChange = useCallback((tf: Timeframe) => {
    commandBus.dispatch({ type: 'SET_TIMEFRAME' as any, payload: { timeframe: tf } });
    window.dispatchEvent(new CustomEvent('change-timeframe', { detail: { timeframe: tf } }));
  }, []);

  const handleCtxToggleGrid = useCallback(() => {
    const currentGrid = useChartSettingsStore.getState().globalProperties.showGrid;
    useChartSettingsStore.getState().updateGlobalProperty('showGrid', !currentGrid);
  }, []);

  const handleCtxToggleVolumes = useCallback(() => {
    const currentVols = useChartSettingsStore.getState().globalProperties.showTickVolumes;
    useChartSettingsStore.getState().updateGlobalProperty('showTickVolumes', !currentVols);
  }, []);

  const handleCtxToggleAutoScroll = useCallback(() => {
    setCtxAutoScroll(prev => {
      const next = !prev;
      useChartSettingsStore.getState().updateGlobalProperty('chartAutoScroll', next);
      commandBus.dispatch({ type: 'SET_AUTO_SCROLL' as any, payload: { enabled: next } });
      return next;
    });
  }, []);

  const handleCtxToggleChartShift = useCallback(() => {
    setCtxChartShift(prev => {
      const next = !prev;
      useChartSettingsStore.getState().updateGlobalProperty('chartShift', next);
      commandBus.dispatch({ type: 'SET_CHART_SHIFT' as any, payload: { enabled: next } });
      return next;
    });
  }, []);

  const handleCtxToggleTradeLevels = useCallback(() => {
    setCtxShowTradeLevels(prev => {
      const next = !prev;
      useChartSettingsStore.getState().updateGlobalProperty('showTradeLevels', next);
      window.dispatchEvent(new CustomEvent('rtx:flush-trade-overlay'));
      return next;
    });
  }, []);

  const handleCtxZoomIn = useCallback(() => {
    commandBus.dispatch({ type: 'ZOOM_IN', payload: {} });
  }, []);

  const handleCtxZoomOut = useCallback(() => {
    commandBus.dispatch({ type: 'ZOOM_OUT', payload: {} });
  }, []);

  const handleCtxDeleteIndicators = () => {
    indicatorManager.clearAll();
  };

  const handleOpenTemplateDialog = (mode: 'save' | 'load') => {
    setTemplateDialogMode(mode);
    setTemplateDialogOpen(true);
  };

  const handleLoadTemplate = (template: ChartTemplate) => {
    // Apply template settings
    setLocalChartType(template.chartType as ChartType);
    // You might need more logic here to apply indicators/drawings
    console.log('[TradingChart] Loading template:', template);
    setTemplateDialogOpen(false);
  };

  const handleCtxOpenNewOrder = useCallback(() => {
    window.dispatchEvent(new CustomEvent('openNewOrder'));
  }, []);

  const handleCtxOpenDOM = useCallback(() => {
    window.dispatchEvent(new CustomEvent('openDepthOfMarket', { detail: { symbol } }));
  }, [symbol]);

  const handleCtxRefresh = useCallback(() => {
    loadHistory();
  }, [loadHistory]);

  const handleCtxSaveAsPicture = useCallback(() => {
    captureFullPage();
  }, []);

  const handleCtxOpenProperties = useCallback(() => {
    window.dispatchEvent(new CustomEvent('openChartProperties', { detail: { symbol } }));
  }, [symbol]);

  // ── Drag to Spawn MT5 Trade Levels ──
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    let dragLineOverlay: HTMLDivElement | null = null;
    let dragBadgeOverlay: HTMLDivElement | null = null;
    let dragState: {
      tradeObj: ActiveTradeSnapshot;
      role: 'SL' | 'TP';
      grabbedType: 'ENTRY' | 'SL' | 'TP';
    } | null = null;

    const getChartY = (e: PointerEvent) => {
      const rect = container.getBoundingClientRect();
      return e.clientY - rect.top;
    };

    const handlePointerDown = (e: PointerEvent) => {
      // Only trigger on left-click and if an active tool is not enabled (i.e. crosshair is active)
      if (e.button !== 0 || !seriesRef.current || activeToolRef.current !== null) return;
      if (chartSettingsRef.current.showTradeLevels === false) return;

      const y = getChartY(e);
      let closestTrade: ActiveTradeSnapshot | null = null;
      let grabbedType: 'ENTRY' | 'SL' | 'TP' = 'ENTRY';
      let minDistance = 10; // 10px snap bounds

      const targetBadge = e.target instanceof Element
        ? e.target.closest('.rtx-trade-level-badge') as HTMLElement | null
        : null;
      const targetTradeKey = targetBadge?.dataset.tradeKey;
      const targetRole = targetBadge?.dataset.role as TradeLevelRole | undefined;
      if (targetTradeKey && (targetRole === 'ENTRY' || targetRole === 'SL' || targetRole === 'TP')) {
        const directTrade = activeTradeSnapshotsRef.current.get(targetTradeKey);
        if (directTrade) {
          closestTrade = directTrade;
          grabbedType = targetRole;
        }
      }

      if (!closestTrade) {
        activeTradeSnapshotsRef.current.forEach(trade => {
          const entryY = seriesRef.current!.priceToCoordinate(trade.entryPrice);
          if (entryY !== null) {
            const dist = Math.abs(entryY - y);
            if (dist < minDistance) {
              minDistance = dist;
              closestTrade = trade;
              grabbedType = 'ENTRY';
            }
          }
          const override = tradeLevelOverridesRef.current.get(trade.key);
          const currentSl = override && override.sl > 0 ? override.sl : trade.sl;
          if (currentSl && currentSl > 0) {
            const slY = seriesRef.current!.priceToCoordinate(currentSl);
            if (slY !== null && Math.abs(slY - y) < minDistance) {
              minDistance = Math.abs(slY - y);
              closestTrade = trade;
              grabbedType = 'SL';
            }
          }
          const currentTp = override && override.tp > 0 ? override.tp : trade.tp;
          if (currentTp && currentTp > 0) {
            const tpY = seriesRef.current!.priceToCoordinate(currentTp);
            if (tpY !== null && Math.abs(tpY - y) < minDistance) {
              minDistance = Math.abs(tpY - y);
              closestTrade = trade;
              grabbedType = 'TP';
            }
          }
        });
      }

      if (closestTrade) {
        e.preventDefault();
        e.stopPropagation();
        if (chartRef.current) {
          chartRef.current.applyOptions({
            handleScroll: { pressedMouseMove: false, horzTouchDrag: false },
            handleScale: { axisPressedMouseMove: { time: false, price: false } }
          });
        }

        dragState = { tradeObj: closestTrade, role: grabbedType === 'ENTRY' ? 'SL' : grabbedType, grabbedType };

        dragLineOverlay = document.createElement('div');
        dragLineOverlay.style.cssText = `position:absolute;left:0;right:52px;height:0;border-top:1px dashed transparent;z-index:999;pointer-events:none;transform:translateY(${y}px)`;

        dragBadgeOverlay = document.createElement('div');
        const isLight = document.documentElement.classList.contains('rtx-skin-untitled-light');
        const badgeBg = isLight ? 'rgba(255, 255, 255, 0.92)' : '#2a2a38';
        const borderCol = isLight ? '#e5e7eb' : 'transparent';
        dragBadgeOverlay.style.cssText = `position:absolute;left:50%;padding:1px 5px;background:${badgeBg};border:1px solid ${borderCol};font-size:10px;font-family:Consolas,monospace;font-weight:600;z-index:1000;pointer-events:none;border-radius:2px;transform:translate(-50%, calc(-50% + ${y}px));`;

        overlayRef.current?.appendChild(dragLineOverlay);
        overlayRef.current?.appendChild(dragBadgeOverlay);
      }
    };

    const handlePointerMove = (e: PointerEvent) => {
      if (!dragState || !dragLineOverlay || !dragBadgeOverlay || !seriesRef.current) return;
      const y = getChartY(e);
      const price = seriesRef.current.coordinateToPrice(y as any);
      if (price === null) return;

      const { tradeObj, grabbedType } = dragState;
      let role: 'SL' | 'TP' = grabbedType === 'ENTRY' ? 'SL' : grabbedType;
      let color = '#eb415c'; // RED

      if (grabbedType === 'ENTRY') {
        if (tradeObj.side === 'BUY') {
          if (price > tradeObj.entryPrice) { role = 'TP'; color = '#00a256'; }
        } else {
          if (price < tradeObj.entryPrice) { role = 'TP'; color = '#00a256'; }
        }
      } else {
        color = role === 'TP' ? '#00a256' : '#eb415c';
      }

      // 5-pip deadzone to avoid accidental triggering
      const ptDist = Math.abs(price - tradeObj.entryPrice);
      const minDistance = 5 * Math.pow(10, -getSymbolDigits(tradeObj.symbol));
      if (ptDist < minDistance) {
        dragLineOverlay.style.borderTopColor = 'transparent';
        dragBadgeOverlay.style.opacity = '0';
      } else {
        dragLineOverlay.style.borderTopColor = color;
        dragBadgeOverlay.style.opacity = '1';
      }

      dragState.role = role;
      dragLineOverlay.style.transform = `translateY(${y}px)`;

      dragBadgeOverlay.style.color = color;
      dragBadgeOverlay.textContent = `${role} ${price.toFixed(getSymbolDigits(tradeObj.symbol))}`;
      dragBadgeOverlay.style.transform = `translate(-50%, calc(-50% + ${y}px))`;
    };

    const handlePointerUp = (e: PointerEvent) => {
      if (!dragState) return;

      if (seriesRef.current) {
        const y = getChartY(e);
        const finalPrice = seriesRef.current.coordinateToPrice(y as any);
        const { tradeObj, role } = dragState;

        if (finalPrice !== null) {
          const ptDist = Math.abs(finalPrice - tradeObj.entryPrice);
          const minDistance = 5 * Math.pow(10, -getSymbolDigits(tradeObj.symbol));
          if (ptDist >= minDistance) {
            const ticket = Number(tradeObj.key.replace('trade:', ''));
            if (ticket) {
              const existingOverrides = tradeLevelOverridesRef.current.get(tradeObj.key);
              const currentSl = existingOverrides && existingOverrides.sl > 0 ? existingOverrides.sl : tradeObj.sl;
              const currentTp = existingOverrides && existingOverrides.tp > 0 ? existingOverrides.tp : tradeObj.tp;

              const sl = role === 'SL' ? finalPrice : currentSl;
              const tp = role === 'TP' ? finalPrice : currentTp;

              // Optimistically set UI level overrides immediately
              tradeLevelOverridesRef.current.set(tradeObj.key, { sl: sl || 0, tp: tp || 0 });
              persistTradeLevelOverrides();
              window.dispatchEvent(new CustomEvent('rtx:flush-trade-overlay')); // flush instantly
              window.dispatchEvent(new CustomEvent('rtx:trade-modified', { detail: { id: ticket, sl: sl || 0, tp: tp || 0 } }));

              api.positions.modifyPosition(ticket, { price_sl: sl || 0, price_tp: tp || 0 })
                .then(() => {
                  window.setTimeout(() => window.dispatchEvent(new Event('rtx:force-refresh-positions')), 250);
                })
                .catch(err => {
                  console.error('[Chart] Failed to modify SL/TP:', err);
                  // On outright error, revert override
                  tradeLevelOverridesRef.current.delete(tradeObj.key);
                  persistTradeLevelOverrides();
                  window.dispatchEvent(new CustomEvent('rtx:flush-trade-overlay'));
                });
            }
          }
        }
      }

      if (dragLineOverlay) dragLineOverlay.remove();
      if (dragBadgeOverlay) dragBadgeOverlay.remove();
      dragLineOverlay = null;
      dragBadgeOverlay = null;
      dragState = null;

      if (chartRef.current) {
        chartRef.current.applyOptions({
          handleScroll: { pressedMouseMove: true, horzTouchDrag: true },
          handleScale: { axisPressedMouseMove: { time: false, price: true } }
        });
      }
    };

    container.addEventListener('pointerdown', handlePointerDown);
    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', handlePointerUp);

    return () => {
      container.removeEventListener('pointerdown', handlePointerDown);
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', handlePointerUp);
      if (dragLineOverlay) dragLineOverlay.remove();
      if (dragBadgeOverlay) dragBadgeOverlay.remove();
    };
  }, [persistTradeLevelOverrides]);

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div
      className="rtx-chart-wrapper relative w-full h-full bg-[#0d0d0d]"
      data-cursor="select"
      onContextMenu={handleContextMenu}
    >

      {/* ── Inline Text Input Overlay (for text drawing tool) ── */}
      {textInputOverlay && (
        <div
          className="rtx-chart-text-input-popover fixed z-[9999] flex flex-col gap-1 p-2 rounded shadow-2xl"
          style={{
            left: textInputOverlay.x,
            top: textInputOverlay.y,
            background: 'var(--rtx-chart-text-input-bg, #18181b)',
            border: '1px solid var(--rtx-chart-text-input-border, #3f3f46)',
            transform: 'translate(-50%, -120%)',
            minWidth: 180,
          }}
        >
          <div className="text-xs text-zinc-400 mb-1">Enter text label</div>
          <input
            autoFocus
            type="text"
            value={textInputValue}
            onChange={e => setTextInputValue(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter' && textInputValue.trim()) {
                // Place text drawing
                drawingManager.updateActiveDrawing({ text: textInputValue.trim() });
                const activeDrawing = drawingManager.getActiveDrawing();
                if (activeDrawing?.type === 'callout') {
                  drawingManager.finishDrawing();
                } else {
                  drawingManager.addPoint(textInputOverlay.time, textInputOverlay.price);
                }
                setTextInputOverlay(null);
                setTextInputValue('');
                // Auto-reset to cursor
                commandBus.dispatch({ type: 'SELECT_TOOL', payload: { tool: 'cursor' } } as any);
              } else if (e.key === 'Escape') {
                drawingManager.cancelDrawing();
                setTextInputOverlay(null);
                setTextInputValue('');
                commandBus.dispatch({ type: 'SELECT_TOOL', payload: { tool: 'cursor' } } as any);
              }
            }}
            className="px-2 py-1 rounded text-sm text-white bg-zinc-800 border border-zinc-600 outline-none focus:border-blue-500"
            placeholder="Type and press Enter"
          />
          <div className="flex gap-1">
            <button
              onClick={() => {
                if (textInputValue.trim()) {
                  drawingManager.updateActiveDrawing({ text: textInputValue.trim() });
                  const activeDrawing = drawingManager.getActiveDrawing();
                  if (activeDrawing?.type === 'callout') {
                    drawingManager.finishDrawing();
                  } else {
                    drawingManager.addPoint(textInputOverlay.time, textInputOverlay.price);
                  }
                }
                setTextInputOverlay(null);
                setTextInputValue('');
                commandBus.dispatch({ type: 'SELECT_TOOL', payload: { tool: 'cursor' } } as any);
              }}
              className="flex-1 px-2 py-1 rounded text-xs bg-blue-600 hover:bg-blue-500 text-white"
            >
              OK
            </button>
            <button
              onClick={() => {
                drawingManager.cancelDrawing();
                setTextInputOverlay(null);
                setTextInputValue('');
                commandBus.dispatch({ type: 'SELECT_TOOL', payload: { tool: 'cursor' } } as any);
              }}
              className="flex-1 px-2 py-1 rounded text-xs bg-zinc-700 hover:bg-zinc-600 text-zinc-300"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* API Error banner — suppressed, errors only logged to console */}

      {/* Loading — phased status: connecting → receiving → fades out on ready */}
      {loadingPhase !== 'hidden' && (
        <div
          className={`absolute inset-0 flex flex-col items-center justify-center bg-[#0a0a0f]/95 z-20 pointer-events-none transition-opacity duration-300 ${loadingPhase === 'ready' ? 'opacity-0' : 'opacity-100'}`}
        >
          <div className="flex items-end gap-1 mb-5 opacity-30" aria-hidden="true">
            {Array.from({ length: 14 }).map((_, i) => (
              <div
                key={i}
                className="w-2 bg-white/40 rounded-sm animate-pulse"
                style={{
                  height: `${22 + ((i * 17) % 56)}px`,
                  animationDelay: `${i * 80}ms`,
                }}
              />
            ))}
          </div>
          <div className="flex items-center gap-3 text-white/90">
            <div className="w-4 h-4 border-2 border-white/25 border-t-white rounded-full animate-spin" />
            <div
              key={loadingMessageIdx}
              className="text-sm tracking-wide transition-opacity duration-300"
            >
              {loadingPhase === 'ready' ? 'Ready' : loadingMessages[loadingMessageIdx]}
            </div>
          </div>
        </div>
      )}


      {/* Premium MT5 HTML HUD — dark mode keeps original styling;
          advanced/untitled-light mode gets sans font, semibold/bold mix,
          theme-purple symbol with traditional H/L colors highlighted in soft pills. */}
      {isAdvancedUntitledLight ? (
        <div style={{
          position: 'absolute', top: 8, left: 12, zIndex: 15, pointerEvents: 'none',
          fontFamily: "system-ui, -apple-system, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif",
          fontSize: '11px', letterSpacing: '0.01em',
          display: 'flex', alignItems: 'center', gap: '8px'
        }}>
          <span style={{
            fontWeight: 700, color: '#7f56d9',
            background: 'rgba(127, 86, 217, 0.10)',
            padding: '2px 8px', borderRadius: '4px',
          }}>{symbol}, {timeframe}</span>
          <span style={{ fontWeight: 500, color: '#475467' }}>
            O: <span ref={ohlcOpenRef} style={{
              fontWeight: 600, color: '#1d2939',
              background: 'rgba(29, 41, 57, 0.06)', padding: '1px 6px', borderRadius: '3px'
            }}>0.00000</span>
          </span>
          <span style={{ fontWeight: 500, color: '#475467' }}>
            H: <span ref={ohlcHighRef} style={{
              fontWeight: 600, color: '#16a34a',
              background: 'rgba(22, 163, 74, 0.10)', padding: '1px 6px', borderRadius: '3px'
            }}>0.00000</span>
          </span>
          <span style={{ fontWeight: 500, color: '#475467' }}>
            L: <span ref={ohlcLowRef} style={{
              fontWeight: 600, color: '#dc2626',
              background: 'rgba(220, 38, 38, 0.10)', padding: '1px 6px', borderRadius: '3px'
            }}>0.00000</span>
          </span>
          <span style={{ fontWeight: 500, color: '#475467' }}>
            C: <span ref={ohlcCloseRef} style={{
              fontWeight: 600, color: '#1d2939',
              background: 'rgba(29, 41, 57, 0.06)', padding: '1px 6px', borderRadius: '3px'
            }}>0.00000</span>
          </span>
          <span style={{ fontWeight: 500, color: '#475467' }}>
            V: <span ref={ohlcVolumeRef} style={{
              fontWeight: 600, color: '#1d2939',
              background: 'rgba(29, 41, 57, 0.06)', padding: '1px 6px', borderRadius: '3px'
            }}>0</span>
          </span>
          <span ref={countdownTextRef} style={{
            marginLeft: '6px', fontWeight: 700, color: '#b45309',
            background: 'rgba(245, 158, 11, 0.12)', padding: '1px 6px', borderRadius: '3px'
          }}></span>
        </div>
      ) : (
        <div style={{
          position: 'absolute', top: 8, left: 12, zIndex: 15, pointerEvents: 'none',
          fontFamily: "Consolas, 'Courier New', monospace", fontSize: '11px', color: '#A1A1AA',
          textShadow: '1px 1px 1px rgba(0,0,0,0.8)', display: 'flex', alignItems: 'center', gap: '8px'
        }}>
          <span style={{ fontWeight: 'bold', color: '#E4E4E7' }}>{symbol}, {timeframe}</span>
          <span>O: <span ref={ohlcOpenRef} style={{ color: '#E4E4E7' }}>0.00000</span></span>
          <span>H: <span ref={ohlcHighRef} style={{ color: '#22C55E' }}>0.00000</span></span>
          <span>L: <span ref={ohlcLowRef} style={{ color: '#EF4444' }}>0.00000</span></span>
          <span>C: <span ref={ohlcCloseRef} style={{ color: '#E4E4E7' }}>0.00000</span></span>
          <span>V: <span ref={ohlcVolumeRef} style={{ color: '#E4E4E7' }}>0</span></span>
          <span ref={countdownTextRef} style={{ marginLeft: '12px', color: '#F59E0B', fontWeight: 'bold' }}></span>
        </div>
      )}

      {/* Chart Container - must have explicit dimensions for lightweight-charts */}
      <div ref={containerRef} className="absolute inset-0 w-full h-full" />

      {/* Static background grid overlay (MT5-style: does not move with pan/scroll) */}
      {chartSettings.showGrid && (
        <div
          className="absolute inset-0"
          style={{
            pointerEvents: 'none',
            zIndex: 1,
            backgroundImage:
              `linear-gradient(to right, ${chartColors.grid} 1px, transparent 1px), ` +
              `linear-gradient(to bottom, ${chartColors.grid} 1px, transparent 1px)`,
            backgroundSize: '80px 50px',
          }}
        />
      )}

      {/* Drawing Overlay — always pointer-events:none so chart canvas receives all mouse events */}
      <div ref={overlayRef} className="chart-drawing-overlay absolute inset-0" style={{ pointerEvents: 'none', zIndex: 10 }} />

      {/* ── Custom crosshair — 5 GPU-composited divs, all pointer-events:none ── */}
      {/* Vertical line: 1px wide, full height, snapped to nearest candle X */}
      <div ref={vertLineRef} style={{
        position: 'absolute', left: 0, top: 0,
        width: 1, height: '100%',
        background: 'rgba(148,163,184,0.75)',
        pointerEvents: 'none', zIndex: 14, opacity: 0,
        willChange: 'transform',
      }} />
      {/* Horizontal line: 1px tall, full width, exact cursor Y */}
      <div ref={horizLineRef} style={{
        position: 'absolute', left: 0, top: 0,
        width: '100%', height: 1,
        background: 'rgba(148,163,184,0.75)',
        pointerEvents: 'none', zIndex: 14, opacity: 0,
        willChange: 'transform',
      }} />
      {/* Centre "+" marker: 12×12, two thin crossed lines */}
      <div ref={centerRef} style={{
        position: 'absolute', left: 0, top: 0,
        width: 12, height: 12,
        pointerEvents: 'none', zIndex: 15, opacity: 0,
        willChange: 'transform',
      }}>
        <div style={{ position: 'absolute', left: 0, top: 5, width: 12, height: 1, background: 'rgba(148,163,184,0.95)' }} />
        <div style={{ position: 'absolute', left: 5, top: 0, width: 1, height: 12, background: 'rgba(148,163,184,0.95)' }} />
      </div>
      {/* Time label: bottom of chart at snappedX */}
      <div ref={timeLabelRef} style={{
        position: 'absolute', left: 0, top: 0,
        background: '#334155', color: '#e2e8f0',
        fontSize: 10, fontFamily: "Consolas,'Courier New',monospace",
        padding: '1px 5px', borderRadius: 2,
        whiteSpace: 'nowrap',
        pointerEvents: 'none', zIndex: 15, opacity: 0,
        willChange: 'transform',
      }} />
      {/* Price label: right edge at cursor Y */}
      <div ref={priceLabelRef} style={{
        position: 'absolute', left: 0, top: 0,
        width: 54, textAlign: 'center',
        background: '#334155', color: '#e2e8f0',
        fontSize: 10, fontFamily: "Consolas,'Courier New',monospace",
        padding: '1px 4px', borderRadius: 2,
        whiteSpace: 'nowrap',
        pointerEvents: 'none', zIndex: 15, opacity: 0,
        willChange: 'transform',
      }} />

      {/* ── Live current-price line + badge (MT5 last-price indicator) ── */}
      <div
        ref={livePriceLineRef}
        style={{
          position: 'absolute',
          top: -9999,
          left: 0,
          right: 52,
          height: 0,
          borderTop: '1px solid #5A5A66',
          pointerEvents: 'none',
          zIndex: 7,
          transform: 'translateY(-0.5px)',
        }}
      />
      <div
        ref={livePriceBadgeRef}
        style={{
          position: 'absolute',
          top: -9999,
          right: 0,
          padding: '1px 4px',
          background: '#5A5A66',
          color: '#ffffff',
          fontSize: 11,
          fontFamily: "Consolas, 'Courier New', monospace",
          fontWeight: 700,
          whiteSpace: 'nowrap',
          pointerEvents: 'none',
          zIndex: 9,
          borderRadius: 1,
          transform: 'translateY(-50%)',
          letterSpacing: '0.01em',
          textAlign: 'center',
          boxSizing: 'border-box',
        }}
      />

      {/* Drawing Context Menu (Right-click on drawings) */}
      <DrawingContextMenu onClose={() => { }} />

      {/* One-Click Trading Panel (Alt+T to toggle) */}
      <OneClickTrading symbol={symbol} timeframe={timeframe} visible={showOneClick} />



      {/* ── MT5-Style Chart Right-Click Context Menu ── */}
      <ChartContextMenu
        visible={ctxMenu.visible}
        x={ctxMenu.x}
        y={ctxMenu.y}
        symbol={symbol}
        currentChartType={localChartType}
        currentTimeframe={prevTimeframeRef.current || timeframe}
        oneClickTrading={showOneClick}
        showGrid={chartSettings.showGrid}
        showVolumes={chartSettings.showTickVolumes}
        autoScroll={ctxAutoScroll}
        chartShift={ctxChartShift}
        showTradeLevels={ctxShowTradeLevels}
        onChangeChartType={handleCtxChartTypeChange}
        onChangeTimeframe={handleCtxTimeframeChange}
        onToggleOneClickTrading={() => setShowOneClick(prev => !prev)}
        onToggleGrid={handleCtxToggleGrid}
        onToggleVolumes={handleCtxToggleVolumes}
        onToggleAutoScroll={handleCtxToggleAutoScroll}
        onToggleChartShift={handleCtxToggleChartShift}
        onToggleTradeLevels={handleCtxToggleTradeLevels}
        onOpenProperties={handleCtxOpenProperties}
        onSaveAsPicture={handleCtxSaveAsPicture}
        onPrintChart={() => window.print()}
        onRefresh={handleCtxRefresh}
        onZoomIn={handleCtxZoomIn}
        onZoomOut={handleCtxZoomOut}
        onDeleteIndicators={handleCtxDeleteIndicators}
        onOpenNewOrder={handleCtxOpenNewOrder}
        onOpenDOM={handleCtxOpenDOM}
        onOpenTemplateDialog={handleOpenTemplateDialog}
        onClose={closeCtxMenu}
        currentIndicators={[]}
        currentDrawingTools={[]}
      />

      {/* Chart Template Dialog hosted here so it stays open when context menu closes */}
      <ChartTemplateDialog
        isOpen={templateDialogOpen}
        onClose={() => setTemplateDialogOpen(false)}
        mode={templateDialogMode}
        currentConfig={{
          chartType: localChartType,
          timeframe: timeframe,
          showGrid: chartSettings.showGrid,
          showVolumes: chartSettings.showTickVolumes,
          indicators: [], // Should be real indicators
          drawingTools: [],
          colors: { background: '#0e0e12', grid: '#222226', candle: { up: '#00c896', down: '#ff4d4f', border: '#378658' }, volume: { up: '#00c896', down: '#ff4d4f' } }
        }}
        onLoadTemplate={handleLoadTemplate}
      />
    </div>
  );
});
