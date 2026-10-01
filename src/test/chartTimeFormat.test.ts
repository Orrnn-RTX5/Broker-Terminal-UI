import { describe, expect, it } from 'vitest';
import { TickMarkType, type UTCTimestamp } from 'lightweight-charts';
import {
  getTradingChartDefaultRightPadBars,
  getTradingChartDefaultVisibleBars,
  getTradingChartInitialLogicalRange,
  getTradingChartShiftRightOffset,
  formatAreaPointHoverTime,
  formatTradingChartCrosshairLabel,
  formatTradingChartTickLabel,
  getTradingChartTickMarkCharacterLength,
  shouldTradingChartFooterPromoteLeftEdgeDateLabel,
} from '../utils/chartTimeFormat';

describe('chartTimeFormat', () => {
  it('formats the area-chart point card like a broker-time stamp', () => {
    const timestamp = Math.floor(Date.UTC(2026, 8, 29, 6, 8, 0, 0) / 1000) as UTCTimestamp;
    expect(formatAreaPointHoverTime(timestamp, 'M1', 5.5 * 60 * 60)).toEqual({
      date: "29 Sep '26",
      time: '11:38 UTC+5:30',
    });
    expect(formatAreaPointHoverTime(timestamp, 'D1', 0)?.time).toBe('');
    expect(formatAreaPointHoverTime(timestamp, 'M1', -4 * 60 * 60)?.time).toBe('02:08 UTC-4');
  });

  it.each(['fr', 'hi', 'ar'])('localizes month labels in %s without changing broker time', locale => {
    const date = new Date(Date.UTC(2026, 3, 1, 10, 25));
    const timestamp = (date.getTime() / 1000) as UTCTimestamp;
    const month = new Intl.DateTimeFormat(locale, { month: 'short', timeZone: 'UTC' }).format(date);
    expect(formatTradingChartCrosshairLabel(timestamp, 'M1', 7200, locale)).toBe(`1 ${month} 2026 12:25`);
    expect(formatTradingChartTickLabel(timestamp, 'M1', TickMarkType.Time, 7200, { locale })).toBe('12:25');
    expect(formatTradingChartTickLabel(timestamp, 'MN', TickMarkType.Month, 7200, { locale })).toBe(`${month} 2026`);
  });

  it('formats M1 footer labels with compact time-only ticks', () => {
    const timestamp = Math.floor(Date.UTC(2026, 3, 1, 10, 25, 0, 0) / 1000) as UTCTimestamp;
    const brokerOffsetSeconds = 2 * 60 * 60;

    expect(formatTradingChartTickLabel(timestamp, 'M1', TickMarkType.Time, brokerOffsetSeconds)).toBe('12:25');
    expect(formatTradingChartTickLabel(timestamp, 'M1', TickMarkType.Time, brokerOffsetSeconds, { forceDateLabel: true })).toBe('1 Apr 2026');
    expect(formatTradingChartCrosshairLabel(timestamp, 'M1', brokerOffsetSeconds)).toBe('1 Apr 2026 12:25');
  });

  it('formats M5 footer labels with compact time-only ticks', () => {
    const timestamp = Math.floor(Date.UTC(2026, 3, 1, 10, 0, 0, 0) / 1000) as UTCTimestamp;
    const brokerOffsetSeconds = 2 * 60 * 60;

    expect(formatTradingChartTickLabel(timestamp, 'M5', TickMarkType.Time, brokerOffsetSeconds)).toBe('12:00');
  });

  it('formats M15 and M30 footer labels like the nav intraday minute frames', () => {
    const timestamp = Math.floor(Date.UTC(2026, 3, 1, 10, 0, 0, 0) / 1000) as UTCTimestamp;
    const brokerOffsetSeconds = 2 * 60 * 60;

    expect(formatTradingChartTickLabel(timestamp, 'M15', TickMarkType.Time, brokerOffsetSeconds)).toBe('12:00');
    expect(formatTradingChartTickLabel(timestamp, 'M30', TickMarkType.Time, brokerOffsetSeconds)).toBe('12:00');
  });

  it('formats hourly timeframes with compact time-only ticks in the footer', () => {
    const timestamp = Math.floor(Date.UTC(2026, 3, 1, 10, 0, 0, 0) / 1000) as UTCTimestamp;
    const brokerOffsetSeconds = 2 * 60 * 60;

    expect(formatTradingChartTickLabel(timestamp, 'H1', TickMarkType.Time, brokerOffsetSeconds)).toBe('12:00');
    expect(formatTradingChartTickLabel(timestamp, 'H4', TickMarkType.Time, brokerOffsetSeconds)).toBe('12:00');
  });

  it('keeps day and month boundary labels readable on minute charts', () => {
    const timestamp = Math.floor(Date.UTC(2026, 3, 1, 0, 0, 0, 0) / 1000) as UTCTimestamp;

    expect(formatTradingChartTickLabel(timestamp, 'M1', TickMarkType.DayOfMonth)).toBe('1 Apr 2026');
    expect(formatTradingChartTickLabel(timestamp, 'M5', TickMarkType.DayOfMonth)).toBe('1 Apr 2026');
    expect(formatTradingChartTickLabel(timestamp, 'M5', TickMarkType.Month)).toBe('Apr 2026');
  });

  it('keeps seconds on intraday footer labels when the library requests them', () => {
    const timestamp = Math.floor(Date.UTC(2026, 3, 1, 10, 25, 30, 0) / 1000) as UTCTimestamp;

    expect(formatTradingChartTickLabel(timestamp, 'M1', TickMarkType.TimeWithSeconds)).toBe('10:25:30');
    expect(formatTradingChartTickLabel(timestamp, 'M5', TickMarkType.TimeWithSeconds)).toBe('10:25:30');
  });

  it('formats higher timeframe labels without intraday time', () => {
    const timestamp = Math.floor(Date.UTC(2026, 3, 1, 0, 0, 0, 0) / 1000) as UTCTimestamp;

    expect(formatTradingChartTickLabel(timestamp, 'D1', TickMarkType.DayOfMonth)).toBe('1 Apr');
    expect(formatTradingChartTickLabel(timestamp, 'W1', TickMarkType.Month)).toBe('Apr 2026');
    expect(formatTradingChartCrosshairLabel(timestamp, 'MN')).toBe('Apr 2026');
  });

  it('formats BusinessDay crosshair labels with a stable date', () => {
    expect(formatTradingChartCrosshairLabel({ year: 2026, month: 4, day: 1 }, 'D1')).toBe('1 Apr 2026');
  });

  it('formats string crosshair labels with broker offset for intraday charts', () => {
    expect(formatTradingChartCrosshairLabel('2026-04-01T10:25:00Z', 'M5', 2 * 60 * 60)).toBe('1 Apr 2026 12:25');
  });

  it('uses the nav timeframe config for tick label width', () => {
    expect(getTradingChartTickMarkCharacterLength('M1')).toBe(5);
    expect(getTradingChartTickMarkCharacterLength('M5')).toBe(5);
    expect(getTradingChartTickMarkCharacterLength('M15')).toBe(5);
    expect(getTradingChartTickMarkCharacterLength('M30')).toBe(5);
    expect(getTradingChartTickMarkCharacterLength('H1')).toBe(5);
    expect(getTradingChartTickMarkCharacterLength('H4')).toBe(5);
    expect(getTradingChartTickMarkCharacterLength('D1')).toBe(8);
    expect(getTradingChartTickMarkCharacterLength('W1')).toBe(8);
    expect(getTradingChartTickMarkCharacterLength('MN')).toBe(8);
  });

  it('promotes the left-edge date label only for time-only footer timeframes', () => {
    expect(shouldTradingChartFooterPromoteLeftEdgeDateLabel('M1')).toBe(true);
    expect(shouldTradingChartFooterPromoteLeftEdgeDateLabel('M5')).toBe(true);
    expect(shouldTradingChartFooterPromoteLeftEdgeDateLabel('H1')).toBe(true);
  });

  it('uses the nav timeframe config for default visible range and chart shift', () => {
    expect(getTradingChartDefaultVisibleBars('M1')).toBe(30);
    expect(getTradingChartDefaultRightPadBars('M1')).toBe(8);
    expect(getTradingChartShiftRightOffset('M1', true)).toBe(8);
    expect(getTradingChartShiftRightOffset('M1', false)).toBe(0);

    expect(getTradingChartDefaultVisibleBars('M5')).toBe(30);
    expect(getTradingChartDefaultRightPadBars('M5')).toBe(8);
    expect(getTradingChartShiftRightOffset('H1', true)).toBe(8);
  });

  it('keeps intraday initial ranges anchored with right-side future space', () => {
    expect(getTradingChartInitialLogicalRange({
      timeframe: 'M1',
      totalBars: 100,
      adaptiveVisibleBars: 50,
    })).toEqual({ from: 50, to: 108 });
  });

  it('uses the requested D1 startup viewport instead of leaving most candles at the far left', () => {
    expect(getTradingChartInitialLogicalRange({
      timeframe: 'D1',
      totalBars: 100,
      adaptiveVisibleBars: 60,
    })).toEqual({ from: 76, to: 104 });
  });

  it('right-anchors sparse higher-timeframe startup viewports like lower timeframes', () => {
    expect(getTradingChartInitialLogicalRange({
      timeframe: 'D1',
      totalBars: 10,
      adaptiveVisibleBars: 60,
    })).toEqual({ from: -14, to: 14 });

    expect(getTradingChartInitialLogicalRange({
      timeframe: 'W1',
      totalBars: 5,
      adaptiveVisibleBars: 60,
    })).toEqual({ from: -1, to: 5.5 });

    expect(getTradingChartInitialLogicalRange({
      timeframe: 'MN',
      totalBars: 3,
      adaptiveVisibleBars: 60,
    })).toEqual({ from: -2, to: 3.5 });
  });

  it('does not apply an initial logical range before candles exist', () => {
    expect(getTradingChartInitialLogicalRange({
      timeframe: 'D1',
      totalBars: 0,
      adaptiveVisibleBars: 60,
    })).toBeNull();
  });
});
