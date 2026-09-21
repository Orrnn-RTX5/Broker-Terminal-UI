/**
 * Account + Positions Realtime WebSocket — /ws/v2  (Section 4 of WebSocket Flow)
 *
 * Flow:
 *   1. Logged-in app                → Boot, trade screen, foreground (RootLayout / hook)
 *   2. Resolve authenticated URL    → Reads broker URL and token (brokerApi.getSocketUri)
 *   3. Open account socket          → Broker-scoped WS → wss://broker/ws/v2?token
 *   4. Resolve login channels       → Uses current account login → account.LOGIN
 *   5. Subscribe realtime           → Account + positions → positions.LOGIN
 *   6. Incoming updates             → Metrics and position events → handleMessage()
 *   7. Update Zustand               → Account and position store subscribers receive the changes
 */

import {
  buildBrokerWsV2Uri,
  getAccessToken,
  getAccountLogin,
  onSessionChange,
  isSessionReady,
} from './brokerSession';
import { useAppStore } from '../store/useAppStore';
import {
  normalizeBrokerTimestampMs,
  readBrokerTimestampMs,
} from '../utils/brokerStreamSemantics';

// ─── Types ───────────────────────────────────────────────────────────────────

const toFinite = (v: unknown, fallback = 0): number => {
  // FIX: Partial account packets may carry omitted/null fields or Money-like
  // `{ amount }` values. Neither may silently erase a known metric with zero.
  if (v === undefined || v === null || v === '') return fallback;
  const candidate = typeof v === 'object' && v !== null && 'amount' in v
    ? (v as { amount?: unknown }).amount
    : v;
  const n = Number(String(candidate).replace(/,/g, ''));
  return Number.isFinite(n) ? n : fallback;
};

const hasOwnValue = (record: any, keys: readonly string[]): boolean => (
  !!record
  && typeof record === 'object'
  && keys.some((key) => (
    Object.prototype.hasOwnProperty.call(record, key)
    && record[key] !== undefined
    && record[key] !== null
    && record[key] !== ''
  ))
);

const BALANCE_KEYS = ['balance_amount', 'balance', 'Balance'] as const;
const EQUITY_KEYS = ['equity_amount', 'equity', 'Equity'] as const;
const MARGIN_KEYS = ['used_margin', 'margin_used', 'margin', 'marginUsed'] as const;
const FREE_MARGIN_KEYS = ['free_margin_amount', 'margin_free', 'freeMargin', 'free_margin', 'margin_available'] as const;
const FLOATING_PNL_KEYS = ['floating_pnl', 'floating', 'profit', 'unrealizedPL', 'unrealized_pl'] as const;
const MARGIN_LEVEL_KEYS = ['margin_level', 'marginLevel'] as const;
const CREDIT_KEYS = ['credit', 'credit_bonus', 'bonus'] as const;
const ACCOUNT_DELTA_KEYS = [
  ...BALANCE_KEYS,
  ...EQUITY_KEYS,
  ...MARGIN_KEYS,
  ...FREE_MARGIN_KEYS,
  ...FLOATING_PNL_KEYS,
  ...MARGIN_LEVEL_KEYS,
  ...CREDIT_KEYS,
  'currency',
  'leverage',
] as const;

const firstDefined = (record: any, keys: readonly string[]): unknown => {
  for (const key of keys) {
    const value = record?.[key];
    if (value !== undefined && value !== null && value !== '') return value;
  }
  return undefined;
};

const unwrapAccountRecord = (payload: any): any => {
  const candidates = [
    payload?.account,
    payload?.data?.account,
    payload?.data?.data?.account,
    payload?.data?.data,
    payload?.data,
    payload,
  ];
  return candidates.find((candidate) => hasOwnValue(candidate, ACCOUNT_DELTA_KEYS)) ?? null;
};

const timestampToIso = (v: unknown): string => {
  const timestamp = normalizeBrokerTimestampMs(v);
  return timestamp === undefined ? '' : new Date(timestamp).toISOString();
};

// ─── Normalizers ─────────────────────────────────────────────────────────────

function normalizePosition(raw: any) {
  // FIX: Position event time accepts every broker precision/ISO alias without
  // multiplying a millisecond/microsecond/nanosecond epoch a second time.
  const openTimestamp = readBrokerTimestampMs([raw], [
    'time_create', 'time_create_ms', 'time_create_msc',
    'time_open', 'time_open_ms', 'time_open_msc',
    'opened_at', 'open_time', 'openTime',
    'time_ms', 'time_msc', 'timestamp_ms', 'timestamp', 'time',
  ]);
  const openTime = openTimestamp === undefined ? '' : timestampToIso(openTimestamp);

  const id = toFinite(raw.position_id ?? raw.ticket ?? raw.id, 0);
  const volume = toFinite(raw.volume_lots ?? raw.volume ?? raw.quantity, 0);
  const openPrice = toFinite(raw.price_open ?? raw.open_price ?? raw.openPrice ?? raw.entryPrice ?? raw.chartEntryPrice ?? raw.price, 0);
  const currentPrice = toFinite(raw.price_current ?? raw.current_price ?? raw.currentPrice ?? raw.livePrice, openPrice);
  const unrealizedPnL = toFinite(raw.profit ?? raw.unrealized_pl ?? raw.unrealizedPnL, 0);

  return {
    id,
    symbol: raw.symbol || '',
    side: Number(raw.action) === 1 || String(raw.side).toLowerCase() === 'sell' ? 'SELL' as const : 'BUY' as const,
    volume,
    openPrice,
    currentPrice,
    openTime,
    sl: toFinite(raw.price_sl ?? raw.sl, 0),
    tp: toFinite(raw.price_tp ?? raw.tp, 0),
    swap: toFinite(raw.storage ?? raw.swap, 0),
    commission: toFinite(raw.commission, 0),
    unrealizedPnL,
    comment: raw.comment,
    // FIX: Keep wire aliases synchronized with the canonical fields. Several
    // trade-table consumers still read these defensive aliases first.
    open_price: openPrice,
    price_open: openPrice,
    current_price: currentPrice,
    price_current: currentPrice,
    quantity: volume,
    unrealized_pl: unrealizedPnL,
    profit: unrealizedPnL,
    time_create: openTime,
    open_time: openTime,
    time: openTime,
  };
}

function normalizeAccount(raw: any, current?: any) {
  const hasEquity = hasOwnValue(raw, EQUITY_KEYS);
  const hasFreeMargin = hasOwnValue(raw, FREE_MARGIN_KEYS);
  const hasMarginLevel = hasOwnValue(raw, MARGIN_LEVEL_KEYS);
  return {
    // FIX: WebSocket metric frames are deltas, not guaranteed full account
    // objects. Preserve every omitted field while applying explicit zeroes.
    ...current,
    balance: toFinite(firstDefined(raw, BALANCE_KEYS), current?.balance ?? 0),
    equity: toFinite(firstDefined(raw, EQUITY_KEYS), current?.equity ?? 0),
    margin: toFinite(firstDefined(raw, MARGIN_KEYS), current?.margin ?? 0),
    freeMargin: toFinite(firstDefined(raw, FREE_MARGIN_KEYS), current?.freeMargin ?? 0),
    unrealizedPL: toFinite(firstDefined(raw, FLOATING_PNL_KEYS), current?.unrealizedPL ?? 0),
    marginLevel: toFinite(firstDefined(raw, MARGIN_LEVEL_KEYS), current?.marginLevel ?? 0),
    credit: toFinite(firstDefined(raw, CREDIT_KEYS), current?.credit ?? 0),
    hasBackendEquity: hasEquity ? true : (current?.hasBackendEquity ?? false),
    hasBackendFreeMargin: hasFreeMargin ? true : (current?.hasBackendFreeMargin ?? false),
    hasBackendMarginLevel: hasMarginLevel ? true : (current?.hasBackendMarginLevel ?? false),
    currency: String(raw?.currency ?? current?.currency ?? 'USD'),
    leverage: toFinite(raw?.leverage ?? current?.leverage, 100),
  };
}

const getPositionId = (raw: any): number => (
  toFinite(raw?.position_id ?? raw?.ticket ?? raw?.id ?? raw?.position_ticket, 0)
);

const isClosedPositionRecord = (raw: any): boolean => {
  const lifecycle = String(raw?.event ?? raw?.status ?? raw?.state ?? '').trim().toLowerCase();
  if (raw?.closed === true || ['close', 'closed', 'sl_hit', 'tp_hit', 'stop_out'].includes(lifecycle)) {
    return true;
  }
  const closedAt = readBrokerTimestampMs([raw], [
    'time_close', 'time_close_ms', 'time_close_msc',
    'closed_at', 'close_time', 'closeTime',
  ]);
  if (
    closedAt !== undefined
    && closedAt > 0
  ) return true;
  const volumeKeys = ['volume_lots', 'volume', 'quantity'] as const;
  return hasOwnValue(raw, volumeKeys) && toFinite(firstDefined(raw, volumeKeys), 0) <= 0;
};

const mergePositionRecord = (raw: any, existing?: any): any => {
  const normalized = normalizePosition(raw) as any;
  if (!existing) return normalized;

  const volume = hasOwnValue(raw, ['volume_lots', 'volume', 'quantity']) ? normalized.volume : existing.volume;
  const openPrice = hasOwnValue(raw, ['price_open', 'open_price', 'openPrice', 'price'])
    ? normalized.openPrice
    : existing.openPrice;
  const currentPrice = hasOwnValue(raw, ['price_current', 'current_price', 'currentPrice'])
    ? normalized.currentPrice
    : existing.currentPrice;
  const openTime = hasOwnValue(raw, [
    'time_create', 'time_create_ms', 'time_create_msc',
    'time_ms', 'time_msc', 'time', 'timestamp', 'timestamp_ms',
    'time_open', 'time_open_ms', 'time_open_msc', 'opened_at', 'open_time', 'openTime',
  ])
    ? normalized.openTime
    : existing.openTime;
  const unrealizedPnL = hasOwnValue(raw, ['profit', 'unrealized_pl', 'unrealizedPnL'])
    ? normalized.unrealizedPnL
    : existing.unrealizedPnL;

  return {
    ...existing,
    ...normalized,
    symbol: hasOwnValue(raw, ['symbol']) ? normalized.symbol : existing.symbol,
    side: hasOwnValue(raw, ['action', 'side']) ? normalized.side : existing.side,
    volume,
    quantity: volume,
    openPrice,
    open_price: openPrice,
    currentPrice,
    current_price: currentPrice,
    price_current: currentPrice,
    openTime,
    time_create: openTime,
    sl: hasOwnValue(raw, ['price_sl', 'sl', 'stopLoss', 'stop_loss']) ? normalized.sl : existing.sl,
    tp: hasOwnValue(raw, ['price_tp', 'tp', 'takeProfit', 'take_profit']) ? normalized.tp : existing.tp,
    swap: hasOwnValue(raw, ['storage', 'swap']) ? normalized.swap : existing.swap,
    commission: hasOwnValue(raw, ['commission']) ? normalized.commission : existing.commission,
    unrealizedPnL,
    unrealized_pl: unrealizedPnL,
    profit: unrealizedPnL,
    comment: hasOwnValue(raw, ['comment']) ? normalized.comment : existing.comment,
  };
};

// ─── AccountSocketManager ────────────────────────────────────────────────────

class AccountSocketManager {
  private ws: WebSocket | null = null;
  private login: number | null = null;

  // Reconnect
  private reconnectAttempts = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private openTimeout: ReturnType<typeof setTimeout> | null = null;
  private maxReconnectDelay = 15000;
  private baseReconnectDelay = 1000;
  private reconnectPendingWhileSuspended = false;
  private disposed = false;

  // Ping
  private pingInterval: ReturnType<typeof setInterval> | null = null;
  private pongTimeout: ReturnType<typeof setTimeout> | null = null;
  private pingIntervalMs = 25000;
  private pongTimeoutMs = 10000;
  private openTimeoutMs = 10000;

  // Session change
  private unsubSessionChange: (() => void) | null = null;

  // State listeners
  private connectedCallbacks = new Set<(connected: boolean) => void>();

  constructor() {
    this.unsubSessionChange = onSessionChange((reason) => {
      if (reason === 'logout') {
        this.disconnect();
      } else if (reason === 'token_rotation' || reason === 'broker_url_change' || reason === 'login') {
        // FIX: Login can satisfy a previously deferred account-stream demand.
        this.forceReconnect();
      } else if (reason === 'account_change') {
        // Re-open with new login
        const newLogin = getAccountLogin();
        if (newLogin) this.connect(newLogin);
      }
    });

    if (typeof window !== 'undefined') {
      window.addEventListener('online', this.handleOnline);
      window.addEventListener('offline', this.handleOffline);
      document.addEventListener('visibilitychange', this.handleVisibilityChange);
      // Foreground reconnect on custom event
      window.addEventListener('rtx:reconnect-ws', this.handleForegroundReconnect);
    }
  }

  // ─── Step 3: Open account socket ─────────────────────────────────────────

  connect(login: number): void {
    console.log(`[AccountSocket] connect() called — login=${login}, disposed=${this.disposed}`);

    if (this.disposed) return;
    // FIX: Retain account demand even when authentication is not ready yet;
    // the subsequent login session event can then establish the socket.
    this.login = login;
    if (this.isRuntimeSuspended()) {
      this.reconnectPendingWhileSuspended = true;
      return;
    }
    if (!isSessionReady()) {
      console.warn('[AccountSocket] Session not ready, deferring connect');
      return;
    }

    this.closeSocket();
    this.reconnectPendingWhileSuspended = false;

    const token = getAccessToken();
    const wsUrl = buildBrokerWsV2Uri(token);

    console.log(`[AccountSocket] Opening WebSocket → ${wsUrl.replace(/token=[^&]+/, 'token=***')}`);

    try {
      const socket = new WebSocket(wsUrl);
      this.ws = socket;
      this.startOpenTimeout(socket);

      socket.onopen = () => {
        // FIX: Ignore callbacks owned by the previous account/token socket.
        if (this.ws !== socket || this.disposed) return;
        this.clearOpenTimeout();
        console.log(`[AccountSocket] Connected for login ${login}`);
        this.reconnectAttempts = 0;
        this.startPing();
        this.notifyConnected(true);

        // Step 4-5: Subscribe to login channels
        const channels = [
          `positions.${login}`,
          `metrics.${login}`,
          `account.${login}`,
        ];
        channels.forEach((channel) => {
          socket.send(JSON.stringify({ action: 'subscribe', channel }));
        });
        console.log('[AccountSocket] Subscribed to channels:', channels);
      };

      socket.onmessage = (event) => {
        if (this.ws !== socket || this.disposed) return;
        this.recordTransportActivity();
        try {
          const data = JSON.parse(event.data);
          this.handleMessage(data);
        } catch (err) {
          console.error('[AccountSocket] Parse error:', err);
        }
      };

      socket.onerror = (err) => {
        if (this.ws !== socket || this.disposed) return;
        console.error('[AccountSocket] Error:', err);
      };

      socket.onclose = (event) => {
        if (this.ws !== socket) return;
        this.ws = null;
        this.clearOpenTimeout();
        console.log(`[AccountSocket] Closed (code: ${event.code})`);
        this.stopPing();
        this.notifyConnected(false);

        if ([1008, 4001, 4003, 4401, 4403].includes(event.code)) {
          console.error('[AccountSocket] Auth failure');
          return;
        }

        if (this.login && !this.disposed) {
          this.scheduleReconnect();
        }
      };
    } catch (err) {
      console.error('[AccountSocket] Connection failed:', err);
      this.scheduleReconnect();
    }
  }

  // ─── Step 6: Incoming updates — handleMessage ────────────────────────────

  private handleMessage(data: any): void {
    const { type, channel } = data;

    if (type === 'pong' || type === 'subscribed') return;

    // Channel message routing. Broker /ws/v2 sends both direct
    // {channel,data} messages and legacy {type:"channel_message"} envelopes.
    if (channel) {
      const payload = data.data ?? data;
      const channelLogin = Number(String(channel).slice(String(channel).lastIndexOf('.') + 1));
      // FIX: Channel ownership is authoritative even when a payload omits or
      // repeats a different login field.
      if (this.login && Number.isFinite(channelLogin) && channelLogin !== this.login) return;

      // Step 6a: Account channel
      if (channel.startsWith('account.') || channel.startsWith('metrics.')) {
        this.handleAccountUpdate(payload);
        return;
      }

      // Step 6b: Positions channel
      if (channel.startsWith('positions.')) {
        this.handlePositionUpdate(payload, data);
        return;
      }
    }

    // Legacy direct types
    if (type === 'mt5_account') {
      this.handleAccountUpdate(data.account ?? data.data ?? data);
      return;
    }

    if (type === 'mt5_positions') {
      this.handlePositionUpdate(data, data);
      return;
    }
  }

  // ─── Step 7: update account and position state in Zustand ───────────────

  private handleAccountUpdate(payload: any): void {
    const accRecord = unwrapAccountRecord(payload);
    // FIX: Account, metrics and margin channels may send independent deltas.
    // Balance is not a required discriminator for a valid equity/margin frame.
    if (!accRecord) return;

    // Filter: only accept data for our login
    if (this.login) {
      const channelLogin = payload?.login ?? payload?.account_login ?? accRecord?.login ?? accRecord?.account_login;
      if (channelLogin && Number(channelLogin) !== this.login) return;
    }

    const store = useAppStore.getState();
    const current = store.account;
    store.setAccount(normalizeAccount(accRecord, current) as any);
  }

  private handlePositionUpdate(payload: any, raw: any): void {
    const store = useAppStore.getState();
    const eventType = String(raw?.event ?? raw?.type ?? payload?.event ?? '').toLowerCase();

    // Array of positions (full snapshot)
    const rawPositions = Array.isArray(payload)
      ? payload
      : (payload?.positions ?? payload?.data?.positions ?? (Array.isArray(payload?.data) ? payload.data : null));
    if (Array.isArray(rawPositions)) {
      const currentById = new Map(store.positions.map((position) => [Number(position.id), position]));
      const snapshotById = new Map<number, any>();
      for (const update of rawPositions) {
        const ticketId = getPositionId(update);
        if (!ticketId || isClosedPositionRecord(update)) continue;
        snapshotById.set(ticketId, mergePositionRecord(update, currentById.get(ticketId)));
      }

      // FIX: `positions` arrays are authoritative open-position snapshots.
      // Replace the set even when it is empty so tickets absent from the
      // latest snapshot (or explicitly closed) cannot remain stale forever.
      store.setPositions(Array.from(snapshotById.values()));
      return;
    }

    // Single position event (open, close, modify)
    const rawPosition = payload?.position ?? payload?.closed_position ?? payload;
    if (!rawPosition) return;

    const current = store.positions;
    const isCloseEvent = ['close', 'closed', 'sl_hit', 'tp_hit', 'stop_out'].some(t => eventType.includes(t));

    if (isCloseEvent) {
      const id = Number(rawPosition?.ticket ?? rawPosition?.position_id ?? rawPosition?.id ?? 0);
      if (id) {
        store.setPositions(current.filter(p => p.id !== id));
      }
    } else {
      const normalized = normalizePosition(rawPosition);
      const existingIdx = current.findIndex(p => p.id === normalized.id);
      if (existingIdx >= 0) {
        const updated = [...current];
        // FIX: Single-position events are deltas. Merge only fields explicitly
        // carried by the event so a price/P&L update cannot erase entry data.
        updated[existingIdx] = mergePositionRecord(rawPosition, updated[existingIdx]);
        store.setPositions(updated);
      } else if (normalized.id) {
        store.setPositions([normalized, ...current]);
      }
    }
  }

  // ─── Reconnect ──────────────────────────────────────────────────────────

  private scheduleReconnect(): void {
    if (this.disposed || this.reconnectTimer || !this.login) return;
    if (this.isRuntimeSuspended()) {
      this.reconnectPendingWhileSuspended = true;
      return;
    }

    const delay = Math.min(
      this.baseReconnectDelay * Math.pow(2, Math.min(this.reconnectAttempts, 10)),
      this.maxReconnectDelay,
    );
    this.reconnectAttempts++;

    console.log(`[AccountSocket] Reconnecting in ${delay}ms (attempt ${this.reconnectAttempts})`);

    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      if (this.isRuntimeSuspended()) {
        this.reconnectPendingWhileSuspended = Boolean(this.login);
        return;
      }
      if (this.login) this.connect(this.login);
    }, delay);
  }

  forceReconnect(): void {
    this.reconnectAttempts = 0;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (!this.login) return;
    if (this.isRuntimeSuspended()) {
      this.stopPing();
      this.clearOpenTimeout();
      this.reconnectPendingWhileSuspended = true;
      return;
    }
    this.reconnectPendingWhileSuspended = false;
    this.connect(this.login);
  }

  // ─── Connection state listeners ─────────────────────────────────────────

  onConnectionChange(cb: (connected: boolean) => void): () => void {
    this.connectedCallbacks.add(cb);
    // Immediately call with current state
    cb(this.isConnected());
    return () => { this.connectedCallbacks.delete(cb); };
  }

  private notifyConnected(connected: boolean): void {
    this.connectedCallbacks.forEach(cb => {
      try { cb(connected); } catch { /* ignore */ }
    });
  }

  // ─── Ping ───────────────────────────────────────────────────────────────

  private isDocumentHidden(): boolean {
    return typeof document !== 'undefined' && document.visibilityState === 'hidden';
  }

  private isRuntimeSuspended(): boolean {
    return this.isDocumentHidden()
      || (typeof navigator !== 'undefined' && navigator.onLine === false);
  }

  private startPing(): void {
    this.stopPing();
    this.pingInterval = setInterval(() => {
      if (this.isRuntimeSuspended()) return;
      if (this.ws?.readyState === WebSocket.OPEN) {
        const socket = this.ws;
        socket.send(JSON.stringify({ type: 'ping', timestamp: Date.now() }));
        if (this.pongTimeout === null) {
          this.pongTimeout = setTimeout(() => {
            this.pongTimeout = null;
            if (this.ws !== socket) return;
            if (this.isRuntimeSuspended()) {
              this.reconnectPendingWhileSuspended = Boolean(this.login);
              return;
            }
            // FIX: Reconnect an OPEN-but-dead account stream so margin and
            // positions cannot remain indefinitely stale.
            this.ws = null;
            this.stopPing();
            this.notifyConnected(false);
            try { socket.close(4000, 'Account socket heartbeat timeout'); } catch { /* ignore */ }
            this.scheduleReconnect();
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
      // FIX: Bound CONNECTING and retry with the current broker/session inputs.
      this.ws = null;
      try { socket.close(4000, 'Account socket open timeout'); } catch { /* ignore */ }
      this.notifyConnected(false);
      this.scheduleReconnect();
    }, this.openTimeoutMs);
  }

  // ─── Cleanup ─────────────────────────────────────────────────────────────

  private closeSocket(): void {
    this.stopPing();
    this.clearOpenTimeout();
    if (this.ws) {
      // FIX: Intentional close relinquishes ownership before onclose fires.
      const socket = this.ws;
      this.ws = null;
      try { socket.close(1000, 'AccountSocketManager closing'); } catch { /* ignore */ }
    }
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }

  disconnect(): void {
    this.login = null;
    this.reconnectPendingWhileSuspended = false;
    this.closeSocket();
    this.notifyConnected(false);
  }

  destroy(): void {
    this.disposed = true;
    this.disconnect();
    this.connectedCallbacks.clear();
    if (this.unsubSessionChange) {
      this.unsubSessionChange();
      this.unsubSessionChange = null;
    }
    if (typeof window !== 'undefined') {
      window.removeEventListener('online', this.handleOnline);
      window.removeEventListener('offline', this.handleOffline);
      document.removeEventListener('visibilitychange', this.handleVisibilityChange);
      window.removeEventListener('rtx:reconnect-ws', this.handleForegroundReconnect);
    }
  }

  // ─── Network handlers ───────────────────────────────────────────────────

  private handleOnline = (): void => {
    console.log('[AccountSocket] Network online — reconnecting');
    if (this.isDocumentHidden()) {
      this.reconnectPendingWhileSuspended = Boolean(this.login);
      return;
    }
    this.forceReconnect();
  };

  private handleOffline = (): void => {
    console.log('[AccountSocket] Network offline');
    // FIX: Network loss suspends heartbeat/open deadlines; the online event
    // owns one fresh account-channel reconnect and resubscription.
    this.stopPing();
    this.clearOpenTimeout();
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.reconnectPendingWhileSuspended = Boolean(this.login);
  };

  private handleVisibilityChange = (): void => {
    if (this.isDocumentHidden()) {
      // FIX: Background timer clamping must not manufacture a missed pong.
      this.stopPing();
      this.clearOpenTimeout();
      if (this.reconnectTimer) {
        clearTimeout(this.reconnectTimer);
        this.reconnectTimer = null;
      }
      this.reconnectPendingWhileSuspended = Boolean(this.login);
      return;
    }

    if (typeof navigator !== 'undefined' && navigator.onLine === false) {
      this.reconnectPendingWhileSuspended = Boolean(this.login);
      return;
    }
    if (this.login && (this.reconnectPendingWhileSuspended || this.ws?.readyState === WebSocket.OPEN)) {
      this.reconnectPendingWhileSuspended = false;
      this.forceReconnect();
    }
  };

  private handleForegroundReconnect = (): void => {
    if (!this.ws || this.ws.readyState === WebSocket.CLOSED || this.ws.readyState === WebSocket.CLOSING) {
      console.log('[AccountSocket] Foreground reconnect triggered');
      this.forceReconnect();
    }
  };

  // ─── Public ─────────────────────────────────────────────────────────────

  isConnected(): boolean {
    return this.ws?.readyState === WebSocket.OPEN;
  }

  getLogin(): number | null {
    return this.login;
  }
}

// ─── Singleton ───────────────────────────────────────────────────────────────

let instance: AccountSocketManager | null = null;

export function getAccountSocketManager(): AccountSocketManager {
  if (!instance) {
    instance = new AccountSocketManager();
  }
  return instance;
}

export function destroyAccountSocketManager(): void {
  if (instance) {
    instance.destroy();
    instance = null;
  }
}

export { AccountSocketManager };
