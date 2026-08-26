import { describe, expect, it, vi } from 'vitest';
import { closePositionsConcurrently } from './closePositionsConcurrently';

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

describe('closePositionsConcurrently', () => {
  it('starts every close before any request settles', async () => {
    const deferredByTicket = new Map([
      [101, createDeferred()],
      [102, createDeferred()],
      [103, createDeferred()],
    ]);
    const startedTicketIds: number[] = [];
    const settledTicketIds: number[] = [];

    const closePromise = closePositionsConcurrently(
      [{ id: 101 }, { id: 102 }, { id: 103 }],
      (ticketId) => {
        startedTicketIds.push(ticketId);
        return deferredByTicket.get(ticketId)!.promise.finally(() => {
          settledTicketIds.push(ticketId);
        });
      },
    );

    expect(startedTicketIds).toEqual([101, 102, 103]);
    expect(settledTicketIds).toEqual([]);

    deferredByTicket.forEach(({ resolve }) => resolve());

    await expect(closePromise).resolves.toEqual({
      confirmedTicketIds: [101, 102, 103],
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
});
