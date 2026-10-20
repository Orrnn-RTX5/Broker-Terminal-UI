import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { removeToken, setToken } from './client';
import { tradingApi } from './endpoints';
import { updateDynamicUrls } from '../config/api';

// T5 (fetch level, real shapes): the sequential bulk-cancel loop in App
// (handleCancelPendingBulkOrders → cancelPendingOrderWithoutConfirm →
// api.orders.cancelOrder → tradingApi.cancelOrder) must issue one DELETE per
// ticket with a distinct Idempotency-Key per call, and transport failures
// must reject so callers can surface + rethrow them (never swallow).

const jsonResponse = (body: unknown): Response =>
  new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } });

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const sentIdempotencyKeys = (): string[] =>
  vi.mocked(fetch).mock.calls.map(
    ([, init]) => new Headers(init?.headers as HeadersInit).get('Idempotency-Key') ?? '',
  );

describe('pending bulk cancel transport (real shapes, fetch-level)', () => {
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

  it('cancels N tickets sequentially: one DELETE per ticket, each with its own UUID v4 Idempotency-Key', async () => {
    setToken('test-access-token');
    const tickets = [34671, 34672, 34673];
    // Mirrors App handleCancelPendingBulkOrders: sequential awaits, no Promise.all.
    for (const ticket of tickets) {
      await tradingApi.cancelOrder(ticket);
    }

    const calls = vi.mocked(fetch).mock.calls;
    expect(calls).toHaveLength(tickets.length);
    tickets.forEach((ticket, index) => {
      expect(String(calls[index][0])).toContain(`/orders/pending/${ticket}`);
      expect((calls[index][1] as RequestInit | undefined)?.method).toBe('DELETE');
    });
    const keys = sentIdempotencyKeys();
    keys.forEach((key) => expect(key).toMatch(UUID_V4));
    expect(new Set(keys).size).toBe(tickets.length);
  });

  it('mints a fresh Idempotency-Key for every attempt, even for the same ticket', async () => {
    setToken('test-access-token');
    await tradingApi.cancelOrder(34671);
    await tradingApi.cancelOrder(34671);

    const keys = sentIdempotencyKeys();
    expect(keys).toHaveLength(2);
    keys.forEach((key) => expect(key).toMatch(UUID_V4));
    expect(keys[0]).not.toBe(keys[1]);
  });

  it('never swallows a transport failure: the cancel rejects so callers can rethrow + surface it', async () => {
    setToken('test-access-token');
    vi.mocked(fetch).mockRejectedValueOnce(new Error('broker refused cancel'));
    await expect(tradingApi.cancelOrder(34671)).rejects.toThrow();
  });
});
