import { describe, expect, it } from 'vitest';
import {
  applyTickToFormingCandle,
  applyBrokerTimeOffsetToCandles,
  buildOlderHistoryRangeFallbackWindows,
  formatHistoryForOhlcv,
  getVisibleLogicalRangeForDataRender,
  mergeAuthoritativeCandleHistory,
  mergeHistoricalCandlesWithBufferedLive,
  mergeHistoricalCandleWithBufferedLive,
  mergeFormingCandleEnvelope,
  mergeBackendCandlePage,
  normalizeCandlePageAscending,
  offsetLogicalRangeForPrependedCandles,
  prependCandleHistory,
  resolveCanonicalServerCandle,
  selectCandlesMutatedAfterGeneration,
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

  it('does not collapse a valid zero-volume forming candle when its first live tick arrives', () => {
    const previous = candle(60, 105, {
      open: 100,
      high: 110,
      low: 90,
      volume: 0,
      tickVolume: 0,
    });

    expect(applyTickToFormingCandle(previous, 102)).toEqual({
      time: 60,
      open: 100,
      high: 110,
      low: 90,
      close: 102,
      volume: 1,
      tickVolume: 1,
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

  it('caches the expanded canonical envelope for a delayed same-time partial', () => {
    const active = candle(60, 105, {
      open: 100,
      high: 110,
      low: 90,
      volume: 18,
      closed: false,
    });
    const delayedPartial = candle(60, 99, {
      open: 101,
      high: 108,
      low: 95,
      volume: 12,
      closed: false,
    });

    expect(resolveCanonicalServerCandle(active, delayedPartial)).toEqual({
      ...delayedPartial,
      open: 100,
      high: 110,
      low: 90,
      volume: 18,
      tickVolume: 18,
    });
  });

  it('keeps an explicit final authoritative when selecting the cache revision', () => {
    const active = candle(60, 105, { open: 100, high: 110, low: 90, volume: 18 });
    const final = candle(60, 99, {
      open: 101,
      high: 108,
      low: 95,
      volume: 12,
      closed: true,
    });

    expect(resolveCanonicalServerCandle(active, final)).toEqual(final);
  });

  it('does not reopen a cached explicit final from a delayed partial', () => {
    const final = candle(60, 99, {
      open: 101,
      high: 108,
      low: 95,
      volume: 12,
      closed: true,
    });
    const delayedPartial = candle(60, 105, {
      open: 100,
      high: 110,
      low: 90,
      volume: 18,
      closed: false,
    });

    expect(resolveCanonicalServerCandle(final, delayedPartial)).toEqual(final);
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

  it('lets fresh backend OHLC replace stale cached duplicates while retaining older rows', () => {
    const stale = [
      candle(60, 60),
      candle(120, 999, { open: 990, high: 1000, low: 980 }),
    ];
    const backend = [
      candle(120, 125, { open: 121, high: 127, low: 119 }),
      candle(180, 180),
    ];

    const result = mergeAuthoritativeCandleHistory(stale, backend);

    expect(result.map(item => item.time)).toEqual([60, 120, 180]);
    expect(result[1]).toEqual(backend[0]);
  });

  it('drops an unproven cached candle newer than a successful latest backend page', () => {
    const staleFuture = candle(300, 999, { open: 990, high: 1000, low: 980 });
    const backend = [
      candle(120, 125, { closed: true }),
      candle(180, 185, { closed: false }),
    ];

    expect(mergeAuthoritativeCandleHistory([
      candle(60, 65),
      ...backend,
      staleFuture,
    ], backend).map(item => item.time)).toEqual([60, 120, 180]);
  });

  it('retains a future bucket only when a post-request live mutation proves it', () => {
    const formingBeforeRequest = candle(240, 245, {
      open: 241,
      high: 247,
      low: 239,
      closed: false,
    });
    const newerLive = candle(240, 250, {
      open: 246,
      high: 252,
      low: 244,
      closed: false,
    });
    const backend = [candle(120, 125, { closed: true }), candle(180, 185, { closed: true })];

    expect(mergeAuthoritativeCandleHistory(
      [formingBeforeRequest],
      backend,
      { formingLiveCandle: newerLive, hasNewerLiveMutation: true },
    )).toEqual([
      ...backend,
      expect.objectContaining({
        time: 240,
        open: 241,
        high: 252,
        low: 239,
        close: 250,
      }),
    ]);
  });

  it('replaces only the authoritative backend range while preserving outside rows and a newer forming overlay', () => {
    const olderOutsideRange = candle(60, 60);
    const staleDuplicate = candle(120, 999, { open: 990, high: 1000, low: 980 });
    const fabricatedInterior = candle(180, 777, { open: 770, high: 780, low: 760 });
    const formingBeforeRequest = candle(300, 300, {
      open: 295,
      high: 305,
      low: 290,
      volume: 40,
      tickVolume: 40,
      closed: false,
    });
    const backend = [
      candle(120, 125, { open: 121, high: 127, low: 119, closed: true }),
      candle(240, 245, { open: 241, high: 247, low: 239, closed: true }),
    ];
    const newerFormingMutation = candle(300, 310, {
      open: 302,
      high: 312,
      low: 298,
      volume: 41,
      tickVolume: 41,
      closed: false,
    });

    const result = mergeAuthoritativeCandleHistory(
      [olderOutsideRange, staleDuplicate, fabricatedInterior, formingBeforeRequest],
      backend,
      {
        formingLiveCandle: newerFormingMutation,
        hasNewerLiveMutation: true,
      },
    );

    expect(result.map(item => item.time)).toEqual([60, 120, 240, 300]);
    expect(result[0]).toEqual(olderOutsideRange);
    expect(result[1]).toEqual(backend[0]);
    expect(result.some(item => item.time === fabricatedInterior.time)).toBe(false);
    expect(result[3]).toMatchObject({
      time: 300,
      open: 295,
      high: 312,
      low: 290,
      close: 310,
      volume: 41,
      tickVolume: 41,
      closed: false,
    });
  });

  it('does not let an unchanged local forming candle overwrite fresh backend OHLC', () => {
    const backend = candle(120, 125, {
      open: 121,
      high: 127,
      low: 119,
      volume: 40,
      closed: false,
    });
    const staleLocal = candle(120, 999, {
      open: 990,
      high: 1000,
      low: 980,
      volume: 4,
    });

    expect(mergeAuthoritativeCandleHistory([staleLocal], [backend], {
      formingLiveCandle: staleLocal,
      hasNewerLiveMutation: false,
    })).toEqual([backend]);
  });

  it('overlays only a newer live mutation onto a forming backend candle', () => {
    const backend = candle(120, 125, {
      open: 121,
      high: 127,
      low: 119,
      volume: 40,
      tickVolume: 40,
      closed: false,
    });
    const newerLive = candle(120, 130, {
      open: 124,
      high: 131,
      low: 123,
      volume: 5,
      tickVolume: 5,
    });

    expect(mergeAuthoritativeCandleHistory([], [backend], {
      formingLiveCandle: newerLive,
      hasNewerLiveMutation: true,
    })).toEqual([{
      ...backend,
      high: 131,
      close: 130,
    }]);
  });

  it('keeps a finalized backend candle authoritative over a newer local mutation', () => {
    const backend = candle(120, 125, {
      open: 121,
      high: 127,
      low: 119,
      volume: 40,
      closed: true,
    });
    const newerLive = candle(120, 130, {
      open: 124,
      high: 131,
      low: 123,
      volume: 5,
    });

    expect(mergeAuthoritativeCandleHistory([], [backend], {
      formingLiveCandle: newerLive,
      hasNewerLiveMutation: true,
    })).toEqual([backend]);
  });

  it('selects every candle changed after a request began, including a rolled bucket', () => {
    const justClosed = candle(120, 125);
    const forming = candle(180, 130);
    const stale = candle(60, 115);
    const generations = new Map<number, number>([
      [60, 4],
      [120, 6],
      [180, 7],
    ]);

    expect(selectCandlesMutatedAfterGeneration(
      [stale, justClosed, forming],
      generations,
      5,
    )).toEqual([justClosed, forming]);
  });

  it('does not overlay buffered live values onto a backend-finalized candle', () => {
    const finalized = candle(120, 125, { closed: true });
    const buffered = candle(120, 130, { high: 131 });

    expect(mergeHistoricalCandlesWithBufferedLive([finalized], [buffered])).toEqual([finalized]);
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

  it('fails closed when price reconciliation rejects an older page', () => {
    const result = selectOlderHistoryCandlesForMerge([
      candle(120, 120),
      candle(60, 60),
    ], []);

    expect(result.usedRawFallback).toBe(false);
    expect(result.candles).toEqual([]);
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
