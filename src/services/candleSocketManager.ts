/**
 * Chart Candle WebSocket — /ws/v2  (Section 3 of WebSocket Flow)
 *
 * Flow:
 *   1. Chart route active           → Current chart settings (symbol + timeframe)
 *   2. Subscribe hook               → Runs on mount/change (useLiveCandleStream)
 *   3. Candle service demand        → Dedupes consumers by key (SYMBOL.TIMEFRAME)
 *   4. Resolve + authenticate       → Broker URL, token if available (/ws/v2?token=JWT)
 *   5. Send candle subscription     → Channel built dynamically: candles.SYMBOL.TF
 *   6. Incoming OHLC payloads       → Routed by channel/context (handlePayload)
 *   7. Quote tick extension         → Realtime ticks move active candle
 *   8. Canonical candle engine      → liveCandleStream.ingestLiveCandle()
 *   9. Merge live + history         → Preserves trusted REST history
 *  10. Notify chart store           → Stable candle snapshots
 *  11. Chart renders                → Current symbol/timeframe
 */

import {
  buildBrokerWsV2Uri,
  getAccessToken,
  onSessionChange,
  isSessionReady,
} from './brokerSession';
import { isStructurallyValidPriceCandle } from './chartPriceGuards';
import {
  asUnknownRecord,
  normalizeBrokerTimestampMs,
  normalizeBrokerTimestampSeconds,
  readBrokerTimestampMs,
  readCandleFinality,
} from '../utils/brokerStreamSemantics';

// ─── Types ───────────────────────────────────────────────────────────────────

export interface CandlePayload {
  symbol: string;
  timeframe: string;
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  tickVolume?: number;
  realVolume?: number;
  closed?: boolean;
}

export type CandleCallback = (candle: CandlePayload) => void;
export type TickCallback = (tick: { symbol: string; bid: number; ask: number; timestamp: number }) => void;

type CandleConsumerEntry = {
  symbol: string;
  timeframe: string;
  count: number;
  candleCallbacks: Set<CandleCallback>;
  tickCallbacks: Set<TickCallback>;
};

// FIX: Broker symbols are opaque identifiers; the control-plane key uses a
// non-protocol delimiter and never parses dots/hyphens out of the symbol.
const normalizeBrokerSymbol = (symbol: string): string => String(symbol || '').trim().toUpperCase();
const normalizeStreamTimeframe = (timeframe: string): string => String(timeframe || 'M1').trim().toUpperCase();
const consumerKey = (symbol: string, timeframe: string): string => (
  `${normalizeBrokerSymbol(symbol)}\u001f${normalizeStreamTimeframe(timeframe)}`
);

const parseCandleChannel = (channel: string): { symbol: string; timeframe: string } | null => {
  if (!channel.startsWith('candles.')) return null;
  const body = channel.slice('candles.'.length);
  const separatorIndex = body.lastIndexOf('.');
  if (separatorIndex <= 0 || separatorIndex >= body.length - 1) return null;
  return {
    symbol: normalizeBrokerSymbol(body.slice(0, separatorIndex)),
    timeframe: normalizeStreamTimeframe(body.slice(separatorIndex + 1)),
  };
};

export const CANDLE_SOCKET_STABLE_OPEN_MS = 10_000;
const RECONNECT_JITTER_RATIO = 0.2;

const addReconnectJitter = (delay: number, maximum: number): number => {
  const jitter = Math.floor(delay * RECONNECT_JITTER_RATIO * Math.random());
  return Math.min(maximum, delay + jitter);
};

// ─── CandleSocketManager ────────────────────────────────────────────────────

class CandleSocketManager {
  private ws: WebSocket | null = null;
  private wsUrl: string = '';

  // Step 3: Deduped consumers by key SYMBOL.TIMEFRAME → ref count
  private consumers: Map<string, CandleConsumerEntry> = new Map();

  // Reconnect
  private reconnectAttempts = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private openTimeout: ReturnType<typeof setTimeout> | null = null;
  private stableOpenTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectPendingWhileHidden = false;
  private maxReconnectDelay = 30000;
  private baseReconnectDelay = 1000;
  private disposed = false;

  // Ping keepalive
  private pingInterval: ReturnType<typeof setInterval> | null = null;
  private pongTimeout: ReturnType<typeof setTimeout> | null = null;
  private pingIntervalMs = 25000;
  private pongTimeoutMs = 10000;
  private openTimeoutMs = 10000;

  // Session change listener
  private unsubSessionChange: (() => void) | null = null;

  constructor() {
    this.unsubSessionChange = onSessionChange((reason) => {
      if (reason === 'logout') {
        this.closeSocket();
      } else if (
        reason === 'token_rotation'
        || reason === 'broker_url_change'
        || reason === 'login'
        || reason === 'account_change'
      ) {
        // FIX: A demand registered before authentication, or retained during an
        // account switch, must establish a fresh session-owned socket.
        this.forceReconnect();
      }
    });

    if (typeof window !== 'undefined') {
      window.addEventListener('online', this.handleOnline);
      window.addEventListener('offline', this.handleOffline);
      document.addEventListener('visibilitychange', this.handleVisibilityChange);
    }
  }

  // ─── Step 2: Subscribe hook — acquire/release a candle stream ────────────

  /**
   * Subscribe to a candle stream. Returns an unsubscribe function.
   * Multiple subscribers for the same SYMBOL.TIMEFRAME share a single WS channel subscription.
   */
  subscribe(
    symbol: string,
    timeframe: string,
    onCandle?: CandleCallback,
    onTick?: TickCallback,
  ): { unsubscribe: () => void } {
    const normalizedSymbol = normalizeBrokerSymbol(symbol);
    const normalizedTimeframe = normalizeStreamTimeframe(timeframe);
    const key = consumerKey(normalizedSymbol, normalizedTimeframe);

    let entry = this.consumers.get(key);
    if (!entry) {
      entry = {
        symbol: normalizedSymbol,
        timeframe: normalizedTimeframe,
        count: 0,
        candleCallbacks: new Set(),
        tickCallbacks: new Set(),
      };
      this.consumers.set(key, entry);
    }

    entry.count++;
    if (onCandle) entry.candleCallbacks.add(onCandle);
    if (onTick) entry.tickCallbacks.add(onTick);

    // First consumer for this key → send WS subscribe
    if (entry.count === 1) {
      this.ensureConnected();
      this.sendChannelSubscribe(normalizedSymbol, normalizedTimeframe);
    }

    return {
      unsubscribe: () => {
        const current = this.consumers.get(key);
        if (!current) return;

        current.count--;
        if (onCandle) current.candleCallbacks.delete(onCandle);
        if (onTick) current.tickCallbacks.delete(onTick);

        // Last consumer released → unsubscribe from WS channel
        if (current.count <= 0) {
          this.consumers.delete(key);
          this.sendChannelUnsubscribe(normalizedSymbol, normalizedTimeframe);

          // If no consumers left at all, close socket
          if (this.consumers.size === 0) {
            this.closeSocket();
            this.reconnectPendingWhileHidden = false;
            this.reconnectAttempts = 0;
          }
        }
      },
    };
  }

  // ─── Step 4: Resolve + authenticate ──────────────────────────────────────

  private ensureConnected(): void {
    if (this.ws?.readyState === WebSocket.OPEN) return;
    if (this.ws?.readyState === WebSocket.CONNECTING) return;
    if (this.isRuntimeSuspended()) {
      this.reconnectPendingWhileHidden = true;
      return;
    }
    this.connect();
  }

  private connect(): void {
    console.log(`[CandleSocket] connect() called — disposed=${this.disposed}, consumers=${this.consumers.size}`);

    if (this.disposed) return;
    if (this.isRuntimeSuspended()) {
      this.reconnectPendingWhileHidden = this.consumers.size > 0;
      return;
    }
    if (!isSessionReady()) {
      console.warn('[CandleSocket] Session not ready, deferring connect');
      return;
    }

    this.closeSocket();

    const token = getAccessToken();
    this.wsUrl = buildBrokerWsV2Uri(token);

    console.log(`[CandleSocket] Opening WebSocket → ${this.wsUrl.replace(/token=[^&]+/, 'token=***')}`);

    try {
      const socket = new WebSocket(this.wsUrl);
      this.ws = socket;
      this.startOpenTimeout(socket);

      socket.onopen = () => {
        // FIX: Ignore callbacks from a socket replaced during session rotation.
        if (this.ws !== socket || this.disposed) return;
        this.clearOpenTimeout();
        console.log('[CandleSocket] Connected');
        this.startPing();

        // Resubscribe all active consumers
        this.resubscribeAll();
        this.scheduleStableOpenReset(socket);
      };

      socket.onmessage = (event) => {
        // FIX: A late frame from an old broker/account socket must never reach
        // the callbacks owned by the new session.
        if (this.ws !== socket || this.disposed) return;
        this.recordTransportActivity();
        try {
          const data = JSON.parse(event.data);
          this.handleMessage(data);
        } catch (err) {
          console.error('[CandleSocket] Parse error:', err);
        }
      };

      socket.onerror = (err) => {
        if (this.ws !== socket || this.disposed) return;
        console.error('[CandleSocket] Error:', err);
      };

      socket.onclose = (event) => {
        // FIX: Closing a superseded socket cannot stop the new ping loop or
        // schedule a reconnect that tears down the healthy replacement.
        if (this.ws !== socket) return;
        this.clearOpenTimeout();
        this.clearStableOpenTimer();
        this.ws = null;
        console.log(`[CandleSocket] Closed (code: ${event.code})`);
        this.stopPing();

        if ([1008, 4001, 4003, 4401, 4403].includes(event.code)) {
          console.error('[CandleSocket] Auth failure');
          return;
        }

        if (this.consumers.size > 0 && !this.disposed) {
          this.scheduleReconnect();
        }
      };
    } catch (err) {
      console.error('[CandleSocket] Connection failed:', err);
      this.scheduleReconnect();
    }
  }

  // ─── Step 5: Send candle subscription ────────────────────────────────────

  private sendChannelSubscribe(symbol: string, timeframe: string): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;

    const normalizedSymbol = normalizeBrokerSymbol(symbol);
    const candleChannel = `candles.${normalizedSymbol}.${normalizeStreamTimeframe(timeframe)}`;
    const tickChannel = `ticks.${normalizedSymbol}`;

    console.log(`[CandleSocket] Subscribing: ${candleChannel}, ${tickChannel}`);
    [candleChannel, tickChannel].forEach((channel) => {
      this.ws?.send(JSON.stringify({ action: 'subscribe', channel }));
    });
  }

  private sendChannelUnsubscribe(symbol: string, timeframe: string): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;

    const normalizedSymbol = normalizeBrokerSymbol(symbol);
    const candleChannel = `candles.${normalizedSymbol}.${normalizeStreamTimeframe(timeframe)}`;
    // Only unsubscribe ticks if no other consumer uses this symbol
    const symbolStillNeeded = [...this.consumers.values()].some(entry => entry.symbol === normalizedSymbol);

    const channels = [candleChannel];
    if (!symbolStillNeeded) {
      channels.push(`ticks.${normalizedSymbol}`);
    }

    console.log(`[CandleSocket] Unsubscribing: ${channels.join(', ')}`);
    channels.forEach((channel) => {
      this.ws?.send(JSON.stringify({ action: 'unsubscribe', channel }));
    });
  }

  private resubscribeAll(): void {
    this.consumers.forEach((entry) => {
      // FIX: Resubscribe from structured ownership instead of splitting a key;
      // dot-suffixed symbols therefore survive reconnect unchanged.
      this.sendChannelSubscribe(entry.symbol, entry.timeframe);
    });
  }

  // ─── Step 6: Incoming OHLC payloads — handlePayload ──────────────────────

  private handleMessage(data: any): void {
    const { type, channel } = data;

    // Pong
    if (type === 'pong') return;

    // Step 6: Route by channel/context
    if (type === 'channel_message' && channel) {
      const payload = data.data ?? data;

      // Candle channel: candles.SYMBOL.TF
      if (channel.startsWith('candles.')) {
        const parsed = parseCandleChannel(channel);
        if (parsed) this.handleCandlePayload(parsed.symbol, parsed.timeframe, payload, data);
        return;
      }

      // Tick channel: ticks.SYMBOL
      if (channel.startsWith('ticks.')) {
        // FIX: Preserve every suffix character after the protocol prefix.
        const symbol = normalizeBrokerSymbol(channel.slice('ticks.'.length));
        this.handleTickPayload(symbol, payload, data);
        return;
      }
    }

    // Direct tick message (type: 'tick')
    if (type === 'tick' && data.symbol) {
      this.handleTickPayload(normalizeBrokerSymbol(data.symbol), data, data);
      return;
    }

    // Direct candle update (type: 'update')
    if (type === 'update' && data.candle && data.symbol) {
      // FIX: Honor explicit backend timeframe metadata; M1 is only the legacy
      // default for update frames whose contract omits it.
      this.handleCandlePayload(
        normalizeBrokerSymbol(data.symbol),
        normalizeStreamTimeframe(data.timeframe ?? data.period ?? data.tf ?? 'M1'),
        data,
        data,
      );
      return;
    }
  }

  // ─── Step 8: Canonical candle engine ─────────────────────────────────────

  private handleCandlePayload(symbol: string, timeframe: string, payload: any, envelope?: any): void {
    const candle = payload?.candle ?? payload;
    if (!candle) return;
    const tickVolume = Number(
      candle.tick_volume
      ?? candle.tickVolume
      ?? candle.tick_count
      ?? candle.tickCount
      ?? candle.volume
      ?? 0
    );
    const realVolume = Number(candle.real_volume ?? candle.realVolume);
    const candleTime = normalizeBrokerTimestampSeconds(
      candle.time
      ?? candle.Time
      ?? candle.timestamp
      ?? candle.timestamp_ms
      ?? candle.time_ms
      ?? candle.time_msc
      ?? candle.t
      ?? candle.open_time
      ?? candle.openTime,
    );
    // FIX: Finality belongs to the candle even when a broker places the flag
    // on the outer channel/update envelope or serializes booleans as 0/1/text.
    const closed = readCandleFinality([
      asUnknownRecord(candle),
      asUnknownRecord(payload),
      asUnknownRecord(envelope),
    ]);

    const normalized: CandlePayload = {
      symbol: normalizeBrokerSymbol(symbol),
      timeframe: normalizeStreamTimeframe(timeframe),
      // FIX: Candle bucket time is canonical Unix seconds regardless of whether
      // the adapter emitted seconds, ms, us, ns, or ISO text.
      time: candleTime ?? 0,
      open: Number(candle.open ?? 0),
      high: Number(candle.high ?? 0),
      low: Number(candle.low ?? 0),
      close: Number(candle.close ?? 0),
      volume: Number.isFinite(tickVolume) ? tickVolume : 0,
      ...(Number.isFinite(tickVolume) ? { tickVolume } : {}),
      ...(Number.isFinite(realVolume) ? { realVolume } : {}),
      ...(closed !== undefined ? { closed } : {}),
    };

    if (!Number.isFinite(normalized.time)
      || normalized.time <= 0
      || !isStructurallyValidPriceCandle(normalized)) return;

    // Step 10: Notify chart store — fan out to all consumers for this SYMBOL.TF
    const key = consumerKey(normalized.symbol, normalized.timeframe);
    const entry = this.consumers.get(key);
    if (entry) {
      entry.candleCallbacks.forEach((cb) => {
        try { cb(normalized); } catch (e) { console.error('[CandleSocket] candle cb error:', e); }
      });
    }
  }

  // ─── Step 7: Quote tick extension — ticks move active candle ─────────────

  private handleTickPayload(symbol: string, payload: any, envelope?: any): void {
    const bid = Number(payload?.bid ?? 0);
    const ask = Number(payload?.ask ?? bid);
    if (bid <= 0 && ask <= 0) return;

    const tick = {
      symbol: normalizeBrokerSymbol(symbol),
      bid,
      ask,
      // FIX: Retain broker event time across all gateway aliases/epoch units;
      // local receipt time is used only when the transport supplied none.
      timestamp: readBrokerTimestampMs([
        asUnknownRecord(payload),
        asUnknownRecord(envelope),
      ]) ?? normalizeBrokerTimestampMs(Date.now())!,
    };

    // Fan out to all consumers that have this symbol (any timeframe)
    this.consumers.forEach((entry) => {
      if (entry.symbol === tick.symbol) {
        entry.tickCallbacks.forEach((cb) => {
          try { cb(tick); } catch (e) { console.error('[CandleSocket] tick cb error:', e); }
        });
      }
    });
  }

  // ─── Reconnect ──────────────────────────────────────────────────────────

  private scheduleReconnect(): void {
    if (this.disposed || this.reconnectTimer || this.reconnectPendingWhileHidden) return;

    if (this.isRuntimeSuspended()) {
      this.reconnectPendingWhileHidden = true;
      return;
    }

    const exponentialDelay = Math.min(
      this.baseReconnectDelay * Math.pow(2, Math.min(this.reconnectAttempts, 10)),
      this.maxReconnectDelay,
    );
    const delay = addReconnectJitter(exponentialDelay, this.maxReconnectDelay);
    this.reconnectAttempts++;

    console.log(`[CandleSocket] Reconnecting in ${delay}ms (attempt ${this.reconnectAttempts})`);

    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      if (this.isRuntimeSuspended()) {
        this.reconnectPendingWhileHidden = true;
        return;
      }
      this.connect();
    }, delay);
  }

  forceReconnect(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.consumers.size > 0) {
      // FIX: `connect()` intentionally ignores an already-open socket, so a
      // token/broker rotation must close it before opening with fresh session data.
      this.closeSocket();
      if (this.isRuntimeSuspended()) {
        this.reconnectPendingWhileHidden = true;
        return;
      }
      this.reconnectPendingWhileHidden = false;
      this.connect();
    }
  }

  private clearStableOpenTimer(): void {
    if (this.stableOpenTimer === null) return;
    clearTimeout(this.stableOpenTimer);
    this.stableOpenTimer = null;
  }

  private scheduleStableOpenReset(socket: WebSocket): void {
    this.clearStableOpenTimer();
    this.stableOpenTimer = setTimeout(() => {
      this.stableOpenTimer = null;
      if (this.ws === socket && socket.readyState === WebSocket.OPEN) {
        this.reconnectAttempts = 0;
      }
    }, CANDLE_SOCKET_STABLE_OPEN_MS);
  }

  private isDocumentHidden(): boolean {
    return typeof document !== 'undefined' && document.visibilityState === 'hidden';
  }

  private isRuntimeSuspended(): boolean {
    return this.isDocumentHidden()
      || (typeof navigator !== 'undefined' && navigator.onLine === false);
  }

  // ─── Ping keepalive ─────────────────────────────────────────────────────

  private startPing(): void {
    this.stopPing();
    this.pingInterval = setInterval(() => {
      if (this.isRuntimeSuspended()) return;
      if (this.ws?.readyState === WebSocket.OPEN) {
        this.ws.send(JSON.stringify({ type: 'ping', timestamp: Date.now() }));
        if (this.pongTimeout === null) {
          const socket = this.ws;
          this.pongTimeout = setTimeout(() => {
            this.pongTimeout = null;
            if (this.ws !== socket) return;
            if (this.isRuntimeSuspended()) {
              this.reconnectPendingWhileHidden = this.consumers.size > 0;
              return;
            }
            // FIX: Detect an OPEN-but-dead candle transport and rebuild every
            // exact subscription instead of retaining stale forming candles.
            this.ws = null;
            this.clearStableOpenTimer();
            this.stopPing();
            try { socket.close(4000, 'Candle socket heartbeat timeout'); } catch { /* ignore */ }
            if (!this.disposed && this.consumers.size > 0) this.scheduleReconnect();
          }, this.pongTimeoutMs);
        }
      }
    }, this.pingIntervalMs);
  }

  private stopPing(): void {
    if (this.pingInterval) {
      clearInterval(this.pingInterval);
      this.pingInterval = null;
    }
    if (this.pongTimeout !== null) {
      clearTimeout(this.pongTimeout);
      this.pongTimeout = null;
    }
  }

  private recordTransportActivity(): void {
    if (this.pongTimeout === null) return;
    clearTimeout(this.pongTimeout);
    this.pongTimeout = null;
  }

  private clearOpenTimeout(): void {
    if (this.openTimeout === null) return;
    clearTimeout(this.openTimeout);
    this.openTimeout = null;
  }

  private startOpenTimeout(socket: WebSocket): void {
    this.clearOpenTimeout();
    this.openTimeout = setTimeout(() => {
      this.openTimeout = null;
      if (this.ws !== socket || socket.readyState !== WebSocket.CONNECTING) return;
      // FIX: CONNECTING is bounded so a failed handshake cannot permanently
      // suppress session-ready reconnect and resubscription.
      this.ws = null;
      try { socket.close(4000, 'Candle socket open timeout'); } catch { /* ignore */ }
      if (!this.disposed && this.consumers.size > 0) this.scheduleReconnect();
    }, this.openTimeoutMs);
  }

  // ─── Cleanup ─────────────────────────────────────────────────────────────

  private closeSocket(): void {
    this.stopPing();
    this.clearOpenTimeout();
    this.clearStableOpenTimer();
    if (this.ws) {
      // FIX: Detach ownership before close; synchronous/late onclose handlers
      // then recognize this as intentional and cannot schedule a reconnect.
      const socket = this.ws;
      this.ws = null;
      try { socket.close(1000, 'CandleSocketManager closing'); } catch { /* ignore */ }
    }
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }

  destroy(): void {
    this.disposed = true;
    this.closeSocket();
    this.reconnectPendingWhileHidden = false;
    this.reconnectAttempts = 0;
    this.consumers.clear();
    if (this.unsubSessionChange) {
      this.unsubSessionChange();
      this.unsubSessionChange = null;
    }
    if (typeof window !== 'undefined') {
      window.removeEventListener('online', this.handleOnline);
      window.removeEventListener('offline', this.handleOffline);
      document.removeEventListener('visibilitychange', this.handleVisibilityChange);
    }
  }

  // ─── Network handlers ───────────────────────────────────────────────────

  private handleOnline = (): void => {
    console.log('[CandleSocket] Network online — reconnecting');
    if (this.isDocumentHidden()) {
      this.reconnectPendingWhileHidden = this.consumers.size > 0;
      return;
    }
    this.forceReconnect();
  };

  private handleOffline = (): void => {
    console.log('[CandleSocket] Network offline');
    // FIX: Offline/background timer throttling is not transport failure. Stop
    // heartbeat deadlines now and rebuild every exact channel after resume.
    this.stopPing();
    this.clearOpenTimeout();
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.reconnectPendingWhileHidden = this.consumers.size > 0;
  };

  private handleVisibilityChange = (): void => {
    if (this.isDocumentHidden()) {
      // FIX: Browsers throttle background timers; suspend heartbeat ownership
      // and force a clean foreground resubscription instead of false timeout.
      this.stopPing();
      if (this.reconnectTimer) {
        clearTimeout(this.reconnectTimer);
        this.reconnectTimer = null;
        this.reconnectPendingWhileHidden = true;
      }
      return;
    }

    if (typeof navigator !== 'undefined' && navigator.onLine === false) {
      this.reconnectPendingWhileHidden = this.consumers.size > 0;
      return;
    }

    if (!this.reconnectPendingWhileHidden && this.consumers.size === 0) return;
    this.reconnectPendingWhileHidden = false;
    if (!this.disposed && this.consumers.size > 0) this.forceReconnect();
  };

  // ─── Public ─────────────────────────────────────────────────────────────

  isConnected(): boolean {
    return this.ws?.readyState === WebSocket.OPEN;
  }
}

// ─── Singleton ───────────────────────────────────────────────────────────────

let instance: CandleSocketManager | null = null;

export function getCandleSocketManager(): CandleSocketManager {
  if (!instance) {
    instance = new CandleSocketManager();
  }
  return instance;
}

export function destroyCandleSocketManager(): void {
  if (instance) {
    instance.destroy();
    instance = null;
  }
}

export { CandleSocketManager };
