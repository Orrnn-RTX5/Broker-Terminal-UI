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
  getCommittedBrokerAccountSessionScope,
  getCommittedBrokerAccountSessionScopeKey,
} from './brokerSession';
import { extractAccountMetrics, normalizeAccountMetrics } from './accountMetrics';
import { markPositionsClosed, useAppStore } from '../store/useAppStore';
import { POSITION_CLOSED_EVENTS, getPositionId, readPositionStreamEvent, readPositionStreamBatch, reconcilePositionStreamBatch } from './positionStream';
import {
  requestPositionSnapshotRevalidation,
} from './positionSnapshotSafety';

// ─── Types ───────────────────────────────────────────────────────────────────

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

// ─── Normalizers ─────────────────────────────────────────────────────────────

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
        this.handleAccountUpdate(data);
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
    store.setAccount(normalizeAccountMetrics(payload, current, {
      partial: !extractAccountMetrics(payload).publication_token,
      login: this.login ?? undefined,
      scope: getCommittedBrokerAccountSessionScopeKey(getCommittedBrokerAccountSessionScope()),
    }));
  }

  private handlePositionUpdate(payload: any, raw: any): void {
    const store = useAppStore.getState();

    const batch = readPositionStreamBatch(raw);
    if (batch) {
      const result = reconcilePositionStreamBatch(store.positions, batch);
      markPositionsClosed(result.closedTickets);
      store.setPositions(result.positions, { closedTickets: result.closedTickets });
      if (result.needsRevalidation) requestPositionSnapshotRevalidation();
      return;
    }

    const { event, position } = readPositionStreamEvent(raw);
    if (!position) return;
    if (POSITION_CLOSED_EVENTS.has(event)) markPositionsClosed([getPositionId(position)]);
    const result = reconcilePositionStreamBatch(store.positions, {
      mode: 'delta',
      positions: [POSITION_CLOSED_EVENTS.has(event) ? { ...position, closed: true } : position],
    });
    store.setPositions(result.positions, { closedTickets: result.closedTickets });
    if (result.needsRevalidation || event === 'position_partial_close') requestPositionSnapshotRevalidation();
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
