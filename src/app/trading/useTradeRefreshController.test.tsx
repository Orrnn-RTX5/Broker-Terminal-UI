import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '../../services/api';
import { useAppStore, type Position } from '../../store/useAppStore';
import { applyOpenPositionSnapshot } from './positionRuntime';
import { fetchOrderHistory } from './orderHistoryRefresh';
import { useTradeRefreshController } from './useTradeRefreshController';

vi.mock('../../services/api', () => ({
  api: {
    positions: { getPositions: vi.fn() },
    orders: { getPendingOrders: vi.fn() },
  },
}));

vi.mock('../../services/terminalHistory', () => ({
  beginTradeHistoryRefresh: vi.fn(),
}));

vi.mock('../../services/tradePositionStream', () => ({
  decodePositionStreamMessage: vi.fn(() => null),
  applyPositionStreamUpdate: vi.fn(),
}));

vi.mock('./orderHistoryRefresh', () => ({
  fetchOrderHistory: vi.fn(async () => ({ trades: [], warning: null })),
  getErrorMessage: vi.fn((error: unknown, fallback: string) => (
    error instanceof Error ? error.message : fallback
  )),
}));

vi.mock('./positionRuntime', () => ({
  applyOpenPositionSnapshot: vi.fn(),
  normalizePositions: vi.fn((positions: Position[]) => positions),
}));

const position = (id: number): Position => ({
  id,
  symbol: 'EURUSD',
  side: 'BUY',
  volume: 0.1,
  openPrice: 1.1,
  currentPrice: 1.11,
  openTime: '2026-09-28T00:00:00.000Z',
  sl: 0,
  tp: 0,
  swap: 0,
  commission: 0,
  unrealizedPnL: 1,
});

const createController = () => {
  const accountIdRef = { current: '123' };
  const isAuthenticatedRef = { current: true };
  const positionsStreamVersionRef = { current: 0 };
  const onRender = vi.fn();
  const hook = renderHook(() => {
    onRender();
    return useTradeRefreshController({
      getLiveTradingLogin: () => Number(accountIdRef.current) || null,
      beginTradeRestRead: () => ({
        startedAt: Date.now(),
        startedVersion: 0,
        startedLocalMutationVersion: 0,
      }),
      isStaleTradeRestRead: () => false,
      reconcileOptimisticClosedPositions: (positions) => positions,
      accountIdRef,
      isAuthenticatedRef,
      positionsStreamVersionRef,
    });
  });

  return { ...hook, accountIdRef, isAuthenticatedRef, onRender };
};

describe('useTradeRefreshController', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useAppStore.setState({
      accountId: '123',
      authToken: 'session-a',
      isAuthenticated: true,
      positions: [],
      orders: [],
      trades: [],
    });
  });

  it('publishes pending orders without rerendering the controller owner', async () => {
    const orders = [{ id: '810', symbol: 'EURUSD' }];
    vi.mocked(api.orders.getPendingOrders).mockResolvedValue(orders as never);
    const controller = createController();
    const rendersBeforeRefresh = controller.onRender.mock.calls.length;

    await act(() => controller.result.current.refreshOrdersAndHistory(123));

    expect(api.orders.getPendingOrders).toHaveBeenCalledWith(123);
    expect(fetchOrderHistory).toHaveBeenCalledWith(123);
    expect(useAppStore.getState().orders).toEqual(orders);
    expect(controller.onRender).toHaveBeenCalledTimes(rendersBeforeRefresh);
  });

  it('does not publish pending orders when the account changes during refresh', async () => {
    let resolveOrders!: (orders: unknown[]) => void;
    vi.mocked(api.orders.getPendingOrders).mockReturnValue(new Promise((resolve) => {
      resolveOrders = resolve;
    }) as never);
    const controller = createController();
    let refreshPromise!: Promise<void>;
    act(() => {
      refreshPromise = controller.result.current.refreshOrdersAndHistory(123);
    });

    controller.accountIdRef.current = '456';
    useAppStore.setState({ accountId: '456', authToken: 'session-b' });
    await act(async () => {
      resolveOrders([{ id: '811', symbol: 'EURUSD' }]);
      await refreshPromise;
    });

    expect(useAppStore.getState().orders).toEqual([]);
  });

  it('publishes a REST position snapshot while the captured account session is current', async () => {
    const positions = [position(71)];
    vi.mocked(api.positions.getPositions).mockResolvedValue(positions as never);
    const controller = createController();

    await act(() => controller.result.current.refreshPositions(123));

    expect(api.positions.getPositions).toHaveBeenCalledWith(123);
    expect(applyOpenPositionSnapshot).toHaveBeenCalledWith(positions, { readStartedAt: expect.any(Number), complete: true });
  });

  it('drops a REST position response after the account session changes', async () => {
    let resolvePositions!: (positions: Position[]) => void;
    vi.mocked(api.positions.getPositions).mockReturnValue(new Promise((resolve) => {
      resolvePositions = resolve;
    }) as never);
    const controller = createController();

    let refreshPromise!: Promise<void>;
    act(() => {
      refreshPromise = controller.result.current.refreshPositions(123);
    });
    await vi.waitFor(() => expect(api.positions.getPositions).toHaveBeenCalledWith(123));

    controller.accountIdRef.current = '456';
    useAppStore.setState({ accountId: '456', authToken: 'session-b' });
    await act(async () => {
      resolvePositions([position(72)]);
      await refreshPromise;
    });

    expect(applyOpenPositionSnapshot).not.toHaveBeenCalled();
  });
});
