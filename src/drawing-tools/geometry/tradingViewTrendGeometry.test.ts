import { describe, expect, it } from 'vitest';
import {
  buildInfoLineMetrics,
  calculateRegressionTrend,
  createChannelGeometry,
  createPitchforkLevels,
  formatElapsedCompact,
  resolvePitchforkMedian,
  type PitchforkVariant,
  type ScreenPoint,
  type ScreenSegment,
} from './tradingViewTrendGeometry';

const expectPointClose = (actual: ScreenPoint, expected: ScreenPoint): void => {
  expect(actual.x).toBeCloseTo(expected.x, 8);
  expect(actual.y).toBeCloseTo(expected.y, 8);
};

const expectSegmentClose = (actual: ScreenSegment, expected: ScreenSegment): void => {
  expectPointClose(actual.start, expected.start);
  expectPointClose(actual.end, expected.end);
};

const expectParallel = (left: ScreenSegment, right: ScreenSegment): void => {
  const leftDirection = {
    x: left.end.x - left.start.x,
    y: left.end.y - left.start.y,
  };
  const rightDirection = {
    x: right.end.x - right.start.x,
    y: right.end.y - right.start.y,
  };
  const crossProduct = (leftDirection.x * rightDirection.y)
    - (leftDirection.y * rightDirection.x);
  expect(crossProduct).toBeCloseTo(0, 7);
};

describe('TradingView info-line metrics', () => {
  it('derives every captured measurement from runtime price, time, logical, and screen inputs', () => {
    const metrics = buildInfoLineMetrics({
      startPrice: 4_444.526,
      endPrice: 4_447.720,
      startTime: 1_800,
      endTime: 3_480,
      startScreen: { x: 0, y: 0 },
      endScreen: { x: 168, y: -58 },
      startLogical: 100,
      endLogical: 128,
      minMove: 0.01,
      pricePrecision: 3,
    });

    expect(metrics.priceChange).toBeCloseTo(3.194, 10);
    expect(metrics.percentChange).toBeCloseTo((3.194 / 4_444.526) * 100, 10);
    expect(metrics.priceSteps).toBeCloseTo(319.4, 10);
    expect(metrics.barCount).toBe(28);
    expect(metrics.elapsedSeconds).toBe(1_680);
    expect(metrics.pixelDistance).toBeCloseTo(Math.hypot(168, 58), 10);
    expect(metrics.angleDegrees).toBeCloseTo(
      Math.atan2(58, 168) * (180 / Math.PI),
      10,
    );
    expect(metrics.display).toEqual({
      priceChange: '3.194',
      percentChange: '0.07',
      priceSteps: '319.4',
      bars: '28 bars',
      elapsed: '28m',
      pixelDistance: '178 px',
      angle: `${metrics.angleDegrees.toFixed(2)}\u00b0`,
    });
  });

  it('uses injected precision and min-move rather than XAUUSD-specific formatting', () => {
    const metrics = buildInfoLineMetrics({
      startPrice: 1.2,
      endPrice: 1.20037,
      startTime: 100,
      endTime: 161,
      startScreen: { x: 10, y: 30 },
      endScreen: { x: 10, y: 10 },
      startLogical: 5,
      endLogical: 6,
      minMove: 0.00001,
      pricePrecision: 5,
      percentPrecision: 4,
      anglePrecision: 1,
      pixelDistancePrecision: 1,
    });

    expect(metrics.priceSteps).toBeCloseTo(37, 8);
    expect(metrics.display).toEqual({
      priceChange: '0.00037',
      percentChange: '0.0308',
      priceSteps: '37',
      bars: '1 bar',
      elapsed: '1m 1s',
      pixelDistance: '20.0 px',
      angle: '90.0\u00b0',
    });
  });

  it('keeps downward measurements signed and handles unavailable percent or price-step bases', () => {
    const metrics = buildInfoLineMetrics({
      startPrice: 0,
      endPrice: -2,
      startTime: 500,
      endTime: 440,
      startScreen: { x: 30, y: 10 },
      endScreen: { x: 10, y: 20 },
      startLogical: 20,
      endLogical: 17,
      minMove: 0,
      pricePrecision: 2,
    });

    expect(metrics.priceChange).toBe(-2);
    expect(metrics.percentChange).toBeNull();
    expect(metrics.priceSteps).toBeNull();
    expect(metrics.barCount).toBe(3);
    expect(metrics.elapsedSeconds).toBe(60);
    expect(metrics.display.priceChange).toBe('-2.00');
    expect(metrics.display.percentChange).toBeNull();
    expect(metrics.display.priceSteps).toBeNull();
  });

  it.each([
    [0, '0s'],
    [59, '59s'],
    [60, '1m'],
    [61, '1m 1s'],
    [3_600, '1h'],
    [3_660, '1h 1m'],
    [86_400, '1d'],
    [90_000, '1d 1h'],
    [-120, '2m'],
  ] as const)('formats %i elapsed seconds as %s', (seconds, expected) => {
    expect(formatElapsedCompact(seconds)).toBe(expected);
  });
});

describe('TradingView channel third-anchor geometry', () => {
  const a = { x: 10, y: 20 };
  const b = { x: 90, y: 60 };
  const c = { x: 50, y: 100 };

  it('keeps a Parallel Channel on the A/B time span and derives its signed offset from C', () => {
    const geometry = createChannelGeometry('parallel_channel', a, b, c);

    expect(geometry).not.toBeNull();
    expectSegmentClose(geometry!.baseline, { start: a, end: b });
    expectSegmentClose(geometry!.boundary, {
      start: { x: 10, y: 80 },
      end: { x: 90, y: 120 },
    });
    expectSegmentClose(geometry!.midpoint, {
      start: { x: 10, y: 50 },
      end: { x: 90, y: 90 },
    });
    expect(geometry!.offsetVector).toEqual({ x: 0, y: 60 });
    expect(geometry!.signedPerpendicularOffset).toBeCloseTo(
      4_800 / Math.hypot(80, 40),
      10,
    );
    expect(geometry!.fillPolygon).toEqual([
      a,
      b,
      { x: 90, y: 120 },
      { x: 10, y: 80 },
    ]);
  });

  it('produces the same Parallel Channel when C moves along its derived boundary', () => {
    const first = createChannelGeometry('parallel_channel', a, b, c);
    const movedAlongBoundary = createChannelGeometry(
      'parallel_channel',
      a,
      b,
      { x: 70, y: 110 },
    );

    expect(movedAlongBoundary!.boundary).toEqual(first!.boundary);
    expect(movedAlongBoundary!.midpoint).toEqual(first!.midpoint);
  });

  it('uses an injectable channel-level ratio', () => {
    const geometry = createChannelGeometry(
      'parallel_channel',
      a,
      b,
      c,
      { midpointRatio: 0.25 },
    );

    expect(geometry!.midpointRatio).toBe(0.25);
    expectSegmentClose(geometry!.midpoint, {
      start: { x: 10, y: 35 },
      end: { x: 90, y: 75 },
    });
  });

  it('uses only C.y for a Flat Top/Bottom boundary over the A/B span', () => {
    const first = createChannelGeometry('flat_top_bottom', a, b, c);
    const movedC = createChannelGeometry('flat_top_bottom', a, b, { x: 1_000, y: 100 });

    expectSegmentClose(first!.boundary, {
      start: { x: 10, y: 100 },
      end: { x: 90, y: 100 },
    });
    expectSegmentClose(first!.midpoint, {
      start: { x: 10, y: 60 },
      end: { x: 90, y: 80 },
    });
    expect(movedC!.boundary).toEqual(first!.boundary);
  });

  it('matches the captured Disjoint Channel span and opposite-slope rails', () => {
    const sourceA = { x: 1_360, y: 620 };
    const sourceB = { x: 1_510, y: 575 };
    const sourceC = { x: 1_430, y: 705 };
    const geometry = createChannelGeometry('disjoint_channel', sourceA, sourceB, sourceC);

    expect(geometry).not.toBeNull();
    expectSegmentClose(geometry!.baseline, { start: sourceA, end: sourceB });
    expectSegmentClose(geometry!.boundary, {
      start: { x: 1_360, y: 660 },
      end: { x: 1_510, y: 705 },
    });
    expect(geometry!.boundary.start.x).toBe(sourceA.x);
    expect(geometry!.boundary.end.x).toBe(sourceB.x);

    const baselineSlopeDelta = geometry!.baseline.end.y - geometry!.baseline.start.y;
    const boundarySlopeDelta = geometry!.boundary.end.y - geometry!.boundary.start.y;
    expect(boundarySlopeDelta).toBe(-baselineSlopeDelta);
    expect(geometry!.offsetVector).toEqual({ x: 0, y: 40 });
  });

  it('ignores the Disjoint Channel third-click x-coordinate', () => {
    const sourceA = { x: 1_360, y: 620 };
    const sourceB = { x: 1_510, y: 575 };
    const first = createChannelGeometry(
      'disjoint_channel',
      sourceA,
      sourceB,
      { x: 1_430, y: 705 },
    );
    const movedHorizontally = createChannelGeometry(
      'disjoint_channel',
      sourceA,
      sourceB,
      { x: -10_000, y: 705 },
    );

    expect(movedHorizontally).toEqual(first);
  });

  it('derives the Disjoint Channel midpoint and fill from the captured rails', () => {
    const sourceA = { x: 1_360, y: 620 };
    const sourceB = { x: 1_510, y: 575 };
    const geometry = createChannelGeometry(
      'disjoint_channel',
      sourceA,
      sourceB,
      { x: 1_430, y: 705 },
    );

    expectSegmentClose(geometry!.midpoint, {
      start: { x: 1_360, y: 640 },
      end: { x: 1_510, y: 640 },
    });
    expect(geometry!.fillPolygon).toEqual([
      sourceA,
      sourceB,
      { x: 1_510, y: 705 },
      { x: 1_360, y: 660 },
    ]);
  });

  it('supports vertical Parallel Channels without inventing a pixel width', () => {
    const geometry = createChannelGeometry(
      'parallel_channel',
      { x: 20, y: 10 },
      { x: 20, y: 90 },
      { x: 55, y: 40 },
    );

    expectSegmentClose(geometry!.boundary, {
      start: { x: 55, y: 10 },
      end: { x: 55, y: 90 },
    });
    expect(geometry!.offsetVector).toEqual({ x: 35, y: 0 });
  });

  it('rejects a zero-length primary channel anchor pair', () => {
    expect(createChannelGeometry('parallel_channel', a, a, c)).toBeNull();
    expect(createChannelGeometry('flat_top_bottom', a, a, c)).toBeNull();
    expect(createChannelGeometry('disjoint_channel', a, a, c)).toBeNull();
  });
});

describe('TradingView regression-trend math', () => {
  const samples = [
    { x: 0, value: 1 },
    { x: 1, value: 2 },
    { x: 2, value: 4 },
    { x: 3, value: 5 },
  ];

  it('returns the exact OLS center and independently configured deviation bands', () => {
    const geometry = calculateRegressionTrend(samples, {
      upperDeviationMultiplier: 2,
      lowerDeviationMultiplier: 2,
    });

    expect(geometry).not.toBeNull();
    expect(geometry!.sampleCount).toBe(4);
    expect(geometry!.slope).toBeCloseTo(1.4, 12);
    expect(geometry!.intercept).toBeCloseTo(0.9, 12);
    expect(geometry!.residualStandardDeviation).toBeCloseTo(Math.sqrt(0.05), 12);
    expect(geometry!.pearsonCorrelation).toBeCloseTo(7 / Math.sqrt(50), 12);
    expect(geometry!.center.start).toEqual({ x: 0, value: expect.closeTo(0.9, 12) });
    expect(geometry!.center.end).toEqual({ x: 3, value: expect.closeTo(5.1, 12) });
    expect(geometry!.upper.start.value).toBeCloseTo(0.9 + (2 * Math.sqrt(0.05)), 12);
    expect(geometry!.upper.end.value).toBeCloseTo(5.1 + (2 * Math.sqrt(0.05)), 12);
    expect(geometry!.lower.start.value).toBeCloseTo(0.9 - (2 * Math.sqrt(0.05)), 12);
    expect(geometry!.lower.end.value).toBeCloseTo(5.1 - (2 * Math.sqrt(0.05)), 12);
  });

  it('changes only the requested band when asymmetric runtime multipliers change', () => {
    const geometry = calculateRegressionTrend(samples, {
      upperDeviationMultiplier: 1,
      lowerDeviationMultiplier: 3,
    })!;

    expect(geometry.center.start.value).toBeCloseTo(0.9, 12);
    expect(geometry.upper.start.value).toBeCloseTo(0.9 + Math.sqrt(0.05), 12);
    expect(geometry.lower.start.value).toBeCloseTo(0.9 - (3 * Math.sqrt(0.05)), 12);
  });

  it('sorts a copied sample set and remains invariant to input order', () => {
    const reversed = [...samples].reverse();
    const originalSnapshot = [...reversed];
    const geometry = calculateRegressionTrend(reversed, {
      upperDeviationMultiplier: 2,
      lowerDeviationMultiplier: 2,
    });

    expect(reversed).toEqual(originalSnapshot);
    expect(geometry).toEqual(calculateRegressionTrend(samples, {
      upperDeviationMultiplier: 2,
      lowerDeviationMultiplier: 2,
    }));
  });

  it('uses runtime x values instead of assuming fixed bar spacing', () => {
    const geometry = calculateRegressionTrend([
      { x: 10, value: 21 },
      { x: 20, value: 41 },
      { x: 40, value: 81 },
    ], {
      upperDeviationMultiplier: 1,
      lowerDeviationMultiplier: 1,
    });

    expect(geometry!.slope).toBeCloseTo(2, 12);
    expect(geometry!.intercept).toBeCloseTo(1, 12);
    expect(geometry!.pearsonCorrelation).toBeCloseTo(1, 12);
    expect(geometry!.center).toEqual({
      start: { x: 10, value: 21 },
      end: { x: 40, value: 81 },
    });
    expect(geometry!.residualStandardDeviation).toBeCloseTo(0, 12);
  });

  it("returns null Pearson's R when Y has no variance", () => {
    const geometry = calculateRegressionTrend([
      { x: 0, value: 7 },
      { x: 1, value: 7 },
      { x: 2, value: 7 },
    ], {
      upperDeviationMultiplier: 2,
      lowerDeviationMultiplier: 2,
    });

    expect(geometry).not.toBeNull();
    expect(geometry!.slope).toBe(0);
    expect(geometry!.residualStandardDeviation).toBe(0);
    expect(geometry!.pearsonCorrelation).toBeNull();
  });

  it('filters invalid samples and returns null rather than a hardcoded fallback band', () => {
    expect(calculateRegressionTrend([
      { x: 0, value: 1 },
      { x: Number.NaN, value: 99 },
      { x: 1, value: 3 },
    ], {
      upperDeviationMultiplier: 2,
      lowerDeviationMultiplier: 2,
    })?.sampleCount).toBe(2);

    expect(calculateRegressionTrend([], {
      upperDeviationMultiplier: 2,
      lowerDeviationMultiplier: 2,
    })).toBeNull();
    expect(calculateRegressionTrend([{ x: 1, value: 2 }], {
      upperDeviationMultiplier: 2,
      lowerDeviationMultiplier: 2,
    })).toBeNull();
    expect(calculateRegressionTrend([
      { x: 1, value: 2 },
      { x: 1, value: 3 },
    ], {
      upperDeviationMultiplier: 2,
      lowerDeviationMultiplier: 2,
    })).toBeNull();
  });
});

describe('TradingView pitchfork formulas and configurable levels', () => {
  const a = { x: 20, y: 20 };
  const b = { x: 60, y: 40 };
  const c = { x: 100, y: 80 };

  const formulas: readonly [
    PitchforkVariant,
    ScreenPoint,
    ScreenPoint,
    ScreenPoint,
  ][] = [
    ['pitchfork', { x: 20, y: 20 }, { x: 80, y: 60 }, { x: 60, y: 40 }],
    ['schiff_pitchfork', { x: 20, y: 30 }, { x: 80, y: 60 }, { x: 60, y: 30 }],
    ['modified_schiff_pitchfork', { x: 40, y: 30 }, { x: 80, y: 60 }, { x: 40, y: 30 }],
    ['inside_pitchfork', { x: 40, y: 30 }, { x: 100, y: 80 }, { x: 60, y: 50 }],
  ];

  it.each(formulas)(
    '%s resolves the exact TradingView median origin, target, and direction',
    (variant, expectedOrigin, expectedTarget, expectedDirection) => {
      const definition = resolvePitchforkMedian(a, b, c, variant);

      expect(definition).not.toBeNull();
      expectPointClose(definition!.origin, expectedOrigin);
      expectPointClose(definition!.target, expectedTarget);
      expectPointClose(definition!.direction, expectedDirection);
    },
  );

  it.each(formulas)(
    '%s creates a median and every configured tine as forward parallel rays',
    (variant, expectedOrigin, expectedTarget, expectedDirection) => {
      const geometry = createPitchforkLevels(a, b, c, 300, 200, variant);

      expect(geometry).not.toBeNull();
      expect(geometry!.ratios).toEqual([0, 0.5, 1]);
      expectPointClose(geometry!.medianOrigin, expectedOrigin);
      expectPointClose(geometry!.medianTarget, expectedTarget);
      expectPointClose(geometry!.direction, expectedDirection);
      expect(geometry!.median.role).toBe('median');
      expectPointClose(geometry!.median.segment.start, expectedOrigin);
      expect(geometry!.levels.map(level => level.ratio)).toEqual([0.5, 1]);
      expect(geometry!.rays).toHaveLength(5);
      geometry!.rays.slice(1).forEach(ray => expectParallel(geometry!.median.segment, ray.segment));
    },
  );

  it.each([
    ['pitchfork', b, c],
    ['schiff_pitchfork', b, c],
    ['modified_schiff_pitchfork', b, c],
  ] as const)('%s ratio-1 tines pass through B and C', (variant, first, second) => {
    const geometry = createPitchforkLevels(a, b, c, 300, 200, variant)!;
    const outer = geometry.levels.find(level => level.ratio === 1)!;
    const actualAnchors = [outer.upper.anchor, outer.lower.anchor];

    expect(actualAnchors).toEqual(expect.arrayContaining([first, second]));
  });

  it('uses A and B as the Inside Pitchfork ratio-1 tines', () => {
    const geometry = createPitchforkLevels(a, b, c, 300, 200, 'inside_pitchfork')!;
    const outer = geometry.levels.find(level => level.ratio === 1)!;

    expect([outer.upper.anchor, outer.lower.anchor]).toEqual(expect.arrayContaining([a, b]));
    expect([outer.upper.anchor, outer.lower.anchor]).not.toContainEqual(c);
  });

  it('interpolates injected ratios instead of assuming a fixed set of levels', () => {
    const geometry = createPitchforkLevels(
      a,
      b,
      c,
      300,
      200,
      'pitchfork',
      [1, 0.25, 0.75, 0.25],
    )!;

    expect(geometry.ratios).toEqual([0, 0.25, 0.75, 1]);
    expect(geometry.levels.map(level => level.ratio)).toEqual([0.25, 0.75, 1]);
    const quarter = geometry.levels[0];
    expectPointClose(quarter.upper.anchor, { x: 75, y: 55 });
    expectPointClose(quarter.lower.anchor, { x: 85, y: 65 });
  });

  it('returns ordered semantic band roles and their exact polygon inputs', () => {
    const geometry = createPitchforkLevels(a, b, c, 300, 200, 'pitchfork')!;

    expect(geometry.bands.map(band => [band.role, band.innerRatio, band.outerRatio])).toEqual([
      ['upper-band', 0, 0.5],
      ['lower-band', 0, 0.5],
      ['upper-band', 0.5, 1],
      ['lower-band', 0.5, 1],
    ]);
    geometry.bands.forEach((band) => {
      expect(band.polygon).toEqual([
        band.innerRay.segment.start,
        band.innerRay.segment.end,
        band.outerRay.segment.end,
        band.outerRay.segment.start,
      ]);
      expect(band.outerRay.role).toBe(
        band.role === 'upper-band' ? 'upper-level' : 'lower-level',
      );
    });
  });

  it('clips every returned ray to the injected viewport', () => {
    const geometry = createPitchforkLevels(a, b, c, 130, 100, 'pitchfork')!;

    geometry.rays.forEach((ray) => {
      [ray.segment.start, ray.segment.end].forEach((point) => {
        expect(point.x).toBeGreaterThanOrEqual(0);
        expect(point.x).toBeLessThanOrEqual(130);
        expect(point.y).toBeGreaterThanOrEqual(0);
        expect(point.y).toBeLessThanOrEqual(100);
      });
    });
  });

  it('returns null for a zero-length median instead of inventing geometry', () => {
    expect(createPitchforkLevels(
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: -10, y: 0 },
      100,
      100,
      'pitchfork',
    )).toBeNull();
  });
});
