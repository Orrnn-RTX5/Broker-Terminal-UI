import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { RTX5_API_URL, updateDynamicUrls } from '../config/api';
import { api } from './api';

const jsonResponse = (body: unknown, init: ResponseInit = {}) =>
  new Response(JSON.stringify(body), {
    status: init.status ?? 200,
    headers: { 'Content-Type': 'application/json', ...init.headers },
  });

const lastFetchCall = () => {
  const call = vi.mocked(fetch).mock.calls.at(-1);
  if (!call) throw new Error('Expected fetch to be called');
  return {
    url: String(call[0]),
    init: call[1] as RequestInit,
    body: call[1]?.body ? JSON.parse(String(call[1].body)) : undefined,
    headers: call[1]?.headers as Record<string, string>,
  };
};

const originalWindowLocation = window.location;

const clearStoredRouting = () => {
  delete (window as Window & { electronAPI?: unknown }).electronAPI;
  delete (window as Window & { __RTX_RUNTIME_CONFIG__?: Record<string, unknown> }).__RTX_RUNTIME_CONFIG__;
  Object.defineProperty(window, 'location', {
    value: originalWindowLocation,
    configurable: true,
  });
  localStorage.clear();
  (window as Window & { __RTX_RUNTIME_CONFIG__?: Record<string, unknown> }).__RTX_RUNTIME_CONFIG__ = {
    BACKEND_TARGET: 'desktop', API_HOST: 'https://broker.example', WS_HOST: 'wss://broker.example',
    BROKER_ID: 'Fixture', DEFAULT_MT5_SERVER: 'Fixture-Live',
  };
  localStorage.setItem('server_url', 'https://broker.example');
  localStorage.setItem('broker_id', 'Fixture');
  updateDynamicUrls();
};

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

describe('pending order sweep wire (stop-limit / expiry / comment / fill policy)', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ ok: true })));
    clearStoredRouting();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('sends a stop-limit place with type, stop-limit price, epoch int expiry, comment, fill policy, and UUID idempotency key', async () => {
    await api.orders.placePendingOrder({
      login: 100001,
      symbol: 'XAUUSD',
      side: 'buy',
      volume: 0.1,
      type: 'buy_stop_limit',
      price: 4170,
      price_limit: 4171,
      price_sl: 4160,
      price_tp: 4185,
      expiration: 1770000000,
      comment: 'sweep-stop-limit',
    });

    const call = lastFetchCall();
    expect(call.url).toBe(`${RTX5_API_URL}/api/v2/orders/pending`);
    expect(String(call.body.client_order_id)).toMatch(UUID_V4);
    expect(call.body).toMatchObject({
      account_login: 100001,
      symbol: 'XAUUSD',
      side: 'buy',
      volume: 0.1,
      type: 'buy_stop_limit',
      price: 4170,
      // Backend wire name is price_limit (gateway placePendingOrderWireRequest).
      price_limit: 4171,
      sl: 4160,
      tp: 4185,
      expiry: 1770000000,
      comment: 'sweep-stop-limit',
    });
    // No fill_policy wire field exists on the gateway REST decoder.
    expect(call.body).not.toHaveProperty('fill_policy');
    expect(Number.isInteger(call.body.expiry)).toBe(true);
  });

  it('rejects unknown pending types and stop-limit orders without a stop-limit price', async () => {
    await expect(api.orders.placePendingOrder({
      login: 100001, symbol: 'XAUUSD', side: 'buy', volume: 0.1,
      type: 'buy_stop_limit', price: 4170,
    })).rejects.toThrow('Stop limit price must be a positive number for stop limit orders');

    await expect(api.orders.placePendingOrder({
      login: 100001, symbol: 'XAUUSD', side: 'buy', volume: 0.1,
      type: 'buy_take_profit' as unknown as 'buy_limit', price: 4170,
    })).rejects.toThrow('Pending order type must be');
  });

  it('omits expiry for empty/invalid expiration input — never 0 or NaN', async () => {
    await api.orders.placePendingOrder({
      login: 100001, symbol: 'XAUUSD', side: 'buy', volume: 0.1,
      type: 'buy_limit', price: 4170,
      expiration: 'GTC' as unknown as number,
    });
    const call = lastFetchCall();
    expect(call.body.expiry).toBeUndefined();
    expect(call.body).not.toHaveProperty('expiration');
    expect(call.body.expiry).not.toBe(0);
  });

  it('never sends comment or fill policy on modify', async () => {
    await api.orders.modifyPendingOrder(112233, {
      price: 2301,
      price_sl: 2291,
      price_tp: 2326,
      comment: 'must not be sent',
      fill_policy: 'Fill or Kill',
    } as never);

    const call = lastFetchCall();
    expect(call.url).toBe(`${RTX5_API_URL}/api/v2/orders/pending/112233`);
    expect(call.body).toMatchObject({ price: 2301, sl: 2291, tp: 2326 });
    expect(call.body).not.toHaveProperty('comment');
    expect(call.body).not.toHaveProperty('fill_policy');
  });
});
