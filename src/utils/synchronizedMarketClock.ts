const MILLISECOND_EPOCH_THRESHOLD = 1_000_000_000_000;

export interface SynchronizedMarketClockAnchor {
  sourceTimestampMs: number;
  monotonicTimestampMs: number;
}

export const normalizeMarketTimestampMs = (timestamp: number): number | null => {
  if (!Number.isFinite(timestamp) || timestamp <= 0) return null;
  return Math.abs(timestamp) >= MILLISECOND_EPOCH_THRESHOLD
    ? timestamp
    : timestamp * 1000;
};

/**
 * Anchor the chart clock to the newest broker/source timestamp. Repeated frames
 * carrying the same timestamp do not restart elapsed time, and late frames can
 * never pull the clock backwards.
 */
export const synchronizeMarketClock = (
  current: SynchronizedMarketClockAnchor | null,
  sourceTimestamp: number,
  monotonicTimestampMs: number,
): SynchronizedMarketClockAnchor | null => {
  const sourceTimestampMs = normalizeMarketTimestampMs(sourceTimestamp);
  if (sourceTimestampMs === null || !Number.isFinite(monotonicTimestampMs)) return current;
  if (current) {
    const projectedCurrentMs = current.sourceTimestampMs
      + Math.max(0, monotonicTimestampMs - current.monotonicTimestampMs);
    // A source timestamp may be newer than the previous raw frame while still
    // trailing the clock already projected from that frame. Retaining the
    // current anchor prevents that normal feed latency from moving time back.
    if (sourceTimestampMs <= projectedCurrentMs) return current;
  }
  return { sourceTimestampMs, monotonicTimestampMs };
};

/**
 * Read market time from a monotonic elapsed clock once a source tick is known.
 * Date.now() is only the startup fallback before the first broker timestamp.
 */
export const getSynchronizedMarketNowMs = (
  anchor: SynchronizedMarketClockAnchor | null,
  wallClockNowMs: number,
  monotonicNowMs: number,
): number => {
  if (!anchor || !Number.isFinite(monotonicNowMs)) return wallClockNowMs;
  return anchor.sourceTimestampMs + Math.max(0, monotonicNowMs - anchor.monotonicTimestampMs);
};
