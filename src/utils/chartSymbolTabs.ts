import type { DockLayout, DockPanelConfig } from '../services/dockManager';
import { normalizeExactBrokerSymbol } from './exactBrokerSymbol';

export interface ChartSymbolTab {
  symbol: string;
  timeframe: string;
  chartType?: string;
}

/** Hidden dock tabs are one window; tiled and floating chart panes are separate windows. */
export const hasArrangedChartWindows = (layout: DockLayout): boolean => {
  const count = (node: DockLayout['root'] | DockPanelConfig): number => {
    if (!('children' in node)) return node.component === 'Chart' ? 1 : 0;
    const children = node.type === 'tabs'
      ? node.children.filter(child => child.id === (node.activeTab || node.children[0]?.id))
      : node.children;
    return children.reduce((total, child) => total + count(child), 0);
  };
  return count(layout.root) + layout.floatingPanels.reduce((total, panel) => total + count(panel), 0) > 1;
};

/** The visible panel always supplies the latest timeframe and chart style. */
export const getChartSymbolTabs = (panel: DockPanelConfig): ChartSymbolTab[] => {
  const symbol = String(panel.props?.symbol || '').trim();
  if (!symbol) return [];
  const current: ChartSymbolTab = {
    symbol,
    timeframe: panel.props?.timeframe || 'M5',
    chartType: panel.props?.chartType,
  };
  const tabs = new Map<string, ChartSymbolTab>();
  for (const tab of panel.chartSymbolTabs ?? []) {
    if (tab.symbol && tab.timeframe) tabs.set(normalizeExactBrokerSymbol(tab.symbol), tab);
  }
  tabs.set(normalizeExactBrokerSymbol(symbol), current);
  return Array.from(tabs.values());
};
