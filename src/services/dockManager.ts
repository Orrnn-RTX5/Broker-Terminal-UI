/**
 * Dock Manager Service
 * Professional docking layout system for trading terminals
 */

import type { ChartSymbolTab } from '../utils/chartSymbolTabs';
import { DEFAULT_CHART_SYMBOL, DEFAULT_CHART_TIMEFRAME } from '../constants/chartDefaults';

export type DockDirection = 'left' | 'right' | 'top' | 'bottom' | 'center' | 'tab';
export type DockContainerType = 'root' | 'split' | 'tabs' | 'panel';
export type ChartArrangement = 'grid' | 'horizontal' | 'vertical' | 'cascade';
export const MAX_CHART_PANELS = 6;

export interface AddChartPanelOptions {
  symbol?: string;
  timeframe?: string;
  chartType?: 'bar' | 'candlestick' | 'line' | 'area';
}

export type AddChartPanelResult = {
  status: 'added'; panelId: string; count: number; limit: typeof MAX_CHART_PANELS;
} | {
  status: 'limit-reached'; count: number; limit: typeof MAX_CHART_PANELS;
};

export interface DropZone {
  id: string;
  direction: DockDirection;
  rect: { x: number; y: number; width: number; height: number };
  targetContainerId: string;
  priority: number;
}

export interface DockPanelConfig {
  id: string;
  title: string;
  icon?: string;
  component: string;
  props?: Record<string, any>;
  chartSymbolTabs?: ChartSymbolTab[];
  minWidth?: number;
  minHeight?: number;
  preferredWidth?: number;
  preferredHeight?: number;
  closable?: boolean;
  floatable?: boolean;
  resizable?: boolean;
  minimized?: boolean;
  ratio?: number;
}

export interface DockContainer {
  id: string;
  type: DockContainerType;
  direction?: 'horizontal' | 'vertical';
  ratio: number;
  children: (DockContainer | DockPanelConfig)[];
  activeTab?: string;
  isFloating?: boolean;
  position?: { x: number; y: number };
  size?: { width: number; height: number };
  restorePosition?: { x: number; y: number };
  iconWidth?: number;
}

export interface DockLayout {
  root: DockContainer;
  floatingPanels: DockContainer[];
  version: string;
}

export const getChartPanelCount = (layout: DockLayout): number => {
  const count = (container: DockContainer): number => container.children.reduce((total, child) => (
    total + ('children' in child ? count(child) : child.component === 'Chart' ? 1 : 0)
  ), 0);
  return count(layout.root) + layout.floatingPanels.reduce((total, container) => total + count(container), 0);
};

/** Keep saved active tabs when reducing older workspaces to the current chart limit. */
export const enforceChartPanelLimit = (layout: DockLayout): { layout: DockLayout; overflowCharts: DockPanelConfig[] } => {
  if (getChartPanelCount(layout) <= MAX_CHART_PANELS) return { layout, overflowCharts: [] };
  const bounded: DockLayout = JSON.parse(JSON.stringify(layout));
  const charts: DockPanelConfig[] = [];
  const activeIds = new Set<string>();
  const collect = (container: DockContainer) => {
    if (container.type === 'tabs' && container.activeTab) activeIds.add(container.activeTab);
    container.children.forEach(child => {
      if ('children' in child) collect(child);
      else if (child.component === 'Chart') charts.push(child);
    });
  };
  [bounded.root, ...bounded.floatingPanels].forEach(collect);
  const retainedIds = new Set([
    ...charts.filter(chart => activeIds.has(chart.id)),
    ...charts.filter(chart => !activeIds.has(chart.id)),
  ].slice(0, MAX_CHART_PANELS).map(chart => chart.id));
  const overflowCharts = charts.filter(chart => !retainedIds.has(chart.id));
  const prune = (container: DockContainer) => {
    container.children = container.children.filter(child => {
      if (!('children' in child)) return child.component !== 'Chart' || retainedIds.has(child.id);
      const wasEmpty = child.children.length === 0;
      prune(child);
      return wasEmpty || child.children.length > 0 || child.id === 'center-main' || child.id === 'left-sidebar';
    });
    if (container.type === 'tabs' && !container.children.some(child => child.id === container.activeTab)) {
      container.activeTab = container.children[0]?.id;
    }
  };
  prune(bounded.root);
  bounded.floatingPanels = bounded.floatingPanels.filter(container => {
    const wasEmpty = container.children.length === 0;
    prune(container);
    return wasEmpty || container.children.length > 0;
  });
  return { layout: bounded, overflowCharts };
};

const findFirstChartPanel = (layout: DockLayout): DockPanelConfig | undefined => {
  const findChart = (container: DockContainer): DockPanelConfig | undefined => {
    for (const child of container.children) {
      if ('children' in child) { const chart = findChart(child); if (chart) return chart; }
      else if (child.component === 'Chart') return child;
    }
  };
  return findChart(layout.root) || layout.floatingPanels.map(findChart).find(Boolean);
};

const createChartPanel = (symbol: string, timeframe: string, chartType: NonNullable<AddChartPanelOptions['chartType']>): DockPanelConfig => {
  const panelId = `chart-${globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`}`;
  return {
    id: panelId, title: `${symbol || 'Chart'},${timeframe}`, component: 'Chart',
    props: { ...(symbol ? { symbol } : {}), timeframe, chartType },
    ratio: 1, closable: true, floatable: true,
  };
};

const MIN_PANEL_SIZE = 100;
const DEFAULT_RATIO = 0.5;
const DOCK_LAYOUT_PREVIOUS_DESKTOP_DEFAULT_MIGRATION_PREFIX = 'dock-layout-desktop-mt5-v2:';
const DOCK_LAYOUT_DESKTOP_WEB_PARITY_MIGRATION_PREFIX = 'dock-layout-desktop-web-parity-v3:';
const DOCK_LAYOUT_SIX_CHART_BACKUP_PREFIX = 'dock-layout-six-chart-backup-v1:';
const DESKTOP_WEB_PARITY_RATIOS = { sidebar: 0.20, chart: 0.75 } as const;

const getChartWorkspaceBounds = () => {
  const viewportWidth = typeof window === 'undefined' ? 1200 : window.innerWidth;
  const viewportHeight = typeof window === 'undefined' ? 800 : window.innerHeight;
  const workspace = typeof document === 'undefined' ? null : (
    document.querySelector('[data-dock-container="center-main"]')
      || document.querySelector('.rtx-dock-workspace')
  )?.getBoundingClientRect();
  const terminal = typeof document === 'undefined' ? null : document.querySelector(
    '[data-dock-panel-component="terminal" i]:not([data-dock-floating-panel="true"])',
  )?.getBoundingClientRect();
  const hasWorkspace = workspace && workspace.width > 0 && workspace.height > 0;
  const right = Math.max(1, Math.min(viewportWidth - 8, hasWorkspace ? workspace.right - 8 : viewportWidth - 16));
  const left = Math.max(0, Math.min(right - 1, hasWorkspace ? workspace.left + 8 : 48));
  const workspaceBottom = hasWorkspace ? workspace.bottom - 8 : viewportHeight - 16;
  const top = Math.max(0, Math.min(viewportHeight - 2, hasWorkspace ? workspace.top + 8 : 80));
  const bottom = Math.max(top + 1, Math.min(viewportHeight - 8,
    terminal && terminal.top > top && terminal.left <= right && terminal.right >= left
      ? Math.min(workspaceBottom, terminal.top - 8) : workspaceBottom));
  return { left, top, right, bottom, width: Math.max(1, right - left), height: Math.max(1, bottom - top) };
};
const PREVIOUS_DESKTOP_DEFAULT_RATIOS = {
  topMain: 0.657,
  toolbox: 0.343,
  sidebar: 0.184,
  chart: 0.816,
} as const;

const ratioMatches = (value: unknown, expected: number): boolean => (
  typeof value === 'number' && Math.abs(value - expected) < 0.0001
);

const getPreviousDesktopDefaultParts = (root: any): {
  leftSidebar: any;
  chartArea: any;
  toolbox: any;
} | null => {
  const rootChildren = Array.isArray(root?.children) ? root.children : [];
  const topMain = rootChildren[0];
  const toolbox = rootChildren[1];
  const topMainChildren = Array.isArray(topMain?.children) ? topMain.children : [];
  const leftSidebar = topMainChildren[0];
  const chartArea = topMainChildren[1];
  const sidebarChildren = Array.isArray(leftSidebar?.children) ? leftSidebar.children : [];

  const matchesPreviousDefault = (
    root?.direction === 'vertical'
    && rootChildren.length === 2
    && topMain?.id === 'desktop-top-main'
    && topMain?.direction === 'horizontal'
    && ratioMatches(topMain?.ratio, PREVIOUS_DESKTOP_DEFAULT_RATIOS.topMain)
    && topMainChildren.length === 2
    && leftSidebar?.id === 'left-sidebar'
    && leftSidebar?.direction === 'vertical'
    && ratioMatches(leftSidebar?.ratio, PREVIOUS_DESKTOP_DEFAULT_RATIOS.sidebar)
    && sidebarChildren.length === 2
    && sidebarChildren[0]?.id === 'market-watch'
    && sidebarChildren[0]?.component === 'MarketWatch'
    && ratioMatches(sidebarChildren[0]?.ratio, 0.5)
    && sidebarChildren[1]?.id === 'navigator'
    && sidebarChildren[1]?.component === 'Navigator'
    && ratioMatches(sidebarChildren[1]?.ratio, 0.5)
    && chartArea?.component === 'Chart'
    && ratioMatches(chartArea?.ratio, PREVIOUS_DESKTOP_DEFAULT_RATIOS.chart)
    && toolbox?.id === 'toolbox'
    && toolbox?.component === 'Terminal'
    && ratioMatches(toolbox?.ratio, PREVIOUS_DESKTOP_DEFAULT_RATIOS.toolbox)
  );

  return matchesPreviousDefault ? { leftSidebar, chartArea, toolbox } : null;
};

export class DockManager {
  private layout: DockLayout;
  private listeners: Set<(layout: DockLayout) => void> = new Set();
  private windowUndoLayouts: DockLayout[] = [];
  private windowRedoLayouts: DockLayout[] = [];
  private overflowCharts: DockPanelConfig[] = [];

  constructor(initialLayout?: DockLayout) {
    this.layout = this.applyChartLimit(initialLayout || this.createDefaultLayout());
  }

  private applyChartLimit(layout: DockLayout): DockLayout {
    const bounded = enforceChartPanelLimit(layout);
    const overflowIds = new Set(bounded.overflowCharts.map(chart => chart.id));
    this.overflowCharts = [...bounded.overflowCharts, ...this.overflowCharts.filter(chart => !overflowIds.has(chart.id))];
    return bounded.layout;
  }

  /** Let the workspace expose migrated chart configurations through Open Deleted. */
  takeOverflowCharts(): DockPanelConfig[] {
    const charts = this.overflowCharts;
    this.overflowCharts = [];
    return charts;
  }

  private createDefaultLayout(): DockLayout {
    // Official MT5 Default Layout:
    // Left: Market Watch (Top) + Navigator (Bottom)
    // Right: Charts (Top) + Toolbox (Bottom)
    return {
      root: {
        id: 'root',
        type: 'split',
        direction: 'horizontal',
        ratio: 1,
        children: [
          // LEFT COLUMN (20% width)
          {
            id: 'left-sidebar',
            type: 'split',
            direction: 'vertical',
            ratio: 0.20,
            children: [
              // Market Watch (Top half of left sidebar)
              {
                id: 'market-watch',
                type: 'panel',
                title: 'Market Watch',
                component: 'MarketWatch',
                ratio: 0.50,
                closable: true,
                floatable: true,
              } as any,
              // Navigator (Bottom half of left sidebar)
              {
                id: 'navigator',
                type: 'panel',
                title: 'Navigator',
                component: 'Navigator',
                ratio: 0.50,
                closable: true,
                floatable: true,
              } as any,
            ]
          },
          // CENTER MAIN COLUMN (80% width)
          {
            id: 'center-main',
            type: 'split',
            direction: 'vertical',
            ratio: 0.80,
            children: [
              // Charts area (75% of center main)
              {
                id: 'chart-default-container',
                type: 'panel',
                title: `${DEFAULT_CHART_SYMBOL},${DEFAULT_CHART_TIMEFRAME}`,
                component: 'Chart',
                props: { symbol: DEFAULT_CHART_SYMBOL, timeframe: DEFAULT_CHART_TIMEFRAME },
                ratio: 0.75,
                closable: true,
                floatable: true,
              } as any,
              // Toolbox (25% of center main)
              {
                id: 'toolbox',
                type: 'panel',
                title: 'Toolbox',
                component: 'Terminal',
                ratio: 0.25,
                closable: true,
                floatable: true,
              } as any,
            ]
          }
        ],
      },
      floatingPanels: [],
      version: '2.6',
    };
  }

  getLayout(): DockLayout {
    return JSON.parse(JSON.stringify(this.layout));
  }

  getChartCount(): number {
    return getChartPanelCount(this.layout);
  }

  canAddChart(): boolean {
    return this.getChartCount() < MAX_CHART_PANELS;
  }

  /** Add one independent chart and divide the workspace without resetting existing charts. */
  addChartPanel(options: AddChartPanelOptions = {}): AddChartPanelResult {
    const count = this.getChartCount();
    if (count >= MAX_CHART_PANELS) return { status: 'limit-reached', count, limit: MAX_CHART_PANELS };
    const source = findFirstChartPanel(this.layout);
    const symbol = options.symbol?.trim() || String(source?.props?.symbol || DEFAULT_CHART_SYMBOL).trim();
    const timeframe = options.timeframe?.trim() || String(source?.props?.timeframe || DEFAULT_CHART_TIMEFRAME);
    const chartType = options.chartType || source?.props?.chartType || 'candlestick';
    const panel = createChartPanel(symbol, timeframe, chartType);
    // Stage the new panel off-screen, then commit once. This also handles an
    // empty/root-only workspace without relying on a particular tab host.
    const staged = this.getLayout();
    staged.floatingPanels.push({
      id: `new-${panel.id}`, type: 'panel', ratio: 1, isFloating: true, children: [panel],
    });
    const next = new DockManager(staged);
    next.tileWindows('grid', { restoreMinimized: false });
    this.setLayout(next.getLayout());
    return { status: 'added', panelId: panel.id, count: count + 1, limit: MAX_CHART_PANELS };
  }

  setLayout(layout: DockLayout, silent = false, preserveWindowHistory = false): void {
    const bounded = this.applyChartLimit(layout);
    if (!preserveWindowHistory && this.panelMembership(this.layout) !== this.panelMembership(bounded)) {
      this.clearWindowHistory();
    }
    this.layout = JSON.parse(JSON.stringify(bounded));
    if (!silent) {
      this.notify();
    }
  }

  private panelMembership(layout: DockLayout): string {
    const ids: string[] = [];
    const collect = (container: DockContainer) => container.children.forEach(child => {
      if ('children' in child) collect(child);
      else ids.push(`${child.id}:${child.component}`);
    });
    collect(layout.root);
    layout.floatingPanels.forEach(collect);
    return ids.sort().join('\u0000');
  }

  private clearWindowHistory(): void {
    this.windowUndoLayouts = [];
    this.windowRedoLayouts = [];
  }

  private commitWindowArrangement(layout: DockLayout): void {
    const geometry = (node: DockContainer | DockPanelConfig): unknown => 'children' in node ? {
      type: node.type, direction: node.direction, ratio: node.ratio, activeTab: node.activeTab,
      position: node.position, size: node.size, restorePosition: node.restorePosition, iconWidth: node.iconWidth,
      children: node.children.map(geometry),
    } : { id: node.id, component: node.component, ratio: node.ratio, minimized: node.minimized };
    const signature = (value: DockLayout) => JSON.stringify([geometry(value.root), value.floatingPanels.map(geometry)]);
    if (signature(layout) === signature(this.layout)) return;
    this.windowUndoLayouts.push(this.getLayout());
    if (this.windowUndoLayouts.length > 30) this.windowUndoLayouts.shift();
    this.windowRedoLayouts = [];
    this.setLayout(layout, false, true);
  }

  private restoreWindowArrangement(snapshot: DockLayout): void {
    const latestPanels = new Map<string, DockPanelConfig>();
    const collect = (container: DockContainer) => container.children.forEach(child => {
      if ('children' in child) collect(child);
      else latestPanels.set(child.id, child);
    });
    collect(this.layout.root);
    this.layout.floatingPanels.forEach(collect);
    const restored: DockLayout = JSON.parse(JSON.stringify(snapshot));
    const preserveChartSettings = (container: DockContainer) => container.children.forEach(child => {
      if ('children' in child) preserveChartSettings(child);
      else {
        const latest = latestPanels.get(child.id);
        if (latest?.component !== child.component) return;
        child.title = latest.title;
        child.props = latest.props ? JSON.parse(JSON.stringify(latest.props)) : undefined;
      }
    });
    preserveChartSettings(restored.root);
    restored.floatingPanels.forEach(preserveChartSettings);
    this.setLayout(restored, false, true);
  }

  subscribe(listener: (layout: DockLayout) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private notify(): void {
    const layout = this.getLayout();
    this.listeners.forEach((l) => l(layout));
  }

  resetToDefaultLayout(): void {
    this.clearWindowHistory();
    this.layout = this.createDefaultLayout();
    this.notify();
  }

  /** Restore the standard workspace with one chart, keeping the selected chart's state. */
  resetWindows(preferredChartId?: string): void {
    const current = this.getLayout();
    const panels: DockPanelConfig[] = [];
    const collect = (container: DockContainer) => container.children.forEach(child => {
      if ('children' in child) collect(child);
      else if (child.component !== 'EmptyChartArea') {
        delete child.minimized;
        panels.push(child);
      }
    });
    collect(current.root);
    current.floatingPanels.forEach(collect);
    const charts = panels.filter(panel => panel.component === 'Chart');
    const retainedChart = charts.find(chart => chart.id === preferredChartId) || charts[0];
    const restored = this.createDefaultLayout();
    const sidebar = restored.root.children[0] as DockContainer;
    const center = restored.root.children[1] as DockContainer;
    const reused = new Set(charts.map(chart => chart.id));
    const reusePanel = (fallback: DockPanelConfig): DockPanelConfig => {
      const existing = panels.find(panel => panel.component === fallback.component && !reused.has(panel.id));
      if (!existing) return fallback;
      reused.add(existing.id);
      return { ...existing, ratio: fallback.ratio };
    };
    sidebar.children = sidebar.children.map(panel => reusePanel(panel as DockPanelConfig));
    center.children[1] = reusePanel(center.children[1] as DockPanelConfig);
    if (retainedChart) center.children[0] = { ...retainedChart, ratio: 0.75 };
    // Keep other open utilities available in a compact side tab group.
    const extraPanels = panels.filter(panel => !reused.has(panel.id));
    if (extraPanels.length) {
      center.ratio = 0.6;
      restored.root.children.push({
        id: 'right-sidebar', type: 'tabs', ratio: 0.2, activeTab: extraPanels[0].id,
        children: extraPanels.map(panel => ({ ...panel, ratio: 1 })),
      });
    }
    // Reset closes the other chart panes. Older arrangement history must not
    // resurrect those panes after the workspace has returned to one chart.
    this.clearWindowHistory();
    this.setLayout(restored);
  }

  setPanelMinimized(panelId: string, minimized: boolean): void {
    const layout = this.getLayout();
    const find = (container: DockContainer): DockPanelConfig | undefined => {
      for (const child of container.children) {
        if ('children' in child) { const match = find(child); if (match) return match; }
        else if (child.id === panelId) return child;
      }
    };
    const floating = layout.floatingPanels.find(container => Boolean(find(container)));
    const panel = find(layout.root) || (floating && find(floating));
    if (!panel || Boolean(panel.minimized) === minimized) return;
    if (minimized) panel.minimized = true;
    else {
      delete panel.minimized;
      if (floating?.restorePosition) {
        floating.position = floating.restorePosition;
        delete floating.restorePosition;
      }
      if (floating) delete floating.iconWidth;
    }
    this.setLayout(layout);
  }

  bringFloatingToFront(panelId: string): void {
    const layout = this.getLayout();
    const index = layout.floatingPanels.findIndex(container => container.children.some(child => child.id === panelId));
    if (index < 0 || index === layout.floatingPanels.length - 1) return;
    layout.floatingPanels.push(...layout.floatingPanels.splice(index, 1));
    this.setLayout(layout);
  }

  /** Pack minimized floating title bars along the bottom of the chart workspace. */
  arrangeIcons(): number {
    const layout = this.getLayout();
    const minimized = layout.floatingPanels.filter(container => container.children.some(child => !('children' in child) && child.minimized));
    if (!minimized.length) return 0;
    const bounds = getChartWorkspaceBounds();
    const width = Math.min(240, bounds.width);
    const columns = Math.max(1, Math.floor((bounds.width + 8) / (width + 8)));
    minimized.forEach((container, index) => {
      container.iconWidth = width;
      container.restorePosition ??= container.position ? { ...container.position } : { x: bounds.left, y: bounds.top };
      container.position = {
        x: bounds.left + (index % columns) * (width + 8),
        y: Math.max(bounds.top, bounds.bottom - 30 - Math.floor(index / columns) * 38),
      };
    });
    this.commitWindowArrangement(layout);
    return minimized.length;
  }

  /**
   * Arrange Windows toolbar action: grow the tiled grid by one chart per call
   * until the six-window maximum, then keep re-tiling the open charts.
   */
  stepTileWindows(): void {
    if (this.canAddChart()) {
      this.addChartPanel();
      return;
    }
    this.arrangeCharts('grid');
  }

  /**
   * TILE WINDOWS implementation:
   * Finds all Chart components and recursively removes them from their current container.
   * Then repackages them into a clean tiled grid layout.
   */
  tileWindows(mode: Exclude<ChartArrangement, 'cascade'> = 'grid', options: { restoreMinimized?: boolean } = {}): void {
    const layout = this.getLayout();
    
    // 1. Collect all chart panels and remove them from layout
    const charts: DockPanelConfig[] = [];
    
    const extractCharts = (container: DockContainer) => {
       container.children = container.children.filter(child => {
         if ('children' in child) {
            extractCharts(child as DockContainer);
         } else if ((child as DockPanelConfig).component === 'Chart') {
            charts.push(child as DockPanelConfig);
            return false;
         } else if ((child as DockPanelConfig).component === 'EmptyChartArea') {
            // Remove the empty placeholder since we are re-tiling real charts
            return false;
         }
         return true;
       });
       if (container.type === 'tabs' && !container.children.some(child => child.id === container.activeTab)) {
         container.activeTab = container.children[0]?.id;
       }
    };
    
    extractCharts(layout.root);
    layout.floatingPanels.forEach(container => {
       extractCharts(container);
       this.cleanupEmptyContainers(container);
    });
    layout.floatingPanels = layout.floatingPanels.filter(container => container.children.length > 0);
    
    if (charts.length === 0) return;
    if (options.restoreMinimized !== false) charts.forEach(chart => { delete chart.minimized; });
    
    // 2. Build grid layout
    let chartsContainer: DockContainer | DockPanelConfig;
    
    if (charts.length === 1) {
       chartsContainer = { ...charts[0], ratio: 1 };
    } else if (mode !== 'grid') {
       // Horizontal tiling produces horizontal rows; vertical tiling produces
       // vertical columns, matching the window-menu names.
       chartsContainer = {
          id: `chart-tile-${mode}`,
          type: 'split',
          direction: mode === 'horizontal' ? 'vertical' : 'horizontal',
          ratio: 0.75,
          children: charts.map(chart => ({ ...chart, ratio: 1 / charts.length })),
       };
    } else if (charts.length === 2) {
       chartsContainer = {
          id: `grid-${Date.now()}`,
          type: 'split',
          direction: 'horizontal',
          ratio: 0.75,
          children: charts.map(c => ({...c, ratio: 0.5}))
       };
    } else if (charts.length === 3) {
       // MT5 Style: 1 on Left, 2 Stacked on Right
       const rightStack: DockContainer = {
          id: `grid-v-${Date.now()}`,
          type: 'split',
          direction: 'vertical',
          ratio: 0.5,
          children: [
             { ...charts[1], ratio: 0.5 },
             { ...charts[2], ratio: 0.5 }
          ]
       };
       chartsContainer = {
          id: `grid-h-${Date.now()}`,
          type: 'split',
          direction: 'horizontal',
          ratio: 0.75,
          children: [
             { ...charts[0], ratio: 0.5 },
             rightStack
          ]
       };
    } else {
          // Grid layout
          const cols = Math.ceil(Math.sqrt(charts.length));
          const rowsContainer: DockContainer = {
             id: `grid-v-${Date.now()}`,
             type: 'split',
             direction: 'vertical',
             ratio: 0.75,
             children: []
          };
          for (let i = 0; i < charts.length; i += cols) {
             const rowPanel = charts.slice(i, i + cols);
             const rowContainer: DockContainer = {
                 id: `grid-h-${Date.now()}-${i}`,
                 type: 'split',
                 direction: 'horizontal',
                 ratio: 1 / Math.ceil(charts.length / cols),
                 children: rowPanel.map(c => ({...c, ratio: 1/rowPanel.length}))
             };
             rowsContainer.children.push(rowContainer);
          }
          chartsContainer = rowsContainer;
    }
    
    // Preserve the center column when Toolbox is closed and all charts are extracted.
    this.cleanupEmptyContainers(layout.root, new Set(['center-main']));

    // 4. Determine insertion point
    const centerMain = this.findContainer(layout.root, 'center-main');
    if (centerMain && centerMain.type === 'split' && centerMain.direction === 'vertical') {
       // Preserve Toolbox and other utility heights when chart panels move.
       const remainingRatio = centerMain.children.reduce((sum, child) => sum + (child.ratio ?? 0), 0);
       
       const chartsRatio = remainingRatio < 1 ? 1 - remainingRatio : 0.75;
       chartsContainer.ratio = chartsRatio;

       // Center main expected order: charts on top, terminal on bottom
       // We insert charts at the beginning (top) so they don't break the layout.
       centerMain.children.unshift(chartsContainer);
       
       if (remainingRatio >= 1) this.normalizeRatios(centerMain);
    } else {
       // Fallback to inserting at root level
       // Push adds it to the right/bottom instead of the left/top
       if (layout.root.type === 'split' && layout.root.direction === 'horizontal') {
           layout.root.children.push(chartsContainer);
       } else {
           layout.root.children.push(chartsContainer);
       }
       this.normalizeRatios(layout.root);
    }
    
    this.commitWindowArrangement(layout);
  }

  /** Arrange existing charts without creating, closing, or resetting panels. */
  arrangeCharts(mode: ChartArrangement): void {
    if (mode !== 'cascade') {
      this.tileWindows(mode);
      return;
    }

    const layout = this.getLayout();
    const charts: DockPanelConfig[] = [];
    let placeholderAdded = false;
    const extractCharts = (container: DockContainer, isDocked: boolean) => {
      container.children = container.children.flatMap<DockContainer | DockPanelConfig>(child => {
        if ('children' in child) {
          extractCharts(child, isDocked);
          return [child];
        }
        if (child.component !== 'Chart') return [child];
        charts.push(child);
        if (!isDocked || placeholderAdded) return [];
        placeholderAdded = true;
        // Keep the chart region's geometry while the charts float above it.
        // In particular, Toolbox must keep its existing height below the region.
        return [{
          id: 'cascade-chart-placeholder', title: '', component: 'EmptyChartArea',
          ratio: child.ratio ?? 1, closable: false, floatable: false,
        } as DockPanelConfig];
      });
      if (container.type === 'tabs' && !container.children.some(child => child.id === container.activeTab)) {
        container.activeTab = container.children[0]?.id;
      }
    };
    extractCharts(layout.root, true);
    layout.floatingPanels.forEach(container => extractCharts(container, false));
    if (charts.length === 0) return;
    charts.forEach(chart => { delete chart.minimized; });
    this.cleanupEmptyContainers(layout.root);
    layout.floatingPanels.forEach(container => this.cleanupEmptyContainers(container));
    layout.floatingPanels = layout.floatingPanels.filter(container => container.children.length > 0);

    const { left, top, width: availableWidth, height: availableHeight } = getChartWorkspaceBounds();
    const width = Math.min(availableWidth, Math.max(240, Math.round(availableWidth * 0.78)));
    const height = Math.min(availableHeight, Math.max(180, Math.round(availableHeight * 0.75)));
    const staggerCount = Math.min(charts.length, MAX_CHART_PANELS);
    const step = staggerCount <= 1 ? 0
      : Math.min(28, (availableWidth - width) / (staggerCount - 1), (availableHeight - height) / (staggerCount - 1));

    charts.forEach((chart, index) => layout.floatingPanels.push({
      id: `cascade-${chart.id}`, type: 'panel', ratio: 1, isFloating: true,
      children: [{ ...chart, ratio: 1 }],
      position: { x: Math.round(left + step * (index % staggerCount)), y: Math.round(top + step * (index % staggerCount)) },
      size: { width, height },
    }));
    this.commitWindowArrangement(layout);
  }

  /**
   * Dock panel to specific target (can be a container ID or a panel ID)
   */
  dockPanel(
    panelId: string,
    targetId: string,
    direction: DockDirection
  ): void {
    const layout = this.getLayout();

    // Find and remove panel from current location
    const panel = this.removePanelFromLayout(layout, panelId);
    if (!panel) return;

    // Try to find target as a container first
    let target = this.findContainer(layout.root, targetId);
    if (target) {
      this.dockToTarget(layout, panel, target, direction);
    } else {
      // Target might be a panel ID — find its parent container
      const result = this.findPanelAndParent(layout.root, targetId);
      if (result) {
        const { parent, panelIndex } = result;
        this.dockPanelNextTo(parent, panelIndex, panel, direction);
      } else {
        // Last resort: dock to root
        this.addToContainer(layout.root, panel, direction);
      }
    }

    // Clean up any empty containers
    this.cleanupEmptyContainers(layout.root);
    this.setLayout(layout);
  }

  /**
   * Snap a panel to the workspace edge (root-level docking)
   */
  snapToWorkspaceEdge(panelId: string, direction: DockDirection): void {
    const layout = this.getLayout();
    const panel = this.removePanelFromLayout(layout, panelId);
    if (!panel) return;

    this.addToContainer(layout.root, panel, direction);
    this.cleanupEmptyContainers(layout.root);
    this.setLayout(layout);
  }

  /**
   * Remove panel from layout
   */
  removePanel(panelId: string): boolean {
    const layout = this.getLayout();
    
    const removed = this.removePanelFromLayout(layout, panelId);
    if (removed) {
      this.cleanupEmptyContainers(layout.root, new Set(['center-main']));

      // Guard: if center-main lost all its charts, protect layout structure
      // by inserting a lightweight empty-chart placeholder to keep Toolbox position fixed.
      const centerMain = this.findContainer(layout.root, 'center-main');
      if (centerMain && centerMain.type === 'split' && centerMain.direction === 'vertical') {
        const containsChartArea = (container: DockContainer): boolean => container.children.some(child => (
          'children' in child ? containsChartArea(child)
            : child.component === 'Chart' || child.component === 'EmptyChartArea'
        ));
        const hasChart = containsChartArea(centerMain);
        const hasToolbox = centerMain.children.some(child => !('children' in child) && child.component === 'Terminal');

        // Always insert spacer when no charts/placeholders exist and toolbox is present
        // This keeps the Toolbox locked at its bottom position
        if (!hasChart && hasToolbox) {
          const placeholder: DockPanelConfig = {
            id: `charts-area-${Date.now()}`,
            title: '',
            component: 'EmptyChartArea',
            ratio: Math.max(0.05, 1 - centerMain.children.reduce((sum, child) => sum + (child.ratio ?? 0), 0)),
            closable: false,
            floatable: false,
          };
          centerMain.children.unshift(placeholder);
        }
      }

      this.setLayout(layout);
      return true;
    }
    return false;
  }


  /**
   * Float a docked panel
   */
  floatPanel(panelId: string, position?: { x: number; y: number }): void {
    const layout = this.getLayout();
    const panel = this.removePanelFromLayout(layout, panelId);
    if (!panel) return;

    // Clamp position to viewport
    const viewportWidth = typeof window !== 'undefined' ? window.innerWidth : 1200;
    const viewportHeight = typeof window !== 'undefined' ? window.innerHeight : 800;
    const panelWidth = 400;
    const panelHeight = 300;

    let posX = position?.x ?? 100;
    let posY = position?.y ?? 100;

    // Ensure panel stays within viewport
    posX = Math.max(50, Math.min(posX, viewportWidth - panelWidth + 100));
    posY = Math.max(50, Math.min(posY, viewportHeight - panelHeight + 100));

    const floatingContainer: DockContainer = {
      id: `floating-${Date.now()}`,
      type: 'panel',
      ratio: 1,
      children: [panel],
      isFloating: true,
      position: { x: posX, y: posY },
      size: { width: panelWidth, height: panelHeight },
    };

    layout.floatingPanels.push(floatingContainer);
    this.cleanupEmptyContainers(layout.root);
    this.setLayout(layout);
  }

  /**
   * Update floating panel position
   */
  updateFloatingPosition(panelId: string, position: { x: number; y: number }): void {
    const layout = this.getLayout();
    const floating = layout.floatingPanels.find((p) => p.id === panelId);
    if (floating) {
      // Clamp to viewport
      const viewportWidth = typeof window !== 'undefined' ? window.innerWidth : 1200;
      const viewportHeight = typeof window !== 'undefined' ? window.innerHeight : 800;
      const width = floating.size?.width || 400;
      const height = floating.size?.height || 300;

      floating.position = {
        x: Math.max(50, Math.min(position.x, viewportWidth - width + 100)),
        y: Math.max(50, Math.min(position.y, viewportHeight - height + 100)),
      };
      this.setLayout(layout, true);
    }
  }

  /**
   * Update floating panel size
   */
  updateFloatingSize(panelId: string, size: { width: number; height: number }): void {
    const layout = this.getLayout();
    const floating = layout.floatingPanels.find((p) => p.id === panelId);
    if (floating) {
      floating.size = {
        width: Math.max(200, size.width),
        height: Math.max(150, size.height),
      };
      this.setLayout(layout, true);
    }
  }

  /**
   * Update container size ratio
   */
  updateContainerSize(containerId: string, newRatio: number): void {
    const layout = this.getLayout();

    let item: DockContainer | DockPanelConfig | null = this.findContainer(layout.root, containerId);
    if (!item) {
      const result = this.findPanelAndParent(layout.root, containerId);
      if (result) item = result.panel;
    }

    if (item) {
      item.ratio = Math.max(0.05, Math.min(0.95, newRatio));
      const parent = this.findParent(layout.root, containerId);
      if (parent) {
        this.normalizeRatios(parent);
      }
      this.setLayout(layout, true);
    }
  }

  /**
   * Set active tab
   */
  setActiveTab(tabContainerId: string, panelId: string): void {
    const layout = this.getLayout();
    const container = this.findContainer(layout.root, tabContainerId);
    if (container && container.type === 'tabs') {
      container.activeTab = panelId;
      this.setLayout(layout, true);
    }
  }

  /**
   * Add a new panel to the layout
   */
  addPanel(panel: DockPanelConfig, targetId?: string, direction: DockDirection = 'center'): boolean {
    if (panel.component === 'Chart' && !this.canAddChart()) return false;
    const layout = this.getLayout();

    // First try to find targetId as a container  
    let target = targetId ? this.findContainer(layout.root, targetId) : layout.root;

    // If not found as a container, targetId might be a panel ID — find its parent container
    if (!target && targetId) {
      const result = this.findPanelAndParent(layout.root, targetId);
      if (result) {
        if (direction === 'tab' || direction === 'center') {
          this.dockPanelNextTo(result.parent, result.panelIndex, panel, direction);
          this.cleanupEmptyContainers(layout.root);
          this.setLayout(layout);
          return true;
        }
        target = result.parent;
      }
    }

    // Final fallback to root
    if (!target) target = layout.root;

    this.dockToTarget(layout, panel, target, direction);

    // If we're adding a real Chart, strip out the empty placeholder
    if (panel.component === 'Chart') {
      const removePlaceholders = (container: DockContainer) => {
        for (let i = container.children.length - 1; i >= 0; i--) {
          const child = container.children[i];
          if ('children' in child) removePlaceholders(child as DockContainer);
          else if ((child as DockPanelConfig).component === 'EmptyChartArea') {
            container.children.splice(i, 1);
          }
        }
      };
      removePlaceholders(layout.root);
    }

    this.cleanupEmptyContainers(layout.root);
    this.setLayout(layout);
    return true;
  }


  /**
   * Dock a floating panel back to the layout
   */
  dockFloatingPanel(panelId: string, targetId: string, direction: DockDirection = 'center'): void {
    const layout = this.getLayout();

    // Find floating panel
    const floatingIndex = layout.floatingPanels.findIndex((p) =>
      p.children.some((c: any) => c.id === panelId)
    );

    if (floatingIndex === -1) return;

    const floating = layout.floatingPanels[floatingIndex];
    const panel = floating.children.find((c: any) => c.id === panelId) as DockPanelConfig;
    if (!panel) return;

    // Remove from floating
    floating.children = floating.children.filter((c: any) => c.id !== panelId);
    if (floating.children.length === 0) {
      layout.floatingPanels.splice(floatingIndex, 1);
    }

    // Find target and dock
    const target = this.findContainer(layout.root, targetId);
    if (target) {
      this.dockToTarget(layout, panel, target, direction);
    }

    this.cleanupEmptyContainers(layout.root);
    this.setLayout(layout);
  }

  /**
   * Undo one explicit arrangement; metadata and resize updates do not add steps.
   */
  undo(): boolean {
    const previous = this.windowUndoLayouts.pop();
    if (!previous) return false;
    this.windowRedoLayouts.push(this.getLayout());
    this.restoreWindowArrangement(previous);
    return true;
  }

  /**
   * Redo the last undone window arrangement.
   */
  redo(): boolean {
    const next = this.windowRedoLayouts.pop();
    if (!next) return false;
    this.windowUndoLayouts.push(this.getLayout());
    this.restoreWindowArrangement(next);
    return true;
  }

  /**
   * Move panel to tab container
   */
  moveToTab(panelId: string, tabContainerId: string, insertIndex?: number): void {
    const layout = this.getLayout();
    const panel = this.removePanelFromLayout(layout, panelId);
    if (!panel) return;

    const tabContainer = this.findContainer(layout.root, tabContainerId);
    if (tabContainer && tabContainer.type === 'tabs') {
      if (insertIndex !== undefined && insertIndex >= 0) {
        tabContainer.children.splice(insertIndex, 0, panel);
      } else {
        tabContainer.children.push(panel);
      }
      tabContainer.activeTab = panelId;
    }

    this.cleanupEmptyContainers(layout.root);
    this.setLayout(layout);
  }


  /**
   * Check whether a window arrangement can be undone.
   */
  canUndo(): boolean {
    return this.windowUndoLayouts.length > 0;
  }

  /**
   * Check whether a window arrangement can be redone.
   */
  canRedo(): boolean {
    return this.windowRedoLayouts.length > 0;
  }

  /**
   * Find drop zone at a specific point (stub for compatibility)
   */
  findDropZoneAtPoint(
    x: number,
    y: number,
    containerRects: Map<string, { x: number; y: number; width: number; height: number }>
  ): DropZone | null {
    // Simple implementation - find which container contains the point
    for (const [containerId, rect] of containerRects.entries()) {
      if (
        x >= rect.x &&
        x <= rect.x + rect.width &&
        y >= rect.y &&
        y <= rect.y + rect.height
      ) {
        // Determine direction based on position within container
        const centerX = rect.x + rect.width / 2;
        const centerY = rect.y + rect.height / 2;

        let direction: DockDirection = 'center';
        if (Math.abs(x - centerX) > Math.abs(y - centerY)) {
          direction = x < centerX ? 'left' : 'right';
        } else {
          direction = y < centerY ? 'top' : 'bottom';
        }

        return {
          id: `${containerId}-${direction}`,
          direction,
          rect,
          targetContainerId: containerId,
          priority: 1,
        };
      }
    }
    return null;
  }

  /**
   * Update a panel's props and title in-place
   */
  updatePanelProps(panelId: string, updates: Partial<Pick<DockPanelConfig, 'props' | 'title' | 'chartSymbolTabs'>>): boolean {
    const layout = this.layout;
    const updated = this.updatePanelInContainer(layout.root, panelId, updates);
    if (updated) {
      this.notify();
      return true;
    }
    // Check floating panels
    for (const floating of layout.floatingPanels) {
      if (this.updatePanelInContainer(floating, panelId, updates)) {
        this.notify();
        return true;
      }
    }
    return false;
  }

  private updatePanelInContainer(container: DockContainer, panelId: string, updates: Partial<Pick<DockPanelConfig, 'props' | 'title' | 'chartSymbolTabs'>>): boolean {
    for (let i = 0; i < container.children.length; i++) {
      const child = container.children[i];
      if ('children' in child) {
        if (this.updatePanelInContainer(child as DockContainer, panelId, updates)) return true;
      } else {
        const panel = child as DockPanelConfig;
        if (panel.id === panelId) {
          if (updates.props) panel.props = { ...panel.props, ...updates.props };
          if (updates.title !== undefined) panel.title = updates.title;
          else if (panel.component === 'Chart' && (updates.props?.symbol || updates.props?.timeframe)) {
            panel.title = `${panel.props?.symbol || 'Chart'},${panel.props?.timeframe || DEFAULT_CHART_TIMEFRAME}`;
          }
          if (updates.chartSymbolTabs !== undefined) panel.chartSymbolTabs = updates.chartSymbolTabs;
          return true;
        }
      }
    }
    return false;
  }

  /**
   * Save layout to localStorage
   */
  saveToStorage(key: string = 'dock-layout'): void {
    try {
      localStorage.setItem(key, JSON.stringify(this.layout));
    } catch (e) {
      console.warn('[DockManager] Failed to save layout:', e);
    }
  }

  loadFromStorage(key: string = 'dock-layout'): boolean {
    // History belongs to the active workspace, including accounts without a saved layout.
    this.clearWindowHistory();
    this.overflowCharts = [];
    try {
      const stored = localStorage.getItem(key);
      if (stored) {
        const parsed = JSON.parse(stored);
        const defaultLayout = this.createDefaultLayout();

        // Check if layout version matches current defaults, if not discard it
        if (!parsed.version || parsed.version !== defaultLayout.version) {
          console.log(`[DockManager] Outdated layout version ${parsed.version}, resetting to ${defaultLayout.version}`);
          return false;
        }

        this.layout = parsed;

        // Auto-sanitize corrupt symbols that might have infected chart tabs
        const isValidSymbol = (s: any) => typeof s === 'string' && s.length > 0 && s.length <= 20 && /^[A-Za-z0-9._-]+$/.test(s);
        const sanitizeContainer = (container: any) => {
          if (!container || !container.children) return;
          for (let i = container.children.length - 1; i >= 0; i--) {
            const child = container.children[i];
            if (child.children) {
              sanitizeContainer(child);
            } else if (child.component === 'Chart') {
              const sym = child.props?.symbol;
              if (!isValidSymbol(sym)) {
                console.warn(`[DockManager] Auto-purged corrupt chart tab: ${sym}`);
                container.children.splice(i, 1);
              }
            }
          }
        };

        sanitizeContainer(this.layout.root);
        if (this.layout.floatingPanels) {
          this.layout.floatingPanels.forEach(sanitizeContainer);
        }

        const isDesktopShell = typeof window !== 'undefined' && Boolean(window.electron?.window);
        const desktopMigrationKey = `${DOCK_LAYOUT_DESKTOP_WEB_PARITY_MIGRATION_PREFIX}${key}`;
        if (isDesktopShell && localStorage.getItem(desktopMigrationKey) !== '1') {
          const root = this.layout.root as any;
          const previousDesktopMigrationKey = `${DOCK_LAYOUT_PREVIOUS_DESKTOP_DEFAULT_MIGRATION_PREFIX}${key}`;
          const previousDefaultParts = localStorage.getItem(previousDesktopMigrationKey) === '1'
            ? getPreviousDesktopDefaultParts(root)
            : null;

          // Migrate only the exact v2 Electron default. Custom user layouts are
          // left untouched, while existing panels/props/floating state are
          // reused so the change is purely structural.
          if (previousDefaultParts) {
            const { leftSidebar, chartArea, toolbox } = previousDefaultParts;
            leftSidebar.ratio = DESKTOP_WEB_PARITY_RATIOS.sidebar;
            chartArea.ratio = DESKTOP_WEB_PARITY_RATIOS.chart;
            toolbox.ratio = 1 - DESKTOP_WEB_PARITY_RATIOS.chart;
            root.direction = 'horizontal';
            root.children = [
              leftSidebar,
              {
                id: 'center-main',
                type: 'split',
                direction: 'vertical',
                ratio: 1 - DESKTOP_WEB_PARITY_RATIOS.sidebar,
                children: [chartArea, toolbox],
              },
            ];

            localStorage.setItem(key, JSON.stringify(this.layout));
          }

          localStorage.setItem(desktopMigrationKey, '1');
        }

        if (this.getChartCount() > MAX_CHART_PANELS) {
          // Keep the complete old workspace recoverable, including its geometry.
          // The store also makes overflow chart configurations available in Open Deleted.
          const backupKey = `${DOCK_LAYOUT_SIX_CHART_BACKUP_PREFIX}${key}`;
          let backedUp = false;
          try {
            if (!localStorage.getItem(backupKey)) localStorage.setItem(backupKey, stored);
            backedUp = true;
          } catch (error) {
            console.warn('[DockManager] Could not back up the previous chart layout:', error);
          }
          this.layout = this.applyChartLimit(this.layout);
          if (backedUp) this.saveToStorage(key);
        }

        this.notify();
        return true;
      }
    } catch (e) {
      console.warn('[DockManager] Failed to load layout:', e);
    }
    return false;
  }

  // Private helper methods

  private removePanelFromLayout(layout: DockLayout, panelId: string): DockPanelConfig | null {
    // Search in root
    const fromRoot = this.removeFromContainer(layout.root, panelId);
    if (fromRoot) return fromRoot;

    // Search in floating panels
    for (const floating of layout.floatingPanels) {
      const panel = floating.children.find((c: any) => c.id === panelId) as DockPanelConfig;
      if (panel) {
        floating.children = floating.children.filter((c: any) => c.id !== panelId);
        // Remove empty floating containers
        if (floating.children.length === 0) {
          const idx = layout.floatingPanels.indexOf(floating);
          if (idx > -1) layout.floatingPanels.splice(idx, 1);
        }
        return panel;
      }
    }

    return null;
  }

  private removeFromContainer(container: DockContainer, panelId: string): DockPanelConfig | null {
    for (let i = 0; i < container.children.length; i++) {
      const child = container.children[i];

      if ('children' in child) {
        const found = this.removeFromContainer(child as DockContainer, panelId);
        if (found) return found;
      } else if ((child as DockPanelConfig).id === panelId) {
        const panel = child as DockPanelConfig;
        container.children.splice(i, 1);

        // If this is a tabs container and we just removed the active tab,
        // we need to set a new active tab, or un-tabify if only 1 child remains.
        if (container.type === 'tabs') {
          if (container.activeTab === panelId && container.children.length > 0) {
            // Select the previous tab, or the new first tab if we removed the first one
            const nextIndex = Math.max(0, i - 1);
            container.activeTab = (container.children[nextIndex] as DockPanelConfig).id;
          }
          // If only 1 child is left, it doesn't need to be a 'tabs' container anymore
          if (container.children.length === 1) {
            // We can optionally change it to a 'panel' or 'split' type. Leaving it as tabs
            // is also okay, DockContainer.tsx handles single tabs gracefully.
          }
        }

        return panel;
      }
    }
    return null;
  }

  private findContainer(container: DockContainer, id: string): DockContainer | null {
    if (container.id === id) return container;

    for (const child of container.children) {
      if ('children' in child) {
        const found = this.findContainer(child as DockContainer, id);
        if (found) return found;
      }
    }
    return null;
  }

  private findParent(container: DockContainer, childId: string): DockContainer | null {
    for (const child of container.children) {
      if ('children' in child) {
        if ((child as DockContainer).id === childId) {
          return container;
        }
        const found = this.findParent(child as DockContainer, childId);
        if (found) return found;
      } else if ((child as DockPanelConfig).id === childId) {
        return container;
      }
    }
    return null;
  }

  /**
   * Find a panel config and its parent container by panel ID
   */
  private findPanelAndParent(
    container: DockContainer,
    panelId: string
  ): { parent: DockContainer; panelIndex: number; panel: DockPanelConfig } | null {
    for (let i = 0; i < container.children.length; i++) {
      const child = container.children[i];
      if ('children' in child) {
        const found = this.findPanelAndParent(child as DockContainer, panelId);
        if (found) return found;
      } else if ((child as DockPanelConfig).id === panelId) {
        return { parent: container, panelIndex: i, panel: child as DockPanelConfig };
      }
    }
    return null;
  }

  /**
   * Dock a new panel next to an existing panel in a container
   */
  private dockPanelNextTo(
    parent: DockContainer,
    targetIndex: number,
    newPanel: DockPanelConfig,
    direction: DockDirection
  ): void {
    if (direction === 'center' || direction === 'tab') {
      // Convert to tabs at this position
      const existingPanel = parent.children[targetIndex] as DockPanelConfig;
      const tabContainer: DockContainer = {
        id: `tabs-${Date.now()}`,
        type: 'tabs',
        ratio: existingPanel.ratio || DEFAULT_RATIO,
        children: [existingPanel, newPanel],
        activeTab: newPanel.id,
      };
      parent.children[targetIndex] = tabContainer;
      return;
    }

    const isHorizontal = direction === 'left' || direction === 'right';
    const splitDir: 'horizontal' | 'vertical' = isHorizontal ? 'horizontal' : 'vertical';

    if (parent.type === 'split' && parent.direction === splitDir) {
      // Same direction as parent — just insert as a sibling
      const insertIndex = (direction === 'left' || direction === 'top') ? targetIndex : targetIndex + 1;
      const existingPanel = parent.children[targetIndex] as any;
      const existingRatio = existingPanel.ratio || (1 / parent.children.length);
      // Split the existing panel's ratio
      const halfRatio = existingRatio / 2;
      existingPanel.ratio = halfRatio;
      parent.children.splice(insertIndex, 0, { ...newPanel, ratio: halfRatio });
    } else {
      // Different direction — wrap the target in a new split
      const existingChild = parent.children[targetIndex];
      const existingRatio = (existingChild as any).ratio || DEFAULT_RATIO;

      const newSplit: DockContainer = {
        id: `split-${Date.now()}`,
        type: 'split',
        direction: splitDir,
        ratio: existingRatio,
        children: [],
      };

      if (direction === 'left' || direction === 'top') {
        newSplit.children = [
          { ...newPanel, ratio: 0.5 },
          { ...existingChild, ratio: 0.5 },
        ];
      } else {
        newSplit.children = [
          { ...existingChild, ratio: 0.5 },
          { ...newPanel, ratio: 0.5 },
        ];
      }

      parent.children[targetIndex] = newSplit;
    }
  }

  private cleanupEmptyContainers(container: DockContainer, preserveEmptyIds: ReadonlySet<string> = new Set()): void {
    for (let i = container.children.length - 1; i >= 0; i--) {
      const child = container.children[i];

      if ('children' in child) {
        const childContainer = child as DockContainer;
        this.cleanupEmptyContainers(childContainer, preserveEmptyIds);

        if (childContainer.children.length === 0 && !preserveEmptyIds.has(childContainer.id)) {
          container.children.splice(i, 1);
        } else if (
          childContainer.children.length === 1 && 
          childContainer.type === 'split' &&
          !['center-main', 'left-sidebar', 'right-sidebar'].includes(childContainer.id)
        ) {
          // Unwrap single-child splits (except structural layout columns)
          const onlyChild = childContainer.children[0];
          onlyChild.ratio = childContainer.ratio;
          container.children[i] = onlyChild;
        }
      }
    }
  }

  private normalizeRatios(container: DockContainer): void {
    if (container.children.length === 0) return;

    const totalRatio = container.children.reduce((sum, c: any) => sum + (c.ratio || DEFAULT_RATIO), 0);
    const factor = 1 / totalRatio;

    container.children.forEach((child: any) => {
      child.ratio = (child.ratio || DEFAULT_RATIO) * factor;
    });
  }

  private dockToTarget(
    layout: DockLayout,
    panel: DockPanelConfig,
    target: DockContainer,
    direction: DockDirection
  ): void {
    if (direction === 'center' || direction === 'tab') {
      // Convert target to tabs or add to existing tabs
      if (target.type === 'tabs') {
        target.children.push(panel);
        target.activeTab = panel.id;
      } else if (target.type === 'panel') {
        // 'panel' typed containers in our layout have children that are DockPanelConfigs
        const existingChildren = [...target.children];
        target.type = 'tabs';
        target.children = [...existingChildren, panel];
        target.activeTab = panel.id;
      } else if (target.type === 'split' || target.type === 'root') {
        // For a split container, find the first panel child and group them as tabs
        const firstPanelIndex = target.children.findIndex(c => !('children' in c));
        if (firstPanelIndex >= 0) {
          const existingPanel = target.children[firstPanelIndex] as DockPanelConfig;
          const tabContainer: DockContainer = {
            id: `tabs-${Date.now()}`,
            type: 'tabs',
            ratio: existingPanel.ratio || DEFAULT_RATIO,
            children: [existingPanel, panel],
            activeTab: panel.id,
          };
          target.children[firstPanelIndex] = tabContainer;
        } else {
          // No leaf panel found, just add to the split as a new child
          target.children.push({ ...panel, ratio: DEFAULT_RATIO });
          this.normalizeRatios(target);
        }
      }
    } else {
      // Split container
      const parent = this.findParent(layout.root, target.id);
      if (parent) {
        this.splitAtChild(parent, target, panel, direction);
      } else {
        this.addToContainer(layout.root, panel, direction);
      }
    }
  }

  private addToContainer(container: DockContainer, panel: DockPanelConfig, direction: DockDirection): void {
    const isHorizontal = direction === 'left' || direction === 'right';
    const newDirection: 'horizontal' | 'vertical' = isHorizontal ? 'horizontal' : 'vertical';

    if (container.type === 'split' && container.direction === newDirection) {
      const insertIndex = direction === 'left' || direction === 'top' ? 0 : container.children.length;
      container.children.splice(insertIndex, 0, { ...panel, ratio: DEFAULT_RATIO });
      this.normalizeRatios(container);
    } else {
      // Create new split
      const existingChildren = [...container.children];
      const existingRatio = 1 - DEFAULT_RATIO;

      const newSplit: DockContainer = {
        id: `split-${Date.now()}`,
        type: 'split',
        direction: newDirection,
        ratio: container.ratio || 1,
        children: [],
      };

      if (direction === 'left' || direction === 'top') {
        newSplit.children = [
          { ...panel, ratio: DEFAULT_RATIO },
          { ...container, ratio: existingRatio, children: existingChildren },
        ];
      } else {
        newSplit.children = [
          { ...container, ratio: existingRatio, children: existingChildren },
          { ...panel, ratio: DEFAULT_RATIO },
        ];
      }

      Object.assign(container, newSplit);
    }
  }

  private splitAtChild(
    parent: DockContainer,
    target: DockContainer,
    newPanel: DockPanelConfig,
    direction: DockDirection
  ): void {
    const isHorizontal = direction === 'left' || direction === 'right';
    const newDirection: 'horizontal' | 'vertical' = isHorizontal ? 'horizontal' : 'vertical';
    const childIndex = parent.children.findIndex((c: any) => c.id === target.id);

    if (childIndex === -1) return;

    if (parent.direction === newDirection) {
      // Same direction, insert sibling
      const insertIndex = direction === 'left' || direction === 'top' ? childIndex : childIndex + 1;
      parent.children.splice(insertIndex, 0, { ...newPanel, ratio: DEFAULT_RATIO });
      this.normalizeRatios(parent);
    } else {
      // Different direction, wrap target in new split
      const targetChild = parent.children[childIndex];
      const targetRatio = (targetChild as any).ratio || DEFAULT_RATIO;
      const remainingRatio = 1 - DEFAULT_RATIO;

      const newSplit: DockContainer = {
        id: `split-${Date.now()}`,
        type: 'split',
        direction: newDirection,
        ratio: targetRatio,
        children: [],
      };

      if (direction === 'left' || direction === 'top') {
        newSplit.children = [
          { ...newPanel, ratio: DEFAULT_RATIO },
          { ...targetChild, ratio: remainingRatio },
        ];
      } else {
        newSplit.children = [
          { ...targetChild, ratio: remainingRatio },
          { ...newPanel, ratio: DEFAULT_RATIO },
        ];
      }

      parent.children[childIndex] = newSplit;
    }
  }
}

// Export singleton instance
export const dockManager = new DockManager();
export default dockManager;
