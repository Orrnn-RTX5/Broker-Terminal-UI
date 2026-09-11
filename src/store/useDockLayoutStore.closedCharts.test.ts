import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { dockManager, type DockContainer, type DockLayout, type DockPanelConfig } from '../services/dockManager';
import { useDockLayoutStore } from './useDockLayoutStore';
import { commitBrokerAccountSessionScope, getCommittedBrokerAccountSessionScope } from '../services/brokerSession';

const originalLayout = useDockLayoutStore.getState().layout;
const originalSessionScope = getCommittedBrokerAccountSessionScope();

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
    commitBrokerAccountSessionScope(originalSessionScope);
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

  it('closes the exact same-symbol chart without closing its sibling timeframe', () => {
    const layout = chartTabsLayout();
    const center = layout.root.children[0] as DockContainer;
    center.children[0] = {
      id: 'same-symbol-windows', type: 'split', direction: 'horizontal', ratio: 0.75,
      children: [
        { id: 'xau-m1', title: 'XAUUSD,M1', component: 'Chart', props: { symbol: 'XAUUSD', timeframe: 'M1' }, ratio: 0.5 },
        { id: 'xau-h4', title: 'XAUUSD,H4', component: 'Chart', props: { symbol: 'XAUUSD', timeframe: 'H4' }, ratio: 0.5 },
      ],
    };
    useDockLayoutStore.getState().setLayout(layout);
    expect(useDockLayoutStore.getState().closeActiveChart('XAUUSD', 'xau-h4')).toBe(true);
    expect(collectCharts(useDockLayoutStore.getState().layout)).toEqual([{ id: 'xau-m1', symbol: 'XAUUSD' }]);
    expect(useDockLayoutStore.getState().recentlyClosedCharts[0]).toMatchObject({ id: 'xau-h4', props: { timeframe: 'H4' } });
  });

  it('rejects a stale, non-chart or nonclosable exact target without falling back to another chart', () => {
    const layout = chartTabsLayout();
    const tabs = (layout.root.children[0] as DockContainer).children[0] as DockContainer;
    (tabs.children[1] as DockPanelConfig).closable = false;
    useDockLayoutStore.getState().setLayout(layout);
    for (const panelId of ['missing-chart', '', 'toolbox', 'chart-xauusd']) {
      expect(useDockLayoutStore.getState().closeActiveChart('EURUSD', panelId)).toBe(false);
      expect(useDockLayoutStore.getState().layout).toEqual(layout);
    }
    expect(useDockLayoutStore.getState().recentlyClosedCharts).toEqual([]);
  });

  it('clears prior-account closed windows on both successful and missing account layout loads', () => {
    const load = vi.spyOn(dockManager, 'loadFromStorage').mockReturnValue(true);
    useDockLayoutStore.getState().loadLayout('closed-history-account-a');
    expect(useDockLayoutStore.getState().closeActiveChart('XAUUSD')).toBe(true);
    expect(useDockLayoutStore.getState().recentlyClosedCharts).toHaveLength(1);
    expect(useDockLayoutStore.getState().loadLayout('closed-history-account-b')).toBe(true);
    expect(useDockLayoutStore.getState().recentlyClosedCharts).toEqual([]);
    expect(useDockLayoutStore.getState().closeActiveChart('EURUSD')).toBe(true);
    load.mockReturnValue(false);
    expect(useDockLayoutStore.getState().loadLayout('closed-history-account-c')).toBe(false);
    expect(useDockLayoutStore.getState().recentlyClosedCharts).toEqual([]);
    expect(load).toHaveBeenLastCalledWith('dock-layout-closed-history-account-c');
  });

  it('retains same-account closed windows when retrying that account layout load', () => {
    vi.spyOn(dockManager, 'loadFromStorage').mockReturnValue(false);
    useDockLayoutStore.getState().loadLayout('closed-history-same-account');
    useDockLayoutStore.getState().closeActiveChart('XAUUSD');
    const closed = useDockLayoutStore.getState().recentlyClosedCharts;
    expect(closed).toHaveLength(1);
    expect(useDockLayoutStore.getState().loadLayout('closed-history-same-account')).toBe(false);
    expect(useDockLayoutStore.getState().recentlyClosedCharts).toEqual(closed);
  });

  it('clears closed windows for the same login number on a different broker without changing persisted keys', () => {
    const load = vi.spyOn(dockManager, 'loadFromStorage').mockReturnValue(false);
    commitBrokerAccountSessionScope({ authenticated: true, accountId: '200001', brokerId: 'test', serverUrl: 'https://test.example' });
    useDockLayoutStore.getState().loadLayout('200001');
    useDockLayoutStore.getState().closeActiveChart('XAUUSD');
    expect(useDockLayoutStore.getState().recentlyClosedCharts).toHaveLength(1);
    commitBrokerAccountSessionScope({ authenticated: true, accountId: '200001', brokerId: 'achiever', serverUrl: 'https://achiever.example' });
    expect(useDockLayoutStore.getState().loadLayout('200001')).toBe(false);
    expect(useDockLayoutStore.getState().recentlyClosedCharts).toEqual([]);
    expect(load.mock.calls).toEqual([['dock-layout-200001'], ['dock-layout-200001']]);
  });

  it('arranges existing charts through the store without treating them as closed charts', () => {
    useDockLayoutStore.getState().arrangeCharts('cascade');
    expect(useDockLayoutStore.getState().layout.floatingPanels).toHaveLength(2);
    expect(collectCharts(useDockLayoutStore.getState().layout).map(chart => chart.id)).toEqual(['chart-eurusd', 'chart-xauusd']);
    expect(useDockLayoutStore.getState().recentlyClosedCharts).toEqual([]);
    useDockLayoutStore.getState().arrangeCharts('vertical');
    expect(useDockLayoutStore.getState().layout.floatingPanels).toEqual([]);
    expect(collectCharts(useDockLayoutStore.getState().layout).map(chart => chart.id)).toEqual(['chart-eurusd', 'chart-xauusd']);
    expect(useDockLayoutStore.getState().recentlyClosedCharts).toEqual([]);
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
