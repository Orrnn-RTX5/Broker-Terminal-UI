import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ token: 'token-a', broker: 'nexa', server: 'https://broker.test',
  session: new Set<() => void>() }));
vi.mock('../config/api', () => ({ toLocalDevProxyUrl: (value: string) => value }));
vi.mock('../store/useAppStore', async () => {
  const { createStore } = await import('zustand/vanilla');
  return { useAppStore: createStore(() => ({})) };
});
vi.mock('../features/market-data/marketDataSession', () => ({
  getApiSessionDescriptor: (accountId: string) => ({ accountId, brokerId: mocks.broker,
    apiRootBaseUrl: mocks.server, v2BaseUrl: `${mocks.server}/api/v2` }),
  captureApiSession: () => mocks.token ? ({ runtimeKey: mocks.token }) : null,
}));
vi.mock('./brokerSession', async importOriginal => ({
  ...await importOriginal<typeof import('./brokerSession')>(),
  onSessionChange: (callback: () => void) => { mocks.session.add(callback); return () => mocks.session.delete(callback); },
}));

import { prepareTerminalMarketQuote } from './terminalMarketQuotePreflight';
import { commitBrokerAccountSessionScope } from './brokerSession';
import { useAppStore } from '../store/useAppStore';
import { calibrateTerminalQuoteClock, getTerminalQuoteFreshness, ingestTerminalQuote,
  resetTerminalQuoteFreshness, type TerminalQuoteEvidence } from './terminalQuoteFreshness';

const epoch = 1_800_000_000_000;
const runtimeWindow = window as Window & { __RTX_RUNTIME_CONFIG__?: Record<string, unknown> };
const quote = (patch: Partial<TerminalQuoteEvidence> = {}): TerminalQuoteEvidence => ({
  provider_timestamp: Date.now(), bid: 86000, ask: 86015, sequence: '2', source: 'cserver',
  stale: false, tradable: true, source_mismatch: false, ...patch,
});
const stale = () => ingestTerminalQuote('BTCUSD', quote({ provider_timestamp: epoch - 4000, sequence: '1' }));
const observe = (pending: Promise<void> | undefined) => {
  expect(pending).toBeInstanceOf(Promise);
  return pending!.then(() => ({ passed: true, error: undefined }), error => ({ passed: false, error }));
};
const expectClean = () => {
  expect(vi.getTimerCount()).toBe(0);
  expect(mocks.session.size).toBe(0);
};

describe('bounded market quote preflight', () => {
  beforeEach(() => {
    vi.useFakeTimers(); vi.setSystemTime(epoch);
    vi.spyOn(performance, 'now').mockImplementation(() => Date.now() - epoch);
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' });
    Object.defineProperty(navigator, 'onLine', { configurable: true, value: true });
    runtimeWindow.__RTX_RUNTIME_CONFIG__ = { TERMINAL_QUOTE_FRESHNESS: true };
    mocks.token = 'token-a'; mocks.broker = 'nexa'; mocks.server = 'https://broker.test';
    useAppStore.setState({ isAuthenticated: true, accountId: '200001', authToken: 'token-a', refreshToken: null });
    commitBrokerAccountSessionScope({ authenticated: true, accountId: '200001', brokerId: 'nexa', serverUrl: mocks.server });
    resetTerminalQuoteFreshness();
    calibrateTerminalQuoteClock(epoch, 0, epoch, 0, epoch);
  });
  afterEach(() => {
    expectClean();
    vi.restoreAllMocks(); vi.useRealTimers();
    delete runtimeWindow.__RTX_RUNTIME_CONFIG__;
  });

  it.each(['live', 'time-unverified', 'disabled'])('keeps the %s path synchronous without listeners', reason => {
    if (reason === 'time-unverified') resetTerminalQuoteFreshness();
    if (reason === 'disabled') runtimeWindow.__RTX_RUNTIME_CONFIG__ = { TERMINAL_QUOTE_FRESHNESS: false };
    ingestTerminalQuote('BTCUSD', quote());
    expect(prepareTerminalMarketQuote('BTCUSD', () => true)).toBeUndefined();
    expectClean();
  });

  it('waits for the next live quote and cleans up before resolving', async () => {
    stale();
    const result = observe(prepareTerminalMarketQuote('BTCUSD', () => true));
    await vi.advanceTimersByTimeAsync(300);
    ingestTerminalQuote('BTCUSD', quote());
    expect(await result).toEqual({ passed: true, error: undefined });
    expectClean();
  });

  it('expires with the original stale error and never resumes on a later live quote', async () => {
    stale();
    const result = observe(prepareTerminalMarketQuote('BTCUSD', () => true));
    await vi.advanceTimersByTimeAsync(1500);
    const outcome = await result;
    expect(outcome).toMatchObject({ passed: false, error: { code: 'QUOTE_STALE', symbol: 'BTCUSD' } });
    expectClean();
    ingestTerminalQuote('BTCUSD', quote());
    expect(await result).toBe(outcome);
  });

  it.each([
    [{ source_mismatch: true }, 'QUOTE_SOURCE_MISMATCH'],
    [{ tradable: false }, 'QUOTE_NOT_TRADABLE'],
    [{ provider_timestamp: undefined }, 'QUOTE_UNAVAILABLE'],
  ] as const)('immediately rejects initial invalid evidence %j', (patch, code) => {
    ingestTerminalQuote('BTCUSD', quote(patch));
    expect(() => prepareTerminalMarketQuote('BTCUSD', () => true)).toThrow(expect.objectContaining({ code }));
  });

  it.each([
    [{ source_mismatch: true }, 'QUOTE_SOURCE_MISMATCH'],
    [{ tradable: false }, 'QUOTE_NOT_TRADABLE'],
  ] as const)('stops if new evidence introduces an explicit veto %j', async (patch, code) => {
    stale();
    const result = observe(prepareTerminalMarketQuote('BTCUSD', () => true));
    ingestTerminalQuote('BTCUSD', quote(patch));
    expect(await result).toMatchObject({ passed: false, error: { code } });
  });

  it.each([
    { stale: true }, { provider_timestamp: epoch - 3500 }, { provider_timestamp: epoch + 60_000 },
    { provider_timestamp: undefined }, { ask: undefined }, { sequence: '0' },
  ])('does not accept a bad or still-stale replacement %j', async patch => {
    stale();
    const result = observe(prepareTerminalMarketQuote('BTCUSD', () => true));
    ingestTerminalQuote('BTCUSD', quote(patch));
    expect(getTerminalQuoteFreshness('BTCUSD').live).toBe(false);
    await vi.advanceTimersByTimeAsync(1500);
    expect(await result).toMatchObject({ passed: false, error: { code: 'QUOTE_STALE' } });
  });

  it('requires verified live evidence after waiting even if clock uncertainty would permit a new click', async () => {
    stale();
    const result = observe(prepareTerminalMarketQuote('BTCUSD', () => true));
    // An OS wall-clock jump invalidates clock verification, but not the quote session.
    vi.spyOn(performance, 'now').mockReturnValue(0);
    vi.setSystemTime(epoch + 5000);
    ingestTerminalQuote('BTCUSD', quote({ provider_timestamp: epoch }));
    expect(getTerminalQuoteFreshness('BTCUSD').reason).toBe('time-unverified');
    await vi.advanceTimersByTimeAsync(1500);
    expect(await result).toMatchObject({ passed: false, error: { code: 'QUOTE_STALE' } });
  });

  it.each(['account', 'broker', 'token', 'generation', 'hidden', 'offline', 'pagehide', 'context', 'session'])(
    'cancels on %s changes and does not revive', async change => {
      stale();
      let current = true;
      const result = observe(prepareTerminalMarketQuote('BTCUSD', () => current));
      if (change === 'account') useAppStore.setState({ accountId: '200002' });
      if (change === 'broker') commitBrokerAccountSessionScope({ authenticated: true, accountId: '200001', brokerId: 'orrnn', serverUrl: mocks.server });
      if (change === 'token') { mocks.token = 'token-b'; useAppStore.setState({ authToken: 'token-b' }); }
      if (change === 'generation') resetTerminalQuoteFreshness();
      if (change === 'hidden') { Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' }); document.dispatchEvent(new Event('visibilitychange')); }
      if (change === 'offline') window.dispatchEvent(new Event('offline'));
      if (change === 'pagehide') window.dispatchEvent(new Event('pagehide'));
      if (change === 'context') current = false;
      if (change === 'session') mocks.session.forEach(listener => listener());
      await vi.advanceTimersByTimeAsync(100);
      expect(await result).toMatchObject({ passed: false, error: { code: 'ORDER_PREPARATION_CANCELLED' } });
      expectClean();
      current = true;
      ingestTerminalQuote('BTCUSD', quote());
      expect(await result).toMatchObject({ passed: false });
    });

  it('does not extend the deadline when the event loop delivers a tick before the overdue timer', async () => {
    stale();
    const result = observe(prepareTerminalMarketQuote('BTCUSD', () => true));
    vi.setSystemTime(epoch + 1600);
    ingestTerminalQuote('BTCUSD', quote());
    expect(await result).toMatchObject({ passed: false, error: { code: 'QUOTE_STALE' } });
  });
});
