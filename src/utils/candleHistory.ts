export interface CandleHistoryCandle {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  tickVolume?: number;
  realVolume?: number;
}

export interface LogicalRangeLike {
  from: number;
  to: number;
}

export interface VisibleLogicalRangeForDataRenderOptions {
  resetVisibleRange: boolean;
  prependedBars: number;
}

export interface CandleHistoryMergeResult<T extends CandleHistoryCandle> {
  candles: T[];
  addedCount: number;
  updatedCount: number;
}

/**
 * Accept the latest forming-candle close without allowing a delayed partial
 * snapshot to move the established open or erase price extremes that were
 * already observed in this bucket. Closed historical corrections intentionally
 * do not use this helper.
 */
export const mergeFormingCandleEnvelope = <T extends CandleHistoryCandle>(
  previous: T,
  incoming: T,
): T => {
  if (previous.time !== incoming.time) return { ...incoming };

  const realVolume = previous.realVolume === undefined && incoming.realVolume === undefined
    ? undefined
    : Math.max(previous.realVolume ?? 0, incoming.realVolume ?? 0);

  return {
    ...previous,
    ...incoming,
    open: previous.open,
    high: Math.max(
      previous.high,
      previous.open,
      previous.close,
      incoming.high,
      incoming.open,
      incoming.close,
    ),
    low: Math.min(
      previous.low,
      previous.open,
      previous.close,
      incoming.low,
      incoming.open,
      incoming.close,
    ),
    volume: Math.max(previous.volume, incoming.volume),
    tickVolume: Math.max(
      previous.tickVolume ?? previous.volume,
      incoming.tickVolume ?? incoming.volume,
    ),
    ...(realVolume === undefined ? {} : { realVolume }),
  };
};

/**
 * Joins history that arrived after live ticks were already buffered for the
 * same bucket. History owns the true bucket open and prior range; the buffered
 * candle owns the newest close while extending (never narrowing) that range.
 */
export const mergeHistoricalCandleWithBufferedLive = <T extends CandleHistoryCandle>(
  historical: T,
  bufferedLive: T,
): T => {
  if (historical.time !== bufferedLive.time) return { ...bufferedLive };

  const realVolume = historical.realVolume === undefined && bufferedLive.realVolume === undefined
    ? undefined
    : Math.max(historical.realVolume ?? 0, bufferedLive.realVolume ?? 0);

  return {
    ...historical,
    ...bufferedLive,
    open: historical.open,
    high: Math.max(
      historical.high,
      historical.open,
      historical.close,
      bufferedLive.high,
      bufferedLive.open,
      bufferedLive.close,
    ),
    low: Math.min(
      historical.low,
      historical.open,
      historical.close,
      bufferedLive.low,
      bufferedLive.open,
      bufferedLive.close,
    ),
    close: bufferedLive.close,
    volume: Math.max(historical.volume, bufferedLive.volume),
    tickVolume: Math.max(
      historical.tickVolume ?? historical.volume,
      bufferedLive.tickVolume ?? bufferedLive.volume,
    ),
    ...(realVolume === undefined ? {} : { realVolume }),
  };
};

const isFiniteNumber = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value);

export const isValidHistoryCandle = (candle: CandleHistoryCandle): boolean => (
  isFiniteNumber(candle.time) &&
  isFiniteNumber(candle.open) &&
  isFiniteNumber(candle.high) &&
  isFiniteNumber(candle.low) &&
  isFiniteNumber(candle.close)
);

const mergeCandles = <T extends CandleHistoryCandle>(
  first: T,
  second: T,
): T => ({
  ...first,
  ...second,
});

export const normalizeCandlePageAscending = <T extends CandleHistoryCandle>(
  candles: readonly T[],
): T[] => {
  const byTime = new Map<number, T>();
  for (const candle of candles) {
    if (!isValidHistoryCandle(candle)) continue;
    const existing = byTime.get(candle.time);
    byTime.set(candle.time, existing ? mergeCandles(existing, candle) : candle);
  }

  return Array.from(byTime.values()).sort((left, right) => left.time - right.time);
};

export const mergeHistoricalCandlesWithBufferedLive = <T extends CandleHistoryCandle>(
  historicalCandles: readonly T[],
  bufferedLiveCandles: readonly T[],
): T[] => {
  const historical = normalizeCandlePageAscending(historicalCandles);
  const bufferedLive = normalizeCandlePageAscending(bufferedLiveCandles);
  const bufferedByTime = new Map(bufferedLive.map(candle => [candle.time, candle]));
  const historicalTimes = new Set(historical.map(candle => candle.time));

  return normalizeCandlePageAscending([
    ...historical.map(candle => {
      const buffered = bufferedByTime.get(candle.time);
      return buffered
        ? mergeHistoricalCandleWithBufferedLive(candle, buffered)
        : candle;
    }),
    ...bufferedLive.filter(candle => !historicalTimes.has(candle.time)),
  ]);
};

export const mergeSortedCandleHistory = <T extends CandleHistoryCandle>(
  existingAscending: readonly T[],
  incomingAscending: readonly T[],
  options: { duplicatePreference?: 'existing' | 'incoming' } = {},
): CandleHistoryMergeResult<T> => {
  const duplicatePreference = options.duplicatePreference ?? 'incoming';
  const candles: T[] = [];
  let existingIndex = 0;
  let incomingIndex = 0;
  let addedCount = 0;
  let updatedCount = 0;

  while (existingIndex < existingAscending.length || incomingIndex < incomingAscending.length) {
    const existing = existingAscending[existingIndex];
    const incoming = incomingAscending[incomingIndex];

    if (!existing) {
      if (incoming && isValidHistoryCandle(incoming)) {
        candles.push(incoming);
        addedCount += 1;
      }
      incomingIndex += 1;
      continue;
    }

    if (!incoming) {
      if (isValidHistoryCandle(existing)) candles.push(existing);
      existingIndex += 1;
      continue;
    }

    if (!isValidHistoryCandle(existing)) {
      existingIndex += 1;
      continue;
    }

    if (!isValidHistoryCandle(incoming)) {
      incomingIndex += 1;
      continue;
    }

    if (existing.time < incoming.time) {
      candles.push(existing);
      existingIndex += 1;
      continue;
    }

    if (incoming.time < existing.time) {
      candles.push(incoming);
      addedCount += 1;
      incomingIndex += 1;
      continue;
    }

    candles.push(
      duplicatePreference === 'incoming'
        ? mergeCandles(existing, incoming)
        : mergeCandles(incoming, existing),
    );
    updatedCount += 1;
    existingIndex += 1;
    incomingIndex += 1;
  }

  return { candles, addedCount, updatedCount };
};

export const prependCandleHistory = <T extends CandleHistoryCandle>(
  existingAscending: readonly T[],
  olderCandles: readonly T[],
): CandleHistoryMergeResult<T> => (
  mergeSortedCandleHistory(
    existingAscending,
    normalizeCandlePageAscending(olderCandles),
    { duplicatePreference: 'existing' },
  )
);

export interface OlderHistoryPageSelection<T extends CandleHistoryCandle> {
  candles: T[];
  usedRawFallback: boolean;
}

export interface OlderHistoryRangeWindow {
  from: number;
  to: number;
}

export const selectOlderHistoryCandlesForMerge = <T extends CandleHistoryCandle>(
  rawCandles: readonly T[],
  reconciledCandles: readonly T[],
): OlderHistoryPageSelection<T> => {
  const normalizedReconciled = normalizeCandlePageAscending(reconciledCandles);
  if (normalizedReconciled.length > 0) {
    return { candles: normalizedReconciled, usedRawFallback: false };
  }

  const normalizedRaw = normalizeCandlePageAscending(rawCandles);
  return {
    candles: normalizedRaw,
    usedRawFallback: normalizedRaw.length > 0,
  };
};

export const buildOlderHistoryRangeFallbackWindows = (
  toInclusive: number,
  timeframeSeconds: number,
  pageSize: number,
  maxWindows: number,
): OlderHistoryRangeWindow[] => {
  if (
    !Number.isFinite(toInclusive)
    || !Number.isFinite(timeframeSeconds)
    || !Number.isFinite(pageSize)
    || !Number.isFinite(maxWindows)
    || timeframeSeconds <= 0
    || pageSize <= 0
    || maxWindows <= 0
  ) {
    return [];
  }

  const windows: OlderHistoryRangeWindow[] = [];
  const windowSeconds = Math.max(timeframeSeconds, Math.floor(timeframeSeconds * pageSize));
  let windowTo = Math.floor(toInclusive);

  for (let index = 0; index < Math.floor(maxWindows); index += 1) {
    if (windowTo < 0) break;
    const from = Math.max(0, windowTo - windowSeconds + timeframeSeconds);
    windows.push({ from, to: windowTo });
    if (from === 0) break;
    windowTo = from - 1;
  }

  return windows;
};

export const mergeBackendCandlePage = <T extends CandleHistoryCandle>(
  existingAscending: readonly T[],
  backendCandles: readonly T[],
): CandleHistoryMergeResult<T> => (
  mergeSortedCandleHistory(
    existingAscending,
    normalizeCandlePageAscending(backendCandles),
    { duplicatePreference: 'incoming' },
  )
);

const findCandleInsertionIndex = <T extends CandleHistoryCandle>(
  candles: readonly T[],
  time: number,
): number => {
  let low = 0;
  let high = candles.length;

  while (low < high) {
    const mid = Math.floor((low + high) / 2);
    if (candles[mid].time < time) low = mid + 1;
    else high = mid;
  }

  return low;
};

export const upsertCandleIntoHistory = <T extends CandleHistoryCandle>(
  existingAscending: readonly T[],
  incoming: T,
): CandleHistoryMergeResult<T> => {
  if (!isValidHistoryCandle(incoming)) {
    return { candles: [...existingAscending], addedCount: 0, updatedCount: 0 };
  }

  const candles = [...existingAscending];
  const insertAt = findCandleInsertionIndex(candles, incoming.time);
  const current = candles[insertAt];
  if (current?.time === incoming.time) {
    candles[insertAt] = mergeCandles(current, incoming);
    return { candles, addedCount: 0, updatedCount: 1 };
  }

  candles.splice(insertAt, 0, incoming);
  return { candles, addedCount: 1, updatedCount: 0 };
};

export const applyBrokerTimeOffsetToCandles = <T extends CandleHistoryCandle>(
  candles: readonly T[],
  offsetSeconds: number,
): T[] => (
  offsetSeconds === 0
    ? [...candles]
    : candles.map(candle => ({ ...candle, time: candle.time - offsetSeconds }))
);

export interface FormattedOhlcvCandle {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export const formatHistoryForOhlcv = (
  candles: readonly CandleHistoryCandle[],
): FormattedOhlcvCandle[] => (
  candles.map(candle => ({
    time: candle.time,
    open: candle.open,
    high: candle.high,
    low: candle.low,
    close: candle.close,
    volume: candle.volume,
  }))
);

export const offsetLogicalRangeForPrependedCandles = <T extends LogicalRangeLike>(
  range: T | null,
  addedCount: number,
): T | null => {
  if (!range || addedCount <= 0) return range;
  return {
    ...range,
    from: range.from + addedCount,
    to: range.to + addedCount,
  };
};

export const getVisibleLogicalRangeForDataRender = <T extends LogicalRangeLike>(
  range: T | null,
  options: VisibleLogicalRangeForDataRenderOptions,
): T | null => {
  if (options.resetVisibleRange) return null;
  return offsetLogicalRangeForPrependedCandles(range, options.prependedBars);
};
