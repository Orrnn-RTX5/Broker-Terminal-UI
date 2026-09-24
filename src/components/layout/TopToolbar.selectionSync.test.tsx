// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { ComponentProps } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { TopToolbar } from './TopToolbar';
import { commandBus } from '../../services/commandBus';
import { useDockLayoutStore } from '../../store/useDockLayoutStore';
import { useChartSettingsStore } from '../../store/useChartSettingsStore';
import { useTerminalBarsStore } from '../../store/useTerminalBarsStore';
import type { DockLayout } from '../../services/dockManager';
import {
  activateActiveChartSource,
  bindActiveChartSourceInteractions,
  clearActiveChartSources,
  registerActiveChartSource,
} from '../../services/activeChartSource';

const originalElectron = window.electron;
const originalLayout = useDockLayoutStore.getState().layout;
const originalChartSettings = useChartSettingsStore.getState();
const chartElements: HTMLElement[] = [];

const toolbarProps = (): ComponentProps<typeof TopToolbar> => ({
  chartType: 'candlestick', timeframe: 'M5', symbol: 'BTCUSD',
  onChartTypeChange: vi.fn(), onTimeframeChange: vi.fn(), onRefreshConnection: vi.fn(),
  feedStatus: { symbols: [], loading: false, settled: true, current: true, error: null },
});

const desktopChartLayout = (type: 'tabs' | 'split' = 'tabs', activeTab = 'chart-a'): DockLayout => ({
  version: originalLayout.version,
  root: {
    id: 'test-charts', type, ratio: 1, direction: 'horizontal', activeTab,
    children: [
      { id: 'chart-a', title: 'BTCUSD,M5', component: 'Chart', props: { symbol: 'BTCUSD', timeframe: 'M5', chartType: 'candlestick' } },
      { id: 'chart-b', title: 'XAUUSD,M5', component: 'Chart', props: { symbol: 'XAUUSD', timeframe: 'M5', chartType: 'line' } },
    ],
  },
  floatingPanels: [],
});

const prepareDesktopCharts = (layout: DockLayout) => {
  Object.defineProperty(window, 'electron', { configurable: true, writable: true, value: { window: {} } });
  clearActiveChartSources();
  commandBus.clearHistory();
  useDockLayoutStore.getState().setLayout(layout);
  const containers = ['chart-a', 'chart-b'].map(id => {
    const container = document.createElement('div');
    container.dataset.dockTabContent = id;
    container.style.display = layout.root.type === 'tabs' && layout.root.activeTab !== id ? 'none' : 'block';
    document.body.appendChild(container);
    chartElements.push(container);
    registerActiveChartSource({ id: `trading-chart:${id}`, getContainer: () => container });
    bindActiveChartSourceInteractions(`trading-chart:${id}`, container);
    return container;
  });
  activateActiveChartSource(`trading-chart:${layout.root.activeTab}`);
  return containers;
};

afterEach(() => {
  cleanup();
  useTerminalBarsStore.setState({ timeframesVisible: true });
  clearActiveChartSources();
  chartElements.splice(0).forEach(element => element.remove());
  useDockLayoutStore.getState().setLayout(originalLayout);
  useChartSettingsStore.setState({
    globalProperties: originalChartSettings.globalProperties,
    symbolProperties: originalChartSettings.symbolProperties,
  });
  Object.defineProperty(window, 'electron', { configurable: true, writable: true, value: originalElectron });
  commandBus.clearHistory();
});

describe('toolbar selection synchronization', () => {
  it.each(['web', 'desktop'])('hides and restores the %s timeframe strip without changing the selected chart period', (surface) => {
    if (surface === 'desktop') prepareDesktopCharts(desktopChartLayout());
    else Object.defineProperty(window, 'electron', { configurable: true, writable: true, value: undefined });
    const props = toolbarProps();
    render(<TopToolbar {...props} />);

    expect(screen.getByRole('radiogroup', { name: 'Chart timeframes' })).toBeInTheDocument();
    act(() => useTerminalBarsStore.getState().toggleTimeframes());
    expect(screen.queryByRole('radiogroup', { name: 'Chart timeframes' })).not.toBeInTheDocument();
    expect(screen.getByRole('radio', { name: 'Candlesticks' })).toBeInTheDocument();
    expect(props.onTimeframeChange).not.toHaveBeenCalled();
    expect(commandBus.getHistory().filter(command => command.type === 'SET_TIMEFRAME')).toHaveLength(0);

    act(() => useTerminalBarsStore.getState().toggleTimeframes());
    expect(screen.getByRole('radio', { name: 'Timeframe: 5 minutes' })).toHaveAttribute('aria-checked', 'true');
    fireEvent.click(screen.getByRole('radio', { name: 'Timeframe: 15 minutes' }));
    expect(props.onTimeframeChange).toHaveBeenCalledWith('M15');
    expect(commandBus.getHistory().filter(command => command.type === 'SET_TIMEFRAME')).toEqual([
      expect.objectContaining({ payload: expect.objectContaining({ timeframe: 'M15' }) }),
    ]);
  });

  it('reflects a restored symbol timeframe without sending a command back to the previous chart', () => {
    commandBus.clearHistory();
    const props = toolbarProps();
    const view = render(<TopToolbar {...props} />);
    expect(screen.getByRole('radio', { name: 'Timeframe: 5 minutes' })).toHaveAttribute('aria-checked', 'true');
    expect(commandBus.getHistory().filter(command => command.type === 'SET_TIMEFRAME' || command.type === 'SET_CHART_TYPE')).toHaveLength(0);
    view.rerender(<TopToolbar {...props} symbol="XAUUSD" timeframe="M1" />);
    expect(screen.getByRole('radio', { name: 'Timeframe: 1 minute' })).toHaveAttribute('aria-checked', 'true');
    expect(commandBus.getHistory().filter(command => command.type === 'SET_TIMEFRAME' || command.type === 'SET_CHART_TYPE')).toHaveLength(0);
    fireEvent.click(screen.getByRole('radio', { name: 'Timeframe: 15 minutes' }));
    expect(commandBus.getHistory().filter(command => command.type === 'SET_TIMEFRAME')).toEqual([
      expect.objectContaining({ payload: expect.objectContaining({ timeframe: 'M15' }) }),
    ]);
  });

  it('shows the saved chart type when restoring a desktop tab without changing the chart', () => {
    prepareDesktopCharts(desktopChartLayout('tabs', 'chart-b'));
    render(<TopToolbar {...toolbarProps()} />);

    expect(screen.getByRole('radio', { name: 'Line Chart' })).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByRole('radio', { name: 'Candlesticks' })).toHaveAttribute('aria-checked', 'false');
    expect(commandBus.getHistory().filter(command => command.type === 'SET_CHART_TYPE')).toHaveLength(0);
  });

  it('follows desktop tab switches while the global chart type remains unchanged', async () => {
    const consoleError = vi.spyOn(console, 'error');
    const [first, second] = prepareDesktopCharts(desktopChartLayout());
    render(<TopToolbar {...toolbarProps()} />);
    expect(screen.getByRole('radio', { name: 'Candlesticks' })).toHaveAttribute('aria-checked', 'true');

    await act(async () => {
      first.style.display = 'none';
      second.style.display = 'block';
      useDockLayoutStore.getState().setActiveTab('test-charts', 'chart-b');
    });

    expect(screen.getByRole('radio', { name: 'Line Chart' })).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByRole('radio', { name: 'Candlesticks' })).toHaveAttribute('aria-checked', 'false');
    expect(commandBus.getHistory().filter(command => command.type === 'SET_CHART_TYPE')).toHaveLength(0);
    expect(consoleError.mock.calls.flat().join(' ')).not.toContain('while rendering a different component');
    consoleError.mockRestore();
  });

  it('follows focused desktop split panes without a layout change', async () => {
    const [first, second] = prepareDesktopCharts(desktopChartLayout('split'));
    const layout = useDockLayoutStore.getState().layout;
    render(<TopToolbar {...toolbarProps()} />);

    await act(async () => { fireEvent.pointerDown(second); });
    expect(screen.getByRole('radio', { name: 'Line Chart' })).toHaveAttribute('aria-checked', 'true');
    await act(async () => { fireEvent.pointerDown(first); });
    expect(screen.getByRole('radio', { name: 'Candlesticks' })).toHaveAttribute('aria-checked', 'true');
    expect(useDockLayoutStore.getState().layout).toBe(layout);
    expect(commandBus.getHistory().filter(command => command.type === 'SET_CHART_TYPE')).toHaveLength(0);
  });

  it('sends one targeted chart-type command and selects its icon when clicked', () => {
    prepareDesktopCharts(desktopChartLayout());
    render(<TopToolbar {...toolbarProps()} />);

    fireEvent.click(screen.getByRole('radio', { name: 'Area Chart' }));

    expect(screen.getByRole('radio', { name: 'Area Chart' })).toHaveAttribute('aria-checked', 'true');
    expect(commandBus.getHistory().filter(command => command.type === 'SET_CHART_TYPE')).toEqual([
      expect.objectContaining({ payload: { chartType: 'area', targetContextId: 'trading-chart:chart-a' } }),
    ]);
  });

  it('preserves the web toolbar selection when a desktop-style chart source changes', () => {
    const [, second] = prepareDesktopCharts(desktopChartLayout('split'));
    Object.defineProperty(window, 'electron', { configurable: true, writable: true, value: undefined });
    render(<TopToolbar {...toolbarProps()} />);

    fireEvent.pointerDown(second);
    expect(screen.getByRole('radio', { name: 'Candlesticks' })).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByRole('radio', { name: 'Line Chart' })).toHaveAttribute('aria-checked', 'false');
  });

  it('updates the period separator selected state when toggled off and on', () => {
    prepareDesktopCharts(desktopChartLayout());
    useChartSettingsStore.setState({
      globalProperties: { ...originalChartSettings.globalProperties, showPeriodSeparators: true },
      symbolProperties: {},
    });
    render(<TopToolbar {...toolbarProps()} />);

    fireEvent.click(screen.getByRole('button', { name: 'Hide Period Separators' }));
    expect(screen.getByRole('button', { name: 'Show Period Separators' })).toHaveAttribute('aria-pressed', 'false');
    fireEvent.click(screen.getByRole('button', { name: 'Show Period Separators' }));
    expect(screen.getByRole('button', { name: 'Hide Period Separators' })).toHaveAttribute('aria-pressed', 'true');
  });
});
