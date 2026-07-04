import { afterEach, describe, expect, it } from 'vitest';
import {
  activateActiveChartSource,
  clearActiveChartSources,
  registerActiveChartSource,
} from './activeChartSource';
import { resolveChartPropertiesTarget } from './chartPropertiesTarget';

describe('resolveChartPropertiesTarget', () => {
  afterEach(() => {
    clearActiveChartSources();
    document.body.replaceChildren();
  });

  it('prefers explicit event detail over the global fallback', () => {
    expect(
      resolveChartPropertiesTarget(
        { symbol: 'ETHUSD', timeframe: 'M15' },
        { symbol: 'BTCUSD', timeframe: 'M1' },
      ),
    ).toEqual({
      symbol: 'ETHUSD',
      timeframe: 'M15',
    });
  });

  it('uses the active chart source before selected symbol and timeframe fallback', () => {
    const container = document.createElement('div');
    document.body.appendChild(container);

    registerActiveChartSource({
      id: 'chart-xauusd-h1',
      getContainer: () => container,
      getSymbol: () => 'XAUUSD',
      getTimeframe: () => 'H1',
    });

    expect(
      resolveChartPropertiesTarget(
        undefined,
        { symbol: 'BTCUSD', timeframe: 'M1' },
      ),
    ).toEqual({
      symbol: 'XAUUSD',
      timeframe: 'H1',
    });
  });

  it('fills a missing timeframe from the active chart source', () => {
    const container = document.createElement('div');
    document.body.appendChild(container);

    registerActiveChartSource({
      id: 'chart-xauusd-h1',
      getContainer: () => container,
      getSymbol: () => 'XAUUSD',
      getTimeframe: () => 'H1',
    });

    expect(
      resolveChartPropertiesTarget(
        { symbol: 'XAUUSD' },
        { symbol: 'BTCUSD', timeframe: 'M1' },
      ),
    ).toEqual({
      symbol: 'XAUUSD',
      timeframe: 'H1',
    });
  });

  it('uses the chart activated by a dock tab switch for detail-less requests', () => {
    const hiddenContainer = document.createElement('div');
    const activeContainer = document.createElement('div');
    document.body.append(hiddenContainer, activeContainer);

    registerActiveChartSource({
      id: 'chart-hidden-eurusd-m5',
      getContainer: () => hiddenContainer,
      getSymbol: () => 'EURUSD',
      getTimeframe: () => 'M5',
    });
    registerActiveChartSource({
      id: 'chart-active-btcusd-m1',
      getContainer: () => activeContainer,
      getSymbol: () => 'BTCUSD',
      getTimeframe: () => 'M1',
    });

    activateActiveChartSource('chart-hidden-eurusd-m5');
    activateActiveChartSource('chart-active-btcusd-m1');

    expect(
      resolveChartPropertiesTarget(
        undefined,
        { symbol: 'XAUUSD', timeframe: 'H1' },
      ),
    ).toEqual({
      symbol: 'BTCUSD',
      timeframe: 'M1',
    });
  });
});
