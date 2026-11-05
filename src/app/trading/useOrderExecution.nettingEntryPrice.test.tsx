import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '../../services/api';
import {
  createTradeOperationContext,
} from '../../features/trading/session/tradeOperationContext';
import type { SymbolMarketStatusState } from '../../hooks/useSymbolMarketStatus';
import { useAppStore, type Position } from '../../store/useAppStore';
import { useOrderExecution } from './useOrderExecution';

// ui-term-19: on a netting account the market-order result of an add/reduce
// carries the existing position ticket but the DEAL price/volume. It must not
// overwrite the open row (that flashed the chart line to the single fill price
// until the re-averaged position frame arrived). A new ticket (hedging) is
// still admitted at once.

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

vi.mock('./tradeHistoryFreshness', () => ({
  createHistoryFreshnessOwner: vi.fn(() => ({})),
  disposeHistoryFreshnessOwner: vi.fn(),
  refreshHistoryAfterFill: vi.fn(),
}));

vi.mock('./positionRuntime', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./positionRuntime')>()),
  getChartEntryPriceForSymbol: vi.fn(() => 1.1062),
}));

const SYMBOL = 'EURUSD';

const openMarketStatus: SymbolMarketStatusState = {
  symbol: SYMBOL,
  status: 'open',
  isOpen: true,
  isTradeBlocked: false,
  label: 'Market Open',
  loading: false,
  error: null,
  refreshedAt: Date.now(),
};

const existingRow = (): Position => ({
  id: 501,
  symbol: SYMBOL,
  side: 'BUY',
  volume: 0.2,
  quantity: 0.2,
  openPrice: 1.1,
  open_price: 1.1,
  price_open: 1.1,
  currentPrice: 1.105,
  current_price: 1.105,
  price_current: 1.105,
  openTime: '2026-11-05T08:00:00.000Z',
  sl: 1.09,
  tp: 1.12,
  swap: 0,
  commission: 0,
  unrealizedPnL: 0,
  profit: 0,
  state_version: 7,
} as unknown as Position);

// Shape of api.ts mapFilledOrderToPosition for an engine result.
const orderResult = (ticket: number, action: string, price: number, volume: number) => ({
  ...{ order_ticket: 9001, position_ticket: ticket, action, status: 'filled', price },
  id: String(ticket),
  ticket,
  account_login: 123,
  symbol: SYMBOL,
  side: 'buy',
  quantity: volume,
  volume,
  open_price: price,
  price_open: price,
  current_price: 0,
  price_current: 0,
  hasBackendCurrentPrice: false,
  hasBackendProfit: false,
  price_sl: 0,
  price_tp: 0,
  sl: 0,
  tp: 0,
  commission: 0,
});

const createController = () => {
  const context = createTradeOperationContext('broker:123', 123, 4);
  const refreshPositions = vi.fn().mockResolvedValue(undefined);
  const result = renderHook(() => useOrderExecution({
    selectedMarketStatus: openMarketStatus,
    selectedSymbol: SYMBOL,
    volume: 0.1,
    setVolume: vi.fn(),
    domSymbol: SYMBOL,
    orderPanelSymbol: SYMBOL,
    getAllowedSymbol: (symbol) => String(symbol),
    getLiveTradingLogin: () => 123,
    captureTradeOperationContext: () => context,
    isTradeOperationContextCurrent: () => true,
    refreshPositions,
    refreshOrdersAndHistory: vi.fn().mockResolvedValue(undefined),
  }));
  return { ...result, refreshPositions };
};

const row = (id: number) => (useAppStore.getState().positions as unknown as Position[])
  .find((position) => Number(position.id) === id) as (Position & Record<string, unknown>) | undefined;

describe('useOrderExecution immediate result on an existing (netting) position', () => {
  let prevPositions: unknown;

  beforeEach(() => {
    vi.clearAllMocks();
    prevPositions = useAppStore.getState().positions;
    useAppStore.setState({ positions: [existingRow()] as never });
  });

  afterEach(() => {
    useAppStore.setState({ positions: prevPositions as never });
  });

  it('does not overwrite price_open/volume/SL/TP of the open row with a netting add deal (quick trade)', async () => {
    vi.mocked(api.orders.placeMarketOrder).mockResolvedValue(orderResult(501, 'increased', 1.1062, 0.1) as never);
    const controller = createController();

    await act(() => controller.result.current.placeOrder('BUY'));

    const current = row(501)!;
    expect(current.price_open).toBe(1.1);
    expect(current.openPrice).toBe(1.1);
    expect(current.volume).toBe(0.2);
    expect(current.sl).toBe(1.09);
    expect(current.tp).toBe(1.12);
    expect(current.state_version).toBe(7);
    expect(current.chartEntryPrice).toBeUndefined();
    // The authoritative row still comes from the stream and the REST refresh.
    expect(controller.refreshPositions).toHaveBeenCalledWith(123);
  });

  it('does not overwrite the open row with a netting add deal from the order dialog', async () => {
    vi.mocked(api.orders.placeMarketOrder).mockResolvedValue(orderResult(501, 'increased', 1.1062, 0.1) as never);
    const controller = createController();

    await act(() => controller.result.current.handleOrderPanelSubmit({ type: 'buy', symbol: SYMBOL, volume: 0.1 }));

    const current = row(501)!;
    expect(current.price_open).toBe(1.1);
    expect(current.volume).toBe(0.2);
  });

  it('still admits a hedging fill (new ticket) at once with its fill price and click quote', async () => {
    vi.mocked(api.orders.placeMarketOrder).mockResolvedValue(orderResult(502, 'opened', 1.1063, 0.1) as never);
    const controller = createController();

    await act(() => controller.result.current.placeOrder('BUY'));

    const added = row(502)!;
    expect(added).toBeDefined();
    expect(added.price_open).toBe(1.1063);
    expect(added.volume).toBe(0.1);
    expect(added.chartEntryPrice).toBe(1.1062);
    // The other open row is untouched.
    expect(row(501)!.price_open).toBe(1.1);
    expect(row(501)!.volume).toBe(0.2);
  });
});
