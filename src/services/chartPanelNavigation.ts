import { useDockLayoutStore } from '../store/useDockLayoutStore';
import type { DockLayout, DockPanelConfig } from './dockManager';
import { activateActiveChartSource, getActiveChartSource } from './activeChartSource';
import { getPanelIdFromChartContextId } from './chartCommandTarget';
import { normalizeExactBrokerSymbol } from '../utils/exactBrokerSymbol';
import { getChartSymbolTabs } from '../utils/chartSymbolTabs';
import { DEFAULT_CHART_TIMEFRAME } from '../constants/chartDefaults';

export const getChartPanels = (layout: DockLayout): DockPanelConfig[] => {
  const panels: DockPanelConfig[] = [];
  const visit = (container: DockLayout['root']) => container.children.forEach(child => {
    if ('children' in child) visit(child);
    else if (child.component === 'Chart') panels.push(child);
  });
  visit(layout.root); layout.floatingPanels.forEach(visit);
  return panels;
};

export const findChartPanelById = (layout: DockLayout, panelId: unknown): DockPanelConfig | undefined => (
  typeof panelId === 'string' ? getChartPanels(layout).find(panel => panel.id === panelId) : undefined
);

export const activateChartPanel = (panelId: string): boolean => {
  const store = useDockLayoutStore.getState();
  if (!findChartPanelById(store.layout, panelId)) return false;
  const activateTabs = (container: DockLayout['root']): boolean => {
    const child = container.children.find(candidate => candidate.id === panelId || ('children' in candidate && activateTabs(candidate)));
    if (!child) return false;
    if (container.type === 'tabs') store.setActiveTab(container.id, child.id);
    return true;
  };
  activateTabs(store.layout.root); store.layout.floatingPanels.forEach(activateTabs);
  store.setPanelMinimized(panelId, false);
  store.bringFloatingToFront(panelId);
  activateActiveChartSource(`trading-chart:${panelId}`);
  return true;
};

/** Remember each symbol's timeframe/style within its pane, leaving siblings intact. */
export const changeChartPanelSymbol = (
  panelId: string,
  requestedSymbol: unknown,
  authorizedSymbols: readonly string[],
  fallbackTimeframe: string = DEFAULT_CHART_TIMEFRAME,
): boolean => {
  const symbol = normalizeExactBrokerSymbol(requestedSymbol);
  if (!symbol || !authorizedSymbols.some(allowed => normalizeExactBrokerSymbol(allowed) === symbol)) return false;
  const store = useDockLayoutStore.getState();
  const panel = findChartPanelById(store.layout, panelId);
  if (!panel) return false;
  const allowed = new Set(authorizedSymbols.map(normalizeExactBrokerSymbol));
  const chartSymbolTabs = getChartSymbolTabs(panel).filter(tab => allowed.has(normalizeExactBrokerSymbol(tab.symbol)));
  const savedTab = chartSymbolTabs.find(tab => normalizeExactBrokerSymbol(tab.symbol) === symbol);
  const timeframe = savedTab?.timeframe || panel.props?.timeframe || fallbackTimeframe;
  const chartType = savedTab?.chartType || panel.props?.chartType;
  store.updatePanelProps(panelId, {
    props: { symbol, timeframe, ...(chartType ? { chartType } : {}) },
    title: `${symbol},${timeframe}`,
    chartSymbolTabs,
  });
  activateChartPanel(panelId);
  window.dispatchEvent(new CustomEvent('chartSymbolChanged', { detail: { symbol, timeframe } }));
  return true;
};

/** Close a symbol within its pane, selecting the next neighbor when needed. */
export const closeChartPanelSymbolTab = (panelId: string, requestedSymbol: unknown): boolean => {
  const symbol = normalizeExactBrokerSymbol(requestedSymbol);
  const store = useDockLayoutStore.getState();
  const panel = findChartPanelById(store.layout, panelId);
  if (!symbol || !panel) return false;
  const tabs = getChartSymbolTabs(panel);
  const index = tabs.findIndex(tab => normalizeExactBrokerSymbol(tab.symbol) === symbol);
  if (index < 0) return false;
  if (tabs.length === 1) return store.closeActiveChart(undefined, panelId);

  const chartSymbolTabs = tabs.filter((_, tabIndex) => tabIndex !== index);
  if (normalizeExactBrokerSymbol(panel.props?.symbol) !== symbol) {
    store.updatePanelProps(panelId, { chartSymbolTabs });
    return true;
  }

  const next = chartSymbolTabs[Math.min(index, chartSymbolTabs.length - 1)];
  const nextSymbol = normalizeExactBrokerSymbol(next.symbol);
  const chartType = next.chartType || panel.props?.chartType;
  store.updatePanelProps(panelId, {
    props: { symbol: nextSymbol, timeframe: next.timeframe, ...(chartType ? { chartType } : {}) },
    title: `${nextSymbol},${next.timeframe}`,
    chartSymbolTabs,
  });
  activateChartPanel(panelId);
  window.dispatchEvent(new CustomEvent('chartSymbolChanged', { detail: { symbol: nextSymbol, timeframe: next.timeframe } }));
  return true;
};

export const getActiveDockChartPanel = (): DockPanelConfig | undefined => {
  const panelId = getPanelIdFromChartContextId(getActiveChartSource()?.id);
  return findChartPanelById(useDockLayoutStore.getState().layout, panelId);
};

/** Pin Market Watch navigation to the clicked pane before focus moves to the list. */
export const requestActiveChartSymbolChange = (symbol: string): void => {
  const panel = getActiveDockChartPanel();
  window.dispatchEvent(new CustomEvent('openChart', {
    detail: { symbol, ...(panel ? { panelId: panel.id } : {}) },
  }));
};

/** Bind unbound/invalid saved panels after broker authorization, leaving valid choices intact. */
export const getChartPanelSymbolUpdates = (
  layout: DockLayout,
  resolveSymbol: (symbol: unknown) => string,
  fallbackSymbol: string,
  fallbackTimeframe: string,
  catalogCurrent = true,
): Array<Pick<DockPanelConfig, 'id' | 'chartSymbolTabs'> & { props: Record<string, unknown>; title: string }> => (
  getChartPanels(layout).flatMap(panel => {
    const requested = panel.props?.symbol ?? panel.title?.split(',')[0];
    if (!catalogCurrent) {
      // A partial catalog must never invalidate a saved symbol, but a
      // symbol-less placeholder (no tenant default chart symbol) has nothing to
      // lose: bind it to the symbol it already renders so its tab is labelled.
      const placeholder = !String(panel.props?.symbol ?? '').trim()
        && ['', 'CHART'].includes(normalizeExactBrokerSymbol(requested));
      if (!placeholder || !fallbackSymbol) return [];
      const timeframe = panel.props?.timeframe || fallbackTimeframe;
      return [{ id: panel.id, props: { ...panel.props, symbol: fallbackSymbol, timeframe }, title: `${fallbackSymbol},${timeframe}` }];
    }
    const resolved = resolveSymbol(requested);
    const chartSymbolTabs = panel.chartSymbolTabs?.filter(tab => resolveSymbol(tab.symbol));
    const tabsChanged = chartSymbolTabs?.length !== panel.chartSymbolTabs?.length;
    if (panel.props?.symbol && resolved && resolved === normalizeExactBrokerSymbol(requested) && !tabsChanged) return [];
    const symbol = resolved && normalizeExactBrokerSymbol(requested) !== 'CHART' ? resolved : fallbackSymbol;
    if (!symbol) return [];
    const timeframe = panel.props?.timeframe || fallbackTimeframe;
    return [{ id: panel.id, props: { ...panel.props, symbol, timeframe }, title: `${symbol},${timeframe}`,
      ...(chartSymbolTabs ? { chartSymbolTabs } : {}),
    }];
  })
);
