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
  const authToken = useAppStore((state) => state.authToken);
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
      const startedStore = useAppStore.getState();
      const sessionCurrent = () => {
        const current = useAppStore.getState();
        return current.accountId === startedStore.accountId && current.authToken === startedStore.authToken;
      };
      const startedAt = Date.now();
      setState((prev) => ({ ...prev, loading: true, error: null }));
      setTradeApiStatus({ loading: true, error: null, lastStartedAt: startedAt });
      try {
        const [account, positions, deals] = await Promise.all([
          tradeGatewayApi.getAccount(login),
          tradeGatewayApi.getPositions(login),
          tradeGatewayApi.getDeals(login).catch(() => tradeGatewayApi.getDeals(undefined)),
        ]);
        if (!sessionCurrent()) return;
        const livePositions = useAppStore.getState().positions;
        const liveTickets = new Set(livePositions.map((position) => position.id));
        applySnapshot({ account, positions: livePositions === startedStore.positions ? positions
          : [...livePositions, ...positions.filter((position) => !liveTickets.has(position.id))], deals });
        const completedAt = Date.now();
        setState((prev) => ({ ...prev, loading: false, error: null, lastUpdated: completedAt }));
        setTradeApiStatus({ loading: false, error: null, lastUpdated: completedAt });
      } catch (error) {
        if (!sessionCurrent()) return;
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

  // Keep a stable ref to refresh to avoid interval teardown/re-execution on callback change
  const refreshRef = useRef(refresh);
  useEffect(() => {
    refreshRef.current = refresh;
  }, [refresh]);

  // Polling — only runs for the singleton instance that claimed the slot above.
  useEffect(() => {
    if (!enabled) return;
    if (_activeTradeFacingInstanceId !== instanceId.current) return;

    refreshRef.current();
    // Live account/position/deal streams already update the store. REST polling
    // on a connected socket only contends with order execution for the DB pool.
    if (!login || pollMs <= 0 || storeWsConnected) return;

    const interval = window.setInterval(() => {
      refreshRef.current();
    }, pollMs);
    const forceRefresh = () => refreshRef.current();
    window.addEventListener('rtx:force-refresh-positions', forceRefresh);
    return () => {
      window.clearInterval(interval);
      window.removeEventListener('rtx:force-refresh-positions', forceRefresh);
    };
  }, [enabled, login, pollMs, storeWsConnected]);

  // Reconnect state refs for Exponential Backoff
  const reconnectAttemptsRef = useRef(0);
  const reconnectTimerRef = useRef<number | null>(null);

  // NOTE: A local equity/free-margin recompute used to live here, driven by a
  // symbol-prefix `getContractSize` heuristic. It was never wired into any
  // displayed value (dead code) and the heuristic produced incorrect money math
  // for any non-standard contract size. It has been removed to eliminate the
  // latent hazard. If client-side equity recomputation is reintroduced, it MUST
  // source the real `contract_size` from the broker symbol catalog rather than
  // guessing from the symbol prefix. Equity/margin are otherwise authoritative
  // from the gateway via AccountSocketManager (below).

  // WebSocket — uses AccountSocketManager (Section 4 of WS flow).
  // The AccountSocketManager handles auth, channel subscription, position/account
  // normalization, and pushes directly to Zustand store. We just need to connect it.
  useEffect(() => {
    if (!enabled || !login || typeof window === 'undefined') return;
    if (_activeTradeFacingInstanceId !== instanceId.current) return;

    let cleanupRef: (() => void) | null = null;
    let disposed = false;

    console.log(`[TradeFacingData] WS effect fired — login=${login}, enabled=${enabled}`);

    // Dynamically import to avoid circular deps at module level
    import('../services/accountSocketManager').then(({ getAccountSocketManager }) => {
      if (disposed) return;

      const manager = getAccountSocketManager();
      console.log(`[TradeFacingData] AccountSocketManager loaded — current login=${manager.getLogin()}, target login=${login}`);

      // Connect (or reconnect if login changed)
      if (manager.getLogin() !== login) {
        console.log(`[TradeFacingData] Calling manager.connect(${login})`);
        manager.connect(login);
      }

      cleanupRef = manager.onConnectionChange((connected) => {
        if (!disposed) setWsConnected(connected);
      });
    }).catch(err => {
      console.error('[TradeFacingData] Failed to load AccountSocketManager:', err);
    });

    return () => {
      disposed = true;
      setWsConnected(false);
      if (cleanupRef) cleanupRef();
    };
  }, [enabled, login, authToken]);

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

