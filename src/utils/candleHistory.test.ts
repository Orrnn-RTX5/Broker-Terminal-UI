import { describe, expect, it } from 'vitest';
import {
  applyBrokerTimeOffsetToCandles,
  formatHistoryForOhlcv,
  getVisibleLogicalRangeForDataRender,
  mergeBackendCandlePage,
  normalizeCandlePageAscending,
  offsetLogicalRangeForPrependedCandles,
  prependCandleHistory,
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
