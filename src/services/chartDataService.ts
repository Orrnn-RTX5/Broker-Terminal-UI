/**
 * Chart Data Service
 * Manages aggregation of tick data into OHLC candles
 */

import type { TickData } from '../types/history';
import {
  API_V2_BASE_URL,
  RTX5_API_URL,
  RTX5_WS_URL,
  toLocalDevProxyUrl,
} from '../config/api';
import {
  buildBrokerApiV2,
  buildBrokerWsV2Uri,
} from './brokerSession';

export type OHLCData = {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  tickVolume?: number;
  realVolume?: number;
};

export type Timeframe = '1m' | '5m' | '15m' | '30m' | '1h' | '4h' | '1d';
export type ApiTimeframe = 'M1' | 'M5' | 'M15' | 'M30' | 'H1' | 'H4' | 'D1' | 'W1' | 'MN';

export interface FetchCandlesOptions {
  symbol: string;
  timeframe: string;
  count?: number;
  from?: number;
  to?: number;
  signal?: AbortSignal;
}

export interface CandleStreamOptions {
  symbol: string;
  timeframe: string;
  onSnapshot?: (candles: OHLCData[]) => void;
  onCandle?: (candle: OHLCData) => void;
  onError?: (error: Error) => void;
}

export interface CandleStreamSubscription {
  close: () => void;
}

const TIMEFRAME_ALIASES: Record<string, ApiTimeframe> = {
  '1M': 'M1',
  '1MIN': 'M1',
  'M1': 'M1',
  '1': 'M1',
  '5M': 'M5',
  '5MIN': 'M5',
  'M5': 'M5',
  '5': 'M5',
  '15M': 'M15',
  '15MIN': 'M15',
  'M15': 'M15',
  '15': 'M15',
  '30M': 'M30',
  '30MIN': 'M30',
  'M30': 'M30',
  '30': 'M30',
  '1H': 'H1',
  'H1': 'H1',
  '60': 'H1',
  '4H': 'H4',
  'H4': 'H4',
  '1D': 'D1',
  'D1': 'D1',
  '1W': 'W1',
  'W1': 'W1',
  'MN': 'MN',
  '1MO': 'MN',
};

const API_TIMEFRAME_SECONDS: Record<Exclude<ApiTimeframe, 'MN'>, number> = {
  M1: 60,
  M5: 5 * 60,
  M15: 15 * 60,
  M30: 30 * 60,
  H1: 60 * 60,
  H4: 4 * 60 * 60,
  D1: 24 * 60 * 60,
  W1: 7 * 24 * 60 * 60,
};

const normalizeTimeForApiTimeframe = (time: number, timeframe?: ApiTimeframe): number => {
  if (!time || !timeframe) return time;
  if (timeframe === 'MN') {
    const date = new Date(time * 1000);
    return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1) / 1000;
  }
  if (timeframe === 'W1') {
    const date = new Date(time * 1000);
    const daysSinceMonday = (date.getUTCDay() + 6) % 7;
    return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate() - daysSinceMonday) / 1000;
  }

  const intervalSeconds = API_TIMEFRAME_SECONDS[timeframe];
  return Math.floor(time / intervalSeconds) * intervalSeconds;
};

const runtimeApiV2BaseUrl = (): string => {
  const brokerBase = toLocalDevProxyUrl(buildBrokerApiV2()).replace(/\/$/, '');
  if (brokerBase) return brokerBase;
  const apiV2Base = API_V2_BASE_URL.replace(/\/$/, '');
  if (apiV2Base) return apiV2Base;
  const configBase = RTX5_API_URL.replace(/\/$/, '');
  return configBase ? `${configBase}/api/v2` : '';
};

const getAuthToken = (): string | null => {
  if (typeof window === 'undefined') return null;
  return localStorage.getItem('auth_token');
};

const buildQuery = (params: Record<string, string | number | undefined>): string => {
  const search = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== null) search.set(key, String(value));
  });
  const qs = search.toString();
  return qs ? `?${qs}` : '';
};

const normalizeSymbol = (symbol: string): string =>
  symbol.replace(/[^a-zA-Z0-9]/g, '').toUpperCase();

const toSeconds = (value: unknown): number => {
  const raw = typeof value === 'string' && Number.isNaN(Number(value))
    ? new Date(value).getTime() / 1000
    : Number(value);
  if (!Number.isFinite(raw)) return 0;
  return raw > 1_000_000_000_000 ? Math.floor(raw / 1000) : Math.floor(raw);
};

const toFiniteNumber = (value: unknown): number | undefined => {
  if (value === undefined || value === null || value === '') return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
};

const CANDLE_ARRAY_KEYS = [
  'candles',
  'bars',
  'ohlc',
  'ohlcv',
  'rates',
  'history',
  'items',
  'rows',
  'values',
  'data',
] as const;

const CANDLE_WRAPPER_KEYS = [
  'data',
  'payload',
  'result',
  'response',
  'body',
  'history',
] as const;

const findCandleArray = (payload: any, depth = 0): { candles: any[]; matched: boolean } => {
  if (Array.isArray(payload)) return { candles: payload, matched: true };
  if (!payload || typeof payload !== 'object' || depth > 4) return { candles: [], matched: false };

  for (const key of CANDLE_ARRAY_KEYS) {
    if (Array.isArray(payload[key])) return { candles: payload[key], matched: true };
  }

  for (const key of CANDLE_WRAPPER_KEYS) {
    const nested = findCandleArray(payload[key], depth + 1);
    if (nested.matched) return nested;
  }

  return { candles: [], matched: false };
};

const extractCandles = (payload: any): any[] => {
  return findCandleArray(payload).candles;
};

const extractCandle = (payload: any): any | null =>
  payload?.candle ?? payload?.data?.candle ?? payload?.payload?.candle ?? payload?.data ?? null;

export class ChartDataService {
  normalizeTimeframe(timeframe: string): ApiTimeframe {
    const normalized = timeframe.trim().toUpperCase();
    return TIMEFRAME_ALIASES[normalized] ?? 'M1';
  }

  normalizeCandle(input: any, timeframe?: string): OHLCData | null {
    if (!input) return null;
    const tf = timeframe ? this.normalizeTimeframe(timeframe) : undefined;
    const row = Array.isArray(input) ? {
      time: input[0],
      open: input[1],
      high: input[2],
      low: input[3],
      close: input[4],
      volume: input[5],
      tick_volume: input[5],
      real_volume: input[7],
    } : input;
    const rawTime = toSeconds(
      row.time
      ?? row.Time
      ?? row.TIME
      ?? row.timestamp
      ?? row.Timestamp
      ?? row.t
      ?? row.date
      ?? row.datetime
      ?? row.open_time
      ?? row.openTime
    );
    const time = normalizeTimeForApiTimeframe(rawTime, tf);
    const open = Number(row.open ?? row.Open ?? row.OPEN ?? row.o);
    const high = Number(row.high ?? row.High ?? row.HIGH ?? row.h);
    const low = Number(row.low ?? row.Low ?? row.LOW ?? row.l);
    const close = Number(row.close ?? row.Close ?? row.CLOSE ?? row.c);
    const tickVolume = toFiniteNumber(
      row.tick_volume
      ?? row.tickVolume
      ?? row.tick_count
      ?? row.tickCount
      ?? row.ticks
      ?? row.TICK_VOLUME
      ?? row.TICK_COUNT
    );
    const realVolume = toFiniteNumber(
      row.real_volume
      ?? row.realVolume
      ?? row.REAL_VOLUME
    );
    const legacyVolume = toFiniteNumber(
      row.volume
      ?? row.Volume
      ?? row.VOLUME
      ?? row.v
    );
    const volume = tickVolume ?? legacyVolume ?? realVolume ?? 0;

    if (!time || ![open, high, low, close].every(Number.isFinite)) return null;

    return {
      time,
      open,
      high,
      low,
      close,
      volume: Number.isFinite(volume) ? volume : 0,
      ...(tickVolume !== undefined ? { tickVolume } : {}),
      ...(realVolume !== undefined ? { realVolume } : {}),
    };
  }

  normalizeCandles(input: any, timeframe?: string): OHLCData[] {
    return this.normalizeCandleItems(extractCandles(input), timeframe);
  }

  private normalizeCandleItems(items: any[], timeframe?: string): OHLCData[] {
    const byTime = new Map<number, OHLCData>();
    for (const item of items) {
      const candle = this.normalizeCandle(item, timeframe);
      if (candle) byTime.set(candle.time, candle);
    }
    return Array.from(byTime.values()).sort((a, b) => a.time - b.time);
  }

  private normalizeCandleResponse(input: any, timeframe?: string): OHLCData[] {
    const extracted = findCandleArray(input);
    if (!extracted.matched) throw new Error('Malformed candle response');
    const candles = this.normalizeCandleItems(extracted.candles, timeframe);
    if (extracted.candles.length > 0 && candles.length === 0) {
      throw new Error('Malformed candle response');
    }
    return candles;
  }

  mergeCandle(candles: OHLCData[], incoming: OHLCData, maxCandles?: number): OHLCData[] {
    const next = [...candles];
    const last = next[next.length - 1];

    if (!last || incoming.time > last.time) {
      next.push(incoming);
    } else if (incoming.time === last.time) {
      next[next.length - 1] = { ...last, ...incoming };
    } else {
      const index = next.findIndex(c => c.time === incoming.time);
      if (index >= 0) next[index] = { ...next[index], ...incoming };
      else next.push(incoming);
      const sorted = next.sort((a, b) => a.time - b.time);
      return maxCandles && sorted.length > maxCandles ? sorted.slice(-maxCandles) : sorted;
    }

    return maxCandles && next.length > maxCandles ? next.slice(-maxCandles) : next;
  }

  shouldRepaintForCandle(candles: OHLCData[], incoming: OHLCData): boolean {
    const last = candles[candles.length - 1];
    return !!last && incoming.time < last.time;
  }

  async fetchCandles(options: FetchCandlesOptions): Promise<OHLCData[]> {
    const { symbol, timeframe, count, from, to, signal } = options;
    const apiTf = this.normalizeTimeframe(timeframe);
    const apiV2BaseUrl = runtimeApiV2BaseUrl();
    const token = getAuthToken();
    const authHeaders = token ? { Authorization: `Bearer ${token}` } : undefined;

    if (!token) {
      return [];
    }

    const coreUrl = `${apiV2BaseUrl}/candles/${encodeURIComponent(symbol)}${buildQuery({
      timeframe: apiTf,
      limit: count,
      from,
      to,
    })}`;

    const attempts = [
      { url: coreUrl, headers: authHeaders, isAuthenticatedCore: true },
    ];

    let lastError: Error | null = null;
    let authenticatedCoreContractError: Error | null = null;
    let sawSuccessfulSource = false;
    for (const attempt of attempts) {
      try {
        const response = await fetch(attempt.url, {
          signal,
          headers: attempt.headers,
        });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);

        let candles: OHLCData[];
        try {
          candles = this.normalizeCandleResponse(await response.json(), apiTf);
        } catch (error) {
          if ((error as Error).name === 'AbortError') throw error;
          const normalizedError = error instanceof Error ? error : new Error('Malformed candle response');
          if (attempt.isAuthenticatedCore) authenticatedCoreContractError = normalizedError;
          lastError = normalizedError;
          continue;
        }

        sawSuccessfulSource = true;
        if (candles.length > 0) return candles;
      } catch (error) {
        if ((error as Error).name === 'AbortError') throw error;
        lastError = error instanceof Error ? error : new Error('Failed to load candles');
      }
    }

    if (sawSuccessfulSource) {
      if (authenticatedCoreContractError) throw authenticatedCoreContractError;
      return [];
    }
    throw lastError ?? new Error('Failed to load candles');
  }

  subscribeCandles(options: CandleStreamOptions): CandleStreamSubscription {
    const apiTf = this.normalizeTimeframe(options.timeframe);
    const symbol = normalizeSymbol(options.symbol);
    const channel = `candles.${symbol}.${apiTf}`;
    const token = getAuthToken();
    const brokerUrl = buildBrokerWsV2Uri(token);
    const wsBase = brokerUrl || RTX5_WS_URL.replace(/\/$/, '');
    const separator = wsBase.includes('?') ? '&' : '?';
    const url = brokerUrl || `${wsBase}${token ? `${separator}token=${encodeURIComponent(token)}` : ''}`;
    let closed = false;
    let ws: WebSocket | null = null;

    try {
      ws = new WebSocket(url);

      ws.onopen = () => {
        if (!ws || closed) return;
        if (token) ws.send(JSON.stringify({ action: 'auth', token }));
        ws.send(JSON.stringify({ action: 'subscribe', channel, channels: [channel] }));
      };

      ws.onmessage = (event) => {
        try {
          const message = JSON.parse(event.data);
          const messageChannel = message.channel ?? message.topic;
          if (messageChannel && messageChannel !== channel) return;

          const snapshot = extractCandles(message);
          if (snapshot.length > 0) {
            options.onSnapshot?.(this.normalizeCandles(snapshot, apiTf));
            return;
          }

          const candle = this.normalizeCandle(extractCandle(message), apiTf);
          if (candle) options.onCandle?.(candle);
        } catch (error) {
          options.onError?.(error instanceof Error ? error : new Error('Invalid candle stream message'));
        }
      };

      ws.onerror = () => {
        options.onError?.(new Error(`Candle stream error for ${channel}`));
      };
    } catch (error) {
      options.onError?.(error instanceof Error ? error : new Error('Failed to open candle stream'));
    }

    return {
      close: () => {
        closed = true;
        if (ws?.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ action: 'unsubscribe', channel, channels: [channel] }));
        }
        ws?.close(1000, 'Chart candle subscription closed');
        ws = null;
      },
    };
  }

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
          volume: tick.volume || 0,
          tickVolume: tick.volume || 0,
        });
      } else {
        // Update existing candle
        const candle = candles.get(candleTime)!;
        candle.high = Math.max(candle.high, price);
        candle.low = Math.min(candle.low, price);
        candle.close = price;
        candle.volume += tick.volume || 0;
        candle.tickVolume = (candle.tickVolume ?? 0) + (tick.volume || 0);
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
