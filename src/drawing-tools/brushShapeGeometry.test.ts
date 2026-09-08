import { describe, expect, it } from 'vitest';
import { rotatedRectangle, doubleCurveControls, defaultDoubleCurveBends } from './brushShapeGeometry';

describe('Brush menu shape geometry', () => {
  it('interpolates both Double curve bend handles independently', () => {
    const a = { x: 20, y: 200 }, b = { x: 200, y: 210 };
    const [p, q] = defaultDoubleCurveBends(a, b);
    p.x += 45;
    const [c, d] = doubleCurveControls(a, b, p, q);
    for (const [t, expected] of [[.25, p], [.75, q]] as const) {
      for (const key of ['x', 'y'] as const) {
        const actual = (1-t)**3*a[key] + 3*(1-t)**2*t*c[key] + 3*(1-t)*t*t*d[key] + t**3*b[key];
        expect(actual).toBeCloseTo(expected[key]);
      }
    }
  });
  it('keeps rotated rectangle sides perpendicular and centered on its axis', () => {
    const a = { x: 20, y: 30 }, b = { x: 120, y: 80 };
    const result = rotatedRectangle(a, b, { x: 90, y: 150 });
    const [p, q, r, s] = result.corners;
    expect((q.x - p.x) * (r.x - q.x) + (q.y - p.y) * (r.y - q.y)).toBeCloseTo(0);
    expect((p.x + s.x) / 2).toBeCloseTo(a.x);
    expect((q.y + r.y) / 2).toBeCloseTo(b.y);
    expect(rotatedRectangle(a, a, a).path).not.toMatch(/NaN|Infinity/);
  });
});
