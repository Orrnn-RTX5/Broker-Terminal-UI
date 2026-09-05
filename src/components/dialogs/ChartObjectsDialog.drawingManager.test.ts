// @vitest-environment jsdom

import type { IChartApi, ISeriesApi } from 'lightweight-charts';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../services/drawingApi', () => ({
  drawingApi: {
    loadDrawings: vi.fn().mockResolvedValue([]),
    saveDrawing: vi.fn().mockResolvedValue('server-drawing'),
    deleteDrawing: vi.fn().mockResolvedValue(undefined),
  },
}));

import {
  DrawingManager,
  isArrowDrawing,
  type Drawing,
  type DrawingType,
} from '../../services/drawingManager';

const createChartHarness = () => {
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
    data: () => [],
  } as unknown as ISeriesApi<'Candlestick'>;
  const container = document.createElement('div');
  Object.defineProperty(container, 'clientWidth', { value: 500 });
  Object.defineProperty(container, 'clientHeight', { value: 300 });
  document.body.appendChild(container);
  return { chart, series, container };
};

const addOnePointDrawing = (
  manager: DrawingManager,
  contextId: string,
  type: DrawingType,
  subtype?: string,
): Drawing => {
  manager.startDrawing(type, '#2196F3', subtype ? { subtype } : undefined);
  expect(manager.addPoint(Date.now() / 1000, 100, undefined, contextId)).toBe(true);
  const drawing = manager.getDrawings(contextId).at(-1);
  expect(drawing).toBeDefined();
  return drawing!;
};

describe('DrawingManager chart-object APIs', () => {
  beforeEach(() => {
    document.body.replaceChildren();
    localStorage.clear();
    sessionStorage.clear();
  });

  it('queries and changes selection in an explicit context without stealing the active chart', () => {
    const manager = new DrawingManager();
    const first = createChartHarness();
    const second = createChartHarness();

    manager.setChart(first.chart, first.series, 'XAUUSD', 1, first.container, 'M1', 'chart-a', 'account-1');
    const firstDrawing = addOnePointDrawing(manager, 'chart-a', 'hline');
    manager.setChart(second.chart, second.series, 'EURUSD', 1, second.container, 'M5', 'chart-b', 'account-1');
    const secondDrawing = addOnePointDrawing(manager, 'chart-b', 'vline');

    expect(manager.getDrawings('chart-a')).toEqual([
      expect.objectContaining({ id: firstDrawing.id }),
    ]);
    expect(manager.selectDrawing(firstDrawing.id, true, 'chart-a')).toBe(true);
    expect(manager.getDrawings('chart-a')[0].selected).toBe(true);
    expect(manager.getDrawings('chart-b')[0]).toEqual(
      expect.objectContaining({ id: secondDrawing.id, selected: true }),
    );

    manager.startDrawing('hline');
    expect(manager.getActiveDrawing('chart-b')).not.toBeNull();
    expect(manager.getActiveDrawing('chart-a')).toBeNull();
    manager.cancelDrawing('chart-b');

    expect(manager.unselectDrawing(firstDrawing.id, 'chart-a')).toBe(true);
    expect(manager.getDrawings('chart-a')[0].selected).toBe(false);
    expect(manager.getDrawings('missing-context')).toEqual([]);
  });

  it('deletes only directional stamp arrows from the requested chart', () => {
    const manager = new DrawingManager();
    const first = createChartHarness();
    const second = createChartHarness();

    manager.setChart(first.chart, first.series, 'XAUUSD', 1, first.container, 'M1', 'chart-a', 'account-1');
    ['arrowUp', 'arrowDown', 'arrow', 'buy', 'sell', 'thumbsUp'].forEach(subtype => {
      addOnePointDrawing(manager, 'chart-a', 'stamp', subtype);
    });
    const line = addOnePointDrawing(manager, 'chart-a', 'hline');

    manager.setChart(second.chart, second.series, 'EURUSD', 1, second.container, 'M5', 'chart-b', 'account-1');
    const otherChartArrow = addOnePointDrawing(manager, 'chart-b', 'stamp', 'arrowDown');
    const changed = vi.fn();
    window.addEventListener('drawings:changed', changed);

    expect(manager.deleteArrows('chart-a')).toBe(5);
    expect(manager.getDrawings('chart-a')).toEqual([
      expect.objectContaining({ type: 'stamp', subtype: 'thumbsUp' }),
      expect.objectContaining({ id: line.id }),
    ]);
    expect(manager.getDrawings('chart-a').some(isArrowDrawing)).toBe(false);
    expect(manager.getDrawings('chart-b')).toEqual([
      expect.objectContaining({ id: otherChartArrow.id, subtype: 'arrowDown' }),
    ]);
    expect(changed).toHaveBeenCalledTimes(5);
    expect(changed.mock.calls.every(([event]) => (
      (event as CustomEvent).detail.contextId === 'chart-a'
      && (event as CustomEvent).detail.reason === 'deleted'
    ))).toBe(true);

    manager.startDrawing('hline');
    expect(manager.getActiveDrawing('chart-b')).not.toBeNull();
    window.removeEventListener('drawings:changed', changed);
  });

  it('deletes the last-created object even after selection changes z-order', () => {
    const manager = new DrawingManager();
    const first = createChartHarness();
    const second = createChartHarness();

    manager.setChart(first.chart, first.series, 'XAUUSD', 1, first.container, 'M1', 'chart-a', 'account-1');
    const firstDrawing = addOnePointDrawing(manager, 'chart-a', 'hline');
    const lastDrawing = addOnePointDrawing(manager, 'chart-a', 'vline');
    expect(manager.selectDrawing(firstDrawing.id, false, 'chart-a')).toBe(true);
    expect(manager.getDrawings('chart-a').at(-1)?.id).toBe(firstDrawing.id);

    manager.setChart(second.chart, second.series, 'EURUSD', 1, second.container, 'M5', 'chart-b', 'account-1');
    addOnePointDrawing(manager, 'chart-b', 'hline');

    expect(manager.deleteLast('chart-a')).toBe(true);
    expect(manager.getDrawings('chart-a').map(drawing => drawing.id)).toEqual([firstDrawing.id]);
    expect(manager.getDrawings('chart-a').some(drawing => drawing.id === lastDrawing.id)).toBe(false);
    expect(manager.getDrawings('chart-b')).toHaveLength(1);

    manager.startDrawing('vline');
    expect(manager.getActiveDrawing('chart-b')).not.toBeNull();
  });
});
