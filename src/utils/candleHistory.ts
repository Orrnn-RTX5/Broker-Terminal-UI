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
