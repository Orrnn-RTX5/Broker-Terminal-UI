import { describe, expect, it } from 'vitest';

import {
  getCurrentClosedMarketRenderCandles,
  getCurrentClosedMarketSessionCloseSeconds,
  type CurrentClosedMarketRenderCandle,
} from './currentClosedMarketTail';

interface TestCandle extends CurrentClosedMarketRenderCandle {
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

const utcSeconds = (
  year: number,
  month: number,
  day: number,
  hour = 0,
  minute = 0,
): number => Math.floor(Date.UTC(year, month - 1, day, hour, minute) / 1000);

const candle = (time: number, price = 1): TestCandle => ({
  time,
  open: price,
  high: price,
  low: price,
  close: price,
  volume: 0,
});

describe('current closed market render filter', () => {
  it('keeps M1 candles before the close and hides candles starting at or after the close', () => {
    const closeSeconds = utcSeconds(2026, 7, 3, 0, 0);
    const candles = [
      candle(utcSeconds(2026, 7, 2, 23, 58)),
      candle(utcSeconds(2026, 7, 2, 23, 59)),
      candle(closeSeconds),
      candle(utcSeconds(2026, 7, 3, 0, 1)),
    ];

    const result = getCurrentClosedMarketRenderCandles(candles, {
      isMarketClosed: true,
      sessionCloseTimeMs: closeSeconds * 1000,
    });

    expect(result.map((item) => item.time)).toEqual([
      utcSeconds(2026, 7, 2, 23, 58),
      utcSeconds(2026, 7, 2, 23, 59),
    ]);
    expect(candles).toHaveLength(4);
  });

  it('keeps the H1 candle that starts before a close inside that hour', () => {
    const closeSeconds = utcSeconds(2026, 7, 3, 16, 57);
    const candles = [
      candle(utcSeconds(2026, 7, 3, 15, 0)),
      candle(utcSeconds(2026, 7, 3, 16, 0)),
      candle(utcSeconds(2026, 7, 3, 17, 0)),
      candle(utcSeconds(2026, 7, 3, 18, 0)),
    ];

    const result = getCurrentClosedMarketRenderCandles(candles, {
      isMarketClosed: true,
      sessionCloseTimeMs: closeSeconds * 1000,
    });

    expect(result.map((item) => item.time)).toEqual([
      utcSeconds(2026, 7, 3, 15, 0),
      utcSeconds(2026, 7, 3, 16, 0),
    ]);
  });

  it('does not trim repeated flat or low-volume candles when session_close is missing', () => {
    const candles = [
      candle(utcSeconds(2026, 7, 3, 20, 45), 1.3349),
      candle(utcSeconds(2026, 7, 3, 20, 46), 1.3349),
      candle(utcSeconds(2026, 7, 3, 20, 47), 1.3349),
      candle(utcSeconds(2026, 7, 3, 20, 48), 1.3349),
      candle(utcSeconds(2026, 7, 3, 20, 49), 1.3349),
    ];

    const result = getCurrentClosedMarketRenderCandles(candles, {
      isMarketClosed: true,
      sessionCloseTimeMs: null,
    });

    expect(result).toEqual(candles);
  });

  it('returns full history when market is open even if a session_close value exists', () => {
    const closeSeconds = utcSeconds(2026, 7, 3, 0, 0);
    const candles = [
      candle(utcSeconds(2026, 7, 2, 23, 59)),
      candle(closeSeconds),
      candle(utcSeconds(2026, 7, 3, 0, 1)),
    ];

    const result = getCurrentClosedMarketRenderCandles(candles, {
      isMarketClosed: false,
      sessionCloseTimeMs: closeSeconds * 1000,
    });

    expect(result).toEqual(candles);
  });

  it('accepts session close timestamps in seconds or milliseconds', () => {
    const closeSeconds = utcSeconds(2026, 7, 3, 16, 57);

    expect(getCurrentClosedMarketSessionCloseSeconds(closeSeconds)).toBe(closeSeconds);
    expect(getCurrentClosedMarketSessionCloseSeconds(closeSeconds * 1000)).toBe(closeSeconds);
  });
});
