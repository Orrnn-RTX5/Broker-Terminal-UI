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
import { buildBrokerWsV2Uri, getAccessToken, onSessionChange } from './brokerSession';
import { normalizeWsUrl as normalizeRuntimeWsUrl } from '../config/api';
import {
  composeDailyChangeQuoteContext,
  readDailyChangeLastPrice,
  readDailyChangePercent,
  readDailyChangePreviousClose,
  resolveDailyChangePercent,
} from '../utils/dailyChange';
import { resolveDailyChangePriceMode } from './dailyChangePriceModeRegistry';
import {
  isEnhancedStoreHandledTickFrame,
  isExactAccountStreamChannel,
  type WebSocketMessage,
} from './enhancedWebSocketMessage';
import { readFirstFiniteNumber, readFirstNonEmptyString } from '../utils/recordFields';
import { readQuoteSessionRange } from '../utils/quoteSessionRange';
import {
  asUnknownRecord,
  normalizeBrokerTimestampMs,
  readBrokerTimestampMs,
  readCandleFinality,
} from '../utils/brokerStreamSemantics';

const WS_DEBUG = import.meta.env.VITE_WS_DEBUG === 'true';

export { isEnhancedStoreHandledTickFrame, isExactAccountStreamChannel };
export type { WebSocketMessage };

/** Channels that exist only as local listeners and are never sent to the server. */
export const isLocalOnlyChannel = (channel: string): boolean => channel === '*';

export type SubscriptionCallback = (data: unknown) => void;
export type ConnectionStateCallback = (state: ConnectionState) => void;
export type MetricsCallback = (metrics: ConnectionMetrics) => void;

export type ConnectionState = 'connecting' | 'connected' | 'disconnected' | 'reconnecting' | 'error' | 'offline';

const resolveTickSourceTimestampMs = (...values: unknown[]): number | undefined => {
  // FIX: Normalize every supported broker alias and seconds/ms/us/ns/ISO form
  // before freshness ordering; receipt time remains a distinct fallback.
  return readBrokerTimestampMs(values.map(asUnknownRecord));
};

export interface ConnectionMetrics {
  messagesSent: number;
  messagesReceived: number;
  reconnectAttempts: number;
  lastLatency: number;
  latencyMeasuredAt?: number | null;
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

export const ENHANCED_WS_OPEN_TIMEOUT_MS = 5_000;
export const ENHANCED_WS_STABLE_OPEN_MS = 10_000;

const RECONNECT_JITTER_RATIO = 0.2;

const addReconnectJitter = (delay: number, maximum: number): number => {
  const jitter = Math.floor(delay * RECONNECT_JITTER_RATIO * Math.random());
  return Math.min(maximum, delay + jitter);
};

export class EnhancedWebSocketService {
  private ws: WebSocket | null = null;
  private url: string;

  // Connection management
  private reconnectAttempts = 0;
  private baseReconnectDelay = 1000;
  private maxReconnectDelay = 30000;
  private reconnectTimeout: ReturnType<typeof setTimeout> | null = null;
  private openTimeout: ReturnType<typeof setTimeout> | null = null;
  private stableOpenTimeout: ReturnType<typeof setTimeout> | null = null;
  private reconnectPendingWhileHidden = false;

  // Heartbeat/ping-pong
  private pingInterval: ReturnType<typeof setInterval> | null = null;
  private pongTimeout: ReturnType<typeof setTimeout> | null = null;
  private pingIntervalMs = 25000; // 25 seconds
  private pongTimeoutMs = 15000; // 15 seconds
  private lastPongTime = 0;
  private lastPingSentAt = 0;
  private lastPingStartedAt = 0;
  // A browser WebSocket cannot use protocol-level ping frames. Only enforce
  // the application heartbeat after this endpoint has proved it understands
  // our JSON ping/pong contract; otherwise a server that simply ignores the
  // optional probe would be mistaken for a dead transport every 40 seconds.
  private pongSupportedUrl: string | null = null;
  // Track last time ANY message arrived (tick, pong, candle, etc.)
  private lastDataTime = 0;

  // Subscription management
  private subscribers: Map<string, Set<SubscriptionCallback>> = new Map();
  private stateListeners: Set<ConnectionStateCallback> = new Set();
  private metricsListeners: Set<MetricsCallback> = new Set();
  private connectionState: ConnectionState = 'disconnected';
  private disposed = false;
  private unsubSessionChange: (() => void) | null = null;

  // Message buffering and throttling
  private tickBuffer: Map<string, WebSocketMessage> = new Map();
  private messageQueue: QueuedMessage[] = [];
  private maxQueueSize = 1000;
  private flushInterval: ReturnType<typeof setInterval> | null = null;
  // Flush buffered ticks once per frame (~60fps). Avoids CPU spin from 1ms timers
  // in Electron while still feeling instantaneous to the user.
  private updateThrottleMs = 16;

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

  constructor(url: string) {
    this.url = this.normalizeWsUrl(url);

    // Listen to online/offline events
    if (typeof window !== 'undefined') {
      window.addEventListener('online', this.handleOnline);
      window.addEventListener('offline', this.handleOffline);

      // Section 5: Foreground reconnect — re-establish WS when tab becomes visible
      document.addEventListener('visibilitychange', this.handleVisibilityChange);

      // FIX: Own the unsubscribe synchronously so a destroyed service cannot be
      // resurrected later by a broker/account/token event.
      this.unsubSessionChange = onSessionChange((reason) => {
        if (reason === 'logout') {
          this.disconnect();
        } else if (
          reason === 'token_rotation'
          || reason === 'broker_url_change'
          || reason === 'login'
          || reason === 'account_change'
        ) {
          console.log(`[WS] Session change (${reason}) — forcing reconnect`);
          this.forceReconnect();
        }
      });
    }
  }

  /**
   * Section 5: Force reconnect — resets backoff, closes stale socket, rebuilds URL, reopens
   */
  public forceReconnect(): void {
    if (this.disposed) return;
    console.log('[WS] Force reconnect triggered');
    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout);
      this.reconnectTimeout = null;
    }
    this.clearStableOpenTimeout();
    // Close the stale socket
    if (this.ws) {
      // FIX: Detach ownership before close so synchronous/late callbacks from
      // the old credential cannot schedule a ghost reconnect.
      const socket = this.ws;
      this.ws = null;
      try { socket.close(1000, 'force reconnect'); } catch { /* ignore */ }
    }
    this.stopPingInterval();
    this.stopFlushInterval();
    if (this.isRuntimeSuspended()) {
      this.reconnectPendingWhileHidden = true;
      this.updateState(typeof navigator !== 'undefined' && navigator.onLine === false ? 'offline' : 'reconnecting');
      return;
    }
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
    if (document.visibilityState === 'hidden') {
      // FIX: Background timer clamping suspends heartbeat/open deadlines. A
      // visible transition owns one fresh socket and exact channel resubscribe.
      this.stopPingInterval();
      this.clearOpenTimeout();
      this.reconnectPendingWhileHidden = Boolean(this.ws || this.subscribers.size > 0 || this.reconnectTimeout);
      if (this.reconnectTimeout) {
        clearTimeout(this.reconnectTimeout);
        this.reconnectTimeout = null;
      }
      if (this.reconnectPendingWhileHidden) this.updateState('reconnecting');
      return;
    }

    if (document.visibilityState === 'visible') {
      if (typeof navigator !== 'undefined' && navigator.onLine === false) {
        this.reconnectPendingWhileHidden = Boolean(this.ws || this.subscribers.size > 0);
        return;
      }

      // Check if connection is stale (no data for 30+ seconds)
      const staleThreshold = 30000;
      const timeSinceLastData = Date.now() - this.lastDataTime;
      const heartbeatIsStale = this.pongSupportedUrl === this.url && (
        this.lastPongTime === 0
        || Date.now() - this.lastPongTime > this.pingIntervalMs + this.pongTimeoutMs + 5000
      );
      if (
        this.reconnectPendingWhileHidden
        || !this.ws
        || this.ws.readyState !== WebSocket.OPEN
        || (timeSinceLastData > staleThreshold && heartbeatIsStale)
      ) {
        console.log('[WS] Tab foregrounded with stale connection — reconnecting');
        this.reconnectPendingWhileHidden = false;
        this.forceReconnect();
      }
    }
  };

  /**
   * Connect to WebSocket server
   */
  public connect(): void {
    if (this.disposed) return;
    if (this.isRuntimeSuspended()) {
      // FIX: Do not start a handshake whose timers will be throttled/offline;
      // one foreground/online transition will reconnect and resubscribe.
      this.reconnectPendingWhileHidden = true;
      this.updateState(typeof navigator !== 'undefined' && navigator.onLine === false ? 'offline' : 'reconnecting');
      return;
    }
    if (
      this.ws?.readyState === WebSocket.OPEN
      || this.ws?.readyState === WebSocket.CONNECTING
    ) {
      console.log('[WS] Connection already open or in progress');
      return;
    }
    this.clearOpenTimeout();

    this.updateState('connecting');

    // Dynamically resolve WebSocket URL from saved server_url at connect-time
    const serverUrl = localStorage.getItem('server_url');
    const isFixApiBackend = this.url.includes('fixapibackend');
    // FIX: The canonical accessor includes sessionStorage and current token
    // rotation, keeping every account channel on the same authenticated owner.
    const token = getAccessToken();
    let urlWithAuth: string;

    if (!isFixApiBackend && !token) {
      console.warn('[WS] Skipping trade WebSocket connect until auth token is available');
      this.updateState('disconnected');
      return;
    }

    if (!isFixApiBackend && serverUrl) {
      this.url = buildBrokerWsV2Uri(null);
      urlWithAuth = token ? buildBrokerWsV2Uri(token) : this.url;
    } else {
      this.url = this.normalizeWsUrl(this.url);
      urlWithAuth = isFixApiBackend ? this.url : this.addTokenToUrl(this.url, token);
    }

    console.log(`[WS] Connecting to ${this.url}...`);
    if (isFixApiBackend) {
      console.log('[WS] Using fixapibackend (no auth token)');
    }

    try {
      const socket = new WebSocket(urlWithAuth);
      this.ws = socket;

      socket.onopen = () => {
        if (this.ws !== socket) return;
        this.clearOpenTimeout();
        console.log('[WS] Connected successfully to', this.url);
        // FIX: A handshake duration is not market-feed RTT. Keep zero as the
        // existing "unknown" sentinel until a real application ping/pong is measured.

        this.lastDataTime = Date.now();
        // FIX: Pong freshness belongs to this socket instance, not its predecessor.
        this.lastPongTime = 0;
        this.lastPingSentAt = 0;
        this.lastPingStartedAt = 0;
        this.latencyMeasurements = [];
        this.metrics.lastLatency = 0;
        this.metrics.averageLatency = 0;
        this.metrics.latencyMeasuredAt = null;
        this.metrics.lastConnectedAt = Date.now();
        this.updateState('connected');
        this.startPingInterval();
        this.startFlushInterval();
        this.processMessageQueue();
        this.resubscribeChannels();
        this.notifyMetricsListeners();
        this.scheduleStableOpenReset(socket);
      };

      socket.onmessage = (event) => {
        if (this.ws !== socket) return;
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

      socket.onerror = (error) => {
        if (this.ws !== socket) return;
        console.error('[WS] Error:', error);
        this.updateState('error');
      };

      socket.onclose = (event) => {
        if (this.ws !== socket) return;
        this.clearOpenTimeout();
        this.clearStableOpenTimeout();
        this.ws = null;
        console.log(`[WS] Connection closed (code: ${event.code}, reason: ${event.reason})`);
        this.metrics.lastDisconnectedAt = Date.now();
        this.updateState('disconnected');
        this.stopPingInterval();
        this.stopFlushInterval();
        this.notifyMetricsListeners();

        // Check if close was due to authentication failure
        if ([1008, 4001, 4003, 4401, 4403].includes(event.code) || event.code === 401) {
          console.error('[WS] Authentication failed - clearing token');
          localStorage.removeItem('auth_token');
          localStorage.removeItem('refresh_token');
          localStorage.removeItem('token_expires_at');
          sessionStorage.removeItem('auth_token');
          sessionStorage.removeItem('refresh_token');
          sessionStorage.removeItem('token_expires_at');
          window.dispatchEvent(new CustomEvent('ws-auth-failed'));
          window.dispatchEvent(new CustomEvent('auth:unauthorized', { detail: { reason: 'websocket_auth_failed' } }));
          return;
        }

        this.attemptReconnect();
      };
      this.startOpenTimeout(socket);
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
    this.clearOpenTimeout();
    this.clearStableOpenTimeout();
    this.reconnectPendingWhileHidden = false;

    this.stopPingInterval();
    this.stopFlushInterval();

    if (this.ws) {
      // FIX: Intentional disconnect cannot be mistaken for transport failure.
      const socket = this.ws;
      this.ws = null;
      socket.close(1000, 'Client initiated disconnect');
    }

    this.reconnectAttempts = 0;
    this.updateState('disconnected');
  }

  private clearOpenTimeout(): void {
    if (this.openTimeout === null) return;
    clearTimeout(this.openTimeout);
    this.openTimeout = null;
  }

  private clearStableOpenTimeout(): void {
    if (this.stableOpenTimeout === null) return;
    clearTimeout(this.stableOpenTimeout);
    this.stableOpenTimeout = null;
  }

  private scheduleStableOpenReset(socket: WebSocket): void {
    this.clearStableOpenTimeout();
    this.stableOpenTimeout = setTimeout(() => {
      this.stableOpenTimeout = null;
      if (this.ws === socket && socket.readyState === WebSocket.OPEN) {
        this.reconnectAttempts = 0;
      }
    }, ENHANCED_WS_STABLE_OPEN_MS);
  }

  private isDocumentHidden(): boolean {
    return typeof document !== 'undefined' && document.visibilityState === 'hidden';
  }

  private isRuntimeSuspended(): boolean {
    return this.isDocumentHidden()
      || (typeof navigator !== 'undefined' && navigator.onLine === false);
  }

  private startOpenTimeout(socket: WebSocket): void {
    this.clearOpenTimeout();
    this.openTimeout = setTimeout(() => {
      this.openTimeout = null;
      if (this.ws !== socket || socket.readyState !== WebSocket.CONNECTING) return;
      if (this.isRuntimeSuspended()) {
        this.reconnectPendingWhileHidden = true;
        return;
      }

      console.warn('[WS] Opening handshake timed out — retrying');
      this.ws = null;
      try { socket.close(4000, 'Opening handshake timed out'); } catch { /* ignore */ }
      this.metrics.lastDisconnectedAt = Date.now();
      this.updateState('disconnected');
      this.notifyMetricsListeners();
      this.attemptReconnect();
    }, ENHANCED_WS_OPEN_TIMEOUT_MS);
  }

  /**
   * Subscribe to a channel
   */
  public subscribe(channel: string, callback: SubscriptionCallback): () => void {
    if (!this.subscribers.has(channel)) {
      this.subscribers.set(channel, new Set());
    }

    this.subscribers.get(channel)!.add(callback);

    // The wildcard is a client-side listener for every received frame. Never
    // ask the server for `channel: '*'`: that would stream every symbol,
    // bypassing the account's group-scoped per-symbol demand.
    if (isLocalOnlyChannel(channel)) {
      return () => {
        const callbacks = this.subscribers.get(channel);
        if (!callbacks) return;
        callbacks.delete(callback);
        if (callbacks.size === 0) this.subscribers.delete(channel);
      };
    }

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

  public hasActiveConsumers(): boolean {
    // FIX: Pool eviction is safe only after every channel/state/metrics owner
    // has detached; otherwise one component could destroy a shared transport.
    return this.subscribers.size > 0
      || this.stateListeners.size > 0
      || this.metricsListeners.size > 0;
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

    // /ws/v2 uses `action` for commands, while older gateways use `type`.
    // Accept either response envelope so a valid pong cannot be discarded.
    const isPong = [data.action, data.type].some((value) => (
      typeof value === 'string' && value.trim().toLowerCase() === 'pong'
    ));
    if (isPong) {
      this.handlePong(data);
      return;
    }

    // Process tick updates immediately for lowest-latency UI updates.
    // Supports fixapibackend format: {type: 'tick', symbol, bid, ask, ...}
    if (type === 'tick' && isEnhancedStoreHandledTickFrame(data)) {
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
    if (type === 'channel_message' || typeof data.channel === 'string') {
      try {
        const payload = data.data as any;
        // App owns account/position state. Transport-side async store writes
        // could overwrite its sparse merges and financial availability flags.
        if (isEnhancedStoreHandledTickFrame(data) && data.channel?.startsWith('ticks.') && payload) {
          const channelSymbol = data.channel.slice('ticks.'.length).trim().toUpperCase();
          const sourceTimestamp = resolveTickSourceTimestampMs(payload, data);
          this.handleFixTick({
            ...payload,
            // The subscribed channel is the exact broker instrument identity;
            // payload.symbol may be an unsuffixed alias (for example EURUSD
            // inside ticks.EURUSD.pro). Preserve the channel identity now that
            // App intentionally no longer writes this same tick a second time.
            symbol: channelSymbol || payload.symbol,
            sourceTimestamp,
          }, data);
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
  private handleFixTick(data: WebSocketMessage, envelope?: WebSocketMessage): void {
    const sourceTimestamp = resolveTickSourceTimestampMs(data);
    const ts = sourceTimestamp ?? Date.now();
    const dailyChangeContext = composeDailyChangeQuoteContext(data, envelope);
    const last = readDailyChangeLastPrice(dailyChangeContext);
    const priceMode = resolveDailyChangePriceMode(data, data.symbol, envelope);
    const bid = Number(data.bid) || 0;
    const ask = Number(data.ask) || bid;
    const previousClose = readDailyChangePreviousClose(dailyChangeContext);
    const dailyOpen = readFirstFiniteNumber(data, ['daily_open', 'dailyOpen', 'open', 'open_price', 'openPrice']);
    const close = readFirstFiniteNumber(data, ['close', 'close_price', 'closePrice']) ?? previousClose;
    const volume = readFirstFiniteNumber(data, [
      'volume',
      'volume_24h',
      'volume24h',
      'tick_volume',
      'tickVolume',
      'real_volume',
      'realVolume',
    ]);
    const lp = readFirstNonEmptyString(data, [
      'lp',
      'provider',
      'liquidity_provider',
      'liquidityProvider',
      'lp_name',
      'lpName',
    ]);
    const session = ((data as any).session ?? {}) as Record<string, unknown>;
    const high = readFirstFiniteNumber(data, ['high']);
    const low = readFirstFiniteNumber(data, ['low']);
    const sessionHigh = Math.max(
      Number(session.high_bid) || 0,
      Number(session.high_ask) || 0,
      high || 0
    );
    const sessionLowValues = [
      Number(session.low_bid) || 0,
      Number(session.low_ask) || 0,
      low || 0,
    ].filter((value) => value > 0);
    const sessionLow = sessionLowValues.length > 0 ? Math.min(...sessionLowValues) : undefined;
    const high24h = readFirstFiniteNumber(data, ['high24h', 'high_24h']) ?? (sessionHigh || undefined);
    const low24h = readFirstFiniteNumber(data, ['low24h', 'low_24h']) ?? sessionLow;
    const dailyChange = resolveDailyChangePercent(
      readDailyChangePercent(dailyChangeContext),
      bid,
      previousClose,
      dailyChangeContext,
      priceMode,
    );
    if (WS_DEBUG) {
      console.log(`[WS TICK] ${data.symbol} bid=${data.bid} ask=${data.ask} spread=${data.spread} ts=${ts} daily=${data.dailyChange}`);
    }

    enqueueLiveTick(data.symbol!, {
      symbol: data.symbol!,
      bid,
      ask,
      spread: Number(data.spread) || (ask - bid),
      timestamp: ts,
      // Do not label Date.now() fallback as broker time. Consumers can order
      // genuine broker events by sourceTimestamp without treating receipt time
      // as proof that the execution quote cache is fresh.
      sourceTimestamp,
      lp,
      volume,
      last,
      dailyChange,
      high24h,
      low24h,
      high,
      low,
      ...readQuoteSessionRange(data),
      open: dailyOpen,
      close,
    });
  }

  /**
   * Handle candle update from fixapibackend
   * Format: {type: 'update', symbol, candle: {time, open, high, low, close, volume}}
   */
  private handleFixCandle(data: WebSocketMessage): void {
    const candle = data.candle as Record<string, unknown> | undefined;
    if (WS_DEBUG && candle) {
      console.log(`[WS CANDLE] ${data.symbol} O=${candle.open} H=${candle.high} L=${candle.low} C=${candle.close} V=${candle.volume}`);
    }
    import('../store/useMarketDataStore').then(({ useMarketDataStore }) => {
      const store = useMarketDataStore.getState();

      if (candle && data.symbol) {
        const candleTime = normalizeBrokerTimestampMs(
          candle.time
          ?? candle.timestamp
          ?? candle.timestamp_ms
          ?? candle.time_ms
          ?? candle.time_msc
          ?? candle.t
          ?? candle.open_time
          ?? candle.openTime,
        );
        if (candleTime === undefined) return;
        // FIX: Preserve both inner and outer final-candle aliases, including
        // string/number booleans, through the canonical market-data store.
        const closed = readCandleFinality([asUnknownRecord(candle), asUnknownRecord(data)]);
        const sourceTimestamp = readBrokerTimestampMs([asUnknownRecord(data)])
          ?? readBrokerTimestampMs([asUnknownRecord(candle)], [
            'sourceTimestamp', 'source_timestamp',
            'event_timestamp', 'eventTimestamp', 'event_time', 'eventTime',
            'server_timestamp', 'serverTimestamp', 'server_time', 'serverTime',
            'updated_at', 'updatedAt', 'revision_time', 'revisionTime',
          ]);
        store.updateCandle({
          symbol: data.symbol,
          timeframe: String(data.timeframe ?? data.period ?? data.tf ?? candle.timeframe ?? candle.period ?? candle.tf ?? 'M1'),
          open: Number(candle.open),
          high: Number(candle.high),
          low: Number(candle.low),
          close: Number(candle.close),
          volume: Number(candle.volume ?? candle.tick_volume ?? candle.tickVolume ?? 0),
          time: candleTime,
          ...(closed === undefined ? {} : { closed }),
          // FIX: Direct candle frames are authoritative backend snapshots;
          // preserve their revision time so delayed frames cannot regress OHLC.
          source: 'server',
          sourceTimestamp,
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

  /** Send the optional application heartbeat used by /ws/v2 gateways. */
  private sendPing(): void {
    if (this.isRuntimeSuspended()) return;
    if (this.ws?.readyState !== WebSocket.OPEN) return;
    if (this.pongTimeout !== null) return;

    const pingTime = Date.now();
    this.lastPingSentAt = pingTime;
    this.lastPingStartedAt = performance.now();
    // Keep `type` for older gateways, but lead with the action-based /ws/v2
    // command shape used by subscribe/unsubscribe on this same connection.
    this.sendMessage({ action: 'ping', type: 'ping', timestamp: pingTime });

    // Capability negotiation: the first unanswered application ping is not
    // evidence of a dead WebSocket. Browsers still receive real transport
    // closure through `onclose`. Once this endpoint has returned any pong,
    // later missed deadlines do provide an actionable liveness signal.
    if (this.pongSupportedUrl !== this.url) return;

    this.pongTimeout = setTimeout(() => {
      this.pongTimeout = null;
      const socket = this.ws;
      if (!socket || socket.readyState !== WebSocket.OPEN) return;
      if (this.isRuntimeSuspended()) {
        this.reconnectPendingWhileHidden = true;
        return;
      }
      // FIX: A zombie OPEN socket must transition through disconnected and
      // reconnect/resubscribe instead of keeping stale margin, orders, and OHLC.
      this.ws = null;
      try { socket.close(4000, 'WebSocket heartbeat timeout'); } catch { /* ignore */ }
      this.metrics.lastDisconnectedAt = Date.now();
      this.updateState('disconnected');
      this.stopPingInterval();
      this.stopFlushInterval();
      this.notifyMetricsListeners();
      this.attemptReconnect();
    }, this.pongTimeoutMs);
  }

  /**
   * Handle pong response

   */
  private handlePong(data: WebSocketMessage): void {
    if (this.pongTimeout) {
      clearTimeout(this.pongTimeout);
      this.pongTimeout = null;
    }

    const now = Date.now();
    this.pongSupportedUrl = this.url;
    const echo = data.ping_timestamp ?? data.request_timestamp ?? data.timestamp ?? (data.data as any)?.timestamp;
    if (this.lastPingSentAt > 0 && echo === this.lastPingSentAt) {
      const latency = performance.now() - this.lastPingStartedAt;
      this.recordLatency(latency);
      this.lastPingSentAt = 0;
    }
    this.lastPongTime = now;
  }

  /**
   * Record latency measurement
   */
  private recordLatency(latency: number): void {
    // FIX: Metrics contain measured application ping/pong RTT only. Never
    // clamp, randomize, or infer latency from tick cadence/server clock skew.
    if (!Number.isFinite(latency) || latency < 0) return;
    const measuredLatency = Math.floor(latency);
    this.latencyMeasurements.push(measuredLatency);
    if (this.latencyMeasurements.length > this.maxLatencyMeasurements) {
      this.latencyMeasurements.shift();
    }

    this.metrics.lastLatency = measuredLatency;
    this.metrics.latencyMeasuredAt = Date.now();
    this.metrics.averageLatency =
      this.latencyMeasurements.reduce((sum, l) => sum + l, 0) /
      this.latencyMeasurements.length;

    this.notifyMetricsListeners();
  }

  /**
   * Attempt to reconnect with exponential backoff (unlimited retries).
   */
  private attemptReconnect(): void {
    if (this.disposed || this.reconnectTimeout || this.reconnectPendingWhileHidden) return;

    if (this.isRuntimeSuspended()) {
      this.reconnectPendingWhileHidden = true;
      this.updateState(typeof navigator !== 'undefined' && navigator.onLine === false ? 'offline' : 'reconnecting');
      return;
    }

    this.reconnectAttempts++;
    this.metrics.reconnectAttempts++;

    // Cap backoff at maxReconnectDelay so we don't wait forever between retries
    const exponentialDelay = Math.min(
      this.baseReconnectDelay * Math.pow(2, Math.min(this.reconnectAttempts - 1, 10)),
      this.maxReconnectDelay
    );
    const delay = addReconnectJitter(exponentialDelay, this.maxReconnectDelay);

    console.log(
      `[WS] Reconnecting in ${delay}ms (attempt ${this.reconnectAttempts})`
    );
    this.updateState('reconnecting');

    this.reconnectTimeout = setTimeout(() => {
      this.reconnectTimeout = null;
      if (this.isRuntimeSuspended()) {
        this.reconnectPendingWhileHidden = true;
        return;
      }
      this.connect();
    }, delay);
  }

  /**
   * Resubscribe to all channels after reconnection
   */
  private resubscribeChannels(): void {
    console.log(`[WS] Resubscribing to ${this.subscribers.size} channels`);

    this.subscribers.forEach((_, channel) => {
      if (isLocalOnlyChannel(channel)) return;

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
    } catch {
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
    if (this.isDocumentHidden()) {
      this.reconnectPendingWhileHidden = true;
      this.updateState('reconnecting');
      return;
    }
    if (this.connectionState === 'offline' || this.connectionState === 'disconnected' || this.reconnectPendingWhileHidden) {
      this.reconnectPendingWhileHidden = false;
      this.forceReconnect();
    }
  };

  /**
   * Handle offline event
   */
  private handleOffline = (): void => {
    console.log('[WS] Network offline');
    // FIX: Suspend every heartbeat/open/reconnect deadline while offline; the
    // online event owns exactly one fresh connection and channel resubscribe.
    this.stopPingInterval();
    this.clearOpenTimeout();
    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout);
      this.reconnectTimeout = null;
    }
    this.reconnectPendingWhileHidden = Boolean(this.ws || this.subscribers.size > 0);
    this.updateState('offline');
  };

  /**
   * Cleanup resources
   */
  public destroy(): void {
    // FIX: Mark disposed before closing because some WebSocket test/browser
    // implementations dispatch onclose synchronously.
    this.disposed = true;
    this.disconnect();

    this.unsubSessionChange?.();
    this.unsubSessionChange = null;

    if (typeof window !== 'undefined') {
      window.removeEventListener('online', this.handleOnline);
      window.removeEventListener('offline', this.handleOffline);
      document.removeEventListener('visibilitychange', this.handleVisibilityChange);
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

    const fallback = normalizeRuntimeWsUrl(buildBrokerWsV2Uri(null));
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

// FIX: Pool by requested transport identity. A dialog or secondary surface
// must not destroy the main account/market socket merely by asking for a
// different endpoint.
const wsInstances = new Map<string, EnhancedWebSocketService>();
let defaultWsInstanceKey: string | null = null;

export const getEnhancedWebSocketService = (url?: string): EnhancedWebSocketService => {
  const normalizedRequestedUrl = (() => {
    if (!url) return undefined;
    if (url.includes('/ws/v2')) return url;
    if (url.includes('fixapibackend.tradecopier.org')) {
      return normalizeRuntimeWsUrl(buildBrokerWsV2Uri(null));
    }
    // Only rewrite known production legacy endpoint, not explicit local test endpoints.
    if (url.includes('rtxbackend') && url.includes('/ws') && !url.includes('fixapi')) {
      return normalizeRuntimeWsUrl(buildBrokerWsV2Uri(null));
    }
    return url;
  })();

  const requestedKey = normalizedRequestedUrl || url;
  if (requestedKey) {
    let instance = wsInstances.get(requestedKey);
    if (!instance) {
      instance = new EnhancedWebSocketService(requestedKey);
      wsInstances.set(requestedKey, instance);
    }
    if (!defaultWsInstanceKey) defaultWsInstanceKey = requestedKey;
    return instance;
  }

  const defaultInstance = defaultWsInstanceKey
    ? wsInstances.get(defaultWsInstanceKey)
    : undefined;
  if (!defaultInstance) {
    throw new Error('WebSocket service not initialized. Provide URL on first call.');
  }
  return defaultInstance;
};

export const releaseEnhancedWebSocketService = (service: EnhancedWebSocketService): void => {
  // FIX: React effect cleanups for channel and listener ownership run in the
  // same task. Defer the idle check once so shared consumers can detach/rebind
  // before deciding whether this URL-keyed transport is truly abandoned.
  queueMicrotask(() => {
    const ownedKeys = Array.from(wsInstances.entries())
      .filter(([, instance]) => instance === service)
      .map(([key]) => key);
    if (ownedKeys.length === 0 || service.hasActiveConsumers()) return;

    service.destroy();
    ownedKeys.forEach((key) => wsInstances.delete(key));
    if (defaultWsInstanceKey && !wsInstances.has(defaultWsInstanceKey)) {
      defaultWsInstanceKey = wsInstances.keys().next().value ?? null;
    }
  });
};

// Export for cleanup
export const destroyWebSocketService = (): void => {
  wsInstances.forEach((instance) => instance.destroy());
  wsInstances.clear();
  defaultWsInstanceKey = null;
};
