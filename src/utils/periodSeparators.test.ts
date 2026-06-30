import { describe, expect, it } from 'vitest';
import { getPeriodSeparators, getPeriodSeparatorTimeframeSeconds, type PeriodSeparatorCandle } from './periodSeparators';

const utcSeconds = (year: number, month: number, day: number, hour = 0, minute = 0) =>
  Date.UTC(year, month - 1, day, hour, minute) / 1000;

const candle = (time: number): PeriodSeparatorCandle => ({ time });

describe('periodSeparators', () => {
  it('parses supported separator timeframes', () => {
    expect(getPeriodSeparatorTimeframeSeconds('M1')).toBe(60);
    expect(getPeriodSeparatorTimeframeSeconds('H4')).toBe(4 * 60 * 60);
    expect(getPeriodSeparatorTimeframeSeconds('D1')).toBe(24 * 60 * 60);
    expect(getPeriodSeparatorTimeframeSeconds('unknown')).toBeNull();
  });

  it('adds day separators for intraday timeframes when broker date changes', () => {
    const candles = [
      candle(utcSeconds(2026, 6, 27, 23, 45)),
      candle(utcSeconds(2026, 6, 28, 0, 0)),
    ];

    expect(getPeriodSeparators(candles, 'M15')).toEqual([
      { time: candles[1].time, index: 1, type: 'day' },
    ]);
  });

  it('adds day separators for H1 and H4', () => {
    const h1Candles = [
      candle(utcSeconds(2026, 6, 27, 23, 0)),
      candle(utcSeconds(2026, 6, 28, 0, 0)),
    ];
    const h4Candles = [
      candle(utcSeconds(2026, 6, 27, 20, 0)),
      candle(utcSeconds(2026, 6, 28, 0, 0)),
    ];

    expect(getPeriodSeparators(h1Candles, 'H1')).toEqual([
      { time: h1Candles[1].time, index: 1, type: 'day' },
    ]);
    expect(getPeriodSeparators(h4Candles, 'H4')).toEqual([
      { time: h4Candles[1].time, index: 1, type: 'day' },
    ]);
  });

  it('adds month separators for D1 only when broker month changes', () => {
    const candles = [
      candle(utcSeconds(2026, 6, 30)),
      candle(utcSeconds(2026, 7, 1)),
    ];

    expect(getPeriodSeparators(candles, 'D1')).toEqual([
      { time: candles[1].time, index: 1, type: 'month' },
    ]);
  });

  it('adds year separators for W1 and MN only when broker year changes', () => {
    const w1Candles = [
      candle(utcSeconds(2026, 12, 28)),
      candle(utcSeconds(2027, 1, 4)),
    ];
    const mnCandles = [
      candle(utcSeconds(2026, 12, 1)),
      candle(utcSeconds(2027, 1, 1)),
    ];

    expect(getPeriodSeparators(w1Candles, 'W1')).toEqual([
      { time: w1Candles[1].time, index: 1, type: 'year' },
    ]);
    expect(getPeriodSeparators(mnCandles, 'MN')).toEqual([
      { time: mnCandles[1].time, index: 1, type: 'year' },
    ]);
  });

  it('uses session_gap priority over normal period changes', () => {
    const candles = [
      candle(utcSeconds(2026, 6, 26, 21, 0)),
      candle(utcSeconds(2026, 6, 28, 21, 0)),
    ];

    expect(getPeriodSeparators(candles, 'M1')).toEqual([
      { time: candles[1].time, index: 1, type: 'session_gap' },
    ]);
  });

  it('adds a session gap at weekend reopen and a normal day separator at the next midnight', () => {
    const candles = [
      candle(utcSeconds(2026, 6, 26, 22, 0)),
      candle(utcSeconds(2026, 6, 28, 23, 0)),
      candle(utcSeconds(2026, 6, 29, 0, 0)),
    ];

    expect(getPeriodSeparators(candles, 'H1')).toEqual([
      { time: candles[1].time, index: 1, type: 'session_gap' },
      { time: candles[2].time, index: 2, type: 'day' },
    ]);
  });

  it('requires at least twelve hours before emitting intraday session gaps', () => {
    const sparseM5Candles = [
      candle(utcSeconds(2026, 6, 27, 10, 0)),
      candle(utcSeconds(2026, 6, 27, 11, 0)),
      candle(utcSeconds(2026, 6, 27, 12, 0)),
    ];
    const twelveHourGapCandles = [
      candle(utcSeconds(2026, 6, 27, 0, 0)),
      candle(utcSeconds(2026, 6, 27, 12, 0)),
    ];

    expect(getPeriodSeparators(sparseM5Candles, 'M5')).toEqual([]);
    expect(getPeriodSeparators(twelveHourGapCandles, 'M5')).toEqual([
      { time: twelveHourGapCandles[1].time, index: 1, type: 'session_gap' },
    ]);
  });

  it('does not emit session gaps for D1 even across multi-day gaps', () => {
    const candles = [
      candle(utcSeconds(2026, 6, 26)),
      candle(utcSeconds(2026, 6, 30)),
    ];

    expect(getPeriodSeparators(candles, 'D1')).toEqual([]);
  });

  it('keeps the strict three-candle threshold for H4 session gaps', () => {
    const exactThreeBarGap = [
      candle(utcSeconds(2026, 6, 27, 0, 0)),
      candle(utcSeconds(2026, 6, 27, 12, 0)),
    ];
    const overThreeBarGap = [
      candle(utcSeconds(2026, 6, 27, 0, 0)),
      candle(utcSeconds(2026, 6, 27, 16, 0)),
    ];

    expect(getPeriodSeparators(exactThreeBarGap, 'H4')).toEqual([]);
    expect(getPeriodSeparators(overThreeBarGap, 'H4')).toEqual([
      { time: overThreeBarGap[1].time, index: 1, type: 'session_gap' },
    ]);
  });

  it('does not add separators for normal consecutive candles inside the same period', () => {
    const candles = [
      candle(utcSeconds(2026, 6, 27, 14, 0)),
      candle(utcSeconds(2026, 6, 27, 14, 5)),
      candle(utcSeconds(2026, 6, 27, 14, 10)),
    ];

    expect(getPeriodSeparators(candles, 'M5')).toEqual([]);
  });

  it('uses broker offset with UTC getters instead of local timezone', () => {
    const candles = [
      candle(utcSeconds(2026, 6, 27, 21, 59)),
      candle(utcSeconds(2026, 6, 27, 22, 0)),
    ];

    expect(getPeriodSeparators(candles, 'M1')).toEqual([]);
    expect(getPeriodSeparators(candles, 'M1', 2 * 60 * 60)).toEqual([
      { time: candles[1].time, index: 1, type: 'day' },
    ]);
  });
});
