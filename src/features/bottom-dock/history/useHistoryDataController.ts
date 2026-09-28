import { useCallback, useEffect, useRef, useState } from 'react';
import { getStoredAccountLogin, type TradeHistoryDataSet } from '../../../api/tradeGateway';
import { TRADE_HISTORY_REFRESH_COMPLETED_EVENT, type TradeHistoryRefreshCompletedEventDetail } from '../../../contracts/terminalEvents';
import {
  getCommittedBrokerAccountSessionScope,
  getCommittedBrokerAccountSessionScopeKey,
  onCommittedBrokerAccountSessionScopeChange,
} from '../../../services/brokerSession';
import { loadTerminalHistory, peekTerminalHistory } from '../../../services/terminalHistory';
import { useAppStore } from '../../../store/useAppStore';
import { EMPTY_HISTORY_DATA_SET } from './historyFilters';

export type HistoryFetchOptions = {
  force?: boolean;
  background?: boolean;
  refresh?: boolean;
};

const getCurrentSessionScopeKey = (): string => getCommittedBrokerAccountSessionScopeKey(
  getCommittedBrokerAccountSessionScope(),
);

export const useHistoryDataController = (
  activeLogin: number,
  activeScopeKey: string,
): {
  historyData: TradeHistoryDataSet;
  loading: boolean;
  ordersPending: boolean;
  error: string | null;
  sessionResetVersion: number;
  fetchHistory: (options?: HistoryFetchOptions) => Promise<void>;
} => {
  const cachedHistory = peekTerminalHistory(activeLogin, activeScopeKey);
  const [historyData, setHistoryData] = useState<TradeHistoryDataSet>(
    () => cachedHistory?.data ?? EMPTY_HISTORY_DATA_SET,
  );
  const [loading, setLoading] = useState(() => !cachedHistory);
  const [ordersPending, setOrdersPending] = useState(() => cachedHistory?.ordersPending ?? false);
  const [error, setError] = useState<string | null>(null);
  const [sessionResetVersion, setSessionResetVersion] = useState(0);
  const requestSerialRef = useRef(0);
  const mountedRef = useRef(false);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      requestSerialRef.current += 1;
    };
  }, []);

  const fetchHistory = useCallback(async (options?: HistoryFetchOptions) => {
    const requestSerial = ++requestSerialRef.current;
    const login = Number.isFinite(activeLogin) && activeLogin > 0 ? activeLogin : null;
    if (!login) {
      setError('No account login found');
      if (!options?.background) setLoading(false);
      return;
    }

    if (!options?.background) setLoading(true);
    setError(null);
    const stillCurrent = () => (
      mountedRef.current
      && requestSerial === requestSerialRef.current
      && Number.parseInt(String(useAppStore.getState().accountId ?? getStoredAccountLogin() ?? ''), 10) === login
      && getCurrentSessionScopeKey() === activeScopeKey
    );

    try {
      const data = await loadTerminalHistory(login, activeScopeKey, {
        force: options?.force,
        refresh: options?.refresh,
        onUpdate: (next, pending) => {
          if (!stillCurrent()) return;
          setHistoryData(next);
          setOrdersPending(pending);
          if (!pending || next.positions.length > 0 || next.deals.length > 0 || next.orders.length > 0) {
            setLoading(false);
          }
        },
      });
      if (!stillCurrent()) return;
      setHistoryData(data);
      setOrdersPending(false);
    } catch (caught: unknown) {
      if (!stillCurrent()) return;
      console.warn('[History] Failed to load:', caught);
      setOrdersPending(false);
      if (!options?.background) {
        setError(caught instanceof Error ? caught.message : 'Failed to load history');
      }
    } finally {
      if (stillCurrent() && !options?.background) setLoading(false);
    }
  }, [activeLogin, activeScopeKey]);

  useEffect(() => {
    const cached = peekTerminalHistory(activeLogin, activeScopeKey);
    if (cached) {
      setHistoryData(cached.data);
      setOrdersPending(cached.ordersPending);
      setLoading(false);
    } else {
      setHistoryData(EMPTY_HISTORY_DATA_SET);
      setOrdersPending(false);
    }
    void fetchHistory({ background: Boolean(cached) });
  }, [activeLogin, activeScopeKey, fetchHistory]);

  useEffect(() => {
    const handleCompleted = (event: Event) => {
      const detail = (event as CustomEvent<TradeHistoryRefreshCompletedEventDetail>).detail;
      if (!detail || detail.ok === false || detail.login !== activeLogin) return;
      void fetchHistory({ background: true, refresh: true });
    };
    window.addEventListener(TRADE_HISTORY_REFRESH_COMPLETED_EVENT, handleCompleted);
    return () => window.removeEventListener(TRADE_HISTORY_REFRESH_COMPLETED_EVENT, handleCompleted);
  }, [activeLogin, fetchHistory]);

  useEffect(() => onCommittedBrokerAccountSessionScopeChange(() => {
    requestSerialRef.current += 1;
    setHistoryData(EMPTY_HISTORY_DATA_SET);
    setOrdersPending(false);
    setError(null);
    setSessionResetVersion(version => version + 1);
  }), []);

  return {
    historyData,
    loading,
    ordersPending,
    error,
    sessionResetVersion,
    fetchHistory,
  };
};
