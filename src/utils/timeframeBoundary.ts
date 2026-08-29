export type BoundaryTimeframe = 'M1' | 'M5' | 'M15' | 'M30' | 'H1' | 'H4' | 'D1' | 'W1' | 'MN';

const SECONDS_PER_DAY = 24 * 60 * 60;

export const CANDLE_TIMEFRAMES: readonly BoundaryTimeframe[] = [
  'M1',
  'M5',
  'M15',
  'M30',
  'H1',
  'H4',
  'D1',
  'W1',
  'MN',
];

/**
 * Nominal durations used for fixed-window alignment and history sizing.
 * MN is deliberately nominal here; calendar-month close times must always come
 * from getTimeframePeriodSeconds()/getTimeframeCloseSeconds().
 */
export const TIMEFRAME_SECONDS: Readonly<Record<BoundaryTimeframe, number>> = {
  M1: 60,
  M5: 5 * 60,
  M15: 15 * 60,
  M30: 30 * 60,
  H1: 60 * 60,
  H4: 4 * 60 * 60,
  D1: SECONDS_PER_DAY,
  W1: 7 * SECONDS_PER_DAY,
  MN: 30 * SECONDS_PER_DAY,
};

export interface TimeframePeriodSeconds {
  startTime: number;
  closeTime: number;
  durationSeconds: number;
}

export const getTimeframeSeconds = (timeframe: BoundaryTimeframe): number => (
  TIMEFRAME_SECONDS[timeframe]
);

export function alignToUtcMondayWeekSeconds(timestampSeconds: number): number {
  const date = new Date(timestampSeconds * 1000);
  const daysSinceMonday = (date.getUTCDay() + 6) % 7;
  return Date.UTC(
    date.getUTCFullYear(),
    date.getUTCMonth(),
    date.getUTCDate() - daysSinceMonday,
  ) / 1000;
}

export function alignToUtcMonthStartSeconds(timestampSeconds: number): number {
  const date = new Date(timestampSeconds * 1000);
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1) / 1000;
}

export function alignTimeframeBoundarySeconds(
  timestampSeconds: number,
  timeframe: BoundaryTimeframe,
  timeframeSeconds: number = TIMEFRAME_SECONDS[timeframe],
  boundaryOffsetSeconds = 0,
): number {
  if (!Number.isFinite(timestampSeconds)) {
    return timestampSeconds;
  }

  const finiteBoundaryOffset = Number.isFinite(boundaryOffsetSeconds) ? boundaryOffsetSeconds : 0;
  const shiftedTimestamp = timestampSeconds + finiteBoundaryOffset;

  if (timeframe === 'W1') {
    return alignToUtcMondayWeekSeconds(shiftedTimestamp) - finiteBoundaryOffset;
  }

  if (timeframe === 'MN') {
    return alignToUtcMonthStartSeconds(shiftedTimestamp) - finiteBoundaryOffset;
  }

  if (!Number.isFinite(timeframeSeconds) || timeframeSeconds <= 0) {
    return timestampSeconds;
  }

  return Math.floor(shiftedTimestamp / timeframeSeconds) * timeframeSeconds - finiteBoundaryOffset;
}

export function alignTimeframeBoundaryMilliseconds(
  timestampMs: number,
  timeframe: BoundaryTimeframe,
  timeframeSeconds: number = TIMEFRAME_SECONDS[timeframe],
  boundaryOffsetSeconds = 0,
): number {
  return alignTimeframeBoundarySeconds(
    timestampMs / 1000,
    timeframe,
    timeframeSeconds,
    boundaryOffsetSeconds,
  ) * 1000;
}

export function getTimeframeCloseSeconds(
  periodStartSeconds: number,
  timeframe: BoundaryTimeframe,
  boundaryOffsetSeconds = 0,
): number {
  if (!Number.isFinite(periodStartSeconds)) return periodStartSeconds;

  if (timeframe === 'MN') {
    const finiteBoundaryOffset = Number.isFinite(boundaryOffsetSeconds) ? boundaryOffsetSeconds : 0;
    const shiftedStart = new Date((periodStartSeconds + finiteBoundaryOffset) * 1000);
    return (
      Date.UTC(shiftedStart.getUTCFullYear(), shiftedStart.getUTCMonth() + 1, 1) / 1000
    ) - finiteBoundaryOffset;
  }

  return periodStartSeconds + TIMEFRAME_SECONDS[timeframe];
}

/**
 * Resolve the candle containing timestampSeconds on the app's canonical Unix
 * time basis. boundaryOffsetSeconds preserves the broker-offset policy already
 * used by REST history; it is not a replacement for a future session-timezone
 * contract (for example a DST-aware 17:00 New York trading day).
 */
export function getTimeframePeriodSeconds(
  timestampSeconds: number,
  timeframe: BoundaryTimeframe,
  boundaryOffsetSeconds = 0,
): TimeframePeriodSeconds | null {
  if (!Number.isFinite(timestampSeconds)) return null;

  const startTime = alignTimeframeBoundarySeconds(
    timestampSeconds,
    timeframe,
    TIMEFRAME_SECONDS[timeframe],
    boundaryOffsetSeconds,
  );
  const closeTime = getTimeframeCloseSeconds(startTime, timeframe, boundaryOffsetSeconds);
  return {
    startTime,
    closeTime,
    durationSeconds: closeTime - startTime,
  };
}

export function getRemainingTimeframeSeconds(
  timestampSeconds: number,
  timeframe: BoundaryTimeframe,
  boundaryOffsetSeconds = 0,
): number | null {
  const period = getTimeframePeriodSeconds(timestampSeconds, timeframe, boundaryOffsetSeconds);
  return period ? Math.max(0, period.closeTime - timestampSeconds) : null;
}

/**
 * Return the one current boundary a forming candle must advance to, or null
 * when it is already current. This makes timer/tick/server rollover calls
 * naturally idempotent.
 */
export function getCandleRolloverStartSeconds(
  currentCandleStartSeconds: number,
  timestampSeconds: number,
  timeframe: BoundaryTimeframe,
  boundaryOffsetSeconds = 0,
): number | null {
  if (!Number.isFinite(currentCandleStartSeconds)) return null;
  const period = getTimeframePeriodSeconds(timestampSeconds, timeframe, boundaryOffsetSeconds);
  if (!period || currentCandleStartSeconds >= period.startTime) return null;
  return period.startTime;
}

export { SECONDS_PER_DAY };
