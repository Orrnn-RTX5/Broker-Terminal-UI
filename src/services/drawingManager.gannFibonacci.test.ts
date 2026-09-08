// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { IChartApi, ISeriesApi } from 'lightweight-charts';

vi.mock('./drawingApi', () => ({
  drawingApi: {
    loadDrawings: vi.fn().mockResolvedValue([]),
    saveDrawing: vi.fn().mockResolvedValue('server-drawing'),
    deleteDrawing: vi.fn().mockResolvedValue(undefined),
  },
}));

import {
  GANN_FIBONACCI_TOOLS,
  getGannFibonacciTool,
  type GannFibonacciToolId,
} from '../drawing-tools/gannFibonacciToolCatalog';
import {
  DrawingManager,
  type DrawingSeriesDataPoint,
  type DrawingType,
} from './drawingManager';

const DEFAULT_SERIES_DATA: readonly DrawingSeriesDataPoint[] = [
  { time: 150, open: 99, high: 103, low: 98, close: 100 },
  { time: 180, open: 100, high: 106, low: 99, close: 104 },
  { time: 210, open: 104, high: 108, low: 103, close: 106 },
  { time: 240, open: 106, high: 110, low: 105, close: 109 },
];

const DRAWING_POINTS = [
  { time: 150, price: 100 },
  { time: 240, price: 109 },
  { time: 180, price: 92 },
] as const;

const createRenderHarness = async () => {
  const timeScale = {
    timeToCoordinate: (time: number) => Number(time) - 100,
    coordinateToTime: (coordinate: number) => coordinate + 100,
    logicalToCoordinate: (logical: number) => logical,
    coordinateToLogical: (coordinate: number) => coordinate,
    height: () => 20,
  };
  const chart = {
    timeScale: () => timeScale,
    priceScale: () => ({ width: () => 40 }),
  } as unknown as IChartApi;
  const series = {
    priceToCoordinate: (price: number) => 220 - price,
    coordinateToPrice: (coordinate: number) => 220 - coordinate,
    options: () => ({ priceFormat: { precision: 2, minMove: 0.01 } }),
    priceFormatter: () => ({ format: (price: number) => price.toFixed(2) }),
    data: () => DEFAULT_SERIES_DATA,
  } as unknown as ISeriesApi<'Candlestick'>;
  const container = document.createElement('div');
  Object.defineProperty(container, 'clientWidth', { value: 500 });
  Object.defineProperty(container, 'clientHeight', { value: 300 });
  document.body.appendChild(container);

  const manager = new DrawingManager();
  manager.setChart(
    chart,
    series,
    'TEST',
    1,
    container,
    'M1',
    'chart-test-m1',
    'account-test',
  );
  await Promise.resolve();

  return { manager, container };
};

const completeDrawing = (
  manager: DrawingManager,
  type: DrawingType,
  subtype: string | undefined,
  points: readonly { time: number; price: number }[],
): void => {
  manager.startDrawing(type, '#3b82f6', subtype ? { subtype } : undefined);
  points.forEach((point) => manager.addPoint(point.time, point.price));
};

const renderTool = async (id: GannFibonacciToolId) => {
  const tool = getGannFibonacciTool(id)!;
  const harness = await createRenderHarness();
  completeDrawing(
    harness.manager,
    tool.drawingType,
    tool.id,
    DRAWING_POINTS.slice(0, tool.requiredPoints),
  );
  const drawing = harness.manager.getDrawings().find((candidate) => candidate.subtype === id);
  expect(drawing).toBeDefined();
  const group = harness.container.querySelector<SVGGElement>(`svg g[data-id="${drawing!.id}"]`);
  expect(group).not.toBeNull();
  return { ...harness, group: group! };
};

const numberAttribute = (element: Element, name: string): number =>
  Number(element.getAttribute(name));

describe('Fibonacci cursor coordinates', () => {
  beforeEach(() => {
    document.body.replaceChildren();
    localStorage.clear();
    sessionStorage.clear();
  });
  it.each(GANN_FIBONACCI_TOOLS)('$label shows the first anchor, moving coordinates, and selected endpoints', async tool => {
    const { manager, container } = await createRenderHarness();
    manager.startDrawing(tool.drawingType, '#2962ff', { subtype: tool.id });
    manager.updatePreviewPoint(150, 100);
    const cursor = () => container.querySelector('[data-geometry-role="cursor-price-scale-label-text"]');
    expect(cursor()?.textContent).toBe('100.00');
    manager.addPoint(150, 100);
    expect(container.querySelector('[data-geometry-role="construction-anchor-1"]')).not.toBeNull();
    manager.updatePreviewPoint(240, 109);
    expect(cursor()?.textContent).toBe('109.00');
    manager.hidePreviewCursor('chart-test-m1');
    expect(cursor()).toBeNull();
    expect(container.querySelector('[data-geometry-role="anchor-1-price-scale-label-text"]')?.textContent).toBe('100.00');
    manager.updatePreviewPoint(240, 109);
    manager.addPoint(240, 109);
    if (tool.requiredPoints === 3) {
      manager.updatePreviewPoint(180, 92);
      expect(cursor()).not.toBeNull();
      manager.addPoint(180, 92);
    }
    expect(cursor()).toBeNull();
    expect(container.querySelectorAll('[data-geometry-role^="selection-anchor-"]')).toHaveLength(tool.requiredPoints);
    expect(container.querySelectorAll('text[data-geometry-role$="price-scale-label-text"]')).toHaveLength(tool.requiredPoints);
    expect(container.querySelectorAll('text[data-geometry-role$="time-scale-label-text"]')).toHaveLength(tool.requiredPoints);
    const drawing = manager.getDrawings()[0];
    manager.unselectDrawing(drawing.id);
    expect(container.querySelector('text[data-geometry-role$="price-scale-label-text"]')).toBeNull();
    manager.selectDrawing(drawing.id);
    expect(container.querySelectorAll('text[data-geometry-role$="price-scale-label-text"]')).toHaveLength(tool.requiredPoints);
  });
});

const screenPointFor = (point: { time: number; price: number }) => ({
  x: point.time - 100,
  y: 220 - point.price,
});

const screenDistance = (
  first: { time: number; price: number },
  second: { time: number; price: number },
): number => {
  const firstScreen = screenPointFor(first);
  const secondScreen = screenPointFor(second);
  return Math.hypot(
    secondScreen.x - firstScreen.x,
    secondScreen.y - firstScreen.y,
  );
};

const ROLE_EXPECTATIONS = [
  {
    id: 'fib_retracement',
    selectors: [
      ['line[data-geometry-role="fib-retracement-reference"]', 1],
      ['line[data-geometry-role^="fib-retracement-level-"]', 11],
      ['text[data-geometry-role^="fib-retracement-label-"]', 11],
      ['polygon[data-geometry-role^="fib-retracement-band-"]', 10],
    ],
  },
  {
    id: 'trend_based_fib_extension',
    selectors: [
      ['line[data-geometry-role="fib-extension-leg-ab"]', 1],
      ['line[data-geometry-role="fib-extension-leg-bc"]', 1],
      ['line[data-geometry-role^="fib-extension-level-"]', 11],
      ['text[data-geometry-role^="fib-extension-label-"]', 11],
      ['polygon[data-geometry-role^="fib-extension-band-"]', 10],
    ],
  },
  {
    id: 'fib_channel',
    selectors: [
      ['line[data-geometry-role="fib-channel-baseline"]', 1],
      ['polygon[data-geometry-role="fib-channel-fill"]', 1],
      ['line[data-geometry-role^="fib-channel-level-"]', 9],
      ['text[data-geometry-role^="fib-channel-label-"]', 10],
      ['polygon[data-geometry-role^="fib-channel-band-"]', 8],
    ],
  },
  {
    id: 'fib_time_zone',
    selectors: [
      ['line[data-geometry-role="fib-time-zone-reference"]', 1],
      ['line[data-geometry-role^="fib-time-zone-level-"]', 11],
      ['text[data-geometry-role^="fib-time-zone-label-"]', 11],
    ],
  },
  {
    id: 'fib_speed_resistance_fan',
    selectors: [
      ['line[data-geometry-role="fib-speed-fan-reference"]', 1],
      ['line[data-geometry-role^="fib-speed-fan-time-grid-"]', 7],
      ['line[data-geometry-role^="fib-speed-fan-price-grid-"]', 7],
      ['line[data-geometry-role^="fib-speed-fan-ray-price-"]', 7],
      ['line[data-geometry-role^="fib-speed-fan-ray-time-"]', 7],
      ['polygon[data-geometry-role^="fib-speed-fan-price-band-"]', 6],
      ['polygon[data-geometry-role^="fib-speed-fan-time-band-"]', 6],
    ],
  },
  {
    id: 'trend_based_fib_time',
    selectors: [
      ['line[data-geometry-role="trend-fib-time-leg-ab"]', 1],
      ['line[data-geometry-role="trend-fib-time-leg-bc"]', 1],
      ['line[data-geometry-role^="trend-fib-time-level-"]', 9],
      ['text[data-geometry-role^="trend-fib-time-label-"]', 9],
      ['polygon[data-geometry-role^="trend-fib-time-band-"]', 8],
    ],
  },
  {
    id: 'fib_circles',
    selectors: [
      ['line[data-geometry-role="fib-circles-reference"]', 1],
      ['ellipse[data-geometry-role^="fib-circle-level-"]', 10],
      ['path[data-geometry-role^="fib-circle-band-"]', 10],
      ['text[data-geometry-role^="fib-circle-label-"]', 10],
    ],
  },
  {
    id: 'fib_spiral',
    selectors: [
      ['line[data-geometry-role="fib-spiral-reference"]', 1],
      ['path[data-geometry-role="fib-spiral"]', 1],
    ],
  },
  {
    id: 'fib_speed_resistance_arcs',
    selectors: [
      ['line[data-geometry-role="fib-speed-arcs-reference"]', 1],
      ['path[data-geometry-role^="fib-speed-arc-level-"]', 10],
      ['path[data-geometry-role^="fib-speed-arc-band-"]', 10],
    ],
  },
  {
    id: 'fib_wedge',
    selectors: [
      ['line[data-geometry-role^="fib-wedge-boundary-"]', 2],
      ['path[data-geometry-role^="fib-wedge-arc-level-"]', 6],
    ],
  },
  {
    id: 'pitchfan',
    selectors: [
      ['line[data-geometry-role="pitchfan-construction-ab"]', 1],
      ['line[data-geometry-role="pitchfan-construction-bc"]', 1],
      ['line[data-geometry-role="pitchfan-median"]', 1],
      ['line[data-geometry-role^="pitchfan-ray-"]', 6],
      ['polygon[data-geometry-role^="pitchfan-band-"]', 6],
    ],
  },
  {
    id: 'gann_box',
    selectors: [
      ['rect[data-geometry-role="gann-box-frame"]', 1],
      ['line[data-geometry-role^="gann-box-time-level-"]', 5],
      ['line[data-geometry-role^="gann-box-price-level-"]', 5],
      ['polygon[data-geometry-role^="gann-box-time-band-"]', 6],
      ['polygon[data-geometry-role^="gann-box-price-band-"]', 6],
    ],
  },
  {
    id: 'gann_square_fixed',
    selectors: [
      ['rect[data-geometry-role="gann-square-fixed-frame"]', 1],
      ['line[data-geometry-role^="gann-square-fixed-grid-vertical-"]', 5],
      ['line[data-geometry-role^="gann-square-fixed-grid-horizontal-"]', 5],
      ['line[data-geometry-role^="gann-square-fixed-fan-"]', 4],
      ['path[data-geometry-role^="gann-square-fixed-arc-"]', 5],
      ['path[data-geometry-role^="gann-square-fixed-band-"]', 5],
    ],
  },
  {
    id: 'gann_square',
    selectors: [
      ['rect[data-geometry-role="gann-square-frame"]', 1],
      ['line[data-geometry-role^="gann-square-grid-vertical-"]', 5],
      ['line[data-geometry-role^="gann-square-grid-horizontal-"]', 5],
      ['line[data-geometry-role^="gann-square-fan-"]', 5],
      ['path[data-geometry-role^="gann-square-arc-"]', 6],
    ],
  },
  {
    id: 'gann_fan',
    selectors: [
      ['line[data-geometry-role^="gann-fan-ray-"]', 9],
      ['line[data-geometry-role="gann-fan-ray-1x1"]', 1],
      ['text[data-geometry-role="gann-fan-label-1x1"]', 1],
      ['polygon[data-geometry-role^="gann-fan-band-"]', 8],
    ],
  },
] as const;

describe('DrawingManager Gann/Fibonacci lifecycle', () => {
  beforeEach(() => {
    document.body.replaceChildren();
    window.localStorage.clear();
    vi.clearAllMocks();
  });

  it.each(GANN_FIBONACCI_TOOLS)(
    '$id commits only after $requiredPoints anchors and preserves its semantic subtype',
    (tool) => {
      const manager = new DrawingManager();
      const saved = vi.fn();
      window.addEventListener('drawing:saved', saved);

      try {
        manager.startDrawing(tool.drawingType, '#3b82f6', { subtype: tool.id });
        DRAWING_POINTS.slice(0, tool.requiredPoints).forEach((point, index) => {
          const completed = manager.addPoint(point.time, point.price);
          const isFinalAnchor = index === tool.requiredPoints - 1;

          expect(completed).toBe(isFinalAnchor);
          if (!isFinalAnchor) {
            expect(manager.getActiveDrawing()).toMatchObject({
              type: tool.drawingType,
              subtype: tool.id,
              points: expect.any(Array),
            });
            expect(manager.getActiveDrawing()?.points).toHaveLength(index + 1);
            expect(saved).not.toHaveBeenCalled();
          }
        });

        expect(manager.getActiveDrawing()).toBeNull();
        expect(saved).toHaveBeenCalledOnce();
        expect((saved.mock.calls[0][0] as CustomEvent).detail).toMatchObject({
          type: tool.drawingType,
          subtype: tool.id,
          points: DRAWING_POINTS.slice(0, tool.requiredPoints),
        });
      } finally {
        window.removeEventListener('drawing:saved', saved);
      }
    },
  );
});

describe('DrawingManager Gann/Fibonacci SVG rendering', () => {
  beforeEach(() => {
    document.body.replaceChildren();
    window.localStorage.clear();
    vi.clearAllMocks();
  });

  it.each(ROLE_EXPECTATIONS)(
    '$id renders its distinctive semantic SVG role families',
    async ({ id, selectors }) => {
      const { group } = await renderTool(id);

      selectors.forEach(([selector, expectedCount]) => {
        expect(group.querySelectorAll(selector), selector).toHaveLength(expectedCount);
      });

      const roles = Array.from(group.querySelectorAll<SVGElement>('[data-geometry-role]'))
        .map((element) => element.getAttribute('data-geometry-role'));
      expect(new Set(roles).size).toBe(roles.length);
    },
  );

  it('keeps Fib channel levels parallel to its baseline', async () => {
    const { group } = await renderTool('fib_channel');
    const baseline = group.querySelector<SVGLineElement>(
      'line[data-geometry-role="fib-channel-baseline"]',
    )!;
    const baselineSlope = (
      numberAttribute(baseline, 'y2') - numberAttribute(baseline, 'y1')
    ) / (
      numberAttribute(baseline, 'x2') - numberAttribute(baseline, 'x1')
    );

    group.querySelectorAll<SVGLineElement>('line[data-geometry-role^="fib-channel-level-"]')
      .forEach((level) => {
        const slope = (
          numberAttribute(level, 'y2') - numberAttribute(level, 'y1')
        ) / (
          numberAttribute(level, 'x2') - numberAttribute(level, 'x1')
        );
        expect(slope).toBeCloseTo(baselineSlope, 8);
      });
  });

  it.each([
    [100, 109],
    [109, 100],
  ])('anchors retracement zero to the endpoint for %s -> %s', async (start, end) => {
    const { manager, container } = await createRenderHarness();
    completeDrawing(manager, 'fibonacci', 'fib_retracement', [
      { time: 150, price: start },
      { time: 240, price: end },
    ]);
    const level = (ratio: string) => container.querySelector<SVGLineElement>(
      `[data-geometry-role="fib-retracement-level-${ratio}"]`,
    )!;
    expect(numberAttribute(level('0'), 'y1')).toBe(220 - end);
    expect(numberAttribute(level('1'), 'y1')).toBe(220 - start);
    expect(numberAttribute(level('0-618'), 'y1')).toBeCloseTo(220 - (end + (start - end) * 0.618));
    expect(numberAttribute(level('4-236'), 'y1')).toBeCloseTo(220 - (end + (start - end) * 4.236));
    expect(container.querySelector('[data-geometry-role="fib-retracement-label-0"]')?.textContent)
      .toBe(`0 (${end.toFixed(2)})`);
  });

  it('applies the selected line width and style to retracement levels', async () => {
    const { manager, container } = await createRenderHarness();
    completeDrawing(manager, 'fibonacci', 'fib_retracement', DRAWING_POINTS.slice(0, 2));
    const drawing = manager.getDrawings()[0];
    manager.updateDrawingProperties(drawing.id, { lineWidth: 4, lineStyle: 'dashed' });
    const level = container.querySelector('[data-geometry-role="fib-retracement-level-0-618"]')!;
    expect(level.getAttribute('stroke-width')).toBe('4');
    expect(level.getAttribute('stroke-dasharray')).not.toBeNull();
  });

  it('bounds retracement and trend-extension bands to their observed anchor spans', async () => {
    const { group: retracement } = await renderTool('fib_retracement');
    retracement.querySelectorAll<SVGLineElement>(
      'line[data-geometry-role^="fib-retracement-level-"]',
    ).forEach((level) => {
      expect(numberAttribute(level, 'x1')).toBe(50);
      expect(numberAttribute(level, 'x2')).toBe(140);
    });
    expect(retracement.querySelectorAll(
      'polygon[data-geometry-role^="fib-retracement-band-"]',
    )).toHaveLength(10);

    const { group: extension } = await renderTool('trend_based_fib_extension');
    extension.querySelectorAll<SVGLineElement>(
      'line[data-geometry-role^="fib-extension-level-"]',
    ).forEach((level) => {
      expect(numberAttribute(level, 'x1')).toBe(80);
      expect(numberAttribute(level, 'x2')).toBe(140);
    });
    expect(extension.querySelectorAll(
      'polygon[data-geometry-role^="fib-extension-band-"]',
    )).toHaveLength(10);
  });

  it.each([
    ['fib_speed_resistance_fan', 'line[data-geometry-role^="fib-speed-fan-ray-"]'],
    ['pitchfan', 'line[data-geometry-role^="pitchfan-ray-"], line[data-geometry-role="pitchfan-median"]'],
    ['gann_fan', 'line[data-geometry-role^="gann-fan-ray-"]'],
  ] as const)('%s projects every ratio ray to a plot boundary', async (id, selector) => {
    const { group } = await renderTool(id);
    group.querySelectorAll<SVGLineElement>(selector).forEach((ray) => {
      const x = numberAttribute(ray, 'x2');
      const y = numberAttribute(ray, 'y2');
      expect(
        Math.abs(x) < 0.000001
        || Math.abs(x - 460) < 0.000001
        || Math.abs(y) < 0.000001
        || Math.abs(y - 280) < 0.000001,
      ).toBe(true);
    });
  });

  it('uses the observed extended circle ratios and P1-centered resistance arcs', async () => {
    const { group: circles } = await renderTool('fib_circles');
    expect(circles.querySelector(
      '[data-geometry-role="fib-circle-level-4-236"]',
    )).not.toBeNull();

    const { group: arcs } = await renderTool('fib_speed_resistance_arcs');
    const outerArc = arcs.querySelector<SVGPathElement>(
      '[data-geometry-role="fib-speed-arc-level-4-236"]',
    )!;
    expect(outerArc).not.toBeNull();
    expect(outerArc.getAttribute('d')).toMatch(/^M[^ ]+ 120 A/);
    expect(outerArc.getAttribute('d')).toMatch(/ 120$/);
    const [, radiusX, radiusY] = outerArc.getAttribute('d')!.match(/A([^ ]+) ([^ ]+) /)!;
    expect(Number(radiusX)).toBeCloseTo(Number(radiusY), 8);
  });

  it('uses the recorded trend-time and Gann-box ratio grids', async () => {
    const { group: trendTime } = await renderTool('trend_based_fib_time');
    expect(trendTime.querySelector(
      '[data-geometry-role="trend-fib-time-level-1-382"]',
    )).not.toBeNull();
    expect(trendTime.querySelector(
      '[data-geometry-role="trend-fib-time-level-2-382"]',
    )).not.toBeNull();

    const { group: gannBox } = await renderTool('gann_box');
    const level = gannBox.querySelector<SVGLineElement>(
      '[data-geometry-role="gann-box-time-level-0-382"]',
    )!;
    expect(numberAttribute(level, 'x1')).toBeCloseTo(50 + 90 * 0.382, 8);
    expect(gannBox.querySelector('[data-geometry-role^="gann-box-angle-"]')).toBeNull();
  });

  it.each([
    ['fib_time_zone', 'line[data-geometry-role^="fib-time-zone-level-"]'],
    ['trend_based_fib_time', 'line[data-geometry-role^="trend-fib-time-level-"]'],
  ] as const)('%s renders full-height vertical time levels', async (id, selector) => {
    const { group } = await renderTool(id);
    group.querySelectorAll<SVGLineElement>(selector).forEach((level) => {
      expect(numberAttribute(level, 'x1')).toBe(numberAttribute(level, 'x2'));
      expect(numberAttribute(level, 'y1')).toBe(0);
      expect(numberAttribute(level, 'y2')).toBe(280);
    });
  });

  it('renders Fib circles as concentric, progressively larger ellipses', async () => {
    const { group } = await renderTool('fib_circles');
    const circles = Array.from(group.querySelectorAll<SVGEllipseElement>(
      'ellipse[data-geometry-role^="fib-circle-level-"]',
    ));
    expect(new Set(circles.map((circle) => circle.getAttribute('cx'))).size).toBe(1);
    expect(new Set(circles.map((circle) => circle.getAttribute('cy'))).size).toBe(1);
    expect(numberAttribute(circles[0], 'cx')).toBe(95);
    expect(numberAttribute(circles[0], 'cy')).toBe(115.5);
    for (let index = 1; index < circles.length; index += 1) {
      expect(numberAttribute(circles[index], 'rx')).toBeGreaterThan(numberAttribute(circles[index - 1], 'rx'));
      expect(numberAttribute(circles[index], 'ry')).toBeGreaterThan(numberAttribute(circles[index - 1], 'ry'));
    }
  });

  it('keeps Fib Wedge staged after P2 and projects its P3 preview and commit onto P2 radius', async () => {
    const { manager, container } = await createRenderHarness();
    manager.startDrawing('fib_extension', '#3b82f6', { subtype: 'fib_wedge' });

    expect(manager.addPoint(150, 100)).toBe(false);
    expect(manager.addPoint(240, 109)).toBe(false);

    const stage = container.querySelector<SVGGElement>('svg g[data-id$="-stage"]')!;
    expect(stage).not.toBeNull();
    expect(stage.querySelector('[data-geometry-role="fib-wedge-boundary-start"]')).not.toBeNull();
    expect(stage.querySelector('[data-geometry-role="fib-wedge-boundary-end"]')).toBeNull();
    expect(stage.querySelector('[data-geometry-role^="fib-wedge-arc-level-"]')).toBeNull();

    manager.updatePreviewPoint(180, 92);
    const preview = container.querySelector<SVGGElement>('svg g[data-id$="-preview"]')!;
    const previewStart = preview.querySelector<SVGLineElement>(
      '[data-geometry-role="fib-wedge-boundary-start"]',
    )!;
    const previewEnd = preview.querySelector<SVGLineElement>(
      '[data-geometry-role="fib-wedge-boundary-end"]',
    )!;
    expect(Math.hypot(
      numberAttribute(previewStart, 'x2') - numberAttribute(previewStart, 'x1'),
      numberAttribute(previewStart, 'y2') - numberAttribute(previewStart, 'y1'),
    )).toBeCloseTo(Math.hypot(
      numberAttribute(previewEnd, 'x2') - numberAttribute(previewEnd, 'x1'),
      numberAttribute(previewEnd, 'y2') - numberAttribute(previewEnd, 'y1'),
    ), 8);

    expect(manager.addPoint(180, 92)).toBe(true);
    const wedge = manager.getDrawings().find((drawing) => drawing.subtype === 'fib_wedge')!;
    expect(wedge.points).toHaveLength(3);
    expect(screenDistance(wedge.points[0], wedge.points[2])).toBeCloseTo(
      screenDistance(wedge.points[0], wedge.points[1]),
      8,
    );
    expect(wedge.points[2]).not.toMatchObject({ time: 180, price: 92 });
  });

  it('renders Fib Wedge rays from its two real boundary anchors', async () => {
    const { manager, container } = await createRenderHarness();
    completeDrawing(manager, 'fib_extension', 'fib_wedge', DRAWING_POINTS);
    const wedge = manager.getDrawings().find((drawing) => drawing.subtype === 'fib_wedge')!;
    const group = container.querySelector<SVGGElement>(`svg g[data-id="${wedge.id}"]`)!;
    const startBoundary = group.querySelector<SVGLineElement>(
      '[data-geometry-role="fib-wedge-boundary-start"]',
    )!;
    const endBoundary = group.querySelector<SVGLineElement>(
      '[data-geometry-role="fib-wedge-boundary-end"]',
    )!;
    const expectedSecond = screenPointFor(wedge.points[1]);
    const expectedThird = screenPointFor(wedge.points[2]);

    expect(numberAttribute(startBoundary, 'x2')).toBeCloseTo(expectedSecond.x, 8);
    expect(numberAttribute(startBoundary, 'y2')).toBeCloseTo(expectedSecond.y, 8);
    expect(numberAttribute(endBoundary, 'x2')).toBeCloseTo(expectedThird.x, 8);
    expect(numberAttribute(endBoundary, 'y2')).toBeCloseTo(expectedThird.y, 8);
  });

  it('reprojects Fib Wedge P3 after each individual anchor is edited', async () => {
    const { manager, container } = await createRenderHarness();
    completeDrawing(manager, 'fib_extension', 'fib_wedge', DRAWING_POINTS);

    const dragAnchor = (index: number, dx: number, dy: number) => {
      const wedge = manager.getDrawings().find((drawing) => drawing.subtype === 'fib_wedge')!;
      const initial = screenPointFor(wedge.points[index]);
      const handle = container.querySelector(
        `[data-geometry-role="selection-anchor-${index + 1}"]`,
      )!;
      handle.dispatchEvent(new MouseEvent('pointerdown', {
        bubbles: true,
        clientX: initial.x,
        clientY: initial.y,
      }));
      window.dispatchEvent(new MouseEvent('pointermove', {
        clientX: initial.x + dx,
        clientY: initial.y + dy,
      }));
      window.dispatchEvent(new MouseEvent('pointerup'));

      const updated = manager.getDrawings().find((drawing) => drawing.subtype === 'fib_wedge')!;
      expect(screenDistance(updated.points[0], updated.points[2])).toBeCloseTo(
        screenDistance(updated.points[0], updated.points[1]),
        8,
      );
    };

    dragAnchor(2, -30, 45);
    dragAnchor(1, 35, -20);
    dragAnchor(0, -15, 25);
  });

  it.each([
    ['fib_speed_resistance_fan', 'line[data-geometry-role^="fib-speed-fan-ray-"]'],
    ['pitchfan', 'line[data-geometry-role^="pitchfan-ray-"], line[data-geometry-role="pitchfan-median"]'],
    ['gann_fan', 'line[data-geometry-role^="gann-fan-ray-"]'],
  ] as const)('%s renders a true shared-origin fan', async (id, selector) => {
    const { group } = await renderTool(id);
    const rays = Array.from(group.querySelectorAll<SVGLineElement>(selector));
    expect(rays.length).toBeGreaterThan(1);
    expect(new Set(rays.map((ray) => ray.getAttribute('x1'))).size).toBe(1);
    expect(new Set(rays.map((ray) => ray.getAttribute('y1'))).size).toBe(1);
  });

  it('uses arc paths for resistance arcs and wedge levels, and a dense path for the spiral', async () => {
    for (const [id, selector] of [
      ['fib_speed_resistance_arcs', 'path[data-geometry-role^="fib-speed-arc-level-"]'],
      ['fib_wedge', 'path[data-geometry-role^="fib-wedge-arc-level-"]'],
    ] as const) {
      const { group } = await renderTool(id);
      group.querySelectorAll<SVGPathElement>(selector).forEach((arc) => {
        expect(arc.getAttribute('d')).toMatch(/\bA/);
      });
    }

    const { group: spiralGroup } = await renderTool('fib_spiral');
    const pathData = spiralGroup.querySelector<SVGPathElement>(
      'path[data-geometry-role="fib-spiral"]',
    )!.getAttribute('d')!;
    expect(pathData.match(/\b[ML]/g)?.length).toBeGreaterThan(90);
  });

  it('distinguishes a fixed Gann square from the endpoint-scaled Gann square', async () => {
    const { group: fixedGroup } = await renderTool('gann_square_fixed');
    const fixedFrame = fixedGroup.querySelector<SVGRectElement>(
      'rect[data-geometry-role="gann-square-fixed-frame"]',
    )!;
    const { group: scaledGroup } = await renderTool('gann_square');
    const scaledFrame = scaledGroup.querySelector<SVGRectElement>(
      'rect[data-geometry-role="gann-square-frame"]',
    )!;

    expect(numberAttribute(fixedFrame, 'width')).toBeCloseTo(numberAttribute(fixedFrame, 'height'), 8);
    expect(numberAttribute(fixedFrame, 'width')).toBeCloseTo(Math.hypot(90, 9), 8);
    expect(Math.abs(
      numberAttribute(scaledFrame, 'width') - numberAttribute(scaledFrame, 'height'),
    )).toBeGreaterThan(1);
  });

  it.each(GANN_FIBONACCI_TOOLS)(
    '$id never emits NaN or Infinity for coincident anchors',
    async (tool) => {
      const { manager, container } = await createRenderHarness();
      const coincidentPoints = Array.from(
        { length: tool.requiredPoints },
        () => ({ time: 150, price: 100 }),
      );
      completeDrawing(manager, tool.drawingType, tool.id, coincidentPoints);

      const drawing = manager.getDrawings().find((candidate) => candidate.subtype === tool.id);
      expect(drawing).toBeDefined();
      const group = container.querySelector(`svg g[data-id="${drawing!.id}"]`);
      expect(group?.querySelector('[data-geometry-role]')).not.toBeNull();
      expect(group?.outerHTML).not.toMatch(/NaN|Infinity/);
    },
  );

  it.each([
    ['fibonacci', 2, 'fib-retracement-reference'],
    ['fib_extension', 3, 'fib-extension-leg-bc'],
  ] as const)(
    'keeps subtype-less legacy %s drawings visible through their default renderer',
    async (type, requiredPoints, expectedRole) => {
      const { manager, container } = await createRenderHarness();
      completeDrawing(manager, type, undefined, DRAWING_POINTS.slice(0, requiredPoints));

      const drawing = manager.getDrawings().find((candidate) => candidate.type === type);
      expect(drawing).toMatchObject({ type });
      expect(drawing?.subtype).toBeUndefined();
      const group = container.querySelector(`svg g[data-id="${drawing!.id}"]`)!;
      expect(group.querySelector(`[data-geometry-role="${expectedRole}"]`)).not.toBeNull();
    },
  );
});
