// @vitest-environment jsdom
import React, { useEffect } from 'react';
import { act, cleanup, fireEvent, render, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DockContainer } from './DockContainer';
import { DockManager, MAX_CHART_PANELS, type DockPanelConfig } from '../../services/dockManager';
import { useDockLayoutStore } from '../../store/useDockLayoutStore';

const initialLayout = useDockLayoutStore.getState().layout;
afterEach(() => {
  cleanup();
  useDockLayoutStore.getState().setLayout(initialLayout);
  vi.restoreAllMocks();
});

describe('individual chart window controls', () => {
  it('lets six minimized columns shrink and scroll so their restore controls remain reachable', () => {
    const manager = new DockManager();
    for (let index = 1; index < MAX_CHART_PANELS; index++) manager.addChartPanel({ symbol: `TEST${index}`, timeframe: 'M1' });
    manager.arrangeCharts('vertical');
    useDockLayoutStore.getState().setLayout(manager.getLayout());
    const view = render(<DockContainer isRoot renderPanel={() => <div />} />);
    within(view.container).getAllByRole('button', { name: /^Minimize chart / }).forEach(button => fireEvent.click(button));
    const columns = view.container.querySelector<HTMLElement>('[data-dock-container="chart-tile-vertical"]')!;
    expect(columns.style.overflowX).toBe('auto');
    const cards = Array.from(columns.querySelectorAll<HTMLElement>(':scope > [data-dock-child]'));
    expect(cards).toHaveLength(MAX_CHART_PANELS);
    expect(cards.every(card => card.style.flexShrink === '1' && card.style.minWidth === '96px')).toBe(true);
    expect(within(columns).getAllByRole('button', { name: /^Restore chart / })).toHaveLength(MAX_CHART_PANELS);
    fireEvent.click(within(columns).getByRole('button', { name: `Restore chart TEST${MAX_CHART_PANELS - 1}` }));
    expect(within(columns).getByRole('button', { name: `Minimize chart TEST${MAX_CHART_PANELS - 1}` })).toBeVisible();
  });

  it('keeps all six restore controls reachable when a nested grid is minimized', () => {
    const manager = new DockManager();
    manager.updatePanelProps('chart-default-container', { title: 'XAUUSD,M5', props: { symbol: 'XAUUSD', timeframe: 'M5' } });
    for (let index = 1; index < MAX_CHART_PANELS; index++) manager.addChartPanel({ symbol: `TEST${index}`, timeframe: 'M1' });
    useDockLayoutStore.getState().setLayout(manager.getLayout());
    const view = render(<DockContainer isRoot renderPanel={panel => <div data-test-panel={panel.id} />} />);
    const minimize = within(view.container).getAllByRole('button', { name: /^Minimize chart / });
    expect(minimize).toHaveLength(MAX_CHART_PANELS);
    minimize.forEach(button => fireEvent.click(button));
    expect(within(view.container).getAllByRole('button', { name: /^Restore chart / })).toHaveLength(MAX_CHART_PANELS);
    expect(view.container.querySelectorAll('[data-dock-panel-component="chart"][data-dock-minimized="true"]')).toHaveLength(MAX_CHART_PANELS);
    expect(view.container.querySelectorAll('[data-dock-panel-component="chart"] [data-test-panel]')).toHaveLength(MAX_CHART_PANELS);
    fireEvent.click(within(view.container).getByRole('button', { name: `Restore chart TEST${MAX_CHART_PANELS - 1}` }));
    expect(within(view.container).getAllByRole('button', { name: /^Restore chart / })).toHaveLength(MAX_CHART_PANELS - 1);
    expect(within(view.container).getByRole('button', { name: `Minimize chart TEST${MAX_CHART_PANELS - 1}` })).toBeVisible();
  });

  it('keeps each chart mounted through minimize and restore, and closes only its own panel', () => {
    const manager = new DockManager();
    manager.updatePanelProps('chart-default-container', { title: 'XAUUSD.raw,M5', props: { symbol: 'XAUUSD.raw', timeframe: 'M5' } });
    const added = manager.addChartPanel({ symbol: 'BTCUSD', timeframe: 'H4', chartType: 'line' });
    expect(added.status).toBe('added');
    useDockLayoutStore.getState().setLayout(manager.getLayout());
    act(() => useDockLayoutStore.getState().arrangeCharts('horizontal'));
    const unmounted = vi.fn();
    const Chart = ({ panel }: { panel: DockPanelConfig }) => {
      useEffect(() => () => unmounted(panel.id), [panel.id]);
      return <div data-test-chart={panel.id}>{panel.props?.symbol}</div>;
    };
    const view = render(<DockContainer isRoot renderPanel={panel => panel.component === 'Chart' ? <Chart panel={panel} /> : <div>{panel.title}</div>} />);
    const chart = view.container.querySelector<HTMLElement>('[data-dock-panel="chart-default-container"]')!;
    expect(chart.querySelector('.dock-panel__header')).toBeInTheDocument();
    expect(within(chart).getByRole('button', { name: 'Change symbol for XAUUSD.raw' })).toBeVisible();
    fireEvent.click(within(chart).getByRole('button', { name: 'Minimize chart XAUUSD.raw' }));
    expect(chart).toHaveAttribute('data-dock-minimized', 'true');
    expect(chart.querySelector('.dock-panel__content')).toHaveAttribute('hidden');
    expect(chart.closest('[data-dock-child]')).toHaveStyle({ flex: '0 0 30px' });
    expect(unmounted).not.toHaveBeenCalled();
    expect(view.container.querySelectorAll('[data-test-chart]')).toHaveLength(2);
    fireEvent.click(within(chart).getByRole('button', { name: 'Restore chart XAUUSD.raw' }));
    expect(chart.querySelector('.dock-panel__content')).not.toHaveAttribute('hidden');
    expect(chart.closest('[data-dock-child]')?.getAttribute('style')).not.toContain('0 0 30px');
    expect(unmounted).not.toHaveBeenCalled();
    fireEvent.click(within(chart).getByRole('button', { name: 'Close chart XAUUSD.raw' }));
    expect(useDockLayoutStore.getState().getChartCount()).toBe(1);
    expect(view.container.querySelector('[data-test-chart="chart-default-container"]')).toBeNull();
    expect(view.container.querySelector('[data-test-chart]')).toHaveTextContent('BTCUSD');
  });

  it('sends the originating panel ID when its symbol selector is clicked', () => {
    const manager = new DockManager();
    manager.updatePanelProps('chart-default-container', { title: 'EURUSD.r,M30', props: { symbol: 'EURUSD.r', timeframe: 'M30' } });
    useDockLayoutStore.getState().setLayout(manager.getLayout());
    const request = vi.fn();
    window.addEventListener('request-chart-symbol-change', request);
    try {
      const view = render(<DockContainer isRoot renderPanel={() => <div />} />);
      fireEvent.click(within(view.container).getByRole('button', { name: 'Change symbol for EURUSD.r' }));
      expect(request).toHaveBeenCalledOnce();
      expect((request.mock.calls[0][0] as CustomEvent).detail).toEqual({ panelId: 'chart-default-container' });
      expect(useDockLayoutStore.getState().getChartCount()).toBe(1);
    } finally {
      window.removeEventListener('request-chart-symbol-change', request);
    }
  });
});
