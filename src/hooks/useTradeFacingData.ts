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

const INITIAL_STATE: HookState = {
  loading: false,
  error: null,
  lastUpdated: null,
};

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

export function useTradeFacingData(accountId?: string | number, pollMs = 10000) {
  const storeAccountId = useAppStore((state) => state.accountId);
  const setAccount = useAppStore((state) => state.setAccount);
  const setPositions = useAppStore((state) => state.setPositions);
  const setTrades = useAppStore((state) => state.setTrades);
  const [state, setState] = useState<HookState>(INITIAL_STATE);
  const wsRef = useRef<WebSocket | null>(null);
  const [wsConnected, setWsConnected] = useState(false);

  const login = useMemo(() => {
    const direct = Number.parseInt(String(accountId ?? storeAccountId ?? ''), 10);
    if (Number.isFinite(direct) && direct > 0) return direct;
    return getStoredAccountLogin();
  }, [accountId, storeAccountId]);

  const applySnapshot = useCallback((snapshot: Partial<TradeGatewaySnapshot>) => {
    if (snapshot.account) setAccount(snapshot.account);
    if (snapshot.positions) setPositions(snapshot.positions);
    if (snapshot.deals) setTrades(snapshot.deals);
    setState((prev) => ({
      ...prev,
      lastUpdated: Date.now(),
    }));
  }, [setAccount, setPositions, setTrades]);

  const refresh = useCallback(async () => {
    if (!login) return;

    setState((prev) => ({ ...prev, loading: true, error: null }));
    try {
      const [account, positions, deals] = await Promise.all([
        tradeGatewayApi.getAccount(login),
        tradeGatewayApi.getPositions(login),
        tradeGatewayApi.getDeals(login).catch(() => tradeGatewayApi.getDeals(undefined)),
      ]);
      applySnapshot({ account, positions, deals });
      setState((prev) => ({ ...prev, loading: false, error: null }));
    } catch (error) {
      setState((prev) => ({
        ...prev,
        loading: false,
        error: error instanceof Error ? error.message : 'Failed to refresh trading data',
      }));
    }
  }, [applySnapshot, login]);

  useEffect(() => {
    refresh();
    if (!login || pollMs <= 0) return;

    const interval = window.setInterval(refresh, pollMs);
    const forceRefresh = () => refresh();
    window.addEventListener('rtx:force-refresh-positions', forceRefresh);
    return () => {
      window.clearInterval(interval);
      window.removeEventListener('rtx:force-refresh-positions', forceRefresh);
    };
  }, [login, pollMs, refresh]);

  useEffect(() => {
    if (!login || typeof window === 'undefined') return;

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
          const rawPositions = Array.isArray(payload) ? payload : payload.positions;
          if (Array.isArray(rawPositions)) {
            applySnapshot({ positions: rawPositions.map(normalizePosition) });
            return;
          }

          const eventType = String(message.event ?? message.type ?? payload.event ?? payload.type ?? '').toLowerCase();
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
  }, [applySnapshot, login]);

  return {
    ...state,
    login,
    refresh,
    wsConnected,
  };
}
