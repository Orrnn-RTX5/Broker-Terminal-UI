import { describe, expect, it, vi } from 'vitest';
import { drawingLogicalToCoordinate } from './drawingCoordinates';

describe('drawing logical coordinates', () => {
  it.each([25.5, 25.125, -2.75])('interpolates fractional index %s using only integer chart queries', (logical) => {
    // lightweight-charts 5.1.0 returns zero for noninteger indices.
    const timeScale = {
      logicalToCoordinate: vi.fn((index: number) => Number.isInteger(index) ? 120 + index * 8 : 0),
    };
    expect(timeScale.logicalToCoordinate(logical)).toBe(0);
    timeScale.logicalToCoordinate.mockClear();
    expect(drawingLogicalToCoordinate(timeScale, logical)).toBeCloseTo(120 + logical * 8, 8);
    expect(timeScale.logicalToCoordinate.mock.calls.map(([index]) => index))
      .toEqual([Math.floor(logical), Math.ceil(logical)]);
  });

  it('preserves zero coordinates and avoids an unnecessary adjacent query for integer indices', () => {
    const timeScale = { logicalToCoordinate: vi.fn(() => 0) };
    expect(drawingLogicalToCoordinate(timeScale, 12)).toBe(0);
    expect(timeScale.logicalToCoordinate).toHaveBeenCalledExactlyOnceWith(12);
  });

  it.each([NaN, Infinity, -Infinity])('rejects invalid logical index %s before querying the chart', (logical) => {
    const timeScale = { logicalToCoordinate: vi.fn(() => 0) };
    expect(drawingLogicalToCoordinate(timeScale, logical)).toBeNull();
    expect(timeScale.logicalToCoordinate).not.toHaveBeenCalled();
  });

  it.each([null, NaN, Infinity])('declines interpolation when an adjacent chart coordinate is %s', (coordinate) => {
    const timeScale = { logicalToCoordinate: vi.fn<(logical: number) => number | null>() };
    timeScale.logicalToCoordinate.mockReturnValueOnce(coordinate);
    expect(drawingLogicalToCoordinate(timeScale, 12.5)).toBeNull();
    timeScale.logicalToCoordinate.mockReturnValueOnce(100).mockReturnValueOnce(coordinate);
    expect(drawingLogicalToCoordinate(timeScale, 12.5)).toBeNull();
  });
});
