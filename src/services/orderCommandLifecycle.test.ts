import { describe, expect, it, vi } from 'vitest';

import {
  ORDER_COMMAND_FALLBACK_DEADLINE_MS,
  ORDER_COMMAND_POLL_INTERVAL_MS,
  normalizeOrderCommand,
  parseOrderCommandEpochMs,
  pollOrderCommandUntilTerminal,
} from './orderCommandLifecycle';

const CLIENT_ORDER_ID = '123e4567-e89b-42d3-a456-426614174000';

describe('normalizeOrderCommand', () => {
  it.each([
    [{ status: 'accepted' }, 'accepted', false],
    [{ data: { state: 'processing' } }, 'processing', false],
    [{ data: { status: 'queued' } }, 'processing', false],
    [{ type: 'order_filled', data: { ticket: 101 } }, 'filled', true],
    [{ type: 'order_rejected' }, 'rejected', true],
    [{ status: 'expired' }, 'expired', true],
  ] as const)('normalizes lifecycle response %#', (response, status, terminal) => {
    expect(normalizeOrderCommand(response, CLIENT_ORDER_ID)).toMatchObject({
      status,
      terminal,
      clientOrderId: CLIENT_ORDER_ID,
    });
  });

  it('keeps nested backend error code and message verbatim', () => {
    const command = normalizeOrderCommand({
      status: 'rejected',
      client_order_id: CLIENT_ORDER_ID,
      error: {
        code: 'NO_FRESH_QUOTE',
        message: 'No fresh XAUUSD quote is available.',
      },
    });

    expect(command.error).toEqual({
      code: 'NO_FRESH_QUOTE',
      message: 'No fresh XAUUSD quote is available.',
    });
  });

  it('supports flat backend errors inside data', () => {
    const command = normalizeOrderCommand({
      data: {
        status: 'rejected',
        error_code: 'SOURCE_MISMATCH',
        error_message: 'Execution source does not match the quote source.',
      },
    }, CLIENT_ORDER_ID);

    expect(command.error).toEqual({
      code: 'SOURCE_MISMATCH',
      message: 'Execution source does not match the quote source.',
    });
  });

  it('extracts a filled position from common response envelopes', () => {
    expect(normalizeOrderCommand({
      status: 'filled',
      data: {
        state: 'filled',
        position: { ticket: 9001, symbol: 'XAUUSD' },
      },
    }, CLIENT_ORDER_ID).position).toEqual({ ticket: 9001, symbol: 'XAUUSD' });

    expect(normalizeOrderCommand({
      status: 'filled',
      client_order_id: CLIENT_ORDER_ID,
      ticket: 9002,
      symbol: 'EURUSD',
    }).position).toMatchObject({ ticket: 9002, symbol: 'EURUSD' });
  });
});

describe('parseOrderCommandEpochMs', () => {
  it('accepts Unix seconds, Unix milliseconds, and RFC3339 timestamps', () => {
    expect(parseOrderCommandEpochMs(1_800_000_000)).toBe(1_800_000_000_000);
    expect(parseOrderCommandEpochMs('1800000000123')).toBe(1_800_000_000_123);
    expect(parseOrderCommandEpochMs('2027-01-15T08:00:00.000Z'))
      .toBe(Date.parse('2027-01-15T08:00:00.000Z'));
  });
});

describe('pollOrderCommandUntilTerminal', () => {
  it('polls once per second and returns the filled terminal result', async () => {
    let currentTime = 1_800_000_000_000;
    const sleep = vi.fn(async (delayMs: number) => {
      currentTime += delayMs;
    });
    const readStatus = vi.fn()
      .mockResolvedValueOnce({
        status: 'processing',
        client_order_id: CLIENT_ORDER_ID,
      })
      .mockResolvedValueOnce({
        status: 'filled',
        client_order_id: CLIENT_ORDER_ID,
        data: { position: { ticket: 701 } },
      });
    const statuses: string[] = [];

    const result = await pollOrderCommandUntilTerminal({
      clientOrderId: CLIENT_ORDER_ID,
      initialResponse: { status: 'accepted', client_order_id: CLIENT_ORDER_ID },
      readStatus,
      now: () => currentTime,
      sleep,
      onStatus: (command) => statuses.push(command.status),
    });

    expect(ORDER_COMMAND_POLL_INTERVAL_MS).toBe(1_000);
    expect(sleep).toHaveBeenNthCalledWith(1, 1_000);
    expect(sleep).toHaveBeenNthCalledWith(2, 1_000);
    expect(readStatus).toHaveBeenCalledTimes(2);
    expect(readStatus).toHaveBeenCalledWith(CLIENT_ORDER_ID);
    expect(statuses).toEqual(['accepted', 'processing', 'filled']);
    expect(result).toMatchObject({
      status: 'filled',
      terminal: true,
      position: { ticket: 701 },
    });
  });

  it('uses a 30-second fallback deadline and performs the final read at the deadline', async () => {
    let currentTime = 100_000;
    const readTimes: number[] = [];
    const sleep = vi.fn(async (delayMs: number) => {
      currentTime += delayMs;
    });
    const readStatus = vi.fn(async () => {
      readTimes.push(currentTime);
      return { data: { state: 'processing' }, client_order_id: CLIENT_ORDER_ID };
    });

    const result = await pollOrderCommandUntilTerminal({
      clientOrderId: CLIENT_ORDER_ID,
      initialResponse: { status: 'accepted', client_order_id: CLIENT_ORDER_ID },
      readStatus,
      startedAtMs: currentTime,
      now: () => currentTime,
      sleep,
    });

    expect(ORDER_COMMAND_FALLBACK_DEADLINE_MS).toBe(30_000);
    expect(readStatus).toHaveBeenCalledTimes(30);
    expect(readTimes.at(-1)).toBe(130_000);
    expect(result).toMatchObject({
      status: 'expired',
      terminal: true,
      executeBeforeMs: 130_000,
      synthetic: true,
      error: {
        code: 'ORDER_COMMAND_EXPIRED',
        message: 'No terminal order result arrived before execute_before.',
      },
    });
  });

  it('honors execute_before and still reads once when the deadline is already due', async () => {
    const executeBefore = '2027-01-15T08:00:00.000Z';
    const currentTime = Date.parse(executeBefore);
    const readStatus = vi.fn().mockResolvedValue({
      status: 'expired',
      client_order_id: CLIENT_ORDER_ID,
      execute_before: executeBefore,
    });
    const sleep = vi.fn(async () => undefined);

    const result = await pollOrderCommandUntilTerminal({
      clientOrderId: CLIENT_ORDER_ID,
      initialResponse: {
        status: 'accepted',
        client_order_id: CLIENT_ORDER_ID,
        execute_before: executeBefore,
      },
      readStatus,
      now: () => currentTime,
      sleep,
    });

    expect(sleep).not.toHaveBeenCalled();
    expect(readStatus).toHaveBeenCalledOnce();
    expect(result).toMatchObject({ status: 'expired', terminal: true });
    expect(result.synthetic).toBeUndefined();
  });

  it('returns an initial rejected or expired response without polling', async () => {
    const readStatus = vi.fn();

    const rejected = await pollOrderCommandUntilTerminal({
      clientOrderId: CLIENT_ORDER_ID,
      initialResponse: { status: 'rejected', client_order_id: CLIENT_ORDER_ID },
      readStatus,
    });
    const expired = await pollOrderCommandUntilTerminal({
      clientOrderId: CLIENT_ORDER_ID,
      initialResponse: { status: 'expired', client_order_id: CLIENT_ORDER_ID },
      readStatus,
    });

    expect(rejected.terminal).toBe(true);
    expect(expired.terminal).toBe(true);
    expect(readStatus).not.toHaveBeenCalled();
  });

  it('expires after a failed final status read instead of spinning forever', async () => {
    let currentTime = 50_000;
    const pollError = new Error('temporary status outage');
    const onPollError = vi.fn();
    const readStatus = vi.fn().mockRejectedValue(pollError);

    const result = await pollOrderCommandUntilTerminal({
      clientOrderId: CLIENT_ORDER_ID,
      initialResponse: {
        status: 'accepted',
        client_order_id: CLIENT_ORDER_ID,
        execute_before: 51,
      },
      readStatus,
      now: () => currentTime,
      sleep: async (delayMs) => { currentTime += delayMs; },
      onPollError,
    });

    expect(readStatus).toHaveBeenCalledOnce();
    expect(onPollError).toHaveBeenCalledWith(pollError);
    expect(result.status).toBe('expired');
  });

  it('rejects a status response correlated to another client_order_id', async () => {
    let currentTime = 1_800_000_000_000;

    await expect(pollOrderCommandUntilTerminal({
      clientOrderId: CLIENT_ORDER_ID,
      initialResponse: { status: 'accepted', client_order_id: CLIENT_ORDER_ID },
      readStatus: async () => ({
        status: 'filled',
        client_order_id: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee',
      }),
      now: () => currentTime,
      sleep: async (delayMs) => { currentTime += delayMs; },
    })).rejects.toThrow('client_order_id does not match');
  });
});
