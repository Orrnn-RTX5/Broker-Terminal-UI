import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '../../services/api';
import { ORDER_FEEDBACK_EVENT } from '../../contracts/terminalEvents';
import {
  createTradeOperationContext,
  type TradeOperationContext,
} from '../../features/trading/session/tradeOperationContext';
import type { SymbolMarketStatusState } from '../../hooks/useSymbolMarketStatus';
import type { DepthOrderRequest } from '../../components/DepthOfMarket';
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

const stopExecution = 'stop' as unknown as DepthOrderRequest['execution'];

describe('useOrderExecution DOM stop side (T17)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(api.orders.placePendingOrder).mockResolvedValue({ ticket: 99 } as never);
  });

  it('places buy_stop for stop-side DOM BUY clicks with derived price', async () => {
    const context = createTradeOperationContext('broker:123', 123, 4);
    const controller = createController(() => context);

    await act(() => controller.result.current.handleDepthOrder({
      side: 'BUY',
      // Buy-stop sits above the market.
      price: 1.105,
      volume: 0.2,
      execution: stopExecution,
    }));

    expect(api.orders.placePendingOrder).toHaveBeenCalledOnce();
    expect(api.orders.placePendingOrder).toHaveBeenCalledWith(expect.objectContaining({
      login: 123,
      symbol: 'EURUSD',
      side: 'buy',
      volume: 0.2,
      type: 'buy_stop',
      price: 1.105,
    }));
  });

  it('places sell_stop for stop-side DOM SELL clicks with derived price', async () => {
    const context = createTradeOperationContext('broker:123', 123, 4);
    const controller = createController(() => context);

    await act(() => controller.result.current.handleDepthOrder({
      side: 'SELL',
      // Sell-stop sits below the market.
      price: 1.085,
      volume: 0.3,
      execution: stopExecution,
    }));

    expect(api.orders.placePendingOrder).toHaveBeenCalledOnce();
    expect(api.orders.placePendingOrder).toHaveBeenCalledWith(expect.objectContaining({
      login: 123,
      symbol: 'EURUSD',
      side: 'sell',
      volume: 0.3,
      type: 'sell_stop',
      price: 1.085,
    }));
  });

  it('keeps limit-side DOM clicks as buy_limit/sell_limit', async () => {
    const context = createTradeOperationContext('broker:123', 123, 4);
    const controller = createController(() => context);

    await act(() => controller.result.current.handleDepthOrder({
      side: 'BUY',
      price: 1.095,
      volume: 0.1,
      execution: 'limit',
    }));
    expect(api.orders.placePendingOrder).toHaveBeenCalledWith(expect.objectContaining({
      side: 'buy',
      type: 'buy_limit',
      price: 1.095,
    }));

    vi.clearAllMocks();
    vi.mocked(api.orders.placePendingOrder).mockResolvedValue({ ticket: 100 } as never);

    await act(() => controller.result.current.handleDepthOrder({
      side: 'SELL',
      price: 1.105,
      volume: 0.1,
      execution: 'limit',
    }));
    expect(api.orders.placePendingOrder).toHaveBeenCalledWith(expect.objectContaining({
      side: 'sell',
      type: 'sell_limit',
      price: 1.105,
    }));
  });

  it('fail-closed on unparseable DOM price: user-visible error, nothing sent', async () => {
    const context = createTradeOperationContext('broker:123', 123, 4);
    const controller = createController(() => context);
    const feedbackEvents: Array<CustomEvent> = [];
    const listener = ((event: Event) => {
      feedbackEvents.push(event as CustomEvent);
    }) as EventListener;
    window.addEventListener(ORDER_FEEDBACK_EVENT, listener);
    try {
      await act(() => controller.result.current.handleDepthOrder({
        side: 'BUY',
        price: Number('not-a-number'),
        volume: 0.1,
        execution: stopExecution,
      }));

      expect(api.orders.placePendingOrder).not.toHaveBeenCalled();
      expect(feedbackEvents.length).toBeGreaterThan(0);
      const last = feedbackEvents[feedbackEvents.length - 1];
      expect(String(last.detail?.message ?? '')).toMatch(/invalid price/i);
    } finally {
      window.removeEventListener(ORDER_FEEDBACK_EVENT, listener);
    }

    // String garbage coerced through the same path must also send nothing.
    vi.clearAllMocks();
    const secondEvents: Array<CustomEvent> = [];
    const secondListener = ((event: Event) => {
      secondEvents.push(event as CustomEvent);
    }) as EventListener;
    window.addEventListener(ORDER_FEEDBACK_EVENT, secondListener);
    try {
      await act(() => controller.result.current.handleDepthOrder({
        side: 'SELL',
        price: 'abc' as unknown as number,
        volume: 0.1,
        execution: 'limit',
      }));

      expect(api.orders.placePendingOrder).not.toHaveBeenCalled();
      expect(secondEvents.length).toBeGreaterThan(0);
    } finally {
      window.removeEventListener(ORDER_FEEDBACK_EVENT, secondListener);
    }
  });
});
