import { describe, expect, it } from 'vitest';
import {
  buildMarketClosedGapSeries,
  getMarketGapTimeframeSeconds,
  isCryptoMarketSymbol,
  isMarketClosedPlaceholderCandle,
  type MarketClosedGapCandle,
} from './marketClosedGaps';

const utcSeconds = (year: number, month: number, day: number, hour = 0, minute = 0) =>
  Date.UTC(year, month - 1, day, hour, minute) / 1000;

const candle = (
  time: number,
  open: number,
  high: number,
  low: number,
  close: number,
  volume = 1,
): MarketClosedGapCandle => ({
  time,
  open,
  high,
  low,
  close,
  volume,
});

const flatCandles = (
  startTime: number,
  count: number,
  price: number,
  stepSeconds = 60,
  volume = 0,
): MarketClosedGapCandle[] => (
  Array.from({ length: count }, (_, index) => candle(startTime + (index * stepSeconds), price, price, price, price, volume))
);

describe('marketClosedGaps', () => {
  it('detects crypto base symbols without matching forex USD pairs', () => {
    expect(isCryptoMarketSymbol('BTCUSD')).toBe(true);
    expect(isCryptoMarketSymbol('ETHUSDT')).toBe(true);
    expect(isCryptoMarketSymbol('USDCAD')).toBe(false);
    expect(isCryptoMarketSymbol('GBPUSD')).toBe(false);
  });

  it('parses supported chart timeframes', () => {
    expect(getMarketGapTimeframeSeconds('M1')).toBe(60);
    expect(getMarketGapTimeframeSeconds('H4')).toBe(4 * 60 * 60);
    expect(getMarketGapTimeframeSeconds('unknown')).toBeNull();
  });

  it('hides long non-crypto weekend placeholder runs and returns one gap marker', () => {
    const previous = candle(utcSeconds(2026, 6, 26, 20, 59), 1.31, 1.32, 1.30, 1.315);
    const closedRun = flatCandles(utcSeconds(2026, 6, 26, 21, 0), 48 * 60, 1.315);
    const reopen = candle(utcSeconds(2026, 6, 28, 23, 0), 1.323, 1.326, 1.321, 1.324);

    const result = buildMarketClosedGapSeries([previous, ...closedRun, reopen], {
      symbol: 'GBPUSD',
      timeframe: 'M1',
    });

    expect(result.candles).toEqual([previous, reopen]);
    expect(result.gaps).toEqual([
      {
        startTime: previous.time,
        endTime: reopen.time,
        markerTime: reopen.time - 60,
        price: 1.315,
        hiddenCandles: 48 * 60,
      },
    ]);
  });

  it('does not publish a gap marker when no real candle follows a hidden run', () => {
    const previous = candle(utcSeconds(2026, 6, 26, 20, 59), 1.31, 1.32, 1.30, 1.315);
    const closedRun = flatCandles(utcSeconds(2026, 6, 26, 21, 0), 48 * 60, 1.315);

    const result = buildMarketClosedGapSeries([previous, ...closedRun], {
      symbol: 'GBPUSD',
      timeframe: 'M1',
    });

    expect(result.candles).toEqual([previous]);
    expect(result.gaps).toEqual([]);
  });

  it('hides H1 weekend placeholders even when the flat price differs from the previous close', () => {
    const previous = candle(utcSeconds(2026, 6, 26, 20), 4010, 4040, 4000, 4055);
    const closedRun = flatCandles(utcSeconds(2026, 6, 27), 44, 4088, 60 * 60);
    const reopen = candle(utcSeconds(2026, 6, 28, 23), 4065, 4070, 4050, 4060);

    const result = buildMarketClosedGapSeries([previous, ...closedRun, reopen], {
      symbol: 'XAUUSD',
      timeframe: 'H1',
    });

    expect(result.candles).toEqual([previous, reopen]);
    expect(result.gaps).toEqual([
      {
        startTime: previous.time,
        endTime: reopen.time,
        markerTime: reopen.time - (60 * 60),
        price: 4088,
        hiddenCandles: 44,
      },
    ]);
  });

  it('keeps positive-volume flat candles at the Sunday reopen time', () => {
    const previous = candle(utcSeconds(2026, 6, 26, 22), 1.31, 1.32, 1.30, 1.315);
    const reopen = candle(utcSeconds(2026, 6, 28, 23), 1.315, 1.315, 1.315, 1.315, 25);
    const next = candle(utcSeconds(2026, 6, 29, 0), 1.315, 1.316, 1.314, 1.3155);

    expect(isMarketClosedPlaceholderCandle(reopen)).toBe(false);

    const result = buildMarketClosedGapSeries([previous, reopen, next], {
      symbol: 'GBPUSD',
      timeframe: 'H1',
    });

    expect(result.candles).toEqual([previous, reopen, next]);
    expect(result.gaps).toHaveLength(0);
  });

  it('compresses long positive-volume weekend runs from broker gap-fill candles', () => {
    const previous = candle(utcSeconds(2026, 6, 19, 22), 1.31, 1.32, 1.30, 1.315);
    const closedRun = Array.from({ length: 48 }, (_, index) => (
      candle(
        utcSeconds(2026, 6, 19, 23) + (index * 60 * 60),
        1.315 + (index % 3) * 0.0001,
        1.316 + (index % 2) * 0.0001,
        1.314,
        1.315 + (index % 4) * 0.0001,
        12,
      )
    ));
    const reopen = candle(utcSeconds(2026, 6, 21, 23), 1.316, 1.321, 1.314, 1.319);

    const result = buildMarketClosedGapSeries([previous, ...closedRun, reopen], {
      symbol: 'GBPUSD',
      timeframe: 'H1',
    });

    expect(result.candles).toEqual([previous, reopen]);
    expect(result.gaps).toEqual([
      {
        startTime: previous.time,
        endTime: reopen.time,
        markerTime: reopen.time - (60 * 60),
        price: closedRun[0].close,
        hiddenCandles: 48,
      },
    ]);
  });

  it('compresses a Friday close to Sunday reopen weekend run for H1 forex charts', () => {
    const previous = candle(utcSeconds(2026, 6, 26, 22), 1.10, 1.11, 1.09, 1.105);
    const closedRun = flatCandles(utcSeconds(2026, 6, 26, 23), 48, 1.105, 60 * 60);
    const reopen = candle(utcSeconds(2026, 6, 28, 23), 1.106, 1.108, 1.104, 1.107);

    const result = buildMarketClosedGapSeries([previous, ...closedRun, reopen], {
      symbol: 'EURUSD',
      timeframe: 'H1',
    });

    expect(result.candles).toEqual([previous, reopen]);
    expect(result.gaps).toEqual([
      {
        startTime: previous.time,
        endTime: reopen.time,
        markerTime: reopen.time - (60 * 60),
        price: 1.105,
        hiddenCandles: 48,
      },
    ]);
  });

  it('hides near-flat zero-volume H1 weekend placeholders from broker gap-fill candles', () => {
    const previous = candle(utcSeconds(2026, 6, 26, 20), 4010, 4040, 4000, 4055);
    const closedRun = Array.from({ length: 44 }, (_, index) => (
      candle(
        utcSeconds(2026, 6, 27) + (index * 60 * 60),
        4088.120,
        4088.122,
        4088.119,
        4088.121,
        0,
      )
    ));
    const reopen = candle(utcSeconds(2026, 6, 28, 23), 4065, 4070, 4050, 4060);

    const result = buildMarketClosedGapSeries([previous, ...closedRun, reopen], {
      symbol: 'XAUUSD',
      timeframe: 'H1',
    });

    expect(result.candles).toEqual([previous, reopen]);
    expect(result.gaps).toHaveLength(1);
    expect(result.gaps[0].endTime).toBe(reopen.time);
  });

  it('leaves crypto weekend candles untouched', () => {
    const previous = candle(utcSeconds(2026, 6, 26, 20, 59), 64000, 64100, 63950, 64025);
    const closedRun = flatCandles(utcSeconds(2026, 6, 26, 21, 0), 48 * 60, 64025);
    const next = candle(utcSeconds(2026, 6, 28, 21, 0), 64100, 64200, 64000, 64150);
    const candles = [previous, ...closedRun, next];

    const result = buildMarketClosedGapSeries(candles, {
      symbol: 'BTCUSD',
      timeframe: 'M1',
    });

    expect(result.candles).toHaveLength(candles.length);
    expect(result.gaps).toHaveLength(0);
  });

  it('keeps short weekday flat runs because they can be real quiet trading', () => {
    const previous = candle(utcSeconds(2026, 6, 24, 10, 0), 1.31, 1.32, 1.30, 1.315);
    const quietRun = flatCandles(utcSeconds(2026, 6, 24, 10, 1), 10, 1.315, 60, 1);
    const next = candle(utcSeconds(2026, 6, 24, 10, 11), 1.315, 1.316, 1.314, 1.3155);
    const candles = [previous, ...quietRun, next];

    const result = buildMarketClosedGapSeries(candles, {
      symbol: 'GBPUSD',
      timeframe: 'M1',
    });

    expect(result.candles).toHaveLength(candles.length);
    expect(result.gaps).toHaveLength(0);
  });

  it('does not hide daily candles', () => {
    const previous = candle(utcSeconds(2026, 6, 26), 1.31, 1.32, 1.30, 1.315);
    const weekend = candle(utcSeconds(2026, 6, 27), 1.315, 1.315, 1.315, 1.315);
    const next = candle(utcSeconds(2026, 6, 28), 1.315, 1.316, 1.314, 1.3155);

    const result = buildMarketClosedGapSeries([previous, weekend, next], {
      symbol: 'GBPUSD',
      timeframe: 'D1',
    });

    expect(result.candles).toEqual([previous, weekend, next]);
    expect(result.gaps).toHaveLength(0);
  });
});
