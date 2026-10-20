// @vitest-environment jsdom

import React from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BottomDock } from '../../../components/BottomDock';

// Row-menu bulk entries must reach the gated App.handleCloseBulk WITHOUT
// issuing any trade call themselves. Confirmation and execution belong to
// the shared BulkCloseConfirmDialog gate in App, so dismissing aborts with
// zero API calls by construction.
const trade = vi.hoisted(() => ({
  account: null as any,
  positions: [] as any[],
  refresh: vi.fn(),
}));

vi.mock('../../../hooks/useToolboxTradeData', () => ({
  useToolboxTradeData: () => ({
    account: trade.account,
    positions: trade.positions,
    pendingPositions: [],
    loading: false,
    error: null,
    login: 1,
    restBaseUrl: '',
    wsUrl: '',
    wsState: 'connected',
    lastRestAt: null,
    lastWsAt: null,
    debug: [],
    refresh: trade.refresh,
    removePosition: vi.fn(),
    removePositionsByMode: vi.fn(),
  }),
}));

const openBulkSubmenu = () => {
  const row = screen.getByText('71').closest('tr')!;
  fireEvent.contextMenu(row);
  fireEvent.click(screen.getByRole('menuitem', { name: 'Bulk Operations' }));
};

describe('row-menu bulk-close entries route to confirmation', () => {
  beforeEach(() => {
    localStorage.clear();
    trade.account = null;
    trade.positions = [
      {
        id: 71, symbol: 'BTCUSD', side: 'BUY', volume: 0.01, openPrice: 80000,
        price_current: 81000, currentPrice: 81000, hasBackendCurrentPrice: true,
        profit: 7, unrealizedPnL: 7, hasBackendProfit: true,
        openTime: '2026-09-21T10:00:00.000Z', sl: 0, tp: 0, swap: 0, commission: 0,
      },
      {
        id: 72, symbol: 'BTCUSD', side: 'SELL', volume: 0.02, openPrice: 81000,
        price_current: 80000, currentPrice: 80000, hasBackendCurrentPrice: true,
        profit: -3, unrealizedPnL: -3, hasBackendProfit: true,
        openTime: '2026-09-21T10:00:00.000Z', sl: 0, tp: 0, swap: 0, commission: 0,
      },
    ];
  });

  afterEach(() => {
    cleanup();
    localStorage.clear();
    vi.clearAllMocks();
  });

  it('routes row-menu Close All to the gated bulk handler without trading itself', () => {
    const onCloseBulk = vi.fn();
    const onClosePosition = vi.fn();
    render(
      <BottomDock height={300} onClosePosition={onClosePosition} onModifyPosition={vi.fn()} onCloseBulk={onCloseBulk} />,
    );

    openBulkSubmenu();
    fireEvent.click(screen.getByRole('menuitem', { name: 'Close All' }));

    expect(onCloseBulk).toHaveBeenCalledTimes(1);
    expect(onCloseBulk).toHaveBeenCalledWith('ALL', undefined);
    expect(onClosePosition).not.toHaveBeenCalled();
  });

  it('routes row-menu Close In-Profit to the gated bulk handler without trading itself', () => {
    const onCloseBulk = vi.fn();
    const onClosePosition = vi.fn();
    render(
      <BottomDock height={300} onClosePosition={onClosePosition} onModifyPosition={vi.fn()} onCloseBulk={onCloseBulk} />,
    );

    openBulkSubmenu();
    fireEvent.click(screen.getByRole('menuitem', { name: 'Close In-Profit' }));

    expect(onCloseBulk).toHaveBeenCalledTimes(1);
    expect(onCloseBulk).toHaveBeenCalledWith('WINNERS', undefined);
    expect(onClosePosition).not.toHaveBeenCalled();
  });

  it('routes row-menu Close In-Loss to the gated bulk handler without trading itself', () => {
    const onCloseBulk = vi.fn();
    const onClosePosition = vi.fn();
    render(
      <BottomDock height={300} onClosePosition={onClosePosition} onModifyPosition={vi.fn()} onCloseBulk={onCloseBulk} />,
    );

    openBulkSubmenu();
    fireEvent.click(screen.getByRole('menuitem', { name: 'Close In-Loss' }));

    expect(onCloseBulk).toHaveBeenCalledTimes(1);
    expect(onCloseBulk).toHaveBeenCalledWith('LOSERS', undefined);
    expect(onClosePosition).not.toHaveBeenCalled();
  });

  it('routes row-menu Close All <symbol> with the row symbol and without trading itself', () => {
    const onCloseBulk = vi.fn();
    const onClosePosition = vi.fn();
    render(
      <BottomDock height={300} onClosePosition={onClosePosition} onModifyPosition={vi.fn()} onCloseBulk={onCloseBulk} />,
    );

    openBulkSubmenu();
    fireEvent.click(screen.getByRole('menuitem', { name: 'Close All BTCUSD' }));

    expect(onCloseBulk).toHaveBeenCalledTimes(1);
    expect(onCloseBulk).toHaveBeenCalledWith('ALL', 'BTCUSD');
    expect(onClosePosition).not.toHaveBeenCalled();
  });

  it('sends nothing when the row menu is never opened', () => {
    const onCloseBulk = vi.fn();
    const onClosePosition = vi.fn();
    render(
      <BottomDock height={300} onClosePosition={onClosePosition} onModifyPosition={vi.fn()} onCloseBulk={onCloseBulk} />,
    );

    expect(screen.getByText('71').closest('tr')).toBeInTheDocument();
    expect(onCloseBulk).not.toHaveBeenCalled();
    expect(onClosePosition).not.toHaveBeenCalled();
  });
});
