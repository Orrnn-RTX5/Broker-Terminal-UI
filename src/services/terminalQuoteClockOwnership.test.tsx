import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  scope: { authenticated: true, accountId: '200001' as string | null, brokerId: 'broker-one', serverUrl: 'https://broker.one' },
  server: 'https://broker.one', access: 'access-a', refresh: 'refresh-a', get: vi.fn(), sessions: new Set<() => void>(),
}));
vi.mock('./brokerSession', () => ({
  getCommittedBrokerAccountSessionScope: () => mocks.scope,
  getCommittedBrokerAccountSessionScopeKey: (scope: unknown) => JSON.stringify(scope),
  getServerUrl: () => mocks.server, getAccessToken: () => mocks.access, getRefreshToken: () => mocks.refresh,
  onSessionChange: (callback: () => void) => { mocks.sessions.add(callback); return () => mocks.sessions.delete(callback); },
}));
vi.mock('../config/localDevProxy', () => ({ toLocalDevProxyUrl: (value: string) => value }));
vi.mock('../config/api', () => ({ API_V2_BASE_URL: 'https://unbound-default.test/api/v2' }));
vi.mock('../api/client', () => ({ apiClient: { get: mocks.get } }));

import { getTerminalQuoteClockOwner, resetTerminalQuoteTransport } from './terminalQuoteClockOwnership';
import { calibrateTerminalQuoteClock, getTerminalQuoteClockNowMs, getTerminalQuoteFreshness,
  getTerminalQuoteSession, ingestTerminalQuote, isTerminalQuoteClockVerified, resetTerminalQuoteFreshness } from './terminalQuoteFreshness';
import { useTerminalQuoteClock } from '../hooks/useTerminalQuoteClock';

const epoch = 1_800_000_000_000;
let mono: number;
let wall: number;
const calibrate = () => calibrateTerminalQuoteClock(epoch + mono, mono, wall, mono, wall,
  getTerminalQuoteSession(), getTerminalQuoteClockOwner());
const tick = () => ({ bid: 100, ask: 101, provider_timestamp: epoch + mono, sequence: 1, source: 'lp' });

describe('independent broker clock ownership across quote transport resets', () => {
  beforeEach(() => {
    vi.useFakeTimers(); mono = 0; wall = epoch;
    vi.spyOn(performance, 'now').mockImplementation(() => mono);
    vi.spyOn(Date, 'now').mockImplementation(() => wall);
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' });
    (window as Window & { __RTX_RUNTIME_CONFIG__?: Record<string, unknown> }).__RTX_RUNTIME_CONFIG__ = { TERMINAL_QUOTE_FRESHNESS: true };
    mocks.scope = { authenticated: true, accountId: '200001', brokerId: 'broker-one', serverUrl: 'https://broker.one' };
    mocks.server = 'https://broker.one'; mocks.access = 'access-a'; mocks.refresh = 'refresh-a';
    resetTerminalQuoteFreshness();
    mocks.get.mockReset().mockResolvedValue({ server_time_ms: epoch });
  });
  afterEach(() => {
    cleanup(); resetTerminalQuoteFreshness(); vi.restoreAllMocks(); vi.useRealTimers();
    delete (window as Window & { __RTX_RUNTIME_CONFIG__?: Record<string, unknown> }).__RTX_RUNTIME_CONFIG__;
  });

  it('preserves the same broker clock while invalidating all quotes and old-generation packets', () => {
    expect(calibrate()).toBe(true);
    const previousSession = getTerminalQuoteSession();
    ingestTerminalQuote('BTCUSD', tick());
    mono += 500; wall += 500;
    resetTerminalQuoteTransport();
    expect(getTerminalQuoteSession()).toBe(previousSession + 1);
    expect(isTerminalQuoteClockVerified()).toBe(true);
    expect(getTerminalQuoteFreshness('BTCUSD').reason).toBe('unavailable');
    expect(ingestTerminalQuote('BTCUSD', tick(), previousSession)).toBe(false);
    expect(ingestTerminalQuote('BTCUSD', tick())).toBe(true);
    expect(getTerminalQuoteFreshness('BTCUSD').live).toBe(true);
  });

  it('does not extend the original sixty-second calibration deadline', () => {
    calibrate();
    mono = 59_000; wall = epoch + mono;
    resetTerminalQuoteTransport();
    expect(isTerminalQuoteClockVerified()).toBe(true);
    mono = 60_000; wall = epoch + mono;
    resetTerminalQuoteTransport();
    expect(isTerminalQuoteClockVerified()).toBe(false);
  });

  it.each(['wall-clock', 'backwards-monotonic'])('does not preserve a %s discontinuity', change => {
    calibrate();
    if (change === 'wall-clock') wall += 1000;
    else mono = -1;
    resetTerminalQuoteTransport();
    expect(isTerminalQuoteClockVerified()).toBe(false);
    wall = epoch; mono = 0;
    expect(isTerminalQuoteClockVerified()).toBe(false);
  });

  it.each(['broker', 'server', 'account', 'auth', 'access', 'refresh'])('rejects changed %s ownership immediately and cannot revive it', change => {
    calibrate();
    const original = { ...mocks.scope };
    if (change === 'broker') mocks.scope.brokerId = 'broker-two';
    if (change === 'server') { mocks.scope.serverUrl = 'https://broker.two'; mocks.server = 'https://broker.two'; }
    if (change === 'account') mocks.scope.accountId = '200002';
    if (change === 'auth') mocks.scope.authenticated = false;
    if (change === 'access') mocks.access = 'access-b';
    if (change === 'refresh') mocks.refresh = 'refresh-b';
    expect(isTerminalQuoteClockVerified()).toBe(false);
    mocks.scope = original; mocks.server = 'https://broker.one'; mocks.access = 'access-a'; mocks.refresh = 'refresh-a';
    expect(isTerminalQuoteClockVerified()).toBe(false);
    resetTerminalQuoteTransport();
    expect(isTerminalQuoteClockVerified()).toBe(false);
  });

  it('requires exact agreement between committed broker server and actual request server', () => {
    calibrate(); mocks.server = 'https://other-server.test';
    expect(getTerminalQuoteClockOwner()).toBeUndefined();
    resetTerminalQuoteTransport(); expect(isTerminalQuoteClockVerified()).toBe(false);
  });

  it('does not preserve an unbound sample and keeps full reset semantics', () => {
    calibrateTerminalQuoteClock(epoch, mono, wall, mono, wall);
    resetTerminalQuoteTransport(); expect(isTerminalQuoteClockVerified()).toBe(false);
    calibrate(); resetTerminalQuoteFreshness(); expect(isTerminalQuoteClockVerified()).toBe(false);
  });

  it('rejects a pending calibration when the owner server has changed', () => {
    const owner = getTerminalQuoteClockOwner();
    mocks.server = 'https://broker.two'; mocks.scope.serverUrl = mocks.server;
    expect(calibrateTerminalQuoteClock(epoch, mono, wall, mono, wall, getTerminalQuoteSession(), owner)).toBe(false);
    expect(isTerminalQuoteClockVerified()).toBe(false);
  });

  it('pins HTTP sampling to its broker and ignores a response from the prior quote generation', async () => {
    renderHook(() => useTerminalQuoteClock());
    await act(async () => {});
    expect(mocks.get).toHaveBeenCalledWith('/time', expect.objectContaining({
      baseUrl: 'https://broker.one/api/v2', skipDynamicUrl: true, skipAuth: true,
    }));
    expect(isTerminalQuoteClockVerified()).toBe(true);
    let complete!: (value: unknown) => void;
    mocks.get.mockReturnValueOnce(new Promise(resolve => { complete = resolve; }));
    act(() => { window.dispatchEvent(new Event('rtx:quote-clock-refresh')); });
    act(() => { resetTerminalQuoteTransport(); });
    expect(isTerminalQuoteClockVerified()).toBe(true);
    await act(async () => { complete({ server_time_ms: epoch + 30_000 }); });
    expect(getTerminalQuoteClockNowMs()).toBe(epoch);
  });

  it.each(['session', 'offline', 'pageshow'])('fully invalidates the retained anchor on %s', async change => {
    renderHook(() => useTerminalQuoteClock()); await act(async () => {});
    resetTerminalQuoteTransport(); expect(isTerminalQuoteClockVerified()).toBe(true);
    mocks.get.mockImplementation(() => new Promise(() => {}));
    act(() => {
      if (change === 'session') mocks.sessions.forEach(callback => callback());
      else window.dispatchEvent(new Event(change));
    });
    expect(isTerminalQuoteClockVerified()).toBe(false);
  });
});
