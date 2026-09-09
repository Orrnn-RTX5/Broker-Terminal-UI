// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { IChartApi, ISeriesApi } from 'lightweight-charts';

vi.mock('./drawingApi', () => ({
  drawingApi: {
    loadDrawings: vi.fn().mockResolvedValue([]),
    saveDrawing: vi.fn().mockResolvedValue('server-drawing'),
    deleteDrawing: vi.fn().mockResolvedValue(undefined),
  },
}));

import { CHART_PATTERN_TOOLS } from '../drawing-tools/chartPatternToolCatalog';
import {
  DrawingManager,
  type DrawingSeriesDataPoint,
} from './drawingManager';

const DEFAULT_SERIES_DATA: readonly DrawingSeriesDataPoint[] = [
  { time: 150, open: 99, high: 103, low: 98, close: 100 },
  { time: 180, open: 100, high: 106, low: 99, close: 104 },
  { time: 210, open: 104, high: 108, low: 103, close: 106 },
  { time: 240, open: 106, high: 110, low: 105, close: 109 },
];

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


afterEach(() => { document.body.innerHTML = ''; vi.restoreAllMocks(); });
beforeEach(() => { localStorage.clear(); });
const points = [
  { time: 150, price: 70 }, { time: 190, price: 150 },
  { time: 230, price: 100 }, { time: 270, price: 170 },
  { time: 310, price: 110 }, { time: 350, price: 190 }, { time: 390, price: 120 },
];
describe('Chart patterns complete through the real drawing manager', () => {
  it('Cyclic lines reverse when the second anchor crosses the first, and undo restores their direction', async () => {
    const { manager, container } = await createRenderHarness();
    manager.startDrawing('pattern', '#2962ff', { subtype: 'cyclic_lines' });
    manager.addPoint(350, 70);
    manager.addPoint(250, 100);
    const lines = () => [...container.querySelectorAll('[data-geometry-role^="cycle-line-"]')].map(path => path.getAttribute('d'));
    expect(lines()).toEqual(['M 250 0 V 280', 'M 150 0 V 280', 'M 50 0 V 280']);
    container.querySelector('[data-geometry-role="pattern-anchor-2"]')!.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, clientX: 150, clientY: 120 }));
    window.dispatchEvent(new MouseEvent('pointermove', { clientX: 350, clientY: 120 }));
    window.dispatchEvent(new MouseEvent('pointerup'));
    expect(lines()).toEqual(['M 250 0 V 280', 'M 350 0 V 280', 'M 450 0 V 280']);
    manager.undo();
    expect(lines()).toEqual(['M 250 0 V 280', 'M 150 0 V 280', 'M 50 0 V 280']);
    manager.setChart(null, null, null, 1, container);
  });

  it.each(CHART_PATTERN_TOOLS)('$label drags anchors and the whole drawing, respects locking, and restores locally', async tool => {
    const { manager, container } = await createRenderHarness();
    manager.startDrawing('pattern', '#2962ff', { subtype: tool.id });
    points.slice(0, tool.requiredPoints).forEach(point => manager.addPoint(point.time, point.price));
    const drawing = manager.getDrawings()[0];
    const readPoints = () => manager.getDrawings()[0].points.map(point => ({ ...point }));
    const drag = (role: string, dx: number, dy: number) => {
      const target = container.querySelector(`[data-geometry-role="${role}"]`)!;
      expect(target).not.toBeNull();
      target.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, clientX: 100, clientY: 100 }));
      window.dispatchEvent(new MouseEvent('pointermove', { clientX: 100 + dx, clientY: 100 + dy }));
      window.dispatchEvent(new MouseEvent('pointerup'));
    };
    const initial = readPoints();
    drag(`pattern-anchor-${tool.requiredPoints}`, 10, -10);
    const edited = readPoints();
    expect(edited.slice(0, -1)).toEqual(initial.slice(0, -1));
    expect(edited.at(-1)!.time).toBe(initial.at(-1)!.time + 10);
    expect(edited.at(-1)!.price).toBe(initial.at(-1)!.price + (tool.id === 'time_cycles' ? 0 : 10));
    drag('pattern-hit', 20, 15);
    const moved = readPoints();
    moved.forEach((point, index) => {
      expect(point.time).toBe(edited[index].time + 20);
      expect(point.price).toBe(edited[index].price - 15);
    });
    manager.updateDrawingProperties(drawing.id, { locked: true });
    drag('pattern-hit', 30, 30);
    expect(readPoints()).toEqual(moved);
    await Promise.resolve();
    manager.setChart(null, null, null, 1, container);
    const restored = await createRenderHarness();
    expect(restored.manager.getDrawings()[0]).toMatchObject({ subtype: tool.id, type: 'pattern', locked: true, points: moved });
    expect(restored.container.querySelector('path[data-geometry-role]')).not.toBeNull();
    restored.manager.setChart(null, null, null, 1, restored.container);
  });

  it('moving the first time-cycle anchor moves the common baseline', async () => {
    const { manager, container } = await createRenderHarness();
    manager.startDrawing('pattern', '#2962ff', { subtype: 'time_cycles' });
    manager.addPoint(150, 70);
    manager.addPoint(190, 150);
    container.querySelector('[data-geometry-role="pattern-anchor-1"]')!.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, clientX: 50, clientY: 150 }));
    window.dispatchEvent(new MouseEvent('pointermove', { clientX: 60, clientY: 130 }));
    window.dispatchEvent(new MouseEvent('pointerup'));
    expect(manager.getDrawings()[0].points.map(point => point.price)).toEqual([90, 90]);
    manager.setChart(null, null, null, 1, container);
  });

  it.each(CHART_PATTERN_TOOLS)('$label previews, completes, edits, locks, and supports undo', async tool => {
    const { manager, container } = await createRenderHarness();
    manager.startDrawing('pattern', '#2962ff', { subtype: tool.id });
    for (let i = 0; i < tool.requiredPoints; i++) {
      expect(manager.addPoint(points[i].time, points[i].price)).toBe(i === tool.requiredPoints - 1);
      if (i < tool.requiredPoints - 1) {
        manager.updatePreviewPoint(points[i+1].time, points[i+1].price);
        expect(container.querySelector('svg g[data-id$="-preview"]')).not.toBeNull();
        expect(manager.getDrawings()).toHaveLength(0);
      }
    }
    const drawing = manager.getDrawings()[0];
    expect(drawing.points).toHaveLength(tool.requiredPoints);
    const group = () => container.querySelector(`g[data-id="${drawing.id}"]`)!;
    expect(group().querySelectorAll('[data-geometry-role^="pattern-anchor-"][data-geometry-role$="-price"]')).toHaveLength(tool.requiredPoints);
    expect(group().querySelector('path[data-geometry-role]')).not.toBeNull();
    expect(group().innerHTML).not.toMatch(/NaN|Infinity/);
    if (tool.id === 'time_cycles') expect(drawing.points[1].price).toBe(drawing.points[0].price);
    manager.updateDrawingProperties(drawing.id, { color: '#ff00ff', lineWidth: 4, locked: true });
    expect(manager.getDrawings()[0]).toMatchObject({ color: '#ff00ff', lineWidth: 4, locked: true });
    manager.undo();
    expect(manager.getDrawings()[0].color).toBe('#2962ff');
    manager.undo();
    expect(manager.getDrawings()).toHaveLength(0);
    manager.redo();
    expect(manager.getDrawings()[0].subtype).toBe(tool.id);
    manager.setChart(null, null, null, 1, container);
  });
  it.each(CHART_PATTERN_TOOLS)('$label cannot finish early and cancels without saving', async tool => {
    const { manager, container } = await createRenderHarness();
    manager.startDrawing('pattern', '#2962ff', { subtype: tool.id });
    manager.addPoint(150, 100);
    expect(manager.finishDrawing()).toBeNull();
    manager.cancelDrawing();
    expect(manager.getDrawings()).toHaveLength(0);
    manager.setChart(null, null, null, 1, container);
  });
});
