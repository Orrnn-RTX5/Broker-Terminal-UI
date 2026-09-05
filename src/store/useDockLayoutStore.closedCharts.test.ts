import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DockLayout } from '../services/dockManager';
import { useDockLayoutStore } from './useDockLayoutStore';

const originalLayout = useDockLayoutStore.getState().layout;

const chartTabsLayout = (): DockLayout => ({
  root: {
    id: 'root',
    type: 'split',
    direction: 'horizontal',
    ratio: 1,
    children: [{
      id: 'center-main',
      type: 'split',
      direction: 'vertical',
      ratio: 1,
      children: [{
        id: 'chart-tabs',
        type: 'tabs',
        ratio: 0.75,
        activeTab: 'chart-xauusd',
        children: [
          {
            id: 'chart-eurusd',
            title: 'EURUSD,M5',
            component: 'Chart',
            props: { symbol: 'EURUSD', timeframe: 'M5' },
          },
          {
            id: 'chart-xauusd',
            title: 'XAUUSD,M15',
            component: 'Chart',
            props: { symbol: 'XAUUSD', timeframe: 'M15' },
          },
        ],
      }, {
        id: 'toolbox',
        title: 'Toolbox',
        component: 'Terminal',
        ratio: 0.25,
      }],
    }],
  },
  floatingPanels: [],
  version: '2.6',
});

const collectCharts = (layout: DockLayout) => {
  const charts: Array<{ id: string; symbol?: unknown }> = [];
  const visit = (container: DockLayout['root']) => {
    container.children.forEach((child) => {
      if ('children' in child) visit(child);
      else if (child.component === 'Chart') charts.push({ id: child.id, symbol: child.props?.symbol });
    });
  };
  visit(layout.root);
  layout.floatingPanels.forEach(visit);
  return charts;
};

describe('useDockLayoutStore recently closed charts', () => {
  beforeEach(() => {
    useDockLayoutStore.getState().setLayout(chartTabsLayout());
    useDockLayoutStore.setState({ recentlyClosedCharts: [] });
  });

  afterEach(() => {
    useDockLayoutStore.getState().setLayout(originalLayout);
    useDockLayoutStore.setState({ recentlyClosedCharts: [] });
    vi.restoreAllMocks();
  });

  it('closes the selected chart and records a restorable snapshot', () => {
    expect(useDockLayoutStore.getState().closeActiveChart('XAUUSD')).toBe(true);

    expect(collectCharts(useDockLayoutStore.getState().layout)).toEqual([
      { id: 'chart-eurusd', symbol: 'EURUSD' },
    ]);
    expect(useDockLayoutStore.getState().recentlyClosedCharts).toEqual([
      expect.objectContaining({
        id: 'chart-xauusd',
        title: 'XAUUSD,M15',
        props: { symbol: 'XAUUSD', timeframe: 'M15' },
      }),
    ]);
  });

  it('closes the visible active tab even when the global symbol is stale', () => {
    expect(useDockLayoutStore.getState().closeActiveChart('EURUSD')).toBe(true);

    expect(collectCharts(useDockLayoutStore.getState().layout)).toEqual([
      { id: 'chart-eurusd', symbol: 'EURUSD' },
    ]);
    expect(useDockLayoutStore.getState().recentlyClosedCharts[0]).toEqual(
      expect.objectContaining({ id: 'chart-xauusd' }),
    );
  });

  it('restores the most recently closed chart as the active chart tab', () => {
    const restoredEvent = vi.fn();
    window.addEventListener('chartSymbolChanged', restoredEvent);

    useDockLayoutStore.getState().closeActiveChart('XAUUSD');
    expect(useDockLayoutStore.getState().restoreClosedChart()).toBe(true);

    expect(collectCharts(useDockLayoutStore.getState().layout).map((chart) => chart.symbol)).toEqual([
      'EURUSD',
      'XAUUSD',
    ]);
    expect(useDockLayoutStore.getState().recentlyClosedCharts).toEqual([]);
    expect(restoredEvent).toHaveBeenCalledTimes(1);
    expect((restoredEvent.mock.calls[0][0] as CustomEvent).detail).toEqual({
      symbol: 'XAUUSD',
      timeframe: 'M15',
    });

    window.removeEventListener('chartSymbolChanged', restoredEvent);
  });

  it('is a no-op when no chart can be closed or restored', () => {
    useDockLayoutStore.getState().setLayout({
      ...chartTabsLayout(),
      root: { id: 'root', type: 'root', ratio: 1, children: [] },
    });

    expect(useDockLayoutStore.getState().closeActiveChart()).toBe(false);
    expect(useDockLayoutStore.getState().restoreClosedChart()).toBe(false);
  });
});
