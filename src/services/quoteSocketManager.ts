/**
 * Quotes Live Bid/Ask WebSocket — broker `/ws/feed` preferred, authenticated
 * `/ws/v2` failover (Section 2 of WebSocket Flow)
 *
 * Flow:
 *   1. Quotes route active          → Screen is mounted/visible
 *   2. Load watchlist               → User's persisted symbols (quoteSymbols)
 *   3. Resolve feed symbols         → Match broker catalog names (resolveQuoteWebSymbols)
 *   4. Set live subscriptions       → Load active watchlist override (setSubscriptions)
 *   5. Merge active demand          → Sticky + row + chart consumers (syncActiveSymbols)
 *   6. Any symbols?                 → No: close socket  |  Yes: connect
 *   7. Open quote socket            → Prefer the anonymous /ws/feed; on handshake
 *                                     failure fall over to authenticated /ws/v2 with
 *                                     the same demand union
 *   8. Send subscribe message       → feed: {type:'subscribe',symbols:[...]},
 *                                     v2: one exact channel envelope per symbol
 *   9. Incoming tick payloads       → processIncomingQuotePayload()
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
} from './brokerSession';
import { enqueueLiveTick, isLiveMarketDataFrozen, type LiveTick } from './liveTickDispatcher';
import { resetTerminalQuoteFreshness, terminalQuoteFreshnessEnabled } from './terminalQuoteFreshness';
import { useWebSocketStore } from '../store/useWebSocketStore';
import {
  processIncomingQuotePayload,
  type NormalizedQuoteTick,
} from './quotePayloadNormalizer';
import {
  AUTH_CLOSE_CODES,
  MAX_FEED_SYMBOLS_PER_FRAME,
  QUOTE_SOCKET_HEARTBEAT_INTERVAL_MS,
  QUOTE_SOCKET_MAX_SUBSCRIPTION_RETRIES,
  QUOTE_SOCKET_OPEN_TIMEOUT_MS,
  QUOTE_SOCKET_PONG_TIMEOUT_MS,
  QUOTE_SOCKET_STABLE_OPEN_MS,
  QUOTE_SOCKET_SUBSCRIPTION_ACK_TIMEOUT_MS,
  addQuoteReconnectJitter as addReconnectJitter,
  chunkQuoteSymbols as chunkStrings,
  collectQuoteConfirmationItems,
  isQuoteMessageRecord as isRecord,
  normalizeQuoteConfirmationItems,
  normalizeQuoteSymbol as normalizeSymbol,
  redactQuoteSocketUrl as redactWsUrl,
  summarizeQuoteSymbols as summarizeSymbols,
} from './quoteSocketProtocol';

export type { NormalizedQuoteTick } from './quotePayloadNormalizer';
export {
  QUOTE_SOCKET_HEARTBEAT_INTERVAL_MS,
  QUOTE_SOCKET_MAX_SUBSCRIPTION_RETRIES,
  QUOTE_SOCKET_OPEN_TIMEOUT_MS,
  QUOTE_SOCKET_PONG_TIMEOUT_MS,
  QUOTE_SOCKET_STABLE_OPEN_MS,
  QUOTE_SOCKET_SUBSCRIPTION_ACK_TIMEOUT_MS,
} from './quoteSocketProtocol';

// ─── Types ───────────────────────────────────────────────────────────────────

type QuoteTickCallback = (tick: NormalizedQuoteTick) => void;
export type QuoteTransport = 'feed' | 'v2';

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
  private openTimeout: ReturnType<typeof setTimeout> | null = null;
  private stableOpenTimer: ReturnType<typeof setTimeout> | null = null;
  private subscriptionAckTimeout: ReturnType<typeof setTimeout> | null = null;
  private subscriptionRetryTimer: ReturnType<typeof setTimeout> | null = null;
  private subscriptionRetrySymbols: Set<string> = new Set();
  private subscriptionAttempts: Map<string, number> = new Map();
  private heartbeatInterval: ReturnType<typeof setInterval> | null = null;
  private pongTimeout: ReturnType<typeof setTimeout> | null = null;
  private idleCloseTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectPendingWhileHidden = false;
  private maxReconnectDelay = 30000;
  private baseReconnectDelay = 1000;
  private disposed = false;

  // Transport selection — prefer broker /ws/feed; fall over to authenticated
  // /ws/v2 for the same demand union when the feed handshake/auth fails.
  private activeTransport: QuoteTransport = 'v2';
  /** Feed credential was rejected this session; do not retry feed until the session/network resets. */
  private feedAuthFailed = false;
  /** True while serving quotes over v2 even though feed credentials exist. */
  private fallbackActive = false;

  // Session change unsubscribe
  private unsubSessionChange: (() => void) | null = null;

  constructor() {
    // Listen for session changes (token rotation, logout, broker change).
    // The anonymous feed has no account credential to renew. Keep a healthy,
    // unchanged feed through login; private v2 sockets still reauthenticate.
    this.unsubSessionChange = onSessionChange((reason) => {
      if (
        reason === 'logout'
        || reason === 'token_rotation'
        || reason === 'broker_url_change'
        || reason === 'login'
        || reason === 'account_change'
      ) {
        if (reason !== 'broker_url_change'
          && this.activeTransport === 'feed'
          && this.ws?.readyState === WebSocket.OPEN
          && this.wsUrl === buildBrokerWsFeedUri()) {
          return;
        }
        this.resetFeedFailure();
        this.reconnect();
      }
    });

    // Online/offline
    if (typeof window !== 'undefined') {
      window.addEventListener('online', this.handleOnline);
      window.addEventListener('offline', this.handleOffline);
      document.addEventListener('visibilitychange', this.handleVisibilityChange);
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
      this.scheduleIdleClose();
      return;
    }

    this.cancelIdleClose();

    if (this.ws?.readyState === WebSocket.CONNECTING) return;

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

  /**
   * Transport selection for the next connection attempt.
   *
   * Prefer the broker `/ws/feed` whenever a feed URL can be resolved. The feed
   * accepts anonymous connections, so no credential is required. If the feed
   * handshake failed earlier in this session, fail the demand union over to
   * `/ws/v2` — but only for authenticated terminal sessions. Anonymous sessions
   * never attempt account-authenticated v2; they retry the feed with backoff.
   */
  private resolveTransport(): QuoteTransport {
    const feedAvailable = Boolean(buildBrokerWsFeedUri());
    if (!feedAvailable) return 'v2';
    if (!this.feedAuthFailed) return 'feed';
    return getAccessToken() ? 'v2' : 'feed';
  }

  private buildTransportUrl(transport: QuoteTransport): string {
    if (transport === 'feed') return buildBrokerWsFeedUri();
    // Authenticated terminal sessions must not fall back to an anonymous v2
    // quote stream; attach the account token whenever one exists.
    return getAccessToken() ? buildBrokerWsV2Uri() : buildBrokerWsV2Uri(null);
  }

  private resetFeedFailure(): void {
    this.feedAuthFailed = false;
    this.fallbackActive = false;
  }

  private publishQuoteTransport(): void {
    try {
      useWebSocketStore.getState().setQuoteTransportState?.(
        this.ws ? this.activeTransport : 'none',
        this.fallbackActive,
      );
    } catch { /* store not ready */ }
  }

  private isFeedAuthErrorText(data: Record<string, unknown>): boolean {
    if (this.activeTransport !== 'feed') return false;
    const text = [data.code, data.message, data.error, data.reason]
      .map((value) => (typeof value === 'string' ? value : ''))
      .join(' ')
      .toLowerCase();
    if (!text) return false;
    return /token[_ ]?mismatch|unauthori[sz]ed|invalid[_ ]?token|auth(?:entication)?[_ ]?(?:failed|error|rejected)/.test(text);
  }

  /** Fail the whole demand union over to authenticated /ws/v2 without backoff. */
  private failOverToV2(reason: string): boolean {
    if (!getAccessToken()) return false;
    console.warn(`[QuoteSocket] ${reason} — failing over to authenticated v2`);
    this.feedAuthFailed = true;
    this.cancelScheduledReconnect();
    this.closeSocket();
    if (this.isRuntimeSuspended()) {
      this.reconnectPendingWhileHidden = true;
      try {
        useWebSocketStore.getState().setConnectionState('reconnecting', 'fix_socket');
      } catch { /* store not ready */ }
      return true;
    }
    this.connect();
    return true;
  }

  private cancelScheduledReconnect(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }

  private connect(): void {
    if (this.disposed) return;
    if (this.isRuntimeSuspended()) {
      // FIX: Defer handshakes while background/offline so timer clamping cannot
      // create a false failure; resume establishes all exact symbol channels.
      this.reconnectPendingWhileHidden = this.activeSymbols.size > 0;
      return;
    }
    if (
      this.ws?.readyState === WebSocket.OPEN
      || this.ws?.readyState === WebSocket.CONNECTING
    ) {
      return;
    }
    const nextTransport = this.resolveTransport();
    const nextWsUrl = this.buildTransportUrl(nextTransport);
    if (!nextWsUrl) {
      console.warn(`[QuoteSocket] ${nextTransport} URL is not ready, deferring connect`);
      return;
    }

    // Close any existing connection
    this.closeSocket();

    this.wsUrl = nextWsUrl;
    this.activeTransport = nextTransport;
    this.fallbackActive = nextTransport === 'v2' && this.feedAuthFailed;

    console.log(`[QuoteSocket] Opening ${nextTransport} WebSocket → ${redactWsUrl(this.wsUrl)}`);

    try {
      const socket = new WebSocket(this.wsUrl);
      this.ws = socket;
      let opened = false;

      socket.onopen = () => {
        if (this.ws !== socket) return;
        if (terminalQuoteFreshnessEnabled()) {
          resetTerminalQuoteFreshness();
          window.dispatchEvent(new Event('rtx:quote-clock-refresh'));
        }
        opened = true;
        this.clearOpenTimeout();
        // FIX: Use transport ping/pong for liveness so a quiet market does not
        // leave an OPEN-but-dead quote socket displaying stale prices.
        this.startHeartbeat(socket);

        console.log(`[QuoteSocket] Connected to ${redactWsUrl(this.wsUrl)} (${nextTransport})`);

        // Update global connection state
        try {
          useWebSocketStore.getState().setConnectionState('connected', 'fix_socket');
        } catch { /* store not ready */ }
        this.publishQuoteTransport();

        // Step 8: Subscribe only to the symbols demanded by mounted consumers.
        if (this.activeSymbols.size > 0) {
          this.sendSubscribe([...this.activeSymbols]);
        }
        this.scheduleStableOpenReset(socket);
      };

      socket.onmessage = (event) => {
        if (this.ws !== socket) return;
        this.recordTransportActivity();

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
        if (terminalQuoteFreshnessEnabled()) resetTerminalQuoteFreshness();
        this.clearOpenTimeout();
        this.clearStableOpenTimer();
        this.clearHeartbeat();
        this.clearSubscriptionTimers(true);

        console.log(`[QuoteSocket] ${nextTransport} closed (code: ${event.code}, reason: ${event.reason})`);
        this.ws = null;
        this.subscribedSymbols.clear();
        this.pendingSubscriptions.clear();

        try {
          useWebSocketStore.getState().setConnectionState('disconnected', 'fix_socket');
        } catch { /* store not ready */ }
        this.publishQuoteTransport();

        if (this.disposed) return;

        // Feed handshake rejection (a 401 handshake surfaces as a pre-open
        // close) or an explicit auth close code: move the same demand union to
        // authenticated v2 immediately when the session has an account token.
        if (
          nextTransport === 'feed'
          && (!opened || AUTH_CLOSE_CODES.has(event.code))
          && this.failOverToV2('Feed auth/handshake failure')
        ) {
          return;
        }

        // Policy/authorization failures on v2 have no further fallback.
        if (nextTransport === 'v2' && AUTH_CLOSE_CODES.has(event.code)) {
          console.error('[QuoteSocket] v2 policy failure — not reconnecting');
          return;
        }

        // Reconnect if we still have demand
        if (this.activeSymbols.size > 0) {
          this.scheduleReconnect();
        }
      };
      this.startOpenTimeout(socket);
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

    console.log(`[QuoteSocket] Subscribing on ${this.activeTransport}: ${summarizeSymbols(subscriptionSymbols)}`);
    if (this.activeTransport === 'feed') {
      chunkStrings(subscriptionSymbols, MAX_FEED_SYMBOLS_PER_FRAME).forEach((batch) => {
        this.ws?.send(JSON.stringify({ type: 'subscribe', symbols: batch }));
      });
    } else {
      // One exact channel envelope per symbol — the deployed v2 contract.
      subscriptionSymbols.forEach((symbol) => {
        const channel = `ticks.${symbol}`;
        this.ws?.send(JSON.stringify({ action: 'subscribe', channel, channels: [channel] }));
      });
    }
    // Mark as pending — promoted to subscribedSymbols only on server confirmation
    // (handleMessage), so a symbol the server rejects can be retried later.
    subscriptionSymbols.forEach((symbol) => this.pendingSubscriptions.add(symbol));
    // FIX: Missing acknowledgements are retried under a bounded policy while
    // the exact symbol remains demanded.
    this.scheduleSubscriptionAckTimeout();
  }

  private sendUnsubscribe(symbols: string[]): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;

    const unsubscribeSymbols = symbols.length > 0 ? symbols : ['*'];
    console.log(`[QuoteSocket] Unsubscribing on ${this.activeTransport}: ${summarizeSymbols(unsubscribeSymbols)}`);
    if (this.activeTransport === 'feed') {
      const feedSymbols = unsubscribeSymbols
        .map((symbol) => (symbol === '*' ? '*' : normalizeSymbol(symbol)))
        .filter(Boolean);
      chunkStrings(feedSymbols, MAX_FEED_SYMBOLS_PER_FRAME).forEach((batch) => {
        this.ws?.send(JSON.stringify({ type: 'unsubscribe', symbols: batch }));
      });
    } else {
      unsubscribeSymbols.forEach((symbol) => {
        if (symbol === '*') {
          this.ws?.send(JSON.stringify({ action: 'unsubscribe', channel: '*' }));
          return;
        }
        const channel = `ticks.${normalizeSymbol(symbol)}`;
        this.ws?.send(JSON.stringify({ action: 'unsubscribe', channel, channels: [channel] }));
      });
    }
    unsubscribeSymbols.forEach((symbol) => {
      this.subscribedSymbols.delete(symbol);
      this.pendingSubscriptions.delete(symbol);
      this.subscriptionAttempts.delete(symbol);
      this.subscriptionRetrySymbols.delete(symbol);
    });
    this.scheduleSubscriptionAckTimeout();
  }

  // ─── Step 9-13: Handle incoming tick payloads ────────────────────────────

  private handleMessage(data: unknown): void {
    if (!isRecord(data)) return;

    // Handle pong
    if (data.type === 'pong') return;

    // Handle subscription confirmation — reconcile local state with the server's
    // authoritative view so a rejected/unconfirmed symbol is not stranded.
    // Either transport may confirm with singular `channel`, array `channels`,
    // or `symbols`; collect every provided form instead of picking one.
    if (data.type === 'subscribed' || data.type === 'unsubscribed') {
      const confirmedItems = collectQuoteConfirmationItems(data);
      console.log(`[QuoteSocket] ${data.type}:`, confirmedItems.join(', '));
      const confirmedSymbols = this.reconcileSubscriptionConfirmation(data.type, confirmedItems);
      if (data.type === 'unsubscribed') this.retryRejectedSubscriptions(confirmedSymbols);
      return;
    }

    if (data.type === 'error') {
      // In-band feed credential rejection (e.g. broker_token_mismatch) fails
      // the demand union over to authenticated v2 the same way a handshake
      // rejection does.
      if (this.isFeedAuthErrorText(data) && this.failOverToV2('Feed credential rejected in-band')) {
        return;
      }

      const rejectedItems = collectQuoteConfirmationItems(data);
      if (rejectedItems.length > 0) {
        const rejectedSymbols = this.reconcileSubscriptionConfirmation('unsubscribed', rejectedItems);
        this.retryRejectedSubscriptions(rejectedSymbols);
      } else {
        // A batch-level validation error is all-or-none. Release every pending
        // entry so later visible demand can retry instead of remaining stranded.
        const rejectedSymbols = [...this.pendingSubscriptions];
        this.pendingSubscriptions.clear();
        this.retryRejectedSubscriptions(rejectedSymbols);
      }
      return;
    }

    // Step 9-10: Normalize ticks
    const ticks = processIncomingQuotePayload(data);
    if (ticks.length === 0) return;

    // A live tick is itself proof the server is feeding this symbol — promote it
    // out of pending so reconnect-time bookkeeping reflects reality even if the
    // explicit `subscribed` confirmation was dropped.
    ticks.forEach((tick) => {
      if (this.pendingSubscriptions.delete(tick.symbol)) {
        this.subscribedSymbols.add(tick.symbol);
      }
      this.subscriptionAttempts.delete(tick.symbol);
      this.subscriptionRetrySymbols.delete(tick.symbol);
    });
    this.scheduleSubscriptionAckTimeout();

    ticks.forEach((tick) => {
      if (isLiveMarketDataFrozen(tick.symbol)) return;

      // Step 14: Batched store path — enqueue for rAF-batched Zustand update
      if (!enqueueLiveTick(tick.symbol, tick as LiveTick)) return;

      // Last-only display metadata is intentionally isolated from raw quote
      // listeners: the selected-chart listener treats every callback as an
      // executable Bid/Ask candle input.
      if (tick.bid <= 0 && tick.ask <= 0) return;

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
  private reconcileSubscriptionConfirmation(type: 'subscribed' | 'unsubscribed', list: unknown): string[] {
    const symbols = normalizeQuoteConfirmationItems(list);
    if (symbols.length === 0) return [];

    if (type === 'subscribed') {
      symbols.forEach((symbol) => {
        this.pendingSubscriptions.delete(symbol);
        this.subscribedSymbols.add(symbol);
        this.subscriptionAttempts.delete(symbol);
        this.subscriptionRetrySymbols.delete(symbol);
      });
    } else {
      symbols.forEach((symbol) => {
        this.pendingSubscriptions.delete(symbol);
        this.subscribedSymbols.delete(symbol);
      });
    }
    this.scheduleSubscriptionAckTimeout();
    return symbols;
  }

  // ─── Step 12: Quote snapshots — per-symbol listener registration ─────────

  private clearSubscriptionAckTimeout(): void {
    if (this.subscriptionAckTimeout === null) return;
    clearTimeout(this.subscriptionAckTimeout);
    this.subscriptionAckTimeout = null;
  }

  private clearSubscriptionTimers(resetAttempts = false): void {
    this.clearSubscriptionAckTimeout();
    if (this.subscriptionRetryTimer !== null) clearTimeout(this.subscriptionRetryTimer);
    this.subscriptionRetryTimer = null;
    this.subscriptionRetrySymbols.clear();
    if (resetAttempts) this.subscriptionAttempts.clear();
  }

  private scheduleSubscriptionAckTimeout(): void {
    this.clearSubscriptionAckTimeout();
    if (
      this.disposed
      || this.pendingSubscriptions.size === 0
      || !this.ws
      || this.ws.readyState !== WebSocket.OPEN
    ) return;

    this.subscriptionAckTimeout = setTimeout(() => {
      this.subscriptionAckTimeout = null;
      const unconfirmed = [...this.pendingSubscriptions].filter((symbol) => this.activeSymbols.has(symbol));
      unconfirmed.forEach((symbol) => this.pendingSubscriptions.delete(symbol));
      // FIX: An ACK deadline releases the pending marker before retrying, so a
      // lost server confirmation cannot suppress every future subscribe frame.
      this.retryRejectedSubscriptions(unconfirmed);
      this.scheduleSubscriptionAckTimeout();
    }, QUOTE_SOCKET_SUBSCRIPTION_ACK_TIMEOUT_MS);
  }

  private retryRejectedSubscriptions(symbols: readonly string[]): void {
    symbols.forEach((symbol) => {
      if (!this.activeSymbols.has(symbol) || this.subscribedSymbols.has(symbol)) return;
      const attempt = (this.subscriptionAttempts.get(symbol) ?? 0) + 1;
      this.subscriptionAttempts.set(symbol, attempt);
      if (attempt <= QUOTE_SOCKET_MAX_SUBSCRIPTION_RETRIES) {
        this.subscriptionRetrySymbols.add(symbol);
      } else {
        console.error(`[QuoteSocket] Subscription was not confirmed after ${attempt - 1} retries: ${symbol}`);
      }
    });

    if (this.subscriptionRetrySymbols.size === 0 || this.subscriptionRetryTimer !== null) return;
    this.subscriptionRetryTimer = setTimeout(() => {
      this.subscriptionRetryTimer = null;
      const retrySymbols = [...this.subscriptionRetrySymbols].filter((symbol) => this.activeSymbols.has(symbol));
      this.subscriptionRetrySymbols.clear();
      this.sendSubscribe(retrySymbols);
    }, QUOTE_SOCKET_SUBSCRIPTION_ACK_TIMEOUT_MS);
  }

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
    if (this.disposed || this.reconnectTimer || this.reconnectPendingWhileHidden) return;

    if (this.isRuntimeSuspended()) {
      this.reconnectPendingWhileHidden = true;
      try {
        useWebSocketStore.getState().setConnectionState('reconnecting', 'fix_socket');
      } catch { /* store not ready */ }
      return;
    }

    const exponentialDelay = Math.min(
      this.baseReconnectDelay * Math.pow(2, Math.min(this.reconnectAttempts, 10)),
      this.maxReconnectDelay,
    );
    const delay = addReconnectJitter(exponentialDelay, this.maxReconnectDelay);
    this.reconnectAttempts++;

    console.log(`[QuoteSocket] Reconnecting in ${delay}ms (attempt ${this.reconnectAttempts})`);

    try {
      useWebSocketStore.getState().setConnectionState('reconnecting', 'fix_socket');
    } catch { /* store not ready */ }

    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      if (this.isRuntimeSuspended()) {
        this.reconnectPendingWhileHidden = true;
        return;
      }
      this.connect();
    }, delay);
  }

  private clearOpenTimeout(): void {
    if (this.openTimeout === null) return;
    clearTimeout(this.openTimeout);
    this.openTimeout = null;
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
    }, QUOTE_SOCKET_STABLE_OPEN_MS);
  }

  private isDocumentHidden(): boolean {
    return typeof document !== 'undefined' && document.visibilityState === 'hidden';
  }

  private isRuntimeSuspended(): boolean {
    return this.isDocumentHidden()
      || (typeof navigator !== 'undefined' && navigator.onLine === false);
  }

  private recordTransportActivity(): void {
    if (this.pongTimeout === null) return;
    clearTimeout(this.pongTimeout);
    this.pongTimeout = null;
  }

  private clearHeartbeat(): void {
    if (this.heartbeatInterval !== null) clearInterval(this.heartbeatInterval);
    if (this.pongTimeout !== null) clearTimeout(this.pongTimeout);
    this.heartbeatInterval = null;
    this.pongTimeout = null;
  }

  private startHeartbeat(socket: WebSocket): void {
    this.clearHeartbeat();
    this.heartbeatInterval = setInterval(() => {
      if (this.ws !== socket || socket.readyState !== WebSocket.OPEN || this.isRuntimeSuspended()) return;
      if (this.pongTimeout !== null) return;

      try {
        socket.send(JSON.stringify({ type: 'ping', timestamp: Date.now() }));
      } catch {
        this.handleHeartbeatTimeout(socket);
        return;
      }
      this.pongTimeout = setTimeout(
        () => this.handleHeartbeatTimeout(socket),
        QUOTE_SOCKET_PONG_TIMEOUT_MS,
      );
    }, QUOTE_SOCKET_HEARTBEAT_INTERVAL_MS);
  }

  private handleHeartbeatTimeout(socket: WebSocket): void {
    if (this.ws !== socket) return;
    if (this.isRuntimeSuspended()) {
      this.clearHeartbeat();
      this.reconnectPendingWhileHidden = this.activeSymbols.size > 0;
      return;
    }
    // FIX: Detach the zombie socket before closing so late callbacks cannot
    // mutate the replacement connection or its subscription ownership.
    this.ws = null;
    this.clearHeartbeat();
    this.clearStableOpenTimer();
    this.clearSubscriptionTimers(true);
    try { socket.close(4000, 'Quote socket heartbeat timeout'); } catch { /* ignore */ }
    this.subscribedSymbols.clear();
    this.pendingSubscriptions.clear();
    try {
      useWebSocketStore.getState().setConnectionState('disconnected', 'fix_socket');
    } catch { /* store not ready */ }
    this.publishQuoteTransport();
    if (!this.disposed && this.activeSymbols.size > 0) this.scheduleReconnect();
  }

  private startOpenTimeout(socket: WebSocket): void {
    this.clearOpenTimeout();
    this.openTimeout = setTimeout(() => {
      this.openTimeout = null;
      if (this.ws !== socket || socket.readyState !== WebSocket.CONNECTING) return;
      if (this.isRuntimeSuspended()) {
        this.reconnectPendingWhileHidden = this.activeSymbols.size > 0;
        return;
      }

      const transport = this.activeTransport;
      console.warn(`[QuoteSocket] Opening handshake timed out on ${transport} — retrying`);
      this.ws = null;
      try { socket.close(4000, 'Opening handshake timed out'); } catch { /* ignore */ }
      this.subscribedSymbols.clear();
      this.pendingSubscriptions.clear();
      try {
        useWebSocketStore.getState().setConnectionState('disconnected', 'fix_socket');
      } catch { /* store not ready */ }
      this.publishQuoteTransport();

      if (this.disposed || this.activeSymbols.size === 0) return;

      // A feed handshake that never completes fails over like a rejected
      // handshake; v2 falls back to the normal backoff loop.
      if (transport === 'feed' && this.failOverToV2('Feed handshake timed out')) return;
      this.scheduleReconnect();
    }, QUOTE_SOCKET_OPEN_TIMEOUT_MS);
  }

  private cancelIdleClose(): void {
    if (this.idleCloseTimer === null) return;
    clearTimeout(this.idleCloseTimer);
    this.idleCloseTimer = null;
  }

  private scheduleIdleClose(): void {
    if (this.idleCloseTimer !== null || this.disposed) return;
    this.idleCloseTimer = setTimeout(() => {
      this.idleCloseTimer = null;
      if (this.activeSymbols.size === 0) this.close();
    }, 0);
  }

  /** Force reconnect (e.g. on session change or foreground resume). Retries the primary feed first. */
  reconnect(): void {
    this.resetFeedFailure();
    this.cancelScheduledReconnect();
    if (this.activeSymbols.size > 0) {
      this.closeSocket();
      if (this.isRuntimeSuspended()) {
        this.reconnectPendingWhileHidden = true;
        try {
          useWebSocketStore.getState().setConnectionState('reconnecting', 'fix_socket');
        } catch { /* store not ready */ }
        return;
      }
      this.connect();
    }
  }

  // ─── Cleanup ─────────────────────────────────────────────────────────────

  private closeSocket(): void {
    if (this.ws && terminalQuoteFreshnessEnabled()) resetTerminalQuoteFreshness();
    this.cancelIdleClose();
    this.clearOpenTimeout();
    this.clearStableOpenTimer();
    this.clearHeartbeat();
    this.clearSubscriptionTimers(true);
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
    this.reconnectPendingWhileHidden = false;
    this.reconnectAttempts = 0;
    this.resetFeedFailure();
    try {
      useWebSocketStore.getState().setConnectionState('disconnected', 'fix_socket');
    } catch { /* store not ready */ }
    this.publishQuoteTransport();
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
      document.removeEventListener('visibilitychange', this.handleVisibilityChange);
    }
  }

  // ─── Network handlers ───────────────────────────────────────────────────

  private handleOnline = (): void => {
    console.log('[QuoteSocket] Network online — reconnecting');
    this.reconnect();
  };

  private handleOffline = (): void => {
    if (terminalQuoteFreshnessEnabled()) resetTerminalQuoteFreshness();
    console.log('[QuoteSocket] Network offline');
    this.clearHeartbeat();
    this.clearOpenTimeout();
    this.cancelScheduledReconnect();
    this.reconnectPendingWhileHidden = this.activeSymbols.size > 0;
    try {
      useWebSocketStore.getState().setConnectionState('offline', 'fix_socket');
    } catch { /* store not ready */ }
  };

  private handleVisibilityChange = (): void => {
    if (this.isDocumentHidden()) {
      // FIX: Background timer throttling must not produce a false heartbeat
      // failure; foreground always establishes a fresh, fully subscribed socket.
      this.clearHeartbeat();
      this.clearOpenTimeout();
      this.reconnectPendingWhileHidden = this.activeSymbols.size > 0;
      if (this.reconnectTimer) {
        this.cancelScheduledReconnect();
        this.reconnectPendingWhileHidden = true;
        try {
          useWebSocketStore.getState().setConnectionState('reconnecting', 'fix_socket');
        } catch { /* store not ready */ }
      }
      return;
    }

    if (this.reconnectPendingWhileHidden) {
      if (this.disposed || this.activeSymbols.size === 0) return;
      this.reconnectPendingWhileHidden = false;
      this.connect();
      return;
    }

    if (this.activeSymbols.size > 0) this.reconnect();
  };

  // ─── Public accessors ───────────────────────────────────────────────────

  getActiveSymbols(): string[] {
    return [...this.activeSymbols];
  }

  isConnected(): boolean {
    return this.ws?.readyState === WebSocket.OPEN;
  }

  /** Transport serving the current (or last) quote connection. */
  getTransport(): QuoteTransport {
    return this.activeTransport;
  }

  /** True while quotes are served over v2 after the broker feed failed. */
  isFallbackActive(): boolean {
    return this.fallbackActive;
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
