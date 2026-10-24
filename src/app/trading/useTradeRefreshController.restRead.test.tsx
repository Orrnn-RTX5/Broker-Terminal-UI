// @vitest-environment jsdom

import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '../../services/api';
import { useAppStore } from '../../store/useAppStore';
import { useTradeRefreshController } from './useTradeRefreshController';

// Real decode and merge: only the network and history fetches are stubbed.
vi.mock('../../services/api', () => ({
  api: {
    positions: { getPositions: vi.fn() },
    orders: { getPendingOrders: vi.fn(async () => []) },
  },
}));
vi.mock('../../services/terminalHistory', () => ({
  beginTradeHistoryRefresh: vi.fn(),
}));
vi.mock('./orderHistoryRefresh', () => ({
  fetchOrderHistory: vi.fn(async () => ({ trades: [], warning: null })),
  getErrorMessage: vi.fn((_error: unknown, fallback: string) => fallback),
}));

const LOGIN = 200036;

// Open rows as the REST positions endpoint returns them (structurally complete).
const restRow = (ticket: number, side: string, priceOpen: number, stateVersion: string) => ({
  ticket,
  account_login: LOGIN,
  broker_id: 'trivanta-markets',
  symbol: 'ETHUSD',
  side,
  volume: 0.01,
  price_open: priceOpen,
  price_current: priceOpen + 1,
  profit: 0,
  price_sl: 0,
  price_tp: 0,
  state_version: stateVersion,
});

const ROW_12063 = restRow(12063, 'buy', 2412.41, '1');
const ROW_12065 = restRow(12065, 'sell', 2399.32, '2');

describe('REST positions read under active stream frames', () => {
  const positionsStreamVersionRef = { current: 0 };
  const accountIdRef = { current: String(LOGIN) };
  const isAuthenticatedRef = { current: true };

  beforeEach(() => {
    vi.clearAllMocks();
    positionsStreamVersionRef.current = 0;
    useAppStore.getState().reset();
    useAppStore.setState({ accountId: String(LOGIN), authToken: 'session-a', isAuthenticated: true });
  });

  it('closes a confirmed ticket that a patch-kind REST read omits, while pnl frames move the stream version during the read', async () => {
    const { result } = renderHook(() => useTradeRefreshController({
      getLiveTradingLogin: () => LOGIN,
      beginTradeRestRead: () => ({ startedAt: Date.now(), startedVersion: 0, startedLocalMutationVersion: 0 }),
      isStaleTradeRestRead: () => false,
      reconcileOptimisticClosedPositions: (positions) => positions,
      accountIdRef,
      isAuthenticatedRef,
      positionsStreamVersionRef,
    }));

    // Read 1 confirms both tickets.
    vi.mocked(api.positions.getPositions).mockResolvedValueOnce([ROW_12063, ROW_12065] as never);
    await act(async () => { await result.current.refreshPositions(LOGIN); });
    expect(useAppStore.getState().positions.map(({ id }) => id).sort()).toEqual([12063, 12065]);

    // Read 2: while it is in flight, pnl frames move the stream version and touch 12063 only.
    // The server no longer lists 12065 (closed by SL).
    vi.mocked(api.positions.getPositions).mockImplementationOnce(async () => {
      positionsStreamVersionRef.current += 1;
      useAppStore.getState().setPositions(useAppStore.getState().positions.map((position) => (
        position.id === 12063 ? { ...position, currentPrice: 2413.5 } : position
      )));
      return [ROW_12063] as never;
    });
    await act(async () => { await result.current.refreshPositions(LOGIN); });

    expect(useAppStore.getState().positions.map(({ id }) => id)).toEqual([12063]);
  });
});
