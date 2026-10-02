import { describe, expect, it } from 'vitest';
import {
  getHistoryPeriodStart,
  getHistoryVirtualWindow,
  HISTORY_OVERSCAN,
  HISTORY_ROW_HEIGHT,
  parseLocalDateBoundary,
  subtractCalendarMonths,
} from './historyFilters';

describe('history filter helpers', () => {
  it('subtracts calendar months without overflowing shorter months', () => {
    const result = subtractCalendarMonths(new Date(2026, 2, 31, 12), 1);
    expect(result.getFullYear()).toBe(2026);
    expect(result.getMonth()).toBe(1);
    expect(result.getDate()).toBe(28);
  });

  it('rejects invalid local dates and creates inclusive day boundaries', () => {
    expect(parseLocalDateBoundary('2026-02-30', false)).toBeNull();
    const start = parseLocalDateBoundary('2026-09-28', false);
    const end = parseLocalDateBoundary('2026-09-28', true);
    expect(start).not.toBeNull();
    expect(end! - start!).toBe(86_399_999);
  });

  it('keeps all/custom unbounded and computes finite preset starts', () => {
    const now = new Date(2026, 8, 28, 12).getTime();
    expect(getHistoryPeriodStart('all', now)).toBeNull();
    expect(getHistoryPeriodStart('custom', now)).toBeNull();
    expect(getHistoryPeriodStart('last-month', now)).toBeTypeOf('number');
  });

  it('uses local midnight for Today and exact rolling durations for recent history', () => {
    const now = new Date(2026, 9, 1, 15, 45, 30, 123).getTime();
    expect(getHistoryPeriodStart('today', now)).toBe(new Date(2026, 9, 1).getTime());
    expect(now - getHistoryPeriodStart('last-hour', now)!).toBe(3_600_000);
    expect(now - getHistoryPeriodStart('last-three-hours', now)!).toBe(3 * 3_600_000);
    expect(now - getHistoryPeriodStart('last-six-hours', now)!).toBe(6 * 3_600_000);
    expect(now - getHistoryPeriodStart('last-twelve-hours', now)!).toBe(12 * 3_600_000);
    expect(now - getHistoryPeriodStart('last-24-hours', now)!).toBe(86_400_000);
    expect(now - getHistoryPeriodStart('last-three-days', now)!).toBe(3 * 86_400_000);
    expect(now - getHistoryPeriodStart('last-seven-days', now)!).toBe(7 * 86_400_000);
    expect(now - getHistoryPeriodStart('last-fourteen-days', now)!).toBe(14 * 86_400_000);
    expect(now - getHistoryPeriodStart('last-thirty-days', now)!).toBe(30 * 86_400_000);
  });

  it('uses calendar-month boundaries through six months, including shorter-month clamping', () => {
    const now = new Date(2026, 7, 31, 15, 45).getTime();
    expect(getHistoryPeriodStart('last-month', now)).toBe(new Date(2026, 6, 31).getTime());
    expect(getHistoryPeriodStart('last-three-months', now)).toBe(new Date(2026, 4, 31).getTime());
    expect(getHistoryPeriodStart('last-six-months', now)).toBe(new Date(2026, 1, 28).getTime());
    // Thirty rolling days and a calendar month are intentionally distinct.
    expect(getHistoryPeriodStart('last-thirty-days', now)).not.toBe(getHistoryPeriodStart('last-month', now));
  });

  it('keeps a large history viewport bounded without losing table height', () => {
    const count = 100_000;
    const window = getHistoryVirtualWindow(count, 1_500_015, 360);
    const rendered = window.endIndex - window.startIndex;
    expect(rendered).toBeLessThanOrEqual(12 + 2 * HISTORY_OVERSCAN + 1);
    expect(window.topSpacerHeight + rendered * HISTORY_ROW_HEIGHT + window.bottomSpacerHeight)
      .toBe(count * HISTORY_ROW_HEIGHT);
    const end = getHistoryVirtualWindow(count, Number.MAX_SAFE_INTEGER, 360);
    expect(end.endIndex).toBe(count);
    expect(end.endIndex - end.startIndex).toBeGreaterThanOrEqual(12);
    expect(end.bottomSpacerHeight).toBe(0);
    expect(getHistoryVirtualWindow(0, 1000, 360).endIndex).toBe(0);
  });
});
