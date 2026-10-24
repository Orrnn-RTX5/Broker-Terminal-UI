import { describe, expect, it } from 'vitest';
import {
  buildTickChartCrosshair,
  buildTickChartGeometry,
  formatTickChartPrice,
  type TickChartLayoutOptions,
  type TickChartPoint,
} from './tickChartGeometry';

const utcDate = (epochMs: number): string => new Date(epochMs).toISOString().slice(0, 10).replace(/-/g, '.');
const utcTime = (epochMs: number): string => new Date(epochMs).toISOString().slice(11, 19);

const layout = (overrides: Partial<TickChartLayoutOptions> = {}): TickChartLayoutOptions => ({
  width: 360,
  height: 400,
  fontSize: 12,
  digits: 2,
  formatDate: utcDate,
  formatTime: utcTime,
  ...overrides,
});

const START = Date.UTC(2026, 8, 29, 8, 0, 0);
const ticks = (count: number, stepMs = 1_000, start = START): TickChartPoint[] => (
  Array.from({ length: count }, (_, index) => ({
    timestamp: start + index * stepMs,
    bid: 4126.2 + (index % 10) * 0.18,
    ask: 4126.6 + (index % 10) * 0.18,
  }))
);

describe('buildTickChartGeometry', () => {
  it('returns nothing without ticks or drawing space', () => {
    expect(buildTickChartGeometry([], layout())).toBeNull();
    expect(buildTickChartGeometry(ticks(3), layout({ width: 0 }))).toBeNull();
  });

  it('draws each quote as a step line that runs flat to the frame', () => {
    const geometry = buildTickChartGeometry([
      { timestamp: START, bid: 10, ask: 11 },
      { timestamp: START + 1, bid: 12, ask: 13 },
      { timestamp: START + 2, bid: 11, ask: 12 },
    ], layout())!;

    expect(geometry.bidPath).toMatch(/^M0\.5 [\d.]+H[\d.]+V[\d.]+H[\d.]+V[\d.]+H[\d.]+$/);
    expect(geometry.bidPath.endsWith(`H${geometry.plot.right}`)).toBe(true);
    expect(geometry.visibleCount).toBe(3);
  });

  it('shows at most one tick per pixel column, keeping the newest', () => {
    const points = ticks(1_500);
    const geometry = buildTickChartGeometry(points, layout({ width: 200 }))!;

    expect(geometry.visibleCount).toBeLessThan(200);
    expect(geometry.latest).toBe(points.at(-1));
  });

  it('labels the price axis on round steps at the broker digits', () => {
    const geometry = buildTickChartGeometry(ticks(40), layout())!;
    const labels = geometry.priceTicks.map(tick => tick.label);

    expect(labels.length).toBeGreaterThan(3);
    labels.forEach(label => expect(label).toMatch(/^\d{4}\.\d{2}$/));
    const steps = labels.slice(1).map((label, index) => Number(label) - Number(labels[index]));
    steps.forEach(step => expect(step).toBeCloseTo(steps[0], 8));
    expect([0.1, 0.2, 0.25, 0.5, 1]).toContainEqual(Number(steps[0].toFixed(8)));
  });

  it('keeps the backend precision when the broker sends no digits', () => {
    expect(formatTickChartPrice(4127.8, null)).toBe('4127.8');
    expect(formatTickChartPrice(4127.8, 2)).toBe('4127.80');
    const geometry = buildTickChartGeometry(ticks(40), layout({ digits: null }))!;
    expect(geometry.askTag.label).toBe(String(ticks(40).at(-1)!.ask));
  });

  it('expands price-scale ticks when observed quote precision is finer than catalog digits', () => {
    const subCentTicks: TickChartPoint[] = [
      { timestamp: START, bid: 0.2055, ask: 0.2057 },
      { timestamp: START + 1_000, bid: 0.2063, ask: 0.2065 },
      { timestamp: START + 2_000, bid: 0.2068, ask: 0.2070 },
    ];
    const geometry = buildTickChartGeometry(subCentTicks, layout({ digits: 2 }))!;
    expect(geometry.priceTicks.length).toBeGreaterThan(0);
    expect(geometry.labelDigits).toBe(4);
    expect(geometry.bidTag.label).toBe('0.2068');
    expect(geometry.askTag.label).toBe('0.2070');
  });

  it('starts the time axis with the date and ends with the newest tick time', () => {
    const geometry = buildTickChartGeometry(ticks(300), layout())!;
    const labels = geometry.timeTicks.map(tick => tick.label);

    expect(labels[0]).toBe('2026.09.29');
    expect(labels.at(-1)).toBe(utcTime(ticks(300).at(-1)!.timestamp));
    labels.slice(1, -1).forEach(label => expect(label).toMatch(/^\d{2}:\d{2}$/));
    const xs = geometry.timeTicks.map(tick => tick.x);
    xs.slice(1).forEach((x, index) => expect(x).toBeGreaterThan(xs[index]));
  });

  it('marks broker-day boundaries with a separator', () => {
    const lateTicks = ticks(20, 60_000, Date.UTC(2026, 8, 28, 17, 30));
    const morningTicks = ticks(20, 60_000, Date.UTC(2026, 8, 29, 7, 58));
    const geometry = buildTickChartGeometry([...lateTicks, ...morningTicks], layout())!;

    expect(geometry.separators).toHaveLength(1);
    expect(geometry.timeTicks[0].label).toBe('2026.09.28');
  });

  it('keeps the Ask tag above the Bid tag without overlap', () => {
    const geometry = buildTickChartGeometry([
      { timestamp: START, bid: 100, ask: 200 },
      { timestamp: START + 1, bid: 150, ask: 150.01 },
    ], layout())!;

    expect(geometry.bidTag.y - geometry.askTag.y).toBeGreaterThanOrEqual(geometry.tagHeight);
    expect(geometry.askTag.label).toBe('150.01');
    expect(geometry.bidTag.label).toBe('150.00');
  });

  it('builds MT5 crosshair coordinates, Bid / Ask quote pill, and axis tags inside the plot', () => {
    const opts = layout({ digits: 5 });
    const geometry = buildTickChartGeometry([
      { timestamp: Date.UTC(2026, 9, 14, 13, 12, 20), bid: 1.11915, ask: 1.11916 },
      { timestamp: Date.UTC(2026, 9, 14, 13, 12, 21), bid: 1.11920, ask: 1.11921 },
      { timestamp: Date.UTC(2026, 9, 14, 13, 12, 22), bid: 1.11925, ask: 1.11927 },
    ], opts)!;

    expect(buildTickChartCrosshair(geometry, null, opts)).toBeNull();
    expect(buildTickChartCrosshair(geometry, { x: geometry.plot.right + 5, y: 100 }, opts)).toBeNull();

    const midX = geometry.plot.left + ((geometry.plot.right - geometry.plot.left) * 0.95) / 2;
    const crosshair = buildTickChartCrosshair(geometry, { x: midX, y: 200 }, opts)!;
    expect(crosshair).not.toBeNull();
    expect(crosshair.index).toBe(1);
    expect(crosshair.quotePill.label).toBe('1.11920 / 1.11921');
    expect(crosshair.timeTag.label).toBe('2026.10.14 13:12:21');
    expect(crosshair.priceTag.label).toMatch(/^1\.119\d\d$/);

    // Clamps pill inside plot when hovering near the top-right corner
    const corner = buildTickChartCrosshair(
      geometry,
      { x: geometry.plot.right - 1, y: geometry.plot.top + 1 },
      opts,
    )!;
    expect(corner.quotePill.x + corner.quotePill.width).toBeLessThanOrEqual(geometry.plot.right - 2);
    expect(corner.quotePill.y).toBeGreaterThanOrEqual(geometry.plot.top + 2);
  });
});

