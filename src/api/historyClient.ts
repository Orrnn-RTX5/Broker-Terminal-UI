/**
 * Historical Data API Client
 * Handles fetching historical tick data from the backend
 */

import type { TickData, DateRange, SymbolDataInfo, DownloadChunk } from '../types/history';
import { API_BASE_URL } from '../config/api';

const CHUNK_SIZE = 5000; // Ticks per chunk
const MAX_RETRIES = 3;
const RETRY_DELAY = 1000; // ms

export class HistoryApiError extends Error {
  statusCode?: number;

  constructor(message: string, statusCode?: number) {
    super(message);
    this.name = 'HistoryApiError';
    this.statusCode = statusCode;
  }
}

export class HistoryClient {
  private abortControllers = new Map<string, AbortController>();

  /**
   * Fetch available symbols and their date ranges
   */
  async getAvailableData(): Promise<SymbolDataInfo[]> {
    const response = await this.fetchWithRetry(
      `${API_BASE_URL}/api/history/available`
    );

    if (!response.ok) {
      throw new HistoryApiError(
        `Failed to fetch available data: ${response.statusText}`,
        response.status
      );
    }

    return await response.json();
  }

  /**
   * Fetch symbol info
   */
  async getSymbolInfo(symbol: string): Promise<SymbolDataInfo> {
    const response = await this.fetchWithRetry(
      `${API_BASE_URL}/api/history/info?symbol=${encodeURIComponent(symbol)}`
    );

    if (!response.ok) {
      throw new HistoryApiError(
        `Failed to fetch symbol info: ${response.statusText}`,
        response.status
      );
    }

    return await response.json();
  }

  /**
   * Fetch ticks for a specific date
   */
  async getTicksByDate(
    symbol: string,
    date: string,
    offset = 0,
    limit = CHUNK_SIZE
  ): Promise<DownloadChunk> {
    const params = new URLSearchParams({
      symbol,
      date,
      offset: offset.toString(),
      limit: limit.toString()
    });

    const response = await this.fetchWithRetry(
      `${API_BASE_URL}/api/history/ticks?${params}`
    );

    if (!response.ok) {
      throw new HistoryApiError(
        `Failed to fetch ticks: ${response.statusText}`,
        response.status
      );
    }

    const data = await response.json();

    return {
      symbol,
      date,
      ticks: data.ticks || [],
      chunkIndex: Math.floor(offset / limit),
      totalChunks: Math.ceil((data.total || 0) / limit)
    };
  }

  /**
   * Fetch ticks in date range
   */
  async getTicksInRange(
    symbol: string,
    dateRange: DateRange,
    onProgress?: (progress: number) => void
  ): Promise<TickData[]> {
    const allTicks: TickData[] = [];
    const dates = this.getDatesBetween(dateRange.from, dateRange.to);

    for (let i = 0; i < dates.length; i++) {
      const date = dates[i];
      let offset = 0;
      let hasMore = true;

      while (hasMore) {
        const chunk = await this.getTicksByDate(symbol, date, offset, CHUNK_SIZE);
        allTicks.push(...chunk.ticks);

        offset += CHUNK_SIZE;
        hasMore = chunk.chunkIndex < chunk.totalChunks - 1;

        if (onProgress) {
          const progress = ((i + (offset / (chunk.totalChunks * CHUNK_SIZE))) / dates.length) * 100;
          onProgress(Math.min(progress, 100));
        }
      }
    }

    return allTicks;
  }

  /**
   * Stream download with cancellation support
   */
  async downloadTicks(
    taskId: string,
    symbol: string,
    date: string,
    onChunk: (chunk: DownloadChunk) => void,
    onProgress?: (progress: number) => void
  ): Promise<void> {
    // Create abort controller for this download
    const controller = new AbortController();
    this.abortControllers.set(taskId, controller);

    try {
      let offset = 0;
      let totalChunks = 1;
      let currentChunk = 0;

      while (currentChunk < totalChunks) {
        // Check if cancelled
        if (controller.signal.aborted) {
          throw new Error('Download cancelled');
        }

        const chunk = await this.getTicksByDate(symbol, date, offset, CHUNK_SIZE);

        totalChunks = chunk.totalChunks;
        currentChunk = chunk.chunkIndex;

        onChunk(chunk);

        if (onProgress) {
          const progress = ((currentChunk + 1) / totalChunks) * 100;
          onProgress(Math.min(progress, 100));
        }

        offset += CHUNK_SIZE;
      }
    } finally {
      this.abortControllers.delete(taskId);
    }
  }

  /**
   * Cancel a download task
   */
  cancelDownload(taskId: string): void {
    const controller = this.abortControllers.get(taskId);
    if (controller) {
      controller.abort();
      this.abortControllers.delete(taskId);
    }
  }

  /**
   * Verify data integrity
   */
  async verifyData(symbol: string, date: string, checksum?: string): Promise<boolean> {
    const params = new URLSearchParams({
      symbol,
      date,
      ...(checksum && { checksum })
    });

    const response = await this.fetchWithRetry(
      `${API_BASE_URL}/api/history/verify?${params}`
    );

    if (!response.ok) {
      throw new HistoryApiError(
        `Failed to verify data: ${response.statusText}`,
        response.status
      );
    }

    const result = await response.json();
    return result.valid === true;
  }

  /**
   * Get total tick count for a date
   */
  async getTickCount(symbol: string, date: string): Promise<number> {
    const params = new URLSearchParams({ symbol, date });

    const response = await this.fetchWithRetry(
      `${API_BASE_URL}/api/history/count?${params}`
    );

    if (!response.ok) {
      throw new HistoryApiError(
        `Failed to get tick count: ${response.statusText}`,
        response.status
      );
    }

    const result = await response.json();
    return result.count || 0;
  }

  /**
   * Fetch with retry logic
   */
  private async fetchWithRetry(
    url: string,
    options: RequestInit = {},
    retries = MAX_RETRIES
  ): Promise<Response> {
    let lastError: Error | null = null;

    for (let i = 0; i < retries; i++) {
      try {
        const token = localStorage.getItem('auth_token');
        const response = await fetch(url, {
          ...options,
          headers: {
            'Content-Type': 'application/json',
            ...(token ? { 'Authorization': `Bearer ${token}` } : {}),
            ...options.headers
          }
        });

        // Don't retry on client errors (4xx)
        if (response.status >= 400 && response.status < 500) {
          return response;
        }

        // Retry on server errors (5xx) or network errors
        if (response.ok || i === retries - 1) {
          return response;
        }

        lastError = new Error(`Server error: ${response.status}`);
      } catch (error) {
        lastError = error as Error;

        // Don't retry if aborted
        if (error instanceof Error && error.name === 'AbortError') {
          throw error;
        }
      }

      // Wait before retrying (exponential backoff)
      if (i < retries - 1) {
        await this.delay(RETRY_DELAY * Math.pow(2, i));
      }
    }

    throw lastError || new Error('Failed to fetch after retries');
  }

  /**
   * Utility: Get dates between two dates
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

  /**
   * Utility: Delay helper
   */
  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

// Export singleton instance
export const historyClient = new HistoryClient();
