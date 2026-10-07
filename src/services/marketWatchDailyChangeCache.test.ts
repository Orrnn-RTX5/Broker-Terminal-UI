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

  it('does not sort the entire cache for each individual quote in a 561-symbol watchlist', () => {
    // Count actual full-cache sort calls instead of relying on machine timing.
    // This includes steady updates and one-entry overflow after the 500 bound.
    const sort = Array.prototype.sort;
    let fullCacheSorts = 0;
    const spy = vi.spyOn(Array.prototype, 'sort').mockImplementation(function (this: unknown[], compare) {
      if (this.length >= MAX_MARKET_WATCH_DAILY_CHANGE_CACHE_ENTRIES
        && this[0] && typeof this[0] === 'object' && 'scopeKey' in this[0]) fullCacheSorts += 1;
      return sort.call(this, compare);
    });
    try {
      for (let pass = 0; pass < 2; pass += 1) {
        for (let index = 0; index < 561; index += 1) {
          vi.setSystemTime(NOW + pass * 561 + index);
          rememberMarketWatchDailyChange(scopeA, `SYMBOL${index}`, index + pass, NOW + pass, 'quote');
        }
      }
    } finally {
      spy.mockRestore();
    }
    expect(fullCacheSorts).toBe(0);
  });

  it('matches original retention ordering across batch load, updates, expiry and clock rollback', () => {
    type Row = { scopeKey: string; symbol: string; value: number; asOf: number; savedAt: number; source: 'quote' | 'history'; completedAt?: number };
    const model = new Map<string, Map<string, Row>>();
    const rows = () => [...model.values()].flatMap(scope => [...scope.values()]);
    const orderingTime = (entry: Row) => entry.completedAt ?? entry.asOf;
    const compare = (left: Row, right: Row) => orderingTime(left) - orderingTime(right)
      || Number(left.source === 'quote') - Number(right.source === 'quote') || left.asOf - right.asOf;
    const remove = (row: Row) => {
      const scope = model.get(row.scopeKey)!;
      scope.delete(row.symbol);
      if (!scope.size) model.delete(row.scopeKey);
    };
    const prune = () => {
      rows().filter(row => row.savedAt <= Date.now() - MARKET_WATCH_DAILY_CHANGE_CACHE_TTL_MS).forEach(remove);
      rows().sort((left, right) => right.savedAt - left.savedAt || compare(right, left)
        || right.scopeKey.localeCompare(left.scopeKey) || right.symbol.localeCompare(left.symbol))
        .slice(MAX_MARKET_WATCH_DAILY_CHANGE_CACHE_ENTRIES).forEach(remove);
    };
    const apply = (row: Row) => {
      const scope = model.get(row.scopeKey) ?? new Map<string, Row>();
      const current = scope.get(row.symbol);
      if (current && (compare(row, current) < 0 || (compare(row, current) === 0
        && current.source === row.source && current.asOf === row.asOf
        && current.completedAt === row.completedAt && current.value === row.value))) return;
      scope.set(row.symbol, row);
      model.set(row.scopeKey, scope);
    };
    const verify = () => {
      flushMarketWatchDailyChangeCache();
      const actual = JSON.parse(localStorage.getItem(MARKET_WATCH_DAILY_CHANGE_CACHE_STORAGE_KEY) || '{}').entries;
      expect(actual).toEqual(rows());
      expect(actual.length).toBeLessThanOrEqual(500);
    };
    // A batch over capacity follows the original stable sort, including locale ties.
    const symbols = Array.from({ length: 557 }, (_, i) => `SYMBOL${i}`)
      .concat(['É', 'E\u0301', 'Å', 'A\u030a']);
    const initial = symbols.map((symbol, i): Row => ({
      scopeKey: scopeA, symbol, value: i, asOf: NOW - (i % 3), savedAt: NOW,
      source: i % 2 ? 'quote' : 'history',
    }));
    rememberMarketWatchDailyChanges(scopeA, initial);
    initial.forEach(apply); prune(); verify();
    for (let pass = 0; pass < 3; pass += 1) {
      for (let i = 0; i < symbols.length; i += 1) {
        const row: Row = { scopeKey: i % 7 ? scopeA : scopeB, symbol: symbols[i], value: pass + i,
          asOf: NOW + pass + 1, savedAt: NOW + (pass === 1 ? -10 : pass), source: i % 2 ? 'quote' : 'history' };
        vi.setSystemTime(row.savedAt);
        rememberMarketWatchDailyChange(row.scopeKey, row.symbol, row.value, row.asOf, row.source);
        apply(row); prune();
      }
      verify();
    }
    vi.setSystemTime(NOW + MARKET_WATCH_DAILY_CHANGE_CACHE_TTL_MS + 1);
    const final: Row = { scopeKey: scopeB, symbol: 'BTCUSD', value: 1, asOf: Date.now(), savedAt: Date.now(), source: 'quote' };
    rememberMarketWatchDailyChange(final.scopeKey, final.symbol, final.value, final.asOf, final.source);
    apply(final); prune(); verify();
    resetMarketWatchDailyChangeCacheForTests({ clearStorage: false });
    expect(readMarketWatchDailyChange(scopeB, 'BTCUSD')).toBe(1);
  });

  it('preserves stable retention ties on a one-entry overflow', () => {
    rememberMarketWatchDailyChanges(scopeA, Array.from({ length: 499 }, (_, i) => ({
      symbol: `SYMBOL${i}`, value: i, asOf: NOW + 1, source: 'quote' as const,
    })));
    const first = 'É';
    const second = 'E\u0301';
    expect(first.localeCompare(second)).toBe(0);
    rememberMarketWatchDailyChange(scopeA, first, 1, NOW, 'quote');
    rememberMarketWatchDailyChange(scopeA, second, 2, NOW, 'quote');
    expect(readMarketWatchDailyChange(scopeA, first)).toBe(1);
    expect(readMarketWatchDailyChange(scopeA, second)).toBeNull();
  });

  it('counts loaded duplicates and read-time expirations without changing the 500-entry bound', () => {
    const stored = Array.from({ length: 561 }, (_, i) => ({
      scopeKey: scopeA, symbol: `SYMBOL${i}`, value: i, asOf: NOW + i,
      savedAt: NOW - 1, source: 'quote',
    }));
    stored.push({ ...stored[560], value: 999, asOf: NOW + 1000 });
    localStorage.setItem(MARKET_WATCH_DAILY_CHANGE_CACHE_STORAGE_KEY, JSON.stringify({ version: 1, entries: stored }));
    resetMarketWatchDailyChangeCacheForTests({ clearStorage: false });
    expect(readMarketWatchDailyChange(scopeA, 'SYMBOL560')).toBe(999);
    flushMarketWatchDailyChangeCache();
    expect(JSON.parse(localStorage.getItem(MARKET_WATCH_DAILY_CHANGE_CACHE_STORAGE_KEY)!).entries).toHaveLength(500);
    vi.setSystemTime(NOW + MARKET_WATCH_DAILY_CHANGE_CACHE_TTL_MS - 1);
    expect(readMarketWatchDailyChange(scopeA, 'SYMBOL560')).toBeNull();
    rememberMarketWatchDailyChange(scopeB, 'BTCUSD', 1, Date.now(), 'quote');
    flushMarketWatchDailyChangeCache();
    expect(JSON.parse(localStorage.getItem(MARKET_WATCH_DAILY_CHANGE_CACHE_STORAGE_KEY)!).entries).toEqual([{
      scopeKey: scopeB, symbol: 'BTCUSD', value: 1, asOf: Date.now(), savedAt: Date.now(), source: 'quote',
    }]);
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
      day('2026-09-04T00:00:00Z', 121, true),
      day('2026-09-06T00:00:00Z', 999, true),
      day('2026-09-07T00:00:00Z', 999, true),
    ], NOW);

    expect(result).toEqual({
      value: 10, change: 11,
      asOf: Date.parse('2026-09-04T00:00:00Z'),
      completedAt: Date.parse('2026-09-04T00:00:00Z'),
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
      value: 25, change: 20,
      asOf: friday,
      completedAt: Date.parse('2026-09-05T06:00:00Z'),
    });
  });

  it('does not invent Friday finality from elapsed hours or Monday on the device clock', () => {
    const mondayNoon = Date.parse('2026-09-07T12:00:00Z');

    expect(resolveCompletedDailyChange([
      day('2026-09-03T00:00:00Z', 100, true),
      day('2026-09-04T00:00:00Z', 110, false),
    ], mondayNoon)).toBeNull();
  });

  it('keeps the current forming D1 candle excluded', () => {
    const mondayNoon = Date.parse('2026-09-07T12:00:00Z');

    expect(resolveCompletedDailyChange([
      day('2026-09-04T00:00:00Z', 100, true),
      day('2026-09-06T22:00:00Z', 110, true),
      day('2026-09-07T00:00:00Z', 220, false),
    ], mondayNoon)).toEqual({
      value: 10, change: 10,
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
      value: 5, change: 5,
      asOf: Date.parse('2026-09-06T22:00:00Z'),
      completedAt: Date.parse('2026-09-06T22:00:00Z'),
    });
  });

  it('uses a newer broker candle as rollover evidence when finality remains false', () => {
    const now = Date.parse('2026-03-09T21:30:00Z');

    expect(resolveCompletedDailyChange([
      day('2026-03-07T22:00:00Z', 100, true),
      day('2026-03-08T22:00:00Z', 110, false),
      day('2026-03-09T21:00:00Z', 999, false),
    ], now)).toEqual({
      value: 10, change: 10,
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
      value: 10, change: 10,
      asOf: Date.parse('2026-09-06T22:00:00Z'),
      completedAt: Date.parse('2026-09-06T22:00:00Z'),
    });
  });

  it('returns a finite zero and supports business-day timestamps', () => {
    expect(resolveCompletedDailyChange([
      { time: { year: 2026, month: 9, day: 3 }, close: 100 },
      { time: { year: 2026, month: 9, day: 4 }, close: 100, closed: true },
    ], NOW)).toEqual({
      value: 0, change: 0,
      asOf: Date.parse('2026-09-04T00:00:00Z'),
      completedAt: Date.parse('2026-09-04T00:00:00Z'),
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
