import { describe, expect, it } from 'vitest';
import { alignToTimeframe, SymbolCandleBuilder } from '../services/candleAggregationService';
import { alignTimeframeBoundarySeconds } from '../utils/timeframeBoundary';

const utcSeconds = (year: number, month: number, day: number, hour = 0, minute = 0) =>
  Date.UTC(year, month - 1, day, hour, minute) / 1000;

describe('timeframeBoundary', () => {
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

  it('uses UTC Monday buckets when aggregating completed M1 candles into W1', () => {
    const builder = new SymbolCandleBuilder('EURUSD');
    const firstMinute = utcSeconds(2025, 10, 9, 12, 0);
    const secondMinute = utcSeconds(2025, 10, 9, 12, 1);

    builder.processTick({ symbol: 'EURUSD', bid: 1.1, ask: 1.2, timestamp: firstMinute });
    builder.processTick({ symbol: 'EURUSD', bid: 1.2, ask: 1.3, timestamp: secondMinute });

    expect(builder.getCandles('W1')).toMatchObject([
      { time: utcSeconds(2025, 10, 6), open: 1.15, close: 1.25 },
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
});
