/**
 * Session-only candle cache used to make chart timeframe switches render
 * immediately while the backend remains the source of truth.
 */

import type { OHLCData } from './chartDataService';
import { onSessionChange } from './brokerSession';

export type CandleCacheKey = string & { readonly __brand: 'CandleCacheKey' };
export type CandleCacheSource = 'backend' | 'derived-m1' | 'mixed';
export const CANDLE_HISTORY_CACHE_VERSION = 'backend-first-m1-fallback-v2';

export interface CandleCacheKeyParts {
  scope: string;
  symbol: string;
  timeframe: string;
  limit: number;
  version?: string;
}

export interface CandleCacheMetadata extends CandleCacheKeyParts {
  brokerOffsetSeconds?: number;
  source?: CandleCacheSource;
}

export interface CandleCacheEntry extends CandleCacheMetadata {
  key: CandleCacheKey;
  candles: OHLCData[];
  fetchedAt: number;
  oldestTime: number | null;
  newestTime: number | null;
}

const KEY_SEPARATOR = '\u001f';
const STALE_AFTER_MS = 2 * 60 * 1000;
const MAX_CACHE_AGE_MS = 30 * 60 * 1000;
export const MAX_CANDLE_CACHE_ENTRIES = 64;
export const MAX_CANDLES_PER_CACHE_ENTRY = 20_000;

const normalizeScope = (scope: string): string => String(scope || 'default').trim().replace(/\/+$/, '') || 'default';
const normalizeSymbol = (symbol: string): string => String(symbol || '').replace(/[^a-zA-Z0-9]/g, '').toUpperCase();
const normalizeTimeframe = (timeframe: string): string => String(timeframe || 'M1').trim().toUpperCase();
const normalizeVersion = (version: string | undefined): string => (
  String(version || CANDLE_HISTORY_CACHE_VERSION).trim() || CANDLE_HISTORY_CACHE_VERSION
);

const cloneCandle = (candle: OHLCData): OHLCData => ({ ...candle });
const cloneCandles = (candles: OHLCData[]): OHLCData[] => candles.map(cloneCandle);

const sortAndDedupeCandles = (candles: OHLCData[]): OHLCData[] => {
  const byTime = new Map<number, OHLCData>();
  for (const candle of candles) {
    const time = Number(candle?.time);
    if (!Number.isFinite(time)) continue;
    byTime.set(time, { ...candle, time });
  }
  return Array.from(byTime.values()).sort((a, b) => a.time - b.time);
};

class CandleCache {
  private entries = new Map<CandleCacheKey, CandleCacheEntry>();
  private inFlight = new Map<CandleCacheKey, Promise<unknown>>();
  private generation = 0;

  createKey(parts: CandleCacheKeyParts): CandleCacheKey {
    const scope = normalizeScope(parts.scope);
    const symbol = normalizeSymbol(parts.symbol);
    const timeframe = normalizeTimeframe(parts.timeframe);
    const limit = Math.max(0, Math.floor(Number(parts.limit) || 0));
    const version = normalizeVersion(parts.version);
    return [scope, symbol, timeframe, limit, version].join(KEY_SEPARATOR) as CandleCacheKey;
  }

  getLatest(key: CandleCacheKey): CandleCacheEntry | null {
    const entry = this.entries.get(key);
    if (!entry) return null;
    if (Date.now() - entry.fetchedAt > MAX_CACHE_AGE_MS) {
      this.entries.delete(key);
      return null;
    }
    // Map insertion order doubles as a tiny LRU without another index.
    this.entries.delete(key);
    this.entries.set(key, entry);
    return this.cloneEntry(entry);
  }

  setLatest(key: CandleCacheKey, candles: OHLCData[], metadata: CandleCacheMetadata): CandleCacheEntry {
    const normalizedCandles = this.boundCandles(sortAndDedupeCandles(candles));
    const entry: CandleCacheEntry = {
      key,
      ...this.normalizeMetadata(metadata),
      candles: cloneCandles(normalizedCandles),
      fetchedAt: Date.now(),
      oldestTime: normalizedCandles[0]?.time ?? null,
      newestTime: normalizedCandles[normalizedCandles.length - 1]?.time ?? null,
    };
    this.entries.set(key, entry);
    this.pruneEntries();
    return this.cloneEntry(entry);
  }

  mergeLatest(key: CandleCacheKey, candles: OHLCData[], metadata?: CandleCacheMetadata): CandleCacheEntry {
    const existing = this.entries.get(key);
    const merged = this.boundCandles(sortAndDedupeCandles([
      ...(existing?.candles ?? []),
      ...candles,
    ]));
    const nextMetadata = metadata
      ? this.normalizeMetadata(metadata)
      : existing
        ? this.normalizeMetadata(existing)
        : this.metadataFromKey(key);
    const source = this.mergeSources(existing?.source, nextMetadata.source);
    const entry: CandleCacheEntry = {
      key,
      ...nextMetadata,
      source,
      candles: cloneCandles(merged),
      fetchedAt: Date.now(),
      oldestTime: merged[0]?.time ?? null,
      newestTime: merged[merged.length - 1]?.time ?? null,
    };
    this.entries.set(key, entry);
    this.pruneEntries();
    return this.cloneEntry(entry);
  }

  isStale(entry: CandleCacheEntry, staleAfterMs = STALE_AFTER_MS): boolean {
    return Date.now() - entry.fetchedAt > staleAfterMs;
  }

  getGeneration(): number {
    return this.generation;
  }

  dedupe<T>(key: CandleCacheKey, factory: () => Promise<T>): Promise<T> {
    const existing = this.inFlight.get(key) as Promise<T> | undefined;
    if (existing) return existing;
    const next = factory().finally(() => {
      if (this.inFlight.get(key) === next) this.inFlight.delete(key);
    });
    this.inFlight.set(key, next);
    return next;
  }

  clearScope(scope: string): void {
    const normalizedScope = normalizeScope(scope);
    for (const [key, entry] of this.entries) {
      if (entry.scope === normalizedScope) this.entries.delete(key);
    }
    for (const [key] of this.inFlight) {
      if (String(key).startsWith(`${normalizedScope}${KEY_SEPARATOR}`)) this.inFlight.delete(key);
    }
    this.generation += 1;
  }

  clearAll(): void {
    this.entries.clear();
    this.inFlight.clear();
    this.generation += 1;
  }

  private boundCandles(candles: OHLCData[]): OHLCData[] {
    return candles.length > MAX_CANDLES_PER_CACHE_ENTRY
      ? candles.slice(-MAX_CANDLES_PER_CACHE_ENTRY)
      : candles;
  }

  private pruneEntries(): void {
    const oldestAllowed = Date.now() - MAX_CACHE_AGE_MS;
    for (const [key, entry] of this.entries) {
      if (entry.fetchedAt < oldestAllowed) this.entries.delete(key);
    }
    while (this.entries.size > MAX_CANDLE_CACHE_ENTRIES) {
      const oldestKey = this.entries.keys().next().value as CandleCacheKey | undefined;
      if (!oldestKey) break;
      this.entries.delete(oldestKey);
    }
  }

  private normalizeMetadata(metadata: CandleCacheMetadata): CandleCacheMetadata {
    return {
      scope: normalizeScope(metadata.scope),
      symbol: normalizeSymbol(metadata.symbol),
      timeframe: normalizeTimeframe(metadata.timeframe),
      limit: Math.max(0, Math.floor(Number(metadata.limit) || 0)),
      version: normalizeVersion(metadata.version),
      brokerOffsetSeconds: metadata.brokerOffsetSeconds ?? 0,
      source: metadata.source ?? 'backend',
    };
  }

  private metadataFromKey(key: CandleCacheKey): CandleCacheMetadata {
    const [
      scope = 'default',
      symbol = '',
      timeframe = 'M1',
      limit = '0',
      version = CANDLE_HISTORY_CACHE_VERSION,
    ] = String(key).split(KEY_SEPARATOR);
    return {
      scope: normalizeScope(scope),
      symbol: normalizeSymbol(symbol),
      timeframe: normalizeTimeframe(timeframe),
      limit: Math.max(0, Math.floor(Number(limit) || 0)),
      version: normalizeVersion(version),
      brokerOffsetSeconds: 0,
      source: 'backend',
    };
  }

  private mergeSources(
    existingSource: CandleCacheSource | undefined,
    incomingSource: CandleCacheSource | undefined,
  ): CandleCacheSource {
    const existing = existingSource ?? 'backend';
    const incoming = incomingSource ?? 'backend';
    return existing === incoming ? incoming : 'mixed';
  }

  private cloneEntry(entry: CandleCacheEntry): CandleCacheEntry {
    return {
      ...entry,
      candles: cloneCandles(entry.candles),
    };
  }
}

export const candleCache = new CandleCache();

onSessionChange((reason) => {
  if (reason === 'login' || reason === 'logout' || reason === 'broker_url_change' || reason === 'account_change') {
    candleCache.clearAll();
  }
});

if (typeof window !== 'undefined') {
  window.addEventListener('auth:token-updated', () => {
    if (!window.localStorage.getItem('auth_token') && !window.sessionStorage.getItem('auth_token')) {
      candleCache.clearAll();
    }
  });
}
