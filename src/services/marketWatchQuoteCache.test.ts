import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  commitBrokerAccountSessionScope,
  getCommittedBrokerAccountSessionScope,
  getCommittedBrokerAccountSessionScopeKey,
} from './brokerSession';
import {
  MARKET_WATCH_QUOTE_CACHE_STORAGE_KEY,
  MARKET_WATCH_QUOTE_CACHE_TTL_MS,
  MAX_MARKET_WATCH_QUOTE_CACHE_ENTRIES,
  flushMarketWatchQuoteCache,
  readMarketWatchQuotes,
  rememberCurrentMarketWatchQuote,
  rememberMarketWatchQuote,
  resetMarketWatchQuoteCacheForTests,
} from './marketWatchQuoteCache';

const NOW = Date.parse('2026-09-19T12:00:00Z');
const scopeA = 'authenticated|1001|broker-a|https://broker-a.example';
const scopeB = 'authenticated|1002|broker-b|https://broker-b.example';
const quote = { bid: 1.17, ask: 1.1702, asOf: NOW - 24 * 60 * 60 * 1000 };

describe('marketWatchQuoteCache', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    resetMarketWatchQuoteCacheForTests();
    commitBrokerAccountSessionScope({ authenticated: false, accountId: null });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    resetMarketWatchQuoteCacheForTests();
    commitBrokerAccountSessionScope({ authenticated: false, accountId: null });
    vi.useRealTimers();
  });

  it('recovers genuine prices after reload with original source time and exact symbol identity', () => {
    rememberMarketWatchQuote(scopeA, ' eurusd.r ', quote);
    rememberMarketWatchQuote(scopeA, 'EURUSDR', { ...quote, bid: 2, ask: 2.1 });
    flushMarketWatchQuoteCache();
    resetMarketWatchQuoteCacheForTests({ clearStorage: false });
    vi.setSystemTime(NOW + 60_000);

    const recovered = readMarketWatchQuotes(scopeA, ['eurusd.r', 'EURUSDR', 'EURUSD']);
    expect(recovered).toEqual({
      'EURUSD.R': quote,
      EURUSDR: { ...quote, bid: 2, ask: 2.1 },
    });
    recovered['EURUSD.R'].bid = 99;
    expect(readMarketWatchQuotes(scopeA, ['EURUSD.R'])['EURUSD.R']).toEqual(quote);
    expect(readMarketWatchQuotes(scopeB, ['EURUSD.R'])).toEqual({});
  });

  it('requires a committed authenticated account and isolates broker/account scopes', () => {
    expect(rememberCurrentMarketWatchQuote('EURUSD', quote)).toBe(false);
    const committed = {
      authenticated: true,
      accountId: '1001',
      brokerId: 'broker-a',
      serverUrl: 'https://broker-a.example',
    };
    commitBrokerAccountSessionScope(committed);
    expect(rememberCurrentMarketWatchQuote('EURUSD', quote)).toBe(true);
    const committedKey = getCommittedBrokerAccountSessionScopeKey(getCommittedBrokerAccountSessionScope());
    expect(readMarketWatchQuotes(committedKey, ['EURUSD'])).toEqual({ EURUSD: quote });

    commitBrokerAccountSessionScope({ ...committed, accountId: '1002' });
    expect(readMarketWatchQuotes(getCommittedBrokerAccountSessionScopeKey(getCommittedBrokerAccountSessionScope()), ['EURUSD'])).toEqual({});
    commitBrokerAccountSessionScope({ ...committed, brokerId: 'broker-b' });
    expect(readMarketWatchQuotes(getCommittedBrokerAccountSessionScopeKey(getCommittedBrokerAccountSessionScope()), ['EURUSD'])).toEqual({});
    expect(readMarketWatchQuotes(committedKey, ['EURUSD'])).toEqual({ EURUSD: quote });
  });

  it.each([
    { bid: 0 }, { ask: -1 }, { bid: Number.NaN }, { ask: Number.POSITIVE_INFINITY },
    { asOf: 0 }, { asOf: Number.NaN }, { asOf: NOW + 1 },
  ])('rejects incomplete or invalid prices and event time: %o', (invalid) => {
    expect(rememberMarketWatchQuote(scopeA, 'EURUSD', { ...quote, ...invalid })).toBe(false);
    expect(readMarketWatchQuotes(scopeA, ['EURUSD'])).toEqual({});
  });

  it('rejects older and identical replays while preserving equal-time corrections', () => {
    expect(rememberMarketWatchQuote(scopeA, 'EURUSD', quote)).toBe(true);
    expect(rememberMarketWatchQuote(scopeA, 'EURUSD', { ...quote, asOf: quote.asOf - 1 })).toBe(false);
    expect(rememberMarketWatchQuote(scopeA, 'EURUSD', quote)).toBe(false);
    const correction = { ...quote, bid: 1.171, ask: 1.1712 };
    expect(rememberMarketWatchQuote(scopeA, 'EURUSD', correction)).toBe(true);
    expect(readMarketWatchQuotes(scopeA, ['EURUSD'])).toEqual({ EURUSD: correction });
  });

  it('coalesces storage writes and flushes pending persistence explicitly', () => {
    const setItem = vi.spyOn(Storage.prototype, 'setItem');
    rememberMarketWatchQuote(scopeA, 'EURUSD', quote);
    rememberMarketWatchQuote(scopeA, 'GBPUSD', quote);
    vi.advanceTimersByTime(249);
    expect(setItem).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(setItem).toHaveBeenCalledTimes(1);
    rememberMarketWatchQuote(scopeA, 'USDJPY', quote);
    expect(flushMarketWatchQuoteCache()).toBe(true);
    expect(setItem).toHaveBeenCalledTimes(2);
    expect(flushMarketWatchQuoteCache()).toBe(false);
  });

  it('expires by source time so reloading or replaying history cannot renew stale quotes', () => {
    const oldQuote = { ...quote, asOf: NOW - MARKET_WATCH_QUOTE_CACHE_TTL_MS + 1 };
    rememberMarketWatchQuote(scopeA, 'EURUSD', oldQuote);
    flushMarketWatchQuoteCache();
    resetMarketWatchQuoteCacheForTests({ clearStorage: false });
    vi.advanceTimersByTime(1);
    expect(readMarketWatchQuotes(scopeA, ['EURUSD'])).toEqual({});
    expect(rememberMarketWatchQuote(scopeA, 'EURUSD', oldQuote)).toBe(false);
  });

  it('discards persisted future event times while keeping valid quotes', () => {
    localStorage.setItem(MARKET_WATCH_QUOTE_CACHE_STORAGE_KEY, JSON.stringify({
      version: 1,
      entries: [
        { ...quote, scopeKey: scopeA, symbol: 'EURUSD', savedAt: NOW },
        { ...quote, asOf: NOW + 1, scopeKey: scopeA, symbol: 'EURUSD', savedAt: NOW },
        { ...quote, asOf: NOW + 1, scopeKey: scopeA, symbol: 'GBPUSD', savedAt: NOW },
      ],
    }));
    expect(readMarketWatchQuotes(scopeA, ['EURUSD', 'GBPUSD'])).toEqual({ EURUSD: quote });
    expect(flushMarketWatchQuoteCache()).toBe(true);
    const stored = JSON.parse(localStorage.getItem(MARKET_WATCH_QUOTE_CACHE_STORAGE_KEY) || '{}');
    expect(stored.entries).toHaveLength(1);
  });

  it('bounds retention across scopes to the 500 freshest original quote events', () => {
    for (let index = 0; index <= MAX_MARKET_WATCH_QUOTE_CACHE_ENTRIES; index += 1) {
      rememberMarketWatchQuote(index % 2 ? scopeB : scopeA, `SYMBOL${index}`, {
        ...quote, asOf: quote.asOf + index,
      });
    }
    expect(readMarketWatchQuotes(scopeA, ['SYMBOL0'])).toEqual({});
    expect(readMarketWatchQuotes(scopeA, ['SYMBOL500']).SYMBOL500.asOf).toBe(quote.asOf + 500);
    flushMarketWatchQuoteCache();
    const stored = JSON.parse(localStorage.getItem(MARKET_WATCH_QUOTE_CACHE_STORAGE_KEY) || '{}');
    expect(stored.entries).toHaveLength(MAX_MARKET_WATCH_QUOTE_CACHE_ENTRIES);
  });

  it.each([
    '{bad-json',
    JSON.stringify({ version: 2, entries: [] }),
    JSON.stringify({ version: 1, entries: [{ ...quote, scopeKey: scopeA, symbol: 'eurusd', savedAt: NOW }] }),
    JSON.stringify({ version: 1, entries: [{ ...quote, ask: 0, scopeKey: scopeA, symbol: 'EURUSD', savedAt: NOW }] }),
  ])('ignores malformed persisted storage safely', (raw) => {
    localStorage.setItem(MARKET_WATCH_QUOTE_CACHE_STORAGE_KEY, raw);
    expect(readMarketWatchQuotes(scopeA, ['EURUSD'])).toEqual({});
    expect(rememberMarketWatchQuote(scopeA, 'EURUSD', quote)).toBe(true);
  });

  it('keeps memory usable after storage read/write failures and permits retry', () => {
    const getItem = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('storage disabled');
    });
    expect(rememberMarketWatchQuote(scopeA, 'EURUSD', quote)).toBe(true);
    getItem.mockRestore();
    const setItem = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('storage quota exceeded');
    });
    expect(flushMarketWatchQuoteCache()).toBe(false);
    expect(readMarketWatchQuotes(scopeA, ['EURUSD'])).toEqual({ EURUSD: quote });
    setItem.mockRestore();
    expect(flushMarketWatchQuoteCache()).toBe(true);
  });
});
