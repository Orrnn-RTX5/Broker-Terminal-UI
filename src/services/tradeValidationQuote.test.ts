// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Drives the REAL dispatcher path (enqueueLiveTick -> flushLiveTicks -> app store), so
// identical replays, invalid frames, freezes and markup re-applies are dropped where production drops them.
const workerMocks = vi.hoisted(() => ({ aggregateSymbols: vi.fn() }));
const quoteCacheMocks = vi.hoisted(() => ({
  flushMarketWatchQuoteCache: vi.fn(),
  rememberCurrentMarketWatchQuote: vi.fn(),
}));
const dailyChangeCacheMocks = vi.hoisted(() => ({
  flushMarketWatchDailyChangeCache: vi.fn(),
  rememberCurrentMarketWatchDailyChange: vi.fn(),
}));
vi.mock('./aggregationWorkerManager', () => ({
  cancelPendingAggregations: vi.fn(),
  getWorkerManager: () => workerMocks,
}));
vi.mock('./marketWatchQuoteCache', () => quoteCacheMocks);
vi.mock('./marketWatchDailyChangeCache', () => dailyChangeCacheMocks);

import {
  enqueueLiveTick,
  enqueueSnapshotTick,
  flushLiveTicks,
  reapplyAccountSpreadMarkupToCachedTicks,
  resetLiveMarketDataSession,
  resetLiveTickDispatcherForTests,
  setLiveMarketDataFrozen,
  type LiveTick,
} from './liveTickDispatcher';
import { readTradeValidationQuote } from './tradeValidationQuote';
import { useAppStore, type Tick } from '../store/useAppStore';
import { clearQuoteFeedActivity, getQuoteFeedActivityMs } from '../store/quoteFeedActivity';
import { commitBrokerAccountSessionScope } from './brokerSession';
import { DEFAULT_QUOTE_MAX_AGE_MS } from '../utils/tradeLevelDrag';

const T0 = 1_800_000_000_000;
const AGE = DEFAULT_QUOTE_MAX_AGE_MS;

const quote = (symbol: string, bid: number, timestamp: number): LiveTick => ({
  symbol,
  bid,
  ask: bid + 0.32,
  spread: 0.32,
  timestamp,
  sourceTimestamp: timestamp,
  volume: 1,
});

/** One message through the dispatcher; the store is written on the flush. */
const deliver = (tick: LiveTick) => {
  enqueueLiveTick(tick.symbol, tick);
  flushLiveTicks();
};

const clock = (nowMs: number) => vi.spyOn(Date, 'now').mockReturnValue(nowMs);

describe('readTradeValidationQuote: feed stamp only for accepted two-sided quotes and identical replays', () => {
  beforeEach(() => {
    commitBrokerAccountSessionScope({ authenticated: false, brokerId: 'test-broker', serverUrl: 'https://broker.test' });
    resetLiveTickDispatcherForTests();
    clearQuoteFeedActivity();
    window.rtxTickCache = new Map();
    useAppStore.setState({ ticks: {}, tickLookup: {} });
    clock(T0);
  });

  afterEach(() => {
    setLiveMarketDataFrozen('test-source', 'FROZENX', false);
    resetLiveTickDispatcherForTests();
    clearQuoteFeedActivity();
    commitBrokerAccountSessionScope({ authenticated: false, brokerId: '', serverUrl: '' });
    vi.restoreAllMocks();
  });

  it('an accepted two-sided quote is validated locally', () => {
    deliver(quote('BTCUSD', 81736.54, T0));
    expect(readTradeValidationQuote('BTCUSD')).toEqual({ bid: 81736.54, ask: 81736.86 });
  });

  it('an identical-replay push frame with unchanged sourceTimestamp refreshes the stamp (live feed is delivering the current stored price)', () => {
    const tick = quote('BTCUSD', 81736.54, T0);
    deliver(tick);
    clock(T0 + AGE - 10_000);
    deliver({ ...tick });
    clock(T0 + AGE + 40_000);
    expect(readTradeValidationQuote('BTCUSD')).toEqual({ bid: 81736.54, ask: 81736.86 });
  });

  it('without replays, silence longer than the age is not validated locally (server-final)', () => {
    deliver(quote('BTCUSD', 81736.54, T0));
    clock(T0 + AGE + 1);
    expect(readTradeValidationQuote('BTCUSD')).toBeNull();
  });

  it('an accepted newer tick refreshes the stamp and the quote', () => {
    deliver(quote('BTCUSD', 81736.54, T0));
    clock(T0 + AGE + 30_000);
    deliver(quote('BTCUSD', 81800, T0 + AGE + 30_000));
    expect(readTradeValidationQuote('BTCUSD')).toEqual({ bid: 81800, ask: 81800.32 });
  });

  it('an older out-of-order tick does not refresh the stamp', () => {
    deliver(quote('BTCUSD', 81736.54, T0 + 10_000));
    clock(T0 + AGE + 30_000);
    deliver(quote('BTCUSD', 81700, T0));
    expect(readTradeValidationQuote('BTCUSD')).toBeNull();
  });

  it('a last-only message does not refresh the stamp (the stored quote is not written)', () => {
    deliver(quote('BTCUSD', 81736.54, T0));
    clock(T0 + AGE + 30_000);
    deliver({ symbol: 'BTCUSD', last: 81737, timestamp: T0 + AGE + 30_000, sourceTimestamp: T0 + AGE + 30_000 } as unknown as LiveTick);
    expect(readTradeValidationQuote('BTCUSD')).toBeNull();
  });

  it('an invalid frame (no canonical timestamp) does not stamp a symbol', () => {
    enqueueLiveTick('INVALIDX', { symbol: 'INVALIDX', bid: 10, ask: 10.5, spread: 0.5, volume: 1 } as unknown as LiveTick);
    flushLiveTicks();
    expect(useAppStore.getState().ticks.INVALIDX).toBeUndefined();
    expect(readTradeValidationQuote('INVALIDX')).toBeNull();
  });

  it('a frozen symbol is not stamped', () => {
    setLiveMarketDataFrozen('test-source', 'FROZENX', true);
    deliver(quote('FROZENX', 50, T0));
    expect(readTradeValidationQuote('FROZENX')).toBeNull();
  });

  it('a markup re-apply of a cached quote does not refresh the stamp', () => {
    deliver(quote('BTCUSD', 81736.54, T0));
    clock(T0 + AGE + 30_000);
    reapplyAccountSpreadMarkupToCachedTicks();
    flushLiveTicks();
    expect(readTradeValidationQuote('BTCUSD')).toBeNull();
  });

  it('a suffixed feed does not freshen the plain key (XAUUSD.RAW ticking, old XAUUSD stays stale)', () => {
    deliver(quote('XAUUSD', 2300, T0));
    clock(T0 + AGE + 30_000);
    deliver(quote('XAUUSD.RAW', 2310, T0 + AGE + 30_000));
    expect(readTradeValidationQuote('XAUUSD')).toBeNull();
    expect(readTradeValidationQuote('XAUUSD.RAW')).toEqual({ bid: 2310, ask: 2310.32 });
  });

  it('case-variant store keys do not share a stamp (old unstamped XAUUSD is not freshened by a stamped xauusd push)', () => {
    enqueueSnapshotTick('XAUUSD', quote('XAUUSD', 2000, T0));
    flushLiveTicks();
    clock(T0 + AGE + 30_000);
    deliver(quote('xauusd', 2310, T0 + AGE + 30_000));
    expect(useAppStore.getState().ticks.XAUUSD?.bid).toBe(2000);
    expect(useAppStore.getState().ticks.xauusd?.bid).toBe(2310);
    expect(getQuoteFeedActivityMs('xauusd')).toBe(T0 + AGE + 30_000);
    expect(getQuoteFeedActivityMs('XAUUSD')).toBeUndefined();
    expect(readTradeValidationQuote('XAUUSD')).toBeNull();
  });

  it('a two-sided quote written to the store without a feed stamp is never fresh (server-final)', () => {
    const storeTick = { symbol: 'BTCUSD', bid: 81736.54, ask: 81736.86, spread: 0.32 } as unknown as Tick;
    useAppStore.setState({ ticks: { BTCUSD: storeTick }, tickLookup: {} });
    expect(readTradeValidationQuote('BTCUSD')).toBeNull();
  });

  it('a symbol that never reached the feed is not validated locally', () => {
    expect(readTradeValidationQuote('BTCUSD')).toBeNull();
  });
});

// Round 4: snapshots (REST, catalogue, guest) never prove liveness; a push does; the stamp
// follows the store commit; a session reset forgets every stamp.
describe('feed stamp: snapshots never stamp, push stamps at store commit, reset clears', () => {
  beforeEach(() => {
    commitBrokerAccountSessionScope({ authenticated: false, brokerId: 'test-broker', serverUrl: 'https://broker.test' });
    resetLiveTickDispatcherForTests();
    clearQuoteFeedActivity();
    window.rtxTickCache = new Map();
    useAppStore.setState({ ticks: {}, tickLookup: {} });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    resetLiveTickDispatcherForTests();
    clearQuoteFeedActivity();
    commitBrokerAccountSessionScope({ authenticated: false, brokerId: '', serverUrl: '' });
  });

  const snapshot = (symbol: string, bid: number, timestamp: number): LiveTick => ({
    ...quote(symbol, bid, timestamp),
  });

  it('a REST snapshot after silence does not freshen the quote', () => {
    vi.spyOn(Date, 'now').mockReturnValue(T0);
    deliver(quote('BTCUSD', 81736.54, T0));
    vi.spyOn(Date, 'now').mockReturnValue(T0 + AGE + 30_000);
    const fresher = snapshot('BTCUSD', 81800, T0 + AGE + 30_000);
    enqueueSnapshotTick(fresher.symbol, fresher);
    flushLiveTicks();
    expect(useAppStore.getState().ticks.BTCUSD?.bid).toBe(81800);
    expect(readTradeValidationQuote('BTCUSD')).toBeNull();
  });

  it('a guest poll after silence does not freshen the quote', () => {
    vi.spyOn(Date, 'now').mockReturnValue(T0);
    deliver(quote('BTCUSD', 81736.54, T0));
    vi.spyOn(Date, 'now').mockReturnValue(T0 + AGE + 30_000);
    enqueueSnapshotTick('BTCUSD', { ...quote('BTCUSD', 81736.54, T0), sourceTimestamp: T0 });
    flushLiveTicks();
    expect(readTradeValidationQuote('BTCUSD')).toBeNull();
  });

  it('a REST row that keeps the stale-symbol failure timestamp does not freshen the quote', () => {
    vi.spyOn(Date, 'now').mockReturnValue(T0);
    deliver(quote('BTCUSD', 81736.54, T0));
    vi.spyOn(Date, 'now').mockReturnValue(T0 + AGE + 30_000);
    enqueueSnapshotTick('BTCUSD', quote('BTCUSD', 81736.54, T0));
    flushLiveTicks();
    expect(readTradeValidationQuote('BTCUSD')).toBeNull();
  });

  it('a snapshot alone, with no push history, is never validated locally', () => {
    vi.spyOn(Date, 'now').mockReturnValue(T0);
    enqueueSnapshotTick('BTCUSD', quote('BTCUSD', 81736.54, T0));
    flushLiveTicks();
    expect(useAppStore.getState().ticks.BTCUSD).toBeDefined();
    expect(readTradeValidationQuote('BTCUSD')).toBeNull();
  });

  it('a WS push after silence freshens the quote', () => {
    vi.spyOn(Date, 'now').mockReturnValue(T0);
    deliver(quote('BTCUSD', 81736.54, T0));
    vi.spyOn(Date, 'now').mockReturnValue(T0 + AGE + 30_000);
    deliver(quote('BTCUSD', 81800, T0 + AGE + 30_000));
    expect(readTradeValidationQuote('BTCUSD')).toEqual({ bid: 81800, ask: 81800.32 });
  });

  it('a store commit that fails does not stamp the new quote; the stale old price is not fresh (HIGH-2)', () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
    vi.setSystemTime(T0);
    deliver(quote('BTCUSD', 81736.54, T0)); // commits: stamped at T0
    vi.setSystemTime(T0 + AGE + 30_000); // the old price is now stale
    const original = useAppStore.getState().setTicksBatch;
    useAppStore.setState({ setTicksBatch: () => { throw new Error('store unavailable'); } });
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    enqueueLiveTick('BTCUSD', quote('BTCUSD', 81900, T0 + AGE + 30_000));
    flushLiveTicks(); // the commit throws; the batch is retained for retry
    expect(errorSpy).toHaveBeenCalled();
    expect(readTradeValidationQuote('BTCUSD')).toBeNull();
    useAppStore.setState({ setTicksBatch: original });
    vi.advanceTimersByTime(3_000); // retry becomes due
    flushLiveTicks(); // commit succeeds: the new quote is stamped at commit
    expect(useAppStore.getState().ticks.BTCUSD?.bid).toBe(81900);
    expect(readTradeValidationQuote('BTCUSD')).toEqual({ bid: 81900, ask: 81900.32 });
  });

  it('an identical replay stamps at once when the store already holds the quote', () => {
    vi.spyOn(Date, 'now').mockReturnValue(T0);
    const tick = quote('BTCUSD', 81736.54, T0);
    deliver(tick);
    vi.spyOn(Date, 'now').mockReturnValue(T0 + AGE - 5_000);
    enqueueLiveTick('BTCUSD', { ...tick });
    expect(getQuoteFeedActivityMs('BTCUSD')).toBe(T0 + AGE - 5_000);
  });

  it('a session reset forgets every feed stamp', () => {
    vi.spyOn(Date, 'now').mockReturnValue(T0);
    deliver(quote('BTCUSD', 81736.54, T0));
    expect(getQuoteFeedActivityMs('BTCUSD')).toBe(T0);
    resetLiveMarketDataSession();
    expect(getQuoteFeedActivityMs('BTCUSD')).toBeUndefined();
    expect(readTradeValidationQuote('BTCUSD')).toBeNull();
  });
});
