/**
 * Comprehensive API Service Layer
 * Centralized API communication with type safety and error handling
 * Includes authentication with JWT token management and 401 handling
 */

import type { Position, Order, Account, Trade, Tick } from '../store/useAppStore';
import { useAppStore } from '../store/useAppStore';

// ============================================
// API Response Types
// ============================================

export interface ApiResponse<T = any> {
  success: boolean;
  data?: T;
  error?: string;
  message?: string;
}

export interface BrokerConfig {
  brokerName: string;
  priceFeedLP: string;
  executionMode: 'ABOOK' | 'BBOOK';
  defaultLeverage: number;
  defaultBalance: number;
  marginMode: 'HEDGING' | 'NETTING';
  maxTicksPerSymbol: number;
  disabledSymbols?: Record<string, boolean>;
}

export interface Symbol {
  symbol: string;
  displayName: string;
  category: string;
  enabled: boolean;
  contractSize: number;
  pipValue: number;
  minVolume: number;
  maxVolume: number;
  stepVolume: number;
  spread?: number;
}

export interface LPStatus {
  id: string;
  name: string;
  type: string;
  enabled: boolean;
  connected: boolean;
  symbolCount: number;
  latency?: number;
  lastQuote?: number;
}

export interface MarginPreview {
  symbol: string;
  volume: number;
  leverage: number;
  requiredMargin: number;
  currentMargin: number;
  freeMargin: number;
  marginAfter: number;
  freeMarginAfter: number;
  marginLevel: number;
  marginLevelAfter: number;
  canTrade: boolean;
}

export interface LotCalculation {
  symbol: string;
  riskPercent: number;
  slPips: number;
  balance: number;
  recommendedLot: number;
  riskAmount: number;
  pipValue: number;
}

export interface LedgerEntry {
  id: number;
  accountId: number;
  type: string;
  amount: number;
  balance: number;
  description: string;
  timestamp: string;
  referenceId?: string;
}

export interface AdminAccount {
  id: number;
  accountNumber: string;
  username: string;
  displayName: string;
  balance: number;
  equity: number;
  margin: number;
  freeMargin: number;
  leverage: number;
  executionMode: string;
  status: string;
  createdAt: string;
}

// ============================================
// API Configuration
// ============================================

import { API_BASE_URL } from '../config/api';
import { ApiError, apiClient } from '../api/client';
import * as endpoints from '../api/endpoints';
import mt5TradeService from './mt5TradeService';

const DEFAULT_TIMEOUT = 10000; // 10 seconds

// ============================================
// HTTP Client with Error Handling
// ============================================

// ============================================
// Authentication API
// ============================================

export const authApi = {
  async login(username: string, password: string, baseUrl?: string): Promise<endpoints.LoginResponse> {
    const result = await endpoints.authApi.login({ username, password }, baseUrl ? { baseUrl } : undefined);

    // Store tokens in Zustand store after successful login
    if (result.access_token) {
      useAppStore.getState().setAuthTokens(
        result.access_token,
        result.refresh_token,
        result.expires_at ? new Date(result.expires_at).getTime() : undefined
      );
    }

    return result;
  },

  async refresh(refreshToken: string): Promise<endpoints.LoginResponse> {
    const result = await endpoints.authApi.refresh(refreshToken);
    if (result.access_token) {
      useAppStore.getState().setAuthTokens(
        result.access_token,
        result.refresh_token,
        result.expires_at ? new Date(result.expires_at).getTime() : undefined
      );
    }
    return result;
  },

  logout(): void {
    useAppStore.getState().logout();
    endpoints.authApi.logout().catch(console.error);
  },
};

// ============================================
// Account API
// ============================================

export const accountApi = {
  async getAccountSummary(login?: number): Promise<endpoints.AccountSummary> {
    return endpoints.accountApi.getSummary(login);
  },

  async createAccount(data: endpoints.CreateAccountRequest): Promise<endpoints.CreateAccountResponse> {
    // Use the registration endpoint from apis.json
    return apiClient.post<endpoints.CreateAccountResponse>('/api/mt5/account/create', data);
  },
};

// ============================================
// Positions API
// ============================================

export const positionsApi = {
  async getPositions(): Promise<endpoints.Position[]> {
    try {
      const response = await endpoints.tradingApi.getPositions();
      return response.positions || [];
    } catch {
      // Gateway may be unavailable — positions come from MT5 Sync WS instead
      return [];
    }
  },

  async closePosition(positionId: string): Promise<void> {
    // Route via MT5 trade service which has auth attached
    const ticket = typeof positionId === 'string' ? parseInt(positionId, 10) : positionId;
    await mt5TradeService.closeTrade({ ticket });
  },

  async closeBulk(
    accountId: number,
    type: 'ALL' | 'WINNERS' | 'LOSERS',
    symbol?: string
  ): Promise<{ closed: number; message: string }> {
    return apiClient.post<{ closed: number; message: string }>('/api/positions/close-bulk', { accountId, type, symbol });
  },
};

// ============================================
// Orders API
// ============================================

export const ordersApi = {
  async placeMarketOrder(data: endpoints.CreateOrderRequest): Promise<endpoints.Order> {
    return endpoints.tradingApi.placeOrder(data);
  },

  async getPendingOrders(): Promise<endpoints.Order[]> {
    const response = await endpoints.tradingApi.getOrders();
    return response.orders || [];
  },

  async cancelOrder(orderId: string): Promise<void> {
    return endpoints.tradingApi.cancelOrder(orderId);
  },
};

// ============================================
// Market Data API
// ============================================

export const marketApi = {
  async getSymbols(): Promise<endpoints.Symbol[]> {
    return endpoints.marketApi.getSymbols();
  },

  async getTicks(symbol: string): Promise<any[]> {
    return endpoints.marketApi.getTicks(symbol);
  },

  async getOHLC(
    symbol: string,
    timeframe: string,
    count = 500
  ): Promise<endpoints.Candle[]> {
    const res = await endpoints.marketApi.getCandles(symbol, { timeframe, count });
    return Array.isArray(res) ? res : res.candles;
  },
};

// ============================================
// Risk Management API
// ============================================

export const riskApi = {
  async calculateLot(
    symbol: string,
    riskPercent: number,
    slPips: number
  ): Promise<LotCalculation> {
    return apiClient.get<LotCalculation>('/risk/calculate-lot', {
      params: { symbol, riskPercent, slPips }
    });
  },

  async previewMargin(
    symbol: string,
    volume: number,
    side: string
  ): Promise<MarginPreview> {
    return apiClient.get<MarginPreview>('/risk/margin-preview', {
      params: { symbol, volume, side }
    });
  },
};

// ============================================
// Trading History API
// ============================================

export const historyApi = {
  async getLedger(): Promise<endpoints.Transaction[]> {
    return endpoints.accountApi.getTransactions();
  },

  async getEquityHistory(period?: '1d' | '7d' | '30d' | '90d' | '1y'): Promise<endpoints.EquityHistoryPoint[]> {
    return endpoints.accountApi.getEquityHistory({ period });
  },
};

// ============================================
// Configuration API
// ============================================

export const configApi = {
  async getConfig(): Promise<BrokerConfig> {
    try {
      return await apiClient.get<BrokerConfig>('/api/config');
    } catch (error) {
      // Some deployments do not expose /api/config yet.
      if (error instanceof ApiError && error.status === 404) {
        return {
          brokerName: 'RTX',
          priceFeedLP: 'YOFX',
          executionMode: 'ABOOK',
          defaultLeverage: 1000,
          defaultBalance: 0,
          marginMode: 'HEDGING',
          maxTicksPerSymbol: 1000,
        };
      }
      throw error;
    }
  },

  async updateConfig(config: Partial<BrokerConfig>): Promise<{ success: boolean; config: BrokerConfig }> {
    return apiClient.post<{ success: boolean; config: BrokerConfig }>('/api/config', config);
  },
};

// ============================================
// Admin API
// ============================================

export const adminApi = {
  async getAccounts(): Promise<AdminAccount[]> {
    const data = await apiClient.get<AdminAccount[]>('/admin/accounts');
    return data || [];
  },

  async deposit(accountId: number, amount: number, method: string, description: string): Promise<void> {
    return apiClient.post<void>('/admin/deposit', { accountId, amount, method, description });
  },

  async withdraw(accountId: number, amount: number, method: string, description: string): Promise<void> {
    return apiClient.post<void>('/admin/withdraw', { accountId, amount, method, description });
  },

  async adjust(accountId: number, amount: number, description: string): Promise<void> {
    return apiClient.post<void>('/admin/adjust', { accountId, amount, description });
  },

  async bonus(accountId: number, amount: number, description: string): Promise<void> {
    return apiClient.post<void>('/admin/bonus', { accountId, amount, description });
  },

  async getLedgerAll(): Promise<LedgerEntry[]> {
    const data = await apiClient.get<LedgerEntry[]>('/admin/ledger');
    return data || [];
  },

  async updateAccount(accountId: number, data: Partial<AdminAccount>): Promise<void> {
    return apiClient.post<void>('/admin/account/update', { accountId, ...data });
  },

  async resetPassword(accountId: number, newPassword: string): Promise<void> {
    return apiClient.post<void>('/admin/reset-password', { accountId, newPassword });
  },

  async getSymbols(): Promise<Symbol[]> {
    const data = await apiClient.get<Symbol[]>('/admin/symbols');
    return data || [];
  },

  async toggleSymbol(symbol: string, enabled: boolean): Promise<void> {
    return apiClient.post<void>('/admin/symbols/toggle', { symbol, enabled });
  },

  async getExecutionMode(): Promise<{ mode: string; description: any; priceFeed: string }> {
    return apiClient.get<{ mode: string; description: any; priceFeed: string }>('/admin/execution-mode');
  },

  async setExecutionMode(mode: 'ABOOK' | 'BBOOK'): Promise<any> {
    return apiClient.post<any>('/admin/execution-mode', { mode });
  },

  async getLPStatus(): Promise<LPStatus[]> {
    const data = await apiClient.get<LPStatus[]>('/admin/lp-status');
    return data || [];
  },

  async restartServer(): Promise<{ success: boolean; message: string }> {
    return apiClient.post<{ success: boolean; message: string }>('/admin/restart', {});
  },
};

// ============================================
// Alerts API
// ============================================

export type AlertRule = {
  id: string;
  name: string;
  enabled: boolean;
  condition: {
    type: 'price_above' | 'price_below' | 'pnl_above' | 'pnl_below' | 'margin_level_below';
    symbol?: string;
    threshold: number;
  };
  severity: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  message: string;
};

export const alertsApi = {
  async getRules(): Promise<AlertRule[]> {
    const data = await apiClient.get<AlertRule[]>('/api/alerts/rules');
    return data || [];
  },

  async createRule(rule: Omit<AlertRule, 'id'>): Promise<AlertRule> {
    return apiClient.post<AlertRule>('/api/alerts/rules', rule);
  },

  async updateRule(id: string, updates: Partial<AlertRule>): Promise<AlertRule> {
    return apiClient.put<AlertRule>(`/api/alerts/rules/${id}`, updates);
  },

  async deleteRule(id: string): Promise<void> {
    return apiClient.delete<void>(`/api/alerts/rules/${id}`);
  },

  async testRule(id: string): Promise<void> {
    return apiClient.post<void>(`/api/alerts/rules/${id}/test`, {});
  },
};

// ============================================
// Analytics & Export API
// ============================================

export const analyticsApi = {
  async exportPDF(accountId: string, startDate: string, endDate: string): Promise<Blob> {
    return apiClient.get<Blob>('/api/analytics/export/pdf', {
      params: { start: startDate, end: endDate, accountId }
    });
  },

  async exportCSV(accountId: string, startDate: string, endDate: string, dataType: string): Promise<string> {
    return apiClient.get<string>('/api/analytics/export/csv', {
      params: { start: startDate, end: endDate, accountId, type: dataType }
    });
  },

  async getPerformanceReport(accountId: string, startDate: string, endDate: string): Promise<any> {
    return apiClient.get<any>('/api/performance', {
      params: { start: startDate, end: endDate, accountId }
    });
  },
};

// ============================================
// Workspace API
// ============================================

export interface WorkspaceConfig {
  charts: any[];
  layout: any;
  marketWatch: any;
  orderPanel: any;
  version: string;
}

export interface Workspace {
  id?: string;
  name: string;
  description?: string;
  userId: string;
  accountId?: string;
  charts: any;
  layout: any;
  marketWatch: any;
  orderPanel: any;
  version: string;
  createdAt?: string;
  updatedAt?: string;
  thumbnail?: string;
  isDefault: boolean;
  tags?: string;
}

export interface SaveWorkspaceRequest {
  workspace: Workspace;
  overwrite: boolean;
}

export interface SaveWorkspaceResponse {
  success: boolean;
  workspaceId?: string;
  message?: string;
  conflict?: boolean;
  conflictVersion?: Workspace;
}

export const workspaceApi = {
  async saveWorkspace(workspace: Workspace, overwrite = false): Promise<SaveWorkspaceResponse> {
    return apiClient.post<SaveWorkspaceResponse>('/api/workspaces', { workspace, overwrite });
  },

  async loadWorkspace(workspaceId: string): Promise<{ success: boolean; workspace?: Workspace; message?: string }> {
    return apiClient.get<{ success: boolean; workspace?: Workspace; message?: string }>(`/api/workspaces/${workspaceId}`);
  },

  async listWorkspaces(userId: string, accountId?: string): Promise<{ success: boolean; workspaces: any[]; message?: string }> {
    return apiClient.get<{ success: boolean; workspaces: any[]; message?: string }>('/api/workspaces', {
      params: { userId, accountId }
    });
  },

  async deleteWorkspace(workspaceId: string): Promise<{ success: boolean; message?: string }> {
    return apiClient.delete<{ success: boolean; message?: string }>(`/api/workspaces/${workspaceId}`);
  },
};

// ============================================
// Notifications API
// ============================================

export interface Notification {
  id: string;
  type: string;
  severity: string;
  title: string;
  message: string;
  read: boolean;
  createdAt: string;
}

export const notificationsApi = {
  async getUnreadCount(): Promise<{ count: number }> {
    try {
      return await apiClient.get<{ count: number }>('/api/notifications/unread-count');
    } catch {
      // Optional endpoint — silently return 0 on any error (404, 502, network, etc.)
      return { count: 0 };
    }
  },

  async getNotifications(limit = 50): Promise<Notification[]> {
    const data = await apiClient.get<Notification[]>('/api/notifications', {
      params: { limit }
    });
    return data || [];
  },

  async markAsRead(notificationId: string): Promise<void> {
    return apiClient.post<void>('/api/notifications/mark-read', { notificationId });
  },

  async markAllRead(): Promise<void> {
    return apiClient.post<void>('/api/notifications/mark-all-read', {});
  },

  async deleteNotification(notificationId: string): Promise<void> {
    return apiClient.delete<void>(`/api/notifications/${notificationId}`);
  },
};

// ============================================
// MT5 Manager API (Account Creation)
// ============================================

export interface MT5Group {
  name: string;
  description?: string;
  type?: string;
}

export interface CreateMT5AccountRequest {
  group: string;
  name: string;
  email?: string;
  phone?: string;
  country?: string;
  city?: string;
  leverage?: number;
}

export interface CreateMT5AccountResponse {
  login: number;
  master_password: string;
  investor_password: string;
  group: string;
  server: string;
  created_at: string;
}

export interface MT5ManagerStatus {
  connected: boolean;
  address?: string;
  login?: number;
  last_error?: string;
  config?: {
    sdk_configured: boolean;
  };
}

export const mt5ManagerApi = {
  async getStatus(): Promise<MT5ManagerStatus> {
    const response = await apiClient.get<MT5ManagerStatus>('/api/mt5/status');
    return response;
  },

  async getGroups(): Promise<MT5Group[]> {
    const response = await apiClient.get<{ groups: MT5Group[] }>('/api/mt5/groups');
    return response.groups || [];
  },

  async createAccount(request: endpoints.CreateAccountRequest): Promise<endpoints.CreateAccountResponse> {
    // Uses Gateway API (/api/mt5/account/create) as defined in endpoints
    return endpoints.mt5Api.createAccount(request);
  },

  async isReady(): Promise<boolean> {
    try {
      const status = await this.getStatus();
      return status.connected;
    } catch {
      return false;
    }
  },
};

// ============================================
// MT5 Direct Trading API
// ============================================

export interface MT5Position {
  ticket: number;
  login: number;
  symbol: string;
  action: string;
  volume: number;
  open_price: number;
  current_price: number;
  sl: number;
  tp: number;
  profit: number;
  swap: number;
  time_ms: number;
}

export interface MT5Account {
  login: number;
  balance: number;
  equity: number;
  margin: number;
  free_margin: number;
  margin_level: number;
  leverage: number;
  currency: string;
  name: string;
}

export interface MT5Order {
  ticket: number;
  login: number;
  symbol: string;
  type: string;
  volume: number;
  price: number;
  sl: number;
  tp: number;
  time_ms: number;
}

export interface MT5HistoryDeal {
  deal: number;
  order: number;
  time_ms: number;
  type: string;
  entry: string;
  symbol: string;
  volume: number;
  price: number;
  profit: number;
  commission: number;
  swap: number;
  comment: string;
}

export interface MT5Status {
  connected: boolean;
  endpoint: string;
  adapter_id: string;
  adapter_name: string;
}

export const mt5Api = {
  async getStatus(): Promise<MT5Status> {
    return endpoints.mt5Api.getStatus();
  },

  async getAccount(login?: number): Promise<MT5Account> {
    // Correct Gateway endpoint: /api/account/summary (with optional login param)
    const params: Record<string, any> = {};
    if (login) params.login = login;
    const data = await apiClient.get<any>('/api/account/summary', { params });
    // Normalize gateway response shape to MT5Account interface
    return {
      login: login || data.id || 0,
      balance: data.balance ?? 0,
      equity: data.equity ?? 0,
      margin: data.margin_used ?? 0,
      free_margin: data.margin_available ?? 0,
      margin_level: data.margin_available && data.margin_used
        ? (data.equity / data.margin_used) * 100
        : 0,
      leverage: data.leverage ?? 0,
      currency: data.currency ?? 'USD',
      name: data.id ?? String(login ?? ''),
    } as MT5Account;
  },

  async getPositions(login?: number): Promise<MT5Position[]> {
    // Correct Gateway endpoint: /api/positions (no login param needed — auth token identifies account)
    const data = await apiClient.get<{ positions: MT5Position[]; count: number }>('/api/positions');
    return data?.positions || [];
  },

  async getOrders(login?: number): Promise<MT5Order[]> {
    // Correct Gateway endpoint: /api/orders
    const data = await apiClient.get<{ orders: MT5Order[]; count: number }>('/api/orders');
    return data?.orders || [];
  },

  async getHistory(params: {
    login?: number;
    from?: number;
    to?: number;
    symbol?: string
  }): Promise<MT5HistoryDeal[]> {
    const data = await apiClient.get<MT5HistoryDeal[]>('/api/mt5/history', { params });
    return data || [];
  },

  async submitOrder(order: {
    symbol: string;
    action: string;
    volume: number;
    price?: number;
    sl?: number;
    tp?: number;
    login?: number;
    comment?: string;
    client_request_id?: string;
  }): Promise<any> {
    // Axios-based direct execute on port 8088
    return mt5TradeService.executeTrade({
      accountLogin: order.login || 0,
      symbol: order.symbol,
      side: order.action.toLowerCase() as 'buy' | 'sell',
      volumeLots: order.volume,
      price: order.price,
      sl: order.sl,
      tp: order.tp,
      comment: order.comment || 'RTX sync trade',
    });
  },

  async closePosition(ticket: number, volume?: number, login?: number): Promise<any> {
    // Axios-based direct close on port 8088
    return mt5TradeService.closeTrade({
      accountLogin: login || 0,
      ticket,
      volumeLots: volume,
    });
  },

  async modifyPosition(ticket: number, sl: number, tp: number): Promise<any> {
    return mt5TradeService.modifyTrade({
      ticket,
      stopLoss: sl,
      takeProfit: tp,
    });
  },

  async changePassword(login: number, oldPassword: string, newPassword: string, type: 'master' | 'investor' = 'master'): Promise<{ success: boolean; login: number; type: string; message: string }> {
    return endpoints.mt5Api.changePassword({
      login,
      old_password: oldPassword,
      new_password: newPassword,
      type
    });
  },
};

// ============================================
// Economic Calendar API
// ============================================

export const economicCalendarApi = {
  async getEvents(params?: { from?: string; to?: string; currencies?: string[]; impact?: string[] }): Promise<endpoints.EconomicEvent[]> {
    const response = await endpoints.economicCalendarApi.getEvents(params);
    return response.events || [];
  },

  async getEventsForToday(): Promise<endpoints.EconomicEvent[]> {
    const response = await endpoints.economicCalendarApi.getEventsForToday();
    return response.events || [];
  },

  async getEventsForWeek(): Promise<endpoints.EconomicEvent[]> {
    const response = await endpoints.economicCalendarApi.getEventsForWeek();
    return response.events || [];
  },
};
// ============================================
// MT5 Journal (Server Log) API
// ============================================

export interface JournalLogEntry {
  code: number;
  code_text: string;
  type: number;
  type_text: string;
  datetime: number;   // Unix timestamp (seconds)
  source: string;
  message: string;
}

export interface JournalQuery {
  mode?: number;   // 0=Standard, 1=Errors only, 2=Full
  type?: number;   // 0=All, 1=Config, 2=System, 3=Network, 4=History, 5=User, 6=Trade, 7=API, 8=Notify
  from?: number;   // Unix timestamp
  to?: number;     // Unix timestamp
  filter?: string; // text search
}

export interface JournalResponse {
  count: number;
  logs: JournalLogEntry[];
}

export const journalApi = {
  async getLogs(params: JournalQuery = {}): Promise<JournalResponse> {
    // In Electron the page origin is file:// so we can call the backend directly
    // without CORS restrictions. In the browser (dev/web) we must go through the
    // Vite proxy (/api → https://rtxbackend.tradecopier.org) to avoid CORS 503s.
    const isElectron = typeof window !== 'undefined' &&
      (window.location.protocol === 'file:' || navigator.userAgent.includes('Electron'));
    const BACKEND = isElectron ? 'https://rtxbackend.tradecopier.org' : '';

    // Build query string — match working curl: mode, type, filter only
    // ⚠️ BACKEND BUG: /api/v1/journal returns 503 if 'filter' param is absent or empty.
    //    Always send a non-empty filter. Space ' ' acts as a wildcard match-all.
    const qs = new URLSearchParams();
    if (params.mode !== undefined) qs.set('mode', String(params.mode));
    if (params.type !== undefined) qs.set('type', String(params.type));
    qs.set('filter', params.filter?.trim() || ' ');  // always non-empty!

    const url = `${BACKEND}/api/v1/journal?${qs.toString()}`;

    const res = await fetch(url, {
      headers: { 'accept': 'application/json' },
    });

    if (!res.ok) {
      throw new Error(`Journal API error: ${res.status} ${res.statusText}`);
    }

    const data = await res.json();
    // Backend returns { count, logs } — normalise to our interface
    return {
      count: data.count ?? (data.logs?.length ?? 0),
      logs: data.logs ?? [],
    } as JournalResponse;
  },
};



export const api = {
  auth: authApi,
  account: accountApi,
  positions: positionsApi,
  orders: ordersApi,
  market: marketApi,
  risk: riskApi,
  history: historyApi,
  config: configApi,
  admin: adminApi,
  analytics: analyticsApi,
  alerts: alertsApi,
  workspace: workspaceApi,
  notifications: notificationsApi,
  mt5: mt5Api,
  mt5Manager: mt5ManagerApi,
  economicCalendar: economicCalendarApi,
  journal: journalApi,
};

export default api;
