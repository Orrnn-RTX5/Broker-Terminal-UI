import { describe, expect, it } from 'vitest';
import type { IChartApi, ISeriesApi } from 'lightweight-charts';
import { freehandPath, freehandPointAt, projectFreehandPoint } from './freehandGeometry';

const fixture = () => {
  const times = [100, 160, 220, 400]; // A real session gap must not change bar spacing.
  const view = { spacing: 20, left: 0, priceScale: 2 };
  const scale = {
    coordinateToLogical: (x: number) => Math.round((x - view.left) / view.spacing),
    logicalToCoordinate: (i: number) => Number.isInteger(i) ? view.left + i * view.spacing : 0,
    coordinateToTime: (x: number) => times[Math.round((x - view.left) / view.spacing)] ?? null,
    timeToIndex: (time: number) => times.includes(time) ? times.indexOf(time) : null,
  };
  const chart = { timeScale: () => scale } as unknown as IChartApi;
  const series = {
    dataByIndex: () => ({ time: times.at(-1) }),
    coordinateToPrice: (y: number) => 100 - y / view.priceScale,
    priceToCoordinate: (p: number) => (100 - p) * view.priceScale,
  } as unknown as ISeriesApi<any>;
  return { chart, series, times, view };
};

describe('freehand chart coordinates', () => {
  it('preserves within-candle placement and real OHLC price-scale conversion', () => {
    const { chart, series } = fixture();
    const point = freehandPointAt(chart, series, 46, 73)!;
    expect(point).toEqual({ time: 220, price: 63.5, logicalIndex: 2.3, barOffset: expect.closeTo(.3, 8) });
    expect(projectFreehandPoint(chart, series, point)).toEqual({ x: 46, y: 73 });
  });
  it('rebases through history prepends and zoom without mutating stored points', () => {
    const { chart, series, times, view } = fixture();
    const point = freehandPointAt(chart, series, 46, 73)!;
    times.unshift(-20, 40);
    view.spacing = 40; view.left = -80; view.priceScale = 4;
    expect(projectFreehandPoint(chart, series, point)).toEqual({ x: 92, y: 146 });
    expect(point.time).toBe(220);
  });
  it('keeps future whitespace anchored when live candles are appended', () => {
    const { chart, series, times } = fixture();
    const point = freehandPointAt(chart, series, 105, 100)!;
    expect(point.time).toBe(400);
    expect(point.barOffset).toBe(2.25);
    times.push(460, 520, 580);
    expect(projectFreehandPoint(chart, series, point)).toEqual({ x: 105, y: 100 });
  });
  it('renders dots and smooth paths with the exact first and last locations', () => {
    expect(freehandPath([{ x: 4, y: 5 }])).toBe('M4.00,5.00 L4.00,5.00');
    const path = freehandPath([{ x: 4, y: 5 }, { x: 8, y: 10 }, { x: 12, y: 3 }, { x: 18, y: 9 }]);
    expect(path).toMatch(/^M4.00,5.00 Q/);
    expect(path).toMatch(/L18.00,9.00$/);
    expect(freehandPath([])).toBe('');
  });
});
