// @vitest-environment jsdom

import { useEffect } from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DockPanel } from './DockPanel';
import { findChartPanelById } from '../../services/chartPanelNavigation';
import type { DockPanelConfig } from '../../services/dockManager';
import { useDockLayoutStore } from '../../store/useDockLayoutStore';
import { useTerminalBarsStore } from '../../store/useTerminalBarsStore';

const initialLayout = useDockLayoutStore.getState().layout;
const initialChartsBarVisible = useTerminalBarsStore.getState().chartsBarVisible;

afterEach(() => {
  cleanup();
  useDockLayoutStore.getState().setLayout(initialLayout);
  useTerminalBarsStore.setState({ chartsBarVisible: initialChartsBarVisible });
});

describe('Charts Bar visibility', () => {
  it.each([false, true])('preserves chart state and window controls when toggled (floating: %s)', (isFloating) => {
    useTerminalBarsStore.setState({ chartsBarVisible: true });
    const panel: DockPanelConfig = {
      id: 'chart', title: 'BTCUSD,M5', component: 'Chart', closable: true,
      props: { symbol: 'BTCUSD', timeframe: 'M5', chartType: 'candlestick' },
      chartSymbolTabs: [
        { symbol: 'XAUUSD', timeframe: 'H1', chartType: 'bar' },
        { symbol: 'BTCUSD', timeframe: 'M5', chartType: 'candlestick' },
      ],
    };
    useDockLayoutStore.getState().setLayout({
      version: '1.0',
      root: { id: 'root', type: 'root', ratio: 1, children: isFloating ? [] : [panel] },
      floatingPanels: isFloating ? [{
        id: 'floating-chart', type: 'panel', ratio: 1, isFloating: true,
        position: { x: 20, y: 20 }, size: { width: 600, height: 400 }, children: [panel],
      }] : [],
    });
    const originalPanel = findChartPanelById(useDockLayoutStore.getState().layout, 'chart')!;
    const originalProps = { ...originalPanel.props };
    const originalTabs = originalPanel.chartSymbolTabs!.map(tab => ({ ...tab }));
    const chartMounted = vi.fn();
    const chartUnmounted = vi.fn();
    const onClose = vi.fn();
    const onDragStart = vi.fn();
    function ChartProbe() {
      useEffect(() => {
        chartMounted();
        return chartUnmounted;
      }, []);
      return <div data-testid="live-chart">Live chart</div>;
    }
    function ChartWindow() {
      const currentPanel = useDockLayoutStore(state => findChartPanelById(state.layout, 'chart'))!;
      return <DockPanel panel={currentPanel} isFloating={isFloating} onClose={onClose}
        onDragStart={onDragStart}
        onMinimizedChange={minimized => useDockLayoutStore.getState().setPanelMinimized('chart', minimized)}>
        <ChartProbe />
      </DockPanel>;
    }
    render(<ChartWindow />);
    const chart = screen.getByTestId('live-chart');
    expect(screen.getAllByRole('tab')).toHaveLength(2);
    expect(screen.getByRole('tab', { name: 'BTCUSD M5' })).toHaveAttribute('aria-selected', 'true');

    act(() => useTerminalBarsStore.getState().toggleChartsBar());
    expect(screen.queryByRole('tablist', { name: 'Symbol charts' })).not.toBeInTheDocument();
    expect(screen.getByText('BTCUSD,M5')).toBeVisible();
    expect(chart).toBeVisible();
    fireEvent.mouseDown(screen.getByText('BTCUSD,M5'));
    expect(onDragStart).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole('button', { name: 'Minimize chart BTCUSD' }));
    expect(chart).not.toBeVisible();
    expect(screen.getByRole('button', { name: 'Restore chart BTCUSD' })).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Restore chart BTCUSD' }));
    expect(chart).toBeVisible();
    expect(screen.queryByRole('tablist', { name: 'Symbol charts' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Close chart BTCUSD' }));
    expect(onClose).toHaveBeenCalledTimes(1);

    act(() => useTerminalBarsStore.getState().toggleChartsBar());
    expect(screen.getAllByRole('tab')).toHaveLength(2);
    expect(screen.getByRole('tab', { name: 'BTCUSD M5' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tab', { name: 'XAUUSD H1' })).toHaveAttribute('aria-selected', 'false');
    const restoredPanel = findChartPanelById(useDockLayoutStore.getState().layout, 'chart')!;
    expect(restoredPanel.props).toEqual(originalProps);
    expect(restoredPanel.chartSymbolTabs).toEqual(originalTabs);
    expect(screen.getByTestId('live-chart')).toBe(chart);
    expect(chartMounted).toHaveBeenCalledTimes(1);
    expect(chartUnmounted).not.toHaveBeenCalled();
  });
});
