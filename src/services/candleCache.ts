/**
 * Session-only candle cache used to make chart timeframe switches render
 * immediately while the backend remains the source of truth.
 */

import type { OHLCData } from './chartDataService';
import { onSessionChange } from './brokerSession';

export type CandleCacheKey = string & { readonly __brand: 'CandleCacheKey' };

export interface CandleCacheKeyParts {
  scope: string;
  symbol: string;
  timeframe: string;
  limit: number;
}

export interface CandleCacheMetadata extends CandleCacheKeyParts {
  brokerOffsetSeconds?: number;
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

const normalizeScope = (scope: string): string => String(scope || 'default').trim().replace(/\/+$/, '') || 'default';
const normalizeSymbol = (symbol: string): string => String(symbol || '').replace(/[^a-zA-Z0-9]/g, '').toUpperCase();
const normalizeTimeframe = (timeframe: string): string => String(timeframe || 'M1').trim().toUpperCase();

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
    return [scope, symbol, timeframe, limit].join(KEY_SEPARATOR) as CandleCacheKey;
  }

  getLatest(key: CandleCacheKey): CandleCacheEntry | null {
    const entry = this.entries.get(key);
    if (!entry) return null;
    if (Date.now() - entry.fetchedAt > MAX_CACHE_AGE_MS) {
      this.entries.delete(key);
      return null;
    }
    return this.cloneEntry(entry);
  }

  setLatest(key: CandleCacheKey, candles: OHLCData[], metadata: CandleCacheMetadata): CandleCacheEntry {
    const normalizedCandles = sortAndDedupeCandles(candles);
    const entry: CandleCacheEntry = {
      key,
      ...this.normalizeMetadata(metadata),
      candles: cloneCandles(normalizedCandles),
      fetchedAt: Date.now(),
      oldestTime: normalizedCandles[0]?.time ?? null,
      newestTime: normalizedCandles[normalizedCandles.length - 1]?.time ?? null,
    };
    this.entries.set(key, entry);
    return this.cloneEntry(entry);
  }

  mergeLatest(key: CandleCacheKey, candles: OHLCData[], metadata?: CandleCacheMetadata): CandleCacheEntry {
    const existing = this.entries.get(key);
    const merged = sortAndDedupeCandles([
      ...(existing?.candles ?? []),
      ...candles,
    ]);
    const nextMetadata = metadata
      ? this.normalizeMetadata(metadata)
      : existing
        ? this.normalizeMetadata(existing)
        : this.metadataFromKey(key);
    const entry: CandleCacheEntry = {
      key,
      ...nextMetadata,
      candles: cloneCandles(merged),
      fetchedAt: Date.now(),
      oldestTime: merged[0]?.time ?? null,
      newestTime: merged[merged.length - 1]?.time ?? null,
    };
    this.entries.set(key, entry);
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

  private normalizeMetadata(metadata: CandleCacheMetadata): CandleCacheMetadata {
    return {
      scope: normalizeScope(metadata.scope),
      symbol: normalizeSymbol(metadata.symbol),
      timeframe: normalizeTimeframe(metadata.timeframe),
      limit: Math.max(0, Math.floor(Number(metadata.limit) || 0)),
      brokerOffsetSeconds: metadata.brokerOffsetSeconds ?? 0,
    };
  }

  private metadataFromKey(key: CandleCacheKey): CandleCacheMetadata {
    const [scope = 'default', symbol = '', timeframe = 'M1', limit = '0'] = String(key).split(KEY_SEPARATOR);
    return {
      scope: normalizeScope(scope),
      symbol: normalizeSymbol(symbol),
      timeframe: normalizeTimeframe(timeframe),
      limit: Math.max(0, Math.floor(Number(limit) || 0)),
      brokerOffsetSeconds: 0,
    };
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
    if (!window.localStorage.getItem('auth_token')) {
      candleCache.clearAll();
    }
  });
}
