// @vitest-environment jsdom

import type { IChartApi, ISeriesApi } from 'lightweight-charts';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { buildDrawingStorageKey } from './contextKey';

vi.mock('../services/drawingApi', () => ({
  drawingApi: {
    loadDrawings: vi.fn().mockResolvedValue([]),
    saveDrawing: vi.fn().mockResolvedValue('server-drawing'),
    deleteDrawing: vi.fn().mockResolvedValue(undefined),
  },
}));

import { DrawingManager } from '../services/drawingManager';
import { drawingApi } from '../services/drawingApi';

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

describe('drawing session context isolation', () => {
  beforeEach(() => {
    document.body.replaceChildren();
    localStorage.clear();
    sessionStorage.clear();
  });

  it('keeps an in-progress drawing bound to its original chart owner', () => {
    const manager = new DrawingManager();
    const first = createChartHarness();
    const second = createChartHarness();

    manager.setChart(first.chart, first.series, 'XAUUSD', 1, first.container, 'M1', 'chart-a', 'account-primary');
    manager.startDrawing('trendline', '#3b82f6', { subtype: 'trendline' });
    expect(manager.addPoint(150, 100, undefined, 'chart-a')).toBe(false);

    manager.setChart(second.chart, second.series, 'EURUSD', 1, second.container, 'M5', 'chart-b', 'account-primary');
    expect(manager.getActiveDrawing('chart-b')).toBeNull();
    expect(manager.addPoint(180, 105, undefined, 'chart-b')).toBe(false);
    expect(manager.getActiveDrawing('chart-a')?.points).toHaveLength(1);

    manager.setChart(first.chart, first.series, 'XAUUSD', 1, first.container, 'M1', 'chart-a', 'account-primary');
    expect(manager.addPoint(210, 108, undefined, 'chart-a')).toBe(true);
    expect(manager.getDrawings()).toHaveLength(1);

    manager.setChart(second.chart, second.series, 'EURUSD', 1, second.container, 'M5', 'chart-b', 'account-primary');
    expect(manager.getDrawings()).toHaveLength(0);

    const storageKey = buildDrawingStorageKey({
      accountScope: 'account-primary',
      symbol: 'XAUUSD',
      timeframe: 'M1',
    });
    expect(JSON.parse(localStorage.getItem(storageKey) || '[]')).toEqual([
      expect.objectContaining({ subtype: 'trendline', points: expect.any(Array) }),
    ]);
  });

  it('keeps the same symbol isolated by timeframe and account', () => {
    const manager = new DrawingManager();
    const chart = createChartHarness();

    manager.setChart(chart.chart, chart.series, 'XAUUSD', 1, chart.container, 'M1', 'chart-a', 'account-a');
    manager.startDrawing('hline', '#3b82f6', { subtype: 'horizontal_line' });
    expect(manager.addPoint(150, 100, undefined, 'chart-a')).toBe(true);

    manager.setChart(chart.chart, chart.series, 'XAUUSD', 1, chart.container, 'M5', 'chart-a', 'account-a');
    expect(manager.getDrawings()).toHaveLength(0);

    manager.setChart(chart.chart, chart.series, 'XAUUSD', 1, chart.container, 'M1', 'chart-a', 'account-b');
    expect(manager.getDrawings()).toHaveLength(0);

    manager.setChart(chart.chart, chart.series, 'XAUUSD', 1, chart.container, 'M1', 'chart-a', 'account-a');
    expect(manager.getDrawings()).toEqual([
      expect.objectContaining({ subtype: 'horizontal_line' }),
    ]);
  });

  it('routes undo, redo, delete, and clear operations to an explicit chart context', () => {
    const manager = new DrawingManager();
    const first = createChartHarness();
    const second = createChartHarness();

    manager.setChart(first.chart, first.series, 'XAUUSD', 1, first.container, 'M1', 'chart-a', 'account-primary');
    manager.startDrawing('hline');
    expect(manager.addPoint(150, 100, undefined, 'chart-a')).toBe(true);
    const firstId = manager.getDrawings()[0].id;

    manager.setChart(second.chart, second.series, 'EURUSD', 1, second.container, 'M5', 'chart-b', 'account-primary');
    manager.startDrawing('hline');
    expect(manager.addPoint(180, 105, undefined, 'chart-b')).toBe(true);
    const secondId = manager.getDrawings()[0].id;

    manager.undo('chart-a');
    expect(manager.getDrawings()).toHaveLength(0);
    manager.setChart(second.chart, second.series, 'EURUSD', 1, second.container, 'M5', 'chart-b', 'account-primary');
    expect(manager.getDrawings()).toEqual([expect.objectContaining({ id: secondId })]);

    manager.redo('chart-a');
    expect(manager.getDrawings()).toEqual([expect.objectContaining({ id: firstId })]);
    manager.selectDrawing(firstId);
    manager.setChart(second.chart, second.series, 'EURUSD', 1, second.container, 'M5', 'chart-b', 'account-primary');
    manager.deleteSelected('chart-a');
    expect(manager.getDrawings()).toHaveLength(0);
    manager.setChart(second.chart, second.series, 'EURUSD', 1, second.container, 'M5', 'chart-b', 'account-primary');
    expect(manager.getDrawings()).toEqual([expect.objectContaining({ id: secondId })]);

    manager.clearAllDrawings(true, 'chart-b');
    expect(manager.getDrawings()).toHaveLength(0);
  });

  it('removes a disposed chart context and keeps scroll locking owned by the dragged chart', () => {
    const manager = new DrawingManager();
    const first = createChartHarness();
    const second = createChartHarness();
    const firstLock = vi.fn();
    const firstUnlock = vi.fn();
    const secondLock = vi.fn();
    const secondUnlock = vi.fn();

    manager.setChart(first.chart, first.series, 'XAUUSD', 1, first.container, 'M1', 'chart-a', 'account-primary');
    manager.setScrollLockCallbacks('chart-a', firstLock, firstUnlock);
    manager.startDrawing('hline');
    expect(manager.addPoint(150, 100, undefined, 'chart-a')).toBe(true);
    const firstId = manager.getDrawings()[0].id;

    manager.setChart(second.chart, second.series, 'EURUSD', 1, second.container, 'M5', 'chart-b', 'account-primary');
    manager.setScrollLockCallbacks('chart-b', secondLock, secondUnlock);
    const firstHitTarget = first.container.querySelector('svg line[stroke="transparent"]');
    expect(firstHitTarget).not.toBeNull();

    (manager as any).beginDrag({
      stopPropagation: vi.fn(),
      preventDefault: vi.fn(),
      target: firstHitTarget,
      pointerId: 1,
      clientX: 120,
      clientY: 80,
    }, firstId, null);
    expect(firstLock).toHaveBeenCalledTimes(1);
    expect(secondLock).not.toHaveBeenCalled();

    (manager as any).onGlobalPointerUp();
    expect(firstUnlock).toHaveBeenCalledTimes(1);
    expect(secondUnlock).not.toHaveBeenCalled();

    manager.setChart(null, null, 'XAUUSD', 1, first.container, 'M1', 'chart-a', 'account-primary');
    expect(first.container.querySelector('.chart-svg-overlay')).toBeNull();
    expect(manager.persistCurrentContext('chart-a')).toBe(false);
    expect(manager.deleteDrawing(firstId, 'chart-a')).toBe(false);
  });

  it('re-persists a drawing after the backend assigns its server id', async () => {
    vi.mocked(drawingApi.saveDrawing).mockResolvedValueOnce('server-42');
    const manager = new DrawingManager();
    const chart = createChartHarness();
    const identity = {
      contextId: 'chart-a',
      accountScope: 'account-primary',
      symbol: 'XAUUSD',
      timeframe: 'M1',
    };
    const storageKey = buildDrawingStorageKey(identity);

    manager.setChart(
      chart.chart,
      chart.series,
      identity.symbol,
      1,
      chart.container,
      identity.timeframe,
      identity.contextId,
      identity.accountScope,
    );
    manager.startDrawing('hline');
    expect(manager.addPoint(150, 100, undefined, identity.contextId)).toBe(true);

    await vi.waitFor(() => {
      expect(JSON.parse(localStorage.getItem(storageKey) || '[]')).toEqual([
        expect.objectContaining({ serverId: 'server-42' }),
      ]);
    });
  });
});
