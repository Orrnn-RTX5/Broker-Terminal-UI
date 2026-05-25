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
}

export type CandleCallback = (candle: CandlePayload) => void;
export type TickCallback = (tick: { symbol: string; bid: number; ask: number; timestamp: number }) => void;

// ─── CandleSocketManager ────────────────────────────────────────────────────

class CandleSocketManager {
  private ws: WebSocket | null = null;
  private wsUrl: string = '';

  // Step 3: Deduped consumers by key SYMBOL.TIMEFRAME → ref count
  private consumers: Map<string, {
    count: number;
    candleCallbacks: Set<CandleCallback>;
    tickCallbacks: Set<TickCallback>;
  }> = new Map();

  // Reconnect
  private reconnectAttempts = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private maxReconnectDelay = 30000;
  private baseReconnectDelay = 1000;
  private disposed = false;

  // Ping keepalive
  private pingInterval: ReturnType<typeof setInterval> | null = null;
  private pingIntervalMs = 25000;

  // Session change listener
  private unsubSessionChange: (() => void) | null = null;

  constructor() {
    this.unsubSessionChange = onSessionChange((reason) => {
      if (reason === 'logout') {
        this.closeSocket();
      } else if (reason === 'token_rotation' || reason === 'broker_url_change') {
        this.forceReconnect();
      }
    });

    if (typeof window !== 'undefined') {
      window.addEventListener('online', this.handleOnline);
      window.addEventListener('offline', this.handleOffline);
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
    const key = `${symbol.toUpperCase()}.${timeframe.toUpperCase()}`;

    let entry = this.consumers.get(key);
    if (!entry) {
      entry = { count: 0, candleCallbacks: new Set(), tickCallbacks: new Set() };
      this.consumers.set(key, entry);
    }

    entry.count++;
    if (onCandle) entry.candleCallbacks.add(onCandle);
    if (onTick) entry.tickCallbacks.add(onTick);

    // First consumer for this key → send WS subscribe
    if (entry.count === 1) {
      this.ensureConnected();
      this.sendChannelSubscribe(symbol, timeframe);
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
          this.sendChannelUnsubscribe(symbol, timeframe);

          // If no consumers left at all, close socket
          if (this.consumers.size === 0) {
            this.closeSocket();
          }
        }
      },
    };
  }

  // ─── Step 4: Resolve + authenticate ──────────────────────────────────────

  private ensureConnected(): void {
    if (this.ws?.readyState === WebSocket.OPEN) return;
    if (this.ws?.readyState === WebSocket.CONNECTING) return;
    this.connect();
  }

  private connect(): void {
    console.log(`[CandleSocket] connect() called — disposed=${this.disposed}, consumers=${this.consumers.size}`);

    if (this.disposed) return;
    if (!isSessionReady()) {
      console.warn('[CandleSocket] Session not ready, deferring connect');
      return;
    }

    this.closeSocket();

    const token = getAccessToken();
    this.wsUrl = buildBrokerWsV2Uri(token);

    console.log(`[CandleSocket] Opening WebSocket → ${this.wsUrl.replace(/token=[^&]+/, 'token=***')}`);

    try {
      this.ws = new WebSocket(this.wsUrl);

      this.ws.onopen = () => {
        console.log('[CandleSocket] Connected');
        this.reconnectAttempts = 0;
        this.startPing();

        // Resubscribe all active consumers
        this.resubscribeAll();
      };

      this.ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          this.handleMessage(data);
        } catch (err) {
          console.error('[CandleSocket] Parse error:', err);
        }
      };

      this.ws.onerror = (err) => {
        console.error('[CandleSocket] Error:', err);
      };

      this.ws.onclose = (event) => {
        console.log(`[CandleSocket] Closed (code: ${event.code})`);
        this.stopPing();

        if (event.code === 1008 || event.code === 4001) {
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

    const candleChannel = `candles.${symbol.toUpperCase()}.${timeframe.toUpperCase()}`;
    const tickChannel = `ticks.${symbol.toUpperCase()}`;

    const msg = {
      action: 'subscribe',
      channels: [candleChannel, tickChannel],
    };

    console.log(`[CandleSocket] Subscribing: ${candleChannel}, ${tickChannel}`);
    this.ws.send(JSON.stringify(msg));
  }

  private sendChannelUnsubscribe(symbol: string, timeframe: string): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;

    const candleChannel = `candles.${symbol.toUpperCase()}.${timeframe.toUpperCase()}`;
    // Only unsubscribe ticks if no other consumer uses this symbol
    const symbolStillNeeded = [...this.consumers.keys()].some(k => k.startsWith(`${symbol.toUpperCase()}.`));

    const channels = [candleChannel];
    if (!symbolStillNeeded) {
      channels.push(`ticks.${symbol.toUpperCase()}`);
    }

    const msg = {
      action: 'unsubscribe',
      channels,
    };

    console.log(`[CandleSocket] Unsubscribing: ${channels.join(', ')}`);
    this.ws.send(JSON.stringify(msg));
  }

  private resubscribeAll(): void {
    this.consumers.forEach((_, key) => {
      const [symbol, timeframe] = key.split('.');
      if (symbol && timeframe) {
        this.sendChannelSubscribe(symbol, timeframe);
      }
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
        const parts = channel.split('.');
        const symbol = parts[1] ?? '';
        const timeframe = parts[2] ?? 'M1';
        this.handleCandlePayload(symbol, timeframe, payload);
        return;
      }

      // Tick channel: ticks.SYMBOL
      if (channel.startsWith('ticks.')) {
        const symbol = channel.replace(/^ticks\./i, '').toUpperCase();
        this.handleTickPayload(symbol, payload);
        return;
      }
    }

    // Direct tick message (type: 'tick')
    if (type === 'tick' && data.symbol) {
      this.handleTickPayload(data.symbol.toUpperCase(), data);
      return;
    }

    // Direct candle update (type: 'update')
    if (type === 'update' && data.candle && data.symbol) {
      this.handleCandlePayload(data.symbol.toUpperCase(), 'M1', data);
      return;
    }
  }

  // ─── Step 8: Canonical candle engine ─────────────────────────────────────

  private handleCandlePayload(symbol: string, timeframe: string, payload: any): void {
    const candle = payload?.candle ?? payload;
    if (!candle) return;

    const normalized: CandlePayload = {
      symbol: symbol.toUpperCase(),
      timeframe: timeframe.toUpperCase(),
      time: Number(candle.time ?? candle.timestamp ?? 0),
      open: Number(candle.open ?? 0),
      high: Number(candle.high ?? 0),
      low: Number(candle.low ?? 0),
      close: Number(candle.close ?? 0),
      volume: Number(candle.volume ?? candle.tick_count ?? 0),
    };

    if (!normalized.time || !Number.isFinite(normalized.open)) return;

    // Step 10: Notify chart store — fan out to all consumers for this SYMBOL.TF
    const key = `${normalized.symbol}.${normalized.timeframe}`;
    const entry = this.consumers.get(key);
    if (entry) {
      entry.candleCallbacks.forEach((cb) => {
        try { cb(normalized); } catch (e) { console.error('[CandleSocket] candle cb error:', e); }
      });
    }
  }

  // ─── Step 7: Quote tick extension — ticks move active candle ─────────────

  private handleTickPayload(symbol: string, payload: any): void {
    const bid = Number(payload?.bid ?? 0);
    const ask = Number(payload?.ask ?? bid);
    if (bid <= 0 && ask <= 0) return;

    const tick = {
      symbol: symbol.toUpperCase(),
      bid,
      ask,
      timestamp: (() => {
        const raw = Number(payload?.timestamp ?? payload?.time ?? Date.now());
        return raw > 1_000_000_000_000 ? raw : raw * 1000;
      })(),
    };

    // Fan out to all consumers that have this symbol (any timeframe)
    this.consumers.forEach((entry, key) => {
      if (key.startsWith(`${tick.symbol}.`)) {
        entry.tickCallbacks.forEach((cb) => {
          try { cb(tick); } catch (e) { console.error('[CandleSocket] tick cb error:', e); }
        });
      }
    });
  }

  // ─── Reconnect ──────────────────────────────────────────────────────────

  private scheduleReconnect(): void {
    if (this.disposed || this.reconnectTimer) return;

    const delay = Math.min(
      this.baseReconnectDelay * Math.pow(2, Math.min(this.reconnectAttempts, 10)),
      this.maxReconnectDelay,
    );
    this.reconnectAttempts++;

    console.log(`[CandleSocket] Reconnecting in ${delay}ms (attempt ${this.reconnectAttempts})`);

    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, delay);
  }

  forceReconnect(): void {
    this.reconnectAttempts = 0;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.consumers.size > 0) {
      this.connect();
    }
  }

  // ─── Ping keepalive ─────────────────────────────────────────────────────

  private startPing(): void {
    this.stopPing();
    this.pingInterval = setInterval(() => {
      if (this.ws?.readyState === WebSocket.OPEN) {
        this.ws.send(JSON.stringify({ type: 'ping', timestamp: Date.now() }));
      }
    }, this.pingIntervalMs);
  }

  private stopPing(): void {
    if (this.pingInterval) {
      clearInterval(this.pingInterval);
      this.pingInterval = null;
    }
  }

  // ─── Cleanup ─────────────────────────────────────────────────────────────

  private closeSocket(): void {
    this.stopPing();
    if (this.ws) {
      try { this.ws.close(1000, 'CandleSocketManager closing'); } catch { /* ignore */ }
      this.ws = null;
    }
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }

  destroy(): void {
    this.disposed = true;
    this.closeSocket();
    this.consumers.clear();
    if (this.unsubSessionChange) {
      this.unsubSessionChange();
      this.unsubSessionChange = null;
    }
    if (typeof window !== 'undefined') {
      window.removeEventListener('online', this.handleOnline);
      window.removeEventListener('offline', this.handleOffline);
    }
  }

  // ─── Network handlers ───────────────────────────────────────────────────

  private handleOnline = (): void => {
    console.log('[CandleSocket] Network online — reconnecting');
    this.forceReconnect();
  };

  private handleOffline = (): void => {
    console.log('[CandleSocket] Network offline');
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
