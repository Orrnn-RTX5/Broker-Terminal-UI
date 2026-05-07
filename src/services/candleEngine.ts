/**
 * Candle Engine Service
 * Production-ready service for managing candle data aggregation
 * Encapsulates all candle logic: historical loading, tick processing, timeframe management
 */

import type { TickData } from '../types/history';
import { historyDataManager } from './historyDataManager';
import { chartDataService, type OHLCData, type Timeframe } from './chartDataService';

/**
 * Candle Engine Configuration
 */
export interface CandleEngineConfig {
  symbol: string;
  timeframe: Timeframe;
  maxHistoricalCandles?: number;
}

/**
 * Candle Engine Processing Result
 */
export interface CandleProcessingResult {
  candles: OHLCData[];
  isNewCandle: boolean;
  candleIndex: number; // Index in candles array
}

/**
 * Production-ready Candle Engine Service
 * Manages historical candle loading, tick processing, and multi-timeframe support
 */
export class CandleEngine {
  private historical: OHLCData[] = [];
  private forming: OHLCData | null = null;
  private symbol: string;
  private timeframe: Timeframe;
  private intervalMs: number;
  private lastProcessedTickTime: number = 0;
  private isInitialized: boolean = false;
  private maxHistoricalCandles: number;

  /**
   * Initialize Candle Engine
   * @param symbol Trading symbol (e.g., 'USDJPY')
   * @param timeframe Candle timeframe (1m, 5m, 15m, 30m, 1h, 4h, 1d)
   * @param maxHistoricalCandles Maximum historical candles to keep (default: 1000)
   */
  constructor(symbol: string, timeframe: Timeframe = '1m', maxHistoricalCandles: number = 1000) {
    if (!symbol || symbol.trim() === '') {
      throw new Error('Symbol cannot be empty');
    }

    this.symbol = symbol.toUpperCase();
    this.timeframe = timeframe;
    this.maxHistoricalCandles = maxHistoricalCandles;
    this.intervalMs = this.getIntervalMs(timeframe);
  }

  /**
   * Load historical candles from backend
   * Fetches tick data and aggregates into OHLC candles
   * @param limit Number of candles to load (default: 500)
   * @returns Array of historical OHLC candles
   */
  async loadHistorical(limit: number = 500): Promise<OHLCData[]> {
    try {
      // Calculate date range for historical data
      // Assuming we want roughly enough ticks to create the requested number of candles
      // With average tick frequency, we'll request a few days of data
      const now = new Date();
      const daysBack = Math.max(7, Math.ceil(limit / 1000)); // 7 days minimum
      const from = new Date(now.getTime() - daysBack * 24 * 60 * 60 * 1000);

      const dateRange = {
        from: from.toISOString().split('T')[0],
        to: now.toISOString().split('T')[0]
      };

      // Fetch tick data from backend
      const ticks = await historyDataManager.getTicks(this.symbol, dateRange, limit * 100);

      if (ticks.length === 0) {
        console.warn(`No historical data available for ${this.symbol}`);
        this.historical = [];
        this.isInitialized = true;
        return [];
      }

      // Aggregate ticks into OHLC candles
      const candles = chartDataService.aggregateToOHLC(ticks, this.timeframe);

      // Keep only the requested number of most recent candles
      this.historical = candles.length > limit
        ? candles.slice(-limit)
        : candles;

      this.isInitialized = true;
      return this.historical;

    } catch (error) {
      console.error(`Failed to load historical candles for ${this.symbol}:`, error);
      this.isInitialized = true;
      this.historical = [];
      throw error;
    }
  }

  /**
   * Process incoming tick and update forming candle
   * Handles tick aggregation into the current candle period
   * @param tick Incoming tick data
   * @returns Processing result with updated candles array and flags
   */
  processTick(tick: TickData): CandleProcessingResult {
    if (!this.isInitialized) {
      throw new Error('CandleEngine must be initialized with loadHistorical() before processing ticks');
    }

    // Validate tick
    if (!tick || tick.timestamp === undefined) {
      throw new Error('Invalid tick data');
    }

    const price = (tick.bid + tick.ask) / 2;
    const candleTime = Math.floor(tick.timestamp / this.intervalMs) * this.intervalMs;

    let isNewCandle = false;
    let candleIndex = 0;

    // Check if this tick belongs to a new candle
    if (this.forming === null || candleTime !== this.forming.time) {
      isNewCandle = true;

      // If we had a forming candle, add it to historical
      if (this.forming !== null) {
        this.historical.push(this.forming);

        // Trim historical to max size
        if (this.historical.length > this.maxHistoricalCandles) {
          this.historical = this.historical.slice(-this.maxHistoricalCandles);
        }
      }

      // Create new forming candle
      this.forming = {
        time: candleTime,
        open: price,
        high: price,
        low: price,
        close: price,
        volume: tick.volume || 0
      };

      candleIndex = this.historical.length;

    } else {
      // Update existing forming candle
      if (this.forming) {
        this.forming.high = Math.max(this.forming.high, price);
        this.forming.low = Math.min(this.forming.low, price);
        this.forming.close = price;
        this.forming.volume += tick.volume || 0;
      }

      candleIndex = this.historical.length;
    }

    this.lastProcessedTickTime = tick.timestamp;

    return {
      candles: this.getAllCandles(),
      isNewCandle,
      candleIndex
    };
  }

  /**
   * Get all candles (historical + forming)
   * Sorted chronologically
   * @returns Array of all available candles
   */
  getAllCandles(): OHLCData[] {
    const all = [...this.historical];

    if (this.forming !== null) {
      all.push(this.forming);
    }

    return all;
  }

  /**
   * Get historical candles only (closed candles)
   * @returns Array of historical OHLC candles
   */
  getHistoricalCandles(): OHLCData[] {
    return [...this.historical];
  }

  /**
   * Get the currently forming candle
   * @returns Current forming candle or null if none
   */
  getFormingCandle(): OHLCData | null {
    return this.forming ? { ...this.forming } : null;
  }

  /**
   * Get the last closed candle
   * @returns Last historical candle or null if none
   */
  getLastClosedCandle(): OHLCData | null {
    return this.historical.length > 0
      ? { ...this.historical[this.historical.length - 1] }
      : null;
  }

  /**
   * Get candle at specific index
   * @param index Candle index in the candles array
   * @returns OHLC candle or null if index out of range
   */
  getCandleAt(index: number): OHLCData | null {
    const all = this.getAllCandles();
    return index >= 0 && index < all.length ? { ...all[index] } : null;
  }

  /**
   * Get last N candles
   * @param count Number of candles to retrieve
   * @returns Array of last N candles
   */
  getLastCandles(count: number): OHLCData[] {
    const all = this.getAllCandles();
    const start = Math.max(0, all.length - count);
    return all.slice(start);
  }

  /**
   * Get candles in time range
   * @param from Start time (milliseconds)
   * @param to End time (milliseconds)
   * @returns Array of candles within time range
   */
  getCandlesInRange(from: number, to: number): OHLCData[] {
    return this.getAllCandles().filter(c => c.time >= from && c.time <= to);
  }

  /**
   * Change timeframe and reload candles
   * Resamples existing historical data to new timeframe
   * @param newTimeframe New timeframe to switch to
   * @returns Array of resampled candles
   */
  async changeTimeframe(newTimeframe: Timeframe): Promise<void> {
    if (newTimeframe === this.timeframe) {
      return; // No change needed
    }

    try {
      this.timeframe = newTimeframe;
      this.intervalMs = this.getIntervalMs(newTimeframe);

      if (this.historical.length === 0) {
        // If no historical data, try to reload
        await this.loadHistorical();
        return;
      }

      // Resample historical candles to new timeframe
      const resampled = chartDataService.resampleOHLC(this.historical, newTimeframe);
      this.historical = resampled;

      // Reset forming candle (will be created from next tick)
      this.forming = null;

    } catch (error) {
      console.error(`Failed to change timeframe to ${newTimeframe}:`, error);
      throw error;
    }
  }

  /**
   * Reset engine state
   * Clears all candles and forming state
   * Use when switching symbols or resetting analysis
   */
  reset(): void {
    this.historical = [];
    this.forming = null;
    this.lastProcessedTickTime = 0;
    this.isInitialized = false;
  }

  /**
   * Get engine statistics
   * @returns Object with engine metrics
   */
  getStats(): {
    symbol: string;
    timeframe: Timeframe;
    historicalCount: number;
    isForming: boolean;
    lastProcessedTime: number;
    intervalMs: number;
  } {
    return {
      symbol: this.symbol,
      timeframe: this.timeframe,
      historicalCount: this.historical.length,
      isForming: this.forming !== null,
      lastProcessedTime: this.lastProcessedTickTime,
      intervalMs: this.intervalMs
    };
  }

  /**
   * Get candles formatted for charting
   * Useful for direct integration with chart libraries
   * @returns Array of candles with high-low range
   */
  getChartData(): Array<OHLCData & { range: number }> {
    return this.getAllCandles().map(c => ({
      ...c,
      range: c.high - c.low
    }));
  }

  /**
   * Calculate interval in milliseconds for timeframe
   * Internal helper
   * @param timeframe Timeframe to convert
   * @returns Interval in milliseconds
   */
  private getIntervalMs(timeframe: Timeframe): number {
    const intervals: Record<Timeframe, number> = {
      '1m': 60 * 1000,
      '5m': 5 * 60 * 1000,
      '15m': 15 * 60 * 1000,
      '30m': 30 * 60 * 1000,
      '1h': 60 * 60 * 1000,
      '4h': 4 * 60 * 60 * 1000,
      '1d': 24 * 60 * 60 * 1000
    };

    const interval = intervals[timeframe];
    if (interval === undefined) {
      throw new Error(`Invalid timeframe: ${timeframe}`);
    }

    return interval;
  }

  /**
   * Validate that engine is properly initialized
   * @returns true if initialized and ready
   */
  isReady(): boolean {
    return this.isInitialized;
  }

  /**
   * Get symbol
   * @returns Current symbol
   */
  getSymbol(): string {
    return this.symbol;
  }

  /**
   * Get timeframe
   * @returns Current timeframe
   */
  getTimeframe(): Timeframe {
    return this.timeframe;
  }
}

/**
 * Factory function to create and initialize a CandleEngine
 * Usage: const engine = createCandleEngine('USDJPY', '1m');
 */
export async function createCandleEngine(
  symbol: string,
  timeframe: Timeframe = '1m',
  historicalLimit: number = 500
): Promise<CandleEngine> {
  const engine = new CandleEngine(symbol, timeframe);
  await engine.loadHistorical(historicalLimit);
  return engine;
}
