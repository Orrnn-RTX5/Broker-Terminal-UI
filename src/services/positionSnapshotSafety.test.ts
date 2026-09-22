// @vitest-environment jsdom

import { describe, expect, it } from 'vitest';
import { shouldDeferEmptyPositionSnapshot } from './positionSnapshotSafety';

describe('shouldDeferEmptyPositionSnapshot', () => {
  it('protects a visible position list from an empty stream snapshot', () => {
    expect(shouldDeferEmptyPositionSnapshot([{ id: 347978 }], [])).toBe(true);
  });

  it('allows an empty list to remain empty and accepts non-empty snapshots', () => {
    expect(shouldDeferEmptyPositionSnapshot([], [])).toBe(false);
    expect(shouldDeferEmptyPositionSnapshot([{ id: 347978 }], [{ id: 347986 }])).toBe(false);
  });
});
