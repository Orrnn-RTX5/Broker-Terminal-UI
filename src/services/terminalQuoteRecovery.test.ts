import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ get: vi.fn(), symbols: ['BTCUSD'], token: 'token-a',
  broker: 'nexa', server: 'https://broker.test', session: new Set<() => void>() }));
vi.mock('../api/client', () => ({ apiClient: { get: mocks.get } }));
vi.mock('../config/api', () => ({ toLocalDevProxyUrl: (value: string) => value }));
vi.mock('./quoteSocketManager', () => ({ getQuoteSocketManager: () => ({ getActiveSymbols: () => mocks.symbols }) }));
vi.mock('../features/market-data/marketDataSession', () => ({
  getApiSessionDescriptor: (accountId: string) => ({ accountId, brokerId: mocks.broker,
    apiRootBaseUrl: mocks.server, v2BaseUrl: `${mocks.server}/api/v2` }),
  captureApiSession: (descriptor: object) => mocks.token ? ({ ...descriptor,
    runtimeKey: mocks.token, authToken: mocks.token, requestContext: { key: mocks.token } }) : null,
  getCapturedRequestOptions: (session: { authToken: string }, baseUrl: string, signal: AbortSignal) =>
    ({ baseUrl, authToken: session.authToken, signal, skipDynamicUrl: true }),
}));
vi.mock('./brokerSession', async importOriginal => ({
  ...await importOriginal<typeof import('./brokerSession')>(),
  onSessionChange: (callback: () => void) => { mocks.session.add(callback); return () => mocks.session.delete(callback); },
}));
vi.mock('./aggregationWorkerManager', () => ({ cancelPendingAggregations: vi.fn(), getWorkerManager: () => ({ aggregateSymbols: vi.fn() }) }));

import { startTerminalQuoteRecovery } from './terminalQuoteRecovery';
import { commitBrokerAccountSessionScope } from './brokerSession';
import { useAppStore } from '../store/useAppStore';
import { resetLiveTickDispatcherForTests } from './liveTickDispatcher';
import { calibrateTerminalQuoteClock, getTerminalQuoteFreshness, ingestTerminalQuote, resetTerminalQuoteFreshness } from './terminalQuoteFreshness';

const epoch = 1_800_000_000_000;
const quote = (symbol = 'BTCUSD', overrides = {}) => ({ symbol, bid: 86000, ask: 86015,
  provider_timestamp: Date.now(), sequence: String(Date.now()), source: 'cserver', stale: false,
  tradable: true, source_mismatch: false, broker_id: 'Nexa', ...overrides });
const advance = async (ms: number) => { await vi.advanceTimersByTimeAsync(ms); };
const pending = () => {
  let resolve!: (value: unknown) => void;
  const promise = new Promise(res => { resolve = res; });
  return { promise, resolve };
};
let stop: (() => void) | undefined;

describe('authenticated demanded quote recovery', () => {
  beforeEach(() => {
    vi.useFakeTimers(); vi.setSystemTime(epoch);
    vi.spyOn(performance, 'now').mockImplementation(() => Date.now() - epoch);
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' });
    Object.defineProperty(navigator, 'onLine', { configurable: true, value: true });
    (window as Window & { __RTX_RUNTIME_CONFIG__?: Record<string, unknown> }).__RTX_RUNTIME_CONFIG__ = { TERMINAL_QUOTE_FRESHNESS: true };
    mocks.symbols = ['BTCUSD']; mocks.token = 'token-a'; mocks.broker = 'nexa'; mocks.server = 'https://broker.test';
    mocks.get.mockReset().mockImplementation(async () => quote());
    useAppStore.setState({ isAuthenticated: true, accountId: '200001', authToken: 'token-a', refreshToken: null,
      positions: [], selectedSymbol: 'BTCUSD', ticks: {}, tickLookup: {} });
    commitBrokerAccountSessionScope({ authenticated: true, accountId: '200001', brokerId: 'nexa', serverUrl: mocks.server });
    resetLiveTickDispatcherForTests(); resetTerminalQuoteFreshness();
    calibrateTerminalQuoteClock(epoch, 0, epoch, 0, epoch);
  });
  afterEach(() => {
    stop?.(); stop = undefined; resetLiveTickDispatcherForTests();
    vi.restoreAllMocks(); vi.useRealTimers();
    delete (window as Window & { __RTX_RUNTIME_CONFIG__?: Record<string, unknown> }).__RTX_RUNTIME_CONFIG__;
  });

  it('recovers stale browser evidence from a fresh Redis quote without issuing any trade', async () => {
    ingestTerminalQuote('BTCUSD', quote('BTCUSD', { provider_timestamp: epoch - 5000, sequence: '1' }));
    expect(getTerminalQuoteFreshness('BTCUSD').reason).toBe('stale');
    stop = startTerminalQuoteRecovery();
    await advance(1000);
    expect(mocks.get).toHaveBeenCalledOnce();
    expect(mocks.get).toHaveBeenCalledWith('/quotes/BTCUSD', expect.objectContaining({
      baseUrl: 'https://broker.test/api/v2', authToken: 'token-a', skipDynamicUrl: true, timeoutMs: 2000, cache: 'no-store',
    }));
    expect(getTerminalQuoteFreshness('BTCUSD')).toMatchObject({ live: true, ageMaxMs: 2 });
  });

  it('makes no recovery requests while primary ticks stay fresh', async () => {
    stop = startTerminalQuoteRecovery();
    for (let i = 0; i < 20; i++) {
      ingestTerminalQuote('BTCUSD', quote());
      await advance(1000);
    }
    expect(mocks.get).not.toHaveBeenCalled();
  });

  it.each([{ stale: true }, { tradable: false }, { source_mismatch: true }])('keeps upstream veto %j', async flags => {
    mocks.get.mockImplementation(async () => quote('BTCUSD', flags));
    stop = startTerminalQuoteRecovery(); await advance(1000);
    expect(getTerminalQuoteFreshness('BTCUSD').live).toBe(false);
  });

  it.each([
    { symbol: 'BTCUSD.R' }, { broker_id: 'Orrnn' }, { broker_id: 'Orrnn', tradable: undefined },
    { provider_timestamp: undefined, timestamp: epoch },
    { provider_timestamp: epoch + 60000 }, { ask: undefined }, { bid: undefined }, { ask: null }, { ask: 'bad' },
  ])('does not promote wrong identity or fabricated evidence %j', async overrides => {
    mocks.get.mockImplementation(async () => quote('BTCUSD', overrides));
    stop = startTerminalQuoteRecovery(); await advance(1000);
    expect(getTerminalQuoteFreshness('BTCUSD').reason).toBe('unavailable');
  });

  it('rejects a late older REST snapshot after a newer primary tick', async () => {
    const request = pending(); mocks.get.mockReturnValue(request.promise);
    stop = startTerminalQuoteRecovery(); await advance(1000);
    ingestTerminalQuote('BTCUSD', quote('BTCUSD', { sequence: '100', source_mismatch: true }));
    request.resolve(quote('BTCUSD', { provider_timestamp: epoch + 500, sequence: '99' }));
    await advance(0);
    expect(getTerminalQuoteFreshness('BTCUSD').reason).toBe('source-mismatch');
  });

  it('rejects a matching outer identity wrapping a foreign quote without tradable metadata', async () => {
    mocks.get.mockImplementation(async () => ({ ...quote(),
      data: quote('BTCUSD', { broker_id: 'Orrnn', tradable: undefined }) }));
    stop = startTerminalQuoteRecovery(); await advance(1000);
    expect(getTerminalQuoteFreshness('BTCUSD').reason).toBe('unavailable');
  });

  it.each(['account', 'broker', 'token', 'quote-generation', 'demand', 'hidden', 'unmount'] as const)(
    'discards a late response after %s changes even when transport ignores abort', async change => {
      const request = pending(); mocks.get.mockReturnValue(request.promise);
      stop = startTerminalQuoteRecovery(); await advance(1000);
      if (change === 'account') commitBrokerAccountSessionScope({ authenticated: true, accountId: '200002', brokerId: 'nexa', serverUrl: mocks.server });
      if (change === 'broker') { mocks.broker = 'orrnn'; mocks.server = 'https://orrnn.test';
        commitBrokerAccountSessionScope({ authenticated: true, accountId: '200001', brokerId: mocks.broker, serverUrl: mocks.server }); }
      if (change === 'token') { mocks.token = 'token-b'; mocks.session.forEach(callback => callback()); }
      if (change === 'quote-generation') resetTerminalQuoteFreshness();
      if (change === 'demand') mocks.symbols = [];
      if (change === 'hidden') { Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' }); document.dispatchEvent(new Event('visibilitychange')); }
      if (change === 'unmount') stop?.();
      request.resolve(quote()); await advance(0);
      expect(getTerminalQuoteFreshness('BTCUSD').reason).toBe('unavailable');
    });

  it.each(['guest', 'wrong-broker', 'wrong-server', 'offline'] as const)('does not fetch in %s context', async state => {
    if (state === 'guest') useAppStore.setState({ isAuthenticated: false });
    if (state === 'wrong-broker') mocks.broker = 'orrnn';
    if (state === 'wrong-server') mocks.server = 'https://other.test';
    if (state === 'offline') Object.defineProperty(navigator, 'onLine', { configurable: true, value: false });
    stop = startTerminalQuoteRecovery(); await advance(10000);
    expect(mocks.get).not.toHaveBeenCalled();
  });

  it('bounds unavailable-symbol concurrency and prioritizes the chart over a large watchlist', async () => {
    mocks.symbols = [...Array.from({ length: 722 }, (_, i) => `SYM${i}`), 'BTCUSD'];
    mocks.get.mockImplementation(() => new Promise(() => {}));
    stop = startTerminalQuoteRecovery(); await advance(10000);
    expect(mocks.get).toHaveBeenCalledTimes(2);
    expect(mocks.get.mock.calls[0][0]).toBe('/quotes/BTCUSD');
    expect(mocks.get.mock.calls.every(call => call[1].signal.aborted)).toBe(true);
  });

  it('backs off repeated failures without polling on every freshness timer update', async () => {
    mocks.get.mockRejectedValue(new Error('No fresh quote'));
    stop = startTerminalQuoteRecovery(); await advance(999);
    expect(mocks.get).not.toHaveBeenCalled();
    await advance(1); expect(mocks.get).toHaveBeenCalledTimes(1);
    await advance(4999); expect(mocks.get).toHaveBeenCalledTimes(1);
    await advance(1); expect(mocks.get).toHaveBeenCalledTimes(2);
    await advance(9999); expect(mocks.get).toHaveBeenCalledTimes(2);
    await advance(1); expect(mocks.get).toHaveBeenCalledTimes(3);
  });
});
