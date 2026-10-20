import { afterEach, beforeEach, expect, it, vi, type Mock } from 'vitest';

// The default chart symbol is tenant deployment config (no compiled-in market);
// these cases model a deployment that configured BTCUSD.
vi.hoisted(() => { vi.stubEnv('VITE_DEFAULT_CHART_SYMBOL', 'BTCUSD'); });
import type { OHLCData } from '../services/chartDataService';

const state = vi.hoisted(() => ({
  token: 'token-a', desktop: false,
  scope: { authenticated: true, accountId: '10001', brokerId: 'broker-a', serverUrl: 'https://broker-a.example' },
  clear: () => {}, scopeClear: () => {},
}));
vi.mock('../api/client', () => ({ getAuthToken: () => state.token }));
vi.mock('../config/backendTarget.js', () => ({ isDesktopBackendTarget: () => state.desktop }));
vi.mock('../services/brokerSession', () => ({
  getCommittedBrokerAccountSessionScope: () => state.scope,
  getCommittedBrokerAccountSessionScopeKey: (scope: typeof state.scope) => JSON.stringify(scope),
  onSessionChange: (clear: () => void) => { state.clear = clear; },
  onCommittedBrokerAccountSessionScopeChange: (clear: () => void) => { state.scopeClear = clear; },
}));
import { preloadAuthenticatedStartupHistory, takeAuthenticatedStartupHistory } from './authenticatedHistoryPrefetch';

const options = { symbol: 'BTCUSD', timeframe: 'M1', count: 500 };
const candles = [{ time: 1789479000, open: 100, high: 105, low: 98, close: 102, volume: 10 }];
let resolve: (value: OHLCData[]) => void;
let load: Mock<(signal: AbortSignal) => Promise<OHLCData[]>>;
let signal: AbortSignal;
beforeEach(() => {
  vi.useFakeTimers();
  state.token = 'token-a'; state.desktop = false;
  state.scope = { authenticated: true, accountId: '10001', brokerId: 'broker-a', serverUrl: 'https://broker-a.example' };
  load = vi.fn((requestSignal: AbortSignal) => new Promise<OHLCData[]>((done, reject) => {
    resolve = done; signal = requestSignal;
    signal.addEventListener('abort', () => reject(signal.reason), { once: true });
  }));
});
afterEach(() => { state.clear(); vi.clearAllTimers(); vi.useRealTimers(); });

it('starts once after committed auth and gives only the default chart its original response', async () => {
  preloadAuthenticatedStartupHistory(load);
  preloadAuthenticatedStartupHistory(load);
  expect(load).toHaveBeenCalledOnce(); // Transport must start before React's queued render.
  await vi.advanceTimersByTimeAsync(0);
  expect(load).toHaveBeenCalledOnce();
  expect(takeAuthenticatedStartupHistory({ ...options, symbol: 'EURUSD' })).toBeNull();
  expect(takeAuthenticatedStartupHistory({ ...options, timeframe: 'M5' })).toBeNull();
  expect(takeAuthenticatedStartupHistory({ ...options, count: 3 })).toBeNull();
  expect(takeAuthenticatedStartupHistory({ ...options, to: 1789479000 })).toBeNull();
  const result = takeAuthenticatedStartupHistory(options);
  expect(takeAuthenticatedStartupHistory(options)).toBeNull();
  resolve(candles);
  await expect(result).resolves.toEqual(candles);
  expect(vi.getTimerCount()).toBe(0);
});

it.each(['token', 'broker', 'account', 'server', 'logout'])('rejects a handoff after a %s change', async kind => {
  preloadAuthenticatedStartupHistory(load);
  await vi.advanceTimersByTimeAsync(0);
  if (kind === 'token') state.token = 'token-b';
  if (kind === 'broker') state.scope.brokerId = 'broker-b';
  if (kind === 'account') state.scope.accountId = '10002';
  if (kind === 'server') state.scope.serverUrl = 'https://broker-b.example';
  if (kind === 'logout') state.scope.authenticated = false;
  expect(takeAuthenticatedStartupHistory(options)).toBeNull();
  expect(signal.aborted).toBe(true);
  await vi.advanceTimersByTimeAsync(0);
});

it('invalidates on scope transitions even if the user returns to the same account', async () => {
  preloadAuthenticatedStartupHistory(load);
  await vi.advanceTimersByTimeAsync(0);
  state.scopeClear();
  expect(signal.aborted).toBe(true);
  expect(takeAuthenticatedStartupHistory(options)).toBeNull();
});

it('honors cancellation after the chart takes request ownership', async () => {
  preloadAuthenticatedStartupHistory(load);
  await vi.advanceTimersByTimeAsync(0);
  const controller = new AbortController();
  const result = takeAuthenticatedStartupHistory({ ...options, signal: controller.signal });
  const rejected = expect(result).rejects.toMatchObject({ name: 'AbortError' });
  controller.abort();
  await rejected;
  expect(signal.aborted).toBe(true);
});

it('rejects claimed history after leaving and returning to the same session', async () => {
  preloadAuthenticatedStartupHistory(load);
  await vi.advanceTimersByTimeAsync(0);
  const result = takeAuthenticatedStartupHistory(options);
  const rejected = expect(result).rejects.toMatchObject({ name: 'AbortError' });
  state.scopeClear();
  state.scopeClear();
  resolve(candles);
  await rejected;
});

it('expires completed history after one second and abandons unused slow requests', async () => {
  preloadAuthenticatedStartupHistory(load);
  await vi.advanceTimersByTimeAsync(0);
  resolve(candles);
  await vi.advanceTimersByTimeAsync(1001);
  expect(takeAuthenticatedStartupHistory(options)).toBeNull();
  preloadAuthenticatedStartupHistory(load);
  await vi.advanceTimersByTimeAsync(10000);
  expect(signal.aborted).toBe(true);
  expect(takeAuthenticatedStartupHistory(options)).toBeNull();
});

it('leaves a claimed slow request under the chart cancellation policy', async () => {
  preloadAuthenticatedStartupHistory(load);
  await vi.advanceTimersByTimeAsync(0);
  const result = takeAuthenticatedStartupHistory(options);
  await vi.advanceTimersByTimeAsync(10001);
  expect(signal.aborted).toBe(false);
  resolve(candles);
  await expect(result).resolves.toEqual(candles);
});

it.each(['desktop', 'anonymous', 'no-token'])('does not speculate for %s', async kind => {
  if (kind === 'desktop') state.desktop = true;
  if (kind === 'anonymous') state.scope.authenticated = false;
  if (kind === 'no-token') state.token = '';
  preloadAuthenticatedStartupHistory(load);
  await vi.advanceTimersByTimeAsync(0);
  expect(load).not.toHaveBeenCalled();
});
