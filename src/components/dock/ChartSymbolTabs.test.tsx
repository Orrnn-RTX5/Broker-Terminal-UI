// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ChartSymbolTabs } from './ChartSymbolTabs';
import { changeChartPanelSymbol, findChartPanelById } from '../../services/chartPanelNavigation';
import { useDockLayoutStore } from '../../store/useDockLayoutStore';
import { applyChartTimeframeCommand } from '../../services/chartTimeframeCommand';

const initialLayout = useDockLayoutStore.getState().layout;
const initialClosedCharts = useDockLayoutStore.getState().recentlyClosedCharts;
afterEach(() => {
  cleanup();
  useDockLayoutStore.getState().setLayout(initialLayout);
  useDockLayoutStore.setState({ recentlyClosedCharts: initialClosedCharts });
});

describe('chart header symbol tabs', () => {
  it('closes individual symbol tabs without activating the header or reopening the closed symbol', () => {
    useDockLayoutStore.getState().setLayout({ version: '1.0', floatingPanels: [], root: {
      id: 'root', type: 'root', ratio: 1, children: [{
        id: 'chart', title: 'XAUUSD,M1', component: 'Chart',
        props: { symbol: 'XAUUSD', timeframe: 'M1' },
        chartSymbolTabs: [
          { symbol: 'BTCUSD', timeframe: 'M5' },
          { symbol: 'EURUSD', timeframe: 'H1' },
          { symbol: 'XAUUSD', timeframe: 'M1' },
        ],
      }],
    } });
    const Header = () => {
      const layout = useDockLayoutStore(state => state.layout);
      const panel = findChartPanelById(layout, 'chart');
      return panel ? <ChartSymbolTabs panel={panel} /> : null;
    };
    const activateHeader = vi.fn();
    const openChart = vi.fn();
    window.addEventListener('openChart', openChart);
    try {
      render(<div onMouseDown={activateHeader} onClick={activateHeader}><Header /></div>);
      expect(screen.getAllByRole('button', { name: /^Close .* tab$/ })).toHaveLength(3);
      const closeInactive = screen.getByRole('button', { name: 'Close EURUSD tab' });
      fireEvent.mouseDown(closeInactive);
      fireEvent.click(closeInactive);
      expect(screen.queryByRole('tab', { name: 'EURUSD H1' })).toBeNull();
      expect(screen.getByRole('tab', { name: 'XAUUSD M1' })).toHaveAttribute('aria-selected', 'true');

      fireEvent.click(screen.getByRole('button', { name: 'Close XAUUSD tab' }));
      expect(screen.queryByRole('tab', { name: 'XAUUSD M1' })).toBeNull();
      expect(screen.getByRole('tab', { name: 'BTCUSD M5' })).toHaveAttribute('aria-selected', 'true');

      fireEvent.click(screen.getByRole('button', { name: 'Close BTCUSD tab' }));
      expect(screen.queryByRole('tablist', { name: 'Symbol charts' })).toBeNull();
      expect(findChartPanelById(useDockLayoutStore.getState().layout, 'chart')).toBeUndefined();
      expect(activateHeader).not.toHaveBeenCalled();
      expect(openChart).not.toHaveBeenCalled();
    } finally { window.removeEventListener('openChart', openChart); }
  });

  it('opens each clicked symbol with its own timeframe and keeps the current tab selected', () => {
    const store = useDockLayoutStore.getState();
    store.setLayout({ version: '1.0', floatingPanels: [], root: { id: 'root', type: 'root', ratio: 1, children: [
      { id: 'chart', title: 'XAUUSD,M1', component: 'Chart', props: { symbol: 'XAUUSD', timeframe: 'M1' } },
    ] } });
    const Header = () => {
      const layout = useDockLayoutStore(state => state.layout);
      return <ChartSymbolTabs panel={findChartPanelById(layout, 'chart')!} />;
    };
    const openChart = vi.fn((event: Event) => {
      const detail = (event as CustomEvent).detail;
      changeChartPanelSymbol(detail.panelId, detail.symbol, ['XAUUSD', 'BTCUSD', 'EURUSD']);
    });
    window.addEventListener('openChart', openChart);
    try {
      changeChartPanelSymbol('chart', 'BTCUSD', ['XAUUSD', 'BTCUSD', 'EURUSD']);
      applyChartTimeframeCommand({ panelId: 'chart', timeframe: 'M5' }, () => {});
      render(<Header />);
      expect(screen.queryByRole('button', { name: /Change symbol for/ })).toBeNull();
      expect(screen.getByRole('tab', { name: 'BTCUSD M5' })).toHaveAttribute('aria-selected', 'true');
      fireEvent.click(screen.getByRole('tab', { name: 'XAUUSD M1' }));
      expect(screen.getByRole('tab', { name: 'XAUUSD M1' })).toHaveAttribute('aria-selected', 'true');
      expect(findChartPanelById(useDockLayoutStore.getState().layout, 'chart')?.props).toMatchObject({ symbol: 'XAUUSD', timeframe: 'M1' });
      fireEvent.click(screen.getByRole('tab', { name: 'BTCUSD M5' }));
      expect(screen.getByRole('tab', { name: 'BTCUSD M5' })).toHaveAttribute('aria-selected', 'true');
      expect(findChartPanelById(useDockLayoutStore.getState().layout, 'chart')?.props).toMatchObject({ symbol: 'BTCUSD', timeframe: 'M5' });
      expect(screen.getAllByRole('tab')).toHaveLength(2);
      const tablist = screen.getByRole('tablist', { name: 'Symbol charts' });
      expect(tablist.querySelectorAll('button:not([role="tab"])')).toHaveLength(0);
      expect(screen.getByRole('button', { name: 'Close BTCUSD tab' }).closest('[role="tablist"]')).toBeNull();
      expect(openChart).toHaveBeenCalledTimes(2);
      fireEvent.keyDown(screen.getByRole('tab', { name: 'BTCUSD M5' }), { key: 'Home' });
      expect(screen.getByRole('tab', { name: 'XAUUSD M1' })).toHaveFocus();
      expect(screen.getByRole('tab', { name: 'XAUUSD M1' })).toHaveAttribute('aria-selected', 'true');
    } finally { window.removeEventListener('openChart', openChart); }
  });

  it('renders a crisp Lucide X icon matching the right-side close control', () => {
    const layout = {
      version: '1.0' as const,
      floatingPanels: [],
      root: {
        id: 'root',
        type: 'root' as const,
        ratio: 1,
        children: [{
          id: 'chart',
          title: 'XAUUSD,M1',
          component: 'Chart',
          props: { symbol: 'XAUUSD', timeframe: 'M1' },
          chartSymbolTabs: [{ symbol: 'XAUUSD', timeframe: 'M1' }],
        }],
      },
    };
    render(<ChartSymbolTabs panel={layout.root.children[0]} />);
    const tabBtn = screen.getByRole('tab', { name: 'XAUUSD M1' });
    const closeBtn = screen.getByRole('button', { name: 'Close XAUUSD tab' });
    const icon = closeBtn.querySelector('svg');
    expect(icon).not.toBeNull();
    expect(icon?.classList.contains('lucide-x')).toBe(true);
    expect(icon?.classList.contains('w-3')).toBe(true);
    expect(icon?.classList.contains('h-3')).toBe(true);
    expect(tabBtn.className).toContain('h-full');
    expect(tabBtn.className).toContain('min-h-0');
    expect(closeBtn.className).toContain('text-zinc-400');
    expect(closeBtn.className).toContain('h-full');
    expect(closeBtn.className).toContain('min-h-0');
    expect(closeBtn).toHaveAttribute('data-chart-tab-active', 'true');
  });
});
