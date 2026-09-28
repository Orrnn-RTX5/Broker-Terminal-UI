// @vitest-environment jsdom

import { describe, expect, it, vi } from 'vitest';
import type { IChartApi, ISeriesApi, SeriesType } from 'lightweight-charts';
import type { DrawingPoint } from '../model/drawing';
import { DrawingTrendChannelRenderer } from './DrawingTrendChannelRenderer';

const SVG_NS = 'http://www.w3.org/2000/svg';

const createLine = (
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  stroke: string,
  lineWidth: number,
  dash = 'none',
): SVGLineElement => {
  const line = document.createElementNS(SVG_NS, 'line');
  line.setAttribute('x1', String(x1));
  line.setAttribute('y1', String(y1));
  line.setAttribute('x2', String(x2));
  line.setAttribute('y2', String(y2));
  line.setAttribute('stroke', stroke);
  line.setAttribute('stroke-width', String(lineWidth));
  if (dash !== 'none') line.setAttribute('stroke-dasharray', dash);
  return line;
};

const createText = (
  x: number,
  y: number,
  value: string,
  fill: string,
  size: number,
): SVGTextElement => {
  const text = document.createElementNS(SVG_NS, 'text');
  text.setAttribute('x', String(x));
  text.setAttribute('y', String(y));
  text.setAttribute('fill', fill);
  text.setAttribute('font-size', String(size));
  text.textContent = value;
  return text;
};

const createRenderer = () => {
  const beginDrag = vi.fn();
  const openContextMenu = vi.fn();
  const chart = {
    priceScale: () => ({ width: () => 50 }),
    timeScale: () => ({
      height: () => 20,
      timeToCoordinate: (time: number) => time,
    }),
  } as unknown as IChartApi;
  const series = {
    coordinateToPrice: (coordinate: number) => 200 - coordinate,
    priceToCoordinate: (price: number) => 200 - price,
  } as unknown as ISeriesApi<SeriesType>;
  const projectPoint = (point: DrawingPoint) => ({ x: point.time, y: 200 - point.price });
  const renderer = new DrawingTrendChannelRenderer({
    getChart: () => chart,
    getSeries: () => series,
    getPreviewPoint: () => null,
    isPreviewCursorVisible: () => false,
    getSeriesData: () => [
      { time: 100, close: 10 },
      { time: 200, close: 20 },
      { time: 300, close: 30 },
    ],
    projectPoint,
    formatPrice: price => price.toFixed(2),
    getThemeToken: (_name, fallback) => fallback,
    appendPriceScaleRangeBand: vi.fn(),
    appendPriceScaleLabel: vi.fn(),
    appendTimeScaleLabel: vi.fn(),
    createLine,
    createText,
    beginDrag,
    openContextMenu,
  });
  return { beginDrag, openContextMenu, renderer };
};

describe('DrawingTrendChannelRenderer', () => {
  it('projects parallel-channel geometry without manager state', () => {
    const { renderer } = createRenderer();
    const geometry = renderer.getTrendChannelGeometry({
      id: 'channel-1',
      type: 'trendline',
      subtype: 'parallel_channel',
      points: [
        { time: 10, price: 100 },
        { time: 20, price: 110 },
        { time: 10, price: 120 },
      ],
    }, false);

    expect(geometry?.baseline.start).toEqual({ x: 10, y: 100 });
    expect(geometry?.boundary.start.y).toBe(80);
    expect(geometry?.midpoint.start.y).toBe(90);
  });

  it('calculates regression segments from neutral series data', () => {
    const { renderer } = createRenderer();
    const regression = renderer.getRegressionSegments({
      id: 'regression-1',
      type: 'trendline',
      subtype: 'regression_trend',
      points: [{ time: 100, price: 10 }, { time: 300, price: 30 }],
    });

    expect(regression?.sampleCount).toBe(3);
    expect(regression?.center).toEqual({
      start: { x: 100, y: 190 },
      end: { x: 300, y: 170 },
    });
    expect(regression?.pearsonCorrelation).toBeCloseTo(1);
  });

  it('renders channel fills and interaction targets through callbacks', () => {
    const { renderer } = createRenderer();
    const group = document.createElementNS(SVG_NS, 'g');

    expect(renderer.renderTrendChannelVariant(group, {
      id: 'channel-2',
      type: 'trendline',
      subtype: 'parallel_channel',
      points: [
        { time: 10, price: 100 },
        { time: 20, price: 110 },
        { time: 10, price: 120 },
      ],
    }, 500, 300, '#2962ff', 2, 'none', '1', false)).toBe(true);

    expect(group.querySelector('[data-geometry-role="channel-fill"]')).not.toBeNull();
    expect(group.querySelector('[data-geometry-role="channel-baseline-hit"]')).not.toBeNull();
    expect(group.querySelector('[data-geometry-role="channel-middle-level"]')).not.toBeNull();
  });
});
