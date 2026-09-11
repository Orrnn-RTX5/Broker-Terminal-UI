// @vitest-environment jsdom

import type { IChartApi, ISeriesApi } from 'lightweight-charts';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { loadDrawings } = vi.hoisted(() => ({
  loadDrawings: vi.fn().mockResolvedValue([]),
}));

vi.mock('./drawingApi', () => ({
  drawingApi: {
    loadDrawings,
    saveDrawing: vi.fn(),
    deleteDrawing: vi.fn(),
  },
}));

import { DrawingManager } from './drawingManager';

const chart = {} as IChartApi;
const series = {} as ISeriesApi<'Candlestick'>;
const interactiveChart = {
  timeScale: () => ({
    timeToCoordinate: () => 100,
    logicalToCoordinate: () => 100,
    coordinateToTime: () => 1_700_000_000,
    coordinateToLogical: () => 10,
    height: () => 0,
  }),
  priceScale: () => ({ width: () => 0 }),
} as unknown as IChartApi;
const interactiveSeries = {
  priceToCoordinate: () => 100,
  coordinateToPrice: () => 2000,
  options: () => ({ priceFormat: { precision: 2, minMove: 0.01 } }),
  priceFormatter: () => ({ format: (price: number) => price.toFixed(2) }),
} as unknown as ISeriesApi<'Candlestick'>;

describe('DrawingManager.setChart', () => {
  beforeEach(() => {
    document.body.replaceChildren();
    localStorage.clear();
    sessionStorage.clear();
    loadDrawings.mockClear();
  });

  it('does not rebuild drawings when the active chart context is identical', async () => {
    const manager = new DrawingManager();
    const container = document.createElement('div');
    document.body.appendChild(container);
    const renderAll = vi.spyOn(manager, 'renderAll');

    manager.setChart(chart, series, 'TEST', 1, container, 'M1');
    await vi.waitFor(() => expect(loadDrawings).toHaveBeenCalledTimes(1));
    await Promise.resolve();
    renderAll.mockClear();

    manager.setChart(chart, series, 'TEST', 1, container, 'M1');

    expect(renderAll).not.toHaveBeenCalled();
    expect(loadDrawings).toHaveBeenCalledTimes(1);
    expect(container.querySelectorAll('.chart-svg-overlay')).toHaveLength(1);
  });

  it('heals a detached SVG instead of treating the context as identical', async () => {
    const manager = new DrawingManager();
    const container = document.createElement('div');
    document.body.appendChild(container);

    manager.setChart(chart, series, 'TEST', 1, container, 'M1');
    await vi.waitFor(() => expect(loadDrawings).toHaveBeenCalledTimes(1));
    const detached = container.querySelector('.chart-svg-overlay');
    detached?.remove();

    manager.setChart(chart, series, 'TEST', 1, container, 'M1');

    const healed = container.querySelector('.chart-svg-overlay');
    expect(healed).not.toBe(detached);
    expect(healed?.parentElement).toBe(container);
    expect(container.querySelectorAll('.chart-svg-overlay')).toHaveLength(1);
  });

  it('still renders for a changed chart context and active drawing previews', async () => {
    const manager = new DrawingManager();
    const container = document.createElement('div');
    document.body.appendChild(container);
    const renderAll = vi.spyOn(manager, 'renderAll');

    manager.setChart(chart, series, 'TEST', 1, container, 'M1');
    await vi.waitFor(() => expect(loadDrawings).toHaveBeenCalledTimes(1));
    await Promise.resolve();
    renderAll.mockClear();

    const replacementSeries = {} as ISeriesApi<'Candlestick'>;
    manager.setChart(chart, replacementSeries, 'TEST', 1, container, 'M1');
    expect(renderAll).toHaveBeenCalledTimes(1);

    renderAll.mockClear();
    manager.startDrawing('trendline');
    expect(renderAll).toHaveBeenCalledTimes(1);
    manager.updatePreviewPoint(1_700_000_000, 2000);
    expect(renderAll).toHaveBeenCalledTimes(2);
  });

  it('does not confuse chart, series, symbol, or timeframe changes with equality', async () => {
    const manager = new DrawingManager();
    const container = document.createElement('div');
    document.body.appendChild(container);
    const renderAll = vi.spyOn(manager, 'renderAll');

    manager.setChart(chart, series, 'TEST', 1, container, 'M1');
    await vi.waitFor(() => expect(loadDrawings).toHaveBeenCalledTimes(1));

    const replacementChart = {} as IChartApi;
    renderAll.mockClear();
    manager.setChart(replacementChart, series, 'TEST', 1, container, 'M1');
    expect(renderAll).toHaveBeenCalledTimes(1);

    const replacementSeries = {} as ISeriesApi<'Candlestick'>;
    renderAll.mockClear();
    manager.setChart(replacementChart, replacementSeries, 'TEST', 1, container, 'M1');
    expect(renderAll).toHaveBeenCalledTimes(1);

    renderAll.mockClear();
    manager.setChart(replacementChart, replacementSeries, 'ALT', 1, container, 'M1');
    expect(renderAll).toHaveBeenCalled();

    renderAll.mockClear();
    manager.setChart(replacementChart, replacementSeries, 'ALT', 1, container, 'M5');
    expect(renderAll).toHaveBeenCalled();
  });

  it('scopes viewport rendering and preview ownership to the active context', async () => {
    const manager = new DrawingManager();
    const containerA = document.createElement('div');
    const containerB = document.createElement('div');
    document.body.append(containerA, containerB);

    manager.setChart(chart, series, 'A', 1, containerA, 'M1', 'chart-a', 'account-1');
    await vi.waitFor(() => expect(loadDrawings).toHaveBeenCalledTimes(1));
    manager.setChart(chart, series, 'B', 1, containerB, 'M1', 'chart-b', 'account-1');
    await vi.waitFor(() => expect(loadDrawings).toHaveBeenCalledTimes(2));

    manager.startDrawing('trendline');
    manager.updatePreviewPoint(1_700_000_000, 2000);
    expect(manager.hasRenderableContent(containerA)).toBe(false);
    expect(manager.hasRenderableContent(containerB)).toBe(true);

    manager.setChart(chart, series, 'A', 1, containerA, 'M1', 'chart-a', 'account-1');
    expect(manager.hasRenderableContent(containerA)).toBe(false);
    expect(manager.hasRenderableContent(containerB)).toBe(true);
    expect(manager.getActiveDrawing('chart-a')).toBeNull();
    expect(manager.getActiveDrawing('chart-b')).not.toBeNull();

    const svgA = containerA.querySelector('svg')!;
    const svgB = containerB.querySelector('svg')!;
    const markerA = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    const markerB = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    markerA.setAttribute('data-test-marker', 'a');
    markerB.setAttribute('data-test-marker', 'b');
    svgA.appendChild(markerA);
    svgB.appendChild(markerB);

    manager.renderContext(containerB);
    expect(svgA.querySelector('[data-test-marker="a"]')).toBe(markerA);
    expect(svgB.querySelector('[data-test-marker="b"]')).toBeNull();

    manager.cancelDrawing('chart-b');
    const emptyMarker = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    emptyMarker.setAttribute('data-test-marker', 'empty');
    svgB.appendChild(emptyMarker);
    manager.renderContext(containerB);
    expect(svgB.querySelector('[data-test-marker="empty"]')).toBe(emptyMarker);
  });

  it('targets the active registration when a detached remount shares its context id', async () => {
    const manager = new DrawingManager();
    const staleContainer = document.createElement('div');
    const remountedContainer = document.createElement('div');
    document.body.appendChild(staleContainer);

    manager.setChart(interactiveChart, interactiveSeries, 'STALE', 1, staleContainer, 'M1', 'chart-remount', 'account-1');
    await vi.waitFor(() => expect(loadDrawings).toHaveBeenCalledTimes(1));
    staleContainer.remove();
    document.body.appendChild(remountedContainer);
    manager.setChart(interactiveChart, interactiveSeries, 'CURRENT', 1, remountedContainer, 'M5', 'chart-remount', 'account-1');
    await vi.waitFor(() => expect(loadDrawings).toHaveBeenCalledTimes(2));

    manager.startDrawing('hline');
    expect(manager.addPoint(1_700_000_000, 2000, undefined, 'chart-remount')).toBe(true);
    expect(manager.getDrawings()).toHaveLength(1);
    expect(remountedContainer.querySelectorAll('g[data-id]')).toHaveLength(1);

    const drawingId = manager.getDrawings()[0].id;
    expect(manager.deleteDrawing(drawingId, 'chart-remount')).toBe(true);
    expect(manager.getDrawings()).toHaveLength(0);
    expect(remountedContainer.querySelectorAll('g[data-id]')).toHaveLength(0);

    manager.startDrawing('hline');
    expect(manager.addPoint(1_700_000_060, 2001, undefined, 'chart-remount')).toBe(true);

    expect(manager.deleteSelected('chart-remount')).toBe(1);
    expect(manager.getDrawings()).toHaveLength(0);
    expect(remountedContainer.querySelectorAll('g[data-id]')).toHaveLength(0);
  });

  it('targets the newest connected remount when another chart is active', async () => {
    const manager = new DrawingManager();
    const staleContainer = document.createElement('div');
    const remountedContainer = document.createElement('div');
    const otherContainer = document.createElement('div');
    document.body.appendChild(staleContainer);

    manager.setChart(interactiveChart, interactiveSeries, 'STALE', 1, staleContainer, 'M1', 'chart-remount', 'account-1');
    await vi.waitFor(() => expect(loadDrawings).toHaveBeenCalledTimes(1));
    staleContainer.remove();
    document.body.append(remountedContainer, otherContainer);
    manager.setChart(interactiveChart, interactiveSeries, 'CURRENT', 1, remountedContainer, 'M5', 'chart-remount', 'account-1');
    await vi.waitFor(() => expect(loadDrawings).toHaveBeenCalledTimes(2));

    manager.startDrawing('hline');
    expect(manager.addPoint(1_700_000_000, 2000, undefined, 'chart-remount')).toBe(true);
    expect(manager.getDrawings()).toHaveLength(1);
    expect(remountedContainer.querySelectorAll('g[data-id]')).toHaveLength(1);

    manager.setChart(interactiveChart, interactiveSeries, 'OTHER', 1, otherContainer, 'H1', 'chart-other', 'account-1');
    await vi.waitFor(() => expect(loadDrawings).toHaveBeenCalledTimes(3));
    manager.clearAllDrawings(true, 'chart-remount');

    manager.setChart(interactiveChart, interactiveSeries, 'CURRENT', 1, remountedContainer, 'M5', 'chart-remount', 'account-1');
    expect(manager.getDrawings()).toHaveLength(0);
    expect(remountedContainer.querySelectorAll('g[data-id]')).toHaveLength(0);
  });

  it('selects every drawing in one target chart without changing sibling selection, order, or active context', async () => {
    const manager = new DrawingManager();
    const containerA = document.createElement('div');
    const containerB = document.createElement('div');
    document.body.append(containerA, containerB);
    manager.setChart(interactiveChart, interactiveSeries, 'SAME', 1, containerA, 'M1', 'chart-a', 'account-1');
    await vi.waitFor(() => expect(loadDrawings).toHaveBeenCalledTimes(1));
    for (let index = 0; index < 3; index++) {
      manager.startDrawing('hline');
      manager.addPoint(1_700_000_000 + index * 60, 2000 + index, undefined, 'chart-a');
    }
    manager.unselectAll('chart-a');
    const beforeA = JSON.parse(JSON.stringify(manager.getDrawings('chart-a')));
    manager.setChart(interactiveChart, interactiveSeries, 'SAME', 1, containerB, 'M5', 'chart-b', 'account-1');
    await vi.waitFor(() => expect(loadDrawings).toHaveBeenCalledTimes(2));
    manager.startDrawing('hline');
    manager.addPoint(1_700_000_000, 2010, undefined, 'chart-b');
    const beforeB = JSON.parse(JSON.stringify(manager.getDrawings('chart-b')));
    const render = vi.spyOn(manager, 'renderAll');
    const dispatch = vi.spyOn(window, 'dispatchEvent');
    expect(manager.selectAll('chart-a')).toBe(3);
    expect(manager.getDrawings('chart-a')).toEqual(beforeA.map((drawing: object) => ({ ...drawing, selected: true })));
    expect(manager.getDrawings('chart-b')).toEqual(beforeB);
    expect(manager.getDrawings()).toEqual(beforeB);
    expect(render).toHaveBeenCalledTimes(1);
    const changes = dispatch.mock.calls.map(([event]) => event).filter(event => event.type === 'drawings:changed');
    expect(changes).toHaveLength(1);
    expect(changes[0]).toMatchObject({ detail: { contextId: 'chart-a', symbol: 'SAME', timeframe: 'M1', accountScope: 'account-1', reason: 'selection' } });
    expect(manager.selectAll('missing-chart')).toBe(0);
    expect(manager.getDrawings('chart-b')).toEqual(beforeB);
    dispatch.mockRestore();
    render.mockRestore();
  });
});
