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
});
