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
    if (!login || pollMs <= 0) return;

    const interval = window.setInterval(() => {
      refreshRef.current();
    }, pollMs);
    const forceRefresh = () => refreshRef.current();
    window.addEventListener('rtx:force-refresh-positions', forceRefresh);
    return () => {
      window.clearInterval(interval);
      window.removeEventListener('rtx:force-refresh-positions', forceRefresh);
    };
  }, [enabled, login, pollMs]);

  // Reconnect state refs for Exponential Backoff
  const reconnectAttemptsRef = useRef(0);
  const reconnectTimerRef = useRef<number | null>(null);

  // Helper to determine contract size for a symbol (Forex default, custom indices/metals/cryptos)
  const getContractSize = useCallback((symbol: string): number => {
    const sym = String(symbol || '').trim().toUpperCase();
    if (sym.startsWith('BTC') || sym.startsWith('ETH') || sym.startsWith('XRP') || sym.startsWith('SOL') || sym.startsWith('BNB')) {
      return 1;
    }
    if (sym.startsWith('XAU')) {
      return 100;
    }
    if (sym.startsWith('XAG')) {
      return 5000;
    }
    if (sym.startsWith('WTI') || sym.startsWith('BCO') || sym.startsWith('NATGAS')) {
      return 1000;
    }
    // Standard Forex
    return 100000;
  }, []);

  // Recalculates account equity and margin levels locally based on latest ticks
  const computeLocalEquityAndFreeMargin = useCallback(() => {
    const store = useAppStore.getState();
    const currentAccount = store.account;
    if (!currentAccount) return;

    const currentPositions = store.positions;
    let totalFloatingPnL = 0;

    const updatedPositions = currentPositions.map((pos) => {
      const symbol = pos.symbol;
      const direction = pos.side === 'SELL' ? -1 : 1;
      const volume = pos.volume;
      const contractSize = getContractSize(symbol);
      const openPrice = pos.openPrice;

      // Try to resolve latest tick prices
      const tick = store.ticks[symbol];
      let currentPrice = pos.currentPrice;
      if (tick) {
        currentPrice = pos.side === 'SELL' ? tick.ask : tick.bid;
        if (!currentPrice || currentPrice <= 0) {
          currentPrice = tick.bid || tick.last || pos.currentPrice;
        }
      }

      if (currentPrice > 0 && openPrice > 0) {
        const positionPnL = (currentPrice - openPrice) * direction * volume * contractSize;
        totalFloatingPnL += positionPnL;
        return {
          ...pos,
          currentPrice,
          unrealizedPnL: Number(positionPnL.toFixed(2)),
        };
      }
      return pos;
    });

    const balance = currentAccount.balance;
    const equity = Number((balance + totalFloatingPnL).toFixed(2));
    const margin = currentAccount.margin;
    const freeMargin = Number((equity - margin).toFixed(2));
    const marginLevel = margin > 0 ? Number(((equity / margin) * 100).toFixed(2)) : 0;

    store.setAccount({
      ...currentAccount,
      equity,
      freeMargin,
      marginLevel,
      unrealizedPL: Number(totalFloatingPnL.toFixed(2)),
    });

    store.setPositions(updatedPositions);
  }, [getContractSize]);

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

