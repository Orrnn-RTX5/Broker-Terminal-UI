import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '../../api/client';
import { ORDER_FEEDBACK_EVENT } from '../../contracts/terminalEvents';
import {
  createTradeOperationContext,
  type TradeOperationContext,
} from '../../features/trading/session/tradeOperationContext';
import type { SymbolMarketStatusState } from '../../hooks/useSymbolMarketStatus';
import { api } from '../../services/api';
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

// T13 dialog-close contract: OrderPanelDialog closes (onClose) only when the
// submission promise resolves, and keeps the dialog open with the reason in
// its existing error display (setError(err.message), inputs preserved) when
// the promise rejects. These tests pin the hook side of that contract.
describe('useOrderExecution dialog-close contract', () => {
  let feedbackMessages: string[];

  beforeEach(() => {
    vi.clearAllMocks();
    feedbackMessages = [];
    const onFeedback = (event: Event) => {
      feedbackMessages.push((event as CustomEvent<{ message: string }>).detail.message);
    };
    window.addEventListener(ORDER_FEEDBACK_EVENT, onFeedback);
    return () => {
      window.removeEventListener(ORDER_FEEDBACK_EVENT, onFeedback);
    };
  });

  it('failure keeps dialog open: rejects with the reason, publishes feedback, preserves inputs', async () => {
    const transportError = new ApiError(400, 'INSUFFICIENT_MARGIN');
    vi.mocked(api.orders.placeMarketOrder).mockRejectedValue(transportError);
    const context = createTradeOperationContext('broker:123', 123, 4);
    const controller = createController(() => context);

    let failure: unknown;
    await act(async () => {
      try {
        await controller.result.current.handleOrderPanelSubmit({
          type: 'buy',
          symbol: 'EURUSD',
          volume: 0.25,
        });
      } catch (error) {
        failure = error;
      }
    });

    // Rejection (not resolution) is what keeps OrderPanelDialog open: its
    // catch shows err.message in the existing error display and never clears
    // the entered volume/price/SL/TP, so the order can be corrected/resubmitted.
    expect(failure).toBeInstanceOf(Error);
    expect((failure as Error).message).toContain('not enough free margin');
    expect((failure as Error).cause).toBe(transportError);
    // Same reason is published to the existing global feedback display.
    expect(feedbackMessages.some((message) => message.includes('not enough free margin'))).toBe(true);
    // Nothing from the success path may run on failure.
    expect(upsertImmediatePosition).not.toHaveBeenCalled();
    expect(controller.refreshPositions).not.toHaveBeenCalled();
    expect(controller.refreshOrdersAndHistory).not.toHaveBeenCalled();
  });

  it('success closes as before: resolves so the dialog dismisses', async () => {
    vi.mocked(api.orders.placeMarketOrder).mockResolvedValue({ ticket: 71 } as never);
    const context = createTradeOperationContext('broker:123', 123, 4);
    const controller = createController(() => context);

    await act(() => controller.result.current.handleOrderPanelSubmit({
      type: 'buy',
      symbol: 'EURUSD',
      volume: 0.25,
    }));

    // Resolution is what lets OrderPanelDialog run onClose().
    expect(api.orders.placeMarketOrder).toHaveBeenCalledWith(
      expect.objectContaining({ login: 123, side: 'BUY', symbol: 'EURUSD', volume: 0.25 }),
      expect.objectContaining({ intentAtMs: expect.any(Number) }),
    );
    expect(upsertImmediatePosition).toHaveBeenCalledOnce();
    expect(controller.refreshPositions).toHaveBeenCalledWith(123);
    expect(controller.refreshOrdersAndHistory).toHaveBeenCalledWith(123);
  });
});
