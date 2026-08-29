import { describe, expect, it } from 'vitest';
import {
  formatChartCandleCountdown,
  getChartCandleCountdownText,
} from './chartCandleCountdown';

describe('chart candle countdown', () => {
  it('formats minute and hour countdowns like TradingView', () => {
    expect(formatChartCandleCountdown(59)).toBe('00:59');
    expect(formatChartCandleCountdown((3 * 3600) + (59 * 60) + 59)).toBe('03:59:59');
    expect(formatChartCandleCountdown((83 * 3600) + (25 * 60) + 59)).toBe('83:25:59');
    expect(formatChartCandleCountdown(-1)).toBe('00:00');
  });

  it.each([
    ['M1', '00:59'],
    ['M5', '00:59'],
    ['M15', '10:59'],
    ['M30', '25:59'],
    ['H1', '25:59'],
    ['H4', '03:25:59'],
    ['D1', '11:25:59'],
    ['W1', '59:25:59'],
    ['MN', '83:25:59'],
  ] as const)('counts %s down to its actual candle close', (timeframe, expected) => {
    const now = Date.UTC(2026, 7, 28, 12, 34, 0, 250);
    expect(getChartCandleCountdownText(now, timeframe)).toBe(expected);
  });

  it('recalculates deterministically when the timeframe switches without restarting a duration', () => {
    const now = Date.UTC(2026, 7, 28, 10, 7, 30);

    expect(getChartCandleCountdownText(now, 'M1')).toBe('00:30');
    expect(getChartCandleCountdownText(now, 'M5')).toBe('02:30');
    expect(getChartCandleCountdownText(now, 'M15')).toBe('07:30');
    expect(getChartCandleCountdownText(now, 'M30')).toBe('22:30');
    expect(getChartCandleCountdownText(now, 'H1')).toBe('52:30');
  });

  it('derives every refresh and resumed-tab update from the supplied current timestamp', () => {
    const beforePause = Date.UTC(2026, 7, 28, 10, 7, 30);
    const afterPause = Date.UTC(2026, 7, 28, 10, 8, 0);

    expect(getChartCandleCountdownText(beforePause, 'M15')).toBe('07:30');
    expect(getChartCandleCountdownText(beforePause, 'M15')).toBe('07:30');
    expect(getChartCandleCountdownText(afterPause, 'M15')).toBe('07:00');
  });

  it('moves to the next candle at the exact boundary without displaying a negative value', () => {
    const oneSecondBefore = Date.UTC(2026, 7, 28, 10, 14, 59);
    const justBefore = Date.UTC(2026, 7, 28, 10, 14, 59, 250);
    const exactBoundary = Date.UTC(2026, 7, 28, 10, 15, 0);
    const justAfter = Date.UTC(2026, 7, 28, 10, 15, 0, 250);

    expect(getChartCandleCountdownText(oneSecondBefore, 'M15')).toBe('00:01');
    expect(getChartCandleCountdownText(justBefore, 'M15')).toBe('00:00');
    expect(getChartCandleCountdownText(exactBoundary, 'M15')).toBe('15:00');
    expect(getChartCandleCountdownText(justAfter, 'M15')).toBe('14:59');
    expect(getChartCandleCountdownText(justAfter, 'M15')).not.toContain('-');
  });

  it.each([
    [Date.UTC(2024, 1, 29, 23, 59, 30), '00:30'],
    [Date.UTC(2025, 1, 28, 23, 59, 30), '00:30'],
    [Date.UTC(2026, 2, 31, 23, 59, 30), '00:30'],
    [Date.UTC(2026, 11, 31, 23, 59, 30), '00:30'],
  ])('uses the next real calendar-month boundary for %s', (now, expected) => {
    expect(getChartCandleCountdownText(now, 'MN')).toBe(expected);
  });

  it('uses the same configured boundary offset when calculating remaining time', () => {
    const now = Date.UTC(2026, 7, 28, 10, 37, 20);

    expect(getChartCandleCountdownText(now, 'H1')).toBe('22:40');
    expect(getChartCandleCountdownText(now, 'H1', 30 * 60)).toBe('52:40');
  });

  it('returns an empty label for a non-finite clock value', () => {
    expect(getChartCandleCountdownText(Number.NaN, 'M1')).toBe('');
  });
});
