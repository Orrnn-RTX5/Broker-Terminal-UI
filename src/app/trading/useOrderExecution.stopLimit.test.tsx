import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '../../services/api';
import {
  createTradeOperationContext,
  type TradeOperationContext,
} from '../../features/trading/session/tradeOperationContext';
import type { SymbolMarketStatusState } from '../../hooks/useSymbolMarketStatus';
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
  getChartEntryPriceForSymbol: vi.fn(() => 4173.5),
  normalizePositions: vi.fn(() => [{ id: 71, symbol: 'XAUUSD' }]),
  upsertImmediatePosition: vi.fn(),
}));

const openMarketStatus: SymbolMarketStatusState = {
  symbol: 'XAUUSD',
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
    selectedSymbol: 'XAUUSD',
    volume: 0.1,
    setVolume: vi.fn(),
    domSymbol: 'XAUUSD',
    orderPanelSymbol: 'XAUUSD',
    getAllowedSymbol: (symbol) => String(symbol),
    getLiveTradingLogin: () => 123,
    captureTradeOperationContext,
    isTradeOperationContextCurrent: () => true,
    refreshPositions,
    refreshOrdersAndHistory,
  }));
  return { ...result, refreshPositions, refreshOrdersAndHistory };
};

describe('useOrderExecution pending sweep (stop-limit / expiry / comment, never fill policy)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(api.orders.placePendingOrder).mockResolvedValue({ ticket: 72 } as never);
  });

  it('maps Stop Limit Order submissions to *_stop_limit with the stop-limit price, epoch int expiry and comment (no fill policy on the wire)', async () => {
    const context = createTradeOperationContext('broker:123', 123, 4);
    const controller = createController(() => context);

    await act(() => controller.result.current.handleOrderPanelSubmit({
      type: 'buy',
      symbol: 'XAUUSD',
      volume: 0.1,
      orderType: 'Stop Limit Order',
      price: 4170,
      stopLimitPrice: 4171,
      priceSl: 4160,
      priceTp: 4185,
      expirationTimestamp: 1770000000000,
      comment: 'sweep-dialog',
      fillPolicy: 'Fill or Kill',
    }));

    expect(api.orders.placePendingOrder).toHaveBeenCalledWith({
      login: 123,
      symbol: 'XAUUSD',
      side: 'buy',
      volume: 0.1,
      type: 'buy_stop_limit',
      price: 4170,
      // Backend wire name is price_limit; no fill_policy is ever sent.
      price_limit: 4171,
      price_sl: 4160,
      price_tp: 4185,
      expiration: 1770000000,
      comment: 'sweep-dialog',
    });
    expect(controller.refreshOrdersAndHistory).toHaveBeenCalledWith(123);
  });

  it('fails closed without sending when the stop-limit price is missing', async () => {
    const context = createTradeOperationContext('broker:123', 123, 4);
    const controller = createController(() => context);

    await act(() => controller.result.current.handleOrderPanelSubmit({
      type: 'sell',
      symbol: 'XAUUSD',
      volume: 0.1,
      orderType: 'Stop Limit Order',
      price: 4175,
    }));

    expect(api.orders.placePendingOrder).not.toHaveBeenCalled();
    expect(controller.refreshOrdersAndHistory).not.toHaveBeenCalled();
  });

  it('omits expiration for the dialog GTC display string — never 0 or NaN', async () => {
    const context = createTradeOperationContext('broker:123', 123, 4);
    const controller = createController(() => context);

    await act(() => controller.result.current.handleOrderPanelSubmit({
      type: 'sell',
      symbol: 'XAUUSD',
      volume: 0.5,
      orderType: 'Limit Order',
      price: 4180,
      expiration: 'GTC',
      comment: 'gtc-limit',
    }));

    const payload = vi.mocked(api.orders.placePendingOrder).mock.calls[0][0] as unknown as Record<string, unknown>;
    expect(payload.type).toBe('sell_limit');
    expect(payload).not.toHaveProperty('expiration');
    expect(payload).not.toHaveProperty('expiry');
    expect(payload.comment).toBe('gtc-limit');
  });
});
