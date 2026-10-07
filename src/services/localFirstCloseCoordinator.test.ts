import { afterEach, describe, expect, it, vi } from 'vitest';
import { assertTerminalCloseQuote, calibrateTerminalQuoteClock, getTerminalQuoteFreshness, ingestTerminalQuote, resetTerminalQuoteFreshness, terminalQuoteFreshnessEnabled } from './terminalQuoteFreshness';
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
  for (let index = 0; index < 5; index += 1) {
    await Promise.resolve();
  }
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
    ]);

    closeByTicket.get(101)!.resolve(undefined);
    closeByTicket.get(102)!.resolve(undefined);
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

    closeByTicket.get(103)!.resolve(undefined);
    closeByTicket.get(104)!.resolve(undefined);

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
    closeByTicket.get(201)!.resolve(undefined);
    closeByTicket.get(202)!.reject(firstFailure);
    await flushPromises();
    closeByTicket.get(204)!.reject(secondFailure);
    closeByTicket.get(203)!.resolve(undefined);

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

  it('reports each ticket as soon as the backend confirms it, never a rejected one', async () => {
    const closeByTicket = new Map<number, Deferred<void>>();
    const confirmed: number[] = [];

    const resultPromise = closePositionsLocalFirst({
      sessionKey: 'broker-a:200002',
      getCurrentSessionKey: () => 'broker-a:200002',
      localCandidates: [{ id: 501 }, { id: 502 }, { id: 503 }],
      loadAuthoritativeCandidates: async () => [],
      closePosition: (ticketId) => {
        const deferred = createDeferred<void>();
        closeByTicket.set(ticketId, deferred);
        return deferred.promise;
      },
      onTicketConfirmed: (ticketId) => {
        confirmed.push(ticketId);
        if (ticketId === 503) throw new Error('UI handler failed');
      },
    });

    expect(confirmed).toEqual([]);

    closeByTicket.get(502)!.resolve(undefined);
    await flushPromises();
    expect(confirmed).toEqual([502]);

    closeByTicket.get(501)!.reject(new Error('ticket 501 rejected'));
    closeByTicket.get(503)!.resolve(undefined);
    await flushPromises();

    await expect(resultPromise).resolves.toMatchObject({
      confirmedTicketIds: [502, 503],
      failedTicketIds: [501],
    });
    expect(confirmed).toEqual([502, 503]);
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
    expect(closePosition).toHaveBeenCalledWith(301, { id: 301 });
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

describe('bulk close dispatch before presentation', () => {
  afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); resetTerminalQuoteFreshness(); });

  it('guards both local and snapshot-only requests while fresh before pending presentation ages their quotes', async () => {
    let mono = 1000, sequence = 0;
    const epoch = 1_800_000_000_000, events: string[] = [], pendingReasons: string[] = [];
    vi.spyOn(performance, 'now').mockImplementation(() => mono);
    vi.spyOn(Date, 'now').mockImplementation(() => epoch + mono);
    vi.stubGlobal('window', { RUNTIME_CONFIG: { TERMINAL_QUOTE_FRESHNESS: true } });
    expect(terminalQuoteFreshnessEnabled()).toBe(true);
    resetTerminalQuoteFreshness();
    expect(calibrateTerminalQuoteClock(epoch + mono, mono, epoch + mono, mono, epoch + mono)).toBe(true);
    const result = await closePositionsLocalFirst({
      sessionKey: 'original', getCurrentSessionKey: () => 'original',
      localCandidates: [{ id: 1 }], loadAuthoritativeCandidates: async () => [{ id: 1 }, { id: 2 }],
      onCandidatesPrepared: candidates => {
        events.push(`prepare:${candidates[0].id}`);
        expect(ingestTerminalQuote('BTCUSD', { bid: 100, ask: 101, provider_timestamp: epoch + mono,
          source: 'test', sequence: String(++sequence) })).toBe(true);
        mono += 2000;
      },
      closePosition: async id => { assertTerminalCloseQuote('BTCUSD'); events.push(`send:${id}`); },
      onCandidatesStarted: candidates => {
        mono += 2000; events.push(`pending:${candidates[0].id}`);
        pendingReasons.push(getTerminalQuoteFreshness('BTCUSD').reason);
      },
    });
    expect(result.confirmedTicketIds).toEqual([1, 2]); expect(result.failedTicketIds).toEqual([]);
    expect(pendingReasons).toEqual(['stale', 'stale']);
    expect(events).toEqual(['prepare:1', 'send:1', 'pending:1', 'prepare:2', 'send:2', 'pending:2']);
  });

  it('does not bypass a stale guard at dispatch or manufacture another attempt', async () => {
    let mono = 1000;
    const epoch = 1_800_000_000_000, sent = vi.fn();
    vi.spyOn(performance, 'now').mockImplementation(() => mono);
    vi.spyOn(Date, 'now').mockImplementation(() => epoch + mono);
    vi.stubGlobal('window', { RUNTIME_CONFIG: { TERMINAL_QUOTE_FRESHNESS: true } });resetTerminalQuoteFreshness();
    expect(terminalQuoteFreshnessEnabled()).toBe(true);
    expect(calibrateTerminalQuoteClock(epoch + mono, mono, epoch + mono, mono, epoch + mono)).toBe(true);
    expect(ingestTerminalQuote('BTCUSD', { bid: 100, ask: 101, provider_timestamp: epoch + mono, source: 'test', sequence: '1' })).toBe(true);
    mono += 4000;
    expect(() => assertTerminalCloseQuote('BTCUSD')).toThrow();
    const dispatch = vi.fn(async () => { assertTerminalCloseQuote('BTCUSD'); sent(); });
    const result = await closePositionsLocalFirst({sessionKey:'original',getCurrentSessionKey:()=> 'original',
      localCandidates:[{id:1}],loadAuthoritativeCandidates:async()=>[{id:1}],closePosition:dispatch});
    expect(result.failedTicketIds).toEqual([1]);expect(dispatch).toHaveBeenCalledTimes(1);expect(sent).not.toHaveBeenCalled();
  });

  it('keeps both original queues and claims in flight when pending and confirmed presentation throw', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const coordinator = createLocalFirstCloseCoordinator(), first = createDeferred<void>(), second = createDeferred<void>();
    const close = vi.fn((id: number) => id === 1 ? first.promise : second.promise);
    const started = vi.fn(() => { throw Error('pending render failed'); });
    const confirmed = vi.fn(() => { throw Error('confirmed render failed'); });
    const options = {sessionKey:'original',getCurrentSessionKey:()=> 'original',localCandidates:[{id:1}],
      loadAuthoritativeCandidates:async()=>[{id:1},{id:2}],closePosition:close,onCandidatesStarted:started,onTicketConfirmed:confirmed};
    const operation = coordinator.run(options);let settled = false;void operation.then(()=>{settled=true;});
    expect(coordinator.run(options)).toBe(operation);await flushPromises();expect(settled).toBe(false);expect(coordinator.hasInFlight('original')).toBe(true);
    first.resolve();await flushPromises();expect(close.mock.calls.map(([id])=>id)).toEqual([1,2]);expect(settled).toBe(false);expect(coordinator.hasInFlight('original')).toBe(true);
    second.resolve();await expect(operation).resolves.toMatchObject({confirmedTicketIds:[1,2],failedTicketIds:[]});
    expect(started).toHaveBeenCalledTimes(2);expect(confirmed).toHaveBeenCalledTimes(2);expect(coordinator.hasInFlight('original')).toBe(false);
  });

  it('blocks every queued dispatch and confirmation callback after a pending listener changes account', async () => {
    let scope = 'original';const pending = [createDeferred<void>(),createDeferred<void>(),createDeferred<void>()], confirmed = vi.fn();
    const close = vi.fn((id:number)=>pending[id-1].promise), load = vi.fn(async()=>[{id:5}]);
    const operation = closePositionsLocalFirst({sessionKey:'original',getCurrentSessionKey:()=>scope,
      localCandidates:[{id:1},{id:2},{id:3},{id:4}],loadAuthoritativeCandidates:load,closePosition:close,
      onCandidatesStarted:()=>{scope='other';},onTicketConfirmed:confirmed});
    expect(close).toHaveBeenCalledTimes(3);pending.forEach(item=>item.resolve());
    await expect(operation).resolves.toMatchObject({confirmedTicketIds:[1,2,3],failedTicketIds:[4],sessionCurrent:false});
    expect(close).toHaveBeenCalledTimes(3);expect(confirmed).not.toHaveBeenCalled();expect(load).not.toHaveBeenCalled();
  });

  it('does not send or present if preparation changes the account, or submit after failed preparation', async () => {
    let scope='original';const close=vi.fn(async()=>{}),present=vi.fn();
    const options={sessionKey:'original',getCurrentSessionKey:()=>scope,localCandidates:[{id:1}],loadAuthoritativeCandidates:async()=>[],closePosition:close,onCandidatesStarted:present};
    await expect(closePositionsLocalFirst({...options,onCandidatesPrepared:()=>{scope='other';}})).resolves.toMatchObject({failedTicketIds:[1],sessionCurrent:false});
    expect(close).not.toHaveBeenCalled();expect(present).not.toHaveBeenCalled();scope='original';
    await expect(closePositionsLocalFirst({...options,onCandidatesPrepared:()=>{throw Error('Preparation failed');}})).rejects.toThrow('Preparation failed');
    expect(close).not.toHaveBeenCalled();expect(present).not.toHaveBeenCalled();
  });
});
