import { getAuthToken } from '../api/client';
import { api } from './api';
import {
  getCommittedBrokerAccountSessionScope,
  getCommittedBrokerAccountSessionScopeKey,
} from './brokerSession';

type StartupAccount = Awaited<ReturnType<typeof api.account.getAccountSummary>>;
type StartupPositions = Awaited<ReturnType<typeof api.positions.getPositions>>;

export interface SessionTradeSnapshot {
  accountResult: PromiseSettledResult<StartupAccount>;
  positionsResult: PromiseSettledResult<StartupPositions>;
}

export interface SessionTradeSnapshotRequests {
  accountResultPromise: Promise<PromiseSettledResult<StartupAccount>>;
  positionsResultPromise: Promise<PromiseSettledResult<StartupPositions>>;
  snapshotPromise: Promise<SessionTradeSnapshot>;
}

const inFlightSnapshots = new Map<string, SessionTradeSnapshotRequests>();

const normalizeLogin = (value: string | number): number | null => {
  const normalized = String(value ?? '').trim();
  if (!/^[1-9]\d*$/.test(normalized)) return null;

  const login = Number(normalized);
  return Number.isSafeInteger(login) ? login : null;
};

const invalidSessionError = (message: string): Error => (
  new Error(`[TradeStartupSnapshot] ${message}`)
);

const startSettledRequest = <T,>(load: () => T | PromiseLike<T>): Promise<T> => {
  try {
    return Promise.resolve(load());
  } catch (error) {
    return Promise.reject(error);
  }
};

const settleRequest = <T,>(request: Promise<T>): Promise<PromiseSettledResult<T>> => (
  request.then<PromiseSettledResult<T>, PromiseSettledResult<T>>(
    (value) => ({ status: 'fulfilled', value }),
    (reason) => ({ status: 'rejected', reason }),
  )
);

/**
 * Coalesces only the concurrent account and position reads that hydrate the
 * first authenticated viewport. The key includes the runtime broker/account
 * scope and current access token, so a broker switch, account switch, logout,
 * or new login cannot reuse another session's in-flight request.
 *
 * The shared request intentionally has no consumer AbortSignal. A StrictMode
 * cleanup or unmounted panel may ignore its result, but it must not cancel the
 * root App consumer that owns the same startup snapshot.
 */
export const getSessionTradeSnapshotRequests = (
  requestedLogin: string | number,
): SessionTradeSnapshotRequests => {
  const login = normalizeLogin(requestedLogin);
  if (!login) throw invalidSessionError('A positive account login is required');

  const scope = getCommittedBrokerAccountSessionScope();
  const scopeLogin = normalizeLogin(scope.accountId ?? '');
  if (!scope.authenticated || !scopeLogin || scopeLogin !== login) {
    throw invalidSessionError('The requested login is not the active authenticated account');
  }
  if (!scope.brokerId || !scope.serverUrl) {
    throw invalidSessionError('The active broker session scope is incomplete');
  }

  const accessToken = String(getAuthToken() || '').trim();
  if (!accessToken) throw invalidSessionError('The active authenticated session has no access token');

  const scopeKey = getCommittedBrokerAccountSessionScopeKey(scope);
  const requestKey = `${scopeKey}\u0000${accessToken}`;
  const existing = inFlightSnapshots.get(requestKey);
  if (existing) return existing;

  const accountResultPromise = settleRequest(
    startSettledRequest(() => api.account.getAccountSummary(login)),
  );
  const positionsResultPromise = settleRequest(
    startSettledRequest(() => api.positions.getPositions(login)),
  );
  const snapshotPromise = Promise.all([
    accountResultPromise,
    positionsResultPromise,
  ]).then(([accountResult, positionsResult]) => ({
    accountResult,
    positionsResult,
  }));
  const requests = {
    accountResultPromise,
    positionsResultPromise,
    snapshotPromise,
  };

  inFlightSnapshots.set(requestKey, requests);
  const evict = () => {
    if (inFlightSnapshots.get(requestKey) === requests) {
      inFlightSnapshots.delete(requestKey);
    }
  };
  void snapshotPromise.then(evict, evict);

  return requests;
};

export const loadSessionTradeSnapshot = (
  requestedLogin: string | number,
): Promise<SessionTradeSnapshot> => {
  try {
    return getSessionTradeSnapshotRequests(requestedLogin).snapshotPromise;
  } catch (error) {
    return Promise.reject(error);
  }
};
