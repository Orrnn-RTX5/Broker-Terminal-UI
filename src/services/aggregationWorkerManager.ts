/**
 * Web Worker Manager for OHLCV Aggregation
 * Offloads heavy computation to separate thread
 * PERFORMANCE FIX: Prevents 50-100ms UI blocking during aggregation
 */

import type { Tick, OHLCV } from '../store/useMarketDataStore';

interface WorkerMessage {
  type: 'aggregate' | 'sma' | 'ema' | 'vwap' | 'indicators' | 'rsi' | 'bollinger' | 'macd';
  data: unknown;
  requestId: string;
}

interface WorkerResponse {
  type: 'success' | 'error';
  requestId: string;
  result?: unknown;
  error?: string;
}

interface AggregateRequest {
  ticks: Tick[];
  timeframeMs: number;
}

type AggregationCallback = (result: any) => void;

class AggregationWorkerManager {
  private worker: Worker | null = null;
  private requestCallbacks: Map<string, AggregationCallback> = new Map();
  private requestId = 0;

  /**
   * Initialize the worker
   */
  initialize() {
    if (this.worker) return;

    try {
      // Create worker from separate file
      this.worker = new Worker(
        new URL('../workers/aggregation.worker.ts', import.meta.url),
        { type: 'module' }
      );

      this.worker.onmessage = this.handleWorkerMessage.bind(this);
      this.worker.onerror = this.handleWorkerError.bind(this);

      console.log('[WorkerManager] Aggregation worker initialized');
    } catch (error) {
      console.error('[WorkerManager] Failed to initialize worker:', error);
    }
  }

  /**
   * Handle messages from worker
   */
  private handleWorkerMessage(event: MessageEvent<WorkerResponse>) {
    const { type, requestId, result, error } = event.data;

    const callback = this.requestCallbacks.get(requestId);
    if (!callback) {
      console.warn('[WorkerManager] No callback found for request:', requestId);
      return;
    }

    if (type === 'success' && result !== undefined) {
      callback(result);
    } else if (type === 'error') {
      console.error('[WorkerManager] Worker error:', error);
    }

    // Clean up callback
    this.requestCallbacks.delete(requestId);
  }

  /**
   * Handle worker errors
   */
  private handleWorkerError(error: ErrorEvent) {
    console.error('[WorkerManager] Worker error:', error);
  }

  /**
   * Aggregate ticks to OHLCV in worker thread
   * @param ticks - Array of ticks to aggregate
   * @param timeframeMs - Timeframe in milliseconds
   * @param callback - Callback with aggregated OHLCV
   */
  aggregateOHLCV(
    ticks: Tick[],
    timeframeMs: number,
    callback: AggregationCallback
  ): void {
    if (!this.worker) {
      console.error('[WorkerManager] Worker not initialized');
      return;
    }

    const requestId = `aggregate_${++this.requestId}`;
    this.requestCallbacks.set(requestId, callback);

    const message: WorkerMessage = {
      type: 'aggregate',
      data: {
        ticks,
        timeframeMs,
      } as AggregateRequest,
      requestId,
    };

    this.worker.postMessage(message);
  }

  /**
   * Aggregate multiple timeframes in parallel
   * PERFORMANCE: Single worker call for all timeframes
   */
  aggregateMultipleTimeframes(
    ticks: Tick[],
    timeframes: { name: string; ms: number }[],
    callback: (results: Record<string, OHLCV[]>) => void
  ): void {
    if (!this.worker) {
      console.error('[WorkerManager] Worker not initialized');
      return;
    }

    const results: Record<string, OHLCV[]> = {};
    let completedCount = 0;

    timeframes.forEach((tf) => {
      this.aggregateOHLCV(ticks, tf.ms, (ohlcv) => {
        results[tf.name] = ohlcv;
        completedCount++;

        // Call callback when all timeframes are done
        if (completedCount === timeframes.length) {
          callback(results);
        }
      });
    });
  }

  /**
   * Calculate SMA in worker thread
   */
  calculateSMA(
    prices: number[],
    period: number,
    callback: (sma: number[]) => void
  ): void {
    if (!this.worker) this.initialize();
    if (!this.worker) return;

    const requestId = `sma_${++this.requestId}`;
    this.requestCallbacks.set(requestId, callback);

    this.worker.postMessage({
      type: 'sma',
      data: { prices, period },
      requestId,
    });
  }

  /**
   * Calculate EMA in worker thread
   */
  calculateEMA(
    prices: number[],
    period: number,
    prevValue?: number | ((ema: number[]) => void),
    callback?: (ema: number[]) => void
  ): void {
    const realCallback = typeof prevValue === 'function' ? (prevValue as any) : callback;
    const realPrevVal = typeof prevValue === 'number' ? prevValue : undefined;

    if (!this.worker) this.initialize();
    if (!this.worker) return;

    const requestId = `ema_${++this.requestId}`;
    this.requestCallbacks.set(requestId, realCallback);

    this.worker.postMessage({
      type: 'ema',
      data: { prices, period, prevValue: realPrevVal },
      requestId,
    });
  }

  /**
   * Calculate RSI in worker thread
   */
  calculateRSI(
    prices: number[],
    period: number,
    callback: (rsi: number[]) => void
  ): void {
    if (!this.worker) this.initialize();
    if (!this.worker) return;

    const requestId = `rsi_${++this.requestId}`;
    this.requestCallbacks.set(requestId, callback);

    this.worker.postMessage({
      type: 'rsi',
      data: { prices, period },
      requestId,
    });
  }

  /**
   * Calculate Bollinger Bands in worker thread
   */
  calculateBollinger(
    prices: number[],
    period: number,
    stdDev: number,
    callback: (res: { upper: number[]; middle: number[]; lower: number[] }) => void
  ): void {
    if (!this.worker) this.initialize();
    if (!this.worker) return;

    const requestId = `bollinger_${++this.requestId}`;
    this.requestCallbacks.set(requestId, callback);

    this.worker.postMessage({
      type: 'bollinger',
      data: { prices, period, stdDev },
      requestId,
    });
  }

  /**
   * Calculate MACD in worker thread
   */
  calculateMACD(
    prices: number[],
    fastPeriod: number,
    slowPeriod: number,
    signalPeriod: number,
    callback: (res: { macd: number[]; signal: number[]; histogram: number[] }) => void
  ): void {
    if (!this.worker) this.initialize();
    if (!this.worker) return;

    const requestId = `macd_${++this.requestId}`;
    this.requestCallbacks.set(requestId, callback);

    this.worker.postMessage({
      type: 'macd',
      data: { prices, fastPeriod, slowPeriod, signalPeriod },
      requestId,
    });
  }

  /**
   * Terminate the worker
   */
  terminate() {
    if (this.worker) {
      this.worker.terminate();
      this.worker = null;
      this.requestCallbacks.clear();
      console.log('[WorkerManager] Worker terminated');
    }
  }
}

// Singleton instance
let workerManager: AggregationWorkerManager | null = null;

export const getWorkerManager = (): AggregationWorkerManager => {
  if (!workerManager) {
    workerManager = new AggregationWorkerManager();
    workerManager.initialize();
  }
  return workerManager;
};

export const terminateWorker = () => {
  if (workerManager) {
    workerManager.terminate();
    workerManager = null;
  }
};
