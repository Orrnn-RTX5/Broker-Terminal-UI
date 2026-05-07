import { apiClient } from './client';
import { MT5_SYNC_URL } from '../config/api';

// ====================
// Types
// ====================

export interface LoginCredentials {
  username: string;
  password: string;
}

export interface LoginResponse {
  access_token: string;
  refresh_token?: string;
  expires_at?: string;
  user: User;
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
  id: string;
  symbol: string;
  side: 'long' | 'short';
  quantity: number;
  open_price: number;
  current_price: number;
  unrealized_pl: number;
  opened_at: string;
}

export interface Order {
  id: string;
  symbol: string;
  type: string;
  side: 'buy' | 'sell';
  quantity: number;
  price: number;
  status: 'pending' | 'filled' | 'cancelled' | 'rejected';
  created_at: string;
  mt5_order_id?: number;
  mt5_deal_id?: number;
}

export interface CreateOrderRequest {
  symbol: string;
  type: 'market';
  side: 'buy' | 'sell';
  quantity: number;
  price?: number;
  account_login?: number;
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

export const authApi = {
  login: (credentials: LoginCredentials, options?: { baseUrl?: string }) =>
    apiClient.post<LoginResponse>('/api/login', credentials, options),

  logout: () =>
    apiClient.post<void>('/api/logout', {}),

  refresh: (refresh_token: string) =>
    apiClient.post<LoginResponse>('/api/refresh', { refresh_token }),
};

// ====================
// Account Endpoints
// ====================

export const accountApi = {
  getSummary: async (login?: number) => {
    try {
      const storedLoginRaw = typeof window !== 'undefined'
        ? (localStorage.getItem('rtx_saved_username') || localStorage.getItem('rtx_last_login'))
        : null;
      const storedLogin = storedLoginRaw ? Number.parseInt(storedLoginRaw, 10) : Number.NaN;
      const resolvedLogin = Number.isFinite(login as number) && (login as number) > 0
        ? login
        : (Number.isFinite(storedLogin) && storedLogin > 0 ? storedLogin : undefined);

      if (!resolvedLogin) {
        throw new Error('Missing account login for /api/account/summary');
      }

      const res = await apiClient.get<AccountSummary>('/api/account/summary', {
        params: { login: resolvedLogin },
      });
      console.log('[DEBUG REST ACCOUNT PAYLOAD]', res);
      return res;
    } catch (e) {
      // Gateway may be down — suppress console noise
      console.debug('[accountApi] getSummary unavailable:', (e as any)?.status || (e as any)?.message);
      throw e;
    }
  },

  getTransactions: (params?: { type?: string; limit?: number }) =>
    apiClient.get<Transaction[]>('/api/account/transactions', {
      params
    }),

  getEquityHistory: (params?: { period?: '1d' | '7d' | '30d' | '90d' | '1y'; interval?: string }) =>
    apiClient.get<EquityHistoryPoint[]>('/api/account/equity-history', {
      params
    }),
};

// ====================
// Trading Endpoints
// ====================

export const tradingApi = {
  getPositions: () =>
    apiClient.get<{ positions: Position[]; count: number }>('/api/positions'),

  getOrders: () =>
    apiClient.get<{ orders: Order[]; count: number }>('/api/orders'),

  placeOrder: (order: CreateOrderRequest) =>
    apiClient.post<Order>('/api/orders', order),

  cancelOrder: (orderId: string) =>
    apiClient.delete<void>(`/api/orders/${orderId}`),

  closePosition: (positionId: string) =>
    apiClient.post<void>(`/api/positions/${positionId}/close`, {}),
};

// ====================
// Market Endpoints
// ====================

// FIX API Base URL
const FIX_API_BASE = import.meta.env.VITE_FIX_API_URL || 'https://rtxbackend.tradecopier.org';

export const marketApi = {
  getSymbols: async () => {
    const response = await apiClient.get<{ symbols: string[] }>(
      '/api/symbols'
    );
    // Map the string array to the Symbol object format expected by the frontend
    return (response.symbols || []).map((sym) => ({
      id: sym,
      name: sym,
      description: sym,
      category: 'Forex',
      digits: 5,
      tickSize: 0.00001,
      contractSize: 100000,
      marginRate: 0.01,
      tradingEnabled: true
    })) as unknown as Symbol[];
  },

  getQuote: (symbol: string) =>
    apiClient.get<Quote>(`/api/fix/quotes/${symbol}`),

  getCandles: (symbol: string, params?: { timeframe?: string; count?: number; from?: number; to?: number }) =>
    apiClient.get<{ candles: Candle[] } | Candle[]>(`/api/fix/candles/${symbol}`, { params }),

  getOHLC: async (symbol: string, timeframe: string = 'M1', count: number = 100) => {
    const response = await apiClient.get<{ candles: Candle[] } | Candle[]>(
      `/api/fix/candles/${symbol}`,
      { params: { timeframe, count } }
    );
    // Handle both { candles: [] } and direct array response
    return Array.isArray(response) ? response : (response.candles || []);
  },

  getTicks: (symbol: string) =>
    apiClient.get<any[]>(`/api/fix/ticks/${symbol}`),
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

// ====================
// MT5 Sync Endpoints (Port 8088)
// ====================

export const mt5Api = {
  createAccount: (data: CreateAccountRequest) =>
    apiClient.post<CreateAccountResponse>('/api/mt5/account/create', data),

  executeTrade: (data: {
    account_login: number;
    symbol: string;
    side: string;
    volume_lots: number;
    price?: number;
    sl?: number;
    tp?: number;
    comment?: string;
    client_request_id?: string;
  }) =>
    apiClient.post<any>('/api/v1/trades/execute', data, { baseUrl: MT5_SYNC_URL }),

  closeTrade: (data: {
    account_login: number;
    ticket: number;
    volume_lots?: number;
  }) =>
    apiClient.post<any>('/api/v1/trades/close', data, { baseUrl: MT5_SYNC_URL }),

  getGroups: () =>
    apiClient.get<{ groups: string[] }>('/api/mt5/groups'),

  getStatus: () =>
    apiClient.get<any>('/api/mt5/status'),

  changePassword: (data: {
    login: number;
    old_password: string;
    new_password: string;
    type: 'master' | 'investor';
  }) =>
    apiClient.post<{ success: boolean; login: number; type: string; message: string }>('/api/v1/mt5/change-password', data),
};

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
