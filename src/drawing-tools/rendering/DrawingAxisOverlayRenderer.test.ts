// @vitest-environment jsdom

import { describe, expect, it } from 'vitest';
import type { IChartApi, ISeriesApi, SeriesType } from 'lightweight-charts';
import type { DrawingPoint } from '../model/drawing';
import {
  DRAWING_AXIS_OVERLAY_ATTRIBUTE,
  DrawingAxisOverlayRenderer,
  segmentMidpoint,
} from './DrawingAxisOverlayRenderer';

const SVG_NS = 'http://www.w3.org/2000/svg';

const createRenderer = () => {
  const container = document.createElement('div');
  Object.defineProperty(container, 'clientWidth', { value: 500 });
  const chart = {
    options: () => ({
      localization: { timeFormatter: (time: number) => `broker:${time}` },
    }),
    priceScale: () => ({ width: () => 64 }),
    timeScale: () => ({ height: () => 20 }),
  } as unknown as IChartApi;
  const series = {
    options: () => ({ priceFormat: { precision: 3, minMove: 0.001 } }),
    priceFormatter: () => ({ format: (price: number) => price.toFixed(3) }),
    coordinateToPrice: (coordinate: number) => 200 - coordinate,
    priceToCoordinate: (price: number) => 200 - price,
  } as unknown as ISeriesApi<SeriesType>;
  const projectPoint = (point: DrawingPoint) => ({
    x: point.time,
    y: 200 - point.price,
  });

  return new DrawingAxisOverlayRenderer({
    getChart: () => chart,
    getSeries: () => series,
    getOverlayContainer: () => container,
    projectPoint,
    resolvePositionDefaults: drawing => ({
      positionTargetPrice: drawing.positionTargetPrice,
      positionStopPrice: drawing.positionStopPrice,
      positionEndTime: drawing.positionEndTime,
      positionEndLogicalIndex: drawing.positionEndLogicalIndex,
    }),
    getSeriesData: () => [],
  });
};

describe('DrawingAxisOverlayRenderer', () => {
  it('uses the active series and chart formatters', () => {
    const renderer = createRenderer();

    expect(renderer.getSeriesPriceFormat()).toEqual({ precision: 3, minMove: 0.001 });
    expect(renderer.formatPrice(1.23456)).toBe('1.235');
    expect(renderer.formatTimeScaleValue(123)).toBe('broker:123');
  });

  it('marks price and time selection bands as axis overlays', () => {
    const renderer = createRenderer();
    const group = document.createElementNS(SVG_NS, 'g');

    renderer.appendSelectionScaleBands(
      group,
      [{ x: 50, y: 70 }, { x: 150, y: 110 }],
      400,
      260,
    );

    const overlays = group.querySelectorAll(`[${DRAWING_AXIS_OVERLAY_ATTRIBUTE}="true"]`);
    expect(overlays).toHaveLength(2);
    expect(group.querySelector('[data-geometry-role="price-scale-range"]')).not.toBeNull();
    expect(group.querySelector('[data-geometry-role="time-scale-range"]')).not.toBeNull();
  });

  it('renders annotation labels through the neutral drawing contract', () => {
    const renderer = createRenderer();
    const group = document.createElementNS(SVG_NS, 'g');

    renderer.appendAnnotationScaleHighlights(group, {
      id: 'annotation-1',
      type: 'text',
      points: [{ time: 80, price: 120 }, { time: 140, price: 90 }],
    }, 400, 260, 1);

    expect(group.querySelector('[data-geometry-role="annotation-anchor-1-price"]')).not.toBeNull();
    expect(group.querySelector('[data-geometry-role="annotation-cursor-time"]')).not.toBeNull();
    expect(group.querySelector('[data-geometry-role="annotation-cursor-price"]')?.getAttribute('fill'))
      .toBe('#131722');
  });

  it('calculates segment midpoints without manager state', () => {
    expect(segmentMidpoint({ start: { x: 4, y: 8 }, end: { x: 10, y: 20 } }))
      .toEqual({ x: 7, y: 14 });
  });
});
