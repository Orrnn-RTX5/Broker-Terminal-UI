// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest';
import { DockManager, MAX_CHART_PANELS, enforceChartPanelLimit, getChartPanelCount, type DockContainer, type DockLayout, type DockPanelConfig } from './dockManager';

const allPanels = (layout: DockLayout): DockPanelConfig[] => {
  const collect = (container: DockContainer): DockPanelConfig[] => container.children.flatMap(child => 'children' in child ? collect(child) : [child]);
  return [layout.root, ...layout.floatingPanels].flatMap(collect);
};
const chartPanels = (layout: DockLayout) => allPanels(layout).filter(panel => panel.component === 'Chart');
const makeLayout = (count: number): DockLayout => {
  const layout = new DockManager().getLayout();
  const center = layout.root.children[1] as DockContainer;
  center.children[0] = {
    id: 'chart-tabs', type: 'tabs', ratio: 0.75, activeTab: 'seed-0',
    children: Array.from({ length: count }, (_, index) => ({
      id: `seed-${index}`, title: `SYM${index},M15`, component: 'Chart',
      props: { symbol: `SYM${index}`, timeframe: 'M15', chartType: 'area', retained: { value: index } },
    })),
  };
  return layout;
};
afterEach(() => { localStorage.clear(); vi.restoreAllMocks(); });

describe('bounded chart creation', () => {
  it('adds exactly one independent chart and one notification per request up to six', () => {
    const manager = new DockManager(makeLayout(1));
    const original = chartPanels(manager.getLayout())[0];
    manager.setPanelMinimized(original.id, true);
    const listener = vi.fn();
    manager.subscribe(listener);
    for (let count = 2; count <= MAX_CHART_PANELS; count++) {
      const beforeIds = chartPanels(manager.getLayout()).map(panel => panel.id);
      const result = manager.addChartPanel({ symbol: `BROKER${count}.XAUUSD`, timeframe: count % 2 ? 'M1' : 'MN', chartType: 'line' });
      expect(result.status).toBe('added');
      expect(result.count).toBe(count);
      if (result.status !== 'added') throw new Error('Expected one chart to be added');
      expect(beforeIds).not.toContain(result.panelId);
      const panels = chartPanels(manager.getLayout());
      expect(panels.filter(panel => !beforeIds.includes(panel.id))).toHaveLength(1);
      expect(panels.find(panel => panel.id === result.panelId)?.props).toEqual({ symbol: `BROKER${count}.XAUUSD`, timeframe: count % 2 ? 'M1' : 'MN', chartType: 'line' });
      expect(panels.find(panel => panel.id === original.id)).toMatchObject({ ...original, minimized: true });
      expect(listener).toHaveBeenCalledTimes(count - 1);
    }
    expect(manager.getChartCount()).toBe(MAX_CHART_PANELS);
    expect(manager.canAddChart()).toBe(false);
    const fullLayout = manager.getLayout();
    expect(manager.addChartPanel({ symbol: 'SEVENTH', timeframe: 'H4' })).toEqual({ status: 'limit-reached', count: MAX_CHART_PANELS, limit: MAX_CHART_PANELS });
    expect(manager.getLayout()).toEqual(fullLayout);
    expect(listener).toHaveBeenCalledTimes(MAX_CHART_PANELS - 1);
  });

  it('counts docked, floating and minimized charts and caps the generic creation path', () => {
    const manager = new DockManager(makeLayout(MAX_CHART_PANELS));
    manager.floatPanel('seed-0');
    manager.setPanelMinimized('seed-0', true);
    expect(getChartPanelCount(manager.getLayout())).toBe(MAX_CHART_PANELS);
    const before = manager.getLayout();
    expect(manager.addPanel({ id: 'extra-chart', title: 'XAUUSD,H4', component: 'Chart' }, 'center-main', 'tab')).toBe(false);
    expect(manager.getLayout()).toEqual(before);
    expect(manager.addPanel({ id: 'news', title: 'News', component: 'News' }, 'root', 'right')).toBe(true);
    expect(getChartPanelCount(manager.getLayout())).toBe(MAX_CHART_PANELS);
    expect(allPanels(manager.getLayout()).find(panel => panel.id === 'news')).toBeDefined();
  });

  it('reuses a newly available slot after closing one chart without bringing it back through undo', () => {
    const manager = new DockManager(makeLayout(MAX_CHART_PANELS));
    manager.arrangeCharts('vertical');
    manager.removePanel('seed-3');
    expect(manager.canAddChart()).toBe(true);
    expect(manager.addChartPanel({ symbol: 'NEW', timeframe: 'H1', chartType: 'bar' }).status).toBe('added');
    expect(manager.getChartCount()).toBe(MAX_CHART_PANELS);
    expect(chartPanels(manager.getLayout()).some(panel => panel.id === 'seed-3')).toBe(false);
    expect(manager.canUndo()).toBe(false);
  });

  it('does not insert an empty chart region when closing one chart inside a nested six-chart grid', () => {
    const manager = new DockManager(makeLayout(MAX_CHART_PANELS));
    const layout = manager.getLayout();
    const center = layout.root.children[1] as DockContainer;
    center.children[0].ratio = 0.65;
    center.children[1].ratio = 0.35;
    manager.setLayout(layout);
    manager.tileWindows();
    const before = chartPanels(manager.getLayout());
    expect(manager.removePanel('seed-1')).toBe(true);
    const after = manager.getLayout();
    expect(chartPanels(after).map(panel => panel.id)).toEqual(before.filter(panel => panel.id !== 'seed-1').map(panel => panel.id));
    expect(allPanels(after).some(panel => panel.component === 'EmptyChartArea')).toBe(false);
    expect((after.root.children[1] as DockContainer).children.at(-1)).toMatchObject({ id: 'toolbox', ratio: 0.35 });
  });

  it('retains the custom Toolbox height when the last chart closes', () => {
    const layout = makeLayout(1);
    const center = layout.root.children[1] as DockContainer;
    center.children[0].ratio = 0.6;
    center.children[1].ratio = 0.4;
    const manager = new DockManager(layout);
    manager.removePanel('seed-0');
    const remaining = (manager.getLayout().root.children[1] as DockContainer).children;
    expect(remaining[0]).toMatchObject({ component: 'EmptyChartArea', ratio: 0.6 });
    expect(remaining[1]).toMatchObject({ id: 'toolbox', ratio: 0.4 });
  });

  it('preserves the empty center column after all charts and Toolbox close so adding keeps sidebar width', () => {
    const manager = new DockManager(makeLayout(1));
    manager.removePanel('toolbox');
    manager.removePanel('seed-0');
    expect(manager.getChartCount()).toBe(0);
    expect(manager.getLayout().root.children[1]).toMatchObject({ id: 'center-main', ratio: 0.8, children: [] });
    manager.addChartPanel({ symbol: 'EURUSD', timeframe: 'M15' });
    const layout = manager.getLayout();
    expect(layout.root.children[0]).toMatchObject({ id: 'left-sidebar', ratio: 0.2 });
    expect(layout.root.children[1]).toMatchObject({ id: 'center-main', ratio: 0.8 });
    expect(manager.getChartCount()).toBe(1);
  });

  it.each([7, 8])('reduces a saved %s-chart workspace to six with a complete recoverable backup', count => {
    const legacy = makeLayout(count);
    const tabs = (legacy.root.children[1] as DockContainer).children[0] as DockContainer;
    tabs.activeTab = `seed-${count - 1}`;
    const key = `saved-${count}-charts`;
    localStorage.setItem(key, JSON.stringify(legacy));
    const manager = new DockManager();
    expect(manager.loadFromStorage(key)).toBe(true);
    expect(manager.getChartCount()).toBe(MAX_CHART_PANELS);
    expect(chartPanels(manager.getLayout()).map(panel => panel.id)).toEqual(['seed-0', 'seed-1', 'seed-2', 'seed-3', 'seed-4', `seed-${count - 1}`]);
    expect(((manager.getLayout().root.children[1] as DockContainer).children[0] as DockContainer).activeTab).toBe(tabs.activeTab);
    const archived = manager.takeOverflowCharts();
    expect(archived).toEqual(chartPanels(legacy).slice(5, count - 1));
    expect(manager.takeOverflowCharts()).toEqual([]);
    expect(JSON.parse(localStorage.getItem(`dock-layout-six-chart-backup-v1:${key}`)!)).toEqual(legacy);
    expect(getChartPanelCount(JSON.parse(localStorage.getItem(key)!))).toBe(MAX_CHART_PANELS);
    expect(manager.addChartPanel({ symbol: 'NEW' })).toEqual({ status: 'limit-reached', count: MAX_CHART_PANELS, limit: MAX_CHART_PANELS });
    expect(manager.loadFromStorage(key)).toBe(true);
    expect(manager.takeOverflowCharts()).toEqual([]);
    expect(JSON.parse(localStorage.getItem(`dock-layout-six-chart-backup-v1:${key}`)!)).toEqual(legacy);
  });

  it('caps constructor and setLayout imports without mutating the input or losing overflow configs', () => {
    const legacy = makeLayout(8);
    const snapshot = JSON.parse(JSON.stringify(legacy));
    const manager = new DockManager(legacy);
    expect(manager.getChartCount()).toBe(MAX_CHART_PANELS);
    expect(manager.takeOverflowCharts()).toEqual(chartPanels(legacy).slice(MAX_CHART_PANELS));
    expect(legacy).toEqual(snapshot);
    manager.setLayout(legacy);
    expect(manager.getChartCount()).toBe(MAX_CHART_PANELS);
    expect(manager.takeOverflowCharts()).toEqual(chartPanels(legacy).slice(MAX_CHART_PANELS));
    expect(manager.canUndo()).toBe(false);
  });

  it('removes empty overflow chart containers while preserving utilities and retained floating state', () => {
    const legacy = makeLayout(5);
    legacy.floatingPanels = [5, 6, 7].map(index => ({
      id: `float-${index}`, type: 'panel', ratio: 1, isFloating: true,
      position: { x: index * 50, y: 60 }, size: { width: 280, height: 200 },
      children: [{ id: `seed-${index}`, title: `SYM${index},H4`, component: 'Chart', minimized: true,
        props: { symbol: `SYM${index}`, timeframe: 'H4', annotation: 'saved' } }],
    }));
    legacy.floatingPanels[2].children.push({ id: 'news', title: 'News', component: 'News' });
    const { layout: bounded, overflowCharts } = enforceChartPanelLimit(legacy);
    expect(getChartPanelCount(bounded)).toBe(MAX_CHART_PANELS);
    expect(bounded.root).toEqual(legacy.root);
    expect(bounded.floatingPanels.map(container => container.id)).toEqual(['float-5', 'float-7']);
    expect(bounded.floatingPanels[0]).toEqual(legacy.floatingPanels[0]);
    expect(bounded.floatingPanels[1].children).toEqual([{ id: 'news', title: 'News', component: 'News' }]);
    expect(overflowCharts.map(panel => panel.id)).toEqual(['seed-6', 'seed-7']);
    expect(overflowCharts.every(panel => panel.props?.annotation === 'saved')).toBe(true);
  });

  it('adds one chart after the last chart is closed and removes the empty placeholder', () => {
    const manager = new DockManager(makeLayout(1));
    manager.removePanel('seed-0');
    const result = manager.addChartPanel({ symbol: 'EURUSD!', timeframe: 'H4', chartType: 'candlestick' });
    expect(result.status).toBe('added');
    expect(manager.getChartCount()).toBe(1);
    expect(allPanels(manager.getLayout()).some(panel => panel.component === 'EmptyChartArea')).toBe(false);
    expect(chartPanels(manager.getLayout())[0].props).toEqual({ symbol: 'EURUSD!', timeframe: 'H4', chartType: 'candlestick' });
  });

  it('creates exactly one visible panel in a completely empty root-only workspace', () => {
    const manager = new DockManager({ version: '2.6', root: { id: 'root', type: 'root', ratio: 1, children: [] }, floatingPanels: [] });
    const result = manager.addChartPanel({ symbol: 'USDJPY', timeframe: 'M5' });
    expect(result.status).toBe('added');
    expect(manager.getChartCount()).toBe(1);
    expect(manager.getLayout().floatingPanels).toEqual([]);
    expect(chartPanels(manager.getLayout())[0].props?.symbol).toBe('USDJPY');
  });
});
