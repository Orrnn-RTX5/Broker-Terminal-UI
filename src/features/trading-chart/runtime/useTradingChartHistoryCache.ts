import { useCallback, type Dispatch, type RefObject, type SetStateAction } from 'react';
import {
  candleAggregationService,
  getTimeframeSeconds,
  omitPartialLeadingM1Aggregate,
  type Timeframe as AggTimeframe,
} from '../../../services/candleAggregationService';
import {
  candleCache,
  type CandleCacheKey,
  type CandleCacheMetadata,
  type CandleCacheSource,
} from '../../../services/candleCache';
import { chartDataService } from '../../../services/chartDataService';
import {
  fetchOlderHistoryPage as fetchChartOlderHistoryPage,
  getHistoryPageSize,
} from '../../../services/chartHistoryLoader';
import {
  createRenderedPriceReference,
  isPriceCompatibleWithReference,
  type RenderedPriceReference,
} from '../../../services/chartPriceGuards';
import type { ChartProperties } from '../../../store/useChartSettingsStore';
import {
  getTimeframePeriodSeconds,
} from '../../../utils/timeframeBoundary';
import { formatHistoryForOhlcv, mergeHistoricalCandlesWithBufferedLive, type LogicalRangeLike } from '../../../utils/candleHistory';
import type { PeriodSeparator } from '../../../utils/periodSeparators';
import type { Candle, ChartType, Timeframe } from '../../../types/chart';
import {
  getDisplayVolume,
  getValidSortedCandles,
} from '../../../components/TradingChart.helpers';
import {
  getInitialHistoryCount,
  mergeCandleCollections,
  waitForProgressiveHistoryIdleTurn,
} from './chartRuntime';
import type { ChartDataRenderRequest } from './chartRuntimeContracts';

export interface ChartHistoryPage {
  candles: Candle[];
  source: CandleCacheSource;
}

interface UseTradingChartHistoryCacheOptions {
  brokerTimeOffsetSecRef: RefObject<number>;
  candlesRef: RefObject<Candle[]>;
  cancelQueuedChartRender: () => void;
  chartSettingsRef: RefObject<ChartProperties>;
  clearPeriodSeparators: () => void;
  currentCandleRef: RefObject<Candle | null>;
  firstRenderedCandleTimeRef: RefObject<number | null>;
  getCachedRenderedPriceReference: () => RenderedPriceReference;
  getLatestRenderableCandle: (candles: Candle[]) => Candle | null;
  hasDisplayedHistoryRef: RefObject<boolean>;
  hasReachedBeginningRef: RefObject<boolean>;
  isLoadingMoreRef: RefObject<boolean>;
  lastRenderedCandlesRef: RefObject<Candle[]>;
  lastStoreCandleSecRef: RefObject<number>;
  lastVisibleLogicalRangeRef: RefObject<LogicalRangeLike | null>;
  liveCandleMutationGenerationByTimeRef: RefObject<Map<number, number>>;
  periodSeparatorsRef: RefObject<PeriodSeparator[]>;
  prevPriceRef: RefObject<number | null>;
  protectedDisplayedHistoryRef: RefObject<Candle[]>;
  reloadAggregationCandles: (
    candles: Candle[],
    activeTimeframe: Timeframe,
    boundaryOffsetSeconds?: number,
  ) => void;
  renderedPriceReferenceRef: RefObject<RenderedPriceReference>;
  resetVisibleRangeOnNextDataRef: RefObject<boolean>;
  scheduleBoundaryTimerRef: RefObject<(() => void) | null>;
  setApiError: Dispatch<SetStateAction<string | null>>;
  symbol: string;
  timeframe: Timeframe;
  updateChartData: (
    candles: Candle[],
    chartType?: ChartType,
    request?: ChartDataRenderRequest,
  ) => void;
  updateLegendDOM: (open: number, high: number, low: number, close: number, volume: number) => void;
}

export function useTradingChartHistoryCache({
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
}: UseTradingChartHistoryCacheOptions) {
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
  }, [brokerTimeOffsetSecRef, buildHistoryCacheTarget, symbol]);

  const mergeHistoryCache = useCallback((
    activeTf: Timeframe,
    candles: Candle[],
    brokerOffsetSeconds = brokerTimeOffsetSecRef.current,
    source: CandleCacheSource = 'backend',
  ) => {
    if (!symbol || candles.length === 0) return;
    const { key, metadata } = buildHistoryCacheTarget(activeTf);
    candleCache.mergeLatest(key, candles, { ...metadata, brokerOffsetSeconds, source });
  }, [brokerTimeOffsetSecRef, buildHistoryCacheTarget, symbol]);

  const hydrateHistoryFromCache = useCallback((activeTf: Timeframe, reason: string): boolean => {
    if (!symbol) return false;
    const { key, metadata } = buildHistoryCacheTarget(activeTf);
    let cached = candleCache.getLatest(key);

    if (!cached || cached.candles.length === 0) {
      const retainedM1Candles = candleAggregationService.getCandlesForHydration(symbol, 'M1', brokerTimeOffsetSecRef.current);
      if (retainedM1Candles.length > (activeTf === 'M1' ? 1 : 0)) {
        const reusableWarmCandles = getValidSortedCandles(
          omitPartialLeadingM1Aggregate(
            activeTf === 'M1' ? retainedM1Candles : candleAggregationService.getCandlesForHydration(symbol, activeTf as AggTimeframe, brokerTimeOffsetSecRef.current),
            retainedM1Candles[0]?.time,
            activeTf as AggTimeframe,
            brokerTimeOffsetSecRef.current,
          ).map(candle => ({ ...candle, tickVolume: candle.volume, closed: candle.isComplete })) as Candle[],
        );
        if (reusableWarmCandles.length > 0) {
          cached = candleCache.setLatest(key, reusableWarmCandles, {
            ...metadata,
            brokerOffsetSeconds: brokerTimeOffsetSecRef.current,
            source: activeTf === 'M1' ? 'mixed' : 'derived-m1',
          });
        }
      }
    }
    if (!cached || cached.candles.length === 0) return false;

    let candles = getValidSortedCandles(cached.candles as Candle[]);
    if (candles.length === 0) return false;

    // A startup quote may already own the current bucket when an older cache
    // baseline becomes available. Join that exact selection's proven live
    // candle before the first setData instead of rewinding its model/close.
    const forming = currentCandleRef.current;
    if (
      activeTf === timeframe
      && forming
      && forming.closed !== true
      && (liveCandleMutationGenerationByTimeRef.current.get(forming.time) ?? 0) > 0
      && forming.time >= candles[candles.length - 1].time
      && isPriceCompatibleWithReference(forming.close, createRenderedPriceReference(candles))
    ) {
      candles = mergeHistoricalCandlesWithBufferedLive(candles, [forming]);
    }

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
    candleAggregationService.hydrateHistoricalCandles(
      symbol,
      activeTf as AggTimeframe,
      formatHistoryForOhlcv(candles).map((candle, index) => ({ ...candle, isComplete: candles[index].closed })),
      explicitBrokerOffsetSeconds,
    );

    updateChartData(candles, undefined, {
      immediate: true,
      resetVisibleRange: true,
      finishLoadingAfterRender: true,
      cachedBaseline: true,
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
  }, [
    brokerTimeOffsetSecRef,
    buildHistoryCacheTarget,
    cancelQueuedChartRender,
    candlesRef,
    chartSettingsRef,
    clearPeriodSeparators,
    currentCandleRef,
    firstRenderedCandleTimeRef,
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
    renderedPriceReferenceRef,
    resetVisibleRangeOnNextDataRef,
    scheduleBoundaryTimerRef,
    setApiError,
    symbol,
    timeframe,
    updateChartData,
    updateLegendDOM,
  ]);

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
  }, [
    candlesRef,
    currentCandleRef,
    hasDisplayedHistoryRef,
    protectedDisplayedHistoryRef,
    reloadAggregationCandles,
    renderedPriceReferenceRef,
    symbol,
    updateChartData,
  ]);

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
  }, [candlesRef, getCachedRenderedPriceReference, symbol]);
  return {
    buildHistoryCacheTarget,
    fetchOlderHistoryPage,
    hydrateHistoryFromCache,
    mergeHistoryCache,
    restoreProtectedDisplayedHistory,
    setHistoryCache,
    validateRenderedCandlesAgainstLivePrice,
  };
}
