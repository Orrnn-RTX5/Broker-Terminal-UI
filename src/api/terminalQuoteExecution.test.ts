import { beforeEach, describe, expect, it, vi } from 'vitest';
const state = vi.hoisted(() => ({ positions: [{ id: 12, symbol: 'XAUUSD' }], orders: [{ id: '13', symbol: 'EURUSD' }] }));
const guard = vi.hoisted(() => vi.fn());
const session = vi.hoisted(() => ({ value: 1 }));
vi.mock('../services/terminalQuoteFreshness', () => ({ assertTerminalMarketOrderQuote: guard, assertTerminalQuoteFresh: guard, terminalQuoteFreshnessEnabled: () => true, getTerminalQuoteSession: () => session.value }));
vi.mock('../store/useAppStore', () => ({ useAppStore: { getState: () => state } }));
import { apiClient } from './client';
import { prepareOrderSubmission, tradingApi } from './endpoints';
import { tradingV2Api } from './trade';
import { assertStoredExecutionQuoteFresh } from '../services/terminalExecutionQuoteGuard';

describe('execution quote guard', () => {
  beforeEach(() => { vi.restoreAllMocks(); guard.mockReset(); session.value = 1; });
  it('blocks every new price-dependent API route before network traffic', () => {
    guard.mockImplementation(() => { throw new Error('Waiting for a fresh quote'); });
    const post = vi.spyOn(apiClient, 'post'); const put = vi.spyOn(apiClient, 'put');
    const order = { symbol: 'XAUUSD' } as never;
    const calls = [() => tradingApi.placeOrder(order), () => tradingApi.placePendingOrder(order),
      () => tradingApi.modifyPendingOrder(13, {}), () => tradingApi.modifyPosition(12, {}),
      () => tradingV2Api.placeOrder(order), () => tradingV2Api.placePendingOrder(order),
      () => tradingV2Api.placeOco(order), () => tradingV2Api.modifyPendingOrder(13, {}),
      () => tradingV2Api.modifyPosition(12, {}), () => tradingV2Api.closePosition(12)];
    calls.forEach((call) => expect(call).toThrow('Waiting for a fresh quote'));
    expect(post).not.toHaveBeenCalled(); expect(put).not.toHaveBeenCalled();
  });
  it('resolves current positions and orders and fails closed for unknown IDs', () => {
    assertStoredExecutionQuoteFresh('positions', 12); expect(guard).toHaveBeenLastCalledWith('XAUUSD');
    assertStoredExecutionQuoteFresh('orders', 13); expect(guard).toHaveBeenLastCalledWith('EURUSD');
    assertStoredExecutionQuoteFresh('positions', 999); expect(guard).toHaveBeenLastCalledWith('');
  });
  it('keeps cancellations available without a quote', async () => {
    guard.mockImplementation(() => { throw new Error('stale'); });
    const remove = vi.spyOn(apiClient, 'delete').mockResolvedValue({});
    await tradingApi.cancelOrder(13); await tradingV2Api.cancelPendingOrder(13); await tradingV2Api.cancelOco(14);
    expect(remove).toHaveBeenCalledTimes(3); expect(guard).not.toHaveBeenCalled();
  });
  it('rechecks freshness for frozen same-ID unsent fallback and caller-made copies', async () => {
    const order = { symbol: 'XAUUSD', side: 'buy', type: 'market', volume: 0.01, login: 200001, client_order_id: '10000000-0000-4000-8000-000000000001' } as const;
    const prepared = prepareOrderSubmission(order);
    expect(Object.isFrozen(prepared)).toBe(true);
    const generated = prepareOrderSubmission({ ...order, client_order_id: undefined });
    expect(generated.client_order_id).toMatch(/^[0-9a-f-]{36}$/i);
    guard.mockImplementation(() => { throw new Error('stale'); });
    const post = vi.spyOn(apiClient, 'post').mockResolvedValue({});
    expect(() => tradingApi.placeOrder(prepared)).toThrow('stale');
    expect(post).not.toHaveBeenCalled();
    expect(() => tradingApi.placeOrder({ ...prepared })).toThrow('stale');
    expect(() => prepareOrderSubmission(order)).toThrow('stale');
  });
  it('blocks an old prepared intent after session reset even if new-session quotes are fresh', () => {
    const order = { symbol: 'XAUUSD', side: 'buy', type: 'market', volume: 0.01, login: 200001 } as const;
    const prepared = prepareOrderSubmission(order);
    session.value++;
    const post = vi.spyOn(apiClient, 'post').mockResolvedValue({});
    expect(() => tradingApi.placeOrder(prepared)).toThrow('Trading session changed');
    expect(post).not.toHaveBeenCalled();
  });
  it('retains the same UUID for a fresh unsent fallback', async () => {
    const prepared = prepareOrderSubmission({ symbol: 'XAUUSD', side: 'buy', type: 'market', volume: 0.01, login: 200001 });
    const post = vi.spyOn(apiClient, 'post').mockResolvedValue({});
    await tradingApi.placeOrder(prepared);
    expect(post).toHaveBeenCalledWith('/orders', expect.objectContaining({ client_order_id: prepared.client_order_id }), expect.anything());
    expect(guard).toHaveBeenCalledTimes(2);
  });
});
