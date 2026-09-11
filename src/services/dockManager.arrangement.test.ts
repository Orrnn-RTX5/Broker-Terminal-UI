// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest';
import { DockManager, MAX_CHART_PANELS, type DockContainer, type DockLayout, type DockPanelConfig } from './dockManager';

const chart = (id: string): DockPanelConfig => ({
  id, title: `${id},M15`, component: 'Chart', ratio: 1,
  props: { symbol: id, timeframe: 'M15', template: { indicators: ['volume'] } },
  closable: true, floatable: true, minWidth: 160,
});

const makeLayout = (): DockLayout => ({
  version: '2.6',
  root: {
    id: 'root', type: 'split', direction: 'horizontal', ratio: 1,
    children: [{
      id: 'left-sidebar', type: 'split', direction: 'vertical', ratio: 0.23,
      children: [
        { id: 'market-watch', title: 'Market Watch', component: 'MarketWatch', ratio: 0.6 },
        { id: 'navigator', title: 'Navigator', component: 'Navigator', ratio: 0.4 },
      ],
    }, {
      id: 'center-main', type: 'split', direction: 'vertical', ratio: 0.77,
      children: [{
        id: 'chart-tabs', type: 'tabs', ratio: 0.68, activeTab: 'BTCUSD',
        children: [chart('XAUUSD'), chart('BTCUSD')],
      }, {
        id: 'toolbox', title: 'Toolbox', component: 'Terminal', ratio: 0.32,
        props: { preserved: true },
      }],
    }],
  },
  floatingPanels: [{
    id: 'existing-chart-float', type: 'panel', ratio: 1, isFloating: true,
    position: { x: 600, y: 100 }, size: { width: 300, height: 240 }, children: [chart('EURUSD')],
  }, {
    id: 'existing-news-float', type: 'panel', ratio: 1, isFloating: true,
    position: { x: 10, y: 10 }, size: { width: 150, height: 140 },
    children: [{ id: 'news', title: 'News', component: 'News', props: { feed: 'retained' } }],
  }],
});

const panels = (container: DockContainer): DockPanelConfig[] => container.children.flatMap(child => (
  'children' in child ? panels(child) : [child]
));
const charts = (layout: DockLayout) => [layout.root, ...layout.floatingPanels]
  .flatMap(panels).filter(panel => panel.component === 'Chart');
const center = (layout: DockLayout) => layout.root.children.find(child => child.id === 'center-main') as DockContainer;
const withoutRatio = ({ ratio: _ratio, ...panel }: DockPanelConfig) => panel;

afterEach(() => { document.body.replaceChildren(); vi.restoreAllMocks(); });

describe('chart window arrangements', () => {
  it.each([
    ['horizontal', 'vertical'], ['vertical', 'horizontal'],
  ] as const)('tiles %s with all chart state and surrounding panels preserved', (mode, direction) => {
    const initial = makeLayout();
    const manager = new DockManager(initial);
    manager.arrangeCharts(mode);
    const result = manager.getLayout();
    const arrangement = center(result).children[0] as DockContainer;
    expect(arrangement.direction).toBe(direction);
    expect(arrangement.children.map(child => child.id)).toEqual(['XAUUSD', 'BTCUSD', 'EURUSD']);
    expect(arrangement.children.map(child => child.ratio)).toEqual([1 / 3, 1 / 3, 1 / 3]);
    expect(charts(result).map(withoutRatio)).toEqual(charts(initial).map(withoutRatio));
    expect(result.root.children[0]).toEqual(initial.root.children[0]);
    expect(center(result).ratio).toBe(0.77);
    expect(center(result).children[0].ratio).toBeCloseTo(0.68);
    expect(center(result).children[1]).toEqual(center(initial).children[1]);
    expect(result.floatingPanels).toEqual([initial.floatingPanels[1]]);

    manager.arrangeCharts(mode);
    expect(charts(manager.getLayout()).map(panel => panel.id)).toEqual(['XAUUSD', 'BTCUSD', 'EURUSD']);
  });

  it('cascades inside the chart workspace above Toolbox and returns every chart to the grid', () => {
    const workspace = document.createElement('div');
    workspace.dataset.dockContainer = 'center-main';
    const terminal = document.createElement('div');
    terminal.dataset.dockPanelComponent = 'terminal';
    document.body.append(workspace, terminal);
    vi.spyOn(workspace, 'getBoundingClientRect').mockReturnValue({ left: 250, top: 90, right: 1000, bottom: 740, width: 750, height: 650 } as DOMRect);
    vi.spyOn(terminal, 'getBoundingClientRect').mockReturnValue({ left: 250, top: 560, right: 1000, bottom: 740, width: 750, height: 180 } as DOMRect);

    const initial = makeLayout();
    const manager = new DockManager(initial);
    manager.arrangeCharts('cascade');
    const result = manager.getLayout();
    expect(charts(result).map(withoutRatio)).toEqual(charts(initial).map(withoutRatio));
    expect(result.root.children[0]).toEqual(initial.root.children[0]);
    expect(center(result).children[1]).toEqual(center(initial).children[1]);
    expect(center(result).children[0].ratio).toBe(0.68);
    expect(panels(result.root).filter(panel => panel.component === 'EmptyChartArea')).toHaveLength(1);
    expect(result.floatingPanels[0]).toEqual(initial.floatingPanels[1]);
    const floatedCharts = result.floatingPanels.slice(1);
    expect(floatedCharts).toHaveLength(3);
    expect(new Set(floatedCharts.map(panel => `${panel.position?.x}:${panel.position?.y}`)).size).toBe(3);
    for (const floating of floatedCharts) {
      expect(floating.position!.x).toBeGreaterThanOrEqual(258);
      expect(floating.position!.y).toBeGreaterThanOrEqual(98);
      expect(floating.position!.x + floating.size!.width).toBeLessThanOrEqual(992);
      expect(floating.position!.y + floating.size!.height).toBeLessThanOrEqual(552);
    }
    manager.arrangeCharts('cascade');
    expect(panels(manager.getLayout().root).filter(panel => panel.component === 'EmptyChartArea')).toHaveLength(1);
    expect(charts(manager.getLayout())).toHaveLength(3);
    manager.arrangeCharts('grid');
    const tiled = manager.getLayout();
    expect(charts(tiled).map(withoutRatio)).toEqual(charts(initial).map(withoutRatio));
    expect(tiled.floatingPanels).toEqual([initial.floatingPanels[1]]);
    expect(panels(tiled.root).some(panel => panel.component === 'EmptyChartArea')).toBe(false);
    expect(center(tiled).children[1]).toEqual(center(initial).children[1]);
  });

  it.each(['grid', 'horizontal', 'vertical', 'cascade'] as const)('does not alter a workspace with no charts for %s', mode => {
    const initial = makeLayout();
    center(initial).children.splice(0, 1);
    initial.floatingPanels.shift();
    const manager = new DockManager(initial);
    const onLayout = vi.fn();
    manager.subscribe(onLayout);
    manager.arrangeCharts(mode);
    expect(manager.getLayout()).toEqual(initial);
    expect(onLayout).not.toHaveBeenCalled();
  });

  it('preserves sidebar width and the center column when tiling with Toolbox closed', () => {
    const initial = makeLayout();
    center(initial).children.pop();
    center(initial).children[0].ratio = 1;
    const manager = new DockManager(initial);
    manager.arrangeCharts('horizontal');
    const result = manager.getLayout();
    expect(result.root.children[0]).toEqual(initial.root.children[0]);
    expect(center(result).ratio).toBe(0.77);
    expect(center(result).children).toHaveLength(1);
    expect(center(result).children[0].ratio).toBe(1);
    expect(charts(result).map(withoutRatio)).toEqual(charts(initial).map(withoutRatio));
  });

  it('preserves the height of an extra docked utility beside Toolbox', () => {
    const initial = makeLayout();
    center(initial).children[0].ratio = 0.48;
    center(initial).children.splice(1, 0, { id: 'orders', title: 'Orders', component: 'Orders', ratio: 0.2 });
    const manager = new DockManager(initial);
    manager.arrangeCharts('vertical');
    expect(center(manager.getLayout()).children.map(child => child.ratio)).toEqual([0.48, 0.2, 0.32]);
  });

  it('resets to the selected chart while retaining its settings and the utility panels', () => {
    const initial = makeLayout();
    const originalCharts = charts(initial);
    originalCharts[0].props = { brokerId: 'broker-one', symbol: 'XAUUSD.a', timeframe: 'M1', template: 'scalping' };
    originalCharts[1].props = { brokerId: 'broker-two', symbol: 'BTCUSD', timeframe: 'MN', template: 'monthly' };
    originalCharts[2].props = { brokerId: 'broker-three', symbol: 'EURUSD!', timeframe: 'H4', template: 'swing' };
    const manager = new DockManager(initial);
    manager.arrangeCharts('cascade');
    manager.setPanelMinimized('BTCUSD', true);
    manager.resetWindows('BTCUSD');
    const result = manager.getLayout();
    expect(charts(result).map(withoutRatio)).toEqual([withoutRatio(originalCharts[1])]);
    const allPanels = panels(result.root);
    expect(allPanels.map(panel => panel.id).sort()).toEqual([...
      panels(initial.root), ...initial.floatingPanels.flatMap(panels),
    ].filter(panel => panel.component !== 'Chart' || panel.id === 'BTCUSD').map(panel => panel.id).sort());
    expect(allPanels.find(panel => panel.id === 'toolbox')?.props).toEqual({ preserved: true });
    expect(allPanels.find(panel => panel.id === 'news')?.props).toEqual({ feed: 'retained' });
    expect(result.root.children[0].ratio).toBe(0.2);
    expect(center(result).children[1].ratio).toBe(0.25);
    expect(result.floatingPanels).toEqual([]);
    expect(allPanels.some(panel => panel.minimized)).toBe(false);
    expect(center(result).children[0]).toMatchObject({ id: 'BTCUSD', component: 'Chart', ratio: 0.75 });
    expect(manager.canUndo()).toBe(false);
    expect(manager.canRedo()).toBe(false);
  });

  it('creates one default chart when resetting a workspace with all charts closed', () => {
    const manager = new DockManager({ version: 'empty', root: { id: 'root', type: 'split', ratio: 1, children: [] }, floatingPanels: [] });
    manager.resetWindows();
    expect(charts(manager.getLayout())).toHaveLength(1);
    expect(charts(manager.getLayout())[0]).toMatchObject({ component: 'Chart', props: { timeframe: 'M5' } });
    expect(charts(manager.getLayout())[0].props?.symbol).toBeUndefined();
    expect(panels(manager.getLayout().root).some(panel => panel.component === 'EmptyChartArea')).toBe(false);
  });

  it.each(['grid', 'horizontal', 'vertical', 'cascade'] as const)('reduces six %s charts to one and keeps repeated resets stable', mode => {
    const manager = new DockManager(makeLayout());
    while (manager.canAddChart()) manager.addChartPanel({ symbol: 'XAUUSD.raw', timeframe: 'H4' });
    expect(manager.getChartCount()).toBe(MAX_CHART_PANELS);
    manager.arrangeCharts(mode);
    const selected = charts(manager.getLayout()).at(-1)!;
    manager.setPanelMinimized(selected.id, true);
    manager.resetWindows(selected.id);
    const reset = manager.getLayout();
    expect(charts(reset).map(panel => panel.id)).toEqual([selected.id]);
    expect(charts(reset)[0].props).toEqual(selected.props);
    expect(charts(reset)[0].minimized).not.toBe(true);
    expect(reset.floatingPanels).toEqual([]);
    expect(manager.undo()).toBe(false);
    manager.resetWindows('stale-chart-id');
    expect(manager.getLayout()).toEqual(reset);
  });

  it('arranges only minimized floating windows, restores their original geometry, and keeps chart state', () => {
    const manager = new DockManager(makeLayout());
    manager.arrangeCharts('cascade');
    const before = manager.getLayout();
    const untouched = before.floatingPanels.find(container => container.children[0].id === 'EURUSD');
    manager.setPanelMinimized('XAUUSD', true);
    manager.setPanelMinimized('BTCUSD', true);
    expect(manager.arrangeIcons()).toBe(2);
    const arranged = manager.getLayout();
    const icons = arranged.floatingPanels.filter(container => (container.children[0] as DockPanelConfig).minimized);
    expect(icons).toHaveLength(2);
    expect(icons[0].position!.x).toBeLessThan(icons[1].position!.x);
    expect(icons[0].position!.y).toBe(icons[1].position!.y);
    expect(arranged.floatingPanels.find(container => container.children[0].id === 'EURUSD')).toEqual(untouched);
    manager.setPanelMinimized('XAUUSD', false);
    const restored = manager.getLayout().floatingPanels.find(container => container.children[0].id === 'XAUUSD');
    expect(restored).toEqual(before.floatingPanels.find(container => container.children[0].id === 'XAUUSD'));
    manager.arrangeCharts('horizontal');
    expect(charts(manager.getLayout()).some(panel => panel.minimized)).toBe(false);
    expect(charts(manager.getLayout()).map(withoutRatio)).toEqual(charts(before).map(withoutRatio));
  });

  it('leaves normal windows unchanged when there are no minimized icons', () => {
    const initial = makeLayout();
    const manager = new DockManager(initial);
    expect(manager.arrangeIcons()).toBe(0);
    expect(manager.getLayout()).toEqual(initial);
  });

  it('undoes and redoes arrangements without metadata or resize updates adding history steps', () => {
    const manager = new DockManager(makeLayout());
    manager.arrangeCharts('grid');
    const grid = center(manager.getLayout()).children[0] as DockContainer;
    manager.arrangeCharts('vertical');
    manager.updatePanelProps('XAUUSD', { title: 'XAUUSD.a,H4', props: { symbol: 'XAUUSD.a', timeframe: 'H4', brokerId: 'live-broker' } });
    manager.updateContainerSize('XAUUSD', 0.7);
    expect(manager.canUndo()).toBe(true);
    expect(manager.undo()).toBe(true);
    expect((center(manager.getLayout()).children[0] as DockContainer).id).toBe(grid.id);
    expect(charts(manager.getLayout()).find(panel => panel.id === 'XAUUSD')).toMatchObject({
      title: 'XAUUSD.a,H4', props: { symbol: 'XAUUSD.a', timeframe: 'H4', brokerId: 'live-broker' },
    });
    expect(manager.canRedo()).toBe(true);
    expect(manager.redo()).toBe(true);
    expect(center(manager.getLayout()).children[0]).toMatchObject({ id: 'chart-tile-vertical', direction: 'horizontal' });
    expect(charts(manager.getLayout()).find(panel => panel.id === 'XAUUSD')?.props?.timeframe).toBe('H4');
    expect(manager.canRedo()).toBe(false);
  });

  it('clears layout history after a chart closes so undo cannot resurrect it', () => {
    const manager = new DockManager(makeLayout());
    manager.arrangeCharts('grid');
    manager.arrangeCharts('vertical');
    manager.removePanel('BTCUSD');
    expect(manager.canUndo()).toBe(false);
    expect(manager.canRedo()).toBe(false);
    expect(manager.undo()).toBe(false);
    expect(charts(manager.getLayout()).some(panel => panel.id === 'BTCUSD')).toBe(false);
  });

  it('does not create duplicate undo steps for a repeated arrangement and invalidates redo after a new choice', () => {
    const initial = makeLayout();
    const manager = new DockManager(initial);
    manager.arrangeCharts('grid');
    manager.arrangeCharts('grid');
    expect(manager.undo()).toBe(true);
    expect(manager.getLayout()).toEqual(initial);
    expect(manager.canUndo()).toBe(false);
    expect(manager.canRedo()).toBe(true);
    manager.arrangeCharts('horizontal');
    expect(manager.canRedo()).toBe(false);
  });

  it('clears history when switching to an account with no saved layout', () => {
    const manager = new DockManager(makeLayout());
    manager.arrangeCharts('vertical');
    expect(manager.canUndo()).toBe(true);
    expect(manager.loadFromStorage('missing-layout-for-new-account')).toBe(false);
    expect(manager.canUndo()).toBe(false);
    expect(manager.canRedo()).toBe(false);
  });
});
