/**
 * Historical Data Manager Service
 * Orchestrates downloading, caching, and retrieval of historical data
 */

import { ticksDB } from '../db/ticksDB';
import { historyClient } from '../api/historyClient';
import type {
  TickData,
  DateRange,
  DownloadTask,
  SymbolDataInfo,
  StorageStats
} from '../types/history';

export type DownloadProgressCallback = (task: DownloadTask) => void;

export class HistoryDataManager {
  private downloadTasks = new Map<string, DownloadTask>();
  private progressCallbacks = new Map<string, DownloadProgressCallback>();
  private maxConcurrentDownloads = 3;
  private activeDownloads = 0;
  private downloadQueue: string[] = [];

  constructor() {
    this.initialize();
  }

  private async initialize() {
    try {
      await ticksDB.initialize();
    } catch (error) {
      console.error('Failed to initialize TicksDB:', error);
    }
  }

  /**
   * Get available symbols and their data info
   */
  async getAvailableSymbols(): Promise<SymbolDataInfo[]> {
    try {
      const serverData = await historyClient.getAvailableData();

      // Merge with local cache info
      for (const symbolInfo of serverData) {
        const downloadedDates = await ticksDB.getDownloadedDates(symbolInfo.symbol);
        symbolInfo.downloadedDates = downloadedDates;

        const downloadedCount = downloadedDates.length;
        const totalCount = symbolInfo.availableDates?.length || 0;
        symbolInfo.downloadProgress = totalCount > 0
          ? (downloadedCount / totalCount) * 100
          : 0;
      }

      return serverData;
    } catch (error) {
      console.error('Failed to get available symbols:', error);
      return [];
    }
  }

  /**
   * Get symbol data info
   */
  async getSymbolInfo(symbol: string): Promise<SymbolDataInfo | null> {
    try {
      const symbolInfo = await historyClient.getSymbolInfo(symbol);
      const downloadedDates = await ticksDB.getDownloadedDates(symbol);

      symbolInfo.downloadedDates = downloadedDates;
      const totalCount = symbolInfo.availableDates?.length || 0;
      symbolInfo.downloadProgress = totalCount > 0
        ? (downloadedDates.length / totalCount) * 100
        : 0;

      return symbolInfo;
    } catch (error) {
      console.error('Failed to get symbol info:', error);
      return null;
    }
  }

  /**
   * Download historical data for a date range
   */
  async downloadData(
    symbol: string,
    dateRange: DateRange,
    onProgress?: DownloadProgressCallback
  ): Promise<string> {
    const taskId = this.generateTaskId(symbol, dateRange);

    // Check if task already exists
    if (this.downloadTasks.has(taskId)) {
      const existingTask = this.downloadTasks.get(taskId)!;
      if (existingTask.status === 'downloading' || existingTask.status === 'pending') {
        return taskId;
      }
    }

    // Create download task
    const task: DownloadTask = {
      id: taskId,
      symbol,
      dateRange,
      status: 'pending',
      progress: 0,
      totalTicks: 0,
      downloadedTicks: 0,
      startTime: Date.now()
    };

    this.downloadTasks.set(taskId, task);

    if (onProgress) {
      this.progressCallbacks.set(taskId, onProgress);
    }

    // Add to queue
    this.downloadQueue.push(taskId);
    this.processQueue();

    return taskId;
  }

  /**
   * Download data for a specific date
   */
  async downloadDate(
    symbol: string,
    date: string,
    onProgress?: DownloadProgressCallback
  ): Promise<string> {
    return this.downloadData(
      symbol,
      { from: date, to: date },
      onProgress
    );
  }

  /**
   * Process download queue
   */
  private async processQueue() {
    while (
      this.downloadQueue.length > 0 &&
      this.activeDownloads < this.maxConcurrentDownloads
    ) {
      const taskId = this.downloadQueue.shift()!;
      await this.executeDownload(taskId);
    }
  }

  /**
   * Execute a download task
   */
  private async executeDownload(taskId: string) {
    const task = this.downloadTasks.get(taskId);
    if (!task) return;

    this.activeDownloads++;
    task.status = 'downloading';
    this.notifyProgress(task);

    try {
      const dates = this.getDatesBetween(task.dateRange.from, task.dateRange.to);
      let totalDownloaded = 0;

      for (let i = 0; i < dates.length; i++) {
        const date = dates[i];

        // Check if already cached
        const hasData = await ticksDB.hasData(task.symbol, date);
        if (hasData) {
          task.progress = ((i + 1) / dates.length) * 100;
          this.notifyProgress(task);
          continue;
        }

        // Download date
        await historyClient.downloadTicks(
          taskId,
          task.symbol,
          date,
          async (chunk) => {
            // Store chunk in IndexedDB
            await ticksDB.storeTicks(task.symbol, date, chunk.ticks);

            totalDownloaded += chunk.ticks.length;
            task.downloadedTicks = totalDownloaded;
          },
          (chunkProgress) => {
            // Calculate overall progress
            const dateProgress = (i + (chunkProgress / 100)) / dates.length;
            task.progress = dateProgress * 100;
            this.notifyProgress(task);
          }
        );
      }

      // Mark as completed
      task.status = 'completed';
      task.progress = 100;
      task.endTime = Date.now();
      this.notifyProgress(task);

    } catch (error) {
      task.status = 'failed';
      task.error = error instanceof Error ? error.message : 'Unknown error';
      this.notifyProgress(task);
      console.error('Download failed:', error);
    } finally {
      this.activeDownloads--;
      this.processQueue();
    }
  }

  /**
   * Pause a download task
   */
  pauseDownload(taskId: string) {
    const task = this.downloadTasks.get(taskId);
    if (task && task.status === 'downloading') {
      historyClient.cancelDownload(taskId);
      task.status = 'paused';
      this.notifyProgress(task);

      // Remove from queue if present
      const queueIndex = this.downloadQueue.indexOf(taskId);
      if (queueIndex > -1) {
        this.downloadQueue.splice(queueIndex, 1);
      }
    }
  }

  /**
   * Resume a paused download
   */
  resumeDownload(taskId: string) {
    const task = this.downloadTasks.get(taskId);
    if (task && task.status === 'paused') {
      task.status = 'pending';
      this.downloadQueue.push(taskId);
      this.processQueue();
    }
  }

  /**
   * Cancel a download task
   */
  cancelDownload(taskId: string) {
    const task = this.downloadTasks.get(taskId);
    if (task) {
      historyClient.cancelDownload(taskId);
      this.downloadTasks.delete(taskId);
      this.progressCallbacks.delete(taskId);

      // Remove from queue
      const queueIndex = this.downloadQueue.indexOf(taskId);
      if (queueIndex > -1) {
        this.downloadQueue.splice(queueIndex, 1);
      }
    }
  }

  /**
   * Get ticks from cache or download if missing
   */
  async getTicks(
    symbol: string,
    dateRange: DateRange,
    limit?: number
  ): Promise<TickData[]> {
    try {
      // Try to get from cache first
      const cachedTicks = await ticksDB.getTicks(symbol, dateRange, limit);

      if (cachedTicks.length > 0) {
        return cachedTicks;
      }

      // If not in cache, download from server
      const serverTicks = await historyClient.getTicksInRange(symbol, dateRange);

      // Cache the downloaded data
      const dates = this.getDatesBetween(dateRange.from, dateRange.to);
      for (const date of dates) {
        const dateTicks = serverTicks.filter(tick => {
          const tickDate = new Date(tick.timestamp).toISOString().split('T')[0];
          return tickDate === date;
        });

        if (dateTicks.length > 0) {
          await ticksDB.storeTicks(symbol, date, dateTicks);
        }
      }

      return limit ? serverTicks.slice(0, limit) : serverTicks;

    } catch (error) {
      console.error('Failed to get ticks:', error);
      return [];
    }
  }

  /**
   * Get storage statistics
   */
  async getStorageStats(): Promise<StorageStats> {
    return ticksDB.getStorageStats();
  }

  /**
   * Clear cached data for a symbol
   */
  async clearSymbol(symbol: string): Promise<void> {
    await ticksDB.clearSymbol(symbol);
  }

  /**
   * Clear all cached data
   */
  async clearAll(): Promise<void> {
    await ticksDB.clearAll();
  }

  /**
   * Get all download tasks
   */
  getDownloadTasks(): DownloadTask[] {
    return Array.from(this.downloadTasks.values());
  }

  /**
   * Get a specific download task
   */
  getDownloadTask(taskId: string): DownloadTask | undefined {
    return this.downloadTasks.get(taskId);
  }

  /**
   * Notify progress callback
   */
  private notifyProgress(task: DownloadTask) {
    const callback = this.progressCallbacks.get(task.id);
    if (callback) {
      callback(task);
    }
  }

  /**
   * Generate unique task ID
   */
  private generateTaskId(symbol: string, dateRange: DateRange): string {
    return `${symbol}-${dateRange.from}-${dateRange.to}-${Date.now()}`;
  }

  /**
   * Get dates between two dates
   */
  private getDatesBetween(from: string, to: string): string[] {
    const dates: string[] = [];
    const current = new Date(from);
    const end = new Date(to);

    while (current <= end) {
      dates.push(current.toISOString().split('T')[0]);
      current.setDate(current.getDate() + 1);
    }

    return dates;
  }
}

// Export singleton instance
export const historyDataManager = new HistoryDataManager();
