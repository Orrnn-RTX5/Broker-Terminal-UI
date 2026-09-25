import { createChartDataSnapshot, type ChartDataSnapshot } from '../services/chartDataSnapshot';
import { ChartSymbolTrigger } from './ChartSymbolDropdown';
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
import { getAnnotationTool } from '../drawing-tools/annotationToolCatalog';
import { createChartRuler, rulerMetrics } from '../drawing-tools/chartRuler';
import {
  createChart,
  createSeriesMarkers,
  ColorType,
  CrosshairMode,
  LineStyle,
  TickMarkType,
  CandlestickSeries,
  LineSeries,
  BarSeries,
  AreaSeries,
  HistogramSeries,
} from 'lightweight-charts';
import type { IChartApi, IPriceLine, ISeriesApi, Time } from 'lightweight-charts';
import { useCrosshair } from '../hooks/useCrosshair';
import { useQuoteSubscription } from '../hooks/useQuoteSubscription';
import { useSymbolMarketStatus } from '../hooks/useSymbolMarketStatus';
import { useSelectedHistoryRequestOwner } from '../hooks/useSelectedHistoryRequestOwner';
import { useActiveChartRuntimeEffect } from '../hooks/useActiveChartRuntimeEffect';
import { useBrokerAccountSessionScope } from '../hooks/useBrokerAccountSessionScope';
import { useTradingChartVisibleRuntime } from '../hooks/useTradingChartVisibleRuntime';
import { createChartInteractionOwnership } from '../utils/chartInteractionOwnership';
import { createChartPostInteractionCoordinator } from '../utils/chartPostInteractionCoordinator';
import {
  buildChartSelectionPresentationKey,
  createChartSelectionPresentationGate,
  isChartSelectionLivePaintAllowed,
  releaseChartSelectionLivePaint,
  selectChartPresentation,
  shouldCommitFirstLiveSelectionBaseline,
} from '../utils/chartSelectionPresentation';
import { RTX_ADVANCED_VIEW_CHANGE_EVENT } from '../utils/advancedViewRootClasses';
import { scheduleChartThemeTransition } from '../utils/chartThemeTransition';
import { refreshLightweightChartSurface } from '../utils/lightweightChartSurface';
import { isLikelyAlwaysOpenCryptoSymbol } from '../utils/marketStatus';
import { setLiveMarketDataFrozen } from '../services/liveTickDispatcher';
import { useWebSocketStore } from '../store/useWebSocketStore';
import { drawingManager } from '../services/drawingManager';
import { resolveTrendToolColor } from '../drawing-tools/toolDefaults';
import { projectDrawingTimeAtLogical } from '../drawing-tools/geometry/drawingTimeProjection';
import { isTrendDrawingInputActive, setTrendDrawingInputActive, usesDirectDrawingPointerInput } from '../drawing-tools/drawingInteractionPriority';
import { getQuoteSocketManager } from '../services/quoteSocketManager';
import {
  candleAggregationService,
  getTimeframeSeconds,
  omitPartialLeadingM1Aggregate,
  type OHLCV,
  type Timeframe as AggTimeframe,
} from '../services/candleAggregationService';
import { useAppStore } from '../store/useAppStore';
import { updateDrawingCandle } from '../drawing-tools/drawingCandleUpdates';
import api from '../services/api';
import { isDesktopBackendTarget } from '../config/backendTarget.js';
import { useDockLayoutStore } from '../store/useDockLayoutStore';
import { useMarketDataStore } from '../store/useMarketDataStore';
import { commandBus } from '../services/commandBus';
import { OneClickTrading } from './OneClickTrading';
import { DrawingContextMenu } from './DrawingContextMenu';
import { PriceDisplay } from './ui/PriceDisplay';
import { getSymbolDigits } from '../utils/symbolUtils';
import {
  computeMinimumVisiblePriceSpan,
  formatChartAxisPrice,
  getPricePointFromDigits,
  resolveSymbolPriceDigits,
} from '../utils/chartPriceScale';
import { getChartGridLineColors } from '../utils/chartGridStyle';
import {
  SQUARE_CHART_GRID_CELL_SIZE_PX,
  SquareChartGridPrimitive,
} from '../utils/squareChartGridPrimitive';
import { getChartCandleCountdownText } from '../utils/chartCandleCountdown';
import type { PeriodSeparator } from '../utils/periodSeparators';
import { rememberTradeHistoryPositionLevels } from '../utils/tradeHistoryLevelCache';
import { ChartContextMenu } from './ChartContextMenu';
import { captureFullPage } from '../services/screenshotService';
import { IndicatorManager, type IndicatorConfig } from '../services/indicatorManager';
import { chartDataService } from '../services/chartDataService';
import { candleCache, type CandleCacheKey, type CandleCacheMetadata, type CandleCacheSource } from '../services/candleCache';
import {
  fetchDerivedTimeframeCandlesFromM1,
  getDerivedM1InitialTargetCandleLimit,
  isM1DerivedFallbackTimeframe,
} from '../services/derivedTimeframeHistoryService';
import {
  backfillRecentInteriorHistoryGaps,
  FIRST_PAINT_HISTORY_COUNT,
  mergeMissingHistoryCandles,
  createChartHistoryBackfillDiagnostics,
  createSelectedTimeframeHistoryCoordinator,
  fetchOlderHistoryPage as fetchChartOlderHistoryPage,
  getHistoryPageSize,
  getInitialHistoryCount as getChartInitialHistoryCount,
  markHistoryBackfillError,
  markHistoryBackfillPageLoaded,
  markHistoryBackfillStarted,
  markHistoryBackfillStopped,
  resolveDeferredVisibleRangeHistoryAction,
  resolveVisibleRangeHistoryAction,
  selectOlderCandlesBeforeCursor,
  type ChartHistoryBackfillDiagnostics,
} from '../services/chartHistoryLoader';
import {
  canDropPreloadedCandlesForLiveQuoteMismatch,
  getChartPriceFromQuote,
  createRenderedPriceReference,
  isPriceCompatibleWithReference,
  normalizeCandlesToReference,
  resetLiveQuoteGuardState,
  updateLiveQuoteGuardState,
  type RenderedPriceReference,
} from '../services/chartPriceGuards';
import { getQuoteBidMarkupOffset, getRawQuoteSides, roundPriceToDigits } from '../utils/spreadMarkup';
import { ChartTemplateDialog } from './ChartTemplateDialog';
import { type ChartTemplate } from '../store/useTemplateStore';
import {
  clampChartOpacityPercent,
  defaultChartProperties,
  getEffectiveChartColors,
  useChartSettingsStore,
  type ChartProperties,
} from '../store/useChartSettingsStore';
import {
  defaultChartObjectState,
  getChartObjectState,
  useChartObjectStateStore,
} from '../store/useChartObjectStateStore';
import {
  getTradingChartDefaultVisibleBars,
  getTradingChartInitialLogicalRange,
  getTradingChartShiftRightOffset,
  formatTradingChartCrosshairLabel,
  formatTradingChartTickLabel,
  getTradingChartTickMarkCharacterLength,
  shouldTradingChartFooterPromoteLeftEdgeDateLabel,
} from '../utils/chartTimeFormat';
import {
  CANDLE_TIMEFRAMES,
  alignTimeframeBoundarySeconds,
  getTimeframePeriodSeconds,
} from '../utils/timeframeBoundary';
import {
  getSynchronizedMarketNowMs,
  synchronizeMarketClock,
  type SynchronizedMarketClockAnchor,
} from '../utils/synchronizedMarketClock';
import {
  applyTradeLevelDragUpdate,
  tradeLevelModifyPatch,
  createTradeLevelOverrideFingerprint,
  getTradeLevelDragMinDistance,
  selectNearestTradeLevel,
} from '../utils/tradeLevelDrag';
import {
  computeSignedPips,
  bindChartUiTranslation,
  createDockedLevelChip,
  createEntryTradeControlBar,
  createTradeLevelControlBar,
  estimateTradeLevelMoney,
  estimateTradeMoneyAtPrice,
  formatMoneyLabel,
  formatPipsLabel,
  refreshChartUiTranslations,
} from '../utils/chartTradeControls';
import {
  buildTradeHistoryBadgeText,
  formatTradeHistoryGmtTime,
  getTradeHistoryExecutionSide,
} from '../utils/chartTradeHistoryPresentation';
import {
  buildTradeShareUrl,
  copyTextToClipboard,
  getSharedChartTrade,
} from '../utils/tradeShareLink';
import { computePriceAxisDragRange } from '../utils/priceAxisDragZoom';
import { applyChartTimeZoom } from '../utils/chartTimeZoom';
import { bindChartKeyboardScroll } from '../utils/chartKeyboardScroll';
import { isChartLegendPainted, paintChartLegend } from '../utils/chartLegend';
import { useChartZoomStore } from '../store/useChartZoomStore';
import {
  activateActiveChartSource,
  bindActiveChartSourceInteractions,
  findLargestChartCanvas,
  getActiveChartSource,
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
import {
  applyTickToFormingCandle,
  applyBrokerTimeOffsetToCandles,
  formatHistoryForOhlcv,
  getVisibleLogicalRangeForDataRender,
  mergeAuthoritativeCandleHistory,
  mergeHistoricalCandlesWithBufferedLive,
  mergeFormingCandleEnvelope,
  mergeBackendCandlePage,
  prependCandleHistory,
  selectCandlesMutatedAfterGeneration,
  selectOlderHistoryCandlesForMerge,
  upsertCandleIntoHistory,
  type LogicalRangeLike,
} from '../utils/candleHistory';
import {
  formatChartSeriesData,
  getDisplayVolume,
  getLeftVisibleTimeFromLogicalRange,
  getLivePriceOverlayColors,
  getLivePriceSeriesColor,
  isCandleAtOrBeforeFinalizedTime,
  markFinalizedCandleTime,
  getRenderedPrependedBarCount,
  getSeparatorPriority,
  getValidSortedCandles,
  getVisibleLogicalRangeAnchoredToTime,
  isDenseMinuteSeparatorTimeframe,
  isPotentialMarketClosedPlaceholderCandle,
  resolveCandleFinalityFromActivePeriod,
  shouldRecomputeMarketGapSeparatorsForCandle,
  shouldRestoreProtectedHistoryForFullRender,
  shouldApplyVisibleRangeResetForRender,
  shouldResetInitialHistoryVisibleRange,
  TRADING_CHART_TIME_SCALE_LIVE_SHIFT_OPTIONS,
  type Candle,
  type ChartType,
  type LivePriceOverlayColors,
  type Timeframe,
  type TradingViewChartTheme,
  type VolumeDisplaySettings,
} from './TradingChart.helpers';
import {
  getCurrentClosedMarketRenderCandles,
  getCurrentClosedMarketSessionCloseSeconds,
} from '../utils/currentClosedMarketTail';

export type { ChartType, Timeframe } from './TradingChart.helpers';

const SUPPORTED_CHART_INDICATOR_TYPES = new Set(['ma', 'sma', 'ema', 'rsi', 'macd', 'bb', 'bollinger']);

const getFixedChartPriceRange = (
  settings: Pick<ChartProperties, 'scaleFix' | 'fixedMinimum' | 'fixedMaximum'>
): { from: number; to: number } | null => {
  const from = Number(settings.fixedMinimum);
  const to = Number(settings.fixedMaximum);
  return settings.scaleFix && Number.isFinite(from) && Number.isFinite(to) && to > from
    ? { from, to }
    : null;
};

interface AddChartIndicatorRequest {
  id?: string;
  name: string;
  indicatorType?: string;
  params?: Record<string, any>;
}

const resolveChartIndicatorType = (request: AddChartIndicatorRequest): string | null => {
  const explicitType = request.indicatorType?.trim().toLowerCase();
  if (explicitType && SUPPORTED_CHART_INDICATOR_TYPES.has(explicitType)) return explicitType;

  const idType = request.id?.split('-')[0]?.trim().toLowerCase();
  if (idType && SUPPORTED_CHART_INDICATOR_TYPES.has(idType)) return idType;

  const normalizedName = request.name.trim().toLowerCase();
  if (normalizedName.includes('bollinger')) return 'bb';
  if (normalizedName.includes('exponential') || normalizedName === 'ema') return 'ema';
  if (normalizedName.includes('moving average') || normalizedName === 'ma' || normalizedName.includes('sma')) return 'sma';
  if (normalizedName.includes('relative strength') || normalizedName === 'rsi') return 'rsi';
  if (normalizedName.includes('macd')) return 'macd';
  return null;
};

// MT5-style "comfortable" candle width — used to compute how many bars to fit
// across the visible chart area on initial-load and on axis reset. Adapting to
// container width keeps the look consistent whether the panel is narrow or wide.
const TARGET_BAR_PX = 25;
const MIN_ADAPTIVE_BARS = 30;
const MAX_ADAPTIVE_BARS = 200;
const INITIAL_HISTORY_COUNT = 500;
const HISTORY_RENDER_IDLE_TIMEOUT_MS = 700;
const HISTORY_BACKFILL_IDLE_YIELD_TIMEOUT_MS = 120;
const HISTORY_IDLE_FALLBACK_DELAY_MS = 32;
const HISTORY_RENDER_INTERACTION_IDLE_MS = 180;
const HISTORY_VISIBLE_RANGE_SUPPRESSION_MS = 120;
const TRADE_LEVEL_OVERRIDES_STORAGE_KEY = 'rtx-trade-level-overrides-v1';
const TRADE_LEVEL_OVERRIDE_TTL_MS = 5 * 60 * 1000;
const TRADE_LEVEL_OPTIMISTIC_GRACE_MS = 15_000;
const TRADE_LEVEL_HIT_AREA_PX = 24;
const TRADE_LEVEL_MIN_DRAG_PX = 2;
const TRADE_LEVEL_CROSS_CLOSE_CANDIDATE_TTL_MS = 15_000;
// A level-cross close is only GUESSED once the position has been missing this
// long. Routine feed gaps (REST refresh races, WS commits) are shorter, so a
// still-open trade hovering at its SL/TP no longer blinks into a fake close.
const TRADE_LEVEL_CROSS_CLOSE_MIN_MISSING_MS = 1_500;
// One backend refresh per window for the whole position cluster: a dozen
// trades riding their levels must not turn every tick into a request storm.
const TRADE_LEVEL_CROSS_REFRESH_MIN_DISPATCH_INTERVAL_MS = 3_000;
const TRADE_LEVEL_BADGE_LEFT_INSET_PX = 10;
const TRADE_LEVEL_BADGE_STACK_OFFSET_PX = 76;
const LIVE_PRICE_SCALE_WIDTH_FALLBACK_PX = 52;
const LIVE_PRICE_BADGE_PRICE_ROW_OFFSET_PX = 10;
const TRADE_MISSING_POSITION_GRACE_MS = 30_000;
const REALTIME_SCROLL_THRESHOLD_BARS = 2;
const LIVE_CHART_UPDATE_INTERVAL_MS = 50;

interface ChartHistoryPage {
  candles: Candle[];
  source: CandleCacheSource;
}

interface BrowserIdleDeadline {
  didTimeout: boolean;
  timeRemaining: () => number;
}

type BrowserIdleCallback = (deadline: BrowserIdleDeadline) => void;
type BrowserIdleCallbackHandle = number;
type BrowserWithIdleCallback = Window & typeof globalThis & {
  requestIdleCallback?: (callback: BrowserIdleCallback, options?: { timeout?: number }) => BrowserIdleCallbackHandle;
  cancelIdleCallback?: (handle: BrowserIdleCallbackHandle) => void;
};

const requestBrowserIdleCallback = (
  callback: BrowserIdleCallback,
  timeoutMs: number,
): BrowserIdleCallbackHandle => {
  if (typeof window === 'undefined') {
    callback({ didTimeout: true, timeRemaining: () => 0 });
    return 0;
  }

  const browserWindow = window as BrowserWithIdleCallback;
  if (browserWindow.requestIdleCallback) {
    return browserWindow.requestIdleCallback(callback, { timeout: timeoutMs });
  }

  return window.setTimeout(() => {
    callback({ didTimeout: true, timeRemaining: () => 0 });
  }, Math.min(timeoutMs, HISTORY_IDLE_FALLBACK_DELAY_MS));
};

const cancelBrowserIdleCallback = (handle: BrowserIdleCallbackHandle): void => {
  if (typeof window === 'undefined' || handle === 0) return;

  const browserWindow = window as BrowserWithIdleCallback;
  if (browserWindow.cancelIdleCallback) {
    browserWindow.cancelIdleCallback(handle);
    return;
  }

  window.clearTimeout(handle);
};

const waitForProgressiveHistoryIdleTurn = (signal: AbortSignal): Promise<void> => (
  new Promise(resolve => {
    if (signal.aborted) {
      resolve();
      return;
    }

    let settled = false;
    let handle: BrowserIdleCallbackHandle | null = null;
    const handleAbort = () => {
      if (settled) return;
      settled = true;
      if (handle !== null) cancelBrowserIdleCallback(handle);
      resolve();
    };

    handle = requestBrowserIdleCallback(() => {
      if (settled) return;
      settled = true;
      signal.removeEventListener('abort', handleAbort);
      resolve();
    }, HISTORY_BACKFILL_IDLE_YIELD_TIMEOUT_MS);

    if (!settled) {
      signal.addEventListener('abort', handleAbort, { once: true });
    }
  })
);

const isAbortError = (error: unknown): boolean => (
  typeof DOMException !== 'undefined' && error instanceof DOMException && error.name === 'AbortError'
) || (
    error instanceof Error && error.name === 'AbortError'
  );

const getInitialHistoryCount = (timeframe: Timeframe): number => (
  getChartInitialHistoryCount(timeframe, INITIAL_HISTORY_COUNT)
);

const shouldBuildVolumeData = (settings: VolumeDisplaySettings): boolean => (
  settings.showTickVolumes || settings.showRealVolumes
);

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
    if (tone === 'BUY') {
      return {
        background: '#eff6ff',
        border: '#2563eb',
        text: '#1d4ed8',
        shadow: 'box-shadow:0 1px 3px rgba(15,23,42,0.12);',
      };
    }
    return isPositiveTone
      ? {
        background: 'rgba(236, 253, 243, 0.9)',
        border: '#059669',
        text: '#047857',
        shadow: 'box-shadow:0 1px 3px rgba(15,23,42,0.12);',
      }
      : {
        background: 'rgba(254, 243, 242, 0.9)',
        border: '#dc2626',
        text: '#b91c1c',
        shadow: 'box-shadow:0 1px 3px rgba(15,23,42,0.12);',
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
const TRADING_VIEW_HANDLE_SCROLL = {
  vertTouchDrag: false,
  horzTouchDrag: true,
  mouseWheel: true,
  pressedMouseMove: true,
} as const;

const TRADING_VIEW_HANDLE_SCALE = {
  // Price-axis dragging is custom (MT5-style gentle exponential curve driven
  // by computePriceAxisDragRange); the native hyperbolic handler stays off.
  axisPressedMouseMove: { time: true, price: false },
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
  if (totalBars <= 0) return 0;
  return Math.max(floor, Math.min(MAX_ADAPTIVE_BARS, adaptive));
};

const mergeCandleCollections = (...collections: Array<readonly Candle[]>): Candle[] => {
  return collections.reduce<Candle[]>(
    (merged, collection) => mergeBackendCandlePage(merged, collection).candles,
    [],
  );
};

const applyBrokerTimeOffset = (candles: Candle[], offsetSeconds: number): Candle[] => (
  applyBrokerTimeOffsetToCandles(candles, offsetSeconds)
);

type ChartColorPalette = ChartProperties['colors'];
const MINUTE_SEPARATOR_PIXEL_DEDUP_DISTANCE = 10;

const CHART_AXIS_FONT_FAMILY = '"Segoe UI", Tahoma, Arial, sans-serif';
const LIGHT_CHART_AXIS_FONT_FAMILY = '"Segoe UI", Tahoma, Arial, sans-serif';
const CHART_AXIS_FONT_SIZE = 14;

const readChartAxisFontSize = (): number => {
  if (typeof document === 'undefined') return CHART_AXIS_FONT_SIZE;
  const root = document.documentElement;
  const size = Number.parseFloat(getComputedStyle(root).getPropertyValue('--rtx-ui-font-size'));
  return Number.isFinite(size) && size > 0 ? size : CHART_AXIS_FONT_SIZE;
};

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

const buildChartTheme = (colors: ChartColorPalette, showGrid: boolean, useReferenceLightSurface = false): TradingViewChartTheme => {
  const candleUp = colors.bullCandle || colors.barUp || '#089981';
  const candleDown = colors.bearCandle || colors.barDown || '#f23645';
  const barUp = colors.barUp || candleUp;
  const barDown = colors.barDown || candleDown;
  const line = colors.lineChart || '#2962ff';
  const rawGrid = colors.grid || 'rgba(120, 144, 156, 0.28)';
  const backgroundLuminance = getColorLuminance(colors.background) ?? 0;
  const backgroundIsDark = backgroundLuminance < 0.45;
  const gridLines = getChartGridLineColors({
    background: colors.background || '#0e0e12',
    grid: rawGrid,
    showGrid,
    preserveConfiguredColor: useReferenceLightSurface,
  });

  return {
    background: colors.background || '#0e0e12',
    text: colors.foreground || '#ffffff',
    axisText: backgroundIsDark
      ? colorWithAlpha(colors.foreground, 0.72, 'rgba(226, 232, 240, 0.72)')
      : (colors.foreground || '#25313c'),
    gridVertical: gridLines.vertical,
    gridHorizontal: gridLines.horizontal,
    scaleBorder: useReferenceLightSurface ? 'transparent' : colorWithAlpha(colors.foreground, 0.24, 'rgba(255, 255, 255, 0.24)'),
    crosshair: useReferenceLightSurface ? '#64748b' : colorWithAlpha(colors.foreground, 0.58, 'rgba(255, 255, 255, 0.58)'),
    candleUp,
    candleDown,
    barUp,
    barDown,
    wickUp: barUp,
    wickDown: barDown,
    line,
    areaTop: colorWithAlpha(line, 0.22, 'rgba(41, 98, 255, 0.22)'),
    areaBottom: colorWithAlpha(line, 0, 'rgba(41, 98, 255, 0)'),
    volumeUp: useReferenceLightSurface ? barUp : colorWithAlpha(barUp, 0.28, 'rgba(8, 153, 129, 0.28)'),
    volumeDown: useReferenceLightSurface ? barDown : colorWithAlpha(barDown, 0.28, 'rgba(242, 54, 69, 0.28)'),
  };
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
  entryExecutionTime: number;
  currentPrice: number;
  currentTime: number;
  sl?: number;
  tp?: number;
}

type ClosedTradeSnapshot = ClosedTradeOverlaySnapshot;

interface ChartDataRenderRequest {
  chartType?: ChartType;
  prependedBars?: number;
  resetVisibleRange?: boolean;
  suppressGlobalVisibleRangeReset?: boolean;
  releaseLivePaintAfterRender?: boolean;
  finishLoadingAfterRender?: boolean;
  immediate?: boolean;
  reason?: string;
}

interface PendingChartDataRender {
  selectionKey: string;
  chartType?: ChartType;
  prependedBars: number;
  resetVisibleRange: boolean;
  suppressGlobalVisibleRangeReset: boolean;
  releaseLivePaintAfterRender: boolean;
  finishLoadingAfterRender: boolean;
  reason: string;
}

interface OverlayNodeData {
  kind: 'horizontal-line' | 'price-badge' | 'price-hit-area' | 'segment' | 'marker';
  price?: number;
  time?: number;
  endPrice?: number;
  endTime?: number;
  markerSide?: TradeSide;
  /** Extra vertical shift (px) applied after the price coordinate for price-badge nodes. */
  pixelOffsetY?: number;
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
  getTitle?: () => string;
  getLabel?: () => string;
  labelVariant?: 'badge' | 'lineText' | 'none';
  lineColor?: string;
  lineWidthPx?: number;
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
  const seriesRef = useRef<ISeriesApi<any> | null>(null);
  const volumeRef = useRef<ISeriesApi<any> | null>(null);
  const squareGridHostSeriesRef = useRef<ISeriesApi<'Line'> | null>(null);
  const squareGridPrimitiveRef = useRef<SquareChartGridPrimitive | null>(null);
  const priceLineRef = useRef<any>(null); // Kept as 'any' as IPriceLine is not imported
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

  // Custom crosshair
  const [crosshairEnabled, setCrosshairEnabled] = useState(false);
  const crosshairEnabledRef = useRef(crosshairEnabled);
  crosshairEnabledRef.current = crosshairEnabled;

  useEffect(() => commandBus.subscribe('TOGGLE_CROSSHAIR', (payload) => {
    if (!isChartCommandTarget(payload)) return;
    setCrosshairEnabled((enabled) => !enabled);
  }), [isChartCommandTarget]);
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

  type LoadingPhase = 'connecting' | 'receiving' | 'ready' | 'hidden';
  const [loadingPhase, setLoadingPhase] = useState<LoadingPhase>('connecting');
  const [loadingMessageIdx, setLoadingMessageIdx] = useState(0);
  const loadingMessages = useMemo(() => (
    loadingPhase === 'connecting'
      ? [tr('Connecting to market data…')]
      : [
        `${symbol} ${activeTimeframe} · ${tr('Loading…')}`,
        tr('Aggregating M1 candles…'),
        tr('Preparing chart…'),
      ]
  ), [activeTimeframe, loadingPhase, symbol, tr]);
  const [showOneClick, setShowOneClick] = useState(
    initialChartSettingsSnapshot.symbolProperties[symbol]?.showQuickTradingButtons
    ?? initialChartSettingsSnapshot.globalProperties.showQuickTradingButtons,
  );
  const [apiError, setApiError] = useState<string | null>(null);
  // Inline text-input overlay for the text drawing tool (replaces browser prompt)
  const [textInputOverlay, setTextInputOverlay] = useState<{ x: number; y: number; time: number; price: number } | null>(null);
  const [textInputValue, setTextInputValue] = useState('');

  // ── Chart Context Menu state ──
  const [ctxMenu, setCtxMenu] = useState<{ visible: boolean; x: number; y: number }>({
    visible: false, x: 0, y: 0,
  });
  const [currentIndicators, setCurrentIndicators] = useState<IndicatorConfig[]>([]);
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

  const toggleOneClickTrading = useCallback(() => {
    setShowOneClick((current) => {
      const visible = !current;
      useChartSettingsStore.getState().updateSymbolProperty(symbol, 'showQuickTradingButtons', visible);
      return visible;
    });
  }, [symbol]);

  useEffect(() => {
    setLocalChartType(chartType);
  }, [chartType]);

  const [templateDialogOpen, setTemplateDialogOpen] = useState(false);
  const [templateDialogMode, setTemplateDialogMode] = useState<'save' | 'load'>('save');
  const [candlesLoadedRev, setCandlesLoadedRev] = useState(0);
  const marketDataReadySymbolRef = useRef<string | null>(null);

  const markCandlesReady = useCallback(() => {
    marketDataReadySymbolRef.current = symbol;
    setApiError(null);
    setLoadingPhase(prev => (prev === 'connecting' || prev === 'receiving' ? 'ready' : prev));
  }, [symbol]);

  const candlesRef = useRef<Candle[]>([]);
  const currentCandleRef = useRef<Candle | null>(null);
  dataWindowReaderRef.current = () => {
    const hoverTime = dataWindowHoverTimeRef.current;
    const candle = hoverTime === null ? (currentCandleRef.current ?? candlesRef.current.at(-1) ?? null) :
      candlesRef.current.find(item => item.time === hoverTime) ?? currentCandleRef.current;
    return createChartDataSnapshot(candle, symbol, activeTimeframe, resolvedPriceDigitsRef.current, brokerTimeOffsetSecRef.current);
  };
  useEffect(() => { dataWindowHoverTimeRef.current = null; }, [symbol, activeTimeframe, brokerAccountSessionScope]);

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

  // ── Live crosshair line DOM refs (no React state, direct DOM for 60fps) ──
  const crosshairLineRef = useRef<HTMLDivElement | null>(null);
  const crosshairBadgeRef = useRef<HTMLDivElement | null>(null);

  // ── Live current-price line + badge (permanent, like MT5 last-price indicator) ──
  const livePriceLineRef = useRef<HTMLDivElement | null>(null);
  const livePriceBadgeRef = useRef<HTMLDivElement | null>(null);
  const livePriceValueRef = useRef<HTMLSpanElement | null>(null);
  const livePriceCountdownRef = useRef<HTMLSpanElement | null>(null);
  const livePriceRef = useRef<number | null>(null);
  // Candles are the raw feed bid; the bid line shows the account's effective
  // (spread-markup widened) bid, this far below the forming candle's close.
  const liveBidMarkupOffsetRef = useRef(0);
  const livePriceScaleWidthRef = useRef<number | null>(null);
  const livePriceRepaintFrameRef = useRef<number | null>(null);
  const repaintTradeOverlayGeometryRef = useRef<() => void>(() => undefined);
  const livePriceOverlayColorsRef = useRef<LivePriceOverlayColors>(
    getLivePriceOverlayColors(defaultChartProperties.colors, defaultChartProperties.colors.bullCandle)
  );
  const livePriceColorPaletteRef = useRef<ChartColorPalette>(defaultChartProperties.colors);
  const lastLivePriceDirectionalColorRef = useRef(defaultChartProperties.colors.bullCandle);
  const useEnterpriseLightPricePaletteRef = useRef(false);
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
    paintLive: (_fullModelPainted: boolean) => undefined,
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

  const rememberVisibleLogicalRange = useCallback((range: LogicalRangeLike | null | undefined) => {
    if (!range || !Number.isFinite(range.from) || !Number.isFinite(range.to)) return;
    lastVisibleLogicalRangeRef.current = { from: range.from, to: range.to };
  }, []);

  const applyInitialVisibleLogicalRange = useCallback((
    chart: IChartApi,
    totalBars: number,
    activeTimeframe: Timeframe,
  ): boolean => {
    if (totalBars <= 0) return false;

    const visibleBars = computeAdaptiveVisibleBars(
      containerRef.current,
      chart,
      totalBars,
      getTradingChartDefaultVisibleBars(activeTimeframe),
    );
    if (visibleBars <= 0) return false;

    const initialRange = getTradingChartInitialLogicalRange({
      timeframe: activeTimeframe,
      totalBars,
      adaptiveVisibleBars: visibleBars,
    });
    if (!initialRange) return false;

    const timeScale = chart.timeScale();
    timeScale.setVisibleLogicalRange(initialRange);
    rememberVisibleLogicalRange(initialRange);

    // Range changes are applied on the chart's next frame. Capture the baseline
    // from the live scale at the first zoom command, after this reset settles.
    useChartZoomStore.getState().clearContext(drawingRuntimeContextRef.current.contextId);

    return true;
  }, [rememberVisibleLogicalRange]);

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
        refreshLightweightChartSurface(chart, offsetWidth, offsetHeight);
      }
    }

    flushTradeOverlay();
  }, [flushTradeOverlay]);

  const hideLivePriceOverlay = useCallback((clearPrice = true) => {
    if (clearPrice) {
      livePriceRef.current = null;
      livePriceScaleWidthRef.current = null;
    }
    if (livePriceRepaintFrameRef.current !== null && typeof window !== 'undefined') {
      window.cancelAnimationFrame(livePriceRepaintFrameRef.current);
      livePriceRepaintFrameRef.current = null;
    }
    if (livePriceLineRef.current) {
      livePriceLineRef.current.style.display = 'none';
      livePriceLineRef.current.style.top = '-9999px';
    }
    if (livePriceBadgeRef.current) {
      livePriceBadgeRef.current.style.display = 'none';
      livePriceBadgeRef.current.style.top = '-9999px';
      if (clearPrice && livePriceValueRef.current) livePriceValueRef.current.textContent = '';
    }
    if (livePriceCountdownRef.current) {
      livePriceCountdownRef.current.textContent = '';
      livePriceCountdownRef.current.style.display = 'none';
    }
  }, []);

  const syncSupplementalPriceLines = useCallback((askPrice: number, lastPrice: number) => {
    const series = seriesRef.current;
    if (!series) return;

    const settings = chartSettingsRef.current;
    const syncLine = (
      lineRef: React.MutableRefObject<IPriceLine | null>,
      visible: boolean,
      price: number,
      color: string,
      title: string,
    ) => {
      if (!visible || !Number.isFinite(price) || price <= 0) {
        try {
          lineRef.current?.applyOptions({ lineVisible: false, axisLabelVisible: false });
        } catch {
          lineRef.current = null;
        }
        return;
      }

      const options = {
        price,
        color,
        lineWidth: 1 as const,
        lineStyle: LineStyle.Dashed,
        lineVisible: true,
        axisLabelVisible: true,
        title,
      };

      try {
        if (!lineRef.current) {
          lineRef.current = series.createPriceLine(options);
        } else {
          lineRef.current.applyOptions(options);
        }
      } catch {
        lineRef.current = null;
      }
    };

    syncLine(
      askPriceLineRef,
      settings.showAskPriceLine,
      askPrice,
      settings.colors.askPriceLine,
      'ASK',
    );
    syncLine(
      lastPriceLineRef,
      settings.showLastPriceLine,
      lastPrice,
      settings.colors.lastPriceLine,
      'LAST',
    );
  }, []);

  const getLivePriceDirectionalColor = useCallback((
    activeCandleTime?: number,
    nextClose?: number,
  ): string => {
    const colors = livePriceColorPaletteRef.current;
    const currentCandle = currentCandleRef.current;
    const fallback = lastLivePriceDirectionalColorRef.current
      || getLivePriceSeriesColor(colors, chartType, 'up');
    if (!currentCandle || !Number.isFinite(currentCandle.open)) return fallback;
    if (activeCandleTime !== undefined && currentCandle.time !== activeCandleTime) return fallback;
    const close = nextClose ?? currentCandle.close;
    if (!Number.isFinite(close)) return fallback;

    const color = getLivePriceSeriesColor(
      colors,
      chartType,
      close >= currentCandle.open ? 'up' : 'down',
    );
    lastLivePriceDirectionalColorRef.current = color;
    return color;
  }, [chartType]);

  const applyStableLivePriceHorizontalGeometry = useCallback((measuredScaleWidth: number) => {
    const measuredWidth = Number.isFinite(measuredScaleWidth) && measuredScaleWidth > 0
      ? measuredScaleWidth
      : LIVE_PRICE_SCALE_WIDTH_FALLBACK_PX;
    const stableWidth = livePriceScaleWidthRef.current ?? measuredWidth;
    livePriceScaleWidthRef.current = stableWidth;

    const right = `${stableWidth}px`;
    const line = livePriceLineRef.current;
    const badge = livePriceBadgeRef.current;
    if (line && line.style.right !== right) line.style.right = right;
    if (badge && badge.style.width !== right) badge.style.width = right;
  }, []);

  const paintLivePriceOverlay = useCallback((
    livePrice: number,
    y: number,
    priceScaleWidth: number,
    activeCandleTime?: number,
    directionClose?: number,
  ) => {
    const line = livePriceLineRef.current;
    const badge = livePriceBadgeRef.current;
    if (!line || !badge) return;

    const digits = resolvedPriceDigitsRef.current;
    const overlayColors = getLivePriceOverlayColors(
      livePriceColorPaletteRef.current,
      getLivePriceDirectionalColor(activeCandleTime, directionClose),
      useEnterpriseLightPricePaletteRef.current,
    );
    livePriceOverlayColorsRef.current = overlayColors;

    line.style.top = `${y}px`;
    applyStableLivePriceHorizontalGeometry(priceScaleWidth);
    line.style.borderTopColor = overlayColors.lineColor;
    line.style.display = 'block';

    badge.style.top = `${y}px`;
    badge.style.background = overlayColors.badgeBackground;
    badge.style.color = overlayColors.badgeTextColor;
    if (livePriceValueRef.current) {
      livePriceValueRef.current.textContent = formatChartAxisPrice(livePrice, digits);
    }
    badge.style.display = 'block';
  }, [applyStableLivePriceHorizontalGeometry, getLivePriceDirectionalColor]);

  const repaintLivePriceOverlayFromCurrentPrice = useCallback((activeCandle: Candle) => {
    if (!chartSettingsRef.current.showBidPriceLine) {
      hideLivePriceOverlay(false);
      return;
    }
    const candleClose = Number(activeCandle.close);
    const bidMarkupOffset = liveBidMarkupOffsetRef.current;
    const livePrice = bidMarkupOffset > 0 && Number.isFinite(candleClose)
      ? roundPriceToDigits(candleClose - bidMarkupOffset, Math.max(resolvedPriceDigitsRef.current, 0))
      : candleClose;
    if (!Number.isFinite(livePrice) || !livePriceLineRef.current || !livePriceBadgeRef.current || !seriesRef.current) return;

    const paint = () => {
      if (isDisposedRef.current || !livePriceLineRef.current || !livePriceBadgeRef.current || !seriesRef.current) return;

      livePriceRef.current = livePrice;
      const y = seriesRef.current.priceToCoordinate(livePrice);
      if (y === null || y === undefined) {
        hideLivePriceOverlay(false);
        return;
      }

      const scaleW = seriesRef.current.priceScale().width();
      paintLivePriceOverlay(livePrice, y, scaleW, activeCandle.time, activeCandle.close);
    };

    paint();

    if (typeof window !== 'undefined') {
      if (livePriceRepaintFrameRef.current !== null) {
        window.cancelAnimationFrame(livePriceRepaintFrameRef.current);
      }
      livePriceRepaintFrameRef.current = window.requestAnimationFrame(() => {
        livePriceRepaintFrameRef.current = null;
        paint();
      });
    }
  }, [hideLivePriceOverlay, paintLivePriceOverlay]);

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
  const chartSettings = useChartSettingsStore(state =>
    state.symbolProperties[symbol] || state.globalProperties
  );
  const chartSettingsRef = useRef(chartSettings);

  useEffect(() => {
    chartSettingsRef.current = chartSettings;
    setCtxShowTradeLevels(chartSettings.showTradeLevels);
    setCtxShowTradeHistory(chartSettings.showTradeHistory);
    setShowOneClick(chartSettings.showQuickTradingButtons);
  }, [chartSettings]);

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
  }, [chartSettings, updateLegendDOM]);

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

  const chartColors = useMemo(
    () => getEffectiveChartColors(chartSettings, { isAdvancedUntitledLight }),
    [chartSettings, isAdvancedUntitledLight],
  );
  const useEnterpriseLightChartPalette = isAdvancedUntitledLight && chartSettings.colorScheme !== 'Custom';
  useEnterpriseLightPricePaletteRef.current = useEnterpriseLightChartPalette;
  const initialLivePriceOverlayColors = useMemo(
    () => getLivePriceOverlayColors(
      chartColors,
      getLivePriceSeriesColor(chartColors, chartType, 'up'),
      useEnterpriseLightChartPalette,
    ),
    [chartColors, chartType, useEnterpriseLightChartPalette],
  );
  const chartTheme = useMemo(
    () => buildChartTheme(chartColors, chartSettings.showGrid, isAdvancedUntitledLight && chartSettings.colorScheme !== 'Custom'),
    [chartColors, chartSettings.showGrid, chartSettings.colorScheme, isAdvancedUntitledLight],
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
  }, [chartColors, chartType, getLivePriceDirectionalColor, useEnterpriseLightChartPalette]);

  useEffect(() => {
    chartThemeRef.current = chartTheme;
  }, [chartTheme]);

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
  }, [getCachedRenderedPriceReference, resolveCurrentQuote, symbol, timeframe]);

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
      drawingManager.renderAll();
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
        drawingManager.renderAll();
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
        chartSelectionPresentationRef.current = releaseChartSelectionLivePaint(
          chartSelectionPresentationRef.current,
          pending.selectionKey,
        );
        markCandlesReady();
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
  }, [applyInitialVisibleLogicalRange, getCandlesForFullRender, getClosedMarketRenderCandles, markCandlesReady, rememberVisibleLogicalRange, scheduleDrawingRenderAfterChartData, schedulePeriodSeparatorRender, scrollToLatestCandleNow, suppressVisibleRangeHistoryLoad, symbol, syncLeftVisibleTime, timeframe]);

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
      reason: request.reason ?? existing?.reason ?? 'chart-data',
    };

    if (isChartInteractionActiveRef.current) {
      postInteractionCoordinatorRef.current?.request({ model: true });
      return;
    }

    scheduleQueuedChartRenderFlush(request.immediate === true);
  }, [scheduleQueuedChartRenderFlush]);

  useLayoutEffect(() => {
    const nextGate = selectChartPresentation(
      chartSelectionPresentationRef.current,
      chartSelectionPresentationKey,
    );
    if (nextGate === chartSelectionPresentationRef.current) return;

    // Close the previous selection before normal effects (including the live
    // tick loop) run. The loading surface therefore covers the switch from the
    // first committed frame, and an already queued old-symbol RAF cannot paint.
    chartSelectionPresentationRef.current = nextGate;
    initialHistoryLoadSequenceRef.current += 1;
    initialHistoryLoadPendingRef.current = true;
    historyRequestCoordinatorRef.current.abort();
    cancelQueuedChartRender();
    postInteractionCoordinatorRef.current?.clear();
    hideLivePriceOverlay();
    setLoadingPhase('connecting');
  }, [
    cancelQueuedChartRender,
    chartSelectionPresentationKey,
    hideLivePriceOverlay,
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

    const chart = createChart(containerRef.current, {
      autoSize: true,
      layout: {
        background: { type: ColorType.Solid, color: chartTheme.background },
        textColor: chartTheme.axisText,
        fontFamily: isAdvancedUntitledLight ? LIGHT_CHART_AXIS_FONT_FAMILY : CHART_AXIS_FONT_FAMILY,
        fontSize: chartAxisFontSize,
        attributionLogo: false,
      },
      // A bottom-layer series primitive draws the square grid. Native X/Y tick
      // grids are disabled because their independently calculated spacing makes
      // rectangular cells and would double-paint the custom lattice.
      grid: {
        vertLines: {
          color: chartTheme.gridVertical,
          style: LineStyle.Solid,
          visible: false,
        },
        horzLines: {
          color: chartTheme.gridHorizontal,
          style: LineStyle.Solid,
          visible: false,
        },
      },
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
      },
    });

    chartRef.current = chart;
    // The host has no data and paints no line. It only gives the grid primitive
    // a stable series lifecycle and the strict `bottom` layer below candles.
    const squareGridHostSeries = chart.addSeries(LineSeries, {
      visible: true,
      color: 'rgba(0, 0, 0, 0)',
      priceScaleId: '',
      priceLineVisible: false,
      lastValueVisible: false,
      crosshairMarkerVisible: false,
    });
    const squareGridPrimitive = new SquareChartGridPrimitive({
      visible: chartSettings.showGrid,
      cellSizeCssPx: SQUARE_CHART_GRID_CELL_SIZE_PX,
      verticalColor: chartTheme.gridVertical,
      horizontalColor: chartTheme.gridHorizontal,
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
          shouldScrollToRealtime(chartRef.current, autoScrollEnabledRef.current, chartSettingsRef.current.chartAutoScroll)
        ) {
          chartRef.current.timeScale().scrollToRealTime();
        }
        autoScrollTimer = null;
      }, 3000); // 3 seconds after last interaction
    };
    settleAutoScrollPolicyRef.current = resetAutoScrollTimer;

    let heldChartPointerId: number | null = null;
    let rightPriceScalePointerId: number | null = null;
    let rightPriceScaleDragStartY: number | null = null;
    let rightPriceScaleDragStartRange: { from: number; to: number } | null = null;
    let priceBoundOverlayGeometryRepaintFrame: number | null = null;
    let wheelTimeScaleBarSpacingBefore: number | null = null;

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

    const captureChartWheelTimeScaleState = (event: WheelEvent) => {
      visibleRangeHistoryUserInitiatedRef.current = true;
      interactionOwnership.noteWheelActivity();
      wheelTimeScaleBarSpacingBefore = null;
      if (event.deltaY === 0 || !isChartPaneWheel(event)) return;

      const barSpacing = chart.timeScale().options().barSpacing;
      if (Number.isFinite(barSpacing) && barSpacing > 0) {
        wheelTimeScaleBarSpacingBefore = barSpacing;
      }
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
        applyStableLivePriceHorizontalGeometry(scaleWidth);
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
        if (drawingRenderFrameRef.current === null && drawingRenderSettledFrameRef.current === null) {
          const drawingContext = drawingRuntimeContextRef.current;
          scheduleDrawingRenderAfterChartData(drawingContext.symbol, drawingContext.timeframe as Timeframe);
        }
      });
    };

    const handlePointerInteractionStart = (event: PointerEvent) => {
      if (!interactionOwnership.beginPointer({
        pointerId: event.pointerId,
        button: event.button,
        isPrimary: event.isPrimary,
      })) return;
      heldChartPointerId = event.pointerId;
      rightPriceScalePointerId = isRightPriceScalePointer(event) ? event.pointerId : null;
      rightPriceScaleDragStartY = null;
      rightPriceScaleDragStartRange = null;
      if (rightPriceScalePointerId !== null) {
        // Anchor the MT5-style axis zoom on the range captured at press time.
        try {
          const startRange = chart.priceScale('right').getVisibleRange();
          const startFrom = Number(startRange?.from);
          const startTo = Number(startRange?.to);
          if (Number.isFinite(startFrom) && Number.isFinite(startTo) && startTo > startFrom) {
            rightPriceScaleDragStartY = event.clientY;
            rightPriceScaleDragStartRange = { from: startFrom, to: startTo };
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
      const barSpacingBefore = wheelTimeScaleBarSpacingBefore;
      wheelTimeScaleBarSpacingBefore = null;

      // Lightweight Charts already applies this wheel delta to the time scale.
      // Mirror its actual before/after scale factor on the price range so the
      // gesture changes both candle width and candle height. Reading the real
      // bar-spacing change also respects drawing locks and library zoom limits.
      if (event.deltaY === 0 || barSpacingBefore === null) return;

      const barSpacingAfter = chart.timeScale().options().barSpacing;
      if (
        !Number.isFinite(barSpacingAfter)
        || barSpacingAfter <= 0
        || Math.abs(barSpacingAfter - barSpacingBefore) < Number.EPSILON
      ) return;

      const priceScale = chart.priceScale('right');
      const visiblePriceRange = priceScale.getVisibleRange();
      const series = seriesRef.current;
      const surface = containerRef.current;
      if (!visiblePriceRange || !series || !surface) return;

      const from = Number(visiblePriceRange.from);
      const to = Number(visiblePriceRange.to);
      const span = to - from;
      if (!Number.isFinite(from) || !Number.isFinite(to) || !Number.isFinite(span) || span <= 0) return;

      const rect = surface.getBoundingClientRect();
      const rawPointerPrice = series.coordinateToPrice((event.clientY - rect.top) as any);
      const pointerPrice = rawPointerPrice === null ? null : Number(rawPointerPrice);
      const anchorPrice = pointerPrice !== null && Number.isFinite(pointerPrice)
        ? pointerPrice
        : from + span / 2;
      const minimumSpan = getMinimumVisiblePriceSpan();
      const nextSpan = Math.max(minimumSpan, span * (barSpacingBefore / barSpacingAfter));
      const priceSpanFactor = nextSpan / span;
      const nextFrom = anchorPrice + (from - anchorPrice) * priceSpanFactor;
      const nextTo = anchorPrice + (to - anchorPrice) * priceSpanFactor;
      if (!Number.isFinite(nextFrom) || !Number.isFinite(nextTo) || nextTo <= nextFrom) return;

      try {
        priceScale.setVisibleRange({ from: nextFrom, to: nextTo });
        queuePriceBoundOverlayGeometryRepaint();
      } catch {
        // The chart can be disposed between the wheel event and this update.
      }
    };

    const clearLocalChartPointerState = () => {
      heldChartPointerId = null;
      rightPriceScalePointerId = null;
      rightPriceScaleDragStartY = null;
      rightPriceScaleDragStartRange = null;
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
      chartContainer.addEventListener('wheel', captureChartWheelTimeScaleState, { passive: true, capture: true });
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
    const crosshairHandler = (param: any) => {
      dataWindowHoverTimeRef.current = typeof param.time === 'number' ? param.time : null;
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
      interactionOwnership.dispose();
      postInteractionCoordinatorRef.current?.clear();
      if (chartInteractionOwnershipRef.current === interactionOwnership) {
        chartInteractionOwnershipRef.current = null;
      }
      clearLocalChartPointerState();
      if (clearLocalChartPointerStateRef.current === clearLocalChartPointerState) {
        clearLocalChartPointerStateRef.current = () => undefined;
      }
      wheelTimeScaleBarSpacingBefore = null;
      if (priceBoundOverlayGeometryRepaintFrame !== null) {
        window.cancelAnimationFrame(priceBoundOverlayGeometryRepaintFrame);
        priceBoundOverlayGeometryRepaintFrame = null;
      }
      if (chartContainer) {
        chartContainer.removeEventListener('pointerdown', handlePointerInteractionStart, true);
        chartContainer.removeEventListener('lostpointercapture', handleLostPointerCapture);
        chartContainer.removeEventListener('pointerleave', interactionOwnership.notePointerLeave);
        chartContainer.removeEventListener('touchstart', handleTouchInteractionStart, true);
        chartContainer.removeEventListener('wheel', captureChartWheelTimeScaleState, true);
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

  const buildHistoryCacheTarget = useCallback((activeTf: Timeframe): { key: CandleCacheKey; metadata: CandleCacheMetadata } => {
    const apiTimeframe = chartDataService.normalizeTimeframe(activeTf);
    const metadata: CandleCacheMetadata = {
      scope: chartDataService.getCandleCacheScope(),
      symbol,
      timeframe: apiTimeframe,
      limit: getInitialHistoryCount(activeTf),
    };
    return {
      key: candleCache.createKey(metadata),
      metadata,
    };
  }, [symbol]);

  const setHistoryCache = useCallback((
    activeTf: Timeframe,
    candles: Candle[],
    brokerOffsetSeconds = brokerTimeOffsetSecRef.current,
    source: CandleCacheSource = 'backend',
  ) => {
    if (!symbol || candles.length === 0) return;
    const { key, metadata } = buildHistoryCacheTarget(activeTf);
    candleCache.setLatest(key, candles, { ...metadata, brokerOffsetSeconds, source });
  }, [buildHistoryCacheTarget, symbol]);

  const mergeHistoryCache = useCallback((
    activeTf: Timeframe,
    candles: Candle[],
    brokerOffsetSeconds = brokerTimeOffsetSecRef.current,
    source: CandleCacheSource = 'backend',
  ) => {
    if (!symbol || candles.length === 0) return;
    const { key, metadata } = buildHistoryCacheTarget(activeTf);
    candleCache.mergeLatest(key, candles, { ...metadata, brokerOffsetSeconds, source });
  }, [buildHistoryCacheTarget, symbol]);

  const hydrateHistoryFromCache = useCallback((activeTf: Timeframe, reason: string): boolean => {
    if (!symbol) return false;
    const { key, metadata } = buildHistoryCacheTarget(activeTf);
    let cached = candleCache.getLatest(key);

    if ((!cached || cached.candles.length === 0) && activeTf !== 'M1') {
      const retainedM1Candles = candleAggregationService.getCandles(symbol, 'M1', true, false);
      if (retainedM1Candles.length > 0) {
        const reusableWarmCandles = getValidSortedCandles(
          omitPartialLeadingM1Aggregate(
            candleAggregationService.getCandles(symbol, activeTf as AggTimeframe, true, false),
            retainedM1Candles[0]?.time,
            activeTf as AggTimeframe,
            brokerTimeOffsetSecRef.current,
          ).map(candle => ({ ...candle, tickVolume: candle.volume })) as Candle[],
        );
        if (reusableWarmCandles.length > 0) {
          cached = candleCache.setLatest(key, reusableWarmCandles, {
            ...metadata,
            brokerOffsetSeconds: brokerTimeOffsetSecRef.current,
            source: 'derived-m1',
          });
        }
      }
    }
    if (!cached || cached.candles.length === 0) return false;

    const candles = getValidSortedCandles(cached.candles as Candle[]);
    if (candles.length === 0) return false;

    cancelQueuedChartRender();
    currentCandleRef.current = null;
    prevPriceRef.current = null;
    renderedPriceReferenceRef.current = createRenderedPriceReference([]);
    periodSeparatorsRef.current = [];
    firstRenderedCandleTimeRef.current = null;
    lastRenderedCandlesRef.current = [];
    clearPeriodSeparators();
    resetVisibleRangeOnNextDataRef.current = true;
    lastVisibleLogicalRangeRef.current = null;
    hasReachedBeginningRef.current = false;
    isLoadingMoreRef.current = false;
    lastStoreCandleSecRef.current = 0;

    candlesRef.current = candles;
    renderedPriceReferenceRef.current = createRenderedPriceReference(candles);
    hasDisplayedHistoryRef.current = candles.length > 1;
    protectedDisplayedHistoryRef.current = candles.length > 1 ? candles : [];
    // FIX: Cache metadata cannot prove a broker offset and older entries may
    // contain the former wall-clock guess. Reuse only the currently explicit
    // runtime offset (zero for the present UTC backend contract).
    const explicitBrokerOffsetSeconds = brokerTimeOffsetSecRef.current;
    reloadAggregationCandles(candles, activeTf, explicitBrokerOffsetSeconds);

    updateChartData(candles, undefined, {
      immediate: true,
      resetVisibleRange: true,
      finishLoadingAfterRender: true,
      reason,
    });

    const last = getLatestRenderableCandle(candles);
    if (last) {
      const normalizedTime = getTimeframePeriodSeconds(
        last.time,
        activeTf as AggTimeframe,
        explicitBrokerOffsetSeconds,
      )?.startTime ?? last.time;
      currentCandleRef.current = { ...last, time: normalizedTime };
      updateLegendDOM(last.open, last.high, last.low, last.close, getDisplayVolume(last, chartSettingsRef.current));
      if (activeTf === 'M1' && normalizedTime > lastStoreCandleSecRef.current) {
        lastStoreCandleSecRef.current = normalizedTime;
      }
      prevPriceRef.current = last.close;
      scheduleBoundaryTimerRef.current?.();
    }

    setApiError(null);
    return true;
  }, [buildHistoryCacheTarget, cancelQueuedChartRender, clearPeriodSeparators, getLatestRenderableCandle, reloadAggregationCandles, symbol, updateChartData, updateLegendDOM]);

  const restoreProtectedDisplayedHistory = useCallback((activeTf: Timeframe, reason: string): boolean => {
    const protectedHistory = protectedDisplayedHistoryRef.current.length > 1
      ? protectedDisplayedHistoryRef.current
      : candlesRef.current;
    if (protectedHistory.length <= 1) return false;

    const restoredCandles = mergeCandleCollections(
      protectedHistory,
      candlesRef.current,
      currentCandleRef.current ? [currentCandleRef.current] : [],
    );
    if (restoredCandles.length <= 1) return false;

    console.warn(`[Chart] Keeping protected ${symbol} ${activeTf} history after ${reason}.`);
    candlesRef.current = restoredCandles;
    renderedPriceReferenceRef.current = createRenderedPriceReference(restoredCandles);
    hasDisplayedHistoryRef.current = true;
    protectedDisplayedHistoryRef.current = restoredCandles;
    reloadAggregationCandles(restoredCandles, activeTf);
    updateChartData(restoredCandles, undefined, {
      immediate: true,
      resetVisibleRange: false,
      finishLoadingAfterRender: true,
      reason: `restore-protected-history:${reason}`,
    });
    return true;
  }, [reloadAggregationCandles, symbol, updateChartData]);

  const fetchOlderHistoryPage = useCallback(async (
    activeTf: Timeframe,
    olderThanRaw: number,
    signal?: AbortSignal,
  ): Promise<ChartHistoryPage> => {
    const result = await fetchChartOlderHistoryPage({
      symbol,
      timeframe: activeTf,
      olderThanRaw,
      signal,
      pageSize: getHistoryPageSize(activeTf),
      timeframeSeconds: getTimeframeSeconds(activeTf as AggTimeframe),
      yieldBetweenPages: waitForProgressiveHistoryIdleTurn,
    });

    if (result.usedRangeFallback) {
      console.log(`[Chart] Range fallback loaded ${result.candles.length} older candles for ${symbol} ${activeTf} before ${olderThanRaw}`);
    }

    if (result.usedDerivedFallback) {
      console.log(
        `[Chart] Derived ${result.candles.length} ${activeTf} candles for ${symbol} from M1 ` +
        `before ${olderThanRaw} in ${Math.max(0, result.attempts - 1)} M1 page(s)`
      );
    }

    return {
      candles: result.candles as Candle[],
      source: result.source,
    };
  }, [symbol]);

  const validateRenderedCandlesAgainstLivePrice = useCallback((price: number, activeTf: Timeframe): boolean => {
    const candles = candlesRef.current;
    if (candles.length === 0) return true;

    const reference = getCachedRenderedPriceReference();
    if (isPriceCompatibleWithReference(price, reference)) return true;

    // FIX: Never rewrite already rendered backend OHLC to make a delayed quote
    // appear compatible. Keep the exact broker values and reject the mismatched
    // event until the symbol/session feeds agree.
    console.warn(
      `[Chart] Ignoring ${symbol} ${activeTf} live price ${price}; `
      + `it is incompatible with exact backend candle reference ${reference.price}.`,
    );
    return false;
  }, [getCachedRenderedPriceReference, symbol]);

  // Load historical data
  const loadHistory = useCallback(async (selectedSymbol: string, selectedTimeframe: Timeframe) => {
    if (isDisposedRef.current || !selectedSymbol) {
      console.log('[Chart] Cannot load history - symbol not set or chart disposed');
      return;
    }

    setApiError(null);
    resetLiveQuotePriceGuard();
    const initialHistoryLoadSequence = initialHistoryLoadSequenceRef.current + 1;
    initialHistoryLoadSequenceRef.current = initialHistoryLoadSequence;
    initialHistoryLoadPendingRef.current = true;
    const activeTf = selectedTimeframe;
    console.log(`[Chart] Loading history for ${selectedSymbol}, timeframe: ${activeTf}`);

    try {
      const deriveInitialHistoryFromM1 = isM1DerivedFallbackTimeframe(activeTf);
      let historySource: CandleCacheSource = deriveInitialHistoryFromM1 ? 'derived-m1' : 'backend';
      let derivedInitialHistory: Awaited<ReturnType<typeof fetchDerivedTimeframeCandlesFromM1>> | null = null;

      // Paint any exact session cache (including M1-derived warm aggregates)
      // before starting new broker history work. This keeps timeframe clicks
      // responsive even when a refresh request is comparatively slow.
      historyRequestCoordinatorRef.current.abort();
      const hydratedFromCache = hydrateHistoryFromCache(activeTf, 'cached-history');
      if (!hydratedFromCache) {
        setLoadingPhase('receiving');
      }
      const liveCandleGenerationAtRequestStart = liveCandleMutationGenerationRef.current;
      const useProgressiveInitialHistory = activeTf === 'M1' && !hydratedFromCache;

      const historyRequest = historyRequestCoordinatorRef.current.start({
        symbol: selectedSymbol,
        timeframe: activeTf,
        count: useProgressiveInitialHistory ? FIRST_PAINT_HISTORY_COUNT : getInitialHistoryCount(activeTf),
      }, async options => {
        if (!deriveInitialHistoryFromM1) {
          return chartDataService.fetchCandles(options);
        }

        derivedInitialHistory = await fetchDerivedTimeframeCandlesFromM1({
          symbol: selectedSymbol,
          targetTimeframe: activeTf,
          signal: options.signal,
          targetCandleLimit: getDerivedM1InitialTargetCandleLimit(activeTf),
          maxM1Pages: 1,
          includeM1Candles: true,
          yieldBetweenPages: waitForProgressiveHistoryIdleTurn,
        });
        if (derivedInitialHistory.candles.length > 0 || options.signal?.aborted) {
          return derivedInitialHistory.candles;
        }

        // Compatibility fallback for brokers that expose a target timeframe
        // but no M1 history. Normal operation always takes the M1-derived path.
        historySource = 'backend';
        return chartDataService.fetchCandles(options);
      });
      const isCurrentHistoryLoad = () => (
        !isDisposedRef.current && historyRequest.isCurrent()
      );
      hasReachedBeginningRef.current = false;
      isLoadingMoreRef.current = false;
      historyBackfillDiagnosticsRef.current = createChartHistoryBackfillDiagnostics();

      let candles: Candle[] = await historyRequest.result;

      if (!isCurrentHistoryLoad()) return;

      candles = getValidSortedCandles(candles);
      const receivedHistoryCount = candles.length;
      if (derivedInitialHistory) {
        console.log(
          `[Chart] M1-derived initial history produced ${derivedInitialHistory.candles.length} ${activeTf} candles for ${selectedSymbol} ` +
          `(m1Candles=${derivedInitialHistory.m1CandlesFetched}, pages=${derivedInitialHistory.pagesFetched}, ` +
          `reachedBeginning=${derivedInitialHistory.reachedBeginning})`
        );
      }
      console.log(`[Chart] Received initial ${receivedHistoryCount} candles from ${historySource}`);

      // If API returns empty candles, initialize series so live ticks can build candles
      if (candles.length === 0) {
        if (hydratedFromCache) {
          console.warn(`[Chart] Keeping cached ${selectedSymbol} ${activeTf} history after empty refresh response.`);
          return;
        }
        if (restoreProtectedDisplayedHistory(activeTf, 'empty-history-reload')) {
          return;
        }
        if (activeTf === 'M1') {
          console.warn(`[Chart] Ignoring empty ${selectedSymbol} ${activeTf} history response to avoid replacing displayed history with a tiny live cluster.`);
          setLoadingPhase('receiving');
          return;
        }

        console.log(`[Chart] No historical candles for ${selectedSymbol} ${activeTf} — live-only mode`);
        resetEmptyHistoryState(activeTf);
        if (seriesRef.current) seriesRef.current.setData([]);
        if (volumeRef.current) volumeRef.current.setData([]);
        if (chartRef.current) chartRef.current.timeScale().scrollToRealTime();

        // Wait for the very first live tick to establish the true broker boundary.
        // DO NOT seed `currentCandleRef` using `Date.now()` here, because if the
        // PC clock is faster than the MT5 broker, all incoming ticks will be trapped
        // in the 'future' candle and the chart will never rollover (infinite volume bug).
        console.warn(`[Chart] No history for ${selectedSymbol} on ${activeTf} — live-only mode (waiting for first live tick)`);
        // Keep overlay up; advance phase so users see "Receiving candles…" instead of
        // a single live-tick candle behind a dismissed loader.
        setLoadingPhase('receiving');
        return;
      }

      candles = reconcileCandlesWithLiveQuote(candles, 'history');

      if (candles.length === 0) {
        if (hydratedFromCache) {
          console.warn(`[Chart] Keeping cached ${selectedSymbol} ${activeTf} history after rejected refresh response.`);
          return;
        }
        if (restoreProtectedDisplayedHistory(activeTf, 'rejected-history-reload')) {
          return;
        }
        if (activeTf === 'M1') {
          console.warn(`[Chart] Ignoring rejected ${selectedSymbol} ${activeTf} history response to avoid replacing displayed history with a tiny live cluster.`);
          setLoadingPhase('receiving');
          return;
        }

        resetEmptyHistoryState(activeTf);
        if (seriesRef.current) seriesRef.current.setData([]);
        if (volumeRef.current) volumeRef.current.setData([]);
        setLoadingPhase('receiving');
        return;
      }

      // FIX: Keep backend Unix timestamps unchanged. Comparing the last candle
      // with Date.now() and snapping the difference to 30-minute increments
      // shifted valid future/test sessions and made REST and stream buckets diverge.
      // A non-zero offset may only come from an explicit broker contract.
      const explicitBrokerOffsetSeconds = brokerTimeOffsetSecRef.current;

      const protectedHistory = protectedDisplayedHistoryRef.current;
      const shouldPreserveProtectedHistory = (
        hasDisplayedHistoryRef.current &&
        protectedHistory.length > candles.length &&
        candles.length < getTradingChartDefaultVisibleBars(activeTf)
      );

      // A cold symbol switch can receive multiple live ticks (and even a
      // rollover) while REST history is still in flight. Join those buffered
      // candles into the historical baseline before the first visible setData:
      // history keeps the true bucket open/range and live keeps the latest close.
      const bufferedLiveCandles = liveCandleMutationGenerationRef.current > liveCandleGenerationAtRequestStart
        ? selectCandlesMutatedAfterGeneration(mergeCandleCollections(
          candlesRef.current,
          currentCandleRef.current ? [currentCandleRef.current] : [],
        ), liveCandleMutationGenerationByTimeRef.current, liveCandleGenerationAtRequestStart)
        : [];
      const retainedHistory = shouldPreserveProtectedHistory ? protectedHistory : candlesRef.current;
      candles = mergeAuthoritativeCandleHistory(retainedHistory, candles);
      if (bufferedLiveCandles.length > 0) {
        // FIX: Replace the backend-covered range first, then overlay only ticks
        // mutated after the request began; explicit backend finals still win.
        candles = mergeHistoricalCandlesWithBufferedLive(candles, bufferedLiveCandles);
      }

      candlesRef.current = candles;
      renderedPriceReferenceRef.current = createRenderedPriceReference(candles);
      if (candles.length > 1) {
        hasDisplayedHistoryRef.current = true;
        if (candles.length >= protectedDisplayedHistoryRef.current.length) {
          protectedDisplayedHistoryRef.current = candles;
        }
      }

      // Seed the live builder with the same M1 rows that produced the displayed
      // higher timeframe. This keeps historical aggregation and live rollover
      // on one M1-based state machine instead of seeding it with native H1/D1 bars.
      const derivedM1Seed = historySource === 'derived-m1' && derivedInitialHistory
        ? derivedInitialHistory.m1Candles.map(candle => ({
          ...candle,
          time: candle.time - explicitBrokerOffsetSeconds,
        }))
        : [];
      const aggregationSeedTimeframe = derivedM1Seed.length > 0 ? 'M1' : activeTf;
      const aggregationSeedCandles = derivedM1Seed.length > 0 ? derivedM1Seed : candles;
      const ohlcvCandles: OHLCV[] = formatHistoryForOhlcv(aggregationSeedCandles);
      candleAggregationService.loadHistoricalCandles(
        selectedSymbol,
        aggregationSeedTimeframe as AggTimeframe,
        ohlcvCandles,
        explicitBrokerOffsetSeconds,
      );

      // One exact M1 seed can satisfy later timeframe clicks without another
      // network round trip. Fill only missing derived-frame caches, preserving
      // any richer entry that this session already fetched.
      const warmOtherTimeframeCaches = () => {
        if (aggregationSeedTimeframe !== 'M1') return;
        const oldestSeedTime = activeTf === 'M1' ? candlesRef.current[0]?.time : ohlcvCandles[0]?.time;
        for (const targetTf of CANDLE_TIMEFRAMES) {
          if (targetTf === 'M1' || targetTf === activeTf) continue;
          const { key: warmCacheKey } = buildHistoryCacheTarget(targetTf as Timeframe);
          const existingWarmCache = candleCache.getLatest(warmCacheKey);

          const reusableAggregates = omitPartialLeadingM1Aggregate(
            candleAggregationService.getCandles(selectedSymbol, targetTf, true, false),
            oldestSeedTime,
            targetTf,
            explicitBrokerOffsetSeconds,
          );
          const warmCandles = getValidSortedCandles(
            reusableAggregates
              .map(candle => ({ ...candle, tickVolume: candle.volume })) as Candle[],
          );
          if (warmCandles.length > (existingWarmCache?.candles.length ?? 0)) {
            setHistoryCache(
              targetTf as Timeframe,
              warmCandles,
              explicitBrokerOffsetSeconds,
              'derived-m1',
            );
          }
        }
      };
      setHistoryCache(activeTf, candles, explicitBrokerOffsetSeconds, historySource);
      console.log(
        `[Chart] Loaded ${ohlcvCandles.length} ${aggregationSeedTimeframe} source candles into aggregation service ` +
        `for ${selectedSymbol} ${activeTf}`
      );

      // Update chart - live data
      setApiError(null);
      // A provisional live candle or short WS snapshot can paint before the
      // uncached REST response and consume the global one-shot viewport reset.
      // The first authoritative history render must still open at the latest
      // candles. A cached baseline already owns the viewport, so its background
      // refresh continues to preserve any user pan/zoom.
      const shouldResetVisibleRange = shouldResetInitialHistoryVisibleRange({
        resetVisibleRangeOnNextData: resetVisibleRangeOnNextDataRef.current,
        hydratedFromCache,
      });
      updateChartData(candles, undefined, {
        immediate: true,
        resetVisibleRange: shouldResetVisibleRange,
        finishLoadingAfterRender: true,
        reason: 'initial-history',
      });

      // Set current forming candle
      if (candles.length > 0) {
        const last = getLatestRenderableCandle(candles);

        // CRITICAL: normalize the forming candle's time to the TF boundary start.
        // The API may return a mid-minute timestamp (e.g. 10:30:45 instead of 10:30:00).
        // If we keep 10:30:45 as currentCandleRef.time, then expectedCandleTime (10:30:00)
        // is LESS than it, making the clockInterval condition (current < expected) FALSE:
        // the clock never fires and the forming candle never rolls over to a new bar.
        if (last) {
          const normalizedTime = getTimeframePeriodSeconds(
            last.time,
            activeTf as AggTimeframe,
            explicitBrokerOffsetSeconds,
          )?.startTime ?? last.time;

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
      }

      // Paint the initial viewport before warming other timeframes or fetching
      // deeper history. The same request owner cancels all follow-up work.
      {
        // Release the initial load and paint its authoritative baseline first.
        // Gap repair can require several network rounds; it is not a condition
        // for displaying the first page. The selection owner cancels this work
        // on logout, account change, symbol change, or timeframe change.
        void (async () => {
          await waitForProgressiveHistoryIdleTurn(historyRequest.signal);
          if (!isCurrentHistoryLoad()) return;
          warmOtherTimeframeCaches();
          if (activeTf !== 'M1' || candles.length < 2) return;

          const applyAdditionalHistory = (incoming: Candle[], reason: string): number => {
            const added = mergeMissingHistoryCandles(
              currentCandleRef.current
                ? upsertCandleIntoHistory(candlesRef.current, currentCandleRef.current).candles
                : candlesRef.current,
              reconcileCandlesWithLiveQuote(getValidSortedCandles(incoming), 'history'),
            );
            if (added.addedCount === 0) return 0;
            candlesRef.current = added.candles;
            protectedDisplayedHistoryRef.current = added.candles;
            renderedPriceReferenceRef.current = createRenderedPriceReference(added.candles);
            setHistoryCache(activeTf, added.candles, explicitBrokerOffsetSeconds, historySource);
            reloadAggregationCandles(added.candles, activeTf, explicitBrokerOffsetSeconds);
            requestChartDataRender({ resetVisibleRange: false, reason });
            return added.addedCount;
          };

          // The latest 500 bars fill the first viewport. Expand in the background
          // without replacing live buckets or changing the user's visible range.
          if (useProgressiveInitialHistory && receivedHistoryCount >= FIRST_PAINT_HISTORY_COUNT) {
            try {
              const extendedHistory = await chartDataService.fetchCandles({
                symbol: selectedSymbol,
                timeframe: activeTf,
                count: getInitialHistoryCount(activeTf),
                signal: historyRequest.signal,
              });
              if (!isCurrentHistoryLoad()) return;
              const addedCount = applyAdditionalHistory(extendedHistory, 'background-history-page');
              if (addedCount > 0) {
                warmOtherTimeframeCaches();
                console.info(`[Chart] Added ${addedCount} older ${selectedSymbol} candles after first paint.`);
              }
            } catch (error) {
              if (!isCurrentHistoryLoad()) return;
              console.warn('[Chart] Background history page failed; keeping visible candles:', error);
            }
          }

          const gapBackfill = await backfillRecentInteriorHistoryGaps({
            symbol: selectedSymbol,
            timeframe: activeTf,
            candles: candlesRef.current,
            signal: historyRequest.signal,
          });
          if (!isCurrentHistoryLoad() || gapBackfill.addedCandles === 0) return;

          const addedCount = applyAdditionalHistory(gapBackfill.candles as Candle[], 'background-history-gaps');
          if (addedCount > 0) {
            warmOtherTimeframeCaches();
            console.info(`[Chart] Filled ${addedCount} history gaps after first paint for ${selectedSymbol} ${activeTf}.`);
          }
        })().catch(error => {
          if (isCurrentHistoryLoad() && !isAbortError(error)) {
            console.warn('[Chart] Background history gap repair failed:', error);
          }
        });
      }
    } catch (err: unknown) {
      if (isAbortError(err)) return;
      console.warn('[Chart] Failed to load history:', err);
      // REST failed: keep the overlay up, but advance the label so users know
      // we're still waiting on the WS snapshot rather than stuck connecting.
      setLoadingPhase(prev => (prev === 'connecting' ? 'receiving' : prev));
    } finally {
      if (initialHistoryLoadSequenceRef.current === initialHistoryLoadSequence) {
        initialHistoryLoadPendingRef.current = false;

        // If history failed or was empty, reveal an already-buffered live
        // baseline now. On success this coalesces with the authoritative
        // initial-history render, so users never see the sparse viewport first.
        if (
          !isDisposedRef.current
          && (candlesRef.current.length > 0 || currentCandleRef.current !== null)
        ) {
          requestChartDataRender({
            immediate: true,
            finishLoadingAfterRender: true,
          });
        }
      }
    }
  }, [buildHistoryCacheTarget, getLatestRenderableCandle, hydrateHistoryFromCache, reconcileCandlesWithLiveQuote, reloadAggregationCandles, requestChartDataRender, resetEmptyHistoryState, resetLiveQuotePriceGuard, restoreProtectedDisplayedHistory, setHistoryCache, updateChartData]);

  // Fade the loading overlay out after candles arrive. 'ready' starts the CSS
  // opacity transition; after it finishes we unmount the overlay entirely.
  useActiveChartRuntimeEffect(visibleRuntime.interval, () => {
    if (loadingPhase !== 'ready') return;
    const timer = window.setTimeout(() => setLoadingPhase('hidden'), 180);
    return () => window.clearTimeout(timer);
  }, [loadingPhase]);

  // Rotate the loading status text every 2.5s while the overlay is up, so all
  // three honest progress messages are visible before the snapshot lands on a
  // typical cold start. Index resets the moment we go ready/hidden.
  useEffect(() => {
    if (!isActive) setLoadingMessageIdx(0);
  }, [isActive]);

  useEffect(() => {
    setLoadingMessageIdx(0);
  }, [activeTimeframe, loadingPhase, symbol]);

  useActiveChartRuntimeEffect(visibleRuntime.interval, () => {
    if (loadingPhase === 'ready' || loadingPhase === 'hidden' || loadingMessages.length <= 1) {
      setLoadingMessageIdx(0);
      return;
    }
    const interval = window.setInterval(() => {
      setLoadingMessageIdx(i => (i + 1) % loadingMessages.length);
    }, 2500);
    return () => window.clearInterval(interval);
  }, [loadingMessages.length, loadingPhase]);

  // Load more historical data (infinite scroll)
  const loadMoreHistory = useCallback(async () => {
    if (isDisposedRef.current || !symbol || isLoadingMoreRef.current || hasReachedBeginningRef.current) return;
    if (isVisibleRangeHistoryLoadSuppressed()) return;

    const oldestCandle = candlesRef.current[0];
    if (!oldestCandle) return;

    isLoadingMoreRef.current = true;
    const activeTf = prevTimeframeRef.current || timeframe;
    const signal = historyRequestCoordinatorRef.current.getActiveSignal();
    historyBackfillDiagnosticsRef.current = markHistoryBackfillStarted(
      historyBackfillDiagnosticsRef.current,
      oldestCandle.time + brokerTimeOffsetSec,
    );
    console.log(`[Chart] Infinite scroll: Fetching ${getHistoryPageSize(activeTf)} more candles before ${oldestCandle.time}`);

    try {
      const olderPage = await fetchOlderHistoryPage(
        activeTf,
        oldestCandle.time + brokerTimeOffsetSec,
        signal,
      );

      if (signal?.aborted) {
        historyBackfillDiagnosticsRef.current = markHistoryBackfillStopped(
          historyBackfillDiagnosticsRef.current,
          'aborted',
          hasReachedBeginningRef.current,
        );
        return;
      }

      if (olderPage.candles.length === 0) {
        console.log(`[Chart] Reached absolute beginning of chart history for ${symbol}`);
        hasReachedBeginningRef.current = true;
        historyBackfillDiagnosticsRef.current = markHistoryBackfillStopped(
          historyBackfillDiagnosticsRef.current,
          'empty-page',
          true,
        );
        return;
      }

      const adjustedOlderCandles = applyBrokerTimeOffset(
        selectOlderCandlesBeforeCursor(olderPage.candles, oldestCandle.time + brokerTimeOffsetSec) as Candle[],
        brokerTimeOffsetSec,
      );

      // Filter out overlapping candles
      const newCandles = adjustedOlderCandles.filter(c => c.time < oldestCandle.time);
      if (newCandles.length === 0) {
        hasReachedBeginningRef.current = true;
        historyBackfillDiagnosticsRef.current = markHistoryBackfillStopped(
          historyBackfillDiagnosticsRef.current,
          'cursor-stalled',
          true,
        );
        return;
      }

      console.log(`[Chart] Fetched ${newCandles.length} older candles`);

      // Filter out any candles with null/NaN OHLC values to prevent chart crashes
      const reconciledNewCandles = reconcileCandlesWithLiveQuote(newCandles, 'older history');
      const selectedOlderHistory = selectOlderHistoryCandlesForMerge(newCandles, reconciledNewCandles);
      if (selectedOlderHistory.candles.length === 0) {
        historyBackfillDiagnosticsRef.current = markHistoryBackfillStopped(
          historyBackfillDiagnosticsRef.current,
          'invalid-page',
          hasReachedBeginningRef.current,
        );
        console.warn(`[Chart] Ignoring ${symbol} older history batch because no valid candles were available.`);
        return;
      }
      const prependResult = prependCandleHistory(candlesRef.current, selectedOlderHistory.candles);
      candlesRef.current = prependResult.candles;
      historyBackfillDiagnosticsRef.current = markHistoryBackfillPageLoaded(
        historyBackfillDiagnosticsRef.current,
        prependResult.addedCount,
        candlesRef.current[0]?.time ?? null,
      );
      if (prependResult.addedCount > 0) {
        mergeHistoryCache(activeTf, selectedOlderHistory.candles, brokerTimeOffsetSec, olderPage.source);
        requestChartDataRender({
          prependedBars: prependResult.addedCount,
          resetVisibleRange: false,
          suppressGlobalVisibleRangeReset: true,
          immediate: true,
          reason: 'left-scroll-history',
        });
      }
      // We push strictly old candles so prepending isn't perfectly supported by the service,
      // but it mostly cares about building forward, so we can ignore adding historical prior to 0 here.

    } catch (err) {
      if (isAbortError(err)) {
        historyBackfillDiagnosticsRef.current = markHistoryBackfillStopped(
          historyBackfillDiagnosticsRef.current,
          'aborted',
          hasReachedBeginningRef.current,
        );
        return;
      }
      historyBackfillDiagnosticsRef.current = markHistoryBackfillError(
        historyBackfillDiagnosticsRef.current,
        err,
      );
      console.error('[Chart] Failed to load older history:', err);
    } finally {
      isLoadingMoreRef.current = false;
    }
  }, [brokerTimeOffsetSec, fetchOlderHistoryPage, isVisibleRangeHistoryLoadSuppressed, mergeHistoryCache, requestChartDataRender, symbol, timeframe, reconcileCandlesWithLiveQuote]);

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
      try { chartRef.current!.removeSeries(seriesRef.current); } catch { }
      seriesRef.current = null;
      askPriceLineRef.current = null;
      lastPriceLineRef.current = null;
    }
    if (volumeRef.current) {
      try { chartRef.current!.removeSeries(volumeRef.current); } catch { }
      volumeRef.current = null;
    }

    // Create new series
    const chart = chartRef.current;
    let series: ISeriesApi<any>;

    // Compute price format based on symbol
    const digits = resolvedPriceDigits;
    const minMove = resolvedPricePoint; // e.g. 0.01 for 2 digits, 0.00001 for 5
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
          lineWidth: 2,
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
      const c1 = ts.logicalToCoordinate((intBar + 1) as any);
      if (c0 === null || c1 === null) return intBar;
      const barWidth = c1 - c0;
      if (Math.abs(barWidth) < 0.5) return intBar;
      const fraction = (x - c0) / barWidth;
      return intBar + fraction;
    };
    let ignoreNextDrawingClick = false;
    let drawingMousePointerActive = false;
    const clickHandler = (param: any) => {
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
        );
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
            const barCenterX = logical !== null ? chart.timeScale().logicalToCoordinate(logical as any) : null;
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
          point: { x, y },
          time: chart.timeScale().coordinateToTime(x),
          sourceEvent: e,
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
        drawingManager.cancelDrawing(contextId);
      }
      continuousDrawingId = null;
    };
    window.addEventListener('pointerup', handlePointerUp);
    window.addEventListener('pointercancel', handlePointerCancel);

    const crosshairHandler = (param: any) => {
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
          );
        }

        if (time) {
          const price = seriesRef.current.coordinateToPrice(param.point.y);
          if (price !== null) {
            if (!bindDrawingManagerToChart()) return;

            if (isDrawingContinuous) {
              drawingManager.addPoint(
                time,
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
                const barCenterX = logical !== null ? chart.timeScale().logicalToCoordinate(logical as any) : null;
                const pixOff = barCenterX !== null ? rawX - barCenterX : 0;
                drawingManager.updatePreviewPointWithLogical(
                  time,
                  price,
                  pixOff,
                  contextId,
                );
              } else {
                drawingManager.updatePreviewPoint(
                  time,
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
        point: { x, y },
        time: chart.timeScale().coordinateToTime(x),
        sourceEvent: e,
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
    window.addEventListener('keydown', handleDrawingShiftChange);
    window.addEventListener('keyup', handleDrawingShiftChange);

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
    (chart as any)._cleanupDrawings = () => {
      chart.unsubscribeClick(clickHandler);
      chart.unsubscribeCrosshairMove(crosshairHandler);
      containerRef.current?.removeEventListener('pointermove', handleDrawingPointerMove);
      containerRef.current?.removeEventListener('pointerleave', handleDrawingPointerLeave);
      try { chart.timeScale().unsubscribeVisibleLogicalRangeChange(timeRangeHandler); } catch { }
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
      window.removeEventListener('keydown', handleDrawingShiftChange);
      window.removeEventListener('keyup', handleDrawingShiftChange);
    };

    // Re-render drawings on every zoom/pan so they stay pinned to the chart
    chart.timeScale().subscribeVisibleLogicalRangeChange(timeRangeHandler);

    isRebuildingRef.current = false; // Safe to resume ticks and resizes
  }, [cancelQueuedChartRender, chartType, symbol, resetLiveQuotePriceGuard, updateChartData, clearPeriodSeparators, hydrateHistoryFromCache, timeframe]); // Note: precision changes are hot-applied below; intentional omit chartSettings

  // The authorized instrument catalog can resolve after the chart mounts.
  // Hot-apply its precision without rebuilding the series or resetting data.
  useEffect(() => {
    if (isDisposedRef.current || !seriesRef.current) return;
    try {
      seriesRef.current.applyOptions({
        priceFormat: {
          type: 'price',
          precision: resolvedPriceDigits,
          minMove: resolvedPricePoint,
        },
      });
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
  }, [isChartCommandTarget]);

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
  }, [chartSettings.chartAutoScroll]);

  useEffect(() => {
    ctxChartShiftRef.current = chartSettings.chartShift;
    setCtxChartShift(chartSettings.chartShift);
  }, [chartSettings.chartShift]);

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
      } catch { }
    };
  }, [schedulePeriodSeparatorRender, syncLeftVisibleTime, timeframe, candlesLoadedRev]);

  // Watch chart settings and hot-apply to chart without unmounting
  useLayoutEffect(() => {
    if (!chartRef.current || isDisposedRef.current) return;
    const chart = chartRef.current;

    // Apply global layout and grid
    chart.applyOptions({
      layout: {
        background: { type: ColorType.Solid, color: chartTheme.background },
        textColor: chartTheme.axisText,
        fontFamily: isAdvancedUntitledLight ? LIGHT_CHART_AXIS_FONT_FAMILY : CHART_AXIS_FONT_FAMILY,
        fontSize: chartAxisFontSize,
      },
      grid: {
        vertLines: {
          color: chartTheme.gridVertical,
          style: LineStyle.Solid,
          visible: false,
        },
        horzLines: {
          color: chartTheme.gridHorizontal,
          style: LineStyle.Solid,
          visible: false,
        },
      },
      crosshair: {
        vertLine: { color: chartTheme.crosshair },
        horzLine: { color: chartTheme.crosshair },
      },
      handleScroll: TRADING_VIEW_HANDLE_SCROLL,
      handleScale: TRADING_VIEW_HANDLE_SCALE,
      rightPriceScale: {
        borderColor: chartTheme.scaleBorder,
        autoScale: !chartSettings.scaleFixOneToOne && getFixedChartPriceRange(chartSettings) === null,
        alignLabels: false,
      },
      timeScale: {
        ...TRADING_CHART_TIME_SCALE_LIVE_SHIFT_OPTIONS,
        borderColor: chartTheme.scaleBorder,
      },
    });

    squareGridPrimitiveRef.current?.applyOptions({
      visible: chartSettings.showGrid,
      cellSizeCssPx: SQUARE_CHART_GRID_CELL_SIZE_PX,
      verticalColor: chartTheme.gridVertical,
      horizontalColor: chartTheme.gridHorizontal,
    });

    const fixedPriceRange = getFixedChartPriceRange(chartSettings);
    if (fixedPriceRange) {
      try {
        chart.priceScale('right').setVisibleRange(fixedPriceRange);
      } catch {
        // The chart can be disposed during a rapid tab or symbol switch.
      }
    }

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
      } else if (chartType === 'line') {
        seriesRef.current.applyOptions({
          color: chartTheme.line,
        });
      } else if (chartType === 'area') {
        seriesRef.current.applyOptions({
          lineColor: chartTheme.line,
          topColor: chartTheme.areaTop,
          bottomColor: chartTheme.areaBottom,
        });
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
        requestChartDataRender({
          chartType: prevChartTypeRef.current || chartType,
          reason: 'volume-settings',
        });
      } else {
        volumeRef.current.setData([]);
        schedulePeriodSeparatorRender();
      }
      const current = currentCandleRef.current;
      if (current) {
        updateLegendDOM(current.open, current.high, current.low, current.close, getDisplayVolume(current, chartSettings));
      }
    }

    window.dispatchEvent(new CustomEvent('rtx:flush-trade-overlay'));
  }, [chartAxisFontSize, chartSettings, chartTheme, chartType, requestChartDataRender, schedulePeriodSeparatorRender, symbol, timeframe, updateLegendDOM]);

  useLayoutEffect(() => {
    if (previousAdvancedUntitledLightRef.current === isAdvancedUntitledLight) return;
    if (!isActive || isDisposedRef.current || !chartRef.current || !seriesRef.current) return;

    previousAdvancedUntitledLightRef.current = isAdvancedUntitledLight;
    return scheduleChartThemeTransition({
      refreshSurface: () => {
        refreshVisibleChartLayout();
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

    try { seriesRef.current?.setData([]); } catch { /* chart may be rebuilding */ }
    try { volumeRef.current?.setData([]); } catch { /* chart may be rebuilding */ }
    if (ohlcOpenRef.current) ohlcOpenRef.current.textContent = '';
    if (ohlcHighRef.current) ohlcHighRef.current.textContent = '';
    if (ohlcLowRef.current) ohlcLowRef.current.textContent = '';
    if (ohlcCloseRef.current) ohlcCloseRef.current.textContent = '';
    if (ohlcVolumeRef.current) ohlcVolumeRef.current.textContent = '';
    setLoadingPhase('connecting');
  }, [cancelQueuedChartRender, resetEmptyHistoryState, symbol]);

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

  // ─── Live tick subscription + candle rollover ─────────────────────────────
  useActiveChartRuntimeEffect(visibleRuntime.candle, () => {
    if (!isActive || !symbol) return;

    // FIX: Preserve the exact broker symbol through cache and tick routing.
    const normalizedSymbol = symbol.trim().toUpperCase();

    // ── State (local to this effect closure) ──────────────────────────────────
    let liveEffectClosed = false;
    let lastTickKey = '';          // dedup: ts+price
    let lastMarketGapSeriesRefreshTime: number | null = null;
    let pendingLiveChartPaint = false;
    let pendingLiveChartRequiresFullRender = false;
    let pendingLiveShouldScrollToRealtime = false;
    // FIX: Explicit backend finals seal only the matching displayed timeframe.
    // A single M1 timestamp must not freeze the containing M5/H1 candle after a
    // timeframe switch, while switching back to M1 still retains its seal.
    const finalizedCandleTimeByTimeframe = new Map<string, number>();

    const canPaintLiveChart = (allowDuringSettle = false): boolean => (
      isActiveRef.current
      && (allowDuringSettle || !isChartInteractionActiveRef.current)
      && !isDisposedRef.current
      && !isRebuildingRef.current
      && Boolean(seriesRef.current)
      && isChartSelectionLivePaintAllowed(
        chartSelectionPresentationRef.current,
        chartSelectionPresentationKey,
      )
    );

    const requestDeferredLivePaint = (
      requiresFullRender = false,
      shouldScrollToRealtime = false,
    ): void => {
      pendingLiveChartPaint = true;
      pendingLiveChartRequiresFullRender ||= requiresFullRender;
      pendingLiveShouldScrollToRealtime ||= shouldScrollToRealtime;
      postInteractionCoordinatorRef.current?.request({ live: true });
    };

    const repaintLivePriceOverlayOrDefer = (c: Candle): void => {
      if (!canPaintLiveChart()) {
        requestDeferredLivePaint();
        return;
      }
      repaintLivePriceOverlayFromCurrentPrice(c);
    };

    const refreshMarketGapSeriesForCandle = (c: Candle): boolean => {
      if (isDisposedRef.current || !seriesRef.current || !chartRef.current) {
        return false;
      }

      const activeSymbol = prevSymbolRef.current || symbol;
      const activeTf = prevTimeframeRef.current || timeframe;
      const marketGapOptions = {
        symbol: activeSymbol,
        timeframe: activeTf,
        brokerOffsetSeconds: brokerTimeOffsetSecRef.current,
      };
      const candlesForFormatting = upsertCandleIntoHistory(candlesRef.current, c).candles;
      if (!shouldRecomputeMarketGapSeparatorsForCandle(candlesForFormatting, c, marketGapOptions)) {
        return false;
      }
      if (lastMarketGapSeriesRefreshTime === c.time) {
        return false;
      }

      lastMarketGapSeriesRefreshTime = c.time;
      requestChartDataRender({
        reason: 'market-gap-refresh',
      });
      return true;
    };

    // ── pushCandleToChart ──────────────────────────────────────────────────────
    // Pushes one candle update to lightweight-charts.
    // isNewCandle=true → append new bar + scroll to realtime.
    // isNewCandle=false → update the last bar in-place.
    const push = (c: Candle, isNewCandle: boolean, allowDuringSettle = false) => {
      if (isDisposedRef.current) return;
      if (liveMarketDataFrozenRef.current) return;
      if (!canPaintLiveChart(allowDuringSettle)) {
        if (shouldCommitFirstLiveSelectionBaseline({
          gate: chartSelectionPresentationRef.current,
          selectionKey: chartSelectionPresentationKey,
          active: isActiveRef.current,
          disposed: isDisposedRef.current,
          rebuilding: isRebuildingRef.current,
          hasSeries: Boolean(seriesRef.current),
          hasCurrentCandle: Boolean(currentCandleRef.current),
        })) {
          requestChartDataRender({
            immediate: true,
            resetVisibleRange: true,
            releaseLivePaintAfterRender: true,
            finishLoadingAfterRender: !initialHistoryLoadPendingRef.current,
            reason: 'first-live-selection-baseline',
          });
        } else {
          requestDeferredLivePaint(isNewCandle, isNewCandle);
        }
        return;
      }

      const series = seriesRef.current;
      if (!series) return;
      if (isNewCandle) {
        console.log(`[Push] 🆕 NEW candle → time=${new Date((c.time as number) * 1000).toISOString()}, O=${c.open} H=${c.high} L=${c.low} C=${c.close}`);
      }
      try {
        const ct = prevChartTypeRef.current || 'candlestick';
        if (ct === 'line' || ct === 'area') {
          series.update({ time: c.time as Time, value: c.close });
        } else {
          series.update({ time: c.time as Time, open: c.open, high: c.high, low: c.low, close: c.close });
        }
        if (volumeRef.current && shouldBuildVolumeData(chartSettingsRef.current)) {
          const theme = chartThemeRef.current;
          const displayVolume = getDisplayVolume(c, chartSettingsRef.current);
          volumeRef.current.update({
            time: c.time as Time, value: displayVolume,
            color: c.close >= c.open ? theme.volumeUp : theme.volumeDown,
          });
        }
        updateDrawingCandle(lastRenderedCandlesRef.current, c);
        const drawingContext = drawingRuntimeContextRef.current;
        // Coalesce frequent ticks without repeatedly cancelling the two-frame render.
        if (drawingRenderFrameRef.current === null && drawingRenderSettledFrameRef.current === null) {
          scheduleDrawingRenderAfterChartData(drawingContext.symbol, drawingContext.timeframe as Timeframe);
        }
        updateLegendDOM(c.open, c.high, c.low, c.close, getDisplayVolume(c, chartSettingsRef.current));
        if (isNewCandle) {
          refreshMarketGapSeriesForCandle(c);
        }
        if (
          isNewCandle &&
          chartRef.current &&
          !isDisposedRef.current &&
          shouldScrollToRealtime(chartRef.current, autoScrollEnabledRef.current, chartSettingsRef.current.chartAutoScroll)
        ) {
          try {
            chartRef.current.timeScale().scrollToRealTime();
          } catch { }
        }
      } catch (e) {
        console.error(`[Push] ❌ series.update FAILED for t=${new Date((c.time as number) * 1000).toISOString()}:`, e, c);
      }
    };

    const prepareDeferredLiveModel = () => {
      if (!pendingLiveChartPaint || !pendingLiveChartRequiresFullRender) return;
      requestChartDataRender({
        resetVisibleRange: false,
        reason: 'deferred-live-rollover',
      });
    };

    const paintDeferredLive = (fullModelPainted: boolean) => {
      if (!pendingLiveChartPaint) return;
      const current = currentCandleRef.current;
      const shouldScroll = pendingLiveShouldScrollToRealtime;
      pendingLiveChartPaint = false;
      pendingLiveChartRequiresFullRender = false;
      pendingLiveShouldScrollToRealtime = false;
      if (!current) return;

      if (!fullModelPainted) {
        push(current, false, true);
      } else {
        updateLegendDOM(
          current.open,
          current.high,
          current.low,
          current.close,
          getDisplayVolume(current, chartSettingsRef.current),
        );
      }
      repaintLivePriceOverlayFromCurrentPrice(current);

      if (
        shouldScroll
        && chartRef.current
        && shouldScrollToRealtime(
          chartRef.current,
          autoScrollEnabledRef.current,
          chartSettingsRef.current.chartAutoScroll,
        )
      ) {
        try {
          chartRef.current.timeScale().scrollToRealTime();
        } catch { }
      }
    };

    postInteractionCallbacksRef.current.prepareLiveModel = prepareDeferredLiveModel;
    postInteractionCallbacksRef.current.paintLive = paintDeferredLive;

    // ── rollover ───────────────────────────────────────────────────────────────
    // FIX: Opens a new candle only from a real tick/server OHLC open. Clock
    // passage alone must never manufacture a zero-volume previous-close bar.
    const rollover = (newTime: number, openPrice: number) => {
      console.log(`[Rollover] called → newTime=${new Date(newTime * 1000).toISOString()}, current=${currentCandleRef.current ? new Date((currentCandleRef.current.time as number) * 1000).toISOString() : 'null'}`);
      if (liveMarketDataFrozenRef.current) { console.warn('[Rollover] BAIL: market data frozen'); return; }
      if (!currentCandleRef.current) { console.warn('[Rollover] BAIL: currentCandleRef is null'); return; }
      if ((currentCandleRef.current.time as number) >= newTime) { console.warn(`[Rollover] BAIL: current=${currentCandleRef.current.time} >= newTime=${newTime} (already rolled)`); return; }
      if (isDisposedRef.current) { console.warn('[Rollover] BAIL: disposed'); return; }
      if (!Number.isFinite(openPrice) || openPrice <= 0) return;

      // Archive the completed candle (once).
      const done = { ...currentCandleRef.current };
      candlesRef.current = upsertCandleIntoHistory(candlesRef.current, done).candles;

      const open = openPrice;
      const newCandle: Candle = { time: newTime, open, high: open, low: open, close: open, volume: 0, tickVolume: 0 };
      currentCandleRef.current = newCandle;
      console.log(`[Chart] ✅ Rollover done → ${new Date(newTime * 1000).toISOString()}`);
      push(newCandle, true);
    };

    const reconcileSynchronizedCandleBoundary = (): number | null => {
      // Do not let the local wall clock manufacture a market candle before this
      // symbol has supplied an authoritative source timestamp.
      if (!synchronizedMarketClockRef.current || liveMarketDataFrozenRef.current) return null;
      const currentCandle = currentCandleRef.current;
      if (!currentCandle) return null;

      const activeTf = (prevTimeframeRef.current || timeframe) as AggTimeframe;
      const marketNowSeconds = getSynchronizedChartMarketNowMs() / 1000;
      const boundaryOffsetSeconds = brokerTimeOffsetSecRef.current;
      const currentPeriod = getTimeframePeriodSeconds(
        marketNowSeconds,
        activeTf,
        boundaryOffsetSeconds,
      );
      if (!currentPeriod || currentPeriod.startTime <= Number(currentCandle.time)) {
        return null;
      }

      // FIX: Return the pending real boundary for stale-tick rejection/countdown
      // only. The first source event is responsible for creating the new bar.
      return currentPeriod.startTime;
    };

    scheduleBoundaryTimerRef.current = reconcileSynchronizedCandleBoundary;
    reconcileSynchronizedCandleBoundary();

    const handleSynchronizedClockVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        reconcileSynchronizedCandleBoundary();
      }
    };
    document.addEventListener('visibilitychange', handleSynchronizedClockVisibilityChange);

    // FIX: Feed every raw selected-symbol websocket frame into the candle model
    // before the quote/store render batching path coalesces it. Rendering may be
    // throttled, but High/Low/volume must retain short-lived ticks like MT/TV.
    const unsubscribeRawQuoteAggregation = getQuoteSocketManager().onQuoteSnapshot(symbol, (tick) => {
      if (liveEffectClosed || isDisposedRef.current || isRebuildingRef.current) return;
      candleAggregationService.processTick({
        symbol,
        bid: tick.bid,
        ask: tick.ask,
        timestamp: tick.sourceTimestamp ?? tick.timestamp,
        volume: 1,
      });
    });

    // ── Main tick polling loop ─────────────────────────────────────────
    const interval = setInterval(() => {
      // Model ingestion must never pause for a pan on an active chart.
      // Hidden tab instances release this entire runtime effect instead.
      if (liveEffectClosed || isDisposedRef.current || isRebuildingRef.current || liveMarketDataFrozenRef.current) return;

      if (pendingLiveChartPaint && currentCandleRef.current && canPaintLiveChart()) {
        flushPostInteractionWork();
      }
      const activeTf = prevTimeframeRef.current || timeframe;

      // Get the latest tick from window.rtxTickCache map first for high performance, fallback to Zustand store
      let tick = typeof window !== 'undefined' && window.rtxTickCache
        ? (window.rtxTickCache.get(symbol)
          ?? window.rtxTickCache.get(normalizedSymbol))
        : undefined;

      if (!tick) {
        const state = useAppStore.getState();
        tick = state.ticks[symbol]
          // FIX: Only the exact broker identity can update this chart; fuzzy
          // punctuation-stripped lookup can cross EURUSD/EURUSD.r instruments.
          ?? state.ticks[normalizedSymbol];
      }

      // ── MIGRATED: Local clock-based boundary check removed ──────────
      // Tick/server timestamps and the synchronized market clock now share the
      // same boundary calculation; the local PC wall clock never rolls the model.

      // FIX: Refresh the monotonic market-time anchor for countdown/boundary
      // awareness only. An unchanged quote never creates a synthetic candle.
      synchronizeChartMarketClock(tick?.sourceTimestamp ?? tick?.timestamp);
      reconcileSynchronizedCandleBoundary();

      // Candles (history, candle stream and the raw quote listener above) are
      // the raw feed bid. A logged-in account's store quote is widened by its
      // spread markup, so the candle model reads the raw sides while the bid/ask
      // lines show the effective prices the account trades at.
      const bidMarkupOffset = getQuoteBidMarkupOffset(tick);
      if (bidMarkupOffset !== liveBidMarkupOffsetRef.current) {
        liveBidMarkupOffsetRef.current = bidMarkupOffset;
        if (currentCandleRef.current) repaintLivePriceOverlayOrDefer(currentCandleRef.current);
      }
      const candleQuote = getRawQuoteSides(tick);
      const price = getChartPriceFromQuote(candleQuote);
      if (price == null || !tick || !candleQuote) return;
      syncSupplementalPriceLines(Number(tick.ask ?? tick.bid), price);
      const rawTickTimestamp = Number(tick.sourceTimestamp ?? tick.timestamp);
      if (!Number.isFinite(rawTickTimestamp) || rawTickTimestamp <= 0) return;

      // Reject only the exact quote already processed by the 50ms poll. Use the
      // raw timestamp (before second bucketing) plus both quote sides so a newer
      // same-price tick still advances candle time/volume and SL/TP semantics.
      const tickKey = `${rawTickTimestamp}:${candleQuote.bid}:${candleQuote.ask ?? candleQuote.bid}:${price}`;
      if (tickKey === lastTickKey) return;
      lastTickKey = tickKey;

      const livePriceMatchesRenderedScale = validateRenderedCandlesAgainstLivePrice(price, activeTf);
      if (!livePriceMatchesRenderedScale || !isLivePriceSafeForCandles(price)) {
        const allowDrop = canDropPreloadedCandlesForLiveQuoteMismatch({
          hasDisplayedHistory: hasDisplayedHistoryRef.current,
          protectedHistoryCount: protectedDisplayedHistoryRef.current.length,
          currentHistoryCount: candlesRef.current.length,
        });
        const guard = updateLiveQuoteGuardState({
          lastAcceptedQuote: lastAcceptedQuoteRef.current,
          incompatibleQuoteCount: incompatibleQuoteCountRef.current,
        }, false, price, { allowDrop });
        lastAcceptedQuoteRef.current = guard.state.lastAcceptedQuote;
        incompatibleQuoteCountRef.current = guard.state.incompatibleQuoteCount;
        setApiError(`${symbol} live quote is outside the candle range; waiting for matching ${activeTf} data.`);

        // If the first live quotes consistently disagree with preloaded history,
        // the history is likely from a stale/wrong instrument. Drop it so live
        // ticks can rebuild the chart at the executable quote scale.
        if (guard.shouldDropCandles) {
          if (restoreProtectedDisplayedHistory(activeTf, 'live-quote-mismatch-drop')) {
            resetLiveQuotePriceGuard();
            return;
          }
          if (activeTf === 'M1') {
            console.warn(`[Chart] Suppressed ${symbol} ${activeTf} live quote mismatch drop to avoid replacing displayed history with a tiny live cluster.`);
            resetLiveQuotePriceGuard();
            return;
          }

          console.warn(`[Chart] Dropping incompatible ${symbol} candles after repeated live quote mismatch.`);
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
          leftVisibleTimeRef.current = null;
          lastVisibleLogicalRangeRef.current = null;
          lastStoreCandleSecRef.current = 0;
          try { seriesRef.current?.setData([]); } catch { }
          try { volumeRef.current?.setData([]); } catch { }
          hideLivePriceOverlay();
          candleAggregationService.loadHistoricalCandles(
            symbol,
            activeTf as AggTimeframe,
            [],
            brokerTimeOffsetSecRef.current,
          );
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
      let ts = rawTickTimestamp;
      if (ts > 1_000_000_000_000) ts = Math.floor(ts / 1000); // ms → sec

      // ── SAFEGUARD: prevent laggy broker ticks from pulling chart backwards ──
      if (currentCandleRef.current && ts < currentCandleRef.current.time) {
        // FIX: Never retimestamp a stale broker event into the active bucket;
        // doing so mutates current OHLC with an old-session/late-stream value.
        return;
      }

      const aggregationUpdates = candleAggregationService.processTick({
        symbol,
        bid: candleQuote.bid,
        ask: candleQuote.ask ?? candleQuote.bid,
        timestamp: rawTickTimestamp,
        volume: 1,
      });
      const aggregationCandles = candleAggregationService.getCandles(
        symbol,
        activeTf as AggTimeframe,
        true,
        false,
      );
      const latestAggregatedCandle = aggregationUpdates.get(activeTf as AggTimeframe)
        ?? aggregationCandles[aggregationCandles.length - 1];
      const tfs = getTimeframeSeconds(activeTf as AggTimeframe);
      const tickPeriod = getTimeframePeriodSeconds(
        ts,
        activeTf as AggTimeframe,
        brokerTimeOffsetSecRef.current,
      );
      const m1DerivedCandle = latestAggregatedCandle && (
        !tickPeriod || latestAggregatedCandle.time === tickPeriod.startTime
      ) ? latestAggregatedCandle : undefined;
      const candleTime = m1DerivedCandle?.time ?? tickPeriod?.startTime
        ?? alignTimeframeBoundarySeconds(ts, activeTf as AggTimeframe, tfs);
      const derivedCurrentCandle: Candle | null = m1DerivedCandle?.time === candleTime
        ? { ...m1DerivedCandle, tickVolume: m1DerivedCandle.volume }
        : null;

      // FIX: A backend `closed:true` bucket is immutable. Replayed ticks with
      // that event period cannot reopen it or reintroduce stale local OHLC.
      if (isCandleAtOrBeforeFinalizedTime(finalizedCandleTimeByTimeframe, activeTf, candleTime)) return;

      // Record only a real accepted quote mutation. A history refresh can then
      // distinguish a newer forming candle from the stale cache row that was
      // already present when its REST request started.
      const liveMutationGeneration = liveCandleMutationGenerationRef.current + 1;
      liveCandleMutationGenerationRef.current = liveMutationGeneration;
      const liveMutationTime = Number(candleTime);
      liveCandleMutationGenerationByTimeRef.current.delete(liveMutationTime);
      liveCandleMutationGenerationByTimeRef.current.set(liveMutationTime, liveMutationGeneration);
      while (liveCandleMutationGenerationByTimeRef.current.size > 256) {
        const oldestTrackedTime = liveCandleMutationGenerationByTimeRef.current.keys().next().value;
        if (oldestTrackedTime === undefined) break;
        liveCandleMutationGenerationByTimeRef.current.delete(oldestTrackedTime);
      }

      // ── Update live price DOM line + badge ──

      // ── Candle rollover or update ──────────────────────────────────────────
      if (!currentCandleRef.current) {
        // Very first tick — create the forming candle.
        currentCandleRef.current = derivedCurrentCandle
          ?? { time: candleTime, open: price, high: price, low: price, close: price, volume: 1, tickVolume: 1 };
        push(currentCandleRef.current, true);
      } else if (candleTime > currentCandleRef.current.time) {
        // rollover() with real first tick price allows true gaps to render properly.
        rollover(candleTime, derivedCurrentCandle?.open ?? price);
        if (currentCandleRef.current && currentCandleRef.current.time === candleTime) {
          if (derivedCurrentCandle) {
            currentCandleRef.current = mergeFormingCandleEnvelope(
              currentCandleRef.current,
              derivedCurrentCandle,
            );
            push(currentCandleRef.current, false);
          } else {
            currentCandleRef.current.volume = 1;
            currentCandleRef.current.tickVolume = 1;
          }
        }
      } else {
        if (derivedCurrentCandle && derivedCurrentCandle.time === currentCandleRef.current.time) {
          currentCandleRef.current = mergeFormingCandleEnvelope(
            currentCandleRef.current,
            derivedCurrentCandle,
          );
        } else {
          currentCandleRef.current = applyTickToFormingCandle(currentCandleRef.current, price);
        }
        push(currentCandleRef.current, false);
      }

      // Refresh after candle creation/update so the first live-only tick has a
      // price scale before we ask LightweightCharts for a coordinate.
      if (currentCandleRef.current) {
        repaintLivePriceOverlayOrDefer(currentCandleRef.current);
      }

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
          // Cluster-wide throttle: with many positions riding their levels the
          // per-trade cooldowns interleave into a near-continuous request
          // storm that destabilizes the positions feed itself.
          const crossDispatchNow = Date.now();
          if (crossDispatchNow - lastCrossRefreshDispatchAtRef.current >= TRADE_LEVEL_CROSS_REFRESH_MIN_DISPATCH_INTERVAL_MS) {
            lastCrossRefreshDispatchAtRef.current = crossDispatchNow;
            const pId = trade.key.replace('trade:', '');
            console.log(`[Chart] SL/TP crossed for trade ${pId}; requesting server refresh`);

            window.dispatchEvent(new Event('rtx:force-refresh-positions'));
            const login = Number.parseInt(String(useAppStore.getState().accountId ?? ''), 10);
            if (Number.isFinite(login) && login > 0) {
              window.dispatchEvent(new CustomEvent('rtx:refresh-trade-history-requested', {
                detail: { login },
              }));
            }
          }
          window.setTimeout(() => {
            tradeLevelCrossRefreshPendingRef.current.delete(trade.key);
          }, 2500);
        }
      });

    }, LIVE_CHART_UPDATE_INTERVAL_MS);

    // ── FIX WebSocket: server-confirmed completed candles ──────────────────────
    const applyServerCandle = (
      c: Candle,
      source: CandleCacheSource = 'backend',
      candleTimeframe: AggTimeframe = 'M1',
    ) => {
      if (liveEffectClosed || isDisposedRef.current || isRebuildingRef.current) return;
      if (liveMarketDataFrozenRef.current) return;
      const [reconciled] = reconcileCandlesWithLiveQuote([c], 'stream update');
      if (!reconciled) return;
      c = reconciled;
      if (!validateRenderedCandlesAgainstLivePrice(c.close, prevTimeframeRef.current || timeframe)) return;
      mergeHistoryCache(
        prevTimeframeRef.current || timeframe,
        [c],
        brokerTimeOffsetSecRef.current,
        source,
      );

      if (c.closed === true) {
        // FIX: Final backend OHLC replaces the local forming candle exactly;
        // expand-only live merging would otherwise preserve a wrong local wick.
        markFinalizedCandleTime(finalizedCandleTimeByTimeframe, candleTimeframe, c.time);
        candlesRef.current = mergeBackendCandlePage(candlesRef.current, [c]).candles;
        if (!currentCandleRef.current || c.time >= currentCandleRef.current.time) {
          currentCandleRef.current = { ...c };
        }
        updateChartData(candlesRef.current, undefined, {
          reason: 'server-final-candle-replacement',
        });
        if (currentCandleRef.current?.time === c.time) {
          repaintLivePriceOverlayOrDefer(currentCandleRef.current);
        }
        return;
      }

      // 1. Is this an update to an older (already closed) bar?
      if (currentCandleRef.current && c.time < currentCandleRef.current.time) {
        // LightweightCharts cannot update historical datums via update(); merge the
        // authoritative server correction and repaint the full sorted set instead.
        mergeCandleIntoRef(c);
        updateChartData(candlesRef.current, undefined, {
          reason: 'server-candle-history-correction',
        });
        return;
      }

      // 2. Is this an update to the CURRENTLY forming bar?
      if (currentCandleRef.current && c.time === currentCandleRef.current.time) {
        currentCandleRef.current = mergeFormingCandleEnvelope(currentCandleRef.current, c);
        mergeCandleIntoRef(currentCandleRef.current);
        if (isPotentialMarketClosedPlaceholder(currentCandleRef.current)) {
          updateChartData(candlesRef.current);
        } else {
          refreshMarketGapSeriesForCandle(currentCandleRef.current);
          push(currentCandleRef.current, false);
        }
        repaintLivePriceOverlayOrDefer(currentCandleRef.current);
        return;
      }

      // 3. Server is telling us about a TRULY NEW candle (c.time > current.time)
      if (!currentCandleRef.current) {
        currentCandleRef.current = { ...c };
        mergeCandleIntoRef(currentCandleRef.current);
        if (isPotentialMarketClosedPlaceholder(currentCandleRef.current)) {
          updateChartData(candlesRef.current);
        } else {
          refreshMarketGapSeriesForCandle(currentCandleRef.current);
          push(currentCandleRef.current, true);
        }
        repaintLivePriceOverlayOrDefer(currentCandleRef.current);
        return;
      }

      if (c.time > currentCandleRef.current.time) {
        // Let the idempotent rollover handle creating it
        rollover(c.time, c.open);

        // Immediately apply server's data to it
        if (currentCandleRef.current && currentCandleRef.current.time === c.time) {
          currentCandleRef.current = { ...c };
          mergeCandleIntoRef(currentCandleRef.current);
          if (isPotentialMarketClosedPlaceholder(currentCandleRef.current)) {
            updateChartData(candlesRef.current);
          } else {
            refreshMarketGapSeriesForCandle(currentCandleRef.current);
            push(currentCandleRef.current, false);
          }
          repaintLivePriceOverlayOrDefer(currentCandleRef.current);
        }

        // We no longer need to reschedule boundary timer here!
        // The immortal Date.now() loop handles it automatically in the background.
      }
    };

    // Higher-timeframe history and server updates use M1 as their normal input.
    // Raw ticks still update the forming minute between server candle messages.
    const streamTimeframe: AggTimeframe = 'M1';
    const getDisplayedStreamTimeframe = (): AggTimeframe => (
      (prevTimeframeRef.current || 'M1') as AggTimeframe
    );
    const classifyServerM1CandleFinality = (candle: Candle): Candle => {
      if (typeof candle.closed === 'boolean') return candle;
      const marketNowSeconds = getSynchronizedChartMarketNowMs() / 1000;
      const activeM1Period = getTimeframePeriodSeconds(
        marketNowSeconds,
        'M1',
        brokerTimeOffsetSecRef.current,
      );
      // FIX: Legacy updates without finality metadata are classified against
      // broker-synchronized M1 time, not arrival order or the local PC clock.
      return resolveCandleFinalityFromActivePeriod(candle, activeM1Period?.startTime);
    };
    const reconcileServerM1Candle = (candle: Candle): Candle => {
      const classifiedCandle = classifyServerM1CandleFinality(candle);
      const [m1] = formatHistoryForOhlcv([classifiedCandle]);
      if (!m1) return classifiedCandle;
      candleAggregationService.reconcileServerCandle(
        symbol,
        'M1',
        m1,
        classifiedCandle.closed === true,
      );
      return classifiedCandle;
    };
    const applyLatestM1DerivedServerCandle = () => {
      const displayedStreamTimeframe = getDisplayedStreamTimeframe();
      if (displayedStreamTimeframe === 'M1') return;
      const derivedCandles = candleAggregationService.getCandles(
        symbol,
        displayedStreamTimeframe,
        true,
        false,
      );
      const latest = derivedCandles[derivedCandles.length - 1];
      if (latest) {
        applyServerCandle(
          { ...latest, tickVolume: latest.volume, closed: latest.isComplete === true },
          'derived-m1',
          displayedStreamTimeframe,
        );
      }
    };
    const candleStream = chartDataService.subscribeCandles({
      symbol,
      timeframe: streamTimeframe,
      onSnapshot: (snapshot) => {
        if (liveEffectClosed || isDisposedRef.current || isRebuildingRef.current || snapshot.length === 0) return;
        if (liveMarketDataFrozenRef.current) return;
        const rawSnapshot = getValidSortedCandles(snapshot as Candle[]).map(classifyServerM1CandleFinality);
        // FIX: Validate the exact backend scale before either painting M1 or
        // feeding M1 into a derived timeframe. An incompatible page fails closed.
        const reconciledSnapshot = reconcileCandlesWithLiveQuote(rawSnapshot, 'stream snapshot');
        if (reconciledSnapshot.length === 0) return;
        const displayedStreamTimeframe = getDisplayedStreamTimeframe();
        if (displayedStreamTimeframe !== 'M1') {
          // FIX: Respect explicit finality (or synchronized-period fallback)
          // for every row. Blindly dropping the newest snapshot row omitted a
          // valid final M1 and left derived M5/H1 values stale after reconnect.
          reconciledSnapshot.forEach(reconcileServerM1Candle);
          applyLatestM1DerivedServerCandle();
          return;
        }
        const activeFormingCandle = currentCandleRef.current;
        const protectedSnapshot = activeFormingCandle
          ? reconciledSnapshot.map((snapshotCandle) => (
            snapshotCandle.time === activeFormingCandle.time && snapshotCandle.closed !== true
              ? mergeFormingCandleEnvelope(activeFormingCandle, snapshotCandle)
              : snapshotCandle
          ))
          : reconciledSnapshot;
        // FIX: A snapshot may end on an explicitly final row. Seal it before
        // cached quote polling can mutate that timestamp again.
        protectedSnapshot.forEach((snapshotCandle) => {
          if (snapshotCandle.closed === true) {
            markFinalizedCandleTime(finalizedCandleTimeByTimeframe, 'M1', snapshotCandle.time);
          }
        });
        // FIX: Seed the canonical M1 builder from the same protected snapshot
        // painted by the chart, so raw ticks and backend OHLC cannot diverge.
        candleAggregationService.loadHistoricalCandles(
          symbol,
          'M1',
          formatHistoryForOhlcv(protectedSnapshot),
          brokerTimeOffsetSecRef.current,
        );
        const explicitFinal = [...protectedSnapshot].reverse().find(item => item.closed === true);
        if (explicitFinal) reconcileServerM1Candle(explicitFinal);
        const latestClose = protectedSnapshot[protectedSnapshot.length - 1]?.close;
        if (latestClose && !validateRenderedCandlesAgainstLivePrice(latestClose, prevTimeframeRef.current || streamTimeframe)) return;
        // FIX: A stream snapshot is authoritative for its covered interval;
        // remove stale/fabricated cached rows that the backend no longer sends.
        const hasNewerLiveSnapshotMutation = Boolean(
          activeFormingCandle
          && liveCandleMutationGenerationByTimeRef.current.has(activeFormingCandle.time),
        );
        candlesRef.current = mergeAuthoritativeCandleHistory(candlesRef.current, protectedSnapshot, {
          // FIX: A delayed stream snapshot may end one bucket behind a real tick.
          // Preserve that future bucket only when this session actually mutated it.
          formingLiveCandle: activeFormingCandle,
          hasNewerLiveMutation: hasNewerLiveSnapshotMutation,
        });
        setHistoryCache(
          prevTimeframeRef.current || streamTimeframe,
          candlesRef.current,
          brokerTimeOffsetSecRef.current,
          'backend',
        );
        updateChartData(candlesRef.current, undefined, {
          immediate: true,
          releaseLivePaintAfterRender: true,
          finishLoadingAfterRender: !initialHistoryLoadPendingRef.current,
          reason: 'stream-snapshot',
        });
        currentCandleRef.current = candlesRef.current[candlesRef.current.length - 1] ?? currentCandleRef.current;
        if (currentCandleRef.current) {
          repaintLivePriceOverlayOrDefer(currentCandleRef.current);
        }
        // A snapshot can provide the fallback baseline, but it only dismisses
        // the loader after the initial REST request has settled. Until then it
        // remains painted behind the loading surface and history gets first reveal.
      },
      onCandle: (candle) => {
        if (liveEffectClosed) return;
        const [validatedCandle] = reconcileCandlesWithLiveQuote(
          [classifyServerM1CandleFinality(candle)],
          'stream update',
        );
        // FIX: Do not contaminate canonical M1 aggregation with a candle from
        // an incompatible symbol/decimal band. The backend value is not altered.
        if (!validatedCandle) return;
        const displayedStreamTimeframe = getDisplayedStreamTimeframe();
        if (displayedStreamTimeframe === 'M1') {
          // FIX: Route legacy M1 updates through the same finality classifier as
          // higher-timeframe derivation before painting or sealing the bucket.
          applyServerCandle(reconcileServerM1Candle(validatedCandle), 'backend', 'M1');
          return;
        }
        reconcileServerM1Candle(validatedCandle);
        applyLatestM1DerivedServerCandle();
      },
      onConnected: () => {
        // FIX: Clear transient stream text after a successful reconnect.
        if (!liveEffectClosed) setApiError(null);
      },
      onError: (error) => {
        if (!liveEffectClosed) setApiError(error.message);
      },
    });

    return () => {
      liveEffectClosed = true;
      clearInterval(interval);
      // FIX: Release the raw-tick model listener with the exact chart runtime.
      unsubscribeRawQuoteAggregation();
      candleStream.close();
      document.removeEventListener('visibilitychange', handleSynchronizedClockVisibilityChange);
      if (scheduleBoundaryTimerRef.current === reconcileSynchronizedCandleBoundary) {
        scheduleBoundaryTimerRef.current = null;
      }
      if (postInteractionCallbacksRef.current.prepareLiveModel === prepareDeferredLiveModel) {
        postInteractionCallbacksRef.current.prepareLiveModel = () => undefined;
      }
      if (postInteractionCallbacksRef.current.paintLive === paintDeferredLive) {
        postInteractionCallbacksRef.current.paintLive = () => undefined;
      }
      postInteractionCoordinatorRef.current?.clear();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    symbol,
    authToken,
    brokerAccountSessionScope,
    chartSelectionPresentationKey,
    getSynchronizedChartMarketNowMs,
    synchronizeChartMarketClock,
  ]);

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
              refreshLightweightChartSurface(chartRef.current, offsetWidth, offsetHeight);
              if (resetVisibleRangeOnNextDataRef.current) {
                const totalBars = getCandlesForFullRender().length;
                resetVisibleRangeOnNextDataRef.current = !applyInitialVisibleLogicalRange(
                  chartRef.current,
                  totalBars,
                  prevTimeframeRef.current || timeframe,
                );
              }
              console.log(`[TradingChart] Tab became visible — resized to ${offsetWidth}x${offsetHeight}`);
              flushTradeOverlay();
              schedulePeriodSeparatorRender();
            }
          }
        }
      },
      { threshold: 0.1 }
    );

    observer.observe(el);
    return () => observer.disconnect();
  }, [applyInitialVisibleLogicalRange, flushTradeOverlay, getCandlesForFullRender, schedulePeriodSeparatorRender, timeframe]);

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
  }), [isChartCommandTarget, rememberVisibleLogicalRange, schedulePeriodSeparatorRender, symbol]);

  // All zoom buttons use the chart's live time scale, shared by candles and volume.
  useEffect(() => {
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
      } catch (e) { /* disposed */ }
    };

    const unsub1 = commandBus.subscribe('ZOOM_IN', (payload) => handleZoom(payload, 'in'));
    const unsub2 = commandBus.subscribe('ZOOM_OUT', (payload) => handleZoom(payload, 'out'));

    let resetChartViewport: (() => Promise<void>) | null = null;

    const handleScrollToRealtime = () => {
      if (isDisposedRef.current || !chartRef.current) return;
      try {
        const totalBars = getCandlesForFullRender().length;
        const activeTf = prevTimeframeRef.current || timeframe;
        if (totalBars > 0 && totalBars <= getTradingChartDefaultVisibleBars(activeTf)) {
          void resetChartViewport?.();
          return;
        }
        chartRef.current.timeScale().scrollToRealTime();
      } catch (e) { /* disposed */ }
    };

    const unsubScrollToRealtime = commandBus.subscribe('SCROLL_TO_REALTIME' as any, (payload: any) => {
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
      } catch (e) { /* disposed */ }
    };

    const unsubJumpToLatestCandle = commandBus.subscribe('JUMP_TO_LATEST_CANDLE' as any, (payload: any) => {
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
      } catch (e) { /* disposed */ }
    };

    resetChartViewport = handleResetChartViewport;

    const unsubResetChartViewport = commandBus.subscribe('RESET_CHART_VIEWPORT' as any, (payload: any) => {
      if (!isChartCommandTarget(payload)) return;
      void handleResetChartViewport();
    });

    // Auto-Scroll (Snap to live edge)
    const unsubAutoScroll = commandBus.subscribe('SET_AUTO_SCROLL' as any, (payload: any) => {
      if (!isChartCommandTarget(payload)) return;
      if (isDisposedRef.current || !chartRef.current) return;
      try {
        const enabled = payload?.enabled === true;
        autoScrollEnabledRef.current = enabled;
        setCtxAutoScroll(enabled);
        if (enabled) {
          handleScrollToRealtime();
        }
      } catch (e) { /* disposed */ }
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
      } catch (e) { /* disposed */ }
    };

    const unsubChartShift = commandBus.subscribe('SET_CHART_SHIFT' as any, (payload: any) => {
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
    const unsubTimeframe = commandBus.subscribe('SET_TIMEFRAME' as any, (payload: any) => {
      if (isDisposedRef.current || !chartRef.current) return;
      if (!isChartCommandTarget(payload)) return;

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

      const newTimeframe = payload?.timeframe;
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
            try { seriesRef.current.setData([]); } catch (e) { }
          }
          if (volumeRef.current) {
            try { volumeRef.current.setData([]); } catch (e) { }
          }
          setLoadingPhase('receiving');
        }
        // The panel-prop update above drives the dedicated symbol/timeframe
        // history effect. Keeping that effect as the only switch owner avoids
        // a second request from this command path.
      }
    });

    return () => {
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
  }, [isChartCommandTarget]);

  // Handle SELECT_TOOL command — bridge toolbar buttons to drawingManager
  useEffect(() => {
    const drawingInteractionContainer = containerRef.current;
    console.log('[TradingChart] ✅ SELECT_TOOL subscriber REGISTERED, chartRef=', !!chartRef.current, 'containerRef=', !!containerRef.current);

    const handleSaved = (event: Event) => {
      const contextId = drawingRuntimeContextRef.current.contextId;
      const savedContextId = (event as CustomEvent<{ contextId?: string }>).detail?.contextId;
      if (savedContextId && savedContextId !== contextId) return;
      if (drawingCommandTargetRef.current !== contextId) return;
      const completed = (event as CustomEvent<{ type?: string; subtype?: string; color?: string; lineWidth?: number; lineStyle?: 'solid' | 'dashed' | 'dotted'; fillColor?: string; fillOpacity?: number }>).detail;
      // Desktop drawings are single-use, including Brush and Highlighter.
      if (!window.electron?.window && event.type === 'drawing:saved' && completed?.type === 'freehand' && activeToolRef.current === 'freehand') {
        if (!bindDrawingManagerToChart()) return;
        drawingManager.startDrawing('freehand', completed.color, { subtype: completed.subtype });
        drawingManager.updateActiveDrawing({
          lineWidth: completed.lineWidth, lineStyle: completed.lineStyle,
          fillColor: completed.fillColor, fillOpacity: completed.fillOpacity
        });
        return;
      }
      console.log('[TradingChart] Drawing interaction ended, returning to cursor mode');
      activeToolRef.current = null;
      drawingCommandTargetRef.current = null;
      setTrendDrawingInputActive(containerRef.current, false);
      if (containerRef.current) containerRef.current.style.touchAction = '';
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
    window.addEventListener('drawing:cancelled', handleSaved);
    const cancelDrawingOnEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || !activeToolRef.current) return;
      const contextId = drawingRuntimeContextRef.current.contextId;
      if (window.electron?.window) {
        if (getActiveChartSource()?.id !== contextId) return;
        commandBus.dispatch({ type: 'SELECT_TOOL', payload: { tool: 'cursor', targetContextId: contextId } });
      } else if (activeToolRef.current === 'freehand') {
        drawingManager.cancelDrawing(contextId);
      }
    };
    window.addEventListener('keydown', cancelDrawingOnEscape);

    const unsubSelectTool = commandBus.subscribe('SELECT_TOOL', (payload) => {
      const tool = payload.tool;
      console.log(`[TradingChart] 🎯 SELECT_TOOL received: tool=${tool}, chartRef=${!!chartRef.current}, seriesRef=${!!seriesRef.current}`);

      const contextId = drawingRuntimeContextRef.current.contextId;
      const targetContextId = payload.targetContextId ?? getActiveChartSource()?.id;
      if (!targetContextId || targetContextId !== contextId) {
        if (drawingCommandTargetRef.current === contextId) {
          drawingCommandTargetRef.current = null;
          activeToolRef.current = null;
          if (containerRef.current) containerRef.current.style.touchAction = '';
          setTrendDrawingInputActive(containerRef.current, false);
          setTextInputOverlay(null);
          if (chartRef.current) {
            chartRef.current.applyOptions({
              handleScroll: TRADING_VIEW_HANDLE_SCROLL,
              handleScale: TRADING_VIEW_HANDLE_SCALE,
              ...(!crosshairEnabledRef.current && { crosshair: { vertLine: { visible: false }, horzLine: { visible: false } } }),
            });
          }
          if (containerRef.current && !crosshairEnabledRef.current) {
            containerRef.current.style.cursor = 'default';
            containerRef.current.querySelectorAll('canvas').forEach((canvas) => {
              (canvas as HTMLCanvasElement).style.cursor = 'default';
            });
            containerRef.current.parentElement?.setAttribute('data-cursor', 'select');
          }
        }
        return;
      }
      if (!bindDrawingManagerToChart()) return;

      // Cancel any active drawing + clear inline text input
      drawingManager.cancelDrawing();
      setTextInputOverlay(null);

      // Track tool in ref (accessible in closures without re-creating handlers)
      activeToolRef.current = tool === 'cursor' ? null : tool;
      if (containerRef.current) containerRef.current.style.touchAction = tool === 'freehand' || tool === 'ruler' ? 'none' : '';
      drawingCommandTargetRef.current = tool === 'cursor' ? null : contextId;
      setTrendDrawingInputActive(containerRef.current, false);

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
            // Drawing previews still follow crosshair-move events, but visible
            // crosshair guides belong exclusively to explicit Crosshair mode.
            ...(!crosshairEnabledRef.current && {
              crosshair: {
                vertLine: { visible: false, labelVisible: false },
                horzLine: { visible: false, labelVisible: false },
              },
            }),
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

        const validDrawingTypes = ['trendline', 'hline', 'vline', 'text', 'channel', 'fibonacci', 'shapes', 'rectangle', 'ellipse', 'fib_extension', 'measure', 'freehand', 'callout', 'stamp', 'pattern'];
        if (validDrawingTypes.includes(tool)) {
          const subtype = payload.subtype;
          drawingManager.startDrawing(
            tool as any,
            resolveTrendToolColor(subtype),
            subtype ? { subtype } : undefined,
          );
          const activeAfter = drawingManager.getActiveDrawing(contextId);
          setTrendDrawingInputActive(containerRef.current, Boolean(
            usesDirectDrawingPointerInput(activeAfter),
          ));
          console.log(`[Chart] Tool: ${tool} — drawing started, activeDrawing=${!!activeAfter}, type=${activeAfter?.type}`);
        } else {
          console.log(`[Chart] Tool: ${tool} — not a drawing tool`);
        }
      }
    });

    return () => {
      unsubSelectTool();
      window.removeEventListener('drawing:saved', handleSaved);
      window.removeEventListener('drawing:cancelled', handleSaved);
      window.removeEventListener('keydown', cancelDrawingOnEscape);
      setTrendDrawingInputActive(drawingInteractionContainer, false);
      if (drawingInteractionContainer) drawingInteractionContainer.style.touchAction = '';
    };
  }, []);

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
          x: index => chart.timeScale().logicalToCoordinate(index as any),
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
  const TRADE_BUY_COLOR = '#22c55e';
  const TRADE_SELL_COLOR = '#ef4444';
  const TRADE_HISTORY_PROFIT_COLOR = '#00e6a8';
  const TRADE_HISTORY_LOSS_COLOR = '#ff5a67';
  const TRADE_HISTORY_LIGHT_PROFIT_COLOR = '#047857';
  const TRADE_HISTORY_LIGHT_LOSS_COLOR = '#b91c1c';
  const TRADE_HISTORY_PRESENTATION_VERSION = 'visibility-v8-clean-arrows';
  // MT5-style entry lines: dotted blue for BUY, dotted red for SELL.
  const TRADE_ENTRY_LINE_BUY_COLOR = '#2962ff';
  const TRADE_ENTRY_LINE_SELL_COLOR = '#ef4444';
  const getEntryLineColor = (side: TradeSide) => side === 'BUY' ? TRADE_ENTRY_LINE_BUY_COLOR : TRADE_ENTRY_LINE_SELL_COLOR;
  const activeOverlayNodesRef = useRef<HTMLElement[]>([]);
  const activeOverlayNodeDataRef = useRef<OverlayNodeData[]>([]);
  const historyOverlayNodesRef = useRef<HTMLElement[]>([]);
  const historyOverlayNodeDataRef = useRef<OverlayNodeData[]>([]);
  // Live Pips/USD refresh hooks for the on-line position control bars.
  const tradeControlLiveUpdatersRef = useRef<Array<() => void>>([]);
  // Entry/SL/TP price-scale axis labels (lightweight-charts price lines).
  const tradeAxisPriceLinesRef = useRef<Map<string, IPriceLine>>(new Map());
  const frozenEntryTimesRef = useRef<Map<number | string, number>>(new Map());
  const stableActiveMarkerTimesRef = useRef<Map<number | string, number>>(new Map());
  const frozenEntryPricesRef = useRef<Map<number | string, number>>(new Map());
  const activeTradeSnapshotsRef = useRef<Map<string, ActiveTradeSnapshot>>(new Map());
  const pendingMissingActiveTradesRef = useRef<Map<string, { trade: ActiveTradeSnapshot; missingSince: number }>>(new Map());
  const closeSuppressedTradeKeysRef = useRef<Map<string, number>>(new Map());
  // Suppressions created by the SL/TP level-cross GUESS (not by a real close
  // request). If the broker feed shows the position open again, the guess was
  // wrong and its suppression must be lifted immediately.
  const crossCloseGuessedTradeKeysRef = useRef<Set<string>>(new Set());
  const lastCrossRefreshDispatchAtRef = useRef(0);
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
      : '.rtx-trade-marker--history,.rtx-trade-marker-hover-target,.rtx-trade-history-line';
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
      tradeControlLiveUpdatersRef.current = [];
      const series = seriesRef.current;
      tradeAxisPriceLinesRef.current.forEach((priceLine) => {
        try { series?.removePriceLine(priceLine); } catch { }
      });
      tradeAxisPriceLinesRef.current.clear();
    } else {
      lastHistoryTradeOverlaySignatureRef.current = '';
    }
  }, []);

  const clearTradeOverlay = useCallback(() => {
    clearTradeOverlayLayer('active');
    clearTradeOverlayLayer('history');
  }, [clearTradeOverlayLayer]);

  const clearTradeOverlayVisualRuntime = useCallback(() => {
    if (tradeHistoryRefreshTimerRef.current !== null) {
      window.clearTimeout(tradeHistoryRefreshTimerRef.current);
      tradeHistoryRefreshTimerRef.current = null;
    }
    if (tradeMissingGraceTimerRef.current !== null) {
      window.clearTimeout(tradeMissingGraceTimerRef.current);
      tradeMissingGraceTimerRef.current = null;
    }
    if (tradeOverlayRafRef.current !== null) {
      window.cancelAnimationFrame(tradeOverlayRafRef.current);
      tradeOverlayRafRef.current = null;
    }
    clearTradeOverlay();
  }, [clearTradeOverlay]);

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
    crossCloseGuessedTradeKeysRef.current.clear();
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
    // A collapsed/zero-size container has no valid geometry; leave nodes as
    // they are rather than culling the entire overlay against height 0.
    if (chartWidth <= 0 || chartHeight <= 0) return;
    const priceScaleWidth = series.priceScale().width();
    const timeScaleHeight = chart.timeScale().height();
    const plotHeight = Math.max(0, chartHeight - (Number.isFinite(timeScaleHeight) ? timeScaleHeight : 0));
    const snapCssPixel = (value: number): number => Math.round(value);
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
          if (
            node.kind === 'horizontal-line'
            || node.kind === 'price-badge'
            || node.kind === 'price-hit-area'
          ) {
            if (node.price == null) {
              el.style.display = 'none';
              continue;
            }

            const y = series.priceToCoordinate(node.price);
            if (y == null) {
              // The scale reports no coordinates while candles reload (feed
              // reconnects, empty snapshots from a flaky backend). Freeze
              // already-placed nodes instead of blinking the overlay off.
              if (!el.style.top) el.style.display = 'none';
              continue;
            }
            if (y < -20 || y > chartHeight + 20) {
              el.style.display = 'none';
              continue;
            }

            const snappedY = snapCssPixel(y);
            // Restore the node's own display mode: flex control bars must not
            // be flattened to block or their buttons fall onto the text baseline.
            el.style.display = el.dataset.display || 'block';
            el.style.top = node.kind === 'price-badge' && el.classList.contains('rtx-trade-level-badge--line-text')
              ? `${snappedY - 14}px`
              : `${snappedY + (node.pixelOffsetY ?? 0)}px`;

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
              // Coordinate gaps during candle reloads freeze placed segments.
              if (!el.style.top) el.style.display = 'none';
              continue;
            }

            el.style.display = 'block';
            el.style.left = `${geometry.left}px`;
            const isHistoryLine = el.classList.contains('rtx-trade-history-line');
            const segmentHeight = el.offsetHeight || 1;
            el.style.top = `${geometry.top - (isHistoryLine ? segmentHeight / 2 : 0)}px`;
            el.style.width = `${geometry.width}px`;
            el.style.transform = `rotate(${geometry.angleDeg}deg)`;
            el.style.transformOrigin = isHistoryLine ? '0 50%' : '0 0';
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
          if (x == null || y == null) {
            // Keep last placement through transient coordinate gaps.
            if (!el.style.top) el.style.display = 'none';
            continue;
          }
          if (x < -24 || x > chartWidth + 24 || y < -24 || y > chartHeight + 24) {
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

            const tooltip = el.querySelector<HTMLElement>('.rtx-trade-marker__price-tooltip');
            if (tooltip) {
              const plotWidth = Math.max(0, chartWidth - priceScaleWidth);
              const tooltipWidth = tooltip.offsetWidth || 64;
              const markerWidth = el.offsetWidth || 15;
              const maxTooltipLeft = Math.max(6, plotWidth - tooltipWidth - 6);
              const tooltipLeft = Math.min(maxTooltipLeft, Math.max(6, x - tooltipWidth / 2));
              tooltip.style.left = `${tooltipLeft - (x - markerWidth / 2)}px`;
              tooltip.style.right = 'auto';
              tooltip.style.transform = 'none';

              const markerHeight = el.offsetHeight || 32;
              const markerTop = node.markerSide === 'BUY' ? y : y - markerHeight;
              const markerBottom = node.markerSide === 'BUY' ? y + markerHeight : y;
              const tooltipHeight = tooltip.offsetHeight || 58;
              const tooltipGap = 7;
              const fitsAbove = markerTop - tooltipGap - tooltipHeight >= 4;
              const fitsBelow = markerBottom + tooltipGap + tooltipHeight <= plotHeight - 4;
              let placeAbove = node.markerSide === 'BUY';
              if (placeAbove && !fitsAbove && fitsBelow) placeAbove = false;
              if (!placeAbove && !fitsBelow && fitsAbove) placeAbove = true;
              tooltip.style.bottom = placeAbove ? `calc(100% + ${tooltipGap}px)` : 'auto';
              tooltip.style.top = placeAbove ? 'auto' : `calc(100% + ${tooltipGap}px)`;
            }
            continue;
          }
        } catch {
          el.style.display = 'none';
        }
      }
    }

    // Refresh the live Pips/USD text on position control bars. Relayout is
    // already tick-driven for active trades, so this stays in the same frame.
    for (const refreshTradeControlMetrics of tradeControlLiveUpdatersRef.current) {
      try { refreshTradeControlMetrics(); } catch { }
    }

    if (
      chartSettingsRef.current.showBidPriceLine
      && livePriceRef.current !== null
      && livePriceLineRef.current
      && livePriceBadgeRef.current
    ) {
      const y = series.priceToCoordinate(livePriceRef.current);
      if (y !== null && y !== undefined && y > 0) {
        const overlayColors = livePriceOverlayColorsRef.current;
        applyStableLivePriceHorizontalGeometry(priceScaleWidth);
        livePriceLineRef.current.style.display = 'block';
        livePriceLineRef.current.style.top = `${y}px`;
        livePriceLineRef.current.style.borderTopColor = overlayColors.lineColor;
        livePriceBadgeRef.current.style.display = 'block';
        livePriceBadgeRef.current.style.top = `${y}px`;
        livePriceBadgeRef.current.style.background = overlayColors.badgeBackground;
        livePriceBadgeRef.current.style.color = overlayColors.badgeTextColor;
      }
    } else if (!chartSettingsRef.current.showBidPriceLine) {
      hideLivePriceOverlay(false);
    }
  }, [applyStableLivePriceHorizontalGeometry, hideLivePriceOverlay]);

  repaintTradeOverlayGeometryRef.current = updateLabelPositions;

  const layoutPostInteractionOverlays = useCallback(() => {
    const chart = chartRef.current;
    const series = seriesRef.current;
    const overlay = overlayRef.current;
    if (!isDisposedRef.current && chart && series && overlay) {
      drawingManager.setChart(
        chart,
        series,
        prevSymbolRef.current || symbol,
        1,
        overlay,
        prevTimeframeRef.current || timeframe,
        activeChartSourceId,
        drawingRuntimeContextRef.current.accountScope,
        getDrawingSeriesData,
      );
      drawingManager.renderAll();
    }
    updateLabelPositions();
  }, [symbol, timeframe, updateLabelPositions]);

  postInteractionCallbacksRef.current.layoutOverlay = layoutPostInteractionOverlays;

  useActiveChartRuntimeEffect(visibleRuntime.overlay, () => {
    if (isDisposedRef.current || !seriesRef.current || !chartRef.current || !symbol) return;

    hydrateTradeLevelOverrides();

    // FIX: Trade overlays use the same opaque identity as orders and quotes.
    const normalizedChartSymbol = symbol.trim().toUpperCase();
    const digits = resolvedPriceDigits;

    const queueTradeOverlayRelayout = () => {
      if (isChartInteractionActiveRef.current) {
        postInteractionCoordinatorRef.current?.request({ overlay: true });
        return;
      }

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
      return null;
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
    const getHistoryProfitColor = () => isChartSurfaceLight()
      ? TRADE_HISTORY_LIGHT_PROFIT_COLOR
      : TRADE_HISTORY_PROFIT_COLOR;
    const getHistoryLossColor = () => isChartSurfaceLight()
      ? TRADE_HISTORY_LIGHT_LOSS_COLOR
      : TRADE_HISTORY_LOSS_COLOR;
    const getHistoryEntryColor = (side: TradeSide) => side === 'BUY' ? getHistoryProfitColor() : getHistoryLossColor();
    const getHistoryExitColor = (side: TradeSide) => side === 'BUY' ? getHistoryLossColor() : getHistoryProfitColor();
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
        entryExecutionTime: existingTrade?.entryExecutionTime ?? trade.entryExecutionTime,
        exitPrice,
        exitTime,
        exitExecutionTime: existingTrade?.exitExecutionTime ?? normalizeUnixSeconds(Date.now()) ?? exitTime,
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
        entryExecutionTime: snapshot.entryExecutionTime ?? existingTrade?.entryExecutionTime ?? snapshot.entryTime,
        exitPrice: existingTrade?.exitPrice ?? snapshot.exitPrice,
        exitTime,
        exitExecutionTime: snapshot.exitExecutionTime ?? existingTrade?.exitExecutionTime ?? snapshot.exitTime,
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
        entryTime: resolveCloseSnapshotOverlayTime(trade.entryExecutionTime, trade.entryTime),
        entryExecutionTime: trade.entryExecutionTime,
        exitPrice: trade.exitPrice,
        exitTime: resolveCloseSnapshotOverlayTime(trade.exitExecutionTime, trade.exitTime),
        exitExecutionTime: trade.exitExecutionTime,
        profit: trade.profit,
      })
    );
    const deriveClosedTradeColor = (trade: ClosedTradeSnapshot) => {
      const pnl = trade.profit ?? (
        trade.side === 'BUY' ? trade.exitPrice - trade.entryPrice : trade.entryPrice - trade.exitPrice
      );
      return pnl >= 0 ? chartThemeRef.current.candleUp : chartThemeRef.current.candleDown;
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
      // A zero override normally means "role untouched" and defers to the
      // server. While a modify request is pending (or in its optimistic grace
      // window) it instead means "level removed", so the stale server value
      // must stay suppressed until the backend confirms the removal.
      const hasActiveModifyWindow = hasPendingTradeLevelModifyRequest(trade) || hasRecentTradeLevelModifyGrace(trade);
      const slRemovalPending = overrideSl <= 0 && serverSl > 0 && hasActiveModifyWindow;
      const tpRemovalPending = overrideTp <= 0 && serverTp > 0 && hasActiveModifyWindow;
      const slSynced = (overrideSl <= 0 && !slRemovalPending) || (serverSl > 0 && Math.abs(serverSl - overrideSl) <= priceTolerance);
      const tpSynced = (overrideTp <= 0 && !tpRemovalPending) || (serverTp > 0 && Math.abs(serverTp - overrideTp) <= priceTolerance);

      if (slSynced && tpSynced) {
        rememberTradeLevels(trade, { sl: serverSl, tp: serverTp });
        deleteTradeLevelState(tradeLevelOverridesRef.current, trade);
        persistTradeLevelOverrides();
        return { sl: serverSl, tp: serverTp };
      }

      const levels = {
        sl: overrideSl > 0 ? overrideSl : slRemovalPending ? 0 : serverSl,
        tp: overrideTp > 0 ? overrideTp : tpRemovalPending ? 0 : serverTp,
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

    const appendHistoryInteractionNode = (element: HTMLElement, node: OverlayNodeData) => {
      const host = overlayRef.current?.parentElement ?? overlayRef.current;
      host?.appendChild(element);
      historyOverlayNodesRef.current.push(element);
      historyOverlayNodeDataRef.current.push(node);
    };

    const createArrowSvg = (side: TradeSide, color: string, emphasized: boolean) => {
      const width = emphasized ? 11 : 16;
      const height = emphasized ? 14 : 20;
      const viewBoxWidth = 22;
      const viewBoxHeight = 28;
      const path = side === 'BUY'
        ? 'M11 3L18.5 14.5H13.6V25H8.4V14.5H3.5Z'
        : 'M11 25L18.5 13.5H13.6V3H8.4V13.5H3.5Z';
      const outline = isChartSurfaceLight() ? '#0f172a' : '#f8fafc';
      const strokeWidth = emphasized ? 1.8 : 1.5;
      return `<svg width="${width}" height="${height}" viewBox="0 0 ${viewBoxWidth} ${viewBoxHeight}" fill="none" aria-hidden="true" style="display:block;overflow:visible"><path d="${path}" fill="${color}" stroke="${outline}" stroke-width="${strokeWidth}" stroke-linejoin="miter" stroke-miterlimit="4" paint-order="stroke fill"/></svg>`;
    };

    const createTradeMarker = (side: TradeSide, price: number, time: number, title: string, color: string, layer: TradeOverlayLayer, opacity = 1, resolveTime?: () => number | null, lifecycle: 'open' | 'close' = 'open', historyPositionSide: TradeSide = side, executionTime = time) => {
      const marker = document.createElement('div');
      marker.className = `rtx-trade-marker rtx-trade-marker--${layer} rtx-trade-marker--${lifecycle}`;
      marker.dataset.tradeLifecycle = lifecycle;
      if (layer === 'active') marker.title = title;
      const isHistoryMarker = layer === 'history';
      const markerWidth = isHistoryMarker ? 11 : 16;
      const markerHeight = isHistoryMarker ? 14 : 20;
      marker.innerHTML = createArrowSvg(side, color, isHistoryMarker);
      marker.style.cssText = `position:absolute;display:none;width:${markerWidth}px;height:${markerHeight}px;z-index:${isHistoryMarker ? 20 : 16};pointer-events:none;opacity:${opacity};filter:drop-shadow(0 1px 0 rgba(15,23,42,0.28));`;
      appendOverlayNode(marker, { kind: 'marker', price, time, markerSide: side, resolveTime }, layer);

      if (layer !== 'history') return;

      const lightSurface = isChartSurfaceLight();
      const palette = getTradeOverlayCardPalette(side, lightSurface);
      const lifecycleLabel = lifecycle === 'open' ? 'OPEN' : 'CLOSE';
      const timeLabel = formatTradeHistoryGmtTime(executionTime, { includeSeconds: true });
      const accessibleLabel = buildTradeHistoryBadgeText({
        positionSide: historyPositionSide,
        lifecycle: lifecycleLabel,
        price,
        digits,
        time: executionTime,
        includeSeconds: true,
      });
      const hoverTarget = document.createElement('div');
      hoverTarget.className = `rtx-trade-marker-hover-target rtx-trade-marker-hover-target--${lifecycle}`;
      hoverTarget.dataset.tradeLifecycle = lifecycle;
      hoverTarget.dataset.hoverPrice = title;
      hoverTarget.dataset.hoverTime = timeLabel;
      hoverTarget.dataset.positionSide = historyPositionSide;
      hoverTarget.dataset.historyAccessibleLabel = accessibleLabel;
      hoverTarget.setAttribute('role', 'img');
      hoverTarget.setAttribute('aria-label', accessibleLabel.replace(
        `${historyPositionSide} ${lifecycleLabel}`,
        `${tr(historyPositionSide)} ${tr(lifecycle === 'open' ? 'Open' : 'Close')}`,
      ));
      hoverTarget.tabIndex = 0;
      hoverTarget.style.cssText = 'position:absolute;display:none;width:32px;height:36px;z-index:22;pointer-events:auto;cursor:help;background:transparent;';

      const tooltip = document.createElement('span');
      tooltip.className = 'rtx-trade-marker__price-tooltip';
      const verticalPosition = side === 'BUY'
        ? 'bottom:calc(100% + 7px);'
        : 'top:calc(100% + 7px);';
      const tooltipBackground = lightSurface ? '#ffffff' : '#111827';
      const tooltipText = lightSurface ? '#111827' : '#f8fafc';
      tooltip.style.cssText = `position:absolute;left:50%;${verticalPosition}display:block;min-width:148px;padding:0;border:1px solid ${palette.border};border-radius:6px;background:${tooltipBackground};color:${tooltipText};font-size:var(--rtx-ui-font-size, 14px);font-family:${CHART_AXIS_FONT_FAMILY};font-variant-numeric:tabular-nums;line-height:16px;white-space:nowrap;pointer-events:none;opacity:0;visibility:hidden;transform:translateX(-50%);transition:opacity 90ms ease;box-shadow:0 6px 18px rgba(0,0,0,0.38);overflow:hidden;`;

      const tooltipHeader = document.createElement('span');
      tooltipHeader.className = 'rtx-trade-marker__tooltip-header';
      tooltipHeader.textContent = `${tr(historyPositionSide)} ${tr(lifecycle === 'open' ? 'Open' : 'Close')}`;
      tooltipHeader.style.cssText = `display:block;padding:3px 8px;border-bottom:1px solid ${colorWithAlpha(palette.border, 0.5, palette.border)};background:${palette.background};color:${palette.text};font-size:var(--rtx-ui-font-size, 14px);font-weight:var(--rtx-font-weight-heading, 500);letter-spacing:0.075em;`;

      const tooltipDetails = document.createElement('span');
      tooltipDetails.className = 'rtx-trade-marker__tooltip-details';
      tooltipDetails.style.cssText = 'display:grid;grid-template-columns:auto 1fr;column-gap:10px;row-gap:1px;padding:4px 8px 5px;';
      const detailLabelColor = lightSurface ? '#5f6b7a' : '#98a2b3';
      const appendTooltipDetail = (labelText: string, valueText: string) => {
        const label = document.createElement('span');
        label.dataset.chartUiLabel = labelText;
        label.textContent = tr(labelText);
        label.style.cssText = `color:${detailLabelColor};font-weight:var(--rtx-font-weight-control, 400);`;
        const value = document.createElement('span');
        value.textContent = valueText;
        value.style.cssText = `color:${tooltipText};font-weight:var(--rtx-font-weight-body, 400);text-align:right;`;
        tooltipDetails.append(label, value);
      };
      appendTooltipDetail('Price', title);
      appendTooltipDetail('Time', timeLabel);
      tooltip.append(tooltipHeader, tooltipDetails);

      const setPriceTooltipVisible = (visible: boolean) => {
        tooltip.style.opacity = visible ? '1' : '0';
        tooltip.style.visibility = visible ? 'visible' : 'hidden';
      };
      hoverTarget.addEventListener('pointerenter', () => setPriceTooltipVisible(true));
      hoverTarget.addEventListener('pointerleave', () => setPriceTooltipVisible(false));
      hoverTarget.addEventListener('focus', () => setPriceTooltipVisible(true));
      hoverTarget.addEventListener('blur', () => setPriceTooltipVisible(false));
      hoverTarget.appendChild(tooltip);
      appendHistoryInteractionNode(
        hoverTarget,
        { kind: 'marker', price, time, markerSide: side, resolveTime },
      );
    };

    const createTradeSegment = (price: number, time: number, color: string, lineStyle: 'solid' | 'dashed', layer: TradeOverlayLayer, endPrice?: number, endTime?: number, resolveEndPrice?: () => number | null, resolveEndTime?: () => number | null, opacity = 1) => {
      const line = document.createElement('div');
      line.className = layer === 'history' ? 'rtx-trade-history-line' : 'rtx-trade-active-segment';
      const isHistoryLine = layer === 'history';
      const thickness = isHistoryLine ? 1 : lineStyle === 'solid' ? 2 : 1;
      const safeOpacity = clampAlpha(opacity);
      const background = lineStyle === 'solid'
        ? color
        : `repeating-linear-gradient(to right, ${color} 0 6px, transparent 6px 10px)`;
      const renderedOpacity = safeOpacity;
      const segmentZIndex = isHistoryLine ? 17 : lineStyle === 'solid' ? 13 : 9;
      line.style.cssText = `position:absolute;display:none;height:${thickness}px;background:${background};border:0;border-radius:999px;z-index:${segmentZIndex};pointer-events:none;opacity:${renderedOpacity};transform-origin:0 50%;will-change:transform,width;`;
      appendOverlayNode(line, { kind: 'segment', price, time, endPrice, endTime, resolveEndPrice, resolveEndTime }, layer);
    };

    const createPriceLevel = (labelText: string, price: number, color: string, options: PriceLevelOptions = {}) => {
      if (!(price > 0)) return;

      const line = document.createElement('div');
      line.className = options.role ? `rtx-trade-level-line rtx-trade-level-line--${options.role.toLowerCase()}` : 'rtx-trade-level-line';
      const lineColor = options.lineColor ?? color;
      const lineWidth = options.lineWidthPx ?? 1;
      const lineOpacity = options.role === 'SL' || options.role === 'TP' ? 0.68 : 0.92;
      line.style.cssText = `position:absolute;display:none;height:0;border-top:${lineWidth}px dashed ${lineColor};z-index:12;pointer-events:none;opacity:${lineOpacity};`;
      appendOverlayNode(line, { kind: 'horizontal-line', price }, 'active');

      if (options.tradeKey && options.role) {
        const hitArea = document.createElement('div');
        hitArea.className = 'rtx-trade-level-hit-area';
        hitArea.dataset.tradeKey = options.tradeKey;
        hitArea.dataset.role = options.role;
        bindChartUiTranslation(hitArea, () => { hitArea.title = options.getTitle?.() ?? options.title ?? ''; });
        hitArea.style.cssText = `position:absolute;display:none;height:${TRADE_LEVEL_HIT_AREA_PX}px;transform:translateY(-50%);z-index:15;pointer-events:auto;cursor:grab;background:transparent;touch-action:none;`;
        appendActiveInteractionNode(hitArea, { kind: 'price-hit-area', price });
      }

      // 'none' keeps the line + drag hit-area but hands labelling over to the
      // cTrader-style control bars built alongside.
      if (options.labelVariant === 'none') return;

      const badge = document.createElement('div');
      bindChartUiTranslation(badge, () => {
        badge.textContent = options.getLabel?.() ?? labelText;
        badge.title = options.getTitle?.() ?? options.title ?? '';
      });
      badge.className = 'rtx-trade-level-badge';
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
      if (isLineTextLabel) badge.classList.add('rtx-trade-level-badge--line-text');
      badge.dataset.leftInset = String(leftInset);
      badge.dataset.display = isLineTextLabel ? 'block' : 'inline-flex';
      badge.style.cssText = isLineTextLabel
        ? `position:absolute;left:${leftInset}px;display:none;padding:0 2px;background:transparent;border:0;color:${color};font-size:var(--rtx-ui-font-size, 14px);font-family:Consolas,'Courier New',monospace;font-weight:var(--rtx-font-weight-control, 400);line-height:14px;white-space:nowrap;z-index:21;pointer-events:${canDrag ? 'auto' : 'none'};cursor:${canDrag ? 'grab' : 'default'};border-radius:0;transform:none;width:max-content;max-width:calc(100% - ${leftInset + 12}px);box-sizing:border-box;text-align:left;touch-action:none;letter-spacing:0;text-shadow:none;-webkit-font-smoothing:antialiased;text-rendering:optimizeLegibility;`
        : `position:absolute;left:${leftInset}px;display:none;align-items:center;justify-content:center;padding:1px 6px;background:${palette.background};border:1px solid ${palette.border};color:${palette.text};font-size:var(--rtx-ui-font-size, 14px);font-family:Consolas,'Courier New',monospace;font-weight:var(--rtx-font-weight-control, 400);white-space:nowrap;z-index:21;pointer-events:${canDrag ? 'auto' : 'none'};cursor:${canDrag ? 'grab' : 'default'};border-radius:2px;transform:translateY(-50%);width:max-content;min-width:52px;max-width:calc(100% - ${leftInset + 12}px);box-sizing:border-box;text-align:center;touch-action:none;-webkit-font-smoothing:antialiased;text-rendering:optimizeLegibility;${palette.shadow}`;
      appendOverlayNode(badge, { kind: 'price-badge', price }, 'active');
    };

    // ── cTrader-style position controls ────────────────────────────────────
    const getAccountCurrencyLabel = (): string => {
      const currency = String(useAppStore.getState().account?.currency || '').trim().toUpperCase();
      return currency || 'USD';
    };

    const getLocalizedTradeTitle = (trade: ActiveTradeSnapshot, role?: 'SL' | 'TP', price?: number) => [
      tr(trade.side),
      tr('{{value0}} lots', { value0: trade.volume }),
      tr('Ticket: {{value0}}', { value0: getTradeTicketLabel(trade.key) || trade.key }),
      role
        ? tr(role === 'SL' ? 'Stop Loss: {{value0}}' : 'Take Profit: {{value0}}', { value0: price ? formatTradeLevelBadgePrice(price) : '—' })
        : tr('Open price: {{value0}}', { value0: formatTradeLevelBadgePrice(trade.entryPrice) }),
      tr(role ? 'Modify Position' : 'Add stop loss and take profit'),
    ].join(' · ');

    const getTradeTicket = (tradeKey: string): number => {
      const ticket = Number.parseInt(tradeKey.replace(/^trade:/, ''), 10);
      return Number.isFinite(ticket) && ticket > 0 ? ticket : 0;
    };

    const findStorePosition = (ticket: number): any | null => {
      if (!ticket) return null;
      const positions = useAppStore.getState().positions;
      if (!Array.isArray(positions)) return null;
      return positions.find((position: any) => Number(position?.id ?? position?.ticket) === ticket) ?? null;
    };

    const getTradeClosePrice = (trade: ActiveTradeSnapshot): number => {
      const tick = resolveSymbolTick(useAppStore.getState().ticks);
      const closeQuote = trade.side === 'BUY' ? Number(tick?.bid) : Number(tick?.ask);
      if (Number.isFinite(closeQuote) && closeQuote > 0) return closeQuote;
      const live = activeTradeSnapshotsRef.current.get(trade.key)?.currentPrice ?? trade.currentPrice;
      return Number.isFinite(live) && live > 0 ? live : trade.entryPrice;
    };

    // Projected money at a level. Prefers scaling the backend-reported live
    // profit (keeps account-currency conversion authoritative); falls back to
    // a contract-size estimate when the live P/L baseline is too small.
    const estimateMoneyAtLevel = (trade: ActiveTradeSnapshot, levelPrice: number): number | null => {
      const position = findStorePosition(getTradeTicket(trade.key));
      const backendPnl = Number(position?.unrealizedPnL ?? position?.profit ?? position?.unrealized_pl);
      return estimateTradeLevelMoney({
        symbol: trade.symbol,
        side: trade.side,
        volume: trade.volume,
        entryPrice: trade.entryPrice,
        levelPrice,
        digits,
        backendPnl: Number.isFinite(backendPnl) ? backendPnl : null,
        currentPrice: getTradeClosePrice(trade),
        contractSize: Number(position?.contractSize ?? position?.contract_size) || undefined,
      });
    };

    const addTradeAxisPriceLine = (key: string, price: number, color: string, textColor = '#ffffff') => {
      if (!(price > 0) || !seriesRef.current) return;
      try {
        const priceLine = seriesRef.current.createPriceLine({
          price,
          color,
          lineWidth: 1,
          lineStyle: LineStyle.Dashed,
          lineVisible: false,
          axisLabelVisible: true,
          axisLabelColor: color,
          axisLabelTextColor: textColor,
          title: '',
        });
        tradeAxisPriceLinesRef.current.set(key, priceLine);
      } catch { }
    };

    // Optimistic SL/TP submission used by the level-bar ✕ buttons. Mirrors the
    // drag-release flow: override immediately, then reconcile or roll back.
    const submitTradeLevelChange = (
      tradeObj: ActiveTradeSnapshot,
      nextLevels: TradeLevelOverride,
      previousLevels: TradeLevelOverride,
      role: 'SL' | 'TP',
    ) => {
      const ticket = getTradeTicket(tradeObj.key);
      if (!ticket) return;
      const requestId = tradeLevelModifyRequestSeqRef.current + 1;
      tradeLevelModifyRequestSeqRef.current = requestId;
      const requestKeys = getTradeLevelStateKeys(tradeObj);
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

      setTradeLevelState(tradeLevelOverridesRef.current, tradeObj, { sl: nextLevels.sl || 0, tp: nextLevels.tp || 0 });
      setTradeLevelState(tradeLevelLastKnownLevelsRef.current, tradeObj, { sl: nextLevels.sl || 0, tp: nextLevels.tp || 0 });
      persistTradeLevelOverrides();
      rememberTradeHistoryPositionLevels([
        {
          id: ticket,
          symbol: tradeObj.symbol,
          side: tradeObj.side,
          volume: tradeObj.volume,
          entryPrice: tradeObj.entryPrice,
          entryTime: tradeObj.entryTime,
          sl: nextLevels.sl || 0,
          tp: nextLevels.tp || 0,
          price_sl: nextLevels.sl || 0,
          price_tp: nextLevels.tp || 0,
        },
      ], useAppStore.getState().accountId);
      window.dispatchEvent(new CustomEvent('rtx:flush-trade-overlay'));
      window.dispatchEvent(new CustomEvent('rtx:trade-modified', { detail: { id: ticket, sl: nextLevels.sl || 0, tp: nextLevels.tp || 0 } }));

      api.positions.modifyPosition(ticket, tradeLevelModifyPatch(role, role === 'SL' ? nextLevels.sl || 0 : nextLevels.tp || 0))
        .then(() => {
          if (!isCurrentRequest()) return;
          clearCurrentRequest();
          window.setTimeout(() => window.dispatchEvent(new Event('rtx:force-refresh-positions')), 250);
        })
        .catch((err) => {
          if (!isCurrentRequest()) return;
          clearCurrentRequest();
          requestKeys.forEach((key) => tradeLevelOptimisticGraceUntilRef.current.delete(key));
          console.error('[Chart] Failed to update SL/TP from level bar:', err);
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
    };

    const createEntryControlsForTrade = (
      trade: ActiveTradeSnapshot,
      levels: TradeLevelOverride,
      tradeOrdinal: number,
      totalTrades: number,
    ) => {
      const ticket = getTradeTicket(trade.key);
      if (!ticket) return;
      const lightSurface = isChartSurfaceLight();
      const ticketLabel = getTradeTicketLabel(trade.key);
      const entryPriceLabel = formatTradeLevelBadgePrice(trade.entryPrice);
      const currencyLabel = getAccountCurrencyLabel();

      const controlBar = createEntryTradeControlBar({
        tradeKey: trade.key,
        ticket,
        symbol: trade.symbol,
        side: trade.side,
        volume: trade.volume,
        isLightSurface: lightSurface,
        leftInset: TRADE_LEVEL_BADGE_LEFT_INSET_PX,
        currencyLabel,
        title: `${trade.side} ${trade.volume} ${ticketLabel} @ ${entryPriceLabel}. Drag above/below to create TP or SL.`,
        onShare: () => {
          const shareUrl = buildTradeShareUrl({
            version: 1,
            ticket,
            symbol: trade.symbol,
            timeframe: String(prevTimeframeRef.current || timeframe),
            side: trade.side,
            volume: trade.volume,
            entryPrice: trade.entryPrice,
            entryTime: trade.entryTime,
            sl: levels.sl || 0,
            tp: levels.tp || 0,
          });
          void copyTextToClipboard(shareUrl).then((copied) => {
            window.dispatchEvent(new CustomEvent('rtx:order-feedback', {
              detail: copied
                ? { message: `${tr('Copied')} · ${tr('Trade')} URL: ${ticketLabel || trade.symbol}`, type: 'success' }
                : { message: `${tr('Copy')} · ${tr('Failed')}`, type: 'error' },
            }));
          });
        },
      });
      bindChartUiTranslation(controlBar.root, () => { controlBar.root.title = getLocalizedTradeTitle(trade); });
      // The bar sits exactly on the entry line so bar, dashed line and the
      // right-scale price box always share one horizontal line — overlapping
      // bars from same-price trades are expected (cTrader behaviour).
      appendOverlayNode(controlBar.root, { kind: 'price-badge', price: trade.entryPrice }, 'active');

      const refreshLiveMetrics = () => {
        const closePrice = getTradeClosePrice(trade);
        const pips = computeSignedPips(trade.side, trade.entryPrice, closePrice, digits);
        const position = findStorePosition(ticket);
        const backendPnl = Number(position?.unrealizedPnL ?? position?.profit ?? position?.unrealized_pl);
        const money = position && Number.isFinite(backendPnl)
          ? backendPnl
          : estimateTradeMoneyAtPrice({
            symbol: trade.symbol,
            side: trade.side,
            volume: trade.volume,
            entryPrice: trade.entryPrice,
            price: closePrice,
          });
        controlBar.setLiveMetrics(pips, money);
      };
      tradeControlLiveUpdatersRef.current.push(refreshLiveMetrics);
      refreshLiveMetrics();

      addTradeAxisPriceLine(`${trade.key}:entry`, trade.entryPrice, getEntryLineColor(trade.side));

      // Docked SL/TP handles while the level does not exist yet. SL sits on the
      // losing side of the entry line, TP on the winning side.
      const dockSuffix = totalTrades > 1 ? ` ${tradeOrdinal}` : '';
      const slDockOffset = trade.side === 'SELL' ? -22 : 22;
      if (!(levels.sl > 0)) {
        const slChip = createDockedLevelChip({
          tradeKey: trade.key,
          role: 'SL',
          label: `SL${dockSuffix}`,
          isLightSurface: lightSurface,
          leftInset: TRADE_LEVEL_BADGE_LEFT_INSET_PX,
          title: `Drag to set Stop Loss for ${ticketLabel || trade.key}`,
        });
        bindChartUiTranslation(slChip, () => { slChip.title = getLocalizedTradeTitle(trade, 'SL'); });
        appendOverlayNode(slChip, { kind: 'price-badge', price: trade.entryPrice, pixelOffsetY: slDockOffset }, 'active');
      }
      if (!(levels.tp > 0)) {
        const tpChip = createDockedLevelChip({
          tradeKey: trade.key,
          role: 'TP',
          label: `TP${dockSuffix}`,
          isLightSurface: lightSurface,
          leftInset: TRADE_LEVEL_BADGE_LEFT_INSET_PX,
          title: `Drag to set Take Profit for ${ticketLabel || trade.key}`,
        });
        bindChartUiTranslation(tpChip, () => { tpChip.title = getLocalizedTradeTitle(trade, 'TP'); });
        appendOverlayNode(tpChip, { kind: 'price-badge', price: trade.entryPrice, pixelOffsetY: -slDockOffset }, 'active');
      }
    };

    const createLevelControlsForTrade = (
      trade: ActiveTradeSnapshot,
      role: 'SL' | 'TP',
      levels: TradeLevelOverride,
    ) => {
      const levelPrice = role === 'SL' ? levels.sl : levels.tp;
      if (!(levelPrice > 0)) return;
      const lightSurface = isChartSurfaceLight();
      const ticketLabel = getTradeTicketLabel(trade.key);
      const levelBar = createTradeLevelControlBar({
        tradeKey: trade.key,
        role,
        side: trade.side,
        label: role,
        pips: computeSignedPips(trade.side, trade.entryPrice, levelPrice, digits),
        money: estimateMoneyAtLevel(trade, levelPrice),
        isLightSurface: lightSurface,
        leftInset: TRADE_LEVEL_BADGE_LEFT_INSET_PX,
        currencyLabel: getAccountCurrencyLabel(),
        title: `${role === 'SL' ? 'Stop Loss' : 'Take Profit'} for ${ticketLabel || trade.key} @ ${formatTradeLevelBadgePrice(levelPrice)}. Drag to move.`,
        onRemove: () => submitTradeLevelChange(
          trade,
          role === 'SL' ? { sl: 0, tp: levels.tp || 0 } : { sl: levels.sl || 0, tp: 0 },
          { sl: levels.sl || 0, tp: levels.tp || 0 },
          role,
        ),
      });
      bindChartUiTranslation(levelBar, () => { levelBar.title = getLocalizedTradeTitle(trade, role, levelPrice); });
      appendOverlayNode(levelBar, { kind: 'price-badge', price: levelPrice }, 'active');
      addTradeAxisPriceLine(
        `${trade.key}:${role.toLowerCase()}`,
        levelPrice,
        lightSurface ? '#334155' : '#2a2e39',
        '#ffffff',
      );
    };
    // ── end cTrader-style position controls ────────────────────────────────

    const pruneCloseSuppressedTradeKeys = (now = Date.now()) => {
      closeSuppressedTradeKeysRef.current.forEach((expiresAt, key) => {
        if (expiresAt <= now) {
          closeSuppressedTradeKeysRef.current.delete(key);
          crossCloseGuessedTradeKeysRef.current.delete(key);
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
      const showTradeLevels = chartProperties.showTradeLevels !== false
        && !getChartObjectState(
          useChartObjectStateStore.getState().byContext,
          drawingRuntimeContextRef.current.contextId,
        ).tradesHidden;
      const showTradeHistory = chartProperties.showTradeHistory !== false;
      const showTradeHistoryArrows = chartProperties.showTradeHistoryArrows !== false;
      const showAnyTradeHistoryOverlay = showTradeHistory || showTradeHistoryArrows;
      const tradeHistoryLineOpacityPercent = clampChartOpacityPercent(
        chartProperties.tradeHistoryLineOpacity,
        defaultChartProperties.tradeHistoryLineOpacity,
      );
      const tradeHistoryLineOpacity = tradeHistoryLineOpacityPercent / 100;
      const appState = useAppStore.getState();
      const appPositions = Array.isArray(appState.positions) ? appState.positions : [];
      const appTrades = Array.isArray(appState.trades) ? appState.trades : [];
      const liveTrailTime = getLiveTrailTime();
      const isMatchingTradeSymbol = (rawSymbol: unknown) => {
        const positionSymbol = String(rawSymbol || '').trim().toUpperCase();
        if (!positionSymbol) return false;
        return positionSymbol === normalizedChartSymbol;
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
        const positionSymbol = String(position.symbol || '').trim().toUpperCase();
        if (!position.id || !positionSymbol) return false;
        // FIX: Never render or manage a different suffix contract's position.
        return Number(position.volume) > 0 && positionSymbol === normalizedChartSymbol;
      });

      const nextActiveSnapshots = new Map<string, ActiveTradeSnapshot>();

      for (const position of matchingPositions) {
        const key = `trade:${String(position.id)}`;
        if (closeSuppressedTradeKeys.has(key)) {
          if (crossCloseGuessedTradeKeysRef.current.has(key)) {
            // The level-cross close was only a guess and the broker feed still
            // reports the position open — the guess was wrong. Lift the
            // suppression and drop the fake closed snapshot so the live
            // controls come back on this very render.
            crossCloseGuessedTradeKeysRef.current.delete(key);
            closeSuppressedTradeKeysRef.current.delete(key);
            closeSuppressedTradeKeys.delete(key);
            optimisticClosedTradeSnapshotsRef.current.delete(key);
            forgetTradeOverlayOptimisticClosedSnapshot(key);
            pendingClosedTradeSnapshotsRef.current.delete(key);
          } else {
            pendingMissingActiveTradesRef.current.delete(key);
            continue;
          }
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
          entryExecutionTime: rawEntryTime ?? entryTime,
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
        const crossCandidateArmed = crossedLevelCandidateExpiresAt > now;
        // Guess a level-cross close only after a real dwell AND while the
        // positions feed itself is alive (it still reports some position). A
        // dead feed loses every trade at once — that is a backend outage, not
        // a fill, and open trades must not be painted as closed.
        if (
          crossCandidateArmed
          && elapsedMs >= TRADE_LEVEL_CROSS_CLOSE_MIN_MISSING_MS
          && appPositions.length > 0
        ) {
          const closedTrade = buildImmediateClosedTrade(pending.trade);
          if (closedTrade) {
            optimisticClosedTradeSnapshotsRef.current.set(key, closedTrade);
          }
          pendingClosedTradeSnapshotsRef.current.delete(key);
          pendingMissingActiveTradesRef.current.delete(key);
          closeSuppressedTradeKeysRef.current.set(key, now + TRADE_OVERLAY_CLOSE_SUPPRESSION_TTL_MS);
          crossCloseGuessedTradeKeysRef.current.add(key);
          tradeLevelCrossCloseCandidatesRef.current.delete(key);
          tradeLevelCrossRefreshPendingRef.current.delete(key);
          didClearCrossClosedTradeLevels = clearTradeLevelRuntimeState(pending.trade) || didClearCrossClosedTradeLevels;
          scheduleHistoryRefresh();
          return;
        }

        // Retain until the trade is PROVEN closed — a close event, a closed
        // history row, or an evidenced level-cross. Feed gaps and backend
        // outages of any length must never hide open trades; only the settings
        // toggle or a real close removes the on-chart controls.
        renderActiveSnapshots.set(key, pending.trade);
        visuallyRetainedActiveTradeKeys.add(key);
        if (crossCandidateArmed) {
          const remainingMs = Math.max(50, TRADE_LEVEL_CROSS_CLOSE_MIN_MISSING_MS - elapsedMs);
          nextMissingGraceDelayMs = nextMissingGraceDelayMs == null
            ? remainingMs
            : Math.min(nextMissingGraceDelayMs, remainingMs);
        }
        if (elapsedMs >= TRADE_MISSING_POSITION_GRACE_MS) {
          // Keep nudging history so a genuinely closed trade gets its closed
          // row and leaves retention through the proven path.
          scheduleHistoryRefresh();
        }
      });

      if (didClearCrossClosedTradeLevels) persistTradeLevelOverrides();

      // Keep retained fills in the live snapshot map so a lagged empty store
      // cannot drop on-chart open trades on the next overlay pass.
      activeTradeSnapshotsRef.current = renderActiveSnapshots;

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

      if (showAnyTradeHistoryOverlay) {
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
          } else if (existingTrade) {
            registerClosedTrade({
              ...existingTrade,
              entryExecutionTime: trade.entryExecutionTime,
              exitExecutionTime: trade.exitExecutionTime,
            });
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
      const closedSignature = showAnyTradeHistoryOverlay
        ? Array.from(closedTrades.values())
          .sort((a, b) => a.key.localeCompare(b.key))
          .map((trade) => [
            trade.key,
            trade.side,
            trade.volume,
            trade.entryTime,
            trade.exitTime,
            trade.entryExecutionTime,
            trade.exitExecutionTime,
            formatSignaturePrice(trade.entryPrice),
            formatSignaturePrice(trade.exitPrice),
            trade.source,
          ].join(':')).join('|')
        : '';
      const sharedTradeForSignature = getSharedChartTrade();
      const sharedTradeSignature = sharedTradeForSignature && sharedTradeForSignature.symbol === normalizedChartSymbol
        ? `shared:${sharedTradeForSignature.ticket}:${activeTradeKeys.has(`trade:${sharedTradeForSignature.ticket}`) ? 'live' : 'annotated'}`
        : 'shared:none';
      const nextActiveSignature = [
        normalizedChartSymbol,
        timeframe,
        TRADE_HISTORY_PRESENTATION_VERSION,
        showTradeLevels ? 'levels:on' : 'levels:off',
        sharedTradeSignature,
        activeSignature,
      ].join('\n');
      const nextHistorySignature = [
        normalizedChartSymbol,
        timeframe,
        TRADE_HISTORY_PRESENTATION_VERSION,
        showTradeHistory ? 'history-lines:on' : 'history-lines:off',
        showTradeHistoryArrows ? 'arrows:on' : 'arrows:off',
        `line-opacity:${tradeHistoryLineOpacityPercent}`,
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

            // Keep the control bars rendered while a position momentarily
            // drops out of the store (REST refresh / WS reconnect gaps). A
            // live<->retained flap must not blink the on-chart controls; only
            // the settings toggle or a real close removes them.
            const showTradeControls = isLiveActiveTrade || isVisuallyRetainedTrade;
            const entryStackIndex = nextLevelOffset('ENTRY', trade.entryPrice);
            createPriceLevel(
              `${trade.side} ${ticketLabel} ${trade.volume} at ${entryPriceLabel}`.trim(),
              trade.entryPrice,
              entryColor,
              {
                tradeKey: isLiveActiveTrade ? trade.key : undefined,
                role: isLiveActiveTrade ? 'ENTRY' : undefined,
                badgeOffsetIndex: showTradeControls ? 0 : entryStackIndex,
                title: isLiveActiveTrade ? `${markerTitle}. Drag above/below to create TP or SL.` : markerTitle,
                getTitle: () => getLocalizedTradeTitle(trade),
                getLabel: () => `${tr(trade.side)} ${ticketLabel} ${tr('{{value0}} lots', { value0: trade.volume })} @ ${entryPriceLabel}`,
                // The control bar replaces the plain text label.
                labelVariant: showTradeControls ? 'none' : 'lineText',
                lineColor: getEntryLineColor(trade.side),
              },
            );

            const levels = isLiveActiveTrade || isVisuallyRetainedTrade ? resolveTradeLevels(trade) : { sl: 0, tp: 0 };

            if (showTradeControls) {
              createEntryControlsForTrade(
                trade,
                levels,
                sortedActiveSnapshots.indexOf(trade) + 1,
                sortedActiveSnapshots.length,
              );
            }

            if (levels.sl && levels.sl > 0) {
              const stopLossPriceLabel = formatTradeLevelBadgePrice(levels.sl);
              const slStackIndex = nextLevelOffset('SL', levels.sl);
              createPriceLevel(`SL ${ticketLabel} ${stopLossPriceLabel}`.trim(), levels.sl, TRADE_SELL_COLOR, {
                tradeKey: isLiveActiveTrade ? trade.key : undefined,
                role: isLiveActiveTrade ? 'SL' : undefined,
                badgeOffsetIndex: showTradeControls ? 0 : slStackIndex,
                title: isVisuallyRetainedTrade
                  ? `Stop Loss for ${ticketLabel || trade.key} @ ${stopLossPriceLabel}. Waiting for position refresh.`
                  : `Stop Loss for ${ticketLabel || trade.key} @ ${stopLossPriceLabel}`,
                getTitle: () => `${getLocalizedTradeTitle(trade, 'SL', levels.sl)}${isVisuallyRetainedTrade ? ` · ${tr('Loading open positions...')}` : ''}`,
                getLabel: () => `${tr('SL')} ${ticketLabel} ${stopLossPriceLabel}`,
                labelVariant: showTradeControls ? 'none' : 'lineText',
              });
              if (showTradeControls) {
                createLevelControlsForTrade(trade, 'SL', levels);
              }
            }
            if (levels.tp && levels.tp > 0) {
              const takeProfitPriceLabel = formatTradeLevelBadgePrice(levels.tp);
              const tpStackIndex = nextLevelOffset('TP', levels.tp);
              createPriceLevel(`TP ${ticketLabel} ${takeProfitPriceLabel}`.trim(), levels.tp, TRADE_BUY_COLOR, {
                tradeKey: isLiveActiveTrade ? trade.key : undefined,
                role: isLiveActiveTrade ? 'TP' : undefined,
                badgeOffsetIndex: showTradeControls ? 0 : tpStackIndex,
                title: isVisuallyRetainedTrade
                  ? `Take Profit for ${ticketLabel || trade.key} @ ${takeProfitPriceLabel}. Waiting for position refresh.`
                  : `Take Profit for ${ticketLabel || trade.key} @ ${takeProfitPriceLabel}`,
                getTitle: () => `${getLocalizedTradeTitle(trade, 'TP', levels.tp)}${isVisuallyRetainedTrade ? ` · ${tr('Loading open positions...')}` : ''}`,
                getLabel: () => `${tr('TP')} ${ticketLabel} ${takeProfitPriceLabel}`,
                labelVariant: showTradeControls ? 'none' : 'lineText',
              });
              if (showTradeControls) {
                createLevelControlsForTrade(trade, 'TP', levels);
              }
            }
          });

          // A trade opened from a share link renders as an annotation drawn
          // purely from the URL payload, so the shared view keeps showing the
          // trade even after the position closes. Suppressed while the same
          // ticket is still live (the live control bar already shows it).
          const sharedTrade = getSharedChartTrade();
          if (
            sharedTrade
            && sharedTrade.symbol === normalizedChartSymbol
            && !activeTradeKeys.has(`trade:${sharedTrade.ticket}`)
          ) {
            const sharedColor = getEntryLineColor(sharedTrade.side);
            const sharedTicketLabel = sharedTrade.ticket > 0 ? `#${sharedTrade.ticket} ` : '';
            const sharedLabel = `Shared ${sharedTrade.side} ${sharedTicketLabel}${sharedTrade.volume} at ${formatTradeLevelBadgePrice(sharedTrade.entryPrice)}`.trim();
            createPriceLevel(sharedLabel, sharedTrade.entryPrice, sharedColor, {
              badgeOffsetIndex: nextLevelOffset('ENTRY', sharedTrade.entryPrice),
              title: `${sharedLabel} (from share link)`,
              labelVariant: 'lineText',
              lineColor: sharedColor,
            });
            addTradeAxisPriceLine(`shared:${sharedTrade.ticket}:entry`, sharedTrade.entryPrice, sharedColor);
            if (sharedTrade.entryTime > 0) {
              createTradeMarker(sharedTrade.side, sharedTrade.entryPrice, sharedTrade.entryTime, sharedLabel, sharedColor, 'active', 0.9);
            }
            if (sharedTrade.sl > 0) {
              createPriceLevel(`SL ${formatTradeLevelBadgePrice(sharedTrade.sl)}`, sharedTrade.sl, TRADE_SELL_COLOR, {
                badgeOffsetIndex: nextLevelOffset('SL', sharedTrade.sl),
                title: `Shared Stop Loss @ ${formatTradeLevelBadgePrice(sharedTrade.sl)}`,
                labelVariant: 'lineText',
              });
            }
            if (sharedTrade.tp > 0) {
              createPriceLevel(`TP ${formatTradeLevelBadgePrice(sharedTrade.tp)}`, sharedTrade.tp, TRADE_BUY_COLOR, {
                badgeOffsetIndex: nextLevelOffset('TP', sharedTrade.tp),
                title: `Shared Take Profit @ ${formatTradeLevelBadgePrice(sharedTrade.tp)}`,
                labelVariant: 'lineText',
              });
            }
          }
        }
      }

      if (historyChanged) {
        clearTradeOverlayLayer('history');
        lastHistoryTradeOverlaySignatureRef.current = nextHistorySignature;

        if (showAnyTradeHistoryOverlay) {
          closedTrades.forEach((trade) => {
            const entryColor = getHistoryEntryColor(trade.side);
            const exitSide = getTradeHistoryExecutionSide(trade.side, 'CLOSE');
            if (showTradeHistory) {
              createTradeSegment(trade.entryPrice, trade.entryTime, deriveClosedTradeColor(trade), 'solid', 'history', trade.exitPrice, trade.exitTime, undefined, undefined, tradeHistoryLineOpacity);
            }
            if (showTradeHistoryArrows) {
              const entryPriceLabel = formatTradeLevelBadgePrice(trade.entryPrice);
              createTradeMarker(trade.side, trade.entryPrice, trade.entryTime, entryPriceLabel, entryColor, 'history', 1, undefined, 'open', trade.side, trade.entryExecutionTime);
            }
            if (showTradeHistoryArrows) {
              const closePriceLabel = formatTradeLevelBadgePrice(trade.exitPrice);
              createTradeMarker(exitSide, trade.exitPrice, trade.exitTime, closePriceLabel, getHistoryExitColor(trade.side), 'history', 1, undefined, 'close', trade.side, trade.exitExecutionTime);
            }
          });
        }
      }

      // Rebuilt nodes are created hidden; place them in this same frame when
      // the chart is idle so a rebuild never paints an empty overlay. Always
      // queue a follow-up layout too: the first pass can run before the series
      // has coordinates after a fill, which would otherwise leave open trades hidden.
      if (isChartInteractionActiveRef.current) {
        queueTradeOverlayRelayout();
      } else {
        updateLabelPositions();
        queueTradeOverlayRelayout();
      }
    };

    renderTradeOverlay();

    const timeScaleHandler = () => queueTradeOverlayRelayout();
    chartRef.current.timeScale().subscribeVisibleLogicalRangeChange(timeScaleHandler);

    const unsubscribeAppStore = useAppStore.subscribe((state, previousState) => {
      const currentTick = resolveSymbolTick(state.ticks);
      const previousTick = resolveSymbolTick(previousState.ticks);

      if (state.positions !== previousState.positions || state.trades !== previousState.trades) {
        renderTradeOverlay();
        return;
      }

      if (
        isActiveRef.current
        &&
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
        || currentProperties.showTradeHistoryArrows !== previousProperties.showTradeHistoryArrows
        || currentProperties.tradeHistoryLineOpacity !== previousProperties.tradeHistoryLineOpacity
      ) {
        renderTradeOverlay(true);
      }
    });

    const unsubscribeChartObjectState = useChartObjectStateStore.subscribe((state, previousState) => {
      const contextId = drawingRuntimeContextRef.current.contextId;
      if (
        getChartObjectState(state.byContext, contextId).tradesHidden
        !== getChartObjectState(previousState.byContext, contextId).tradesHidden
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
          crossCloseGuessedTradeKeysRef.current.delete(key);
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
          // A real close request owns this suppression from here on; the
          // level-cross guess marker must not lift it on stale snapshots.
          crossCloseGuessedTradeKeysRef.current.delete(key);
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
    const handleNewTradePlaced = () => renderTradeOverlay({ forceActive: true });
    window.addEventListener('rtx:force-refresh-positions', handleForceRefresh);
    window.addEventListener('rtx:refresh-trade-overlay', handleRefreshTradeOverlay);
    window.addEventListener('rtx:flush-trade-overlay', handleFlushTradeOverlay);
    window.addEventListener('rtx:new-trade-placed', handleNewTradePlaced);
    window.addEventListener(TRADE_OVERLAY_CLOSE_STATE_EVENT, handleTradeOverlayCloseState);

    return () => {
      unsubscribeAppStore();
      unsubscribeChartSettings();
      unsubscribeChartObjectState();
      window.removeEventListener('rtx:force-refresh-positions', handleForceRefresh);
      window.removeEventListener('rtx:refresh-trade-overlay', handleRefreshTradeOverlay);
      window.removeEventListener('rtx:flush-trade-overlay', handleFlushTradeOverlay);
      window.removeEventListener('rtx:new-trade-placed', handleNewTradePlaced);
      window.removeEventListener(TRADE_OVERLAY_CLOSE_STATE_EVENT, handleTradeOverlayCloseState);
      try { chartRef.current?.timeScale().unsubscribeVisibleLogicalRangeChange(timeScaleHandler); } catch { }
      clearTradeOverlayVisualRuntime();
    };
  }, [brokerTimeOffsetSec, clearTradeOverlayLayer, clearTradeOverlayVisualRuntime, getNearestCandleByTime, hydrateTradeLevelOverrides, isLivePriceSafeForCandles, persistTradeLevelOverrides, resolvedPriceDigits, symbol, timeframe, TRADE_HISTORY_PRESENTATION_VERSION, updateLabelPositions]);

  // Relabel existing overlays in place. Changing the interface language must
  // not recreate the chart, reset its viewport, or interrupt a level drag.
  useEffect(() => {
    const host = overlayRef.current?.parentElement ?? overlayRef.current;
    if (!host) return;
    refreshChartUiTranslations(host);
    host.querySelectorAll<HTMLElement>('[data-chart-ui-label]').forEach(label => {
      label.textContent = tr(label.dataset.chartUiLabel || '');
    });
    host.querySelectorAll<HTMLElement>('.rtx-trade-marker-hover-target').forEach(marker => {
      const side = marker.dataset.positionSide;
      const lifecycle = marker.dataset.tradeLifecycle;
      if (!side || !lifecycle) return;
      const sourceHeader = `${side} ${lifecycle === 'open' ? 'OPEN' : 'CLOSE'}`;
      const translatedHeader = `${tr(side)} ${tr(lifecycle === 'open' ? 'Open' : 'Close')}`;
      const header = marker.querySelector<HTMLElement>('.rtx-trade-marker__tooltip-header');
      if (header) header.textContent = translatedHeader;
      const accessibleLabel = marker.dataset.historyAccessibleLabel;
      if (accessibleLabel) marker.setAttribute('aria-label', accessibleLabel.replace(sourceHeader, translatedHeader));
    });
  }, [tr]);

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
      const digits = resolvedPriceDigits;
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
        const labelColor = isChartSurfaceLight()
          ? (isBuyLabel ? '#1d4ed8' : '#b91c1c')
          : (isBuyLabel ? '#26a69a' : '#ef5350');
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
          font-size: var(--rtx-ui-font-size, 14px);
          font-family: Consolas, 'Courier New', monospace;
          font-weight: var(--rtx-font-weight-control, 400);
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
          font-size: var(--rtx-ui-font-size, 14px);
          font-family: Consolas, 'Courier New', monospace;
          font-weight: var(--rtx-font-weight-control, 400);
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
        ? `<svg width="11" height="14" viewBox="0 0 22 28" fill="none" aria-hidden="true" style="display:block;overflow:visible"><path d="M11 3L18.5 14.5H13.6V25H8.4V14.5H3.5Z" fill="#2962FF" stroke="#0f172a" stroke-width="1.8" stroke-linejoin="miter" stroke-miterlimit="4" paint-order="stroke fill"/></svg>`
        : `<svg width="11" height="14" viewBox="0 0 22 28" fill="none" aria-hidden="true" style="display:block;overflow:visible"><path d="M11 25L18.5 13.5H13.6V3H8.4V13.5H3.5Z" fill="#ef5350" stroke="#0f172a" stroke-width="1.8" stroke-linejoin="miter" stroke-miterlimit="4" paint-order="stroke fill"/></svg>`;
      entryArrow.style.cssText = `position: absolute; z-index: 12; pointer-events: none; filter: drop-shadow(0 1px 0 rgba(15,23,42,0.28));`;
      overlayEl.appendChild(entryArrow);
      positionLabelsRef.current.push(entryArrow);
      positionLabelDataRef.current.push({ price: entryPrice, time: entryTime, text: '', color, isPin: true, isBuyDeal: isBuy });

      // The Exit arrow (opposite direction shape)
      const exitArrow = document.createElement('div');
      exitArrow.className = 'rtx-history-arrow-exit';
      exitArrow.title = `Trade OUT: ${isBuy ? 'SELL' : 'BUY'} ${volume} @ ${exitPrice}`;
      exitArrow.innerHTML = isBuy
        ? `<svg width="11" height="14" viewBox="0 0 22 28" fill="none" aria-hidden="true" style="display:block;overflow:visible"><path d="M11 25L18.5 13.5H13.6V3H8.4V13.5H3.5Z" fill="#ef5350" stroke="#0f172a" stroke-width="1.8" stroke-linejoin="miter" stroke-miterlimit="4" paint-order="stroke fill"/></svg>`
        : `<svg width="11" height="14" viewBox="0 0 22 28" fill="none" aria-hidden="true" style="display:block;overflow:visible"><path d="M11 3L18.5 14.5H13.6V25H8.4V14.5H3.5Z" fill="#2962FF" stroke="#0f172a" stroke-width="1.8" stroke-linejoin="miter" stroke-miterlimit="4" paint-order="stroke fill"/></svg>`;
      exitArrow.style.cssText = `position: absolute; z-index: 12; pointer-events: none; filter: drop-shadow(0 1px 0 rgba(15,23,42,0.28));`;
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
        ? `<svg width="11" height="14" viewBox="0 0 22 28" fill="none" aria-hidden="true" style="display:block;overflow:visible"><path d="M11 3L18.5 14.5H13.6V25H8.4V14.5H3.5Z" fill="#2962FF" stroke="#0f172a" stroke-width="1.8" stroke-linejoin="miter" stroke-miterlimit="4" paint-order="stroke fill"/></svg>`
        : `<svg width="11" height="14" viewBox="0 0 22 28" fill="none" aria-hidden="true" style="display:block;overflow:visible"><path d="M11 25L18.5 13.5H13.6V3H8.4V13.5H3.5Z" fill="#ef5350" stroke="#0f172a" stroke-width="1.8" stroke-linejoin="miter" stroke-miterlimit="4" paint-order="stroke fill"/></svg>`;

      pin.style.cssText = `
        position: absolute;
        width: 11px;
        height: 14px;
        z-index: 20;
        pointer-events: none;
        filter: drop-shadow(0 1px 0 rgba(15,23,42,0.28));
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

      // FIX: Legacy overlay rendering follows exact broker identity as well.
      const normalizedChartSymbol = symbol.trim().toUpperCase();
      const myPositions = positions.filter(p => {
        const posSymbol = String(p.symbol || '').trim().toUpperCase();
        const matchesSymbol = posSymbol === normalizedChartSymbol;
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
        const digits = resolvedPriceDigits;

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

      mt5HistoryDeals.filter(d => String(d.symbol || '').trim().toUpperCase() === normalizedChartSymbol).forEach(d => {
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
      appTrades.filter((t: any) => String(t.symbol || '').trim().toUpperCase() === normalizedChartSymbol).forEach((t: any) => {
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

    let positionLabelRaf: number | null = null;
    const queuePositionLabelUpdate = () => {
      if (positionLabelRaf !== null) return;
      positionLabelRaf = requestAnimationFrame(() => {
        positionLabelRaf = null;
        updateLabelPositions();
      });
    };
    const schedulePositionLabelUpdate = () => {
      if (isChartInteractionActiveRef.current) {
        postInteractionCoordinatorRef.current?.request({ overlay: true });
        return;
      }

      queuePositionLabelUpdate();
    };

    // Also update on time scale changes (scroll, zoom)
    const timeScaleHandler = () => {
      schedulePositionLabelUpdate();
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
      if (positionLabelRaf !== null) {
        cancelAnimationFrame(positionLabelRaf);
        positionLabelRaf = null;
      }
      if (chartRef.current) {
        try { chartRef.current.timeScale().unsubscribeVisibleLogicalRangeChange(timeScaleHandler); } catch { }
      }
      cleanup();
    };
  }, [symbol, chartType, resolvedPriceDigits, updateLabelPositions, candlesLoadedRev]);


  // ── Context menu handlers ──────────────────────────────────────────────────
  const handleContextMenu = useCallback((e: React.MouseEvent) => {
    e.preventDefault(); // Block the browser's native right-click menu
    activateActiveChartSource(activeChartSourceId);

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
  }, [activeChartSourceId]);

  const closeCtxMenu = useCallback(() => {
    setCtxMenu(prev => ({ ...prev, visible: false }));
  }, []);

  const handleCtxChartTypeChange = useCallback((type: ChartType) => {
    setLocalChartType(type);
    commandBus.dispatch({
      type: 'SET_CHART_TYPE',
      payload: { chartType: type, targetContextId: activeChartSourceId },
    });
  }, [activeChartSourceId]);

  const handleCtxTimeframeChange = useCallback((tf: Timeframe) => {
    commandBus.dispatch({
      type: 'SET_TIMEFRAME' as any,
      payload: { timeframe: tf, targetContextId: activeChartSourceId, panelId },
    });
  }, [activeChartSourceId, panelId]);

  const handleCtxToggleGrid = useCallback(() => {
    const next = !chartSettingsRef.current.showGrid;
    useChartSettingsStore.getState().updateSymbolProperty(symbol, 'showGrid', next);
  }, [symbol]);

  const handleCtxToggleVolumes = useCallback(() => {
    const store = useChartSettingsStore.getState();
    const currentProperties = store.symbolProperties[symbol] || store.globalProperties;
    const next = !(currentProperties.showTickVolumes || currentProperties.showRealVolumes);
    store.updateSymbolProperty(symbol, 'showTickVolumes', next);
    store.updateSymbolProperty(symbol, 'showRealVolumes', false);
  }, [symbol]);

  const handleCtxToggleAutoScroll = useCallback(() => {
    setCtxAutoScroll(prev => {
      const next = !prev;
      useChartSettingsStore.getState().updateSymbolProperty(symbol, 'chartAutoScroll', next);
      commandBus.dispatch({
        type: 'SET_AUTO_SCROLL',
        payload: { enabled: next, targetContextId: activeChartSourceId },
      });
      return next;
    });
  }, [activeChartSourceId, symbol]);

  const handleCtxToggleChartShift = useCallback(() => {
    setCtxChartShift(prev => {
      const next = !prev;
      useChartSettingsStore.getState().updateSymbolProperty(symbol, 'chartShift', next);
      commandBus.dispatch({
        type: 'SET_CHART_SHIFT',
        payload: { enabled: next, targetContextId: activeChartSourceId },
      });
      return next;
    });
  }, [activeChartSourceId, symbol]);

  const handleCtxToggleTradeLevels = useCallback(() => {
    setCtxShowTradeLevels(prev => {
      const next = !prev;
      useChartSettingsStore.getState().updateSymbolProperty(symbol, 'showTradeLevels', next);
      window.dispatchEvent(new CustomEvent('rtx:flush-trade-overlay'));
      return next;
    });
  }, [symbol]);

  const handleCtxToggleTradeHistory = useCallback(() => {
    setCtxShowTradeHistory(prev => {
      const next = !prev;
      const store = useChartSettingsStore.getState();
      store.updateSymbolProperty(symbol, 'showTradeHistory', next);
      window.dispatchEvent(new CustomEvent('rtx:flush-trade-overlay'));
      return next;
    });
  }, [symbol]);

  const handleCtxZoomIn = useCallback(() => {
    commandBus.dispatch({ type: 'ZOOM_IN', payload: { targetContextId: activeChartSourceId } });
  }, [activeChartSourceId]);

  const handleCtxZoomOut = useCallback(() => {
    commandBus.dispatch({ type: 'ZOOM_OUT', payload: { targetContextId: activeChartSourceId } });
  }, [activeChartSourceId]);

  const handleCtxDeleteIndicators = clearLocalIndicators;

  const handleOpenTemplateDialog = (mode: 'save' | 'load') => {
    setTemplateDialogMode(mode);
    setTemplateDialogOpen(true);
  };

  const handleLoadTemplate = (template: ChartTemplate) => {
    // Apply template settings
    setLocalChartType(template.chartType as ChartType);
    commandBus.dispatch({
      type: 'SET_CHART_TYPE',
      payload: { chartType: template.chartType as ChartType, targetContextId: activeChartSourceId },
    });
    commandBus.dispatch({
      type: 'SET_TIMEFRAME' as any,
      payload: { timeframe: template.timeframe, targetContextId: activeChartSourceId, panelId },
    });

    const settingsStore = useChartSettingsStore.getState();
    settingsStore.updateSymbolProperty(symbol, 'showGrid', template.showGrid);
    settingsStore.updateSymbolProperty(symbol, 'showTickVolumes', template.showVolumes);
    settingsStore.updateSymbolProperty(symbol, 'showRealVolumes', false);

    localIndicatorManager.clearAll();
    for (const indicator of template.indicators) {
      addLocalIndicator({
        id: indicator.id,
        name: indicator.name,
        indicatorType: indicator.type,
        params: indicator.parameters,
      });
    }
    refreshCurrentIndicators();
    persistCurrentIndicators();

    squareGridPrimitiveRef.current?.applyOptions({
      visible: template.showGrid,
      cellSizeCssPx: SQUARE_CHART_GRID_CELL_SIZE_PX,
      verticalColor: chartTheme.gridVertical,
      horizontalColor: chartTheme.gridHorizontal,
    });
    console.log('[TradingChart] Loading template:', template);
    setTemplateDialogOpen(false);
  };

  const handleCtxOpenNewOrder = useCallback(() => {
    window.dispatchEvent(new CustomEvent('openNewOrder', { detail: { symbol, targetContextId: activeChartSourceId } }));
  }, [activeChartSourceId, symbol]);

  const handleCtxOpenDOM = useCallback(() => {
    window.dispatchEvent(new CustomEvent('openDepthOfMarket', { detail: { symbol } }));
  }, [symbol]);

  const handleCtxRefresh = useCallback(() => {
    loadHistory(symbol, prevTimeframeRef.current || timeframe);
  }, [loadHistory, symbol, timeframe]);

  const handleCtxSaveAsPicture = useCallback(() => {
    captureFullPage();
  }, []);

  const handleCtxOpenProperties = useCallback(() => {
    window.dispatchEvent(new CustomEvent('openChartProperties', {
      detail: {
        symbol,
        timeframe: activeTimeframe,
        targetContextId: activeChartSourceId,
      },
    }));
  }, [activeChartSourceId, activeTimeframe, symbol]);

  // ── Drag to Spawn MT5 Trade Levels ──
  useEffect(() => {
    if (!isActive) return;

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
    // Level bars hidden while their level is being dragged (the live preview
    // replaces them); restored on release/cancel, and rebuilt on flush anyway.
    let hiddenDragControlBars: HTMLElement[] = [];

    const hideDraggedLevelControls = (tradeKey: string, role: 'SL' | 'TP') => {
      const overlayHost = overlayRef.current?.parentElement ?? overlayRef.current;
      overlayHost?.querySelectorAll<HTMLElement>(
        `.rtx-trade-controls[data-trade-key="${tradeKey}"][data-role="${role}"]`,
      ).forEach((node) => {
        node.style.visibility = 'hidden';
        hiddenDragControlBars.push(node);
      });
    };

    const restoreDraggedLevelControls = () => {
      hiddenDragControlBars.forEach((node) => {
        try { node.style.visibility = ''; } catch { }
      });
      hiddenDragControlBars = [];
    };
    let capturedPointerElement: HTMLElement | null = null;
    let capturedPointerId: number | null = null;
    let previousRootCursor = '';
    let previousContainerCursor = '';
    let previousBodyCursor = '';
    let previousUserSelect = '';
    let dragCursorActive = false;
    let tradeHoverCursorActive = false;
    let tradeHoverFrame: number | null = null;
    let pendingTradeHoverPoint: { clientX: number; clientY: number } | null = null;

    const getChartY = (e: PointerEvent) => {
      const rect = container.getBoundingClientRect();
      return e.clientY - rect.top;
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
      const digits = resolvedPriceDigitsRef.current;
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
      if (dragCursorActive || active === tradeHoverCursorActive) return;
      tradeHoverCursorActive = active;
      const cursor = active ? 'grab' : 'default';
      interactionRoot.style.cursor = active ? cursor : '';
      container.style.cursor = active ? cursor : '';
      container.querySelectorAll('canvas').forEach((canvas) => {
        (canvas as HTMLElement).style.cursor = cursor;
      });
    };

    const cancelQueuedTradeHover = () => {
      pendingTradeHoverPoint = null;
      if (tradeHoverFrame === null) return;
      window.cancelAnimationFrame(tradeHoverFrame);
      tradeHoverFrame = null;
    };

    const queueTradeHover = (e: PointerEvent) => {
      pendingTradeHoverPoint = { clientX: e.clientX, clientY: e.clientY };
      if (tradeHoverFrame !== null) return;

      tradeHoverFrame = window.requestAnimationFrame(() => {
        tradeHoverFrame = null;
        const point = pendingTradeHoverPoint;
        pendingTradeHoverPoint = null;

        if (
          !point
          || dragState
          || isChartInteractionActiveRef.current
          || !seriesRef.current
          || activeToolRef.current !== null
          || chartSettingsRef.current.showTradeLevels === false
        ) {
          setTradeHoverCursor(false);
          return;
        }

        // Read chart geometry once for this coalesced hover frame. The actual
        // trade-level scan is deliberately outside the active pan path.
        const rect = container.getBoundingClientRect();
        const isInside = (
          point.clientX >= rect.left
          && point.clientX <= rect.right
          && point.clientY >= rect.top
          && point.clientY <= rect.bottom
        );
        if (!isInside) {
          setTradeHoverCursor(false);
          return;
        }

        const y = point.clientY - rect.top;
        setTradeHoverCursor(Boolean(findClosestTradeLevel(y, TRADE_LEVEL_HIT_AREA_PX / 2)));
      });
    };

    const handlePointerDown = (e: PointerEvent) => {
      cancelQueuedTradeHover();
      setTradeHoverCursor(false);

      // Drawing clicks belong to the canvas, including clicks near a trade
      // level whose DOM hit target is temporarily disabled by scoped CSS.
      if (isTrendDrawingInputActive(container)) return;

      // Trade levels get first priority when the pointer is actually on/near one.
      if (e.button !== 0 || !seriesRef.current) return;
      // Position control buttons (reverse/double/close/remove) handle their own
      // clicks; this capture-phase handler must never turn them into drags.
      if (e.target instanceof Element && e.target.closest('.rtx-trade-control-btn')) return;
      if (!tradeAllowed) return;
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
        } else {
          // The badge belongs to a retained trade whose position data is
          // refreshing; it is not draggable right now and the press must not
          // fall through to another trade's nearby level.
          return;
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
        if (grabbedType !== 'ENTRY') {
          hideDraggedLevelControls(closestTrade.key, grabbedType);
        }

        dragLineOverlay = document.createElement('div');
        dragLineOverlay.style.cssText = `position:absolute;left:0;right:${getPriceScaleOffset()}px;top:0;height:0;border-top:1px dashed transparent;z-index:999;pointer-events:none;transform:translate3d(0, ${initialOverlayY}px, 0);will-change:transform;`;

        dragBadgeOverlay = document.createElement('div');
        dragBadgeOverlay.className = 'rtx-trade-drag-price-badge';
        const initialPalette = getTradeOverlayCardPalette(grabbedType === 'TP' ? 'TP' : 'SL', isChartSurfaceLight());
        dragBadgeOverlay.style.cssText = `position:absolute;left:${TRADE_LEVEL_BADGE_LEFT_INSET_PX}px;top:0;padding:1px 5px;background:${initialPalette.background};border:1px solid ${initialPalette.border};color:${initialPalette.text};font-size:var(--rtx-ui-font-size, 14px);font-family:Consolas,monospace;font-weight:var(--rtx-font-weight-control, 400);z-index:1000;pointer-events:none;border-radius:2px;transform:translateY(calc(-50% + ${initialOverlayY}px));will-change:transform;opacity:0;${initialPalette.shadow}`;

        overlayRef.current?.appendChild(dragLineOverlay);
        overlayRef.current?.appendChild(dragBadgeOverlay);
      }
    };

    const handlePointerMove = (e: PointerEvent) => {
      // A captured trade-level drag must stay synchronous even if the generic
      // chart-interaction flag is still active from an earlier pan gesture.
      if (dragState) {
        if (!dragLineOverlay || !dragBadgeOverlay || !seriesRef.current) return;
        if (capturedPointerId !== null && e.pointerId !== capturedPointerId) return;
        e.preventDefault();
        e.stopPropagation();
        const y = getChartY(e);
        const rawPrice = seriesRef.current.coordinateToPrice(y as any);
        if (rawPrice === null) return;

        const { tradeObj, grabbedType, entryAnchorY } = dragState;
        const digits = resolvedPriceDigitsRef.current;
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
        // Live cTrader-style preview: Pips and money keep updating while the
        // level is dragged, so the drop target's risk/reward is always visible.
        const previewState = useAppStore.getState();
        const previewTicket = Number(tradeObj.key.replace(/^trade:/, ''));
        const previewPosition = Array.isArray(previewState.positions)
          ? previewState.positions.find((candidate: any) => Number(candidate?.id ?? candidate?.ticket) === previewTicket)
          : null;
        const previewPositionRaw = previewPosition as unknown as Record<string, unknown> | null;
        const previewBackendPnl = Number(previewPosition?.unrealizedPnL ?? previewPosition?.profit ?? previewPosition?.unrealized_pl);
        const previewPips = computeSignedPips(tradeObj.side, tradeObj.entryPrice, price, digits);
        const previewMoney = estimateTradeLevelMoney({
          symbol: tradeObj.symbol,
          side: tradeObj.side,
          volume: tradeObj.volume,
          entryPrice: tradeObj.entryPrice,
          levelPrice: price,
          digits,
          backendPnl: Number.isFinite(previewBackendPnl) ? previewBackendPnl : null,
          currentPrice: liveCurrentPrice,
          contractSize: Number(previewPositionRaw?.contractSize ?? previewPositionRaw?.contract_size) || undefined,
        });
        const previewCurrency = String(previewState.account?.currency || 'USD').trim().toUpperCase() || 'USD';
        const previewBadge = dragBadgeOverlay;
        bindChartUiTranslation(previewBadge, () => {
          previewBadge.textContent = `${tr(role)} ${price.toFixed(digits)}  ${tr('pips')}: ${formatPipsLabel(previewPips)}  ${previewCurrency}: ${formatMoneyLabel(previewMoney)}`;
        });
        dragBadgeOverlay.style.transform = `translateY(calc(-50% + ${drawY}px))`;
        return;
      }

      if (isChartInteractionActiveRef.current) {
        cancelQueuedTradeHover();
        setTradeHoverCursor(false);
        return;
      }

      if (
        !seriesRef.current
        || activeToolRef.current !== null
        || chartSettingsRef.current.showTradeLevels === false
      ) {
        cancelQueuedTradeHover();
        setTradeHoverCursor(false);
        return;
      }

      queueTradeHover(e);
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
            const digits = resolvedPriceDigitsRef.current;
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

                api.positions.modifyPosition(ticket, tradeLevelModifyPatch(update.role, update.price))
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
      restoreDraggedLevelControls();
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
      restoreDraggedLevelControls();
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
      cancelQueuedTradeHover();
      // A tab can deactivate mid-drag. Reuse the normal cancellation path so
      // capture, overlays, cursors, and chart scroll options are restored.
      handlePointerCancel();
      setTradeHoverCursor(false);
    };
  }, [isActive, persistTradeLevelOverrides, tradeAllowed]);

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div
      className="rtx-chart-wrapper relative w-full h-full bg-[#0d0d0d]"
      data-chart-context-id={activeChartSourceId}
      dir="ltr"
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
          <div className="text-xs text-zinc-400 mb-1">{tr("Enter text label")}</div>
          <input
            autoFocus
            type="text"
            value={textInputValue}
            onChange={e => setTextInputValue(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter' && textInputValue.trim()) {
                const contextId = drawingRuntimeContextRef.current.contextId;
                if (!bindDrawingManagerToChart() || !drawingManager.ownsActiveDrawing(contextId)) return;
                // Place text drawing
                drawingManager.updateActiveDrawing({ text: textInputValue.trim() });
                const activeDrawing = drawingManager.getActiveDrawing(contextId);
                if (activeDrawing?.type === 'callout') {
                  drawingManager.finishDrawing();
                } else {
                  drawingManager.addPoint(
                    textInputOverlay.time,
                    textInputOverlay.price,
                    undefined,
                    contextId,
                  );
                }
                setTextInputOverlay(null);
                setTextInputValue('');
                // Auto-reset to cursor
                commandBus.dispatch({
                  type: 'SELECT_TOOL',
                  payload: { tool: 'cursor', targetContextId: contextId },
                });
              } else if (e.key === 'Escape') {
                const contextId = drawingRuntimeContextRef.current.contextId;
                drawingManager.cancelDrawing(contextId);
                setTextInputOverlay(null);
                setTextInputValue('');
                commandBus.dispatch({
                  type: 'SELECT_TOOL',
                  payload: { tool: 'cursor', targetContextId: contextId },
                });
              }
            }}
            className="px-2 py-1 rounded text-sm text-white bg-zinc-800 border border-zinc-600 outline-none focus:border-blue-500"
            placeholder={tr("Type and press Enter")}
          />
          <div className="flex gap-1">
            <button
              onClick={() => {
                if (textInputValue.trim()) {
                  const contextId = drawingRuntimeContextRef.current.contextId;
                  if (!bindDrawingManagerToChart() || !drawingManager.ownsActiveDrawing(contextId)) return;
                  drawingManager.updateActiveDrawing({ text: textInputValue.trim() });
                  const activeDrawing = drawingManager.getActiveDrawing(contextId);
                  if (activeDrawing?.type === 'callout') {
                    drawingManager.finishDrawing();
                  } else {
                    drawingManager.addPoint(
                      textInputOverlay.time,
                      textInputOverlay.price,
                      undefined,
                      contextId,
                    );
                  }
                }
                setTextInputOverlay(null);
                setTextInputValue('');
                commandBus.dispatch({
                  type: 'SELECT_TOOL',
                  payload: {
                    tool: 'cursor',
                    targetContextId: drawingRuntimeContextRef.current.contextId,
                  },
                });
              }}
              className="flex-1 px-2 py-1 rounded text-xs bg-blue-600 hover:bg-blue-500 text-white"
            >
              {tr("OK")}</button>
            <button
              onClick={() => {
                const contextId = drawingRuntimeContextRef.current.contextId;
                drawingManager.cancelDrawing(contextId);
                setTextInputOverlay(null);
                setTextInputValue('');
                commandBus.dispatch({
                  type: 'SELECT_TOOL',
                  payload: { tool: 'cursor', targetContextId: contextId },
                });
              }}
              className="flex-1 px-2 py-1 rounded text-xs bg-zinc-700 hover:bg-zinc-600 text-zinc-300"
            >
              {tr("Cancel")}</button>
          </div>
        </div>
      )}

      {/* API Error banner — suppressed, errors only logged to console */}

      {/* Loading — phased status: connecting → receiving → fades out on ready */}
      {loadingPhase !== 'hidden' && (
        <div
          className={`absolute inset-0 flex flex-col items-center justify-center bg-[#0a0a0f]/95 z-20 pointer-events-none transition-opacity duration-150 ${loadingPhase === 'ready' ? 'opacity-0' : 'opacity-100'}`}
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
              {loadingPhase === 'ready' ? tr("Ready") : (loadingMessages[loadingMessageIdx] ?? loadingMessages[0])}
            </div>
          </div>
        </div>
      )}


      {/* Chart HUD uses shared size and weight roles with theme-specific families and colors. */}
      {(chartSettings.showTicker || chartSettings.showOHLC) && (isAdvancedUntitledLight ? (
        <div className="rtx-chart-hud" style={{
          position: 'absolute', top: 8, left: 12, zIndex: 15, pointerEvents: 'none',
          fontFamily: 'var(--font-sans)', fontSize: 'var(--rtx-ui-font-size, 14px)', fontWeight: 'var(--rtx-font-weight-body, 400)', lineHeight: '16px', letterSpacing: 'normal',
          display: 'flex', alignItems: 'center', gap: '8px'
        }}>
          {chartSettings.showTicker && (
            <span className="rtx-chart-hud__symbol" style={{
              fontWeight: 'var(--rtx-font-weight-control, 400)', color: '#7f56d9',
              background: 'rgba(127, 86, 217, 0.10)',
              padding: '2px 8px', borderRadius: '4px',
            }}><ChartSymbolTrigger symbol={symbol} panelId={panelId} />, {timeframe}</span>
          )}
          {chartSettings.showOHLC && (
            <>
              <span style={{ fontWeight: 'var(--rtx-font-weight-body, 400)', color: '#475467' }}>
                O: <span ref={ohlcOpenRef} style={{
                  fontWeight: 'var(--rtx-font-weight-body, 400)', color: '#1d2939',
                  background: 'rgba(29, 41, 57, 0.06)', padding: '1px 6px', borderRadius: '3px'
                }}>0.00000</span>
              </span>
              <span style={{ fontWeight: 'var(--rtx-font-weight-body, 400)', color: '#475467' }}>
                H: <span ref={ohlcHighRef} style={{
                  fontWeight: 'var(--rtx-font-weight-body, 400)', color: '#16a34a',
                  background: 'rgba(22, 163, 74, 0.10)', padding: '1px 6px', borderRadius: '3px'
                }}>0.00000</span>
              </span>
              <span style={{ fontWeight: 'var(--rtx-font-weight-body, 400)', color: '#475467' }}>
                L: <span ref={ohlcLowRef} style={{
                  fontWeight: 'var(--rtx-font-weight-body, 400)', color: '#dc2626',
                  background: 'rgba(220, 38, 38, 0.10)', padding: '1px 6px', borderRadius: '3px'
                }}>0.00000</span>
              </span>
              <span style={{ fontWeight: 'var(--rtx-font-weight-body, 400)', color: '#475467' }}>
                C: <span ref={ohlcCloseRef} style={{
                  fontWeight: 'var(--rtx-font-weight-body, 400)', color: '#1d2939',
                  background: 'rgba(29, 41, 57, 0.06)', padding: '1px 6px', borderRadius: '3px'
                }}>0.00000</span>
              </span>
            </>
          )}
        </div>
      ) : (
        <div className="rtx-chart-hud" style={{
          position: 'absolute', top: 8, left: 12, zIndex: 15, pointerEvents: 'none',
          fontFamily: 'var(--font-mono)', fontSize: 'var(--rtx-ui-font-size, 14px)', fontWeight: 'var(--rtx-font-weight-body, 400)', lineHeight: '16px', color: chartTheme.axisText,
          textShadow: '1px 1px 1px rgba(0,0,0,0.8)', display: 'flex', alignItems: 'center', gap: '8px'
        }}>
          {chartSettings.showTicker && (
            <span className="rtx-chart-hud__symbol" style={{ fontWeight: 'var(--rtx-font-weight-control, 400)', color: chartTheme.text }}><ChartSymbolTrigger symbol={symbol} panelId={panelId} />, {timeframe}</span>
          )}
          {chartSettings.showOHLC && (
            <>
              <span>O: <span ref={ohlcOpenRef} style={{ color: chartTheme.text }}>0.00000</span></span>
              <span>H: <span ref={ohlcHighRef} style={{ color: chartTheme.candleUp }}>0.00000</span></span>
              <span>L: <span ref={ohlcLowRef} style={{ color: chartTheme.candleDown }}>0.00000</span></span>
              <span>C: <span ref={ohlcCloseRef} style={{ color: chartTheme.text }}>0.00000</span></span>
            </>
          )}
        </div>
      ))}

      {/*
        Chart Container - must have explicit dimensions for lightweight-charts.
        Its native grid is painted below candles/series; never add a DOM grid
        layer beside this container because that would cover chart data.
      */}
      <div
        ref={containerRef}
        className="absolute inset-0 w-full h-full"
        style={{ zIndex: chartSettings.chartOnForeground ? 11 : 0 }}
      />

      {/* Drawing Overlay — always pointer-events:none so chart canvas receives all mouse events */}
      <div
        ref={overlayRef}
        className="chart-drawing-overlay absolute inset-0"
        style={{
          position: 'absolute',
          inset: 0,
          pointerEvents: 'none',
          zIndex: chartSettings.chartOnForeground ? 5 : 10,
        }}
      />

      {/* ── Custom crosshair — 5 GPU-composited divs, all pointer-events:none ── */}
      {/* Vertical line: 1px wide, full height, snapped to nearest candle X */}
      <div ref={vertLineRef} style={{
        position: 'absolute', left: 0, top: 0,
        width: 1, height: '100%',
        background: useEnterpriseLightChartPalette ? '#64748b' : 'rgba(148,163,184,0.75)',
        pointerEvents: 'none', zIndex: 14, opacity: 0,
        willChange: 'transform',
      }} />
      {/* Horizontal line: 1px tall, full width, exact cursor Y */}
      <div ref={horizLineRef} style={{
        position: 'absolute', left: 0, top: 0,
        width: '100%', height: 1,
        background: useEnterpriseLightChartPalette ? '#64748b' : 'rgba(148,163,184,0.75)',
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
        <div style={{ position: 'absolute', left: 0, top: 5, width: 12, height: 1, background: useEnterpriseLightChartPalette ? '#64748b' : 'rgba(148,163,184,0.95)' }} />
        <div style={{ position: 'absolute', left: 5, top: 0, width: 1, height: 12, background: useEnterpriseLightChartPalette ? '#64748b' : 'rgba(148,163,184,0.95)' }} />
      </div>
      {/* Time label: bottom of chart at snappedX */}
      <div ref={timeLabelRef} className="rtx-chart-crosshair-label" style={{
        position: 'absolute', left: 0, top: 0,
        background: '#334155', color: useEnterpriseLightChartPalette ? '#ffffff' : '#e2e8f0',
        fontSize: 'var(--rtx-ui-font-size, 14px)', fontWeight: 'var(--rtx-font-weight-body, 400)', fontFamily: "Consolas,'Courier New',monospace",
        padding: '1px 5px', borderRadius: 2,
        whiteSpace: 'nowrap',
        pointerEvents: 'none', zIndex: 15, opacity: 0,
        willChange: 'transform',
      }} />
      {/* Price label: right edge at cursor Y */}
      <div ref={priceLabelRef} className="rtx-chart-crosshair-label" style={{
        position: 'absolute', left: 0, top: 0,
        width: 54, textAlign: 'center',
        background: '#334155', color: useEnterpriseLightChartPalette ? '#ffffff' : '#e2e8f0',
        fontSize: 'var(--rtx-ui-font-size, 14px)', fontWeight: 'var(--rtx-font-weight-body, 400)', fontFamily: "Consolas,'Courier New',monospace",
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
          right: LIVE_PRICE_SCALE_WIDTH_FALLBACK_PX,
          height: 0,
          borderTop: `0.5px solid ${initialLivePriceOverlayColors.lineColor}`,
          pointerEvents: 'none',
          zIndex: 7,
          transform: 'translateY(-0.25px)',
        }}
      />
      <div
        ref={livePriceBadgeRef}
        className="rtx-chart-price-badge"
        style={{
          position: 'absolute',
          top: -9999,
          right: 0,
          padding: '2px 5px',
          background: initialLivePriceOverlayColors.badgeBackground,
          color: initialLivePriceOverlayColors.badgeTextColor,
          fontFamily: CHART_AXIS_FONT_FAMILY,
          whiteSpace: 'nowrap',
          pointerEvents: 'none',
          zIndex: 9,
          borderRadius: 0,
          transform: `translateY(-${LIVE_PRICE_BADGE_PRICE_ROW_OFFSET_PX}px)`,
          letterSpacing: 0,
          textAlign: 'center',
          boxSizing: 'border-box',
        }}
      >
        <span
          ref={livePriceValueRef}
          style={{
            display: 'block',
            fontSize: 'var(--rtx-ui-font-size, 14px)',
            fontWeight: 'var(--rtx-font-weight-control, 400)',
            lineHeight: '16px',
            fontVariantNumeric: 'tabular-nums',
          }}
        />
        <span
          ref={livePriceCountdownRef}
          data-live-price-countdown
          aria-hidden="true"
          style={{
            display: 'none',
            fontSize: 'var(--rtx-ui-font-size, 14px)',
            fontWeight: 'var(--rtx-font-weight-control, 400)',
            lineHeight: '14px',
            letterSpacing: 0,
            fontVariantNumeric: 'tabular-nums',
            opacity: 1,
          }}
        />
      </div>

      {/* Drawing Context Menu (Right-click on drawings) */}
      <DrawingContextMenu onClose={() => { }} />

      {/* One-Click Trading Panel (Alt+T to toggle) */}
      <OneClickTrading
        symbol={symbol}
        timeframe={timeframe}
        visible={showOneClick}
        tradeAllowed={tradeAllowed}
        marketStatus={marketStatus}
        minVolume={minVolume}
        maxVolume={maxVolume}
        volumeStep={volumeStep}
      />



      {/* ── MT5-Style Chart Right-Click Context Menu ── */}
      <ChartContextMenu
        visible={ctxMenu.visible}
        x={ctxMenu.x}
        y={ctxMenu.y}
        symbol={symbol}
        targetContextId={activeChartSourceId}
        currentChartType={localChartType}
        currentTimeframe={prevTimeframeRef.current || timeframe}
        oneClickTrading={showOneClick}
        showGrid={chartSettings.showGrid}
        showVolumes={chartSettings.showTickVolumes || chartSettings.showRealVolumes}
        autoScroll={ctxAutoScroll}
        chartShift={ctxChartShift}
        showTradeLevels={ctxShowTradeLevels}
        showTradeHistory={ctxShowTradeHistory}
        onChangeChartType={handleCtxChartTypeChange}
        onChangeTimeframe={handleCtxTimeframeChange}
        onToggleOneClickTrading={toggleOneClickTrading}
        onToggleGrid={handleCtxToggleGrid}
        onToggleVolumes={handleCtxToggleVolumes}
        onToggleAutoScroll={handleCtxToggleAutoScroll}
        onToggleChartShift={handleCtxToggleChartShift}
        onToggleTradeLevels={handleCtxToggleTradeLevels}
        onToggleTradeHistory={handleCtxToggleTradeHistory}
        onOpenProperties={handleCtxOpenProperties}
        onSaveAsPicture={handleCtxSaveAsPicture}
        onPrintChart={() => {
          activateActiveChartSource(activeChartSourceId);
          window.dispatchEvent(new CustomEvent('printChart'));
        }}
        onRefresh={handleCtxRefresh}
        onZoomIn={handleCtxZoomIn}
        onZoomOut={handleCtxZoomOut}
        onAddIndicator={addLocalIndicator}
        onDeleteIndicators={handleCtxDeleteIndicators}
        onOpenNewOrder={handleCtxOpenNewOrder}
        onOpenDOM={handleCtxOpenDOM}
        onOpenTemplateDialog={handleOpenTemplateDialog}
        onClose={closeCtxMenu}
        currentIndicators={currentIndicators}
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
          showVolumes: chartSettings.showTickVolumes || chartSettings.showRealVolumes,
          indicators: currentIndicators,
          drawingTools: [],
          colors: { background: '#0e0e12', grid: '#222226', candle: { up: '#00c896', down: '#ff4d4f', border: '#378658' }, volume: { up: '#00c896', down: '#ff4d4f' } }
        }}
        onLoadTemplate={handleLoadTemplate}
      />
    </div>
  );
});
