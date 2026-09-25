// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { DockContainer, DockPanelConfig } from '../services/dockManager';

const collectCharts = (container: DockContainer): DockPanelConfig[] => container.children.flatMap(child => (
  'children' in child ? collectCharts(child) : child.component === 'Chart' ? [child] : []
));

afterEach(() => {
  localStorage.clear();
  delete window.electron;
  vi.resetModules();
});

describe.each(['web', 'desktop'])('%s startup chart', runtime => {
  it.each([null, 'M15', 'H4'])('starts on BTCUSD M1 with saved timeframe %s', async savedTimeframe => {
    vi.resetModules();
    if (runtime === 'desktop') {
      Object.defineProperty(window, 'electron', { configurable: true, value: { window: {} } });
    }
    if (savedTimeframe) {
      localStorage.setItem('rtx5_timeframe', savedTimeframe);
      const oldLayout = {
        version: '2.6', floatingPanels: [], root: {
          id: 'root', type: 'split', ratio: 1, children: [{
            id: 'old-chart', component: 'Chart', title: `EURUSD,${savedTimeframe}`,
            props: { symbol: 'EURUSD', timeframe: savedTimeframe },
          }],
        },
      };
      localStorage.setItem('dock-layout-account', JSON.stringify(oldLayout));
      localStorage.setItem('dock-layout-storage', JSON.stringify({ state: { layout: oldLayout }, version: 0 }));
    }

    const { initialToolbarState, toolbarReducer } = await import('../store/toolbarState');
    const { useDockLayoutStore } = await import('../store/useDockLayoutStore');
    const { DockManager } = await import('../services/dockManager');
    expect(initialToolbarState.timeframe).toBe('M1');
    expect(collectCharts(new DockManager().getLayout().root)).toEqual([
      expect.objectContaining({ title: 'BTCUSD,M1', props: { symbol: 'BTCUSD', timeframe: 'M1' } }),
    ]);

    // The same action used at launch also replaces a previous in-memory session.
    const store = useDockLayoutStore.getState();
    store.resetToDefaultLayout();
    expect(collectCharts(useDockLayoutStore.getState().layout.root)).toEqual([
      expect.objectContaining({ title: 'BTCUSD,M1', props: { symbol: 'BTCUSD', timeframe: 'M1' } }),
    ]);
    store.updatePanelProps('chart-default-container', {
      title: 'EURUSD,H1', props: { symbol: 'EURUSD', timeframe: 'H1' },
    });
    expect(collectCharts(useDockLayoutStore.getState().layout.root)[0].props).toMatchObject({ symbol: 'EURUSD', timeframe: 'H1' });
    expect(toolbarReducer(initialToolbarState, { type: 'SET_TIMEFRAME', timeframe: 'H1' }).timeframe).toBe('H1');
    store.resetToDefaultLayout();
    expect(collectCharts(useDockLayoutStore.getState().layout.root)[0].props).toEqual({ symbol: 'BTCUSD', timeframe: 'M1' });
  });
});
