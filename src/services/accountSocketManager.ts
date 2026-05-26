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
 *   7. useLiveAccountState          → usePositionsState → Trade / History / Settings UI update
 */

import {
  buildBrokerWsV2Uri,
  getAccessToken,
  getAccountLogin,
  onSessionChange,
  isSessionReady,
} from './brokerSession';
import { useAppStore } from '../store/useAppStore';

// ─── Types ───────────────────────────────────────────────────────────────────

const toFinite = (v: unknown, fallback = 0): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
};

const timestampToIso = (v: unknown): string => {
  const n = Number(v);
  if (!Number.isFinite(n) || n <= 0) return '';
  return new Date(n > 1_000_000_000_000 ? n : n * 1000).toISOString();
};

// ─── Normalizers ─────────────────────────────────────────────────────────────

function normalizePosition(raw: any) {
  let openTime = '';
  if (raw.time_create && raw.time_create > 0) {
    openTime = new Date(raw.time_create * 1000).toISOString();
  } else if (raw.time_ms && raw.time_ms > 0) {
    const ms = raw.time_ms > 1_000_000_000_000 ? raw.time_ms : raw.time_ms * 1000;
    openTime = new Date(ms).toISOString();
  } else if (raw.time && raw.time > 0) {
    const ms = raw.time > 1_000_000_000_000 ? raw.time : raw.time * 1000;
    openTime = new Date(ms).toISOString();
  } else if (raw.time_open && raw.time_open > 0) {
    openTime = new Date(raw.time_open * 1000).toISOString();
  } else if (raw.opened_at) {
    openTime = raw.opened_at;
  }

  return {
    id: raw.position_id ?? raw.ticket ?? raw.id ?? 0,
    symbol: raw.symbol || '',
    side: raw.action === 1 || String(raw.side).toLowerCase() === 'sell' ? 'SELL' as const : 'BUY' as const,
    volume: toFinite(raw.volume_lots ?? raw.volume ?? raw.quantity, 0),
    openPrice: toFinite(raw.price_open ?? raw.open_price ?? raw.openPrice ?? raw.price, 0),
    currentPrice: toFinite(raw.price_current ?? raw.current_price ?? raw.currentPrice, 0),
    openTime,
    sl: toFinite(raw.price_sl ?? raw.sl, 0),
    tp: toFinite(raw.price_tp ?? raw.tp, 0),
    swap: toFinite(raw.storage ?? raw.swap, 0),
    commission: toFinite(raw.commission, 0),
    unrealizedPnL: toFinite(raw.profit ?? raw.unrealized_pl ?? raw.unrealizedPnL, 0),
    comment: raw.comment,
  };
}

function normalizeAccount(raw: any, current?: any) {
  return {
    balance: toFinite(raw?.balance ?? current?.balance, 0),
    equity: toFinite(raw?.equity ?? current?.equity, 0),
    margin: toFinite(raw?.used_margin ?? raw?.margin_used ?? raw?.margin ?? current?.margin, 0),
    freeMargin: toFinite(raw?.margin_free ?? raw?.freeMargin ?? raw?.free_margin ?? current?.freeMargin, 0),
    unrealizedPL: toFinite(raw?.floating_pnl ?? raw?.profit ?? raw?.unrealizedPL ?? raw?.unrealized_pl ?? current?.unrealizedPL, 0),
    marginLevel: toFinite(raw?.margin_level ?? raw?.marginLevel ?? current?.marginLevel, 0),
    currency: String(raw?.currency ?? current?.currency ?? 'USD'),
    leverage: toFinite(raw?.leverage ?? current?.leverage, 100),
  };
}

// ─── AccountSocketManager ────────────────────────────────────────────────────

class AccountSocketManager {
  private ws: WebSocket | null = null;
  private login: number | null = null;

  // Reconnect
  private reconnectAttempts = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private maxReconnectDelay = 15000;
  private baseReconnectDelay = 1000;
  private disposed = false;

  // Ping
  private pingInterval: ReturnType<typeof setInterval> | null = null;
  private pingIntervalMs = 25000;

  // Session change
  private unsubSessionChange: (() => void) | null = null;

  // State listeners
  private connectedCallbacks = new Set<(connected: boolean) => void>();

  constructor() {
    this.unsubSessionChange = onSessionChange((reason) => {
      if (reason === 'logout') {
        this.disconnect();
      } else if (reason === 'token_rotation' || reason === 'broker_url_change') {
        this.forceReconnect();
      } else if (reason === 'account_change') {
        // Re-open with new login
        const newLogin = getAccountLogin();
        if (newLogin && newLogin !== this.login) {
          this.connect(newLogin);
        }
      }
    });

    if (typeof window !== 'undefined') {
      window.addEventListener('online', this.handleOnline);
      window.addEventListener('offline', this.handleOffline);
      // Foreground reconnect on custom event
      window.addEventListener('rtx:reconnect-ws', this.handleForegroundReconnect);
    }
  }

  // ─── Step 3: Open account socket ─────────────────────────────────────────

  connect(login: number): void {
    console.log(`[AccountSocket] connect() called — login=${login}, disposed=${this.disposed}`);

    if (this.disposed) return;
    if (!isSessionReady()) {
      console.warn('[AccountSocket] Session not ready, deferring connect');
      return;
    }

    this.login = login;
    this.closeSocket();

    const token = getAccessToken();
    const wsUrl = buildBrokerWsV2Uri(token);

    console.log(`[AccountSocket] Opening WebSocket → ${wsUrl.replace(/token=[^&]+/, 'token=***')}`);

    try {
      this.ws = new WebSocket(wsUrl);

      this.ws.onopen = () => {
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
          this.ws!.send(JSON.stringify({ action: 'subscribe', channel }));
        });
        console.log('[AccountSocket] Subscribed to channels:', channels);
      };

      this.ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          this.handleMessage(data);
        } catch (err) {
          console.error('[AccountSocket] Parse error:', err);
        }
      };

      this.ws.onerror = (err) => {
        console.error('[AccountSocket] Error:', err);
      };

      this.ws.onclose = (event) => {
        console.log(`[AccountSocket] Closed (code: ${event.code})`);
        this.stopPing();
        this.notifyConnected(false);

        if (event.code === 1008 || event.code === 4001) {
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

  // ─── Step 7: useLiveAccountState — update Zustand ────────────────────────

  private handleAccountUpdate(payload: any): void {
    const accRecord = payload?.account ?? payload?.data?.account ?? payload?.data?.data ?? payload?.data ?? payload;
    if (!accRecord || accRecord.balance === undefined) return;

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
    const rawPositions = Array.isArray(payload) ? payload : (payload?.positions ?? null);
    if (Array.isArray(rawPositions)) {
      const current = store.positions;
      let updated = [...current];
      let changed = false;

      for (const update of rawPositions) {
        const ticketId = Number(update.ticket ?? update.id ?? update.position_id ?? update.position_ticket ?? 0);
        if (!ticketId) continue;

        const idx = updated.findIndex((p) => p.id === ticketId);
        if (idx >= 0) {
          const existing = updated[idx];
          const newPrice = toFinite(update.price_current ?? update.current_price ?? update.currentPrice, existing.currentPrice);
          const newPnL = toFinite(update.profit ?? update.unrealized_pl ?? update.unrealizedPnL, existing.unrealizedPnL);
          const next = {
            ...existing,
            currentPrice: newPrice,
            current_price: newPrice,
            price_current: newPrice,
            unrealizedPnL: newPnL,
            unrealized_pl: newPnL,
            profit: newPnL,
            swap: toFinite(update.swap ?? update.storage, existing.swap),
            time_update: update.time_update ?? existing.time_update,
          } as any;
          if (
            existing.currentPrice !== next.currentPrice ||
            existing.unrealizedPnL !== next.unrealizedPnL ||
            existing.swap !== next.swap ||
            existing.time_update !== next.time_update
          ) {
            updated[idx] = next;
            changed = true;
          }
        } else {
          const normalized = normalizePosition(update);
          if (normalized.id) {
            updated = [normalized, ...updated];
            changed = true;
          }
        }
      }

      if (changed) store.setPositions(updated);
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
        updated[existingIdx] = { ...updated[existingIdx], ...normalized };
        store.setPositions(updated);
      } else if (normalized.id) {
        store.setPositions([normalized, ...current]);
      }
    }
  }

  // ─── Reconnect ──────────────────────────────────────────────────────────

  private scheduleReconnect(): void {
    if (this.disposed || this.reconnectTimer || !this.login) return;

    const delay = Math.min(
      this.baseReconnectDelay * Math.pow(2, Math.min(this.reconnectAttempts, 10)),
      this.maxReconnectDelay,
    );
    this.reconnectAttempts++;

    console.log(`[AccountSocket] Reconnecting in ${delay}ms (attempt ${this.reconnectAttempts})`);

    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      if (this.login) this.connect(this.login);
    }, delay);
  }

  forceReconnect(): void {
    this.reconnectAttempts = 0;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.login) {
      this.connect(this.login);
    }
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
      try { this.ws.close(1000, 'AccountSocketManager closing'); } catch { /* ignore */ }
      this.ws = null;
    }
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }

  disconnect(): void {
    this.login = null;
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
      window.removeEventListener('rtx:reconnect-ws', this.handleForegroundReconnect);
    }
  }

  // ─── Network handlers ───────────────────────────────────────────────────

  private handleOnline = (): void => {
    console.log('[AccountSocket] Network online — reconnecting');
    this.forceReconnect();
  };

  private handleOffline = (): void => {
    console.log('[AccountSocket] Network offline');
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
