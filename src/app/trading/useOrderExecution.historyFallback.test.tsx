import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '../../services/api';
import {
  createTradeOperationContext,
  type TradeOperationContext,
} from '../../features/trading/session/tradeOperationContext';
import type { SymbolMarketStatusState } from '../../hooks/useSymbolMarketStatus';
import { ACK_HISTORY_FALLBACK_MS } from './tradeHistoryFreshness';
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

const mountController = (captureTradeOperationContext: (expectedLogin?: number) => TradeOperationContext | null) => {
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
  return { ...result, refreshOrdersAndHistory };
};

describe('useOrderExecution ACK history fallback', () => {
  const context = createTradeOperationContext('broker:123', 123, 4);

  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    vi.mocked(api.orders.placeMarketOrder).mockResolvedValue({ ticket: 71 } as never);
    vi.mocked(api.orders.placePendingOrder).mockResolvedValue({} as never);
  });

  it('a market fill refetches at the ACK and once more after the fallback delay', async () => {
    const controller = mountController(() => context);
    await act(() => controller.result.current.placeOrder('BUY'));
    expect(controller.refreshOrdersAndHistory).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(ACK_HISTORY_FALLBACK_MS);
    expect(controller.refreshOrdersAndHistory).toHaveBeenCalledTimes(2);
    expect(controller.refreshOrdersAndHistory).toHaveBeenLastCalledWith(123);
    vi.advanceTimersByTime(ACK_HISTORY_FALLBACK_MS * 3);
    expect(controller.refreshOrdersAndHistory).toHaveBeenCalledTimes(2);
  });

  it('a pending order ACK gets the same immediate-plus-fallback refetch', async () => {
    const controller = mountController(() => context);
    await act(() => controller.result.current.handleOrderPanelSubmit({
      type: 'sell',
      symbol: 'EURUSD',
      volume: 0.5,
      orderType: 'Limit Order',
      price: 1.095,
    }));
    expect(controller.refreshOrdersAndHistory).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(ACK_HISTORY_FALLBACK_MS);
    expect(controller.refreshOrdersAndHistory).toHaveBeenCalledTimes(2);
  });

  it('unmount clears a pending ACK fallback', async () => {
    const controller = mountController(() => context);
    await act(() => controller.result.current.placeOrder('BUY'));
    expect(controller.refreshOrdersAndHistory).toHaveBeenCalledTimes(1);

    controller.unmount();
    vi.advanceTimersByTime(ACK_HISTORY_FALLBACK_MS * 2);
    expect(controller.refreshOrdersAndHistory).toHaveBeenCalledTimes(1);
  });
});
