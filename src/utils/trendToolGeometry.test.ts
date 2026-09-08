import { describe, expect, it } from 'vitest';
import { TREND_LINE_TOOLS } from '../config/trendLineTools';
import {
  clipLineToViewport,
  constrainPointTo45DegreeAngle,
  createPitchforkGeometry,
  parallelSegmentThrough,
  screenAngleDegrees,
} from './trendToolGeometry';

describe('trend line tool registry', () => {
  it('defines the complete TradingView trend-tool menu and interaction point counts', () => {
    expect(TREND_LINE_TOOLS).toHaveLength(17);
    expect(TREND_LINE_TOOLS.filter((tool) => tool.group === 'Lines')).toHaveLength(9);
    expect(TREND_LINE_TOOLS.filter((tool) => tool.group === 'Channels')).toHaveLength(4);
    expect(TREND_LINE_TOOLS.filter((tool) => tool.group === 'Pitchforks')).toHaveLength(4);
    expect(
      TREND_LINE_TOOLS.filter((tool) => tool.requiredPoints === 3).map((tool) => tool.id),
    ).toEqual([
      'parallel_channel',
      'flat_top_bottom',
      'disjoint_channel',
      'pitchfork',
      'schiff_pitchfork',
      'modified_schiff_pitchfork',
      'inside_pitchfork',
    ]);
  });
});

describe('trend line screen geometry', () => {
  it.each([
    [80, 10, 1, 0], [80, 65, 1, 1], [10, 80, 0, 1], [-65, 80, -1, 1],
    [-80, 10, -1, 0], [-80, -65, -1, -1], [10, -80, 0, -1], [65, -80, 1, -1],
  ])('constrains the pointer vector (%i, %i) to the nearest 45-degree direction', (dx, dy, xSign, ySign) => {
    const anchor = { x: 100, y: 100 };
    const actual = constrainPointTo45DegreeAngle(anchor, { x: 100 + dx, y: 100 + dy });
    const actualX = actual.x - anchor.x;
    const actualY = actual.y - anchor.y;
    expect(Math.sign(actualX)).toBe(xSign);
    expect(Math.sign(actualY)).toBe(ySign);
    if (xSign && ySign) expect(Math.abs(actualX)).toBeCloseTo(Math.abs(actualY), 8);
    expect(Math.hypot(actualX, actualY)).toBeCloseTo(Math.hypot(dx, dy), 8);
  });

  it('keeps coincident anchors finite and matches the observed diagonal endpoint drag', () => {
    expect(constrainPointTo45DegreeAngle({ x: 10, y: 20 }, { x: 10, y: 20 }))
      .toEqual({ x: 10, y: 20 });
    const actual = constrainPointTo45DegreeAngle({ x: 587, y: 220 }, { x: 900, y: 480 });
    expect(actual.x).toBeCloseTo(874.723, 2);
    expect(actual.y).toBeCloseTo(507.723, 2);
  });

  it('keeps segments finite and clips rays or extended lines to the pane', () => {
    expect(clipLineToViewport({ x: 20, y: 80 }, { x: 80, y: 20 }, 100, 100, 'segment')).toEqual({
      start: { x: 20, y: 80 },
      end: { x: 80, y: 20 },
    });
    expect(clipLineToViewport({ x: 20, y: 80 }, { x: 80, y: 20 }, 100, 100, 'ray')).toEqual({
      start: { x: 20, y: 80 },
      end: { x: 100, y: 0 },
    });
    expect(clipLineToViewport({ x: 20, y: 80 }, { x: 80, y: 20 }, 100, 100, 'infinite')).toEqual({
      start: { x: 0, y: 100 },
      end: { x: 100, y: 0 },
    });
  });

  it('handles vertical lines and rejects a zero-length line', () => {
    expect(clipLineToViewport({ x: 25, y: 20 }, { x: 25, y: 40 }, 100, 100, 'infinite')).toEqual({
      start: { x: 25, y: 0 },
      end: { x: 25, y: 100 },
    });
    expect(clipLineToViewport({ x: 25, y: 20 }, { x: 25, y: 20 }, 100, 100, 'ray')).toBeNull();
  });

  it('constructs a channel parallel through the third anchor', () => {
    expect(parallelSegmentThrough(
      { x: 10, y: 10 },
      { x: 60, y: 30 },
      { x: 15, y: 50 },
    )).toEqual({
      start: { x: 15, y: 50 },
      end: { x: 65, y: 70 },
    });
  });

  it.each([
    'pitchfork',
    'schiff_pitchfork',
    'modified_schiff_pitchfork',
    'inside_pitchfork',
  ] as const)('creates clipped geometry for %s', (variant) => {
    const result = createPitchforkGeometry(
      { x: 15, y: 50 },
      { x: 45, y: 20 },
      { x: 45, y: 80 },
      120,
      100,
      variant,
    );
    expect(result).not.toBeNull();
    expect(result!.median.start.x).toBeGreaterThanOrEqual(0);
    expect(result!.median.end.x).toBeLessThanOrEqual(120);
    if (variant === 'inside_pitchfork') {
      expect(result!.innerUpper).toBeDefined();
      expect(result!.innerLower).toBeDefined();
    }
  });

  it('reports the visual trend angle', () => {
    expect(screenAngleDegrees({ x: 0, y: 100 }, { x: 100, y: 0 })).toBeCloseTo(45);
  });
});
