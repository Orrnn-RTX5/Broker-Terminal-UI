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
import { rememberTradeHistoryPositionLevels } from '../utils/tradeHistoryLevelCache';
import { ChartContextMenu } from './ChartContextMenu';
import { captureFullPage } from '../services/screenshotService';
import { indicatorManager } from '../services/indicatorManager';
import { chartDataService } from '../services/chartDataService';
import {
  getChartPriceFromQuote,
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
import {
  clampChartOpacityPercent,
  defaultChartProperties,
  useChartSettingsStore,
  type ChartProperties,
} from '../store/useChartSettingsStore';
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
  applyTradeLevelDragUpdate,
  createTradeLevelOverrideFingerprint,
  getTradeLevelDragMinDistance,
  selectNearestTradeLevel,
} from '../utils/tradeLevelDrag';
import {
  activateActiveChartSource,
  findLargestChartCanvas,
  registerActiveChartSource,
} from '../services/activeChartSource';
import {
  buildOptimisticClosedTradeSnapshot,
  buildClosedTradeHistorySnapshots,
  dispatchTradeOverlayCloseState,
  filterActiveTradeKeysForHistory,
  forgetTradeOverlayOptimisticClosedSnapshot,
  getTradeOverlayOptimisticClosedSnapshots,
  getTradeOverlayCloseSnapshots,
  getTradeOverlayCloseState,
  getTradeOverlayCloseTicketKeys,
  getTradeOverlayRedrawDecision,
  resolveNearestTradeOverlayCandleTime,
  resolveStableTradeEntryPrice,
  resolveStableTradeEntryTime,
  resolveTradeOverlaySegmentGeometry,
  shouldKeepMissingActiveTradeOverlay,
  shouldUseClosedTradeHistorySnapshot,
  TRADE_OVERLAY_CLOSE_STATE_EVENT,
  TRADE_OVERLAY_CLOSE_SUPPRESSION_TTL_MS,
  type ClosedTradeOverlaySnapshot,
  type TradeOverlayCloseSnapshotSeed,
  type TradeOverlayHistoryRow,
} from '../services/tradeOverlayHistory';

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
const TRADE_LEVEL_OPTIMISTIC_GRACE_MS = 15_000;
const TRADE_LEVEL_HIT_AREA_PX = 24;
const TRADE_LEVEL_MIN_DRAG_PX = 2;
const TRADE_LEVEL_CROSS_CLOSE_CANDIDATE_TTL_MS = 15_000;
const TRADE_LEVEL_BADGE_LEFT_INSET_PX = 10;
const TRADE_LEVEL_BADGE_STACK_OFFSET_PX = 76;
const TRADE_MISSING_POSITION_GRACE_MS = 30_000;
const REALTIME_SCROLL_THRESHOLD_BARS = 2;
const TRANSPARENT_CHART_LINE = 'rgba(0, 0, 0, 0)';

const parseCssColor = (value: string): { r: number; g: number; b: number } | null => {
  const color = value.trim();
  const hexMatch = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(color);
  if (hexMatch) {
    const hex = hexMatch[1].length === 3
      ? hexMatch[1].split('').map((part) => `${part}${part}`).join('')
      : hexMatch[1];
    return {
      r: Number.parseInt(hex.slice(0, 2), 16),
      g: Number.parseInt(hex.slice(2, 4), 16),
      b: Number.parseInt(hex.slice(4, 6), 16),
    };
  }

  const rgbMatch = /^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)/i.exec(color);
  if (!rgbMatch) return null;
  return {
    r: Math.min(255, Math.max(0, Number(rgbMatch[1]))),
    g: Math.min(255, Math.max(0, Number(rgbMatch[2]))),
    b: Math.min(255, Math.max(0, Number(rgbMatch[3]))),
  };
};

const isLightChartBackground = (background: string): boolean => {
  const color = parseCssColor(background);
  if (!color) return false;
  return (0.2126 * color.r) + (0.7152 * color.g) + (0.0722 * color.b) >= 180;
};

type TradeOverlayCardTone = 'BUY' | 'SELL' | 'SL' | 'TP';

interface TradeOverlayCardPalette {
  background: string;
  border: string;
  text: string;
  shadow: string;
}

const getTradeOverlayCardPalette = (
  tone: TradeOverlayCardTone,
  isLightSurface: boolean,
): TradeOverlayCardPalette => {
  const isPositiveTone = tone === 'BUY' || tone === 'TP';
  if (isLightSurface) {
    return isPositiveTone
      ? {
        background: 'rgba(236, 253, 243, 0.9)',
        border: '#17b26a',
        text: '#027a48',
        shadow: 'box-shadow:0 1px 3px rgba(16,24,40,0.12);',
      }
      : {
        background: 'rgba(254, 243, 242, 0.9)',
        border: '#f04438',
        text: '#b42318',
        shadow: 'box-shadow:0 1px 3px rgba(16,24,40,0.12);',
      };
  }

  return isPositiveTone
    ? {
      background: 'rgba(5, 46, 30, 0.9)',
      border: '#22c55e',
      text: '#bbf7d0',
      shadow: 'box-shadow:0 2px 8px rgba(0,0,0,0.28);',
    }
    : {
      background: 'rgba(69, 10, 10, 0.9)',
      border: '#ef4444',
      text: '#fecaca',
      shadow: 'box-shadow:0 2px 8px rgba(0,0,0,0.28);',
    };
};
const TRADING_VIEW_GRID_OVERLAY_SIZE = '92px 50px';
const LIVE_PRICE_UP_COLOR = '#089981';
const LIVE_PRICE_DOWN_COLOR = '#f23645';

const TRADING_VIEW_HANDLE_SCROLL = {
  vertTouchDrag: false,
  horzTouchDrag: true,
  mouseWheel: true,
  pressedMouseMove: true,
} as const;

const TRADING_VIEW_HANDLE_SCALE = {
  axisPressedMouseMove: { time: true, price: true },
  axisDoubleClickReset: { time: true, price: true },
  mouseWheel: true,
  pinch: true,
} as const;

const DRAWING_LOCK_HANDLE_SCROLL = {
  vertTouchDrag: false,
  horzTouchDrag: false,
  mouseWheel: false,
  pressedMouseMove: false,
} as const;

const DRAWING_LOCK_HANDLE_SCALE = {
  axisPressedMouseMove: false,
  axisDoubleClickReset: false,
  mouseWheel: false,
  pinch: false,
} as const;

type TradeLevelRole = 'ENTRY' | 'SL' | 'TP';

interface TradeLevelOverride {
  sl: number;
  tp: number;
}

type TradeLevelModifyRequestId = number;

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
  tickVolume?: number;
  realVolume?: number;
}

type VolumeDisplaySettings = Pick<ChartProperties, 'showTickVolumes' | 'showRealVolumes'>;

const finiteVolumeOrNull = (value: unknown): number | null => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
};

const getDisplayVolume = (candle: Candle, settings: VolumeDisplaySettings): number => {
  if (settings.showRealVolumes && !settings.showTickVolumes) {
    return finiteVolumeOrNull(candle.realVolume) ?? 0;
  }

  return finiteVolumeOrNull(candle.tickVolume)
    ?? finiteVolumeOrNull(candle.volume)
    ?? finiteVolumeOrNull(candle.realVolume)
    ?? 0;
};

const getLivePriceOverlayColor = (
  currentCandle: Candle | null,
  activeCandleTime?: number,
  nextClose?: number,
): string => {
  if (!currentCandle || !Number.isFinite(currentCandle.open)) return LIVE_PRICE_UP_COLOR;
  if (activeCandleTime !== undefined && currentCandle.time !== activeCandleTime) return LIVE_PRICE_UP_COLOR;
  const close = nextClose ?? currentCandle.close;
  if (!Number.isFinite(close)) return LIVE_PRICE_UP_COLOR;
  return close >= currentCandle.open ? LIVE_PRICE_UP_COLOR : LIVE_PRICE_DOWN_COLOR;
};

type ChartColorPalette = ChartProperties['colors'];
type FormattedSeriesDatum =
  | { time: Time; value: number }
  | { time: Time; open: number; high: number; low: number; close: number };

const CHART_AXIS_FONT_FAMILY = '"Inter", "Segoe UI", Tahoma, Arial, sans-serif';
const CHART_AXIS_FONT_SIZE = 11;

interface FormattedVolumeDatum {
  time: Time;
  value: number;
  color: string;
}

interface TradingViewChartTheme {
  background: string;
  text: string;
  axisText: string;
  grid: string;
  scaleBorder: string;
  crosshair: string;
  candleUp: string;
  candleDown: string;
  barUp: string;
  barDown: string;
  wickUp: string;
  wickDown: string;
  line: string;
  areaTop: string;
  areaBottom: string;
  volumeUp: string;
  volumeDown: string;
}

const clampAlpha = (alpha: number): number => Math.max(0, Math.min(1, alpha));

const colorWithAlpha = (color: string | undefined, alpha: number, fallback: string): string => {
  if (!color) return fallback;
  const nextAlpha = clampAlpha(alpha);
  const trimmed = color.trim();
  const shortHex = /^#([a-f\d])([a-f\d])([a-f\d])$/i.exec(trimmed);
  if (shortHex) {
    const [, r, g, b] = shortHex;
    return `rgba(${parseInt(r + r, 16)}, ${parseInt(g + g, 16)}, ${parseInt(b + b, 16)}, ${nextAlpha})`;
  }

  const longHex = /^#([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(trimmed);
  if (longHex) {
    const [, r, g, b] = longHex;
    return `rgba(${parseInt(r, 16)}, ${parseInt(g, 16)}, ${parseInt(b, 16)}, ${nextAlpha})`;
  }

  const rgb = /^rgb\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*\)$/i.exec(trimmed);
  if (rgb) {
    const [, r, g, b] = rgb;
    return `rgba(${r}, ${g}, ${b}, ${nextAlpha})`;
  }

  const rgba = /^rgba\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*[\d.]+\s*\)$/i.exec(trimmed);
  if (rgba) {
    const [, r, g, b] = rgba;
    return `rgba(${r}, ${g}, ${b}, ${nextAlpha})`;
  }

  return fallback;
};

const getColorLuminance = (color: string | undefined): number | null => {
  if (!color) return null;
  const trimmed = color.trim();
  const shortHex = /^#([a-f\d])([a-f\d])([a-f\d])$/i.exec(trimmed);
  if (shortHex) {
    const [, r, g, b] = shortHex;
    return ((parseInt(r + r, 16) * 0.2126) + (parseInt(g + g, 16) * 0.7152) + (parseInt(b + b, 16) * 0.0722)) / 255;
  }

  const longHex = /^#([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(trimmed);
  if (longHex) {
    const [, r, g, b] = longHex;
    return ((parseInt(r, 16) * 0.2126) + (parseInt(g, 16) * 0.7152) + (parseInt(b, 16) * 0.0722)) / 255;
  }

  const rgb = /^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)(?:,\s*[\d.]+\s*)?\)$/i.exec(trimmed);
  if (rgb) {
    const [, r, g, b] = rgb;
    return ((Number(r) * 0.2126) + (Number(g) * 0.7152) + (Number(b) * 0.0722)) / 255;
  }

  return null;
};

const buildChartTheme = (colors: ChartColorPalette, showGrid: boolean): TradingViewChartTheme => {
  const candleUp = colors.bullCandle || colors.barUp || '#089981';
  const candleDown = colors.bearCandle || colors.barDown || '#f23645';
  const barUp = colors.barUp || candleUp;
  const barDown = colors.barDown || candleDown;
  const line = colors.lineChart || '#2962ff';
  const rawGrid = colors.grid || 'rgba(120, 144, 156, 0.28)';
  const backgroundLuminance = getColorLuminance(colors.background) ?? 0;
  const backgroundIsDark = backgroundLuminance < 0.45;
  const gridLuminance = getColorLuminance(rawGrid);
  const lightGrid = gridLuminance === null || gridLuminance > 0.86 ? '#d0d5dd' : rawGrid;
  const grid = showGrid
    ? (backgroundIsDark ? colorWithAlpha(rawGrid, 0.1, 'rgba(148, 163, 184, 0.1)') : lightGrid)
    : TRANSPARENT_CHART_LINE;

  return {
    background: colors.background || '#0e0e12',
    text: colors.foreground || '#ffffff',
    axisText: backgroundIsDark
      ? colorWithAlpha(colors.foreground, 0.72, 'rgba(226, 232, 240, 0.72)')
      : colorWithAlpha(colors.foreground, 0.7, 'rgba(71, 84, 103, 0.7)'),
    grid,
    scaleBorder: colorWithAlpha(colors.foreground, 0.24, 'rgba(255, 255, 255, 0.24)'),
    crosshair: colorWithAlpha(colors.foreground, 0.58, 'rgba(255, 255, 255, 0.58)'),
    candleUp,
    candleDown,
    barUp,
    barDown,
    wickUp: barUp,
    wickDown: barDown,
    line,
    areaTop: colorWithAlpha(line, 0.22, 'rgba(41, 98, 255, 0.22)'),
    areaBottom: colorWithAlpha(line, 0, 'rgba(41, 98, 255, 0)'),
    volumeUp: colorWithAlpha(barUp, 0.28, 'rgba(8, 153, 129, 0.28)'),
    volumeDown: colorWithAlpha(barDown, 0.28, 'rgba(242, 54, 69, 0.28)'),
  };
};

const formatChartSeriesData = (
  candles: Candle[],
  chartType: ChartType,
  theme: TradingViewChartTheme,
  volumeSettings: VolumeDisplaySettings,
): {
  sortedCandles: Candle[];
  seriesData: FormattedSeriesDatum[];
  volumeData: FormattedVolumeDatum[];
} => {
  const uniqueCandles = new Map<number, Candle>();
  candles.forEach(candle => uniqueCandles.set(candle.time, candle));

  const sortedCandles = Array.from(uniqueCandles.values())
    .filter(candle =>
      candle.open != null &&
      candle.high != null &&
      candle.low != null &&
      candle.close != null &&
      Number.isFinite(candle.open) &&
      Number.isFinite(candle.high) &&
      Number.isFinite(candle.low) &&
      Number.isFinite(candle.close)
    )
    .sort((a, b) => a.time - b.time);

  const seriesData: FormattedSeriesDatum[] = chartType === 'line' || chartType === 'area'
    ? sortedCandles.map(candle => ({
      time: candle.time as Time,
      value: candle.close,
    }))
    : sortedCandles.map(candle => ({
      time: candle.time as Time,
      open: candle.open,
      high: candle.high,
      low: candle.low,
      close: candle.close,
    }));

  const volumeData: FormattedVolumeDatum[] = sortedCandles.map(candle => ({
    time: candle.time as Time,
    value: getDisplayVolume(candle, volumeSettings),
    color: candle.close >= candle.open ? theme.volumeUp : theme.volumeDown,
  }));

  return { sortedCandles, seriesData, volumeData };
};

const shouldScrollToRealtime = (
  chart: IChartApi | null,
  autoScrollEnabled: boolean,
  chartAutoScroll: boolean,
): boolean => {
  if (!chart || !autoScrollEnabled || !chartAutoScroll) return false;
  const scrollPosition = chart.timeScale().scrollPosition();
  return Number.isFinite(scrollPosition) && scrollPosition >= 0 && scrollPosition <= REALTIME_SCROLL_THRESHOLD_BARS;
};

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

type ClosedTradeSnapshot = ClosedTradeOverlaySnapshot;

interface OverlayNodeData {
  kind: 'horizontal-line' | 'price-badge' | 'price-hit-area' | 'segment' | 'marker' | 'label';
  price?: number;
  time?: number;
  endPrice?: number;
  endTime?: number;
  markerSide?: TradeSide;
  labelOffsetX?: number;
  labelOffsetY?: number;
  resolveTime?: () => number | null;
  resolveEndPrice?: () => number | null;
  resolveEndTime?: () => number | null;
}

type TradeOverlayLayer = 'active' | 'history';

interface PriceLevelOptions {
  tradeKey?: string;
  role?: TradeLevelRole;
  badgeOffsetIndex?: number;
  title?: string;
  labelVariant?: 'badge' | 'lineText';
  lineColor?: string;
}

interface TradingChartProps {
  symbol: string;
  timeframe?: Timeframe;
  chartType?: ChartType;
  panelId?: string;
  tradeAllowed?: boolean;
  isActive?: boolean;
}

export const TradingChart = React.memo(function TradingChart({
  symbol,
  timeframe = 'M5',
  chartType = 'candlestick',
  panelId,
  tradeAllowed = false,
  isActive = true,
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
  const [ctxShowTradeHistory, setCtxShowTradeHistory] = useState(() => {
    const state = useChartSettingsStore.getState();
    return state.symbolProperties[symbol]?.showTradeHistory ?? state.globalProperties.showTradeHistory;
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
  // Tracks current bar spacing (px/bar) for toolbar zoom commands.
  const pixelsPerBarRef = useRef(2);
  const resetVisibleRangeOnNextDataRef = useRef(true);

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

  const flushTradeOverlay = useCallback(() => {
    if (typeof window === 'undefined') return;
    window.dispatchEvent(new CustomEvent('rtx:flush-trade-overlay'));
  }, []);

  const refreshVisibleChartLayout = useCallback(() => {
    if (isDisposedRef.current) return;

    const chart = chartRef.current;
    const container = containerRef.current;
    if (chart && container) {
      const { offsetWidth, offsetHeight } = container;
      if (offsetWidth > 0 && offsetHeight > 0) {
        try {
          chart.applyOptions({ width: offsetWidth, height: offsetHeight });
        } catch {
          // Chart can be disposed during fast tab/workspace switches.
        }
      }
    }

    flushTradeOverlay();
  }, [flushTradeOverlay]);

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

  const paintLivePriceOverlay = useCallback((
    livePrice: number,
    y: number,
    scaleW: number,
    activeCandleTime?: number,
    directionClose?: number,
  ) => {
    const line = livePriceLineRef.current;
    const badge = livePriceBadgeRef.current;
    if (!line || !badge) return;

    const digits = getSymbolDigits(symbol);
    const badgeColor = getLivePriceOverlayColor(currentCandleRef.current, activeCandleTime, directionClose);

    line.style.top = `${y}px`;
    line.style.right = `${scaleW}px`;
    line.style.borderTopColor = badgeColor;
    line.style.display = 'block';

    badge.style.top = `${y}px`;
    badge.style.width = `${scaleW}px`;
    badge.style.background = badgeColor;
    badge.textContent = livePrice.toFixed(digits);
    badge.style.display = 'block';
  }, [symbol]);

  const renderLivePriceOverlay = useCallback((livePrice: number, activeCandleTime?: number, directionClose?: number) => {
    livePriceRef.current = livePrice;

    if (!livePriceLineRef.current || !livePriceBadgeRef.current || !seriesRef.current) return;

    const y = seriesRef.current.priceToCoordinate(livePrice);
    if (y === null || y === undefined) {
      hideLivePriceOverlay(false);
      return;
    }

    const scaleW = seriesRef.current.priceScale().width();
    paintLivePriceOverlay(livePrice, y, scaleW, activeCandleTime, directionClose);
  }, [hideLivePriceOverlay, paintLivePriceOverlay]);

  const repaintLivePriceOverlayFromCurrentPrice = useCallback((activeCandle: Candle) => {
    const livePrice = livePriceRef.current;
    if (livePrice === null || !livePriceLineRef.current || !livePriceBadgeRef.current || !seriesRef.current) return;

    const y = seriesRef.current.priceToCoordinate(livePrice);
    if (y === null || y === undefined) {
      hideLivePriceOverlay(false);
      return;
    }

    const scaleW = seriesRef.current.priceScale().width();
    paintLivePriceOverlay(livePrice, y, scaleW, activeCandle.time, activeCandle.close);
  }, [hideLivePriceOverlay, paintLivePriceOverlay]);

  const resetEmptyHistoryState = useCallback((activeTf: Timeframe) => {
    candlesRef.current = [];
    currentCandleRef.current = null;
    prevPriceRef.current = null;
    resetVisibleRangeOnNextDataRef.current = true;
    hideLivePriceOverlay();
    leftVisibleTimeRef.current = null;
    hasReachedBeginningRef.current = false;
    isLoadingMoreRef.current = false;
    lastStoreCandleSecRef.current = 0;
    resetLiveQuotePriceGuard();
    candleAggregationService.loadHistoricalCandles(symbol, activeTf as AggTimeframe, []);
  }, [hideLivePriceOverlay, resetLiveQuotePriceGuard, symbol]);

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
    setCtxShowTradeHistory(chartSettings.showTradeHistory);
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
  const chartTheme = useMemo(
    () => buildChartTheme(chartColors, chartSettings.showGrid),
    [chartColors, chartSettings.showGrid],
  );
  const chartThemeRef = useRef(chartTheme);

  useEffect(() => {
    chartThemeRef.current = chartTheme;
  }, [chartTheme]);

  const isChartSurfaceLight = useCallback(() => (
    isLightChartBackground(chartThemeRef.current.background)
  ), []);

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

    return getChartPriceFromQuote(tick);
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

    console.log(`[TradingChart] Container size: ${containerRef.current.offsetWidth}x${containerRef.current.offsetHeight}`);

    const chart = createChart(containerRef.current, {
      autoSize: true,
      layout: {
        background: { type: ColorType.Solid, color: chartTheme.background },
        textColor: chartTheme.axisText,
        fontFamily: CHART_AXIS_FONT_FAMILY,
        fontSize: CHART_AXIS_FONT_SIZE,
        attributionLogo: false,
      },
      grid: {
        vertLines: { color: TRANSPARENT_CHART_LINE },
        horzLines: { color: TRANSPARENT_CHART_LINE },
      },
      crosshair: {
        mode: CrosshairMode.Normal,
        // Arrow/cursor is the default tool — hide crosshair lines until a drawing tool is selected
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
        scaleMargins: { top: 0.05, bottom: 0.28 },
        autoScale: !chartSettings.scaleFixOneToOne,
      },
      timeScale: {
        borderColor: chartTheme.scaleBorder,
        timeVisible: true,
        secondsVisible: false,
        tickMarkMaxCharacterLength: getTradingChartTickMarkCharacterLength(timeframe),
        barSpacing: 8,
        minBarSpacing: 0.5,
        rightOffset: getTradingChartShiftRightOffset(timeframe, ctxChartShift),
        fixLeftEdge: false,
        fixRightEdge: false,
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
      if (isDisposedRef.current || !chartRef.current || !autoScrollEnabledRef.current || !chartSettingsRef.current.chartAutoScroll) return;

      autoScrollTimer = setTimeout(() => {
        if (
          !isDisposedRef.current &&
          chartRef.current &&
          !isUserInteracting &&
          shouldScrollToRealtime(chartRef.current, autoScrollEnabledRef.current, chartSettingsRef.current.chartAutoScroll)
        ) {
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

    const chartContainer = containerRef.current;

    if (chartContainer) {
      // Track pointer/drag interactions for auto-scroll timer
      chartContainer.addEventListener('pointerdown', handleInteractionStart);
      chartContainer.addEventListener('pointerup', handleInteractionEnd);
      chartContainer.addEventListener('pointerleave', handleInteractionEnd);
      chartContainer.addEventListener('touchstart', handleInteractionStart, { passive: true });
      chartContainer.addEventListener('touchend', handleInteractionEnd);

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
          updateLegendDOM(c.open, c.high, c.low, c.close, getDisplayVolume(c, chartSettingsRef.current));
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
      if (chartContainer) {
        chartContainer.removeEventListener('pointerdown', handleInteractionStart);
        chartContainer.removeEventListener('pointerup', handleInteractionEnd);
        chartContainer.removeEventListener('pointerleave', handleInteractionEnd);
        chartContainer.removeEventListener('touchstart', handleInteractionStart);
        chartContainer.removeEventListener('touchend', handleInteractionEnd);
      }
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

    const { sortedCandles, seriesData, volumeData } = formatChartSeriesData(
      candles,
      activeType,
      chartThemeRef.current,
      chartSettingsRef.current,
    );

    try {
      seriesRef.current.setData(seriesData);
      volumeRef.current.setData(volumeData);

      // Initial/context-reset fit only. Live/history refreshes preserve the user's viewport.
      const totalBars = seriesData.length;
      if (totalBars > 0 && chartRef.current && resetVisibleRangeOnNextDataRef.current) {
        seriesRef.current.priceScale().applyOptions({ autoScale: true });
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
        resetVisibleRangeOnNextDataRef.current = false;
        syncLeftVisibleTime();
      } else {
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
        updateLegendDOM(last.open, last.high, last.low, last.close, getDisplayVolume(last, chartSettingsRef.current));
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
      const { seriesData, volumeData } = formatChartSeriesData(
        candlesRef.current,
        activeType,
        chartThemeRef.current,
        chartSettingsRef.current,
      );

      // Update series but maintain current left logical index so it visually stays in place
      if (seriesRef.current && volumeRef.current && chartRef.current) {
        // Temporarily save current range
        const timeScale = chartRef.current.timeScale();
        const currentPos = timeScale.scrollPosition();

        seriesRef.current.setData(seriesData);
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
        resetVisibleRangeOnNextDataRef.current = true;
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
        resetVisibleRangeOnNextDataRef.current = true;
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
    resetVisibleRangeOnNextDataRef.current = true;

    const hasCachedData = candlesRef.current.length > 0;

    if (symbolChanged && !seriesRef.current) {
      candlesRef.current = [];
      currentCandleRef.current = null;
      prevPriceRef.current = null;
      resetVisibleRangeOnNextDataRef.current = true;
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
    const theme = chartThemeRef.current;

    console.log(`[TradingChart] Creating series for chartType=${chartType}, symbol=${symbol}, digits=${digits}`);

    switch (chartType) {
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
      case 'area':
        series = chart.addSeries(AreaSeries, {
          lineColor: theme.line,
          topColor: theme.areaTop,
          bottomColor: theme.areaBottom,
          priceFormat: priceFormatOpts,
          priceLineVisible: false,
          lastValueVisible: false,
        });
        break;
      default:
        series = chart.addSeries(CandlestickSeries, {
          upColor: theme.candleUp,
          downColor: theme.candleDown,
          priceFormat: priceFormatOpts,
          priceLineVisible: false,
          lastValueVisible: false,
        });
    }


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
              handleScroll: DRAWING_LOCK_HANDLE_SCROLL,
              handleScale: DRAWING_LOCK_HANDLE_SCALE,
            });
          } catch (e) { /* disposed */ }
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
      fixRightEdge: false,
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
        background: { type: ColorType.Solid, color: chartTheme.background },
        textColor: chartTheme.axisText,
        fontFamily: CHART_AXIS_FONT_FAMILY,
        fontSize: CHART_AXIS_FONT_SIZE,
      },
      grid: {
        vertLines: { color: TRANSPARENT_CHART_LINE },
        horzLines: { color: TRANSPARENT_CHART_LINE },
      },
      crosshair: {
        vertLine: { color: chartTheme.crosshair },
        horzLine: { color: chartTheme.crosshair },
      },
      handleScroll: TRADING_VIEW_HANDLE_SCROLL,
      handleScale: TRADING_VIEW_HANDLE_SCALE,
      rightPriceScale: {
        borderColor: chartTheme.scaleBorder,
        autoScale: !chartSettings.scaleFixOneToOne,
      },
      timeScale: {
        borderColor: chartTheme.scaleBorder,
      },
    });

    // Update Series colors
    if (seriesRef.current) {
      if (chartType === 'candlestick') {
        seriesRef.current.applyOptions({
          upColor: chartTheme.candleUp,
          downColor: chartTheme.candleDown,
          wickUpColor: chartTheme.wickUp,
          wickDownColor: chartTheme.wickDown,
          borderUpColor: chartTheme.barUp,
          borderDownColor: chartTheme.barDown,
        });
      } else if (chartType === 'bar') {
        seriesRef.current.applyOptions({
          upColor: chartTheme.barUp,
          downColor: chartTheme.barDown,
        });
      } else if (chartType === 'line' || chartType === 'area') {
        seriesRef.current.applyOptions({
          lineColor: chartTheme.line,
          color: chartTheme.line,
          topColor: chartTheme.areaTop,
          bottomColor: chartTheme.areaBottom,
        });
      }
    }

    // Toggle volumes and apply colors if it exists
    if (volumeRef.current) {
      volumeRef.current.applyOptions({
        visible: chartSettings.showTickVolumes || chartSettings.showRealVolumes,
        color: chartTheme.volumeUp
      });
      const { volumeData } = formatChartSeriesData(
        candlesRef.current,
        prevChartTypeRef.current || chartType,
        chartTheme,
        chartSettings,
      );
      volumeRef.current.setData(volumeData);
      const current = currentCandleRef.current;
      if (current) {
        updateLegendDOM(current.open, current.high, current.low, current.close, getDisplayVolume(current, chartSettings));
      }
    }

    window.dispatchEvent(new CustomEvent('rtx:flush-trade-overlay'));
  }, [chartSettings, chartTheme, chartType, updateLegendDOM]);

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
          const theme = chartThemeRef.current;
          const displayVolume = getDisplayVolume(c, chartSettingsRef.current);
          volumeRef.current.update({
            time: c.time as Time, value: displayVolume,
            color: c.close >= c.open ? theme.volumeUp : theme.volumeDown,
          });
        }
        updateLegendDOM(c.open, c.high, c.low, c.close, getDisplayVolume(c, chartSettingsRef.current));
        markCandlesReady();
        if (
          isNewCandle &&
          chartRef.current &&
          !isDisposedRef.current &&
          shouldScrollToRealtime(chartRef.current, autoScrollEnabledRef.current, chartSettingsRef.current.chartAutoScroll)
        ) {
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
      const newCandle: Candle = { time: newTime, open, high: open, low: open, close: open, volume: 0, tickVolume: 0 };
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

      const price = getChartPriceFromQuote(tick);
      if (price == null) return;
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
          resetVisibleRangeOnNextDataRef.current = true;
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
        const y = seriesRef.current.priceToCoordinate(price);
        if (y !== null && y !== undefined) {
          livePriceRef.current = price;

          // Match exact price-scale width so badge overlays the axis labels 1:1
          const scaleW = seriesRef.current.priceScale().width();
          paintLivePriceOverlay(price, y, scaleW, candleTime, price);
        }
      }


      // ── Candle rollover or update ──────────────────────────────────────────
      if (!currentCandleRef.current) {
        // Very first tick — create the forming candle.
        currentCandleRef.current = { time: candleTime, open: price, high: price, low: price, close: price, volume: 1, tickVolume: 1 };
        push(currentCandleRef.current, true);
      } else if (candleTime > currentCandleRef.current.time) {
        // rollover() with real first tick price allows true gaps to render properly.
        rollover(candleTime, price);
        // The real first tick features will be correctly mapped implicitly during
        // the next tick loop cycle, or updated later by FIX update.
        if (currentCandleRef.current && currentCandleRef.current.time === candleTime) {
          currentCandleRef.current.volume = 1; // Mark as seen
          currentCandleRef.current.tickVolume = 1;
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
          currentCandleRef.current.tickVolume = 1;
        } else {
          currentCandleRef.current.high = Math.max(currentCandleRef.current.high, price);
          currentCandleRef.current.low = Math.min(currentCandleRef.current.low, price);
          currentCandleRef.current.close = price;
          currentCandleRef.current.volume += 1;
          currentCandleRef.current.tickVolume = (currentCandleRef.current.tickVolume ?? currentCandleRef.current.volume - 1) + 1;
        }
        push(currentCandleRef.current, false);
      }

      // Refresh after candle creation/update so the first live-only tick has a
      // price scale before we ask LightweightCharts for a coordinate.
      renderLivePriceOverlay(price, candleTime, price);

      // Backend/broker owns SL/TP execution. The frontend only refreshes server
      // state when local ticks show a crossed level.
      activeTradeSnapshotsRef.current.forEach((trade) => {
        if (tradeLevelCrossRefreshPendingRef.current.has(trade.key)) return;

        let shouldRefreshForCross = false;

        // Do not close from local ticks: optimistic SL/TP edits can race with
        // server validation and make the UI close an older position by mistake.
        if (trade.side === 'BUY') {
          if (trade.sl != null && trade.sl > 0 && tick.bid <= trade.sl) shouldRefreshForCross = true;
          if (trade.tp != null && trade.tp > 0 && tick.bid >= trade.tp) shouldRefreshForCross = true;
        } else {
          const closePrice = tick.ask ?? tick.bid;
          if (trade.sl != null && trade.sl > 0 && closePrice >= trade.sl) shouldRefreshForCross = true;
          if (trade.tp != null && trade.tp > 0 && closePrice <= trade.tp) shouldRefreshForCross = true;
        }

        if (shouldRefreshForCross) {
          tradeLevelCrossRefreshPendingRef.current.add(trade.key);
          tradeLevelCrossCloseCandidatesRef.current.set(
            trade.key,
            Date.now() + TRADE_LEVEL_CROSS_CLOSE_CANDIDATE_TTL_MS,
          );
          const pId = trade.key.replace('trade:', '');
          console.log(`[Chart] SL/TP crossed for trade ${pId}; requesting server refresh`);

          window.dispatchEvent(new Event('rtx:force-refresh-positions'));
          const login = Number.parseInt(String(useAppStore.getState().accountId ?? ''), 10);
          if (Number.isFinite(login) && login > 0) {
            window.dispatchEvent(new CustomEvent('rtx:refresh-trade-history-requested', {
              detail: { login },
            }));
          }
          window.setTimeout(() => {
            tradeLevelCrossRefreshPendingRef.current.delete(trade.key);
          }, 2500);
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
        currentCandleRef.current = { ...c };
        candlesRef.current = chartDataService.mergeCandle(candlesRef.current, currentCandleRef.current, 1000) as Candle[];
        push(currentCandleRef.current, false);
        repaintLivePriceOverlayFromCurrentPrice(currentCandleRef.current);
        return;
      }

      // 3. Server is telling us about a TRULY NEW candle (c.time > current.time)
      if (!currentCandleRef.current) {
        currentCandleRef.current = { ...c };
        candlesRef.current = chartDataService.mergeCandle(candlesRef.current, currentCandleRef.current, 1000) as Candle[];
        push(currentCandleRef.current, true);
        repaintLivePriceOverlayFromCurrentPrice(currentCandleRef.current);
        return;
      }

      if (c.time > currentCandleRef.current.time) {
        // Let the idempotent rollover handle creating it
        rollover(c.time, c.open);

        // Immediately apply server's data to it
        if (currentCandleRef.current && currentCandleRef.current.time === c.time) {
          currentCandleRef.current = { ...c };
          candlesRef.current = chartDataService.mergeCandle(candlesRef.current, currentCandleRef.current, 1000) as Candle[];
          push(currentCandleRef.current, false);
          repaintLivePriceOverlayFromCurrentPrice(currentCandleRef.current);
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
        if (currentCandleRef.current) {
          repaintLivePriceOverlayFromCurrentPrice(currentCandleRef.current);
        }
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
              flushTradeOverlay();
            }
          }
        }
      },
      { threshold: 0.1 }
    );

    observer.observe(el);
    return () => observer.disconnect();
  }, [flushTradeOverlay]);

  useEffect(() => {
    if (!isActive) return;

    refreshVisibleChartLayout();

    let secondFrameId: number | null = null;
    const firstFrameId = window.requestAnimationFrame(() => {
      refreshVisibleChartLayout();
      secondFrameId = window.requestAnimationFrame(refreshVisibleChartLayout);
    });
    const timeoutId = window.setTimeout(refreshVisibleChartLayout, 120);

    return () => {
      window.cancelAnimationFrame(firstFrameId);
      if (secondFrameId !== null) window.cancelAnimationFrame(secondFrameId);
      window.clearTimeout(timeoutId);
    };
  }, [isActive, refreshVisibleChartLayout, symbol, timeframe]);

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
          fixRightEdge: false,
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
        resetVisibleRangeOnNextDataRef.current = true;
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
          handleScroll: TRADING_VIEW_HANDLE_SCROLL,
          handleScale: TRADING_VIEW_HANDLE_SCALE,
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
            handleScroll: TRADING_VIEW_HANDLE_SCROLL,
            handleScale: TRADING_VIEW_HANDLE_SCALE,
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
            handleScroll: DRAWING_LOCK_HANDLE_SCROLL,
            handleScale: DRAWING_LOCK_HANDLE_SCALE,
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
  const TRADE_ENTRY_LINE_COLOR = '#a8adb7';
  const activeOverlayNodesRef = useRef<HTMLElement[]>([]);
  const activeOverlayNodeDataRef = useRef<OverlayNodeData[]>([]);
  const historyOverlayNodesRef = useRef<HTMLElement[]>([]);
  const historyOverlayNodeDataRef = useRef<OverlayNodeData[]>([]);
  const frozenEntryTimesRef = useRef<Map<number | string, number>>(new Map());
  const stableActiveMarkerTimesRef = useRef<Map<number | string, number>>(new Map());
  const frozenEntryPricesRef = useRef<Map<number | string, number>>(new Map());
  const activeTradeSnapshotsRef = useRef<Map<string, ActiveTradeSnapshot>>(new Map());
  const pendingMissingActiveTradesRef = useRef<Map<string, { trade: ActiveTradeSnapshot; missingSince: number }>>(new Map());
  const closeSuppressedTradeKeysRef = useRef<Map<string, number>>(new Map());
  const pendingClosedTradeSnapshotsRef = useRef<Map<string, ActiveTradeSnapshot>>(new Map());
  const optimisticClosedTradeSnapshotsRef = useRef<Map<string, ClosedTradeSnapshot>>(new Map());
  const tradeHistoryRefreshTimerRef = useRef<number | null>(null);
  const tradeMissingGraceTimerRef = useRef<number | null>(null);
  const tradeOverlayRafRef = useRef<number | null>(null);
  const tradeLevelCrossRefreshPendingRef = useRef<Set<string>>(new Set());
  const tradeLevelCrossCloseCandidatesRef = useRef<Map<string, number>>(new Map());
  const tradeLevelOverridesRef = useRef<Map<string, TradeLevelOverride>>(new Map());
  const tradeLevelLastKnownLevelsRef = useRef<Map<string, TradeLevelOverride>>(new Map());
  const tradeLevelModifyRequestSeqRef = useRef<TradeLevelModifyRequestId>(0);
  const pendingTradeLevelModifyRequestsRef = useRef<Map<string, TradeLevelModifyRequestId>>(new Map());
  const tradeLevelOptimisticGraceUntilRef = useRef<Map<string, number>>(new Map());
  const tradeLevelOverridesHydratedRef = useRef(false);
  const lastActiveTradeOverlaySignatureRef = useRef('');
  const lastHistoryTradeOverlaySignatureRef = useRef('');
  const positionLabelsRef = useRef<HTMLElement[]>([]);
  const positionLabelDataRef = useRef<any[]>([]);

  const getFrozenEntryTimeKey = (tradeKey: number | string, chartTimeframe: Timeframe | string) =>
    `${String(tradeKey)}::${String(chartTimeframe)}`;

  const clearFrozenEntryTime = (tradeKey: number | string) => {
    const directKey = String(tradeKey);
    const scopedPrefix = `${directKey}::`;
    frozenEntryTimesRef.current.delete(tradeKey);
    frozenEntryTimesRef.current.delete(directKey);
    Array.from(frozenEntryTimesRef.current.keys()).forEach((key) => {
      if (String(key).startsWith(scopedPrefix)) {
        frozenEntryTimesRef.current.delete(key);
      }
    });
  };

  const clearStableActiveMarkerTime = (tradeKey: number | string) => {
    const directKey = String(tradeKey);
    const markerKey = `${directKey}:marker`;
    const scopedPrefix = `${markerKey}::`;
    stableActiveMarkerTimesRef.current.delete(tradeKey);
    stableActiveMarkerTimesRef.current.delete(directKey);
    stableActiveMarkerTimesRef.current.delete(markerKey);
    Array.from(stableActiveMarkerTimesRef.current.keys()).forEach((key) => {
      if (String(key).startsWith(scopedPrefix)) {
        stableActiveMarkerTimesRef.current.delete(key);
      }
    });
  };

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
        if (!key.startsWith('trade:') || !Number.isFinite(savedAt) || now - savedAt > TRADE_LEVEL_OVERRIDE_TTL_MS) return;

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
        .filter(([key, levels]) => key.startsWith('trade:') && ((levels.sl || 0) > 0 || (levels.tp || 0) > 0))
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

  const clearTradeOverlayLayer = useCallback((layer: TradeOverlayLayer) => {
    const nodesRef = layer === 'active' ? activeOverlayNodesRef : historyOverlayNodesRef;
    const dataRef = layer === 'active' ? activeOverlayNodeDataRef : historyOverlayNodeDataRef;

    for (const node of nodesRef.current) {
      try {
        node.remove();
      } catch {
        // Ignore detached nodes.
      }
    }
    const overlayHost = overlayRef.current?.parentElement ?? overlayRef.current;
    const staleSelector = layer === 'active'
      ? '.rtx-trade-marker--active,.rtx-trade-active-segment,.rtx-trade-level-line,.rtx-trade-level-badge,.rtx-trade-level-hit-area'
      : '.rtx-trade-marker--history,.rtx-trade-history-line,.rtx-trade-history-label';
    overlayHost?.querySelectorAll(staleSelector).forEach((node) => {
      try {
        node.remove();
      } catch {
        // Ignore detached nodes.
      }
    });
    nodesRef.current = [];
    dataRef.current = [];
    if (layer === 'active') {
      lastActiveTradeOverlaySignatureRef.current = '';
    } else {
      lastHistoryTradeOverlaySignatureRef.current = '';
    }
  }, []);

  const clearTradeOverlay = useCallback(() => {
    clearTradeOverlayLayer('active');
    clearTradeOverlayLayer('history');
  }, [clearTradeOverlayLayer]);

  const getNearestCandleByTime = useCallback((time: number, maxDistanceSeconds?: number): Candle | null => {
    const candles = candlesRef.current;
    const nearestTime = resolveNearestTradeOverlayCandleTime(
      time,
      candles,
      currentCandleRef.current,
      maxDistanceSeconds,
    );
    if (nearestTime == null) return null;

    if (currentCandleRef.current?.time === nearestTime) {
      return currentCandleRef.current;
    }

    return candles.find((candle) => candle.time === nearestTime) ?? null;
  }, []);

  useEffect(() => {
    activeTradeSnapshotsRef.current.clear();
    pendingMissingActiveTradesRef.current.clear();
    closeSuppressedTradeKeysRef.current.clear();
    pendingClosedTradeSnapshotsRef.current.clear();
    optimisticClosedTradeSnapshotsRef.current.clear();
    frozenEntryTimesRef.current.clear();
    stableActiveMarkerTimesRef.current.clear();
    frozenEntryPricesRef.current.clear();
    tradeLevelLastKnownLevelsRef.current.clear();
    pendingTradeLevelModifyRequestsRef.current.clear();
    tradeLevelOptimisticGraceUntilRef.current.clear();
    tradeLevelCrossCloseCandidatesRef.current.clear();
    clearTradeOverlay();

    if (tradeHistoryRefreshTimerRef.current !== null) {
      window.clearTimeout(tradeHistoryRefreshTimerRef.current);
      tradeHistoryRefreshTimerRef.current = null;
    }
    if (tradeMissingGraceTimerRef.current !== null) {
      window.clearTimeout(tradeMissingGraceTimerRef.current);
      tradeMissingGraceTimerRef.current = null;
    }

    window.dispatchEvent(new Event('rtx:force-refresh-positions'));
  }, [clearTradeOverlay, symbol]);

  const updateLabelPositions = useCallback(() => {
    if (!seriesRef.current || !chartRef.current) return;

    const series = seriesRef.current;
    const chart = chartRef.current;
    const overlayLayers = [
      { nodes: historyOverlayNodesRef.current, data: historyOverlayNodeDataRef.current },
      { nodes: activeOverlayNodesRef.current, data: activeOverlayNodeDataRef.current },
    ];
    const chartWidth = containerRef.current?.offsetWidth || 0;
    const chartHeight = containerRef.current?.offsetHeight || 0;
    const priceScaleWidth = series.priceScale().width();
    const resolveTimeCoordinate = (time: unknown): number | null => {
      const numericTime = Number(time);
      if (!Number.isFinite(numericTime) || numericTime <= 0) return null;

      const directCoordinate = chart.timeScale().timeToCoordinate(numericTime as Time);
      if (directCoordinate != null) return directCoordinate;

      const activeTf = prevTimeframeRef.current || timeframe;
      const timeframeSeconds = getTimeframeSeconds(activeTf as AggTimeframe);
      const nearest = getNearestCandleByTime(
        numericTime,
        Number.isFinite(timeframeSeconds) && timeframeSeconds > 0 ? timeframeSeconds : undefined,
      );
      if (!nearest?.time) return null;

      return chart.timeScale().timeToCoordinate(nearest.time as Time);
    };

    for (const { nodes, data } of overlayLayers) {
      for (let i = 0; i < nodes.length; i++) {
        const el = nodes[i];
        const node = data[i];
        if (!el || !node) continue;

        try {
          if (node.kind === 'horizontal-line' || node.kind === 'price-badge' || node.kind === 'price-hit-area') {
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

            if (node.kind === 'horizontal-line' || node.kind === 'price-hit-area') {
              el.style.left = '0px';
              el.style.right = `${priceScaleWidth}px`;
            } else {
              const leftInset = Number.parseFloat(el.dataset.leftInset ?? '') || 0;
              el.style.width = 'max-content';
              el.style.maxWidth = `${Math.max(96, chartWidth - priceScaleWidth - leftInset - 12)}px`;
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

            const x1 = resolveTimeCoordinate(node.time);
            const y1 = series.priceToCoordinate(node.price);
            const x2 = resolveTimeCoordinate(endTime);
            const y2 = series.priceToCoordinate(endPrice);
            const geometry = resolveTradeOverlaySegmentGeometry({
              x1,
              y1,
              x2,
              y2,
              minLengthPx: el.classList.contains('rtx-trade-history-line') ? 24 : 0,
            });
            if (!geometry) {
              el.style.display = 'none';
              continue;
            }

            el.style.display = 'block';
            el.style.left = `${geometry.left}px`;
            el.style.top = `${geometry.top}px`;
            el.style.width = `${geometry.width}px`;
            el.style.transform = `rotate(${geometry.angleDeg}deg)`;
            el.style.transformOrigin = '0 0';
            continue;
          }

          if (node.price == null || node.time == null) {
            el.style.display = 'none';
            continue;
          }

          let x = resolveTimeCoordinate(node.time);
          if (x == null && node.resolveTime) {
            const fallbackX = resolveTimeCoordinate(node.resolveTime());
            if (fallbackX != null) {
              x = fallbackX;
            }
          }
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
    }

    if (livePriceRef.current !== null && livePriceLineRef.current && livePriceBadgeRef.current) {
      const y = series.priceToCoordinate(livePriceRef.current);
      if (y !== null && y !== undefined && y > 0) {
        const badgeColor = getLivePriceOverlayColor(currentCandleRef.current);
        livePriceLineRef.current.style.display = 'block';
        livePriceLineRef.current.style.top = `${y}px`;
        livePriceLineRef.current.style.right = `${priceScaleWidth}px`;
        livePriceLineRef.current.style.borderTopColor = badgeColor;
        livePriceBadgeRef.current.style.display = 'block';
        livePriceBadgeRef.current.style.top = `${y}px`;
        livePriceBadgeRef.current.style.width = `${priceScaleWidth}px`;
        livePriceBadgeRef.current.style.background = badgeColor;
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
      return ticket ? `#${ticket}` : '';
    };

    const formatTradeLevelBadgePrice = (price: number): string => price.toFixed(digits);

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
        const nearest = getNearestCandleByTime(candidate, timeframeSeconds);
        if (!nearest) continue;
        const distance = Math.abs(nearest.time - candidate);
        if (distance < bestDistance) {
          bestDistance = distance;
          bestTime = nearest.time;
        }
      }

      return bestTime ?? alignTimeframeBoundarySeconds(normalizedTimestamp, activeTf as AggTimeframe, timeframeSeconds);
    };

    const getEntryColor = (side: TradeSide) => side === 'BUY' ? TRADE_BUY_COLOR : TRADE_SELL_COLOR;
    const getExitColor = (side: TradeSide) => side === 'BUY' ? TRADE_SELL_COLOR : TRADE_BUY_COLOR;
    const getLiveTrailTime = () =>
      currentCandleRef.current?.time
      ?? candlesRef.current[candlesRef.current.length - 1]?.time
      ?? null;
    const getActiveMarkerTimeKey = (tradeKey: string) =>
      getFrozenEntryTimeKey(`${tradeKey}:marker`, prevTimeframeRef.current || timeframe);
    const getStoredActiveMarkerTime = (tradeKey: string): number | null => {
      const storedTime = stableActiveMarkerTimesRef.current.get(getActiveMarkerTimeKey(tradeKey));
      return storedTime != null && Number.isFinite(storedTime) && storedTime > 0 ? storedTime : null;
    };
    const canResolveOverlayTime = (time: unknown): boolean => {
      const numericTime = Number(time);
      if (!Number.isFinite(numericTime) || numericTime <= 0) return false;

      const directCoordinate = chartRef.current?.timeScale().timeToCoordinate(numericTime as Time);
      if (directCoordinate != null) return true;

      const activeTf = prevTimeframeRef.current || timeframe;
      const timeframeSeconds = getTimeframeSeconds(activeTf as AggTimeframe);
      return Boolean(getNearestCandleByTime(
        numericTime,
        Number.isFinite(timeframeSeconds) && timeframeSeconds > 0 ? timeframeSeconds : undefined,
      ));
    };
    const resolveClosedEntryTime = (trade: ActiveTradeSnapshot): number => {
      if (canResolveOverlayTime(trade.entryTime)) return trade.entryTime;

      const storedMarkerTime = getStoredActiveMarkerTime(trade.key);
      if (storedMarkerTime != null && canResolveOverlayTime(storedMarkerTime)) {
        return storedMarkerTime;
      }

      return trade.entryTime;
    };
    const getLiveTrailPrice = (side: TradeSide, fallbackPrice: number): number | null => {
      const tick = resolveSymbolTick(useAppStore.getState().ticks);
      const quote = side === 'BUY'
        ? Number(tick?.bid ?? tick?.last ?? 0)
        : Number(tick?.ask ?? tick?.bid ?? tick?.last ?? 0);
      if (quote > 0 && isLivePriceSafeForCandles(quote)) return quote;
      return fallbackPrice > 0 ? fallbackPrice : null;
    };
    const resolveCloseSnapshotOverlayTime = (rawTime: unknown, fallbackTime?: number | null): number => {
      const mappedTime = mapTradeTimestampToChartTime(rawTime);
      if (mappedTime != null && canResolveOverlayTime(mappedTime)) return mappedTime;

      const normalizedTime = normalizeUnixSeconds(rawTime);
      if (normalizedTime != null && canResolveOverlayTime(normalizedTime)) return normalizedTime;

      if (fallbackTime != null && Number.isFinite(fallbackTime) && fallbackTime > 0) {
        return fallbackTime;
      }

      return mappedTime ?? normalizedTime ?? 0;
    };
    const buildImmediateClosedTrade = (
      trade: ActiveTradeSnapshot,
      existingTrade?: ClosedTradeSnapshot | null,
    ): ClosedTradeSnapshot | null => {
      const exitPrice = existingTrade?.exitPrice
        ?? getLiveTrailPrice(trade.side, trade.currentPrice || trade.entryPrice)
        ?? trade.currentPrice
        ?? trade.entryPrice;
      const exitTime = existingTrade?.exitTime
        ?? getLiveTrailTime()
        ?? trade.currentTime
        ?? trade.entryTime;
      return buildOptimisticClosedTradeSnapshot({
        key: trade.key,
        symbol: trade.symbol,
        side: trade.side,
        volume: trade.volume,
        entryPrice: existingTrade?.entryPrice ?? trade.entryPrice,
        entryTime: existingTrade?.entryTime ?? resolveClosedEntryTime(trade),
        exitPrice,
        exitTime,
        profit: existingTrade?.profit,
      });
    };
    const buildClosedTradeFromEventSnapshot = (
      snapshot: TradeOverlayCloseSnapshotSeed,
      capturedTrade?: ActiveTradeSnapshot | null,
      existingTrade?: ClosedTradeSnapshot | null,
    ): ClosedTradeSnapshot | null => {
      const entryFallbackTime = existingTrade?.entryTime
        ?? (capturedTrade ? resolveClosedEntryTime(capturedTrade) : null);
      const entryTime = existingTrade?.entryTime
        ?? resolveCloseSnapshotOverlayTime(snapshot.entryTime, entryFallbackTime);
      const exitFallbackTime = existingTrade?.exitTime
        ?? getLiveTrailTime()
        ?? capturedTrade?.currentTime
        ?? entryTime;
      const exitTime = existingTrade?.exitTime
        ?? resolveCloseSnapshotOverlayTime(snapshot.exitTime, exitFallbackTime);

      return buildOptimisticClosedTradeSnapshot({
        ...snapshot,
        entryPrice: existingTrade?.entryPrice ?? snapshot.entryPrice,
        entryTime,
        exitPrice: existingTrade?.exitPrice ?? snapshot.exitPrice,
        exitTime,
        profit: snapshot.profit ?? existingTrade?.profit,
      });
    };
    const mapStoredClosedTradeToChart = (trade: ClosedTradeSnapshot): ClosedTradeSnapshot | null => (
      buildOptimisticClosedTradeSnapshot({
        key: trade.key,
        symbol: trade.symbol,
        side: trade.side,
        volume: trade.volume,
        entryPrice: trade.entryPrice,
        entryTime: resolveCloseSnapshotOverlayTime(trade.entryTime, trade.entryTime),
        exitPrice: trade.exitPrice,
        exitTime: resolveCloseSnapshotOverlayTime(trade.exitTime, trade.exitTime),
        profit: trade.profit,
      })
    );
    const deriveClosedTradeColor = (trade: ClosedTradeSnapshot) => {
      const pnl = trade.profit ?? (
        trade.side === 'BUY' ? trade.exitPrice - trade.entryPrice : trade.entryPrice - trade.exitPrice
      );
      return pnl >= 0 ? TRADE_BUY_COLOR : TRADE_SELL_COLOR;
    };
    const requestTradeHistoryRefresh = () => {
      const login = Number.parseInt(String(useAppStore.getState().accountId ?? ''), 10);
      if (!Number.isFinite(login) || login <= 0) return;
      window.dispatchEvent(new CustomEvent('rtx:refresh-trade-history-requested', {
        detail: { login },
      }));
    };
    const scheduleHistoryRefresh = () => {
      if (tradeHistoryRefreshTimerRef.current !== null) {
        window.clearTimeout(tradeHistoryRefreshTimerRef.current);
      }
      tradeHistoryRefreshTimerRef.current = window.setTimeout(() => {
        tradeHistoryRefreshTimerRef.current = null;
        requestTradeHistoryRefresh();
      }, 350);
    };

    const getTradeLevelStateKeys = (trade: ActiveTradeSnapshot): string[] => {
      const fingerprint = createTradeLevelOverrideFingerprint({
        symbol: trade.symbol,
        side: trade.side,
        volume: trade.volume,
        entryPrice: trade.entryPrice,
        entryTime: trade.entryTime,
        digits,
      });
      return Array.from(new Set([trade.key, fingerprint]));
    };

    const getTradeLevelState = (
      state: Map<string, TradeLevelOverride>,
      trade: ActiveTradeSnapshot,
    ): TradeLevelOverride | undefined => {
      for (const key of getTradeLevelStateKeys(trade)) {
        const levels = state.get(key);
        if (!levels) continue;
        if (key !== trade.key) state.set(trade.key, levels);
        return levels;
      }
      return undefined;
    };

    const setTradeLevelState = (
      state: Map<string, TradeLevelOverride>,
      trade: ActiveTradeSnapshot,
      levels: TradeLevelOverride,
    ) => {
      getTradeLevelStateKeys(trade).forEach((key) => state.set(key, levels));
    };

    const deleteTradeLevelState = (
      state: Map<string, TradeLevelOverride>,
      trade: ActiveTradeSnapshot,
    ) => {
      getTradeLevelStateKeys(trade).forEach((key) => state.delete(key));
    };

    const deleteTradeLevelStateByKey = (
      state: Map<string, TradeLevelOverride>,
      key: string,
    ): boolean => state.delete(key);

    const clearTradeLevelRuntimeState = (trade: ActiveTradeSnapshot): boolean => {
      let changed = false;
      getTradeLevelStateKeys(trade).forEach((key) => {
        changed = deleteTradeLevelStateByKey(tradeLevelOverridesRef.current, key) || changed;
        changed = deleteTradeLevelStateByKey(tradeLevelLastKnownLevelsRef.current, key) || changed;
        pendingTradeLevelModifyRequestsRef.current.delete(key);
        tradeLevelOptimisticGraceUntilRef.current.delete(key);
      });
      return changed;
    };

    const clearTradeLevelRuntimeStateByKey = (key: string): boolean => {
      pendingTradeLevelModifyRequestsRef.current.delete(key);
      tradeLevelOptimisticGraceUntilRef.current.delete(key);
      const overrideDeleted = tradeLevelOverridesRef.current.delete(key);
      const lastKnownDeleted = tradeLevelLastKnownLevelsRef.current.delete(key);
      return overrideDeleted || lastKnownDeleted;
    };

    const hasPendingTradeLevelModifyRequest = (trade: ActiveTradeSnapshot): boolean =>
      getTradeLevelStateKeys(trade).some((key) => pendingTradeLevelModifyRequestsRef.current.has(key));

    const hasRecentTradeLevelModifyGrace = (trade: ActiveTradeSnapshot): boolean => {
      let hasGrace = false;
      const nowMs = Date.now();
      getTradeLevelStateKeys(trade).forEach((key) => {
        const expiresAt = tradeLevelOptimisticGraceUntilRef.current.get(key);
        if (!expiresAt) return;
        if (expiresAt > nowMs) {
          hasGrace = true;
        } else {
          tradeLevelOptimisticGraceUntilRef.current.delete(key);
        }
      });
      return hasGrace;
    };

    const rememberTradeLevels = (trade: ActiveTradeSnapshot, levels: TradeLevelOverride) => {
      const normalized = {
        sl: levels.sl > 0 ? levels.sl : 0,
        tp: levels.tp > 0 ? levels.tp : 0,
      };
      if (normalized.sl > 0 || normalized.tp > 0) {
        setTradeLevelState(tradeLevelLastKnownLevelsRef.current, trade, normalized);
      } else if (!hasPendingTradeLevelModifyRequest(trade)) {
        deleteTradeLevelState(tradeLevelLastKnownLevelsRef.current, trade);
      }
    };

    const resolveTradeLevels = (trade: ActiveTradeSnapshot): TradeLevelOverride => {
      const override = getTradeLevelState(tradeLevelOverridesRef.current, trade);
      if (!override) {
        const serverLevels = { sl: trade.sl || 0, tp: trade.tp || 0 };
        const lastKnownLevels = getTradeLevelState(tradeLevelLastKnownLevelsRef.current, trade);
        const hasRecentGrace = hasRecentTradeLevelModifyGrace(trade);
        const levels = hasRecentGrace && lastKnownLevels
          ? {
            sl: serverLevels.sl > 0 ? serverLevels.sl : lastKnownLevels.sl || 0,
            tp: serverLevels.tp > 0 ? serverLevels.tp : lastKnownLevels.tp || 0,
          }
          : serverLevels;
        rememberTradeLevels(trade, levels);
        return levels;
      }

      const serverSl = trade.sl || 0;
      const serverTp = trade.tp || 0;
      const overrideSl = override.sl || 0;
      const overrideTp = override.tp || 0;
      const slSynced = overrideSl <= 0 || (serverSl > 0 && Math.abs(serverSl - overrideSl) <= priceTolerance);
      const tpSynced = overrideTp <= 0 || (serverTp > 0 && Math.abs(serverTp - overrideTp) <= priceTolerance);

      if (slSynced && tpSynced) {
        rememberTradeLevels(trade, { sl: serverSl, tp: serverTp });
        deleteTradeLevelState(tradeLevelOverridesRef.current, trade);
        persistTradeLevelOverrides();
        return { sl: serverSl, tp: serverTp };
      }

      const levels = {
        sl: overrideSl > 0 ? overrideSl : serverSl,
        tp: overrideTp > 0 ? overrideTp : serverTp,
      };
      rememberTradeLevels(trade, levels);
      return levels;
    };

    const createCollisionOffsetFactory = () => {
      const offsets = new Map<string, number>();

      return (_role: TradeLevelRole, price: number) => {
        const y = seriesRef.current?.priceToCoordinate(price);
        const bucket = y == null || !Number.isFinite(y)
          ? price.toFixed(digits)
          : String(Math.round(y / 18));
        const key = bucket;
        const offsetIndex = offsets.get(key) ?? 0;
        offsets.set(key, offsetIndex + 1);
        return offsetIndex;
      };
    };

    const formatSignaturePrice = (value?: number) => (Number(value) || 0).toFixed(digits);

    const appendOverlayNode = (element: HTMLElement, node: OverlayNodeData, layer: TradeOverlayLayer) => {
      const nodesRef = layer === 'active' ? activeOverlayNodesRef : historyOverlayNodesRef;
      const dataRef = layer === 'active' ? activeOverlayNodeDataRef : historyOverlayNodeDataRef;
      overlayRef.current?.appendChild(element);
      nodesRef.current.push(element);
      dataRef.current.push(node);
    };

    const appendActiveInteractionNode = (element: HTMLElement, node: OverlayNodeData) => {
      const host = overlayRef.current?.parentElement ?? overlayRef.current;
      host?.appendChild(element);
      activeOverlayNodesRef.current.push(element);
      activeOverlayNodeDataRef.current.push(node);
    };

    const createArrowSvg = (side: TradeSide, color: string) => side === 'BUY'
      ? `<svg width="8" height="11" viewBox="0 0 12 16" fill="none"><path d="M6 1L11 6H8V15H4V6H1L6 1Z" fill="${color}" stroke="#e5edf4" stroke-width="0.85" stroke-linejoin="round"/></svg>`
      : `<svg width="8" height="11" viewBox="0 0 12 16" fill="none"><path d="M6 15L1 10H4V1H8V10H11L6 15Z" fill="${color}" stroke="#e5edf4" stroke-width="0.85" stroke-linejoin="round"/></svg>`;

    const createTradeMarker = (side: TradeSide, price: number, time: number, title: string, color: string, layer: TradeOverlayLayer, opacity = 1, resolveTime?: () => number | null) => {
      const marker = document.createElement('div');
      marker.className = `rtx-trade-marker rtx-trade-marker--${layer}`;
      marker.title = title;
      marker.innerHTML = createArrowSvg(side, color);
      marker.style.cssText = `position:absolute;z-index:14;pointer-events:none;opacity:${opacity};`;
      appendOverlayNode(marker, { kind: 'marker', price, time, markerSide: side, resolveTime }, layer);
    };

    const formatHistoryLabelTime = (time: number): string => {
      const date = new Date(time * 1000);
      if (Number.isNaN(date.getTime())) return '';
      return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });
    };

    const createTradeHistoryLabel = (side: TradeSide, price: number, time: number, _color: string, layer: TradeOverlayLayer, opacity = 1, ticketLabel = '') => {
      const label = document.createElement('div');
      const timeLabel = formatHistoryLabelTime(time);
      const palette = getTradeOverlayCardPalette(side, isChartSurfaceLight());
      const ticketText = ticketLabel ? ` ${ticketLabel}` : '';
      label.className = `rtx-trade-history-label rtx-trade-history-label--${side.toLowerCase()}`;
      label.textContent = `${side}${ticketText} ${price.toFixed(digits)}${timeLabel ? ` | ${timeLabel}` : ''}`;
      label.style.cssText = `position:absolute;padding:2px 5px;background:${palette.background};border:1px solid ${palette.border};color:${palette.text};font-size:10px;font-family:Consolas,'Courier New',monospace;font-weight:700;white-space:nowrap;z-index:15;pointer-events:none;border-radius:2px;line-height:13px;opacity:${opacity};${palette.shadow}`;
      appendOverlayNode(label, { kind: 'label', price, time, labelOffsetX: 10, labelOffsetY: -18 }, layer);
    };

    const createTradeSegment = (price: number, time: number, color: string, lineStyle: 'solid' | 'dashed', layer: TradeOverlayLayer, endPrice?: number, endTime?: number, resolveEndPrice?: () => number | null, resolveEndTime?: () => number | null, opacity = 1) => {
      const line = document.createElement('div');
      line.className = layer === 'history' ? 'rtx-trade-history-line' : 'rtx-trade-active-segment';
      const thickness = lineStyle === 'solid' ? 2 : 1;
      const background = lineStyle === 'solid'
        ? color
        : `repeating-linear-gradient(to right, ${color} 0 6px, transparent 6px 10px)`;
      line.style.cssText = `position:absolute;height:${thickness}px;background:${background};border:0;border-radius:999px;z-index:${lineStyle === 'solid' ? 13 : 9};pointer-events:none;opacity:${opacity};transform-origin:0 50%;will-change:transform,width;`;
      appendOverlayNode(line, { kind: 'segment', price, time, endPrice, endTime, resolveEndPrice, resolveEndTime }, layer);
    };

    const createPriceLevel = (labelText: string, price: number, color: string, options: PriceLevelOptions = {}) => {
      if (!(price > 0)) return;

      const line = document.createElement('div');
      line.className = 'rtx-trade-level-line';
      line.style.cssText = `position:absolute;height:0;border-top:1px dashed ${(options.lineColor ?? color)}cc;z-index:12;pointer-events:none;`;
      appendOverlayNode(line, { kind: 'horizontal-line', price }, 'active');

      if (options.tradeKey && options.role) {
        const hitArea = document.createElement('div');
        hitArea.className = 'rtx-trade-level-hit-area';
        hitArea.dataset.tradeKey = options.tradeKey;
        hitArea.dataset.role = options.role;
        if (options.title) hitArea.title = options.title;
        hitArea.style.cssText = `position:absolute;height:${TRADE_LEVEL_HIT_AREA_PX}px;transform:translateY(-50%);z-index:15;pointer-events:auto;cursor:grab;background:transparent;touch-action:none;`;
        appendActiveInteractionNode(hitArea, { kind: 'price-hit-area', price });
      }

      const badge = document.createElement('div');
      badge.textContent = labelText;
      badge.className = 'rtx-trade-level-badge';
      if (options.title) badge.title = options.title;
      if (options.tradeKey && options.role) {
        badge.dataset.tradeKey = options.tradeKey;
        badge.dataset.role = options.role;
      }
      const upperLabel = labelText.trim().toUpperCase();
      const tone: TradeOverlayCardTone = options.role === 'TP' || upperLabel.startsWith('TP')
        ? 'TP'
        : options.role === 'SL' || upperLabel.startsWith('SL')
          ? 'SL'
          : upperLabel.startsWith('SELL')
            ? 'SELL'
            : 'BUY';
      const palette = getTradeOverlayCardPalette(tone, isChartSurfaceLight());
      const offsetIndex = options.badgeOffsetIndex ?? 0;
      const offsetX = offsetIndex * TRADE_LEVEL_BADGE_STACK_OFFSET_PX;
      const leftInset = TRADE_LEVEL_BADGE_LEFT_INSET_PX + offsetX;
      const canDrag = Boolean(options.tradeKey && options.role);
      const isLineTextLabel = options.labelVariant === 'lineText';
      badge.dataset.leftInset = String(leftInset);
      badge.style.cssText = isLineTextLabel
        ? `position:absolute;left:${leftInset}px;display:block;padding:0 2px;background:transparent;border:0;color:${color};font-size:10px;font-family:Consolas,'Courier New',monospace;font-weight:600;line-height:13px;white-space:nowrap;z-index:21;pointer-events:${canDrag ? 'auto' : 'none'};cursor:${canDrag ? 'grab' : 'default'};border-radius:0;transform:translateY(calc(-100% - 1px));width:max-content;max-width:calc(100% - ${leftInset + 12}px);box-sizing:border-box;text-align:left;touch-action:none;letter-spacing:0;text-shadow:0 1px 2px rgba(0,0,0,0.28);`
        : `position:absolute;left:${leftInset}px;display:inline-flex;align-items:center;justify-content:center;padding:1px 6px;background:${palette.background};border:1px solid ${palette.border};color:${palette.text};font-size:10px;font-family:Consolas,'Courier New',monospace;font-weight:700;white-space:nowrap;z-index:21;pointer-events:${canDrag ? 'auto' : 'none'};cursor:${canDrag ? 'grab' : 'default'};border-radius:2px;transform:translateY(-50%);width:max-content;min-width:52px;max-width:calc(100% - ${leftInset + 12}px);box-sizing:border-box;text-align:center;touch-action:none;${palette.shadow}`;
      appendOverlayNode(badge, { kind: 'price-badge', price }, 'active');
    };

    const pruneCloseSuppressedTradeKeys = (now = Date.now()) => {
      closeSuppressedTradeKeysRef.current.forEach((expiresAt, key) => {
        if (expiresAt <= now) {
          closeSuppressedTradeKeysRef.current.delete(key);
        }
      });
    };

    const pruneTradeLevelCrossCloseCandidates = (now = Date.now()) => {
      tradeLevelCrossCloseCandidatesRef.current.forEach((expiresAt, key) => {
        if (expiresAt <= now) {
          tradeLevelCrossCloseCandidatesRef.current.delete(key);
        }
      });
    };

    const renderTradeOverlay = (options: boolean | { forceActive?: boolean; forceHistory?: boolean } = false) => {
      if (isDisposedRef.current || !seriesRef.current || !overlayRef.current) return;
      const forceActive = typeof options === 'boolean' ? options : Boolean(options.forceActive);
      const forceHistory = typeof options === 'boolean' ? options : Boolean(options.forceHistory);
      const now = Date.now();
      pruneCloseSuppressedTradeKeys(now);
      pruneTradeLevelCrossCloseCandidates(now);
      const closeSuppressedTradeKeys = new Set(closeSuppressedTradeKeysRef.current.keys());

      const chartProperties = useChartSettingsStore.getState().symbolProperties[symbol]
        || useChartSettingsStore.getState().globalProperties;
      const showTradeLevels = chartProperties.showTradeLevels !== false;
      const showTradeHistory = chartProperties.showTradeHistory !== false;
      const showTradeHistoryBoxes = chartProperties.showTradeHistoryBoxes !== false;
      const tradeHistoryLineOpacityPercent = clampChartOpacityPercent(
        chartProperties.tradeHistoryLineOpacity,
        defaultChartProperties.tradeHistoryLineOpacity,
      );
      const tradeHistoryBoxOpacityPercent = clampChartOpacityPercent(
        chartProperties.tradeHistoryBoxOpacity,
        defaultChartProperties.tradeHistoryBoxOpacity,
      );
      const tradeHistoryLineOpacity = tradeHistoryLineOpacityPercent / 100;
      const tradeHistoryBoxOpacity = tradeHistoryBoxOpacityPercent / 100;
      const appState = useAppStore.getState();
      const appPositions = Array.isArray(appState.positions) ? appState.positions : [];
      const appTrades = Array.isArray(appState.trades) ? appState.trades : [];
      const liveTrailTime = getLiveTrailTime();
      const isMatchingTradeSymbol = (rawSymbol: unknown) => {
        const positionSymbol = String(rawSymbol || '').replace(/[^A-Za-z0-9]/g, '').toUpperCase();
        if (!positionSymbol) return false;
        return (
          positionSymbol === normalizedChartSymbol
          || positionSymbol.startsWith(normalizedChartSymbol)
          || normalizedChartSymbol.startsWith(positionSymbol)
        );
      };
      const getPositionId = (position: any): number | string | null => {
        const rawId = position?.id ?? position?.ticket ?? position?.positionId ?? position?.position_id;
        const id = String(rawId ?? '').trim();
        return id ? id : null;
      };
      const getPositionSymbol = (position: any): string =>
        String(position?.symbol ?? position?.instrument ?? position?.name ?? '');
      const getPositionVolume = (position: any): number => Number(
        position?.volume
        ?? position?.quantity
        ?? position?.volume_lots
        ?? position?.lots
        ?? 0,
      ) || 0;
      const getPositionSide = (position: any): TradeSide => {
        const side = String(position?.side ?? position?.action ?? position?.type ?? '').trim().toUpperCase();
        return side.includes('SELL') || side === '1' ? 'SELL' : 'BUY';
      };
      const getPositionOpenPrice = (position: any): number => pickPositiveNumber(
        position?.chartEntryPrice,
        position?.openPrice,
        position?.open_price,
        position?.price_open,
        position?.priceOpen,
      );
      const getPositionCurrentPrice = (position: any): number => pickPositiveNumber(
        position?.currentPrice,
        position?.current_price,
        position?.price_current,
        position?.priceCurrent,
        position?.price,
      );
      const getPositionOpenTime = (position: any): number | null => normalizeUnixSeconds(
        position?.chartEntryTime
        ?? position?.openTime
        ?? position?.time_create
        ?? position?.time_open
        ?? position?.time_ms
        ?? position?.time,
      );
      const rawActiveTradeKeys = new Set(
        appPositions
          .filter((position: any) => getPositionId(position) != null && getPositionVolume(position) > 0 && isMatchingTradeSymbol(getPositionSymbol(position)))
          .map((position: any) => `trade:${String(getPositionId(position))}`),
      );
      const activeTradeKeys = filterActiveTradeKeysForHistory(rawActiveTradeKeys, closeSuppressedTradeKeys);
      const mapHistoryTimestamp = (value: unknown): number =>
        mapTradeTimestampToChartTime(value) ?? normalizeUnixSeconds(value) ?? 0;
      const closedHistorySnapshots = buildClosedTradeHistorySnapshots({
        rows: appTrades as unknown as TradeOverlayHistoryRow[],
        symbol: normalizedChartSymbol,
        mapTimestamp: mapHistoryTimestamp,
        activeTradeKeys,
      });
      const realClosedTradeKeys = new Set(closedHistorySnapshots.map((trade) => trade.key));
      let didClearClosedHistoryTradeLevels = false;
      realClosedTradeKeys.forEach((key) => {
        const capturedTrade = activeTradeSnapshotsRef.current.get(key)
          ?? pendingMissingActiveTradesRef.current.get(key)?.trade
          ?? pendingClosedTradeSnapshotsRef.current.get(key);
        didClearClosedHistoryTradeLevels = capturedTrade
          ? clearTradeLevelRuntimeState(capturedTrade) || didClearClosedHistoryTradeLevels
          : clearTradeLevelRuntimeStateByKey(key) || didClearClosedHistoryTradeLevels;
        pendingClosedTradeSnapshotsRef.current.delete(key);
        tradeLevelCrossCloseCandidatesRef.current.delete(key);
      });
      if (didClearClosedHistoryTradeLevels) persistTradeLevelOverrides();

      const normalizedAppPositions = appPositions.map((position: any) => ({
        id: getPositionId(position),
        symbol: getPositionSymbol(position),
        side: getPositionSide(position),
        volume: getPositionVolume(position),
        openPrice: getPositionOpenPrice(position),
        currentPrice: getPositionCurrentPrice(position),
        rawOpenTime: getPositionOpenTime(position),
        sl: pickPositiveNumber(position.sl, position.price_sl, position.stopLoss, position.stop_loss),
        tp: pickPositiveNumber(position.tp, position.price_tp, position.takeProfit, position.take_profit),
      }));

      const matchingPositions = normalizedAppPositions.filter((position) => {
        const positionSymbol = String(position.symbol || '').replace(/[^A-Za-z0-9]/g, '').toUpperCase();
        if (!position.id || !positionSymbol) return false;
        return Number(position.volume) > 0 && (
          positionSymbol === normalizedChartSymbol
          || positionSymbol.startsWith(normalizedChartSymbol)
          || normalizedChartSymbol.startsWith(positionSymbol)
        );
      });

      const nextActiveSnapshots = new Map<string, ActiveTradeSnapshot>();

      for (const position of matchingPositions) {
        const key = `trade:${String(position.id)}`;
        if (closeSuppressedTradeKeys.has(key)) {
          pendingMissingActiveTradesRef.current.delete(key);
          continue;
        }

        const activeTf = prevTimeframeRef.current || timeframe;
        const scopedEntryTimeKey = getFrozenEntryTimeKey(key, activeTf);
        const storedEntryTime = frozenEntryTimesRef.current.get(scopedEntryTimeKey);
        const rawEntryTime = position.rawOpenTime ?? normalizeUnixSeconds(Date.now());
        const entryTime = resolveStableTradeEntryTime(
          storedEntryTime,
          rawEntryTime,
          mapTradeTimestampToChartTime,
          liveTrailTime,
        );
        if (storedEntryTime == null && entryTime > 0) {
          frozenEntryTimesRef.current.set(scopedEntryTimeKey, entryTime);
        }

        const storedEntryPrice = frozenEntryPricesRef.current.get(key);
        const entryPrice = resolveStableTradeEntryPrice(
          storedEntryPrice,
          position.openPrice,
          position.currentPrice,
        );
        if (storedEntryPrice == null && entryPrice > 0) {
          frozenEntryPricesRef.current.set(key, entryPrice);
        }
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
        pendingMissingActiveTradesRef.current.delete(key);
      }

      const renderActiveSnapshots = new Map(nextActiveSnapshots);
      const visuallyRetainedActiveTradeKeys = new Set<string>();
      let nextMissingGraceDelayMs: number | null = null;
      let didClearCrossClosedTradeLevels = false;

      activeTradeSnapshotsRef.current.forEach((previousTrade, key) => {
        if (previousTrade.symbol !== normalizedChartSymbol || nextActiveSnapshots.has(key)) return;
        if (!shouldKeepMissingActiveTradeOverlay({
          tradeKey: key,
          closeSuppressedTradeKeys,
          closedHistoryTradeKeys: realClosedTradeKeys,
        })) {
          pendingMissingActiveTradesRef.current.delete(key);
          return;
        }

        if (!pendingMissingActiveTradesRef.current.has(key)) {
          pendingMissingActiveTradesRef.current.set(key, { trade: previousTrade, missingSince: now });
          scheduleHistoryRefresh();
        }
      });

      pendingMissingActiveTradesRef.current.forEach((pending, key) => {
        if (
          pending.trade.symbol !== normalizedChartSymbol
          || nextActiveSnapshots.has(key)
          || !shouldKeepMissingActiveTradeOverlay({
            tradeKey: key,
            closeSuppressedTradeKeys,
            closedHistoryTradeKeys: realClosedTradeKeys,
          })
        ) {
          pendingMissingActiveTradesRef.current.delete(key);
          return;
        }

        const elapsedMs = now - pending.missingSince;
        const crossedLevelCandidateExpiresAt = tradeLevelCrossCloseCandidatesRef.current.get(key) ?? 0;
        if (crossedLevelCandidateExpiresAt > now) {
          const closedTrade = buildImmediateClosedTrade(pending.trade);
          if (closedTrade) {
            optimisticClosedTradeSnapshotsRef.current.set(key, closedTrade);
          }
          pendingClosedTradeSnapshotsRef.current.delete(key);
          pendingMissingActiveTradesRef.current.delete(key);
          closeSuppressedTradeKeysRef.current.set(key, now + TRADE_OVERLAY_CLOSE_SUPPRESSION_TTL_MS);
          tradeLevelCrossCloseCandidatesRef.current.delete(key);
          tradeLevelCrossRefreshPendingRef.current.delete(key);
          didClearCrossClosedTradeLevels = clearTradeLevelRuntimeState(pending.trade) || didClearCrossClosedTradeLevels;
          scheduleHistoryRefresh();
          return;
        }

        if (elapsedMs < TRADE_MISSING_POSITION_GRACE_MS) {
          // Broker/account feeds can briefly emit an empty or partial positions
          // snapshot between live updates. Keep drawing the last confirmed levels
          // during the grace window so active trade lines do not blink off.
          renderActiveSnapshots.set(key, pending.trade);
          visuallyRetainedActiveTradeKeys.add(key);
          const remainingMs = TRADE_MISSING_POSITION_GRACE_MS - elapsedMs;
          nextMissingGraceDelayMs = nextMissingGraceDelayMs == null
            ? remainingMs
            : Math.min(nextMissingGraceDelayMs, remainingMs);
          return;
        }

        scheduleHistoryRefresh();
        pendingMissingActiveTradesRef.current.delete(key);
      });

      if (didClearCrossClosedTradeLevels) persistTradeLevelOverrides();

      activeTradeSnapshotsRef.current = nextActiveSnapshots;

      if (nextMissingGraceDelayMs != null) {
        if (tradeMissingGraceTimerRef.current !== null) {
          window.clearTimeout(tradeMissingGraceTimerRef.current);
        }
        tradeMissingGraceTimerRef.current = window.setTimeout(() => {
          tradeMissingGraceTimerRef.current = null;
          renderTradeOverlay({ forceActive: true });
        }, Math.max(0, nextMissingGraceDelayMs + 25));
      } else if (tradeMissingGraceTimerRef.current !== null) {
        window.clearTimeout(tradeMissingGraceTimerRef.current);
        tradeMissingGraceTimerRef.current = null;
      }

      const closedTrades = new Map<string, ClosedTradeSnapshot>();
      const registerClosedTrade = (trade: ClosedTradeSnapshot) => {
        if (trade.entryPrice > 0 && trade.exitPrice > 0 && trade.entryTime > 0 && trade.exitTime > 0) {
          closedTrades.set(trade.key, trade);
        }
      };
      const hasRenderableClosedTradePath = (trade: ClosedTradeSnapshot): boolean => {
        const hasVisibleSpan = Math.abs(trade.entryTime - trade.exitTime) > 0
          || Math.abs(trade.entryPrice - trade.exitPrice) > priceTolerance;
        return hasVisibleSpan && canResolveOverlayTime(trade.entryTime) && canResolveOverlayTime(trade.exitTime);
      };

      if (showTradeHistory) {
        getTradeOverlayOptimisticClosedSnapshots(normalizedChartSymbol).forEach((trade) => {
          if (rawActiveTradeKeys.has(trade.key)) {
            forgetTradeOverlayOptimisticClosedSnapshot(trade.key);
            return;
          }
          const chartTrade = mapStoredClosedTradeToChart(trade);
          if (chartTrade) {
            registerClosedTrade(chartTrade);
          }
        });
        optimisticClosedTradeSnapshotsRef.current.forEach((trade, key) => {
          if (rawActiveTradeKeys.has(key)) {
            optimisticClosedTradeSnapshotsRef.current.delete(key);
            return;
          }
          if (trade.symbol === normalizedChartSymbol) {
            registerClosedTrade(trade);
          }
        });
        closedHistorySnapshots.forEach((trade) => {
          const existingTrade = closedTrades.get(trade.key);
          const backendHasRenderablePath = hasRenderableClosedTradePath(trade);
          if (shouldUseClosedTradeHistorySnapshot({
            existingTrade,
            candidateTrade: trade,
            canRenderTradePath: hasRenderableClosedTradePath,
          })) {
            registerClosedTrade(trade);
            if (backendHasRenderablePath) {
              optimisticClosedTradeSnapshotsRef.current.delete(trade.key);
              forgetTradeOverlayOptimisticClosedSnapshot(trade.key);
            }
          }
        });
      }

      const sortedActiveSnapshots = Array.from(renderActiveSnapshots.values())
        .sort((a, b) => a.key.localeCompare(b.key));
      const activeSignature = showTradeLevels
        ? sortedActiveSnapshots.map((trade) => {
            const levels = nextActiveSnapshots.has(trade.key) || visuallyRetainedActiveTradeKeys.has(trade.key)
              ? resolveTradeLevels(trade)
              : { sl: 0, tp: 0 };
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
      const nextActiveSignature = [
        normalizedChartSymbol,
        timeframe,
        showTradeLevels ? 'levels:on' : 'levels:off',
        activeSignature,
      ].join('\n');
      const nextHistorySignature = [
        normalizedChartSymbol,
        timeframe,
        showTradeHistory ? 'history:on' : 'history:off',
        showTradeHistoryBoxes ? 'boxes:on' : 'boxes:off',
        `line-opacity:${tradeHistoryLineOpacityPercent}`,
        `box-opacity:${tradeHistoryBoxOpacityPercent}`,
        closedSignature,
      ].join('\n');

      const { activeChanged, historyChanged } = getTradeOverlayRedrawDecision({
        lastActiveSignature: lastActiveTradeOverlaySignatureRef.current,
        nextActiveSignature,
        lastHistorySignature: lastHistoryTradeOverlaySignatureRef.current,
        nextHistorySignature,
        forceActive,
        forceHistory,
      });
      if (!activeChanged && !historyChanged) {
        queueTradeOverlayRelayout();
        return;
      }

      if (activeChanged) {
        clearTradeOverlayLayer('active');
        lastActiveTradeOverlaySignatureRef.current = nextActiveSignature;

        if (showTradeLevels) {
          const nextLevelOffset = createCollisionOffsetFactory();
          sortedActiveSnapshots.forEach((trade) => {
            const isLiveActiveTrade = nextActiveSnapshots.has(trade.key);
            const isVisuallyRetainedTrade = visuallyRetainedActiveTradeKeys.has(trade.key);
            const entryColor = getEntryColor(trade.side);
            const ticketLabel = getTradeTicketLabel(trade.key);
            const entryPriceLabel = formatTradeLevelBadgePrice(trade.entryPrice);
            const markerTitle = `${trade.side} ${trade.volume} ${ticketLabel} @ ${entryPriceLabel}`.trim();
            const activeMarkerTimeKey = getActiveMarkerTimeKey(trade.key);
            let stableActiveMarkerTime = stableActiveMarkerTimesRef.current.get(activeMarkerTimeKey) ?? null;
            if (!(stableActiveMarkerTime != null && stableActiveMarkerTime > 0) && trade.currentTime > 0) {
              stableActiveMarkerTime = trade.currentTime;
              stableActiveMarkerTimesRef.current.set(activeMarkerTimeKey, stableActiveMarkerTime);
            }
            createTradeMarker(
              trade.side,
              trade.entryPrice,
              trade.entryTime,
              markerTitle,
              entryColor,
              'active',
              1,
              () => stableActiveMarkerTimesRef.current.get(activeMarkerTimeKey) ?? stableActiveMarkerTime,
            );

            createPriceLevel(
              `${trade.side} ${ticketLabel} ${trade.volume} at ${entryPriceLabel}`.trim(),
              trade.entryPrice,
              entryColor,
              {
                tradeKey: isLiveActiveTrade ? trade.key : undefined,
                role: isLiveActiveTrade ? 'ENTRY' : undefined,
                badgeOffsetIndex: nextLevelOffset('ENTRY', trade.entryPrice),
                title: isLiveActiveTrade ? `${markerTitle}. Drag above/below to create TP or SL.` : markerTitle,
                labelVariant: 'lineText',
                lineColor: TRADE_ENTRY_LINE_COLOR,
              },
            );

            const levels = isLiveActiveTrade || isVisuallyRetainedTrade ? resolveTradeLevels(trade) : { sl: 0, tp: 0 };
            if (levels.sl && levels.sl > 0) {
              const stopLossPriceLabel = formatTradeLevelBadgePrice(levels.sl);
              createPriceLevel(`SL ${ticketLabel} ${stopLossPriceLabel}`.trim(), levels.sl, TRADE_SELL_COLOR, {
                tradeKey: isLiveActiveTrade ? trade.key : undefined,
                role: isLiveActiveTrade ? 'SL' : undefined,
                badgeOffsetIndex: nextLevelOffset('SL', levels.sl),
                title: isVisuallyRetainedTrade
                  ? `Stop Loss for ${ticketLabel || trade.key} @ ${stopLossPriceLabel}. Waiting for position refresh.`
                  : `Stop Loss for ${ticketLabel || trade.key} @ ${stopLossPriceLabel}`,
                labelVariant: 'lineText',
              });
            }
            if (levels.tp && levels.tp > 0) {
              const takeProfitPriceLabel = formatTradeLevelBadgePrice(levels.tp);
              createPriceLevel(`TP ${ticketLabel} ${takeProfitPriceLabel}`.trim(), levels.tp, TRADE_BUY_COLOR, {
                tradeKey: isLiveActiveTrade ? trade.key : undefined,
                role: isLiveActiveTrade ? 'TP' : undefined,
                badgeOffsetIndex: nextLevelOffset('TP', levels.tp),
                title: isVisuallyRetainedTrade
                  ? `Take Profit for ${ticketLabel || trade.key} @ ${takeProfitPriceLabel}. Waiting for position refresh.`
                  : `Take Profit for ${ticketLabel || trade.key} @ ${takeProfitPriceLabel}`,
                labelVariant: 'lineText',
              });
            }
          });
        }
      }

      if (historyChanged) {
        clearTradeOverlayLayer('history');
        lastHistoryTradeOverlaySignatureRef.current = nextHistorySignature;

        if (showTradeHistory) {
          closedTrades.forEach((trade) => {
            const entryColor = getEntryColor(trade.side);
            const exitSide: TradeSide = trade.side === 'BUY' ? 'SELL' : 'BUY';
            const ticketLabel = getTradeTicketLabel(trade.key);
            createTradeSegment(trade.entryPrice, trade.entryTime, deriveClosedTradeColor(trade), 'solid', 'history', trade.exitPrice, trade.exitTime, undefined, undefined, tradeHistoryLineOpacity);
            createTradeMarker(trade.side, trade.entryPrice, trade.entryTime, `${trade.side} ${trade.volume} ${ticketLabel} @ ${trade.entryPrice.toFixed(digits)}`.trim(), entryColor, 'history', tradeHistoryLineOpacity);
            if (showTradeHistoryBoxes) {
              createTradeHistoryLabel(trade.side, trade.entryPrice, trade.entryTime, entryColor, 'history', tradeHistoryBoxOpacity, ticketLabel);
            }
            createTradeMarker(exitSide, trade.exitPrice, trade.exitTime, `${exitSide} ${trade.volume} ${ticketLabel} @ ${trade.exitPrice.toFixed(digits)}`.trim(), getExitColor(trade.side), 'history', tradeHistoryLineOpacity);
            if (showTradeHistoryBoxes) {
              createTradeHistoryLabel(exitSide, trade.exitPrice, trade.exitTime, getExitColor(trade.side), 'history', tradeHistoryBoxOpacity, ticketLabel);
            }
          });
        }
      }

      updateLabelPositions();
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

      if (
        currentTick !== previousTick
        && (activeTradeSnapshotsRef.current.size > 0 || pendingMissingActiveTradesRef.current.size > 0)
      ) {
        queueTradeOverlayRelayout();
      }
    });

    const unsubscribeChartSettings = useChartSettingsStore.subscribe((state, previousState) => {
      const currentProperties = state.symbolProperties[symbol] || state.globalProperties;
      const previousProperties = previousState.symbolProperties[symbol] || previousState.globalProperties;
      if (
        currentProperties.showTradeLevels !== previousProperties.showTradeLevels
        || currentProperties.showTradeHistory !== previousProperties.showTradeHistory
        || currentProperties.showTradeHistoryBoxes !== previousProperties.showTradeHistoryBoxes
        || currentProperties.tradeHistoryLineOpacity !== previousProperties.tradeHistoryLineOpacity
        || currentProperties.tradeHistoryBoxOpacity !== previousProperties.tradeHistoryBoxOpacity
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
    const handleTradeOverlayCloseState = (event: Event) => {
      const detail = (event as CustomEvent<unknown>).detail;
      const status = getTradeOverlayCloseState(detail);
      const tradeKeys = getTradeOverlayCloseTicketKeys(detail);
      if (!status || tradeKeys.length === 0) return;
      const closeSnapshotsByKey = new Map(
        getTradeOverlayCloseSnapshots(detail).map((snapshot) => [snapshot.key, snapshot]),
      );

      if (status === 'failed') {
        tradeKeys.forEach((key) => {
          closeSuppressedTradeKeysRef.current.delete(key);
          pendingClosedTradeSnapshotsRef.current.delete(key);
          optimisticClosedTradeSnapshotsRef.current.delete(key);
          forgetTradeOverlayOptimisticClosedSnapshot(key);
          tradeLevelCrossRefreshPendingRef.current.delete(key);
          tradeLevelCrossCloseCandidatesRef.current.delete(key);
        });
      } else {
        const expiresAt = Date.now() + TRADE_OVERLAY_CLOSE_SUPPRESSION_TTL_MS;
        let didClearTradeLevels = false;
        tradeKeys.forEach((key) => {
          const capturedTrade = activeTradeSnapshotsRef.current.get(key)
            ?? pendingMissingActiveTradesRef.current.get(key)?.trade
            ?? pendingClosedTradeSnapshotsRef.current.get(key);
          if (capturedTrade) {
            pendingClosedTradeSnapshotsRef.current.set(key, capturedTrade);
            didClearTradeLevels = clearTradeLevelRuntimeState(capturedTrade) || didClearTradeLevels;
          } else {
            didClearTradeLevels = clearTradeLevelRuntimeStateByKey(key) || didClearTradeLevels;
          }
          const eventCloseSnapshot = closeSnapshotsByKey.get(key);
          const existingClosedTrade = optimisticClosedTradeSnapshotsRef.current.get(key);
          const closedTrade = eventCloseSnapshot
            ? buildClosedTradeFromEventSnapshot(eventCloseSnapshot, capturedTrade, existingClosedTrade)
            : capturedTrade
              ? buildImmediateClosedTrade(capturedTrade, existingClosedTrade)
              : existingClosedTrade ?? null;
          if (closedTrade) {
            optimisticClosedTradeSnapshotsRef.current.set(key, closedTrade);
          }
          if (capturedTrade) {
            if (status === 'confirmed') {
              pendingClosedTradeSnapshotsRef.current.delete(key);
            }
          } else if (status === 'confirmed') {
            pendingClosedTradeSnapshotsRef.current.delete(key);
          }
          closeSuppressedTradeKeysRef.current.set(key, expiresAt);
          activeTradeSnapshotsRef.current.delete(key);
          pendingMissingActiveTradesRef.current.delete(key);
          if (status === 'confirmed') {
            clearFrozenEntryTime(key);
            clearStableActiveMarkerTime(key);
            frozenEntryPricesRef.current.delete(key);
          }
          tradeLevelCrossRefreshPendingRef.current.delete(key);
          tradeLevelCrossCloseCandidatesRef.current.delete(key);
        });
        if (didClearTradeLevels) persistTradeLevelOverrides();
        scheduleHistoryRefresh();
      }

      clearTradeOverlayLayer('active');
      renderTradeOverlay({ forceActive: true, forceHistory: status !== 'failed' });
    };
    window.addEventListener('rtx:force-refresh-positions', handleForceRefresh);
    window.addEventListener('rtx:refresh-trade-overlay', handleRefreshTradeOverlay);
    window.addEventListener('rtx:flush-trade-overlay', handleFlushTradeOverlay);
    window.addEventListener(TRADE_OVERLAY_CLOSE_STATE_EVENT, handleTradeOverlayCloseState);

    return () => {
      unsubscribeAppStore();
      unsubscribeChartSettings();
      window.removeEventListener('rtx:force-refresh-positions', handleForceRefresh);
      window.removeEventListener('rtx:refresh-trade-overlay', handleRefreshTradeOverlay);
      window.removeEventListener('rtx:flush-trade-overlay', handleFlushTradeOverlay);
      window.removeEventListener(TRADE_OVERLAY_CLOSE_STATE_EVENT, handleTradeOverlayCloseState);

      if (tradeHistoryRefreshTimerRef.current !== null) {
        window.clearTimeout(tradeHistoryRefreshTimerRef.current);
        tradeHistoryRefreshTimerRef.current = null;
      }
      if (tradeMissingGraceTimerRef.current !== null) {
        window.clearTimeout(tradeMissingGraceTimerRef.current);
        tradeMissingGraceTimerRef.current = null;
      }
      if (tradeOverlayRafRef.current !== null) {
        cancelAnimationFrame(tradeOverlayRafRef.current);
        tradeOverlayRafRef.current = null;
      }

      try { chartRef.current?.unsubscribeCrosshairMove(crosshairLabelUpdater); } catch { }
      try { chartRef.current?.timeScale().unsubscribeVisibleLogicalRangeChange(timeScaleHandler); } catch { }

      clearTradeOverlay();
    };
  }, [brokerTimeOffsetSec, clearTradeOverlay, clearTradeOverlayLayer, getNearestCandleByTime, hydrateTradeLevelOverrides, isLivePriceSafeForCandles, persistTradeLevelOverrides, symbol, timeframe, updateLabelPositions]);

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
        const palette = getTradeOverlayCardPalette(slTpLabel === 'TP' ? 'TP' : 'SL', isChartSurfaceLight());

        const badge = document.createElement('div');
        badge.className = 'rtx-position-badge';
        badge.style.cssText = `
          position: absolute;
          right: 0;
          padding: 1px 5px;
          background: ${palette.background};
          border: 1px solid ${palette.border};
          color: ${palette.text};
          font-size: 10px;
          font-family: Consolas, 'Courier New', monospace;
          font-weight: 700;
          white-space: nowrap;
          z-index: 6;
          pointer-events: none;
          border-radius: 2px;
          transform: translateY(-50%);
          letter-spacing: 0.02em;
          min-width: 52px;
          text-align: center;
          ${palette.shadow}
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

  const handleCtxToggleTradeHistory = useCallback(() => {
    setCtxShowTradeHistory(prev => {
      const next = !prev;
      const store = useChartSettingsStore.getState();
      store.updateGlobalProperty('showTradeHistory', next);
      store.updateSymbolProperty(symbol, 'showTradeHistory', next);
      window.dispatchEvent(new CustomEvent('rtx:flush-trade-overlay'));
      return next;
    });
  }, [symbol]);

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
    const interactionRoot = container.parentElement ?? container;

    let dragLineOverlay: HTMLDivElement | null = null;
    let dragBadgeOverlay: HTMLDivElement | null = null;
    let dragState: {
      tradeObj: ActiveTradeSnapshot;
      grabbedType: 'ENTRY' | 'SL' | 'TP';
      entryAnchorY: number;
    } | null = null;
    let capturedPointerElement: HTMLElement | null = null;
    let capturedPointerId: number | null = null;
    let previousRootCursor = '';
    let previousContainerCursor = '';
    let previousBodyCursor = '';
    let previousUserSelect = '';
    let dragCursorActive = false;
    let tradeHoverCursorActive = false;

    const getChartY = (e: PointerEvent) => {
      const rect = container.getBoundingClientRect();
      return e.clientY - rect.top;
    };

    const isPointerInsideChart = (e: PointerEvent) => {
      const rect = container.getBoundingClientRect();
      return (
        e.clientX >= rect.left
        && e.clientX <= rect.right
        && e.clientY >= rect.top
        && e.clientY <= rect.bottom
      );
    };

    const getEntryDragDirection = (y: number, startY: number): 1 | -1 | null => {
      if (Math.abs(y - startY) < TRADE_LEVEL_MIN_DRAG_PX) return null;
      return y < startY ? 1 : -1;
    };

    const getFinitePriceCoordinate = (price: number): number | null => {
      if (!seriesRef.current || !(price > 0)) return null;
      const coordinate = seriesRef.current.priceToCoordinate(price);
      return coordinate !== null && Number.isFinite(coordinate) ? (coordinate as number) : null;
    };

    const getPriceScaleOffset = () => seriesRef.current?.priceScale().width() ?? 52;

    const getTradeLevelStateKeys = (trade: ActiveTradeSnapshot): string[] => {
      const digits = getSymbolDigits(trade.symbol);
      const fingerprint = createTradeLevelOverrideFingerprint({
        symbol: trade.symbol,
        side: trade.side,
        volume: trade.volume,
        entryPrice: trade.entryPrice,
        entryTime: trade.entryTime,
        digits,
      });
      return Array.from(new Set([trade.key, fingerprint]));
    };

    const getTradeLevelState = (
      state: Map<string, TradeLevelOverride>,
      trade: ActiveTradeSnapshot,
    ): TradeLevelOverride | undefined => {
      for (const key of getTradeLevelStateKeys(trade)) {
        const levels = state.get(key);
        if (!levels) continue;
        if (key !== trade.key) state.set(trade.key, levels);
        return levels;
      }
      return undefined;
    };

    const setTradeLevelState = (
      state: Map<string, TradeLevelOverride>,
      trade: ActiveTradeSnapshot,
      levels: TradeLevelOverride,
    ) => {
      getTradeLevelStateKeys(trade).forEach((key) => state.set(key, levels));
    };

    const deleteTradeLevelState = (
      state: Map<string, TradeLevelOverride>,
      trade: ActiveTradeSnapshot,
    ) => {
      getTradeLevelStateKeys(trade).forEach((key) => state.delete(key));
    };

    const getDragRoleColor = (role: 'SL' | 'TP') => role === 'TP' ? '#00a256' : '#eb415c';

    const findClosestLevelForTrade = (
      trade: ActiveTradeSnapshot,
      y: number,
      maxDistance: number,
    ): { grabbedType: 'ENTRY' | 'SL' | 'TP'; distance: number } | null => {
      if (!seriesRef.current) return null;

      const override = getTradeLevelState(tradeLevelOverridesRef.current, trade);
      const lastKnown = getTradeLevelState(tradeLevelLastKnownLevelsRef.current, trade);
      const getLevelY = (price: number | undefined) => (
        price && price > 0 && seriesRef.current
          ? seriesRef.current.priceToCoordinate(price)
          : null
      );

      const sl = override && override.sl > 0
        ? override.sl
        : lastKnown && lastKnown.sl > 0
          ? lastKnown.sl
          : trade.sl;
      const tp = override && override.tp > 0
        ? override.tp
        : lastKnown && lastKnown.tp > 0
          ? lastKnown.tp
          : trade.tp;

      return selectNearestTradeLevel([
        { grabbedType: 'ENTRY', y: getLevelY(trade.entryPrice) },
        { grabbedType: 'SL', y: getLevelY(sl) },
        { grabbedType: 'TP', y: getLevelY(tp) },
      ], y, maxDistance);
    };

    const findClosestTradeLevel = (
      y: number,
      maxDistance: number,
    ): { tradeObj: ActiveTradeSnapshot; grabbedType: 'ENTRY' | 'SL' | 'TP'; distance: number } | null => {
      let closest: { tradeObj: ActiveTradeSnapshot; grabbedType: 'ENTRY' | 'SL' | 'TP'; distance: number } | null = null;

      activeTradeSnapshotsRef.current.forEach((trade) => {
        const nearestLevel = findClosestLevelForTrade(trade, y, closest?.distance ?? maxDistance);
        if (nearestLevel) {
          closest = {
            tradeObj: trade,
            grabbedType: nearestLevel.grabbedType,
            distance: nearestLevel.distance,
          };
        }
      });

      return closest;
    };

    const beginPointerCapture = (target: HTMLElement | null, pointerId: number) => {
      capturedPointerElement = target ?? interactionRoot;
      capturedPointerId = pointerId;
      try {
        capturedPointerElement.setPointerCapture(pointerId);
      } catch {
        capturedPointerElement = null;
        capturedPointerId = null;
      }
    };

    const releasePointerCapture = () => {
      if (capturedPointerElement && capturedPointerId !== null) {
        try {
          if (capturedPointerElement.hasPointerCapture(capturedPointerId)) {
            capturedPointerElement.releasePointerCapture(capturedPointerId);
          }
        } catch {
          // Pointer capture can already be released by the browser on pointercancel.
        }
      }
      capturedPointerElement = null;
      capturedPointerId = null;
    };

    const beginDragCursor = () => {
      previousRootCursor = interactionRoot.style.cursor;
      previousContainerCursor = container.style.cursor;
      previousBodyCursor = document.body.style.cursor;
      previousUserSelect = document.body.style.userSelect;
      interactionRoot.style.cursor = 'grabbing';
      container.style.cursor = 'grabbing';
      container.querySelectorAll('canvas').forEach((canvas) => {
        (canvas as HTMLElement).style.cursor = 'grabbing';
      });
      document.body.style.cursor = 'grabbing';
      document.body.style.userSelect = 'none';
      dragCursorActive = true;
    };

    const endDragCursor = () => {
      if (!dragCursorActive) return;
      interactionRoot.style.cursor = previousRootCursor;
      container.style.cursor = previousContainerCursor;
      container.querySelectorAll('canvas').forEach((canvas) => {
        (canvas as HTMLElement).style.cursor = 'default';
      });
      document.body.style.cursor = previousBodyCursor;
      document.body.style.userSelect = previousUserSelect;
      dragCursorActive = false;
    };

    const setTradeHoverCursor = (active: boolean) => {
      if (dragCursorActive || (!active && !tradeHoverCursorActive)) return;
      tradeHoverCursorActive = active;
      const cursor = active ? 'grab' : 'default';
      interactionRoot.style.cursor = active ? cursor : '';
      container.style.cursor = active ? cursor : '';
      container.querySelectorAll('canvas').forEach((canvas) => {
        (canvas as HTMLElement).style.cursor = cursor;
      });
    };

    const handlePointerDown = (e: PointerEvent) => {
      // Trade levels get first priority when the pointer is actually on/near one.
      if (e.button !== 0 || !seriesRef.current) return;
      if (chartSettingsRef.current.showTradeLevels === false) return;

      const y = getChartY(e);
      let closestTrade: ActiveTradeSnapshot | null = null;
      let grabbedType: 'ENTRY' | 'SL' | 'TP' = 'ENTRY';

      const targetBadge = e.target instanceof Element
        ? e.target.closest('.rtx-trade-level-badge') as HTMLElement | null
        : null;
      const targetLevel = e.target instanceof Element
        ? e.target.closest('.rtx-trade-level-badge, .rtx-trade-level-hit-area') as HTMLElement | null
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
        const nearestTradeLevel = findClosestTradeLevel(y, TRADE_LEVEL_HIT_AREA_PX / 2);
        if (nearestTradeLevel) {
          closestTrade = nearestTradeLevel.tradeObj;
          grabbedType = nearestTradeLevel.grabbedType;
        }
      }

      if (!closestTrade && activeToolRef.current !== null) return;

      if (closestTrade) {
        e.preventDefault();
        e.stopPropagation();
        setTradeHoverCursor(false);
        beginPointerCapture(targetLevel, e.pointerId);
        beginDragCursor();
        if (chartRef.current) {
          chartRef.current.applyOptions({
            handleScroll: DRAWING_LOCK_HANDLE_SCROLL,
            handleScale: DRAWING_LOCK_HANDLE_SCALE,
          });
        }

        const entryAnchorY = grabbedType === 'ENTRY'
          ? getFinitePriceCoordinate(closestTrade.entryPrice) ?? y
          : y;
        const initialOverlayY = grabbedType === 'ENTRY' ? entryAnchorY : y;
        dragState = { tradeObj: closestTrade, grabbedType, entryAnchorY };

        dragLineOverlay = document.createElement('div');
        dragLineOverlay.style.cssText = `position:absolute;left:0;right:${getPriceScaleOffset()}px;top:0;height:0;border-top:1px dashed transparent;z-index:999;pointer-events:none;transform:translate3d(0, ${initialOverlayY}px, 0);will-change:transform;`;

        dragBadgeOverlay = document.createElement('div');
        const initialPalette = getTradeOverlayCardPalette(grabbedType === 'TP' ? 'TP' : 'SL', isChartSurfaceLight());
        dragBadgeOverlay.style.cssText = `position:absolute;left:${TRADE_LEVEL_BADGE_LEFT_INSET_PX}px;top:0;padding:1px 5px;background:${initialPalette.background};border:1px solid ${initialPalette.border};color:${initialPalette.text};font-size:10px;font-family:Consolas,monospace;font-weight:700;z-index:1000;pointer-events:none;border-radius:2px;transform:translateY(calc(-50% + ${initialOverlayY}px));will-change:transform;opacity:0;${initialPalette.shadow}`;

        overlayRef.current?.appendChild(dragLineOverlay);
        overlayRef.current?.appendChild(dragBadgeOverlay);
      }
    };

    const handlePointerMove = (e: PointerEvent) => {
      if (!dragState) {
        if (
          !seriesRef.current
          || activeToolRef.current !== null
          || chartSettingsRef.current.showTradeLevels === false
          || !isPointerInsideChart(e)
        ) {
          setTradeHoverCursor(false);
          return;
        }
        setTradeHoverCursor(Boolean(findClosestTradeLevel(getChartY(e), TRADE_LEVEL_HIT_AREA_PX / 2)));
        return;
      }

      if (!dragLineOverlay || !dragBadgeOverlay || !seriesRef.current) return;
      if (capturedPointerId !== null && e.pointerId !== capturedPointerId) return;
      e.preventDefault();
      e.stopPropagation();
      const y = getChartY(e);
      const rawPrice = seriesRef.current.coordinateToPrice(y as any);
      if (rawPrice === null) return;

      const { tradeObj, grabbedType, entryAnchorY } = dragState;
      const digits = getSymbolDigits(tradeObj.symbol);
      const minStopDistance = getTradeLevelDragMinDistance(digits);
      const liveCurrentPrice = activeTradeSnapshotsRef.current.get(tradeObj.key)?.currentPrice ?? tradeObj.currentPrice;
      const entryDragDirection = grabbedType === 'ENTRY' ? getEntryDragDirection(y, entryAnchorY) : null;

      // Entry-line clicks are ignored, but any real vertical drag should create SL/TP.
      // Existing SL/TP levels remain freely repositionable.
      const hasRealEntryDrag = entryDragDirection !== null;
      const showPreview = grabbedType !== 'ENTRY' || hasRealEntryDrag;
      const previewUpdate = showPreview
        ? applyTradeLevelDragUpdate({
          side: tradeObj.side,
          grabbedType,
          entryPrice: tradeObj.entryPrice,
          finalPrice: rawPrice,
          currentSl: tradeObj.sl,
          currentTp: tradeObj.tp,
          digits,
          currentPrice: liveCurrentPrice,
          minStopDistance,
          minEntryDistance: grabbedType === 'ENTRY' ? minStopDistance : undefined,
          snapEntryToMinDistance: grabbedType === 'ENTRY',
          entryDragDirection: entryDragDirection ?? undefined,
        })
        : null;

      if (!previewUpdate || !Number.isFinite(previewUpdate.price) || previewUpdate.price <= 0) {
        const idleY = grabbedType === 'ENTRY' ? entryAnchorY : y;
        dragLineOverlay.style.borderTopColor = 'transparent';
        dragBadgeOverlay.style.opacity = '0';
        dragLineOverlay.style.transform = `translate3d(0, ${idleY}px, 0)`;
        dragBadgeOverlay.style.transform = `translateY(calc(-50% + ${idleY}px))`;
        return;
      }

      const price = previewUpdate.price;
      const role = previewUpdate.role;
      const color = getDragRoleColor(role);
      const palette = getTradeOverlayCardPalette(role, isChartSurfaceLight());

      // Draw at the clamped price coordinate so the level sticks to the broker-valid
      // boundary instead of following the pointer into a zone the broker would reject.
      const clampedY = seriesRef.current.priceToCoordinate(price);
      const drawY = clampedY === null || !Number.isFinite(clampedY) ? y : (clampedY as number);

      dragLineOverlay.style.borderTopColor = color;
      dragBadgeOverlay.style.opacity = '1';
      dragLineOverlay.style.transform = `translate3d(0, ${drawY}px, 0)`;

      dragBadgeOverlay.style.background = palette.background;
      dragBadgeOverlay.style.borderColor = palette.border;
      dragBadgeOverlay.style.color = palette.text;
      dragBadgeOverlay.style.boxShadow = palette.shadow.replace(/^box-shadow:/, '').replace(/;$/, '');
      dragBadgeOverlay.textContent = `${role} ${price.toFixed(digits)}`;
      dragBadgeOverlay.style.transform = `translateY(calc(-50% + ${drawY}px))`;
    };

    const handlePointerUp = (e: PointerEvent) => {
      if (!dragState) return;
      if (capturedPointerId !== null && e.pointerId !== capturedPointerId) return;
      e.preventDefault();
      e.stopPropagation();

      if (seriesRef.current) {
        const y = getChartY(e);
        const rawFinalPrice = seriesRef.current.coordinateToPrice(y as any);
        const { tradeObj, grabbedType, entryAnchorY } = dragState;

        if (rawFinalPrice !== null) {
          const entryDragDirection = grabbedType === 'ENTRY' ? getEntryDragDirection(y, entryAnchorY) : null;
          const hasRealEntryDrag = entryDragDirection !== null;
          if (!(grabbedType === 'ENTRY' && !hasRealEntryDrag)) {
            const existingOverrides = getTradeLevelState(tradeLevelOverridesRef.current, tradeObj);
            const lastKnownLevels = getTradeLevelState(tradeLevelLastKnownLevelsRef.current, tradeObj);
            const currentSl = existingOverrides && existingOverrides.sl > 0
              ? existingOverrides.sl
              : lastKnownLevels && lastKnownLevels.sl > 0
                ? lastKnownLevels.sl
                : tradeObj.sl;
            const currentTp = existingOverrides && existingOverrides.tp > 0
              ? existingOverrides.tp
              : lastKnownLevels && lastKnownLevels.tp > 0
                ? lastKnownLevels.tp
                : tradeObj.tp;
            const digits = getSymbolDigits(tradeObj.symbol);
            const liveCurrentPrice = activeTradeSnapshotsRef.current.get(tradeObj.key)?.currentPrice ?? tradeObj.currentPrice;
            const update = applyTradeLevelDragUpdate({
              side: tradeObj.side,
              grabbedType,
              entryPrice: tradeObj.entryPrice,
              finalPrice: rawFinalPrice,
              currentSl,
              currentTp,
              digits,
              currentPrice: liveCurrentPrice,
              minStopDistance: getTradeLevelDragMinDistance(digits),
              minEntryDistance: grabbedType === 'ENTRY' ? getTradeLevelDragMinDistance(digits) : undefined,
              snapEntryToMinDistance: grabbedType === 'ENTRY',
              entryDragDirection: entryDragDirection ?? undefined,
            });

            if (update) {
              const ticket = Number(tradeObj.key.replace('trade:', ''));
              if (ticket) {
                const { sl, tp } = update;
                const previousLevels = {
                  sl: currentSl || 0,
                  tp: currentTp || 0,
                };
                const requestId = tradeLevelModifyRequestSeqRef.current + 1;
                const requestKeys = getTradeLevelStateKeys(tradeObj);
                tradeLevelModifyRequestSeqRef.current = requestId;
                const optimisticGraceUntil = Date.now() + TRADE_LEVEL_OPTIMISTIC_GRACE_MS;
                requestKeys.forEach((key) => pendingTradeLevelModifyRequestsRef.current.set(key, requestId));
                requestKeys.forEach((key) => tradeLevelOptimisticGraceUntilRef.current.set(key, optimisticGraceUntil));
                const isCurrentRequest = () => requestKeys.some((key) => (
                  pendingTradeLevelModifyRequestsRef.current.get(key) === requestId
                ));
                const clearCurrentRequest = () => {
                  requestKeys.forEach((key) => {
                    if (pendingTradeLevelModifyRequestsRef.current.get(key) === requestId) {
                      pendingTradeLevelModifyRequestsRef.current.delete(key);
                    }
                  });
                };

                // Optimistically set UI level overrides immediately
                setTradeLevelState(tradeLevelOverridesRef.current, tradeObj, { sl: sl || 0, tp: tp || 0 });
                setTradeLevelState(tradeLevelLastKnownLevelsRef.current, tradeObj, { sl: sl || 0, tp: tp || 0 });
                persistTradeLevelOverrides();
                rememberTradeHistoryPositionLevels([
                  {
                    id: ticket,
                    symbol: tradeObj.symbol,
                    side: tradeObj.side,
                    volume: tradeObj.volume,
                    entryPrice: tradeObj.entryPrice,
                    entryTime: tradeObj.entryTime,
                    sl: sl || 0,
                    tp: tp || 0,
                    price_sl: sl || 0,
                    price_tp: tp || 0,
                  },
                ], useAppStore.getState().accountId);
                window.dispatchEvent(new CustomEvent('rtx:flush-trade-overlay')); // flush instantly
                window.dispatchEvent(new CustomEvent('rtx:trade-modified', { detail: { id: ticket, sl: sl || 0, tp: tp || 0 } }));

                api.positions.modifyPosition(ticket, { price_sl: sl || 0, price_tp: tp || 0 })
                  .then(() => {
                    if (!isCurrentRequest()) return;
                    clearCurrentRequest();
                    window.setTimeout(() => window.dispatchEvent(new Event('rtx:force-refresh-positions')), 250);
                  })
                  .catch(err => {
                    if (!isCurrentRequest()) return;
                    clearCurrentRequest();
                    requestKeys.forEach((key) => tradeLevelOptimisticGraceUntilRef.current.delete(key));
                    console.error('[Chart] Failed to modify SL/TP:', err);
                    if ((previousLevels.sl || 0) > 0 || (previousLevels.tp || 0) > 0) {
                      setTradeLevelState(tradeLevelOverridesRef.current, tradeObj, previousLevels);
                      setTradeLevelState(tradeLevelLastKnownLevelsRef.current, tradeObj, previousLevels);
                    } else {
                      deleteTradeLevelState(tradeLevelOverridesRef.current, tradeObj);
                      deleteTradeLevelState(tradeLevelLastKnownLevelsRef.current, tradeObj);
                    }
                    persistTradeLevelOverrides();
                    window.dispatchEvent(new CustomEvent('rtx:flush-trade-overlay'));
                  });
              }
            }
          }
        }
      }

      if (dragLineOverlay) dragLineOverlay.remove();
      if (dragBadgeOverlay) dragBadgeOverlay.remove();
      dragLineOverlay = null;
      dragBadgeOverlay = null;
      dragState = null;
      releasePointerCapture();
      endDragCursor();
      setTradeHoverCursor(false);

      if (chartRef.current) {
        chartRef.current.applyOptions({
          handleScroll: TRADING_VIEW_HANDLE_SCROLL,
          handleScale: TRADING_VIEW_HANDLE_SCALE,
        });
      }
    };

    const handlePointerCancel = () => {
      if (!dragState && !dragLineOverlay && !dragBadgeOverlay) return;
      if (dragLineOverlay) dragLineOverlay.remove();
      if (dragBadgeOverlay) dragBadgeOverlay.remove();
      dragLineOverlay = null;
      dragBadgeOverlay = null;
      dragState = null;
      releasePointerCapture();
      endDragCursor();
      setTradeHoverCursor(false);
      if (chartRef.current) {
        chartRef.current.applyOptions({
          handleScroll: TRADING_VIEW_HANDLE_SCROLL,
          handleScale: TRADING_VIEW_HANDLE_SCALE,
        });
      }
    };

    interactionRoot.addEventListener('pointerdown', handlePointerDown, true);
    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', handlePointerUp);
    window.addEventListener('pointercancel', handlePointerCancel);

    return () => {
      interactionRoot.removeEventListener('pointerdown', handlePointerDown, true);
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', handlePointerUp);
      window.removeEventListener('pointercancel', handlePointerCancel);
      if (dragLineOverlay) dragLineOverlay.remove();
      if (dragBadgeOverlay) dragBadgeOverlay.remove();
      releasePointerCapture();
      endDragCursor();
      setTradeHoverCursor(false);
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

      {chartSettings.showGrid && (
        <div
          aria-hidden="true"
          className="absolute inset-0"
          style={{
            pointerEvents: 'none',
            zIndex: 1,
            backgroundImage: `linear-gradient(to right, ${chartTheme.grid} 1px, transparent 1px), linear-gradient(to bottom, ${chartTheme.grid} 1px, transparent 1px)`,
            backgroundSize: TRADING_VIEW_GRID_OVERLAY_SIZE,
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

      {/* ── Live current-price line + badge (TradingView-style last-price indicator) ── */}
      <div
        ref={livePriceLineRef}
        style={{
          position: 'absolute',
          top: -9999,
          left: 0,
          right: 52,
          height: 0,
          borderTop: `1px dashed ${LIVE_PRICE_UP_COLOR}`,
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
          background: LIVE_PRICE_UP_COLOR,
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
      <OneClickTrading symbol={symbol} timeframe={timeframe} visible={showOneClick} tradeAllowed={tradeAllowed} />



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
        showTradeHistory={ctxShowTradeHistory}
        onChangeChartType={handleCtxChartTypeChange}
        onChangeTimeframe={handleCtxTimeframeChange}
        onToggleOneClickTrading={() => setShowOneClick(prev => !prev)}
        onToggleGrid={handleCtxToggleGrid}
        onToggleVolumes={handleCtxToggleVolumes}
        onToggleAutoScroll={handleCtxToggleAutoScroll}
        onToggleChartShift={handleCtxToggleChartShift}
        onToggleTradeLevels={handleCtxToggleTradeLevels}
        onToggleTradeHistory={handleCtxToggleTradeHistory}
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
