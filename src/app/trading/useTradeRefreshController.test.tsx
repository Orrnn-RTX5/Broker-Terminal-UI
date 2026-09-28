import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '../../services/api';
import { useAppStore, type Position } from '../../store/useAppStore';
import { applyOpenPositionSnapshot } from './positionRuntime';
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
  const hook = renderHook(() => useTradeRefreshController({
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
    setOrders: vi.fn(),
  }));

  return { ...hook, accountIdRef, isAuthenticatedRef };
};

describe('useTradeRefreshController', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useAppStore.setState({
      accountId: '123',
      authToken: 'session-a',
      isAuthenticated: true,
      positions: [],
    });
  });

  it('publishes a REST position snapshot while the captured account session is current', async () => {
    const positions = [position(71)];
    vi.mocked(api.positions.getPositions).mockResolvedValue(positions as never);
    const controller = createController();

    await act(() => controller.result.current.refreshPositions(123));

    expect(api.positions.getPositions).toHaveBeenCalledWith(123);
    expect(applyOpenPositionSnapshot).toHaveBeenCalledWith(positions);
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
