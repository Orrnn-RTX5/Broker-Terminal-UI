/**
 * Quotes Live Bid/Ask WebSocket — public /ws/v2 (Section 2 of WebSocket Flow)
 *
 * Flow:
 *   1. Quotes route active          → Screen is mounted/visible
 *   2. Load watchlist               → User's persisted symbols (quoteSymbols)
 *   3. Resolve feed symbols         → Match broker catalog names (resolveQuoteWebSymbols)
 *   4. Set live subscriptions       → Load active watchlist override (setSubscriptions)
 *   5. Merge active demand          → Sticky + row + chart consumers (syncActiveSymbols)
 *   6. Any symbols?                 → No: close socket  |  Yes: connect
 *   7. Open quote socket            → Public /ws/v2, without token or headers
 *   8. Send subscribe message       → One channel for a single add, channel batches for bulk demand
 *   9. Incoming tick payloads       → processIncomingPayload()
 *  10. Normalize + validate         → Per-symbol raw updates
 *  11. Immediate listeners          → Per-symbol row updates
 *  12. Quote snapshots              → useTickQuoteSnapshot()
 *  13. Quote rows render            → Fast live bid/ask UI
 *  14. Batched store path           → useTradingState.quotes
 */

import {
  buildBrokerWsV2Uri,
  onSessionChange,
} from './brokerSession';
import { enqueueLiveTick, isLiveMarketDataFrozen, type LiveTick } from './liveTickDispatcher';
import { useWebSocketStore } from '../store/useWebSocketStore';
import { readDailyChangePercent, resolveDailyChangePercent } from '../utils/dailyChange';

// ─── Types ───────────────────────────────────────────────────────────────────

export interface NormalizedQuoteTick {
  symbol: string;
  bid: number;
  ask: number;
  spread: number;
  timestamp: number;
  /** Feed-provided event time. Missing when `timestamp` is receipt-time fallback. */
  sourceTimestamp?: number;
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
type QuoteTransport = 'v2';

// ─── Helpers ─────────────────────────────────────────────────────────────────

const toNumber = (v: unknown, fallback = 0): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
};

const normalizeSymbol = (v: unknown): string =>
  typeof v === 'string' ? v.trim().toUpperCase() : '';

const MAX_V2_CHANNELS_PER_FRAME = 500;
const MAX_LOGGED_SYMBOLS = 12;

const summarizeSymbols = (symbols: Iterable<string>): string => {
  const values = Array.from(symbols);
  if (values.length <= MAX_LOGGED_SYMBOLS) return values.join(', ');
  return `${values.slice(0, MAX_LOGGED_SYMBOLS).join(', ')} ... (+${values.length - MAX_LOGGED_SYMBOLS})`;
};

const chunkChannels = (channels: string[]): string[][] => {
  const chunks: string[][] = [];
  for (let index = 0; index < channels.length; index += MAX_V2_CHANNELS_PER_FRAME) {
    chunks.push(channels.slice(index, index + MAX_V2_CHANNELS_PER_FRAME));
  }
  return chunks;
};

const sourceTimestampToMs = (value: unknown): number | undefined => {
  if (value === null || value === undefined || value === '') return undefined;
  const raw = Number(value);
  if (!Number.isFinite(raw) || raw <= 0) return undefined;
  return raw > 1_000_000_000_000 ? raw : raw * 1000;
};

// ─── Step 9-10: processIncomingPayload ───────────────────────────────────────

const QUOTE_PAYLOAD_KEYS = ['data', 'tick', 'quote', 'price', 'payload', 'message', 'prices', 'ticks'] as const;

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null;

const hasQuotePriceFields = (v: unknown): boolean =>
  isRecord(v) && (v.bid !== undefined || v.ask !== undefined);

const getChannelSymbol = (v: unknown): string | undefined => {
  if (!isRecord(v) || typeof v.channel !== 'string') return undefined;
  return v.channel.startsWith('ticks.') ? v.channel.split('.')[1] : undefined;
};

const hasQuoteIdentityFields = (v: unknown): boolean =>
  isRecord(v) && (normalizeSymbol(v.symbol) !== '' || getChannelSymbol(v) !== undefined);

const getDescendantEnvelope = (raw: unknown, envelope: unknown): unknown =>
  hasQuoteIdentityFields(raw) ? raw : envelope;

function collectQuotePayloads(raw: unknown, envelope: unknown = raw): Array<{ payload: Record<string, unknown>; envelope: unknown }> {
  if (typeof raw === 'string') {
    try {
      const parsed = JSON.parse(raw);
      return collectQuotePayloads(parsed, envelope);
    } catch {
      return [];
    }
  }

  if (Array.isArray(raw)) {
    return raw.flatMap((item) => collectQuotePayloads(item, isRecord(envelope) ? envelope : item));
  }

  if (!isRecord(raw)) return [];

  if (hasQuotePriceFields(raw)) {
    return [{ payload: raw, envelope: getDescendantEnvelope(raw, envelope) }];
  }

  const descendantEnvelope = getDescendantEnvelope(raw, envelope);

  return QUOTE_PAYLOAD_KEYS.flatMap((key) => {
    if (!(key in raw)) return [];
    const value = raw[key];

    if (Array.isArray(value)) {
      return value.flatMap((item) => collectQuotePayloads(item, descendantEnvelope));
    }

    return collectQuotePayloads(value, descendantEnvelope);
  });
}

function normalizeQuotePayload(payload: Record<string, unknown>, envelope: unknown): NormalizedQuoteTick | null {
  const channelSymbol = getChannelSymbol(envelope) ?? getChannelSymbol(payload);
  const symbol = normalizeSymbol(payload?.symbol ?? (isRecord(envelope) ? envelope.symbol : undefined) ?? channelSymbol);
  if (!symbol) return null;

  const bid = toNumber(payload?.bid);
  const ask = toNumber(payload?.ask, bid);
  if (bid <= 0 && ask <= 0) return null;

  const previousClose = toNumber(payload?.previous_close ?? payload?.previousClose);
  const dailyOpen = toNumber(payload?.daily_open ?? payload?.dailyOpen ?? payload?.open);

  const session = isRecord(payload.session) ? payload.session : {};
  const sessionHigh = Math.max(toNumber(session?.high_bid), toNumber(session?.high_ask), toNumber(payload?.high));
  const sessionLowValues = [toNumber(session?.low_bid), toNumber(session?.low_ask), toNumber(payload?.low)].filter(v => v > 0);
  const sessionLow = sessionLowValues.length > 0 ? Math.min(...sessionLowValues) : undefined;
  const sourceTimestamp = sourceTimestampToMs(
    payload.timestamp
      ?? payload.time
      ?? (isRecord(envelope) ? envelope.timestamp ?? envelope.time : undefined),
  );

  return {
    symbol,
    bid,
    ask,
    spread: toNumber(payload?.spread, ask - bid),
    timestamp: sourceTimestamp ?? Date.now(),
    sourceTimestamp,
    lp: typeof payload?.lp === 'string' ? payload.lp : undefined,
    volume: toNumber(payload?.volume, 1),
    dailyChange: resolveDailyChangePercent(
      readDailyChangePercent(payload),
      bid,
      previousClose,
    ),
    high24h: payload?.high24h !== undefined ? toNumber(payload.high24h) : sessionHigh || undefined,
    low24h: payload?.low24h !== undefined ? toNumber(payload.low24h) : sessionLow,
    high: payload?.high !== undefined ? toNumber(payload.high) : undefined,
    low: payload?.low !== undefined ? toNumber(payload.low) : undefined,
    open: dailyOpen || undefined,
    close: (previousClose > 0 || payload?.close !== undefined) ? toNumber(payload?.close ?? previousClose) : undefined,
  };
}

function processIncomingPayload(raw: unknown): NormalizedQuoteTick[] {
  return collectQuotePayloads(raw)
    .map(({ payload, envelope }) => normalizeQuotePayload(payload, envelope))
    .filter((tick): tick is NormalizedQuoteTick => tick !== null);
}

// ─── QuoteSocketManager Singleton ────────────────────────────────────────────

class QuoteSocketManager {
  private ws: WebSocket | null = null;
  private wsUrl: string = '';
  // Server-confirmed subscriptions (reconciled from `type:'subscribed'`/`'unsubscribed'`).
  private subscribedSymbols: Set<string> = new Set();
  // In-flight subscribe requests awaiting server confirmation. Kept separate so a
  // symbol the server never confirms is not treated as permanently subscribed —
  // it stays pending only until the next confirmation, unsubscribe, or reconnect.
  private pendingSubscriptions: Set<string> = new Set();

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
  private preferredTransport: QuoteTransport = 'v2';

  // Session change unsubscribe
  private unsubSessionChange: (() => void) | null = null;

  constructor() {
    // Listen for session changes (token rotation, logout, broker change)
    this.unsubSessionChange = onSessionChange((reason) => {
      if (
        reason === 'logout'
        || reason === 'token_rotation'
        || reason === 'broker_url_change'
        || reason === 'login'
      ) {
        // The quote stream is public, but session transitions can change the
        // selected broker origin. Rebuild the URL without attaching the token.
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
    console.log(`[QuoteSocket] setDemand(${sourceId}) → ${summarizeSymbols(normalized)} (${normalized.size} symbols)`);
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

    if (removed.length > 0) {
      this.sendUnsubscribe(removed);
    }
  }

  // ─── Step 7: Open quote socket ───────────────────────────────────────────

  private connect(transport: QuoteTransport = this.preferredTransport): void {
    console.log(`[QuoteSocket] connect() called — disposed=${this.disposed}, transport=${transport}, activeSymbols=${summarizeSymbols(this.activeSymbols)}`);

    if (this.disposed) return;
    const nextTransport: QuoteTransport = transport;
    const nextWsUrl = buildBrokerWsV2Uri(null);
    if (!nextWsUrl) {
      console.warn('[QuoteSocket] Public v2 URL is not ready, deferring connect');
      return;
    }

    // Close any existing connection
    this.closeSocket();

    this.wsUrl = nextWsUrl;
    this.preferredTransport = nextTransport;

    console.log(`[QuoteSocket] Opening ${nextTransport} WebSocket → ${this.wsUrl.replace(/token=[^&]+/, 'token=***')}`);

    try {
      const socket = new WebSocket(this.wsUrl);
      this.ws = socket;
      socket.onopen = () => {
        if (this.ws !== socket) return;

        console.log(`[QuoteSocket] Connected to ${this.wsUrl.replace(/token=[^&]+/, 'token=***')}`);
        this.reconnectAttempts = 0;

        // Update global connection state
        try {
          useWebSocketStore.getState().setConnectionState('connected', 'fix_socket');
        } catch { /* store not ready */ }

        // Step 8: Subscribe only to the symbols demanded by mounted consumers.
        if (this.activeSymbols.size > 0) {
          this.sendSubscribe([...this.activeSymbols]);
        }
      };

      socket.onmessage = (event) => {
        if (this.ws !== socket) return;

        try {
          const data = JSON.parse(event.data);
          this.handleMessage(data);
        } catch (err) {
          console.error('[QuoteSocket] Failed to parse message:', err);
        }
      };

      socket.onerror = (err) => {
        if (this.ws !== socket) return;

        console.error('[QuoteSocket] Error:', err);
      };

      socket.onclose = (event) => {
        if (this.ws !== socket) return;

        console.log(`[QuoteSocket] Closed (code: ${event.code}, reason: ${event.reason})`);
        this.ws = null;
        this.subscribedSymbols.clear();
        this.pendingSubscriptions.clear();

        try {
          useWebSocketStore.getState().setConnectionState('disconnected', 'fix_socket');
        } catch { /* store not ready */ }

        // Policy/authorization failures should not reconnect in a tight loop.
        // Public tick channels require no auth, so this indicates a deployment
        // or endpoint-policy mismatch rather than an expired account token.
        if (event.code === 1008 || event.code === 4001) {
          console.error('[QuoteSocket] Public v2 policy failure — not reconnecting');
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

  private sendSubscribe(symbols: string[] = []): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;

    const requestedSymbols = symbols.length > 0 ? symbols : [...this.activeSymbols];
    const subscriptionSymbols = Array.from(new Set(
      requestedSymbols.map(normalizeSymbol).filter(Boolean)
    )).filter((symbol) => !this.subscribedSymbols.has(symbol) && !this.pendingSubscriptions.has(symbol));
    if (subscriptionSymbols.length === 0) return;

    console.log(`[QuoteSocket] Subscribing to symbols: ${summarizeSymbols(subscriptionSymbols)}`);
    const channels = subscriptionSymbols.map((symbol) => `ticks.${symbol}`);
    chunkChannels(channels).forEach((channelBatch) => {
      const frame = channelBatch.length === 1
        ? { action: 'subscribe', channel: channelBatch[0] }
        : { action: 'subscribe', channels: channelBatch };
      this.ws?.send(JSON.stringify(frame));
    });
    // Mark as pending — promoted to subscribedSymbols only on server confirmation
    // (handleMessage), so a symbol the server rejects can be retried later.
    subscriptionSymbols.forEach((symbol) => this.pendingSubscriptions.add(symbol));
  }

  private sendUnsubscribe(symbols: string[]): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;

    const unsubscribeSymbols = symbols.length > 0 ? symbols : ['*'];
    console.log(`[QuoteSocket] Unsubscribing from symbols: ${summarizeSymbols(unsubscribeSymbols)}`);
    const channels = unsubscribeSymbols.map((symbol) => (
      symbol === '*' ? '*' : `ticks.${normalizeSymbol(symbol)}`
    ));
    chunkChannels(channels).forEach((channelBatch) => {
      const frame = channelBatch.length === 1
        ? { action: 'unsubscribe', channel: channelBatch[0] }
        : { action: 'unsubscribe', channels: channelBatch };
      this.ws?.send(JSON.stringify(frame));
    });
    unsubscribeSymbols.forEach((symbol) => {
      this.subscribedSymbols.delete(symbol);
      this.pendingSubscriptions.delete(symbol);
    });
  }

  // ─── Step 9-13: Handle incoming tick payloads ────────────────────────────

  private handleMessage(data: unknown): void {
    if (!isRecord(data)) return;

    // Handle pong
    if (data.type === 'pong') return;

    // Handle subscription confirmation — reconcile local state with the server's
    // authoritative view so a rejected/unconfirmed symbol is not stranded.
    if (data.type === 'subscribed' || data.type === 'unsubscribed') {
      console.log(`[QuoteSocket] ${data.type}:`, data.symbols ?? data.channels ?? data.channel);
      this.reconcileSubscriptionConfirmation(data.type, data.symbols ?? data.channels ?? data.channel);
      return;
    }

    if (data.type === 'error') {
      const rejectedChannels = data.channels ?? data.channel;
      if (rejectedChannels !== undefined) {
        this.reconcileSubscriptionConfirmation('unsubscribed', rejectedChannels);
      } else {
        // A batch-level validation error is all-or-none. Release every pending
        // entry so later visible demand can retry instead of remaining stranded.
        this.pendingSubscriptions.clear();
      }
      return;
    }

    // Step 9-10: Normalize ticks
    const ticks = processIncomingPayload(data);
    if (ticks.length === 0) return;

    // A live tick is itself proof the server is feeding this symbol — promote it
    // out of pending so reconnect-time bookkeeping reflects reality even if the
    // explicit `subscribed` confirmation was dropped.
    ticks.forEach((tick) => {
      if (this.pendingSubscriptions.delete(tick.symbol)) {
        this.subscribedSymbols.add(tick.symbol);
      }
    });

    ticks.forEach((tick) => {
      if (isLiveMarketDataFrozen(tick.symbol)) return;

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
    });
  }

  /**
   * Reconcile local subscribe state against a server confirmation message.
   *
   * `subscribed`   → the listed symbols are confirmed live: promote them from
   *                  pending to subscribed.
   * `unsubscribed` → the listed symbols are no longer served (explicit unsub or
   *                  a rejection): drop them from both sets so a later re-add is
   *                  not silently filtered and can retry without a full reconnect.
   *
   * Accepts either bare symbols (`'EURUSD'`) or feed channels (`'ticks.eurusd'`).
   */
  private reconcileSubscriptionConfirmation(type: 'subscribed' | 'unsubscribed', list: unknown): void {
    const confirmedItems = Array.isArray(list)
      ? list
      : typeof list === 'string'
        ? [list]
        : [];
    if (confirmedItems.length === 0) return;

    const symbols = confirmedItems
      .map((entry) => {
        const raw = typeof entry === 'string' ? entry : '';
        const symbolPart = raw.startsWith('ticks.') ? raw.slice('ticks.'.length) : raw;
        return normalizeSymbol(symbolPart);
      })
      .filter(Boolean);

    if (type === 'subscribed') {
      symbols.forEach((symbol) => {
        this.pendingSubscriptions.delete(symbol);
        this.subscribedSymbols.add(symbol);
      });
    } else {
      symbols.forEach((symbol) => {
        this.pendingSubscriptions.delete(symbol);
        this.subscribedSymbols.delete(symbol);
      });
    }
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
    this.preferredTransport = 'v2';
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
      const socket = this.ws;
      this.ws = null;
      try { socket.close(1000, 'QuoteSocketManager closing'); } catch { /* ignore */ }
    }
    this.subscribedSymbols.clear();
    this.pendingSubscriptions.clear();
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }

  close(): void {
    this.closeSocket();
    this.preferredTransport = 'v2';
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
