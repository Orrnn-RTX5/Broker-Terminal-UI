// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DockManager, MAX_CHART_PANELS, type DockContainer, type DockPanelConfig } from '../services/dockManager';
import { useDockLayoutStore } from './useDockLayoutStore';

const originalLayout = useDockLayoutStore.getState().layout;
const originalClosed = useDockLayoutStore.getState().recentlyClosedCharts;
const collect = (container: DockContainer): DockPanelConfig[] => container.children.flatMap(child => 'children' in child ? collect(child) : [child]);
beforeEach(() => {
  const layout = new DockManager().getLayout();
  const center = layout.root.children[1] as DockContainer;
  center.children[0] = { id: 'test-seed', title: 'TEST,M15', component: 'Chart', props: { symbol: 'TEST', timeframe: 'M15', chartType: 'area' }, ratio: 0.75 };
  useDockLayoutStore.getState().setLayout(layout);
  useDockLayoutStore.setState({ recentlyClosedCharts: [] });
});
afterEach(() => {
  useDockLayoutStore.getState().setLayout(originalLayout);
  useDockLayoutStore.setState({ recentlyClosedCharts: originalClosed });
  vi.restoreAllMocks();
  localStorage.clear();
});
const fillCharts = () => {
  while (useDockLayoutStore.getState().canAddChart()) {
    expect(useDockLayoutStore.getState().addChartPanel({ symbol: 'XAUUSD', timeframe: 'M1', chartType: 'bar' }).status).toBe('added');
  }
};
const legacyLayout = () => {
  const layout = new DockManager().getLayout();
  const center = layout.root.children[1] as DockContainer;
  center.children[0] = { id: 'legacy-tabs', type: 'tabs', activeTab: 'legacy-7', ratio: 0.75,
    children: Array.from({ length: 8 }, (_, index) => ({
      id: `legacy-${index}`, title: `BROKER${index},H4`, component: 'Chart',
      props: { symbol: `BROKER${index}`, timeframe: 'H4', chartType: 'area', template: { name: 'saved' } },
    })),
  };
  return layout;
};

describe('chart slot actions', () => {
  it('synchronizes imported layouts to six and preserves the two overflow charts for restoration', () => {
    useDockLayoutStore.getState().setLayout(legacyLayout());
    const state = useDockLayoutStore.getState();
    expect(state.getChartCount()).toBe(MAX_CHART_PANELS);
    expect(collect(state.layout.root).filter(panel => panel.component === 'Chart')).toHaveLength(MAX_CHART_PANELS);
    expect(state.recentlyClosedCharts.map(panel => panel.id)).toEqual(['legacy-5', 'legacy-6']);
    expect(state.restoreClosedChart('legacy-6')).toBe(false);
    state.removePanel('legacy-0');
    expect(state.restoreClosedChart('legacy-6')).toBe(true);
    const restored = collect(useDockLayoutStore.getState().layout.root).find(panel => panel.props?.symbol === 'BROKER6');
    expect(restored?.props).toEqual({ symbol: 'BROKER6', timeframe: 'H4', chartType: 'area', template: { name: 'saved' } });
    expect(state.getChartCount()).toBe(MAX_CHART_PANELS);
  });

  it('makes overflow from an account layout migration available in Open Deleted', () => {
    const legacy = legacyLayout();
    localStorage.setItem('dock-layout-six-chart-account', JSON.stringify(legacy));
    expect(useDockLayoutStore.getState().loadLayout('six-chart-account')).toBe(true);
    expect(useDockLayoutStore.getState().getChartCount()).toBe(MAX_CHART_PANELS);
    expect(useDockLayoutStore.getState().recentlyClosedCharts.map(panel => panel.id)).toEqual(['legacy-5', 'legacy-6']);
    expect(JSON.parse(localStorage.getItem('dock-layout-six-chart-backup-v1:dock-layout-six-chart-account')!)).toEqual(legacy);
  });

  it('restores a saved chart into an entirely empty root before removing its closed record', () => {
    const closed: DockPanelConfig = {
      id: 'closed-last', title: 'EURUSD.r,H4', component: 'Chart', minimized: true,
      props: { symbol: 'EURUSD.r', timeframe: 'H4', chartType: 'area', template: { name: 'retained' } },
    };
    useDockLayoutStore.getState().setLayout({
      version: '2.6', root: { id: 'root', type: 'root', ratio: 1, children: [] }, floatingPanels: [],
    });
    useDockLayoutStore.setState({ recentlyClosedCharts: [closed] });
    expect(useDockLayoutStore.getState().restoreClosedChart('closed-last')).toBe(true);
    const charts = collect(useDockLayoutStore.getState().layout.root).filter(panel => panel.component === 'Chart');
    expect(charts).toHaveLength(1);
    expect(charts[0].props).toEqual(closed.props);
    expect(charts[0].minimized).not.toBe(true);
    expect(useDockLayoutStore.getState().recentlyClosedCharts).toEqual([]);
  });

  it('reports count/cap state and leaves a seventh request unchanged', () => {
    fillCharts();
    expect(useDockLayoutStore.getState().getChartCount()).toBe(MAX_CHART_PANELS);
    expect(useDockLayoutStore.getState().canAddChart()).toBe(false);
    const previous = useDockLayoutStore.getState().layout;
    expect(useDockLayoutStore.getState().addChartPanel({ symbol: 'BTCUSD', timeframe: 'MN' })).toEqual({ status: 'limit-reached', count: MAX_CHART_PANELS, limit: MAX_CHART_PANELS });
    expect(useDockLayoutStore.getState().layout).toBe(previous);
    expect(useDockLayoutStore.getState().addPanel({ id: 'seventh', title: 'BTCUSD,MN', component: 'Chart' })).toBe(false);
  });

  it('keeps a blocked closed-chart record and restores it only after a slot becomes available', () => {
    fillCharts();
    const closed: DockPanelConfig = {
      id: 'closed-btc', title: 'BTCUSD,MN', component: 'Chart', minimized: true,
      props: { symbol: 'BTCUSD', timeframe: 'MN', chartType: 'line', template: { name: 'saved' } },
    };
    useDockLayoutStore.setState({ recentlyClosedCharts: [closed] });
    const dispatch = vi.spyOn(window, 'dispatchEvent');
    expect(useDockLayoutStore.getState().restoreClosedChart('closed-btc')).toBe(false);
    expect(useDockLayoutStore.getState().recentlyClosedCharts).toEqual([closed]);
    expect(dispatch.mock.calls.some(([event]) => event.type === 'chartSymbolChanged')).toBe(false);
    useDockLayoutStore.getState().removePanel('test-seed');
    expect(useDockLayoutStore.getState().restoreClosedChart('closed-btc')).toBe(true);
    expect(useDockLayoutStore.getState().getChartCount()).toBe(MAX_CHART_PANELS);
    const restored = collect(useDockLayoutStore.getState().layout.root).find(panel => panel.props?.symbol === 'BTCUSD');
    expect(restored?.props).toEqual(closed.props);
    expect(restored?.minimized).not.toBe(true);
    expect(useDockLayoutStore.getState().recentlyClosedCharts.some(panel => panel.id === 'closed-btc')).toBe(false);
    const center = useDockLayoutStore.getState().layout.root.children[1] as DockContainer;
    expect(center.children.at(-1)).toMatchObject({ id: 'toolbox', component: 'Terminal' });
  });
});
