import { useCallback, useEffect, useRef, type RefObject } from 'react';
import type { IChartApi, ISeriesApi, SeriesType, Time } from 'lightweight-charts';
import type { TradingChartVisibleRuntime } from '../../../hooks/useTradingChartVisibleRuntime';
import { drawingManager } from '../../../services/drawingManager';
import { requestChartTradeOverlayRefresh } from '../../../services/tradeOverlayRefreshEvents';
import { getTimeframeSeconds, type Timeframe as AggTimeframe } from '../../../services/candleAggregationService';
import type { ChartProperties } from '../../../store/useChartSettingsStore';
import { refreshChartUiTranslations } from '../../../utils/chartTradeControls';
import { getTradeHistoryMarkerPrice } from '../../../utils/chartTradeHistoryPresentation';
import {
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
  layoutTradeControls,
  placeTradeMarkerTooltip,
  TRADE_LEVEL_OVERRIDES_STORAGE_KEY,
  TRADE_MARKER_TIP_OFFSET_PX,
  tradeMarkerTooltipLayouts,
  type TradeSide,
} from '../presentation/tradeOverlayPresentation';
import { useTradingChartTradeLevelDrag } from './useTradingChartTradeLevelDrag';
import { useTradingChartTradeOverlayRenderer } from './useTradingChartTradeOverlayRenderer';
import { readStoredTradeLevelOverrides } from './tradeLevelOverrideStorage';
import { readTradeControlSize, rememberTradeControlResize, type TradeControlSizeCache } from './tradeControlSizeCache';
import {
  readTradeOverlayContainerSize,
  rememberTradeOverlayContainerResize,
  type TradeOverlayContainerSizeCache,
} from './tradeOverlayContainerSizeCache';
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
  lastRenderedCandlesRef: RefObject<Candle[]>;
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
  resolvedPriceDigits: number | null;
  resolvedPriceDigitsRef: RefObject<number | null>;
  seriesRef: RefObject<ISeriesApi<SeriesType> | null>;
  symbol: string;
  timeframe: Timeframe;
  tr: <T>(source: T, values?: Record<string, unknown>) => T;
  tradeAllowed: boolean;
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
  lastRenderedCandlesRef,
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
  const tradeControlSizesRef = useRef<TradeControlSizeCache>(new WeakMap());
  const tradeOverlayContainerSizesRef = useRef<TradeOverlayContainerSizeCache>(new WeakMap());
  const tradeControlSizeObservationRef = useRef(false);


  const frozenEntryTimesRef = useRef<Map<number | string, number>>(new Map());


  const stableActiveMarkerTimesRef = useRef<Map<number | string, number>>(new Map());


  const frozenEntryPricesRef = useRef<Map<number | string, number>>(new Map());




  const pendingMissingActiveTradesRef = useRef<Map<string, { trade: ActiveTradeSnapshot; missingSince: number }>>(new Map());


  const closeSuppressedTradeKeysRef = useRef<Map<string, number>>(new Map());


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
      readStoredTradeLevelOverrides(window.localStorage).forEach((levels, key) => {
        tradeLevelOverridesRef.current.set(key, levels);
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
      ? '.rtx-trade-marker--active,.rtx-trade-active-segment,.rtx-trade-level-line,.rtx-trade-level-badge,.rtx-trade-level-hit-area,.rtx-trade-axis-price-badge,.rtx-trade-overflow,.rtx-trade-control-leader'
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
    pendingClosedTradeSnapshotsRef.current.clear();
    optimisticClosedTradeSnapshotsRef.current.clear();
    frozenEntryTimesRef.current.clear();
    stableActiveMarkerTimesRef.current.clear();
    frozenEntryPricesRef.current.clear();
    tradeLevelLastKnownLevelsRef.current.clear();
    pendingTradeLevelModifyRequestsRef.current.clear();
    tradeLevelOptimisticGraceUntilRef.current.clear();
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
  ]);



  const updateLabelPositions = useCallback((refreshMetrics = true) => {
    if (!seriesRef.current || !chartRef.current) return;

    const series = seriesRef.current;
    const chart = chartRef.current;
    const overlayLayers = [
      { nodes: historyOverlayNodesRef.current, data: historyOverlayNodeDataRef.current },
      { nodes: activeOverlayNodesRef.current, data: activeOverlayNodeDataRef.current },
    ];
    const { width: chartWidth, height: chartHeight } = readTradeOverlayContainerSize(
      tradeOverlayContainerSizesRef.current, containerRef.current, tradeControlSizeObservationRef.current,
    );
    // A collapsed/zero-size container has no valid geometry; leave nodes as
    // they are rather than culling the entire overlay against height 0.
    if (chartWidth <= 0 || chartHeight <= 0) return;
    const priceScaleWidth = series.priceScale().width();
    const timeScaleHeight = chart.timeScale().height();
    const plotHeight = Math.max(0, chartHeight - (Number.isFinite(timeScaleHeight) ? timeScaleHeight : 0));
    const overlayHost = overlayRef.current;
    const controlNodes = new Map<string, { element: HTMLElement; anchorY: number }>();
    for (const host of [overlayHost, overlayHost?.parentElement]) {
      if (!host) continue;
      const clipLayer = getTradePlotClipLayer(host);
      clipLayer.style.right = `${Math.max(0, priceScaleWidth)}px`;
      clipLayer.style.bottom = `${Math.max(0, chartHeight - plotHeight)}px`;
    }
    const snapCssPixel = (value: number): number => Math.round(value);
    const resolveTimeCoordinate = (time: unknown): number | null => {
      const numericTime = Number(time);
      if (!Number.isFinite(numericTime) || numericTime <= 0) return null;

      const directCoordinate = chart.timeScale().timeToCoordinate(numericTime as Time);
      if (directCoordinate != null) return directCoordinate;

      const activeTf = prevTimeframeRef.current || timeframe;
      const timeframeSeconds = getTimeframeSeconds(activeTf as AggTimeframe);
      const firstCandleTime = candlesRef.current[0]?.time ?? currentCandleRef.current?.time ?? null;
      const maxDistance = firstCandleTime != null && numericTime >= firstCandleTime
        ? undefined
        : (Number.isFinite(timeframeSeconds) && timeframeSeconds > 0 ? timeframeSeconds : undefined);
      const nearest = getNearestCandleByTime(numericTime, maxDistance);
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
      if (!tradeMarkerCandles.has(markerTime) && node.resolveTime) {
        const resolvedTime = Number(node.resolveTime());
        if (Number.isFinite(resolvedTime) && resolvedTime > 0) {
          markerTime = resolvedTime;
        }
      }
      if (!tradeMarkerCandles.has(markerTime)) {
        const activeTf = prevTimeframeRef.current || timeframe;
        const timeframeSeconds = getTimeframeSeconds(activeTf as AggTimeframe);
        const firstCandleTime = candlesRef.current[0]?.time ?? currentCandleRef.current?.time ?? null;
        const maxDistance = firstCandleTime != null && markerTime >= firstCandleTime
          ? undefined
          : (Number.isFinite(timeframeSeconds) && timeframeSeconds > 0 ? timeframeSeconds : undefined);
        const fallbackTime = getNearestCandleByTime(markerTime, maxDistance)?.time;
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
              if (!el.style.top) el.style.display = 'none';
              continue;
            }
            const snappedY = snapCssPixel(y);
            // Outlined prices belong entirely to the scale, never the time axis.
            if (priceScaleWidth <= 0 || snappedY < 10 || snappedY + 10 > plotHeight) {
              el.style.display = 'none';
              continue;
            }
            el.style.display = 'flex';
            el.style.top = `${snappedY}px`;
            el.style.right = '0px';
            el.style.width = `${priceScaleWidth}px`;
            continue;
          }
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
            const isControl = el.classList.contains('rtx-trade-controls');
            // Restore the node's own display mode: flex control bars must not
            // be flattened to block or their buttons fall onto the text baseline.
            el.style.display = el.dataset.display || 'block';
            if (!isControl) {
              el.style.top = node.kind === 'price-badge' && el.classList.contains('rtx-trade-level-badge--line-text')
                ? `${snappedY - 14}px`
                : `${snappedY + (node.pixelOffsetY ?? 0)}px`;
            }

            if (node.kind === 'horizontal-line' || node.kind === 'price-hit-area') {
              el.style.left = '0px';
              el.style.right = `${priceScaleWidth}px`;
            } else {
              const leftInset = Number.parseFloat(el.dataset.leftInset ?? '') || 0;
              el.style.width = 'max-content';
              if (isControl) {
                if (snappedY < 0 || snappedY > plotHeight) {
                  el.style.display = 'none';
                  continue;
                }
                el.style.maxWidth = `${Math.max(0, chartWidth - priceScaleWidth - 32)}px`;
                controlNodes.set(`${el.dataset.tradeKey}:${el.dataset.role}`, { element: el, anchorY: snappedY });
              } else {
                el.style.maxWidth = `${Math.max(96, chartWidth - priceScaleWidth - leftInset - 12)}px`;
                if (el.dataset.align === 'right') {
                  el.style.left = 'auto';
                  el.style.right = `${priceScaleWidth + 16}px`;
                }
              }
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
            const geometry = resolveTradeOverlaySegmentGeometry({
              x1,
              y1,
              x2,
              y2,
              minLengthPx: 0,
            });
            if (!geometry) {
              // Coordinate gaps during candle reloads freeze placed segments.
              if (!el.style.top) el.style.display = 'none';
              continue;
            }

            el.style.display = 'block';
            el.style.left = `${geometry.left}px`;
            const isHistoryLine = el.classList.contains('rtx-trade-history-line');
            // History lines have a fixed inline height; reading offsetHeight here
            // forced one synchronous layout per trade segment on every pass.
            const segmentHeight = isHistoryLine ? (Number.parseFloat(el.style.height) || 1) : 0;
            el.style.top = `${geometry.top - segmentHeight / 2}px`;
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
          const anchoredPrice = node.kind === 'marker' ? resolveTradeMarkerAnchorPrice(node) : node.price;
          const y = series.priceToCoordinate(anchoredPrice);
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
            const markerY = y + (node.pixelOffsetY ?? 0);
            el.style.left = `${x}px`;
            el.style.top = `${markerY}px`;
            el.style.transform = node.markerSide === 'BUY'
              ? 'translate(-50%, 0)'
              : 'translate(-50%, -100%)';

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
          el.style.display = 'none';
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

    // Observer-provided border boxes keep quote-driven placement from forcing
    // layout after every marker/style write. Dense trades retain their anchors.
    if (controlNodes.size && containerRef.current) {
      const plotWidth = Math.max(0, chartWidth - priceScaleWidth);
      const inputs = Array.from(controlNodes, ([key, { element, anchorY }]) => {
        const { width, height } = readTradeControlSize(
          tradeControlSizesRef.current, element, tradeControlSizeObservationRef.current,
        );
        return {
          key, anchorY, width, height,
          preferredLeft: element.dataset.align === 'right'
            ? plotWidth - width - 16
            : Number.parseFloat(element.dataset.leftInset ?? '') || 16,
        };
      });
      const placements = layoutTradeControls(inputs, plotWidth);
      for (const placement of placements) {
        const element = controlNodes.get(placement.key)!.element;
        element.style.left = `${snapCssPixel(placement.left)}px`;
        element.style.right = 'auto';
        element.style.top = `${snapCssPixel(placement.top + placement.height / 2)}px`;
        element.dataset.priceAnchorOffsetY = String(placement.offsetY);
        element.dataset.priceAnchorY = String(placement.anchorY);
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

  useEffect(() => {
    const container = containerRef.current;
    const wrapper = container?.parentElement;
    if (!container || !wrapper) return;
    let frame: number | null = null;
    const schedule = () => {
      if (frame !== null) return;
      frame = window.requestAnimationFrame(() => { frame = null; updateLabelPositions(false); });
    };
    const resize = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(entries => {
      for (const entry of entries) {
        if (entry.target === container) {
          rememberTradeOverlayContainerResize(tradeOverlayContainerSizesRef.current, entry);
        } else if ((entry.target as HTMLElement).classList.contains('rtx-trade-controls')) {
          rememberTradeControlResize(tradeControlSizesRef.current, entry);
        }
      }
      schedule();
    });
    tradeControlSizeObservationRef.current = resize !== null;
    const observeControlSizes = () => {
      resize?.disconnect();
      resize?.observe(wrapper);
      resize?.observe(container, { box: 'border-box' });
      container.querySelectorAll('td, canvas').forEach(element => resize?.observe(element));
      wrapper.querySelectorAll('.rtx-trade-controls').forEach(element => resize?.observe(element));
      schedule();
    };
    const children = new MutationObserver(observeControlSizes);
    children.observe(wrapper, { childList: true });
    children.observe(container, { childList: true, subtree: true });
    observeControlSizes();
    return () => {
      children.disconnect();
      resize?.disconnect();
      tradeControlSizeObservationRef.current = false;
      tradeControlSizesRef.current = new WeakMap();
      tradeOverlayContainerSizesRef.current = new WeakMap();
      if (frame !== null) window.cancelAnimationFrame(frame);
    };
  }, [containerRef, updateLabelPositions]);



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
      drawingManager.renderContext(overlay);
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
    lastRenderedCandlesRef,
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
    requestChartTradeOverlayRefresh(drawingRuntimeContextRef.current.contextId, 'reconcile');
  }, [candlesLoadedRev, drawingRuntimeContextRef]);



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
