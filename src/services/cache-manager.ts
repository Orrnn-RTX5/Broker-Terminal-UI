/**
 * Cache Manager with IndexedDB for Historical Data
 * - Persistent storage for market data
 * - Smart invalidation strategies
 * - Prefetching for adjacent timeframes
 * - Memory and disk quota management
 */

interface CacheEntry<T> {
  key: string;
  data: T;
  timestamp: number;
  expiresAt: number;
  size: number;
}

interface CacheOptions {
  ttl?: number; // Time to live in milliseconds
  maxSize?: number; // Max size in bytes
  strategy?: 'LRU' | 'LFU' | 'FIFO';
}

export class CacheManager {
  private dbName = 'TradingEngineCache';
  private version = 1;
  private db: IDBDatabase | null = null;
  private memoryCache: Map<string, CacheEntry<unknown>> = new Map();
  private accessCount: Map<string, number> = new Map();
  private maxMemoryCacheSize = 50 * 1024 * 1024; // 50MB
  private currentMemoryCacheSize = 0;

  async initialize(): Promise<void> {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(this.dbName, this.version);

      request.onerror = () => {
        console.error('[Cache] Failed to open IndexedDB:', request.error);
        reject(request.error);
      };

      request.onsuccess = () => {
        this.db = request.result;
        console.log('[Cache] IndexedDB initialized');
        resolve();
      };

      request.onupgradeneeded = (event) => {
        const db = (event.target as IDBOpenDBRequest).result;

        // Create object stores
        if (!db.objectStoreNames.contains('ticks')) {
          const tickStore = db.createObjectStore('ticks', { keyPath: 'key' });
          tickStore.createIndex('symbol', 'symbol', { unique: false });
          tickStore.createIndex('timestamp', 'timestamp', { unique: false });
          tickStore.createIndex('expiresAt', 'expiresAt', { unique: false });
        }

        if (!db.objectStoreNames.contains('ohlcv')) {
          const ohlcvStore = db.createObjectStore('ohlcv', { keyPath: 'key' });
          ohlcvStore.createIndex('symbol', 'symbol', { unique: false });
          ohlcvStore.createIndex('timeframe', 'timeframe', { unique: false });
          ohlcvStore.createIndex('timestamp', 'timestamp', { unique: false });
          ohlcvStore.createIndex('expiresAt', 'expiresAt', { unique: false });
        }

        if (!db.objectStoreNames.contains('metadata')) {
          db.createObjectStore('metadata', { keyPath: 'key' });
        }
      };
    });
  }

  /**
   * Get data from cache (memory first, then IndexedDB)
   */
  async get<T>(key: string): Promise<T | null> {
    // Check memory cache first
    const memoryEntry = this.memoryCache.get(key) as CacheEntry<T> | undefined;
    if (memoryEntry) {
      // Check if expired
      if (Date.now() > memoryEntry.expiresAt) {
        this.memoryCache.delete(key);
      } else {
        // Update access count for LFU
        this.accessCount.set(key, (this.accessCount.get(key) || 0) + 1);
        return memoryEntry.data;
      }
    }

    // Check IndexedDB
    const dbEntry = await this.getFromDB<T>(key);
    if (dbEntry) {
      // Check if expired
      if (Date.now() > dbEntry.expiresAt) {
        await this.delete(key);
        return null;
      }

      // Add to memory cache if space available
      if (this.currentMemoryCacheSize + dbEntry.size < this.maxMemoryCacheSize) {
        this.memoryCache.set(key, dbEntry);
        this.currentMemoryCacheSize += dbEntry.size;
      }

      return dbEntry.data;
    }

    return null;
  }

  /**
   * Set data in cache
   */
  async set<T>(key: string, data: T, options: CacheOptions = {}): Promise<void> {
    const ttl = options.ttl || 60 * 60 * 1000; // Default 1 hour
    const timestamp = Date.now();
    const expiresAt = timestamp + ttl;
    const size = this.estimateSize(data);

    const entry: CacheEntry<T> = {
      key,
      data,
      timestamp,
      expiresAt,
      size,
    };

    // Add to memory cache if space available
    if (this.currentMemoryCacheSize + size < this.maxMemoryCacheSize) {
      this.memoryCache.set(key, entry);
      this.currentMemoryCacheSize += size;
      this.accessCount.set(key, 1);
    } else {
      // Evict based on strategy
      await this.evict(size);
      this.memoryCache.set(key, entry);
      this.currentMemoryCacheSize += size;
    }

    // Always save to IndexedDB for persistence
    await this.setInDB(key, entry);
  }

  /**
   * Delete from cache
   */
  async delete(key: string): Promise<void> {
    // Remove from memory
    const entry = this.memoryCache.get(key);
    if (entry) {
      this.currentMemoryCacheSize -= entry.size;
      this.memoryCache.delete(key);
      this.accessCount.delete(key);
    }

    // Remove from IndexedDB
    await this.deleteFromDB(key);
  }

  /**
   * Clear all cache
   */
  async clear(): Promise<void> {
    // Clear memory
    this.memoryCache.clear();
    this.accessCount.clear();
    this.currentMemoryCacheSize = 0;

    // Clear IndexedDB
    await this.clearDB();
  }

  /**
   * Get multiple entries by prefix
   */
  async getByPrefix<T>(prefix: string): Promise<T[]> {
    const results: T[] = [];

    // Check memory cache
    for (const [key, entry] of this.memoryCache.entries()) {
      if (key.startsWith(prefix) && Date.now() <= entry.expiresAt) {
        results.push(entry.data as T);
      }
    }

    // Check IndexedDB
    const dbResults = await this.getFromDBByPrefix<T>(prefix);
    results.push(...dbResults);

    return results;
  }

  /**
   * Invalidate entries matching pattern
   */
  async invalidate(pattern: string | RegExp): Promise<void> {
    const regex = typeof pattern === 'string' ? new RegExp(pattern) : pattern;

    // Invalidate memory cache
    for (const key of this.memoryCache.keys()) {
      if (regex.test(key)) {
        await this.delete(key);
      }
    }

    // Invalidate IndexedDB (requires reading all keys)
    await this.invalidateDB(regex);
  }

  /**
   * Prefetch adjacent timeframes
   */
  async prefetch(symbol: string, timeframe: string): Promise<void> {
    const adjacentTimeframes = this.getAdjacentTimeframes(timeframe);

    for (const tf of adjacentTimeframes) {
      const key = `ohlcv:${symbol}:${tf}`;
      const cached = await this.get(key);
      if (!cached) {
        console.log(`[Cache] Prefetching ${key}`);
        // Trigger fetch in background (implementation depends on your API)
      }
    }
  }

  /**
   * Get cache statistics
   */
  async getStats(): Promise<{
    memorySize: number;
    memoryCount: number;
    diskSize: number;
    diskCount: number;
  }> {
    const diskStats = await this.getDBStats();

    return {
      memorySize: this.currentMemoryCacheSize,
      memoryCount: this.memoryCache.size,
      diskSize: diskStats.size,
      diskCount: diskStats.count,
    };
  }

  /**
   * Clean up expired entries
   */
  async cleanup(): Promise<number> {
    let cleaned = 0;
    const now = Date.now();

    // Clean memory cache
    for (const [key, entry] of this.memoryCache.entries()) {
      if (now > entry.expiresAt) {
        await this.delete(key);
        cleaned++;
      }
    }

    // Clean IndexedDB
    cleaned += await this.cleanupDB();

    console.log(`[Cache] Cleaned up ${cleaned} expired entries`);
    return cleaned;
  }

  // ============================================
  // Private Helper Methods
  // ============================================

  private async getFromDB<T>(key: string): Promise<CacheEntry<T> | null> {
    if (!this.db) return null;

    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction(['ticks', 'ohlcv'], 'readonly');
      const tickStore = transaction.objectStore('ticks');
      const ohlcvStore = transaction.objectStore('ohlcv');

      const tickRequest = tickStore.get(key);
      const ohlcvRequest = ohlcvStore.get(key);

      transaction.oncomplete = () => {
        resolve(tickRequest.result || ohlcvRequest.result || null);
      };

      transaction.onerror = () => {
        console.error('[Cache] Failed to get from DB:', transaction.error);
        reject(transaction.error);
      };
    });
  }

  private async setInDB<T>(key: string, entry: CacheEntry<T>): Promise<void> {
    if (!this.db) return;

    return new Promise((resolve, reject) => {
      const storeName = key.startsWith('ohlcv') ? 'ohlcv' : 'ticks';
      const transaction = this.db!.transaction([storeName], 'readwrite');
      const store = transaction.objectStore(storeName);

      const request = store.put(entry);

      request.onsuccess = () => resolve();
      request.onerror = () => {
        console.error('[Cache] Failed to set in DB:', request.error);
        reject(request.error);
      };
    });
  }

  private async deleteFromDB(key: string): Promise<void> {
    if (!this.db) return;

    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction(['ticks', 'ohlcv'], 'readwrite');
      const tickStore = transaction.objectStore('ticks');
      const ohlcvStore = transaction.objectStore('ohlcv');

      tickStore.delete(key);
      ohlcvStore.delete(key);

      transaction.oncomplete = () => resolve();
      transaction.onerror = () => {
        console.error('[Cache] Failed to delete from DB:', transaction.error);
        reject(transaction.error);
      };
    });
  }

  private async clearDB(): Promise<void> {
    if (!this.db) return;

    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction(['ticks', 'ohlcv'], 'readwrite');
      const tickStore = transaction.objectStore('ticks');
      const ohlcvStore = transaction.objectStore('ohlcv');

      tickStore.clear();
      ohlcvStore.clear();

      transaction.oncomplete = () => resolve();
      transaction.onerror = () => {
        console.error('[Cache] Failed to clear DB:', transaction.error);
        reject(transaction.error);
      };
    });
  }

  private async getFromDBByPrefix<T>(prefix: string): Promise<T[]> {
    if (!this.db) return [];

    return new Promise((resolve, reject) => {
      const results: T[] = [];
      const transaction = this.db!.transaction(['ticks', 'ohlcv'], 'readonly');
      const tickStore = transaction.objectStore('ticks');
      const ohlcvStore = transaction.objectStore('ohlcv');

      const processStore = (store: IDBObjectStore) => {
        const request = store.openCursor();

        request.onsuccess = (event) => {
          const cursor = (event.target as IDBRequest).result;
          if (cursor) {
            const entry = cursor.value as CacheEntry<T>;
            if (entry.key.startsWith(prefix) && Date.now() <= entry.expiresAt) {
              results.push(entry.data);
            }
            cursor.continue();
          }
        };
      };

      processStore(tickStore);
      processStore(ohlcvStore);

      transaction.oncomplete = () => resolve(results);
      transaction.onerror = () => {
        console.error('[Cache] Failed to get by prefix from DB:', transaction.error);
        reject(transaction.error);
      };
    });
  }

  private async invalidateDB(regex: RegExp): Promise<void> {
    if (!this.db) return;

    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction(['ticks', 'ohlcv'], 'readwrite');
      const tickStore = transaction.objectStore('ticks');
      const ohlcvStore = transaction.objectStore('ohlcv');

      const processStore = (store: IDBObjectStore) => {
        const request = store.openCursor();

        request.onsuccess = (event) => {
          const cursor = (event.target as IDBRequest).result;
          if (cursor) {
            const entry = cursor.value as CacheEntry<unknown>;
            if (regex.test(entry.key)) {
              cursor.delete();
            }
            cursor.continue();
          }
        };
      };

      processStore(tickStore);
      processStore(ohlcvStore);

      transaction.oncomplete = () => resolve();
      transaction.onerror = () => {
        console.error('[Cache] Failed to invalidate DB:', transaction.error);
        reject(transaction.error);
      };
    });
  }

  private async getDBStats(): Promise<{ size: number; count: number }> {
    if (!this.db) return { size: 0, count: 0 };

    return new Promise((resolve, reject) => {
      let totalSize = 0;
      let totalCount = 0;

      const transaction = this.db!.transaction(['ticks', 'ohlcv'], 'readonly');
      const tickStore = transaction.objectStore('ticks');
      const ohlcvStore = transaction.objectStore('ohlcv');

      const processStore = (store: IDBObjectStore) => {
        const request = store.openCursor();

        request.onsuccess = (event) => {
          const cursor = (event.target as IDBRequest).result;
          if (cursor) {
            const entry = cursor.value as CacheEntry<unknown>;
            totalSize += entry.size;
            totalCount++;
            cursor.continue();
          }
        };
      };

      processStore(tickStore);
      processStore(ohlcvStore);

      transaction.oncomplete = () => resolve({ size: totalSize, count: totalCount });
      transaction.onerror = () => {
        console.error('[Cache] Failed to get DB stats:', transaction.error);
        reject(transaction.error);
      };
    });
  }

  private async cleanupDB(): Promise<number> {
    if (!this.db) return 0;

    return new Promise((resolve, reject) => {
      let cleaned = 0;
      const now = Date.now();

      const transaction = this.db!.transaction(['ticks', 'ohlcv'], 'readwrite');
      const tickStore = transaction.objectStore('ticks');
      const ohlcvStore = transaction.objectStore('ohlcv');

      const processStore = (store: IDBObjectStore) => {
        const request = store.openCursor();

        request.onsuccess = (event) => {
          const cursor = (event.target as IDBRequest).result;
          if (cursor) {
            const entry = cursor.value as CacheEntry<unknown>;
            if (now > entry.expiresAt) {
              cursor.delete();
              cleaned++;
            }
            cursor.continue();
          }
        };
      };

      processStore(tickStore);
      processStore(ohlcvStore);

      transaction.oncomplete = () => resolve(cleaned);
      transaction.onerror = () => {
        console.error('[Cache] Failed to cleanup DB:', transaction.error);
        reject(transaction.error);
      };
    });
  }

  private estimateSize(data: unknown): number {
    // Rough estimation of object size in bytes
    const json = JSON.stringify(data);
    return new Blob([json]).size;
  }

  private async evict(requiredSize: number): Promise<void> {
    // Evict entries until we have enough space
    const entries = Array.from(this.memoryCache.entries());

    // Sort by strategy (LRU by default)
    entries.sort((a, b) => {
      return a[1].timestamp - b[1].timestamp;
    });

    let freedSize = 0;
    for (const [key, entry] of entries) {
      if (freedSize >= requiredSize) break;

      this.memoryCache.delete(key);
      this.accessCount.delete(key);
      this.currentMemoryCacheSize -= entry.size;
      freedSize += entry.size;
    }
  }

  private getAdjacentTimeframes(timeframe: string): string[] {
    const timeframes = ['1m', '5m', '15m', '1h', '4h', '1d'];
    const index = timeframes.indexOf(timeframe);

    if (index === -1) return [];

    const adjacent: string[] = [];
    if (index > 0) adjacent.push(timeframes[index - 1]);
    if (index < timeframes.length - 1) adjacent.push(timeframes[index + 1]);

    return adjacent;
  }
}

// Singleton instance
let cacheInstance: CacheManager | null = null;

export const getCacheManager = async (): Promise<CacheManager> => {
  if (!cacheInstance) {
    cacheInstance = new CacheManager();
    await cacheInstance.initialize();
  }

  return cacheInstance;
};
