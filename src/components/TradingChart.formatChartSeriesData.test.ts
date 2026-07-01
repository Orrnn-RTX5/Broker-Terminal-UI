import { describe, expect, it } from 'vitest';
import { defaultChartProperties } from '../store/useChartSettingsStore';
import {
  formatChartSeriesData,
  getLeftVisibleTimeFromLogicalRange,
  getRenderedPrependedBarCount,
  getVisibleLogicalRangeAnchoredToTime,
  isPotentialMarketClosedPlaceholderCandle,
  shouldRecomputeMarketGapSeparatorsForCandle,
  shouldRestoreProtectedHistoryForFullRender,
  TRADING_CHART_TIME_SCALE_LIVE_SHIFT_OPTIONS,
} from './TradingChart.helpers';

const utcSeconds = (year: number, month: number, day: number, hour = 0, minute = 0) =>
  Date.UTC(year, month - 1, day, hour, minute) / 1000;

const theme = {
  background: '#0e0e12',
  text: '#ffffff',
  axisText: '#ffffff',
  grid: 'rgba(255,255,255,0.15)',
  scaleBorder: 'rgba(255,255,255,0.24)',
  crosshair: 'rgba(255,255,255,0.58)',
  candleUp: '#10B981',
  candleDown: '#EF4444',
  barUp: '#10B981',
  barDown: '#EF4444',
  wickUp: '#10B981',
  wickDown: '#EF4444',
  line: '#10B981',
  areaTop: 'rgba(16,185,129,0.22)',
  areaBottom: 'rgba(16,185,129,0)',
  volumeUp: 'rgba(16,185,129,0.28)',
  volumeDown: 'rgba(239,68,68,0.28)',
};

const realCandle = (time: number, close: number) => ({
  time,
  open: close - 0.0002,
  high: close + 0.0004,
  low: close - 0.0004,
  close,
  volume: 100,
  tickVolume: 100,
  realVolume: 100,
});

const placeholderCandle = (time: number, price: number) => ({
  time,
  open: price,
  high: price,
  low: price,
  close: price,
  volume: 0,
  tickVolume: 0,
  realVolume: 0,
});

const placeholderRun = (startTime: number, count: number, stepSeconds: number, price: number) =>
  Array.from({ length: count }, (_, index) => placeholderCandle(startTime + index * stepSeconds, price));

const closedSessionRun = (
  startTime: number,
  count: number,
  stepSeconds: number,
  price: number,
) => (
  Array.from({ length: count }, (_, index) => ({
    time: startTime + index * stepSeconds,
    open: price + (index % 3) * 0.0001,
    high: price + 0.0004 + (index % 2) * 0.0001,
    low: price - 0.0004,
    close: price + (index % 4) * 0.0001,
    volume: 12,
    tickVolume: 12,
    realVolume: 12,
  }))
);

describe('formatChartSeriesData market gap separators', () => {
  it('disables implicit live new-bar viewport shifting for M1 charts', () => {
    expect(TRADING_CHART_TIME_SCALE_LIVE_SHIFT_OPTIONS).toEqual({
      shiftVisibleRangeOnNewBar: false,
      allowShiftVisibleRangeOnWhitespaceReplacement: false,
    });
  });

  it('restores protected history before a tiny live batch can replace it on any timeframe', () => {
    expect(shouldRestoreProtectedHistoryForFullRender({
      activeTimeframe: 'M1',
      incomingCount: 3,
      protectedCount: 120,
      resetVisibleRange: false,
      defaultVisibleBars: 30,
    })).toBe(true);

    expect(shouldRestoreProtectedHistoryForFullRender({
      activeTimeframe: 'M1',
      incomingCount: 3,
      protectedCount: 120,
      resetVisibleRange: true,
      defaultVisibleBars: 30,
    })).toBe(false);

    expect(shouldRestoreProtectedHistoryForFullRender({
      activeTimeframe: 'M5',
      incomingCount: 3,
      protectedCount: 120,
      resetVisibleRange: false,
      defaultVisibleBars: 30,
    })).toBe(true);
  });

  it('anchors viewport preservation to the previous left visible candle time', () => {
    const candles = [100, 160, 220, 280, 340, 400].map(time => ({ time }));

    expect(getVisibleLogicalRangeAnchoredToTime(
      candles,
      280,
      { from: 1, to: 4 },
    )).toEqual({ from: 3, to: 6 });
  });

  it('derives the left visible time from the last rendered data before history prepends', () => {
    const previouslyRenderedCandles = [100, 160, 220, 280].map(time => ({ time }));
    const nextRenderedCandles = [20, 80, ...previouslyRenderedCandles.map(candle => candle.time)]
      .map(time => ({ time }));
    const previousRange = { from: 1, to: 3 };

    const leftVisibleTime = getLeftVisibleTimeFromLogicalRange(
      previouslyRenderedCandles,
      previousRange,
    );

    expect(leftVisibleTime).toBe(160);
    expect(getVisibleLogicalRangeAnchoredToTime(
      nextRenderedCandles,
      leftVisibleTime,
      previousRange,
    )).toEqual({ from: 3, to: 5 });
  });

  it('compresses hidden market-gap candles without adding synthetic whitespace for short rendered gaps', () => {
    const previousTime = utcSeconds(2026, 6, 26, 22, 0);
    const nextTime = utcSeconds(2026, 6, 28, 23, 0);
    const result = formatChartSeriesData(
      [
        realCandle(previousTime, 1.1000),
        ...placeholderRun(utcSeconds(2026, 6, 26, 22, 15), 195, 15 * 60, 1.1000),
        realCandle(nextTime, 1.1010),
      ],
      'candlestick',
      theme,
      defaultChartProperties,
      { symbol: 'EURUSD', timeframe: 'M15', brokerOffsetSeconds: 0 },
    );

    expect(result.sortedCandles.map(candle => candle.time)).toEqual([previousTime, nextTime]);
    expect(result.seriesData.map(datum => Number(datum.time))).toEqual([previousTime, nextTime]);
    expect(result.periodSeparators).toEqual([
      { time: nextTime, index: 1, type: 'session_gap' },
    ]);
  });

  it('adds one session_gap at the first real candle after a qualifying hidden market gap', () => {
    const previousTime = utcSeconds(2026, 6, 26, 22, 0);
    const nextTime = utcSeconds(2026, 6, 28, 23, 0);
    const result = formatChartSeriesData(
      [
        realCandle(previousTime, 1.1000),
        ...placeholderRun(utcSeconds(2026, 6, 26, 22, 15), 195, 15 * 60, 1.1000),
        realCandle(nextTime, 1.1010),
      ],
      'candlestick',
      theme,
      defaultChartProperties,
      { symbol: 'EURUSD', timeframe: 'M15', brokerOffsetSeconds: 0 },
    );

    expect(result.periodSeparators).toEqual([
      { time: nextTime, index: 1, type: 'session_gap' },
    ]);
  });

  it('compresses a weekend closure and keeps the reopen plus next-midnight separators', () => {
    const previousTime = utcSeconds(2026, 6, 26, 22, 0);
    const saturdayMidnight = utcSeconds(2026, 6, 27, 0, 0);
    const reopenTime = utcSeconds(2026, 6, 28, 23, 0);
    const mondayMidnight = utcSeconds(2026, 6, 29, 0, 0);
    const result = formatChartSeriesData(
      [
        realCandle(previousTime, 1.1000),
        ...placeholderRun(utcSeconds(2026, 6, 26, 23, 0), 48, 60 * 60, 1.1000),
        realCandle(reopenTime, 1.1010),
        realCandle(mondayMidnight, 1.1015),
      ],
      'candlestick',
      theme,
      defaultChartProperties,
      { symbol: 'EURUSD', timeframe: 'H1', brokerOffsetSeconds: 0 },
    );

    expect(result.sortedCandles.map(candle => candle.time)).toEqual([
      previousTime,
      reopenTime,
      mondayMidnight,
    ]);
    expect(result.seriesData.map(datum => Number(datum.time))).toEqual([
      previousTime,
      reopenTime,
      mondayMidnight,
    ]);
    expect(result.volumeData.map(datum => Number(datum.time))).toEqual([
      previousTime,
      reopenTime,
      mondayMidnight,
    ]);
    expect(result.periodSeparators).toEqual([
      { time: reopenTime, index: 1, type: 'session_gap' },
      { time: mondayMidnight, index: 2, type: 'day' },
    ]);
    expect(result.seriesData.some(datum => Number(datum.time) === saturdayMidnight)).toBe(false);
    expect(result.periodSeparators.some(separator => separator.time === saturdayMidnight)).toBe(false);
  });

  it('compresses the 20/21 weekend even when broker gap-fill candles have bodies and volume', () => {
    const previousTime = utcSeconds(2026, 6, 19, 22, 0);
    const saturdayMidnight = utcSeconds(2026, 6, 20, 0, 0);
    const sundayMidnight = utcSeconds(2026, 6, 21, 0, 0);
    const reopenTime = utcSeconds(2026, 6, 21, 23, 0);
    const mondayMidnight = utcSeconds(2026, 6, 22, 0, 0);
    const result = formatChartSeriesData(
      [
        realCandle(previousTime, 1.3150),
        ...closedSessionRun(utcSeconds(2026, 6, 19, 23, 0), 48, 60 * 60, 1.3150),
        realCandle(reopenTime, 1.3190),
        realCandle(mondayMidnight, 1.3195),
      ],
      'candlestick',
      theme,
      defaultChartProperties,
      { symbol: 'GBPUSD', timeframe: 'H1', brokerOffsetSeconds: 0 },
    );

    expect(result.sortedCandles.map(candle => candle.time)).toEqual([
      previousTime,
      reopenTime,
      mondayMidnight,
    ]);
    expect(result.seriesData.map(datum => Number(datum.time))).toEqual([
      previousTime,
      reopenTime,
      mondayMidnight,
    ]);
    expect(result.periodSeparators).toEqual([
      { time: reopenTime, index: 1, type: 'session_gap' },
      { time: mondayMidnight, index: 2, type: 'day' },
    ]);
    expect(result.seriesData.some(datum => Number(datum.time) === saturdayMidnight)).toBe(false);
    expect(result.seriesData.some(datum => Number(datum.time) === sundayMidnight)).toBe(false);
    expect(result.periodSeparators.some(separator => (
      separator.time === saturdayMidnight ||
      separator.time === sundayMidnight
    ))).toBe(false);
  });

  it.each([
    { timeframe: 'M1', start: utcSeconds(2026, 6, 19, 22, 1), count: 2939, step: 60 },
    { timeframe: 'M5', start: utcSeconds(2026, 6, 19, 22, 5), count: 587, step: 5 * 60 },
  ])('keeps only reopen and next-day separators for $timeframe around the 20/21 weekend', ({ timeframe, start, count, step }) => {
    const previousTime = utcSeconds(2026, 6, 19, 22, 0);
    const saturdayMidnight = utcSeconds(2026, 6, 20, 0, 0);
    const sundayMidnight = utcSeconds(2026, 6, 21, 0, 0);
    const reopenTime = utcSeconds(2026, 6, 21, 23, 0);
    const mondayMidnight = utcSeconds(2026, 6, 22, 0, 0);

    const result = formatChartSeriesData(
      [
        realCandle(previousTime, 1.3150),
        ...closedSessionRun(start, count, step, 1.3150),
        realCandle(reopenTime, 1.3190),
        realCandle(mondayMidnight, 1.3195),
      ],
      'candlestick',
      theme,
      defaultChartProperties,
      { symbol: 'XAUUSD', timeframe, brokerOffsetSeconds: 0 },
    );

    expect(result.seriesData.map(datum => Number(datum.time))).toEqual([
      previousTime,
      reopenTime,
      mondayMidnight,
    ]);
    expect(result.periodSeparators).toEqual([
      { time: reopenTime, index: 1, type: 'session_gap' },
      { time: mondayMidnight, index: 2, type: 'day' },
    ]);
    expect(result.periodSeparators.some(separator => (
      separator.time === saturdayMidnight ||
      separator.time === sundayMidnight
    ))).toBe(false);
  });

  it('flags the live first real candle after hidden placeholders for separator recomputation', () => {
    const previousTime = utcSeconds(2026, 6, 26, 22, 0);
    const nextTime = utcSeconds(2026, 6, 28, 23, 0);
    const firstRealAfterGap = realCandle(nextTime, 1.1010);
    const candles = [
      realCandle(previousTime, 1.1000),
      ...placeholderRun(utcSeconds(2026, 6, 26, 22, 15), 195, 15 * 60, 1.1000),
      firstRealAfterGap,
    ];

    expect(shouldRecomputeMarketGapSeparatorsForCandle(
      candles,
      firstRealAfterGap,
      { symbol: 'EURUSD', timeframe: 'M15', brokerOffsetSeconds: 0 },
    )).toBe(true);
  });

  it('formats the compressed hidden-gap series and volume data for the recompute candle', () => {
    const previousTime = utcSeconds(2026, 6, 26, 22, 0);
    const nextTime = utcSeconds(2026, 6, 28, 23, 0);
    const firstRealAfterGap = realCandle(nextTime, 1.1010);
    const candles = [
      realCandle(previousTime, 1.1000),
      ...placeholderRun(utcSeconds(2026, 6, 26, 22, 15), 195, 15 * 60, 1.1050),
      firstRealAfterGap,
    ];

    expect(shouldRecomputeMarketGapSeparatorsForCandle(
      candles,
      firstRealAfterGap,
      { symbol: 'EURUSD', timeframe: 'M15', brokerOffsetSeconds: 0 },
    )).toBe(true);

    const result = formatChartSeriesData(
      candles,
      'candlestick',
      theme,
      defaultChartProperties,
      { symbol: 'EURUSD', timeframe: 'M15', brokerOffsetSeconds: 0 },
    );

    expect(result.sortedCandles.map(candle => candle.time)).toEqual([previousTime, nextTime]);
    expect(result.seriesData.map(datum => Number(datum.time))).toEqual([previousTime, nextTime]);
    expect(result.volumeData.map(datum => Number(datum.time))).toEqual([previousTime, nextTime]);
    expect(result.periodSeparators).toEqual([
      { time: nextTime, index: 1, type: 'session_gap' },
    ]);
  });

  it('does not flag normal new candles for market-gap separator recomputation', () => {
    const nextCandle = realCandle(utcSeconds(2026, 6, 26, 20, 15), 1.1010);

    expect(shouldRecomputeMarketGapSeparatorsForCandle(
      [
        realCandle(utcSeconds(2026, 6, 26, 20, 0), 1.1000),
        nextCandle,
      ],
      nextCandle,
      { symbol: 'EURUSD', timeframe: 'M15', brokerOffsetSeconds: 0 },
    )).toBe(false);
  });

  it('treats weekend flat placeholders as market-closed even when price differs from the previous close', () => {
    expect(isPotentialMarketClosedPlaceholderCandle(
      placeholderCandle(utcSeconds(2026, 6, 27), 4088),
      { symbol: 'XAUUSD', timeframe: 'H1', brokerOffsetSeconds: 0 },
    )).toBe(true);
  });

  it('counts only rendered prepended bars for viewport preservation after gap compression', () => {
    const previousFirstRenderedTime = utcSeconds(2026, 6, 21, 23, 0);
    const result = formatChartSeriesData(
      [
        realCandle(utcSeconds(2026, 6, 19, 22, 0), 1.3150),
        ...closedSessionRun(utcSeconds(2026, 6, 19, 23, 0), 48, 60 * 60, 1.3150),
        realCandle(previousFirstRenderedTime, 1.3190),
        realCandle(utcSeconds(2026, 6, 22, 0, 0), 1.3195),
      ],
      'candlestick',
      theme,
      defaultChartProperties,
      { symbol: 'GBPUSD', timeframe: 'H1', brokerOffsetSeconds: 0 },
    );

    expect(getRenderedPrependedBarCount(
      result.sortedCandles,
      previousFirstRenderedTime,
      49,
    )).toBe(1);
  });
});
