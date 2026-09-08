// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { IChartApi, ISeriesApi } from 'lightweight-charts';

vi.mock('./drawingApi', () => ({
  drawingApi: {
    loadDrawings: vi.fn().mockResolvedValue([]),
    saveDrawing: vi.fn().mockResolvedValue('info-line'),
    deleteDrawing: vi.fn().mockResolvedValue(undefined),
  },
}));

import { DrawingManager } from './drawingManager';

const BASE_TIME = 1_788_761_400;
const timeAt = (index: number) => BASE_TIME + index * 60;
const CONTEXT = 'chart-info';
const createFixture = async () => {
  const times = Array.from({ length: 200 }, (_, index) => timeAt(index));
  const timeScale = {
    timeToIndex: (time: number) => {
      const index = times.indexOf(time);
      return index < 0 ? null : index;
    },
    timeToCoordinate: (time: number) => {
      const index = times.indexOf(time);
      return index < 0 ? null : 400 + (index - 100) * 12;
    },
    coordinateToTime: (x: number) => times[Math.round((x - 400) / 12) + 100] ?? null,
    coordinateToLogical: (x: number) => Math.round((x - 400) / 12) + 100,
    logicalToCoordinate: (index: number) => Number.isInteger(index) ? 400 + (index - 100) * 12 : 0,
    height: () => 20,
  };
  const chart = { timeScale: () => timeScale, priceScale: () => ({ width: () => 40 }) };
  const series = {
    priceToCoordinate: (price: number) => 1000 - price,
    coordinateToPrice: (y: number) => 1000 - y,
    options: () => ({ priceFormat: { precision: 2, minMove: .01 } }),
    priceFormatter: () => ({ format: (price: number) => price.toFixed(2) }),
  };
  const container = document.createElement('div');
  Object.defineProperty(container, 'clientWidth', { value: 1000 });
  Object.defineProperty(container, 'clientHeight', { value: 500 });
  document.body.appendChild(container);
  const manager = new DrawingManager();
  manager.setChart(chart as unknown as IChartApi, series as unknown as ISeriesApi<'Candlestick'>,
    'TEST', 1, container, 'M1', CONTEXT, 'account-test');
  await Promise.resolve();
  const place = () => {
    manager.startDrawing('trendline', '#2962ff', { subtype: 'info_line' });
    manager.addPoint(timeAt(100), 800, undefined, CONTEXT, 100.4);
    manager.addPoint(timeAt(114), 680, undefined, CONTEXT, 113.6);
  };
  return { manager, container, times, timeScale, place };
};
const drag = (node: Element, fromX: number, fromY: number, dx: number, dy: number) => {
  node.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, clientX: fromX, clientY: fromY }));
  window.dispatchEvent(new MouseEvent('pointermove', { clientX: fromX + dx, clientY: fromY + dy }));
  window.dispatchEvent(new MouseEvent('pointerup'));
};
const value = (node: Element, name: string) => Number(node.getAttribute(name));

describe('Info line measurement and panel interaction', () => {
  beforeEach(() => {
    document.body.replaceChildren();
    localStorage.clear();
    sessionStorage.clear();
  });

  it('shows one committed handle and a passive zero-measurement panel immediately after the first click', async () => {
    const { manager, container } = await createFixture();
    manager.startDrawing('trendline', '#2962ff', { subtype: 'info_line' });
    manager.addPoint(timeAt(100), 800, undefined, CONTEXT, 100.4);
    expect(container.querySelectorAll('circle')).toHaveLength(1);
    expect(container.querySelector('[data-geometry-role="construction-anchor-1"]')).not.toBeNull();
    const panel = container.querySelector('[data-geometry-role="measurement-panel"]')!;
    expect(panel.getAttribute('pointer-events')).toBe('none');
    expect(container.querySelector('[data-geometry-role="measurement-row-1"]')!.textContent).toBe('0.00 (0.00%), 0');
    expect(container.querySelector('[data-geometry-role="measurement-row-2"]')!.textContent).toBe('0 bars (0s), distance: 0 px');
    expect(container.querySelector('[data-geometry-role="measurement-row-3"]')!.textContent).toBe('0.0\u00b0');
    expect(manager.hasRenderableContent(container)).toBe(true);
    manager.cancelDrawing(CONTEXT);
    expect(container.querySelector('[data-geometry-role="measurement-panel"]')).toBeNull();
    expect(container.querySelector('circle')).toBeNull();
  });

  it('counts resolved candle anchors rather than raw click fractions, including history prepend and endpoint edits', async () => {
    const { manager, container, times, timeScale, place } = await createFixture();
    place();
    const count = () => container.querySelector('[data-geometry-role="measurement-row-2"]')!.textContent;
    expect(Math.round(113.6 - 100.4)).toBe(13);
    expect(count()).toContain('14 bars (14m)');
    expect(container.querySelector('[data-geometry-role="measurement-row-3"]')!.textContent).toMatch(/^-?\d+\.\d°$/);

    times.unshift(...Array.from({ length: 10 }, (_, index) => timeAt(index - 10)));
    manager.renderAll();
    expect(count()).toContain('14 bars (14m)');
    const end = container.querySelector('[data-geometry-role="selection-anchor-2"]')!;
    drag(end, timeScale.timeToCoordinate(timeAt(114))!, 320, 24, 0);
    expect(count()).toContain('16 bars (16m)');
  });

  it('keeps elapsed time independent of the real candle count across a missing minute', async () => {
    const { container, times, place } = await createFixture();
    times.splice(times.indexOf(timeAt(107)), 1);
    place();
    expect(container.querySelector('[data-geometry-role="measurement-row-2"]')!.textContent).toContain('13 bars (14m)');
  });

  it('retains the panel when deselected and moves the entire drawing when the panel is dragged', async () => {
    const { manager, container, place } = await createFixture();
    place();
    const id = manager.getDrawings(CONTEXT)[0].id;
    const original = manager.getDrawings(CONTEXT)[0].points.map(point => ({ ...point }));
    const originalMeasure = container.querySelector('[data-geometry-role="measurement-row-2"]')!.textContent;
    manager.unselectAll(CONTEXT);
    expect(container.querySelector('[data-geometry-role^="selection-anchor-"]')).toBeNull();
    const panel = container.querySelector('[data-geometry-role="measurement-panel"]')!;
    expect(panel).not.toBeNull();
    expect(value(panel, 'y') + value(panel, 'height')).toBeLessThan(260);
    expect(panel.getAttribute('pointer-events')).toBe('all');
    const selections: Array<{ anchorClientY: number }> = [];
    const captureSelection = (event: Event) => selections.push((event as CustomEvent).detail);
    window.addEventListener('drawing:selected', captureSelection);
    drag(panel, value(panel, 'x') + 20, value(panel, 'y') + 20, 24, 20);
    window.removeEventListener('drawing:selected', captureSelection);
    expect(selections.at(-1)?.anchorClientY).toBe(220);
    const drawing = manager.getDrawings(CONTEXT).find(item => item.id === id)!;
    expect(drawing.selected).toBe(true);
    drawing.points.forEach((point, index) => {
      expect(point.time).toBe(original[index].time + 120);
      expect(point.price).toBe(original[index].price - 20);
    });
    expect(container.querySelector('[data-geometry-role="measurement-row-2"]')!.textContent).toBe(originalMeasure);
    expect(container.querySelectorAll('[data-geometry-role^="selection-anchor-"]')).toHaveLength(2);
  });

  it('honors panel locking and lets a newly armed tool place through the existing panel', async () => {
    const { manager, container, place } = await createFixture();
    place();
    const drawing = manager.getDrawings(CONTEXT)[0];
    const original = drawing.points.map(point => ({ ...point }));
    manager.updateDrawingProperties(drawing.id, { locked: true }, CONTEXT);
    let panel = container.querySelector('[data-geometry-role="measurement-panel"]')!;
    expect(panel.getAttribute('pointer-events')).toBe('none');
    const lockedDown = new MouseEvent('pointerdown', { bubbles: true, cancelable: true });
    panel.dispatchEvent(lockedDown);
    expect(lockedDown.defaultPrevented).toBe(false);
    drag(panel, value(panel, 'x') + 20, value(panel, 'y') + 20, 24, 20);
    expect(manager.getDrawings(CONTEXT)[0].points).toEqual(original);

    manager.startDrawing('trendline', '#2962ff', { subtype: 'info_line' });
    panel = container.querySelector('[data-geometry-role="measurement-panel"]')!;
    expect((panel as SVGRectElement).style.pointerEvents).toBe('none');
    manager.addPoint(timeAt(110), 750, undefined, CONTEXT, 110);
    manager.updatePreviewPoint(timeAt(120), 730, CONTEXT, 120);
    const previewPanel = container.querySelector('g[data-id$="-preview"] [data-geometry-role="measurement-panel"]')!;
    expect(previewPanel.getAttribute('pointer-events')).toBe('none');
    manager.cancelDrawing(CONTEXT);
    expect(container.querySelectorAll('[data-geometry-role="measurement-panel"]')).toHaveLength(1);
  });
});
