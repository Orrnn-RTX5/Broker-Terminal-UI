import { useDockLayoutStore } from '../store/useDockLayoutStore';
import type { DockLayout, DockPanelConfig } from './dockManager';
import { activateActiveChartSource, getActiveChartSource } from './activeChartSource';
import { getPanelIdFromChartContextId } from './chartCommandTarget';
import { normalizeExactBrokerSymbol } from '../utils/exactBrokerSymbol';

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

/** Replace one panel's opaque broker symbol, retaining its timeframe/type and siblings. */
export const changeChartPanelSymbol = (
  panelId: string,
  requestedSymbol: unknown,
  authorizedSymbols: readonly string[],
  fallbackTimeframe = 'M5',
): boolean => {
  const symbol = normalizeExactBrokerSymbol(requestedSymbol);
  if (!symbol || !authorizedSymbols.some(allowed => normalizeExactBrokerSymbol(allowed) === symbol)) return false;
  const store = useDockLayoutStore.getState();
  const panel = findChartPanelById(store.layout, panelId);
  if (!panel) return false;
  const timeframe = panel.props?.timeframe || fallbackTimeframe;
  store.updatePanelProps(panelId, { props: { symbol, timeframe }, title: `${symbol},${timeframe}` });
  activateChartPanel(panelId);
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
): Array<{ id: string; props: Record<string, unknown>; title: string }> => !catalogCurrent ? [] : (
  getChartPanels(layout).flatMap(panel => {
    const requested = panel.props?.symbol ?? panel.title?.split(',')[0];
    const resolved = resolveSymbol(requested);
    if (panel.props?.symbol && resolved && resolved === normalizeExactBrokerSymbol(requested)) return [];
    const symbol = resolved && normalizeExactBrokerSymbol(requested) !== 'CHART' ? resolved : fallbackSymbol;
    if (!symbol) return [];
    const timeframe = panel.props?.timeframe || fallbackTimeframe;
    return [{ id: panel.id, props: { ...panel.props, symbol, timeframe }, title: `${symbol},${timeframe}` }];
  })
);
