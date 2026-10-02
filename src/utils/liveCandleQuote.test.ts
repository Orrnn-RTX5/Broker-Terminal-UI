import { describe, expect, it } from 'vitest';
import { resolveFormingCandleLiveClose } from './liveCandleQuote';
import { getTimeframePeriodSeconds } from './timeframeBoundary';

describe('forming candle quote ownership', () => {
  const timestamp = Date.UTC(2026, 8, 30, 13, 10, 25);
  it.each(['EURJPY', 'GBPJPY', 'XAGUSD', 'XAUUSD', 'BTCUSD', 'EURUSD.r'])('uses the same raw Bid rule for %s across all chart periods', symbol => {
    for (const timeframe of ['M1', 'M5', 'M15', 'M30', 'H1', 'H4', 'D1', 'W1', 'MN'] as const) {
      const time = getTimeframePeriodSeconds(timestamp / 1000, timeframe)!.startTime;
      const server = { time, open: 100, high: 103, low: 99, close: 102, volume: 5, closed: false };
      const quote = { symbol, bid: 100.5, ask: 103.5, rawBid: 101, rawAsk: 103, sourceTimestamp: timestamp };
      expect(resolveFormingCandleLiveClose(server, quote, symbol, timeframe)).toEqual({ ...server, close: 101 });
    }
  });
  it('keeps explicit final candles exact and rejects another symbol, bucket, or receipt-only quote', () => {
    const server = { time: Math.floor(timestamp / 60000) * 60, open: 100, high: 103, low: 99, close: 102, volume: 5 };
    const quote = { symbol: 'EURJPY', bid: 101, ask: 103, sourceTimestamp: timestamp };
    expect(resolveFormingCandleLiveClose({ ...server, closed: true }, quote, 'EURJPY', 'M1').close).toBe(102);
    expect(resolveFormingCandleLiveClose(server, quote, 'EURJPY.r', 'M1')).toBe(server);
    expect(resolveFormingCandleLiveClose(server, { ...quote, sourceTimestamp: timestamp - 60000 }, 'EURJPY', 'M1')).toBe(server);
    expect(resolveFormingCandleLiveClose(server, { ...quote, sourceTimestamp: undefined }, 'EURJPY', 'M1')).toBe(server);
  });
});
