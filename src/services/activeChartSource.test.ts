import { afterEach, describe, expect, it } from 'vitest';
import {
  activateActiveChartSource,
  clearActiveChartSources,
  getActiveChartSource,
  registerActiveChartSource,
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
});
