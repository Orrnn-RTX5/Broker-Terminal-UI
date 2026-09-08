// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MismatchDirection, type IChartApi, type ISeriesApi, type Time } from 'lightweight-charts';
import { projectDrawingTimeAtLogical } from './drawingTimeProjection';

vi.mock('../../services/drawingApi', () => ({
  drawingApi: {
    loadDrawings: vi.fn().mockResolvedValue([]),
    saveDrawing: vi.fn().mockResolvedValue('server-projection'),
    deleteDrawing: vi.fn().mockResolvedValue(undefined),
  },
}));

import { DrawingManager } from '../../services/drawingManager';

const createFilteredHistory = () => {
  const raw = Array.from({ length: 1000 }, (_, index) => ({
    time: 1_788_761_400 + (index * 60), open: 100, high: 110, low: 90, close: 105,
  }));
  const rendered = raw.slice(400);
  const timeScale = {
    timeToIndex: vi.fn((time: Time) => {
      const index = rendered.findIndex(row => row.time === time);
      return index < 0 ? null : index;
    }),
    timeToCoordinate: (time: Time) => {
      const index = rendered.findIndex(row => row.time === time);
      return index < 0 ? null : (index - 580) * 10;
    },
    logicalToCoordinate: (logical: number) => (logical - 580) * 10,
    coordinateToLogical: (coordinate: number) => 580 + (coordinate / 10),
    coordinateToTime: (coordinate: number) => rendered[Math.round(580 + coordinate / 10)]?.time ?? null,
    height: () => 20,
  };
  const series = {
    dataByIndex: vi.fn(() => {
      const latest = rendered.at(-1);
      return latest ? { ...latest, time: latest.time as Time } : null;
    }),
    data: vi.fn(() => rendered),
    priceToCoordinate: (price: number) => 220 - price,
    coordinateToPrice: (coordinate: number) => 220 - coordinate,
    options: () => ({ priceFormat: { precision: 2, minMove: 0.01 } }),
    priceFormatter: () => ({ format: (price: number) => price.toFixed(2) }),
  };
  return { raw, rendered, series, timeScale };
};

describe('drawing time projection from the rendered chart', () => {
  beforeEach(() => {
    document.body.replaceChildren();
    localStorage.clear();
    sessionStorage.clear();
  });

  it('projects future logical 605 from rendered index 599 instead of raw history index 999', () => {
    const { raw, rendered, series, timeScale } = createFilteredHistory();
    const latestTime = rendered.at(-1)!.time;
    expect(raw).toHaveLength(1000);
    expect(rendered).toHaveLength(600);
    const wrongRawProjection = raw.at(-1)!.time + ((605 - (raw.length - 1)) * 60);
    expect(timeScale.timeToCoordinate(wrongRawProjection as Time)).toBeLessThan(0);

    const actual = projectDrawingTimeAtLogical(series, timeScale, 605, 60);
    expect(actual).toBe(latestTime + 360);
    expect(timeScale.timeToCoordinate(actual as Time)).toBeNull();
    expect(series.dataByIndex).toHaveBeenCalledWith(Number.MAX_SAFE_INTEGER, MismatchDirection.NearestLeft);
    expect(timeScale.timeToIndex).toHaveBeenCalledWith(latestTime, false);
    expect(series.data).not.toHaveBeenCalled();
  });

  it('reads a live-appended bar before cached raw history or full-render metadata is refreshed', () => {
    const { raw, rendered, series, timeScale } = createFilteredHistory();
    const previousLastTime = raw.at(-1)!.time;
    expect(projectDrawingTimeAtLogical(series, timeScale, 605, 60)).toBe(previousLastTime + 360);
    rendered.push({ ...rendered.at(-1)!, time: previousLastTime + 180 });

    expect(raw).toHaveLength(1000);
    expect(projectDrawingTimeAtLogical(series, timeScale, 605, 60)).toBe(previousLastTime + 480);
    expect(series.data).not.toHaveBeenCalled();
  });

  it('retains fractional future placement and rejects a missing rendered reference', () => {
    const { rendered, series, timeScale } = createFilteredHistory();
    expect(projectDrawingTimeAtLogical(series, timeScale, 605.5, 60)).toBe(rendered.at(-1)!.time + 390);
    series.dataByIndex.mockReturnValueOnce(null);
    expect(projectDrawingTimeAtLogical(series, timeScale, 605, 60)).toBeNull();
    timeScale.timeToIndex.mockReturnValueOnce(null);
    expect(projectDrawingTimeAtLogical(series, timeScale, 605, 60)).toBeNull();
  });

  it('keeps the Ray preview and completed future endpoint to the right after raw candles are filtered', async () => {
    const { rendered, series, timeScale } = createFilteredHistory();
    const chart = { timeScale: () => timeScale, priceScale: () => ({ width: () => 40 }) };
    const container = document.createElement('div');
    Object.defineProperty(container, 'clientWidth', { value: 500 });
    Object.defineProperty(container, 'clientHeight', { value: 300 });
    document.body.appendChild(container);
    const manager = new DrawingManager();
    manager.setChart(chart as unknown as IChartApi, series as unknown as ISeriesApi<'Candlestick'>,
      'TEST', 1, container, 'M1', 'chart-projection', 'account-test');
    await Promise.resolve();

    manager.startDrawing('trendline', '#2962ff', { subtype: 'ray' });
    manager.addPoint(rendered[590].time, 100, undefined, 'chart-projection', 590);
    const futureTime = projectDrawingTimeAtLogical(series, timeScale, 605, 60)!;
    manager.updatePreviewPoint(futureTime, 80, 'chart-projection', 605);
    const preview = container.querySelector('g[data-id$="-preview"] line')!;
    expect(Number(preview.getAttribute('x1'))).toBe(100);
    expect(Number(preview.getAttribute('x2'))).toBeCloseTo(460, 8);

    manager.addPoint(futureTime, 80, undefined, 'chart-projection', 605);
    const endpoint = container.querySelector('[data-geometry-role="selection-anchor-2"]')!;
    expect(Number(endpoint.getAttribute('cx'))).toBe(250);
    expect(manager.getDrawings('chart-projection')[0].points[1]).toMatchObject({
      time: rendered.at(-1)!.time + 360, logicalIndex: 605,
    });
  });
});
