import { describe, expect, it } from 'vitest';
import {
  getHistoryPeriodStart,
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
});
