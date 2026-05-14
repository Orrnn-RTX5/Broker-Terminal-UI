/**
 * Comprehensive API Service Layer
 * Centralized API communication with type safety and error handling
 * Includes authentication with JWT token management and 401 handling
 */

import type { Position, Order, Account, Trade, Tick } from '../store/useAppStore';
import { useAppStore } from '../store/useAppStore';
import { API_V2_BASE_URL } from '../config/api';

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
import { getStoredBrokerServer, resolveLoginBrokerTarget } from './brokerServers';

const DEFAULT_TIMEOUT = 10000; // 10 seconds
const DEFAULT_BROKER_ID = 'broker_3';

interface LoginOptions {
  baseUrl?: string;
  broker_id?: string;
  server?: string;
}

const normalizeLoginOption = (value: unknown): string => String(value || '').trim();

const toFiniteNumber = (value: unknown, fallback = 0): number => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const resolveTradingLogin = (login?: number): number => {
  if (Number.isFinite(login) && Number(login) > 0) return Number(login);
  const stateLogin = Number.parseInt(String(useAppStore.getState().accountId || ''), 10);
  if (Number.isFinite(stateLogin) && stateLogin > 0) return stateLogin;
  if (typeof window !== 'undefined') {
    const stored = localStorage.getItem('rtx_saved_username') || localStorage.getItem('rtx_last_login');
    const storedLogin = Number.parseInt(String(stored || ''), 10);
    if (Number.isFinite(storedLogin) && storedLogin > 0) return storedLogin;
  }
  throw new Error('Missing account login for trading request');
};

const requireSymbol = (symbol: unknown): string => {
  const normalized = String(symbol || '').trim().toUpperCase();
  if (!normalized) throw new Error('Missing symbol');
  return normalized;
};

const requireVolume = (volume: unknown): number => {
  const parsed = Number(volume);
  if (!Number.isFinite(parsed) || parsed <= 0) throw new Error('Volume must be greater than zero');
  return parsed;
};

const normalizeSideForApi = (side: unknown): 'buy' | 'sell' => {
  const normalized = String(side || '').trim().toLowerCase();
  if (normalized !== 'buy' && normalized !== 'sell') throw new Error('Side must be buy or sell');
  return normalized;
};

const timestampToIso = (value: unknown): string => {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return new Date().toISOString();
  return new Date(n > 1_000_000_000_000 ? n : n * 1000).toISOString();
};

const unwrapList = <T,>(payload: T[] | { positions?: T[]; orders?: T[]; count?: number } | undefined, key: 'positions' | 'orders'): T[] => {
  if (Array.isArray(payload)) return payload;
  const list = payload?.[key];
  return Array.isArray(list) ? list : [];
};

const normalizeGatewayPositionForApp = (raw: any, index = 0) => {
  const ticket = toFiniteNumber(raw?.ticket ?? raw?.id, index + 1);
  const openPrice = toFiniteNumber(raw?.price_open ?? raw?.open_price ?? raw?.openPrice ?? raw?.price, 0);
  const currentPrice = toFiniteNumber(raw?.price_current ?? raw?.current_price ?? raw?.currentPrice, openPrice);
  const side = String(raw?.side ?? '').toLowerCase() === 'sell' ? 'SELL' : 'BUY';

  return {
    ...raw,
    id: ticket,
    ticket,
    symbol: requireSymbol(raw?.symbol),
    side,
    volume: toFiniteNumber(raw?.volume ?? raw?.quantity, 0),
    quantity: toFiniteNumber(raw?.volume ?? raw?.quantity, 0),
    open_price: openPrice,
    current_price: currentPrice,
    opened_at: raw?.opened_at ?? timestampToIso(raw?.time_create),
    sl: toFiniteNumber(raw?.price_sl ?? raw?.sl, 0),
    tp: toFiniteNumber(raw?.price_tp ?? raw?.tp, 0),
    swap: toFiniteNumber(raw?.swap, 0),
    commission: toFiniteNumber(raw?.commission, 0),
    unrealized_pl: toFiniteNumber(raw?.profit ?? raw?.unrealized_pl ?? raw?.unrealizedPnL, 0),
  };
};

const normalizeGatewayOrderForApp = (raw: any, index = 0) => {
  const ticket = toFiniteNumber(raw?.ticket ?? raw?.id, index + 1);
  const type = String(raw?.type || '').toUpperCase();
  const side = String(raw?.side ?? '').toLowerCase() === 'sell' || type.includes('SELL') ? 'SELL' : 'BUY';

  return {
    ...raw,
    id: String(ticket),
    ticket,
    symbol: requireSymbol(raw?.symbol),
    type,
    side,
    volume: toFiniteNumber(raw?.volume ?? raw?.quantity, 0),
    quantity: toFiniteNumber(raw?.volume ?? raw?.quantity, 0),
    price: toFiniteNumber(raw?.price, 0),
    sl: toFiniteNumber(raw?.price_sl ?? raw?.sl, 0),
    tp: toFiniteNumber(raw?.price_tp ?? raw?.tp, 0),
    status: String(raw?.status || 'pending').toUpperCase(),
    created_at: raw?.created_at ?? timestampToIso(raw?.time_create),
    createdAt: raw?.createdAt ?? raw?.created_at ?? timestampToIso(raw?.time_create),
  };
};

// ============================================
// HTTP Client with Error Handling
// ============================================

// ============================================
// Authentication API
// ============================================

export const authApi = {
  async login(username: string, password: string, options?: string | LoginOptions): Promise<endpoints.LoginResponse> {
    const loginOptions = typeof options === 'string' ? { baseUrl: options } : options;
    const storedBrokerId = typeof window !== 'undefined'
      ? normalizeLoginOption(localStorage.getItem('rtx_broker_id') || localStorage.getItem('broker_id'))
      : '';
    const explicitBrokerId = normalizeLoginOption(loginOptions?.broker_id);
    const explicitServer = normalizeLoginOption(loginOptions?.server);
    const storedTarget = resolveLoginBrokerTarget(getStoredBrokerServer());
    const loginTarget = explicitBrokerId
      ? { displayValue: explicitBrokerId, broker_id: explicitBrokerId }
      : explicitServer
        ? resolveLoginBrokerTarget(explicitServer)
        : storedTarget.server
          ? storedTarget
          : {
            displayValue: storedTarget.displayValue,
            broker_id: storedTarget.broker_id || storedBrokerId || DEFAULT_BROKER_ID,
          };
    const numericLogin = Number.parseInt(username, 10);
    const identifier = Number.isFinite(numericLogin) && String(numericLogin) === username.trim()
      ? { login: numericLogin }
      : username.includes('@')
        ? { email: username }
        : { username };
    const result = await endpoints.authApi.login(
      { ...identifier, password, ...(loginTarget.server ? { server: loginTarget.server } : { broker_id: loginTarget.broker_id || DEFAULT_BROKER_ID }) },
      loginOptions?.baseUrl ? { baseUrl: loginOptions.baseUrl } : undefined
    );
    const accessToken = result.token || result.access_token;
    const resolvedBrokerId = result.broker_id || loginTarget.broker_id;
    const resolvedBrokerServer = loginTarget.server || result.broker_server || loginTarget.displayValue;

    // Store tokens in Zustand store after successful login
    if (accessToken) {
      useAppStore.getState().setAuthTokens(
        accessToken,
        result.refresh_token,
        result.expires_at ? new Date(result.expires_at).getTime() : undefined
      );
    }
    if (typeof window !== 'undefined') {
      if (resolvedBrokerId) {
        localStorage.setItem('rtx_broker_id', resolvedBrokerId);
        localStorage.setItem('broker_id', resolvedBrokerId);
      }
      if (resolvedBrokerServer) {
        localStorage.setItem('rtx_broker_server', resolvedBrokerServer);
      }
    }

    return { ...result, access_token: accessToken, broker_id: resolvedBrokerId, broker_server: resolvedBrokerServer };
  },

  async refresh(refreshToken: string): Promise<endpoints.LoginResponse> {
    const result = await endpoints.authApi.refresh(refreshToken);
    const accessToken = result.token || result.access_token;
    if (accessToken) {
      useAppStore.getState().setAuthTokens(
        accessToken,
        result.refresh_token,
        result.expires_at ? new Date(result.expires_at).getTime() : undefined
      );
    }
    return { ...result, access_token: accessToken };
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
};

// ============================================
// Positions API
// ============================================

export const positionsApi = {
  async getPositions(login?: number): Promise<endpoints.Position[]> {
    const response = await endpoints.tradingApi.getPositions(resolveTradingLogin(login));
    return unwrapList(response, 'positions').map(normalizeGatewayPositionForApp) as any;
  },

  async closePosition(positionId: string): Promise<void> {
    const ticket = Number.parseInt(String(positionId), 10);
    if (!Number.isFinite(ticket) || ticket <= 0) throw new Error('Invalid position ticket');
    await endpoints.tradingApi.closePosition(ticket);
  },

  async modifyPosition(positionId: string | number, data: endpoints.ModifyPositionRequest): Promise<endpoints.Position> {
    const ticket = Number.parseInt(String(positionId), 10);
    if (!Number.isFinite(ticket) || ticket <= 0) throw new Error('Invalid position ticket');
    return endpoints.tradingApi.modifyPosition(ticket, {
      price_sl: data.price_sl,
      price_tp: data.price_tp,
      trailing_stop: data.trailing_stop,
      trailing_step: data.trailing_step,
    });
  },

  async closeBulk(
    accountId: number,
    type: 'ALL' | 'WINNERS' | 'LOSERS',
    symbol?: string
  ): Promise<{ closed: number; message: string }> {
    const login = resolveTradingLogin(accountId);
    const normalizedSymbol = symbol ? requireSymbol(symbol) : undefined;

    if (type === 'ALL' && !normalizedSymbol) {
      return apiClient.post<{ closed: number; message: string }>(
        `/accounts/${login}/close-all`,
        {},
        { baseUrl: API_V2_BASE_URL }
      );
    }

    const response = await endpoints.tradingApi.getPositions(login, { limit: 500, offset: 0 });
    const positions = unwrapList(response, 'positions').map(normalizeGatewayPositionForApp);
    const candidates = positions.filter((position: any) => {
      if (normalizedSymbol && position.symbol !== normalizedSymbol) return false;
      if (type === 'ALL') return true;
      const profit = toFiniteNumber(position.profit ?? position.unrealized_pl ?? position.unrealizedPnL, 0);
      return type === 'WINNERS' ? profit > 0 : profit < 0;
    });

    await Promise.all(candidates.map((position: any) => endpoints.tradingApi.closePosition(position.id ?? position.ticket)));

    return {
      closed: candidates.length,
      message: `Closed ${candidates.length} ${type.toLowerCase()} position${candidates.length === 1 ? '' : 's'}`,
    };
  },
};

// ============================================
// Orders API
// ============================================

export const ordersApi = {
  async placeMarketOrder(data: endpoints.CreateOrderRequest): Promise<endpoints.Position> {
    return endpoints.tradingApi.placeOrder({
      login: resolveTradingLogin(data.login ?? data.account_login),
      symbol: requireSymbol(data.symbol),
      side: normalizeSideForApi(data.side),
      volume: requireVolume(data.volume ?? data.quantity),
      price_sl: data.price_sl ?? data.sl,
      price_tp: data.price_tp ?? data.tp,
      comment: data.comment,
      trailing_stop: data.trailing_stop,
      trailing_step: data.trailing_step,
      magic: data.magic,
    });
  },

  async placePendingOrder(data: endpoints.PendingOrderRequest): Promise<endpoints.Order> {
    const type = String(data.type || '').trim().toLowerCase();
    if (!['buy_limit', 'sell_limit', 'buy_stop', 'sell_stop'].includes(type)) {
      throw new Error('Pending order type must be buy_limit, sell_limit, buy_stop, or sell_stop');
    }
    return endpoints.tradingApi.placePendingOrder({
      login: resolveTradingLogin(data.login ?? data.account_login),
      symbol: requireSymbol(data.symbol),
      side: normalizeSideForApi(data.side),
      volume: requireVolume(data.volume),
      type: type as endpoints.PendingOrderRequest['type'],
      price: requireVolume(data.price),
      price_sl: data.price_sl ?? data.sl,
      price_tp: data.price_tp ?? data.tp,
      expiration: data.expiration,
      comment: data.comment,
      trailing_stop: data.trailing_stop,
      trailing_step: data.trailing_step,
      magic: data.magic,
    });
  },

  async getPendingOrders(login?: number): Promise<endpoints.Order[]> {
    const response = await endpoints.tradingApi.getPendingOrders(resolveTradingLogin(login));
    return unwrapList(response as any, 'orders').map(normalizeGatewayOrderForApp) as any;
  },

  async cancelOrder(orderId: string): Promise<void> {
    const ticket = Number.parseInt(String(orderId), 10);
    if (!Number.isFinite(ticket) || ticket <= 0) throw new Error('Invalid pending order ticket');
    await endpoints.tradingApi.cancelOrder(ticket);
  },

  async modifyPendingOrder(orderId: string | number, data: endpoints.ModifyPendingOrderRequest): Promise<endpoints.Order> {
    const ticket = Number.parseInt(String(orderId), 10);
    if (!Number.isFinite(ticket) || ticket <= 0) throw new Error('Invalid pending order ticket');
    return endpoints.tradingApi.modifyPendingOrder(ticket, {
      price: data.price,
      price_sl: data.price_sl,
      price_tp: data.price_tp,
      expiration: data.expiration,
      trailing_stop: data.trailing_stop,
      trailing_step: data.trailing_step,
    });
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
  workspace: workspaceApi,
  notifications: notificationsApi,
  economicCalendar: economicCalendarApi,
  journal: journalApi,
};

export default api;
