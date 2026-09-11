import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  activateActiveChartSource,
  bindActiveChartSourceInteractions,
  clearActiveChartSources,
  getActiveChartSource,
  getActiveChartSourceId,
  registerActiveChartSource,
  subscribeActiveChartSource,
} from './activeChartSource';

describe('activeChartSource registry', () => {
  afterEach(() => {
    clearActiveChartSources();
    document.body.replaceChildren();
  });

  it('resolves the active registered chart canvas and container', () => {
    const container = document.createElement('div');
    const canvas = document.createElement('canvas');
    canvas.width = 800;
    canvas.height = 600;
    container.appendChild(canvas);
    document.body.appendChild(container);

    registerActiveChartSource({
      id: 'chart-a',
      getCanvas: () => canvas,
      getContainer: () => container,
      getSymbol: () => 'EURUSD',
      getTimeframe: () => 'M5',
    });

    expect(getActiveChartSource()).toMatchObject({
      id: 'chart-a',
      canvas,
      container,
      symbol: 'EURUSD',
      timeframe: 'M5',
    });
  });

  it('does not let old cleanup remove a newer active source', () => {
    const containerA = document.createElement('div');
    const canvasA = document.createElement('canvas');
    containerA.appendChild(canvasA);
    const containerB = document.createElement('div');
    const canvasB = document.createElement('canvas');
    containerB.appendChild(canvasB);
    document.body.append(containerA, containerB);

    const unregisterA = registerActiveChartSource({
      id: 'chart-a',
      getCanvas: () => canvasA,
      getContainer: () => containerA,
    });
    registerActiveChartSource({
      id: 'chart-b',
      getCanvas: () => canvasB,
      getContainer: () => containerB,
    });
    activateActiveChartSource('chart-b');

    unregisterA();

    expect(getActiveChartSource()).toMatchObject({
      id: 'chart-b',
      canvas: canvasB,
      container: containerB,
    });
  });

  it('keeps the last clicked pane active while the pointer crosses siblings toward Market Watch', () => {
    const chartA = document.createElement('div');
    const chartB = document.createElement('div');
    const symbolRow = document.createElement('button');
    document.body.append(chartA, chartB, symbolRow);
    const unregisterA = registerActiveChartSource({ id: 'a', getContainer: () => chartA });
    const unregisterB = registerActiveChartSource({ id: 'b', getContainer: () => chartB });
    const unbindA = bindActiveChartSourceInteractions('a', chartA);
    const unbindB = bindActiveChartSourceInteractions('b', chartB);
    chartB.dispatchEvent(new Event('pointerdown'));
    chartA.dispatchEvent(new Event('pointerenter'));
    symbolRow.focus();
    expect(getActiveChartSource()?.id).toBe('b');
    chartA.dispatchEvent(new Event('pointerdown'));
    expect(getActiveChartSource()?.id).toBe('a');
    chartB.dispatchEvent(new Event('focusin'));
    expect(getActiveChartSource()?.id).toBe('b');
    unbindA(); unbindB();
    chartA.dispatchEvent(new Event('pointerdown'));
    expect(getActiveChartSource()?.id).toBe('b');
    unregisterA(); unregisterB();
  });

  it('notifies sidebar consumers when the active chart changes, but not on repeated reads', () => {
    const containerA = document.createElement('div');
    const containerB = document.createElement('div');
    document.body.append(containerA, containerB);
    registerActiveChartSource({ id: 'a', getContainer: () => containerA });
    const unregisterB = registerActiveChartSource({ id: 'b', getContainer: () => containerB });
    const listener = vi.fn();
    const unsubscribe = subscribeActiveChartSource(listener);
    activateActiveChartSource('b');
    expect(getActiveChartSourceId()).toBe('b');
    expect(listener).toHaveBeenCalledTimes(1);
    getActiveChartSource();
    getActiveChartSource();
    expect(listener).toHaveBeenCalledTimes(1);
    unregisterB();
    expect(getActiveChartSourceId()).toBe('a');
    unsubscribe();
    listener.mockClear();
    clearActiveChartSources();
    expect(listener).not.toHaveBeenCalled();
  });

  it('does not let stale same-id cleanup remove a replacement registration', () => {
    const oldContainer = document.createElement('div');
    const oldCanvas = document.createElement('canvas');
    oldContainer.appendChild(oldCanvas);
    const replacementContainer = document.createElement('div');
    const replacementCanvas = document.createElement('canvas');
    replacementContainer.appendChild(replacementCanvas);
    document.body.append(oldContainer, replacementContainer);

    const unregisterOld = registerActiveChartSource({
      id: 'chart-remount',
      getCanvas: () => oldCanvas,
      getContainer: () => oldContainer,
      getSymbol: () => 'XAUUSD',
    });
    const unregisterReplacement = registerActiveChartSource({
      id: 'chart-remount',
      getCanvas: () => replacementCanvas,
      getContainer: () => replacementContainer,
      getSymbol: () => 'BTCUSD',
    });

    expect(activateActiveChartSource('chart-remount')).toMatchObject({
      canvas: replacementCanvas,
      container: replacementContainer,
      symbol: 'BTCUSD',
    });

    unregisterOld();

    expect(getActiveChartSource()).toMatchObject({
      id: 'chart-remount',
      canvas: replacementCanvas,
      container: replacementContainer,
      symbol: 'BTCUSD',
    });

    unregisterReplacement();
    expect(getActiveChartSource()).toBeNull();
  });

  it('ignores a mounted but hidden chart tab without unregistering it', () => {
    const hiddenLayer = document.createElement('div');
    hiddenLayer.dataset.dockTabContent = 'panel-hidden';
    hiddenLayer.style.opacity = '0';
    hiddenLayer.style.pointerEvents = 'none';
    const hiddenContainer = document.createElement('div');
    hiddenLayer.appendChild(hiddenContainer);

    const visibleLayer = document.createElement('div');
    visibleLayer.dataset.dockTabContent = 'panel-visible';
    visibleLayer.style.opacity = '1';
    visibleLayer.style.pointerEvents = 'auto';
    const visibleContainer = document.createElement('div');
    visibleLayer.appendChild(visibleContainer);
    document.body.append(hiddenLayer, visibleLayer);

    registerActiveChartSource({
      id: 'chart-hidden',
      getContainer: () => hiddenContainer,
      getSymbol: () => 'AAVUSD',
    });
    registerActiveChartSource({
      id: 'chart-visible',
      getContainer: () => visibleContainer,
      getSymbol: () => 'XAUUSD',
    });

    expect(activateActiveChartSource('chart-hidden')).toBeNull();
    expect(getActiveChartSource()).toMatchObject({
      id: 'chart-visible',
      symbol: 'XAUUSD',
    });

    hiddenLayer.style.opacity = '1';
    hiddenLayer.style.pointerEvents = 'auto';
    visibleLayer.style.opacity = '0';
    visibleLayer.style.pointerEvents = 'none';

    expect(activateActiveChartSource('chart-hidden')).toMatchObject({
      id: 'chart-hidden',
      symbol: 'AAVUSD',
    });
  });

  it.each(['floating', 'docked'])('falls back from a minimized %s chart and can reactivate it after restore', (kind) => {
    const floatingWindow = document.createElement('div');
    if (kind === 'floating') floatingWindow.dataset.dockFloatingPanel = 'true';
    floatingWindow.dataset.dockMinimized = 'false';
    const floatingChart = document.createElement('div');
    floatingWindow.appendChild(floatingChart);
    const dockedChart = document.createElement('div');
    document.body.append(floatingWindow, dockedChart);
    registerActiveChartSource({
      id: 'floating-chart', getContainer: () => floatingChart,
      getSymbol: () => 'BTCUSD', getTimeframe: () => 'MN',
    });
    registerActiveChartSource({
      id: 'docked-chart', getContainer: () => dockedChart,
      getSymbol: () => 'XAUUSD.a', getTimeframe: () => 'M1',
    });
    activateActiveChartSource('floating-chart');
    floatingWindow.dataset.dockMinimized = 'true';
    expect(floatingChart.isConnected).toBe(true);
    expect(getActiveChartSource()).toMatchObject({ id: 'docked-chart', symbol: 'XAUUSD.a', timeframe: 'M1' });
    expect(activateActiveChartSource('floating-chart')).toBeNull();
    expect(getActiveChartSourceId()).toBe('docked-chart');

    floatingWindow.dataset.dockMinimized = 'false';
    expect(activateActiveChartSource('floating-chart')).toMatchObject({ id: 'floating-chart', symbol: 'BTCUSD', timeframe: 'MN' });
    expect(getActiveChartSourceId()).toBe('floating-chart');
  });

  it('does not fall back to a minimized legacy canvas when all registered windows are minimized', () => {
    const floatingWindow = document.createElement('div');
    floatingWindow.dataset.dockFloatingPanel = 'true';
    floatingWindow.dataset.dockMinimized = 'false';
    const canvas = document.createElement('canvas');
    floatingWindow.appendChild(canvas);
    document.body.appendChild(floatingWindow);
    registerActiveChartSource({ id: 'only-chart', getCanvas: () => canvas });
    expect(getActiveChartSource()?.id).toBe('only-chart');
    floatingWindow.dataset.dockMinimized = 'true';
    expect(getActiveChartSource()).toBeNull();
    expect(getActiveChartSourceId()).toBeNull();
    floatingWindow.dataset.dockMinimized = 'false';
    expect(getActiveChartSource()?.id).toBe('only-chart');
  });
});
