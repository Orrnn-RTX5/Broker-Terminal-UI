import type { FetchCandlesOptions, OHLCData } from './chartDataService';
import { chartDataService } from './chartDataService';
import {
  buildOlderHistoryRangeFallbackWindows,
  normalizeCandlePageAscending,
} from '../utils/candleHistory';
import {
  fetchDerivedTimeframeCandlesFromM1,
  isM1DerivedFallbackTimeframe,
} from './derivedTimeframeHistoryService';

export const DEFAULT_HISTORY_PAGE_SIZE = 3000;
export const M1_HISTORY_PAGE_SIZE = 5000;
export const M1_OLDER_HISTORY_RANGE_FALLBACK_WINDOWS = 8;

export type FetchCandlesPage = (options: FetchCandlesOptions) => Promise<OHLCData[]>;

export interface OlderHistoryPageOptions {
  symbol: string;
  timeframe: string;
  olderThanRaw: number;
  signal?: AbortSignal;
  pageSize?: number;
  timeframeSeconds?: number;
  maxRangeFallbackWindows?: number;
  yieldBetweenPages?: (signal: AbortSignal) => Promise<void> | void;
  fetchCandles?: FetchCandlesPage;
}

export interface OlderHistoryPageResult {
  candles: OHLCData[];
  requestedTo: number;
  pageSize: number;
  attempts: number;
  usedRangeFallback: boolean;
  usedDerivedFallback: boolean;
  source: 'backend' | 'derived-m1';
}

export interface ChartHistoryBackfillDiagnostics {
  loadingOlder: boolean;
  pagesLoaded: number;
  candlesLoaded: number;
  oldestTime: number | null;
  hasReachedBeginning: boolean;
  lastError: string | null;
  lastStopReason: string | null;
}

const normalizeTimeframe = (timeframe: string): string => String(timeframe || '').trim().toUpperCase();

export const getHistoryPageSize = (timeframe: string): number => (
  normalizeTimeframe(timeframe) === 'M1' ? M1_HISTORY_PAGE_SIZE : DEFAULT_HISTORY_PAGE_SIZE
);

export const getInitialHistoryCount = (timeframe: string, defaultCount: number): number => (
  normalizeTimeframe(timeframe) === 'M1' ? M1_HISTORY_PAGE_SIZE : defaultCount
);

export const selectOlderCandlesBeforeCursor = (
  candles: readonly OHLCData[],
  olderThanRaw: number,
): OHLCData[] => (
  normalizeCandlePageAscending(candles).filter(candle => candle.time < olderThanRaw)
);

export const getNextOlderHistoryCursor = (olderCandlesAscending: readonly OHLCData[]): number | null => {
  const oldest = normalizeCandlePageAscending(olderCandlesAscending)[0]?.time;
  return Number.isFinite(oldest) ? oldest : null;
};

export const createChartHistoryBackfillDiagnostics = (
  oldestTime: number | null = null,
): ChartHistoryBackfillDiagnostics => ({
  loadingOlder: false,
  pagesLoaded: 0,
  candlesLoaded: 0,
  oldestTime,
  hasReachedBeginning: false,
  lastError: null,
  lastStopReason: null,
});

export const markHistoryBackfillStarted = (
  current: ChartHistoryBackfillDiagnostics,
  oldestTime: number | null = current.oldestTime,
): ChartHistoryBackfillDiagnostics => ({
  ...current,
  loadingOlder: true,
  oldestTime,
  hasReachedBeginning: false,
  lastError: null,
  lastStopReason: null,
});

export const markHistoryBackfillPageLoaded = (
  current: ChartHistoryBackfillDiagnostics,
  addedCandles: number,
  oldestTime: number | null,
): ChartHistoryBackfillDiagnostics => ({
  ...current,
  loadingOlder: true,
  pagesLoaded: current.pagesLoaded + 1,
  candlesLoaded: current.candlesLoaded + Math.max(0, Math.floor(addedCandles)),
  oldestTime,
  lastError: null,
});

export const markHistoryBackfillStopped = (
  current: ChartHistoryBackfillDiagnostics,
  reason: string,
  hasReachedBeginning = current.hasReachedBeginning,
): ChartHistoryBackfillDiagnostics => ({
  ...current,
  loadingOlder: false,
  hasReachedBeginning,
  lastStopReason: reason,
});

export const markHistoryBackfillError = (
  current: ChartHistoryBackfillDiagnostics,
  error: unknown,
): ChartHistoryBackfillDiagnostics => ({
  ...current,
  loadingOlder: false,
  lastError: error instanceof Error ? error.message : String(error),
  lastStopReason: 'error',
});

export const fetchOlderHistoryPage = async ({
  symbol,
  timeframe,
  olderThanRaw,
  signal,
  pageSize = getHistoryPageSize(timeframe),
  timeframeSeconds = 60,
  maxRangeFallbackWindows = M1_OLDER_HISTORY_RANGE_FALLBACK_WINDOWS,
  yieldBetweenPages,
  fetchCandles = chartDataService.fetchCandles.bind(chartDataService),
}: OlderHistoryPageOptions): Promise<OlderHistoryPageResult> => {
  const requestedTo = Math.floor(olderThanRaw) - 1;
  if (signal?.aborted) {
    return {
      candles: [],
      requestedTo,
      pageSize,
      attempts: 0,
      usedRangeFallback: false,
      usedDerivedFallback: false,
      source: 'backend',
    };
  }

  const directCandles = normalizeCandlePageAscending(await fetchCandles({
    symbol,
    timeframe,
    count: pageSize,
    to: requestedTo,
    signal,
  }));

  const normalizedTimeframe = normalizeTimeframe(timeframe);
  const directHasOlderCandles = directCandles.some(candle => candle.time < olderThanRaw);
  if (normalizedTimeframe !== 'M1' && !directHasOlderCandles && isM1DerivedFallbackTimeframe(timeframe)) {
    const derivedCandles = await fetchDerivedTimeframeCandlesFromM1({
      symbol,
      targetTimeframe: timeframe,
      olderThanRaw,
      signal,
      yieldBetweenPages,
      fetchCandles,
    });

    if (derivedCandles.candles.length > 0) {
      return {
        candles: derivedCandles.candles,
        requestedTo,
        pageSize,
        attempts: 1 + derivedCandles.pagesFetched,
        usedRangeFallback: false,
        usedDerivedFallback: true,
        source: 'derived-m1',
      };
    }
  }

  if (normalizedTimeframe !== 'M1' || directHasOlderCandles) {
    return {
      candles: directCandles,
      requestedTo,
      pageSize,
      attempts: 1,
      usedRangeFallback: false,
      usedDerivedFallback: false,
      source: 'backend',
    };
  }

  const fallbackWindows = buildOlderHistoryRangeFallbackWindows(
    requestedTo,
    timeframeSeconds,
    pageSize,
    maxRangeFallbackWindows,
  );

  let attempts = 1;
  for (const windowRange of fallbackWindows) {
    if (signal?.aborted) {
      return {
        candles: [],
        requestedTo,
        pageSize,
        attempts,
        usedRangeFallback: true,
        usedDerivedFallback: false,
        source: 'backend',
      };
    }

    attempts += 1;
    const rangedCandles = normalizeCandlePageAscending(await fetchCandles({
      symbol,
      timeframe,
      count: pageSize,
      from: windowRange.from,
      to: windowRange.to,
      signal,
    }));

    if (rangedCandles.some(candle => candle.time < olderThanRaw)) {
      return {
        candles: rangedCandles,
        requestedTo,
        pageSize,
        attempts,
        usedRangeFallback: true,
        usedDerivedFallback: false,
        source: 'backend',
      };
    }
  }

  return {
    candles: directCandles,
    requestedTo,
    pageSize,
    attempts,
    usedRangeFallback: false,
    usedDerivedFallback: false,
    source: 'backend',
  };
};
