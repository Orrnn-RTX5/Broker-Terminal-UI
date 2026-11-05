// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// ui-term-19: a one-click netting add returns the EXISTING position ticket with
// the DEAL price/volume. It must not overwrite the open row (the chart line
// would flash to the single fill price). A new ticket (hedging) is admitted
// at once, as before.

const orderMocks = vi.hoisted(() => ({ placeMarketOrder: vi.fn() }));

vi.mock('../services/api', () => ({
  default: { orders: { placeMarketOrder: orderMocks.placeMarketOrder } },
}));
vi.mock('../app/trading/tradeHistoryFreshness', () => ({
  refreshHistoryAfterFill: vi.fn(),
}));

import { useAppStore, type Position } from '../store/useAppStore';
import { normalizeMarketStatus } from '../utils/marketStatus';
import { OneClickTrading } from './OneClickTrading';

const SYMBOL = 'EURUSD';

const existingRow = (): Position => ({
  id: 501,
  symbol: SYMBOL,
  side: 'BUY',
  volume: 0.2,
  quantity: 0.2,
  openPrice: 1.08,
  open_price: 1.08,
  price_open: 1.08,
  currentPrice: 1.085,
  current_price: 1.085,
  openTime: '2026-11-05T08:00:00.000Z',
  sl: 1.07,
  tp: 1.1,
  swap: 0,
  commission: 0,
  unrealizedPnL: 0,
  profit: 0,
  state_version: 7,
} as unknown as Position);

// Shape of api.ts mapFilledOrderToPosition for an engine result.
const orderResult = (ticket: number, action: string, price: number, volume: number) => ({
  order_ticket: 9001,
  position_ticket: ticket,
  action,
  status: 'filled',
  price,
  id: String(ticket),
  ticket,
  account_login: 10001,
  symbol: SYMBOL,
  side: 'buy',
  quantity: volume,
  volume,
  open_price: price,
  price_open: price,
  current_price: 0,
  price_current: 0,
  price_sl: 0,
  price_tp: 0,
  sl: 0,
  tp: 0,
  commission: 0,
});

const row = (id: number) => (useAppStore.getState().positions as unknown as Array<Position & Record<string, unknown>>)
  .find((position) => Number(position.id) === id);

const clickBuy = async () => {
  render(
    <OneClickTrading
      symbol={SYMBOL}
      timeframe="M5"
      visible
      tradeAllowed
      marketStatus={normalizeMarketStatus({ symbol: SYMBOL, status: 'open' })}
    />,
  );
  const button = screen.getByText('BUY').closest('button');
  if (!(button instanceof HTMLButtonElement)) throw new Error('Expected BUY button');
  await act(async () => {
    fireEvent.click(button);
  });
  await act(async () => {
    await Promise.resolve();
  });
};

describe('OneClickTrading immediate result on an existing (netting) position', () => {
  beforeEach(() => {
    useAppStore.getState().reset();
    orderMocks.placeMarketOrder.mockReset();
    useAppStore.setState({
      isAuthenticated: true,
      accountId: '10001',
      authToken: 'netting-test-token',
      tokenExpiresAt: Date.now() + 60_000,
    });
    useAppStore.getState().setTicks({
      [SYMBOL]: { symbol: SYMBOL, bid: 1.085, ask: 1.0852, spread: 0.0002, timestamp: Date.now(), digits: 5 },
    });
    useAppStore.setState({ positions: [existingRow()] as never });
  });

  afterEach(() => {
    cleanup();
    useAppStore.getState().reset();
    vi.restoreAllMocks();
  });

  it('does not overwrite price_open/volume/SL/TP of the open row with a netting add deal', async () => {
    orderMocks.placeMarketOrder.mockResolvedValue(orderResult(501, 'increased', 1.0852, 0.01));

    await clickBuy();

    expect(orderMocks.placeMarketOrder).toHaveBeenCalledOnce();
    const current = row(501)!;
    expect(current.price_open).toBe(1.08);
    expect(current.openPrice).toBe(1.08);
    expect(current.volume).toBe(0.2);
    expect(current.sl).toBe(1.07);
    expect(current.tp).toBe(1.1);
    expect(current.state_version).toBe(7);
    expect(current.chartEntryPrice).toBeUndefined();
    expect(useAppStore.getState().positions).toHaveLength(1);
  });

  it('still admits a hedging fill (new ticket) at once with its fill price', async () => {
    orderMocks.placeMarketOrder.mockResolvedValue(orderResult(502, 'opened', 1.0853, 0.01));

    await clickBuy();

    const added = row(502)!;
    expect(added).toBeDefined();
    expect(added.openPrice).toBe(1.0853);
    expect(added.volume).toBe(0.01);
    expect(added.chartEntryPrice).toBe(1.0852);
    expect(row(501)!.price_open).toBe(1.08);
    expect(row(501)!.volume).toBe(0.2);
  });
});
