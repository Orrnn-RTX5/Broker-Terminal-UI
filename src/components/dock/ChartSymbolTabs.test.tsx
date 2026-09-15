// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ChartSymbolTabs } from './ChartSymbolTabs';
import { changeChartPanelSymbol, findChartPanelById } from '../../services/chartPanelNavigation';
import { useDockLayoutStore } from '../../store/useDockLayoutStore';
import { applyChartTimeframeCommand } from '../../services/chartTimeframeCommand';

const initialLayout = useDockLayoutStore.getState().layout;
afterEach(() => { cleanup(); useDockLayoutStore.getState().setLayout(initialLayout); });

describe('chart header symbol tabs', () => {
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
      expect(screen.getByRole('tab', { name: 'BTCUSD, M5' })).toHaveAttribute('aria-selected', 'true');
      fireEvent.click(screen.getByRole('tab', { name: 'XAUUSD, M1' }));
      expect(screen.getByRole('tab', { name: 'XAUUSD, M1' })).toHaveAttribute('aria-selected', 'true');
      expect(findChartPanelById(useDockLayoutStore.getState().layout, 'chart')?.props).toMatchObject({ symbol: 'XAUUSD', timeframe: 'M1' });
      fireEvent.click(screen.getByRole('tab', { name: 'BTCUSD, M5' }));
      expect(screen.getByRole('tab', { name: 'BTCUSD, M5' })).toHaveAttribute('aria-selected', 'true');
      expect(findChartPanelById(useDockLayoutStore.getState().layout, 'chart')?.props).toMatchObject({ symbol: 'BTCUSD', timeframe: 'M5' });
      expect(screen.getAllByRole('tab')).toHaveLength(2);
      expect(openChart).toHaveBeenCalledTimes(2);
    } finally { window.removeEventListener('openChart', openChart); }
  });
});
