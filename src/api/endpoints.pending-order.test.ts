import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { removeToken, setToken } from './client';
import { tradingApi } from './endpoints';
import { updateDynamicUrls } from '../config/api';

const jsonResponse = (body: unknown): Response =>
  new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } });

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

describe('pending order API', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ ok: true })));
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

  it('sends a UUID v4 client_order_id so the gateway can de-duplicate the command', async () => {
    setToken('test-access-token');
    await tradingApi.placePendingOrder({
      login: 77, symbol: 'BTCUSD', side: 'buy', volume: 0.01, type: 'buy_limit', price: 64000,
    });
    const [, init] = vi.mocked(fetch).mock.calls[0];
    const sent = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>;
    expect(String(sent.client_order_id)).toMatch(UUID_V4);
    expect(sent.account_login).toBe(77);
    expect(sent.type).toBe('buy_limit');
  });

  it('keeps a caller-supplied client_order_id and rejects a non-UUID one', async () => {
    setToken('test-access-token');
    const id = '6f1c2b0a-1d2e-4f3a-9b8c-7d6e5f4a3b2c';
    await tradingApi.placePendingOrder({
      login: 77, symbol: 'BTCUSD', side: 'sell', volume: 0.01, type: 'sell_limit', price: 66000, client_order_id: id,
    });
    const [, init] = vi.mocked(fetch).mock.calls[0];
    expect(JSON.parse(String(init?.body ?? '{}')).client_order_id).toBe(id);
    expect(() => tradingApi.placePendingOrder({
      login: 77, symbol: 'BTCUSD', side: 'sell', volume: 0.01, type: 'sell_limit', price: 66000, client_order_id: 'abc',
    })).toThrow('client_order_id must be a UUID v4');
  });
});
