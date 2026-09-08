// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MismatchDirection, type IChartApi, type ISeriesApi } from 'lightweight-charts';

vi.mock('./drawingApi', () => ({
  drawingApi: {
    loadDrawings: vi.fn().mockResolvedValue([]),
    saveDrawing: vi.fn().mockResolvedValue('regression-recovery'),
    deleteDrawing: vi.fn().mockResolvedValue(undefined),
  },
}));

import { DrawingManager } from './drawingManager';

const BASE_TIME = 1_788_761_400;
const timeAt = (index: number) => BASE_TIME + index * 60;
const makeBars = () => Array.from({ length: 20 }, (_, index) => ({
  time: timeAt(index), open: 100 + index, high: 102 + index, low: 98 + index, close: 100 + index,
}));

const attachChart = async (manager = new DrawingManager(), id = 'chart-regression', bars = makeBars()) => {
  const providerBars = bars.map(bar => ({ ...bar }));
  const timeScale = {
    timeToCoordinate: (time: number) => {
      const index = bars.findIndex(bar => bar.time === time);
      return index < 0 ? null : index * 10;
    },
    coordinateToTime: (x: number) => bars[Math.round(x / 10)]?.time ?? null,
    logicalToCoordinate: (index: number) => Number.isInteger(index) ? index * 10 : 0,
    coordinateToLogical: (x: number) => Math.round(x / 10),
    height: () => 20,
  };
  const chart = { timeScale: () => timeScale, priceScale: () => ({ width: () => 40 }) } as unknown as IChartApi;
  const series = {
    dataByIndex: vi.fn(() => bars.at(-1) ?? null),
    priceToCoordinate: (price: number) => 220 - price,
    coordinateToPrice: (y: number) => 220 - y,
    options: () => ({ priceFormat: { precision: 2, minMove: .01 } }),
    priceFormatter: () => ({ format: (price: number) => price.toFixed(2) }),
  };
  const container = document.createElement('div');
  Object.defineProperty(container, 'clientWidth', { value: 500 });
  Object.defineProperty(container, 'clientHeight', { value: 300 });
  document.body.appendChild(container);
  const bind = () => manager.setChart(chart, series as unknown as ISeriesApi<'Candlestick'>,
    id, 1, container, 'M1', id, 'account-test', () => providerBars);
  bind();
  await Promise.resolve();
  return { manager, id, bars, series, container, bind };
};

const coordinate = (node: Element | null, axis: 'cx' | 'cy') => {
  expect(node).not.toBeNull();
  return Number(node!.getAttribute(axis));
};

const drag = (node: Element, fromX: number, fromY: number, toX: number, toY: number) => {
  node.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, clientX: fromX, clientY: fromY }));
  window.dispatchEvent(new MouseEvent('pointermove', { clientX: toX, clientY: toY }));
  window.dispatchEvent(new MouseEvent('pointerup'));
};

const placeEmptyRegression = (manager: DrawingManager, id: string) => {
  manager.startDrawing('channel', '#2962ff', { subtype: 'regression_trend' });
  manager.addPoint(timeAt(25), 100, undefined, id, 25);
  manager.addPoint(timeAt(30), 80, undefined, id, 30);
};

describe('Regression trend recovery from a range without a fit', () => {
  beforeEach(() => {
    document.body.replaceChildren();
    localStorage.clear();
    sessionStorage.clear();
  });

  it('clamps future construction and keeps two editable price anchors until dragging into real candles recovers the fit', async () => {
    const { manager, id, container, series } = await attachChart();
    manager.startDrawing('channel', '#2962ff', { subtype: 'regression_trend' });
    manager.addPoint(timeAt(25), 100, undefined, id, 25);
    const first = container.querySelector('[data-geometry-role="construction-anchor-1"]');
    expect(coordinate(first, 'cx')).toBe(190);
    expect(coordinate(first, 'cy')).toBe(120);
    manager.updatePreviewPoint(timeAt(30), 80, id, 30);
    const preview = container.querySelector('[data-geometry-role="regression-preview-anchor"]');
    expect(coordinate(preview, 'cx')).toBe(190);
    expect(coordinate(preview, 'cy')).toBe(140);
    expect(preview!.getAttribute('pointer-events')).toBe('none');
    manager.addPoint(timeAt(30), 80, undefined, id, 30);

    const drawing = manager.getDrawings(id)[0];
    expect(drawing.points).toEqual([
      { time: timeAt(19), price: 100, logicalIndex: undefined },
      { time: timeAt(19), price: 80, logicalIndex: undefined },
    ]);
    expect(series.dataByIndex).toHaveBeenCalledWith(Number.MAX_SAFE_INTEGER, MismatchDirection.NearestLeft);
    expect(container.querySelector('[data-geometry-role="regression-center"]')).toBeNull();
    const handles = container.querySelectorAll('[data-geometry-role^="selection-anchor-"]');
    expect(handles).toHaveLength(2);
    expect(coordinate(handles[0], 'cy')).toBe(120);
    expect(coordinate(handles[1], 'cy')).toBe(140);
    handles.forEach(handle => expect(handle.getAttribute('pointer-events')).toBe('all'));

    drag(handles[0], 190, 120, 100, 120);
    expect(manager.getDrawings(id)[0].points.map(point => point.time)).toEqual([timeAt(10), timeAt(19)]);
    expect(container.querySelector('[data-geometry-role="regression-upper"]')).not.toBeNull();
    expect(container.querySelector('[data-geometry-role="regression-center"]')).not.toBeNull();
    expect(container.querySelector('[data-geometry-role="regression-lower"]')).not.toBeNull();
    expect(container.querySelectorAll('[data-geometry-role^="selection-anchor-"]')).toHaveLength(4);
    expect(container.querySelector('[data-geometry-role="regression-pearson"]')!.textContent).toContain('1.000000');
  });

  it('supports cancelling construction, locking empty-fit handles, and deleting the selected drawing', async () => {
    const { manager, id, container } = await attachChart();
    manager.startDrawing('channel', '#2962ff', { subtype: 'regression_trend' });
    manager.addPoint(timeAt(25), 100, undefined, id, 25);
    manager.cancelDrawing(id);
    expect(container.querySelector('[data-geometry-role="construction-anchor-1"]')).toBeNull();
    expect(manager.getDrawings(id)).toHaveLength(0);

    placeEmptyRegression(manager, id);
    const drawing = manager.getDrawings(id)[0];
    manager.updateDrawingProperties(drawing.id, { locked: true }, id);
    const handle = container.querySelector('[data-geometry-role="selection-anchor-start"]')!;
    drag(handle, 190, 120, 100, 120);
    expect(manager.getDrawings(id)[0].points[0].time).toBe(timeAt(19));
    expect(manager.deleteSelected(id)).toBe(1);
    expect(manager.getDrawings(id)).toHaveLength(0);
    expect(container.querySelector('[data-geometry-role^="selection-anchor-"]')).toBeNull();
  });

  it('clamps to a live-appended rendered candle even when the full-render provider is older', async () => {
    const { manager, id, bars, container } = await attachChart();
    bars.push({ ...bars.at(-1)!, time: timeAt(20) });
    placeEmptyRegression(manager, id);
    expect(manager.getDrawings(id)[0].points.map(point => point.time)).toEqual([timeAt(20), timeAt(20)]);
    expect(coordinate(container.querySelector('[data-geometry-role="selection-anchor-start"]'), 'cx')).toBe(200);
    expect(container.querySelector('[data-geometry-role="regression-center"]')).toBeNull();
  });

  it('uses the original chart owner for clamping and regression samples after a sibling becomes active', async () => {
    const owner = await attachChart();
    owner.manager.startDrawing('channel', '#2962ff', { subtype: 'regression_trend' });
    await attachChart(owner.manager, 'chart-sibling', makeBars().map(bar => ({ ...bar, time: bar.time + 86_400 })));
    owner.manager.addPoint(timeAt(25), 100, undefined, owner.id, 25);
    owner.manager.updatePreviewPoint(timeAt(30), 80, owner.id, 30);
    owner.manager.addPoint(timeAt(30), 80, undefined, owner.id, 30);
    expect(owner.manager.getDrawings(owner.id)[0].points.map(point => point.time)).toEqual([timeAt(19), timeAt(19)]);
    const handle = owner.container.querySelector('[data-geometry-role="selection-anchor-start"]')!;
    drag(handle, 190, 120, 100, 120);
    expect(owner.container.querySelector('[data-geometry-role="regression-center"]')).not.toBeNull();
    expect(owner.manager.getDrawings('chart-sibling')).toHaveLength(0);
  });

  it('retains editable source points without manufacturing a fit when no candles exist', async () => {
    const { manager, id, container } = await attachChart(new DrawingManager(), 'empty-chart', []);
    placeEmptyRegression(manager, id);
    expect(manager.getDrawings(id)[0].points.map(point => point.time)).toEqual([timeAt(25), timeAt(30)]);
    expect(container.querySelectorAll('[data-geometry-role^="selection-anchor-"]')).toHaveLength(2);
    expect(container.querySelector('[data-geometry-role="regression-center"]')).toBeNull();
  });
});
