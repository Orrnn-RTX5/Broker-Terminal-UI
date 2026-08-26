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
    manager.updatePreviewPoint(1_700_000_000, 2000);
    expect(renderAll).toHaveBeenCalledTimes(1);
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

    manager.setChart(chart, series, 'A', 1, containerA, 'M1');
    await vi.waitFor(() => expect(loadDrawings).toHaveBeenCalledTimes(1));
    manager.setChart(chart, series, 'B', 1, containerB, 'M1');
    await vi.waitFor(() => expect(loadDrawings).toHaveBeenCalledTimes(2));

    manager.startDrawing('trendline');
    manager.updatePreviewPoint(1_700_000_000, 2000);
    expect(manager.hasRenderableContent(containerA)).toBe(false);
    expect(manager.hasRenderableContent(containerB)).toBe(true);

    manager.setChart(chart, series, 'A', 1, containerA, 'M1');
    expect(manager.hasRenderableContent(containerA)).toBe(true);
    expect(manager.hasRenderableContent(containerB)).toBe(false);

    const svgA = containerA.querySelector('svg')!;
    const svgB = containerB.querySelector('svg')!;
    const markerA = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    const markerB = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    markerA.setAttribute('data-test-marker', 'a');
    markerB.setAttribute('data-test-marker', 'b');
    svgA.appendChild(markerA);
    svgB.appendChild(markerB);

    manager.renderContext(containerA);
    expect(svgA.querySelector('[data-test-marker="a"]')).toBeNull();
    expect(svgB.querySelector('[data-test-marker="b"]')).toBe(markerB);

    manager.cancelDrawing();
    const emptyMarker = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    emptyMarker.setAttribute('data-test-marker', 'empty');
    svgB.appendChild(emptyMarker);
    manager.renderContext(containerB);
    expect(svgB.querySelector('[data-test-marker="empty"]')).toBe(emptyMarker);
  });
});
