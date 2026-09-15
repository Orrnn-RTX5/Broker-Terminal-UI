import { describe, expect, it } from 'vitest';
import type { DockLayout, DockPanelConfig } from '../services/dockManager';
import { hasArrangedChartWindows } from './chartSymbolTabs';

const chart = (id: string): DockPanelConfig => ({ id, component: 'Chart', title: 'EURUSD,M1' });
const layout = (children: DockLayout['root']['children']): DockLayout => ({ version: '1.0', floatingPanels: [], root: { id: 'root', type: 'root', ratio: 1, children } });

describe('chart symbol dropdown visibility', () => {
  it('hides the dropdown with one chart and any number of utility panels', () => {
    expect(hasArrangedChartWindows(layout([chart('chart-a'), { id: 'watch', component: 'MarketWatch', title: 'Market Watch' }]))).toBe(false);
  });
  it('treats hidden chart tabs as one visible window', () => {
    expect(hasArrangedChartWindows(layout([{ id: 'tabs', type: 'tabs', ratio: 1, activeTab: 'chart-b', children: [chart('chart-a'), chart('chart-b')] }]))).toBe(false);
  });
  it('shows the dropdown for two tiled or floating chart windows', () => {
    expect(hasArrangedChartWindows(layout([chart('chart-a'), chart('chart-b')]))).toBe(true);
    const floating = layout([chart('chart-a')]);
    floating.floatingPanels = [{ id: 'float', type: 'panel', ratio: 1, children: [chart('chart-b')] }];
    expect(hasArrangedChartWindows(floating)).toBe(true);
  });
});
