/**
 * Chart Data Service
 * Manages aggregation of tick data into OHLC candles
 */

import type { TickData } from '../types/history';

export type OHLCData = {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
};

export type Timeframe = '1m' | '5m' | '15m' | '30m' | '1h' | '4h' | '1d';

export class ChartDataService {
  /**
   * Aggregate tick data into OHLC candles
   */
  aggregateToOHLC(ticks: TickData[], timeframe: Timeframe): OHLCData[] {
    if (ticks.length === 0) return [];

    const intervalMs = this.getIntervalMs(timeframe);
    const candles = new Map<number, OHLCData>();

    // Sort ticks by timestamp
    const sortedTicks = [...ticks].sort((a, b) => a.timestamp - b.timestamp);

    for (const tick of sortedTicks) {
      // Calculate candle time (floor to interval)
      const candleTime = Math.floor(tick.timestamp / intervalMs) * intervalMs;

      // Get mid price
      const price = (tick.bid + tick.ask) / 2;

      if (!candles.has(candleTime)) {
        // Create new candle
        candles.set(candleTime, {
          time: candleTime,
          open: price,
          high: price,
          low: price,
          close: price,
          volume: tick.volume || 0
        });
      } else {
        // Update existing candle
        const candle = candles.get(candleTime)!;
        candle.high = Math.max(candle.high, price);
        candle.low = Math.min(candle.low, price);
        candle.close = price;
        candle.volume += tick.volume || 0;
      }
    }

    // Convert to array and sort
    return Array.from(candles.values()).sort((a, b) => a.time - b.time);
  }

  /**
   * Calculate Heikin-Ashi candles from OHLC data
   */
  calculateHeikinAshi(ohlc: OHLCData[]): OHLCData[] {
    if (ohlc.length === 0) return [];

    const haCandles: OHLCData[] = [];
    let prevHA: OHLCData | null = null;

    for (const candle of ohlc) {
      const haClose = (candle.open + candle.high + candle.low + candle.close) / 4;

      const haOpen = prevHA
        ? (prevHA.open + prevHA.close) / 2
        : (candle.open + candle.close) / 2;

      const haHigh = Math.max(candle.high, haOpen, haClose);
      const haLow = Math.min(candle.low, haOpen, haClose);

      const haCandle: OHLCData = {
        time: candle.time,
        open: haOpen,
        high: haHigh,
        low: haLow,
        close: haClose,
        volume: candle.volume
      };

      haCandles.push(haCandle);
      prevHA = haCandle;
    }

    return haCandles;
  }

  /**
   * Resample OHLC data to a different timeframe
   */
  resampleOHLC(ohlc: OHLCData[], targetTimeframe: Timeframe): OHLCData[] {
    if (ohlc.length === 0) return [];

    const intervalMs = this.getIntervalMs(targetTimeframe);
    const resampled = new Map<number, OHLCData>();

    for (const candle of ohlc) {
      const targetTime = Math.floor(candle.time / intervalMs) * intervalMs;

      if (!resampled.has(targetTime)) {
        resampled.set(targetTime, {
          time: targetTime,
          open: candle.open,
          high: candle.high,
          low: candle.low,
          close: candle.close,
          volume: candle.volume
        });
      } else {
        const existing = resampled.get(targetTime)!;
        existing.high = Math.max(existing.high, candle.high);
        existing.low = Math.min(existing.low, candle.low);
        existing.close = candle.close;
        existing.volume += candle.volume;
      }
    }

    return Array.from(resampled.values()).sort((a, b) => a.time - b.time);
  }

  /**
   * Merge historical and live data
   */
  mergeHistoricalAndLive(historical: TickData[], live: TickData[]): TickData[] {
    if (historical.length === 0) return live;
    if (live.length === 0) return historical;

    // Get last historical timestamp
    const lastHistoricalTime = Math.max(...historical.map(t => t.timestamp));

    // Filter live data to only include ticks after historical data
    const newLiveTicks = live.filter(t => t.timestamp > lastHistoricalTime);

    // Merge and sort
    return [...historical, ...newLiveTicks].sort((a, b) => a.timestamp - b.timestamp);
  }

  /**
   * Get interval in milliseconds for timeframe
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

    return intervals[timeframe];
  }
}

// Export singleton instance
export const chartDataService = new ChartDataService();
