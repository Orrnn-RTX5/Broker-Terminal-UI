// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { IChartApi, ISeriesApi } from 'lightweight-charts';
vi.mock('./drawingApi', () => ({ drawingApi: {
  loadDrawings: vi.fn().mockResolvedValue([]), saveDrawing: vi.fn().mockResolvedValue('saved'),
  deleteDrawing: vi.fn().mockResolvedValue(undefined),
} }));
import { DrawingManager } from './drawingManager';
import { BRUSH_SHAPE_TOOLS } from '../drawing-tools/brushShapeToolCatalog';

const managers: DrawingManager[] = [];
beforeEach(() => localStorage.clear());
afterEach(() => {
  managers.splice(0).forEach(manager => manager.setChart(null, null, null));
  document.body.innerHTML = ''; vi.restoreAllMocks();
});
async function harness() {
  const timeScale = {
    timeToCoordinate: (time: number) => time - 100,
    coordinateToTime: (x: number) => x + 100,
    timeToIndex: (time: number) => time - 100,
    logicalToCoordinate: (index: number) => index,
    coordinateToLogical: (x: number) => x,
    height: () => 20,
  };
  const chart = { timeScale: () => timeScale, priceScale: () => ({ width: () => 40 }) } as unknown as IChartApi;
  const series = {
    priceToCoordinate: (price: number) => 220 - price,
    coordinateToPrice: (y: number) => 220 - y,
    options: () => ({ priceFormat: { precision: 2, minMove: .01 } }),
    priceFormatter: () => ({ format: (price: number) => price.toFixed(2) }),
    data: () => [],
  } as unknown as ISeriesApi<'Candlestick'>;
  const container = document.createElement('div');
  Object.defineProperties(container, { clientWidth: { value: 500 }, clientHeight: { value: 300 } });
  document.body.appendChild(container);
  const manager = new DrawingManager(); managers.push(manager);
  manager.setChart(chart, series, 'TEST', 1, container, 'M1', 'shapes-test', 'account-test');
  await Promise.resolve();
  const bands = () => ({
    price: container.querySelector('[data-geometry-role="price-scale-range"]'),
    time: container.querySelector('[data-geometry-role="time-scale-range"]'),
  });
  const expectRange = (coordinates: { x: number; y: number }[]) => {
    const { price, time } = bands();
    const xs = coordinates.map(p => p.x), ys = coordinates.map(p => p.y);
    expect(price).toHaveAttribute('x', '460');
    expect(Number(price!.getAttribute('y'))).toBeCloseTo(Math.min(...ys));
    expect(Number(price!.getAttribute('height'))).toBeCloseTo(Math.max(...ys) - Math.min(...ys));
    expect(Number(time!.getAttribute('x'))).toBeCloseTo(Math.min(...xs));
    expect(Number(time!.getAttribute('width'))).toBeCloseTo(Math.max(...xs) - Math.min(...xs));
    expect(time).toHaveAttribute('y', '280');
    for (const band of [price, time]) {
      expect(band).toHaveAttribute('fill', '#2962ff');
      expect(band).toHaveAttribute('pointer-events', 'none');
    }
    expect(container.querySelectorAll('[data-geometry-role="price-scale-range"]')).toHaveLength(1);
  };
  return { manager, container, bands, expectRange };
}

describe('Brush and shape axis intervals through the drawing manager', () => {
  it.each(BRUSH_SHAPE_TOOLS.filter(tool => tool.requiredPoints !== 1))(
    '$label tracks construction, selection, movement and deselection', async tool => {
      const { manager, container, bands, expectRange } = await harness();
      manager.startDrawing('shapes', '#ef4444', { subtype: tool.id });
      manager.addPoint(150, 70);
      manager.updatePreviewPoint(290, 130);
      expectRange([{ x: 50, y: 150 }, { x: 190, y: 90 }]);
      manager.hidePreviewCursor('shapes-test');
      expect(bands().price).toBeNull();
      manager.addPoint(290, 130);
      if (tool.requiredPoints === 3 || tool.requiredPoints === 0) manager.addPoint(210, 30);
      if (tool.requiredPoints === 0) manager.finishDrawing();
      const drawing = manager.getDrawings()[0];
      const screens = () => drawing.points.map(point => ({ x: point.time - 100, y: 220 - point.price }));
      expectRange(screens());
      const labelCount = ['path', 'polyline'].includes(tool.id) ? 0
        : ['curve', 'double_curve'].includes(tool.id) ? 2 : tool.requiredPoints;
      expect(container.querySelectorAll('[data-geometry-role^="shape-anchor-"][data-geometry-role$="-price"]')).toHaveLength(labelCount);
      if (tool.requiredPoints === 3) {
        // The raw third coordinate is distinct from the projected width/bend handle.
        const badge = container.querySelector('[data-geometry-role="shape-anchor-3-price-text"]');
        expect(badge?.textContent).toBe('30.00');
      }
      manager.unselectDrawing(drawing.id);
      expect(bands().price).toBeNull(); expect(bands().time).toBeNull();
      manager.selectDrawing(drawing.id);
      expectRange(screens());
      const before = screens();
      container.querySelector(`[data-geometry-role="${tool.id}"]`)!.dispatchEvent(
        new MouseEvent('pointerdown', { bubbles: true, clientX: 100, clientY: 100 }));
      window.dispatchEvent(new MouseEvent('pointermove', { clientX: 120, clientY: 115 }));
      window.dispatchEvent(new MouseEvent('pointerup'));
      expectRange(before.map(p => ({ x: p.x + 20, y: p.y + 15 })));
    });

  it.each(['arrow_mark_up', 'arrow_mark_down'])('%s has one coordinate without an interval', async subtype => {
    const { manager, container, bands } = await harness();
    manager.startDrawing('shapes', '#00aa00', { subtype }); manager.addPoint(150, 70);
    expect(bands().price).toBeNull(); expect(bands().time).toBeNull();
    expect(container.querySelectorAll('[data-geometry-role="shape-anchor-1-price"]')).toHaveLength(1);
  });

  it.each(['brush', 'highlighter'])('%s includes interior stroke extrema and follows body movement', async subtype => {
    const { manager, container, bands, expectRange } = await harness();
    manager.startDrawing('freehand', '#ff8800', { subtype });
    const samples = [{ x: 100, y: 150 }, { x: 180, y: 60 }, { x: 220, y: 190 }, { x: 300, y: 130 }];
    samples.forEach(p => manager.addFreehandPoint(p.x, p.y, 'shapes-test'));
    expectRange(samples);
    manager.finishDrawing();
    const drawing = manager.getDrawings()[0];
    expectRange(samples);
    container.querySelector('[data-geometry-role="brush-hit"]')!.dispatchEvent(
      new MouseEvent('pointerdown', { bubbles: true, clientX: 100, clientY: 100 }));
    window.dispatchEvent(new MouseEvent('pointermove', { clientX: 125, clientY: 120 }));
    window.dispatchEvent(new MouseEvent('pointerup'));
    expectRange(samples.map(p => ({ x: p.x + 25, y: p.y + 20 })));
    manager.unselectDrawing(drawing.id);
    expect(bands().price).toBeNull(); expect(bands().time).toBeNull();
  });

  it.each(['curve', 'double_curve'])('%s includes an edited bend without an extra coordinate badge', async subtype => {
    const { manager, container, expectRange } = await harness();
    manager.startDrawing('shapes', '#2962ff', { subtype });
    manager.addPoint(200, 100); manager.addPoint(350, 140);
    const drawing = manager.getDrawings()[0];
    const index = subtype === 'curve' ? 2 : 3;
    const before = drawing.points.map(p => ({ x: p.time - 100, y: 220 - p.price }));
    container.querySelector(`[data-geometry-role="shape-anchor-${index + 1}"]`)!.dispatchEvent(
      new MouseEvent('pointerdown', { bubbles: true, clientX: 100, clientY: 100 }));
    window.dispatchEvent(new MouseEvent('pointermove', { clientX: 125, clientY: 140 }));
    window.dispatchEvent(new MouseEvent('pointerup'));
    expectRange(before.map((p, i) => i === index ? { x: p.x + 25, y: p.y + 40 } : p));
    expect(container.querySelector(`[data-geometry-role="shape-anchor-${index + 1}-price"]`)).toBeNull();
  });
});
