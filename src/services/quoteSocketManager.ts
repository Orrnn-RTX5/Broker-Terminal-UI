/**
 * Quotes Live Bid/Ask WebSocket — /ws/feed  (Section 2 of WebSocket Flow)
 *
 * Flow:
 *   1. Quotes route active          → Screen is mounted/visible
 *   2. Load watchlist               → User's persisted symbols (quoteSymbols)
 *   3. Resolve feed symbols         → Match broker catalog names (resolveQuoteWebSymbols)
 *   4. Set live subscriptions       → Load active watchlist override (setSubscriptions)
 *   5. Merge active demand          → Sticky + row + chart consumers (syncActiveSymbols)
 *   6. Any symbols?                 → No: close socket  |  Yes: connect
 *   7. Open quote socket            → Resolved from broker URL → wss://broker/ws/feed
 *   8. Send subscribe message       → { type: 'subscribe', symbols: [...] }
 *   9. Incoming tick payloads       → processIncomingPayload()
 *  10. Normalize + validate         → Per-symbol raw updates
 *  11. Immediate listeners          → Per-symbol row updates
 *  12. Quote snapshots              → useTickQuoteSnapshot()
 *  13. Quote rows render            → Fast live bid/ask UI
 *  14. Batched store path           → useTradingState.quotes
 */

import {
  buildBrokerWsFeedUri,
  buildBrokerWsV2Uri,
  getAccessToken,
  onSessionChange,
  isSessionReady,
} from './brokerSession';
import { enqueueLiveTick, type LiveTick } from './liveTickDispatcher';
import { useWebSocketStore } from '../store/useWebSocketStore';

// ─── Types ───────────────────────────────────────────────────────────────────

export interface NormalizedQuoteTick {
  symbol: string;
  bid: number;
  ask: number;
  spread: number;
  timestamp: number;
  lp?: string;
  volume?: number;
  dailyChange?: number;
  high24h?: number;
  low24h?: number;
  high?: number;
  low?: number;
  open?: number;
  close?: number;
}

type QuoteTickCallback = (tick: NormalizedQuoteTick) => void;

// ─── Helpers ─────────────────────────────────────────────────────────────────

const toNumber = (v: unknown, fallback = 0): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
};

const normalizeSymbol = (v: unknown): string =>
  typeof v === 'string' ? v.trim().toUpperCase() : '';

// ─── Step 9-10: processIncomingPayload ───────────────────────────────────────

function processIncomingPayload(raw: any): NormalizedQuoteTick | null {
  const payload = raw?.data ?? raw?.tick ?? raw?.quote ?? raw;
  const channelSymbol = raw?.channel?.startsWith('ticks.') ? raw.channel.split('.')[1] : undefined;
  const symbol = normalizeSymbol(payload?.symbol ?? raw?.symbol ?? channelSymbol);
  if (!symbol) return null;

  const bid = toNumber(payload?.bid);
  const ask = toNumber(payload?.ask, bid);
  if (bid <= 0 && ask <= 0) return null;

  const mid = bid > 0 && ask > 0 ? (bid + ask) / 2 : bid || ask;
  const previousClose = toNumber(payload?.previous_close ?? payload?.previousClose);
  const dailyOpen = toNumber(payload?.daily_open ?? payload?.dailyOpen ?? payload?.open);
  const dailyReference = previousClose > 0 ? previousClose : dailyOpen;

  const session = payload?.session ?? {};
  const sessionHigh = Math.max(toNumber(session?.high_bid), toNumber(session?.high_ask), toNumber(payload?.high));
  const sessionLowValues = [toNumber(session?.low_bid), toNumber(session?.low_ask), toNumber(payload?.low)].filter(v => v > 0);
  const sessionLow = sessionLowValues.length > 0 ? Math.min(...sessionLowValues) : undefined;

  return {
    symbol,
    bid,
    ask,
    spread: toNumber(payload?.spread, ask - bid),
    timestamp: (() => {
      const raw = toNumber(payload?.timestamp ?? payload?.time, Date.now());
      return raw > 1_000_000_000_000 ? raw : raw * 1000;
    })(),
    lp: payload?.lp,
    volume: toNumber(payload?.volume, 1),
    dailyChange: payload?.dailyChange !== undefined
      ? toNumber(payload.dailyChange)
      : dailyReference > 0 ? ((mid - dailyReference) / dailyReference) * 100 : undefined,
    high24h: payload?.high24h !== undefined ? toNumber(payload.high24h) : sessionHigh || undefined,
    low24h: payload?.low24h !== undefined ? toNumber(payload.low24h) : sessionLow,
    high: payload?.high !== undefined ? toNumber(payload.high) : undefined,
    low: payload?.low !== undefined ? toNumber(payload.low) : undefined,
    open: dailyOpen || undefined,
    close: (previousClose > 0 || payload?.close !== undefined) ? toNumber(payload?.close ?? previousClose) : undefined,
  };
}

// ─── QuoteSocketManager Singleton ────────────────────────────────────────────

class QuoteSocketManager {
  private ws: WebSocket | null = null;
  private wsUrl: string = '';

  // Step 5: Demand sources — each keyed by sourceId (e.g. "watchlist", "chart-main", "depth-panel")
  private demandSources: Map<string, Set<string>> = new Map();

  // Computed merged set of all active symbols
  private activeSymbols: Set<string> = new Set();

  // Step 11: Immediate per-symbol listeners for UI rows
  private symbolListeners: Map<string, Set<QuoteTickCallback>> = new Map();

  // Global listeners (every tick)
  private globalListeners: Set<QuoteTickCallback> = new Set();

  // Reconnect state
  private reconnectAttempts = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private maxReconnectDelay = 30000;
  private baseReconnectDelay = 1000;
  private disposed = false;

  // Session change unsubscribe
  private unsubSessionChange: (() => void) | null = null;

  constructor() {
    // Listen for session changes (token rotation, logout, broker change)
    this.unsubSessionChange = onSessionChange((reason) => {
      if (reason === 'logout') {
        this.close();
      } else if (reason === 'token_rotation' || reason === 'broker_url_change') {
        // Rebuild URL and reconnect
        this.reconnect();
      }
    });

    // Online/offline
    if (typeof window !== 'undefined') {
      window.addEventListener('online', this.handleOnline);
      window.addEventListener('offline', this.handleOffline);
    }
  }

  // ─── Step 4: Set live subscriptions ──────────────────────────────────────

  /** Register demand from a consumer (watchlist row, chart, depth panel, etc.) */
  setDemand(sourceId: string, symbols: string[]): void {
    const normalized = new Set(symbols.map(normalizeSymbol).filter(Boolean));
    console.log(`[QuoteSocket] setDemand(${sourceId}) → ${[...normalized].join(', ')} (${normalized.size} symbols)`);
    this.demandSources.set(sourceId, normalized);
    this.syncActiveSymbols();
  }

  /** Remove demand from a consumer (unmount). */
  removeDemand(sourceId: string): void {
    this.demandSources.delete(sourceId);
    this.syncActiveSymbols();
  }

  // ─── Step 5: Merge active demand ─────────────────────────────────────────

  private syncActiveSymbols(): void {
    const merged = new Set<string>();
    this.demandSources.forEach((symbols) => {
      symbols.forEach((s) => merged.add(s));
    });

    const oldSymbols = this.activeSymbols;
    this.activeSymbols = merged;

    // Step 6: Any symbols? No → close. Yes → connect.
    if (merged.size === 0) {
      this.close();
      return;
    }

    // If socket not open, connect
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      this.connect();
      return;
    }

    // Diff: compute added/removed symbols
    const added = [...merged].filter((s) => !oldSymbols.has(s));
    const removed = [...oldSymbols].filter((s) => !merged.has(s));

    // Send subscribe for added
    if (added.length > 0) {
      this.sendSubscribe(added);
    }

    // Send unsubscribe for removed
    if (removed.length > 0) {
      this.sendUnsubscribe(removed);
    }
  }

  // ─── Step 7: Open quote socket ───────────────────────────────────────────

  private connect(): void {
    console.log(`[QuoteSocket] connect() called — disposed=${this.disposed}, activeSymbols=${[...this.activeSymbols].join(',')}`);

    if (this.disposed) return;
    if (!isSessionReady()) {
      console.warn('[QuoteSocket] Session not ready, deferring connect');
      return;
    }

    // Close any existing connection
    this.closeSocket();

    const token = getAccessToken();
    this.wsUrl = buildBrokerWsV2Uri(token);

    console.log(`[QuoteSocket] Opening WebSocket → ${this.wsUrl.replace(/token=[^&]+/, 'token=***')}`);

    try {
      this.ws = new WebSocket(this.wsUrl);

      this.ws.onopen = () => {
        console.log(`[QuoteSocket] Connected to ${this.wsUrl}`);
        this.reconnectAttempts = 0;

        // Update global connection state
        try {
          useWebSocketStore.getState().setConnectionState('connected', 'fix_socket');
        } catch { /* store not ready */ }

        // Step 8: Send subscribe for all active symbols
        if (this.activeSymbols.size > 0) {
          this.sendSubscribe([...this.activeSymbols]);
        }
      };

      this.ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          this.handleMessage(data);
        } catch (err) {
          console.error('[QuoteSocket] Failed to parse message:', err);
        }
      };

      this.ws.onerror = (err) => {
        console.error('[QuoteSocket] Error:', err);
      };

      this.ws.onclose = (event) => {
        console.log(`[QuoteSocket] Closed (code: ${event.code}, reason: ${event.reason})`);

        try {
          useWebSocketStore.getState().setConnectionState('disconnected', 'fix_socket');
        } catch { /* store not ready */ }

        // Auth failure — don't reconnect
        if (event.code === 1008 || event.code === 4001) {
          console.error('[QuoteSocket] Auth failure — not reconnecting');
          return;
        }

        // Reconnect if we still have demand
        if (this.activeSymbols.size > 0 && !this.disposed) {
          this.scheduleReconnect();
        }
      };
    } catch (err) {
      console.error('[QuoteSocket] Connection failed:', err);
      this.scheduleReconnect();
    }
  }

  // ─── Step 8: Send subscribe message ──────────────────────────────────────

  private sendSubscribe(symbols: string[]): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;

    symbols.forEach((symbol) => {
      const channel = `ticks.${symbol}`;
      const message = {
        action: 'subscribe',
        channel,
        channels: [channel],
      };
      console.log(`[QuoteSocket] Subscribing to channel: ${channel}`);
      this.ws.send(JSON.stringify(message));
    });
  }

  private sendUnsubscribe(symbols: string[]): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;

    symbols.forEach((symbol) => {
      const channel = `ticks.${symbol}`;
      const message = {
        action: 'unsubscribe',
        channel,
        channels: [channel],
      };
      console.log(`[QuoteSocket] Unsubscribing from channel: ${channel}`);
      this.ws.send(JSON.stringify(message));
    });
  }

  // ─── Step 9-13: Handle incoming tick payloads ────────────────────────────

  private handleMessage(data: any): void {
    // Handle pong
    if (data.type === 'pong') return;

    // Handle subscription confirmation
    if (data.type === 'subscribed' || data.type === 'unsubscribed') {
      console.log(`[QuoteSocket] ${data.type}:`, data.symbols ?? data.channels);
      return;
    }

    // Step 9-10: Normalize tick
    const tick = processIncomingPayload(data);
    if (!tick) return;

    // Step 14: Batched store path — enqueue for rAF-batched Zustand update
    enqueueLiveTick(tick.symbol, tick as LiveTick);

    // Step 11: Immediate per-symbol listeners (for quote row UI)
    const callbacks = this.symbolListeners.get(tick.symbol);
    if (callbacks) {
      callbacks.forEach((cb) => {
        try { cb(tick); } catch (e) { console.error('[QuoteSocket] listener error:', e); }
      });
    }

    // Global listeners
    this.globalListeners.forEach((cb) => {
      try { cb(tick); } catch (e) { console.error('[QuoteSocket] global listener error:', e); }
    });
  }

  // ─── Step 12: Quote snapshots — per-symbol listener registration ─────────

  /** Subscribe to real-time ticks for a specific symbol. Returns unsubscribe fn. */
  onQuoteSnapshot(symbol: string, cb: QuoteTickCallback): () => void {
    const key = normalizeSymbol(symbol);
    if (!this.symbolListeners.has(key)) {
      this.symbolListeners.set(key, new Set());
    }
    this.symbolListeners.get(key)!.add(cb);

    return () => {
      const listeners = this.symbolListeners.get(key);
      if (listeners) {
        listeners.delete(cb);
        if (listeners.size === 0) this.symbolListeners.delete(key);
      }
    };
  }

  /** Subscribe to ALL ticks (wildcard). Returns unsubscribe fn. */
  onAnyQuote(cb: QuoteTickCallback): () => void {
    this.globalListeners.add(cb);
    return () => { this.globalListeners.delete(cb); };
  }

  // ─── Reconnect Logic ────────────────────────────────────────────────────

  private scheduleReconnect(): void {
    if (this.disposed || this.reconnectTimer) return;

    const delay = Math.min(
      this.baseReconnectDelay * Math.pow(2, Math.min(this.reconnectAttempts, 10)),
      this.maxReconnectDelay,
    );
    this.reconnectAttempts++;

    console.log(`[QuoteSocket] Reconnecting in ${delay}ms (attempt ${this.reconnectAttempts})`);

    try {
      useWebSocketStore.getState().setConnectionState('reconnecting', 'fix_socket');
    } catch { /* store not ready */ }

    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, delay);
  }

  /** Force reconnect (e.g. on session change or foreground resume). */
  reconnect(): void {
    this.reconnectAttempts = 0;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.activeSymbols.size > 0) {
      this.connect();
    }
  }

  // ─── Cleanup ─────────────────────────────────────────────────────────────

  private closeSocket(): void {
    if (this.ws) {
      try { this.ws.close(1000, 'QuoteSocketManager closing'); } catch { /* ignore */ }
      this.ws = null;
    }
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }

  close(): void {
    this.closeSocket();
    try {
      useWebSocketStore.getState().setConnectionState('disconnected', 'fix_socket');
    } catch { /* store not ready */ }
  }

  destroy(): void {
    this.disposed = true;
    this.close();
    this.demandSources.clear();
    this.activeSymbols.clear();
    this.symbolListeners.clear();
    this.globalListeners.clear();
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
    console.log('[QuoteSocket] Network online — reconnecting');
    this.reconnect();
  };

  private handleOffline = (): void => {
    console.log('[QuoteSocket] Network offline');
    try {
      useWebSocketStore.getState().setConnectionState('offline', 'fix_socket');
    } catch { /* store not ready */ }
  };

  // ─── Public accessors ───────────────────────────────────────────────────

  getActiveSymbols(): string[] {
    return [...this.activeSymbols];
  }

  isConnected(): boolean {
    return this.ws?.readyState === WebSocket.OPEN;
  }
}

// ─── Singleton ───────────────────────────────────────────────────────────────

let instance: QuoteSocketManager | null = null;

export function getQuoteSocketManager(): QuoteSocketManager {
  if (!instance) {
    instance = new QuoteSocketManager();
  }
  return instance;
}

export function destroyQuoteSocketManager(): void {
  if (instance) {
    instance.destroy();
    instance = null;
  }
}

export { QuoteSocketManager };
