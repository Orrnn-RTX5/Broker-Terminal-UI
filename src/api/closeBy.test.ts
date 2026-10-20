import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { removeToken, setToken } from './client';
import { API_V2_BASE_URL, updateDynamicUrls } from '../config/api';
import {
  buildCloseByPairKey,
  CLOSE_BY_CONTEXT,
  closePositionsBy,
  findCloseByCounterpart,
} from './closeBy';

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const jsonResponse = (body: unknown, init: ResponseInit = {}): Response =>
  new Response(JSON.stringify(body), {
    status: init.status ?? 200,
    headers: { 'Content-Type': 'application/json', ...init.headers },
  });

const buy = (ticket: number | string, symbol = 'EURUSD', version = '11') => ({
  ticket, id: Number(ticket), symbol, side: 'BUY', state_version_text: version,
});

const sell = (ticket: number | string, symbol = 'EURUSD', version = '22') => ({
  ticket, id: Number(ticket), symbol, side: 'SELL', state_version_text: version,
});

describe('close-by API wire', () => {
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

  const lastPost = () => {
    const call = vi.mocked(fetch).mock.calls.at(-1);
    expect(call).toBeDefined();
    return { url: String(call?.[0]), init: call?.[1] as RequestInit };
  };

  it('posts the backend DTO with decimal strings, account_login and a UUIDv4 client_order_id', async () => {
    setToken('test-access-token');
    vi.mocked(fetch).mockImplementationOnce(async (_url, init) => {
      const sent = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>;
      return jsonResponse({ closed: [sent.position_ticket], client_order_id: sent.client_order_id });
    });

    await closePositionsBy(buy(1001, 'EURUSD', '9007199254740993'), sell(1002, 'EURUSD', '7'), { account_login: 200101 });

    const { url, init } = lastPost();
    expect(url).toBe(`${API_V2_BASE_URL}/positions/close-by`);
    expect(init?.method).toBe('POST');
    const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
    // Exact backend DTO shape (DisallowUnknownFields rejects anything else).
    expect(body).toEqual({
      client_order_id: expect.stringMatching(UUID_V4),
      account_login: 200101,
      position_ticket: '1001',
      other_position_ticket: '1002',
      expected_state_version: '9007199254740993',
      other_expected_state_version: '7',
    });
    expect(new Headers(init?.headers).get('Authorization')).toBe('Bearer test-access-token');
    expect(new Headers(init?.headers).get('Content-Type')).toBe('application/json');
  });

  it('orders legs lowest-ticket-first with each version following its own ticket', async () => {
    await closePositionsBy(sell(5005, 'XAUUSD', '55'), buy(4004, 'XAUUSD', '44'), { account_login: 200101 });

    const { init } = lastPost();
    const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
    expect(body.position_ticket).toBe('4004');
    expect(body.other_position_ticket).toBe('5005');
    expect(body.expected_state_version).toBe('44');
    expect(body.other_expected_state_version).toBe('55');
  });

  it('preserves bigint-scale decimal ticket/version strings without numeric coercion', async () => {
    const bigA = '900719925474099312345';
    const bigB = '900719925474099398765';
    await closePositionsBy(
      { ticket: bigA, state_version_text: '123456789012345678901234567890' },
      { ticket: bigB, state_version: '987654321098765432109876543210' },
      { account_login: 200101 },
    );

    const { url, init } = lastPost();
    expect(url).toBe(`${API_V2_BASE_URL}/positions/close-by`);
    const raw = String(init?.body);
    // Decimal strings travel quoted: the wire must never carry them as numbers.
    expect(raw).toContain(`"${bigA}"`);
    expect(raw).toContain(`"${bigB}"`);
    expect(raw).toContain('"123456789012345678901234567890"');
    const body = JSON.parse(raw) as Record<string, unknown>;
    expect(body.position_ticket).toBe(bigA);
  });

  it('keeps a caller-supplied UUID client_order_id and rejects a non-UUID one unsent', async () => {
    const id = '9b2f4a3e-1c5d-4e6f-a7b8-c9d0e1f2a3b4';
    await closePositionsBy(buy(11, 'EURUSD', '1'), sell(12, 'EURUSD', '2'), { client_order_id: id, account_login: 200101 });
    expect((JSON.parse(String(lastPost().init?.body)) as Record<string, unknown>).client_order_id).toBe(id);

    await expect(closePositionsBy(buy(11, 'EURUSD', '1'), sell(12, 'EURUSD', '2'), {
      client_order_id: 'not-a-uuid', account_login: 200101,
    })).rejects.toThrow('client_order_id must be a UUID v4');
  });

  it('refuses to send without an account login or with a stale version', async () => {
    await expect(closePositionsBy(buy(11, 'EURUSD', '1'), sell(12, 'EURUSD', '2')))
      .rejects.toThrow('No trading account is selected');
    await expect(closePositionsBy(buy(11, 'EURUSD', '0'), sell(12, 'EURUSD', '2'), { account_login: 200101 }))
      .rejects.toThrow('Position data is stale');
    await expect(closePositionsBy(buy(11, 'EURUSD', '1'), sell(12, 'EURUSD', '007'), { account_login: 200101 }))
      .rejects.toThrow('Position data is stale');
    expect(fetch).not.toHaveBeenCalled();
  });

  it.each([
    ['empty ticket', { ticket: '', state_version_text: '1' }, sell(12, 'EURUSD', '2')],
    ['zero ticket', { ticket: '0', state_version_text: '1' }, sell(12, 'EURUSD', '2')],
    ['padded ticket', { ticket: '007', state_version_text: '1' }, sell(12, 'EURUSD', '2')],
    ['fractional ticket', { ticket: '1001.5', state_version_text: '1' }, sell(12, 'EURUSD', '2')],
    ['unsafe numeric ticket', { ticket: Number.MAX_SAFE_INTEGER + 1, state_version_text: '1' }, sell(12, 'EURUSD', '2')],
    ['missing version', { ticket: '1001' }, sell(12, 'EURUSD', '2')],
    ['malformed version', { ticket: '1001', state_version_text: 'v9' }, sell(12, 'EURUSD', '2')],
    ['null leg', null, sell(12, 'EURUSD', '2')],
  ])('refuses an invalid %s leg before sending a request', async (_label, first, second) => {
    await expect(closePositionsBy(
      first as never,
      second as never,
      { account_login: 200101 },
    )).rejects.toThrow(CLOSE_BY_CONTEXT);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('refuses a self-pair without sending a request', async () => {
    await expect(closePositionsBy(buy(1001, 'EURUSD', '3'), sell(1001, 'EURUSD', '4'), { account_login: 200101 }))
      .rejects.toThrow('both legs name the same ticket');
    expect(fetch).not.toHaveBeenCalled();
  });
});

describe('close-by counterpart gating', () => {
  it('returns null when no opposite-side same-symbol position exists', () => {
    const row = buy(101);
    expect(findCloseByCounterpart(row, [])).toBeNull();
    expect(findCloseByCounterpart(row, null)).toBeNull();
    expect(findCloseByCounterpart(null, [sell(102)])).toBeNull();
    // Same side only.
    expect(findCloseByCounterpart(row, [buy(102), buy(103)])).toBeNull();
    // Opposite side, different symbol only.
    expect(findCloseByCounterpart(row, [sell(102, 'GBPUSD')])).toBeNull();
    // Unknown side never pairs.
    expect(findCloseByCounterpart({ ...row, side: 'HOLD' }, [sell(102)])).toBeNull();
    // Blank symbol never pairs.
    expect(findCloseByCounterpart({ ...row, symbol: '  ' }, [sell(102, '  ')])).toBeNull();
    // Invalid row ticket never pairs.
    expect(findCloseByCounterpart(buy('oops'), [sell(102)])).toBeNull();
  });

  it('picks the lowest-ticket opposite-side same-symbol counterpart', () => {
    const row = buy(2001);
    const candidates = [
      sell(2009, 'EURUSD', '9'),
      buy(2002, 'EURUSD', '2'),
      sell(2003, 'GBPUSD', '3'),
      sell(2005, 'eurusd', '5'),
      { ticket: 'bogus', symbol: 'EURUSD', side: 'SELL', state_version_text: '1' },
    ];
    const match = findCloseByCounterpart(row, candidates);
    expect(match).toBe(candidates[3]);
    expect(String((match as { ticket: unknown }).ticket)).toBe('2005');
  });

  it('compares bigint-scale tickets exactly, not by float precision', () => {
    const row = { ticket: '100', symbol: 'EURUSD', side: 'BUY' };
    const lower = { ticket: '9007199254740992', symbol: 'EURUSD', side: 'SELL' };
    const higher = { ticket: '9007199254740993', symbol: 'EURUSD', side: 'SELL' };
    // Number() cannot distinguish 2^53 from 2^53+1; the decimal-string
    // compare must still order them exactly.
    expect(Number(lower.ticket) === Number(higher.ticket)).toBe(true);
    expect(findCloseByCounterpart(row, [higher, lower])).toBe(lower);
  });

  it('builds an order-independent in-flight pair key', () => {
    expect(buildCloseByPairKey('1001', '1002')).toBe(buildCloseByPairKey('1002', '1001'));
  });
});
