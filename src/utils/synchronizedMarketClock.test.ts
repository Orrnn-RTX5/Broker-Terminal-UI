import { describe, expect, it } from 'vitest';
import {
  getSynchronizedMarketNowMs,
  normalizeMarketTimestampMs,
  synchronizeMarketClock,
} from './synchronizedMarketClock';

describe('synchronized market clock', () => {
  it('normalizes source timestamps supplied in seconds or milliseconds', () => {
    expect(normalizeMarketTimestampMs(1_800_000_000)).toBe(1_800_000_000_000);
    expect(normalizeMarketTimestampMs(1_800_000_000_250)).toBe(1_800_000_000_250);
  });

  it('derives current market time from broker time plus monotonic elapsed time', () => {
    const anchor = synchronizeMarketClock(null, 1_800_000_000_000, 500);
    expect(getSynchronizedMarketNowMs(anchor, 99, 20_500)).toBe(1_800_000_020_000);
  });

  it('does not restart elapsed time for duplicate or older source frames', () => {
    const first = synchronizeMarketClock(null, 1_800_000_000_000, 500);
    const duplicate = synchronizeMarketClock(first, 1_800_000_000_000, 900);
    const older = synchronizeMarketClock(duplicate, 1_799_999_999_000, 1_000);

    expect(duplicate).toBe(first);
    expect(older).toBe(first);
    expect(getSynchronizedMarketNowMs(older, 0, 1_500)).toBe(1_800_000_001_000);
  });

  it('does not move projected market time backward for a newer raw tick that trails the projection', () => {
    const first = synchronizeMarketClock(null, 1_800_000_000_000, 500);
    const projectedBeforeTick = getSynchronizedMarketNowMs(first, 0, 20_500);
    const newerButLaggingTick = synchronizeMarketClock(
      first,
      1_800_000_005_000,
      20_500,
    );

    expect(projectedBeforeTick).toBe(1_800_000_020_000);
    expect(newerButLaggingTick).toBe(first);
    expect(getSynchronizedMarketNowMs(newerButLaggingTick, 0, 20_500))
      .toBe(projectedBeforeTick);
    expect(getSynchronizedMarketNowMs(newerButLaggingTick, 0, 21_500))
      .toBe(1_800_000_021_000);
  });

  it('falls back to the current wall clock before a source timestamp arrives', () => {
    expect(getSynchronizedMarketNowMs(null, 123_456, 50)).toBe(123_456);
  });
});
