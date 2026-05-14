import { useState, useEffect, useCallback, useRef } from 'react';
import {
  ApiError,
  setToken,
  removeToken,
} from './client';
import {
  authApi,
  accountApi,
  tradingApi,
  marketApi,
  notificationsApi,
  economicCalendarApi,
  LoginCredentials,
  CreateOrderRequest,
  AccountSummary,
  Transaction,
  EquityHistoryPoint,
  Position,
  Order,
  Symbol,
  Quote,
  Notification,
  EconomicEvent,
} from './endpoints';
import { getStoredBrokerServer, persistBrokerServer, resolveLoginBrokerTarget } from '../services/brokerServers';
import { useAppStore } from '../store/useAppStore';

// ====================
// Generic Types
// ====================

interface UseApiState<T> {
  data: T | null;
  loading: boolean;
  error: ApiError | null;
}

interface UseApiReturn<T> extends UseApiState<T> {
  refetch: () => Promise<void>;
  reset: () => void;
}

type AccountLogin = string | number | null | undefined;

const parseAccountLogin = (login: AccountLogin): number | undefined => {
  const parsed = typeof login === 'number' ? login : Number.parseInt(String(login ?? ''), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
};

const getStoredAccountLogin = (): number | undefined => {
  if (typeof window === 'undefined') return undefined;
  return parseAccountLogin(
    localStorage.getItem('rtx_saved_username') || localStorage.getItem('rtx_last_login')
  );
};

const useResolvedAccountLogin = (explicitLogin?: AccountLogin): number | undefined => {
  const activeAccountId = useAppStore((state) => state.accountId);
  return parseAccountLogin(explicitLogin) ?? parseAccountLogin(activeAccountId) ?? getStoredAccountLogin();
};

const normalizePositionsResponse = (data: unknown): { positions: Position[]; count: number } => {
  const payload = data as { positions?: unknown; count?: unknown; total?: unknown } | null | undefined;
  const positions = Array.isArray(data) ? data : payload?.positions;
  const rows = Array.isArray(positions) ? positions : [];
  return {
    positions: rows as Position[],
    count: Number(payload?.count ?? payload?.total ?? rows.length),
  };
};

const normalizeOrdersResponse = (data: unknown): { orders: Order[]; total: number } => {
  const payload = data as { orders?: unknown; count?: unknown; total?: unknown } | null | undefined;
  const orders = Array.isArray(data) ? data : payload?.orders;
  const rows = Array.isArray(orders) ? orders : [];
  return {
    orders: rows as Order[],
    total: Number(payload?.total ?? payload?.count ?? rows.length),
  };
};

// ====================
// Generic Hook Factory
// ====================

function createUseApiHook<T>(fetchFn: () => Promise<T>, deps: unknown[] = []) {
  return function useApiHook(): UseApiReturn<T> {
    const fetchFnRef = useRef(fetchFn);
    fetchFnRef.current = fetchFn;

    const [state, setState] = useState<UseApiState<T>>({
      data: null,
      loading: true,
      error: null,
    });

    const fetchData = useCallback(async () => {
      setState(prev => ({ ...prev, loading: true, error: null }));
      try {
        const data = await fetchFnRef.current();
        setState({ data, loading: false, error: null });
      } catch (error) {
        setState({
          data: null,
          loading: false,
          error: error instanceof ApiError ? error : new ApiError(0, 'Unknown error'),
        });
      }
    }, []);

    const reset = useCallback(() => {
      setState({ data: null, loading: false, error: null });
    }, []);

    useEffect(() => {
      fetchData();
    }, deps);

    return { ...state, refetch: fetchData, reset };
  };
}

// ====================
// Auth Hooks
// ====================

export const useLogin = () => {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);

  const login = useCallback(async (credentials: LoginCredentials) => {
    setLoading(true);
    setError(null);
    try {
      const selectedServer = credentials.server || getStoredBrokerServer();
      const loginTarget = credentials.broker_id
        ? { displayValue: credentials.broker_id, broker_id: credentials.broker_id }
        : resolveLoginBrokerTarget(selectedServer);
      const response = await authApi.login({
        ...credentials,
        broker_id: loginTarget.broker_id,
        server: loginTarget.server,
      });
      persistBrokerServer(response.broker_server || loginTarget.displayValue);
      const accessToken = response.access_token || response.token;
      if (accessToken) {
        setToken(accessToken);
      }
      return response;
    } catch (err) {
      const apiError = err instanceof ApiError ? err : new ApiError(0, 'Login failed');
      setError(apiError);
      throw apiError;
    } finally {
      setLoading(false);
    }
  }, []);

  return { login, loading, error };
};

export const useLogout = () => {
  const [loading, setLoading] = useState(false);

  const logout = useCallback(async () => {
    setLoading(true);
    try {
      await authApi.logout();
    } finally {
      removeToken();
      setLoading(false);
    }
  }, []);

  return { logout, loading };
};

// export const useCurrentUser = () => {
//   return createUseApiHook<User>(() => authApi.me(), [])();
// };

// ====================
// Account Hooks
// ====================

export const useAccount = (login?: AccountLogin): UseApiReturn<AccountSummary> => {
  const resolvedLogin = useResolvedAccountLogin(login);
  return createUseApiHook<AccountSummary | null>(
    () => resolvedLogin ? accountApi.getSummary(resolvedLogin) : Promise.resolve(null),
    [resolvedLogin]
  )() as UseApiReturn<AccountSummary>;
};

interface UseTransactionsParams {
  startDate?: string;
  endDate?: string;
  type?: string;
  limit?: number;
  offset?: number;
  login?: AccountLogin;
}

export const useTransactions = (params?: UseTransactionsParams) => {
  const resolvedLogin = useResolvedAccountLogin(params?.login);
  const { type, limit, offset } = params || {};
  const [state, setState] = useState<UseApiState<{ transactions: Transaction[]; total: number }>>({
    data: null,
    loading: true,
    error: null,
  });

  const fetchTransactions = useCallback(async () => {
    setState(prev => ({ ...prev, loading: true, error: null }));
    if (!resolvedLogin) {
      setState({ data: { transactions: [], total: 0 }, loading: false, error: null });
      return;
    }

    try {
      const data = await accountApi.getTransactions({ type, limit, offset, login: resolvedLogin });
      setState({ data: { transactions: data, total: data.length }, loading: false, error: null });
    } catch (error) {
      setState({
        data: null,
        loading: false,
        error: error instanceof ApiError ? error : new ApiError(0, 'Failed to fetch transactions'),
      });
    }
  }, [type, limit, offset, resolvedLogin]);

  useEffect(() => {
    fetchTransactions();
  }, [fetchTransactions]);

  return { ...state, refetch: fetchTransactions };
};

interface UseEquityHistoryParams {
  period?: '1d' | '7d' | '30d' | '90d' | '1y';
  login?: AccountLogin;
}

export const useEquityHistory = (params?: UseEquityHistoryParams) => {
  const resolvedLogin = useResolvedAccountLogin(params?.login);
  const { period } = params || {};
  const [state, setState] = useState<UseApiState<EquityHistoryPoint[]>>({
    data: null,
    loading: true,
    error: null,
  });

  const fetchHistory = useCallback(async () => {
    setState(prev => ({ ...prev, loading: true, error: null }));
    if (!resolvedLogin) {
      setState({ data: [], loading: false, error: null });
      return;
    }

    try {
      const data = await accountApi.getEquityHistory({ period, login: resolvedLogin });
      setState({ data, loading: false, error: null });
    } catch (error) {
      setState({
        data: null,
        loading: false,
        error: error instanceof ApiError ? error : new ApiError(0, 'Failed to fetch equity history'),
      });
    }
  }, [period, resolvedLogin]);

  useEffect(() => {
    fetchHistory();
  }, [fetchHistory]);

  return { ...state, refetch: fetchHistory };
};

// ====================
// Trading Hooks
// ====================

export const usePositions = (login?: AccountLogin): UseApiReturn<{ positions: Position[]; count: number }> => {
  const resolvedLogin = useResolvedAccountLogin(login);
  return createUseApiHook<{ positions: Position[]; count: number }>(
    async () => {
      if (!resolvedLogin) return { positions: [], count: 0 };
      return normalizePositionsResponse(await tradingApi.getPositions(resolvedLogin));
    },
    [resolvedLogin]
  )();
};

interface UseOrdersParams {
  status?: string;
  symbol?: string;
  login?: AccountLogin;
}

export const useOrders = (params?: UseOrdersParams, login?: AccountLogin) => {
  const resolvedLogin = useResolvedAccountLogin(login ?? params?.login);
  const { status, symbol } = params || {};
  const [state, setState] = useState<UseApiState<{ orders: Order[]; total: number }>>({
    data: null,
    loading: true,
    error: null,
  });

  const fetchOrders = useCallback(async () => {
    setState(prev => ({ ...prev, loading: true, error: null }));
    if (!resolvedLogin) {
      setState({ data: { orders: [], total: 0 }, loading: false, error: null });
      return;
    }

    try {
      const data = await tradingApi.getOrders(resolvedLogin);
      const normalized = normalizeOrdersResponse(data);
      const filteredOrders = normalized.orders.filter((order) => (
        (!status || order.status === status) &&
        (!symbol || order.symbol === symbol)
      ));
      setState({
        data: { orders: filteredOrders, total: filteredOrders.length },
        loading: false,
        error: null
      });
    } catch (error) {
      setState({
        data: null,
        loading: false,
        error: error instanceof ApiError ? error : new ApiError(0, 'Failed to fetch orders'),
      });
    }
  }, [status, symbol, resolvedLogin]);

  useEffect(() => {
    fetchOrders();
  }, [fetchOrders]);

  return { ...state, refetch: fetchOrders };
};

export const usePlaceOrder = () => {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);

  const placeOrder = useCallback(async (order: CreateOrderRequest) => {
    setLoading(true);
    setError(null);
    try {
      const response = await tradingApi.placeOrder(order);
      return response;
    } catch (err) {
      const apiError = err instanceof ApiError ? err : new ApiError(0, 'Failed to place order');
      setError(apiError);
      throw apiError;
    } finally {
      setLoading(false);
    }
  }, []);

  return { placeOrder, loading, error };
};

export const useCloseOrder = () => {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);

  const closeOrder = useCallback(async (orderId: string) => {
    setLoading(true);
    setError(null);
    try {
      await tradingApi.cancelOrder(orderId);
    } catch (err) {
      const apiError = err instanceof ApiError ? err : new ApiError(0, 'Failed to close order');
      setError(apiError);
      throw apiError;
    } finally {
      setLoading(false);
    }
  }, []);

  return { closeOrder, loading, error };
};

export const useClosePosition = () => {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);

  const closePosition = useCallback(async (positionId: string, volume?: number) => {
    setLoading(true);
    setError(null);
    try {
      await tradingApi.closePosition(positionId);
    } catch (err) {
      const apiError = err instanceof ApiError ? err : new ApiError(0, 'Failed to close position');
      setError(apiError);
      throw apiError;
    } finally {
      setLoading(false);
    }
  }, []);

  return { closePosition, loading, error };
};

// ====================
// Market Hooks
// ====================

interface UseSymbolsParams {
  category?: string;
  search?: string;
}

export const useSymbols = (params?: UseSymbolsParams) => {
  const [state, setState] = useState<UseApiState<{ symbols: Symbol[]; total: number }>>({
    data: null,
    loading: true,
    error: null,
  });

  const fetchSymbols = useCallback(async () => {
    setState(prev => ({ ...prev, loading: true, error: null }));
    try {
      const data = await marketApi.getSymbols();
      setState({ data: { symbols: data, total: data.length }, loading: false, error: null });
    } catch (error) {
      setState({
        data: null,
        loading: false,
        error: error instanceof ApiError ? error : new ApiError(0, 'Failed to fetch symbols'),
      });
    }
  }, [params?.category, params?.search]);

  useEffect(() => {
    fetchSymbols();
  }, [fetchSymbols]);

  return { ...state, refetch: fetchSymbols };
};

export const useQuotes = (symbols?: string[]) => {
  const [state, setState] = useState<UseApiState<Quote[]>>({
    data: null,
    loading: true,
    error: null,
  });

  const fetchQuotes = useCallback(async () => {
    setState(prev => ({ ...prev, loading: true, error: null }));
    try {
      const promises = (symbols || []).map(sym => marketApi.getQuote(sym));
      const data = await Promise.all(promises);
      setState({ data, loading: false, error: null });
    } catch (error) {
      setState({
        data: null,
        loading: false,
        error: error instanceof ApiError ? error : new ApiError(0, 'Failed to fetch quotes'),
      });
    }
  }, [symbols?.join(',')]);

  useEffect(() => {
    fetchQuotes();
  }, [fetchQuotes]);

  return { ...state, refetch: fetchQuotes };
};

export const useQuote = (symbol: string) => {
  const [state, setState] = useState<UseApiState<Quote>>({
    data: null,
    loading: true,
    error: null,
  });

  const fetchQuote = useCallback(async () => {
    if (!symbol) return;
    setState(prev => ({ ...prev, loading: true, error: null }));
    try {
      const data = await marketApi.getQuote(symbol);
      setState({ data, loading: false, error: null });
    } catch (error) {
      setState({
        data: null,
        loading: false,
        error: error instanceof ApiError ? error : new ApiError(0, 'Failed to fetch quote'),
      });
    }
  }, [symbol]);

  useEffect(() => {
    fetchQuote();
  }, [fetchQuote]);

  return { ...state, refetch: fetchQuote };
};

// ====================
// Notifications Hooks
// ====================

interface UseNotificationsParams {
  unreadOnly?: boolean;
  limit?: number;
  offset?: number;
}

export const useNotifications = (params?: UseNotificationsParams) => {
  const [state, setState] = useState<UseApiState<{ notifications: Notification[]; total: number; unreadCount: number }>>({
    data: null,
    loading: true,
    error: null,
  });

  const fetchNotifications = useCallback(async () => {
    setState(prev => ({ ...prev, loading: true, error: null }));
    try {
      const data = await notificationsApi.getNotifications(params);
      setState({ data, loading: false, error: null });
    } catch (error) {
      setState({
        data: null,
        loading: false,
        error: error instanceof ApiError ? error : new ApiError(0, 'Failed to fetch notifications'),
      });
    }
  }, [params?.unreadOnly, params?.limit, params?.offset]);

  useEffect(() => {
    fetchNotifications();
  }, [fetchNotifications]);

  return { ...state, refetch: fetchNotifications };
};

export const useMarkNotificationAsRead = () => {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);

  const markAsRead = useCallback(async (notificationId: string) => {
    setLoading(true);
    setError(null);
    try {
      await notificationsApi.markAsRead(notificationId);
    } catch (err) {
      const apiError = err instanceof ApiError ? err : new ApiError(0, 'Failed to mark notification as read');
      setError(apiError);
      throw apiError;
    } finally {
      setLoading(false);
    }
  }, []);

  return { markAsRead, loading, error };
};

export const useMarkAllNotificationsAsRead = () => {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);

  const markAllAsRead = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      await notificationsApi.markAllAsRead();
    } catch (err) {
      const apiError = err instanceof ApiError ? err : new ApiError(0, 'Failed to mark all notifications as read');
      setError(apiError);
      throw apiError;
    } finally {
      setLoading(false);
    }
  }, []);

  return { markAllAsRead, loading, error };
};

// ====================
// Economic Calendar Hooks
// ====================

interface UseEconomicEventsParams {
  from?: string;
  to?: string;
  currencies?: string[];
  impact?: string[];
}

export const useEconomicEvents = (params?: UseEconomicEventsParams) => {
  const [state, setState] = useState<UseApiState<{ events: EconomicEvent[]; total: number }>>({
    data: null,
    loading: true,
    error: null,
  });

  const fetchEvents = useCallback(async () => {
    setState(prev => ({ ...prev, loading: true, error: null }));
    try {
      const data = await economicCalendarApi.getEvents(params);
      setState({ data, loading: false, error: null });
    } catch (error) {
      setState({
        data: null,
        loading: false,
        error: error instanceof ApiError ? error : new ApiError(0, 'Failed to fetch economic events'),
      });
    }
  }, [params?.from, params?.to, params?.currencies?.join(','), params?.impact?.join(',')]);

  useEffect(() => {
    fetchEvents();
  }, [fetchEvents]);

  return { ...state, refetch: fetchEvents };
};

export const useTodaysEconomicEvents = () => {
  return createUseApiHook<{ events: EconomicEvent[]; total: number }>(
    () => economicCalendarApi.getEventsForToday(),
    []
  )();
};

export const useWeeksEconomicEvents = () => {
  return createUseApiHook<{ events: EconomicEvent[]; total: number }>(
    () => economicCalendarApi.getEventsForWeek(),
    []
  )();
};

// ====================
// Polling Hooks
// ====================

export const usePolling = <T>(
  fetchFn: () => Promise<T>,
  interval: number = 5000,
  enabled: boolean = true
) => {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);
  const intervalRef = useRef<NodeJS.Timeout | null>(null);

  const fetchData = useCallback(async () => {
    if (loading) return;
    setLoading(true);
    try {
      const result = await fetchFn();
      setData(result);
      setError(null);
    } catch (err) {
      setError(err instanceof ApiError ? err : new ApiError(0, 'Polling error'));
    } finally {
      setLoading(false);
    }
  }, [fetchFn]);

  const startPolling = useCallback(() => {
    if (intervalRef.current) return;
    fetchData();
    intervalRef.current = setInterval(fetchData, interval);
  }, [fetchData, interval]);

  const stopPolling = useCallback(() => {
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
  }, []);

  useEffect(() => {
    if (enabled) {
      startPolling();
    }
    return () => stopPolling();
  }, [enabled, startPolling, stopPolling]);

  return { data, loading, error, refetch: fetchData, startPolling, stopPolling };
};

// Polling hooks for common use cases
export const usePollingQuotes = (symbols?: string[], interval: number = 5000) => {
  return usePolling(async () => {
    const promises = (symbols || []).map(sym => marketApi.getQuote(sym));
    return Promise.all(promises);
  }, interval, !!symbols?.length);
};

export const usePollingPositions = (interval: number = 5000, login?: AccountLogin) => {
  const resolvedLogin = useResolvedAccountLogin(login);
  return usePolling(
    async () => {
      if (!resolvedLogin) return { positions: [], count: 0 };
      return normalizePositionsResponse(await tradingApi.getPositions(resolvedLogin));
    },
    interval,
    !!resolvedLogin
  );
};

export const usePollingAccount = (interval: number = 10000, login?: AccountLogin) => {
  const resolvedLogin = useResolvedAccountLogin(login);
  return usePolling(
    () => resolvedLogin ? accountApi.getSummary(resolvedLogin) : Promise.resolve(null),
    interval,
    !!resolvedLogin
  );
};
