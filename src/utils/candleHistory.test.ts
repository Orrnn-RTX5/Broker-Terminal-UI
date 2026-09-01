import { describe, expect, it } from 'vitest';
import {
  applyBrokerTimeOffsetToCandles,
  buildOlderHistoryRangeFallbackWindows,
  formatHistoryForOhlcv,
  getVisibleLogicalRangeForDataRender,
  mergeHistoricalCandlesWithBufferedLive,
  mergeHistoricalCandleWithBufferedLive,
  mergeFormingCandleEnvelope,
  mergeBackendCandlePage,
  normalizeCandlePageAscending,
  offsetLogicalRangeForPrependedCandles,
  prependCandleHistory,
  selectOlderHistoryCandlesForMerge,
  upsertCandleIntoHistory,
  type CandleHistoryCandle,
} from './candleHistory';

const candle = (
  time: number,
  close: number,
  extra?: Partial<CandleHistoryCandle>,
): CandleHistoryCandle => ({
  time,
  open: close - 1,
  high: close + 1,
  low: close - 2,
  close,
  volume: 10,
  ...extra,
});

describe('candle history helpers', () => {
  it('atomically joins delayed history with a buffered live candle in the same bucket', () => {
    const historical = candle(300, 105, {
      open: 100,
      high: 110,
      low: 95,
      volume: 18,
      tickVolume: 18,
    });
    const bufferedLive = candle(300, 112, {
      open: 108,
      high: 113,
      low: 104,
      volume: 3,
      tickVolume: 3,
    });

    expect(mergeHistoricalCandleWithBufferedLive(historical, bufferedLive)).toMatchObject({
      time: 300,
      open: 100,
      high: 113,
      low: 95,
      close: 112,
      volume: 18,
      tickVolume: 18,
    });
  });

  it('produces one sorted history-plus-live snapshot without a duplicate forming bucket', () => {
    const result = mergeHistoricalCandlesWithBufferedLive(
      [
        candle(60, 101),
        candle(120, 105, { open: 100, high: 108, low: 98 }),
      ],
      [
        candle(120, 110, { open: 106, high: 111, low: 104 }),
        candle(180, 112, { open: 110, high: 113, low: 109 }),
      ],
    );

    expect(result.map(item => item.time)).toEqual([60, 120, 180]);
    expect(result[1]).toMatchObject({
      open: 100,
      high: 111,
      low: 98,
      close: 110,
    });
  });

  it('keeps the observed forming-candle envelope when a partial server update narrows it', () => {
    const previous = candle(60, 105, {
      open: 100,
      high: 110,
      low: 90,
      volume: 18,
      tickVolume: 18,
      realVolume: 4,
    });
    const incoming = candle(60, 99, {
      open: 101,
      high: 108,
      low: 95,
      volume: 12,
      tickVolume: 12,
      realVolume: 3,
    });

    expect(mergeFormingCandleEnvelope(previous, incoming)).toEqual({
      time: 60,
      open: 100,
      high: 110,
      low: 90,
      close: 99,
      volume: 18,
      tickVolume: 18,
      realVolume: 4,
    });
  });

  it('accepts a forming candle close retracement and any new true extreme', () => {
    const previous = candle(60, 105, { open: 100, high: 110, low: 90, volume: 18 });
    const incoming = candle(60, 96, { open: 100, high: 114, low: 88, volume: 20 });

    expect(mergeFormingCandleEnvelope(previous, incoming)).toMatchObject({
      open: 100,
      high: 114,
      low: 88,
      close: 96,
      volume: 20,
    });
  });

  it('keeps the live candle range monotonic across repeated same-bucket updates', () => {
    const updates = [
      candle(60, 101, { open: 100, high: 106, low: 97, volume: 19 }),
      candle(60, 111, { open: 100, high: 112, low: 96, volume: 20 }),
      candle(60, 102, { open: 100, high: 107, low: 95, volume: 21 }),
      candle(60, 89, { open: 100, high: 108, low: 88, volume: 22 }),
      candle(60, 103, { open: 100, high: 105, low: 94, volume: 23 }),
    ];

    const observed = updates.reduce<Array<ReturnType<typeof candle>>>((candles, incoming) => {
      const previous = candles[candles.length - 1];
      return [...candles, mergeFormingCandleEnvelope(previous, incoming)];
    }, [candle(60, 105, { open: 100, high: 110, low: 90, volume: 18 })]);

    expect(observed.map(({ open, high, low }) => ({ open, high, low }))).toEqual([
      { open: 100, high: 110, low: 90 },
      { open: 100, high: 110, low: 90 },
      { open: 100, high: 112, low: 90 },
      { open: 100, high: 112, low: 90 },
      { open: 100, high: 112, low: 88 },
      { open: 100, high: 112, low: 88 },
    ]);
    expect(observed[observed.length - 1]).toMatchObject({
      close: 103,
      volume: 23,
    });
  });

  it('starts a different candle bucket from the incoming server values', () => {
    const previous = candle(60, 105, { open: 100, high: 110, low: 90, volume: 18 });
    const incoming = candle(120, 201, { open: 200, high: 202, low: 199, volume: 2 });

    expect(mergeFormingCandleEnvelope(previous, incoming)).toEqual(incoming);
  });

  it('retains every valid backend candle while merging paged history', () => {
    const initial = normalizeCandlePageAscending([
      candle(180, 180),
      candle(240, 240),
      candle(300, 300),
    ]);

    const firstOlder = prependCandleHistory(initial, [
      candle(60, 60),
      candle(120, 120),
      candle(180, 181),
    ]);
    const secondOlder = prependCandleHistory(firstOlder.candles, [
      candle(-60, -60),
      candle(0, 0),
      candle(60, 61),
    ]);

    expect(secondOlder.candles.map(item => item.time)).toEqual([-60, 0, 60, 120, 180, 240, 300]);
    expect(secondOlder.candles).toHaveLength(7);
  });

  it('merges multiple 5000-row older backend pages without duplicates', () => {
    const latestPage = normalizeCandlePageAscending(
      Array.from({ length: 5000 }, (_, index) => candle((5000 + index) * 60, 5000 + index))
    );
    const overlappingOlderPage = Array.from(
      { length: 5001 },
      (_, index) => candle(index * 60, index)
    );

    const result = prependCandleHistory(latestPage, overlappingOlderPage);

    expect(result.candles).toHaveLength(10_000);
    expect(result.addedCount).toBe(5000);
    expect(result.candles[0].time).toBe(0);
    expect(result.candles[result.candles.length - 1].time).toBe(9999 * 60);
  });

  it('keeps overlapping older pages mergeable without stopping cursor progress', () => {
    const existing = normalizeCandlePageAscending([
      candle(180, 180),
      candle(240, 240),
      candle(300, 300),
    ]);
    const olderPage = normalizeCandlePageAscending([
      candle(60, 60),
      candle(120, 120),
      candle(180, 999),
    ]);

    const result = prependCandleHistory(existing, olderPage);

    expect(result.addedCount).toBe(2);
    expect(result.candles.map(item => item.time)).toEqual([60, 120, 180, 240, 300]);
    expect(result.candles[2].close).toBe(180);
  });

  it('merges duplicate timestamps with incoming backend values when requested', () => {
    const existing = normalizeCandlePageAscending([
      candle(60, 60, { tickVolume: 10 }),
      candle(120, 120, { tickVolume: 12 }),
    ]);

    const result = mergeBackendCandlePage(existing, [
      candle(120, 125, { realVolume: 99 }),
      candle(180, 180),
    ]);

    expect(result.addedCount).toBe(1);
    expect(result.updatedCount).toBe(1);
    expect(result.candles).toEqual([
      candle(60, 60, { tickVolume: 10 }),
      candle(120, 125, { tickVolume: 12, realVolume: 99 }),
      candle(180, 180),
    ]);
  });

  it('keeps candles sorted ascending after unsorted backend pages and live upserts', () => {
    const normalized = normalizeCandlePageAscending([
      candle(300, 300),
      candle(60, 60),
      candle(180, 180),
      candle(180, 181),
    ]);

    const withEarlierLiveUpdate = upsertCandleIntoHistory(normalized, candle(120, 120));
    const withLaterLiveUpdate = upsertCandleIntoHistory(withEarlierLiveUpdate.candles, candle(360, 360));

    expect(withLaterLiveUpdate.candles.map(item => item.time)).toEqual([60, 120, 180, 300, 360]);
    expect(withLaterLiveUpdate.candles[2].close).toBe(181);
  });

  it('returns the prepended unique count and offsets the visible logical range', () => {
    const existing = normalizeCandlePageAscending([
      candle(180, 180),
      candle(240, 240),
      candle(300, 300),
    ]);

    const result = prependCandleHistory(existing, [
      candle(60, 60),
      candle(120, 120),
      candle(180, 999),
    ]);

    expect(result.addedCount).toBe(2);
    expect(result.candles[2].close).toBe(180);
    expect(offsetLogicalRangeForPrependedCandles({ from: 10, to: 90 }, result.addedCount)).toEqual({
      from: 12,
      to: 92,
    });
  });

  it('keeps valid raw older candles when price reconciliation rejects the whole page', () => {
    const result = selectOlderHistoryCandlesForMerge([
      candle(120, 120),
      candle(60, 60),
    ], []);

    expect(result.usedRawFallback).toBe(true);
    expect(result.candles.map(item => item.time)).toEqual([60, 120]);
  });

  it('prefers reconciled older candles when price reconciliation succeeds', () => {
    const result = selectOlderHistoryCandlesForMerge([
      candle(60, 60),
      candle(120, 120),
    ], [
      candle(60, 600),
      candle(120, 1200),
    ]);

    expect(result.usedRawFallback).toBe(false);
    expect(result.candles.map(item => item.close)).toEqual([600, 1200]);
  });

  it('keeps empty older pages empty so callers can stop at the beginning of history', () => {
    const result = selectOlderHistoryCandlesForMerge([], []);

    expect(result.usedRawFallback).toBe(false);
    expect(result.candles).toEqual([]);
  });

  it('builds bounded inclusive range windows behind an older-history cursor', () => {
    expect(buildOlderHistoryRangeFallbackWindows(600, 60, 3, 3)).toEqual([
      { from: 480, to: 600 },
      { from: 359, to: 479 },
      { from: 238, to: 358 },
    ]);
  });

  it('preserves the visible logical range for non-reset renders without prepends', () => {
    expect(getVisibleLogicalRangeForDataRender(
      { from: 10, to: 90 },
      { resetVisibleRange: false, prependedBars: 0 },
    )).toEqual({
      from: 10,
      to: 90,
    });
  });

  it('offsets the preserved visible logical range for prepended history renders', () => {
    expect(getVisibleLogicalRangeForDataRender(
      { from: 10, to: 90 },
      { resetVisibleRange: false, prependedBars: 2 },
    )).toEqual({
      from: 12,
      to: 92,
    });
  });

  it('returns no preserved range for reset renders so callers can apply the initial viewport', () => {
    expect(getVisibleLogicalRangeForDataRender(
      { from: 10, to: 90 },
      { resetVisibleRange: true, prependedBars: 2 },
    )).toBeNull();
  });

  it('formats history for aggregation and applies broker offsets without mutating source candles', () => {
    const source = [
      candle(120, 10, { tickVolume: 11, realVolume: 12 }),
      candle(180, 20),
    ];

    const adjusted = applyBrokerTimeOffsetToCandles(source, 60);

    expect(source[0].time).toBe(120);
    expect(adjusted.map(item => item.time)).toEqual([60, 120]);
    expect(formatHistoryForOhlcv(adjusted)).toEqual([
      { time: 60, open: 9, high: 11, low: 8, close: 10, volume: 10 },
      { time: 120, open: 19, high: 21, low: 18, close: 20, volume: 10 },
    ]);
  });
});
