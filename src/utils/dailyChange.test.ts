import { describe, expect, it } from 'vitest';

import { readDailyChangePercent, resolveDailyChangePercent } from './dailyChange';

describe('resolveDailyChangePercent', () => {
  it('reads the broker percentage field and its supported aliases', () => {
    expect(readDailyChangePercent({ daily_change_pct: 0.45 })).toBe(0.45);
    expect(readDailyChangePercent({ dailyChangePct: -0.12 })).toBe(-0.12);
    expect(readDailyChangePercent({ daily_change: 0.19 })).toBe(0.19);
    expect(readDailyChangePercent({ dailyChange: -0.36 })).toBe(-0.36);
    expect(readDailyChangePercent({ daily_change_pct: '', daily_change: 0.07 })).toBe(0.07);
  });

  it('uses an upstream percentage without recalculating it', () => {
    expect(resolveDailyChangePercent('0.19', 110, 100)).toBe(0.19);
    expect(resolveDailyChangePercent(0, 110, 100)).toBe(0);
  });

  it('calculates a Bid-based percentage from the previous session close', () => {
    expect(resolveDailyChangePercent(undefined, 110, '100')).toBeCloseTo(10, 10);
  });

  it('does not invent a percentage when the previous session close is unavailable', () => {
    expect(resolveDailyChangePercent(undefined, 110, undefined)).toBeUndefined();
    expect(resolveDailyChangePercent(undefined, 110, 0)).toBeUndefined();
  });
});
