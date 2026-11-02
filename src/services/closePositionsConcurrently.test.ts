import { describe, expect, it, vi } from 'vitest';
import {
  closePositionsConcurrently,
  MAX_PARALLEL_POSITION_CLOSES,
} from './closePositionsConcurrently';

type Deferred = {
  promise: Promise<void>;
  resolve: () => void;
  reject: (reason: unknown) => void;
};

const createDeferred = (): Deferred => {
  let resolve!: () => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<void>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });

  return { promise, resolve, reject };
};

const flushPromises = async () => {
  for (let index = 0; index < 5; index += 1) {
    await Promise.resolve();
  }
};

describe('closePositionsConcurrently', () => {
  it('never exceeds the safe per-account close concurrency', async () => {
    const deferredByTicket = new Map([
      [101, createDeferred()],
      [102, createDeferred()],
      [103, createDeferred()],
      [104, createDeferred()],
    ]);
    const startedTicketIds: number[] = [];
    const settledTicketIds: number[] = [];

    const closePromise = closePositionsConcurrently(
      [{ id: 101 }, { id: 102 }, { id: 103 }, { id: 104 }],
      (ticketId) => {
        startedTicketIds.push(ticketId);
        return deferredByTicket.get(ticketId)!.promise.finally(() => {
          settledTicketIds.push(ticketId);
        });
      },
    );

    expect(startedTicketIds).toEqual([101, 102, 103]);
    expect(startedTicketIds).toHaveLength(MAX_PARALLEL_POSITION_CLOSES);
    expect(settledTicketIds).toEqual([]);

    deferredByTicket.get(101)!.resolve();
    await flushPromises();
    expect(startedTicketIds).toEqual([101, 102, 103, 104]);

    deferredByTicket.get(102)!.resolve();
    deferredByTicket.get(103)!.resolve();
    deferredByTicket.get(104)!.resolve();

    await expect(closePromise).resolves.toEqual({
      confirmedTicketIds: [101, 102, 103, 104],
      failedTicketIds: [],
      failedReasons: [],
    });
  });

  it('maps mixed out-of-order outcomes back to tickets in candidate order', async () => {
    const deferredByTicket = new Map([
      [201, createDeferred()],
      [202, createDeferred()],
      [203, createDeferred()],
      [204, createDeferred()],
    ]);
    const firstFailure = new Error('ticket 202 rejected');
    const secondFailure = new Error('ticket 204 rejected');

    const closePromise = closePositionsConcurrently(
      [{ id: 201 }, { id: 202 }, { id: 203 }, { id: 204 }],
      (ticketId) => deferredByTicket.get(ticketId)!.promise,
    );

    deferredByTicket.get(203)!.resolve();
    deferredByTicket.get(204)!.reject(secondFailure);
    deferredByTicket.get(202)!.reject(firstFailure);
    deferredByTicket.get(201)!.resolve();

    await expect(closePromise).resolves.toEqual({
      confirmedTicketIds: [201, 203],
      failedTicketIds: [202, 204],
      failedReasons: [firstFailure, secondFailure],
    });
  });

  it('returns empty results without calling the close callback for empty input', async () => {
    const closePosition = vi.fn<(ticketId: number) => Promise<void>>();

    await expect(closePositionsConcurrently([], closePosition)).resolves.toEqual({
      confirmedTicketIds: [],
      failedTicketIds: [],
      failedReasons: [],
    });
    expect(closePosition).not.toHaveBeenCalled();
  });

  it('retries 429 ORDER_RATE_LIMITED / TOO_MANY_ORDERS responses so batches larger than 20 positions close completely', async () => {
    const attemptsByTicket = new Map<number, number>();
    const twentyTwoCandidates = Array.from({ length: 22 }, (_, index) => ({ id: 75181600 + index }));

    const result = await closePositionsConcurrently(
      twentyTwoCandidates,
      async (ticketId) => {
        const prev = attemptsByTicket.get(ticketId) ?? 0;
        attemptsByTicket.set(ticketId, prev + 1);
        if (ticketId >= 75181620 && prev === 0) {
          const err = Object.assign(new Error('Order rate limit exceeded (429)'), {
            status: 429,
            code: 'ORDER_RATE_LIMITED',
          });
          throw err;
        }
      },
      { retryDelayMs: 1 },
    );

    expect(result.confirmedTicketIds).toHaveLength(22);
    expect(result.failedTicketIds).toEqual([]);
    expect(attemptsByTicket.get(75181620)).toBe(2);
    expect(attemptsByTicket.get(75181621)).toBe(2);
  });
});
