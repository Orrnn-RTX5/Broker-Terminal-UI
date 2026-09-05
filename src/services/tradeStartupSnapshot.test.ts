import { beforeEach, describe, expect, it, vi } from 'vitest';

type Deferred<T> = {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (reason?: unknown) => void;
};

const deferred = <T,>(): Deferred<T> => {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
};

const mocks = vi.hoisted(() => ({
  token: 'access-token-a',
  scope: {
    authenticated: true,
    accountId: '200001',
    brokerId: 'test',
    serverUrl: 'https://test.example.com',
  },
  getAccountSummary: vi.fn(),
  getPositions: vi.fn(),
}));

vi.mock('../api/client', () => ({
  getAuthToken: () => mocks.token,
}));

vi.mock('./brokerSession', () => ({
  getCommittedBrokerAccountSessionScope: () => mocks.scope,
  getCommittedBrokerAccountSessionScopeKey: (scope: typeof mocks.scope) => [
    scope.authenticated ? 'authenticated' : 'anonymous',
    scope.accountId || '',
    scope.brokerId,
    scope.serverUrl,
  ].join('|'),
}));

vi.mock('./api', () => ({
  api: {
    account: {
      getAccountSummary: mocks.getAccountSummary,
    },
    positions: {
      getPositions: mocks.getPositions,
    },
  },
}));

import {
  getSessionTradeSnapshotRequests,
  loadSessionTradeSnapshot,
} from './tradeStartupSnapshot';

describe('loadSessionTradeSnapshot', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.token = 'access-token-a';
    mocks.scope.authenticated = true;
    mocks.scope.accountId = '200001';
    mocks.scope.brokerId = 'test';
    mocks.scope.serverUrl = 'https://test.example.com';
  });

  it('coalesces concurrent account and position reads for one authenticated session', async () => {
    const account = deferred<{ id: string; balance: number }>();
    const positions = deferred<Array<{ id: number }>>();
    mocks.getAccountSummary.mockReturnValue(account.promise);
    mocks.getPositions.mockReturnValue(positions.promise);

    const firstConsumer = loadSessionTradeSnapshot(200001);
    const secondConsumer = loadSessionTradeSnapshot('200001');

    expect(secondConsumer).toBe(firstConsumer);
    expect(mocks.getAccountSummary).toHaveBeenCalledTimes(1);
    expect(mocks.getPositions).toHaveBeenCalledTimes(1);

    account.resolve({ id: '200001', balance: 1000 });
    positions.resolve([{ id: 17 }]);

    const snapshot = await secondConsumer;
    expect(snapshot.accountResult).toEqual({
      status: 'fulfilled',
      value: { id: '200001', balance: 1000 },
    });
    expect(snapshot.positionsResult).toEqual({
      status: 'fulfilled',
      value: [{ id: 17 }],
    });
  });

  it('releases positions without waiting for the account request', async () => {
    const account = deferred<{ id: string; balance: number }>();
    const positions = deferred<Array<{ id: number }>>();
    mocks.getAccountSummary.mockReturnValue(account.promise);
    mocks.getPositions.mockReturnValue(positions.promise);

    const requests = getSessionTradeSnapshotRequests(200001);
    let combinedSettled = false;
    void requests.snapshotPromise.then(() => {
      combinedSettled = true;
    });

    positions.resolve([{ id: 17 }]);

    await expect(requests.positionsResultPromise).resolves.toEqual({
      status: 'fulfilled',
      value: [{ id: 17 }],
    });
    expect(combinedSettled).toBe(false);

    account.resolve({ id: '200001', balance: 1000 });
    await expect(requests.snapshotPromise).resolves.toMatchObject({
      accountResult: { status: 'fulfilled' },
      positionsResult: { status: 'fulfilled' },
    });
  });

  it('keeps partial failures named and evicts the entry after settlement', async () => {
    const accountError = new Error('account unavailable');
    mocks.getAccountSummary.mockRejectedValueOnce(accountError);
    mocks.getPositions.mockResolvedValueOnce([{ id: 18 }]);

    const first = await loadSessionTradeSnapshot(200001);
    expect(first.accountResult).toEqual({ status: 'rejected', reason: accountError });
    expect(first.positionsResult).toEqual({ status: 'fulfilled', value: [{ id: 18 }] });

    mocks.getAccountSummary.mockResolvedValueOnce({ id: '200001', balance: 2000 });
    mocks.getPositions.mockResolvedValueOnce([{ id: 19 }]);
    const retry = await loadSessionTradeSnapshot(200001);

    expect(mocks.getAccountSummary).toHaveBeenCalledTimes(2);
    expect(mocks.getPositions).toHaveBeenCalledTimes(2);
    expect(retry.accountResult.status).toBe('fulfilled');
    expect(retry.positionsResult.status).toBe('fulfilled');
  });

  it('does not coalesce different access tokens or committed broker scopes', async () => {
    const accountRequests = [deferred<unknown>(), deferred<unknown>(), deferred<unknown>()];
    const positionRequests = [deferred<unknown[]>(), deferred<unknown[]>(), deferred<unknown[]>()];
    accountRequests.forEach((request) => mocks.getAccountSummary.mockReturnValueOnce(request.promise));
    positionRequests.forEach((request) => mocks.getPositions.mockReturnValueOnce(request.promise));

    const firstSession = loadSessionTradeSnapshot(200001);

    mocks.token = 'access-token-b';
    const rotatedTokenSession = loadSessionTradeSnapshot(200001);

    mocks.scope.brokerId = 'second-broker';
    mocks.scope.serverUrl = 'https://second.example.com';
    const switchedBrokerSession = loadSessionTradeSnapshot(200001);

    expect(mocks.getAccountSummary).toHaveBeenCalledTimes(3);
    expect(mocks.getPositions).toHaveBeenCalledTimes(3);

    accountRequests.forEach((request, index) => request.resolve({ id: `account-${index}` }));
    positionRequests.forEach((request, index) => request.resolve([{ id: index }]));
    await Promise.all([firstSession, rotatedTokenSession, switchedBrokerSession]);
  });

  it('rejects invalid, unauthenticated, mismatched, incomplete, or tokenless sessions before loading', async () => {
    await expect(loadSessionTradeSnapshot('not-a-login')).rejects.toThrow('positive account login');

    mocks.scope.authenticated = false;
    await expect(loadSessionTradeSnapshot(200001)).rejects.toThrow('active authenticated account');

    mocks.scope.authenticated = true;
    mocks.scope.accountId = '200002';
    await expect(loadSessionTradeSnapshot(200001)).rejects.toThrow('active authenticated account');

    mocks.scope.accountId = '200001';
    mocks.scope.serverUrl = '';
    await expect(loadSessionTradeSnapshot(200001)).rejects.toThrow('scope is incomplete');

    mocks.scope.serverUrl = 'https://test.example.com';
    mocks.token = '';
    await expect(loadSessionTradeSnapshot(200001)).rejects.toThrow('no access token');

    expect(mocks.getAccountSummary).not.toHaveBeenCalled();
    expect(mocks.getPositions).not.toHaveBeenCalled();
  });

  it('lets a live consumer finish when an earlier StrictMode-style consumer is ignored', async () => {
    const account = deferred<{ id: string }>();
    const positions = deferred<Array<{ id: number }>>();
    mocks.getAccountSummary.mockReturnValue(account.promise);
    mocks.getPositions.mockReturnValue(positions.promise);

    void loadSessionTradeSnapshot(200001); // First mount is disposed and ignores the shared result.
    const liveConsumer = loadSessionTradeSnapshot(200001);

    account.resolve({ id: '200001' });
    positions.resolve([{ id: 20 }]);

    await expect(liveConsumer).resolves.toMatchObject({
      accountResult: { status: 'fulfilled' },
      positionsResult: { status: 'fulfilled' },
    });
    expect(mocks.getAccountSummary).toHaveBeenCalledTimes(1);
    expect(mocks.getPositions).toHaveBeenCalledTimes(1);
  });
});
