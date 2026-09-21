/**
 * Historical Data API Client
 * Handles fetching historical tick data from the backend
 */

import type { TickData, DateRange, SymbolDataInfo, DownloadChunk } from '../types/history';
import type { HistoryCandle, HistoryCandleParams, HistoryTickParams, Timeframe } from '../types/api';
import { historyV2Api, marketV2Api } from './trade';

const CHUNK_SIZE = 10000; // Swagger history/v2 max ticks per request
const UNSUPPORTED_DOWNLOADER_METADATA_STATUS = 501;

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
   * Fetch symbols that can be used with the Swagger history/v2 endpoints.
   * The contract has no downloader metadata/date-range endpoint, so date
   * availability is intentionally left to the user's selected range and local cache.
   */
  async getAvailableData(): Promise<SymbolDataInfo[]> {
    try {
      const instruments = await marketV2Api.getInstruments();

      return instruments
        .filter(instrument => instrument.enabled !== false)
        .map(instrument => ({
          symbol: instrument.symbol,
          availableDates: [],
          totalTicks: 0,
          firstDate: '',
          lastDate: '',
          downloadedDates: [],
          downloadProgress: 0
        }))
        .sort((a, b) => a.symbol.localeCompare(b.symbol));
    } catch (error) {
      throw this.toHistoryApiError(error, 'Failed to fetch instruments for history downloader');
    }
  }

  /**
   * Fetch symbol info
   */
  async getSymbolInfo(symbol: string): Promise<SymbolDataInfo> {
    const symbolInfo = (await this.getAvailableData()).find(item => item.symbol === symbol);

    if (symbolInfo) {
      return symbolInfo;
    }

    return {
      symbol,
      availableDates: [],
      totalTicks: 0,
      firstDate: '',
      lastDate: '',
      downloadedDates: [],
      downloadProgress: 0
    };
  }

  /**
   * Fetch historical candles through the Swagger history/v2 API.
   */
  async getCandles(
    symbol: string,
    params?: HistoryCandleParams
  ): Promise<HistoryCandle[]> {
    try {
      return await historyV2Api.getCandles(symbol, params);
    } catch (error) {
      throw this.toHistoryApiError(error, 'Failed to fetch candles');
    }
  }

  /**
   * Fetch the latest historical candle through the Swagger history/v2 API.
   */
  async getLatestCandle(symbol: string, tf?: Timeframe): Promise<HistoryCandle> {
    try {
      return await historyV2Api.getLatestCandle(symbol, tf);
    } catch (error) {
      throw this.toHistoryApiError(error, 'Failed to fetch latest candle');
    }
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
    const chunkIndex = Math.floor(offset / limit);

    if (offset > 0) {
      return {
        symbol,
        date,
        ticks: [],
        chunkIndex,
        totalChunks: 1
      };
    }

    const params: HistoryTickParams = {
      ...this.getUnixDayRange(date),
      limit: Math.min(limit, CHUNK_SIZE)
    };

    try {
      const ticks = await historyV2Api.getTicks(symbol, params);

      return {
        symbol,
        date,
        ticks: ticks.map(tick => this.toTickData(tick, symbol)),
        chunkIndex,
        totalChunks: 1
      };
    } catch (error) {
      throw this.toHistoryApiError(error, 'Failed to fetch ticks');
    }
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
      let currentChunk = 0;

      while (currentChunk < 1) {
        // Check if cancelled
        if (controller.signal.aborted) {
          throw new Error('Download cancelled');
        }

        const chunk = await this.getTicksByDate(symbol, date, offset, CHUNK_SIZE);

        currentChunk = chunk.chunkIndex;

        onChunk(chunk);

        if (onProgress) {
          const progress = ((currentChunk + 1) / chunk.totalChunks) * 100;
          onProgress(Math.min(progress, 100));
        }

        offset += CHUNK_SIZE;
        currentChunk += 1;
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
    throw this.unsupportedDownloaderMetadata(
      `tick integrity verification for ${symbol} on ${date}${checksum ? ' with checksum' : ''}`
    );
  }

  /**
   * Get total tick count for a date
   */
  async getTickCount(symbol: string, date: string): Promise<number> {
    throw this.unsupportedDownloaderMetadata(`tick count metadata for ${symbol} on ${date}`);
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
   * Utility: Convert date-only download requests to Swagger history tick params.
   */
  private getUnixDayRange(date: string): Pick<HistoryTickParams, 'from' | 'to'> {
    const start = new Date(`${date}T00:00:00.000Z`);

    if (Number.isNaN(start.getTime())) {
      throw new HistoryApiError(`Invalid history date: ${date}`, 400);
    }

    const from = Math.floor(start.getTime() / 1000);
    return {
      from,
      to: from + 86400 - 1
    };
  }

  /**
   * Utility: Normalize Swagger history ticks to the downloader cache shape.
   */
  private toTickData(tick: { symbol?: string; bid: number; ask: number; time: number }, fallbackSymbol: string): TickData {
    return {
      symbol: tick.symbol || fallbackSymbol,
      bid: tick.bid,
      ask: tick.ask,
      timestamp: this.toEpochMilliseconds(tick.time)
    };
  }

  private toEpochMilliseconds(timestamp: number): number {
    return Math.abs(timestamp) < 1_000_000_000_000
      ? timestamp * 1000
      : timestamp;
  }

  /**
   * Downloader/admin metadata endpoints are intentionally outside the S0 trade API contract.
   */
  private unsupportedDownloaderMetadata(operation: string): HistoryApiError {
    return new HistoryApiError(
      `Unsupported history downloader metadata request (${operation}); no Swagger history/v2 trade endpoint is available.`,
      UNSUPPORTED_DOWNLOADER_METADATA_STATUS
    );
  }

  private toHistoryApiError(error: unknown, fallbackMessage: string): HistoryApiError {
    if (error instanceof HistoryApiError) {
      return error;
    }

    const statusCode = typeof error === 'object' && error !== null && 'status' in error
      ? Number((error as { status?: number }).status)
      : undefined;

    const message = error instanceof Error ? error.message : fallbackMessage;
    return new HistoryApiError(message || fallbackMessage, Number.isNaN(statusCode) ? undefined : statusCode);
  }
}

// Export singleton instance
export const historyClient = new HistoryClient();
