import {
  useCallback,
  useEffect,
  useRef,
  type Dispatch,
  type MutableRefObject,
  type SetStateAction,
} from 'react';
import { api } from '../../services/api';
import { applyPositionStreamUpdate, decodePositionStreamMessage } from '../../services/tradePositionStream';
import { beginTradeHistoryRefresh } from '../../services/terminalHistory';
import { useAppStore, type Order, type Position } from '../../store/useAppStore';
import { parsePositiveLogin } from '../session/sessionIdentity';
import { fetchOrderHistory, getErrorMessage } from './orderHistoryRefresh';
import {
  applyOpenPositionSnapshot,
  normalizePositions,
} from './positionRuntime';
import type {
  PendingPositionsRefresh,
  RefreshPositionsOptions,
  TradeRestRead,
} from './tradeRuntimeContracts';

interface UseTradeRefreshControllerOptions {
  getLiveTradingLogin: () => number | null;
  beginTradeRestRead: () => TradeRestRead;
  isStaleTradeRestRead: (request: TradeRestRead, options?: RefreshPositionsOptions) => boolean;
  reconcileOptimisticClosedPositions: (
    positions: Position[],
    options?: { clearConfirmedAbsent?: boolean },
  ) => Position[];
  accountIdRef: MutableRefObject<string>;
  isAuthenticatedRef: MutableRefObject<boolean>;
  positionsStreamVersionRef: MutableRefObject<number>;
  setOrders: Dispatch<SetStateAction<unknown[]>>;
}

interface TradeRefreshController {
  refreshPositions: (login?: number, options?: RefreshPositionsOptions) => Promise<void>;
  refreshOrdersAndHistory: (login?: number) => Promise<void>;
}

export const useTradeRefreshController = ({
  getLiveTradingLogin,
  beginTradeRestRead,
  isStaleTradeRestRead,
  reconcileOptimisticClosedPositions,
  accountIdRef,
  isAuthenticatedRef,
  positionsStreamVersionRef,
  setOrders,
}: UseTradeRefreshControllerOptions): TradeRefreshController => {
  const refreshPositionsInFlightRef = useRef<Promise<void> | null>(null);
  const refreshPositionsPendingRef = useRef<PendingPositionsRefresh | null>(null);
  const refreshHistoryInFlightRef = useRef<Promise<void> | null>(null);
  const refreshHistoryPendingLoginRef = useRef<number | null>(null);

  const refreshPositions = useCallback(async (
    login?: number,
    options: RefreshPositionsOptions = {},
  ): Promise<void> => {
    const requestedLogin = login || getLiveTradingLogin();
    if (!requestedLogin) return;
    if (refreshPositionsInFlightRef.current) {
      refreshPositionsPendingRef.current = { login: requestedLogin, options };
      await refreshPositionsInFlightRef.current;
      return;
    }

    const request = (async () => {
      try {
        const restRead = beginTradeRestRead();
        const startedAuthToken = useAppStore.getState().authToken;
        const positionsVersion = positionsStreamVersionRef.current;
        const positionsPayload = await api.positions.getPositions(requestedLogin);
        const activeLogin = parsePositiveLogin(useAppStore.getState().accountId || accountIdRef.current || undefined);
        if (!isAuthenticatedRef.current || activeLogin !== requestedLogin) return;
        if (useAppStore.getState().authToken !== startedAuthToken) return;
        if (isStaleTradeRestRead(restRead, options)) return;

        const currentPositions = useAppStore.getState().positions;
        const decoded = decodePositionStreamMessage({ data: { positions: positionsPayload } });
        const normalized = reconcileOptimisticClosedPositions(decoded
          ? applyPositionStreamUpdate(currentPositions, {
            ...decoded,
            source: 'rest',
            kind: positionsStreamVersionRef.current > positionsVersion ? 'patch' : 'snapshot',
          }, (raw) => normalizePositions([raw])[0])
          : normalizePositions(positionsPayload), { clearConfirmedAbsent: true });
        applyOpenPositionSnapshot(normalized);
      } catch (error) {
        console.warn('[App] refreshPositions failed:', getErrorMessage(error, 'Position refresh failed'));
      } finally {
        refreshPositionsInFlightRef.current = null;
        const pendingRefresh = refreshPositionsPendingRef.current;
        refreshPositionsPendingRef.current = null;
        if (pendingRefresh) void refreshPositions(pendingRefresh.login, pendingRefresh.options);
      }
    })();

    refreshPositionsInFlightRef.current = request;
    await request;
  }, [
    accountIdRef,
    beginTradeRestRead,
    getLiveTradingLogin,
    isAuthenticatedRef,
    isStaleTradeRestRead,
    positionsStreamVersionRef,
    reconcileOptimisticClosedPositions,
  ]);

  const refreshOrdersAndHistory = useCallback(async (login?: number): Promise<void> => {
    const resolvedLogin = login || getLiveTradingLogin();
    if (!resolvedLogin) return;
    if (refreshHistoryInFlightRef.current) {
      refreshHistoryPendingLoginRef.current = resolvedLogin;
      await refreshHistoryInFlightRef.current;
      return;
    }

    beginTradeHistoryRefresh();
    window.dispatchEvent(new CustomEvent('rtx:trade-history-refresh-started', {
      detail: { login: resolvedLogin },
    }));
    const request = (async () => {
      let historyError: unknown = null;
      let historySucceeded = false;
      try {
        const [pendingOrdersResult, orderHistoryResult] = await Promise.allSettled([
          api.orders.getPendingOrders(resolvedLogin),
          fetchOrderHistory(resolvedLogin),
        ]);
        if (!isAuthenticatedRef.current || getLiveTradingLogin() !== resolvedLogin) return;

        const pendingOrders = pendingOrdersResult.status === 'fulfilled'
          ? pendingOrdersResult.value
          : [];
        setOrders(pendingOrders);
        useAppStore.getState().setOrders(pendingOrders as unknown as Order[]);

        if (orderHistoryResult.status === 'fulfilled') {
          historySucceeded = true;
          useAppStore.getState().setTrades(orderHistoryResult.value.trades);
          if (orderHistoryResult.value.warning) {
            historyError = orderHistoryResult.value.warning;
            console.warn('[History] Partially refreshed trade history:', historyError);
            window.dispatchEvent(new CustomEvent('rtx:trade-history-refresh-error', {
              detail: {
                login: resolvedLogin,
                partial: true,
                message: getErrorMessage(historyError, 'Some order history sources failed'),
              },
            }));
          }
        } else {
          historyError = orderHistoryResult.reason;
          console.error('[History] Failed to refresh trade history:', historyError);
          window.dispatchEvent(new CustomEvent('rtx:trade-history-refresh-error', {
            detail: {
              login: resolvedLogin,
              message: getErrorMessage(historyError, 'Failed to refresh order history'),
            },
          }));
        }
      } finally {
        refreshHistoryInFlightRef.current = null;
        window.dispatchEvent(new CustomEvent('rtx:trade-history-refresh-completed', {
          detail: {
            login: resolvedLogin,
            ok: historySucceeded,
            message: historyError ? getErrorMessage(historyError, 'Failed to refresh order history') : null,
          },
        }));
        const pendingLogin = refreshHistoryPendingLoginRef.current;
        refreshHistoryPendingLoginRef.current = null;
        if (pendingLogin) void refreshOrdersAndHistory(pendingLogin);
      }
    })();

    refreshHistoryInFlightRef.current = request;
    await request;
  }, [getLiveTradingLogin, isAuthenticatedRef, setOrders]);

  useEffect(() => {
    let refreshTimer: number | null = null;
    let pendingLogin: number | null = null;
    const handleSync = (event: Event) => {
      const eventLogin = parsePositiveLogin(String((event as CustomEvent)?.detail?.login ?? ''));
      const requestedLogin = eventLogin || getLiveTradingLogin();
      if (!requestedLogin) return;
      pendingLogin = requestedLogin;
      if (refreshTimer !== null) window.clearTimeout(refreshTimer);
      refreshTimer = window.setTimeout(() => {
        refreshTimer = null;
        const nextLogin = pendingLogin;
        pendingLogin = null;
        if (nextLogin) void refreshPositions(nextLogin, { allowWsCommit: true });
      }, 100);
    };
    window.addEventListener('rtx:force-refresh-positions', handleSync);
    return () => {
      window.removeEventListener('rtx:force-refresh-positions', handleSync);
      if (refreshTimer !== null) window.clearTimeout(refreshTimer);
    };
  }, [getLiveTradingLogin, refreshPositions]);

  useEffect(() => {
    const handleHistoryRefreshRequest = (event: Event) => {
      if (!isAuthenticatedRef.current) return;
      const requestedLogin = parsePositiveLogin(String((event as CustomEvent)?.detail?.login ?? ''));
      const liveLogin = getLiveTradingLogin();
      if (!requestedLogin || !liveLogin || requestedLogin !== liveLogin) return;
      void refreshOrdersAndHistory(requestedLogin).catch((error) => {
        console.error('[History] Failed to refresh orders/history:', error);
      });
    };
    window.addEventListener('rtx:refresh-trade-history-requested', handleHistoryRefreshRequest);
    return () => window.removeEventListener('rtx:refresh-trade-history-requested', handleHistoryRefreshRequest);
  }, [getLiveTradingLogin, isAuthenticatedRef, refreshOrdersAndHistory]);

  return { refreshPositions, refreshOrdersAndHistory };
};
