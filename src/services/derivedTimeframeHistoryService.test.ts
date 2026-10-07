import { describe, expect, it, vi } from 'vitest';
import type { FetchCandlesOptions, OHLCData } from './chartDataService';
import {
  aggregateM1CandlesToTimeframe,
  fetchDerivedTimeframeCandlesFromM1,
  getDerivedM1InitialTargetCandleLimit,
  getDerivedM1MaxPages,
  isM1DerivedFallbackTimeframe,
} from './derivedTimeframeHistoryService';

const utcSeconds = (year: number, month: number, day: number, hour = 0, minute = 0) =>
  Date.UTC(year, month - 1, day, hour, minute) / 1000;

const candle = (
  time: number,
  open = time,
  high = open + 2,
  low = open - 2,
  close = open + 1,
  volume = 1,
): OHLCData => ({
  time,
  open,
  high,
  low,
  close,
  volume,
});

describe('derived timeframe history from M1', () => {
  it('uses the explicit broker boundary offset for a snapshot aggregate', () => {
    const start = utcSeconds(2026, 5, 1, 0, 2);
    const candles = [candle(start, 100), candle(start + 60, 101), candle(start + 300, 102)];
    expect(aggregateM1CandlesToTimeframe(candles, 'M5', 120).map(item => item.time))
      .toEqual([start - 240, start + 60]);
  });
  it('aggregates five M1 candles into one M5 candle', () => {
    const start = utcSeconds(2026, 5, 1, 0, 0);
    const m1Candles = [
      candle(start, 10, 11, 9, 10.5, 3),
      candle(start + 60, 10.5, 12, 10, 11, 4),
      candle(start + 120, 11, 11.5, 8, 9, 5),
      candle(start + 180, 9, 13, 8.5, 12, 6),
      candle(start + 240, 12, 12.5, 11, 12.25, 7),
    ];

    expect(aggregateM1CandlesToTimeframe(m1Candles, 'M5')).toEqual([{
      time: start,
      open: 10,
      high: 13,
      low: 8,
      close: 12.25,
      volume: 25,
    }]);
  });

  it('aggregates multiple H1 buckets with first open, max high, min low, last close, and summed volume', () => {
    const start = utcSeconds(2026, 5, 1, 0, 0);
    const m1Candles = [
      candle(start, 1.1, 1.2, 1.0, 1.15, 10),
      candle(start + 59 * 60, 1.15, 1.3, 1.05, 1.25, 20),
      candle(start + 60 * 60, 1.25, 1.28, 1.2, 1.22, 30),
      candle(start + 61 * 60, 1.22, 1.35, 1.18, 1.33, 40),
    ];

    expect(aggregateM1CandlesToTimeframe(m1Candles, 'H1')).toEqual([
      { time: start, open: 1.1, high: 1.3, low: 1.0, close: 1.25, volume: 30 },
      { time: start + 60 * 60, open: 1.25, high: 1.35, low: 1.18, close: 1.33, volume: 70 },
    ]);
  });

  it('preserves first open and last close when one H1 bucket spans multiple M1 pages', async () => {
    const start = utcSeconds(2026, 5, 1, 0, 0);
    const m1Candles = Array.from({ length: 60 }, (_, index) => (
      candle(
        start + index * 60,
        index,
        index + 10,
        index - 10,
        index + 0.5,
        1,
      )
    ));
    const fetchCandles = vi.fn(async (options: FetchCandlesOptions) => {
      const to = options.to ?? Number.MAX_SAFE_INTEGER;
      const count = options.count ?? 30;
      return m1Candles
        .filter(item => item.time <= to)
        .sort((left, right) => right.time - left.time)
        .slice(0, count);
    });

    const result = await fetchDerivedTimeframeCandlesFromM1({
      symbol: 'EURUSD',
      targetTimeframe: 'H1',
      olderThanRaw: start + 60 * 60,
      pageSize: 30,
      maxM1Pages: 2,
      fetchCandles,
      yieldToMainThread: async () => undefined,
    });

    expect(fetchCandles).toHaveBeenCalledTimes(2);
    expect(result.candles).toEqual([{
      time: start,
      open: 0,
      high: 69,
      low: -10,
      close: 59.5,
      volume: 60,
    }]);
  });

  it('returns all complete older target candles from fetched M1 coverage', async () => {
    const start = utcSeconds(2026, 5, 1, 0, 0);
    const m1Candles = Array.from({ length: 180 }, (_, index) => candle(start + index * 60));
    const fetchCandles = vi.fn(async (options: FetchCandlesOptions) => {
      const to = options.to ?? Number.MAX_SAFE_INTEGER;
      const count = options.count ?? 180;
      return m1Candles
        .filter(item => item.time <= to)
        .sort((left, right) => right.time - left.time)
        .slice(0, count);
    });

    const result = await fetchDerivedTimeframeCandlesFromM1({
      symbol: 'EURUSD',
      targetTimeframe: 'H1',
      olderThanRaw: start + 3 * 60 * 60,
      pageSize: 180,
      maxM1Pages: 2,
      fetchCandles,
      yieldToMainThread: async () => undefined,
    });

    expect(fetchCandles).toHaveBeenCalledTimes(1);
    expect(result.candles.map(item => item.time)).toEqual([
      start,
      start + 60 * 60,
      start + 2 * 60 * 60,
    ]);
  });

  it.each([
    {
      targetTimeframe: 'D1',
      bucketStart: utcSeconds(2026, 1, 1),
      olderThanRaw: utcSeconds(2026, 1, 2),
      firstInBucket: utcSeconds(2026, 1, 1, 23, 0),
      lastInBucket: utcSeconds(2026, 1, 1, 23, 59),
      olderCoverageCandle: utcSeconds(2025, 12, 31, 23, 59),
    },
    {
      targetTimeframe: 'W1',
      bucketStart: utcSeconds(2026, 1, 5),
      olderThanRaw: utcSeconds(2026, 1, 12),
      firstInBucket: utcSeconds(2026, 1, 6),
      lastInBucket: utcSeconds(2026, 1, 9),
      olderCoverageCandle: utcSeconds(2026, 1, 4, 23, 59),
    },
    {
      targetTimeframe: 'MN',
      bucketStart: utcSeconds(2026, 3, 1),
      olderThanRaw: utcSeconds(2026, 4, 1),
      firstInBucket: utcSeconds(2026, 3, 2),
      lastInBucket: utcSeconds(2026, 3, 31),
      olderCoverageCandle: utcSeconds(2026, 2, 28, 23, 59),
    },
  ])('treats $targetTimeframe buckets with session gaps as complete after coverage crosses the boundary', async ({
    targetTimeframe,
    bucketStart,
    olderThanRaw,
    firstInBucket,
    lastInBucket,
    olderCoverageCandle,
  }) => {
    const m1Candles = [
      candle(olderCoverageCandle, 8, 9, 7, 8.5, 1),
      candle(firstInBucket, 10, 11, 9, 10.5, 2),
      candle(lastInBucket, 12, 13, 11, 12.5, 3),
    ];
    const fetchCandles = vi.fn(async (options: FetchCandlesOptions) => {
      const to = options.to ?? Number.MAX_SAFE_INTEGER;
      const count = options.count ?? 2;
      return m1Candles
        .filter(item => item.time <= to)
        .sort((left, right) => right.time - left.time)
        .slice(0, count);
    });

    const result = await fetchDerivedTimeframeCandlesFromM1({
      symbol: 'EURUSD',
      targetTimeframe,
      olderThanRaw,
      pageSize: 2,
      maxM1Pages: 2,
      fetchCandles,
      yieldToMainThread: async () => undefined,
    });

    expect(fetchCandles).toHaveBeenCalledTimes(2);
    expect(result.candles).toEqual([{
      time: bucketStart,
      open: 10,
      high: 13,
      low: 9,
      close: 12.5,
      volume: 5,
    }]);
  });

  it('aligns W1 buckets to UTC Monday', () => {
    const thursday = utcSeconds(2026, 7, 2, 12, 34);
    const monday = utcSeconds(2026, 6, 29);

    expect(aggregateM1CandlesToTimeframe([candle(thursday)], 'W1')[0]?.time).toBe(monday);
  });

  it('aligns MN buckets to the first calendar day of the month', () => {
    const julySecond = utcSeconds(2026, 7, 2, 12, 34);
    const julyFirst = utcSeconds(2026, 7, 1);

    expect(aggregateM1CandlesToTimeframe([candle(julySecond)], 'MN')[0]?.time).toBe(julyFirst);
  });

  it('derives one complete May 2026 MN candle from full May M1 data', () => {
    const mayStart = utcSeconds(2026, 5, 1);
    const mayCandles = Array.from({ length: 44_640 }, (_, index) => (
      candle(mayStart + index * 60, 100 + index, 101 + index, 99 + index, 100.5 + index, 1)
    ));

    const derived = aggregateM1CandlesToTimeframe(mayCandles, 'MN');

    expect(derived).toHaveLength(1);
    expect(derived[0]).toMatchObject({
      time: mayStart,
      open: 100,
      high: 101 + 44_639,
      low: 99,
      close: 100.5 + 44_639,
      volume: 44_640,
    });
  });

  it('fetches enough M1 pages to derive a complete older monthly candle', async () => {
    const mayStart = utcSeconds(2026, 5, 1);
    const juneStart = utcSeconds(2026, 6, 1);
    const mayCandles = Array.from({ length: 44_640 }, (_, index) => candle(mayStart + index * 60));
    const fetchCandles = vi.fn(async (options: FetchCandlesOptions) => {
      const to = options.to ?? Number.MAX_SAFE_INTEGER;
      const count = options.count ?? 5000;
      return mayCandles
        .filter(item => item.time <= to)
        .sort((left, right) => right.time - left.time)
        .slice(0, count);
    });

    const result = await fetchDerivedTimeframeCandlesFromM1({
      symbol: 'GBPUSD',
      targetTimeframe: 'MN',
      olderThanRaw: juneStart,
      fetchCandles,
      yieldToMainThread: async () => undefined,
    });

    expect(result.pagesFetched).toBe(9);
    expect(result.m1CandlesFetched).toBe(44_640);
    expect(result.candles.map(item => item.time)).toEqual([mayStart]);
    expect(fetchCandles.mock.calls[0]?.[0]).toMatchObject({
      symbol: 'GBPUSD',
      timeframe: 'M1',
      count: 5000,
      to: juneStart - 1,
    });
  });

  it('fetches initial MN history through the calendar bucket start before returning it', async () => {
    const julyStart = utcSeconds(2026, 7, 1);
    const midMonth = utcSeconds(2026, 7, 15);
    const newestPage = [
      candle(midMonth, 20, 22, 19, 21, 5),
      candle(midMonth + 60, 21, 24, 20, 23, 7),
    ];
    const bucketStartPage = [
      candle(julyStart, 10, 12, 9, 11, 2),
      candle(julyStart + 60, 11, 13, 10, 12, 3),
    ];
    const fetchCandles = vi.fn(async (options: FetchCandlesOptions) => (
      options.to === undefined ? newestPage : bucketStartPage
    ));

    const result = await fetchDerivedTimeframeCandlesFromM1({
      symbol: 'XAUUSD',
      targetTimeframe: 'MN',
      pageSize: 2,
      maxM1Pages: 2,
      targetCandleLimit: 1,
      includeM1Candles: true,
      fetchCandles,
      yieldToMainThread: async () => undefined,
    });

    expect(fetchCandles).toHaveBeenCalledTimes(2);
    expect(fetchCandles.mock.calls[0]?.[0]).not.toHaveProperty('to');
    expect(fetchCandles.mock.calls[1]?.[0]).toMatchObject({
      symbol: 'XAUUSD',
      timeframe: 'M1',
      count: 2,
      to: midMonth - 1,
    });
    expect(result.pagesFetched).toBe(2);
    expect(result.m1CandlesFetched).toBe(4);
    expect(result.m1Candles.map(item => item.time)).toEqual([
      julyStart,
      julyStart + 60,
      midMonth,
      midMonth + 60,
    ]);
    expect(result.candles).toEqual([{
      time: julyStart,
      open: 10,
      high: 24,
      low: 9,
      close: 23,
      volume: 17,
    }]);
  });

  it('stops initial fallback after the requested derived target candle count', async () => {
    const start = utcSeconds(2026, 5, 1);
    const m1Candles = Array.from({ length: 180 }, (_, index) => candle(start + index * 60));
    const fetchCandles = vi.fn(async (options: FetchCandlesOptions) => {
      const to = options.to ?? Number.MAX_SAFE_INTEGER;
      const count = options.count ?? 60;
      return m1Candles
        .filter(item => item.time <= to)
        .sort((left, right) => right.time - left.time)
        .slice(0, count);
    });
    const yieldBetweenPages = vi.fn(async () => undefined);

    const result = await fetchDerivedTimeframeCandlesFromM1({
      symbol: 'GBPUSD',
      targetTimeframe: 'H1',
      pageSize: 60,
      maxM1Pages: 3,
      targetCandleLimit: 2,
      fetchCandles,
      yieldBetweenPages,
      yieldToMainThread: async () => undefined,
    });

    expect(fetchCandles).toHaveBeenCalledTimes(2);
    expect(yieldBetweenPages).toHaveBeenCalledTimes(1);
    expect(result.candles.map(item => item.time)).toEqual([
      start + 60 * 60,
      start + 120 * 60,
    ]);
  });

  it('aborts between M1 fallback pages before starting the next fetch', async () => {
    const controller = new AbortController();
    const start = utcSeconds(2026, 5, 1);
    const m1Candles = Array.from({ length: 60 }, (_, index) => candle(start + index * 60));
    const fetchCandles = vi.fn(async (options: FetchCandlesOptions) => {
      const to = options.to ?? Number.MAX_SAFE_INTEGER;
      const count = options.count ?? 30;
      return m1Candles
        .filter(item => item.time <= to)
        .sort((left, right) => right.time - left.time)
        .slice(0, count);
    });
    const yieldBetweenPages = vi.fn(async () => {
      controller.abort();
    });

    const result = await fetchDerivedTimeframeCandlesFromM1({
      symbol: 'US30',
      targetTimeframe: 'H1',
      olderThanRaw: start + 60 * 60,
      signal: controller.signal,
      pageSize: 30,
      maxM1Pages: 2,
      fetchCandles,
      yieldBetweenPages,
      yieldToMainThread: async () => undefined,
    });

    expect(fetchCandles).toHaveBeenCalledTimes(1);
    expect(yieldBetweenPages).toHaveBeenCalledTimes(1);
    expect(result.aborted).toBe(true);
    expect(result.m1CandlesFetched).toBe(30);
    expect(result.candles).toEqual([]);
  });

  it('yields while processing a large M1 fallback page', async () => {
    const start = utcSeconds(2026, 5, 1);
    const m1Candles = Array.from({ length: 60 }, (_, index) => candle(start + index * 60));
    const fetchCandles = vi.fn(async () => (
      [...m1Candles].sort((left, right) => right.time - left.time)
    ));
    const yieldToMainThread = vi.fn(async () => undefined);

    const result = await fetchDerivedTimeframeCandlesFromM1({
      symbol: 'US30',
      targetTimeframe: 'H1',
      olderThanRaw: start + 60 * 60,
      pageSize: 60,
      maxM1Pages: 1,
      processingChunkSize: 10,
      fetchCandles,
      yieldToMainThread,
    });

    expect(yieldToMainThread).toHaveBeenCalled();
    expect(result.aborted).toBe(false);
    expect(result.candles.map(item => item.time)).toEqual([start]);
  });

  it('stops processing and reports aborted when the signal aborts during M1 aggregation', async () => {
    const controller = new AbortController();
    const start = utcSeconds(2026, 5, 1);
    const m1Candles = Array.from({ length: 60 }, (_, index) => candle(start + index * 60));
    const fetchCandles = vi.fn(async () => (
      [...m1Candles].sort((left, right) => right.time - left.time)
    ));
    const yieldToMainThread = vi.fn(async () => {
      controller.abort();
    });

    const result = await fetchDerivedTimeframeCandlesFromM1({
      symbol: 'US30',
      targetTimeframe: 'H1',
      olderThanRaw: start + 60 * 60,
      signal: controller.signal,
      pageSize: 60,
      maxM1Pages: 2,
      processingChunkSize: 1,
      fetchCandles,
      yieldToMainThread,
    });

    expect(fetchCandles).toHaveBeenCalledTimes(1);
    expect(yieldToMainThread).toHaveBeenCalledTimes(1);
    expect(result.aborted).toBe(true);
    expect(result.candles).toEqual([]);
    expect(result.m1CandlesFetched).toBe(1);
  });

  it('honors maxM1Pages when M1 coverage is insufficient for a complete target bucket', async () => {
    const mayStart = utcSeconds(2026, 5, 1);
    const juneStart = utcSeconds(2026, 6, 1);
    const mayTailCandles = Array.from({ length: 10 }, (_, index) => (
      candle(mayStart + (44_630 + index) * 60)
    ));
    const fetchCandles = vi.fn(async (options: FetchCandlesOptions) => {
      const to = options.to ?? Number.MAX_SAFE_INTEGER;
      const count = options.count ?? 2;
      return mayTailCandles
        .filter(item => item.time <= to)
        .sort((left, right) => right.time - left.time)
        .slice(0, count);
    });

    const result = await fetchDerivedTimeframeCandlesFromM1({
      symbol: 'GBPUSD',
      targetTimeframe: 'MN',
      olderThanRaw: juneStart,
      pageSize: 2,
      maxM1Pages: 2,
      fetchCandles,
      yieldToMainThread: async () => undefined,
    });

    expect(fetchCandles).toHaveBeenCalledTimes(2);
    expect(result.pagesFetched).toBe(2);
    expect(result.m1CandlesFetched).toBe(4);
    expect(result.candles).toEqual([]);
  });

  it('does not fetch when the fallback is aborted before it starts', async () => {
    const controller = new AbortController();
    controller.abort();
    const fetchCandles = vi.fn();

    const result = await fetchDerivedTimeframeCandlesFromM1({
      symbol: 'US30',
      targetTimeframe: 'H1',
      olderThanRaw: utcSeconds(2026, 6, 1),
      signal: controller.signal,
      fetchCandles,
    });

    expect(fetchCandles).not.toHaveBeenCalled();
    expect(result.aborted).toBe(true);
    expect(result.candles).toEqual([]);
  });

  it('returns no derived candles when M1 has no data', async () => {
    const fetchCandles = vi.fn(async () => []);

    const result = await fetchDerivedTimeframeCandlesFromM1({
      symbol: 'US30',
      targetTimeframe: 'H1',
      olderThanRaw: utcSeconds(2026, 6, 1),
      fetchCandles,
    });

    expect(fetchCandles).toHaveBeenCalledTimes(1);
    expect(result.reachedBeginning).toBe(true);
    expect(result.candles).toEqual([]);
  });

  it('exposes fallback eligibility and page limits by timeframe', () => {
    expect(isM1DerivedFallbackTimeframe('M1')).toBe(false);
    expect(isM1DerivedFallbackTimeframe('H1')).toBe(true);
    expect(getDerivedM1InitialTargetCandleLimit('H1')).toBe(30);
    expect(getDerivedM1InitialTargetCandleLimit('D1')).toBe(10);
    expect(getDerivedM1InitialTargetCandleLimit('MN')).toBe(1);
    expect(getDerivedM1MaxPages('H1')).toBe(2);
    expect(getDerivedM1MaxPages('D1')).toBe(3);
    expect(getDerivedM1MaxPages('W1')).toBe(4);
    expect(getDerivedM1MaxPages('MN')).toBe(10);
  });
});
