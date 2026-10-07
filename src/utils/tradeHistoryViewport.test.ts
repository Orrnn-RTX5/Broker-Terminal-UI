import { describe, expect, it } from 'vitest';
import { getTradeHistoryTimeRange, isTradeHistoryInTimeRange } from './tradeHistoryViewport';

const candles = Array.from({ length: 100 }, (_, index) => ({ time: 1000 + index * 60 }));

describe('trade history viewport membership', () => {
  it('uses neighboring candle times rather than assuming evenly spaced history', () => {
    const sparseCandles = [{ time: 10 }, { time: 20 }, { time: 4000 }, { time: 9000 }, { time: 15000 }];
    expect(getTradeHistoryTimeRange(sparseCandles, { from: 2.2, to: 2.8 }))
      .toEqual({ from: 10, to: 15000 });
  });

  it('clamps fractional and shifted ranges to loaded candles', () => {
    expect(getTradeHistoryTimeRange(candles, { from: 95.4, to: 108 }))
      .toEqual({ from: candles[93].time, to: candles[99].time });
    expect(getTradeHistoryTimeRange(candles, { from: -8, to: 3 }))
      .toEqual({ from: candles[0].time, to: candles[5].time });
  });

  it('waits for chart coordinates before mounting history DOM', () => {
    expect(getTradeHistoryTimeRange([], { from: 0, to: 50 })).toBeNull();
    expect(getTradeHistoryTimeRange(candles, null)).toBeNull();
    expect(getTradeHistoryTimeRange(candles, { from: NaN, to: 50 })).toBeNull();
    expect(isTradeHistoryInTimeRange({ entryTime: 1000, exitTime: 2000 }, null)).toBe(false);
  });

  it.each([
    [110, 150, true], [50, 250, true], [250, 50, true],
    [100, 100, true], [200, 200, true], [20, 99, false], [201, 300, false],
  ])('retains crossing paths and edge arrows: %s to %s', (entryTime, exitTime, expected) => {
    expect(isTradeHistoryInTimeRange({ entryTime, exitTime }, { from: 100, to: 200 })).toBe(expected);
  });

  it('selects the new viewport without discarding older account records', () => {
    const history = Array.from({ length: 1000 }, (_, index) => ({
      entryTime: 1000 + index * 60, exitTime: 1010 + index * 60,
    }));
    const select = (from: number, to: number) => history.filter(trade => isTradeHistoryInTimeRange(trade, { from, to }));
    expect(select(1000, 1100)).toHaveLength(2);
    expect(select(20000, 20100)).toHaveLength(2);
    expect(history).toHaveLength(1000);
    expect(select(1000, 1100)).toEqual(history.slice(0, 2));
  });
});
