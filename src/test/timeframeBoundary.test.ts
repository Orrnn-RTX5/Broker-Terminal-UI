import { describe, expect, it } from 'vitest';
import { alignToTimeframe, SymbolCandleBuilder } from '../services/candleAggregationService';
import {
  CANDLE_TIMEFRAMES,
  TIMEFRAME_SECONDS,
  alignTimeframeBoundarySeconds,
  getCandleRolloverStartSeconds,
  getRemainingTimeframeSeconds,
  getTimeframePeriodSeconds,
  type BoundaryTimeframe,
} from '../utils/timeframeBoundary';

const utcSeconds = (
  year: number,
  month: number,
  day: number,
  hour = 0,
  minute = 0,
  second = 0,
) => Date.UTC(year, month - 1, day, hour, minute, second) / 1000;

describe('timeframeBoundary', () => {
  it('keeps one canonical registry for every supported chart timeframe', () => {
    expect(CANDLE_TIMEFRAMES).toEqual(['M1', 'M5', 'M15', 'M30', 'H1', 'H4', 'D1', 'W1', 'MN']);
    expect(TIMEFRAME_SECONDS).toMatchObject({
      M1: 60,
      M5: 5 * 60,
      M15: 15 * 60,
      M30: 30 * 60,
      H1: 60 * 60,
      H4: 4 * 60 * 60,
      D1: 24 * 60 * 60,
      W1: 7 * 24 * 60 * 60,
    });
  });

  it.each([
    {
      timeframe: 'M1',
      now: utcSeconds(2026, 8, 28, 10, 0, 20),
      start: utcSeconds(2026, 8, 28, 10, 0),
      close: utcSeconds(2026, 8, 28, 10, 1),
      remaining: 40,
    },
    {
      timeframe: 'M5',
      now: utcSeconds(2026, 8, 28, 10, 3, 20),
      start: utcSeconds(2026, 8, 28, 10, 0),
      close: utcSeconds(2026, 8, 28, 10, 5),
      remaining: 100,
    },
    {
      timeframe: 'M15',
      now: utcSeconds(2026, 8, 28, 10, 7, 30),
      start: utcSeconds(2026, 8, 28, 10, 0),
      close: utcSeconds(2026, 8, 28, 10, 15),
      remaining: 450,
    },
    {
      timeframe: 'M30',
      now: utcSeconds(2026, 8, 28, 10, 22, 15),
      start: utcSeconds(2026, 8, 28, 10, 0),
      close: utcSeconds(2026, 8, 28, 10, 30),
      remaining: 465,
    },
    {
      timeframe: 'H1',
      now: utcSeconds(2026, 8, 28, 10, 37, 20),
      start: utcSeconds(2026, 8, 28, 10, 0),
      close: utcSeconds(2026, 8, 28, 11, 0),
      remaining: 1360,
    },
    {
      timeframe: 'H4',
      now: utcSeconds(2026, 8, 28, 10, 37, 20),
      start: utcSeconds(2026, 8, 28, 8, 0),
      close: utcSeconds(2026, 8, 28, 12, 0),
      remaining: 4960,
    },
    {
      timeframe: 'D1',
      now: utcSeconds(2026, 8, 28, 10, 37, 20),
      start: utcSeconds(2026, 8, 28),
      close: utcSeconds(2026, 8, 29),
      remaining: 48160,
    },
    {
      timeframe: 'W1',
      now: utcSeconds(2026, 8, 28, 10, 37, 20),
      start: utcSeconds(2026, 8, 24),
      close: utcSeconds(2026, 8, 31),
      remaining: 220960,
    },
    {
      timeframe: 'MN',
      now: utcSeconds(2026, 8, 28, 10, 37, 20),
      start: utcSeconds(2026, 8, 1),
      close: utcSeconds(2026, 9, 1),
      remaining: 307360,
    },
  ] satisfies Array<{
    timeframe: BoundaryTimeframe;
    now: number;
    start: number;
    close: number;
    remaining: number;
  }>)('resolves the real $timeframe candle period from its timestamp', ({
    timeframe,
    now,
    start,
    close,
    remaining,
  }) => {
    expect(getTimeframePeriodSeconds(now, timeframe)).toEqual({
      startTime: start,
      closeTime: close,
      durationSeconds: close - start,
    });
    expect(getRemainingTimeframeSeconds(now, timeframe)).toBe(remaining);
    expect(alignToTimeframe(now * 1000, timeframe)).toBe(start * 1000);
  });

  it('switches periods at the exact close boundary and makes repeated rollover resolution idempotent', () => {
    const previousStart = utcSeconds(2026, 8, 28, 10, 0);
    const boundary = utcSeconds(2026, 8, 28, 10, 15);

    expect(getTimeframePeriodSeconds(boundary - 0.001, 'M15')).toMatchObject({
      startTime: previousStart,
      closeTime: boundary,
    });
    expect(getRemainingTimeframeSeconds(boundary - 0.001, 'M15')).toBeCloseTo(0.001, 6);
    expect(getTimeframePeriodSeconds(boundary, 'M15')).toEqual({
      startTime: boundary,
      closeTime: utcSeconds(2026, 8, 28, 10, 30),
      durationSeconds: 15 * 60,
    });
    expect(getCandleRolloverStartSeconds(previousStart, boundary, 'M15')).toBe(boundary);
    expect(getCandleRolloverStartSeconds(boundary, boundary, 'M15')).toBeNull();
  });

  it.each([
    {
      timeframe: 'H1',
      now: utcSeconds(2026, 8, 28, 10, 37, 20),
      start: utcSeconds(2026, 8, 28, 10, 30),
      close: utcSeconds(2026, 8, 28, 11, 30),
    },
    {
      timeframe: 'D1',
      now: utcSeconds(2026, 8, 28, 20, 0),
      start: utcSeconds(2026, 8, 28, 18, 30),
      close: utcSeconds(2026, 8, 29, 18, 30),
    },
    {
      timeframe: 'W1',
      now: utcSeconds(2026, 8, 24, 1, 0),
      start: utcSeconds(2026, 8, 23, 18, 30),
      close: utcSeconds(2026, 8, 30, 18, 30),
    },
    {
      timeframe: 'MN',
      now: utcSeconds(2026, 9, 1, 1, 0),
      start: utcSeconds(2026, 8, 31, 18, 30),
      close: utcSeconds(2026, 9, 30, 18, 30),
    },
  ] satisfies Array<{
    timeframe: BoundaryTimeframe;
    now: number;
    start: number;
    close: number;
  }>)('aligns $timeframe to the configured UTC+05:30 market boundary', ({
    timeframe,
    now,
    start,
    close,
  }) => {
    const boundaryOffsetSeconds = (5 * 60 * 60) + (30 * 60);

    expect(getTimeframePeriodSeconds(now, timeframe, boundaryOffsetSeconds)).toMatchObject({
      startTime: start,
      closeTime: close,
    });
    expect(alignToTimeframe(now * 1000, timeframe, boundaryOffsetSeconds)).toBe(start * 1000);
  });

  it.each([
    [2024, 2, 29],
    [2025, 2, 28],
    [2026, 4, 30],
    [2026, 7, 31],
  ])('uses the real calendar length for %i-%i', (year, month, expectedDays) => {
    const period = getTimeframePeriodSeconds(utcSeconds(year, month, 15, 12), 'MN');

    expect(period?.startTime).toBe(utcSeconds(year, month, 1));
    expect(period?.durationSeconds).toBe(expectedDays * 24 * 60 * 60);
    expect(period?.closeTime).toBe(month === 12
      ? utcSeconds(year + 1, 1, 1)
      : utcSeconds(year, month + 1, 1));
  });

  it('aligns W1 timestamps to UTC Monday instead of Unix-epoch Thursday', () => {
    const thursday = utcSeconds(2025, 10, 9, 15, 30);
    const monday = utcSeconds(2025, 10, 6);

    expect(alignTimeframeBoundarySeconds(thursday, 'W1', 7 * 24 * 60 * 60)).toBe(monday);
    expect(alignToTimeframe(thursday * 1000, 'W1')).toBe(monday * 1000);
  });

  it('preserves fixed-second bucketing for non-weekly frames', () => {
    const timestamp = utcSeconds(2025, 10, 9, 15, 37);

    expect(alignTimeframeBoundarySeconds(timestamp, 'M5', 5 * 60)).toBe(utcSeconds(2025, 10, 9, 15, 35));
    expect(alignTimeframeBoundarySeconds(timestamp, 'D1', 24 * 60 * 60)).toBe(utcSeconds(2025, 10, 9));
  });

  it('aligns MN timestamps to the first UTC day of the calendar month', () => {
    const julyTimestamp = utcSeconds(2026, 7, 2, 12, 30);
    const fixedThirtyDayBucket = utcSeconds(2026, 6, 6);

    expect(alignTimeframeBoundarySeconds(julyTimestamp, 'MN', 30 * 24 * 60 * 60))
      .toBe(utcSeconds(2026, 7, 1));
    expect(alignTimeframeBoundarySeconds(julyTimestamp, 'MN', 30 * 24 * 60 * 60))
      .not.toBe(fixedThirtyDayBucket);
    expect(alignToTimeframe(julyTimestamp * 1000, 'MN')).toBe(utcSeconds(2026, 7, 1) * 1000);
  });

  it('keeps MN aligned across February and March calendar lengths', () => {
    expect(alignTimeframeBoundarySeconds(utcSeconds(2024, 2, 29, 23, 59), 'MN', 30 * 24 * 60 * 60))
      .toBe(utcSeconds(2024, 2, 1));
    expect(alignTimeframeBoundarySeconds(utcSeconds(2026, 3, 31, 18, 45), 'MN', 30 * 24 * 60 * 60))
      .toBe(utcSeconds(2026, 3, 1));
  });

  it('uses UTC Monday buckets when aggregating completed M1 candles into W1', () => {
    const builder = new SymbolCandleBuilder('EURUSD');
    const firstMinute = utcSeconds(2025, 10, 9, 12, 0);
    const secondMinute = utcSeconds(2025, 10, 9, 12, 1);

    builder.processTick({ symbol: 'EURUSD', bid: 1.1, ask: 1.2, timestamp: firstMinute });
    builder.processTick({ symbol: 'EURUSD', bid: 1.2, ask: 1.3, timestamp: secondMinute });

    expect(builder.getCandles('W1')).toMatchObject([
      { time: utcSeconds(2025, 10, 6), open: 1.1, close: 1.2 },
    ]);
  });

  it('aggregates multiple July M1 candles into one MN candle at July 1', () => {
    const builder = new SymbolCandleBuilder('BTCUSD');

    builder.addCompletedCandle('M1', {
      time: utcSeconds(2026, 7, 1, 0, 0),
      open: 60000,
      high: 60100,
      low: 59900,
      close: 60050,
      volume: 10,
    });
    builder.addCompletedCandle('M1', {
      time: utcSeconds(2026, 7, 2, 12, 30),
      open: 60050,
      high: 61200,
      low: 59800,
      close: 61000,
      volume: 20,
    });

    expect(builder.getCandles('MN')).toEqual([
      {
        time: utcSeconds(2026, 7, 1),
        open: 60000,
        high: 61200,
        low: 59800,
        close: 61000,
        volume: 30,
        isComplete: false,
      },
    ]);
  });

  it('splits completed M1 candles across June and July MN candles', () => {
    const builder = new SymbolCandleBuilder('BTCUSD');

    builder.addCompletedCandle('M1', {
      time: utcSeconds(2026, 6, 30, 23, 59),
      open: 58000,
      high: 58500,
      low: 57900,
      close: 58400,
      volume: 7,
    });
    builder.addCompletedCandle('M1', {
      time: utcSeconds(2026, 7, 1, 0, 0),
      open: 58400,
      high: 59000,
      low: 58300,
      close: 58900,
      volume: 9,
    });

    expect(builder.getCandles('MN')).toEqual([
      {
        time: utcSeconds(2026, 6, 1),
        open: 58000,
        high: 58500,
        low: 57900,
        close: 58400,
        volume: 7,
        isComplete: true,
      },
      {
        time: utcSeconds(2026, 7, 1),
        open: 58400,
        high: 59000,
        low: 58300,
        close: 58900,
        volume: 9,
        isComplete: false,
      },
    ]);
  });

  it('propagates server-confirmed M1 candles into higher timeframes', () => {
    const builder = new SymbolCandleBuilder('EURUSD');

    builder.addCompletedCandle('M1', {
      time: utcSeconds(2025, 10, 9, 12, 0),
      open: 1.1,
      high: 1.2,
      low: 1.0,
      close: 1.15,
      volume: 10,
    });
    builder.addCompletedCandle('M1', {
      time: utcSeconds(2025, 10, 9, 12, 1),
      open: 1.15,
      high: 1.3,
      low: 1.12,
      close: 1.25,
      volume: 5,
    });

    expect(builder.getCandles('M5')).toMatchObject([
      {
        time: utcSeconds(2025, 10, 9, 12, 0),
        open: 1.1,
        high: 1.3,
        low: 1.0,
        close: 1.25,
        volume: 15,
      },
    ]);
  });

  it('does not synthesize missing M1 candles when live ticks skip periods', () => {
    const builder = new SymbolCandleBuilder('EURUSD');
    const firstMinute = utcSeconds(2025, 10, 9, 12, 0);
    const nextRealMinute = utcSeconds(2025, 10, 9, 12, 6);

    builder.processTick({ symbol: 'EURUSD', bid: 1.1, ask: 1.2, timestamp: firstMinute });
    builder.processTick({ symbol: 'EURUSD', bid: 1.3, ask: 1.4, timestamp: nextRealMinute });

    const candles = builder.getCandles('M1');

    expect(candles.map(candle => candle.time)).toEqual([firstMinute, nextRealMinute]);
    expect(candles.every(candle => candle.isSynthetic !== true)).toBe(true);
  });
});
