/**
 * Candle Cache Service
 * In-memory cache for historical candle data.
 * Eliminates redundant backend fetches when the same symbol+timeframe
 * is requested again within the TTL window.
 */

interface CacheEntry {
  candles: any[];
  fetchedAt: number; // ms timestamp
}

// TTL: 60 seconds — fresh enough for live markets, avoids redundant fetches on switching
const CACHE_TTL_MS = 60_000;

class CandleCache {
  private cache = new Map<string, CacheEntry>();

  private key(symbol: string, timeframe: string, limit: number): string {
    return `${symbol}:${timeframe}:${limit}`;
  }

  get(symbol: string, timeframe: string, limit: number): any[] | null {
    const entry = this.cache.get(this.key(symbol, timeframe, limit));
    if (!entry) return null;
    if (Date.now() - entry.fetchedAt > CACHE_TTL_MS) {
      this.cache.delete(this.key(symbol, timeframe, limit));
      return null;
    }
    return entry.candles;
  }

  set(symbol: string, timeframe: string, limit: number, candles: any[]): void {
    this.cache.set(this.key(symbol, timeframe, limit), {
      candles,
      fetchedAt: Date.now(),
    });
  }

  /** Force-invalidate a symbol when a new live candle completes */
  invalidate(symbol: string): void {
    for (const k of this.cache.keys()) {
      if (k.startsWith(`${symbol}:`)) this.cache.delete(k);
    }
  }

  clear(): void {
    this.cache.clear();
  }
}

export const candleCache = new CandleCache();
