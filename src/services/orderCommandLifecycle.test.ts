import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

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

describe('order command terminal pushes during reconciliation', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(1_800_000_000_000);
  });
  afterEach(() => { vi.useRealTimers(); });

  const createPushSource = () => {
    let listener: ((response: unknown) => void) | undefined;
    const unsubscribe = vi.fn();
    return {
      unsubscribe,
      subscribeTerminal: vi.fn((callback: (response: unknown) => void) => {
        listener = callback;
        return unsubscribe;
      }),
      emit: (response: unknown) => listener?.(response),
    };
  };
  const processing = { status: 'processing', client_order_id: CLIENT_ORDER_ID };
  const filled = { status: 'filled', client_order_id: CLIENT_ORDER_ID, data: { ticket: 701 } };

  it('lets the terminal push win a pending status GET and safely observes a later GET rejection', async () => {
    const source = createPushSource();
    let rejectRead!: (error: Error) => void;
    const readStatus = vi.fn(() => new Promise<unknown>((_resolve, reject) => { rejectRead = reject; }));
    const onPollError = vi.fn();
    const onStatus = vi.fn();
    const resultPromise = pollOrderCommandUntilTerminal({
      clientOrderId: CLIENT_ORDER_ID,
      initialResponse: processing,
      readStatus,
      pollImmediately: true,
      subscribeTerminal: source.subscribeTerminal,
      onPollError,
      onStatus,
    });

    expect(readStatus).toHaveBeenCalledOnce();
    source.emit(filled);
    await expect(resultPromise).resolves.toMatchObject({ status: 'filled', position: { ticket: 701 } });
    expect(source.unsubscribe).toHaveBeenCalledOnce();

    rejectRead(new Error('Late status read failed'));
    source.emit({ status: 'expired', client_order_id: CLIENT_ORDER_ID });
    await vi.advanceTimersByTimeAsync(60_000);
    expect(readStatus).toHaveBeenCalledOnce();
    expect(onPollError).not.toHaveBeenCalled();
    expect(onStatus.mock.calls.map(([command]) => command.status)).toEqual(['processing', 'filled']);
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each(['filled', 'rejected', 'expired'])('cancels the poll sleep as soon as a %s push arrives', async (status) => {
    const source = createPushSource();
    const readStatus = vi.fn();
    const resultPromise = pollOrderCommandUntilTerminal({
      clientOrderId: CLIENT_ORDER_ID,
      initialResponse: processing,
      readStatus,
      subscribeTerminal: source.subscribeTerminal,
    });

    expect(vi.getTimerCount()).toBe(1);
    source.emit({ status, client_order_id: CLIENT_ORDER_ID });
    await expect(resultPromise).resolves.toMatchObject({ status, terminal: true });
    expect(vi.getTimerCount()).toBe(0);
    expect(source.unsubscribe).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(readStatus).not.toHaveBeenCalled();
  });

  it('ignores malformed, nonterminal, missing-id, and other-command pushes before the HTTP result wins', async () => {
    const source = createPushSource();
    let resolveRead!: (response: unknown) => void;
    const readStatus = vi.fn(() => new Promise<unknown>((resolve) => { resolveRead = resolve; }));
    const resultPromise = pollOrderCommandUntilTerminal({
      clientOrderId: CLIENT_ORDER_ID,
      initialResponse: processing,
      readStatus,
      pollImmediately: true,
      subscribeTerminal: source.subscribeTerminal,
    });
    let settled = false;
    void resultPromise.then(() => { settled = true; });
    source.emit(null);
    source.emit({ type: 'order_status_error', client_order_id: CLIENT_ORDER_ID });
    source.emit(processing);
    source.emit({ status: 'filled' });
    source.emit({ status: 'filled', client_order_id: 'another-command' });
    await Promise.resolve();
    expect(settled).toBe(false);

    resolveRead(filled);
    await expect(resultPromise).resolves.toMatchObject({ status: 'filled', position: { ticket: 701 } });
    expect(source.unsubscribe).toHaveBeenCalledOnce();
  });

  it('keeps listening after a failed status GET until the terminal push arrives during backoff', async () => {
    const source = createPushSource();
    const readStatus = vi.fn().mockRejectedValue(new Error('Temporary status read failure'));
    const onPollError = vi.fn();
    const resultPromise = pollOrderCommandUntilTerminal({
      clientOrderId: CLIENT_ORDER_ID,
      initialResponse: processing,
      readStatus,
      pollImmediately: true,
      subscribeTerminal: source.subscribeTerminal,
      onPollError,
    });

    await vi.advanceTimersByTimeAsync(0);
    expect(onPollError).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(1);
    source.emit(filled);
    await expect(resultPromise).resolves.toMatchObject({ status: 'filled' });
    expect(source.unsubscribe).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
    expect(readStatus).toHaveBeenCalledOnce();
  });

  it('retains the original deadline when no push arrives and unsubscribes at expiry', async () => {
    const source = createPushSource();
    const startedAtMs = Date.now() - 20_000;
    const readStatus = vi.fn().mockResolvedValue(processing);
    const resultPromise = pollOrderCommandUntilTerminal({
      clientOrderId: CLIENT_ORDER_ID,
      initialResponse: processing,
      readStatus,
      startedAtMs,
      startedAtMonoMs: performance.now() - 20_000,
      pollImmediately: true,
      subscribeTerminal: source.subscribeTerminal,
    });

    await vi.advanceTimersByTimeAsync(10_000);
    await expect(resultPromise).resolves.toMatchObject({
      status: 'outcome-unknown', terminal: false, synthetic: true,
    });
    expect(readStatus).toHaveBeenCalledTimes(11);
    expect(source.unsubscribe).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('accepts a synchronously delivered correlated terminal result and cleans up without polling', async () => {
    const unsubscribe = vi.fn();
    const readStatus = vi.fn();
    const result = await pollOrderCommandUntilTerminal({
      clientOrderId: CLIENT_ORDER_ID,
      initialResponse: processing,
      readStatus,
      pollImmediately: true,
      subscribeTerminal: (listener) => {
        listener(filled);
        return unsubscribe;
      },
    });

    expect(result.status).toBe('filled');
    expect(unsubscribe).toHaveBeenCalledOnce();
    expect(readStatus).not.toHaveBeenCalled();
  });

  it('keeps malformed HTTP status reads uncertain until the bounded wait ends', async () => {
    const source = createPushSource();
    const result = pollOrderCommandUntilTerminal({
      clientOrderId: CLIENT_ORDER_ID,
      initialResponse: processing,
      readStatus: async () => ({ client_order_id: CLIENT_ORDER_ID }),
      pollImmediately: true,
      subscribeTerminal: source.subscribeTerminal,
    });
    await vi.advanceTimersByTimeAsync(30_000);
    await expect(result).resolves.toMatchObject({ status: 'outcome-unknown', terminal: false });
    expect(source.unsubscribe).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
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
    expect(readStatus).toHaveBeenCalledWith(CLIENT_ORDER_ID, expect.any(AbortSignal));
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
      status: 'outcome-unknown',
      terminal: false,
      synthetic: true,
      error: {
        code: 'ORDER_OUTCOME_UNKNOWN',
        message: `Awaiting confirmation. Check command ${CLIENT_ORDER_ID} before placing another order.`,
      },
    });
  });

  it('reads recovery status immediately, then preserves the normal polling interval and original deadline', async () => {
    const startedAtMs = 1_800_000_000_000;
    let currentTime = startedAtMs + 20_000;
    const readTimes: number[] = [];
    const sleep = vi.fn(async (delayMs: number) => { currentTime += delayMs; });

    const result = await pollOrderCommandUntilTerminal({
      clientOrderId: CLIENT_ORDER_ID,
      initialResponse: { status: 'processing', client_order_id: CLIENT_ORDER_ID },
      readStatus: async () => {
        readTimes.push(currentTime);
        return { status: 'processing', client_order_id: CLIENT_ORDER_ID };
      },
      startedAtMs,
      pollImmediately: true,
      now: () => currentTime,
      sleep,
    });

    expect(readTimes).toHaveLength(11);
    expect(readTimes[0]).toBe(startedAtMs + 20_000);
    expect(readTimes[1]).toBe(startedAtMs + 21_000);
    expect(readTimes.at(-1)).toBe(startedAtMs + 30_000);
    expect(sleep.mock.calls.every(([delay]) => delay === 1_000)).toBe(true);
    expect(result).toMatchObject({ status: 'outcome-unknown', terminal: false });
  });

  it('returns an already-filled recovery read without waiting for a timer', async () => {
    const sleep = vi.fn(async () => undefined);
    const result = await pollOrderCommandUntilTerminal({
      clientOrderId: CLIENT_ORDER_ID,
      initialResponse: { status: 'processing', client_order_id: CLIENT_ORDER_ID },
      readStatus: async () => ({ status: 'filled', client_order_id: CLIENT_ORDER_ID, data: { ticket: 701 } }),
      pollImmediately: true,
      sleep,
    });

    expect(sleep).not.toHaveBeenCalled();
    expect(result).toMatchObject({ status: 'filled', position: { ticket: 701 } });
  });

  it('waits normally after an immediate recovery read fails', async () => {
    let currentTime = 1_800_000_000_000;
    const readTimes: number[] = [];
    const readStatus = vi.fn(async () => {
      readTimes.push(currentTime);
      if (readTimes.length === 1) throw new Error('Temporary status outage');
      return { status: 'filled', client_order_id: CLIENT_ORDER_ID };
    });

    const result = await pollOrderCommandUntilTerminal({
      clientOrderId: CLIENT_ORDER_ID,
      initialResponse: { status: 'processing', client_order_id: CLIENT_ORDER_ID },
      readStatus,
      pollImmediately: true,
      now: () => currentTime,
      sleep: async (delayMs) => { currentTime += delayMs; },
    });

    expect(readTimes).toEqual([1_800_000_000_000, 1_800_000_001_000]);
    expect(result.status).toBe('filled');
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
        execute_before: executeBefore, server_time_ms: currentTime,
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
        execute_before: 51, server_time: 50,
      },
      readStatus,
      now: () => currentTime,
      sleep: async (delayMs) => { currentTime += delayMs; },
      onPollError,
    });

    expect(readStatus).toHaveBeenCalledOnce();
    expect(onPollError).toHaveBeenCalledWith(pollError);
    expect(result.status).toBe('outcome-unknown');
  });

  it('does not adopt a terminal response correlated to another client_order_id', async () => {
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
    })).resolves.toMatchObject({ status: 'outcome-unknown', terminal: false, clientOrderId: CLIENT_ORDER_ID });
  });
});
