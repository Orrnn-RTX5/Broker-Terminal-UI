import { useCallback, useEffect, useRef, type RefObject } from 'react';
import type { IChartApi, ISeriesApi, SeriesType, Time } from 'lightweight-charts';
import type { TradingChartVisibleRuntime } from '../../../hooks/useTradingChartVisibleRuntime';
import { drawingManager } from '../../../services/drawingManager';
import { getTimeframeSeconds, type Timeframe as AggTimeframe } from '../../../services/candleAggregationService';
import type { ChartProperties } from '../../../store/useChartSettingsStore';
import { refreshChartUiTranslations } from '../../../utils/chartTradeControls';
import { setTradeOverlayStyle } from '../../../utils/tradeOverlayStyle';
import { getTradeHistoryMarkerPrice } from '../../../utils/chartTradeHistoryPresentation';
import {
  createTradeOverlayCandleLookup,
  resolveNearestTradeOverlayCandleTime,
  resolveTradeOverlaySegmentGeometry,
} from '../../../services/tradeOverlayHistory';
import type {
  Candle,
  LivePriceOverlayColors,
  Timeframe,
  TradingViewChartTheme,
} from '../../../types/chart';
import type {
  ChartPostInteractionCallbacks,
  ChartPostInteractionCoordinator,
} from '../../../utils/chartPostInteractionCoordinator';
import {
  getTradePlotClipLayer,
  placeTradeMarkerTooltip,
  TRADE_LEVEL_OVERRIDES_STORAGE_KEY,
  TRADE_LEVEL_OVERRIDE_TTL_MS,
  TRADE_MARKER_TIP_OFFSET_PX,
  tradeMarkerTooltipLayouts,
  type TradeSide,
} from '../presentation/tradeOverlayPresentation';
import { useTradingChartTradeLevelDrag } from './useTradingChartTradeLevelDrag';
import { useTradingChartTradeOverlayRenderer } from './useTradingChartTradeOverlayRenderer';
import type {
  ActiveTradeSnapshot,
  ClosedTradeSnapshot,
  OverlayNodeData,
  TradeLevelModifyRequestId,
  TradeLevelOverride,
  TradeOverlayLayer,
} from './tradeRuntimeContracts';

export type { ActiveTradeSnapshot } from './tradeRuntimeContracts';

interface UseTradingChartTradeRuntimeOptions {
  activeChartSourceId: string;
  activeToolRef: RefObject<string | null>;
  activeTradeSnapshotsRef: RefObject<Map<string, ActiveTradeSnapshot>>;
  applyLivePriceHorizontalGeometry: (measuredScaleWidth: number) => void;
  brokerAccountSessionScope: string;
  brokerTimeOffsetSec: number;
  candlesLoadedRev: number;
  candlesRef: RefObject<Candle[]>;
  chartRef: RefObject<IChartApi | null>;
  chartSettingsRef: RefObject<ChartProperties>;
  chartThemeRef: RefObject<TradingViewChartTheme>;
  containerRef: RefObject<HTMLDivElement | null>;
  currentCandleRef: RefObject<Candle | null>;
  drawingRuntimeContextRef: RefObject<{
    contextId: string;
    accountScope?: string;
    symbol: string;
    timeframe: Timeframe;
  }>;
  getDrawingSeriesData: () => Candle[];
  hideLivePriceOverlay: (clearPrice?: boolean) => void;
  isActive: boolean;
  isActiveRef: RefObject<boolean>;
  isChartInteractionActiveRef: RefObject<boolean>;
  isChartSurfaceLight: () => boolean;
  isDisposedRef: RefObject<boolean>;
  isLivePriceSafeForCandles: (price: number) => boolean;
  livePriceBadgeRef: RefObject<HTMLDivElement | null>;
  livePriceLineRef: RefObject<HTMLDivElement | null>;
  livePriceOverlayColorsRef: RefObject<LivePriceOverlayColors>;
  livePriceRef: RefObject<number | null>;
  overlayRef: RefObject<HTMLDivElement | null>;
  postInteractionCallbacksRef: RefObject<ChartPostInteractionCallbacks>;
  postInteractionCoordinatorRef: RefObject<ChartPostInteractionCoordinator | null>;
  prevSymbolRef: RefObject<string>;
  prevTimeframeRef: RefObject<Timeframe>;
  repaintTradeOverlayGeometryRef: RefObject<() => void>;
  resolvedPriceDigits: number;
  resolvedPriceDigitsRef: RefObject<number>;
  seriesRef: RefObject<ISeriesApi<SeriesType> | null>;
  symbol: string;
  timeframe: Timeframe;
  tr: <T>(source: T, values?: Record<string, unknown>) => T;
  tradeAllowed: boolean;
  tradeLevelCrossCloseCandidatesRef: RefObject<Map<string, number>>;
  tradeLevelCrossRefreshPendingRef: RefObject<Set<string>>;
  visibleRuntime: TradingChartVisibleRuntime;
}

export const useTradingChartTradeRuntime = ({
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
  tradeLevelCrossCloseCandidatesRef,
  tradeLevelCrossRefreshPendingRef,
  visibleRuntime,
}: UseTradingChartTradeRuntimeOptions): void => {


  // ─── Trade Annotations on Chart (MT5-style entry/exit markers + live trails) ───
  const activeOverlayNodesRef = useRef<HTMLElement[]>([]);


  const activeOverlayNodeDataRef = useRef<OverlayNodeData[]>([]);


  const historyOverlayNodesRef = useRef<HTMLElement[]>([]);


  const historyOverlayNodeDataRef = useRef<OverlayNodeData[]>([]);


  // Live Pips/USD refresh hooks for the on-line position control bars.
  const tradeControlLiveUpdatersRef = useRef<Array<() => void>>([]);


  const frozenEntryTimesRef = useRef<Map<number | string, number>>(new Map());


  const stableActiveMarkerTimesRef = useRef<Map<number | string, number>>(new Map());


  const frozenEntryPricesRef = useRef<Map<number | string, number>>(new Map());




  const pendingMissingActiveTradesRef = useRef<Map<string, { trade: ActiveTradeSnapshot; missingSince: number }>>(new Map());


  const closeSuppressedTradeKeysRef = useRef<Map<string, number>>(new Map());


  // Suppressions created by the SL/TP level-cross GUESS (not by a real close
  // request). If the broker feed shows the position open again, the guess was
  // wrong and its suppression must be lifted immediately.
  const crossCloseGuessedTradeKeysRef = useRef<Set<string>>(new Set());




  const pendingClosedTradeSnapshotsRef = useRef<Map<string, ActiveTradeSnapshot>>(new Map());


  const optimisticClosedTradeSnapshotsRef = useRef<Map<string, ClosedTradeSnapshot>>(new Map());


  const tradeHistoryRefreshTimerRef = useRef<number | null>(null);


  const tradeMissingGraceTimerRef = useRef<number | null>(null);


  const tradeOverlayRafRef = useRef<number | null>(null);






  const tradeLevelOverridesRef = useRef<Map<string, TradeLevelOverride>>(new Map());


  const tradeLevelLastKnownLevelsRef = useRef<Map<string, TradeLevelOverride>>(new Map());


  const tradeLevelModifyRequestSeqRef = useRef<TradeLevelModifyRequestId>(0);


  const pendingTradeLevelModifyRequestsRef = useRef<Map<string, TradeLevelModifyRequestId>>(new Map());


  const tradeLevelOptimisticGraceUntilRef = useRef<Map<string, number>>(new Map());


  const tradeLevelOverridesHydratedRef = useRef(false);


  const lastActiveTradeOverlaySignatureRef = useRef('');


  const lastHistoryTradeOverlaySignatureRef = useRef('');







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
      ? '.rtx-trade-marker--active,.rtx-trade-active-segment,.rtx-trade-level-line,.rtx-trade-level-badge,.rtx-trade-level-hit-area,.rtx-trade-axis-price-badge'
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
    } else {
      lastHistoryTradeOverlaySignatureRef.current = '';
    }
  }, [overlayRef]);



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
  }, [candlesRef, currentCandleRef]);



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
  }, [
    activeTradeSnapshotsRef,
    clearTradeOverlay,
    symbol,
    tradeLevelCrossCloseCandidatesRef,
  ]);



  const updateLabelPositions = useCallback((refreshMetrics = true) => {
    if (!seriesRef.current || !chartRef.current) return true;
    let needsCoordinateRetry = false;
    const candleLookup = createTradeOverlayCandleLookup(candlesRef.current, currentCandleRef.current);

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
    if (chartWidth <= 0 || chartHeight <= 0) return true;
    const priceScaleWidth = series.priceScale().width();
    const timeScaleHeight = chart.timeScale().height();
    const plotHeight = Math.max(0, chartHeight - (Number.isFinite(timeScaleHeight) ? timeScaleHeight : 0));
    const overlayHost = overlayRef.current;
    for (const host of [overlayHost, overlayHost?.parentElement]) {
      if (!host) continue;
      const clipLayer = getTradePlotClipLayer(host);
      setTradeOverlayStyle(clipLayer, "right", `${Math.max(0, priceScaleWidth)}px`);
      setTradeOverlayStyle(clipLayer, "bottom", `${Math.max(0, chartHeight - plotHeight)}px`);
    }
    const snapCssPixel = (value: number): number => Math.round(value);
    const isProjectableTime = (time: unknown): boolean => Number.isFinite(Number(time)) && Number(time) > 0;
    const resolveTimeCoordinate = (time: unknown): number | null => {
      const numericTime = Number(time);
      if (!Number.isFinite(numericTime) || numericTime <= 0) return null;

      const directCoordinate = chart.timeScale().timeToCoordinate(numericTime as Time);
      if (directCoordinate != null) return directCoordinate;

      const activeTf = prevTimeframeRef.current || timeframe;
      const timeframeSeconds = getTimeframeSeconds(activeTf as AggTimeframe);
      const nearest = candleLookup(
        numericTime,
        Number.isFinite(timeframeSeconds) && timeframeSeconds > 0 ? timeframeSeconds : undefined,
      );
      if (!nearest?.time) return null;

      return chart.timeScale().timeToCoordinate(nearest.time as Time);
    };
    // Candle lookup for execution arrows: hydrated once per layout pass, only
    // when a candle-anchored marker actually needs it.
    const tradeMarkerCandles = new Map<number, Candle>();
    let tradeMarkerCandlesHydrated = false;
    const resolveTradeMarkerAnchorPrice = (node: OverlayNodeData): number => {
      if (node.markerAnchor !== 'candle' || !node.markerSide || node.price == null) {
        return node.price ?? 0;
      }
      if (!tradeMarkerCandlesHydrated) {
        tradeMarkerCandlesHydrated = true;
        for (const candle of candlesRef.current) tradeMarkerCandles.set(candle.time, candle);
        const liveCandle = currentCandleRef.current;
        if (liveCandle) tradeMarkerCandles.set(liveCandle.time, liveCandle);
      }
      let markerTime = Number(node.time);
      if (!tradeMarkerCandles.has(markerTime)) {
        const activeTf = prevTimeframeRef.current || timeframe;
        const timeframeSeconds = getTimeframeSeconds(activeTf as AggTimeframe);
        const fallbackTime = candleLookup(
          markerTime,
          Number.isFinite(timeframeSeconds) && timeframeSeconds > 0 ? timeframeSeconds : undefined,
        )?.time;
        if (fallbackTime != null) {
          markerTime = fallbackTime;
        }
      }
      return getTradeHistoryMarkerPrice(node.markerSide, node.price, tradeMarkerCandles.get(markerTime));
    };

    for (const { nodes, data } of overlayLayers) {
      for (let i = 0; i < nodes.length; i++) {
        const el = nodes[i];
        const node = data[i];
        if (!el || !node) continue;

        try {
          if (node.kind === 'axis-price-badge') {
            const y = node.price == null ? null : series.priceToCoordinate(node.price);
            if (y == null) {
              if (Number.isFinite(node.price)) needsCoordinateRetry = true;
              if (!el.style.top) setTradeOverlayStyle(el, "display", 'none');
              continue;
            }
            const snappedY = snapCssPixel(y);
            // Outlined prices belong entirely to the scale, never the time axis.
            if (priceScaleWidth <= 0 || snappedY < 10 || snappedY + 10 > plotHeight) {
              setTradeOverlayStyle(el, "display", 'none');
              continue;
            }
            setTradeOverlayStyle(el, "display", 'flex');
            setTradeOverlayStyle(el, "top", `${snappedY}px`);
            setTradeOverlayStyle(el, "right", '0px');
            setTradeOverlayStyle(el, "width", `${priceScaleWidth}px`);
            continue;
          }
          if (
            node.kind === 'horizontal-line'
            || node.kind === 'price-badge'
            || node.kind === 'price-hit-area'
          ) {
            if (node.price == null) {
              setTradeOverlayStyle(el, "display", 'none');
              continue;
            }

            const y = series.priceToCoordinate(node.price);
            if (y == null) {
              if (Number.isFinite(node.price)) needsCoordinateRetry = true;
              // The scale reports no coordinates while candles reload (feed
              // reconnects, empty snapshots from a flaky backend). Freeze
              // already-placed nodes instead of blinking the overlay off.
              if (!el.style.top) setTradeOverlayStyle(el, "display", 'none');
              continue;
            }
            if (y < -20 || y > chartHeight + 20) {
              setTradeOverlayStyle(el, "display", 'none');
              continue;
            }

            const snappedY = snapCssPixel(y);
            // Restore the node's own display mode: flex control bars must not
            // be flattened to block or their buttons fall onto the text baseline.
            setTradeOverlayStyle(el, "display", el.dataset.display || 'block');
            setTradeOverlayStyle(el, "top", node.kind === 'price-badge' && el.classList.contains('rtx-trade-level-badge--line-text')
              ? `${snappedY - 14}px`
              : `${snappedY + (node.pixelOffsetY ?? 0)}px`);

            if (node.kind === 'horizontal-line' || node.kind === 'price-hit-area') {
              setTradeOverlayStyle(el, "left", '0px');
              setTradeOverlayStyle(el, "right", `${priceScaleWidth}px`);
            } else {
              const leftInset = Number.parseFloat(el.dataset.leftInset ?? '') || 0;
              setTradeOverlayStyle(el, "width", 'max-content');
              setTradeOverlayStyle(el, "maxWidth", `${Math.max(96, chartWidth - priceScaleWidth - leftInset - 12)}px`);
              if (el.dataset.align === 'right') {
                setTradeOverlayStyle(el, "left", 'auto');
                setTradeOverlayStyle(el, "right", `${priceScaleWidth + 16}px`);
              }
            }

            continue;
          }

          if (node.kind === 'segment') {
            if (node.price == null || node.time == null) {
              setTradeOverlayStyle(el, "display", 'none');
              continue;
            }

            const endPrice = node.resolveEndPrice?.() ?? node.endPrice ?? null;
            const endTime = node.resolveEndTime?.() ?? node.endTime ?? null;
            if (endPrice == null || endTime == null) {
              setTradeOverlayStyle(el, "display", 'none');
              continue;
            }

            const resolveSegmentEndY = (price: number, time: number, markerSide?: TradeSide) => {
              if (!markerSide) return series.priceToCoordinate(price);
              const y = series.priceToCoordinate(
                resolveTradeMarkerAnchorPrice({ kind: 'marker', price, time, markerSide, markerAnchor: 'candle' }),
              );
              if (y == null) return null;
              return y + (markerSide === 'BUY' ? TRADE_MARKER_TIP_OFFSET_PX : -TRADE_MARKER_TIP_OFFSET_PX);
            };
            const x1 = resolveTimeCoordinate(node.time);
            const y1 = resolveSegmentEndY(node.price, node.time, node.startMarkerSide);
            const x2 = resolveTimeCoordinate(endTime);
            const y2 = resolveSegmentEndY(endPrice, endTime, node.endMarkerSide);
            if ((x1 == null && isProjectableTime(node.time)) || (y1 == null && Number.isFinite(node.price))
              || (x2 == null && isProjectableTime(endTime)) || (y2 == null && Number.isFinite(endPrice))) {
              needsCoordinateRetry = true;
            }
            const geometry = resolveTradeOverlaySegmentGeometry({
              x1,
              y1,
              x2,
              y2,
              minLengthPx: el.classList.contains('rtx-trade-history-line') ? 24 : 0,
            });
            if (!geometry) {
              // Coordinate gaps during candle reloads freeze placed segments.
              if (!el.style.top) setTradeOverlayStyle(el, "display", 'none');
              continue;
            }

            setTradeOverlayStyle(el, "display", 'block');
            setTradeOverlayStyle(el, "left", `${geometry.left}px`);
            const isHistoryLine = el.classList.contains('rtx-trade-history-line');
            // History lines have a fixed inline height; reading offsetHeight here
            // forced one synchronous layout per trade segment on every pass.
            const segmentHeight = isHistoryLine ? (Number.parseFloat(el.style.height) || 1) : 0;
            setTradeOverlayStyle(el, "top", `${geometry.top - segmentHeight / 2}px`);
            setTradeOverlayStyle(el, "width", `${geometry.width}px`);
            setTradeOverlayStyle(el, "transform", `rotate(${geometry.angleDeg}deg)`);
            setTradeOverlayStyle(el, "transformOrigin", isHistoryLine ? '0 50%' : '0 0');
            continue;
          }

          if (node.price == null || node.time == null) {
            setTradeOverlayStyle(el, "display", 'none');
            continue;
          }

          let coordinateTime = node.time;
          let x = resolveTimeCoordinate(coordinateTime);
          if (x == null && node.resolveTime) {
            const fallbackTime = node.resolveTime();
            const fallbackX = resolveTimeCoordinate(fallbackTime);
            if (isProjectableTime(fallbackTime)) coordinateTime = fallbackTime;
            if (fallbackX != null) {
              x = fallbackX;
            }
          }
          const anchoredPrice = node.kind === 'marker' ? resolveTradeMarkerAnchorPrice(node) : node.price;
          const y = series.priceToCoordinate(anchoredPrice);
          if (x == null || y == null) {
            if ((x == null && isProjectableTime(coordinateTime)) || (y == null && Number.isFinite(anchoredPrice))) {
              needsCoordinateRetry = true;
            }
            // Keep last placement through transient coordinate gaps.
            if (!el.style.top) setTradeOverlayStyle(el, "display", 'none');
            continue;
          }
          if (x < -24 || x > chartWidth + 24 || y < -24 || y > chartHeight + 24) {
            setTradeOverlayStyle(el, "display", 'none');
            continue;
          }

          setTradeOverlayStyle(el, "display", 'block');

          if (node.kind === 'marker') {
            const markerY = y + (node.pixelOffsetY ?? 0);
            setTradeOverlayStyle(el, "left", `${x}px`);
            setTradeOverlayStyle(el, "top", `${markerY}px`);
            setTradeOverlayStyle(el, "transform", node.markerSide === 'BUY'
              ? 'translate(-50%, 0)'
              : 'translate(-50%, -100%)');

            const tooltip = el.querySelector<HTMLElement>('.rtx-trade-marker__price-tooltip');
            if (tooltip) {
              tradeMarkerTooltipLayouts.set(el, {
                x,
                markerY,
                markerSide: node.markerSide,
                plotWidth: Math.max(0, chartWidth - priceScaleWidth),
                plotHeight,
              });
              // Hidden tooltips are placed when shown (hover/focus).
              if (tooltip.style.visibility === 'visible') placeTradeMarkerTooltip(el, tooltip);
            }
            continue;
          }
        } catch {
          needsCoordinateRetry = true;
          setTradeOverlayStyle(el, "display", 'none');
        }
      }
    }

    // Refresh the live Pips/USD text on position control bars. Relayout is
    // already tick-driven for active trades, so this stays in the same frame.
    if (refreshMetrics) {
      for (const refreshTradeControlMetrics of tradeControlLiveUpdatersRef.current) {
        try { refreshTradeControlMetrics(); } catch { /* overlay may be rebuilding */ }
      }
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
        applyLivePriceHorizontalGeometry(priceScaleWidth);
        setTradeOverlayStyle(livePriceLineRef.current, "display", 'block');
        setTradeOverlayStyle(livePriceLineRef.current, "top", `${y}px`);
        setTradeOverlayStyle(livePriceLineRef.current, "borderTopColor", overlayColors.lineColor);
        setTradeOverlayStyle(livePriceBadgeRef.current, "display", 'block');
        setTradeOverlayStyle(livePriceBadgeRef.current, "top", `${y}px`);
        setTradeOverlayStyle(livePriceBadgeRef.current, "background", overlayColors.badgeBackground);
        setTradeOverlayStyle(livePriceBadgeRef.current, "color", overlayColors.badgeTextColor);
      }
    } else if (!chartSettingsRef.current.showBidPriceLine) {
      hideLivePriceOverlay(false);
    }
    return needsCoordinateRetry;
  }, [
    applyLivePriceHorizontalGeometry,
    candlesRef,
    chartRef,
    chartSettingsRef,
    containerRef,
    currentCandleRef,
    getNearestCandleByTime,
    hideLivePriceOverlay,
    livePriceBadgeRef,
    livePriceLineRef,
    livePriceOverlayColorsRef,
    livePriceRef,
    overlayRef,
    prevTimeframeRef,
    seriesRef,
    timeframe,
  ]);



  useEffect(() => {
    const repaintTradeOverlayGeometry = () => updateLabelPositions(false);
    repaintTradeOverlayGeometryRef.current = repaintTradeOverlayGeometry;
    return () => {
      if (repaintTradeOverlayGeometryRef.current === repaintTradeOverlayGeometry) {
        repaintTradeOverlayGeometryRef.current = () => undefined;
      }
    };
  }, [repaintTradeOverlayGeometryRef, updateLabelPositions]);



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
  }, [
    activeChartSourceId,
    chartRef,
    drawingRuntimeContextRef,
    getDrawingSeriesData,
    isDisposedRef,
    overlayRef,
    prevSymbolRef,
    prevTimeframeRef,
    seriesRef,
    symbol,
    timeframe,
    updateLabelPositions,
  ]);



  useEffect(() => {
    const callbacks = postInteractionCallbacksRef.current;
    const previousLayoutOverlay = callbacks.layoutOverlay;
    callbacks.layoutOverlay = layoutPostInteractionOverlays;
    return () => {
      if (callbacks.layoutOverlay === layoutPostInteractionOverlays) {
        callbacks.layoutOverlay = previousLayoutOverlay;
      }
    };
  }, [layoutPostInteractionOverlays, postInteractionCallbacksRef]);



  useTradingChartTradeOverlayRenderer({
    activeOverlayNodeDataRef,
    activeOverlayNodesRef,
    activeTradeSnapshotsRef,
    brokerAccountSessionScope,
    brokerTimeOffsetSec,
    candlesRef,
    chartRef,
    chartThemeRef,
    clearFrozenEntryTime,
    clearStableActiveMarkerTime,
    clearTradeOverlayLayer,
    clearTradeOverlayVisualRuntime,
    closeSuppressedTradeKeysRef,
    crossCloseGuessedTradeKeysRef,
    currentCandleRef,
    drawingRuntimeContextRef,
    frozenEntryPricesRef,
    frozenEntryTimesRef,
    getNearestCandleByTime,
    historyOverlayNodeDataRef,
    historyOverlayNodesRef,
    hydrateTradeLevelOverrides,
    isActiveRef,
    isChartInteractionActiveRef,
    isChartSurfaceLight,
    isDisposedRef,
    isLivePriceSafeForCandles,
    lastActiveTradeOverlaySignatureRef,
    lastHistoryTradeOverlaySignatureRef,
    optimisticClosedTradeSnapshotsRef,
    overlayRef,
    pendingClosedTradeSnapshotsRef,
    pendingMissingActiveTradesRef,
    pendingTradeLevelModifyRequestsRef,
    persistTradeLevelOverrides,
    postInteractionCoordinatorRef,
    prevTimeframeRef,
    resolvedPriceDigits,
    seriesRef,
    stableActiveMarkerTimesRef,
    symbol,
    timeframe,
    tr,
    tradeControlLiveUpdatersRef,
    tradeHistoryRefreshTimerRef,
    tradeLevelCrossCloseCandidatesRef,
    tradeLevelCrossRefreshPendingRef,
    tradeLevelLastKnownLevelsRef,
    tradeLevelModifyRequestSeqRef,
    tradeLevelOptimisticGraceUntilRef,
    tradeLevelOverridesRef,
    tradeMissingGraceTimerRef,
    tradeOverlayRafRef,
    updateLabelPositions,
    visibleRuntime,
  });



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
  }, [overlayRef, tr]);



  useEffect(() => {
    if (candlesLoadedRev <= 0) return;
    window.dispatchEvent(new CustomEvent('rtx:refresh-trade-overlay'));
  }, [candlesLoadedRev]);



  useTradingChartTradeLevelDrag({
    activeToolRef,
    activeTradeSnapshotsRef,
    brokerAccountSessionScope,
    chartRef,
    chartSettingsRef,
    containerRef,
    isActive,
    isChartInteractionActiveRef,
    isChartSurfaceLight,
    overlayRef,
    pendingTradeLevelModifyRequestsRef,
    persistTradeLevelOverrides,
    resolvedPriceDigitsRef,
    seriesRef,
    tr,
    tradeAllowed,
    tradeLevelLastKnownLevelsRef,
    tradeLevelModifyRequestSeqRef,
    tradeLevelOptimisticGraceUntilRef,
    tradeLevelOverridesRef,
  });
};
