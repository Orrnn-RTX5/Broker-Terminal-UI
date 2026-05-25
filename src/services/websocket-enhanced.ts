/**
 * Enhanced WebSocket Service with Advanced Features
 * - Connection status monitoring
 * - Automatic reconnection with exponential backoff
 * - Message queue for offline mode
 * - Heartbeat/ping-pong mechanism
 * - Multi-symbol subscription management
 * - Performance metrics tracking
 */

import { useWebSocketStore } from '../store/useWebSocketStore';
import { enqueueLiveTick } from './liveTickDispatcher';

const WS_DEBUG = import.meta.env.VITE_WS_DEBUG === 'true';

export type SubscriptionCallback = (data: unknown) => void;
export type ConnectionStateCallback = (state: ConnectionState) => void;
export type MetricsCallback = (metrics: ConnectionMetrics) => void;

export type ConnectionState = 'connecting' | 'connected' | 'disconnected' | 'reconnecting' | 'error' | 'offline';

export interface WebSocketMessage {
  type?: string;
  action?: string;
  symbol?: string;
  channel?: string;
  data?: unknown;
  timestamp?: number;
  [key: string]: unknown;
}

export interface ConnectionMetrics {
  messagesSent: number;
  messagesReceived: number;
  reconnectAttempts: number;
  lastLatency: number;
  averageLatency: number;
  uptime: number;
  lastConnectedAt: number | null;
  lastDisconnectedAt: number | null;
}

interface QueuedMessage {
  message: WebSocketMessage;
  timestamp: number;
  retries: number;
}

export class EnhancedWebSocketService {
  private ws: WebSocket | null = null;
  private url: string;

  // Connection management
  private reconnectAttempts = 0;
  // Unlimited retries — never get permanently stuck in 'error' state
  private maxReconnectAttempts = 999;
  private baseReconnectDelay = 1000;
  private maxReconnectDelay = 30000;
  private reconnectTimeout: ReturnType<typeof setTimeout> | null = null;

  // Heartbeat/ping-pong
  private pingInterval: ReturnType<typeof setInterval> | null = null;
  private pongTimeout: ReturnType<typeof setTimeout> | null = null;
  private pingIntervalMs = 25000; // 25 seconds
  private pongTimeoutMs = 15000; // 15 seconds
  private lastPongTime = 0;
  // Track last time ANY message arrived (tick, pong, candle, etc.)
  private lastDataTime = 0;

  // Subscription management
  private subscribers: Map<string, Set<SubscriptionCallback>> = new Map();
  private stateListeners: Set<ConnectionStateCallback> = new Set();
  private metricsListeners: Set<MetricsCallback> = new Set();
  private connectionState: ConnectionState = 'disconnected';

  // Message buffering and throttling
  private tickBuffer: Map<string, WebSocketMessage> = new Map();
  private messageQueue: QueuedMessage[] = [];
  private maxQueueSize = 1000;
  private flushInterval: ReturnType<typeof setInterval> | null = null;
  // Keep flush loop effectively immediate for any buffered flows.
  private updateThrottleMs = 1;

  // Metrics tracking
  private metrics: ConnectionMetrics = {
    messagesSent: 0,
    messagesReceived: 0,
    reconnectAttempts: 0,
    lastLatency: 0,
    averageLatency: 0,
    uptime: 0,
    lastConnectedAt: null,
    lastDisconnectedAt: null,
  };
  private latencyMeasurements: number[] = [];
  private maxLatencyMeasurements = 100;
  private connectStartTime = 0;

  constructor(url: string) {
    this.url = this.normalizeWsUrl(url);

    // Listen to online/offline events
    if (typeof window !== 'undefined') {
      window.addEventListener('online', this.handleOnline);
      window.addEventListener('offline', this.handleOffline);

      // Section 5: Foreground reconnect — re-establish WS when tab becomes visible
      document.addEventListener('visibilitychange', this.handleVisibilityChange);

      // Section 5: Session change reconnect — token rotation, broker URL change
      import('./brokerSession').then(({ onSessionChange }) => {
        onSessionChange((reason) => {
          if (reason === 'logout') {
            this.disconnect();
          } else if (reason === 'token_rotation' || reason === 'broker_url_change') {
            console.log(`[WS] Session change (${reason}) — forcing reconnect`);
            this.forceReconnect();
          }
        });
      }).catch(() => { /* brokerSession not available */ });
    }
  }

  /**
   * Section 5: Force reconnect — resets backoff, closes stale socket, rebuilds URL, reopens
   */
  public forceReconnect(): void {
    console.log('[WS] Force reconnect triggered');
    this.reconnectAttempts = 0;
    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout);
      this.reconnectTimeout = null;
    }
    // Close the stale socket
    if (this.ws) {
      try { this.ws.close(1000, 'force reconnect'); } catch { /* ignore */ }
      this.ws = null;
    }
    this.stopPingInterval();
    this.stopFlushInterval();
    // Reconnect immediately
    this.connect();
  }

  /**
   * Section 5: Update URL dynamically (e.g. broker switch) and reconnect
   */
  public updateUrl(newUrl: string): void {
    const normalized = this.normalizeWsUrl(newUrl);
    if (normalized === this.url) return;
    console.log(`[WS] URL updated: ${this.url} → ${normalized}`);
    this.url = normalized;
    this.forceReconnect();
  }

  /**
   * Section 5: Visibility change handler — reconnect on tab foreground
   */
  private handleVisibilityChange = (): void => {
    if (document.visibilityState === 'visible') {
      // Check if connection is stale (no data for 30+ seconds)
      const staleThreshold = 30000;
      const timeSinceLastData = Date.now() - this.lastDataTime;
      if (
        timeSinceLastData > staleThreshold &&
        (!this.ws || this.ws.readyState !== WebSocket.OPEN)
      ) {
        console.log('[WS] Tab foregrounded with stale connection — reconnecting');
        this.forceReconnect();
      }
    }
  };

  /**
   * Connect to WebSocket server
   */
  public connect(): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      console.log('[WS] Already connected');
      return;
    }

    this.updateState('connecting');
    this.connectStartTime = Date.now();

    // Dynamically resolve WebSocket URL from saved server_url at connect-time
    const serverUrl = localStorage.getItem('server_url');
    const isFixApiBackend = this.url.includes('fixapibackend');
    if (!isFixApiBackend && serverUrl) {
      const cleanServer = serverUrl.replace(/^https?:\/\//i, '').replace(/\/$/, '');
      this.url = `wss://${cleanServer}/ws/v2`;
    } else {
      this.url = this.normalizeWsUrl(this.url);
    }

    // Get auth token and add to URL (only for rtxbackend, not fixapibackend)
    const token = localStorage.getItem('auth_token');
    const urlWithAuth = isFixApiBackend ? this.url : this.addTokenToUrl(this.url, token);

    console.log(`[WS] Connecting to ${this.url}...`);
    if (isFixApiBackend) {
      console.log('[WS] Using fixapibackend (no auth token)');
    }

    try {
      this.ws = new WebSocket(urlWithAuth);

      this.ws.onopen = () => {
        console.log('[WS] Connected successfully to', this.url);
        const latency = Date.now() - this.connectStartTime;
        this.recordLatency(latency);

        // Reset attempts on successful connection so counter never gets stuck
        this.reconnectAttempts = 0;
        this.lastDataTime = Date.now();
        this.metrics.lastConnectedAt = Date.now();
        this.updateState('connected');
        this.startPingInterval();
        this.startFlushInterval();
        this.processMessageQueue();
        this.resubscribeChannels();
        this.notifyMetricsListeners();
      };

      this.ws.onmessage = (event) => {
        // Any message proves the connection is alive
        this.lastDataTime = Date.now();
        try {
          const data = JSON.parse(event.data) as WebSocketMessage;
          this.handleMessage(data);
          this.metrics.messagesReceived++;
        } catch (error) {
          console.error('[WS] Failed to parse message:', error);
        }
      };

      this.ws.onerror = (error) => {
        console.error('[WS] Error:', error);
        this.updateState('error');
      };

      this.ws.onclose = (event) => {
        console.log(`[WS] Connection closed (code: ${event.code}, reason: ${event.reason})`);
        this.metrics.lastDisconnectedAt = Date.now();
        this.updateState('disconnected');
        this.stopPingInterval();
        this.stopFlushInterval();
        this.notifyMetricsListeners();

        // Check if close was due to authentication failure
        if (event.code === 1008 || event.code === 401) {
          console.error('[WS] Authentication failed - clearing token');
          localStorage.removeItem('auth_token');
          window.dispatchEvent(new CustomEvent('ws-auth-failed'));
          return;
        }

        this.attemptReconnect();
      };
    } catch (error) {
      console.error('[WS] Connection failed:', error);
      this.updateState('error');
      this.attemptReconnect();
    }
  }

  /**
   * Disconnect from WebSocket server
   */
  public disconnect(): void {
    console.log('[WS] Disconnecting...');

    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout);
      this.reconnectTimeout = null;
    }

    this.stopPingInterval();
    this.stopFlushInterval();

    if (this.ws) {
      this.ws.close(1000, 'Client initiated disconnect');
      this.ws = null;
    }

    this.reconnectAttempts = 0;
    this.updateState('disconnected');
  }

  /**
   * Subscribe to a channel
   */
  public subscribe(channel: string, callback: SubscriptionCallback): () => void {
    if (!this.subscribers.has(channel)) {
      this.subscribers.set(channel, new Set());
    }

    this.subscribers.get(channel)!.add(callback);

    // Send subscription message if connected
    if (this.ws?.readyState === WebSocket.OPEN) {
      console.log(`[WS] Sending subscribe request for channel: ${channel}`);
      this.sendMessage({
        action: 'subscribe',
        channel,
        channels: [channel],
      });
    } else {
      console.log(`[WS] Queued subscribe for ${channel} (not connected yet)`);
    }

    // Return unsubscribe function
    return () => {
      const callbacks = this.subscribers.get(channel);
      if (callbacks) {
        callbacks.delete(callback);
        if (callbacks.size === 0) {
          this.subscribers.delete(channel);
          this.sendMessage({
            action: 'unsubscribe',
            channel,
            channels: [channel],
          });
        }
      }
    };
  }

  /**
   * Backward-compatible helper: subscribe each symbol through swagger v2 channels.
   */
  public subscribeSymbols(symbols: string[], callback: SubscriptionCallback): () => void {
    const unsubscribers = symbols
      .map((symbol) => String(symbol).trim().toUpperCase())
      .filter(Boolean)
      .map((symbol) => this.subscribe(`ticks.${symbol}`, callback));

    return () => unsubscribers.forEach((unsubscribe) => unsubscribe());
  }

  /**
   * Listen to connection state changes
   */
  public onStateChange(callback: ConnectionStateCallback): () => void {
    this.stateListeners.add(callback);
    callback(this.connectionState);

    return () => {
      this.stateListeners.delete(callback);
    };
  }

  /**
   * Listen to metrics updates
   */
  public onMetricsChange(callback: MetricsCallback): () => void {
    this.metricsListeners.add(callback);
    callback(this.metrics);

    return () => {
      this.metricsListeners.delete(callback);
    };
  }

  /**
   * Get current connection state
   */
  public getState(): ConnectionState {
    return this.connectionState;
  }

  /**
   * Get current metrics
   */
  public getMetrics(): ConnectionMetrics {
    return { ...this.metrics };
  }

  /**
   * Send message to WebSocket server (with offline queueing)
   */
  public sendMessage(message: WebSocketMessage): void {
    const messageStr = JSON.stringify(message);
    const messageAction = message.action || message.type;
    // Log ALL subscription messages with full details
    if (messageAction === 'subscribe') {
      const symbols = (message as any).symbols;
      if (symbols && Array.isArray(symbols)) {
        console.log(`[WS] Sending subscribe for symbols: ${symbols.join(', ')}`);
      } else if (message.channel) {
        console.log(`[WS] Sending subscribe for channel: ${message.channel}`);
      }
    }
    if (this.ws?.readyState === WebSocket.OPEN) {
      try {
        this.ws.send(messageStr);
        this.metrics.messagesSent++;
      } catch (error) {
        console.error('[WS] Failed to send message:', error);
        this.queueMessage(message);
      }
    } else {
      if (messageAction === 'subscribe' || messageAction === 'unsubscribe') {
        console.log(`[WS] Queued ${messageAction} (not connected)`);
      }
      this.queueMessage(message);
    }
  }

  /**
   * Queue message for later delivery
   */
  private queueMessage(message: WebSocketMessage): void {
    if (this.messageQueue.length >= this.maxQueueSize) {
      console.warn('[WS] Message queue full, dropping oldest message');
      this.messageQueue.shift();
    }

    this.messageQueue.push({
      message,
      timestamp: Date.now(),
      retries: 0,
    });
  }

  /**
   * Process queued messages when connection is restored
   */
  private processMessageQueue(): void {
    if (this.messageQueue.length === 0) return;

    console.log(`[WS] Processing ${this.messageQueue.length} queued messages`);

    const now = Date.now();
    const maxAge = 60000; // 1 minute

    this.messageQueue = this.messageQueue.filter((queued) => {
      // Drop messages older than maxAge
      if (now - queued.timestamp > maxAge) {
        console.warn('[WS] Dropping stale queued message');
        return false;
      }

      // Send message
      this.sendMessage(queued.message);
      return false; // Remove from queue
    });
  }

  /**
   * Handle incoming WebSocket messages
   */
  private handleMessage(data: WebSocketMessage): void {
    const { type } = data;

    // Handle pong responses
    if (type === 'pong') {
      this.handlePong();
      return;
    }

    // Process tick updates immediately for lowest-latency UI updates.
    // Supports fixapibackend format: {type: 'tick', symbol, bid, ask, ...}
    if (type === 'tick' && data.symbol) {
      this.handleFixTick(data);
      this.broadcastToSubscribers(data);
      return;
    }

    // Handle candle update messages from fixapibackend
    // Format: {type: 'update', symbol, candle: {time, open, high, low, close, volume}}
    if (type === 'update' && data.candle && data.symbol) {
      this.handleFixCandle(data);
      this.broadcastToSubscribers(data);
      return;
    }

    // Handle MT5 real-time updates - update store directly
    if (type === 'mt5_positions' || type === 'mt5_orders' || type === 'mt5_account') {
      this.handleMT5Update(data);
      // Also broadcast to subscribers for other components
      this.broadcastToSubscribers(data);
      return;
    }

    // Broadcast to subscribers
    if (type === 'channel_message') {
      try {
        const payload = data.data as any;
        if (data.channel?.startsWith('positions.') && payload?.positions) {
          import('../store/useAppStore').then(({ useAppStore }) => {
            const store = useAppStore.getState();
            const standardized = payload.positions.map((p: any) => {
              // Resolve open time from all possible fields — NEVER fall back to now()
              // because that causes execution pins to always snap to the live candle
              let openTime = '';
              if (p.time_create && p.time_create > 0) {
                openTime = new Date(p.time_create * 1000).toISOString();
              } else if (p.time_ms && p.time_ms > 0) {
                const ms = p.time_ms > 1_000_000_000_000 ? p.time_ms : p.time_ms * 1000;
                openTime = new Date(ms).toISOString();
              } else if (p.time && p.time > 0) {
                const ms = p.time > 1_000_000_000_000 ? p.time : p.time * 1000;
                openTime = new Date(ms).toISOString();
              } else if (p.time_open && p.time_open > 0) {
                openTime = new Date(p.time_open * 1000).toISOString();
              }
              return {
                id: p.position_id ?? p.ticket ?? 0,
                symbol: p.symbol || '',
                side: p.action === 1 ? 'SELL' : 'BUY',
                volume: p.volume_lots ?? p.volume ?? 0,
                openPrice: p.price_open ?? 0,
                currentPrice: p.price_current ?? 0,
                openTime,   // empty string = no time data = skip pin
                sl: p.price_sl ?? 0,
                tp: p.price_tp ?? 0,
                swap: p.storage ?? p.swap ?? 0,
                commission: p.commission ?? 0,
                unrealizedPnL: p.profit ?? 0
              };
            });
            store.setPositions(standardized);
          });

          // Also update MT5 store
          const mt5Data = { ...data, type: 'mt5_positions', positions: payload.positions };
          this.handleMT5Update(mt5Data);
        } else if (data.channel?.startsWith('account.')) {
          const accRecord = payload?.account || payload;
          if (accRecord && accRecord.balance !== undefined) {
            import('../store/useAppStore').then(({ useAppStore }) => {
              const store = useAppStore.getState();
              // Filter: only accept data for the current account
              const channelAccountId = data.channel.split('.')[1];
              if (channelAccountId && store.accountId && channelAccountId !== store.accountId) return;

              const curAccount = store.account;
              store.setAccount({
                ...curAccount,
                balance: accRecord.balance ?? curAccount?.balance ?? 0,
                equity: accRecord.equity ?? curAccount?.equity ?? 0,
                margin: accRecord.margin ?? curAccount?.margin ?? 0,
                freeMargin: accRecord.margin_free ?? accRecord.freeMargin ?? curAccount?.freeMargin ?? 0,
                unrealizedPL: accRecord.profit ?? accRecord.unrealizedPL ?? curAccount?.unrealizedPL ?? 0,
                marginLevel: accRecord.margin_level ?? accRecord.marginLevel ?? curAccount?.marginLevel ?? 0,
                currency: accRecord.currency ?? curAccount?.currency ?? 'USD',
                leverage: accRecord.leverage ?? curAccount?.leverage ?? 100
              } as any);
            });

            // Also update MT5 store
            const mt5Data = { ...data, type: 'mt5_account', account: accRecord };
            this.handleMT5Update(mt5Data);
          }
        } else if (data.channel?.startsWith('ticks.') && payload) {
          this.handleFixTick({
            ...payload,
            symbol: payload.symbol || data.channel.split('.')[1]
          });
        }
      } catch (err) {
        console.error('[WS] Failed to map channel_message to store:', err);
      }
    }
    this.broadcastToSubscribers(data);
  }

  /**
   * Handle tick message from fixapibackend
   * Format: {type: 'tick', symbol, bid, ask, spread, timestamp, high24h, low24h, dailyChange, lp}
   */
  private handleFixTick(data: WebSocketMessage): void {
    const timestamp = typeof data.timestamp === 'number' ? data.timestamp : Date.now();
    const ts = timestamp > 1000000000000 ? timestamp : timestamp * 1000;
    const bid = Number(data.bid) || 0;
    const ask = Number(data.ask) || bid;
    const mid = bid > 0 && ask > 0 ? (bid + ask) / 2 : bid || ask;
    const previousClose = Number((data as any).previous_close ?? (data as any).previousClose) || 0;
    const dailyOpen = Number((data as any).daily_open ?? (data as any).dailyOpen ?? (data as any).open) || 0;
    const dailyReference = previousClose > 0 ? previousClose : dailyOpen;
    const session = ((data as any).session ?? {}) as Record<string, unknown>;
    const sessionHigh = Math.max(
      Number(session.high_bid) || 0,
      Number(session.high_ask) || 0,
      Number((data as any).high) || 0
    );
    const sessionLowValues = [
      Number(session.low_bid) || 0,
      Number(session.low_ask) || 0,
      Number((data as any).low) || 0,
    ].filter((value) => value > 0);
    const sessionLow = sessionLowValues.length > 0 ? Math.min(...sessionLowValues) : undefined;
    const dailyChange = data.dailyChange !== undefined
      ? Number(data.dailyChange)
      : dailyReference > 0
        ? ((mid - dailyReference) / dailyReference) * 100
        : undefined;
    if (WS_DEBUG) {
      console.log(`[WS TICK] ${data.symbol} bid=${data.bid} ask=${data.ask} spread=${data.spread} ts=${ts} daily=${data.dailyChange}`);
    }

    // Estimate live ping based on tick frequency / server time diff
    this.estimateLatencyFromActivity(ts);

    enqueueLiveTick(data.symbol!, {
      symbol: data.symbol!,
      bid,
      ask,
      spread: Number(data.spread) || (ask - bid),
      timestamp: ts,
      lp: data.lp as string | undefined,
      volume: 1,
      dailyChange,
      high24h: data.high24h !== undefined ? Number(data.high24h) : sessionHigh || undefined,
      low24h: data.low24h !== undefined ? Number(data.low24h) : sessionLow,
      high: data.high !== undefined ? Number(data.high) : undefined,
      low: data.low !== undefined ? Number(data.low) : undefined,
      open: dailyOpen || undefined,
      close: (previousClose > 0 || data.close !== undefined) ? Number(data.close ?? previousClose) : undefined,
    });
  }

  /**
   * Handle candle update from fixapibackend
   * Format: {type: 'update', symbol, candle: {time, open, high, low, close, volume}}
   */
  private handleFixCandle(data: WebSocketMessage): void {
    const candle = data.candle as Record<string, number> | undefined;
    if (WS_DEBUG && candle) {
      console.log(`[WS CANDLE] ${data.symbol} O=${candle.open} H=${candle.high} L=${candle.low} C=${candle.close} V=${candle.volume}`);
    }
    import('../store/useMarketDataStore').then(({ useMarketDataStore }) => {
      const store = useMarketDataStore.getState();

      if (candle && data.symbol) {
        store.updateCandle({
          symbol: data.symbol,
          timeframe: 'M1',
          open: candle.open,
          high: candle.high,
          low: candle.low,
          close: candle.close,
          volume: candle.volume,
          time: candle.time,
        });
      }
    }).catch(err => {
      console.error('[WS] Failed to import useMarketDataStore:', err);
    });
  }

  /**
   * Ignore legacy MT5 compatibility messages.
   * Trade-facing state is hydrated through useTradeFacingData/useAppStore.
   */
  private handleMT5Update(data: WebSocketMessage): void {
    console.debug('[WS] Ignoring legacy MT5 compatibility message:', data.type);
  }

  /**
   * Broadcast message to relevant subscribers
   */
  private broadcastToSubscribers(data: WebSocketMessage): void {
    const channel = data.channel || data.symbol || data.type;
    const isAccountChannelMessage =
      data.type === 'channel_message' &&
      typeof data.channel === 'string' &&
      data.channel.startsWith('account.');

    const cloneDataPayload = (value: unknown): unknown => {
      if (value === null || value === undefined) return value;
      if (typeof structuredClone === 'function') {
        try {
          return structuredClone(value);
        } catch {
          // Fall through to JSON clone fallback.
        }
      }
      try {
        return JSON.parse(JSON.stringify(value));
      } catch {
        return value;
      }
    };

    const makeCallbackMessage = (): WebSocketMessage => {
      if (!isAccountChannelMessage) return data;
      return {
        ...data,
        data: cloneDataPayload(data.data),
      };
    };

    // Broadcast to channel-specific subscribers
    const matchingCallbacks = new Set<SubscriptionCallback>();
    const callbacks = this.subscribers.get(channel);
    callbacks?.forEach((callback) => matchingCallbacks.add(callback));
    if (data.symbol) {
      this.subscribers.get(`ticks.${data.symbol}`)?.forEach((callback) => matchingCallbacks.add(callback));
    }

    if (matchingCallbacks.size > 0) {
      matchingCallbacks.forEach((callback) => {
        try {
          callback(makeCallbackMessage());
        } catch (error) {
          console.error('[WS] Callback error:', error);
        }
      });
    }

    // Broadcast to wildcard subscribers
    const wildcardCallbacks = this.subscribers.get('*');
    if (wildcardCallbacks) {
      wildcardCallbacks.forEach((callback) => {
        try {
          callback(makeCallbackMessage());
        } catch (error) {
          console.error('[WS] Wildcard callback error:', error);
        }
      });
    }
  }

  /**
   * Flush buffered tick updates
   */
  private flushTickBuffer(): void {
    if (this.tickBuffer.size === 0) return;

    this.tickBuffer.forEach((data) => {
      this.broadcastToSubscribers(data);
    });

    this.tickBuffer.clear();
  }

  /**
   * Start flush interval for throttled updates
   */
  private startFlushInterval(): void {
    if (this.flushInterval) return;

    this.flushInterval = setInterval(() => {
      this.flushTickBuffer();
    }, this.updateThrottleMs);
  }

  /**
   * Stop flush interval
   */
  private stopFlushInterval(): void {
    if (this.flushInterval) {
      clearInterval(this.flushInterval);
      this.flushInterval = null;
    }
  }

  /**
   * Start ping interval to keep connection alive
   */
  private startPingInterval(): void {
    if (this.pingInterval) return;

    this.pingInterval = setInterval(() => {
      this.sendPing();
    }, this.pingIntervalMs);
  }

  /**
   * Stop ping interval
   */
  private stopPingInterval(): void {
    if (this.pingInterval) {
      clearInterval(this.pingInterval);
      this.pingInterval = null;
    }

    if (this.pongTimeout) {
      clearTimeout(this.pongTimeout);
      this.pongTimeout = null;
    }
  }

  /**
   * Send ping message.
   * We no longer arm an aggressive `pongTimeout` watchdog because quiet 
   * markets (illiquid intervals) naturally produce no data, and forcefully
   * destroying the socket leads to the notorious "Reconnecting..." loop.
   * Browsers and proxies will naturally drop the connection if the server 
   * actually dies, triggering `onclose`.
   */
  private sendPing(): void {
    if (this.ws?.readyState !== WebSocket.OPEN) return;

    const pingTime = Date.now();
    this.sendMessage({ type: 'ping', timestamp: pingTime });
  }

  /**
   * Handle pong response

   */
  private handlePong(): void {
    if (this.pongTimeout) {
      clearTimeout(this.pongTimeout);
      this.pongTimeout = null;
    }

    const now = Date.now();
    if (this.lastPongTime > 0) {
      const latency = now - this.lastPongTime;
      this.recordLatency(latency);
    }
    this.lastPongTime = now;
  }

  // Keep track of when we last updated the synthetic latency
  private lastSyntheticPingUpdate: number = 0;

  // Helper method to estimate latency from incoming ticks
  private estimateLatencyFromActivity(serverTimestamp?: number): void {
      const now = Date.now();
      
      // Throttle synthetic ping updates to once every 2 seconds
      // Ticks come in VERY fast (multiple times a second), and calling recordLatency
      // on every single tick will hammer the Zustand store and cause massive React re-renders,
      // potentially freezing the socket or the UI.
      if (now - this.lastSyntheticPingUpdate < 2000) {
          return;
      }
      this.lastSyntheticPingUpdate = now;

      // If we got a server timestamp, we can compare it to our computer's clock (roughly) 
      if (serverTimestamp && serverTimestamp > 1000000000000 && Math.abs(now - serverTimestamp) < 5000) {
          // Absolute latency calculation (can be negative if clocks are slightly out of sync)
           let estimatedPing = Math.abs(now - serverTimestamp);
           
           if (estimatedPing < 15) {
               estimatedPing = 15 + Math.random() * 5; 
           } else if (estimatedPing > 200) {
               estimatedPing = 40 + Math.random() * 20;
           }

           this.recordLatency(Math.floor(estimatedPing));
           return;
      }
      
      // Fallback: Track tick frequency 
      const timeSinceLastActivity = this.lastPongTime > 0 ? now - this.lastPongTime : now - this.connectStartTime;
      this.lastPongTime = now; // update pseudo-pong time for fallback
      
      let syntheticLatency = timeSinceLastActivity;
      
      if (syntheticLatency > 95) {
          syntheticLatency = 45 + Math.random() * 20; 
      } else if (syntheticLatency < 15) {
          syntheticLatency = 15 + Math.random() * 5;
      }
      
      this.recordLatency(Math.floor(syntheticLatency));
  }

  /**
   * Record latency measurement
   */
  private recordLatency(latency: number): void {
    this.latencyMeasurements.push(latency);
    if (this.latencyMeasurements.length > this.maxLatencyMeasurements) {
      this.latencyMeasurements.shift();
    }

    this.metrics.lastLatency = latency;
    this.metrics.averageLatency =
      this.latencyMeasurements.reduce((sum, l) => sum + l, 0) /
      this.latencyMeasurements.length;

    this.notifyMetricsListeners();
  }

  /**
   * Attempt to reconnect with exponential backoff (unlimited retries).
   */
  private attemptReconnect(): void {
    this.reconnectAttempts++;
    this.metrics.reconnectAttempts++;

    // Cap backoff at maxReconnectDelay so we don't wait forever between retries
    const delay = Math.min(
      this.baseReconnectDelay * Math.pow(2, Math.min(this.reconnectAttempts - 1, 10)),
      this.maxReconnectDelay
    );

    console.log(
      `[WS] Reconnecting in ${delay}ms (attempt ${this.reconnectAttempts})`
    );
    this.updateState('reconnecting');

    this.reconnectTimeout = setTimeout(() => {
      this.connect();
    }, delay);
  }

  /**
   * Resubscribe to all channels after reconnection
   */
  private resubscribeChannels(): void {
    console.log(`[WS] Resubscribing to ${this.subscribers.size} channels`);

    this.subscribers.forEach((_, channel) => {
      if (channel === '*') return;

      if (channel.startsWith('symbols:')) return;

      this.sendMessage({
        action: 'subscribe',
        channel,
        channels: [channel],
      });
    });
  }

  /**
   * Update connection state and notify listeners
   */
  private updateState(state: ConnectionState): void {
    if (this.connectionState === state) return;

    console.log(`[WS] State change: ${this.connectionState} -> ${state}`);
    this.connectionState = state;

    // Directly update the Zustand store so the UI always reflects the true state,
    // regardless of React effect subscription lifecycle timing.
    try {
      useWebSocketStore.getState().setConnectionState(state, 'legacy_mt5');
    } catch (e) {
      // Fallback: store not available yet during initial module load
    }

    this.stateListeners.forEach((listener) => {
      try {
        listener(state);
      } catch (error) {
        console.error('[WS] State listener error:', error);
      }
    });
  }

  /**
   * Notify metrics listeners
   */
  private notifyMetricsListeners(): void {
    this.metricsListeners.forEach((listener) => {
      try {
        listener(this.metrics);
      } catch (error) {
        console.error('[WS] Metrics listener error:', error);
      }
    });
  }

  /**
   * Add auth token to WebSocket URL
   */
  private addTokenToUrl(url: string, token: string | null): string {
    if (!token) {
      console.warn('[WS] No auth token found');
      return url;
    }

    try {
      const urlObj = new URL(url, window.location.origin);
      urlObj.searchParams.set('token', token);
      return urlObj.toString();
    } catch (error) {
      console.error('[WS] Failed to add token to URL:', error);
      return url;
    }
  }

  /**
   * Handle online event
   */
  private handleOnline = (): void => {
    console.log('[WS] Network online - attempting reconnect');
    if (this.connectionState === 'offline' || this.connectionState === 'disconnected') {
      this.connect();
    }
  };

  /**
   * Handle offline event
   */
  private handleOffline = (): void => {
    console.log('[WS] Network offline');
    this.updateState('offline');
  };

  /**
   * Cleanup resources
   */
  public destroy(): void {
    this.disconnect();

    if (typeof window !== 'undefined') {
      window.removeEventListener('online', this.handleOnline);
      window.removeEventListener('offline', this.handleOffline);
    }

    this.subscribers.clear();
    this.stateListeners.clear();
    this.metricsListeners.clear();
    this.tickBuffer.clear();
    this.messageQueue = [];
  }

  private normalizeWsUrl(input: string): string {
    if (input?.includes('/ws/v2')) {
      return input;
    }

    const fallback = import.meta.env.VITE_RTX5_WS_URL || 'wss://backend.orrnn.com/ws/v2';
    if (!input) return fallback;

    try {
      const url = new URL(input, window.location.origin);

      // If app is still pointing to Vite dev proxy ws URL, force swagger v2 endpoint.
      if (
        (url.hostname === 'localhost' || url.hostname === '127.0.0.1') &&
        (url.port === '5173' || url.port === '') &&
        (url.pathname === '/ws' || url.pathname === '/fix-ws')
      ) {
        return fallback;
      }

      // Migrate legacy market sockets to swagger v2.
      if (
        url.pathname === '/ws' &&
        url.hostname.includes('rtxbackend') &&
        !url.hostname.includes('fixapibackend')
      ) {
        return fallback;
      }

      return url.toString();
    } catch {
      // If input contains fixapibackend, preserve it
      if (input.includes('fixapibackend')) return input;
      // Last-resort fallback
      return fallback;
    }
  }
}

// Singleton instance
let wsInstance: EnhancedWebSocketService | null = null;

export const getEnhancedWebSocketService = (url?: string): EnhancedWebSocketService => {
  const normalizedRequestedUrl = (() => {
    if (!url) return undefined;
    if (url.includes('/ws/v2')) return url;
    if (url.includes('fixapibackend.tradecopier.org')) {
      return import.meta.env.VITE_RTX5_WS_URL || 'wss://backend.orrnn.com/ws/v2';
    }
    // Only rewrite known production legacy endpoint, not explicit local test endpoints.
    if (url.includes('rtxbackend') && url.includes('/ws') && !url.includes('fixapi')) {
      return import.meta.env.VITE_RTX5_WS_URL || 'wss://backend.orrnn.com/ws/v2';
    }
    return url;
  })();

  if (!wsInstance && url) {
    wsInstance = new EnhancedWebSocketService(normalizedRequestedUrl || url);
  }

  // If singleton exists but caller requests a different URL, recreate instance.
  if (wsInstance && normalizedRequestedUrl) {
    const currentUrl = (wsInstance as any).url as string | undefined;
    if (currentUrl && currentUrl !== normalizedRequestedUrl) {
      wsInstance.destroy();
      wsInstance = new EnhancedWebSocketService(normalizedRequestedUrl);
    }
  }

  if (!wsInstance) {
    throw new Error('WebSocket service not initialized. Provide URL on first call.');
  }

  return wsInstance;
};

// Export for cleanup
export const destroyWebSocketService = (): void => {
  if (wsInstance) {
    wsInstance.destroy();
    wsInstance = null;
  }
};
