export type BoundaryTimeframe = 'M1' | 'M5' | 'M15' | 'M30' | 'H1' | 'H4' | 'D1' | 'W1' | 'MN';

const SECONDS_PER_DAY = 24 * 60 * 60;

export function alignToUtcMondayWeekSeconds(timestampSeconds: number): number {
  const date = new Date(timestampSeconds * 1000);
  const daysSinceMonday = (date.getUTCDay() + 6) % 7;
  return Date.UTC(
    date.getUTCFullYear(),
    date.getUTCMonth(),
    date.getUTCDate() - daysSinceMonday,
  ) / 1000;
}

export function alignTimeframeBoundarySeconds(
  timestampSeconds: number,
  timeframe: BoundaryTimeframe,
  timeframeSeconds: number,
): number {
  if (!Number.isFinite(timestampSeconds) || !Number.isFinite(timeframeSeconds) || timeframeSeconds <= 0) {
    return timestampSeconds;
  }

  if (timeframe === 'W1') {
    return alignToUtcMondayWeekSeconds(timestampSeconds);
  }

  return Math.floor(timestampSeconds / timeframeSeconds) * timeframeSeconds;
}

export function alignTimeframeBoundaryMilliseconds(
  timestampMs: number,
  timeframe: BoundaryTimeframe,
  timeframeSeconds: number,
): number {
  if (timeframe === 'W1') {
    return alignToUtcMondayWeekSeconds(timestampMs / 1000) * 1000;
  }

  return alignTimeframeBoundarySeconds(timestampMs / 1000, timeframe, timeframeSeconds) * 1000;
}

export { SECONDS_PER_DAY };
