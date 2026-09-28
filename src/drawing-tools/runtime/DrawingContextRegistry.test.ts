import { describe, expect, it } from 'vitest';
import { DrawingContextRegistry, type ChartContext } from './DrawingContextRegistry';

const chartContext = (contextId: string, symbol = 'EURUSD'): ChartContext => ({
  chart: {} as ChartContext['chart'],
  series: {} as ChartContext['series'],
  contextId,
  symbol,
  timeframe: 'M1',
  accountScope: 'broker:1001',
  svgOverlay: null,
});

describe('DrawingContextRegistry', () => {
  it('prefers the explicitly active matching container', () => {
    const registry = new DrawingContextRegistry();
    const first = document.createElement('div');
    const active = document.createElement('div');
    registry.set(first, chartContext('chart:1'));
    registry.set(active, chartContext('chart:1'));

    expect(registry.resolve('chart:1', active)?.[0]).toBe(active);
  });

  it('prefers the newest connected duplicate over a detached registration', () => {
    const registry = new DrawingContextRegistry();
    const detached = document.createElement('div');
    const connected = document.createElement('div');
    document.body.appendChild(connected);
    registry.set(detached, chartContext('chart:1'));
    registry.set(connected, chartContext('chart:1'));

    expect(registry.resolve('chart:1', null)?.[0]).toBe(connected);
    connected.remove();
  });

  it('rejects a matching id with a different drawing identity', () => {
    const registry = new DrawingContextRegistry();
    const container = document.createElement('div');
    registry.set(container, chartContext('chart:1', 'EURUSD'));

    expect(registry.resolve('chart:1', null, {
      contextId: 'chart:1',
      symbol: 'GBPUSD',
      timeframe: 'M1',
      accountScope: 'broker:1001',
    })).toBeNull();
  });
});
