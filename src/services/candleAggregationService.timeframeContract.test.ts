import { describe, expect, it } from 'vitest';
import {
  CandleAggregationService,
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

  it('rejects an out-of-order previous-bucket tick without contaminating the current M1 or M5 candle', () => {
    const builder = new SymbolCandleBuilder('XAUUSD');
    const start = utcSeconds(2026, 8, 28, 10, 0);

    builder.processTick(tick(start, 100, 1));
    builder.processTick(tick(start + 60, 101, 1));
    builder.processTick(tick(start + 80, 103, 1));
    const m1BeforeDelayedTick = builder.getCandles('M1').map(candle => ({ ...candle }));
    const m5BeforeDelayedTick = builder.getCandles('M5').map(candle => ({ ...candle }));

    const updates = builder.processTick(tick(start + 40, 150, 7));

    expect(updates.size).toBe(0);
    expect(builder.getCandles('M1')).toEqual(m1BeforeDelayedTick);
    expect(builder.getCandles('M5')).toEqual(m5BeforeDelayedTick);
    expect(builder.getCandles('M1')[1]).toMatchObject({
      time: start + 60,
      open: 101,
      high: 103,
      low: 101,
      close: 103,
      volume: 2,
    });
  });

  it('lets an older same-bucket tick extend High or Low without regressing Close', () => {
    const builder = new SymbolCandleBuilder('XAUUSD');
    const start = utcSeconds(2026, 8, 28, 10, 0);

    builder.processTick(tick(start + 10, 100, 1));
    builder.processTick(tick(start + 50, 105, 1));
    builder.processTick(tick(start + 40, 110, 1));
    builder.processTick(tick(start + 30, 95, 1));

    expect(builder.getCandles('M1')).toEqual([{
      time: start,
      open: 100,
      high: 110,
      low: 95,
      close: 105,
      volume: 4,
      isComplete: false,
    }]);
    expect(builder.getCandles('M5')[0]).toMatchObject({
      open: 100,
      high: 110,
      low: 95,
      close: 105,
      volume: 4,
    });
  });

  it('ignores a non-consecutive replay after a different tick has been processed', () => {
    const builder = new SymbolCandleBuilder('XAUUSD');
    const start = utcSeconds(2026, 8, 28, 10, 0);
    const first = tick(start, 100, 2);

    builder.processTick(first);
    builder.processTick(tick(start + 1, 101, 3));
    const replayUpdates = builder.processTick(first);

    expect(replayUpdates.size).toBe(0);
    expect(builder.getCandles('M1')).toEqual([{
      time: start,
      open: 100,
      high: 101,
      low: 100,
      close: 101,
      volume: 5,
      isComplete: false,
    }]);
    expect(builder.getCandles('M5')[0]).toMatchObject({ close: 101, volume: 5 });
  });

  it('applies backend partial A and B open/close authoritatively while only expanding the observed envelope', () => {
    const builder = new SymbolCandleBuilder('XAUUSD');
    const start = utcSeconds(2026, 8, 28, 10, 0);

    builder.processTick(tick(start + 5, 100, 4));
    builder.processTick(tick(start + 20, 110, 3));

    const backendPartialA: OHLCV = {
      time: start,
      open: 102,
      high: 108,
      low: 101,
      close: 105,
      volume: 5,
    };
    builder.reconcileServerCandle('M1', backendPartialA, false);

    expect(builder.getCandles('M1')[0]).toEqual({
      ...backendPartialA,
      high: 110,
      low: 100,
      volume: 7,
      isComplete: false,
    });

    builder.processTick(tick(start + 50, 95, 1));
    const backendPartialB: OHLCV = {
      time: start,
      open: 103,
      high: 115,
      low: 99,
      close: 106,
      volume: 6,
    };
    builder.reconcileServerCandle('M1', backendPartialB, false);

    expect(builder.getCandles('M1')[0]).toEqual({
      ...backendPartialB,
      low: 95,
      volume: 8,
      isComplete: false,
    });
    expect(builder.getCandles('M5')[0]).toMatchObject({
      open: 103,
      high: 115,
      low: 95,
      close: 106,
      volume: 8,
    });
  });

  it('lets backend final C exactly replace local M1 and rebuild the corrected derived timeframe', () => {
    const builder = new SymbolCandleBuilder('XAUUSD');
    const start = utcSeconds(2026, 8, 28, 10, 0);
    const localA = { ...m1(start, 102, 2), open: 100, high: 103, low: 99 };
    const localB = { ...m1(start + 60, 105, 3), open: 102, high: 106, low: 101 };
    const localC = { ...m1(start + 120, 118, 4), open: 105, high: 120, low: 104 };

    builder.addCompletedCandle('M1', localA);
    builder.addCompletedCandle('M1', localB);
    builder.addCompletedCandle('M1', localC);
    expect(builder.getCandles('M5')[0]).toMatchObject({ high: 120, close: 118, volume: 9 });

    const backendFinalC: OHLCV = {
      time: start + 120,
      open: 105,
      high: 108,
      low: 103,
      close: 104,
      volume: 7,
    };
    builder.reconcileServerCandle('M1', backendFinalC, true);

    expect(builder.getCandles('M1')[2]).toEqual({
      ...backendFinalC,
      isComplete: true,
    });
    expect(builder.getCandles('M5')).toEqual([{
      time: start,
      open: 100,
      high: 108,
      low: 99,
      close: 104,
      volume: 12,
      isComplete: false,
    }]);
  });

  it('builds Bid-only OHLC without turning the Ask spread into a candle wick', () => {
    const builder = new SymbolCandleBuilder('XAUUSD');
    const start = utcSeconds(2026, 9, 1, 10, 45);

    builder.processTick({
      symbol: 'XAUUSD',
      bid: 4376,
      ask: 4378,
      timestamp: start,
      volume: 1,
    });
    builder.processTick({
      symbol: 'XAUUSD',
      bid: 4376,
      ask: 4390,
      timestamp: start + 1,
      volume: 1,
    });

    expect(builder.getCandles('M1')).toEqual([{
      time: start,
      open: 4376,
      high: 4376,
      low: 4376,
      close: 4376,
      volume: 2,
      isComplete: false,
    }]);
  });

  it('repairs a forming candle when a later tick would leave high below the body', () => {
    const builder = new SymbolCandleBuilder('XAUUSD');
    const start = utcSeconds(2026, 9, 1, 10, 45);

    builder.processTick(tick(start, 4376, 1));
    builder.processTick(tick(start + 10, 4380, 1));

    expect(builder.getCandles('M1')[0]).toMatchObject({
      open: 4376,
      high: 4380,
      low: 4376,
      close: 4380,
    });
  });

  it('falls back to a positive Ask instead of building zero-price M1 and M5 candles', () => {
    const builder = new SymbolCandleBuilder('XAUUSD');
    const start = utcSeconds(2026, 9, 1, 10, 45);

    const updates = builder.processTick({
      symbol: 'XAUUSD',
      bid: 0,
      ask: 4376,
      timestamp: start,
      volume: 1,
    });

    expect(updates.get('M1')).toMatchObject({
      open: 4376,
      high: 4376,
      low: 4376,
      close: 4376,
    });
    expect(updates.get('M5')).toMatchObject({
      open: 4376,
      high: 4376,
      low: 4376,
      close: 4376,
    });
  });

  it('drops a tick when neither Bid nor Ask is a positive finite price', () => {
    const builder = new SymbolCandleBuilder('XAUUSD');
    const start = utcSeconds(2026, 9, 1, 10, 45);

    expect(builder.processTick({
      symbol: 'XAUUSD',
      bid: 0,
      ask: -1,
      timestamp: start,
      volume: 1,
    }).size).toBe(0);
    expect(builder.getCandles('M1')).toEqual([]);
    expect(builder.getCandles('M5')).toEqual([]);
  });

  it('does not mutate an established candle when a later tick has no valid price', () => {
    const builder = new SymbolCandleBuilder('XAUUSD');
    const start = utcSeconds(2026, 9, 1, 10, 45);

    builder.processTick(tick(start, 4376, 2));
    expect(builder.processTick({
      symbol: 'XAUUSD',
      bid: 0,
      ask: 0,
      timestamp: start + 1,
      volume: 9,
    }).size).toBe(0);

    expect(builder.getCandles('M1')).toMatchObject([{
      open: 4376,
      high: 4376,
      low: 4376,
      close: 4376,
      volume: 2,
    }]);
    expect(builder.getCandles('M5')).toMatchObject([{
      open: 4376,
      high: 4376,
      low: 4376,
      close: 4376,
      volume: 2,
    }]);
  });

  it('rejects corrupt history and completed-candle inputs before higher-timeframe aggregation', () => {
    const builder = new SymbolCandleBuilder('XAUUSD');
    const start = utcSeconds(2026, 9, 1, 10, 45);
    const valid = m1(start, 4376);

    builder.loadHistoricalCandles('M1', [
      valid,
      { ...m1(start + 60, 0), open: 0, high: 0, low: 0, close: 0 },
      { ...m1(start + 120, 4380), high: 280000 },
    ]);
    builder.addCompletedCandle('M1', {
      ...m1(start + 180, 4380),
      high: 4379,
    });

    expect(builder.getCandles('M1', false)).toEqual([{ ...valid, isComplete: true }]);
    expect(builder.getCandles('M5')).toMatchObject([{
      open: 4376,
      high: 4376,
      low: 4376,
      close: 4376,
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

  it('keeps EURUSD and EURUSD.r in exact punctuation-preserving symbol stores', () => {
    const service = new CandleAggregationService();
    const start = utcSeconds(2026, 8, 28, 10, 0);

    service.processTick({ ...tick(start, 1.1, 1), symbol: 'EURUSD' });
    service.processTick({ ...tick(start, 1.2, 1), symbol: 'EURUSD.r' });
    service.processTick({ ...tick(start + 1, 1.25, 1), symbol: 'EURUSD.r' });

    expect(service.getCandles('EURUSD', 'M1')[0]).toMatchObject({
      open: 1.1,
      close: 1.1,
      volume: 1,
    });
    expect(service.getCandles('EURUSD.r', 'M1')[0]).toMatchObject({
      open: 1.2,
      high: 1.25,
      close: 1.25,
      volume: 2,
    });
    expect(service.getSymbols()).toEqual(['EURUSD', 'EURUSD.R']);

    service.clearSymbol('EURUSD');
    expect(service.getCandles('EURUSD', 'M1')).toEqual([]);
    expect(service.getCandles('EURUSD.r', 'M1')).toHaveLength(1);
  });
});
