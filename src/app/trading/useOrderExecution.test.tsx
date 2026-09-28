import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '../../services/api';
import {
  createTradeOperationContext,
  type TradeOperationContext,
} from '../../features/trading/session/tradeOperationContext';
import type { SymbolMarketStatusState } from '../../hooks/useSymbolMarketStatus';
import { upsertImmediatePosition } from './positionRuntime';
import { useOrderExecution } from './useOrderExecution';

vi.mock('../../services/tradingAuthGate', () => ({
  requireTradingAuth: vi.fn(() => true),
}));

vi.mock('../../services/api', () => ({
  api: {
    orders: {
      placeMarketOrder: vi.fn(),
      placePendingOrder: vi.fn(),
    },
  },
}));

vi.mock('./positionRuntime', () => ({
  getChartEntryPriceForSymbol: vi.fn(() => 1.101),
  normalizePositions: vi.fn(() => [{ id: 71, symbol: 'EURUSD' }]),
  upsertImmediatePosition: vi.fn(),
}));

const openMarketStatus: SymbolMarketStatusState = {
  symbol: 'EURUSD',
  status: 'open',
  isOpen: true,
  isTradeBlocked: false,
  label: 'Market Open',
  loading: false,
  error: null,
  refreshedAt: Date.now(),
};

const createController = (
  captureTradeOperationContext: (expectedLogin?: number) => TradeOperationContext | null,
) => {
  const refreshPositions = vi.fn().mockResolvedValue(undefined);
  const refreshOrdersAndHistory = vi.fn().mockResolvedValue(undefined);
  const result = renderHook(() => useOrderExecution({
    selectedMarketStatus: openMarketStatus,
    selectedSymbol: 'EURUSD',
    volume: 0.1,
    setVolume: vi.fn(),
    domSymbol: 'EURUSD',
    orderPanelSymbol: 'EURUSD',
    getAllowedSymbol: (symbol) => String(symbol),
    getLiveTradingLogin: () => 123,
    captureTradeOperationContext,
    isTradeOperationContextCurrent: () => true,
    refreshPositions,
    refreshOrdersAndHistory,
  }));
  return { ...result, refreshPositions, refreshOrdersAndHistory };
};

describe('useOrderExecution', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(api.orders.placeMarketOrder).mockResolvedValue({ ticket: 71 } as never);
  });

  it('publishes the immediate position and refreshes only within the captured session', async () => {
    const context = createTradeOperationContext('broker:123', 123, 4);
    const captureContext = vi.fn(() => context);
    const controller = createController(captureContext);

    await act(() => controller.result.current.placeOrder('BUY'));

    expect(api.orders.placeMarketOrder).toHaveBeenCalledWith(
      expect.objectContaining({ login: 123, side: 'BUY', symbol: 'EURUSD', volume: 0.1 }),
      expect.objectContaining({ intentAtMs: expect.any(Number) }),
    );
    expect(upsertImmediatePosition).toHaveBeenCalledOnce();
    expect(controller.refreshPositions).toHaveBeenCalledWith(123);
    expect(controller.refreshOrdersAndHistory).toHaveBeenCalledWith(123);
  });

  it('drops a successful response after the broker-account session changes', async () => {
    const originalContext = createTradeOperationContext('broker:123', 123, 4);
    const replacementContext = createTradeOperationContext('broker:456', 456, 5);
    const captureContext = vi.fn<(expectedLogin?: number) => TradeOperationContext | null>()
      .mockReturnValueOnce(originalContext)
      .mockReturnValueOnce(replacementContext);
    const controller = createController(captureContext);

    await act(() => controller.result.current.placeOrder('BUY'));

    expect(api.orders.placeMarketOrder).toHaveBeenCalledOnce();
    expect(upsertImmediatePosition).not.toHaveBeenCalled();
    expect(controller.refreshPositions).not.toHaveBeenCalled();
    expect(controller.refreshOrdersAndHistory).not.toHaveBeenCalled();
  });
});
