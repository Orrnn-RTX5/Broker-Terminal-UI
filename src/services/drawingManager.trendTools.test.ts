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
  DrawingManager,
  type DrawingSeriesDataPoint,
  type DrawingSeriesDataProvider,
  type DrawingType,
} from './drawingManager';

const DEFAULT_SERIES_DATA: readonly DrawingSeriesDataPoint[] = [
  { time: 150, open: 99, high: 103, low: 98, close: 100 },
  { time: 180, open: 100, high: 106, low: 99, close: 104 },
  { time: 210, open: 104, high: 108, low: 103, close: 106 },
  { time: 240, open: 106, high: 110, low: 105, close: 109 },
];

interface RenderHarnessOptions {
  includeSeriesData?: boolean;
  seriesData?: readonly DrawingSeriesDataPoint[];
  seriesDataProvider?: DrawingSeriesDataProvider;
  pricePrecision?: number;
  minMove?: number;
  timeToCoordinate?: (time: number) => number;
  coordinateToLogical?: (coordinate: number) => number;
}

const createRenderHarness = async (options: RenderHarnessOptions = {}) => {
  const pricePrecision = options.pricePrecision ?? 2;
  const minMove = options.minMove ?? 0.01;
  const timeScale = {
    timeToCoordinate: options.timeToCoordinate ?? ((time: number) => Number(time) - 100),
    coordinateToTime: (coordinate: number) => coordinate + 100,
    logicalToCoordinate: (logical: number) => logical,
    coordinateToLogical: options.coordinateToLogical ?? ((coordinate: number) => coordinate),
    height: () => 20,
  };
  const chart = {
    timeScale: () => timeScale,
    priceScale: () => ({ width: () => 40 }),
  } as unknown as IChartApi;
  const seriesShape: Record<string, unknown> = {
    priceToCoordinate: (price: number) => 220 - price,
    coordinateToPrice: (coordinate: number) => 220 - coordinate,
    options: () => ({ priceFormat: { precision: pricePrecision, minMove } }),
    priceFormatter: () => ({ format: (price: number) => price.toFixed(pricePrecision) }),
  };
  if (options.includeSeriesData !== false) {
    seriesShape.data = () => options.seriesData ?? DEFAULT_SERIES_DATA;
  }
  const series = seriesShape as unknown as ISeriesApi<'Candlestick'>;
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
    options.seriesDataProvider,
  );
  await Promise.resolve();
  return { manager, container, chart, series };
};

const completeDrawing = (
  manager: DrawingManager,
  type: DrawingType,
  subtype: string,
  points: readonly { time: number; price: number }[],
): void => {
  manager.startDrawing(type, '#3b82f6', { subtype });
  points.forEach(point => manager.addPoint(point.time, point.price));
};

const numberAttribute = (element: Element, name: string): number =>
  Number(element.getAttribute(name));

describe('DrawingManager trend tool lifecycle', () => {
  beforeEach(() => {
    document.body.replaceChildren();
    window.localStorage.clear();
    vi.clearAllMocks();
  });

  it.each([
    ['horizontal_ray', 'hline', 1],
    ['crossline', 'vline', 1],
    ['trendline', 'trendline', 2],
    ['ray', 'trendline', 2],
    ['info_line', 'trendline', 2],
    ['extended_line', 'trendline', 2],
    ['trend_angle', 'trendline', 2],
    ['regression_trend', 'channel', 2],
    ['parallel_channel', 'channel', 3],
    ['flat_top_bottom', 'channel', 3],
    ['disjoint_channel', 'channel', 3],
    ['pitchfork', 'channel', 3],
    ['schiff_pitchfork', 'channel', 3],
    ['modified_schiff_pitchfork', 'channel', 3],
    ['inside_pitchfork', 'channel', 3],
  ] as const)('%s uses %s and commits after %i anchors', (subtype, type, requiredPoints) => {
    const manager = new DrawingManager();
    manager.startDrawing(type, '#3b82f6', { subtype });

    for (let index = 0; index < requiredPoints; index += 1) {
      const completed = manager.addPoint(1_700_000_000 + index * 60, 100 + index);
      expect(completed).toBe(index === requiredPoints - 1);
    }

    expect(manager.getActiveDrawing()).toBeNull();
  });

  it('retains the selected subtype in the saved drawing event', () => {
    const manager = new DrawingManager();
    const saved = vi.fn();
    window.addEventListener('drawing:saved', saved, { once: true });
    manager.startDrawing('channel', '#3b82f6', { subtype: 'pitchfork' });
    manager.addPoint(1, 10);
    manager.addPoint(2, 11);
    manager.addPoint(3, 12);

    expect(saved).toHaveBeenCalledOnce();
    expect((saved.mock.calls[0][0] as CustomEvent).detail).toMatchObject({
      type: 'channel',
      subtype: 'pitchfork',
      points: expect.arrayContaining([
        expect.objectContaining({ time: 1, price: 10 }),
      ]),
    });
  });

  it.each([
    ['ray', 'trendline', 2, 'line', 2],
    ['info_line', 'trendline', 2, 'rect', 1],
    ['trend_angle', 'trendline', 2, 'text', 1],
    ['horizontal_ray', 'hline', 1, 'line', 2],
    ['crossline', 'vline', 1, 'line', 4],
    ['parallel_channel', 'channel', 3, 'polygon', 1],
    ['regression_trend', 'channel', 2, 'polygon', 1],
    ['pitchfork', 'channel', 3, 'line', 7],
    ['inside_pitchfork', 'channel', 3, 'line', 11],
  ] as const)('renders committed %s SVG geometry', async (subtype, type, pointCount, selector, minimumCount) => {
    const { manager, container } = await createRenderHarness();
    manager.startDrawing(type, '#3b82f6', { subtype });
    const points = [
      { time: 150, price: 100 },
      { time: 240, price: 109 },
      { time: 180, price: 92 },
    ];
    points.slice(0, pointCount).forEach((point) => manager.addPoint(point.time, point.price));

    const drawingGroup = container.querySelector('svg g[data-id]');
    expect(drawingGroup).not.toBeNull();
    expect(drawingGroup!.querySelectorAll(selector).length).toBeGreaterThanOrEqual(minimumCount);
  });

  it('renders the Info Line as three measurement rows using runtime precision and min-move', async () => {
    const { manager, container } = await createRenderHarness({
      pricePrecision: 3,
      minMove: 0.01,
      timeToCoordinate: time => 50 + ((time - 150) / 60),
      coordinateToLogical: coordinate => coordinate,
    });
    completeDrawing(manager, 'trendline', 'info_line', [
      { time: 150, price: 100 },
      { time: 1_830, price: 103.194 },
    ]);

    const group = container.querySelector('svg g[data-id]')!;
    const firstRow = group.querySelector('[data-geometry-role="measurement-row-1"]');
    const secondRow = group.querySelector('[data-geometry-role="measurement-row-2"]');
    const thirdRow = group.querySelector('[data-geometry-role="measurement-row-3"]');

    expect(group.querySelector('[data-geometry-role="measurement-panel"]')).not.toBeNull();
    expect(group.querySelectorAll('[data-geometry-role^="measurement-row-"]')).toHaveLength(3);
    expect(firstRow?.textContent).toBe('3.194 (3.19%), 319.4');
    expect(secondRow?.textContent).toBe('28 bars (28m), distance: 28 px');
    expect(thirdRow?.textContent).toBe(
      `${(Math.atan2(3.194, 28) * (180 / Math.PI)).toFixed(2)}\u00b0`,
    );
  });

  it('renders Trend Angle with a short dotted reference and an inline degree label', async () => {
    const { manager, container } = await createRenderHarness();
    completeDrawing(manager, 'trendline', 'trend_angle', [
      { time: 150, price: 100 },
      { time: 210, price: 160 },
    ]);

    const reference = container.querySelector<SVGLineElement>(
      '[data-geometry-role="angle-reference"]',
    )!;
    const label = container.querySelector<SVGTextElement>(
      '[data-geometry-role="angle-label"]',
    )!;

    expect(reference).not.toBeNull();
    expect(reference.getAttribute('stroke-dasharray')).toBe('2 2');
    expect(numberAttribute(reference, 'x1')).toBe(50);
    expect(numberAttribute(reference, 'x2')).toBe(78);
    expect(numberAttribute(reference, 'y1')).toBe(120);
    expect(numberAttribute(reference, 'y2')).toBe(120);
    expect(numberAttribute(reference, 'x2') - numberAttribute(reference, 'x1')).toBeLessThan(60);
    expect(label.textContent).toBe('45.00\u00b0');
    expect(numberAttribute(label, 'x')).toBe(86);
    expect(numberAttribute(label, 'y')).toBe(123);
  });

  it.each([
    ['horizontal_line', 'hline', true, false],
    ['horizontal_ray', 'hline', true, false],
    ['vertical_line', 'vline', false, true],
    ['crossline', 'vline', true, true],
  ] as const)(
    '%s renders the expected price/time scale labels',
    async (subtype, type, hasPriceLabel, hasTimeLabel) => {
      const { manager, container } = await createRenderHarness({ pricePrecision: 3 });
      completeDrawing(manager, type, subtype, [{ time: 150, price: 100.125 }]);
      const group = container.querySelector('svg g[data-id]')!;
      const priceLabel = group.querySelector('[data-geometry-role="price-scale-label"]');
      const priceText = group.querySelector('[data-geometry-role="price-scale-label-text"]');
      const timeLabel = group.querySelector('[data-geometry-role="time-scale-label"]');
      const timeText = group.querySelector('[data-geometry-role="time-scale-label-text"]');

      expect(priceLabel !== null).toBe(hasPriceLabel);
      expect(priceText !== null).toBe(hasPriceLabel);
      expect(timeLabel !== null).toBe(hasTimeLabel);
      expect(timeText !== null).toBe(hasTimeLabel);
      if (hasPriceLabel) expect(priceText?.textContent).toBe('100.125');
      if (hasTimeLabel) {
        expect(timeText?.textContent).toMatch(/^\w{3} \d{2} \w{3} '\d{2} \d{2}:\d{2}$/);
      }
    },
  );

  it.each([
    ['horizontal_line', 'hline', 'x', 448],
    ['vertical_line', 'vline', 'y', 268],
  ] as const)(
    '%s exposes its source-style square edge control and Add text prompt',
    async (subtype, type, edgeAttribute, expectedEdge) => {
      const { manager, container } = await createRenderHarness();
      completeDrawing(manager, type, subtype, [{ time: 150, price: 100 }]);
      const group = container.querySelector('svg g[data-id]')!;
      const handle = group.querySelector<SVGRectElement>(
        'rect[data-geometry-role="selection-anchor-1"]',
      )!;

      expect(handle).not.toBeNull();
      expect(handle.getAttribute('width')).toBe(handle.getAttribute('height'));
      expect(numberAttribute(handle, edgeAttribute)).toBe(expectedEdge);
      expect(group.querySelector('[data-geometry-role="drawing-add-text-prompt"]')?.textContent)
        .toBe('+ Add text');
    },
  );

  it('keeps Parallel Channel boundaries on the A/B span and renders its middle level', async () => {
    const points = [
      { time: 150, price: 100 },
      { time: 240, price: 109 },
      { time: 180, price: 92 },
    ] as const;
    const parallelHarness = await createRenderHarness();
    completeDrawing(parallelHarness.manager, 'channel', 'parallel_channel', points);
    const parallelGroup = parallelHarness.container.querySelector('svg g[data-id]')!;
    const baseline = parallelGroup.querySelector('[data-geometry-role="channel-baseline"]')!;
    const boundary = parallelGroup.querySelector('[data-geometry-role="channel-boundary"]')!;
    const middle = parallelGroup.querySelector('[data-geometry-role="channel-middle-level"]')!;

    expect([numberAttribute(baseline, 'x1'), numberAttribute(baseline, 'x2')]).toEqual([50, 140]);
    expect([numberAttribute(boundary, 'x1'), numberAttribute(boundary, 'x2')]).toEqual([50, 140]);
    expect([numberAttribute(middle, 'x1'), numberAttribute(middle, 'x2')]).toEqual([50, 140]);
    expect(numberAttribute(middle, 'y1')).toBeCloseTo(
      (numberAttribute(baseline, 'y1') + numberAttribute(boundary, 'y1')) / 2,
      8,
    );

    const disjointHarness = await createRenderHarness();
    completeDrawing(disjointHarness.manager, 'channel', 'disjoint_channel', points);
    const disjointId = disjointHarness.manager.getDrawings()
      .find(drawing => drawing.subtype === 'disjoint_channel')!.id;
    const disjointGroup = disjointHarness.container.querySelector(`svg g[data-id="${disjointId}"]`)!;
    const disjointBoundary = disjointGroup.querySelector('[data-geometry-role="channel-boundary"]')!;

    expect([numberAttribute(disjointBoundary, 'x1'), numberAttribute(disjointBoundary, 'x2')])
      .toEqual([50, 140]);
    expect(disjointGroup.querySelector('[data-geometry-role="channel-middle-level"]')).toBeNull();
    expect(disjointBoundary.getAttribute('x1')).toBe(boundary.getAttribute('x1'));
  });

  it('uses the final setChart series-data provider for split Regression Trend geometry', async () => {
    const seriesDataProvider = vi.fn<() => readonly DrawingSeriesDataPoint[]>(() => [
      { time: 150, open: 99, high: 103, low: 98, close: 100 },
      { time: 180, open: 102, high: 106, low: 100, close: 104 },
      { time: 210, open: 105, high: 108, low: 103, close: 106 },
      { time: 240, open: 108, high: 111, low: 106, close: 109 },
    ]);
    const { manager, container, series } = await createRenderHarness({
      includeSeriesData: false,
      seriesDataProvider,
    });
    expect((series as unknown as { data?: unknown }).data).toBeUndefined();
    completeDrawing(manager, 'channel', 'regression_trend', [
      { time: 150, price: 100 },
      { time: 240, price: 109 },
    ]);

    const group = container.querySelector('svg g[data-id]')!;
    expect(seriesDataProvider).toHaveBeenCalled();
    expect(group.querySelector('polygon[data-geometry-role="regression-upper-fill"]')).not.toBeNull();
    expect(group.querySelector('polygon[data-geometry-role="regression-lower-fill"]')).not.toBeNull();
    expect(group.querySelector('line[data-geometry-role="regression-upper"]')).not.toBeNull();
    expect(group.querySelector('line[data-geometry-role="regression-center"]')).not.toBeNull();
    expect(group.querySelector('line[data-geometry-role="regression-lower"]')).not.toBeNull();
    expect(group.querySelector('[data-geometry-role="regression-pearson"]')?.textContent)
      .toMatch(/^Pearson's R = 0\.\d{6}$/);
  });

  it.each([
    'pitchfork',
    'schiff_pitchfork',
    'modified_schiff_pitchfork',
    'inside_pitchfork',
  ] as const)('%s renders semantic 0, 0.5, and 1 rays without duplicates', async (subtype) => {
    const { manager, container } = await createRenderHarness();
    completeDrawing(manager, 'channel', subtype, [
      { time: 150, price: 100 },
      { time: 240, price: 109 },
      { time: 180, price: 92 },
    ]);
    const group = container.querySelector('svg g[data-id]')!;
    const expectedRoles = [
      'pitchfork-median-0',
      'pitchfork-upper-level-0.5',
      'pitchfork-lower-level-0.5',
      'pitchfork-upper-level-1',
      'pitchfork-lower-level-1',
    ];
    const rays = expectedRoles.map((role) => {
      const ray = group.querySelector<SVGLineElement>(`line[data-geometry-role="${role}"]`);
      expect(ray, role).not.toBeNull();
      return ray!;
    });
    const segmentKeys = rays.map(ray => [
      ray.getAttribute('x1'),
      ray.getAttribute('y1'),
      ray.getAttribute('x2'),
      ray.getAttribute('y2'),
    ].join(':'));

    expect(group.querySelectorAll('line[data-geometry-role^="pitchfork-"]:not([data-geometry-role$="-hit"])'))
      .toHaveLength(subtype === 'pitchfork' ? 6 : 7);
    expect(new Set(segmentKeys).size).toBe(segmentKeys.length);
    expect(group.querySelectorAll('polygon[data-geometry-role^="upper-band"], polygon[data-geometry-role^="lower-band"]'))
      .toHaveLength(4);
    expect(rays[0].hasAttribute('stroke-dasharray')).toBe(false);
  });

  it.each([
    ['pitchfork', [
      [140, 111, 80, 128],
    ]],
    ['schiff_pitchfork', [
      [50, 120, 140, 111],
      [140, 111, 80, 128],
    ]],
    ['modified_schiff_pitchfork', [
      [50, 120, 140, 111],
      [140, 111, 80, 128],
    ]],
    ['inside_pitchfork', [
      [50, 120, 140, 111],
      [140, 111, 80, 128],
    ]],
  ] as const)(
    '%s renders the source construction scaffold before its median ray',
    async (subtype, expectedSegments) => {
      const { manager, container } = await createRenderHarness();
      completeDrawing(manager, 'channel', subtype, [
        { time: 150, price: 100 },
        { time: 240, price: 109 },
        { time: 180, price: 92 },
      ]);
      const group = container.querySelector('svg g[data-id]')!;
      const constructionSegments = Array.from(group.querySelectorAll<SVGLineElement>(
        'line[data-geometry-role^="pitchfork-construction-"]',
      )).map(line => [
        numberAttribute(line, 'x1'),
        numberAttribute(line, 'y1'),
        numberAttribute(line, 'x2'),
        numberAttribute(line, 'y2'),
      ]);

      expect(constructionSegments).toEqual(expectedSegments);
      expect(group.querySelector('line[data-geometry-role="pitchfork-median-0"]')).not.toBeNull();
    },
  );

  it.each([
    ['parallel_channel', 3, 4, 2],
    ['regression_trend', 2, 4, 0],
    ['flat_top_bottom', 3, 4, 0],
    ['disjoint_channel', 3, 3, 1],
  ] as const)(
    '%s exposes the source selection controls',
    async (subtype, pointCount, expectedCircleCount, expectedSquareCount) => {
      const { manager, container } = await createRenderHarness();
      completeDrawing(manager, 'channel', subtype, [
        { time: 150, price: 100 },
        { time: 240, price: 109 },
        { time: 180, price: 92 },
      ].slice(0, pointCount));
      const group = container.querySelector('svg g[data-id]')!;
      const circles = group.querySelectorAll<SVGCircleElement>(
        'circle[data-geometry-role^="selection-anchor-"]',
      );
      const squares = group.querySelectorAll<SVGRectElement>(
        'rect[data-geometry-role^="selection-anchor-"]',
      );

      expect(circles).toHaveLength(expectedCircleCount);
      expect(squares).toHaveLength(expectedSquareCount);
      circles.forEach((control) => expect(control.getAttribute('pointer-events')).toBe('all'));
      squares.forEach((control) => {
        expect(control.getAttribute('width')).toBe(control.getAttribute('height'));
        expect(control.getAttribute('pointer-events')).toBe('all');
      });
    },
  );

  it.each([
    'trendline',
    'ray',
    'info_line',
    'extended_line',
    'trend_angle',
  ] as const)(
    'selected %s exposes price and time chips for both endpoints',
    async (subtype) => {
      const { manager, container } = await createRenderHarness({ pricePrecision: 3 });
      completeDrawing(manager, 'trendline', subtype, [
        { time: 150, price: 100.125 },
        { time: 240, price: 109.875 },
      ]);
      const group = container.querySelector('svg g[data-id]')!;
      const priceChips = group.querySelectorAll<SVGRectElement>(
        'rect[data-geometry-role*="price-scale-label"]',
      );
      const priceTexts = Array.from(group.querySelectorAll<SVGTextElement>(
        'text[data-geometry-role*="price-scale-label"]',
      )).map(label => label.textContent);
      const timeChips = group.querySelectorAll<SVGRectElement>(
        'rect[data-geometry-role*="time-scale-label"]',
      );
      const timeTexts = Array.from(group.querySelectorAll<SVGTextElement>(
        'text[data-geometry-role*="time-scale-label"]',
      )).map(label => label.textContent);

      expect(priceChips).toHaveLength(2);
      expect(priceTexts).toEqual(['100.125', '109.875']);
      expect(timeChips).toHaveLength(2);
      expect(timeTexts).toHaveLength(2);
      expect(timeTexts.every(Boolean)).toBe(true);
      expect(new Set(timeTexts).size).toBe(2);
    },
  );

  it.each([
    ['trendline', 'trendline', 2, 2],
    ['inside_pitchfork', 'channel', 3, 3],
  ] as const)(
    'selects a newly committed %s and renders semantic circle handles',
    async (subtype, type, pointCount, handleCount) => {
      const { manager, container } = await createRenderHarness();
      completeDrawing(manager, type, subtype, [
        { time: 150, price: 100 },
        { time: 240, price: 109 },
        { time: 180, price: 92 },
      ].slice(0, pointCount));

      expect(manager.getDrawings()).toEqual([
        expect.objectContaining({ subtype, selected: true }),
      ]);
      const handles = container.querySelectorAll<SVGCircleElement>(
        'svg g[data-id] circle[data-geometry-role^="selection-anchor-"]',
      );
      expect(handles).toHaveLength(handleCount);
      handles.forEach((handle) => {
        expect(handle.getAttribute('r')).toBe('5');
        expect(handle.getAttribute('pointer-events')).toBe('all');
      });
    },
  );

  it.each([
    ['parallel_channel', 'channel-boundary'],
    ['flat_top_bottom', 'channel-boundary'],
    ['disjoint_channel', 'channel-boundary'],
    ['pitchfork', 'pitchfork-median-0'],
    ['schiff_pitchfork', 'pitchfork-median-0'],
    ['modified_schiff_pitchfork', 'pitchfork-median-0'],
    ['inside_pitchfork', 'pitchfork-median-0'],
  ] as const)(
    '%s previews through the third anchor without emitting drawing:saved early',
    async (subtype, finalPreviewRole) => {
      const { manager, container } = await createRenderHarness();
      const saved = vi.fn();
      window.addEventListener('drawing:saved', saved);
      try {
        manager.startDrawing('channel', '#3b82f6', { subtype });
        expect(manager.addPoint(150, 100)).toBe(false);
        manager.updatePreviewPoint(240, 109);
        expect(container.querySelector('g[data-id$="-preview"]')).not.toBeNull();
        expect(saved).not.toHaveBeenCalled();

        expect(manager.addPoint(240, 109)).toBe(false);
        manager.updatePreviewPoint(180, 92);
        expect(container.querySelector(
          `g[data-id$="-preview"] [data-geometry-role="${finalPreviewRole}"]`,
        )).not.toBeNull();
        expect(saved).not.toHaveBeenCalled();
        expect(manager.getDrawings()).toHaveLength(0);

        expect(manager.addPoint(180, 92)).toBe(true);
        expect(saved).toHaveBeenCalledOnce();
        expect(container.querySelector('g[data-id$="-preview"]')).toBeNull();
        expect(manager.getDrawings()).toHaveLength(1);
      } finally {
        window.removeEventListener('drawing:saved', saved);
      }
    },
  );
});
