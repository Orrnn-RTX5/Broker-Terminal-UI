import { describe, expect, it } from 'vitest';

import { resolveDailyChangePercent } from './dailyChange';

describe('resolveDailyChangePercent', () => {
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
