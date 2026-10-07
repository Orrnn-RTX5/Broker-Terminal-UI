import type { Dispatch, RefObject, SetStateAction } from 'react';
import type { IChartApi, ISeriesApi, SeriesType, Time } from 'lightweight-charts';
import { updateDrawingCandle } from '../../../drawing-tools/drawingCandleUpdates';
import { useActiveChartRuntimeEffect } from '../../../hooks/useActiveChartRuntimeEffect';
import type { TradingChartVisibleRuntime } from '../../../hooks/useTradingChartVisibleRuntime';
import {
  candleAggregationService,
  getTimeframeSeconds,
  omitPartialLeadingM1Aggregate,
  type Timeframe as AggTimeframe,
} from '../../../services/candleAggregationService';
import type { CandleCacheSource } from '../../../services/candleCache';
import { chartDataService } from '../../../services/chartDataService';
import { aggregateM1CandlesToTimeframe } from '../../../services/derivedTimeframeHistoryService';
import {
  canDropPreloadedCandlesForLiveQuoteMismatch,
  createRenderedPriceReference,
  getChartPriceFromQuote,
  updateLiveQuoteGuardState,
  type RenderedPriceReference,
} from '../../../services/chartPriceGuards';
import { getQuoteSocketManager } from '../../../services/quoteSocketManager';
import { useAppStore } from '../../../store/useAppStore';
import type { ChartProperties } from '../../../store/useChartSettingsStore';
import {
  applyTickToFormingCandle,
  formatHistoryForOhlcv,
  mergeAuthoritativeCandleHistory,
  mergeBackendCandlePage,
  mergeFormingCandleEnvelope,
  resolveCanonicalServerCandle,
  upsertCandleIntoHistory,
  type LogicalRangeLike,
} from '../../../utils/candleHistory';
import type {
  ChartPostInteractionCallbacks,
  ChartPostInteractionCoordinator,
} from '../../../utils/chartPostInteractionCoordinator';
import {
  isChartSelectionLivePaintAllowed,
  shouldCommitFirstLiveSelectionBaseline,
} from '../../../utils/chartSelectionPresentation';
import type { PeriodSeparator } from '../../../utils/periodSeparators';
import { getRawQuoteSides } from '../../../utils/spreadMarkup';
import { resolveFormingCandleLiveClose } from '../../../utils/liveCandleQuote';
import type { SynchronizedMarketClockAnchor } from '../../../utils/synchronizedMarketClock';
import { getTradingChartShiftRightOffset } from '../../../utils/chartTimeFormat';
import {
  alignTimeframeBoundarySeconds,
  getTimeframePeriodSeconds,
} from '../../../utils/timeframeBoundary';
import type {
  Candle,
  ChartSelectionPresentationGate,
  ChartType,
  Timeframe,
  TradingViewChartTheme,
} from '../../../types/chart';
import {
  getDisplayVolume,
  getValidSortedCandles,
  isCandleAtOrBeforeFinalizedTime,
  markFinalizedCandleTime,
  resolveCandleFinalityFromActivePeriod,
  shouldRecomputeMarketGapSeparatorsForCandle,
} from '../../../components/TradingChart.helpers';
import {
  LIVE_CHART_UPDATE_INTERVAL_MS,
  getStartupSnapshotCandleCount,
  shouldBuildVolumeData,
  shouldScrollToRealtime,
} from './chartRuntime';
import type { ChartDataRenderRequest } from './chartRuntimeContracts';
import type { ActiveTradeSnapshot } from './useTradingChartTradeRuntime';
import {
  TRADE_LEVEL_CROSS_CLOSE_CANDIDATE_TTL_MS,
  TRADE_LEVEL_CROSS_REFRESH_MIN_DISPATCH_INTERVAL_MS,
} from '../presentation/tradeOverlayPresentation';

interface UseTradingChartLiveCandleRuntimeOptions {
  discardRetainedPublicChartSurface: () => void;
  activeTradeSnapshotsRef: RefObject<Map<string, ActiveTradeSnapshot>>;
  applyAreaTrendColors: (latestClose?: number) => void;
  authToken: string | null;
  autoScrollEnabledRef: RefObject<boolean>;
  brokerAccountSessionScope: string;
  brokerTimeOffsetSecRef: RefObject<number>;
  cancelQueuedChartRender: () => void;
  candlesRef: RefObject<Candle[]>;
  chartRef: RefObject<IChartApi | null>;
  chartSelectionPresentationKey: string;
  chartSelectionPresentationRef: RefObject<ChartSelectionPresentationGate>;
  chartSettingsRef: RefObject<ChartProperties>;
  chartThemeRef: RefObject<TradingViewChartTheme>;
  clearPeriodSeparators: () => void;
  currentCandleRef: RefObject<Candle | null>;
  drawingRenderFrameRef: RefObject<number | null>;
  drawingRenderSettledFrameRef: RefObject<number | null>;
  drawingRuntimeContextRef: RefObject<{ contextId: string; accountScope?: string; symbol: string; timeframe: Timeframe }>;
  firstRenderedCandleTimeRef: RefObject<number | null>;
  flushPostInteractionWork: () => boolean;
  getSynchronizedChartMarketNowMs: () => number;
  hasDisplayedHistoryRef: RefObject<boolean>;
  hideLivePriceOverlay: (clearPrice?: boolean) => void;
  incompatibleQuoteCountRef: RefObject<number>;
  initialHistoryLoadPendingRef: RefObject<boolean>;
  isActive: boolean;
  isActiveRef: RefObject<boolean>;
  isChartInteractionActiveRef: RefObject<boolean>;
  isDisposedRef: RefObject<boolean>;
  isLivePriceSafeForCandles: (price: number) => boolean;
  isPotentialMarketClosedPlaceholder: (candle: Candle) => boolean;
  isRebuildingRef: RefObject<boolean>;
  lastAcceptedQuoteRef: RefObject<number | null>;
  lastCrossRefreshDispatchAtRef: RefObject<number>;
  lastRenderedCandlesRef: RefObject<Candle[]>;
  lastStoreCandleSecRef: RefObject<number>;
  lastVisibleLogicalRangeRef: RefObject<LogicalRangeLike | null>;
  leftVisibleTimeRef: RefObject<number | null>;
  liveCandleMutationGenerationByTimeRef: RefObject<Map<number, number>>;
  liveCandleMutationGenerationRef: RefObject<number>;
  liveMarketDataFrozenRef: RefObject<boolean>;
  mergeCandleIntoRef: (incoming: Candle) => void;
  mergeHistoryCache: (activeTimeframe: Timeframe, candles: Candle[], brokerOffsetSeconds?: number, source?: CandleCacheSource) => void;
  periodSeparatorsRef: RefObject<PeriodSeparator[]>;
  postInteractionCallbacksRef: RefObject<ChartPostInteractionCallbacks>;
  postInteractionCoordinatorRef: RefObject<ChartPostInteractionCoordinator | null>;
  prevChartTypeRef: RefObject<ChartType>;
  prevPriceRef: RefObject<number | null>;
  prevSymbolRef: RefObject<string>;
  prevTimeframeRef: RefObject<Timeframe>;
  protectedDisplayedHistoryRef: RefObject<Candle[]>;
  reconcileCandlesWithLiveQuote: (candles: Candle[], context: string) => Candle[];
  repaintLivePriceOverlayFromCurrentPrice: (activeCandle: Candle) => void;
  renderedPriceReferenceRef: RefObject<RenderedPriceReference | null>;
  requestChartDataRender: (request?: ChartDataRenderRequest) => void;
  resetLiveQuotePriceGuard: () => void;
  resetVisibleRangeOnNextDataRef: RefObject<boolean>;
  restoreProtectedDisplayedHistory: (activeTimeframe: Timeframe, reason: string) => boolean;
  scheduleBoundaryTimerRef: RefObject<() => void>;
  scheduleDrawingRenderAfterChartData: (activeSymbol: string, activeTimeframe: Timeframe) => void;
  seriesRef: RefObject<ISeriesApi<SeriesType> | null>;
  setApiError: Dispatch<SetStateAction<string>>;
  setHistoryCache: (activeTimeframe: Timeframe, candles: Candle[], brokerOffsetSeconds?: number, source?: CandleCacheSource) => void;
  symbol: string;
  syncSupplementalPriceLines: (askPrice: number, lastPrice: number) => void;
  synchronizeChartMarketClock: (sourceTimestamp: unknown) => void;
  synchronizedMarketClockRef: RefObject<SynchronizedMarketClockAnchor | null>;
  timeframe: Timeframe;
  tradeLevelCrossCloseCandidatesRef: RefObject<Map<string, number>>;
  tradeLevelCrossRefreshPendingRef: RefObject<Set<string>>;
  updateChartData: (candles: Candle[], currentChartType?: ChartType, request?: ChartDataRenderRequest) => void;
  updateLegendDOM: (open: number, high: number, low: number, close: number, volume: number) => void;
  validateRenderedCandlesAgainstLivePrice: (price: number, activeTimeframe: Timeframe) => boolean;
  visibleRuntime: TradingChartVisibleRuntime;
  volumeRef: RefObject<ISeriesApi<SeriesType> | null>;
}

export const useTradingChartLiveCandleRuntime = (options: UseTradingChartLiveCandleRuntimeOptions): void => {
  const {
    activeTradeSnapshotsRef, applyAreaTrendColors, authToken, autoScrollEnabledRef,
    brokerAccountSessionScope, brokerTimeOffsetSecRef, cancelQueuedChartRender, candlesRef,
    chartRef, chartSelectionPresentationKey, chartSelectionPresentationRef, chartSettingsRef,
    chartThemeRef, clearPeriodSeparators, currentCandleRef, discardRetainedPublicChartSurface, drawingRenderFrameRef,
    drawingRenderSettledFrameRef, drawingRuntimeContextRef, firstRenderedCandleTimeRef,
    flushPostInteractionWork, getSynchronizedChartMarketNowMs, hasDisplayedHistoryRef,
    hideLivePriceOverlay, incompatibleQuoteCountRef, initialHistoryLoadPendingRef, isActive,
    isActiveRef, isChartInteractionActiveRef, isDisposedRef, isLivePriceSafeForCandles,
    isPotentialMarketClosedPlaceholder, isRebuildingRef, lastAcceptedQuoteRef,
    lastCrossRefreshDispatchAtRef, lastRenderedCandlesRef, lastStoreCandleSecRef,
    lastVisibleLogicalRangeRef, leftVisibleTimeRef,
    liveCandleMutationGenerationByTimeRef, liveCandleMutationGenerationRef,
    liveMarketDataFrozenRef, mergeCandleIntoRef, mergeHistoryCache, periodSeparatorsRef,
    postInteractionCallbacksRef, postInteractionCoordinatorRef, prevChartTypeRef, prevPriceRef,
    prevSymbolRef, prevTimeframeRef, protectedDisplayedHistoryRef, reconcileCandlesWithLiveQuote,
    repaintLivePriceOverlayFromCurrentPrice, renderedPriceReferenceRef, requestChartDataRender,
    resetLiveQuotePriceGuard, resetVisibleRangeOnNextDataRef, restoreProtectedDisplayedHistory,
    scheduleBoundaryTimerRef, scheduleDrawingRenderAfterChartData, seriesRef, setApiError,
    setHistoryCache, symbol, syncSupplementalPriceLines, synchronizeChartMarketClock,
    synchronizedMarketClockRef, timeframe, tradeLevelCrossCloseCandidatesRef,
    tradeLevelCrossRefreshPendingRef, updateChartData, updateLegendDOM,
    validateRenderedCandlesAgainstLivePrice, visibleRuntime, volumeRef,
  } = options;

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
    let pendingSupplementalPriceLines: { ask: number; last: number; time: number } | null = null;
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
      const rightOffset = getTradingChartShiftRightOffset(
        prevTimeframeRef.current || timeframe,
        chartSettingsRef.current.chartShift,
      );
      // Decide before appending: adding a bar changes the scroll position even
      // when the user was following the last candle immediately beforehand.
      const followRealtime = isNewCandle && shouldScrollToRealtime(
        chartRef.current,
        autoScrollEnabledRef.current,
        chartSettingsRef.current.chartAutoScroll,
        rightOffset,
      );
      if (isNewCandle) {
        console.log(`[Push] 🆕 NEW candle → time=${new Date((c.time as number) * 1000).toISOString()}, O=${c.open} H=${c.high} L=${c.low} C=${c.close}`);
      }
      try {
        const ct = prevChartTypeRef.current || 'candlestick';
        if (ct === 'line' || ct === 'area') {
          series.update({ time: c.time as Time, value: c.close });
          if (ct === 'area') applyAreaTrendColors(c.close);
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
          followRealtime &&
          chartRef.current &&
          !isDisposedRef.current
        ) {
          try {
            chartRef.current.timeScale().scrollToPosition(rightOffset, false);
          } catch { /* chart may be rebuilding */ }
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
          getTradingChartShiftRightOffset(prevTimeframeRef.current || timeframe, chartSettingsRef.current.chartShift),
        )
      ) {
        try {
          chartRef.current.timeScale().scrollToPosition(
            getTradingChartShiftRightOffset(prevTimeframeRef.current || timeframe, chartSettingsRef.current.chartShift),
            false,
          );
        } catch { /* chart may be rebuilding */ }
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

      // A quote received during login cannot draw account price lines over the
      // public guest canvas. Resume once its owned baseline commits, even if
      // no newer quote has arrived; recheck against that new candle scale.
      if (pendingSupplementalPriceLines && canPaintLiveChart(true)) {
        const pending = pendingSupplementalPriceLines;
        pendingSupplementalPriceLines = null;
        if ((!currentCandleRef.current || pending.time >= currentCandleRef.current.time)
          && validateRenderedCandlesAgainstLivePrice(pending.last, prevTimeframeRef.current || timeframe)
          && isLivePriceSafeForCandles(pending.last)) {
          syncSupplementalPriceLines(pending.ask, pending.last);
        }
      }

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
      // spread markup. The candle and its current-price line share raw Bid;
      // order controls and the optional Ask line retain executable quotes.
      const candleQuote = getRawQuoteSides(tick);
      const price = getChartPriceFromQuote(candleQuote);
      if (price == null || !tick || !candleQuote) return;
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
          discardRetainedPublicChartSurface();
          try { seriesRef.current?.setData([]); } catch { /* chart may be rebuilding */ }
          try { volumeRef.current?.setData([]); } catch { /* chart may be rebuilding */ }
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
      if (canPaintLiveChart(true)) {
        pendingSupplementalPriceLines = null;
        syncSupplementalPriceLines(Number(tick.ask ?? tick.bid), price);
      } else {
        pendingSupplementalPriceLines = { ask: Number(tick.ask ?? tick.bid), last: price, time: ts };
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
      c = resolveCanonicalServerCandle(currentCandleRef.current, c);
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
    const resolveServerM1LiveClose = (candle: Candle): Candle => {
      const quote = window.rtxTickCache?.get(normalizedSymbol)
        ?? useAppStore.getState().ticks[normalizedSymbol];
      return resolveFormingCandleLiveClose(candle, quote, symbol, 'M1', brokerTimeOffsetSecRef.current);
    };
    const reconcileServerM1Candle = (candle: Candle): Candle => {
      const classifiedCandle = resolveServerM1LiveClose(classifyServerM1CandleFinality(candle));
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
        const rawSnapshot = getValidSortedCandles(snapshot as Candle[])
          .map(classifyServerM1CandleFinality).map(resolveServerM1LiveClose);
        // FIX: Validate the exact backend scale before either painting M1 or
        // feeding M1 into a derived timeframe. An incompatible page fails closed.
        const reconciledSnapshot = reconcileCandlesWithLiveQuote(rawSnapshot, 'stream snapshot');
        if (reconciledSnapshot.length === 0) return;
        const displayedStreamTimeframe = getDisplayedStreamTimeframe();
        let displaySnapshot = reconciledSnapshot;
        if (displayedStreamTimeframe !== 'M1') {
          const existingM1: Candle[] = candleAggregationService.getCandles(symbol, 'M1', true, false)
            .map(candle => ({ ...candle, closed: candle.isComplete === true }));
          const latestM1 = existingM1[existingM1.length - 1];
          const m1Seed = mergeAuthoritativeCandleHistory(existingM1, reconciledSnapshot, {
            formingLiveCandle: latestM1,
            hasNewerLiveMutation: liveCandleMutationGenerationRef.current > 0,
          });
          // Rebuild once for the whole page, rather than rebuilding all higher
          // timeframes for every M1 row. Explicit backend finality wins over the
          // local clock when seeding the forming minute.
          candleAggregationService.loadHistoricalCandles(
            symbol, 'M1', m1Seed.map(candle => ({
              ...candle, isComplete: candle.closed,
            })), brokerTimeOffsetSecRef.current,
          );
          const derived = aggregateM1CandlesToTimeframe(
            reconciledSnapshot, displayedStreamTimeframe, brokerTimeOffsetSecRef.current,
          ).map(candle => ({ ...candle, volume: candle.volume ?? 0 }));
          const activePeriodStart = getTimeframePeriodSeconds(
            getSynchronizedChartMarketNowMs() / 1000,
            displayedStreamTimeframe,
            brokerTimeOffsetSecRef.current,
          )?.startTime;
          displaySnapshot = omitPartialLeadingM1Aggregate(
            derived, reconciledSnapshot[0].time,
            displayedStreamTimeframe, brokerTimeOffsetSecRef.current,
          ).map(candle => resolveCandleFinalityFromActivePeriod(candle, activePeriodStart));
          if (displaySnapshot.length === 0) return;
        }
        const activeFormingCandle = currentCandleRef.current;
        const protectedSnapshot = activeFormingCandle
          ? displaySnapshot.map((snapshotCandle) => (
            resolveCanonicalServerCandle(activeFormingCandle, snapshotCandle)
          ))
          : displaySnapshot;
        // FIX: A snapshot may end on an explicitly final row. Seal it before
        // cached quote polling can mutate that timestamp again.
        protectedSnapshot.forEach((snapshotCandle) => {
          if (snapshotCandle.closed === true) {
            markFinalizedCandleTime(finalizedCandleTimeByTimeframe, displayedStreamTimeframe, snapshotCandle.time);
          }
        });
        // FIX: Seed the canonical M1 builder from the same protected snapshot
        // painted by the chart, so raw ticks and backend OHLC cannot diverge.
        if (displayedStreamTimeframe === 'M1') {
          candleAggregationService.loadHistoricalCandles(
            symbol,
            'M1',
            formatHistoryForOhlcv(protectedSnapshot).map((candle, index) => ({
              ...candle, isComplete: protectedSnapshot[index].closed,
            })),
            brokerTimeOffsetSecRef.current,
          );
          const explicitFinal = [...protectedSnapshot].reverse().find(item => item.closed === true);
          if (explicitFinal) reconcileServerM1Candle(explicitFinal);
        }
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
          displayedStreamTimeframe === 'M1' ? 'backend' : 'derived-m1',
        );
        updateChartData(candlesRef.current, undefined, {
          immediate: true,
          releaseLivePaintAfterRender: true,
          // A current-session first page can reveal the chart while REST
          // fills older history. Keep sparse tick clusters behind the loader.
          finishLoadingAfterRender: !initialHistoryLoadPendingRef.current
            || protectedSnapshot.length >= getStartupSnapshotCandleCount(displayedStreamTimeframe),
          reason: 'stream-snapshot',
        });
        currentCandleRef.current = candlesRef.current[candlesRef.current.length - 1] ?? currentCandleRef.current;
        if (currentCandleRef.current) {
          repaintLivePriceOverlayOrDefer(currentCandleRef.current);
        }
        // Readiness is reported by the render owner after setData completes.
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
  }, [
    symbol,
    authToken,
    applyAreaTrendColors,
    brokerAccountSessionScope,
    chartSelectionPresentationKey,
    getSynchronizedChartMarketNowMs,
    synchronizeChartMarketClock,
  ]);
};
