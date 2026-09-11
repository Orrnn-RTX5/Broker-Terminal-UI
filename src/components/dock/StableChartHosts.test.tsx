// @vitest-environment jsdom
import React, { useEffect, useRef, useState } from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DockContainer, FloatingPanelsLayer } from './DockContainer';
import { StableChartHosts } from './StableChartHosts';
import { useDockLayoutStore } from '../../store/useDockLayoutStore';
import { DockManager, MAX_CHART_PANELS, type DockContainer as Container, type DockPanelConfig } from '../../services/dockManager';
import { clearActiveChartSources, getActiveChartSource, registerActiveChartSource } from '../../services/activeChartSource';
import { runTerminalShortcutAction } from '../../services/shortcutCatalog';

const originalLayout = useDockLayoutStore.getState().layout;
const originalClosed = useDockLayoutStore.getState().recentlyClosedCharts;
const mounted = vi.fn();
const unmounted = vi.fn();
function Chart({ panel, active }: { panel: DockPanelConfig; active: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  const latest = useRef(panel); latest.current = panel;
  const [count, setCount] = useState(0);
  useEffect(() => {
    mounted(panel.id);
    const unregister = registerActiveChartSource({ id: `trading-chart:${panel.id}`, getContainer: () => ref.current,
      getSymbol: () => latest.current.props?.symbol, getTimeframe: () => latest.current.props?.timeframe });
    return () => { unregister(); unmounted(panel.id); };
  }, [panel.id]);
  return <div ref={ref} data-testid={`chart-${panel.id}`} data-active={active}>
    <input aria-label={`draft-${panel.id}`} defaultValue="Drawing draft" />
    <button onClick={() => setCount(value => value + 1)}>{panel.id}: {count}</button>
  </div>;
}
const renderPanel = (panel: DockPanelConfig, active: boolean) => panel.component === 'Chart'
  ? <Chart panel={panel} active={active} /> : <div>{panel.component}</div>;
const tabsLayout = () => {
  const layout = new DockManager().getLayout();
  const center = layout.root.children[1] as Container;
  center.children[0] = { id: 'charts', type: 'tabs', activeTab: 'a', ratio: 0.75, children: [
    { id: 'a', title: 'XAUUSD.raw,M1', component: 'Chart', props: { symbol: 'XAUUSD.raw', timeframe: 'M1' } },
    { id: 'b', title: 'EURUSD.r,H4', component: 'Chart', props: { symbol: 'EURUSD.r', timeframe: 'H4' } },
  ] };
  return layout;
};
const mountShared = () => render(<StableChartHosts renderPanel={renderPanel}>
  <DockContainer isRoot renderPanel={renderPanel} /><FloatingPanelsLayer renderPanel={renderPanel} />
</StableChartHosts>);
beforeEach(() => {
  mounted.mockClear(); unmounted.mockClear(); clearActiveChartSources();
  useDockLayoutStore.getState().setLayout(tabsLayout());
  useDockLayoutStore.setState({ recentlyClosedCharts: [] });
});
afterEach(() => {
  cleanup(); clearActiveChartSources(); useDockLayoutStore.getState().setLayout(originalLayout);
  useDockLayoutStore.setState({ recentlyClosedCharts: originalClosed });
});

describe('stable chart hosts through layout topology changes', () => {
  it('resets six panes to the exact active chart without remounting it or losing its draft', () => {
    const store = useDockLayoutStore.getState();
    store.updatePanelProps('b', { title: 'XAUUSD.raw,H4', props: { symbol: 'XAUUSD.raw', timeframe: 'H4' } });
    while (store.canAddChart()) store.addChartPanel({ symbol: 'BTCUSD', timeframe: 'M5' });
    store.arrangeCharts('cascade');
    mountShared();
    const chartB = screen.getByTestId('chart-b');
    fireEvent.change(screen.getByLabelText('draft-b'), { target: { value: 'Retained annotation' } });
    fireEvent.mouseDown(chartB);
    expect(getActiveChartSource()?.id).toBe('trading-chart:b');

    act(() => runTerminalShortcutAction('window.reset'));
    expect(store.getChartCount()).toBe(1);
    expect(screen.getByTestId('chart-b')).toBe(chartB);
    expect(screen.getByLabelText('draft-b')).toHaveValue('Retained annotation');
    expect(screen.queryByTestId('chart-a')).toBeNull();
    expect(screen.getAllByRole('button', { name: 'Close chart XAUUSD.raw' })).toHaveLength(1);
    expect(getActiveChartSource()?.id).toBe('trading-chart:b');
    expect(useDockLayoutStore.getState().layout.floatingPanels).toEqual([]);
    expect(useDockLayoutStore.getState().recentlyClosedCharts).toHaveLength(MAX_CHART_PANELS - 1);
    expect(useDockLayoutStore.getState().recentlyClosedCharts.some(panel => panel.id === 'b')).toBe(false);
    expect(store.canUndo()).toBe(false);
    expect(unmounted.mock.calls.some(([id]) => id === 'b')).toBe(false);

    act(() => runTerminalShortcutAction('window.reset'));
    expect(store.getChartCount()).toBe(1);
    expect(screen.getByTestId('chart-b')).toBe(chartB);
    expect(useDockLayoutStore.getState().recentlyClosedCharts).toHaveLength(MAX_CHART_PANELS - 1);
  });

  it('renders an explicit standalone root independently of the saved store layout', () => {
    const root: Container = { id: 'explicit-root', type: 'panel', ratio: 1, children: [
      { id: 'explicit-chart', component: 'Chart', title: 'GBPUSD,M30', props: { symbol: 'GBPUSD', timeframe: 'M30' } },
    ] };
    render(<DockContainer isRoot container={root} renderPanel={renderPanel} />);
    expect(screen.getByTestId('chart-explicit-chart')).toBeVisible();
    expect(screen.queryByTestId('chart-a')).toBeNull();
  });

  it('keeps a survivor mounted when a standalone root collapses its one-child split after close', () => {
    useDockLayoutStore.getState().arrangeCharts('vertical');
    render(<DockContainer isRoot renderPanel={renderPanel} />);
    const chart = screen.getByTestId('chart-a');
    fireEvent.change(screen.getByLabelText('draft-a'), { target: { value: 'Custom annotation' } });
    act(() => useDockLayoutStore.getState().removePanel('b'));
    expect(screen.getByTestId('chart-a')).toBe(chart);
    expect(screen.getByLabelText('draft-a')).toHaveValue('Custom annotation');
    expect(unmounted.mock.calls).toEqual([['b']]);
  });

  it('retains DOM, React state and source identity across add, tile, cascade and sibling close', () => {
    mountShared();
    const chart = screen.getByTestId('chart-a');
    const host = chart.closest('[data-stable-chart-host]');
    fireEvent.click(screen.getByRole('button', { name: 'a: 0' }));
    let addedId = '';
    act(() => {
      const added = useDockLayoutStore.getState().addChartPanel({ symbol: 'BTCUSD-pro', timeframe: 'MN', chartType: 'area' });
      if (added.status === 'added') addedId = added.panelId;
    });
    expect(addedId).not.toBe('');
    for (const mode of ['horizontal', 'vertical', 'cascade', 'grid'] as const) {
      act(() => useDockLayoutStore.getState().arrangeCharts(mode));
      expect(screen.getByTestId('chart-a')).toBe(chart);
      expect(chart.closest('[data-stable-chart-host]')).toBe(host);
      expect(chart).toBeVisible();
      expect(screen.getByRole('button', { name: 'a: 1' })).toBeInTheDocument();
      fireEvent.mouseDown(chart);
      expect(getActiveChartSource()).toMatchObject({ id: 'trading-chart:a', symbol: 'XAUUSD.raw', timeframe: 'M1' });
      expect(getActiveChartSource()?.container === chart).toBe(true);
    }
    act(() => useDockLayoutStore.getState().removePanel(addedId));
    expect(screen.getByTestId('chart-a')).toBe(chart);
    expect(mounted.mock.calls.filter(([id]) => id === 'a')).toHaveLength(1);
    expect(unmounted.mock.calls.some(([id]) => id === 'a')).toBe(false);
    act(() => useDockLayoutStore.getState().removePanel('a'));
    expect(screen.queryByTestId('chart-a')).toBeNull();
    expect(document.querySelector('[data-stable-chart-host="a"]')).toBeNull();
    expect(unmounted.mock.calls.filter(([id]) => id === 'a')).toHaveLength(1);
    expect(getActiveChartSource()?.id).not.toBe('trading-chart:a');
  });

  it('keeps cold tabs lazy and parks previously open tabs without handing them chart commands', () => {
    mountShared();
    const chartA = screen.getByTestId('chart-a');
    expect(screen.queryByTestId('chart-b')).toBeNull();
    act(() => useDockLayoutStore.getState().setActiveTab('charts', 'b'));
    const chartB = screen.getByTestId('chart-b');
    fireEvent.mouseDown(chartB);
    expect(getActiveChartSource()?.id).toBe('trading-chart:b');
    expect(chartA).toHaveAttribute('data-active', 'false');
    // Replace the container identity so its fresh lazy-tab state has never
    // visited A. The provider must preserve A in connected, inactive parking.
    const changed = tabsLayout();
    const tabs = (changed.root.children[1] as Container).children[0] as Container;
    tabs.id = 'replacement-tabs'; tabs.activeTab = 'b';
    act(() => useDockLayoutStore.getState().setLayout(changed));
    expect(screen.getByTestId('chart-a')).toBe(chartA);
    expect(chartA).toBeInTheDocument();
    expect(chartA.closest('[data-stable-chart-parking]')).not.toBeNull();
    expect(chartA).not.toBeVisible();
    expect(getActiveChartSource()?.id).toBe('trading-chart:b');
    act(() => useDockLayoutStore.getState().setActiveTab('replacement-tabs', 'a'));
    expect(screen.getByTestId('chart-a')).toBe(chartA);
    expect(chartA.closest('[data-stable-chart-slot="a"]')).not.toBeNull();
    expect(chartA).toHaveAttribute('data-active', 'true');
    expect(mounted.mock.calls.filter(([id]) => id === 'a')).toHaveLength(1);
  });

  it('keeps minimized charts mounted but ineligible for commands through floating and restore', () => {
    useDockLayoutStore.getState().arrangeCharts('vertical');
    mountShared();
    const chartA = screen.getByTestId('chart-a');
    fireEvent.mouseDown(chartA);
    expect(getActiveChartSource()?.id).toBe('trading-chart:a');
    act(() => useDockLayoutStore.getState().setPanelMinimized('a', true));
    expect(chartA).toHaveAttribute('data-active', 'false');
    expect(getActiveChartSource()?.id).not.toBe('trading-chart:a');
    act(() => useDockLayoutStore.getState().floatPanel('a', { x: 40, y: 60 }));
    expect(screen.getByTestId('chart-a')).toBe(chartA);
    expect(chartA).not.toBeVisible();
    act(() => useDockLayoutStore.getState().setPanelMinimized('a', false));
    fireEvent.mouseDown(chartA);
    expect(chartA).toBeVisible();
    expect(getActiveChartSource()?.id).toBe('trading-chart:a');
    expect(useDockLayoutStore.getState().layout.floatingPanels.at(-1)?.children[0].id).toBe('a');
    expect(unmounted).not.toHaveBeenCalled();
  });
});
