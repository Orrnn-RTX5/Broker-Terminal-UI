/**
 * IndexedDB Storage Layer
 * Efficient storage and retrieval of historical tick data
 */

import type { TickData, DateRange, StorageStats } from '../types/history';

const DB_NAME = 'TradingEngineTicksDB';
const DB_VERSION = 1;
const TICKS_STORE = 'ticks';
const METADATA_STORE = 'metadata';

export class TicksDB {
  private db: IDBDatabase | null = null;
  private isInitialized = false;

  async initialize(): Promise<void> {
    if (this.isInitialized) return;

    return new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);

      request.onerror = () => {
        reject(new Error('Failed to open IndexedDB'));
      };

      request.onsuccess = () => {
        this.db = request.result;
        this.isInitialized = true;
        resolve();
      };

      request.onupgradeneeded = (event) => {
        const db = (event.target as IDBOpenDBRequest).result;

        // Ticks store with composite key (symbol + date + timestamp)
        if (!db.objectStoreNames.contains(TICKS_STORE)) {
          const ticksStore = db.createObjectStore(TICKS_STORE, {
            keyPath: ['symbol', 'date', 'timestamp']
          });

          // Indexes for efficient queries
          ticksStore.createIndex('symbol', 'symbol', { unique: false });
          ticksStore.createIndex('date', 'date', { unique: false });
          ticksStore.createIndex('symbolDate', ['symbol', 'date'], { unique: false });
          ticksStore.createIndex('timestamp', 'timestamp', { unique: false });
        }

        // Metadata store for symbol info and stats
        if (!db.objectStoreNames.contains(METADATA_STORE)) {
          db.createObjectStore(METADATA_STORE, { keyPath: 'id' });
        }
      };
    });
  }

  private getStore(storeName: string, mode: IDBTransactionMode = 'readonly'): IDBObjectStore {
    if (!this.db) {
      throw new Error('Database not initialized');
    }
    const transaction = this.db.transaction(storeName, mode);
    return transaction.objectStore(storeName);
  }

  /**
   * Store ticks for a specific symbol and date
   */
  async storeTicks(symbol: string, date: string, ticks: TickData[]): Promise<void> {
    await this.initialize();

    return new Promise((resolve, reject) => {
      const store = this.getStore(TICKS_STORE, 'readwrite');
      let completed = 0;

      // Store ticks with date partition
      ticks.forEach((tick) => {
        const record = {
          ...tick,
          symbol, // Ensure symbol is part of the composite key
          date,
          // Store compressed data if needed
          compressed: this.shouldCompress(ticks.length)
        };

        const request = store.put(record);

        request.onsuccess = () => {
          completed++;
          if (completed === ticks.length) {
            this.updateMetadata(symbol, date, ticks.length).then(resolve).catch(reject);
          }
        };

        request.onerror = () => {
          reject(new Error(`Failed to store tick: ${request.error}`));
        };
      });

      if (ticks.length === 0) {
        this.updateMetadata(symbol, date, 0).then(resolve).catch(reject);
      }
    });
  }

  /**
   * Retrieve ticks for a symbol within a date range
   */
  async getTicks(
    symbol: string,
    dateRange: DateRange,
    limit?: number
  ): Promise<TickData[]> {
    await this.initialize();

    return new Promise((resolve, reject) => {
      const store = this.getStore(TICKS_STORE);
      const index = store.index('symbolDate');
      const results: TickData[] = [];

      const fromDate = new Date(dateRange.from).toISOString().split('T')[0];
      const toDate = new Date(dateRange.to).toISOString().split('T')[0];

      // Create range for symbol + date
      const range = IDBKeyRange.bound(
        [symbol, fromDate],
        [symbol, toDate],
        false,
        false
      );

      const request = index.openCursor(range);
      let count = 0;

      request.onsuccess = (event) => {
        const cursor = (event.target as IDBRequest).result;

        if (cursor && (!limit || count < limit)) {
          results.push(cursor.value);
          count++;
          cursor.continue();
        } else {
          resolve(results);
        }
      };

      request.onerror = () => {
        reject(new Error('Failed to retrieve ticks'));
      };
    });
  }

  /**
   * Get ticks for a specific date
   */
  async getTicksByDate(symbol: string, date: string): Promise<TickData[]> {
    await this.initialize();

    return new Promise((resolve, reject) => {
      const store = this.getStore(TICKS_STORE);
      const index = store.index('symbolDate');
      const results: TickData[] = [];

      const request = index.openCursor(IDBKeyRange.only([symbol, date]));

      request.onsuccess = (event) => {
        const cursor = (event.target as IDBRequest).result;

        if (cursor) {
          results.push(cursor.value);
          cursor.continue();
        } else {
          resolve(results);
        }
      };

      request.onerror = () => {
        reject(new Error('Failed to retrieve ticks by date'));
      };
    });
  }

  /**
   * Check if data exists for symbol and date
   */
  async hasData(symbol: string, date: string): Promise<boolean> {
    await this.initialize();

    return new Promise((resolve, reject) => {
      const store = this.getStore(METADATA_STORE);
      const key = `${symbol}-${date}`;
      const request = store.get(key);

      request.onsuccess = () => {
        resolve(!!request.result);
      };

      request.onerror = () => {
        reject(new Error('Failed to check data existence'));
      };
    });
  }

  /**
   * Get downloaded dates for a symbol
   */
  async getDownloadedDates(symbol: string): Promise<string[]> {
    await this.initialize();

    return new Promise((resolve, reject) => {
      const store = this.getStore(METADATA_STORE);
      const request = store.openCursor();
      const dates: string[] = [];

      request.onsuccess = (event) => {
        const cursor = (event.target as IDBRequest).result;

        if (cursor) {
          const key = cursor.key as string;
          if (key.startsWith(`${symbol}-`)) {
            const date = key.split('-').slice(1).join('-');
            dates.push(date);
          }
          cursor.continue();
        } else {
          resolve(dates.sort());
        }
      };

      request.onerror = () => {
        reject(new Error('Failed to get downloaded dates'));
      };
    });
  }

  /**
   * Delete ticks for a symbol and date
   */
  async deleteTicks(symbol: string, date: string): Promise<void> {
    await this.initialize();

    return new Promise((resolve, reject) => {
      const ticksStore = this.getStore(TICKS_STORE, 'readwrite');
      const index = ticksStore.index('symbolDate');
      const request = index.openCursor(IDBKeyRange.only([symbol, date]));

      request.onsuccess = (event) => {
        const cursor = (event.target as IDBRequest).result;

        if (cursor) {
          cursor.delete();
          cursor.continue();
        } else {
          // Also delete metadata
          this.deleteMetadata(symbol, date).then(resolve).catch(reject);
        }
      };

      request.onerror = () => {
        reject(new Error('Failed to delete ticks'));
      };
    });
  }

  /**
   * Get storage statistics
   */
  async getStorageStats(): Promise<StorageStats> {
    await this.initialize();

    return new Promise((resolve, reject) => {
      const store = this.getStore(METADATA_STORE);
      const request = store.getAll();

      request.onsuccess = () => {
        const metadata = request.result;
        const stats: StorageStats = {
          totalSize: 0,
          tickCount: 0,
          symbolCount: new Set(metadata.map((m: any) => m.symbol)).size,
          dateRanges: {},
          lastUpdate: Date.now()
        };

        metadata.forEach((m: any) => {
          stats.totalSize += m.size || 0;
          stats.tickCount += m.count || 0;

          if (!stats.dateRanges[m.symbol]) {
            stats.dateRanges[m.symbol] = { from: m.date, to: m.date };
          } else {
            if (m.date < stats.dateRanges[m.symbol].from) {
              stats.dateRanges[m.symbol].from = m.date;
            }
            if (m.date > stats.dateRanges[m.symbol].to) {
              stats.dateRanges[m.symbol].to = m.date;
            }
          }
        });

        resolve(stats);
      };

      request.onerror = () => {
        reject(new Error('Failed to get storage stats'));
      };
    });
  }

  /**
   * Clear all data for a symbol
   */
  async clearSymbol(symbol: string): Promise<void> {
    await this.initialize();
    const dates = await this.getDownloadedDates(symbol);

    for (const date of dates) {
      await this.deleteTicks(symbol, date);
    }
  }

  /**
   * Clear all data
   */
  async clearAll(): Promise<void> {
    await this.initialize();

    return new Promise((resolve, reject) => {
      const ticksStore = this.getStore(TICKS_STORE, 'readwrite');
      const metadataStore = this.getStore(METADATA_STORE, 'readwrite');

      const clearTicks = ticksStore.clear();
      const clearMetadata = metadataStore.clear();

      clearTicks.onsuccess = () => {
        clearMetadata.onsuccess = () => resolve();
        clearMetadata.onerror = () => reject(new Error('Failed to clear metadata'));
      };

      clearTicks.onerror = () => {
        reject(new Error('Failed to clear ticks'));
      };
    });
  }

  /**
   * Update metadata for symbol and date
   */
  private async updateMetadata(symbol: string, date: string, count: number): Promise<void> {
    return new Promise((resolve, reject) => {
      const store = this.getStore(METADATA_STORE, 'readwrite');
      const key = `${symbol}-${date}`;

      const metadata = {
        id: key,
        symbol,
        date,
        count,
        size: count * 32, // Estimate: 32 bytes per tick
        timestamp: Date.now()
      };

      const request = store.put(metadata);

      request.onsuccess = () => resolve();
      request.onerror = () => reject(new Error('Failed to update metadata'));
    });
  }

  /**
   * Delete metadata
   */
  private async deleteMetadata(symbol: string, date: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const store = this.getStore(METADATA_STORE, 'readwrite');
      const key = `${symbol}-${date}`;
      const request = store.delete(key);

      request.onsuccess = () => resolve();
      request.onerror = () => reject(new Error('Failed to delete metadata'));
    });
  }

  /**
   * Determine if compression should be used
   */
  private shouldCompress(tickCount: number): boolean {
    // Compress if more than 10,000 ticks
    return tickCount > 10000;
  }
}

// Export singleton instance
export const ticksDB = new TicksDB();
