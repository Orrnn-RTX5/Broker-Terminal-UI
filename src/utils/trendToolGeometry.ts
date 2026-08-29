export interface ScreenPoint {
  x: number;
  y: number;
}

export interface ScreenSegment {
  start: ScreenPoint;
  end: ScreenPoint;
}

export type LineExtent = 'segment' | 'ray' | 'infinite';

const EPSILON = 1e-7;

/** Clips a segment, forward ray, or infinite line to the visible chart pane. */
export const clipLineToViewport = (
  start: ScreenPoint,
  through: ScreenPoint,
  width: number,
  height: number,
  extent: LineExtent,
): ScreenSegment | null => {
  const dx = through.x - start.x;
  const dy = through.y - start.y;
  if (Math.abs(dx) < EPSILON && Math.abs(dy) < EPSILON) return null;

  let tMin = extent === 'infinite' ? Number.NEGATIVE_INFINITY : 0;
  let tMax = extent === 'segment' ? 1 : Number.POSITIVE_INFINITY;

  const constrain = (origin: number, delta: number, min: number, max: number): boolean => {
    if (Math.abs(delta) < EPSILON) return origin >= min && origin <= max;
    let near = (min - origin) / delta;
    let far = (max - origin) / delta;
    if (near > far) [near, far] = [far, near];
    tMin = Math.max(tMin, near);
    tMax = Math.min(tMax, far);
    return tMin <= tMax;
  };

  if (!constrain(start.x, dx, 0, Math.max(0, width))) return null;
  if (!constrain(start.y, dy, 0, Math.max(0, height))) return null;
  if (!Number.isFinite(tMin) || !Number.isFinite(tMax)) return null;

  return {
    start: { x: start.x + dx * tMin, y: start.y + dy * tMin },
    end: { x: start.x + dx * tMax, y: start.y + dy * tMax },
  };
};

export const parallelSegmentThrough = (
  baselineStart: ScreenPoint,
  baselineEnd: ScreenPoint,
  through: ScreenPoint,
): ScreenSegment => ({
  start: through,
  end: {
    x: through.x + (baselineEnd.x - baselineStart.x),
    y: through.y + (baselineEnd.y - baselineStart.y),
  },
});

export const midpoint = (a: ScreenPoint, b: ScreenPoint): ScreenPoint => ({
  x: (a.x + b.x) / 2,
  y: (a.y + b.y) / 2,
});

export type PitchforkVariant =
  | 'pitchfork'
  | 'schiff_pitchfork'
  | 'modified_schiff_pitchfork'
  | 'inside_pitchfork';

export interface PitchforkGeometry {
  median: ScreenSegment;
  upper: ScreenSegment;
  lower: ScreenSegment;
  innerUpper?: ScreenSegment;
  innerLower?: ScreenSegment;
}

export const createPitchforkGeometry = (
  a: ScreenPoint,
  b: ScreenPoint,
  c: ScreenPoint,
  width: number,
  height: number,
  variant: PitchforkVariant,
): PitchforkGeometry | null => {
  const bcMid = midpoint(b, c);
  let origin = a;

  if (variant === 'schiff_pitchfork') {
    origin = { x: (a.x + b.x) / 2, y: a.y };
  } else if (variant === 'modified_schiff_pitchfork') {
    origin = midpoint(a, b);
  }

  const direction = { x: bcMid.x - origin.x, y: bcMid.y - origin.y };
  if (Math.abs(direction.x) < EPSILON && Math.abs(direction.y) < EPSILON) return null;

  const ray = (point: ScreenPoint): ScreenSegment | null =>
    clipLineToViewport(
      point,
      { x: point.x + direction.x, y: point.y + direction.y },
      width,
      height,
      'ray',
    );

  const median = ray(origin);
  const upper = ray(b);
  const lower = ray(c);
  if (!median || !upper || !lower) return null;

  if (variant !== 'inside_pitchfork') return { median, upper, lower };

  const innerUpper = ray(midpoint(b, bcMid)) || undefined;
  const innerLower = ray(midpoint(c, bcMid)) || undefined;
  return { median, upper, lower, innerUpper, innerLower };
};

export const screenAngleDegrees = (start: ScreenPoint, end: ScreenPoint): number =>
  Math.atan2(start.y - end.y, end.x - start.x) * (180 / Math.PI);

