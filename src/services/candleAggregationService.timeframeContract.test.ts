import { describe, expect, it } from 'vitest';
import {
  omitPartialLeadingM1Aggregate,
  SymbolCandleBuilder,
  type OHLCV,
  type Tick,
} from './candleAggregationService';

const utcSeconds = (
  year: number,
  month: number,
  day: number,
  hour = 0,
  minute = 0,
  second = 0,
) => Date.UTC(year, month - 1, day, hour, minute, second) / 1000;

const tick = (
  timestamp: number,
  price: number,
  volume: number,
): Tick => ({
  symbol: 'XAUUSD',
  bid: price,
  ask: price,
  timestamp,
  volume,
});

const m1 = (
  time: number,
  price: number,
  volume = 1,
): OHLCV => ({
  time,
  open: price,
  high: price,
  low: price,
  close: price,
  volume,
});

describe('SymbolCandleBuilder synchronized timeframe contract', () => {
  it('keeps an aligned leading aggregate and drops only a genuinely partial one', () => {
    const start = utcSeconds(2026, 8, 28, 10, 0);
    const aggregates = [m1(start, 100), m1(start + 60 * 60, 101)];

    expect(omitPartialLeadingM1Aggregate(aggregates, start, 'H1')).toEqual(aggregates);
    expect(omitPartialLeadingM1Aggregate(aggregates, start + 60, 'H1')).toEqual([aggregates[1]]);
    expect(omitPartialLeadingM1Aggregate([aggregates[1]], start + 60, 'H1')).toEqual([aggregates[1]]);
    expect(omitPartialLeadingM1Aggregate([aggregates[0]], start + 60, 'H1')).toEqual([]);
  });

  it.each([
    ['H1', utcSeconds(2026, 8, 28, 10, 30)],
    ['D1', utcSeconds(2026, 8, 28, 18, 30)],
    ['W1', utcSeconds(2026, 8, 23, 18, 30)],
    ['MN', utcSeconds(2026, 8, 31, 18, 30)],
  ] as const)('uses the configured offset for %s leading-coverage checks', (timeframe, bucketStart) => {
    const boundaryOffsetSeconds = (5 * 60 * 60) + (30 * 60);
    const aggregates = [m1(bucketStart, 100)];

    expect(omitPartialLeadingM1Aggregate(
      aggregates,
      bucketStart,
      timeframe,
      boundaryOffsetSeconds,
    )).toEqual(aggregates);
    expect(omitPartialLeadingM1Aggregate(
      aggregates,
      bucketStart + 60,
      timeframe,
      boundaryOffsetSeconds,
    )).toEqual([]);
  });

  it('keeps one M5 candle updating from successive M1 periods without double-counting live volume', () => {
    const builder = new SymbolCandleBuilder('XAUUSD');
    const start = utcSeconds(2026, 8, 28, 10, 0);

    builder.processTick(tick(start, 100, 1));
    builder.processTick(tick(start + 20, 102, 2));
    builder.processTick(tick(start + 60, 101, 3));
    builder.processTick(tick(start + 80, 104, 4));
    builder.processTick(tick(start + 120, 103, 5));

    expect(builder.getCandles('M1').map(candle => candle.volume)).toEqual([3, 7, 5]);
    expect(builder.getCandles('M5')).toEqual([{
      time: start,
      open: 100,
      high: 104,
      low: 100,
      close: 103,
      volume: 15,
      isComplete: false,
    }]);
  });

  it('ignores an exact replay while retaining a newer same-price tick', () => {
    const builder = new SymbolCandleBuilder('XAUUSD');
    const start = utcSeconds(2026, 8, 28, 10, 0);
    const replay = tick(start, 100, 2);

    builder.processTick(replay);
    builder.processTick(replay);
    builder.processTick(tick(start + 1, 100, 2));

    expect(builder.getCandles('M1')).toEqual([{
      time: start,
      open: 100,
      high: 100,
      low: 100,
      close: 100,
      volume: 4,
      isComplete: false,
    }]);
  });

  it('creates one candle per exact boundary when a completed M1 frame is replayed', () => {
    const builder = new SymbolCandleBuilder('XAUUSD');
    const start = utcSeconds(2026, 8, 28, 10, 0);

    for (let minute = 0; minute <= 5; minute += 1) {
      builder.addCompletedCandle('M1', m1(start + minute * 60, 100 + minute));
    }
    builder.addCompletedCandle('M1', m1(start + 5 * 60, 105));

    expect(builder.getCandles('M1', false)).toHaveLength(6);
    expect(builder.getCandles('M5')).toEqual([
      {
        time: start,
        open: 100,
        high: 104,
        low: 100,
        close: 104,
        volume: 5,
        isComplete: true,
      },
      {
        time: start + 5 * 60,
        open: 105,
        high: 105,
        low: 105,
        close: 105,
        volume: 1,
        isComplete: false,
      },
    ]);
  });

  it('uses the configured market boundary offset for higher-timeframe buckets', () => {
    const boundaryOffsetSeconds = (5 * 60 * 60) + (30 * 60);
    const builder = new SymbolCandleBuilder('XAUUSD', { boundaryOffsetSeconds });
    const firstMinute = utcSeconds(2026, 8, 28, 10, 37);

    builder.addCompletedCandle('M1', m1(firstMinute, 100));
    builder.addCompletedCandle('M1', m1(firstMinute + 60, 101));

    expect(builder.getCandles('H1')).toMatchObject([{
      time: utcSeconds(2026, 8, 28, 10, 30),
      open: 100,
      close: 101,
      volume: 2,
    }]);
  });
});
