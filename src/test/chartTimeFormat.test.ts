import { describe, expect, it } from 'vitest';
import { TickMarkType } from 'lightweight-charts';
import {
  getTradingChartDefaultRightPadBars,
  getTradingChartDefaultVisibleBars,
  getTradingChartShiftRightOffset,
  formatTradingChartCrosshairLabel,
  formatTradingChartTickLabel,
  getTradingChartTickMarkCharacterLength,
  shouldTradingChartFooterPromoteLeftEdgeDateLabel,
} from '../utils/chartTimeFormat';

describe('chartTimeFormat', () => {
  it('formats M1 footer labels with compact time-only ticks', () => {
    const timestamp = Math.floor(Date.UTC(2026, 3, 1, 10, 25, 0, 0) / 1000);
    const brokerOffsetSeconds = 2 * 60 * 60;

    expect(formatTradingChartTickLabel(timestamp, 'M1', TickMarkType.Time, brokerOffsetSeconds)).toBe('12:25');
    expect(formatTradingChartTickLabel(timestamp, 'M1', TickMarkType.Time, brokerOffsetSeconds, { forceDateLabel: true })).toBe('1 Apr 2026');
    expect(formatTradingChartCrosshairLabel(timestamp, 'M1', brokerOffsetSeconds)).toBe('1 Apr 2026 12:25');
  });

  it('formats M5 footer labels with compact time-only ticks', () => {
    const timestamp = Math.floor(Date.UTC(2026, 3, 1, 10, 0, 0, 0) / 1000);
    const brokerOffsetSeconds = 2 * 60 * 60;

    expect(formatTradingChartTickLabel(timestamp, 'M5', TickMarkType.Time, brokerOffsetSeconds)).toBe('12:00');
  });

  it('formats M15 and M30 footer labels like the nav intraday minute frames', () => {
    const timestamp = Math.floor(Date.UTC(2026, 3, 1, 10, 0, 0, 0) / 1000);
    const brokerOffsetSeconds = 2 * 60 * 60;

    expect(formatTradingChartTickLabel(timestamp, 'M15', TickMarkType.Time, brokerOffsetSeconds)).toBe('12:00');
    expect(formatTradingChartTickLabel(timestamp, 'M30', TickMarkType.Time, brokerOffsetSeconds)).toBe('12:00');
  });

  it('formats hourly timeframes with compact time-only ticks in the footer', () => {
    const timestamp = Math.floor(Date.UTC(2026, 3, 1, 10, 0, 0, 0) / 1000);
    const brokerOffsetSeconds = 2 * 60 * 60;

    expect(formatTradingChartTickLabel(timestamp, 'H1', TickMarkType.Time, brokerOffsetSeconds)).toBe('12:00');
    expect(formatTradingChartTickLabel(timestamp, 'H4', TickMarkType.Time, brokerOffsetSeconds)).toBe('12:00');
  });

  it('keeps day and month boundary labels readable on minute charts', () => {
    const timestamp = Math.floor(Date.UTC(2026, 3, 1, 0, 0, 0, 0) / 1000);

    expect(formatTradingChartTickLabel(timestamp, 'M1', TickMarkType.DayOfMonth)).toBe('1 Apr 2026');
    expect(formatTradingChartTickLabel(timestamp, 'M5', TickMarkType.DayOfMonth)).toBe('1 Apr 2026');
    expect(formatTradingChartTickLabel(timestamp, 'M5', TickMarkType.Month)).toBe('Apr 2026');
  });

  it('keeps seconds on intraday footer labels when the library requests them', () => {
    const timestamp = Math.floor(Date.UTC(2026, 3, 1, 10, 25, 30, 0) / 1000);

    expect(formatTradingChartTickLabel(timestamp, 'M1', TickMarkType.TimeWithSeconds)).toBe('10:25:30');
    expect(formatTradingChartTickLabel(timestamp, 'M5', TickMarkType.TimeWithSeconds)).toBe('10:25:30');
  });

  it('formats higher timeframe labels without intraday time', () => {
    const timestamp = Math.floor(Date.UTC(2026, 3, 1, 0, 0, 0, 0) / 1000);

    expect(formatTradingChartTickLabel(timestamp, 'D1', TickMarkType.DayOfMonth)).toBe('1 Apr');
    expect(formatTradingChartTickLabel(timestamp, 'W1', TickMarkType.Month)).toBe('Apr 2026');
    expect(formatTradingChartCrosshairLabel(timestamp, 'MN')).toBe('Apr 2026');
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
    expect(getTradingChartDefaultRightPadBars('M1')).toBe(5);
    expect(getTradingChartShiftRightOffset('M1', true)).toBe(8);
    expect(getTradingChartShiftRightOffset('M1', false)).toBe(0);

    expect(getTradingChartDefaultVisibleBars('M5')).toBe(30);
    expect(getTradingChartDefaultRightPadBars('M5')).toBe(5);
    expect(getTradingChartShiftRightOffset('H1', true)).toBe(8);
  });
});
