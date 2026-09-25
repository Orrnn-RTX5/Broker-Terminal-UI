import { getAuthToken } from '../api/client';
import { api } from './api';
import {
  getCommittedBrokerAccountSessionScope,
  getCommittedBrokerAccountSessionScopeKey,
  onSessionChange,
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
const VALIDATED_ACCOUNT_HANDOFF_MS = 1_000;
let validatedAccountHandoff: {
  requestKey: string;
  account: StartupAccount;
  expiresAt: number;
  timeout: ReturnType<typeof setTimeout>;
} | null = null;

const clearValidatedAccountHandoff = () => {
  if (validatedAccountHandoff) clearTimeout(validatedAccountHandoff.timeout);
  validatedAccountHandoff = null;
};

onSessionChange(clearValidatedAccountHandoff);

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

const getSnapshotRequestIdentity = (
  requestedLogin: string | number,
): { login: number; requestKey: string; accessToken: string } => {
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
  return { login, requestKey, accessToken };
};

/** Reuse only the summary that just validated this exact restored session. */
export const seedValidatedSessionAccountSummary = (
  requestedLogin: string | number,
  account: StartupAccount,
  validatedAccessToken: string,
): boolean => {
  clearValidatedAccountHandoff();
  try {
    const { login, requestKey, accessToken } = getSnapshotRequestIdentity(requestedLogin);
    if (accessToken !== validatedAccessToken || inFlightSnapshots.has(requestKey)) return false;
    // Broker payloads may omit identity, since the request itself identifies
    // the account. Every supplied identity must still agree with that request.
    const record = account as StartupAccount & { login?: unknown; account_login?: unknown };
    const suppliedIds = [record.id, record.login, record.account_login]
      .filter((value) => value !== undefined && value !== null && value !== '');
    if (suppliedIds.some((value) => normalizeLogin(String(value)) !== login)) return false;

    validatedAccountHandoff = {
      requestKey,
      account,
      expiresAt: Date.now() + VALIDATED_ACCOUNT_HANDOFF_MS,
      timeout: setTimeout(clearValidatedAccountHandoff, VALIDATED_ACCOUNT_HANDOFF_MS),
    };
    return true;
  } catch {
    return false;
  }
};

/**
 * Coalesces concurrent account and position reads for one committed session.
 * The restore-only handoff saves a duplicate summary request; positions always
 * load fresh. Token and broker/account ownership guard both paths.
 *
 * The shared request intentionally has no consumer AbortSignal. A StrictMode
 * cleanup may ignore its result without cancelling another live consumer.
 */
export const getSessionTradeSnapshotRequests = (
  requestedLogin: string | number,
): SessionTradeSnapshotRequests => {
  const { login, requestKey } = getSnapshotRequestIdentity(requestedLogin);
  const existing = inFlightSnapshots.get(requestKey);
  if (existing) return existing;

  const handoff = validatedAccountHandoff;
  clearValidatedAccountHandoff();
  const canUseHandoff = handoff?.requestKey === requestKey && Date.now() < handoff.expiresAt;
  const accountResultPromise = canUseHandoff
    ? Promise.resolve<PromiseSettledResult<StartupAccount>>({ status: 'fulfilled', value: handoff.account })
    : settleRequest(startSettledRequest(() => api.account.getAccountSummary(login)));
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
