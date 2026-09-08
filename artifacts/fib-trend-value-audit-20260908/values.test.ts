import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { IChartApi, ISeriesApi } from 'lightweight-charts';
vi.mock('../../src/services/drawingApi', () => ({ drawingApi: {
  loadDrawings: vi.fn().mockResolvedValue([]), saveDrawing: vi.fn().mockResolvedValue('audit'),
  deleteDrawing: vi.fn().mockResolvedValue(undefined),
} }));
import { DrawingManager } from '../../src/services/drawingManager';

const levels = ['0', '0-236', '0-382', '0-5', '0-618', '0-786', '1', '1-618', '2-618', '3-618', '4-236'];
const harness = async (precision = 2) => {
  const viewport = { priceZoom: 1, priceOffset: 300, timeZoom: 1 };
  const y = (p: number) => viewport.priceOffset - p * viewport.priceZoom;
  const x = (t: number) => (t - 100) * viewport.timeZoom;
  const timeScale = {
    timeToCoordinate: x, coordinateToTime: (v: number) => v / viewport.timeZoom + 100,
    logicalToCoordinate: (v: number) => v * viewport.timeZoom,
    coordinateToLogical: (v: number) => v / viewport.timeZoom,
    height: () => 20,
  };
  const series = {
    priceToCoordinate: y, coordinateToPrice: (v: number) => (viewport.priceOffset - v) / viewport.priceZoom,
    options: () => ({ priceFormat: { precision, minMove: 10 ** -precision } }),
    priceFormatter: () => ({ format: (v: number) => v.toFixed(precision) }),
    data: () => [],
  } as unknown as ISeriesApi<'Candlestick'>;
  const timeFormatter = (t: number) => new Date(t * 1000).toISOString().slice(11, 19);
  const chart = {
    timeScale: () => timeScale, priceScale: () => ({ width: () => 60 }),
    options: () => ({ localization: { timeFormatter } }),
  } as unknown as IChartApi;
  const container = document.createElement('div');
  Object.defineProperty(container, 'clientWidth', { value: 800 });
  Object.defineProperty(container, 'clientHeight', { value: 600 });
  document.body.appendChild(container);
  const manager = new DrawingManager();
  manager.setChart(chart, series, 'AUDIT', 1, container, 'M1', 'audit-context', 'audit-account');
  await Promise.resolve();
  const text = (role: string) => container.querySelector(`[data-geometry-role="${role}"]`)?.textContent;
  const el = (role: string) => container.querySelector(`[data-geometry-role="${role}"]`)!;
  const complete = (subtype: 'fib_retracement' | 'trendline', a: number, b: number) => {
    manager.startDrawing(subtype === 'trendline' ? 'trendline' : 'fibonacci', '#2962ff', { subtype });
    manager.addPoint(160, a, undefined, 'audit-context');
    manager.addPoint(280, b, undefined, 'audit-context');
  };
  return { manager, container, viewport, x, y, text, el, complete };
};
beforeEach(() => { document.body.replaceChildren(); localStorage.clear(); sessionStorage.clear(); });

describe('Independent Fibonacci and trendline value audit', () => {
  it.each([
    { name: 'upward 100 to 200', a: 100, b: 200, expected: [200,176.4,161.8,150,138.2,121.4,100,38.2,-61.8,-161.8,-223.6] },
    { name: 'downward 200 to 100', a: 200, b: 100, expected: [100,123.6,138.2,150,161.8,178.6,200,261.8,361.8,461.8,523.6] },
    { name: 'flat 150 to 150', a: 150, b: 150, expected: Array(11).fill(150) },
  ])('all eleven Fibonacci labels and lines: $name', async ({ a, b, expected }) => {
    const h = await harness(); h.complete('fib_retracement', a, b);
    levels.forEach((key, i) => {
      expect(h.text(`fib-retracement-label-${key}`)).toBe(`${key.replace('-', '.')} (${expected[i].toFixed(2)})`);
      expect(Number(h.el(`fib-retracement-level-${key}`).getAttribute('y1'))).toBeCloseTo(h.y(expected[i]), 8);
      expect(Number(h.el(`fib-retracement-level-${key}`).getAttribute('y2'))).toBeCloseTo(h.y(expected[i]), 8);
    });
  });

  it('preserves five-decimal instrument formatting', async () => {
    const h = await harness(5); h.complete('fib_retracement', 1.1, 1.2);
    expect(h.text('fib-retracement-label-0-618')).toBe('0.618 (1.13820)');
    expect(h.text('endpoint-1-price-scale-label-text')).toBe('1.10000');
    expect(h.text('endpoint-2-price-scale-label-text')).toBe('1.20000');
  });

  it.each(['fib_retracement', 'trendline'] as const)('%s labels use exact endpoint prices and the chart time formatter', async subtype => {
    const h = await harness(); h.complete(subtype, 101.234, 109.876);
    expect(h.text('endpoint-1-price-scale-label-text')).toBe('101.23');
    expect(h.text('endpoint-2-price-scale-label-text')).toBe('109.88');
    expect(h.text('endpoint-1-time-scale-label-text')).toBe('00:02:40');
    expect(h.text('endpoint-2-time-scale-label-text')).toBe('00:04:40');
    for (const [index, price] of [[1,101.234],[2,109.876]]) {
      expect(Number(h.el(`endpoint-${index}-price-scale-label`).getAttribute('y')) + 9).toBeCloseTo(h.y(price), 8);
    }
  });

  it.each(['fib_retracement', 'trendline'] as const)('%s zoom changes coordinates without changing price/time labels', async subtype => {
    const h = await harness(); h.complete(subtype, 100, 200);
    const labels = () => Array.from(h.container.querySelectorAll('text[data-geometry-role]')).map(e => e.textContent);
    const before = labels();
    h.viewport.priceZoom = 1.5; h.viewport.priceOffset = 400; h.viewport.timeZoom = 2;
    h.manager.renderAll(); expect(labels()).toEqual(before);
    expect(Number(h.el('selection-anchor-1').getAttribute('cx'))).toBe(h.x(160));
    expect(Number(h.el('selection-anchor-1').getAttribute('cy'))).toBe(h.y(100));
    if (subtype === 'fib_retracement') expect(Number(h.el('fib-retracement-level-0-618').getAttribute('y1'))).toBeCloseTo(h.y(138.2));
  });

  it.each(['fib_retracement', 'trendline'] as const)('%s dragging an endpoint updates the actual anchor and value labels', async subtype => {
    const h = await harness(); h.complete(subtype, 100, 200);
    h.el('selection-anchor-2').dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, clientX: h.x(280), clientY: h.y(200) }));
    window.dispatchEvent(new MouseEvent('pointermove', { clientX: h.x(340), clientY: h.y(220) }));
    window.dispatchEvent(new MouseEvent('pointerup'));
    const points = h.manager.getDrawings('audit-context')[0].points;
    expect(points[1].price).toBe(220);
    expect(h.text('endpoint-2-price-scale-label-text')).toBe('220.00');
    expect(h.text('endpoint-2-time-scale-label-text')).toBe(new Date(points[1].time * 1000).toISOString().slice(11, 19));
    if (subtype === 'fib_retracement') expect(h.text('fib-retracement-label-0-5')).toBe('0.5 (160.00)');
  });
});
