// @vitest-environment jsdom

import React, { useEffect } from 'react';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { act, cleanup, fireEvent, render, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DockManager, type DockContainer as DockContainerConfig, type DockPanelConfig } from '../../services/dockManager';
import { useDockLayoutStore } from '../../store/useDockLayoutStore';
import { DockContainer, FloatingPanelsLayer } from './DockContainer';

const initialLayout = useDockLayoutStore.getState().layout;
const focusStyles = readFileSync(resolve(process.cwd(), 'src/styles/legacy-light-overrides.css'), 'utf8')
  .match(/html\.rtx-advanced-focus-chart \.rtx-dock-workspace[\s\S]*?(?=\/\* === OneClickTrading)/)![0];
afterEach(() => {
  cleanup();
  document.documentElement.classList.remove('rtx-advanced-view', 'rtx-advanced-focus-chart');
  useDockLayoutStore.getState().setLayout(initialLayout);
  vi.restoreAllMocks();
  document.querySelector('[data-test-focus-styles]')?.remove();
});
const chartsLayout = () => {
  const layout = new DockManager().getLayout();
  const center = layout.root.children[1] as DockContainerConfig;
  center.children[0] = {
    id: 'charts', type: 'tabs', ratio: 0.75, activeTab: 'chart-a', children: [
      { id: 'chart-a', title: 'XAUUSD.a,M1', component: 'Chart', props: { brokerId: 'one', symbol: 'XAUUSD.a', timeframe: 'M1' } },
      { id: 'chart-b', title: 'BTCUSD,MN', component: 'Chart', props: { brokerId: 'two', symbol: 'BTCUSD', timeframe: 'MN' } },
    ],
  };
  return layout;
};

describe('visible chart window arrangements', () => {
  it.each([false, true])('hides and restores surrounding panels when Light is %s without changing the layout', async (light) => {
    const style = document.createElement('style');
    style.dataset.testFocusStyles = 'true';
    style.textContent = focusStyles;
    document.head.appendChild(style);
    const layout = chartsLayout();
    useDockLayoutStore.getState().setLayout(layout);
    if (light) document.documentElement.classList.add('rtx-advanced-view');
    const view = render(<DockContainer isRoot renderPanel={panel => <div>{panel.title}</div>} />);
    const panels = ['market-watch', 'navigator', 'toolbox'].map(id =>
      view.container.querySelector(`[data-dock-panel="${id}"]`)!);
    for (const panel of panels) expect(panel).toBeVisible();
    await act(async () => document.documentElement.classList.add('rtx-advanced-focus-chart'));
    for (const panel of panels) expect(panel).not.toBeVisible();
    expect(view.container.querySelector('[data-dock-panel="chart-a"]')).toBeVisible();
    await act(async () => document.documentElement.classList.remove('rtx-advanced-focus-chart'));
    for (const panel of panels) expect(panel).toBeVisible();
    expect(useDockLayoutStore.getState().layout).toEqual(layout);
  });

  it('renders each tiled chart and changes row/column direction through the live store', () => {
    useDockLayoutStore.getState().setLayout(chartsLayout());
    const view = render(<DockContainer isRoot renderPanel={panel => <div data-test-chart={panel.id}>{panel.title}</div>} />);
    expect(view.container.querySelector('[data-test-chart="chart-b"]')).toBeNull();
    act(() => useDockLayoutStore.getState().arrangeCharts('horizontal'));
    expect(view.container.querySelector('[data-dock-container="chart-tile-horizontal"]')).toHaveAttribute('data-dock-container-direction', 'vertical');
    expect(view.container.querySelector('[data-test-chart="chart-a"]')).toHaveTextContent('XAUUSD.a,M1');
    expect(view.container.querySelector('[data-test-chart="chart-b"]')).toHaveTextContent('BTCUSD,MN');
    act(() => useDockLayoutStore.getState().arrangeCharts('vertical'));
    expect(view.container.querySelector('[data-dock-container="chart-tile-vertical"]')).toHaveAttribute('data-dock-container-direction', 'horizontal');
    expect(view.container.querySelector('[data-dock-panel="toolbox"]')).toBeInTheDocument();
    expect(view.container.querySelector('[data-dock-panel="navigator"]')).toBeInTheDocument();
  });

  it('provides working floating controls and arranges minimized title bars without unmounting charts', () => {
    useDockLayoutStore.getState().setLayout(chartsLayout());
    useDockLayoutStore.getState().arrangeCharts('cascade');
    const unmounted = vi.fn();
    const Chart = ({ panel }: { panel: DockPanelConfig }) => {
      useEffect(() => () => unmounted(panel.id), [panel.id]);
      return <div>{panel.title}</div>;
    };
    const view = render(<FloatingPanelsLayer renderPanel={panel => <Chart panel={panel} />} />);
    const findWindow = (id: string) => view.container.querySelector<HTMLElement>(`[data-dock-panel="${id}"]`)!;
    const originalPosition = useDockLayoutStore.getState().layout.floatingPanels[0].position;
    const chartA = findWindow('chart-a');
    const chartB = findWindow('chart-b');
    expect(chartA.querySelector('.dock-panel__header')).toBeInTheDocument();
    fireEvent.click(within(chartA).getByTitle('Minimize'));
    fireEvent.click(within(chartB).getByTitle('Minimize'));
    expect(chartA).toHaveAttribute('data-dock-minimized', 'true');
    expect(chartA.style.height).toBe('30px');
    expect(chartA.querySelector('.dock-panel__content')).toHaveAttribute('hidden');
    expect(chartA.querySelector('[data-dock-floating-resize-handle]')).toBeNull();
    expect(unmounted).not.toHaveBeenCalled();
    act(() => { expect(useDockLayoutStore.getState().arrangeIcons()).toBe(2); });
    expect(chartA.style.left).not.toBe(chartB.style.left);
    expect(chartA.style.top).toBe(chartB.style.top);
    fireEvent.click(within(chartA).getByTitle('Restore'));
    expect(chartA).toHaveAttribute('data-dock-minimized', 'false');
    expect(chartA.style.left).toBe(`${originalPosition!.x}px`);
    expect(chartA.style.top).toBe(`${originalPosition!.y}px`);
    expect(chartA.querySelector('.dock-panel__content')).not.toHaveAttribute('hidden');
    expect(unmounted).not.toHaveBeenCalled();
    fireEvent.mouseDown(chartA);
    expect(useDockLayoutStore.getState().layout.floatingPanels.at(-1)?.children[0].id).toBe('chart-a');
    fireEvent.click(within(chartA).getByTitle('Close'));
    expect(findWindow('chart-a')).toBeNull();
    expect(findWindow('chart-b')).toBeInTheDocument();
  });

  it('exits focus mode before the store arranges the visible chart windows', async () => {
    useDockLayoutStore.getState().setLayout(chartsLayout());
    document.documentElement.classList.add('rtx-advanced-view', 'rtx-advanced-focus-chart');
    const view = render(<><DockContainer isRoot /><FloatingPanelsLayer renderPanel={panel => <div>{panel.title}</div>} /></>);
    act(() => useDockLayoutStore.getState().arrangeCharts('cascade'));
    expect(document.documentElement).not.toHaveClass('rtx-advanced-focus-chart');
    await waitFor(() => expect(view.container.querySelectorAll('[data-dock-floating-panel="true"]')).toHaveLength(2));
    expect(view.container.querySelector('[data-dock-panel="toolbox"]')).toBeInTheDocument();
  });

  it('visibly returns from four columns to the previous grid and redoes columns after chart updates settle', async () => {
    const layout = chartsLayout();
    const center = layout.root.children[1] as DockContainerConfig;
    const tabs = center.children[0] as DockContainerConfig;
    tabs.children.push(
      { id: 'chart-c', title: 'EURUSD,M5', component: 'Chart', props: { symbol: 'EURUSD', timeframe: 'M5' } },
      { id: 'chart-d', title: 'NAS100,H1', component: 'Chart', props: { symbol: 'NAS100', timeframe: 'H1' } },
    );
    useDockLayoutStore.getState().setLayout(layout);
    const view = render(<DockContainer isRoot renderPanel={panel => <div>{panel.title}</div>} />);
    await act(async () => useDockLayoutStore.getState().arrangeCharts('grid'));
    const grid = (useDockLayoutStore.getState().layout.root.children[1] as DockContainerConfig).children[0] as DockContainerConfig;
    expect(view.container.querySelector(`[data-dock-container="${grid.id}"]`)).toHaveAttribute('data-dock-container-direction', 'vertical');
    await act(async () => useDockLayoutStore.getState().arrangeCharts('vertical'));
    await act(async () => useDockLayoutStore.getState().updatePanelProps('chart-b', { title: 'BTCUSD,H4', props: { symbol: 'BTCUSD', timeframe: 'H4' } }));
    expect(view.container.querySelector('[data-dock-container="chart-tile-vertical"]')).toHaveAttribute('data-dock-container-direction', 'horizontal');
    await act(async () => useDockLayoutStore.getState().undo());
    expect(view.container.querySelector(`[data-dock-container="${grid.id}"]`)).toHaveAttribute('data-dock-container-direction', 'vertical');
    expect(view.container.querySelector('[data-dock-panel="chart-b"]')).toHaveTextContent('BTCUSD,H4');
    await act(async () => useDockLayoutStore.getState().redo());
    expect(view.container.querySelector('[data-dock-container="chart-tile-vertical"]')).toHaveAttribute('data-dock-container-direction', 'horizontal');
  });
});
