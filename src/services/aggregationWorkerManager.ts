/**
 * Web Worker Manager for OHLCV Aggregation
 * Offloads heavy computation to separate thread
 * PERFORMANCE FIX: Prevents 50-100ms UI blocking during aggregation
 */

import type { Tick, OHLCV } from '../store/useMarketDataStore';

interface WorkerMessage {
  type: 'aggregate' | 'aggregate-batch' | 'sma' | 'ema' | 'vwap' | 'indicators' | 'rsi' | 'bollinger' | 'macd';
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

export interface SymbolAggregationRequest {
  symbol: string;
  tickBuffer: Tick[];
}

export interface SymbolAggregationResult {
  symbol: string;
  results?: Record<string, OHLCV[]>;
  error?: string;
}

// Bound structured cloning and each result publication, including when a
// reconnect contains many symbols with full rolling tick buffers.
const MAX_AGGREGATION_BATCH_SYMBOLS = 64;
const MAX_AGGREGATION_BATCH_TICKS = 10_000;

class AggregationWorkerManager {
  private worker: Worker | null = null;
  private requestCallbacks: Map<string, AggregationCallback> = new Map();
  private requestId = 0;
  private aggregationRequestIds = new Set<string>();

  /**
   * Initialize the worker
   */
  initialize() {
    if (this.worker) return;

    try {
      // Create worker from separate file
      const worker = new Worker(
        new URL('../workers/aggregation.worker.ts', import.meta.url),
        { type: 'module' }
      );

      this.worker = worker;
      worker.onmessage = (event) => {
        if (this.worker === worker) this.handleWorkerMessage(event);
      };
      worker.onerror = (event) => {
        if (this.worker === worker) this.handleWorkerError(event);
      };

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
    // A broker/session reset may have cancelled this request while the worker
    // was still computing it. Those replies have no current owner.
    if (!callback) return;

    this.requestCallbacks.delete(requestId);
    this.aggregationRequestIds.delete(requestId);

    if (type === 'success' && result !== undefined) {
      callback(result);
    } else if (type === 'error') {
      console.error('[WorkerManager] Worker error:', error);
    }
  }

  /**
   * Handle worker errors
   */
  private handleWorkerError(error: ErrorEvent) {
    console.error('[WorkerManager] Worker error:', error);
    this.terminate();
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
    this.aggregationRequestIds.add(requestId);

    const message: WorkerMessage = {
      type: 'aggregate',
      data: {
        ticks,
        timeframeMs,
      } as AggregateRequest,
      requestId,
    };

    try {
      this.worker.postMessage(message);
    } catch (error) {
      this.requestCallbacks.delete(requestId);
      this.aggregationRequestIds.delete(requestId);
      throw error;
    }
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
    this.aggregateSymbols([{ symbol: ticks[0]?.symbol ?? '', tickBuffer: ticks }], timeframes, (rows) => {
      if (rows[0]?.results) callback(rows[0].results);
    });
  }

  /** One request/reply per bounded group, with all timeframes kept together. */
  aggregateSymbols(
    requests: readonly SymbolAggregationRequest[],
    timeframes: { name: string; ms: number }[],
    callback: (results: SymbolAggregationResult[]) => void,
  ): void {
    if (!this.worker) this.initialize();
    if (!this.worker) return;

    let batch: SymbolAggregationRequest[] = [];
    let tickCount = 0;
    const sendBatch = (requests: SymbolAggregationRequest[]) => {
      const requestId = `aggregate_batch_${++this.requestId}`;
      this.requestCallbacks.set(requestId, callback);
      this.aggregationRequestIds.add(requestId);
      try {
        this.worker!.postMessage({ type: 'aggregate-batch', data: { requests, timeframes }, requestId });
      } catch (error) {
        this.requestCallbacks.delete(requestId);
        this.aggregationRequestIds.delete(requestId);
        // A non-cloneable payload must not cost healthy symbols their candles.
        if (requests.length > 1) {
          const middle = Math.floor(requests.length / 2);
          sendBatch(requests.slice(0, middle));
          sendBatch(requests.slice(middle));
        } else {
          console.error('[WorkerManager] Aggregation request could not be sent:', error);
        }
      }
    };
    const send = () => {
      if (batch.length === 0) return;
      sendBatch(batch);
      batch = [];
      tickCount = 0;
    };
    for (const request of requests) {
      if (batch.length >= MAX_AGGREGATION_BATCH_SYMBOLS
        || (batch.length > 0 && tickCount + request.tickBuffer.length > MAX_AGGREGATION_BATCH_TICKS)) send();
      batch.push(request);
      tickCount += request.tickBuffer.length;
    }
    send();
  }

  cancelPendingAggregations(): void {
    this.aggregationRequestIds.forEach((requestId) => this.requestCallbacks.delete(requestId));
    this.aggregationRequestIds.clear();
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
      this.worker.onmessage = null;
      this.worker.onerror = null;
      this.worker.terminate();
      this.worker = null;
      console.log('[WorkerManager] Worker terminated');
    }
    this.requestCallbacks.clear();
    this.aggregationRequestIds.clear();
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

export const cancelPendingAggregations = (): void => {
  workerManager?.cancelPendingAggregations();
};
