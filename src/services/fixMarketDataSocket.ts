/**
 * Fix Market Data WebSocket Service
 * Handles connection to wss://fixapibackend.tradecopier.org/ws
 * Message formats:
 * - Subscribe: {"type":"subscribe","symbols":["XAUUSD"]}
 * - Tick: {"type":"tick","symbol":"XAUUSD","bid":4685.8,"ask":4685.94,"spread":0.14,"timestamp":1775552355,"high24h":4687.4,"low24h":4649.8,"dailyChange":0.709,"lp":"YOFX"}
 * - Candle: {"type":"update","symbol":"XAUUSD","candle":{"time":1772261040,"open":63922.955,"high":63991.705,"low":63921.995,"close":63991.705,"volume":223}}
 */

import { useMarketDataStore } from '../store/useMarketDataStore';
import { useWebSocketStore, type ConnectionState } from '../store/useWebSocketStore';
import { enqueueLiveTick } from './liveTickDispatcher';
import { MARKET_WS_URL } from '../config/api';
import { buildBrokerWsV2Uri } from './brokerSession';

const FIX_SOCKET_DEBUG = import.meta.env.VITE_WS_DEBUG === 'true';

export type FixSocketState = ConnectionState;

export interface FixTickMessage {
  type: 'tick';
  symbol: string;
  bid: number;
  ask: number;
  spread: number;
  timestamp: number;
  high24h?: number;
  high_24h?: number;
  low24h?: number;
  low_24h?: number;
  dailyChange?: number;
  lp?: string;
  provider?: string;
  liquidity_provider?: string;
  liquidityProvider?: string;
  volume?: number;
  volume_24h?: number;
  volume24h?: number;
  tick_volume?: number;
  tickVolume?: number;
  real_volume?: number;
  realVolume?: number;
  last?: number;
  last_price?: number;
  lastPrice?: number;
  high?: number;
  low?: number;
  open?: number;
  daily_open?: number;
  dailyOpen?: number;
  close?: number;
  previous_close?: number;
  previousClose?: number;
}

export interface FixCandleMessage {
  type: 'update';
  symbol: string;
  sourceTimestamp?: number;
  source_timestamp?: number;
  event_timestamp?: number;
  server_timestamp?: number;
  timestamp?: number;
  candle: {
    time: number;
    open: number;
    high: number;
    low: number;
    close: number;
    volume: number;
  };
}

export type FixSocketMessage = FixTickMessage | FixCandleMessage;

const readFirstFiniteNumber = (
  record: Record<string, unknown>,
  keys: readonly string[],
): number | undefined => {
  for (const key of keys) {
    const value = record[key];
    if (value === null || value === undefined || value === '') continue;
    const numeric = Number(value);
    if (Number.isFinite(numeric)) return numeric;
  }
  return undefined;
};

const readFirstNonEmptyString = (
  record: Record<string, unknown>,
  keys: readonly string[],
): string | undefined => {
  for (const key of keys) {
    const value = record[key];
    if (typeof value !== 'string') continue;
    const normalized = value.trim();
    if (normalized) return normalized;
  }
  return undefined;
};

type MessageHandler = (data: FixSocketMessage) => void;
type StateHandler = (state: FixSocketState) => void;

export class FixMarketDataSocket {
  private ws: WebSocket | null = null;
  private url: string;
  private subscribedSymbols: Set<string> = new Set();
  private messageHandlers: Set<MessageHandler> = new Set();
  private stateHandlers: Set<StateHandler> = new Set();
  private state: FixSocketState = 'disconnected';

  private reconnectAttempts = 0;
  // Unlimited retries — keep trying forever with exponential back-off capped at 30s
  private maxReconnectAttempts = 999;
  private baseReconnectDelay = 1000;
  private maxReconnectDelay = 30000;
  private reconnectTimeout: ReturnType<typeof setTimeout> | null = null;
  // Ping tracking for precise latency calculation
  private pingInterval: ReturnType<typeof setInterval> | null = null;
  private readonly pingIntervalMs = 5000;
  private lastPingTime = 0;
  private lastPingStartedAt = 0;
  private latencyMeasurements: number[] = [];
  private readonly maxLatencyMeasurements = 5;

  // Watchdog: force-close if no message received within this window
  private activityWatchdog: ReturnType<typeof setTimeout> | null = null;
  private readonly ACTIVITY_TIMEOUT_MS = 120_000; // 120 s

  constructor(url?: string) {
    this.url = url || MARKET_WS_URL || buildBrokerWsV2Uri(null);
  }

  /**
   * Get current connection state
   */
  public getState(): FixSocketState {
    return this.state;
  }

  /**
   * Connect to WebSocket server
   */
  public connect(): void {
    if (this.ws?.readyState === WebSocket.OPEN || this.ws?.readyState === WebSocket.CONNECTING) {
      console.log('[FixSocket] Already connected or connecting');
      return;
    }

    this.updateState('connecting');
    console.log(`[FixSocket] Connecting to ${this.url}...`);

    try {
      this.ws = new WebSocket(this.url);

      this.ws.onopen = () => {
        console.log('[FixSocket] Connected successfully');
        this.reconnectAttempts = 0;
        useWebSocketStore.getState().resetReconnectAttempts('fix_socket');
        this.updateState('connected');
        useWebSocketStore.getState().updateMetrics({ lastLatency: 0, averageLatency: 0, latencyMeasuredAt: null }, 'fix_socket');
        this.startPingInterval();
        this.resubscribeSymbols();

        if (this.reconnectTimeout) {
          clearTimeout(this.reconnectTimeout);
          this.reconnectTimeout = null;
        }
      };

      this.ws.onmessage = (event) => {
        // Any message proves the connection is alive — reset watchdog
        this.resetActivityWatchdog();
        
        try {
          const data = JSON.parse(event.data) as FixSocketMessage;
          if (String((data as any).type ?? (data as any).action).toLowerCase() === 'pong') {
            this.recordPongActivity(data);
            return;
          }
          this.handleMessage(data);
        } catch (error) {
          console.error('[FixSocket] Failed to parse message:', error);
        }
      };

      this.ws.onerror = (error) => {
        console.error('[FixSocket] Error:', error);
        this.updateState('error');
      };

      this.ws.onclose = (event) => {
        console.log(`[FixSocket] Connection closed (code: ${event.code})`);
        this.updateState('disconnected');
        this.stopPingInterval();
        this.clearActivityWatchdog();
        this.attemptReconnect();
      };
    } catch (error) {
      console.error('[FixSocket] Connection failed:', error);
      this.updateState('error');
      this.attemptReconnect();
    }
  }

  /**
   * Disconnect from WebSocket server
   */
  public disconnect(): void {
    console.log('[FixSocket] Disconnecting...');

    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout);
      this.reconnectTimeout = null;
    }

    this.stopPingInterval();
    this.clearActivityWatchdog();

    if (this.ws) {
      this.ws.close(1000, 'Client initiated disconnect');
      this.ws = null;
    }

    this.stopPingInterval();
    this.reconnectAttempts = 0;
    this.updateState('disconnected');
  }

  /**
   * Subscribe to symbols
   */
  public subscribe(symbols: string[]): void {
    symbols.forEach(symbol => this.subscribedSymbols.add(symbol));

    if (this.ws?.readyState === WebSocket.OPEN) {
      this.sendSubscribeMessage(symbols);
    }
  }

  /**
   * Unsubscribe from symbols
   */
  public unsubscribe(symbols: string[]): void {
    symbols.forEach(symbol => this.subscribedSymbols.delete(symbol));

    // Note: Backend may not support unsubscribe, but we can stop tracking
    console.log(`[FixSocket] Unsubscribed from: ${symbols.join(', ')}`);
  }

  /**
   * Add message handler
   */
  public onMessage(handler: MessageHandler): () => void {
    this.messageHandlers.add(handler);
    return () => {
      this.messageHandlers.delete(handler);
    };
  }

  /**
   * Add state change handler
   */
  public onStateChange(handler: StateHandler): () => void {
    this.stateHandlers.add(handler);
    handler(this.state);
    return () => {
      this.stateHandlers.delete(handler);
    };
  }

  /**
   * Handle incoming messages
   */
  private handleMessage(data: FixSocketMessage): void {
    // Notify all registered handlers
    this.messageHandlers.forEach(handler => {
      try {
        handler(data);
      } catch (error) {
        console.error('[FixSocket] Handler error:', error);
      }
    });

    // Process tick messages
    if (data.type === 'tick') {
      this.processTick(data);
    }

    // Process candle update messages
    if (data.type === 'update' && data.candle) {
      this.processCandle(data);
    }
  }

  /**
   * Process tick message and update store
   */
  private processTick(tick: FixTickMessage): void {
    const { symbol, bid, ask, spread, timestamp, dailyChange } = tick;
    const record = tick as unknown as Record<string, unknown>;
    const high24h = readFirstFiniteNumber(record, ['high24h', 'high_24h']);
    const low24h = readFirstFiniteNumber(record, ['low24h', 'low_24h']);
    const volume = readFirstFiniteNumber(record, [
      'volume',
      'volume_24h',
      'volume24h',
      'tick_volume',
      'tickVolume',
      'real_volume',
      'realVolume',
    ]);
    const last = readFirstFiniteNumber(record, ['last', 'last_price', 'lastPrice']);
    const lp = readFirstNonEmptyString(record, [
      'lp',
      'provider',
      'liquidity_provider',
      'liquidityProvider',
      'lp_name',
      'lpName',
    ]);
    const open = readFirstFiniteNumber(record, ['daily_open', 'dailyOpen', 'open', 'open_price', 'openPrice']);
    const close = readFirstFiniteNumber(record, ['close', 'previous_close', 'previousClose', 'close_price', 'closePrice']);
    const high = readFirstFiniteNumber(record, ['high']);
    const low = readFirstFiniteNumber(record, ['low']);

    // Convert timestamp to milliseconds if it's in seconds
    const ts = timestamp > 1000000000000 ? timestamp : timestamp * 1000;

    // Update MarketDataStore (OHLCV aggregation — uses bid/ask/spread only)
    enqueueLiveTick(symbol, {
      symbol,
      bid,
      ask,
      spread,
      timestamp: ts,
      sourceTimestamp: ts,
      lp,
      volume,
      last,
      dailyChange,
      high24h,
      low24h,
      high,
      low,
      open,
      close,
    });
  }

  /**
   * Process candle message and update store
   */
  private processCandle(data: FixCandleMessage): void {
    const { symbol, candle } = data;
    const sourceTimestamp = readFirstFiniteNumber(
      data as unknown as Record<string, unknown>,
      ['sourceTimestamp', 'source_timestamp', 'event_timestamp', 'server_timestamp', 'timestamp'],
    );

    // Update market data store with candle data
    const store = useMarketDataStore.getState();
    store.updateCandle({
      symbol,
      timeframe: 'M1', // Assuming 1-minute candles from backend
      open: candle.open,
      high: candle.high,
      low: candle.low,
      close: candle.close,
      volume: candle.volume,
      time: candle.time,
      // FIX: WebSocket candle snapshots are authoritative backend OHLC; keep
      // their event revision separate from the candle bucket timestamp.
      source: 'server',
      sourceTimestamp,
    });
  }
  
  /**
   * Ping/Pong latency tracking
   */
  private startPingInterval(): void {
    this.stopPingInterval();
    this.pingInterval = setInterval(() => {
      if (this.ws?.readyState === WebSocket.OPEN) {
        this.lastPingTime = Date.now();
        this.lastPingStartedAt = performance.now();
        this.ws.send(JSON.stringify({ type: 'ping', action: 'ping', timestamp: this.lastPingTime }));
      }
    }, this.pingIntervalMs);
  }

  private stopPingInterval(): void {
    this.lastPingTime = 0;
    this.lastPingStartedAt = 0;
    this.latencyMeasurements = [];
    if (this.pingInterval) {
      clearInterval(this.pingInterval);
      this.pingInterval = null;
    }
  }

  private recordPongActivity(data: any): void {
    const echo = data?.ping_timestamp ?? data?.request_timestamp ?? data?.timestamp ?? data?.data?.timestamp;
    if (this.lastPingTime > 0 && echo === this.lastPingTime) {
      const diff = performance.now() - this.lastPingStartedAt;
      if (!Number.isFinite(diff) || diff < 0) return;
      this.latencyMeasurements.push(diff);
      if (this.latencyMeasurements.length > this.maxLatencyMeasurements) {
        this.latencyMeasurements.shift();
      }

      const averageLatency = Math.floor(
        this.latencyMeasurements.reduce((sum, l) => sum + l, 0) / this.latencyMeasurements.length
      );

      useWebSocketStore.getState().updateMetrics({ lastLatency: diff, averageLatency, latencyMeasuredAt: Date.now() }, 'fix_socket');
      
      // Reset ping time so we don't double-count the same ping
      this.lastPingTime = 0;
    }
  }

  /**
   * Send subscribe message to backend
   */
  private sendSubscribeMessage(symbols: string[]): void {
    if (this.ws?.readyState !== WebSocket.OPEN) return;

    const message = {
      type: 'subscribe',
      symbols: symbols,
    };

    console.log(`[FixSocket] Subscribing to: ${symbols.join(', ')}`);
    this.ws.send(JSON.stringify(message));
  }

  /**
   * Resubscribe to all symbols after reconnection
   */
  private resubscribeSymbols(): void {
    if (this.subscribedSymbols.size === 0) return;

    const symbols = Array.from(this.subscribedSymbols);
    console.log(`[FixSocket] Resubscribing to ${symbols.length} symbols`);
    this.sendSubscribeMessage(symbols);
  }

  /**
   * Reset the activity watchdog timer.
   * If no message is received within ACTIVITY_TIMEOUT_MS, force-close the socket
   * so onclose fires and the reconnect logic kicks in.
   */
  private resetActivityWatchdog(): void {
    this.clearActivityWatchdog();
    this.activityWatchdog = setTimeout(() => {
      if (this.ws?.readyState === WebSocket.OPEN || this.ws?.readyState === WebSocket.CONNECTING) {
        console.warn('[FixSocket] No activity for 120s — force-closing to trigger reconnect');
        this.ws.close(4000, 'Activity timeout');
      }
    }, this.ACTIVITY_TIMEOUT_MS);
  }

  private clearActivityWatchdog(): void {
    if (this.activityWatchdog) {
      clearTimeout(this.activityWatchdog);
      this.activityWatchdog = null;
    }
  }

  /**
   * Attempt to reconnect with exponential backoff
   */
  private attemptReconnect(): void {
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      console.error('[FixSocket] Max reconnect attempts reached');
      this.updateState('error');
      return;
    }

    this.reconnectAttempts++;
    useWebSocketStore.getState().incrementReconnectAttempts('fix_socket');

    // Cap backoff at maxReconnectDelay
    const delay = Math.min(
      this.baseReconnectDelay * Math.pow(2, Math.min(this.reconnectAttempts - 1, 10)),
      this.maxReconnectDelay
    );

    console.log(
      `[FixSocket] Reconnecting in ${delay}ms (attempt ${this.reconnectAttempts})`
    );
    this.updateState('reconnecting');

    this.reconnectTimeout = setTimeout(() => {
      this.connect();
    }, delay);
  }

  /**
   * Update connection state and notify listeners
   */
  private updateState(state: FixSocketState): void {
    if (this.state === state) return;

    console.log(`[FixSocket] State change: ${this.state} -> ${state}`);
    this.state = state;

    // Sync state to the global WebSocket store for the UI
    try {
      if (typeof window !== 'undefined') {
        const wsStore = useWebSocketStore.getState();
        // Only override if the main MT5 websocket isn't the one managing things,
        // or prioritize this since it's the actual price feed.
        wsStore.setConnectionState(state, 'fix_socket');
      }
    } catch (err) {
      console.warn('[FixSocket] Failed to sync state to store:', err);
    }

    this.stateHandlers.forEach(handler => {
      try {
        handler(state);
      } catch (error) {
        console.error('[FixSocket] State handler error:', error);
      }
    });
  }

  /**
   * Cleanup resources
   */
  public destroy(): void {
    this.disconnect();
    this.messageHandlers.clear();
    this.stateHandlers.clear();
    this.subscribedSymbols.clear();
  }
}

// Singleton instance
let fixSocketInstance: FixMarketDataSocket | null = null;

export const getFixMarketDataSocket = (url?: string): FixMarketDataSocket => {
  if (!fixSocketInstance) {
    fixSocketInstance = new FixMarketDataSocket(url);
  }
  return fixSocketInstance;
};

export const destroyFixMarketDataSocket = (): void => {
  if (fixSocketInstance) {
    fixSocketInstance.destroy();
    fixSocketInstance = null;
  }
};
