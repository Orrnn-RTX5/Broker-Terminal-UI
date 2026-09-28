import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  commitBrokerAccountSessionScope,
  getCommittedBrokerAccountSessionScope,
  getCommittedBrokerAccountSessionScopeKey,
} from './brokerSession';
import {
  MARKET_WATCH_DAILY_CHANGE_CACHE_STORAGE_KEY,
  MARKET_WATCH_DAILY_CHANGE_CACHE_TTL_MS,
  MAX_MARKET_WATCH_DAILY_CHANGE_CACHE_ENTRIES,
  flushMarketWatchDailyChangeCache,
  getCurrentMarketWatchDailyChangeScopeKey,
  readCurrentMarketWatchDailyChange,
  readMarketWatchDailyChange,
  readMarketWatchDailyChangeEntry,
  readMarketWatchDailyChanges,
  rememberCurrentMarketWatchDailyChange,
  rememberMarketWatchDailyChange,
  rememberMarketWatchDailyChanges,
  resetMarketWatchDailyChangeCacheForTests,
  resolveCompletedDailyChange,
} from './marketWatchDailyChangeCache';

const NOW = Date.parse('2026-09-05T12:00:00.000Z');
const scopeA = 'authenticated|1001|broker-a|https://broker-a.example';
const scopeB = 'authenticated|1001|broker-b|https://broker-b.example';

describe('marketWatchDailyChangeCache', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    resetMarketWatchDailyChangeCacheForTests();
    commitBrokerAccountSessionScope({ authenticated: false, accountId: null });
  });

  afterEach(() => {
    resetMarketWatchDailyChangeCacheForTests();
    commitBrokerAccountSessionScope({ authenticated: false, accountId: null });
    vi.useRealTimers();
  });

  it('rejects an unidentified anonymous scope and derives an authenticated account scope', () => {
    commitBrokerAccountSessionScope({
      authenticated: false,
      accountId: null,
      brokerId: '',
      serverUrl: '',
    });
    expect(getCurrentMarketWatchDailyChangeScopeKey()).toBeNull();
    expect(rememberCurrentMarketWatchDailyChange('EURUSD', 1, NOW, 'quote')).toBe(false);

    commitBrokerAccountSessionScope({
      authenticated: true,
      accountId: '1001',
      brokerId: 'Broker-A',
      serverUrl: 'https://broker-a.example/',
    });
    const committed = getCommittedBrokerAccountSessionScope();

    expect(getCurrentMarketWatchDailyChangeScopeKey()).toBe(
      getCommittedBrokerAccountSessionScopeKey(committed),
    );
    expect(rememberCurrentMarketWatchDailyChange('EURUSD', 0, NOW, 'quote')).toBe(true);
    expect(readCurrentMarketWatchDailyChange('EURUSD')).toBe(0);
  });

  it('retains public changes in the canonical anonymous broker scope without cross-broker leakage', () => {
    commitBrokerAccountSessionScope({
      authenticated: false,
      brokerId: 'Broker-A',
      serverUrl: 'https://broker-a.example/',
    });
    const brokerAKey = getCommittedBrokerAccountSessionScopeKey(
      getCommittedBrokerAccountSessionScope(),
    );

    expect(getCurrentMarketWatchDailyChangeScopeKey()).toBe(brokerAKey);
    expect(rememberCurrentMarketWatchDailyChange('EURUSD', 1.25, NOW, 'quote')).toBe(true);
    expect(readCurrentMarketWatchDailyChange('EURUSD')).toBe(1.25);

    commitBrokerAccountSessionScope({
      authenticated: false,
      brokerId: 'Broker-B',
      serverUrl: 'https://broker-b.example/',
    });
    expect(getCurrentMarketWatchDailyChangeScopeKey()).not.toBe(brokerAKey);
    expect(readCurrentMarketWatchDailyChange('EURUSD')).toBeNull();
    expect(readMarketWatchDailyChange(brokerAKey, 'EURUSD')).toBe(1.25);
  });

  it('retains finite zero and uses exact normalized symbol keys', () => {
    expect(rememberMarketWatchDailyChange(scopeA, ' eurusd.r ', 0, NOW, 'quote')).toBe(true);
    expect(rememberMarketWatchDailyChange(scopeA, 'EURUSDR', -1.25, NOW, 'quote')).toBe(true);
    expect(rememberMarketWatchDailyChange(scopeA, 'BROKEN', Number.NaN, NOW, 'quote')).toBe(false);

    expect(readMarketWatchDailyChange(scopeA, 'EURUSD.r')).toBe(0);
    expect(readMarketWatchDailyChange(scopeA, 'eurusdr')).toBe(-1.25);
    expect(readMarketWatchDailyChanges(scopeA, [' eurusd.r', 'EURUSDR', 'MISSING'])).toEqual({
      'EURUSD.R': 0,
      EURUSDR: -1.25,
    });
    expect(readMarketWatchDailyChangeEntry(scopeA, 'EURUSD.R')).toEqual({
      value: 0,
      asOf: NOW,
      savedAt: NOW,
      source: 'quote',
    });
  });

  it('isolates the same symbol by broker and account scope', () => {
    rememberMarketWatchDailyChange(scopeA, 'BTCUSD', 1.5, NOW, 'quote');
    rememberMarketWatchDailyChange(scopeB, 'BTCUSD', -2.5, NOW, 'quote');

    expect(readMarketWatchDailyChange(scopeA, 'BTCUSD')).toBe(1.5);
    expect(readMarketWatchDailyChange(scopeB, 'BTCUSD')).toBe(-2.5);
  });

  it('coalesces persistence and supports an explicit flush', () => {
    const setItem = vi.spyOn(Storage.prototype, 'setItem');

    rememberMarketWatchDailyChange(scopeA, 'EURUSD', 1, NOW, 'quote');
    rememberMarketWatchDailyChange(scopeA, 'GBPUSD', 2, NOW + 1, 'quote');
    rememberMarketWatchDailyChange(scopeA, 'USDJPY', 3, NOW + 2, 'quote');

    expect(setItem).not.toHaveBeenCalled();
    vi.advanceTimersByTime(249);
    expect(setItem).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(setItem).toHaveBeenCalledTimes(1);

    rememberMarketWatchDailyChange(scopeA, 'AUDUSD', 4, NOW + 3, 'quote');
    expect(flushMarketWatchDailyChangeCache()).toBe(true);
    expect(setItem).toHaveBeenCalledTimes(2);
    expect(flushMarketWatchDailyChangeCache()).toBe(false);
  });

  it('rejects older observations and lets quote beat equal-time history', () => {
    expect(rememberMarketWatchDailyChange(scopeA, 'EURUSD', 5, NOW, 'history')).toBe(true);
    expect(rememberMarketWatchDailyChange(scopeA, 'EURUSD', 4, NOW - 1, 'quote')).toBe(false);
    expect(readMarketWatchDailyChange(scopeA, 'EURUSD')).toBe(5);

    expect(rememberMarketWatchDailyChange(scopeA, 'EURUSD', 6, NOW, 'quote')).toBe(true);
    expect(rememberMarketWatchDailyChange(scopeA, 'EURUSD', 7, NOW, 'history')).toBe(false);
    expect(readMarketWatchDailyChangeEntry(scopeA, 'EURUSD')).toMatchObject({
      value: 6,
      asOf: NOW,
      source: 'quote',
    });

    expect(rememberMarketWatchDailyChange(scopeA, 'EURUSD', 8, NOW + 1, 'history')).toBe(true);
    expect(readMarketWatchDailyChange(scopeA, 'EURUSD')).toBe(8);
  });

  it('lets a final D1 result replace its intraday quote but protects a newer session quote', () => {
    const sessionStartedAt = NOW - 12 * 60 * 60 * 1000;
    const intradayQuoteAt = sessionStartedAt + 6 * 60 * 60 * 1000;
    const sessionCompletedAt = NOW;

    expect(rememberMarketWatchDailyChange(
      scopeA,
      'EURUSD',
      1.25,
      intradayQuoteAt,
      'quote',
    )).toBe(true);
    expect(rememberMarketWatchDailyChange(
      scopeA,
      'EURUSD',
      2.5,
      sessionStartedAt,
      'history',
      sessionCompletedAt,
    )).toBe(true);
    expect(readMarketWatchDailyChangeEntry(scopeA, 'EURUSD')).toMatchObject({
      value: 2.5,
      asOf: sessionStartedAt,
      completedAt: sessionCompletedAt,
      source: 'history',
    });

    // A quote at the next session boundary wins the tie, and the older final
    // history row cannot overwrite it if that history request completes late.
    expect(rememberMarketWatchDailyChange(
      scopeA,
      'EURUSD',
      -0.5,
      sessionCompletedAt,
      'quote',
    )).toBe(true);
    expect(rememberMarketWatchDailyChange(
      scopeA,
      'EURUSD',
      2.5,
      sessionStartedAt,
      'history',
      sessionCompletedAt,
    )).toBe(false);
    expect(readMarketWatchDailyChangeEntry(scopeA, 'EURUSD')).toMatchObject({
      value: -0.5,
      asOf: sessionCompletedAt,
      source: 'quote',
    });
  });

  it('persists the optional history completion boundary and still loads legacy entries', () => {
    const completedAt = NOW - 1;
    expect(rememberMarketWatchDailyChange(
      scopeA,
      'EURUSD',
      1.5,
      NOW - 60_000,
      'history',
      completedAt,
    )).toBe(true);
    expect(flushMarketWatchDailyChangeCache()).toBe(true);

    resetMarketWatchDailyChangeCacheForTests({ clearStorage: false });
    expect(readMarketWatchDailyChangeEntry(scopeA, 'EURUSD')).toMatchObject({
      value: 1.5,
      completedAt,
      source: 'history',
    });

    localStorage.setItem(MARKET_WATCH_DAILY_CHANGE_CACHE_STORAGE_KEY, JSON.stringify({
      version: 1,
      entries: [{
        scopeKey: scopeA,
        symbol: 'GBPUSD',
        value: -1,
        asOf: NOW - 60_000,
        savedAt: NOW,
        source: 'history',
      }],
    }));
    resetMarketWatchDailyChangeCacheForTests({ clearStorage: false });
    expect(readMarketWatchDailyChangeEntry(scopeA, 'GBPUSD')).toEqual({
      value: -1,
      asOf: NOW - 60_000,
      savedAt: NOW,
      source: 'history',
    });
  });

  it('expires entries after fourteen days and rejects malformed storage', () => {
    rememberMarketWatchDailyChange(scopeA, 'EURUSD', 1.25, NOW, 'history');
    flushMarketWatchDailyChangeCache();

    vi.setSystemTime(NOW + MARKET_WATCH_DAILY_CHANGE_CACHE_TTL_MS);
    resetMarketWatchDailyChangeCacheForTests({ clearStorage: false });
    expect(readMarketWatchDailyChange(scopeA, 'EURUSD')).toBeNull();

    localStorage.setItem(MARKET_WATCH_DAILY_CHANGE_CACHE_STORAGE_KEY, JSON.stringify({
      version: 1,
      entries: [{
        scopeKey: scopeA,
        symbol: 'eurusd',
        value: 12,
        asOf: NOW,
        savedAt: NOW,
        source: 'history',
      }],
    }));
    resetMarketWatchDailyChangeCacheForTests({ clearStorage: false });
    expect(readMarketWatchDailyChange(scopeA, 'EURUSD')).toBeNull();

    localStorage.setItem(MARKET_WATCH_DAILY_CHANGE_CACHE_STORAGE_KEY, '{not-json');
    resetMarketWatchDailyChangeCacheForTests({ clearStorage: false });
    expect(readMarketWatchDailyChange(scopeA, 'EURUSD')).toBeNull();
  });

  it('bounds the cache to the newest 500 entries', () => {
    for (let index = 0; index <= MAX_MARKET_WATCH_DAILY_CHANGE_CACHE_ENTRIES; index += 1) {
      vi.setSystemTime(NOW + index);
      rememberMarketWatchDailyChange(scopeA, `SYMBOL${index}`, index, NOW + index, 'history');
    }

    expect(readMarketWatchDailyChange(scopeA, 'SYMBOL0')).toBeNull();
    expect(readMarketWatchDailyChange(scopeA, `SYMBOL${MAX_MARKET_WATCH_DAILY_CHANGE_CACHE_ENTRIES}`)).toBe(
      MAX_MARKET_WATCH_DAILY_CHANGE_CACHE_ENTRIES,
    );

    flushMarketWatchDailyChangeCache();
    const stored = JSON.parse(localStorage.getItem(MARKET_WATCH_DAILY_CHANGE_CACHE_STORAGE_KEY) || '{}');
    expect(stored.entries).toHaveLength(MAX_MARKET_WATCH_DAILY_CHANGE_CACHE_ENTRIES);
  });

  it('remembers a valid batch while rejecting invalid rows', () => {
    expect(rememberMarketWatchDailyChanges(scopeA, [
      { symbol: 'EURUSD', value: 0.5, asOf: NOW, source: 'history' },
      { symbol: 'GBPUSD', value: -0.5, asOf: NOW, source: 'quote' },
      { symbol: '', value: 1, asOf: NOW, source: 'quote' },
    ])).toBe(2);
    expect(readMarketWatchDailyChanges(scopeA, ['EURUSD', 'GBPUSD'])).toEqual({
      EURUSD: 0.5,
      GBPUSD: -0.5,
    });
  });
});

describe('resolveCompletedDailyChange', () => {
  const day = (iso: string, close: unknown, closed?: boolean) => ({
    time: Date.parse(iso) / 1000,
    close,
    closed,
  });

  it('uses the latest two completed closes and ignores future rows', () => {
    const result = resolveCompletedDailyChange([
      day('2026-09-02T00:00:00Z', 100),
      day('2026-09-03T00:00:00Z', 110),
      day('2026-09-04T00:00:00Z', 121),
      day('2026-09-06T00:00:00Z', 999, true),
      day('2026-09-07T00:00:00Z', 999, true),
    ], NOW);

    expect(result).toEqual({
      value: 10,
      asOf: Date.parse('2026-09-04T00:00:00Z'),
      completedAt: Date.parse('2026-09-05T00:00:00Z'),
    });
  });

  it('skips invalid, current incomplete, and lower-finality duplicate-time rows', () => {
    const thursday = Date.parse('2026-09-03T00:00:00Z');
    const friday = Date.parse('2026-09-04T00:00:00Z');
    const result = resolveCompletedDailyChange([
      { time: thursday, close: 80 },
      { time: friday, close: 90 },
      { time: friday, close: 100, closed: true },
      { time: friday, close: 150, closed: false },
      day('2026-09-05T06:00:00Z', 120, false),
      day('2026-09-01T00:00:00Z', Number.NaN, true),
      day('2026-09-01T00:00:00Z', 0, true),
    ], NOW);

    expect(result).toEqual({
      value: 25,
      asOf: friday,
      completedAt: Date.parse('2026-09-05T00:00:00Z'),
    });
  });

  it('accepts an aged Friday close even when the gateway leaves closed false through Monday', () => {
    const mondayNoon = Date.parse('2026-09-07T12:00:00Z');

    expect(resolveCompletedDailyChange([
      day('2026-09-03T00:00:00Z', 100, true),
      day('2026-09-04T00:00:00Z', 110, false),
    ], mondayNoon)).toEqual({
      value: 10,
      asOf: Date.parse('2026-09-04T00:00:00Z'),
      completedAt: Date.parse('2026-09-05T00:00:00Z'),
    });
  });

  it('keeps the current forming D1 candle excluded', () => {
    const mondayNoon = Date.parse('2026-09-07T12:00:00Z');

    expect(resolveCompletedDailyChange([
      day('2026-09-04T00:00:00Z', 100, true),
      day('2026-09-06T22:00:00Z', 110, true),
      day('2026-09-07T00:00:00Z', 220, false),
    ], mondayNoon)).toEqual({
      value: 10,
      asOf: Date.parse('2026-09-06T22:00:00Z'),
      completedAt: Date.parse('2026-09-07T00:00:00Z'),
    });
  });

  it('accepts a Sunday-labelled broker candle when explicit finality says it is closed', () => {
    const mondayNoon = Date.parse('2026-09-07T12:00:00Z');

    expect(resolveCompletedDailyChange([
      day('2026-09-04T22:00:00Z', 100, true),
      day('2026-09-06T22:00:00Z', 105, true),
    ], mondayNoon)).toEqual({
      value: 5,
      asOf: Date.parse('2026-09-06T22:00:00Z'),
      completedAt: mondayNoon,
    });
  });

  it('uses a newer broker candle as rollover evidence when finality remains false', () => {
    const now = Date.parse('2026-03-09T21:30:00Z');

    expect(resolveCompletedDailyChange([
      day('2026-03-07T22:00:00Z', 100, true),
      day('2026-03-08T22:00:00Z', 110, false),
      day('2026-03-09T21:00:00Z', 999, false),
    ], now)).toEqual({
      value: 10,
      asOf: Date.parse('2026-03-08T22:00:00Z'),
      completedAt: Date.parse('2026-03-09T21:00:00Z'),
    });
  });

  it('prefers the raw broker D1 timestamp over its UTC-aligned chart bucket', () => {
    const mondayNoon = Date.parse('2026-09-07T12:00:00Z');

    expect(resolveCompletedDailyChange([
      {
        time: Date.parse('2026-09-04T00:00:00Z') / 1000,
        sourceTime: Date.parse('2026-09-04T22:00:00Z') / 1000,
        close: 100,
        closed: true,
      },
      {
        time: Date.parse('2026-09-06T00:00:00Z') / 1000,
        sourceTime: Date.parse('2026-09-06T22:00:00Z') / 1000,
        close: 110,
        closed: true,
      },
    ], mondayNoon)).toEqual({
      value: 10,
      asOf: Date.parse('2026-09-06T22:00:00Z'),
      completedAt: mondayNoon,
    });
  });

  it('returns a finite zero and supports business-day timestamps', () => {
    expect(resolveCompletedDailyChange([
      { time: { year: 2026, month: 9, day: 3 }, close: 100 },
      { time: { year: 2026, month: 9, day: 4 }, close: 100 },
    ], NOW)).toEqual({
      value: 0,
      asOf: Date.parse('2026-09-04T00:00:00Z'),
      completedAt: Date.parse('2026-09-05T00:00:00Z'),
    });
  });

  it('returns null without two distinct valid completed closes', () => {
    expect(resolveCompletedDailyChange([], NOW)).toBeNull();
    expect(resolveCompletedDailyChange([
      day('2026-09-04T00:00:00Z', 100),
      day('2026-09-04T00:00:00Z', 101),
      day('2026-09-06T00:00:00Z', 102, true),
    ], NOW)).toBeNull();
    expect(resolveCompletedDailyChange([
      day('2026-07-01T00:00:00Z', 100),
      day('2026-07-02T00:00:00Z', 101),
    ], NOW)).toBeNull();
  });
});
