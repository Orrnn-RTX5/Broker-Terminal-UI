import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '../../services/api';
import { useAppStore, type Position } from '../../store/useAppStore';
import { applyOpenPositionSnapshot } from './positionRuntime';
import { fetchOrderHistory } from './orderHistoryRefresh';
import { useTradeRefreshController } from './useTradeRefreshController';

vi.mock('../../services/api', () => ({
  api: {
    account: { getAccountMetrics: vi.fn() },
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
  normalizeAccountSummary: vi.fn((raw: unknown) => raw),
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

  it('refreshes account metrics in parallel when positions are refreshed after open or close', async () => {
    const positions = [position(71)];
    const metrics = {
      balance: 1000,
      equity: 1005,
      margin: 25,
      freeMargin: 980,
      marginLevel: 4020,
      unrealizedPL: 5,
      currency: 'USD',
      leverage: 100,
    };
    vi.mocked(api.positions.getPositions).mockResolvedValue(positions as never);
    vi.mocked(api.account.getAccountMetrics).mockResolvedValue(metrics as never);
    const controller = createController();

    await act(() => controller.result.current.refreshPositions(123));

    expect(api.positions.getPositions).toHaveBeenCalledWith(123);
    expect(api.account.getAccountMetrics).toHaveBeenCalledWith(123);
    expect(useAppStore.getState().account).toMatchObject({
      margin: 25,
      freeMargin: 980,
      marginLevel: 4020,
    });
  });

  it('does not block a newly switched account refresh behind the previous account in-flight requests', async () => {
    let resolveFirstAccountPositions!: (positions: Position[]) => void;
    let resolveFirstAccountOrders!: (orders: unknown[]) => void;
    vi.mocked(api.positions.getPositions)
      .mockImplementationOnce(() => new Promise((resolve) => {
        resolveFirstAccountPositions = resolve;
      }) as never)
      .mockResolvedValueOnce([position(99)] as never);
    vi.mocked(api.orders.getPendingOrders)
      .mockImplementationOnce(() => new Promise((resolve) => {
        resolveFirstAccountOrders = resolve;
      }) as never)
      .mockResolvedValueOnce([{ id: '900', symbol: 'GBPUSD' }] as never);

    const controller = createController();
    act(() => {
      void controller.result.current.refreshPositions(123);
      void controller.result.current.refreshOrdersAndHistory(123);
    });
    await vi.waitFor(() => expect(api.positions.getPositions).toHaveBeenCalledWith(123));

    controller.accountIdRef.current = '456';
    useAppStore.setState({ accountId: '456', authToken: 'session-b' });

    await act(async () => {
      await Promise.all([
        controller.result.current.refreshPositions(456),
        controller.result.current.refreshOrdersAndHistory(456),
      ]);
    });

    expect(api.positions.getPositions).toHaveBeenCalledWith(456);
    expect(api.orders.getPendingOrders).toHaveBeenCalledWith(456);
    expect(applyOpenPositionSnapshot).toHaveBeenCalledWith([position(99)], {
      readStartedAt: expect.any(Number),
      complete: true,
    });
    expect(useAppStore.getState().orders).toEqual([{ id: '900', symbol: 'GBPUSD' }]);

    await act(async () => {
      resolveFirstAccountPositions([position(1)]);
      resolveFirstAccountOrders([{ id: '100', symbol: 'EURUSD' }]);
    });
    expect(useAppStore.getState().orders).toEqual([{ id: '900', symbol: 'GBPUSD' }]);
  });
});
