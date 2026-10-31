import {
  useCallback,
  type Dispatch,
  type RefObject,
  type SetStateAction,
} from 'react';
import type { IChartApi, ISeriesApi, SeriesType } from 'lightweight-charts';
import { waitForTerminalReady } from '../../../startup/waitForTerminalReady';
import {
  candleAggregationService,
  omitPartialLeadingM1Aggregate,
  type OHLCV,
  type Timeframe as AggTimeframe,
} from '../../../services/candleAggregationService';
import {
  candleCache,
  type CandleCacheKey,
  type CandleCacheMetadata,
  type CandleCacheSource,
} from '../../../services/candleCache';
import { chartDataService } from '../../../services/chartDataService';
import { captureHistoryGapRequestScope } from '../../../services/chartHistoryGapRequests';
import {
  fetchDerivedTimeframeCandlesFromM1,
  getDerivedM1InitialTargetCandleLimit,
  isM1DerivedFallbackTimeframe,
  prefersNativeTimeframeHistory,
} from '../../../services/derivedTimeframeHistoryService';
import {
  backfillRecentInteriorHistoryGaps,
  FIRST_PAINT_HISTORY_COUNT,
  mergeMissingHistoryCandles,
  createChartHistoryBackfillDiagnostics,
  getHistoryPageSize,
  markHistoryBackfillError,
  markHistoryBackfillPageLoaded,
  markHistoryBackfillStarted,
  markHistoryBackfillStopped,
  selectOlderCandlesBeforeCursor,
  type ChartHistoryBackfillDiagnostics,
  type SelectedTimeframeHistoryCoordinator,
} from '../../../services/chartHistoryLoader';
import {
  createRenderedPriceReference,
  type RenderedPriceReference,
} from '../../../services/chartPriceGuards';
import type { ChartProperties } from '../../../store/useChartSettingsStore';
import { useAppStore } from '../../../store/useAppStore';
import {
  formatHistoryForOhlcv,
  mergeAuthoritativeCandleHistory,
  mergeHistoricalCandlesWithBufferedLive,
  prependCandleHistory,
  selectCandlesMutatedAfterGeneration,
  selectOlderHistoryCandlesForMerge,
  upsertCandleIntoHistory,
} from '../../../utils/candleHistory';
import {
  getTradingChartDefaultVisibleBars,
} from '../../../utils/chartTimeFormat';
import { resolveFormingCandleLiveClose } from '../../../utils/liveCandleQuote';
import {
  CANDLE_TIMEFRAMES,
  getTimeframePeriodSeconds,
} from '../../../utils/timeframeBoundary';
import type { Candle, ChartType, Timeframe } from '../../../types/chart';
import {
  getDisplayVolume,
  getValidSortedCandles,
  shouldResetInitialHistoryVisibleRange,
} from '../../../components/TradingChart.helpers';
import {
  applyBrokerTimeOffset,
  getInitialHistoryCount,
  getStartupSnapshotCandleCount,
  isAbortError,
  mergeCandleCollections,
  waitForProgressiveHistoryIdleTurn,
} from './chartRuntime';
import type { ChartDataRenderRequest } from './chartRuntimeContracts';
import type { ChartHistoryPage } from './useTradingChartHistoryCache';

type LoadingPhase = 'connecting' | 'receiving' | 'ready' | 'hidden';

interface UseTradingChartHistoryLoadingOptions {
  discardRetainedPublicChartSurface: () => void;
  brokerTimeOffsetSec: number;
  brokerTimeOffsetSecRef: RefObject<number>;
  buildHistoryCacheTarget: (activeTimeframe: Timeframe) => {
    key: CandleCacheKey;
    metadata: CandleCacheMetadata;
  };
  candlesRef: RefObject<Candle[]>;
  chartRef: RefObject<IChartApi | null>;
  chartSettingsRef: RefObject<ChartProperties>;
  currentCandleRef: RefObject<Candle | null>;
  fetchOlderHistoryPage: (
    activeTimeframe: Timeframe,
    olderThanRaw: number,
    signal?: AbortSignal,
  ) => Promise<ChartHistoryPage>;
  getLatestRenderableCandle: (candles: Candle[]) => Candle | null;
  hasDisplayedHistoryRef: RefObject<boolean>;
  hasReachedBeginningRef: RefObject<boolean>;
  historyBackfillDiagnosticsRef: RefObject<ChartHistoryBackfillDiagnostics>;
  historyRequestCoordinatorRef: RefObject<SelectedTimeframeHistoryCoordinator>;
  hydrateHistoryFromCache: (activeTimeframe: Timeframe, reason: string) => boolean;
  initialHistoryLoadPendingRef: RefObject<boolean>;
  initialHistoryLoadSequenceRef: RefObject<number>;
  isDisposedRef: RefObject<boolean>;
  isLoadingMoreRef: RefObject<boolean>;
  isVisibleRangeHistoryLoadSuppressed: () => boolean;
  lastStoreCandleSecRef: RefObject<number>;
  liveCandleMutationGenerationByTimeRef: RefObject<Map<number, number>>;
  liveCandleMutationGenerationRef: RefObject<number>;
  mergeHistoryCache: (
    activeTimeframe: Timeframe,
    candles: Candle[],
    brokerOffsetSeconds?: number,
    source?: CandleCacheSource,
  ) => void;
  prevPriceRef: RefObject<number | null>;
  prevTimeframeRef: RefObject<Timeframe>;
  protectedDisplayedHistoryRef: RefObject<Candle[]>;
  reconcileCandlesWithLiveQuote: (candles: Candle[], context: string) => Candle[];
  reloadAggregationCandles: (
    candles: Candle[],
    activeTimeframe: Timeframe,
    boundaryOffsetSeconds?: number,
  ) => void;
  renderedPriceReferenceRef: RefObject<RenderedPriceReference>;
  requestChartDataRender: (request?: ChartDataRenderRequest) => void;
  resetEmptyHistoryState: (activeTimeframe: Timeframe) => void;
  resetLiveQuotePriceGuard: () => void;
  resetVisibleRangeOnNextDataRef: RefObject<boolean>;
  restoreProtectedDisplayedHistory: (activeTimeframe: Timeframe, reason: string) => boolean;
  scheduleBoundaryTimerRef: RefObject<(() => void) | null>;
  seriesRef: RefObject<ISeriesApi<SeriesType> | null>;
  setApiError: Dispatch<SetStateAction<string | null>>;
  setHistoryCache: (
    activeTimeframe: Timeframe,
    candles: Candle[],
    brokerOffsetSeconds?: number,
    source?: CandleCacheSource,
  ) => void;
  setLoadingPhase: Dispatch<SetStateAction<LoadingPhase>>;
  symbol: string;
  timeframe: Timeframe;
  updateChartData: (
    candles: Candle[],
    chartType?: ChartType,
    request?: ChartDataRenderRequest,
  ) => void;
  updateLegendDOM: (open: number, high: number, low: number, close: number, volume: number) => void;
  volumeRef: RefObject<ISeriesApi<SeriesType> | null>;
}

export function useTradingChartHistoryLoading({
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
  discardRetainedPublicChartSurface,
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
}: UseTradingChartHistoryLoadingOptions) {
  // Load historical data
  const loadHistory = useCallback(async (selectedSymbol: string, selectedTimeframe: Timeframe) => {
    if (isDisposedRef.current || !selectedSymbol) {
      console.log('[Chart] Cannot load history - symbol not set or chart disposed');
      return;
    }
    const gapRequestScope = captureHistoryGapRequestScope(chartDataService.getCandleCacheScope());

    setApiError(null);
    resetLiveQuotePriceGuard();
    const initialHistoryLoadSequence = initialHistoryLoadSequenceRef.current + 1;
    initialHistoryLoadSequenceRef.current = initialHistoryLoadSequence;
    initialHistoryLoadPendingRef.current = true;
    const activeTf = selectedTimeframe;
    console.log(`[Chart] Loading history for ${selectedSymbol}, timeframe: ${activeTf}`);

    // A real quote can arrive before history starts (including startup prefetch
    // hydration). Keep only its proven current bucket; a cached tail alone is
    // not evidence that the broker traded after the returned history page.
    const currentBeforeHydration = currentCandleRef.current;
    const provenFormingBeforeHydration = (
      selectedSymbol === symbol && activeTf === timeframe
      && currentBeforeHydration && currentBeforeHydration.closed !== true
      && (liveCandleMutationGenerationByTimeRef.current.get(currentBeforeHydration.time) ?? 0) > 0
    ) ? { ...currentBeforeHydration } : null;
    const m1BeforeHydration = provenFormingBeforeHydration
      ? candleAggregationService.getCandles(selectedSymbol, 'M1', true, false).at(-1)
      : undefined;
    const provenM1BeforeHydration = m1BeforeHydration && m1BeforeHydration.isComplete !== true
      && getTimeframePeriodSeconds(m1BeforeHydration.time, activeTf, brokerTimeOffsetSecRef.current)?.startTime === provenFormingBeforeHydration?.time
      ? { ...m1BeforeHydration } : null;

    try {
      const deriveInitialHistoryFromM1 = isM1DerivedFallbackTimeframe(activeTf)
        && !prefersNativeTimeframeHistory(activeTf);
      let historySource: CandleCacheSource = deriveInitialHistoryFromM1 ? 'derived-m1' : 'backend';
      let derivedInitialHistory: Awaited<ReturnType<typeof fetchDerivedTimeframeCandlesFromM1>> | null = null;

      // Paint any exact session cache (including M1-derived warm aggregates)
      // before starting new broker history work. This keeps timeframe clicks
      // responsive even when a refresh request is comparatively slow.
      historyRequestCoordinatorRef.current.abort();
      const hydratedFromCache = hydrateHistoryFromCache(activeTf, 'cached-history');
      const currentAfterHydration = currentCandleRef.current;
      if (!hydratedFromCache) {
        setLoadingPhase('receiving');
      }
      const liveCandleGenerationAtRequestStart = liveCandleMutationGenerationRef.current;
      const useProgressiveInitialHistory = activeTf === 'M1' && !hydratedFromCache;
      // Paint the calendar viewport first instead of asking the broker for
      // hundreds of weeks/months before revealing even one candle. Older
      // history remains available through the normal left-scroll owner.
      const initialHistoryCount = prefersNativeTimeframeHistory(activeTf)
        ? getTradingChartDefaultVisibleBars(activeTf)
        : useProgressiveInitialHistory ? FIRST_PAINT_HISTORY_COUNT : getInitialHistoryCount(activeTf);

      const historyRequest = historyRequestCoordinatorRef.current.start({
        symbol: selectedSymbol,
        timeframe: activeTf,
        count: initialHistoryCount,
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
        discardRetainedPublicChartSurface();
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

        discardRetainedPublicChartSurface();
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
      const normalizedSymbol = selectedSymbol.trim().toUpperCase();
      const currentQuote = window.rtxTickCache?.get(selectedSymbol)
        ?? window.rtxTickCache?.get(normalizedSymbol)
        ?? useAppStore.getState().ticks[selectedSymbol]
        ?? useAppStore.getState().ticks[normalizedSymbol];
      const resolveLatestFormingHistoryQuote = (rows: Candle[], historyTimeframe: Timeframe): Candle[] => {
        const last = rows[rows.length - 1];
        if (!last) return rows;
        const quoted = resolveFormingCandleLiveClose(
          last, currentQuote, selectedSymbol, historyTimeframe, explicitBrokerOffsetSeconds,
        );
        if (quoted === last) return rows;
        const [validated] = reconcileCandlesWithLiveQuote([quoted], 'forming history quote');
        return validated ? [...rows.slice(0, -1), validated] : rows;
      };

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
      const latestBackendTime = candles[candles.length - 1].time;
      const currentAtCommit = currentCandleRef.current;
      const capturedBucketWasFinalized = provenFormingBeforeHydration && (
        (currentAtCommit?.time === provenFormingBeforeHydration.time && currentAtCommit.closed === true)
        || candlesRef.current.some(candle => candle.time === provenFormingBeforeHydration.time && candle.closed === true)
      );
      // A server partial may expand this same bucket without a new raw-tick
      // generation. Prefer that current owner model over the captured copy;
      // use the copy only when hydration still owns the unchanged working ref.
      const latestCapturedForming = provenFormingBeforeHydration
        && currentAtCommit?.time === provenFormingBeforeHydration.time
        && currentAtCommit.closed !== true
        && (!hydratedFromCache || currentAtCommit !== currentAfterHydration)
        ? currentAtCommit : provenFormingBeforeHydration;
      const provenLaterFormingCandle = provenFormingBeforeHydration
        && provenFormingBeforeHydration.time > latestBackendTime
        && !capturedBucketWasFinalized
        ? reconcileCandlesWithLiveQuote([latestCapturedForming!], 'buffered live history')[0] ?? null : null;
      candles = mergeAuthoritativeCandleHistory(retainedHistory, candles, {
        formingLiveCandle: provenLaterFormingCandle,
        hasNewerLiveMutation: Boolean(provenLaterFormingCandle),
      });
      if (bufferedLiveCandles.length > 0) {
        // FIX: Replace the backend-covered range first, then overlay only ticks
        // mutated after the request began; explicit backend finals still win.
        candles = mergeHistoricalCandlesWithBufferedLive(candles, bufferedLiveCandles);
      }
      // The exact timestamped broker Bid owns only its forming period's Close.
      // Final rows and receipt-only/other-period quotes keep backend OHLC.
      candles = resolveLatestFormingHistoryQuote(candles, activeTf);

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
      let derivedM1Seed = historySource === 'derived-m1' && derivedInitialHistory
        ? derivedInitialHistory.m1Candles.map(candle => ({
          ...candle,
          time: candle.time - explicitBrokerOffsetSeconds,
        }))
        : [];
      if (derivedM1Seed.length > 0) {
        const displayedTail = candles[candles.length - 1];
        const latestM1 = candleAggregationService.getCandles(selectedSymbol, 'M1', true, false).at(-1);
        const provenDisplayedTail = displayedTail.closed !== true
          && (liveCandleMutationGenerationByTimeRef.current.get(displayedTail.time) ?? 0) > 0;
        const latestSourceM1Time = derivedM1Seed[derivedM1Seed.length - 1].time;
        const retainedM1Tail = provenDisplayedTail
          ? [provenM1BeforeHydration, latestM1]
            .filter((candle): candle is OHLCV => Boolean(candle && candle.isComplete !== true
              && candle.time > latestSourceM1Time
              && getTimeframePeriodSeconds(candle.time, activeTf, explicitBrokerOffsetSeconds)?.startTime === displayedTail.time))
            .sort((left, right) => left.time - right.time).at(-1)
          : undefined;
        if (retainedM1Tail) {
          // Keep the actual forming minute that produced the retained higher
          // bucket. Splitting higher-frame OHLC into a fake M1 row is unsafe.
          const [validatedM1Tail] = reconcileCandlesWithLiveQuote([{
            ...retainedM1Tail, tickVolume: retainedM1Tail.volume, closed: false,
          }], 'buffered M1 history');
          if (validatedM1Tail) {
            derivedM1Seed = mergeHistoricalCandlesWithBufferedLive(derivedM1Seed, [validatedM1Tail]);
          }
        }
        derivedM1Seed = resolveLatestFormingHistoryQuote(derivedM1Seed, 'M1');
      }
      const aggregationSeedTimeframe = derivedM1Seed.length > 0 ? 'M1' : activeTf;
      const aggregationSeedCandles = derivedM1Seed.length > 0 ? derivedM1Seed : candles;
      const ohlcvCandles: OHLCV[] = formatHistoryForOhlcv(aggregationSeedCandles).map((candle, index) => ({
        ...candle, isComplete: aggregationSeedCandles[index].closed,
      }));
      candleAggregationService.loadHistoricalCandles(
        selectedSymbol,
        aggregationSeedTimeframe as AggTimeframe,
        ohlcvCandles,
        explicitBrokerOffsetSeconds,
      );
      if (aggregationSeedTimeframe === 'M1' && activeTf !== 'M1') {
        const fullDerivedAggregates = omitPartialLeadingM1Aggregate(
          candleAggregationService.getCandles(selectedSymbol, activeTf as AggTimeframe, true, false),
          ohlcvCandles[0]?.time,
          activeTf as AggTimeframe,
          explicitBrokerOffsetSeconds,
        );
        const fullDerivedCandles = reconcileCandlesWithLiveQuote(
          getValidSortedCandles(
            fullDerivedAggregates.map(candle => ({
              ...candle,
              tickVolume: candle.volume,
              closed: candle.isComplete,
            })) as Candle[],
          ),
          'history',
        );
        if (fullDerivedCandles.length > candles.length) {
          candles = resolveLatestFormingHistoryQuote(
            mergeCandleCollections(fullDerivedCandles, candles),
            activeTf,
          );
          candlesRef.current = candles;
          renderedPriceReferenceRef.current = createRenderedPriceReference(candles);
          if (candles.length > 1) {
            hasDisplayedHistoryRef.current = true;
            if (candles.length >= protectedDisplayedHistoryRef.current.length) {
              protectedDisplayedHistoryRef.current = candles;
            }
          }
        }
      }

      // One exact M1 seed can satisfy later timeframe clicks without another
      // network round trip. Fill only missing derived-frame caches, preserving
      // any richer entry that this session already fetched.
      const warmOtherTimeframeCaches = (allowPartial = false) => {
        if (aggregationSeedTimeframe !== 'M1') return;
        if (activeTf !== 'M1' && derivedM1Seed.length > 0) {
          const { key: m1CacheKey } = buildHistoryCacheTarget('M1');
          const existingM1Cache = candleCache.getLatest(m1CacheKey);
          const warmM1Candles = getValidSortedCandles(derivedM1Seed);
          if (warmM1Candles.length > (existingM1Cache?.candles.length ?? 0)) {
            setHistoryCache('M1', warmM1Candles, explicitBrokerOffsetSeconds, 'backend');
          }
        }
        const oldestSeedTime = activeTf === 'M1' ? candlesRef.current[0]?.time : ohlcvCandles[0]?.time;
        for (const targetTf of CANDLE_TIMEFRAMES) {
          if (targetTf === 'M1' || targetTf === activeTf) continue;
          const { key: warmCacheKey } = buildHistoryCacheTarget(targetTf as Timeframe);
          const existingWarmCache = candleCache.getLatest(warmCacheKey);
          // Native calendar history owns complete broker periods. A larger but
          // shorter M1-derived cache must not replace that visited baseline.
          if (prefersNativeTimeframeHistory(targetTf) && existingWarmCache
            && existingWarmCache.source !== 'derived-m1') continue;

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
          const minWarmBars = allowPartial ? 2 : getTradingChartDefaultVisibleBars(targetTf as Timeframe);
          if (
            warmCandles.length >= minWarmBars
            && warmCandles.length > (existingWarmCache?.candles.length ?? 0)
          ) {
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
        hydratedFromCache: hydratedFromCache || (
          hasDisplayedHistoryRef.current
          && protectedDisplayedHistoryRef.current.length >= getStartupSnapshotCandleCount(activeTf)
        ),
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
          if (!await waitForTerminalReady(historyRequest.signal)) return;
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
            requestScope: gapRequestScope,
            boundaryOffsetSeconds: explicitBrokerOffsetSeconds,
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
      if (initialHistoryLoadSequenceRef.current !== initialHistoryLoadSequence || isDisposedRef.current) return;
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
  }, [
    brokerTimeOffsetSecRef,
    buildHistoryCacheTarget,
    candlesRef,
    chartRef,
    chartSettingsRef,
    currentCandleRef,
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
    lastStoreCandleSecRef,
    liveCandleMutationGenerationByTimeRef,
    liveCandleMutationGenerationRef,
    prevPriceRef,
    protectedDisplayedHistoryRef,
    reconcileCandlesWithLiveQuote,
    reloadAggregationCandles,
    renderedPriceReferenceRef,
    requestChartDataRender,
    resetEmptyHistoryState,
    discardRetainedPublicChartSurface,
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
  ]);

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
  }, [
    brokerTimeOffsetSec,
    candlesRef,
    fetchOlderHistoryPage,
    hasReachedBeginningRef,
    historyBackfillDiagnosticsRef,
    historyRequestCoordinatorRef,
    isDisposedRef,
    isLoadingMoreRef,
    isVisibleRangeHistoryLoadSuppressed,
    mergeHistoryCache,
    prevTimeframeRef,
    reconcileCandlesWithLiveQuote,
    requestChartDataRender,
    symbol,
    timeframe,
  ]);

  return { loadHistory, loadMoreHistory };
}
