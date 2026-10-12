// @vitest-environment jsdom

import React from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BottomDock } from './BottomDock';
import { useLiveAccountMetrics } from '../hooks/useLiveAccountMetrics';
import { formatPrice } from '../utils/symbolUtils';
import type { Account } from '../store/useAppStore';

const trade = vi.hoisted(() => ({
  account: null as Account | null,
  positions: [] as any[],
  pendingPositions: [] as any[],
  loading: false,
  error: null,
  login: 1,
  restBaseUrl: '',
  wsUrl: '',
  wsState: 'connected',
  lastRestAt: null as number | null,
  lastWsAt: null as number | null,
  debug: [],
  refresh: vi.fn(),
  removePosition: vi.fn(),
  removePositionsByMode: vi.fn(),
}));

vi.mock('../hooks/useToolboxTradeData', () => ({ useToolboxTradeData: () => trade }));
vi.mock('../hooks/useLiveAccountMetrics', async importOriginal => {
  const actual = await importOriginal<typeof import('../hooks/useLiveAccountMetrics')>();
  return { ...actual, useLiveAccountMetrics: vi.fn(actual.useLiveAccountMetrics) };
});
vi.mock('../utils/symbolUtils', async importOriginal => {
  const actual = await importOriginal<typeof import('../utils/symbolUtils')>();
  return { ...actual, formatPrice: vi.fn(actual.formatPrice) };
});

const makePosition = (id: number) => ({
  id, symbol: 'BTCUSD', side: 'BUY', volume: 0.01, openPrice: 80000,
  currentPrice: 81000, hasBackendCurrentPrice: true,
  profit: 7, unrealizedPnL: 7, hasBackendProfit: true,
  openTime: '2026-09-21T10:00:00.000Z', sl: 0, tp: 0, swap: 0, commission: 0,
});

describe('Trade rendering latency', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    localStorage.clear();
    trade.positions = [makePosition(71)];
    trade.account = null;
    trade.pendingPositions = [];
    trade.wsState = 'connected';
    trade.lastRestAt = null;
    trade.lastWsAt = null;
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    vi.clearAllMocks();
    localStorage.clear();
  });

  it('does not rerender every trade row for transport timestamps and connection status alone', () => {
    const props = { height: 300, onClosePosition: vi.fn(), onModifyPosition: vi.fn() };
    const { rerender } = render(<BottomDock {...props} />);
    expect(screen.getByText('71')).toBeInTheDocument();
    vi.mocked(useLiveAccountMetrics).mockClear();

    for (let update = 1; update <= 20; update += 1) {
      trade.lastRestAt = update;
      trade.lastWsAt = update;
      trade.wsState = update % 2 ? 'connecting' : 'connected';
      rerender(<BottomDock {...props} />);
    }

    expect(useLiveAccountMetrics).not.toHaveBeenCalled();
    expect(screen.getByText('71')).toBeInTheDocument();
  });

  it('renders newly confirmed, modified and closed positions without waiting for a timer', () => {
    const props = { height: 300, onClosePosition: vi.fn(), onModifyPosition: vi.fn() };
    const { rerender } = render(<BottomDock {...props} />);
    const startedAt = Date.now();

    trade.positions = [...trade.positions, makePosition(72)];
    rerender(<BottomDock {...props} />);
    expect(screen.getByText('72')).toBeInTheDocument();

    trade.positions = [{ ...trade.positions[0], sl: 79000 }, trade.positions[1]];
    rerender(<BottomDock {...props} />);
    expect(screen.getByTitle('Stop Loss: 79000.00 · Modify Position')).toBeInTheDocument();

    trade.positions = [trade.positions[1]];
    rerender(<BottomDock {...props} />);
    expect(screen.queryByText('71')).not.toBeInTheDocument();
    expect(screen.getByText('72')).toBeInTheDocument();
    expect(Date.now()).toBe(startedAt);
  });

  it('publishes changed account metrics without reformatting unchanged trade rows', () => {
    const props = { height: 300, onClosePosition: vi.fn(), onModifyPosition: vi.fn() };
    const { container, rerender } = render(<BottomDock {...props} />);
    expect(screen.getByText('71')).toBeInTheDocument();
    expect(formatPrice).toHaveBeenCalled();
    vi.mocked(formatPrice).mockClear();

    for (let update = 1; update <= 20; update += 1) {
      trade.account = {
        balance: 1000, equity: 1000 + update, margin: 20, freeMargin: 980 + update,
        unrealizedPL: update, marginLevel: 5000, currency: 'USD', leverage: 100,
        publicationToken: `publication-${update}`,
      };
      rerender(<BottomDock {...props} />);
    }

    expect(container.querySelector('.rtx-trade-footer')).toHaveAttribute('data-metrics-publication-token', 'publication-20');
    expect(formatPrice).not.toHaveBeenCalled();
    expect(screen.getByTitle('Current price: 81000.00')).toBeInTheDocument();

    trade.positions = [{ ...trade.positions[0], currentPrice: 81042 }];
    rerender(<BottomDock {...props} />);
    expect(formatPrice).toHaveBeenCalled();
    expect(screen.getByTitle('Current price: 81042.00')).toBeInTheDocument();
  });

  it('shows an in-progress order immediately and replaces it with its confirmed ticket', () => {
    const props = { height: 300, onClosePosition: vi.fn(), onModifyPosition: vi.fn() };
    const { rerender } = render(<BottomDock {...props} />);
    const startedAt = Date.now();

    trade.pendingPositions = [{ ...makePosition(-1), clientOrderId: 'new-order', placementState: 'pending' }];
    rerender(<BottomDock {...props} />);
    expect(screen.getByText('Pending')).toBeVisible();
    expect(screen.getByRole('button', { name: 'Pending' })).toBeDisabled();

    trade.positions = [...trade.positions, makePosition(72)];
    trade.pendingPositions = [];
    rerender(<BottomDock {...props} />);
    expect(screen.queryByText('Pending')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Pending' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Close position 72' })).toBeEnabled();
    expect(Date.now()).toBe(startedAt);
  });
});
