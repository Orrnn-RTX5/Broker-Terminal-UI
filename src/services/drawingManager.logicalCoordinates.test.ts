// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { IChartApi, ISeriesApi } from 'lightweight-charts';

vi.mock('./drawingApi', () => ({
  drawingApi: {
    loadDrawings: vi.fn().mockResolvedValue([]),
    saveDrawing: vi.fn().mockResolvedValue('server-logical'),
    deleteDrawing: vi.fn().mockResolvedValue(undefined),
  },
}));

import { DrawingManager } from './drawingManager';

const FIRST_TIME = 1_700_000_000;
const timeAt = (logical: number) => FIRST_TIME + logical * 60;
const CONTEXT = 'chart-logical';

const createHarness = async () => {
  const times = Array.from({ length: 20 }, (_, index) => timeAt(index));
  const timeScale = {
    timeToCoordinate: vi.fn((time: number) => {
      const index = times.indexOf(time);
      return index >= 0 ? index * 10 : null;
    }),
    logicalToCoordinate: vi.fn((logical: number) => Number.isInteger(logical) ? logical * 10 : 0),
    coordinateToLogical: (coordinate: number) => coordinate / 10,
    coordinateToTime: (coordinate: number) => times[Math.round(coordinate / 10)] ?? null,
    height: () => 20,
  };
  const chart = { timeScale: () => timeScale, priceScale: () => ({ width: () => 40 }) };
  const series = {
    priceToCoordinate: (price: number) => 220 - price,
    coordinateToPrice: (coordinate: number) => 220 - coordinate,
    options: () => ({ priceFormat: { precision: 2, minMove: 0.01 } }),
    priceFormatter: () => ({ format: (price: number) => price.toFixed(2) }),
  };
  const container = document.createElement('div');
  Object.defineProperty(container, 'clientWidth', { value: 500 });
  Object.defineProperty(container, 'clientHeight', { value: 300 });
  document.body.appendChild(container);
  const manager = new DrawingManager();
  manager.setChart(chart as unknown as IChartApi, series as unknown as ISeriesApi<'Candlestick'>,
    'TEST', 1, container, 'M1', CONTEXT, 'account-test');
  await Promise.resolve();
  return { manager, container, timeScale };
};

const attribute = (element: Element | null, name: string) => {
  expect(element).not.toBeNull();
  return Number(element!.getAttribute(name));
};

describe('DrawingManager with integer-only chart projection', () => {
  beforeEach(() => {
    document.body.replaceChildren();
    localStorage.clear();
    sessionStorage.clear();
  });

  it.each(['trendline', 'ray'])('keeps fractional future %s previews and completion at the pointer position', async (subtype) => {
    const { manager, container, timeScale } = await createHarness();
    manager.startDrawing('trendline', '#2962ff', { subtype });
    manager.addPoint(timeAt(10), 100, undefined, CONTEXT, 10);
    manager.updatePreviewPoint(timeAt(25.5), 80, CONTEXT, 25.5);
    const preview = container.querySelector('g[data-id$="-preview"] line');
    expect(attribute(preview, 'x1')).toBe(100);
    expect(attribute(preview, 'x2')).toBeCloseTo(subtype === 'ray' ? 460 : 255, 8);

    manager.addPoint(timeAt(25.5), 80, undefined, CONTEXT, 25.5);
    expect(attribute(container.querySelector('[data-geometry-role="selection-anchor-2"]'), 'cx')).toBe(255);
    expect(manager.getDrawings(CONTEXT)[0].points[1]).toMatchObject({
      time: timeAt(25.5), logicalIndex: 25.5,
    });
    expect(timeScale.logicalToCoordinate.mock.calls.every(([index]) => Number.isInteger(index))).toBe(true);
  });

  it('keeps durable candle time ahead of a stale fractional logical fallback', async () => {
    const { manager, container, timeScale } = await createHarness();
    manager.startDrawing('trendline', '#2962ff', { subtype: 'trendline' });
    manager.addPoint(timeAt(10), 100, undefined, CONTEXT, 2.5);
    manager.addPoint(timeAt(15), 80, undefined, CONTEXT, 4.5);
    expect(attribute(container.querySelector('[data-geometry-role="selection-anchor-1"]'), 'cx')).toBe(100);
    expect(attribute(container.querySelector('[data-geometry-role="selection-anchor-2"]'), 'cx')).toBe(150);
    expect(timeScale.logicalToCoordinate).not.toHaveBeenCalled();
  });

  it('retains a 45-degree Shift constraint when the projected Ray endpoint remains in future space', async () => {
    const { manager, container } = await createHarness();
    manager.startDrawing('trendline', '#2962ff', { subtype: 'ray' });
    manager.addPoint(timeAt(10), 100, undefined, CONTEXT, 10);
    manager.addPoint(timeAt(25.5), 0, undefined, CONTEXT, 25.5, true);
    const endpoint = container.querySelector('[data-geometry-role="selection-anchor-2"]');
    const x = attribute(endpoint, 'cx');
    const y = attribute(endpoint, 'cy');
    expect(x).toBeGreaterThan(190);
    expect(x - 100).toBeCloseTo(y - 120, 8);
  });

  it.each(['endpoint', 'body'])('drags a future Ray %s from its interpolated position without jumping to zero', async (target) => {
    const { manager, container } = await createHarness();
    manager.startDrawing('trendline', '#2962ff', { subtype: 'ray' });
    manager.addPoint(timeAt(22.5), 100, undefined, CONTEXT, 22.5);
    manager.addPoint(timeAt(25.5), 80, undefined, CONTEXT, 25.5);
    const element = target === 'endpoint'
      ? container.querySelector('[data-geometry-role="selection-anchor-2"]')
      : container.querySelector('g[data-id] line[stroke="transparent"]');
    expect(element).not.toBeNull();
    element!.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, clientX: 255, clientY: 140 }));
    window.dispatchEvent(new MouseEvent('pointermove', { clientX: 280, clientY: 150 }));
    window.dispatchEvent(new MouseEvent('pointerup'));

    expect(attribute(container.querySelector('[data-geometry-role="selection-anchor-2"]'), 'cx')).toBe(280);
    expect(manager.getDrawings(CONTEXT)[0].points[1]).toMatchObject({
      time: timeAt(28), logicalIndex: 28, price: 70,
    });
    expect(attribute(container.querySelector('[data-geometry-role="selection-anchor-1"]'), 'cx'))
      .toBe(target === 'body' ? 250 : 225);
  });

  it.each(['vertical_line', 'crossline'])('projects a future %s fractional anchor consistently', async (subtype) => {
    const { manager, container } = await createHarness();
    manager.startDrawing('vline', '#2962ff', { subtype });
    manager.addPoint(timeAt(25.5), 100, undefined, CONTEXT, 25.5);
    expect(attribute(container.querySelector('g[data-id] line'), 'x1')).toBe(255);
  });
});
