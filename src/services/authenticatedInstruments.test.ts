import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ApiRequestOptions } from '../api/client';
import { marketApi } from '../api/endpoints';
import { loadSharedAuthenticatedInstruments } from './authenticatedInstruments';

const state = vi.hoisted(() => ({
  get: vi.fn(), token: 'token-a', expired: false,
  scope: { authenticated: true, accountId: '123', brokerId: 'broker-a', serverUrl: 'https://broker.test' },
  listeners: [] as Array<() => void>,
}));

vi.mock('../api/client', () => ({
  apiClient: { get: state.get },
  getAuthToken: () => state.token,
  isStoredTokenExpired: () => state.expired,
  getDynamicUrl: (url: string) => `${state.scope.serverUrl}${new URL(url, 'https://config.test').pathname}`,
}));
vi.mock('./brokerSession', async (importOriginal) => ({
  ...await importOriginal<typeof import('./brokerSession')>(),
  getCommittedBrokerAccountSessionScope: () => state.scope,
  getCommittedBrokerAccountSessionScopeKey: (scope: unknown) => JSON.stringify(scope),
  onCommittedBrokerAccountSessionScopeChange: (callback: () => void) => { state.listeners.push(callback); },
  onSessionChange: (callback: () => void) => { state.listeners.push(callback); },
}));

type Pending = { resolve: (value: unknown) => void; reject: (error: unknown) => void; signal?: AbortSignal | null };
let pending: Pending[];
const options = (): ApiRequestOptions => ({ baseUrl: `${state.scope.serverUrl}/api/v2` });
const capturedOptions = (): ApiRequestOptions => ({
  ...options(), authToken: state.token, skipDynamicUrl: true,
  requestContext: {
    key: 'captured-session', backendOrigin: state.scope.serverUrl,
    refreshEndpoint: `${state.scope.serverUrl}/api/v2/auth/refresh`, refreshToken: 'refresh-a',
  },
});
const catalog = { instruments: [{ symbol: 'EURUSD', digits: 5, enabled: false }] };

beforeEach(() => {
  state.listeners.forEach((listener) => listener());
  state.scope = { authenticated: true, accountId: '123', brokerId: 'broker-a', serverUrl: 'https://broker.test' };
  state.token = 'token-a';
  state.expired = false;
  localStorage.setItem('refresh_token', 'refresh-a');
  pending = [];
  state.get.mockReset().mockImplementation((_endpoint: string, request: ApiRequestOptions) => new Promise((resolve, reject) => {
    pending.push({ resolve, reject, signal: request.signal });
    request.signal?.addEventListener('abort', () => reject(request.signal?.reason), { once: true });
  }));
});

afterEach(() => {
  state.listeners.forEach((listener) => listener());
  localStorage.clear();
});

describe('authenticated instruments in-flight sharing', () => {
  it('joins the captured hook request and both menu paths, preserving permissions', async () => {
    const hook = loadSharedAuthenticatedInstruments(capturedOptions(), state.scope);
    const menuBar = marketApi.getSymbols();
    const fileMenu = marketApi.getSymbols();
    expect(state.get).toHaveBeenCalledTimes(1);
    expect(state.get).toHaveBeenCalledWith('/instruments', expect.objectContaining({
      baseUrl: 'https://broker.test/api/v2', authToken: 'token-a',
      requestContext: capturedOptions().requestContext, skipDynamicUrl: true,
    }));
    pending[0].resolve(catalog);
    await expect(hook).resolves.toEqual(catalog);
    const menus = await Promise.all([menuBar, fileMenu]);
    expect(menus[0][0]).toMatchObject({ name: 'EURUSD', tradingEnabled: false });
    expect(menus[1]).toEqual(menus[0]);
  });

  it('also joins when a menu request starts before the captured hook', async () => {
    const menu = marketApi.getSymbols();
    const hook = loadSharedAuthenticatedInstruments(capturedOptions(), state.scope);
    expect(state.get).toHaveBeenCalledTimes(1);
    pending[0].resolve(catalog);
    await Promise.all([menu, hook]);
  });

  it('cancels one consumer without canceling the other', async () => {
    const controller = new AbortController();
    const first = loadSharedAuthenticatedInstruments({ ...options(), signal: controller.signal });
    const second = loadSharedAuthenticatedInstruments(options());
    const canceled = expect(first).rejects.toMatchObject({ name: 'AbortError' });
    controller.abort();
    await canceled;
    expect(pending[0].signal?.aborted).toBe(false);
    pending[0].resolve(catalog);
    await expect(second).resolves.toEqual(catalog);
  });

  it('aborts upstream when all consumers cancel and lets the next request start fresh', async () => {
    const controller = new AbortController();
    const first = loadSharedAuthenticatedInstruments({ ...options(), signal: controller.signal });
    const canceled = expect(first).rejects.toMatchObject({ name: 'AbortError' });
    controller.abort();
    await canceled;
    expect(pending[0].signal?.aborted).toBe(true);
    const next = loadSharedAuthenticatedInstruments(options());
    expect(state.get).toHaveBeenCalledTimes(2);
    pending[1].resolve(catalog);
    await next;
  });

  it('does not retain successful or failed results', async () => {
    const first = loadSharedAuthenticatedInstruments(options());
    pending[0].resolve(catalog);
    await first;
    const next = loadSharedAuthenticatedInstruments(options());
    const failed = expect(next).rejects.toThrow('offline');
    pending[1].reject(new Error('offline'));
    await failed;
    const retry = loadSharedAuthenticatedInstruments(options());
    expect(state.get).toHaveBeenCalledTimes(3);
    pending[2].resolve(catalog);
    await retry;
  });

  it.each(['accountId', 'brokerId', 'serverUrl', 'token', 'refreshToken'] as const)(
    'never joins across a changed %s', async (field) => {
      const first = loadSharedAuthenticatedInstruments(options());
      if (field === 'token') state.token = 'token-b';
      else if (field === 'refreshToken') localStorage.setItem('refresh_token', 'refresh-b');
      else state.scope = { ...state.scope, [field]: field === 'serverUrl' ? 'https://second.test' : 'second' };
      const second = loadSharedAuthenticatedInstruments(options());
      expect(state.get).toHaveBeenCalledTimes(2);
      pending.forEach((request) => request.resolve(catalog));
      await Promise.all([first, second]);
    },
  );

  it('does not rejoin the old request after a session lifecycle change', async () => {
    const first = loadSharedAuthenticatedInstruments(options());
    state.listeners.forEach((listener) => listener());
    const second = loadSharedAuthenticatedInstruments(options());
    expect(state.get).toHaveBeenCalledTimes(2);
    pending.forEach((request) => request.resolve(catalog));
    await Promise.all([first, second]);
  });

  it('keeps mismatched captured ownership and custom headers outside sharing', async () => {
    const first = loadSharedAuthenticatedInstruments(capturedOptions(), state.scope);
    const wrongAccount = loadSharedAuthenticatedInstruments(capturedOptions(), { ...state.scope, accountId: '456' });
    const wrongBroker = loadSharedAuthenticatedInstruments(capturedOptions(), { ...state.scope, brokerId: 'other' });
    const headers = loadSharedAuthenticatedInstruments({ ...capturedOptions(), headers: { 'X-Feature': 'custom' } });
    expect(state.get).toHaveBeenCalledTimes(4);
    pending.forEach((request) => request.resolve(catalog));
    await Promise.all([first, wrongAccount, wrongBroker, headers]);
  });

  it('preserves the API client expiry check instead of joining a captured token request', async () => {
    const captured = loadSharedAuthenticatedInstruments(capturedOptions(), state.scope);
    state.expired = true;
    const dynamic = loadSharedAuthenticatedInstruments(options());
    expect(state.get).toHaveBeenCalledTimes(2);
    expect(state.get.mock.calls[1][1]).toEqual(options());
    pending.forEach((request) => request.resolve(catalog));
    await Promise.all([captured, dynamic]);
  });

  it('starts no transport for an already canceled consumer', async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(loadSharedAuthenticatedInstruments({ ...options(), signal: controller.signal }))
      .rejects.toMatchObject({ name: 'AbortError' });
    expect(state.get).not.toHaveBeenCalled();
  });

  it('evicts synchronous transport errors', async () => {
    state.get.mockImplementationOnce(() => { throw new Error('synchronous failure'); });
    await expect(loadSharedAuthenticatedInstruments(options())).rejects.toThrow('synchronous failure');
    const retry = loadSharedAuthenticatedInstruments(options());
    expect(state.get).toHaveBeenCalledTimes(2);
    pending[0].resolve(catalog);
    await retry;
  });
});
