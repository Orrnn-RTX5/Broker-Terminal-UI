import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('./aggregationWorkerManager', () => ({ cancelPendingAggregations: vi.fn(), getWorkerManager: () => ({ aggregateSymbols: vi.fn() }) }));
vi.mock('./marketWatchDailyChangeCache', () => ({ flushMarketWatchDailyChangeCache: vi.fn(), rememberCurrentMarketWatchDailyChange: vi.fn() }));
vi.mock('./marketWatchQuoteCache', () => ({ flushMarketWatchQuoteCache: vi.fn(), rememberCurrentMarketWatchQuote: vi.fn() }));
import { calibrateTerminalQuoteClock, getTerminalQuoteFreshness, getTerminalQuoteSession, getVerifiedQuoteProviderTime,
  getNewerLiveTerminalQuoteEvidence, ingestTerminalQuote, refreshTerminalQuotePrices, resetTerminalQuoteFreshness } from './terminalQuoteFreshness';
import { enqueueFinancialLiveTick, enqueueLiveTick, flushLiveTicks, resetLiveTickDispatcherForTests } from './liveTickDispatcher';
import { FinancialQuoteStream, financialQuoteEventIdentity } from './financialQuoteStream';
import { useAppStore } from '../store/useAppStore';
import { useMarketDataStore } from '../store/useMarketDataStore';
import { compareCanonicalTickFreshness } from '../utils/liveTickSemantics';
import { getQuoteDiagnosticDump } from './quoteDiagnostics';

const epoch = 1_800_000_000_000;
const runtimeWindow = window as Window & { __RTX_RUNTIME_CONFIG__?: Record<string, unknown> };
let mono: number;
const tick = (sequence: string | undefined, revision: number | undefined, bid = 100, tickId = 'rtx-oldhub-1000') => ({
  symbol: 'BTCUSD', bid, ask: bid + 1, spread: 1, volume: 1,
  timestamp: epoch + mono, sourceTimestamp: epoch + mono, provider_timestamp: epoch + mono,
  sequence, source: 'cserver', source_revision: revision, tick_id: tickId,
  stale: false, tradable: true, source_mismatch: false });
const advance = (ms: number) => { mono += ms; };

describe('broker source revision sequence epochs', () => {
  beforeEach(() => {
    mono = 1000;
    vi.spyOn(performance, 'now').mockImplementation(() => mono);
    vi.spyOn(Date, 'now').mockImplementation(() => epoch + mono);
    runtimeWindow.__RTX_RUNTIME_CONFIG__ = { TERMINAL_QUOTE_FRESHNESS: true };
    window.__RTX_QUOTE_DIAGNOSTICS_ENABLED__ = true;
    window.__RTX_QUOTE_DIAGNOSTICS_SYMBOLS__ = ['BTCUSD'];
    window.rtxTickCache = new Map();
    resetLiveTickDispatcherForTests(); useMarketDataStore.getState().clearAllData(); useAppStore.getState().setTicks({});
    resetTerminalQuoteFreshness();
    expect(calibrateTerminalQuoteClock(epoch + mono, mono, epoch + mono, mono, epoch + mono)).toBe(true);
  });
  afterEach(() => {
    resetLiveTickDispatcherForTests(); resetTerminalQuoteFreshness();
    useMarketDataStore.getState().clearAllData(); useAppStore.getState().setTicks({});
    delete runtimeWindow.__RTX_RUNTIME_CONFIG__; delete window.__RTX_QUOTE_DIAGNOSTICS_ENABLED__; delete window.__RTX_QUOTE_DIAGNOSTICS_SYMBOLS__;
    vi.restoreAllMocks();
  });

  it('recovers a stale quote with a newer revision and lower sequence without changing provider time', () => {
    expect(ingestTerminalQuote('BTCUSD', tick('900000', 49))).toBe(true);
    advance(4000);
    const incoming = tick('10', 50, 101, 'rtx-newhub-10');
    expect(ingestTerminalQuote('BTCUSD', incoming)).toBe(true);
    expect(getVerifiedQuoteProviderTime('BTCUSD')).toBe(incoming.provider_timestamp);
    expect(getTerminalQuoteFreshness('BTCUSD')).toMatchObject({ live: true, clockStatus: 'verified' });
  });

  it('rejects revision rollback even with newer provider time and a larger sequence', () => {
    expect(ingestTerminalQuote('BTCUSD', tick('10', 50))).toBe(true); advance(10);
    expect(ingestTerminalQuote('BTCUSD', tick('999999', 49))).toBe(false);
    expect(getQuoteDiagnosticDump().quotes.at(-1)).toMatchObject({ reason: 'older-source-revision' });
  });

  it('retains the known revision across unversioned intermediate evidence in both owners', () => {
    const stream = new FinancialQuoteStream();
    const first = tick('10', 50);
    expect(ingestTerminalQuote('BTCUSD', first)).toBe(true); expect(stream.decide('BTCUSD', first, true)).toBe('accepted');
    advance(10); const legacy = tick('11', undefined);
    expect(ingestTerminalQuote('BTCUSD', legacy)).toBe(true); expect(stream.decide('BTCUSD', legacy, true)).toBe('accepted');
    advance(10); const older = tick('999999', 49);
    expect(ingestTerminalQuote('BTCUSD', older)).toBe(false); expect(stream.decide('BTCUSD', older, false)).toBe('rejected');
    advance(10); const newer = tick('1', 51);
    expect(ingestTerminalQuote('BTCUSD', newer)).toBe(true); expect(stream.decide('BTCUSD', newer, true)).toBe('accepted');
  });

  it('clears the old sequence when an accepted newer revision initially omits sequence', () => {
    const stream = new FinancialQuoteStream();
    for (const [sequence, revision] of [['999999', 49], [undefined, 50], ['1', 50]] as const) {
      advance(10); const incoming = tick(sequence, revision);
      expect(ingestTerminalQuote('BTCUSD', incoming)).toBe(true);
      expect(stream.decide('BTCUSD', incoming, true)).toBe('accepted');
    }
    advance(10); expect(ingestTerminalQuote('BTCUSD', tick('0', 50))).toBe(false);
  });

  it.each(['same revision', 'missing revision', 'different source text', 'different tick ID'])('does not reset the sequence from %s alone', kind => {
    expect(ingestTerminalQuote('BTCUSD', tick('900000', 50))).toBe(true); advance(4000);
    const next = { ...tick('10', kind === 'missing revision' ? undefined : 50, 101, 'rtx-newhub-10'),
      source: kind === 'different source text' ? 'other-lp' : 'cserver' };
    expect(ingestTerminalQuote('BTCUSD', next)).toBe(false);
    expect(getTerminalQuoteFreshness('BTCUSD').reason).toBe('stale');
  });

  it.each(['older time', 'future time', 'invalid price', 'invalid sequence'])('does not poison epoch order with higher-revision %s', kind => {
    expect(ingestTerminalQuote('BTCUSD', tick('100', 49))).toBe(true); advance(10);
    const invalid = { ...tick('1', 50),
      ...(kind === 'older time' ? { provider_timestamp: epoch } : {}),
      ...(kind === 'future time' ? { provider_timestamp: epoch + mono + 500 } : {}),
      ...(kind === 'invalid price' ? { bid: 0 } : {}),
      ...(kind === 'invalid sequence' ? { sequence: 'bad' } : {}) };
    expect(ingestTerminalQuote('BTCUSD', invalid)).toBe(false);
    expect(ingestTerminalQuote('BTCUSD', tick('101', 49))).toBe(true);
  });

  it.each([{ stale: true }, { tradable: false }, { source_mismatch: true }])('retains upstream vetoes across an epoch: %j', veto => {
    expect(ingestTerminalQuote('BTCUSD', tick('100', 49))).toBe(true); advance(10);
    expect(ingestTerminalQuote('BTCUSD', { ...tick('1', 50), ...veto })).toBe(true);
    expect(getTerminalQuoteFreshness('BTCUSD').live).toBe(false);
  });

  it('does not turn an old provider timestamp fresh merely by changing revision', () => {
    expect(ingestTerminalQuote('BTCUSD', tick('100', 49))).toBe(true); advance(5000);
    expect(ingestTerminalQuote('BTCUSD', { ...tick('1', 50), provider_timestamp: epoch + 1100 })).toBe(true);
    expect(getTerminalQuoteFreshness('BTCUSD').reason).toBe('stale');
  });

  it('recovers AppStore, cache and chart event stream together after a new epoch', () => {
    const stream = new FinancialQuoteStream();
    for (const next of [tick('900000', 49), (advance(4000), tick('10', 50, 101, 'rtx-newhub-10'))]) {
      const accepted = enqueueLiveTick('BTCUSD', next);
      expect(accepted).toBe(true); expect(stream.decide('BTCUSD', next, accepted)).toBe('accepted');
      enqueueFinancialLiveTick('BTCUSD', next); flushLiveTicks();
    }
    expect(useAppStore.getState().ticks.BTCUSD).toMatchObject({ bid: 101, source_revision: 50, sequence: '10' });
    expect(window.rtxTickCache.get('BTCUSD')).toMatchObject({ bid: 101, source_revision: 50 });
    expect(useMarketDataStore.getState().symbolData.BTCUSD.currentTick).toMatchObject({ bid: 101, source_revision: 50 });
    expect(useMarketDataStore.getState().symbolData.BTCUSD.tickBuffer.at(-1)).toMatchObject({ bid: 101, source_revision: 50 });
  });

  it('orders equal-provider-time epochs without treating the new sequence as an old correction', () => {
    const old = tick('999999', 49), next = tick('1', 50, 101);
    expect(compareCanonicalTickFreshness(old, next)).toBeGreaterThan(0);
    expect(compareCanonicalTickFreshness(next, { ...tick('9999999', 49), timestamp: epoch + mono + 10, sourceTimestamp: epoch + mono + 10 })).toBeLessThan(0);
    expect(enqueueLiveTick('BTCUSD', old)).toBe(true); flushLiveTicks();
    expect(enqueueLiveTick('BTCUSD', next)).toBe(true); flushLiveTicks();
    expect(useMarketDataStore.getState().symbolData.BTCUSD.tickBuffer.at(-1)).toMatchObject({ source_revision: 50, sequence: '1' });
  });

  it.each([false, true])('retains epoch authority through unversioned dispatcher/store evidence (equal time: %s)', equalTime => {
    const stream = new FinancialQuoteStream();
    const frames = equalTime
      ? [['100', 49], ['1', 50], ['2', undefined]] as const
      : [['100', 49], ['101', undefined], ['1', 50]] as const;
    for (const [sequence, revision] of frames) {
      if (!equalTime) advance(10);
      const incoming = tick(sequence, revision);
      expect(enqueueLiveTick('BTCUSD', incoming)).toBe(true);
      expect(stream.decide('BTCUSD', incoming, true)).toBe('accepted');
      enqueueFinancialLiveTick('BTCUSD', incoming); flushLiveTicks();
      // Stores preserve the actual upstream metadata; owners retain the fence.
      expect(useAppStore.getState().ticks.BTCUSD).toMatchObject({ sequence, source_revision: revision });
      expect(window.rtxTickCache.get('BTCUSD')).toMatchObject({ sequence, source_revision: revision });
      expect(useMarketDataStore.getState().symbolData.BTCUSD.tickBuffer.at(-1)).toMatchObject({ sequence, source_revision: revision });
    }
    advance(10); const rollback = tick('999999', 49, 200);
    expect(enqueueLiveTick('BTCUSD', rollback)).toBe(false);
    expect(stream.decide('BTCUSD', rollback, false)).toBe('rejected');
    flushLiveTicks();
    expect(useAppStore.getState().ticks.BTCUSD.bid).toBe(100);
    expect(useMarketDataStore.getState().symbolData.BTCUSD.currentTick?.bid).toBe(100);
    advance(10); const next = tick('3', 50, 101);
    expect(enqueueLiveTick('BTCUSD', next)).toBe(true);
    expect(stream.decide('BTCUSD', next, true)).toBe('accepted');
    enqueueFinancialLiveTick('BTCUSD', next); flushLiveTicks();
    expect(useAppStore.getState().ticks.BTCUSD).toMatchObject({ sequence: '3', source_revision: 50, bid: 101 });
    expect(useMarketDataStore.getState().symbolData.BTCUSD.tickBuffer.at(-1)).toMatchObject({ sequence: '3', source_revision: 50, bid: 101 });
  });

  it('keeps stale status recovery and markup identity scoped to the actual source revision', () => {
    const previous = tick('900000', 49);
    expect(ingestTerminalQuote('BTCUSD', previous)).toBe(true); advance(10);
    const next = tick('10', 50);
    expect(ingestTerminalQuote('BTCUSD', next)).toBe(true);
    expect(getNewerLiveTerminalQuoteEvidence('BTCUSD', previous, getTerminalQuoteSession())).toMatchObject({ source_revision: 50, sequence: '10' });
    expect(refreshTerminalQuotePrices('BTCUSD', { ...next, source_revision: 49, bid: 99 }, getTerminalQuoteSession())).toBe(false);
    expect(financialQuoteEventIdentity(next)).not.toBe(financialQuoteEventIdentity({ ...next, source_revision: 49 }));
  });
});
