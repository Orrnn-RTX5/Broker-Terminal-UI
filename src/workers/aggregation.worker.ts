/**
 * Web Worker for Heavy Data Aggregation
 * - OHLCV calculations
 * - Moving averages (SMA, EMA)
 * - VWAP calculations
 * - Technical indicators
 * Runs in separate thread to avoid blocking UI
 */

export interface Tick {
  symbol: string;
  bid: number;
  ask: number;
  timestamp: number;
  volume?: number;
}

export interface OHLCV {
  timestamp: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface WorkerMessage {
  type: 'aggregate' | 'sma' | 'ema' | 'vwap' | 'indicators';
  data: unknown;
  requestId: string;
}

export interface AggregateRequest {
  ticks: Tick[];
  timeframeMs: number;
}

export interface MovingAverageRequest {
  prices: number[];
  period: number;
  prevValue?: number;
}

export interface VWAPRequest {
  ticks: Tick[];
}

export interface IndicatorsRequest {
  ohlcv: OHLCV[];
  indicators: string[];
}

// ============================================
// Aggregation Functions
// ============================================

function aggregateOHLCV(ticks: Tick[], timeframeMs: number): OHLCV[] {
  if (ticks.length === 0) return [];

  const ohlcvMap = new Map<number, OHLCV>();

  ticks.forEach((tick) => {
    const bucketTime = Math.floor(tick.timestamp / timeframeMs) * timeframeMs;
    const midPrice = (tick.bid + tick.ask) / 2;
    const volume = tick.volume || 1;

    if (!ohlcvMap.has(bucketTime)) {
      ohlcvMap.set(bucketTime, {
        timestamp: bucketTime,
        open: midPrice,
        high: midPrice,
        low: midPrice,
        close: midPrice,
        volume: volume,
      });
    } else {
      const ohlcv = ohlcvMap.get(bucketTime)!;
      ohlcv.high = Math.max(ohlcv.high, midPrice);
      ohlcv.low = Math.min(ohlcv.low, midPrice);
      ohlcv.close = midPrice;
      ohlcv.volume += volume;
    }
  });

  return Array.from(ohlcvMap.values()).sort((a, b) => a.timestamp - b.timestamp);
}

function calculateSMA(prices: number[], period: number): number[] {
  const result: number[] = [];

  for (let i = 0; i < prices.length; i++) {
    if (i < period - 1) {
      result.push(NaN);
      continue;
    }

    const slice = prices.slice(i - period + 1, i + 1);
    const sum = slice.reduce((acc, price) => acc + price, 0);
    result.push(sum / period);
  }

  return result;
}

function calculateEMA(prices: number[], period: number, prevEMA?: number): number[] {
  const result: number[] = [];
  const multiplier = 2 / (period + 1);

  for (let i = 0; i < prices.length; i++) {
    if (i < period - 1) {
      result.push(NaN);
      continue;
    }

    if (i === period - 1) {
      // Use SMA for first EMA value
      const slice = prices.slice(0, i + 1);
      const sum = slice.reduce((acc, price) => acc + price, 0);
      result.push(sum / period);
    } else {
      const prevValue = result[i - 1] || prevEMA || prices[i];
      const ema = (prices[i] - prevValue) * multiplier + prevValue;
      result.push(ema);
    }
  }

  return result;
}

function calculateVWAP(ticks: Tick[]): number {
  if (ticks.length === 0) return 0;

  let totalVolume = 0;
  let totalValue = 0;

  ticks.forEach((tick) => {
    const price = (tick.bid + tick.ask) / 2;
    const volume = tick.volume || 1;
    totalValue += price * volume;
    totalVolume += volume;
  });

  return totalVolume > 0 ? totalValue / totalVolume : 0;
}

function calculateRSI(prices: number[], period = 14): number[] {
  const result: number[] = [];
  const gains: number[] = [];
  const losses: number[] = [];

  for (let i = 1; i < prices.length; i++) {
    const change = prices[i] - prices[i - 1];
    gains.push(change > 0 ? change : 0);
    losses.push(change < 0 ? Math.abs(change) : 0);
  }

  for (let i = 0; i < gains.length; i++) {
    if (i < period - 1) {
      result.push(NaN);
      continue;
    }

    const avgGain = gains.slice(i - period + 1, i + 1).reduce((a, b) => a + b, 0) / period;
    const avgLoss = losses.slice(i - period + 1, i + 1).reduce((a, b) => a + b, 0) / period;

    if (avgLoss === 0) {
      result.push(100);
    } else {
      const rs = avgGain / avgLoss;
      const rsi = 100 - 100 / (1 + rs);
      result.push(rsi);
    }
  }

  return [NaN, ...result]; // Prepend NaN for first price (no change)
}

function calculateBollingerBands(
  prices: number[],
  period = 20,
  stdDev = 2
): { upper: number[]; middle: number[]; lower: number[] } {
  const middle = calculateSMA(prices, period);
  const upper: number[] = [];
  const lower: number[] = [];

  for (let i = 0; i < prices.length; i++) {
    if (i < period - 1) {
      upper.push(NaN);
      lower.push(NaN);
      continue;
    }

    const slice = prices.slice(i - period + 1, i + 1);
    const mean = middle[i];
    const variance = slice.reduce((acc, price) => acc + Math.pow(price - mean, 2), 0) / period;
    const std = Math.sqrt(variance);

    upper.push(mean + stdDev * std);
    lower.push(mean - stdDev * std);
  }

  return { upper, middle, lower };
}

function calculateMACD(
  prices: number[],
  fastPeriod = 12,
  slowPeriod = 26,
  signalPeriod = 9
): { macd: number[]; signal: number[]; histogram: number[] } {
  const fastEMA = calculateEMA(prices, fastPeriod);
  const slowEMA = calculateEMA(prices, slowPeriod);

  const macd = fastEMA.map((fast, i) => fast - slowEMA[i]);
  const signal = calculateEMA(macd.filter((v) => !isNaN(v)), signalPeriod);

  // Pad signal array to match macd length
  const signalPadded = [...Array(macd.length - signal.length).fill(NaN), ...signal];

  const histogram = macd.map((m, i) => m - signalPadded[i]);

  return { macd, signal: signalPadded, histogram };
}

function calculateIndicators(ohlcv: OHLCV[], indicators: string[]): Record<string, unknown> {
  const closePrices = ohlcv.map((candle) => candle.close);


  const result: Record<string, unknown> = {};

  indicators.forEach((indicator) => {
    switch (indicator) {
      case 'sma20':
        result.sma20 = calculateSMA(closePrices, 20);
        break;
      case 'sma50':
        result.sma50 = calculateSMA(closePrices, 50);
        break;
      case 'sma200':
        result.sma200 = calculateSMA(closePrices, 200);
        break;
      case 'ema20':
        result.ema20 = calculateEMA(closePrices, 20);
        break;
      case 'ema50':
        result.ema50 = calculateEMA(closePrices, 50);
        break;
      case 'rsi':
        result.rsi = calculateRSI(closePrices);
        break;
      case 'bollinger':
        result.bollinger = calculateBollingerBands(closePrices);
        break;
      case 'macd':
        result.macd = calculateMACD(closePrices);
        break;
    }
  });

  return result;
}

// ============================================
// Message Handler
// ============================================

self.onmessage = (event: MessageEvent<WorkerMessage>) => {
  const { type, data, requestId } = event.data;

  try {
    let result: unknown;

    switch (type) {
      case 'aggregate': {
        const { ticks, timeframeMs } = data as AggregateRequest;
        result = aggregateOHLCV(ticks, timeframeMs);
        break;
      }

      case 'sma': {
        const { prices, period } = data as MovingAverageRequest;
        result = calculateSMA(prices, period);
        break;
      }

      case 'ema': {
        const { prices, period, prevValue } = data as MovingAverageRequest;
        result = calculateEMA(prices, period, prevValue);
        break;
      }

      case 'vwap': {
        const { ticks } = data as VWAPRequest;
        result = calculateVWAP(ticks);
        break;
      }

      case 'indicators': {
        const { ohlcv, indicators } = data as IndicatorsRequest;
        result = calculateIndicators(ohlcv, indicators);
        break;
      }

      default:
        throw new Error(`Unknown message type: ${type}`);
    }

    self.postMessage({
      type: 'success',
      requestId,
      result,
    });
  } catch (error) {
    self.postMessage({
      type: 'error',
      requestId,
      error: error instanceof Error ? error.message : 'Unknown error',
    });
  }
};

// Export for TypeScript types
export { };
