import { describe, expect, it } from 'vitest';
import { parseMarketWatchTickHistory } from './useMarketWatchTickHistory';

describe('parseMarketWatchTickHistory', () => {
  it('reads array and wrapped responses in chronological order', () => {
    const rows = [
      { symbol: 'XAUUSD', bid: 4126.3, ask: 4126.7, time: 1_790_000_001 },
      { symbol: 'XAUUSD', bid: 4126.2, ask: 4126.6, time: 1_790_000_000 },
    ];
    const expected = [
      { timestamp: 1_790_000_000_000, bid: 4126.2, ask: 4126.6 },
      { timestamp: 1_790_000_001_000, bid: 4126.3, ask: 4126.7 },
    ];

    expect(parseMarketWatchTickHistory(rows, 'xauusd')).toEqual(expected);
    expect(parseMarketWatchTickHistory({ ticks: rows }, 'XAUUSD')).toEqual(expected);
    expect(parseMarketWatchTickHistory({ data: rows }, 'XAUUSD')).toEqual(expected);
  });

  it('skips other contracts, one-sided quotes and rows without broker time', () => {
    expect(parseMarketWatchTickHistory([
      { symbol: 'XAUUSD.raw', bid: 1, ask: 2, time: 1_790_000_000 },
      { symbol: 'XAUUSD', bid: 0, ask: 2, time: 1_790_000_000 },
      { symbol: 'XAUUSD', bid: 1, ask: 2 },
      { bid: 1, ask: 2, time: 1_790_000_002 },
    ], 'XAUUSD')).toEqual([{ timestamp: 1_790_000_002_000, bid: 1, ask: 2 }]);
    expect(parseMarketWatchTickHistory(null, 'XAUUSD')).toEqual([]);
    expect(parseMarketWatchTickHistory({ error: 'none' }, 'XAUUSD')).toEqual([]);
  });
});
