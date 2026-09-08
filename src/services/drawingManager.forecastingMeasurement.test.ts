// @vitest-environment jsdom

import type { IChartApi, ISeriesApi } from 'lightweight-charts';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  deleteDrawingMock,
  loadDrawingsMock,
  saveDrawingMock,
} = vi.hoisted(() => ({
  deleteDrawingMock: vi.fn().mockResolvedValue(undefined),
  loadDrawingsMock: vi.fn().mockResolvedValue([]),
  saveDrawingMock: vi.fn().mockResolvedValue('server-forecast-drawing'),
}));

vi.mock('./drawingApi', () => ({
  drawingApi: {
    loadDrawings: loadDrawingsMock,
    saveDrawing: saveDrawingMock,
    deleteDrawing: deleteDrawingMock,
  },
}));

import {
  FORECASTING_MEASUREMENT_TOOLS,
} from '../drawing-tools/forecastingMeasurementToolCatalog';
import { buildDrawingStorageKey } from '../drawing-tools/contextKey';
import {
  DrawingManager,
  type DrawingSeriesDataPoint,
  type DrawingSeriesDataProvider,
} from './drawingManager';

const CONTEXT_ID = 'chart-forecast-m1';
const CONTEXT_ID_OTHER = 'chart-other-m1';
const SYMBOL = 'TEST';
const TIMEFRAME = 'M1';
const ACCOUNT_SCOPE = 'account-test';

const STORAGE_IDENTITY = {
  contextId: CONTEXT_ID,
  symbol: SYMBOL,
  timeframe: TIMEFRAME,
  accountScope: ACCOUNT_SCOPE,
} as const;

const DRAWING_POINTS = [
  { time: 120, price: 100, logicalIndex: 10 },
  { time: 180, price: 106, logicalIndex: 11 },
  { time: 240, price: 97, logicalIndex: 12 },
] as const;

const expectedCommittedPoints = (toolId: string, requiredPoints: number) => (
  toolId === 'sector'
    ? [
      DRAWING_POINTS[0],
      DRAWING_POINTS[1],
      { time: 180, price: 97, logicalIndex: 11 },
    ]
    : DRAWING_POINTS.slice(0, requiredPoints)
);

interface HarnessOptions {
  seriesData?: readonly DrawingSeriesDataPoint[];
  seriesDataProvider?: DrawingSeriesDataProvider;
  timeToCoordinate?: (time: number) => number | null;
  coordinateToTime?: (coordinate: number) => number | null;
  logicalToCoordinate?: (logicalIndex: number) => number | null;
  coordinateToLogical?: (coordinate: number) => number | null;
}

const createHarness = async (options: HarnessOptions = {}) => {
  const timeToCoordinate = vi.fn(
    options.timeToCoordinate ?? ((time: number) => time - 60),
  );
  const logicalToCoordinate = vi.fn(
    options.logicalToCoordinate ?? ((logicalIndex: number) => logicalIndex * 8),
  );
  const timeScale = {
    timeToCoordinate,
    coordinateToTime: options.coordinateToTime ?? ((coordinate: number) => coordinate + 60),
    logicalToCoordinate,
    coordinateToLogical: options.coordinateToLogical ?? ((coordinate: number) => coordinate / 8),
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
    data: () => options.seriesData ?? [],
  } as unknown as ISeriesApi<'Candlestick'>;
  const container = document.createElement('div');
  Object.defineProperty(container, 'clientWidth', { value: 500 });
  Object.defineProperty(container, 'clientHeight', { value: 300 });
  document.body.appendChild(container);

  const manager = new DrawingManager();
  manager.setChart(
    chart,
    series,
    SYMBOL,
    1,
    container,
    TIMEFRAME,
    CONTEXT_ID,
    ACCOUNT_SCOPE,
    options.seriesDataProvider,
  );
  await Promise.resolve();

  return {
    manager,
    container,
    chart,
    series,
    timeToCoordinate,
    logicalToCoordinate,
  };
};

const readPersistedDrawings = () => {
  const raw = localStorage.getItem(buildDrawingStorageKey(STORAGE_IDENTITY));
  expect(raw).not.toBeNull();
  return JSON.parse(raw!) as Array<Record<string, unknown>>;
};

describe('DrawingManager Forecasting and Measurement lifecycle', () => {
  it('includes measurement callouts in the toolbar avoidance bounds', async () => {
    const { manager } = await createHarness();
    const rectSpy = vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) {
      const annotation = this.getAttribute('data-geometry-role')?.endsWith('-background');
      return { x: 0, y: annotation ? 70 : 0, left: 0, right: 500, top: annotation ? 70 : 0,
        bottom: annotation ? 104 : 300, width: 500, height: annotation ? 34 : 300, toJSON: () => ({}) };
    });
    const selected = vi.fn();
    window.addEventListener('drawing:selected', selected);
    try {
      manager.startDrawing('measure', '#2962ff', { subtype: 'date_and_price_range' });
      manager.addPoint(120, 100, undefined, CONTEXT_ID, 10);
      manager.addPoint(180, 106, undefined, CONTEXT_ID, 11);
      expect(selected).toHaveBeenCalled();
      expect((selected.mock.calls.at(-1)![0] as CustomEvent).detail.annotationClientBounds).toEqual({ top: 70, bottom: 104 });
    } finally {
      window.removeEventListener('drawing:selected', selected);
      rectSpy.mockRestore();
    }
  });

  beforeEach(() => {
    document.body.replaceChildren();
    localStorage.clear();
    sessionStorage.clear();
    vi.clearAllMocks();
    loadDrawingsMock.mockResolvedValue([]);
    saveDrawingMock.mockResolvedValue('server-forecast-drawing');
    deleteDrawingMock.mockResolvedValue(undefined);
  });

  it.each(FORECASTING_MEASUREMENT_TOOLS.filter(tool => tool.requiredPoints > 0))(
    '$id commits only after its catalog-defined $requiredPoints anchor(s)',
    async (tool) => {
      const { manager } = await createHarness();
      const expectedPoints = expectedCommittedPoints(tool.id, tool.requiredPoints);
      manager.startDrawing(tool.drawingType, '#2962ff', { subtype: tool.id });

      for (let index = 0; index < tool.requiredPoints; index += 1) {
        const point = DRAWING_POINTS[index];
        const completed = manager.addPoint(
          point.time,
          point.price,
          undefined,
          CONTEXT_ID,
          point.logicalIndex,
        );
        const isFinalAnchor = index === tool.requiredPoints - 1;

        expect(completed).toBe(isFinalAnchor);
        if (!isFinalAnchor) {
          expect(manager.getDrawings(CONTEXT_ID)).toHaveLength(0);
          expect(manager.getActiveDrawing(CONTEXT_ID)).toMatchObject({
            type: tool.drawingType,
            subtype: tool.id,
            points: expect.arrayContaining([
              expect.objectContaining({
                time: expectedPoints[index].time,
                price: expectedPoints[index].price,
                logicalIndex: expectedPoints[index].logicalIndex,
              }),
            ]),
          });
        }
      }

      expect(manager.getActiveDrawing(CONTEXT_ID)).toBeNull();
      const committed = manager.getDrawings(CONTEXT_ID);
      expect(committed).toHaveLength(1);
      expect(committed[0]).toMatchObject({
        type: tool.drawingType,
        subtype: tool.id,
      });
      if (tool.id === 'sector') {
        expect(committed[0].points.slice(0, 2)).toEqual(expectedPoints.slice(0, 2));
        const [origin, radiusPoint, anglePoint] = committed[0].points;
        const radius = Math.hypot((radiusPoint.time - 60) - (origin.time - 60), (220 - radiusPoint.price) - (220 - origin.price));
        const angleRadius = Math.hypot((anglePoint.time - 60) - (origin.time - 60), (220 - anglePoint.price) - (220 - origin.price));
        expect(angleRadius).toBeCloseTo(radius, 8);
      } else {
        expect(committed[0].points).toEqual(expectedPoints);
      }
      expect(saveDrawingMock).toHaveBeenCalledWith(
        expect.objectContaining({
          type: tool.drawingType,
          subtype: tool.id,
          points: tool.id === 'sector' ? committed[0].points : expectedPoints,
        }),
        SYMBOL,
      );
    },
  );

  it('keeps Ghost feed open across click anchors and rejects wrong-context input and finish', async () => {
    const { manager } = await createHarness();
    manager.startDrawing('measure', '#2962ff', { subtype: 'ghost_feed' });

    expect(manager.addPoint(60, 98, undefined, CONTEXT_ID_OTHER, 9)).toBe(false);
    expect(manager.finishDrawing(CONTEXT_ID_OTHER)).toBeNull();
    expect(manager.getActiveDrawing(CONTEXT_ID)).toMatchObject({ points: [] });
    expect(saveDrawingMock).not.toHaveBeenCalled();

    expect(manager.addPoint(120, 100, undefined, CONTEXT_ID, 10)).toBe(false);
    expect(manager.addPoint(180, 106, undefined, CONTEXT_ID, 11)).toBe(false);
    expect(manager.addPoint(240, 97, undefined, CONTEXT_ID, 12)).toBe(false);
    expect(manager.getDrawings(CONTEXT_ID)).toHaveLength(0);
    expect(manager.getActiveDrawing(CONTEXT_ID)?.points).toEqual(DRAWING_POINTS);

    const completed = manager.finishDrawing(CONTEXT_ID);
    expect(completed).toMatchObject({
      type: 'measure',
      subtype: 'ghost_feed',
      points: DRAWING_POINTS,
    });
    expect(manager.getActiveDrawing(CONTEXT_ID)).toBeNull();
    expect(manager.getDrawings(CONTEXT_ID)).toHaveLength(1);
    expect(saveDrawingMock).toHaveBeenCalledOnce();
  });

  it('does not finish Ghost feed until it has at least two valid anchors', async () => {
    const { manager } = await createHarness();
    manager.startDrawing('measure', '#2962ff', { subtype: 'ghost_feed' });

    expect(manager.finishDrawing(CONTEXT_ID)).toBeNull();
    expect(manager.getActiveDrawing(CONTEXT_ID)).toMatchObject({ points: [] });

    expect(manager.addPoint(120, 100, undefined, CONTEXT_ID, 10)).toBe(false);
    expect(manager.finishDrawing(CONTEXT_ID)).toBeNull();
    expect(manager.getActiveDrawing(CONTEXT_ID)).toMatchObject({
      points: [{ time: 120, price: 100, logicalIndex: 10 }],
    });
    expect(manager.getDrawings(CONTEXT_ID)).toHaveLength(0);
    expect(saveDrawingMock).not.toHaveBeenCalled();

    expect(manager.addPoint(180, 106, undefined, CONTEXT_ID, 11)).toBe(false);
    expect(manager.finishDrawing(CONTEXT_ID)).not.toBeNull();
    expect(manager.getDrawings(CONTEXT_ID)).toHaveLength(1);
    expect(saveDrawingMock).toHaveBeenCalledOnce();
  });

  it('captures an immutable Bars Pattern source range including volume and persists it', async () => {
    const source: DrawingSeriesDataPoint[] = [
      { time: 60, open: 95, high: 99, low: 94, close: 98, volume: 10 },
      { time: 120, open: 98, high: 103, low: 97, close: 100, volume: 20 },
      { time: 180, open: 100, high: 108, low: 99, close: 106, tickVolume: 31 },
      { time: 240, open: 106, high: 110, low: 103, close: 104, realVolume: 42 },
    ];
    const provider = vi.fn(() => source);
    const { manager } = await createHarness({
      seriesData: [{ time: 999, close: 1, volume: 999 }],
      seriesDataProvider: provider,
    });

    manager.startDrawing('measure', '#2962ff', { subtype: 'bars_pattern' });
    expect(manager.addPoint(200, 106, undefined, CONTEXT_ID, 12)).toBe(false);
    expect(manager.addPoint(100, 98, undefined, CONTEXT_ID, 10)).toBe(false);

    const expectedSnapshot = [
      { time: 120, open: 98, high: 103, low: 97, close: 100, volume: 20 },
      { time: 180, open: 100, high: 108, low: 99, close: 106, tickVolume: 31 },
    ];
    expect(manager.getActiveDrawing(CONTEXT_ID)?.seriesSnapshot).toEqual(expectedSnapshot);

    // Live candles can continue changing while the user moves to click three.
    // The source must already be frozen at the second click.
    source[1].close = 9_999;
    source[1].volume = 9_999;
    source.push({ time: 150, close: 9_999, volume: 9_999 });
    expect(manager.addPoint(300, 104, undefined, CONTEXT_ID, 14)).toBe(true);

    const drawing = manager.getDrawings(CONTEXT_ID)[0];
    expect(provider).toHaveBeenCalled();
    expect(drawing.seriesSnapshot).toEqual(expectedSnapshot);
    expect(drawing.seriesSnapshot?.[0]).not.toBe(source[1]);
    expect(drawing.seriesSnapshot).toEqual(expectedSnapshot);
    expect(saveDrawingMock).toHaveBeenCalledWith(
      expect.objectContaining({
        subtype: 'bars_pattern',
        seriesSnapshot: expectedSnapshot,
      }),
      SYMBOL,
    );
    expect(readPersistedDrawings()).toEqual([
      expect.objectContaining({
        subtype: 'bars_pattern',
        seriesSnapshot: expectedSnapshot,
      }),
    ]);

    const reloadedHarness = await createHarness();
    await vi.waitFor(() => {
      expect(reloadedHarness.manager.getDrawings(CONTEXT_ID)).toEqual([
        expect.objectContaining({
          subtype: 'bars_pattern',
          seriesSnapshot: expectedSnapshot,
        }),
      ]);
    });
  });

  it('recaptures and persists the frozen Bars Pattern range when a source anchor is edited', async () => {
    let source: DrawingSeriesDataPoint[] = [
      { time: 120, open: 98, high: 103, low: 97, close: 100, volume: 20 },
      { time: 180, open: 100, high: 108, low: 99, close: 106, volume: 30 },
      { time: 240, open: 106, high: 111, low: 104, close: 109, volume: 40 },
    ];
    const provider = vi.fn(() => source);
    const { manager, container } = await createHarness({ seriesDataProvider: provider });

    manager.startDrawing('measure', '#2962ff', { subtype: 'bars_pattern' });
    manager.addPoint(120, 100, undefined, CONTEXT_ID, 10);
    manager.addPoint(180, 106, undefined, CONTEXT_ID, 11);
    manager.addPoint(300, 104, undefined, CONTEXT_ID, 14);

    const originalSnapshot = manager.getDrawings(CONTEXT_ID)[0].seriesSnapshot;
    source = [
      { time: 120, open: 90, high: 94, low: 89, close: 92, volume: 51 },
      { time: 180, open: 92, high: 97, low: 91, close: 96, volume: 61 },
      { time: 240, open: 96, high: 101, low: 95, close: 100, volume: 71 },
      { time: 300, open: 100, high: 102, low: 98, close: 99, volume: 81 },
    ];

    const sourceEndHandle = container.querySelector('[data-geometry-role="selection-anchor-2"]');
    expect(sourceEndHandle).not.toBeNull();
    sourceEndHandle!.dispatchEvent(new MouseEvent('pointerdown', {
      bubbles: true,
      clientX: 120,
      clientY: 114,
    }));
    window.dispatchEvent(new MouseEvent('pointermove', { clientX: 180, clientY: 114 }));
    window.dispatchEvent(new MouseEvent('pointerup'));

    const updated = manager.getDrawings(CONTEXT_ID)[0];
    expect(updated.points.slice(0, 2)).toEqual([
      { time: 120, price: 100, logicalIndex: 10 },
      { time: 240, price: 106 },
    ]);
    expect(updated.seriesSnapshot).toEqual(source.slice(0, 3));
    expect(updated.seriesSnapshot).not.toBe(originalSnapshot);
    expect(updated.seriesSnapshot?.[0]).not.toBe(source[0]);
    await vi.waitFor(() => {
      expect(saveDrawingMock).toHaveBeenLastCalledWith(
        expect.objectContaining({
          subtype: 'bars_pattern',
          seriesSnapshot: source.slice(0, 3),
        }),
        SYMBOL,
      );
    });
    expect(readPersistedDrawings()).toEqual([
      expect.objectContaining({
        subtype: 'bars_pattern',
        seriesSnapshot: source.slice(0, 3),
      }),
    ]);
  });

  it('moves only the Bars Pattern destination when its copied geometry is dragged', async () => {
    let source: DrawingSeriesDataPoint[] = [
      { time: 120, open: 98, high: 103, low: 97, close: 100, volume: 20 },
      { time: 180, open: 100, high: 108, low: 99, close: 106, volume: 30 },
    ];
    const { manager, container } = await createHarness({
      seriesDataProvider: () => source,
    });

    manager.startDrawing('measure', '#2962ff', { subtype: 'bars_pattern' });
    manager.addPoint(120, 100, undefined, CONTEXT_ID, 10);
    manager.addPoint(180, 106, undefined, CONTEXT_ID, 11);
    manager.addPoint(300, 104, undefined, CONTEXT_ID, 14);

    const before = manager.getDrawings(CONTEXT_ID)[0];
    const frozenSource = JSON.parse(JSON.stringify(before.seriesSnapshot));
    source = [{ time: 120, open: 1, high: 2, low: 0, close: 1, volume: 999 }];

    const copiedPatternHit = container.querySelector('[data-geometry-hit-for="bars-pattern-ghost-path"]');
    expect(copiedPatternHit).not.toBeNull();
    copiedPatternHit!.dispatchEvent(new MouseEvent('pointerdown', {
      bubbles: true,
      clientX: 240,
      clientY: 116,
    }));
    window.dispatchEvent(new MouseEvent('pointermove', { clientX: 248, clientY: 126 }));
    window.dispatchEvent(new MouseEvent('pointerup'));

    const moved = manager.getDrawings(CONTEXT_ID)[0];
    expect(moved.points.slice(0, 2)).toEqual(before.points.slice(0, 2));
    expect(moved.points[2]).toEqual({ time: 308, price: 94 });
    expect(moved.seriesSnapshot).toEqual(frozenSource);
  });

  it('retains and persists logical indices for anchors placed in the future margin', async () => {
    const futureTime = 1_000;
    const logicalToCoordinate = vi.fn((logicalIndex: number) => (
      Number.isInteger(logicalIndex) ? logicalIndex * 8 : 0
    ));
    const { manager, container } = await createHarness({
      timeToCoordinate: time => (time === futureTime ? null : time - 60),
      logicalToCoordinate,
    });

    manager.startDrawing('measure', '#2962ff', { subtype: 'position_forecast' });
    expect(manager.addPoint(120, 100, undefined, CONTEXT_ID, 10)).toBe(false);
    expect(manager.addPoint(futureTime, 106, undefined, CONTEXT_ID, 73.5)).toBe(true);

    const expectedPoints = [
      { time: 120, price: 100, logicalIndex: 10 },
      { time: futureTime, price: 106, logicalIndex: 73.5 },
    ];
    expect(manager.getDrawings(CONTEXT_ID)[0]).toMatchObject({
      subtype: 'position_forecast',
      points: expectedPoints,
    });
    expect(container.querySelector('[data-geometry-role="forecast-projection"]')?.getAttribute('d'))
      .toBe('M 60 120 Q 460 120 460 114');
    expect(container.querySelector('[data-geometry-role="selection-anchor-2"]')?.getAttribute('x'))
      .toBe('584');
    expect(saveDrawingMock).toHaveBeenCalledWith(
      expect.objectContaining({
        subtype: 'position_forecast',
        points: expectedPoints,
      }),
      SYMBOL,
    );
    expect(readPersistedDrawings()).toEqual([
      expect.objectContaining({
        subtype: 'position_forecast',
        points: expectedPoints,
      }),
    ]);
  });

  it.each(FORECASTING_MEASUREMENT_TOOLS)(
    'renders $id through the manager with semantic geometry and hit targets',
    async (tool) => {
      const seriesData: DrawingSeriesDataPoint[] = [
        { time: 60, open: 98, high: 101, low: 97, close: 100, volume: 10 },
        { time: 120, open: 100, high: 104, low: 99, close: 103, volume: 20 },
        { time: 180, open: 103, high: 106, low: 101, close: 102, tickVolume: 30 },
        { time: 240, open: 102, high: 108, low: 101, close: 107, realVolume: 40 },
        { time: 300, open: 107, high: 109, low: 104, close: 105, volume: 25 },
      ];
      const { manager, container } = await createHarness({ seriesData });
      const anchors = tool.id === 'bars_pattern'
        ? DRAWING_POINTS
        : tool.id === 'sector'
          ? DRAWING_POINTS
          : tool.requiredPoints === 1
            ? DRAWING_POINTS.slice(0, 1)
            : DRAWING_POINTS.slice(0, Math.max(2, tool.requiredPoints));

      manager.startDrawing('measure', '#2962ff', { subtype: tool.id });
      anchors.forEach((point) => {
        manager.addPoint(point.time, point.price, undefined, CONTEXT_ID, point.logicalIndex);
      });
      if (tool.id === 'ghost_feed') manager.finishDrawing(CONTEXT_ID);

      const drawing = manager.getDrawings(CONTEXT_ID).at(-1);
      expect(drawing).toMatchObject({ subtype: tool.id });
      const group = Array.from(container.querySelectorAll<SVGGElement>('g[data-id]'))
        .find((candidate) => candidate.getAttribute('data-id') === drawing?.id);
      expect(group?.querySelector('[data-geometry-role]')).not.toBeNull();
      expect(group?.querySelector('[data-geometry-hit-for]')).not.toBeNull();
    },
  );

  it.each([
    ['bars_pattern', 'bars-pattern-source-range'],
    ['sector', 'sector-first-ray'],
  ] as const)('keeps the staged %s construction visible after click two', async (subtype, role) => {
    const seriesData: DrawingSeriesDataPoint[] = [
      { time: 120, open: 99, high: 103, low: 98, close: 100, volume: 10 },
      { time: 180, open: 100, high: 108, low: 99, close: 106, volume: 20 },
    ];
    const { manager, container } = await createHarness({ seriesData });
    manager.startDrawing('measure', '#2962ff', { subtype });
    manager.addPoint(120, 100, undefined, CONTEXT_ID, 10);
    manager.updatePreviewPoint(180, 106, CONTEXT_ID, 11);
    expect(container.querySelector(`[data-geometry-role="${role}"]`)).not.toBeNull();

    manager.addPoint(180, 106, undefined, CONTEXT_ID, 11);
    expect(manager.getActiveDrawing(CONTEXT_ID)?.points).toHaveLength(2);
    expect(container.querySelector(`[data-geometry-role="${role}"]`)).not.toBeNull();
  });

  it.each(['long_position', 'short_position'])('%s keeps preview geometry on completion and displays market-based PnL', async subtype => {
    const { manager, container } = await createHarness({
      seriesData: [{ time: 120, open: 100, high: 106, low: 99, close: 105 }],
    });
    manager.startDrawing('measure', '#2962ff', { subtype });
    manager.updatePreviewPoint(120, 100, CONTEXT_ID, 10);
    const prefix = subtype.replace('_', '-');
    const geometry = () => ['target', 'stop', 'entry'].map(role => {
      const line = container.querySelector(`[data-geometry-role="${prefix}-${role}"]`)!;
      return ['x1', 'x2', 'y1', 'y2'].map(attribute => line.getAttribute(attribute));
    });
    const previewGeometry = geometry();
    const targetY = Number(previewGeometry[0][2]);
    const stopY = Number(previewGeometry[1][2]);
    expect(Math.abs(targetY - stopY)).toBeCloseTo(2 * 280 * .19);
    expect(manager.getActiveDrawing(CONTEXT_ID)?.points).toHaveLength(0);
    manager.addPoint(120, 100, undefined, CONTEXT_ID, 10);
    expect(geometry()).toEqual(previewGeometry);
    expect(container.textContent).toContain(`Open PnL: ${subtype === 'long_position' ? '5.00' : '-5.00'}`);
    expect(container.textContent).toContain('Risk/reward ratio: 1');
  });

  it('creates one-click positions with TradingView symmetric risk and a forty-bar duration', async () => {
    const { manager } = await createHarness();
    manager.startDrawing('measure', '#2962ff', { subtype: 'long_position' });
    manager.addPoint(120, 100, undefined, CONTEXT_ID, 10);

    const drawing = manager.getDrawings(CONTEXT_ID)[0];
    expect(drawing.positionTargetPrice! - drawing.points[0].price)
      .toBeCloseTo(drawing.points[0].price - drawing.positionStopPrice!, 8);
    expect(drawing.positionEndTime! - drawing.points[0].time).toBe(40 * 60);
    expect(drawing.positionEndLogicalIndex! - drawing.points[0].logicalIndex!).toBe(40);
  });

  it('supports independent controls and prevents a Long entry crossing its duration end', async () => {
    const { manager, container } = await createHarness();
    manager.startDrawing('measure', '#2962ff', { subtype: 'long_position' });
    manager.addPoint(120, 100, undefined, CONTEXT_ID, 10);

    const targetHit = container.querySelector('[data-geometry-hit-for="long-position-target"]');
    expect(targetHit).not.toBeNull();
    targetHit!.dispatchEvent(new MouseEvent('pointerdown', {
      bubbles: true,
      clientX: 200,
      clientY: 118,
    }));
    window.dispatchEvent(new MouseEvent('pointermove', { clientX: 200, clientY: 115 }));
    window.dispatchEvent(new MouseEvent('pointerup'));
    expect(manager.getDrawings(CONTEXT_ID)[0].positionTargetPrice).toBe(105);

    const stopHit = container.querySelector('[data-geometry-hit-for="long-position-stop"]');
    expect(stopHit).not.toBeNull();
    stopHit!.dispatchEvent(new MouseEvent('pointerdown', {
      bubbles: true,
      clientX: 200,
      clientY: 121,
    }));
    window.dispatchEvent(new MouseEvent('pointermove', { clientX: 200, clientY: 125 }));
    window.dispatchEvent(new MouseEvent('pointerup'));
    expect(manager.getDrawings(CONTEXT_ID)[0].positionStopPrice).toBe(95);

    const widthHit = container.querySelector('[data-geometry-hit-for="long-position-width-handle"]');
    expect(widthHit).not.toBeNull();
    widthHit!.dispatchEvent(new MouseEvent('pointerdown', {
      bubbles: true,
      clientX: 460,
      clientY: 120,
    }));
    window.dispatchEvent(new MouseEvent('pointermove', { clientX: 240, clientY: 120 }));
    window.dispatchEvent(new MouseEvent('pointerup'));
    expect(manager.getDrawings(CONTEXT_ID)[0]).toMatchObject({
      positionEndTime: 300,
      positionEndLogicalIndex: 30,
    });

    const entryHandle = container.querySelector('[data-geometry-role="selection-anchor-1"]');
    expect(entryHandle).not.toBeNull();
    entryHandle!.dispatchEvent(new MouseEvent('pointerdown', {
      bubbles: true,
      clientX: 60,
      clientY: 120,
    }));
    window.dispatchEvent(new MouseEvent('pointermove', { clientX: 400, clientY: 100 }));
    window.dispatchEvent(new MouseEvent('pointerup'));

    expect(manager.getDrawings(CONTEXT_ID)[0]).toMatchObject({
      positionTargetPrice: 105,
      positionStopPrice: 95,
      positionEndTime: 300,
    });
    const entry = manager.getDrawings(CONTEXT_ID)[0].points[0];
    expect(entry.price).toBeCloseTo(104.99, 8);
    expect(entry.time).toBe(292);
    expect(entry.time).toBeLessThan(manager.getDrawings(CONTEXT_ID)[0].positionEndTime!);
    expect(entry.logicalIndex).toBe(29);
    expect(manager.getDrawings(CONTEXT_ID)[0].positionEndLogicalIndex).toBe(30);
  });

  it('keeps Sector radius and angular boundary constrained while editing', async () => {
    const { manager, container } = await createHarness();
    manager.startDrawing('measure', '#2962ff', { subtype: 'sector' });
    DRAWING_POINTS.forEach(point => {
      manager.addPoint(point.time, point.price, undefined, CONTEXT_ID, point.logicalIndex);
    });

    let points = manager.getDrawings(CONTEXT_ID)[0].points;
    expect(points.slice(0, 2)).toEqual(expectedCommittedPoints('sector', 3).slice(0, 2));
    expect(Math.hypot(points[2].time - points[0].time, points[2].price - points[0].price))
      .toBeCloseTo(Math.hypot(points[1].time - points[0].time, points[1].price - points[0].price), 1);

    const radiusHandle = container.querySelector('[data-geometry-role="selection-anchor-2"]');
    expect(radiusHandle).not.toBeNull();
    radiusHandle!.dispatchEvent(new MouseEvent('pointerdown', {
      bubbles: true,
      clientX: 120,
      clientY: 120,
    }));
    window.dispatchEvent(new MouseEvent('pointermove', { clientX: 20, clientY: 80 }));
    window.dispatchEvent(new MouseEvent('pointerup'));

    points = manager.getDrawings(CONTEXT_ID)[0].points;
    expect(points[1]).toMatchObject({ time: 80, price: 146 });
    expect(Math.hypot(points[2].time - points[0].time, points[2].price - points[0].price))
      .toBeCloseTo(Math.hypot(points[1].time - points[0].time, points[1].price - points[0].price), 1);

    const movedRadiusHandle = container.querySelector('[data-geometry-role="selection-anchor-2"]');
    movedRadiusHandle!.dispatchEvent(new MouseEvent('pointerdown', {
      bubbles: true,
      clientX: 68,
      clientY: 120,
    }));
    window.dispatchEvent(new MouseEvent('pointermove', { clientX: 168, clientY: 80 }));
    window.dispatchEvent(new MouseEvent('pointerup'));

    points = manager.getDrawings(CONTEXT_ID)[0].points;
    expect(points[1]).toMatchObject({ time: 180, price: 186 });
    expect(Math.hypot(points[2].time - points[0].time, points[2].price - points[0].price))
      .toBeCloseTo(Math.hypot(points[1].time - points[0].time, points[1].price - points[0].price), 1);

    const angleHandle = container.querySelector('[data-geometry-role="selection-anchor-3"]');
    expect(angleHandle).not.toBeNull();
    angleHandle!.dispatchEvent(new MouseEvent('pointerdown', {
      bubbles: true,
      clientX: 168,
      clientY: 123,
    }));
    window.dispatchEvent(new MouseEvent('pointermove', { clientX: 100, clientY: 103 }));
    window.dispatchEvent(new MouseEvent('pointerup'));

    points = manager.getDrawings(CONTEXT_ID)[0].points;
    expect(points[2].time).not.toBe(points[1].time);
    expect(Math.hypot(points[2].time - points[0].time, points[2].price - points[0].price))
      .toBeCloseTo(Math.hypot(points[1].time - points[0].time, points[1].price - points[0].price), 1);

    const originHandle = container.querySelector('[data-geometry-role="selection-anchor-1"]');
    expect(originHandle).not.toBeNull();
    originHandle!.dispatchEvent(new MouseEvent('pointerdown', {
      bubbles: true,
      clientX: 60,
      clientY: 120,
    }));
    window.dispatchEvent(new MouseEvent('pointermove', { clientX: 400, clientY: 120 }));
    window.dispatchEvent(new MouseEvent('pointerup'));

    points = manager.getDrawings(CONTEXT_ID)[0].points;
    expect(points[0].time).toBe(460);
    expect(points[0].time).toBeGreaterThan(points[1].time);
    expect(points[1]).toMatchObject({ time: 180, price: 186 });
    expect(Math.hypot(points[2].time - points[0].time, points[2].price - points[0].price))
      .toBeCloseTo(Math.hypot(points[1].time - points[0].time, points[1].price - points[0].price), 1);
  });

  it('preserves a custom future position duration across history prepends and whole-body drags', async () => {
    let prependedBars = 0;
    const timeToCoordinate = (time: number) => (
      time <= 300 ? 100 + (((time - 120) / 60) * 8) : null
    );
    const logicalToCoordinate = (logical: number) => (
      100 + ((logical - (10 + prependedBars)) * 8)
    );
    const coordinateToLogical = (coordinate: number) => (
      10 + prependedBars + ((coordinate - 100) / 8)
    );
    const coordinateToTime = (coordinate: number) => (
      coordinate <= 124 ? 120 + (((coordinate - 100) / 8) * 60) : null
    );
    const { manager, container } = await createHarness({
      timeToCoordinate,
      logicalToCoordinate,
      coordinateToLogical,
      coordinateToTime,
    });
    manager.startDrawing('measure', '#2962ff', { subtype: 'long_position' });
    manager.addPoint(120, 100, undefined, CONTEXT_ID, 10);

    const widthHit = container.querySelector('[data-geometry-hit-for="long-position-width-handle"]');
    expect(widthHit?.getAttribute('cx')).toBe('420');
    widthHit!.dispatchEvent(new MouseEvent('pointerdown', {
      bubbles: true,
      clientX: 420,
      clientY: 120,
    }));
    window.dispatchEvent(new MouseEvent('pointermove', { clientX: 300, clientY: 120 }));
    window.dispatchEvent(new MouseEvent('pointerup'));

    let drawing = manager.getDrawings(CONTEXT_ID)[0];
    expect(drawing.positionEndTime! - drawing.points[0].time).toBe(25 * 60);
    expect(drawing.positionEndLogicalIndex! - drawing.points[0].logicalIndex!).toBe(25);

    prependedBars = 7;
    manager.renderAll();
    expect(container.querySelector('[data-geometry-role="long-position-width-handle"]')?.getAttribute('cx'))
      .toBe('300');

    const prependedWidthHit = container.querySelector('[data-geometry-hit-for="long-position-width-handle"]');
    prependedWidthHit!.dispatchEvent(new MouseEvent('pointerdown', {
      bubbles: true,
      clientX: 300,
      clientY: 120,
    }));
    window.dispatchEvent(new MouseEvent('pointermove', { clientX: 324, clientY: 120 }));
    window.dispatchEvent(new MouseEvent('pointerup'));

    drawing = manager.getDrawings(CONTEXT_ID)[0];
    expect(drawing.positionEndTime! - drawing.points[0].time).toBe(28 * 60);
    expect(drawing.positionEndLogicalIndex! - drawing.points[0].logicalIndex!).toBe(28);

    const bodyHit = container.querySelector('[data-geometry-hit-for="long-position-profit-zone"]');
    expect(bodyHit).not.toBeNull();
    bodyHit!.dispatchEvent(new MouseEvent('pointerdown', {
      bubbles: true,
      clientX: 150,
      clientY: 120,
    }));
    window.dispatchEvent(new MouseEvent('pointermove', { clientX: 166, clientY: 120 }));
    window.dispatchEvent(new MouseEvent('pointerup'));

    drawing = manager.getDrawings(CONTEXT_ID)[0];
    expect(drawing.points[0]).toMatchObject({ time: 240, logicalIndex: 19 });
    expect(drawing.positionEndTime).toBe(1_920);
    expect(drawing.positionEndLogicalIndex).toBe(47);
    expect(drawing.positionEndLogicalIndex! - drawing.points[0].logicalIndex!).toBe(28);
    expect(container.querySelector('[data-geometry-role="long-position-width-handle"]')?.getAttribute('cx'))
      .toBe('340');
  });

  it('prevents a Short entry crossing its duration end', async () => {
    const { manager, container } = await createHarness();
    manager.startDrawing('measure', '#2962ff', { subtype: 'short_position' });
    manager.addPoint(120, 100, undefined, CONTEXT_ID, 10);

    container.querySelector('[data-geometry-hit-for="short-position-width-handle"]')!
      .dispatchEvent(new MouseEvent('pointerdown', {
        bubbles: true,
        clientX: 460,
        clientY: 120,
      }));
    window.dispatchEvent(new MouseEvent('pointermove', { clientX: 240, clientY: 120 }));
    window.dispatchEvent(new MouseEvent('pointerup'));

    container.querySelector('[data-geometry-role="selection-anchor-1"]')!
      .dispatchEvent(new MouseEvent('pointerdown', {
        bubbles: true,
        clientX: 60,
        clientY: 120,
      }));
    window.dispatchEvent(new MouseEvent('pointermove', { clientX: 400, clientY: 120 }));
    window.dispatchEvent(new MouseEvent('pointerup'));

    const drawing = manager.getDrawings(CONTEXT_ID)[0];
    expect(drawing.points[0]).toMatchObject({ time: 292, price: 100, logicalIndex: 29 });
    expect(drawing.positionEndTime).toBe(300);
    expect(drawing.positionEndLogicalIndex).toBe(30);
  });

  it('drags time-backed anchors from durable time and keeps future anchors movable', async () => {
    const coordinateToTime = vi.fn((coordinate: number) => coordinate <= 80 ? coordinate + 60 : null);
    const { manager, container } = await createHarness({
      timeToCoordinate: time => time === 1_000 ? null : time - 60,
      logicalToCoordinate: logical => logical * 8,
      coordinateToTime,
    });
    manager.startDrawing('measure', '#2962ff', { subtype: 'position_forecast' });
    manager.addPoint(120, 100, undefined, CONTEXT_ID, 10);
    manager.addPoint(1_000, 106, undefined, CONTEXT_ID, 73.5);

    const projectionHit = container.querySelector('[data-geometry-hit-for="forecast-projection"]');
    expect(projectionHit).not.toBeNull();
    projectionHit!.dispatchEvent(new MouseEvent('pointerdown', {
      bubbles: true,
      clientX: 60,
      clientY: 120,
    }));
    window.dispatchEvent(new MouseEvent('pointermove', { clientX: 68, clientY: 120 }));
    window.dispatchEvent(new MouseEvent('pointerup'));

    expect(coordinateToTime).toHaveBeenCalledWith(68);
    expect(manager.getDrawings(CONTEXT_ID)[0].points).toEqual([
      { time: 128, price: 100 },
      { time: 1_060, price: 106, logicalIndex: 74.5 },
    ]);
  });

  it('renders data-driven studies from each chart context own candle provider', async () => {
    const providerA = vi.fn(() => [
      { time: 120, open: 99, high: 102, low: 98, close: 100, volume: 10 },
      { time: 180, open: 100, high: 104, low: 99, close: 102, volume: 20 },
    ]);
    const providerB = vi.fn(() => [
      { time: 120, open: 149, high: 152, low: 148, close: 150, volume: 30 },
      { time: 180, open: 150, high: 154, low: 149, close: 152, volume: 40 },
    ]);
    const { manager, container: containerA, chart, series } = await createHarness({
      seriesDataProvider: providerA,
    });
    manager.startDrawing('measure', '#2962ff', { subtype: 'anchored_vwap' });
    manager.addPoint(120, 100, undefined, CONTEXT_ID, 10);

    const containerB = document.createElement('div');
    Object.defineProperty(containerB, 'clientWidth', { value: 500 });
    Object.defineProperty(containerB, 'clientHeight', { value: 300 });
    document.body.appendChild(containerB);
    manager.setChart(
      chart,
      series,
      SYMBOL,
      1,
      containerB,
      TIMEFRAME,
      CONTEXT_ID_OTHER,
      ACCOUNT_SCOPE,
      providerB,
    );
    await Promise.resolve();
    manager.startDrawing('measure', '#2962ff', { subtype: 'anchored_vwap' });
    manager.addPoint(120, 150, undefined, CONTEXT_ID_OTHER, 10);
    manager.renderAll();

    const pathA = containerA.querySelector('[data-geometry-role="anchored-vwap-line"]')?.getAttribute('d');
    const pathB = containerB.querySelector('[data-geometry-role="anchored-vwap-line"]')?.getAttribute('d');
    expect(pathA).toBeTruthy();
    expect(pathB).toBeTruthy();
    expect(pathA).not.toBe(pathB);
    expect(providerA).toHaveBeenCalled();
    expect(providerB).toHaveBeenCalled();
  });
});
