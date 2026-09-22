import { beforeEach, describe, expect, it, vi } from 'vitest';

import { removeToken, setToken } from './client';
import { tradingApi } from './endpoints';
import { API_V2_BASE_URL } from '../config/api';

const jsonResponse = (body: unknown, init: ResponseInit = {}): Response =>
  new Response(JSON.stringify(body), {
    status: init.status ?? 200,
    headers: { 'Content-Type': 'application/json', ...init.headers },
  });

describe('single full-position close API', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ ok: true })));
    localStorage.clear();
    sessionStorage.clear();
    removeToken();
  });

  it('posts an exact full-close request to the configured broker v2 endpoint', async () => {
    setToken('test-access-token');
    vi.mocked(fetch).mockImplementationOnce(async (_url, init) => {
      const sent = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>;
      return jsonResponse({ ticket: 1001353, status: 'closed', client_order_id: sent.client_order_id });
    });

    await tradingApi.closePosition(1001353);

    const call = vi.mocked(fetch).mock.calls.at(-1);
    expect(call).toBeDefined();
    expect(String(call?.[0])).toBe(
      `${API_V2_BASE_URL}/positions/1001353/close`
    );

    const request = call?.[1];
    expect(request?.method).toBe('POST');
    const body = JSON.parse(String(request?.body));
    expect(body.volume).toBe(0);
    expect(String(body.client_order_id)).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    );
    expect(new Headers(request?.headers).get('Authorization')).toBe('Bearer test-access-token');
    expect(new Headers(request?.headers).get('Content-Type')).toBe('application/json');
  });

  it('preserves a valid positive decimal string ticket without numeric coercion', async () => {
    const ticket = '900719925474099312345';

    vi.mocked(fetch).mockImplementationOnce(async (_url, init) => {
      const sent = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>;
      return jsonResponse({ ticket, status: 'closed', client_order_id: sent.client_order_id });
    });
    await tradingApi.closePosition(ticket);

    expect(String(vi.mocked(fetch).mock.calls.at(-1)?.[0])).toBe(
      `${API_V2_BASE_URL}/positions/${ticket}/close`
    );
  });

  it.each([
    ['empty', ''],
    ['zero', '0'],
    ['negative', '-1'],
    ['fractional string', '1001353.5'],
    ['fractional number', 1001353.5],
    ['unsafe number', Number.MAX_SAFE_INTEGER + 1],
    ['numeric prefix with suffix', '1001353abc'],
    ['scientific notation', '1e6'],
    ['surrounding whitespace', ' 1001353 '],
    ['path characters', '1001353/close-all'],
  ])('rejects an invalid %s ticket before sending a request', (_label, ticket) => {
    expect(() => tradingApi.closePosition(ticket)).toThrow(
      'Invalid ticket for /api/v2/positions/{id}/close'
    );
    expect(fetch).not.toHaveBeenCalled();
  });
});
