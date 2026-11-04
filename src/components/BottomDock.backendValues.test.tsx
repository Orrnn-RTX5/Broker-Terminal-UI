// @vitest-environment jsdom

import React from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BottomDock } from './BottomDock';
import { useAppStore } from '../store/useAppStore';

const trade = vi.hoisted(() => ({
  account: null as any,
  positions: [] as any[],
  refresh: vi.fn(),
}));

vi.mock('../hooks/useToolboxTradeData', () => ({
  useToolboxTradeData: () => ({
    account: trade.account, positions: trade.positions, pendingPositions: [],
    loading: false, error: null, login: 1, restBaseUrl: '', wsUrl: '',
    wsState: 'connected', lastRestAt: null, lastWsAt: null, debug: [],
    refresh: trade.refresh, removePosition: vi.fn(), removePositionsByMode: vi.fn(),
  }),
}));

describe('Trade backend financial rendering', () => {
  beforeEach(() => {
    localStorage.clear();
    trade.account = {
      balance: 1000, credit: 0, equity: 1100, margin: 20, freeMargin: 1080, marginLevel: 5500,
      unrealizedPL: -81.4, hasBackendUnrealizedPL: true, currency: 'USD',
    };
    trade.positions = [{
      id: 71, symbol: 'BTCUSD', side: 'BUY', volume: 0.01, openPrice: 80000,
      price_current: 81000, currentPrice: 81000, hasBackendCurrentPrice: true,
      profit: 7, unrealizedPnL: 7, hasBackendProfit: true,
      openTime: '2026-09-21T10:00:00.000Z', sl: 0, tp: 0, swap: 0, commission: 0,
    }];
  });

  afterEach(() => {
    cleanup();
    localStorage.clear();
    vi.clearAllMocks();
  });

  it('renders backend row profit, keeps the account total on the live rows, then applies fresh backend updates', () => {
    const { container, rerender } = render(<BottomDock height={300} onClosePosition={vi.fn()} onModifyPosition={vi.fn()} />);
    expect(screen.getByTitle('Profit: 7.00')).toHaveTextContent('7.00');
    // Floating P/L follows the streamed rows (profit + swap + commission), not the older -81.40 snapshot.
    expect(container.querySelector('.rtx-trade-footer-floating')).toHaveTextContent('7.00');

    act(() => useAppStore.getState().setTicks({
      BTCUSD: { symbol: 'BTCUSD', bid: 90000, ask: 90001, spread: 1, timestamp: Date.now() },
    }));
    expect(screen.getByTitle('Profit: 7.00')).toHaveTextContent('7.00');
    expect(container.querySelector('.rtx-trade-footer-floating')).toHaveTextContent('7.00');

    trade.positions = [{ ...trade.positions[0], profit: -12, unrealizedPnL: -12 }];
    trade.account = { ...trade.account, unrealizedPL: -90.5 };
    rerender(<BottomDock height={300} onClosePosition={vi.fn()} onModifyPosition={vi.fn()} />);
    expect(screen.getByTitle('Profit: -12.00')).toHaveTextContent('-12.00');
    expect(container.querySelector('.rtx-trade-footer-floating')).toHaveTextContent('-12.00');
  });

  it('keeps the floating P/L color tied to its sign while the value changes', () => {
    trade.positions = [{ ...trade.positions[0], profit: -2.3, unrealizedPnL: -2.3 }];
    const { container, rerender } = render(<BottomDock height={300} onClosePosition={vi.fn()} onModifyPosition={vi.fn()} />);
    const floatingAmount = () => container.querySelector(
      '.rtx-trade-footer-floating > span:not(.rtx-trade-footer-currency)',
    );

    expect(floatingAmount()).toHaveClass('text-loss');

    trade.positions = [{ ...trade.positions[0], profit: -2.2, unrealizedPnL: -2.2 }];
    rerender(<BottomDock height={300} onClosePosition={vi.fn()} onModifyPosition={vi.fn()} />);
    expect(floatingAmount()).toHaveTextContent('-2.20');
    expect(floatingAmount()).toHaveClass('text-loss');
    expect(floatingAmount()).not.toHaveClass('text-profit');

    trade.positions = [{ ...trade.positions[0], profit: 2.3, unrealizedPnL: 2.3 }];
    rerender(<BottomDock height={300} onClosePosition={vi.fn()} onModifyPosition={vi.fn()} />);
    expect(floatingAmount()).toHaveClass('text-profit');

    trade.positions = [{ ...trade.positions[0], profit: 2.2, unrealizedPnL: 2.2 }];
    rerender(<BottomDock height={300} onClosePosition={vi.fn()} onModifyPosition={vi.fn()} />);
    expect(floatingAmount()).toHaveTextContent('2.20');
    expect(floatingAmount()).toHaveClass('text-profit');
    expect(floatingAmount()).not.toHaveClass('text-loss');

    trade.positions = [{ ...trade.positions[0], profit: 0, unrealizedPnL: 0 }];
    rerender(<BottomDock height={300} onClosePosition={vi.fn()} onModifyPosition={vi.fn()} />);
    expect(floatingAmount()).toHaveTextContent('0.00');
    expect(floatingAmount()).toHaveClass('text-zinc-100');
  });

  it('updates equity, free margin and level from live profit without direction flashes', () => {
    trade.account = {
      ...trade.account, equity: 1007, freeMargin: 987, marginLevel: 5035, unrealizedPL: 7,
    };
    const { rerender } = render(<BottomDock height={300} onClosePosition={vi.fn()} onModifyPosition={vi.fn()} />);
    const expectMetrics = (values: string[]) => {
      ['Equity', 'Free margin', 'Level'].forEach((label, index) => {
        const amount = screen.getByText(label).parentElement?.lastElementChild;
        expect(amount).toHaveTextContent(values[index]);
        expect(amount).toHaveClass('text-zinc-100');
        expect(amount).not.toHaveClass('text-profit');
        expect(amount).not.toHaveClass('text-loss');
      });
    };
    expectMetrics(['1 007.00', '987.00', '5035.00%']);

    trade.positions = [{ ...trade.positions[0], profit: 10, unrealizedPnL: 10 }];
    rerender(<BottomDock height={300} onClosePosition={vi.fn()} onModifyPosition={vi.fn()} />);
    expectMetrics(['1 010.00', '990.00', '5050.00%']);

    trade.positions = [{ ...trade.positions[0], profit: -5, unrealizedPnL: -5 }];
    rerender(<BottomDock height={300} onClosePosition={vi.fn()} onModifyPosition={vi.fn()} />);
    expectMetrics(['995.00', '975.00', '4975.00%']);
  });

  it('clears the selected trade row when clicking empty space or another panel', () => {
    const { container } = render(<>
      <button type="button">Chart area</button>
      <BottomDock height={300} onClosePosition={vi.fn()} onModifyPosition={vi.fn()} />
    </>);
    const row = screen.getByText('71').closest('tr')!;
    fireEvent.click(screen.getByText('71'));
    expect(row).toHaveAttribute('aria-selected', 'true');

    fireEvent.pointerDown(screen.getByText('71'));
    expect(row).toHaveAttribute('aria-selected', 'true');
    fireEvent.pointerDown(container.querySelector('.rtx-trade-scroll')!);
    expect(row).toHaveAttribute('aria-selected', 'false');

    fireEvent.click(screen.getByText('71'));
    fireEvent.pointerDown(screen.getByRole('button', { name: 'Chart area' }));
    expect(row).toHaveAttribute('aria-selected', 'false');
    expect(row).not.toHaveClass('rtx-trade-row--selected');

    fireEvent.contextMenu(row);
    fireEvent.pointerDown(screen.getByRole('menu'));
    expect(row).toHaveAttribute('aria-selected', 'true');
  });

  it('shows unavailable monetary fields instead of a calculated profit or zero placeholders', () => {
    trade.account = {
      ...trade.account, balance: 0, margin: 0, unrealizedPL: 0,
      hasBackendBalance: false, hasBackendMargin: false, hasBackendUnrealizedPL: false,
    };
    trade.positions = [{ ...trade.positions[0], profit: 0, unrealizedPnL: 0, hasBackendProfit: false }];
    const { container } = render(<BottomDock height={300} onClosePosition={vi.fn()} onModifyPosition={vi.fn()} />);
    expect(container.querySelector('.rtx-trade-footer-floating')).not.toHaveTextContent('0.00');
    expect(container.querySelector('.rtx-trade-footer-floating [title="Not reported by the trading server"]')).toBeInTheDocument();
    expect(screen.queryByTitle('Profit: 0.00')).not.toBeInTheDocument();
    expect(container.querySelectorAll('.rtx-trade-footer-metrics [title="Not reported by the trading server"]')).toHaveLength(2);
  });

  it('displays backend zero floating profit and margin level verbatim for an empty account', () => {
    trade.positions = [];
    trade.account = { ...trade.account, margin: 0, freeMargin: 1000, unrealizedPL: 0, marginLevel: 0 };
    const { container } = render(<BottomDock height={300} onClosePosition={vi.fn()} onModifyPosition={vi.fn()} />);
    expect(container.querySelector('.rtx-trade-footer-floating')).toHaveTextContent('0.00');
    expect(container.querySelector('.rtx-trade-footer-metrics')).toHaveTextContent('0.00%');
    expect(container.querySelector('.rtx-trade-footer-metrics')).not.toHaveTextContent('∞');
  });

  it('clears stale floating P/L as soon as the last visible position closes', () => {
    trade.positions = [];
    trade.account = { ...trade.account, unrealizedPL: -81.4 };

    const { container } = render(<BottomDock height={300} onClosePosition={vi.fn()} onModifyPosition={vi.fn()} />);
    const floatingProfit = container.querySelector('.rtx-trade-footer-floating');

    expect(floatingProfit).toHaveTextContent('0.00');
    expect(floatingProfit).not.toHaveTextContent('-81.40');
  });

  it('does not substitute a quote or entry price for a missing backend current price', () => {
    useAppStore.getState().setTicks({
      BTCUSD: { symbol: 'BTCUSD', bid: 90000, ask: 90001, spread: 1, timestamp: Date.now() },
    });
    trade.positions = [{ ...trade.positions[0], price_current: 0, currentPrice: 0, hasBackendCurrentPrice: false }];
    render(<BottomDock height={300} onClosePosition={vi.fn()} onModifyPosition={vi.fn()} />);
    expect(screen.getByTitle('Current price: —')).toHaveTextContent('—');
    expect(screen.queryByTitle('Current price: 90000.00')).not.toBeInTheDocument();
  });

  it('shows Credit: 500.00 between Balance and Equity when non-zero and hides it when credit is 0', () => {
    trade.account = { ...trade.account, balance: 1000, credit: 500, hasBackendCredit: true, equity: 1507 };
    const { container, rerender } = render(<BottomDock height={300} onClosePosition={vi.fn()} onModifyPosition={vi.fn()} />);

    const getFooterLabels = () => Array.from(
      container.querySelectorAll('.rtx-trade-footer-metrics .rtx-trade-metric-label'),
    ).map(node => node.textContent);

    expect(getFooterLabels()).toEqual(['Balance', 'Credit', 'Equity', 'Margin', 'Free margin', 'Level']);
    expect(screen.getByText('Credit').parentElement?.lastElementChild).toHaveTextContent('500.00');
    expect(screen.getByText('Credit').closest('.rtx-trade-footer-metric')).toHaveAttribute(
      'title',
      'Credit (bonus) given by the broker; counts in equity and margin, cannot be withdrawn: 500.00 USD',
    );
    expect(screen.getByText('Equity').closest('.rtx-trade-footer-metric')).toHaveAttribute(
      'title',
      'Balance plus credit plus current floating P/L: 1 507.00',
    );

    trade.account = { ...trade.account, credit: 0, hasBackendCredit: true };
    rerender(<BottomDock height={300} onClosePosition={vi.fn()} onModifyPosition={vi.fn()} />);
    expect(getFooterLabels()).toEqual(['Balance', 'Equity', 'Margin', 'Free margin', 'Level']);
    expect(screen.queryByText('Credit')).not.toBeInTheDocument();
  });

  it('shows — instead of 0 when credit is not supplied by the backend (hasBackendCredit: false)', () => {
    trade.account = { ...trade.account, credit: 0, hasBackendCredit: false };
    render(<BottomDock height={300} onClosePosition={vi.fn()} onModifyPosition={vi.fn()} />);

    const creditMetric = screen.getByText('Credit').closest('.rtx-trade-footer-metric')!;
    expect(creditMetric).toHaveTextContent('Credit—');
    expect(creditMetric).not.toHaveTextContent('0.00');
    expect(creditMetric.querySelector('[title="Not reported by the trading server"]')).toBeInTheDocument();
  });

  it('shows Credit for an old saved footer setting without a credit key', () => {
    localStorage.setItem('rtx5_trade_footer_metrics_v1', JSON.stringify({
      positions: false,
      balance: true,
      equity: true,
      margin: true,
      freeMargin: true,
      marginLevel: true,
      swap: false,
      commission: false,
    }));
    trade.account = { ...trade.account, credit: 500, hasBackendCredit: true };
    render(<BottomDock height={300} onClosePosition={vi.fn()} onModifyPosition={vi.fn()} />);

    expect(screen.getByText('Credit').parentElement?.lastElementChild).toHaveTextContent('500.00');
  });

  it('hides Credit when switched off in the footer right-click menu and keeps it hidden after reload', () => {
    trade.account = { ...trade.account, credit: 500, hasBackendCredit: true };
    const { container, unmount } = render(<BottomDock height={300} onClosePosition={vi.fn()} onModifyPosition={vi.fn()} />);

    const getFooterLabels = (root: HTMLElement) => Array.from(
      root.querySelectorAll('.rtx-trade-footer-metrics .rtx-trade-metric-label'),
    ).map(node => node.textContent);

    expect(getFooterLabels(container)).toContain('Credit');
    fireEvent.contextMenu(container.querySelector('.rtx-trade-footer')!);
    fireEvent.click(screen.getByRole('menuitem', { name: 'Credit' }));

    expect(getFooterLabels(container)).not.toContain('Credit');
    expect(JSON.parse(localStorage.getItem('rtx5_trade_footer_metrics_v1') || '{}').credit).toBe(false);

    unmount();
    const reloaded = render(<BottomDock height={300} onClosePosition={vi.fn()} onModifyPosition={vi.fn()} />);
    expect(getFooterLabels(reloaded.container)).not.toContain('Credit');
    expect(screen.queryByText('Credit')).not.toBeInTheDocument();
  });
});
