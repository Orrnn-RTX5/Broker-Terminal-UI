import type { ApiTimeframe, FetchCandlesOptions, OHLCData } from './chartDataService';
import { chartDataService } from './chartDataService';
import { normalizeCandlePageAscending } from '../utils/candleHistory';
import { alignTimeframeBoundarySeconds } from '../utils/timeframeBoundary';

export const DERIVED_M1_PAGE_SIZE = 5000;
export const DERIVED_M1_PROCESSING_CHUNK_SIZE = 1000;
const DERIVED_M1_YIELD_TIMEOUT_MS = 16;

type FetchCandlesPage = (options: FetchCandlesOptions) => Promise<OHLCData[]>;
type YieldToMainThread = (signal?: AbortSignal) => Promise<void>;
type YieldBetweenPages = (signal: AbortSignal) => Promise<void> | void;

export interface FetchDerivedTimeframeCandlesFromM1Options {
  symbol: string;
  targetTimeframe: string;
  olderThanRaw?: number;
  signal?: AbortSignal;
  pageSize?: number;
  maxM1Pages?: number;
  targetCandleLimit?: number;
  processingChunkSize?: number;
  fetchCandles?: FetchCandlesPage;
  yieldBetweenPages?: YieldBetweenPages;
  yieldToMainThread?: YieldToMainThread;
}

export interface FetchDerivedTimeframeCandlesFromM1Result {
  candles: OHLCData[];
  pagesFetched: number;
  m1CandlesFetched: number;
  requestedTo: number | null;
  targetTimeframe: ApiTimeframe | null;
  reachedBeginning: boolean;
  aborted: boolean;
}

const TIMEFRAME_SECONDS: Record<ApiTimeframe, number> = {
  M1: 60,
  M5: 5 * 60,
  M15: 15 * 60,
  M30: 30 * 60,
  H1: 60 * 60,
  H4: 4 * 60 * 60,
  D1: 24 * 60 * 60,
  W1: 7 * 24 * 60 * 60,
  MN: 30 * 24 * 60 * 60,
};

const TIMEFRAME_ALIASES: Record<string, ApiTimeframe> = {
  M1: 'M1',
  '1': 'M1',
  '1M': 'M1',
  '1MIN': 'M1',
  M5: 'M5',
  '5': 'M5',
  '5M': 'M5',
  '5MIN': 'M5',
  M15: 'M15',
  '15': 'M15',
  '15M': 'M15',
  '15MIN': 'M15',
  M30: 'M30',
  '30': 'M30',
  '30M': 'M30',
  '30MIN': 'M30',
  H1: 'H1',
  '1H': 'H1',
  '60': 'H1',
  H4: 'H4',
  '4H': 'H4',
  D1: 'D1',
  '1D': 'D1',
  W1: 'W1',
  '1W': 'W1',
  MN: 'MN',
  '1MO': 'MN',
};

interface IdleDeadlineLike {
  didTimeout: boolean;
  timeRemaining: () => number;
}

type IdleCallbackLike = (deadline: IdleDeadlineLike) => void;
type GlobalWithIdleCallback = typeof globalThis & {
  requestIdleCallback?: (callback: IdleCallbackLike, options?: { timeout?: number }) => number;
  cancelIdleCallback?: (handle: number) => void;
};

interface DerivedBucket {
  candle: OHLCData;
  firstM1Time: number;
  lastM1Time: number;
}

interface M1AggregationState {
  buckets: Map<number, DerivedBucket>;
  seenM1Times: Set<number>;
  oldestM1Time: number | null;
  m1CandlesFetched: number;
}

interface AccumulateM1PageResult {
  aborted: boolean;
}

const emptyDerivedResult = (
  requestedTo: number | null,
  targetTimeframe: ApiTimeframe | null,
  aborted = false,
): FetchDerivedTimeframeCandlesFromM1Result => ({
  candles: [],
  pagesFetched: 0,
  m1CandlesFetched: 0,
  requestedTo,
  targetTimeframe,
  reachedBeginning: false,
  aborted,
});

const normalizeTimeframe = (timeframe: string): ApiTimeframe | null => (
  TIMEFRAME_ALIASES[String(timeframe || '').trim().toUpperCase()] ?? null
);

const isFiniteNumber = (value: unknown): value is number => (
  typeof value === 'number' && Number.isFinite(value)
);

const finiteVolume = (value: unknown): number => (
  isFiniteNumber(value) ? value : 0
);

const sumOptionalVolume = (left: unknown, right: unknown): number | undefined => {
  const hasLeft = isFiniteNumber(left);
  const hasRight = isFiniteNumber(right);
  if (!hasLeft && !hasRight) return undefined;
  return (hasLeft ? left : 0) + (hasRight ? right : 0);
};

const getOldestTime = (candles: readonly OHLCData[]): number | null => {
  const oldest = candles[0]?.time;
  return isFiniteNumber(oldest) ? oldest : null;
};

const getNewestTime = (candles: readonly OHLCData[]): number | null => {
  const newest = candles[candles.length - 1]?.time;
  return isFiniteNumber(newest) ? newest : null;
};

const getBucketEndSeconds = (bucketTime: number, targetTf: ApiTimeframe): number => {
  if (targetTf === 'MN') {
    const date = new Date(bucketTime * 1000);
    return Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 1) / 1000;
  }

  return bucketTime + TIMEFRAME_SECONDS[targetTf];
};

const isAbortError = (error: unknown, signal?: AbortSignal): boolean => (
  signal?.aborted === true
  || (
    typeof error === 'object'
    && error !== null
    && 'name' in error
    && String((error as { name?: unknown }).name) === 'AbortError'
  )
);

const toPositiveInteger = (value: number | undefined, fallback: number): number => {
  const candidate = value ?? fallback;
  return Number.isFinite(candidate) && candidate > 0 ? Math.floor(candidate) : 0;
};

const createM1AggregationState = (): M1AggregationState => ({
  buckets: new Map<number, DerivedBucket>(),
  seenM1Times: new Set<number>(),
  oldestM1Time: null,
  m1CandlesFetched: 0,
});

const defaultYieldToMainThread: YieldToMainThread = (signal) => (
  new Promise(resolve => {
    if (signal?.aborted) {
      resolve();
      return;
    }

    const globalWithIdle = globalThis as GlobalWithIdleCallback;
    let settled = false;
    let idleHandle: number | null = null;
    let timeoutHandle: ReturnType<typeof globalThis.setTimeout> | null = null;

    const settle = () => {
      if (settled) return;
      settled = true;
      signal?.removeEventListener('abort', handleAbort);
      resolve();
    };

    const handleAbort = () => {
      if (idleHandle !== null && globalWithIdle.cancelIdleCallback) {
        globalWithIdle.cancelIdleCallback(idleHandle);
      }
      if (timeoutHandle !== null) {
        globalThis.clearTimeout(timeoutHandle);
      }
      settle();
    };

    signal?.addEventListener('abort', handleAbort, { once: true });

    if (globalWithIdle.requestIdleCallback) {
      idleHandle = globalWithIdle.requestIdleCallback(
        () => settle(),
        { timeout: DERIVED_M1_YIELD_TIMEOUT_MS },
      );
      return;
    }

    timeoutHandle = globalThis.setTimeout(() => settle(), 0);
  })
);

const upsertM1CandleIntoBucket = (
  state: M1AggregationState,
  candle: OHLCData,
  targetTf: ApiTimeframe,
): void => {
  const bucketTime = alignTimeframeBoundarySeconds(
    candle.time,
    targetTf,
    TIMEFRAME_SECONDS[targetTf],
  );
  const existing = state.buckets.get(bucketTime);
  const volume = finiteVolume(candle.volume);

  if (!existing) {
    const next: OHLCData = {
      time: bucketTime,
      open: candle.open,
      high: candle.high,
      low: candle.low,
      close: candle.close,
      volume,
    };
    if (isFiniteNumber(candle.tickVolume)) next.tickVolume = candle.tickVolume;
    if (isFiniteNumber(candle.realVolume)) next.realVolume = candle.realVolume;
    state.buckets.set(bucketTime, {
      candle: next,
      firstM1Time: candle.time,
      lastM1Time: candle.time,
    });
    return;
  }

  existing.candle.high = Math.max(existing.candle.high, candle.high);
  existing.candle.low = Math.min(existing.candle.low, candle.low);
  existing.candle.volume += volume;

  if (candle.time < existing.firstM1Time) {
    existing.firstM1Time = candle.time;
    existing.candle.open = candle.open;
  }

  if (candle.time > existing.lastM1Time) {
    existing.lastM1Time = candle.time;
    existing.candle.close = candle.close;
  }

  const nextTickVolume = sumOptionalVolume(existing.candle.tickVolume, candle.tickVolume);
  if (nextTickVolume !== undefined) existing.candle.tickVolume = nextTickVolume;

  const nextRealVolume = sumOptionalVolume(existing.candle.realVolume, candle.realVolume);
  if (nextRealVolume !== undefined) existing.candle.realVolume = nextRealVolume;
};

const accumulateM1Page = async (
  state: M1AggregationState,
  m1CandlesAscending: readonly OHLCData[],
  targetTf: ApiTimeframe,
  signal: AbortSignal | undefined,
  yieldToMainThread: YieldToMainThread,
  processingChunkSize: number,
): Promise<AccumulateM1PageResult> => {
  for (let index = 0; index < m1CandlesAscending.length; index += 1) {
    if (signal?.aborted) return { aborted: true };

    const candle = m1CandlesAscending[index];
    if (state.seenM1Times.has(candle.time)) continue;

    state.seenM1Times.add(candle.time);
    state.oldestM1Time = state.oldestM1Time === null
      ? candle.time
      : Math.min(state.oldestM1Time, candle.time);
    state.m1CandlesFetched += 1;
    upsertM1CandleIntoBucket(state, candle, targetTf);

    if ((index + 1) % processingChunkSize === 0) {
      await yieldToMainThread(signal);
      if (signal?.aborted) return { aborted: true };
    }
  }

  return { aborted: false };
};

const isBucketCoveredForResult = (
  bucket: DerivedBucket,
  targetTf: ApiTimeframe,
  coveredFromInclusive: number | null,
  coveredToInclusive: number | null,
  olderThanRaw?: number,
): boolean => {
  const hasCursor = isFiniteNumber(olderThanRaw);
  const bucketStart = bucket.candle.time;
  if (!hasCursor) return true;

  const bucketEnd = getBucketEndSeconds(bucketStart, targetTf);
  return (
    bucketStart < olderThanRaw &&
    bucketEnd <= olderThanRaw &&
    coveredFromInclusive !== null &&
    coveredFromInclusive <= bucketStart &&
    coveredToInclusive !== null &&
    coveredToInclusive >= bucketEnd - 1
  );
};

const countDerivedCandlesForCoverage = (
  state: M1AggregationState,
  targetTf: ApiTimeframe,
  coveredFromInclusive: number | null,
  coveredToInclusive: number | null,
  olderThanRaw?: number,
): number => {
  let count = 0;
  for (const bucket of state.buckets.values()) {
    if (isBucketCoveredForResult(bucket, targetTf, coveredFromInclusive, coveredToInclusive, olderThanRaw)) {
      count += 1;
    }
  }
  return count;
};

const getDerivedCandlesForCoverage = (
  state: M1AggregationState,
  targetTf: ApiTimeframe,
  coveredFromInclusive: number | null,
  coveredToInclusive: number | null,
  targetCandleLimit: number,
  olderThanRaw?: number,
): OHLCData[] => {
  const candles = Array.from(state.buckets.values())
    .filter(bucket => isBucketCoveredForResult(bucket, targetTf, coveredFromInclusive, coveredToInclusive, olderThanRaw))
    .map(bucket => ({ ...bucket.candle }))
    .sort((left, right) => left.time - right.time);

  if (targetCandleLimit <= 0 || candles.length <= targetCandleLimit) return candles;
  return candles.slice(candles.length - targetCandleLimit);
};

export const isM1DerivedFallbackTimeframe = (timeframe: string): boolean => {
  const normalized = normalizeTimeframe(timeframe);
  return normalized !== null && normalized !== 'M1';
};

export const getDerivedM1MaxPages = (targetTimeframe: string): number => {
  const normalized = normalizeTimeframe(targetTimeframe);
  switch (normalized) {
    case 'D1':
      return 3;
    case 'W1':
      return 4;
    case 'MN':
      return 10;
    case 'M5':
    case 'M15':
    case 'M30':
    case 'H1':
    case 'H4':
      return 2;
    default:
      return 0;
  }
};

export const getDerivedM1InitialTargetCandleLimit = (targetTimeframe: string): number => {
  const normalized = normalizeTimeframe(targetTimeframe);
  switch (normalized) {
    case 'W1':
      return 2;
    case 'MN':
      return 1;
    case 'M5':
    case 'M15':
    case 'M30':
    case 'H1':
    case 'H4':
      return 30;
    case 'D1':
      return 10;
    default:
      return 0;
  }
};

export const aggregateM1CandlesToTimeframe = (
  m1Candles: readonly OHLCData[],
  targetTimeframe: string,
): OHLCData[] => {
  const targetTf = normalizeTimeframe(targetTimeframe);
  if (!targetTf) return [];
  if (targetTf === 'M1') return normalizeCandlePageAscending(m1Candles);

  const buckets = new Map<number, OHLCData>();
  for (const candle of normalizeCandlePageAscending(m1Candles)) {
    const bucketTime = alignTimeframeBoundarySeconds(
      candle.time,
      targetTf,
      TIMEFRAME_SECONDS[targetTf],
    );
    const existing = buckets.get(bucketTime);
    const volume = finiteVolume(candle.volume);

    if (!existing) {
      const next: OHLCData = {
        time: bucketTime,
        open: candle.open,
        high: candle.high,
        low: candle.low,
        close: candle.close,
        volume,
      };
      if (isFiniteNumber(candle.tickVolume)) next.tickVolume = candle.tickVolume;
      if (isFiniteNumber(candle.realVolume)) next.realVolume = candle.realVolume;
      buckets.set(bucketTime, next);
      continue;
    }

    existing.high = Math.max(existing.high, candle.high);
    existing.low = Math.min(existing.low, candle.low);
    existing.close = candle.close;
    existing.volume += volume;

    const nextTickVolume = sumOptionalVolume(existing.tickVolume, candle.tickVolume);
    if (nextTickVolume !== undefined) existing.tickVolume = nextTickVolume;

    const nextRealVolume = sumOptionalVolume(existing.realVolume, candle.realVolume);
    if (nextRealVolume !== undefined) existing.realVolume = nextRealVolume;
  }

  return normalizeCandlePageAscending(Array.from(buckets.values()));
};

export const fetchDerivedTimeframeCandlesFromM1 = async ({
  symbol,
  targetTimeframe,
  olderThanRaw,
  signal,
  pageSize = DERIVED_M1_PAGE_SIZE,
  maxM1Pages = getDerivedM1MaxPages(targetTimeframe),
  targetCandleLimit,
  processingChunkSize = DERIVED_M1_PROCESSING_CHUNK_SIZE,
  fetchCandles = chartDataService.fetchCandles.bind(chartDataService),
  yieldBetweenPages,
  yieldToMainThread = defaultYieldToMainThread,
}: FetchDerivedTimeframeCandlesFromM1Options): Promise<FetchDerivedTimeframeCandlesFromM1Result> => {
  const targetTf = normalizeTimeframe(targetTimeframe);
  const requestedTo = isFiniteNumber(olderThanRaw) ? Math.floor(olderThanRaw) - 1 : null;
  const normalizedPageSize = toPositiveInteger(pageSize, DERIVED_M1_PAGE_SIZE);
  const normalizedMaxPages = toPositiveInteger(maxM1Pages, getDerivedM1MaxPages(targetTimeframe));
  const normalizedProcessingChunkSize = Math.max(1, toPositiveInteger(
    processingChunkSize,
    DERIVED_M1_PROCESSING_CHUNK_SIZE,
  ));
  const normalizedTargetCandleLimit = toPositiveInteger(
    targetCandleLimit,
    requestedTo === null ? getDerivedM1InitialTargetCandleLimit(targetTimeframe) : 0,
  );
  const targetCandlesToStop = requestedTo === null ? normalizedTargetCandleLimit : 1;

  if (!targetTf || targetTf === 'M1' || normalizedMaxPages <= 0 || normalizedPageSize <= 0) {
    return emptyDerivedResult(requestedTo, targetTf);
  }
  if (requestedTo !== null && requestedTo < 0) {
    return emptyDerivedResult(requestedTo, targetTf);
  }
  if (signal?.aborted) {
    return emptyDerivedResult(requestedTo, targetTf, true);
  }

  let cursorTo = requestedTo;
  let pagesFetched = 0;
  let reachedBeginning = false;
  let previousOldestTime: number | null = null;
  let coveredFromInclusive: number | null = null;
  let coveredToInclusive: number | null = requestedTo;
  const aggregationState = createM1AggregationState();

  const buildResult = (aborted: boolean): FetchDerivedTimeframeCandlesFromM1Result => ({
    candles: aborted
      ? []
      : getDerivedCandlesForCoverage(
        aggregationState,
        targetTf,
        coveredFromInclusive,
        coveredToInclusive,
        normalizedTargetCandleLimit,
        olderThanRaw,
      ),
    pagesFetched,
    m1CandlesFetched: aggregationState.m1CandlesFetched,
    requestedTo,
    targetTimeframe: targetTf,
    reachedBeginning,
    aborted,
  });

  for (let pageIndex = 0; pageIndex < normalizedMaxPages; pageIndex += 1) {
    if (signal?.aborted) {
      return buildResult(true);
    }

    const request: FetchCandlesOptions = {
      symbol,
      timeframe: 'M1',
      count: normalizedPageSize,
      signal,
    };
    if (cursorTo !== null) request.to = cursorTo;

    let page: OHLCData[];
    try {
      page = normalizeCandlePageAscending(await fetchCandles(request));
    } catch (error) {
      if (isAbortError(error, signal)) {
        return buildResult(true);
      }
      throw error;
    }
    pagesFetched += 1;
    if (coveredToInclusive === null) {
      coveredToInclusive = getNewestTime(page);
    }

    if (signal?.aborted) {
      return buildResult(true);
    }

    if (page.length === 0) {
      reachedBeginning = true;
      break;
    }

    const pageOldestTime = getOldestTime(page);
    if (pageOldestTime !== null) {
      coveredFromInclusive = coveredFromInclusive === null
        ? pageOldestTime
        : Math.min(coveredFromInclusive, pageOldestTime);
    }
    const pageCandlesBeforeCursor = isFiniteNumber(olderThanRaw)
      ? page.filter(candle => candle.time < olderThanRaw)
      : page;

    const accumulateResult = await accumulateM1Page(
      aggregationState,
      pageCandlesBeforeCursor,
      targetTf,
      signal,
      yieldToMainThread,
      normalizedProcessingChunkSize,
    );

    if (accumulateResult.aborted) {
      return buildResult(true);
    }

    const derivedCandleCount = countDerivedCandlesForCoverage(
      aggregationState,
      targetTf,
      coveredFromInclusive,
      coveredToInclusive,
      olderThanRaw,
    );
    if (targetCandlesToStop > 0 && derivedCandleCount >= targetCandlesToStop) {
      return buildResult(false);
    }

    if (pageOldestTime === null || (previousOldestTime !== null && pageOldestTime >= previousOldestTime)) {
      reachedBeginning = true;
      break;
    }

    previousOldestTime = pageOldestTime;
    cursorTo = Math.floor(pageOldestTime) - 1;
    if (cursorTo < 0) {
      reachedBeginning = true;
      break;
    }

    if (pageIndex < normalizedMaxPages - 1 && yieldBetweenPages) {
      await yieldBetweenPages(signal ?? new AbortController().signal);
      if (signal?.aborted) return buildResult(true);
    }
  }

  return buildResult(signal?.aborted ?? false);
};
