import { afterEach, describe, expect, it } from 'vitest';
import {
  activateActiveChartSource,
  clearActiveChartSources,
  registerActiveChartSource,
} from './activeChartSource';
import {
  getActiveChartCommandTarget,
  getPanelIdFromChartContextId,
} from './chartCommandTarget';

describe('chartCommandTarget', () => {
  afterEach(() => {
    clearActiveChartSources();
    document.body.innerHTML = '';
  });

  it('resolves the currently active connected chart with fallback values', () => {
    const container = document.createElement('div');
    document.body.appendChild(container);

    registerActiveChartSource({
      id: 'trading-chart:panel-a',
      getContainer: () => container,
      getSymbol: () => 'EURUSD',
      getTimeframe: () => 'M5',
    });
    activateActiveChartSource('trading-chart:panel-a');

    expect(getActiveChartCommandTarget('GBPUSD', 'H1')).toEqual({
      targetContextId: 'trading-chart:panel-a',
      symbol: 'EURUSD',
      timeframe: 'M5',
    });
  });

  it('uses fallbacks when no connected chart is registered', () => {
    expect(getActiveChartCommandTarget(' XAUUSD ', ' M1 ')).toEqual({
      targetContextId: undefined,
      symbol: 'XAUUSD',
      timeframe: 'M1',
    });
  });

  it('extracts only valid trading chart panel ids', () => {
    expect(getPanelIdFromChartContextId('trading-chart:chart-42')).toBe('chart-42');
    expect(getPanelIdFromChartContextId('chart-42')).toBeUndefined();
    expect(getPanelIdFromChartContextId('trading-chart:')).toBeUndefined();
  });
});
