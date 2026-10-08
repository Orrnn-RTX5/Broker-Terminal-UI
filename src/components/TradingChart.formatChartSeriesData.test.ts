import { describe, expect, it } from 'vitest';
import {
  defaultChartProperties,
  getEffectiveChartColors,
  getPresetSchemeColors,
} from '../store/useChartSettingsStore';
import {
  formatChartSeriesData,
  getAreaTrendDirection,
  getAreaTrendSeriesOptions,
  getLeftVisibleTimeFromLogicalRange,
  getLivePriceOverlayColors,
  getLivePriceSeriesColor,
  isCandleAtOrBeforeFinalizedTime,
  markFinalizedCandleTime,
  getRenderedPrependedBarCount,
  getVisibleLogicalRangeAnchoredToTime,
  isPotentialMarketClosedPlaceholderCandle,
  LIVE_PRICE_SCALE_WIDTH_FALLBACK_PX,
  resolveCandleFinalityFromActivePeriod,
  resolveLivePriceScaleWidth,
  shouldRecomputeMarketGapSeparatorsForCandle,
  shouldApplyVisibleRangeResetForRender,
  shouldResetInitialHistoryVisibleRange,
  shouldRestoreProtectedHistoryForFullRender,
  TRADING_CHART_TIME_SCALE_LIVE_SHIFT_OPTIONS,
  type Candle,
} from './TradingChart.helpers';

const utcSeconds = (year: number, month: number, day: number, hour = 0, minute = 0) =>
  Date.UTC(year, month - 1, day, hour, minute) / 1000;

const theme = {
  background: '#0e0e12',
  text: '#ffffff',
  axisText: '#ffffff',
  gridVertical: 'rgba(255,255,255,0.102)',
  gridHorizontal: 'rgba(255,255,255,0.135)',
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
  areaUpLine: '#10B981',
  areaUpTop: 'rgba(16,185,129,0.28)',
  areaUpBottom: 'rgba(16,185,129,0)',
  areaDownLine: '#EF4444',
  areaDownTop: 'rgba(239,68,68,0.28)',
  areaDownBottom: 'rgba(239,68,68,0)',
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

describe('TradingChart live candle finality helpers', () => {
  it('infers legacy finality from the active broker period without overriding an explicit flag', () => {
    const legacyClosed: Candle = realCandle(60, 1.1);
    const legacyForming: Candle = realCandle(120, 1.2);
    const explicitForming = { ...legacyClosed, closed: false };

    expect(resolveCandleFinalityFromActivePeriod(legacyClosed, 120).closed).toBe(true);
    expect(resolveCandleFinalityFromActivePeriod(legacyForming, 120).closed).toBe(false);
    expect(resolveCandleFinalityFromActivePeriod(explicitForming, 120)).toBe(explicitForming);
  });

  it('seals finalized candle times independently for each displayed timeframe', () => {
    const finalizedByTimeframe = new Map<string, number>();
    markFinalizedCandleTime(finalizedByTimeframe, 'M1', 240);

    expect(isCandleAtOrBeforeFinalizedTime(finalizedByTimeframe, 'M1', 240)).toBe(true);
    expect(isCandleAtOrBeforeFinalizedTime(finalizedByTimeframe, 'M1', 300)).toBe(false);
    expect(isCandleAtOrBeforeFinalizedTime(finalizedByTimeframe, 'M5', 0)).toBe(false);

    markFinalizedCandleTime(finalizedByTimeframe, 'M5', 300);
    expect(isCandleAtOrBeforeFinalizedTime(finalizedByTimeframe, 'M5', 300)).toBe(true);
    expect(isCandleAtOrBeforeFinalizedTime(finalizedByTimeframe, 'M1', 300)).toBe(false);
  });
});

describe('formatChartSeriesData chart types', () => {
  it('maps Area to the same close-value data contract as Line', () => {
    const candles = [
      realCandle(100, 1.1050),
      realCandle(160, 1.1075),
    ];

    const areaResult = formatChartSeriesData(
      candles,
      'area',
      theme,
      defaultChartProperties,
      undefined,
      { includeVolumeData: false },
    );
    const lineResult = formatChartSeriesData(
      candles,
      'line',
      theme,
      defaultChartProperties,
      undefined,
      { includeVolumeData: false },
    );

    expect(areaResult.seriesData).toEqual([
      { time: 100, value: 1.1050 },
      { time: 160, value: 1.1075 },
    ]);
    expect(areaResult.seriesData).toEqual(lineResult.seriesData);
  });

  it('keeps corrupt cached candles out of the rendered price scale', () => {
    const validBefore = { ...realCandle(100, 4380), open: 4379, high: 4382, low: 4378 };
    const validAfter = { ...realCandle(280, 4381), open: 4380, high: 4383, low: 4379 };
    const result = formatChartSeriesData(
      [
        validBefore,
        { time: 160, open: 0, high: 0, low: 0, close: 0, volume: 1 },
        { time: 220, open: 280000, high: 281000, low: 279000, close: 280500, volume: 1 },
        validAfter,
      ],
      'candlestick',
      theme,
      defaultChartProperties,
    );

    expect(result.sortedCandles).toEqual([validBefore, validAfter]);
    expect(result.seriesData).toEqual([
      { time: 100, open: 4379, high: 4382, low: 4378, close: 4380 },
      { time: 280, open: 4380, high: 4383, low: 4379, close: 4381 },
    ]);
  });
});

describe('TradingView-style area trend coloring', () => {
  const bar = (time: number, close: number, open = close) => ({ time, open, close });

  it('colors by the daily change against the previous day close', () => {
    const candles = [
      bar(utcSeconds(2026, 9, 21, 10), 1.10),
      bar(utcSeconds(2026, 9, 21, 23), 1.12), // previous daily close
      bar(utcSeconds(2026, 9, 22, 9), 1.13),
      bar(utcSeconds(2026, 9, 22, 10), 1.14),
    ];
    expect(getAreaTrendDirection(candles)).toBe('up');

    const falling = [
      bar(utcSeconds(2026, 9, 21, 23), 1.12),
      bar(utcSeconds(2026, 9, 22, 9), 1.11),
    ];
    expect(getAreaTrendDirection(falling)).toBe('down');
    expect(getAreaTrendDirection([])).toBe(null);
  });

  it('treats an unchanged price as up, matching the TradingView symbol page', () => {
    const candles = [
      bar(utcSeconds(2026, 9, 21, 23), 1.10),
      bar(utcSeconds(2026, 9, 22, 9), 1.10),
    ];
    expect(getAreaTrendDirection(candles)).toBe('up');
  });

  it('respects the broker time offset when finding the day boundary', () => {
    // Broker day starts 3 hours before UTC midnight. A 22:30 UTC candle on the
    // 21st already belongs to the broker's 22nd, so the previous daily close
    // is the 20:30 UTC candle, not the 22:30 one.
    const offset = 3 * 60 * 60;
    const candles = [
      bar(utcSeconds(2026, 9, 21, 20, 30), 1.20),
      bar(utcSeconds(2026, 9, 21, 22, 30), 1.10),
      bar(utcSeconds(2026, 9, 22, 9), 1.15),
    ];
    expect(getAreaTrendDirection(candles, offset)).toBe('down');
    expect(getAreaTrendDirection(candles, 0)).toBe('up');
  });

  it('falls back to the day-open when history does not reach the previous session', () => {
    const candles = [
      bar(utcSeconds(2026, 9, 22, 9), 1.13, 1.12),
      bar(utcSeconds(2026, 9, 22, 10), 1.11),
    ];
    expect(getAreaTrendDirection(candles)).toBe('down');
    expect(getAreaTrendDirection([bar(utcSeconds(2026, 9, 22, 9), 1.14, 1.12)])).toBe('up');
  });

  it('lets the live tick close override the last rendered candle', () => {
    const candles = [
      bar(utcSeconds(2026, 9, 21, 23), 1.12),
      bar(utcSeconds(2026, 9, 22, 9), 1.14),
    ];
    expect(getAreaTrendDirection(candles, 0, 1.05)).toBe('down');
    expect(getAreaTrendDirection(candles, 0, 1.16)).toBe('up');
  });

  it('scopes the change period to the timeframe like the TradingView range buttons', () => {
    const candles = [
      bar(utcSeconds(2026, 9, 17, 22), 1.00),
      bar(utcSeconds(2026, 9, 19, 22), 1.50),
      bar(utcSeconds(2026, 9, 22, 9), 1.20),
    ];
    // M1 → 1-day change (loss vs the 1.50 previous close), M5 → 5-day change
    // (profit vs the 1.00 close from five days back).
    expect(getAreaTrendDirection(candles, 0, undefined, 'M1')).toBe('down');
    expect(getAreaTrendDirection(candles, 0, undefined, 'M5')).toBe('up');
  });

  it('colors daily charts by the one-year change', () => {
    const candles = [
      bar(utcSeconds(2025, 9, 10), 100),
      bar(utcSeconds(2026, 3, 2), 140),
      bar(utcSeconds(2026, 9, 21), 120),
    ];
    expect(getAreaTrendDirection(candles, 0, undefined, 'D1')).toBe('up');
    expect(getAreaTrendDirection(candles, 0, undefined, 'M1')).toBe('down');
  });

  it('uses a five-year change period on weekly charts, falling back to loaded history', () => {
    const candles = [
      bar(utcSeconds(2020, 9, 7), 1.00),
      bar(utcSeconds(2024, 1, 5), 2.00),
      bar(utcSeconds(2026, 9, 21), 1.50),
    ];
    expect(getAreaTrendDirection(candles, 0, undefined, 'W1')).toBe('up');

    const shortHistory = [
      bar(utcSeconds(2026, 9, 14), 1.40, 1.60),
      bar(utcSeconds(2026, 9, 21), 1.50),
    ];
    expect(getAreaTrendDirection(shortHistory, 0, undefined, 'W1')).toBe('down');
  });

  it('maps trend direction to the themed line and gradient colors', () => {
    expect(getAreaTrendSeriesOptions(theme, 'up')).toEqual({
      lineColor: theme.areaUpLine,
      topColor: theme.areaUpTop,
      bottomColor: theme.areaUpBottom,
    });
    expect(getAreaTrendSeriesOptions(theme, 'down')).toEqual({
      lineColor: theme.areaDownLine,
      topColor: theme.areaDownTop,
      bottomColor: theme.areaDownBottom,
    });
  });
});

describe('formatChartSeriesData market gap separators', () => {
  it('keeps the visible right edge during wheel zoom without implicit live-bar shifting', () => {
    expect(TRADING_CHART_TIME_SCALE_LIVE_SHIFT_OPTIONS).toEqual({
      shiftVisibleRangeOnNewBar: false,
      allowShiftVisibleRangeOnWhitespaceReplacement: false,
      uniformDistribution: true,
      rightBarStaysOnScroll: true,
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

  it('does not time-anchor sparse startup ranges that begin before the first candle', () => {
    const mnCandles = [utcSeconds(2026, 5, 1)].map(time => ({ time }));
    const sparseStartupRange = { from: -4, to: 1.5 };

    const leftVisibleTime = getLeftVisibleTimeFromLogicalRange(
      mnCandles,
      sparseStartupRange,
    );

    expect(leftVisibleTime).toBeNull();
    expect(getVisibleLogicalRangeAnchoredToTime(
      mnCandles,
      leftVisibleTime,
      sparseStartupRange,
    )).toBeNull();
  });

  it('suppresses global visible-range resets for background backfill renders', () => {
    expect(shouldApplyVisibleRangeResetForRender({
      resetVisibleRange: false,
      resetVisibleRangeOnNextData: true,
      suppressGlobalVisibleRangeReset: true,
    })).toBe(false);

    expect(shouldApplyVisibleRangeResetForRender({
      resetVisibleRange: true,
      resetVisibleRangeOnNextData: true,
      suppressGlobalVisibleRangeReset: true,
    })).toBe(true);

    expect(shouldApplyVisibleRangeResetForRender({
      resetVisibleRange: false,
      resetVisibleRangeOnNextData: true,
      suppressGlobalVisibleRangeReset: false,
    })).toBe(true);
  });

  it('re-applies the latest-candle viewport when uncached history follows a sparse live paint', () => {
    expect(shouldResetInitialHistoryVisibleRange({
      resetVisibleRangeOnNextData: false,
      hydratedFromCache: false,
    })).toBe(true);

    expect(shouldResetInitialHistoryVisibleRange({
      resetVisibleRangeOnNextData: false,
      hydratedFromCache: true,
    })).toBe(false);

    expect(shouldResetInitialHistoryVisibleRange({
      resetVisibleRangeOnNextData: true,
      hydratedFromCache: true,
    })).toBe(true);
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

  it.each([
    ['M1', '2026-10-06T23:59:00Z', '2026-10-07T00:00:00Z', 'day', 0],
    ['M5', '2026-10-06T23:55:00Z', '2026-10-07T00:00:00Z', 'day', 0],
    ['M15', '2026-10-06T23:45:00Z', '2026-10-07T00:00:00Z', 'day', 0],
    ['M30', '2026-10-06T23:30:00Z', '2026-10-07T00:00:00Z', 'day', 0],
    ['H1', '2026-10-06T23:00:00Z', '2026-10-07T00:00:00Z', 'day', 0],
    ['H4', '2026-10-04T20:00:00Z', '2026-10-05T00:00:00Z', 'week', 0],
    ['D1', '2026-10-31T00:00:00Z', '2026-11-01T00:00:00Z', 'month', 0],
    ['W1', '2026-12-28T00:00:00Z', '2027-01-04T00:00:00Z', 'year', 0],
    ['MN', '2026-12-01T00:00:00Z', '2027-01-01T00:00:00Z', 'year', 0],
    ['M1', '2026-10-06T21:59:00Z', '2026-10-06T22:00:00Z', 'day', 7200],
  ] as const)('refreshes %s separators at a live period boundary', (timeframe, previous, next, type, brokerOffsetSeconds) => {
    const candles = [realCandle(Date.parse(previous) / 1000, 100), realCandle(Date.parse(next) / 1000, 101)];
    const options = { symbol: 'BTCUSD', timeframe, brokerOffsetSeconds };
    expect(shouldRecomputeMarketGapSeparatorsForCandle(candles, candles[1], options)).toBe(true);
    expect(formatChartSeriesData(candles, 'candlestick', theme, defaultChartProperties, options).periodSeparators).toEqual([
      { time: candles[1].time, index: 1, type },
    ]);
  });

  it('keeps H4 daily changes and data gaps within the week free of separators', () => {
    const candles = [realCandle(utcSeconds(2026, 10, 5), 100), realCandle(utcSeconds(2026, 10, 6, 12), 101)];
    const options = { symbol: 'BTCUSD', timeframe: 'H4' as const, brokerOffsetSeconds: 0 };
    expect(formatChartSeriesData(candles, 'candlestick', theme, defaultChartProperties, options).periodSeparators).toEqual([]);
    expect(shouldRecomputeMarketGapSeparatorsForCandle(candles, candles[1], options)).toBe(false);
  });

  it('does not flag normal new candles within a period for separator recomputation', () => {
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

describe('live price scale geometry', () => {
  it('adopts every valid current price-scale width instead of freezing the first measurement', () => {
    expect(resolveLivePriceScaleWidth(76, 58)).toBe(76);
    expect(resolveLivePriceScaleWidth(64, 76)).toBe(64);
  });

  it('uses the last valid width only while the chart reports a transient invalid measurement', () => {
    expect(resolveLivePriceScaleWidth(0, 76)).toBe(76);
    expect(resolveLivePriceScaleWidth(Number.NaN, 76)).toBe(76);
    expect(resolveLivePriceScaleWidth(0, null)).toBe(LIVE_PRICE_SCALE_WIDTH_FALLBACK_PX);
  });
});

describe('live price overlay colors', () => {
  it('keeps the dim light Green on Black price labels aligned with readable candle hues', () => {
    const colors = getEffectiveChartColors({
      colorScheme: 'Green on Black',
      colors: getPresetSchemeColors('Green on Black'),
    }, { isAdvancedUntitledLight: true });

    expect(getLivePriceOverlayColors(colors, colors.bullCandle, true)).toEqual({
      lineColor: '#087f6c', badgeBackground: '#087f6c', badgeTextColor: '#ffffff',
    });
    expect(getLivePriceOverlayColors(colors, colors.bearCandle, true)).toEqual({
      lineColor: '#ce2938', badgeBackground: '#ce2938', badgeTextColor: '#ffffff',
    });
    // Reusing a candle hue in a saved custom scheme must not opt that scheme
    // into the default light label palette.
    expect(getLivePriceOverlayColors(colors, '#dc2626')).toEqual({
      lineColor: '#dc2626', badgeBackground: '#dc2626', badgeTextColor: '#ffffff',
    });
  });

  it.each([
    { mode: 'dark', light: false, up: '#4597ff', down: '#ff5858' },
    { mode: 'light', light: true, up: '#1746bc', down: '#a51f26' },
  ])('uses the default quote direction colors for price lines and badges in $mode mode', ({ light, up, down }) => {
    const colors = getEffectiveChartColors(defaultChartProperties, { isAdvancedUntitledLight: light });

    expect(getLivePriceOverlayColors(colors, colors.bullCandle, light)).toMatchObject({
      lineColor: up, badgeBackground: up,
    });
    expect(getLivePriceOverlayColors(colors, colors.bearCandle, light)).toMatchObject({
      lineColor: down, badgeBackground: down,
    });
  });

  it('takes the live price color from the series that is actually rendered', () => {
    const colors = {
      ...defaultChartProperties.colors,
      bullCandle: '#11aa77',
      bearCandle: '#dd4455',
      barUp: '#228866',
      barDown: '#bb3344',
      lineChart: '#3366cc',
    };

    expect(getLivePriceSeriesColor(colors, 'candlestick', 'up')).toBe('#11aa77');
    expect(getLivePriceSeriesColor(colors, 'candlestick', 'down')).toBe('#dd4455');
    expect(getLivePriceSeriesColor(colors, 'bar', 'up')).toBe('#228866');
    expect(getLivePriceSeriesColor(colors, 'bar', 'down')).toBe('#bb3344');
    expect(getLivePriceSeriesColor(colors, 'line', 'down')).toBe('#3366cc');
    expect(getLivePriceSeriesColor(colors, 'area', 'up')).toBe('#11aa77');
    expect(getLivePriceSeriesColor(colors, 'area', 'down')).toBe('#dd4455');
  });

  it.each([
    { name: 'daily loss while the current candle rises', open: 90, close: 95, direction: 'down' as const, color: '#ff5858' },
    { name: 'daily gain while the current candle falls', open: 110, close: 105, direction: 'up' as const, color: '#4597ff' },
  ])('matches the area price badge and line to $name', ({ open, close, direction, color }) => {
    const colors = defaultChartProperties.colors;
    const candles = [
      { time: utcSeconds(2026, 9, 21, 23, 59), open: 100, close: 100 },
      { time: utcSeconds(2026, 9, 22, 11), open, close },
    ];
    const areaDirection = getAreaTrendDirection(candles, 0, close, 'M1');
    expect(areaDirection).toBe(direction);
    if (!areaDirection) throw new Error('Expected an area trend from the loaded candles');

    const areaOptions = getAreaTrendSeriesOptions({
      ...theme,
      areaUpLine: colors.bullCandle,
      areaDownLine: colors.bearCandle,
    }, areaDirection);
    const overlay = getLivePriceOverlayColors(
      colors,
      getLivePriceSeriesColor(colors, 'area', areaDirection),
    );

    expect(areaOptions.lineColor).toBe(color);
    expect(overlay.lineColor).toBe(areaOptions.lineColor);
    expect(overlay.badgeBackground).toBe(color);
  });

  it('uses Yellow on Black directional bar colors instead of the black bull candle', () => {
    const colors = getPresetSchemeColors('Yellow on Black');

    expect(getLivePriceOverlayColors(colors, colors.barUp)).toMatchObject({
      lineColor: '#facc15',
      badgeBackground: '#facc15',
      badgeTextColor: '#000000',
    });
    expect(getLivePriceOverlayColors(colors, colors.barDown).lineColor).toBe('#facc15');
    expect(getLivePriceOverlayColors(colors, colors.barUp).lineColor).not.toBe(colors.bullCandle);
  });

  it('keeps Black on White dark-mode directional live price visible on a black background', () => {
    const colors = getPresetSchemeColors('Black on White');

    expect(getLivePriceOverlayColors(colors, colors.barUp)).toMatchObject({
      lineColor: '#adadad',
      badgeBackground: '#adadad',
      badgeTextColor: '#000000',
    });
    expect(getLivePriceOverlayColors(colors, colors.barDown).lineColor).toBe('#ffffff');
    expect(getLivePriceOverlayColors(colors, colors.barUp).lineColor).not.toBe(colors.background);
  });

  it('uses readable badge text on an advanced light chart directional color', () => {
    const colors = getEffectiveChartColors({
      colorScheme: 'Yellow on Black',
      colors: getPresetSchemeColors('Yellow on Black'),
    }, { isAdvancedUntitledLight: true });

    expect(getLivePriceOverlayColors(colors, colors.barUp)).toMatchObject({
      badgeTextColor: '#ffffff',
    });
    expect(getLivePriceOverlayColors(colors, colors.barUp).badgeBackground).not.toBe(colors.foreground);
  });

  it('uses WCAG relative luminance for badge text contrast', () => {
    expect(getLivePriceOverlayColors({
      background: '#000000',
      foreground: '#ffffff',
    }, '#666666').badgeTextColor).toBe('#ffffff');
  });

  it('falls back from low-contrast custom directional live line colors', () => {
    expect(getLivePriceOverlayColors({
      background: '#000000',
      foreground: '#f8fafc',
    }, '#010101').lineColor).toBe('#f8fafc');

    expect(getLivePriceOverlayColors({
      background: '#ffffff',
      foreground: '#f8fafc',
    }, '#ffffff')).toMatchObject({
      lineColor: '#000000',
      badgeTextColor: '#ffffff',
    });
  });
});
