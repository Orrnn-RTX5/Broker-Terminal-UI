import { MismatchDirection, type Time } from 'lightweight-charts';

interface DrawingProjectionSeries {
  dataByIndex(index: number, direction?: MismatchDirection): { time: Time } | null;
}

interface DrawingProjectionTimeScale {
  timeToIndex(time: Time, findNearest?: boolean): number | null;
}

/** Project blank chart space from the actual rendered timeline, not raw history. */
export const projectDrawingTimeAtLogical = (
  series: DrawingProjectionSeries,
  timeScale: DrawingProjectionTimeScale,
  logical: number | null,
  timeframeSeconds: number,
): number | null => {
  if (logical === null || !Number.isFinite(logical)) return null;
  if (!Number.isFinite(timeframeSeconds) || timeframeSeconds <= 0) return null;

  // Nearest-left lookup reads one bar without copying the entire series on
  // every pointer move. Its chart index accounts for filtered history and any
  // live bars appended since the last full render.
  const latest = series.dataByIndex(Number.MAX_SAFE_INTEGER, MismatchDirection.NearestLeft);
  if (!latest || typeof latest.time !== 'number' || !Number.isFinite(latest.time)) return null;
  const latestLogical = timeScale.timeToIndex(latest.time, false);
  if (latestLogical === null || !Number.isFinite(latestLogical)) return null;
  const projected = latest.time + ((logical - latestLogical) * timeframeSeconds);
  return Number.isFinite(projected) ? projected : null;
};
