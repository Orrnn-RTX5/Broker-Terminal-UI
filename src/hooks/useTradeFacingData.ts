import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useAppStore } from '../store/useAppStore';
import {
  getStoredAccountLogin,
  normalizeAccount,
  normalizeDeal,
  normalizePosition,
  tradeGatewayApi,
  type TradeGatewaySnapshot,
} from '../api/tradeGateway';

type HookState = {
  loading: boolean;
  error: string | null;
  lastUpdated: number | null;
};

type UseTradeFacingDataOptions = {
  enabled?: boolean;
};

const INITIAL_STATE: HookState = {
  loading: false,
  error: null,
  lastUpdated: null,
};

const EMPTY_LIST: [] = [];

const readChannelPayload = (message: any) => message?.data ?? message?.payload ?? message;

const positionId = (position: { id?: number }) => Number(position.id ?? 0);

const mergePosition = (positions: ReturnType<typeof useAppStore.getState>['positions'], next: any) => {
  const normalized = normalizePosition(next);
  const id = positionId(normalized);
  if (!id) return positions;
  const existingIndex = positions.findIndex((position) => positionId(position) === id);
  if (existingIndex < 0) return [normalized, ...positions];
  const updated = [...positions];
  updated[existingIndex] = { ...updated[existingIndex], ...normalized };
  return updated;
};

const removePosition = (positions: ReturnType<typeof useAppStore.getState>['positions'], payload: any) => {
  const id = Number(payload?.ticket ?? payload?.position_id ?? payload?.id ?? payload?.position_ticket ?? 0);
  if (!id) return positions;
  return positions.filter((position) => positionId(position) !== id);
};

// Module-level singleton guard.
// Only the first mounted instance that has a valid login creates a WebSocket and
// starts the polling loop. All other instances are pure store consumers.
// This prevents N concurrent WS connections and N competing REST polls when the
// hook is called from multiple components simultaneously.
let _activeTradeFacingInstanceId: symbol | null = null;

export function useTradeFacingData(accountId?: string | number, pollMs = 10000, options: UseTradeFacingDataOptions = {}) {
  const enabled = options.enabled ?? true;
  const storeAccountId = useAppStore((state) => enabled ? state.accountId : undefined);
  const account = useAppStore((state) => enabled ? state.account : null);
  const positions = useAppStore((state) => enabled ? state.positions : EMPTY_LIST);
  const trades = useAppStore((state) => enabled ? state.trades : EMPTY_LIST);
  const storeWsConnected = useAppStore((state) => state.wsConnected);
  const setAccount = useAppStore((state) => state.setAccount);
  const setPositions = useAppStore((state) => state.setPositions);
  const setTrades = useAppStore((state) => state.setTrades);
  const setTradeApiStatus = useAppStore((state) => state.setTradeApiStatus);
  const [state, setState] = useState<HookState>(INITIAL_STATE);
  const wsRef = useRef<WebSocket | null>(null);
  const refreshInFlightRef = useRef<Promise<void> | null>(null);
  const refreshPendingRef = useRef(false);
  const [wsConnected, setWsConnected] = useState(false);

  // Stable unique identity for this hook instance across re-renders.
  const instanceId = useRef<symbol | null>(null);
  if (!instanceId.current) instanceId.current = Symbol('useTradeFacingData');

  const login = useMemo(() => {
    const direct = Number.parseInt(String(accountId ?? storeAccountId ?? ''), 10);
    if (Number.isFinite(direct) && direct > 0) return direct;
    return getStoredAccountLogin();
  }, [accountId, storeAccountId]);

  const applySnapshot = useCallback((snapshot: Partial<TradeGatewaySnapshot>) => {
    if (!enabled) return;
    if (snapshot.account) setAccount(snapshot.account);
    if (snapshot.positions) setPositions(snapshot.positions);
    if (snapshot.deals) setTrades(snapshot.deals);
    setState((prev) => ({
      ...prev,
      lastUpdated: Date.now(),
    }));
  }, [enabled, setAccount, setPositions, setTrades]);

  const refresh = useCallback(async () => {
    if (!enabled || !login) return;

    if (refreshInFlightRef.current) {
      refreshPendingRef.current = true;
      await refreshInFlightRef.current;
      return;
    }

    const request = (async () => {
      const startedAt = Date.now();
      setState((prev) => ({ ...prev, loading: true, error: null }));
      setTradeApiStatus({ loading: true, error: null, lastStartedAt: startedAt });
      try {
        const [account, positions, deals] = await Promise.all([
          tradeGatewayApi.getAccount(login),
          tradeGatewayApi.getPositions(login),
          tradeGatewayApi.getDeals(login).catch(() => tradeGatewayApi.getDeals(undefined)),
        ]);
        applySnapshot({ account, positions, deals });
        const completedAt = Date.now();
        setState((prev) => ({ ...prev, loading: false, error: null, lastUpdated: completedAt }));
        setTradeApiStatus({ loading: false, error: null, lastUpdated: completedAt });
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Failed to refresh trading data';
        setState((prev) => ({
          ...prev,
          loading: false,
          error: message,
        }));
        setTradeApiStatus({ loading: false, error: message });
      } finally {
        refreshInFlightRef.current = null;
        const hasPendingRefresh = refreshPendingRef.current;
        refreshPendingRef.current = false;
        if (hasPendingRefresh) {
          void refresh();
        }
      }
    })();

    refreshInFlightRef.current = request;
    await request;
  }, [applySnapshot, enabled, login, setTradeApiStatus]);

  // Claim the singleton slot when this is the first instance with a valid login.
  // On cleanup the slot is released so the next active instance can claim it.
  useEffect(() => {
    if (!enabled || !login) return;
    if (_activeTradeFacingInstanceId !== null) return; // Another instance already owns the slot
    _activeTradeFacingInstanceId = instanceId.current!;
    return () => {
      if (_activeTradeFacingInstanceId === instanceId.current) {
        _activeTradeFacingInstanceId = null;
      }
    };
  }, [enabled, login]);

  // Polling — only runs for the singleton instance that claimed the slot above.
  useEffect(() => {
    if (!enabled) return;
    if (_activeTradeFacingInstanceId !== instanceId.current) return;

    refresh();
    if (!login || pollMs <= 0) return;

    const interval = window.setInterval(refresh, pollMs);
    const forceRefresh = () => refresh();
    window.addEventListener('rtx:force-refresh-positions', forceRefresh);
    return () => {
      window.clearInterval(interval);
      window.removeEventListener('rtx:force-refresh-positions', forceRefresh);
    };
  }, [enabled, login, pollMs, refresh]);

  // WebSocket — only runs for the singleton instance.
  useEffect(() => {
    if (!enabled || !login || typeof window === 'undefined') return;
    if (_activeTradeFacingInstanceId !== instanceId.current) return;

    const token = localStorage.getItem('auth_token');
    if (!token) return;

    const ws = new WebSocket(`${tradeGatewayApi.getWsUrl()}?token=${encodeURIComponent(token)}`);
    wsRef.current = ws;

    const subscribe = (channel: string) => {
      const payload = { action: 'subscribe', channel };
      if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(payload));
    };

    ws.onopen = () => {
      setWsConnected(true);
      ws.send(JSON.stringify({ action: 'auth', token }));
      ['account', 'positions', 'orders', 'deals'].forEach((channel) => {
        subscribe(`${channel}.${login}`);
      });
    };

    ws.onmessage = (event) => {
      try {
        const message = JSON.parse(event.data);
        const channel = String(message.channel ?? '');
        const payload = readChannelPayload(message);

        if (channel.startsWith(`account.${login}`)) {
          const current = useAppStore.getState().account;
          const account = normalizeAccount(payload.account ?? payload, current);
          applySnapshot({ account });
          return;
        }

        if (channel.startsWith(`positions.${login}`)) {
          const eventType = String(message.event ?? message.type ?? payload.event ?? payload.type ?? '').toLowerCase();
          const rawPositions = Array.isArray(payload) ? payload : payload.positions;

          if (Array.isArray(rawPositions)) {
            if (eventType === 'pnl_update') {
                const current = useAppStore.getState().positions;
                const updated = [...current];
                let changed = false;
                for (const update of rawPositions) {
                    const ticketId = Number(update.ticket ?? update.id ?? update.position_ticket ?? 0);
                    if (!ticketId) continue;
                    const idx = updated.findIndex((p) => positionId(p) === ticketId);
                    if (idx >= 0) {
                        const existing = updated[idx];
                        const newPrice = Number(update.price_current ?? update.current_price ?? update.currentPrice ?? existing.currentPrice);
                        const newPnL = Number(update.profit ?? update.unrealized_pl ?? update.unrealizedPnL ?? existing.unrealizedPnL);
                        if (existing.currentPrice !== newPrice || existing.unrealizedPnL !== newPnL) {
                            updated[idx] = { ...existing, currentPrice: newPrice, unrealizedPnL: newPnL };
                            changed = true;
                        }
                    }
                }
                if (changed) applySnapshot({ positions: updated });
            } else {
                applySnapshot({ positions: rawPositions.map(normalizePosition) });
            }
            return;
          }

          const rawPosition = payload.position ?? payload.closed_position ?? payload;
          const current = useAppStore.getState().positions;
          const nextPositions = ['close', 'closed', 'sl_hit', 'tp_hit', 'stop_out'].some((type) => eventType.includes(type))
            ? removePosition(current, rawPosition)
            : mergePosition(current, rawPosition);
          applySnapshot({ positions: nextPositions });
          return;
        }

        if (channel.startsWith(`deals.${login}`) || channel.startsWith(`orders.${login}`)) {
          const rawDeals = Array.isArray(payload) ? payload : payload.deals ? payload.deals : [payload.deal ?? payload];
          if (Array.isArray(rawDeals)) {
            const incoming = rawDeals.map(normalizeDeal);
            const current = useAppStore.getState().trades;
            const ids = new Set(incoming.map((deal) => deal.id));
            applySnapshot({ deals: [...incoming, ...current.filter((deal) => !ids.has(deal.id))].slice(0, 500) });
          }
        }
      } catch (error) {
        console.debug('[TradeFacingData] Ignoring malformed WS message:', error);
      }
    };

    ws.onclose = () => setWsConnected(false);
    ws.onerror = () => setWsConnected(false);

    return () => {
      setWsConnected(false);
      ws.close(1000, 'trade-facing hook unmounted');
      if (wsRef.current === ws) wsRef.current = null;
    };
  }, [applySnapshot, enabled, login]);

  useEffect(() => {
    if (enabled) return;
    if (!account && positions.length === 0 && trades.length === 0) return;
    setState((prev) => ({
      ...prev,
      lastUpdated: Date.now(),
    }));
  }, [account, enabled, positions, trades]);

  return {
    ...state,
    login,
    refresh,
    wsConnected: enabled ? wsConnected : storeWsConnected,
  };
}
