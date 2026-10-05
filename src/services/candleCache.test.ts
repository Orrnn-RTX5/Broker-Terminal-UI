import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  CANDLE_HISTORY_CACHE_VERSION,
  MAX_CANDLE_CACHE_ENTRIES,
  MAX_CANDLES_PER_CACHE_ENTRY,
  candleCache,
  type CandleCacheKeyParts,
  type CandleCacheMetadata,
} from './candleCache';
import type { OHLCData } from './chartDataService';
import { emitSessionChange } from './brokerSession';

const baseKeyParts: CandleCacheKeyParts = {
  scope: 'https://broker.example/api/v2',
  symbol: 'EURUSD',
  timeframe: 'M1',
  limit: 500,
};

const candle = (time: number, close = time): OHLCData => ({
  time,
  open: close - 1,
  high: close + 1,
  low: close - 2,
  close,
  volume: time,
});

describe('candleCache', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-02T00:00:00Z'));
    candleCache.clearAll();
  });

  afterEach(() => {
    candleCache.clearAll();
    vi.useRealTimers();
  });

  it('isolates entries by scope, symbol, timeframe, and limit', () => {
    const m1Key = candleCache.createKey(baseKeyParts);
    const m5Key = candleCache.createKey({ ...baseKeyParts, timeframe: 'M5' });
    const otherScopeKey = candleCache.createKey({ ...baseKeyParts, scope: 'https://other.example/api/v2' });

    candleCache.setLatest(m1Key, [candle(60)], baseKeyParts);
    candleCache.setLatest(m5Key, [candle(300)], { ...baseKeyParts, timeframe: 'M5' });

    expect(candleCache.getLatest(m1Key)?.candles.map(c => c.time)).toEqual([60]);
    expect(candleCache.getLatest(m5Key)?.candles.map(c => c.time)).toEqual([300]);
    expect(candleCache.getLatest(otherScopeKey)).toBeNull();
  });

  it('keeps punctuated broker symbols isolated from compact symbol names', () => {
    const symbolCases = [
      ['EURUSD.r', 'EURUSDr'],
      ['0001.HK', '0001HK'],
      ['NAS100-F', 'NAS100F'],
    ] as const;

    symbolCases.forEach(([punctuated, compact], index) => {
      const punctuatedParts = { ...baseKeyParts, symbol: punctuated };
      const compactParts = { ...baseKeyParts, symbol: compact };
      const punctuatedKey = candleCache.createKey(punctuatedParts);
      const compactKey = candleCache.createKey(compactParts);

      expect(punctuatedKey).not.toBe(compactKey);

      candleCache.setLatest(punctuatedKey, [candle(60, index + 10)], punctuatedParts);
      candleCache.setLatest(compactKey, [candle(60, index + 20)], compactParts);

      expect(candleCache.getLatest(punctuatedKey)?.candles[0].close).toBe(index + 10);
      expect(candleCache.getLatest(compactKey)?.candles[0].close).toBe(index + 20);
    });
  });

  it('isolates entries by history cache version', () => {
    const currentKey = candleCache.createKey(baseKeyParts);
    const legacyKey = candleCache.createKey({ ...baseKeyParts, version: 'legacy-empty-history' });

    candleCache.setLatest(legacyKey, [candle(30)], { ...baseKeyParts, version: 'legacy-empty-history' });

    expect(candleCache.getLatest(currentKey)).toBeNull();
    expect(candleCache.getLatest(legacyKey)?.version).toBe('legacy-empty-history');

    candleCache.setLatest(currentKey, [candle(60)], baseKeyParts);
    expect(candleCache.getLatest(currentKey)?.version).toBe(CANDLE_HISTORY_CACHE_VERSION);
    expect(candleCache.getLatest(currentKey)?.candles.map(c => c.time)).toEqual([60]);
  });

  it('clones candles on set and get so callers cannot mutate cached data', () => {
    const key = candleCache.createKey(baseKeyParts);
    const source = [candle(60, 10)];

    candleCache.setLatest(key, source, baseKeyParts);
    source[0].close = 999;

    const firstRead = candleCache.getLatest(key);
    expect(firstRead?.candles[0].close).toBe(10);

    if (firstRead) firstRead.candles[0].close = 888;
    expect(candleCache.getLatest(key)?.candles[0].close).toBe(10);
  });

  it('exposes stale metadata without dropping session entries immediately', () => {
    const key = candleCache.createKey(baseKeyParts);
    const entry = candleCache.setLatest(key, [candle(60)], baseKeyParts);

    expect(candleCache.isStale(entry)).toBe(false);

    vi.setSystemTime(new Date('2026-07-02T00:03:00Z'));
    const cached = candleCache.getLatest(key);

    expect(cached).not.toBeNull();
    expect(cached ? candleCache.isStale(cached) : false).toBe(true);
  });

  it('merges overlapping candles by time and returns sorted history', () => {
    const key = candleCache.createKey(baseKeyParts);

    candleCache.setLatest(key, [candle(120, 12), candle(60, 6)], baseKeyParts);
    candleCache.mergeLatest(key, [candle(60, 7), candle(180, 18)], baseKeyParts);

    expect(candleCache.getLatest(key)?.candles.map(c => [c.time, c.close])).toEqual([
      [60, 7],
      [120, 12],
      [180, 18],
    ]);
  });

  it('tracks backend, derived, and mixed cache sources', () => {
    const key = candleCache.createKey(baseKeyParts);

    candleCache.setLatest(key, [candle(60, 6)], { ...baseKeyParts, source: 'derived-m1' });
    expect(candleCache.getLatest(key)?.source).toBe('derived-m1');

    candleCache.mergeLatest(key, [candle(120, 12)], { ...baseKeyParts, source: 'backend' });
    expect(candleCache.getLatest(key)?.source).toBe('mixed');

    candleCache.setLatest(key, [candle(180, 18)], { ...baseKeyParts, source: 'backend' });
    expect(candleCache.getLatest(key)?.source).toBe('backend');
    expect(candleCache.getLatest(key)?.candles.map(item => item.time)).toEqual([180]);
  });

  it('clears only matching scope entries', () => {
    const brokerKey = candleCache.createKey(baseKeyParts);
    const otherKey = candleCache.createKey({ ...baseKeyParts, scope: 'https://other.example/api/v2' });

    candleCache.setLatest(brokerKey, [candle(60)], baseKeyParts);
    candleCache.setLatest(otherKey, [candle(90)], { ...baseKeyParts, scope: 'https://other.example/api/v2' });
    candleCache.clearScope(baseKeyParts.scope);

    expect(candleCache.getLatest(brokerKey)).toBeNull();
    expect(candleCache.getLatest(otherKey)?.candles.map(c => c.time)).toEqual([90]);
  });

  it('dedupes in-flight fetches for the same key', async () => {
    const key = candleCache.createKey(baseKeyParts);
    let calls = 0;

    const first = candleCache.dedupe(key, async () => {
      calls += 1;
      return [candle(60)];
    });
    const second = candleCache.dedupe(key, async () => {
      calls += 1;
      return [candle(120)];
    });

    await expect(Promise.all([first, second])).resolves.toEqual([[candle(60)], [candle(60)]]);
    expect(calls).toBe(1);
  });

  it('bounds session cache keys with least-recently-used eviction', () => {
    const keys = Array.from({ length: MAX_CANDLE_CACHE_ENTRIES + 1 }, (_, index) => (
      candleCache.createKey({ ...baseKeyParts, symbol: `SYMBOL${index}` })
    ));

    keys.forEach((key, index) => {
      candleCache.setLatest(key, [candle(index + 1)], {
        ...baseKeyParts,
        symbol: `SYMBOL${index}`,
      });
    });

    expect(candleCache.getLatest(keys[0])).toBeNull();
    expect(candleCache.getLatest(keys.at(-1)!)).not.toBeNull();
  });

  it('keeps only the newest bounded candles in each cache entry', () => {
    const key = candleCache.createKey(baseKeyParts);
    const candles = Array.from(
      { length: MAX_CANDLES_PER_CACHE_ENTRY + 5 },
      (_, index) => candle(index + 1),
    );

    candleCache.setLatest(key, candles, baseKeyParts);

    const cached = candleCache.getLatest(key);
    expect(cached?.candles).toHaveLength(MAX_CANDLES_PER_CACHE_ENTRY);
    expect(cached?.oldestTime).toBe(6);
    expect(cached?.newestTime).toBe(MAX_CANDLES_PER_CACHE_ENTRY + 5);
  });

  it('matches public merge snapshots for live, historical, duplicate and invalid writes', () => {
    const key = candleCache.createKey(baseKeyParts);
    const actions: Array<{ candles: OHLCData[]; metadata?: CandleCacheMetadata }> = [
      { candles: [], metadata: { ...baseKeyParts, source: 'derived-m1' } },
      { candles: [candle(120)] },
      { candles: [candle(120, 121)] },
      { candles: [candle(180)], metadata: { ...baseKeyParts, brokerOffsetSeconds: 3600, source: 'backend' } },
      { candles: [candle(60), candle(120, 122), candle(120, 123), candle(300), candle(240)] },
      { candles: [candle(90)] },
      { candles: [candle(300, 301)] },
      { candles: [{ ...candle(360), time: '360' as unknown as number }] },
      { candles: [candle(Number.NaN), candle(Number.POSITIVE_INFINITY)] },
      { candles: [candle(420)], metadata: { ...baseKeyParts, source: 'derived-m1', version: 'custom-version' } },
    ];
    const exercise = (withoutSnapshot: boolean) => {
      candleCache.clearAll();
      vi.setSystemTime(new Date('2026-07-02T00:00:00Z'));
      return actions.map(({ candles, metadata }) => {
        vi.advanceTimersByTime(1000);
        if (withoutSnapshot) candleCache.mergeLatestWithoutSnapshot(key, candles, metadata);
        else candleCache.mergeLatest(key, candles, metadata);
        return candleCache.getLatest(key);
      });
    };
    expect(exercise(true)).toEqual(exercise(false));
  });

  it('keeps inputs and previous public snapshots isolated across live replacement and append', () => {
    const key = candleCache.createKey(baseKeyParts);
    const source = [Object.freeze(candle(60)), Object.freeze(candle(120))];
    Object.freeze(source);
    const setSnapshot = candleCache.setLatest(key, source, baseKeyParts);
    const mergeSnapshot = candleCache.mergeLatest(key, [candle(180)], baseKeyParts);
    const readSnapshot = candleCache.getLatest(key)!;
    for (const snapshot of [setSnapshot, mergeSnapshot, readSnapshot]) {
      snapshot.candles.forEach(Object.freeze);
      Object.freeze(snapshot.candles);
      Object.freeze(snapshot);
    }
    const replacement = candle(180, 181);
    const appended = candle(240);
    candleCache.mergeLatestWithoutSnapshot(key, [replacement]);
    candleCache.mergeLatestWithoutSnapshot(key, [appended]);
    replacement.close = 999;
    appended.high = 999;

    expect(setSnapshot.candles).toEqual(source);
    expect(mergeSnapshot.candles.at(-1)?.close).toBe(180);
    expect(readSnapshot.candles.at(-1)?.close).toBe(180);
    const latest = candleCache.getLatest(key)!;
    expect(latest.candles.map(row => row.close)).toEqual([60, 120, 181, 240]);
    expect(latest.candles.at(-1)?.high).toBe(241);
    latest.candles[0].close = 888;
    expect(candleCache.getLatest(key)?.candles[0].close).toBe(60);
  });

  it('preserves the exact bounded history when appending or correcting at the cap', () => {
    const key = candleCache.createKey(baseKeyParts);
    const source = Array.from({ length: MAX_CANDLES_PER_CACHE_ENTRY }, (_, index) => candle(index + 1));
    const exercise = (withoutSnapshot: boolean) => {
      candleCache.clearAll();
      candleCache.setLatest(key, source, baseKeyParts);
      for (const incoming of [candle(20_000, 20_001), candle(20_001), candle(20_002), candle(20_002, 20_003)]) {
        if (withoutSnapshot) candleCache.mergeLatestWithoutSnapshot(key, [incoming]);
        else candleCache.mergeLatest(key, [incoming]);
      }
      return candleCache.getLatest(key);
    };
    expect(exercise(true)).toEqual(exercise(false));
    expect(source[0].time).toBe(1);
    expect(source.at(-1)?.close).toBe(20_000);
  });

  it('preserves merge revival, strict expiry and insertion-order eviction', () => {
    const exercise = (withoutSnapshot: boolean) => {
      candleCache.clearAll();
      vi.setSystemTime(new Date('2026-07-02T00:00:00Z'));
      const keys = Array.from({ length: MAX_CANDLE_CACHE_ENTRIES + 1 }, (_, index) => (
        candleCache.createKey({ ...baseKeyParts, symbol: `LIVE${index}` })
      ));
      keys.slice(0, -1).forEach((key, index) => candleCache.setLatest(key, [candle(60)], {
        ...baseKeyParts, symbol: `LIVE${index}`,
      }));
      const merge = withoutSnapshot
        ? candleCache.mergeLatestWithoutSnapshot.bind(candleCache)
        : candleCache.mergeLatest.bind(candleCache);
      merge(keys[0], [candle(120)]);
      merge(keys.at(-1)!, [candle(60)]);
      const evicted = candleCache.getLatest(keys[0]);
      vi.advanceTimersByTime(30 * 60_000 + 1);
      // Existing merge revives an expired-but-not-yet-read entry; retain that.
      merge(keys[1], [candle(180)]);
      const revived = candleCache.getLatest(keys[1]);
      const pruned = candleCache.getLatest(keys[2]);
      vi.advanceTimersByTime(30 * 60_000);
      const atBoundary = candleCache.getLatest(keys[1]);
      vi.advanceTimersByTime(1);
      const expired = candleCache.getLatest(keys[1]);
      return { evicted, revived, pruned, atBoundary, expired };
    };
    const actual = exercise(true);
    expect(actual).toEqual(exercise(false));
    expect(actual.evicted).toBeNull();
    expect(actual.revived?.candles.map(row => row.time)).toEqual([60, 180]);
    expect(actual.pruned).toBeNull();
    expect(actual.atBoundary).not.toBeNull();
    expect(actual.expired).toBeNull();
  });

  it('does not retain private live rows across scope or broker session resets', () => {
    const key = candleCache.createKey(baseKeyParts);
    candleCache.mergeLatestWithoutSnapshot(key, [candle(60)]);
    candleCache.mergeLatestWithoutSnapshot(key, [candle(120)]);
    const snapshot = candleCache.getLatest(key)!;
    candleCache.clearScope(baseKeyParts.scope);
    candleCache.mergeLatestWithoutSnapshot(key, [candle(180)]);
    expect(candleCache.getLatest(key)?.candles.map(row => row.time)).toEqual([180]);
    emitSessionChange('account_change');
    expect(candleCache.getLatest(key)).toBeNull();
    candleCache.mergeLatestWithoutSnapshot(key, [candle(240)]);
    expect(candleCache.getLatest(key)?.candles.map(row => row.time)).toEqual([240]);
    expect(snapshot.candles.map(row => row.time)).toEqual([60, 120]);
  });
});
