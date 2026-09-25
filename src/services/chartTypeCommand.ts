import type { ChartType } from '../components/TradingChart.helpers';
import type { DockLayout, DockPanelConfig } from './dockManager';
import { getPanelIdFromChartContextId } from './chartCommandTarget';

const chartTypes: readonly ChartType[] = ['bar', 'candlestick', 'line', 'area'];
export const findChartPanel = (layout: DockLayout, id: string): DockPanelConfig | undefined => {
  const find = (node: DockLayout['root']): DockPanelConfig | undefined => {
    for (const child of node.children) {
      if ('children' in child) { const result = find(child); if (result) return result; }
      else if (child.id === id && child.component === 'Chart') return child;
    }
    return undefined;
  };
  return find(layout.root) ?? layout.floatingPanels.map(find).find(Boolean);
};

export const getDockPanelChartType = (layout: DockLayout, contextId: string | undefined, fallback: ChartType): ChartType => {
  const panelId = getPanelIdFromChartContextId(contextId);
  const type = panelId ? findChartPanel(layout, panelId)?.props?.chartType : undefined;
  return chartTypes.includes(type) ? type : fallback;
};
