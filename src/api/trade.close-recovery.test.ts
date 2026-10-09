import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { installTestBrokerRuntime } from '../test/brokerRuntime';

import { API_V2_BASE_URL } from '../config/api';
import { formatOrderError } from '../utils/orderError';
import { ApiError, removeToken } from './client';
import { tradingV2Api } from './trade';

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SUPPLIED_CLOSE_ID = '550e8400-e29b-41d4-a716-446655440000';
const PARTIAL_CLOSE_ID = '123e4567-e89b-42d3-a456-426614174000';

const jsonResponse = (body: unknown, init: ResponseInit = {}): Response =>
  new Response(JSON.stringify(body), {
    status: init.status ?? 200,
    headers: { 'Content-Type': 'application/json', ...init.headers },
  });

const callsTo = (substring: string): Array<[unknown, RequestInit | undefined]> =>
  vi.mocked(fetch).mock.calls.filter(([url]) => String(url).includes(substring)) as Array<
    [unknown, RequestInit | undefined]
  >;

const postBody = (call: [unknown, RequestInit | undefined]): Record<string, unknown> =>
  JSON.parse(String(call[1]?.body ?? '{}')) as Record<string, unknown>;

const clientIdFromStatusUrl = (url: unknown): string => {
  const match = /\/order-commands\/([^/?]+)/.exec(String(url));
  return match ? decodeURIComponent(match[1]) : '';
};

describe('durable closePosition intent', () => {
  let restoreBrokerRuntime: () => void;
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ ok: true })));
    localStorage.clear();
    sessionStorage.clear();
    removeToken();
    restoreBrokerRuntime = installTestBrokerRuntime();
  });

  afterEach(() => {
    restoreBrokerRuntime();
    vi.unstubAllGlobals();
  });

  it('sends one POST with a generated client_order_id and full volume', async () => {
    vi.mocked(fetch).mockImplementationOnce(async (_url, init) => {
      const sent = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>;
      return jsonResponse({ ticket: 998877, status: 'closed', client_order_id: sent.client_order_id });
    });

    await tradingV2Api.closePosition(998877);

    expect(vi.mocked(fetch)).toHaveBeenCalledTimes(1);
    const [[url, init]] = vi.mocked(fetch).mock.calls;
    expect(String(url)).toBe(`${API_V2_BASE_URL}/positions/998877/close`);
    expect(init?.method).toBe('POST');
    const body = postBody([url, init]);
    expect(body.volume).toBe(0);
    expect(String(body.client_order_id)).toMatch(UUID_PATTERN);
  });

  it('carries a partial volume with a stably supplied client_order_id', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      jsonResponse({ ticket: 998877, status: 'partial_closed', volume_closed: 0.25, client_order_id: PARTIAL_CLOSE_ID }),
    );

    await tradingV2Api.closePosition(998877, {
      volume: 0.25,
      client_order_id: PARTIAL_CLOSE_ID,
    });

    expect(vi.mocked(fetch)).toHaveBeenCalledTimes(1);
    const body = postBody(vi.mocked(fetch).mock.calls.at(-1) as [unknown, RequestInit | undefined]);
    expect(body).toMatchObject({ volume: 0.25, client_order_id: PARTIAL_CLOSE_ID });
  });

  it('recovers a dropped POST reply via the same-ID status poll, never a second POST', async () => {
    vi.mocked(fetch).mockImplementationOnce(() =>
      Promise.reject(new TypeError('socket destroyed')),
    );
    vi.mocked(fetch).mockImplementation(async (url) => {
      const id = clientIdFromStatusUrl(url);
      return jsonResponse({
        status: 'filled',
        type: 'position_closed',
        client_order_id: id,
        data: { ticket: 998877, status: 'closed', client_order_id: id },
      });
    });

    const result = await tradingV2Api.closePosition(998877, {
      client_order_id: SUPPLIED_CLOSE_ID,
      account_login: 900001,
      closeRecoveryIntervalMs: 0,
    });

    const posts = callsTo('/positions/998877/close');
    const polls = callsTo('/order-commands/');
    expect(posts).toHaveLength(1);
    expect(polls).toHaveLength(1);
    expect(postBody(posts[0]).client_order_id).toBe(SUPPLIED_CLOSE_ID);
    expect(clientIdFromStatusUrl(polls[0][0])).toBe(SUPPLIED_CLOSE_ID);
    expect(String(polls[0][0])).toContain('account_login=900001');
    expect(result).toMatchObject({ ticket: 998877, client_order_id: SUPPLIED_CLOSE_ID });
  });

  it('recovers a 202 accepted close via the same-ID status poll', async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(
        jsonResponse(
          { status: 'accepted', type: 'position_close_accepted' },
          { status: 202 },
        ),
      )
      .mockImplementation(async (url) => {
        const id = clientIdFromStatusUrl(url);
        return jsonResponse({
          status: 'succeeded',
          type: 'position_closed',
          client_order_id: id,
          data: { ticket: 998877, status: 'closed', client_order_id: id },
        });
      });

    await tradingV2Api.closePosition(998877, {
      client_order_id: SUPPLIED_CLOSE_ID,
      closeRecoveryIntervalMs: 0,
    });

    const posts = callsTo('/positions/998877/close');
    const polls = callsTo('/order-commands/');
    expect(posts).toHaveLength(1);
    expect(polls).toHaveLength(1);
    expect(clientIdFromStatusUrl(polls[0][0])).toBe(SUPPLIED_CLOSE_ID);
  });

  it('recovers a 503 admission uncertainty via the same-ID status poll', async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(jsonResponse({ message: 'Unavailable' }, { status: 503 }))
      .mockImplementation(async (url) => {
        const id = clientIdFromStatusUrl(url);
        return jsonResponse({
          status: 'filled',
          type: 'position_closed',
          client_order_id: id,
          data: { ticket: 998877, status: 'closed', client_order_id: id },
        });
      });

    const result = await tradingV2Api.closePosition(998877, {
      client_order_id: SUPPLIED_CLOSE_ID,
      closeRecoveryIntervalMs: 0,
    });

    expect(callsTo('/positions/998877/close')).toHaveLength(1);
    expect(callsTo('/order-commands/')).toHaveLength(1);
    expect(result).toMatchObject({ ticket: 998877 });
  });

  it('surfaces a rejected terminal as failure, never a confirm', async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(
        jsonResponse(
          { status: 'accepted', type: 'position_close_accepted' },
          { status: 202 },
        ),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          status: 'rejected',
          type: 'position_close_rejected',
          error: {
            code: 'POSITION_ALREADY_CLOSED',
            message: 'Position was already closed',
            retryable: false,
          },
        }),
      );

    const failure = await tradingV2Api
      .closePosition(998877, {
        client_order_id: SUPPLIED_CLOSE_ID,
        closeRecoveryIntervalMs: 0,
      })
      .then(
        () => null,
        (error: unknown) => error,
      );

    expect(failure).toBeInstanceOf(ApiError);
    expect(failure as ApiError).toMatchObject({ status: 400 });
    expect(String((failure as ApiError).message)).toMatch(/already closed/i);
    expect(String((failure as ApiError).message)).toContain(SUPPLIED_CLOSE_ID);
    expect(callsTo('/positions/998877/close')).toHaveLength(1);
    expect(callsTo('/order-commands/')).toHaveLength(1);
  });

  it('preserves a retryable close-lock rejection without retrying or confirming the close', async () => {
    const rejected = {
      status: 'rejected',
      client_order_id: SUPPLIED_CLOSE_ID,
      error: {
        code: 'DATABASE_UNAVAILABLE',
        message: 'Unable to lock close position',
        retryable: true,
      },
    };
    vi.mocked(fetch)
      .mockResolvedValueOnce(jsonResponse({
        status: 'accepted', type: 'position_close_accepted', client_order_id: SUPPLIED_CLOSE_ID,
      }, { status: 202 }))
      .mockResolvedValueOnce(jsonResponse(rejected));

    const failure = await tradingV2Api.closePosition(998877, {
      client_order_id: SUPPLIED_CLOSE_ID,
      account_login: 900001,
      closeRecoveryIntervalMs: 0,
    }).then(() => null, (error: unknown) => error);

    expect(failure).toBeInstanceOf(ApiError);
    expect(formatOrderError(failure)).toBe('DATABASE_UNAVAILABLE: Unable to lock close position');
    expect(failure).toMatchObject({
      status: 503,
      data: { ...rejected.error, client_order_id: SUPPLIED_CLOSE_ID, payload: rejected },
    });
    const posts = callsTo('/positions/998877/close');
    const polls = callsTo('/order-commands/');
    expect(posts).toHaveLength(1);
    expect(postBody(posts[0]).client_order_id).toBe(SUPPLIED_CLOSE_ID);
    expect(polls).toHaveLength(1);
    expect(clientIdFromStatusUrl(polls[0][0])).toBe(SUPPLIED_CLOSE_ID);
    expect(String(polls[0][0])).toContain('account_login=900001');
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('times out with an explicit unresolved error when the command never reaches terminal', async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(
        jsonResponse(
          { status: 'accepted', type: 'position_close_accepted' },
          { status: 202 },
        ),
      )
      .mockResolvedValue(
        jsonResponse({ status: 'accepted', type: 'position_close_accepted' }),
      );

    const failure = await tradingV2Api
      .closePosition(998877, {
        client_order_id: SUPPLIED_CLOSE_ID,
        closeRecoveryAttempts: 3,
        closeRecoveryIntervalMs: 0,
      })
      .then(
        () => null,
        (error: unknown) => error,
      );

    expect(failure).toBeInstanceOf(ApiError);
    expect(String((failure as ApiError).message)).toMatch(/outcome unknown/i);
    expect(String((failure as ApiError).message)).toContain(SUPPLIED_CLOSE_ID);
    expect(String((failure as ApiError).message)).toMatch(/never resubmitted, not confirmed/i);
    expect(callsTo('/positions/998877/close')).toHaveLength(1);
    expect(callsTo('/order-commands/')).toHaveLength(3);
  });

  it('does not poll or resubmit on a terminal 400 rejection', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      jsonResponse({ message: 'Close volume exceeds the open position volume' }, { status: 400 }),
    );

    await expect(
      tradingV2Api.closePosition(998877, {
        client_order_id: SUPPLIED_CLOSE_ID,
        closeRecoveryIntervalMs: 0,
      }),
    ).rejects.toMatchObject({ status: 400 });

    expect(vi.mocked(fetch)).toHaveBeenCalledTimes(1);
    expect(callsTo('/order-commands/')).toHaveLength(0);
  });

  it('ignores stored usernames and omits account_login without an explicit identity', async () => {
    localStorage.setItem('rtx_saved_username', '900001');
    localStorage.setItem('rtx_last_login', '900001');
    vi.mocked(fetch).mockImplementationOnce(() =>
      Promise.reject(new TypeError('socket destroyed')),
    );
    vi.mocked(fetch).mockImplementation(async (url) => {
      const id = clientIdFromStatusUrl(url);
      return jsonResponse({
        status: 'filled',
        type: 'position_closed',
        client_order_id: id,
        data: { ticket: 998877, status: 'closed', client_order_id: id },
      });
    });

    await tradingV2Api.closePosition(998877, {
      client_order_id: SUPPLIED_CLOSE_ID,
      closeRecoveryIntervalMs: 0,
    });

    const polls = callsTo('/order-commands/');
    expect(polls).toHaveLength(1);
    expect(String(polls[0][0])).not.toContain('account_login');
  });

  it('ignores an unrelated filled snapshot and confirms the correlated terminal', async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(
        jsonResponse(
          { status: 'accepted', type: 'position_close_accepted' },
          { status: 202 },
        ),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          status: 'filled',
          type: 'position_closed',
          client_order_id: '00000000-0000-4000-8000-000000000000',
          data: { ticket: 111111, status: 'closed', client_order_id: '00000000-0000-4000-8000-000000000000' },
        }),
      )
      .mockImplementation(async (url) => {
        const id = clientIdFromStatusUrl(url);
        return jsonResponse({
          status: 'filled',
          type: 'position_closed',
          client_order_id: id,
          data: { ticket: 998877, status: 'closed', client_order_id: id },
        });
      });

    const result = await tradingV2Api.closePosition(998877, {
      client_order_id: SUPPLIED_CLOSE_ID,
      closeRecoveryIntervalMs: 0,
    });

    expect(callsTo('/order-commands/')).toHaveLength(2);
    expect(result).toMatchObject({ ticket: 998877, client_order_id: SUPPLIED_CLOSE_ID });
  });

  it('verifies a status-less 200 via the bounded same-ID poll instead of confirming blind', async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(jsonResponse({ ok: true }))
      .mockImplementation(async (url) => {
        const id = clientIdFromStatusUrl(url);
        return jsonResponse({
          status: 'filled',
          type: 'position_closed',
          client_order_id: id,
          data: { ticket: 998877, status: 'closed', client_order_id: id },
        });
      });

    const result = await tradingV2Api.closePosition(998877, {
      client_order_id: SUPPLIED_CLOSE_ID,
      closeRecoveryIntervalMs: 0,
    });

    expect(callsTo('/positions/998877/close')).toHaveLength(1);
    expect(callsTo('/order-commands/')).toHaveLength(1);
    expect(result).toMatchObject({ ticket: 998877, client_order_id: SUPPLIED_CLOSE_ID });
  });
});
