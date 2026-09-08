import type { FetchCandlesOptions, OHLCData } from './chartDataService';
import { chartDataService } from './chartDataService';
import {
  buildOlderHistoryRangeFallbackWindows,
  mergeBackendCandlePage,
  normalizeCandlePageAscending,
} from '../utils/candleHistory';
import {
  fetchDerivedTimeframeCandlesFromM1,
  isM1DerivedFallbackTimeframe,
} from './derivedTimeframeHistoryService';

export const DEFAULT_HISTORY_PAGE_SIZE = 3000;
export const M1_HISTORY_PAGE_SIZE = 5000;
export const FIRST_PAINT_HISTORY_COUNT = 500;
export const M5_HISTORY_PAGE_SIZE = 5000;
export const M1_OLDER_HISTORY_RANGE_FALLBACK_WINDOWS = 8;
export const M1_INTERIOR_GAP_LOOKBACK_SECONDS = 12 * 60 * 60;
export const M1_INTERIOR_GAP_MAX_SECONDS = 2 * 60 * 60;
export const M1_INTERIOR_GAP_MAX_REQUESTS = 12;
export const M1_INTERIOR_GAP_MAX_MISSING_CANDLES = 500;
export const M1_INTERIOR_GAP_REQUEST_CONCURRENCY = 4;
export const M1_INTERIOR_GAP_MAX_PASSES = 2;

export type FetchCandlesPage = (options: FetchCandlesOptions) => Promise<OHLCData[]>;

/** A late gap repair may add missing buckets, but must never rewind live OHLC. */
export const mergeMissingHistoryCandles = <T extends OHLCData>(
  current: readonly T[],
  repaired: readonly T[],
): { candles: T[]; addedCount: number } => {
  const existingTimes = new Set(current.map(candle => candle.time));
  const missing = repaired.filter(candle => !existingTimes.has(candle.time));
  return mergeBackendCandlePage(current, missing);
};

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

export interface InteriorHistoryGap {
  from: number;
  to: number;
  missingCandleCount: number;
}

export interface RecentInteriorHistoryGapOptions {
  timeframeSeconds?: number;
  lookbackSeconds?: number;
  maxGapSeconds?: number;
  maxRequests?: number;
  maxMissingCandles?: number;
}

export interface BackfillRecentInteriorHistoryGapsOptions extends RecentInteriorHistoryGapOptions {
  symbol: string;
  timeframe: string;
  candles: readonly OHLCData[];
  signal?: AbortSignal;
  concurrency?: number;
  maxPasses?: number;
  fetchCandles?: FetchCandlesPage;
}

export interface BackfillRecentInteriorHistoryGapsResult {
  candles: OHLCData[];
  requestedGaps: number;
  failedGaps: number;
  addedCandles: number;
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

export interface SelectedTimeframeHistoryRequest {
  sequence: number;
  timeframe: string;
  signal: AbortSignal;
  fetchOptions: FetchCandlesOptions;
  result: Promise<OHLCData[]>;
  isCurrent: () => boolean;
}

export interface SelectedTimeframeHistoryCoordinator {
  start: (options: {
    symbol: string;
    timeframe: string;
    count: number;
  }, fetchCandles: FetchCandlesPage) => SelectedTimeframeHistoryRequest;
  abort: () => void;
  getActiveSignal: () => AbortSignal | undefined;
}

export type VisibleRangeHistoryAction = 'none' | 'defer' | 'load';

export const createSelectedTimeframeHistoryCoordinator = (): SelectedTimeframeHistoryCoordinator => {
  let sequence = 0;
  let active: { sequence: number; controller: AbortController } | null = null;

  return {
    start: ({ symbol, timeframe, count }, fetchCandles) => {
      active?.controller.abort();

      const controller = new AbortController();
      const requestSequence = sequence + 1;
      sequence = requestSequence;
      active = { sequence: requestSequence, controller };

      const fetchOptions = {
        symbol,
        timeframe,
        count,
        signal: controller.signal,
      };

      return {
        sequence: requestSequence,
        timeframe,
        signal: controller.signal,
        fetchOptions,
        result: fetchCandles(fetchOptions),
        isCurrent: () => (
          active?.sequence === requestSequence
          && active.controller === controller
          && !controller.signal.aborted
        ),
      };
    },
    abort: () => {
      active?.controller.abort();
      active = null;
    },
    getActiveSignal: () => active?.controller.signal,
  };
};

export const resolveVisibleRangeHistoryAction = ({
  logicalFrom,
  suppressed,
  interactionActive,
  userInitiated,
  threshold = 50,
}: {
  logicalFrom: number | null | undefined;
  suppressed: boolean;
  interactionActive: boolean;
  userInitiated: boolean;
  threshold?: number;
}): VisibleRangeHistoryAction => {
  if (!userInitiated || !Number.isFinite(logicalFrom) || (logicalFrom as number) >= threshold || suppressed) return 'none';
  return interactionActive ? 'defer' : 'load';
};

export const resolveDeferredVisibleRangeHistoryAction = ({
  pending,
  logicalFrom,
  suppressed,
  userInitiated,
  threshold = 50,
}: {
  pending: boolean;
  logicalFrom: number | null | undefined;
  suppressed: boolean;
  userInitiated: boolean;
  threshold?: number;
}): VisibleRangeHistoryAction => {
  if (!pending) return 'none';
  return resolveVisibleRangeHistoryAction({
    logicalFrom,
    suppressed,
    interactionActive: false,
    userInitiated,
    threshold,
  });
};

const normalizeTimeframe = (timeframe: string): string => String(timeframe || '').trim().toUpperCase();

export const getHistoryPageSize = (timeframe: string): number => {
  const normalizedTimeframe = normalizeTimeframe(timeframe);
  if (normalizedTimeframe === 'M1') return M1_HISTORY_PAGE_SIZE;
  if (normalizedTimeframe === 'M5') return M5_HISTORY_PAGE_SIZE;
  return DEFAULT_HISTORY_PAGE_SIZE;
};

export const getInitialHistoryCount = (timeframe: string, defaultCount: number): number => (
  normalizeTimeframe(timeframe) === 'M1' ? M1_HISTORY_PAGE_SIZE : defaultCount
);

export const selectOlderCandlesBeforeCursor = (
  candles: readonly OHLCData[],
  olderThanRaw: number,
): OHLCData[] => (
  normalizeCandlePageAscending(candles).filter(candle => candle.time < olderThanRaw)
);

export const findRecentInteriorHistoryGaps = (
  candles: readonly OHLCData[],
  {
    timeframeSeconds = 60,
    lookbackSeconds = M1_INTERIOR_GAP_LOOKBACK_SECONDS,
    maxGapSeconds = M1_INTERIOR_GAP_MAX_SECONDS,
    maxRequests = M1_INTERIOR_GAP_MAX_REQUESTS,
    maxMissingCandles = M1_INTERIOR_GAP_MAX_MISSING_CANDLES,
  }: RecentInteriorHistoryGapOptions = {},
): InteriorHistoryGap[] => {
  if (
    !Number.isFinite(timeframeSeconds)
    || timeframeSeconds <= 0
    || !Number.isFinite(lookbackSeconds)
    || lookbackSeconds <= 0
    || !Number.isFinite(maxGapSeconds)
    || maxGapSeconds <= timeframeSeconds
    || !Number.isFinite(maxRequests)
    || maxRequests <= 0
    || !Number.isFinite(maxMissingCandles)
    || maxMissingCandles <= 0
  ) return [];

  const normalized = normalizeCandlePageAscending(candles);
  const newestTime = normalized[normalized.length - 1]?.time;
  if (!Number.isFinite(newestTime)) return [];

  const cutoff = newestTime - Math.floor(lookbackSeconds);
  const candidates: InteriorHistoryGap[] = [];
  for (let index = 1; index < normalized.length; index += 1) {
    const previous = normalized[index - 1];
    const current = normalized[index];
    const delta = current.time - previous.time;
    if (
      previous.time < cutoff
      || delta <= timeframeSeconds
      || delta > maxGapSeconds
      || delta % timeframeSeconds !== 0
    ) continue;

    const missingCandleCount = Math.floor(delta / timeframeSeconds) - 1;
    if (missingCandleCount <= 0) continue;
    candidates.push({
      from: previous.time + timeframeSeconds,
      to: current.time - timeframeSeconds,
      missingCandleCount,
    });
  }

  const selected: InteriorHistoryGap[] = [];
  let remainingBudget = Math.floor(maxMissingCandles);
  for (const gap of candidates.reverse()) {
    if (selected.length >= Math.floor(maxRequests)) break;
    if (gap.missingCandleCount > remainingBudget) continue;
    selected.push(gap);
    remainingBudget -= gap.missingCandleCount;
  }
  return selected;
};

export const backfillRecentInteriorHistoryGaps = async ({
  symbol,
  timeframe,
  candles,
  signal,
  concurrency = M1_INTERIOR_GAP_REQUEST_CONCURRENCY,
  maxPasses = M1_INTERIOR_GAP_MAX_PASSES,
  fetchCandles = chartDataService.fetchCandles.bind(chartDataService),
  ...gapOptions
}: BackfillRecentInteriorHistoryGapsOptions): Promise<BackfillRecentInteriorHistoryGapsResult> => {
  let mergedCandles = normalizeCandlePageAscending(candles);
  const safeConcurrency = Math.max(1, Math.floor(concurrency));
  const safeMaxPasses = Math.max(1, Math.floor(maxPasses));
  const timeframeSeconds = Math.max(1, Math.floor(gapOptions.timeframeSeconds ?? 60));
  // FIX: These are operation-wide safety budgets, not per-pass allowances.
  // A residual boundary retry must not silently multiply backend load.
  const maxTotalRequests = Math.max(
    1,
    Math.floor(gapOptions.maxRequests ?? M1_INTERIOR_GAP_MAX_REQUESTS),
  );
  let remainingMissingCandleBudget = Math.max(
    1,
    Math.floor(gapOptions.maxMissingCandles ?? M1_INTERIOR_GAP_MAX_MISSING_CANDLES),
  );
  let requestedGaps = 0;
  let failedGaps = 0;
  let addedCandles = 0;

  for (
    let pass = 0;
    pass < safeMaxPasses
      && !signal?.aborted
      && requestedGaps < maxTotalRequests
      && remainingMissingCandleBudget > 0;
    pass += 1
  ) {
    const remainingRequests = maxTotalRequests - requestedGaps;
    const gaps = findRecentInteriorHistoryGaps(mergedCandles, {
      ...gapOptions,
      timeframeSeconds,
      maxRequests: remainingRequests,
      maxMissingCandles: remainingMissingCandleBudget,
    });
    if (gaps.length === 0) break;

    for (let index = 0; index < gaps.length && !signal?.aborted; index += safeConcurrency) {
      const batch = gaps.slice(index, index + safeConcurrency);
      const pages = await Promise.all(batch.map(async gap => {
        requestedGaps += 1;
        // FIX: Charge every exact or overlap retry to the same global candle
        // budget so repeated partial responses remain bounded.
        remainingMissingCandleBudget -= gap.missingCandleCount;
        try {
          // Ask for the exact gap first. Some broker endpoints treat `to` as
          // exclusive, so a residual pass adds one known bucket on each side.
          const includeBoundaryOverlap = pass > 0;
          const page = await fetchCandles({
            symbol,
            timeframe,
            count: gap.missingCandleCount + (includeBoundaryOverlap ? 2 : 0),
            from: includeBoundaryOverlap ? Math.max(0, gap.from - timeframeSeconds) : gap.from,
            to: includeBoundaryOverlap ? gap.to + timeframeSeconds : gap.to,
            signal,
          });
          return normalizeCandlePageAscending(page).filter(
            candle => candle.time >= gap.from && candle.time <= gap.to,
          );
        } catch (error) {
          if (!signal?.aborted && (error as Error)?.name !== 'AbortError') failedGaps += 1;
          return [];
        }
      }));

      if (signal?.aborted) break;
      for (const page of pages) {
        const merged = mergeBackendCandlePage(mergedCandles, page);
        mergedCandles = merged.candles;
        addedCandles += merged.addedCount;
      }
    }
  }

  return { candles: mergedCandles, requestedGaps, failedGaps, addedCandles };
};

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

  const normalizedTimeframe = normalizeTimeframe(timeframe);
  let derivedAttempts = 0;

  if (normalizedTimeframe !== 'M1' && isM1DerivedFallbackTimeframe(timeframe)) {
    const derivedCandles = await fetchDerivedTimeframeCandlesFromM1({
      symbol,
      targetTimeframe: timeframe,
      olderThanRaw,
      signal,
      yieldBetweenPages,
      fetchCandles,
    });
    derivedAttempts = derivedCandles.pagesFetched;

    if (derivedCandles.candles.length > 0) {
      return {
        candles: derivedCandles.candles,
        requestedTo,
        pageSize,
        attempts: derivedAttempts,
        usedRangeFallback: false,
        usedDerivedFallback: true,
        source: 'derived-m1',
      };
    }

    if (derivedCandles.aborted || signal?.aborted) {
      return {
        candles: [],
        requestedTo,
        pageSize,
        attempts: derivedAttempts,
        usedRangeFallback: false,
        usedDerivedFallback: false,
        source: 'backend',
      };
    }
  }

  const directCandles = normalizeCandlePageAscending(await fetchCandles({
    symbol,
    timeframe,
    count: pageSize,
    to: requestedTo,
    signal,
  }));

  const directHasOlderCandles = directCandles.some(candle => candle.time < olderThanRaw);
  if (normalizedTimeframe !== 'M1' || directHasOlderCandles) {
    return {
      candles: directCandles,
      requestedTo,
      pageSize,
      attempts: derivedAttempts + 1,
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
