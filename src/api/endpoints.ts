import { apiClient } from './client';
import { API_HISTORY_BASE_URL, API_V2_BASE_URL, normalizeBrokerServerUrl } from '../config/api';

const resolveV2BaseUrl = (baseUrl?: string): string => {
  if (!baseUrl) return API_V2_BASE_URL;
  const trimmed = normalizeBrokerServerUrl(baseUrl).replace(/\/$/, '');
  return trimmed.endsWith('/api/v2') ? trimmed : `${trimmed}/api/v2`;
};

const resolveStoredLogin = (): number | undefined => {
  if (typeof window === 'undefined') return undefined;
  const raw = localStorage.getItem('rtx_saved_username') || localStorage.getItem('rtx_last_login');
  const parsed = raw ? Number.parseInt(raw, 10) : Number.NaN;
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
};

const getApiRootBaseUrl = (): string => API_V2_BASE_URL.replace(/\/api\/v2\/?$/, '');

const SYMBOL_ENDPOINTS = ['/api/v2/symbols', '/api/v1/symbols', '/manager/api/v2/symbols', '/api/v2/instruments'];

const resolveSymbolEndpoint = (endpoint: string): { endpoint: string; baseUrl: string } =>
  endpoint.startsWith('/api/v2')
    ? { endpoint: endpoint.replace(/^\/api\/v2(?=\/|$)/, '') || '/', baseUrl: API_V2_BASE_URL }
    : { endpoint, baseUrl: getApiRootBaseUrl() };

const extractInstrumentRows = (payload: any): any[] => {
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload?.symbols)) return payload.symbols;
  if (Array.isArray(payload?.instruments)) return payload.instruments;
  if (Array.isArray(payload?.data)) return payload.data;
  if (Array.isArray(payload?.result)) return payload.result;
  return [];
};

const requireLogin = (login: unknown, context: string): number => {
  const parsed = typeof login === 'number' ? login : Number.parseInt(String(login ?? ''), 10);
  if (Number.isFinite(parsed) && parsed > 0) return parsed;
  throw new Error(`Missing account login for ${context}`);
};

const requireTicket = (ticket: unknown, context: string): number => {
  const parsed = typeof ticket === 'number' ? ticket : Number.parseInt(String(ticket ?? ''), 10);
  if (Number.isFinite(parsed) && parsed > 0) return parsed;
  throw new Error(`Missing ticket for ${context}`);
};

const normalizeSide = (side: string): 'buy' | 'sell' => side.toLowerCase() === 'sell' ? 'sell' : 'buy';

const normalizeOrderPayload = (order: CreateOrderRequest): CreateOrderRequest & { login: number; side: 'buy' | 'sell'; volume: number } => {
  const login = requireLogin(order.login ?? order.account_login, '/api/v2/orders');
  const volume = order.volume ?? order.quantity;
  if (!volume || volume <= 0) {
    throw new Error('Missing order volume for /api/v2/orders');
  }

  const { account_login: _accountLogin, quantity: _quantity, sl, tp, type: _type, ...rest } = order;
  return {
    ...rest,
    login,
    side: normalizeSide(order.side),
    volume,
    price_sl: order.price_sl ?? sl,
    price_tp: order.price_tp ?? tp,
  };
};

const normalizePendingOrderPayload = (order: PendingOrderRequest): PendingOrderRequest & { login: number; side: 'buy' | 'sell' } => {
  const login = requireLogin(order.login ?? order.account_login, '/api/v2/orders/pending');
  const { account_login: _accountLogin, sl, tp, ...rest } = order;
  return {
    ...rest,
    login,
    side: normalizeSide(order.side),
    type: order.type.toLowerCase() as PendingOrderRequest['type'],
    price_sl: order.price_sl ?? sl,
    price_tp: order.price_tp ?? tp,
  };
};

// ====================
// Types
// ====================

export interface LoginCredentials {
  username?: string;
  email?: string;
  login?: number;
  password: string;
  broker_id?: string;
  server?: string;
}

export interface LoginResponse {
  token?: string;
  access_token?: string;
  refresh_token?: string;
  expires_at?: string;
  user?: User;
  user_id?: string;
  username?: string;
  role?: string;
  account_login?: number;
  broker_id?: string;
  broker_name?: string;
  broker_server?: string;
  backend_url?: string;
  market_api_url?: string;
  server_url?: string;
  ws_url?: string;
  feed_url?: string;
  feed_ws_url?: string;
  feed_status_url?: string;
}

export interface User {
  id: string;
  username: string;
  email: string;
  role: string;
}

export interface AccountSummary {
  id?: string;
  balance: number;
  equity: number;
  margin?: number;
  margin_free?: number;
  margin_level?: number;
  margin_used?: number;
  margin_available?: number;
  unrealized_pl?: number;
  realized_pl?: number;
  open_positions?: number;
  pending_orders?: number;
  currency: string;
  leverage: number;
  last_updated?: string;
}

export interface Transaction {
  id: string;
  type: 'deposit' | 'withdrawal' | 'trade' | 'fee' | 'commission';
  amount: number;
  currency: string;
  description?: string;
  createdAt: string;
}

export interface EquityHistoryPoint {
  timestamp: string;
  equity: number;
}

export interface Position {
  id?: string;
  ticket?: number;
  account_login?: number;
  symbol: string;
  side: 'buy' | 'sell' | 'long' | 'short';
  quantity?: number;
  volume?: number;
  open_price?: number;
  current_price?: number;
  price_open?: number;
  price_current?: number;
  price_sl?: number | null;
  price_tp?: number | null;
  sl?: number;
  tp?: number;
  swap?: number;
  commission?: number;
  profit?: number;
  unrealized_pl?: number;
  opened_at?: string;
  time_create?: number;
}

export interface Order {
  id?: string;
  ticket?: number;
  account_login?: number;
  symbol: string;
  type: string;
  side: 'buy' | 'sell';
  quantity?: number;
  volume?: number;
  price: number;
  price_sl?: number | null;
  price_tp?: number | null;
  status: 'pending' | 'filled' | 'cancelled' | 'rejected' | 'active' | 'triggered' | 'expired';
  created_at?: string;
  time_create?: number;
  mt5_order_id?: number;
  mt5_deal_id?: number;
}

export interface CreateOrderRequest {
  login?: number;
  account_login?: number;
  symbol: string;
  type?: 'market';
  side: 'buy' | 'sell' | 'BUY' | 'SELL';
  quantity?: number;
  volume?: number;
  price?: number;
  price_sl?: number;
  price_tp?: number;
  sl?: number;
  tp?: number;
  comment?: string;
  trailing_stop?: number;
  trailing_step?: number;
  magic?: number;
}

export interface PendingOrderRequest {
  login?: number;
  account_login?: number;
  symbol: string;
  side: 'buy' | 'sell' | 'BUY' | 'SELL';
  volume: number;
  type: 'buy_limit' | 'sell_limit' | 'buy_stop' | 'sell_stop' | 'BUY_LIMIT' | 'SELL_LIMIT' | 'BUY_STOP' | 'SELL_STOP';
  price: number;
  price_sl?: number;
  price_tp?: number;
  sl?: number;
  tp?: number;
  expiration?: number;
  comment?: string;
  trailing_stop?: number;
  trailing_step?: number;
  magic?: number;
}

export interface ModifyPositionRequest {
  price_sl?: number;
  price_tp?: number;
  trailing_stop?: number;
  trailing_step?: number;
}

export interface ModifyPendingOrderRequest extends ModifyPositionRequest {
  price?: number;
  expiration?: number;
}

export interface CreateAccountRequest {
  name: string;
  email?: string;
  phone?: string;
  country?: string;
  city?: string;
  group: string;
  leverage: number;
}

export interface CreateAccountResponse {
  success: boolean;
  message: string;
  account?: {
    login: number;
    master_password: string;
    investor_password: string;
    group: string;
    server: string;
    created_at: string;
  };
}

export interface Symbol {
  id: string;
  name: string;
  description: string;
  category: string;
  digits: number;
  tickSize: number;
  contractSize: number;
  marginRate: number;
  tradingEnabled: boolean;
  bid?: number;
  ask?: number;
}

export interface Quote {
  symbol: string;
  bid: number;
  ask: number;
  spread: number;
  timestamp: string;
}

export interface Candle {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface Notification {
  id: string;
  userId: string;
  type: 'info' | 'warning' | 'success' | 'error';
  title: string;
  message: string;
  read: boolean;
  createdAt: string;
}

export interface EconomicEvent {
  id: string;
  timestamp: string;
  currency: string;
  impact: 'low' | 'medium' | 'high';
  name: string;
  actual?: string;
  forecast?: string;
  previous?: string;
}

// ====================
// Auth Endpoints
// ====================

type LoginPayload = {
  username?: string | number;
  password: string;
  broker_id?: string;
};

const normalizeLoginCredentials = (credentials: LoginCredentials): LoginPayload => {
  const username = credentials.username ?? credentials.login ?? credentials.email;

  return {
    ...(username !== undefined ? { username } : {}),
    password: credentials.password,
    ...(credentials.broker_id ? { broker_id: credentials.broker_id } : {}),
  };
};

export const authApi = {
  login: (credentials: LoginCredentials, options?: { baseUrl?: string }) =>
    apiClient.post<LoginResponse>('/auth/login', normalizeLoginCredentials(credentials), {
      baseUrl: resolveV2BaseUrl(options?.baseUrl),
      skipDynamicUrl: Boolean(options?.baseUrl),
    }),

  logout: () =>
    apiClient.post<void>('/auth/logout', {}, { baseUrl: API_V2_BASE_URL }),

  refresh: (refresh_token: string) =>
    apiClient.post<LoginResponse>('/auth/refresh', { refresh_token }, { baseUrl: API_V2_BASE_URL }),
};

// ====================
// Account Endpoints
// ====================

export const accountApi = {
  getSummary: async (login?: number) => {
    try {
      const resolvedLogin = requireLogin(login ?? resolveStoredLogin(), '/api/v2/account/{login}');

      const res = await apiClient.get<AccountSummary>(`/account/${resolvedLogin}`, {
        baseUrl: API_V2_BASE_URL,
      });
      console.log('[DEBUG REST ACCOUNT PAYLOAD]', res);
      return res;
    } catch (e) {
      // Gateway may be down — suppress console noise
      console.debug('[accountApi] getSummary unavailable:', (e as any)?.status || (e as any)?.message);
      throw e;
    }
  },

  getTransactions: async (params?: { type?: string; limit?: number; offset?: number; login?: number }) => {
    const login = requireLogin(params?.login ?? resolveStoredLogin(), '/api/v2/accounts/{login}/history');
    const rows = await apiClient.get<any[]>(`/accounts/${login}/history`, {
      baseUrl: API_V2_BASE_URL,
      params: { limit: params?.limit, offset: params?.offset },
    });

    return rows
      .filter((row) => !params?.type || row.type === params.type)
      .map((row) => ({
        id: String(row.id),
        type: row.type,
        amount: Number(row.amount),
        currency: row.currency || 'USD',
        description: row.comment,
        createdAt: row.time ? new Date(Number(row.time) * 1000).toISOString() : '',
      })) as Transaction[];
  },

  getEquityHistory: async (params?: { period?: '1d' | '7d' | '30d' | '90d' | '1y'; interval?: string; login?: number; from?: number; to?: number }) => {
    const login = requireLogin(params?.login ?? resolveStoredLogin(), '/api/v2/account/{login}/equity');
    const points = await apiClient.get<any[]>(`/account/${login}/equity`, {
      baseUrl: API_V2_BASE_URL,
      params: { from: params?.from, to: params?.to },
    });

    return points.map((point) => ({
      timestamp: point.time ? new Date(Number(point.time) * 1000).toISOString() : '',
      equity: Number(point.equity),
    })) as EquityHistoryPoint[];
  },
};



export const tradingApi = {
  getPositions: (login?: number, params?: { limit?: number; offset?: number }): Promise<any> => {
    const resolvedLogin = requireLogin(login, '/api/v2/positions/{login}');
    const baseUrl = API_V2_BASE_URL;
    const endpoint = `/positions/${resolvedLogin}`;
    const url = `${baseUrl}${endpoint}`;
    console.log("Calling Toolbox -> Trade API:", url);
    return apiClient.get<Position[]>(endpoint, {
      baseUrl,
      params: {
        limit: params?.limit ?? 50,
        offset: params?.offset ?? 0,
      },
      headers: {
        accept: 'application/json',
      },
    });
  },

  getOrders: (login?: number, params?: { limit?: number }): Promise<any> =>
    apiClient.get<Order[]>(`/orders/${requireLogin(login, '/api/v2/orders/{login}')}`, {
      baseUrl: API_V2_BASE_URL,
      params,
    }),

  getPendingOrders: (login: number): Promise<any> =>
    apiClient.get<Order[]>(`/orders/pending/${requireLogin(login, '/api/v2/orders/pending/{login}')}`, { baseUrl: API_V2_BASE_URL }),

  placeOrder: (order: CreateOrderRequest): Promise<any> =>
    apiClient.post<Position>('/orders', normalizeOrderPayload(order), { baseUrl: API_V2_BASE_URL }),

  placePendingOrder: (order: PendingOrderRequest): Promise<any> =>
    apiClient.post<Order>('/orders/pending', normalizePendingOrderPayload(order), { baseUrl: API_V2_BASE_URL }),

  cancelOrder: (orderId: string | number): Promise<any> =>
    apiClient.delete<{ message?: string }>(`/orders/pending/${requireTicket(orderId, '/api/v2/orders/pending/{ticket}')}`, { baseUrl: API_V2_BASE_URL }),

  modifyPendingOrder: (orderId: string | number, data: ModifyPendingOrderRequest): Promise<any> =>
    apiClient.put<Order>(`/orders/pending/${requireTicket(orderId, '/api/v2/orders/pending/{ticket}')}`, data, { baseUrl: API_V2_BASE_URL }),

  closePosition: (positionId: string | number): Promise<any> =>
    apiClient.post<void>(`/positions/${requireTicket(positionId, '/api/v2/positions/{id}/close')}/close`, {}, { baseUrl: API_V2_BASE_URL }),

  modifyPosition: (positionId: string | number, data: ModifyPositionRequest): Promise<any> =>
    apiClient.put<Position>(`/positions/${requireTicket(positionId, '/api/v2/positions/{id}')}`, data, { baseUrl: API_V2_BASE_URL }),

};

// ====================
// Market Endpoints
// ====================

export const marketApi = {
  getSymbols: async () => {
    let lastError: unknown = null;
    let instruments: any[] = [];

    for (const endpoint of SYMBOL_ENDPOINTS) {
      try {
        const request = resolveSymbolEndpoint(endpoint);
        const response = await apiClient.get<unknown>(request.endpoint, {
          baseUrl: request.baseUrl,
        });
        instruments = extractInstrumentRows(response);
        if (instruments.length > 0) break;
        lastError = new Error(`No symbols returned by ${endpoint}`);
      } catch (error) {
        lastError = error;
      }
    }

    if (instruments.length === 0 && lastError) {
      throw lastError;
    }

    return instruments.map((instrument) => {
      const symbol = String(instrument.symbol ?? instrument.name ?? instrument.id ?? '').trim();

      return {
        id: symbol,
        name: symbol,
        description: instrument.description || symbol,
        category: instrument.category || 'Forex',
        digits: instrument.digits,
        tickSize: instrument.tick_size ?? Math.pow(10, -Number(instrument.digits || 5)),
        contractSize: instrument.contract_size,
        marginRate: instrument.margin_rate ?? 0.01,
        tradingEnabled: Boolean(instrument.enabled ?? instrument.trading_enabled ?? instrument.tradingEnabled ?? true),
        bid: instrument.bid,
        ask: instrument.ask,
      };
    }) as unknown as Symbol[];
  },

  getQuote: (symbol: string) =>
    apiClient.get<Quote>(`/quotes/${encodeURIComponent(symbol)}`, { baseUrl: API_V2_BASE_URL }),

  getCandles: (symbol: string, params?: { timeframe?: string; count?: number; from?: number; to?: number }) =>
    apiClient.get<{ candles: Candle[] } | Candle[]>(`/candles/${encodeURIComponent(symbol)}`, {
      baseUrl: API_HISTORY_BASE_URL,
      params: {
        tf: params?.timeframe,
        count: params?.count,
        from: params?.from,
        to: params?.to,
      },
      skipAuth: true,
    }),

  getOHLC: async (symbol: string, timeframe: string = 'M1', count: number = 100) => {
    const response = await apiClient.get<{ candles: Candle[] } | Candle[]>(
      `/candles/${encodeURIComponent(symbol)}`,
      {
        baseUrl: API_HISTORY_BASE_URL,
        params: { tf: timeframe, count },
        skipAuth: true,
      }
    );
    return Array.isArray(response) ? response : (response.candles || []);
  },

  getTicks: (symbol: string) =>
    apiClient.get<any[]>(`/ticks/${encodeURIComponent(symbol)}`, {
      baseUrl: API_V2_BASE_URL,
      params: { limit: 100 },
    }),
};

// ====================
// Notifications Endpoints
// ====================

export const notificationsApi = {
  getNotifications: (params?: { unreadOnly?: boolean; limit?: number; offset?: number }) =>
    apiClient.get<{ notifications: Notification[]; total: number; unreadCount: number }>('/notifications', {
      headers: params ? { 'X-Query-Params': JSON.stringify(params) } : undefined,
    }),

  markAsRead: (notificationId: string) =>
    apiClient.patch<void>(`/notifications/${notificationId}/read`, {}),

  markAllAsRead: () =>
    apiClient.post<void>('/notifications/read-all', {}),

  deleteNotification: (notificationId: string) =>
    apiClient.delete<void>(`/notifications/${notificationId}`),
};

// ====================
// Economic Calendar Endpoints
// ====================

export const economicCalendarApi = {
  getEvents: (params?: { from?: string; to?: string; currencies?: string[]; impact?: string[] }) =>
    apiClient.get<{ events: EconomicEvent[]; total: number }>('/economic-calendar/events', {
      headers: params ? { 'X-Query-Params': JSON.stringify(params) } : undefined,
    }),

  getEventsForToday: () =>
    apiClient.get<{ events: EconomicEvent[]; total: number }>('/economic-calendar/events/today'),

  getEventsForWeek: () =>
    apiClient.get<{ events: EconomicEvent[]; total: number }>('/economic-calendar/events/week'),
};
