import { describe, expect, it } from 'vitest';
import {
  buildRemovalMenuItems,
  countRemovableDrawings,
  formatDrawingCount,
  formatIndicatorCount,
  selectRemovableDrawings,
} from './removeDrawingsPlan';

describe('removal labels', () => {
  it('pluralizes counts from the applied objects instead of hardcoding them', () => {
    expect(formatDrawingCount(1)).toBe('1 drawing');
    expect(formatDrawingCount(15)).toBe('15 drawings');
    expect(formatIndicatorCount(1)).toBe('1 indicator');
    expect(formatIndicatorCount(2)).toBe('2 indicators');
  });
});

describe('removal menu items', () => {
  it('lists drawings, indicators and the combined entry when both exist', () => {
    expect(buildRemovalMenuItems({ drawings: 15, indicators: 1 })).toEqual([
      { scope: 'drawings', label: 'Remove 15 drawings' },
      { scope: 'indicators', label: 'Remove 1 indicator' },
      { scope: 'both', label: 'Remove 15 drawings & 1 indicator' },
    ]);
  });
  it('omits the indicator entries when no indicator is applied', () => {
    expect(buildRemovalMenuItems({ drawings: 3, indicators: 0 })).toEqual([
      { scope: 'drawings', label: 'Remove 3 drawings' },
    ]);
  });
  it('omits the drawing entries when only indicators are applied', () => {
    expect(buildRemovalMenuItems({ drawings: 0, indicators: 2 })).toEqual([
      { scope: 'indicators', label: 'Remove 2 indicators' },
    ]);
  });
  it('offers nothing when the chart is empty', () => {
    expect(buildRemovalMenuItems({ drawings: 0, indicators: 0 })).toEqual([]);
  });
});

describe('locked drawing filtering', () => {
  const drawings = [
    { id: 'a', locked: false },
    { id: 'b', locked: true },
    { id: 'c', locked: false },
  ];
  it('keeps locked drawings out of the removal set until the toggle is on', () => {
    expect(selectRemovableDrawings(drawings, false).map(d => d.id)).toEqual(['a', 'c']);
    expect(countRemovableDrawings(drawings, false)).toBe(2);
  });
  it('includes locked drawings when always-remove-locked is enabled', () => {
    expect(selectRemovableDrawings(drawings, true).map(d => d.id)).toEqual(['a', 'b', 'c']);
    expect(countRemovableDrawings(drawings, true)).toBe(3);
  });
  it('treats legacy drawings without a lock flag as unlocked', () => {
    const legacyDrawings: Array<{ id: string; locked?: boolean }> = [...drawings, { id: 'legacy' }];
    expect(selectRemovableDrawings(legacyDrawings, false).map(d => d.id)).toEqual(['a', 'c', 'legacy']);
    expect(countRemovableDrawings(legacyDrawings, false)).toBe(3);
  });
});
