import { describe, expect, it, vi } from 'vitest';
import {
  closePositionsLocalFirst,
  createLocalFirstCloseCoordinator,
} from './localFirstCloseCoordinator';

type Deferred<T> = {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (reason: unknown) => void;
};

const createDeferred = <T>(): Deferred<T> => {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });

  return { promise, resolve, reject };
};

const flushPromises = async () => {
  await Promise.resolve();
  await Promise.resolve();
};

describe('local-first close coordinator', () => {
  it('starts local closes before loading the snapshot and adds only missing tickets', async () => {
    const snapshot = createDeferred<readonly { id: number }[]>();
    const closeByTicket = new Map<number, Deferred<void>>();
    const events: string[] = [];
    const closePosition = (ticketId: number) => {
      events.push(`close:${ticketId}`);
      const deferred = createDeferred<void>();
      closeByTicket.set(ticketId, deferred);
      return deferred.promise;
    };

    const resultPromise = closePositionsLocalFirst({
      sessionKey: 'broker-a:200002',
      getCurrentSessionKey: () => 'broker-a:200002',
      localCandidates: [{ id: 101 }, { id: 102 }, { id: 101 }],
      onCandidatesStarted: (candidates) => events.push(`pending:${candidates.map(({ id }) => id).join(',')}`),
      loadAuthoritativeCandidates: () => {
        events.push('load-snapshot');
        return snapshot.promise;
      },
      closePosition,
    });

    expect(events).toEqual(['close:101', 'close:102', 'pending:101,102', 'load-snapshot']);

    snapshot.resolve([{ id: 102 }, { id: 103 }, { id: 103 }, { id: 104 }]);
    await flushPromises();

    expect(events).toEqual([
      'close:101',
      'close:102',
      'pending:101,102',
      'load-snapshot',
      'close:103',
      'close:104',
      'pending:103,104',
    ]);

    closeByTicket.forEach(({ resolve }) => resolve(undefined));

    await expect(resultPromise).resolves.toMatchObject({
      attemptedTicketIds: [101, 102, 103, 104],
      confirmedTicketIds: [101, 102, 103, 104],
      failedTicketIds: [],
    });
  });

  it('preserves ticket ownership for mixed outcomes that settle out of order', async () => {
    const closeByTicket = new Map<number, Deferred<void>>();
    const firstFailure = new Error('ticket 202 rejected');
    const secondFailure = new Error('ticket 204 rejected');

    const resultPromise = closePositionsLocalFirst({
      sessionKey: 'broker-a:200002',
      getCurrentSessionKey: () => 'broker-a:200002',
      localCandidates: [{ id: 201 }, { id: 202 }],
      loadAuthoritativeCandidates: async () => [{ id: 202 }, { id: 203 }, { id: 204 }],
      closePosition: (ticketId) => {
        const deferred = createDeferred<void>();
        closeByTicket.set(ticketId, deferred);
        return deferred.promise;
      },
    });

    await flushPromises();
    closeByTicket.get(204)!.reject(secondFailure);
    closeByTicket.get(203)!.resolve(undefined);
    closeByTicket.get(202)!.reject(firstFailure);
    closeByTicket.get(201)!.resolve(undefined);

    await expect(resultPromise).resolves.toEqual({
      attemptedTicketIds: [201, 202, 203, 204],
      confirmedTicketIds: [201, 203],
      failedTicketIds: [202, 204],
      failedReasons: [firstFailure, secondFailure],
      skippedTicketIds: [],
      authoritativeSnapshotError: null,
      sessionCurrent: true,
    });
  });

  it('joins repeated runs for the same session into one in-flight operation', async () => {
    const coordinator = createLocalFirstCloseCoordinator();
    const snapshot = createDeferred<readonly { id: number }[]>();
    const closeRequest = createDeferred<void>();
    const closePosition = vi.fn(() => closeRequest.promise);
    const loadAuthoritativeCandidates = vi.fn(() => snapshot.promise);
    const options = {
      sessionKey: 'broker-a:200002',
      getCurrentSessionKey: () => 'broker-a:200002',
      localCandidates: [{ id: 301 }],
      loadAuthoritativeCandidates,
      closePosition,
    };

    const firstRun = coordinator.run(options);
    const secondRun = coordinator.run({
      ...options,
      localCandidates: [{ id: 999 }],
    });

    expect(secondRun).toBe(firstRun);
    expect(coordinator.hasInFlight('broker-a:200002')).toBe(true);
    expect(closePosition).toHaveBeenCalledTimes(1);
    expect(closePosition).toHaveBeenCalledWith(301);
    expect(loadAuthoritativeCandidates).toHaveBeenCalledTimes(1);

    snapshot.resolve([]);
    closeRequest.resolve(undefined);
    await firstRun;

    expect(coordinator.hasInFlight('broker-a:200002')).toBe(false);
  });

  it('does not start snapshot-only closes after the captured session changes', async () => {
    let currentSessionKey = 'broker-a:200002';
    const snapshot = createDeferred<readonly { id: number }[]>();
    const localClose = createDeferred<void>();
    const startedTicketIds: number[] = [];

    const resultPromise = closePositionsLocalFirst({
      sessionKey: currentSessionKey,
      getCurrentSessionKey: () => currentSessionKey,
      localCandidates: [{ id: 401 }],
      loadAuthoritativeCandidates: () => snapshot.promise,
      closePosition: (ticketId) => {
        startedTicketIds.push(ticketId);
        return localClose.promise;
      },
    });

    currentSessionKey = 'broker-b:200002';
    snapshot.resolve([{ id: 401 }, { id: 402 }]);
    localClose.resolve(undefined);

    await expect(resultPromise).resolves.toMatchObject({
      attemptedTicketIds: [401],
      confirmedTicketIds: [401],
      sessionCurrent: false,
    });
    expect(startedTicketIds).toEqual([401]);
  });
});
