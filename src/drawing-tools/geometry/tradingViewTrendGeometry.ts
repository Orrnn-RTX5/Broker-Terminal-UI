import {
  clipLineToViewport,
  midpoint,
  screenAngleDegrees,
  type PitchforkVariant,
  type ScreenPoint,
  type ScreenSegment,
} from './trendToolGeometry';

export type { PitchforkVariant, ScreenPoint, ScreenSegment } from './trendToolGeometry';

const EPSILON = 1e-9;

const isFinitePoint = (point: ScreenPoint): boolean =>
  Number.isFinite(point.x) && Number.isFinite(point.y);

const lerp = (start: number, end: number, ratio: number): number =>
  start + ((end - start) * ratio);

const lerpPoint = (start: ScreenPoint, end: ScreenPoint, ratio: number): ScreenPoint => ({
  x: lerp(start.x, end.x, ratio),
  y: lerp(start.y, end.y, ratio),
});

const decimalPlaces = (value: number): number => {
  if (!Number.isFinite(value)) return 0;
  const normalized = Math.abs(value);
  if (normalized === 0) return 0;

  const source = normalized.toString().toLowerCase();
  if (!source.includes('e')) {
    return source.includes('.') ? source.split('.')[1].length : 0;
  }

  const [coefficient, exponentText] = source.split('e');
  const exponent = Number(exponentText);
  const coefficientDecimals = coefficient.includes('.') ? coefficient.split('.')[1].length : 0;
  return Math.max(0, coefficientDecimals - exponent);
};

const normalizePrecision = (value: number | undefined, fallback: number): number =>
  Number.isFinite(value)
    ? Math.max(0, Math.trunc(value as number))
    : fallback;

export const formatElapsedCompact = (elapsedSeconds: number): string => {
  const remaining = Math.max(0, Math.round(Math.abs(
    Number.isFinite(elapsedSeconds) ? elapsedSeconds : 0,
  )));
  if (remaining < 60) return `${remaining}s`;

  const days = Math.floor(remaining / 86_400);
  const hours = Math.floor((remaining % 86_400) / 3_600);
  const minutes = Math.floor((remaining % 3_600) / 60);
  const seconds = remaining % 60;

  if (days > 0) return hours > 0 ? `${days}d ${hours}h` : `${days}d`;
  if (hours > 0) return minutes > 0 ? `${hours}h ${minutes}m` : `${hours}h`;
  return seconds > 0 ? `${minutes}m ${seconds}s` : `${minutes}m`;
};

export interface InfoLineMetricsInput {
  startPrice: number;
  endPrice: number;
  startTime: number;
  endTime: number;
  startScreen: ScreenPoint;
  endScreen: ScreenPoint;
  startLogical: number;
  endLogical: number;
  minMove: number;
  pricePrecision: number;
  percentPrecision?: number;
  anglePrecision?: number;
  pixelDistancePrecision?: number;
}

export interface InfoLineMetricDisplay {
  priceChange: string;
  percentChange: string | null;
  priceSteps: string | null;
  bars: string;
  elapsed: string;
  pixelDistance: string;
  angle: string;
}

export interface InfoLineMetrics {
  priceChange: number;
  percentChange: number | null;
  priceSteps: number | null;
  barCount: number;
  elapsedSeconds: number;
  pixelDistance: number;
  angleDegrees: number;
  display: InfoLineMetricDisplay;
}

export const buildInfoLineMetrics = (input: InfoLineMetricsInput): InfoLineMetrics => {
  const pricePrecision = normalizePrecision(input.pricePrecision, 0);
  const percentPrecision = normalizePrecision(input.percentPrecision, 2);
  const anglePrecision = normalizePrecision(input.anglePrecision, 2);
  const pixelDistancePrecision = normalizePrecision(input.pixelDistancePrecision, 0);

  const priceChange = input.endPrice - input.startPrice;
  const percentChange = Math.abs(input.startPrice) > EPSILON
    ? (priceChange / input.startPrice) * 100
    : null;
  const priceSteps = Number.isFinite(input.minMove) && input.minMove > 0
    ? priceChange / input.minMove
    : null;
  const stepPrecision = Math.max(0, pricePrecision - decimalPlaces(input.minMove));
  const barCount = Math.max(0, Math.round(Math.abs(input.endLogical - input.startLogical)));
  const elapsedSeconds = Math.max(0, Math.round(Math.abs(input.endTime - input.startTime)));
  const pixelDistance = Math.hypot(
    input.endScreen.x - input.startScreen.x,
    input.endScreen.y - input.startScreen.y,
  );
  const angleDegrees = screenAngleDegrees(input.startScreen, input.endScreen);

  return {
    priceChange,
    percentChange,
    priceSteps,
    barCount,
    elapsedSeconds,
    pixelDistance,
    angleDegrees,
    display: {
      priceChange: priceChange.toFixed(pricePrecision),
      percentChange: percentChange === null ? null : percentChange.toFixed(percentPrecision),
      priceSteps: priceSteps === null ? null : priceSteps.toFixed(stepPrecision),
      bars: `${barCount} ${barCount === 1 ? 'bar' : 'bars'}`,
      elapsed: formatElapsedCompact(elapsedSeconds),
      pixelDistance: `${pixelDistance.toFixed(pixelDistancePrecision)} px`,
      angle: `${angleDegrees.toFixed(anglePrecision)}\u00b0`,
    },
  };
};

export type TrendChannelVariant =
  | 'parallel_channel'
  | 'flat_top_bottom'
  | 'disjoint_channel';

export interface ChannelGeometryOptions {
  midpointRatio?: number;
}

export interface ChannelGeometry {
  variant: TrendChannelVariant;
  baseline: ScreenSegment;
  boundary: ScreenSegment;
  midpoint: ScreenSegment;
  midpointRatio: number;
  fillPolygon: readonly [ScreenPoint, ScreenPoint, ScreenPoint, ScreenPoint];
  signedPerpendicularOffset: number;
  offsetVector: ScreenPoint;
}

const sameSpanParallelBoundary = (
  a: ScreenPoint,
  b: ScreenPoint,
  c: ScreenPoint,
): { segment: ScreenSegment; offsetVector: ScreenPoint } | null => {
  const dx = b.x - a.x;
  const dy = b.y - a.y;

  if (Math.abs(dx) >= EPSILON) {
    const baselineAtC = a.y + (((c.x - a.x) / dx) * dy);
    const offsetY = c.y - baselineAtC;
    return {
      segment: {
        start: { x: a.x, y: a.y + offsetY },
        end: { x: b.x, y: b.y + offsetY },
      },
      offsetVector: { x: 0, y: offsetY },
    };
  }

  if (Math.abs(dy) >= EPSILON) {
    const baselineAtC = a.x + (((c.y - a.y) / dy) * dx);
    const offsetX = c.x - baselineAtC;
    return {
      segment: {
        start: { x: a.x + offsetX, y: a.y },
        end: { x: b.x + offsetX, y: b.y },
      },
      offsetVector: { x: offsetX, y: 0 },
    };
  }

  return null;
};

export const createChannelGeometry = (
  variant: TrendChannelVariant,
  a: ScreenPoint,
  b: ScreenPoint,
  c: ScreenPoint,
  options: ChannelGeometryOptions = {},
): ChannelGeometry | null => {
  if (![a, b, c].every(isFinitePoint)) return null;

  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const baselineLength = Math.hypot(dx, dy);
  if (baselineLength < EPSILON) return null;

  const midpointRatio = Number.isFinite(options.midpointRatio)
    ? options.midpointRatio as number
    : 0.5;
  const baseline: ScreenSegment = { start: { ...a }, end: { ...b } };
  let boundary: ScreenSegment;
  let offsetVector: ScreenPoint;

  if (variant === 'parallel_channel') {
    const parallel = sameSpanParallelBoundary(a, b, c);
    if (!parallel) return null;
    boundary = parallel.segment;
    offsetVector = parallel.offsetVector;
  } else if (variant === 'flat_top_bottom') {
    boundary = {
      start: { x: a.x, y: c.y },
      end: { x: b.x, y: c.y },
    };
    offsetVector = {
      x: boundary.start.x - a.x,
      y: boundary.start.y - a.y,
    };
  } else {
    // TradingView's Disjoint Channel keeps both rails on the A/B time span.
    // C controls the far-end price of the second rail; its x-coordinate does
    // not move that rail. The second rail mirrors the A/B screen slope so the
    // two sides can diverge instead of becoming another Parallel Channel.
    boundary = {
      start: { x: a.x, y: c.y + dy },
      end: { x: b.x, y: c.y },
    };
    offsetVector = {
      x: boundary.start.x - a.x,
      y: boundary.start.y - a.y,
    };
  }

  const midpointSegment: ScreenSegment = {
    start: lerpPoint(baseline.start, boundary.start, midpointRatio),
    end: lerpPoint(baseline.end, boundary.end, midpointRatio),
  };
  const offsetReference = variant === 'disjoint_channel' ? boundary.start : c;
  const signedPerpendicularOffset = (
    (dx * (offsetReference.y - a.y)) - (dy * (offsetReference.x - a.x))
  ) / baselineLength;

  return {
    variant,
    baseline,
    boundary,
    midpoint: midpointSegment,
    midpointRatio,
    fillPolygon: [baseline.start, baseline.end, boundary.end, boundary.start],
    signedPerpendicularOffset,
    offsetVector,
  };
};

export interface RegressionSample {
  x: number;
  value: number;
}

export interface RegressionTrendOptions {
  upperDeviationMultiplier: number;
  lowerDeviationMultiplier: number;
}

export interface RegressionValuePoint {
  x: number;
  value: number;
}

export interface RegressionValueSegment {
  start: RegressionValuePoint;
  end: RegressionValuePoint;
}

export interface RegressionTrendGeometry {
  sampleCount: number;
  slope: number;
  intercept: number;
  residualStandardDeviation: number;
  /** Pearson's R for the selected samples, or null when Y has no variance. */
  pearsonCorrelation: number | null;
  center: RegressionValueSegment;
  upper: RegressionValueSegment;
  lower: RegressionValueSegment;
}

export const calculateRegressionTrend = (
  samples: readonly RegressionSample[],
  options: RegressionTrendOptions,
): RegressionTrendGeometry | null => {
  const validSamples = samples
    .filter(sample => Number.isFinite(sample.x) && Number.isFinite(sample.value))
    .map(sample => ({ ...sample }))
    .sort((left, right) => left.x - right.x);
  if (validSamples.length < 2) return null;

  const upperMultiplier = Number.isFinite(options.upperDeviationMultiplier)
    ? Math.max(0, options.upperDeviationMultiplier)
    : 0;
  const lowerMultiplier = Number.isFinite(options.lowerDeviationMultiplier)
    ? Math.max(0, options.lowerDeviationMultiplier)
    : 0;
  const sampleCount = validSamples.length;
  const meanX = validSamples.reduce((sum, sample) => sum + sample.x, 0) / sampleCount;
  const meanY = validSamples.reduce((sum, sample) => sum + sample.value, 0) / sampleCount;

  let numerator = 0;
  let denominator = 0;
  let yDenominator = 0;
  validSamples.forEach((sample) => {
    numerator += (sample.x - meanX) * (sample.value - meanY);
    denominator += (sample.x - meanX) ** 2;
    yDenominator += (sample.value - meanY) ** 2;
  });
  if (denominator < EPSILON) return null;

  const slope = numerator / denominator;
  const intercept = meanY - (slope * meanX);
  const pearsonCorrelation = yDenominator < EPSILON
    ? null
    : numerator / Math.sqrt(denominator * yDenominator);
  const residualStandardDeviation = Math.sqrt(
    validSamples.reduce((sum, sample) => {
      const residual = sample.value - (intercept + (slope * sample.x));
      return sum + (residual * residual);
    }, 0) / sampleCount,
  );
  const startX = validSamples[0].x;
  const endX = validSamples[validSamples.length - 1].x;
  const startValue = intercept + (slope * startX);
  const endValue = intercept + (slope * endX);
  const upperOffset = residualStandardDeviation * upperMultiplier;
  const lowerOffset = residualStandardDeviation * lowerMultiplier;

  return {
    sampleCount,
    slope,
    intercept,
    residualStandardDeviation,
    pearsonCorrelation,
    center: {
      start: { x: startX, value: startValue },
      end: { x: endX, value: endValue },
    },
    upper: {
      start: { x: startX, value: startValue + upperOffset },
      end: { x: endX, value: endValue + upperOffset },
    },
    lower: {
      start: { x: startX, value: startValue - lowerOffset },
      end: { x: endX, value: endValue - lowerOffset },
    },
  };
};

export const DEFAULT_PITCHFORK_LEVEL_RATIOS = [0, 0.5, 1] as const;

export type PitchforkRayRole = 'median' | 'upper-level' | 'lower-level';
export type PitchforkBandRole = 'upper-band' | 'lower-band';

export interface PitchforkRay {
  role: PitchforkRayRole;
  ratio: number;
  anchor: ScreenPoint;
  segment: ScreenSegment;
}

export interface PitchforkLevelPair {
  ratio: number;
  upper: PitchforkRay;
  lower: PitchforkRay;
}

export interface PitchforkBand {
  role: PitchforkBandRole;
  innerRatio: number;
  outerRatio: number;
  innerRay: PitchforkRay;
  outerRay: PitchforkRay;
  polygon: readonly [ScreenPoint, ScreenPoint, ScreenPoint, ScreenPoint];
}

export interface PitchforkMedianDefinition {
  origin: ScreenPoint;
  target: ScreenPoint;
  direction: ScreenPoint;
  outerMidpoint: ScreenPoint;
  firstOuterAnchor: ScreenPoint;
  secondOuterAnchor: ScreenPoint;
}

export interface PitchforkLevelsGeometry {
  variant: PitchforkVariant;
  ratios: readonly number[];
  medianOrigin: ScreenPoint;
  medianTarget: ScreenPoint;
  direction: ScreenPoint;
  median: PitchforkRay;
  levels: readonly PitchforkLevelPair[];
  rays: readonly PitchforkRay[];
  bands: readonly PitchforkBand[];
}

export const resolvePitchforkMedian = (
  a: ScreenPoint,
  b: ScreenPoint,
  c: ScreenPoint,
  variant: PitchforkVariant,
): PitchforkMedianDefinition | null => {
  if (![a, b, c].every(isFinitePoint)) return null;

  const bcMidpoint = midpoint(b, c);
  let origin = a;
  let target = bcMidpoint;
  let outerMidpoint = bcMidpoint;
  let firstOuterAnchor = b;
  let secondOuterAnchor = c;

  if (variant === 'schiff_pitchfork') {
    origin = { x: a.x, y: (a.y + b.y) / 2 };
  } else if (variant === 'modified_schiff_pitchfork') {
    origin = midpoint(a, b);
  } else if (variant === 'inside_pitchfork') {
    origin = midpoint(a, b);
    target = c;
    outerMidpoint = origin;
    firstOuterAnchor = a;
    secondOuterAnchor = b;
  }

  const direction = { x: target.x - origin.x, y: target.y - origin.y };
  if (Math.hypot(direction.x, direction.y) < EPSILON) return null;

  return {
    origin,
    target,
    direction,
    outerMidpoint,
    firstOuterAnchor,
    secondOuterAnchor,
  };
};

const lineYAtReferenceX = (
  anchor: ScreenPoint,
  direction: ScreenPoint,
  referenceX: number,
): number | null => {
  if (Math.abs(direction.x) < EPSILON) return null;
  return anchor.y + (((referenceX - anchor.x) / direction.x) * direction.y);
};

const orderPitchforkOuterAnchors = (
  definition: PitchforkMedianDefinition,
): { upper: ScreenPoint; lower: ScreenPoint } => {
  const firstY = lineYAtReferenceX(
    definition.firstOuterAnchor,
    definition.direction,
    definition.target.x,
  );
  const secondY = lineYAtReferenceX(
    definition.secondOuterAnchor,
    definition.direction,
    definition.target.x,
  );

  if (firstY !== null && secondY !== null) {
    return firstY <= secondY
      ? { upper: definition.firstOuterAnchor, lower: definition.secondOuterAnchor }
      : { upper: definition.secondOuterAnchor, lower: definition.firstOuterAnchor };
  }

  return definition.firstOuterAnchor.x <= definition.secondOuterAnchor.x
    ? { upper: definition.firstOuterAnchor, lower: definition.secondOuterAnchor }
    : { upper: definition.secondOuterAnchor, lower: definition.firstOuterAnchor };
};

const createParallelRay = (
  anchor: ScreenPoint,
  direction: ScreenPoint,
  width: number,
  height: number,
): ScreenSegment | null => clipLineToViewport(
  anchor,
  { x: anchor.x + direction.x, y: anchor.y + direction.y },
  width,
  height,
  'ray',
);

const normalizePitchforkRatios = (ratios: readonly number[]): number[] => {
  const normalized = ratios
    .filter(ratio => Number.isFinite(ratio) && ratio >= 0)
    .map(ratio => Math.abs(ratio));
  normalized.push(0);
  return [...new Set(normalized)].sort((left, right) => left - right);
};

const bandPolygon = (
  inner: PitchforkRay,
  outer: PitchforkRay,
): readonly [ScreenPoint, ScreenPoint, ScreenPoint, ScreenPoint] => [
  inner.segment.start,
  inner.segment.end,
  outer.segment.end,
  outer.segment.start,
];

export const createPitchforkLevels = (
  a: ScreenPoint,
  b: ScreenPoint,
  c: ScreenPoint,
  width: number,
  height: number,
  variant: PitchforkVariant,
  ratios: readonly number[] = DEFAULT_PITCHFORK_LEVEL_RATIOS,
): PitchforkLevelsGeometry | null => {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width < 0 || height < 0) {
    return null;
  }

  const definition = resolvePitchforkMedian(a, b, c, variant);
  if (!definition) return null;

  const medianSegment = createParallelRay(
    definition.origin,
    definition.direction,
    width,
    height,
  );
  if (!medianSegment) return null;

  const normalizedRatios = normalizePitchforkRatios(ratios);
  const median: PitchforkRay = {
    role: 'median',
    ratio: 0,
    anchor: definition.origin,
    segment: medianSegment,
  };
  const orderedOuterAnchors = orderPitchforkOuterAnchors(definition);
  const levels: PitchforkLevelPair[] = [];

  for (const ratio of normalizedRatios) {
    if (ratio < EPSILON) continue;

    const upperAnchor = lerpPoint(
      definition.outerMidpoint,
      orderedOuterAnchors.upper,
      ratio,
    );
    const lowerAnchor = lerpPoint(
      definition.outerMidpoint,
      orderedOuterAnchors.lower,
      ratio,
    );
    const upperSegment = createParallelRay(upperAnchor, definition.direction, width, height);
    const lowerSegment = createParallelRay(lowerAnchor, definition.direction, width, height);
    if (!upperSegment || !lowerSegment) return null;

    levels.push({
      ratio,
      upper: {
        role: 'upper-level',
        ratio,
        anchor: upperAnchor,
        segment: upperSegment,
      },
      lower: {
        role: 'lower-level',
        ratio,
        anchor: lowerAnchor,
        segment: lowerSegment,
      },
    });
  }

  const bands: PitchforkBand[] = [];
  let innerUpper = median;
  let innerLower = median;
  let innerRatio = 0;
  levels.forEach((level) => {
    bands.push({
      role: 'upper-band',
      innerRatio,
      outerRatio: level.ratio,
      innerRay: innerUpper,
      outerRay: level.upper,
      polygon: bandPolygon(innerUpper, level.upper),
    });
    bands.push({
      role: 'lower-band',
      innerRatio,
      outerRatio: level.ratio,
      innerRay: innerLower,
      outerRay: level.lower,
      polygon: bandPolygon(innerLower, level.lower),
    });
    innerUpper = level.upper;
    innerLower = level.lower;
    innerRatio = level.ratio;
  });

  return {
    variant,
    ratios: normalizedRatios,
    medianOrigin: definition.origin,
    medianTarget: definition.target,
    direction: definition.direction,
    median,
    levels,
    rays: [median, ...levels.flatMap(level => [level.upper, level.lower])],
    bands,
  };
};
