import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { removeToken, setToken } from './client';
import { normalizePendingExpiryToEpochSeconds, tradingApi } from './endpoints';
import { updateDynamicUrls } from '../config/api';

const jsonResponse = (body: unknown): Response =>
  new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } });

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const lastSentBody = (): Record<string, unknown> => {
  const [, init] = vi.mocked(fetch).mock.calls.at(-1) ?? [];
  return JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>;
};

describe('pending stop-limit order wire', () => {
  beforeEach(() => {
    // Fresh Response per call: a Response body can only be read once.
    vi.stubGlobal('fetch', vi.fn().mockImplementation(() => Promise.resolve(jsonResponse({ ok: true }))));
    localStorage.clear();
    sessionStorage.clear();
    removeToken();
    (window as Window & { __RTX_RUNTIME_CONFIG__?: Record<string, unknown> }).__RTX_RUNTIME_CONFIG__ = {
      BACKEND_TARGET: 'web', API_HOST: 'https://broker.example', WS_HOST: 'wss://broker.example',
      BROKER_ID: 'Fixture', DEFAULT_MT5_SERVER: 'Fixture-Live',
    };
    localStorage.setItem('server_url', 'https://broker.example');
    localStorage.setItem('broker_id', 'Fixture');
    updateDynamicUrls();
  });
  afterEach(() => {
    delete (window as Window & { __RTX_RUNTIME_CONFIG__?: Record<string, unknown> }).__RTX_RUNTIME_CONFIG__;
    localStorage.clear(); sessionStorage.clear(); vi.unstubAllGlobals();
  });

  it('sends buy_stop_limit with the backend price_limit field, epoch int expiry, comment, and a UUID v4 idempotency key', async () => {
    setToken('test-access-token');
    await tradingApi.placePendingOrder({
      login: 77, symbol: 'XAUUSD', side: 'buy', volume: 0.1,
      type: 'buy_stop_limit', price: 4170, price_limit: 4171,
      sl: 4160, tp: 4185, expiration: 1770000000,
      comment: 'mt5-stop-limit',
    });
    const sent = lastSentBody();
    expect(String(sent.client_order_id)).toMatch(UUID_V4);
    expect(sent.account_login).toBe(77);
    expect(sent.type).toBe('buy_stop_limit');
    expect(sent.price).toBe(4170);
    expect(sent.price_limit).toBe(4171);
    expect(sent.sl).toBe(4160);
    expect(sent.tp).toBe(4185);
    expect(sent.expiry).toBe(1770000000);
    expect(Number.isInteger(sent.expiry)).toBe(true);
    expect(sent.comment).toBe('mt5-stop-limit');
    // No fill_policy wire field exists: the gateway REST decoder has no
    // fill-policy concept (IOC/FOK refused), so it must never be sent.
    expect(sent).not.toHaveProperty('fill_policy');
  });

  it('sends sell_stop_limit with the stop-limit price and a UUID v4 idempotency key', async () => {
    setToken('test-access-token');
    await tradingApi.placePendingOrder({
      login: 77, symbol: 'EURUSD', side: 'sell', volume: 0.5,
      type: 'sell_stop_limit', price: 1.095, price_limit: 1.094,
    });
    const sent = lastSentBody();
    expect(String(sent.client_order_id)).toMatch(UUID_V4);
    expect(sent.type).toBe('sell_stop_limit');
    expect(sent.price).toBe(1.095);
    expect(sent.price_limit).toBe(1.094);
  });

  it('rejects a stop-limit order without a positive stop-limit price (fail-closed, nothing sent)', () => {
    setToken('test-access-token');
    expect(() => tradingApi.placePendingOrder({
      login: 77, symbol: 'XAUUSD', side: 'buy', volume: 0.1,
      type: 'buy_stop_limit', price: 4170,
    })).toThrow('Stop limit price must be a positive number for stop limit orders');
    expect(vi.mocked(fetch)).not.toHaveBeenCalled();
  });

  it('omits expiry for empty/invalid expiration input — never 0 or NaN', async () => {
    setToken('test-access-token');
    await tradingApi.placePendingOrder({
      login: 77, symbol: 'XAUUSD', side: 'buy', volume: 0.1,
      type: 'buy_limit', price: 4170, expiration: 0,
    });
    expect(lastSentBody().expiry).toBeUndefined();

    await tradingApi.placePendingOrder({
      login: 77, symbol: 'XAUUSD', side: 'buy', volume: 0.1,
      type: 'buy_limit', price: 4170, expiration: 'GTC' as unknown as number,
    });
    const sent = lastSentBody();
    expect(sent.expiry).toBeUndefined();
    expect(sent).not.toHaveProperty('expiration');
    expect(sent.expiry).not.toBe(0);
    expect(Number.isNaN(sent.expiry)).toBe(false);
  });

  it('normalizes millisecond-epoch expiration to whole epoch seconds', async () => {
    setToken('test-access-token');
    await tradingApi.placePendingOrder({
      login: 77, symbol: 'XAUUSD', side: 'buy', volume: 0.1,
      type: 'buy_limit', price: 4170, expiration: 1770000000500,
    });
    expect(lastSentBody().expiry).toBe(1770000000);
  });

  it('keeps stripping the forbidden comment on modify', async () => {
    setToken('test-access-token');
    await tradingApi.modifyPendingOrder(123, {
      price: 65000, price_sl: 64000, price_tp: 66000, comment: 'must not be sent',
    });
    const sent = lastSentBody();
    expect(sent.comment).toBeUndefined();
    expect(sent.price).toBe(65000);
  });
});

describe('normalizePendingExpiryToEpochSeconds', () => {
  it('passes whole epoch seconds through and drops empty/invalid input', () => {
    expect(normalizePendingExpiryToEpochSeconds(1770000000)).toBe(1770000000);
    expect(normalizePendingExpiryToEpochSeconds('1770000000')).toBe(1770000000);
    expect(normalizePendingExpiryToEpochSeconds(1770000000.9)).toBe(1770000000);
    expect(normalizePendingExpiryToEpochSeconds(1770000000500)).toBe(1770000000);
    expect(normalizePendingExpiryToEpochSeconds(undefined)).toBeUndefined();
    expect(normalizePendingExpiryToEpochSeconds('')).toBeUndefined();
    expect(normalizePendingExpiryToEpochSeconds('GTC')).toBeUndefined();
    expect(normalizePendingExpiryToEpochSeconds(0)).toBeUndefined();
    expect(normalizePendingExpiryToEpochSeconds(-5)).toBeUndefined();
    expect(normalizePendingExpiryToEpochSeconds(Number.NaN)).toBeUndefined();
  });
});
