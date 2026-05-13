import { API_HISTORY_BASE_URL, API_V2_BASE_URL } from '../config/api';
import { ApiError, apiClient, removeToken, setRefreshToken, setToken, type ApiRequestOptions } from './client';
import type {
  Account,
  AccountMetrics,
  ApiUser,
  AuthLoginRequest,
  AuthTokenResponse,
  BalanceOp,
  BrokerConfig,
  BrokerServer,
  Candle,
  CandleParams,
  ChangePasswordRequest,
  ClosedPosition,
  DateRangeParams,
  Deal,
  EquityPoint,
  HistoryCandle,
  HistoryCandleParams,
  HistoryTick,
  HistoryTickParams,
  Instrument,
  ListParams,
  MarginCalcRequest,
  MarginCalcResponse,
  MarketStatus,
  ModifyPendingOrderRequest,
  ModifyPositionRequest,
  OcoPair,
  Order,
  OrderBook,
  PendingOrder,
  PasswordChangeResponse,
  PlaceOcoRequest,
  PlaceOrderRequest,
  PlacePendingOrderRequest,
  Position,
  ProfitCalcRequest,
  ProfitCalcResponse,
  SetInvestorPasswordRequest,
  Tick,
  WatchlistItem,
} from '../types/api';

export type CloseAllPositionsResponse = {
  closed_count?: number;
  closed?: number;
  message?: string;
};

const v2Options = (options?: ApiRequestOptions): ApiRequestOptions => ({
  ...options,
  baseUrl: options?.baseUrl || API_V2_BASE_URL,
});

const historyOptions = (options?: ApiRequestOptions): ApiRequestOptions => ({
  ...options,
  baseUrl: options?.baseUrl || API_HISTORY_BASE_URL,
  skipAuth: options?.skipAuth ?? true,
});

const persistAuth = (response: AuthTokenResponse): AuthTokenResponse => {
  const token = response.access_token || response.token;

  if (token) {
    setToken(token);
  }

  if (response.refresh_token) {
    setRefreshToken(response.refresh_token);
  }

  if (response.expires_at && typeof window !== 'undefined') {
    localStorage.setItem('token_expires_at', String(response.expires_at));
  }

  return {
    ...response,
    access_token: token,
    token,
  };
};

export const authV2Api = {
  login: (credentials: AuthLoginRequest, options?: ApiRequestOptions) =>
    apiClient.post<AuthTokenResponse>('/auth/login', credentials, v2Options({ ...options, skipAuth: true }))
      .then(persistAuth),

  me: (options?: ApiRequestOptions) =>
    apiClient.get<ApiUser>('/auth/me', v2Options(options)),

  refresh: (refresh_token: string, options?: ApiRequestOptions) =>
    apiClient.post<AuthTokenResponse>('/auth/refresh', { refresh_token }, v2Options({ ...options, skipAuth: true }))
      .then(persistAuth),

  changePassword: (request: ChangePasswordRequest, options?: ApiRequestOptions) =>
    apiClient.post<PasswordChangeResponse>('/auth/change-password', request, v2Options(options)),

  logoutLocal: () => removeToken(),
};

export const brokerV2Api = {
  getServers: (options?: ApiRequestOptions) =>
    apiClient.get<BrokerServer[]>('/broker/servers', v2Options({ ...options, skipAuth: true })),

  getConfig: (broker_id?: string, options?: ApiRequestOptions) =>
    apiClient.get<BrokerConfig>('/broker/config', v2Options({
      ...options,
      params: { ...options?.params, broker_id },
    })),
};

export const marketV2Api = {
  getStatus: (options?: ApiRequestOptions) =>
    apiClient.get<MarketStatus>('/market/status', v2Options(options)),

  getSymbolStatus: (symbol: string, options?: ApiRequestOptions) =>
    apiClient.get<MarketStatus>(`/market/status/${encodeURIComponent(symbol)}`, v2Options(options)),

  getInstruments: (options?: ApiRequestOptions) =>
    apiClient.get<Instrument[]>('/instruments', v2Options(options)),

  getQuotes: (symbols?: string[] | string, options?: ApiRequestOptions) =>
    apiClient.get<Tick[]>('/quotes', v2Options({
      ...options,
      params: { ...options?.params, symbols: Array.isArray(symbols) ? symbols.join(',') : symbols },
    })),

  getQuote: (symbol: string, options?: ApiRequestOptions) =>
    apiClient.get<Tick>(`/quotes/${encodeURIComponent(symbol)}`, v2Options(options)),

  getCandles: (symbol: string, params?: CandleParams, options?: ApiRequestOptions) =>
    apiClient.get<Candle[]>(`/candles/${encodeURIComponent(symbol)}`, v2Options({ ...options, params })),

  getTicks: (symbol: string, params?: { limit?: number }, options?: ApiRequestOptions) =>
    apiClient.get<Tick[]>(`/ticks/${encodeURIComponent(symbol)}`, v2Options({ ...options, params })),

  getDepth: (symbol: string, params?: { limit?: number }, options?: ApiRequestOptions) =>
    apiClient.get<OrderBook>(`/depth/${encodeURIComponent(symbol)}`, v2Options({ ...options, params })),

  calculateMargin: (request: MarginCalcRequest, options?: ApiRequestOptions) =>
    apiClient.post<MarginCalcResponse>('/calculate/margin', request, v2Options(options)),

  calculateProfit: (request: ProfitCalcRequest, options?: ApiRequestOptions) =>
    apiClient.post<ProfitCalcResponse>('/calculate/profit', request, v2Options(options)),
};

export const historyV2Api = {
  getCandles: (symbol: string, params?: HistoryCandleParams, options?: ApiRequestOptions) =>
    apiClient.get<HistoryCandle[]>(`/candles/${encodeURIComponent(symbol)}`, historyOptions({ ...options, params })),

  getLatestCandle: async (symbol: string, tf?: HistoryCandleParams['tf'], options?: ApiRequestOptions) => {
    try {
      return await apiClient.get<HistoryCandle>(`/candles/${encodeURIComponent(symbol)}/latest`, historyOptions({
        ...options,
        params: { ...options?.params, tf },
      }));
    } catch (error) {
      if (!(error instanceof ApiError) || error.status !== 502) {
        throw error;
      }

      const fallback = await marketV2Api.getCandles(symbol, {
        timeframe: tf,
        limit: 5,
      }, options);
      const latest = Array.isArray(fallback) ? fallback.at(-1) : undefined;
      if (latest) return latest as HistoryCandle;
      throw error;
    }
  },

  getTicks: (symbol: string, params: HistoryTickParams, options?: ApiRequestOptions) =>
    apiClient.get<HistoryTick[]>(`/ticks/${encodeURIComponent(symbol)}`, historyOptions({ ...options, params })),
};

export const accountV2Api = {
  list: (options?: ApiRequestOptions) =>
    apiClient.get<Account[]>('/accounts', v2Options(options)),

  create: (data: { name: string; currency: string; leverage: number; group?: string }, options?: ApiRequestOptions) =>
    apiClient.post<Account>('/accounts', data, v2Options(options)),

  get: (login: number | string, options?: ApiRequestOptions) =>
    apiClient.get<Account>(`/account/${login}`, v2Options(options)),

  getMetrics: (login: number | string, options?: ApiRequestOptions) =>
    apiClient.get<AccountMetrics>(`/account/${login}/metrics`, v2Options(options)),

  getEquity: (login: number | string, params?: DateRangeParams, options?: ApiRequestOptions) =>
    apiClient.get<EquityPoint[]>(`/account/${login}/equity`, v2Options({ ...options, params })),

  getBalanceHistory: (login: number | string, params?: ListParams, options?: ApiRequestOptions) =>
    apiClient.get<BalanceOp[]>(`/accounts/${login}/history`, v2Options({ ...options, params })),

  closeAllPositions: (login: number | string, options?: ApiRequestOptions) =>
    apiClient.post<CloseAllPositionsResponse>(`/accounts/${login}/close-all`, {}, v2Options(options)),

  setInvestorPassword: (login: number | string, request: SetInvestorPasswordRequest, options?: ApiRequestOptions) =>
    apiClient.post<PasswordChangeResponse>(`/accounts/${login}/investor-password`, request, v2Options(options)),
};

export const tradingV2Api = {
  getPositions: (login: number | string, params?: ListParams, options?: ApiRequestOptions) =>
    apiClient.get<Position[]>(`/positions/${login}`, v2Options({ ...options, params })),

  getPositionHistory: (login: number | string, params?: ListParams, options?: ApiRequestOptions) =>
    apiClient.get<ClosedPosition[]>(`/positions/${login}/history`, v2Options({ ...options, params })),

  getDeals: (login: number | string, params?: ListParams, options?: ApiRequestOptions) =>
    apiClient.get<Deal[]>(`/deals/${login}`, v2Options({ ...options, params })),

  getUserOrders: (params?: ListParams, options?: ApiRequestOptions) =>
    apiClient.get<Order[]>('/account/orders', v2Options({ ...options, params })),

  getUserDeals: (params?: DateRangeParams, options?: ApiRequestOptions) =>
    apiClient.get<Deal[]>('/account/deals', v2Options({ ...options, params })),

  placeOrder: (order: PlaceOrderRequest, options?: ApiRequestOptions) =>
    apiClient.post<Position>('/orders', order, v2Options(options)),

  closePosition: (id: number | string, options?: ApiRequestOptions) =>
    apiClient.post<Deal>(`/positions/${id}/close`, {}, v2Options(options)),

  modifyPosition: (id: number | string, changes: ModifyPositionRequest, options?: ApiRequestOptions) =>
    apiClient.put<Position>(`/positions/${id}`, changes, v2Options(options)),

  getOrders: (login: number | string, params?: { limit?: number }, options?: ApiRequestOptions) =>
    apiClient.get<Order[]>(`/orders/${login}`, v2Options({ ...options, params })),

  placePendingOrder: (order: PlacePendingOrderRequest, options?: ApiRequestOptions) =>
    apiClient.post<PendingOrder>('/orders/pending', order, v2Options(options)),

  getPendingOrders: (login: number | string, options?: ApiRequestOptions) =>
    apiClient.get<PendingOrder[]>(`/orders/pending/${login}`, v2Options(options)),

  cancelPendingOrder: (ticket: number | string, options?: ApiRequestOptions) =>
    apiClient.delete<{ message?: string }>(`/orders/pending/${ticket}`, v2Options(options)),

  modifyPendingOrder: (ticket: number | string, changes: ModifyPendingOrderRequest, options?: ApiRequestOptions) =>
    apiClient.put<PendingOrder>(`/orders/pending/${ticket}`, changes, v2Options(options)),

  placeOco: (order: PlaceOcoRequest, options?: ApiRequestOptions) =>
    apiClient.post<OcoPair>('/orders/oco', order, v2Options(options)),

  getOcoPairs: (login: number | string, options?: ApiRequestOptions) =>
    apiClient.get<OcoPair[]>(`/orders/oco/${login}`, v2Options(options)),

  cancelOco: (id: number | string, options?: ApiRequestOptions) =>
    apiClient.delete<{ message?: string }>(`/orders/oco/${id}`, v2Options(options)),
};

export const watchlistV2Api = {
  list: (options?: ApiRequestOptions) =>
    apiClient.get<WatchlistItem[]>('/watchlist', v2Options(options)),

  update: (symbols: string[], options?: ApiRequestOptions) =>
    apiClient.put<WatchlistItem[]>('/watchlist', { symbols }, v2Options(options)),

  add: (symbol: string, options?: ApiRequestOptions) =>
    apiClient.post<WatchlistItem>(`/watchlist/${encodeURIComponent(symbol)}`, {}, v2Options(options)),

  remove: (symbol: string, options?: ApiRequestOptions) =>
    apiClient.delete<{ message?: string }>(`/watchlist/${encodeURIComponent(symbol)}`, v2Options(options)),
};

export const tradeApi = {
  auth: authV2Api,
  broker: brokerV2Api,
  market: marketV2Api,
  history: historyV2Api,
  account: accountV2Api,
  trading: tradingV2Api,
  watchlist: watchlistV2Api,
};

export type {
  Account,
  AccountMetrics,
  AuthLoginRequest,
  AuthTokenResponse,
  BrokerConfig,
  BrokerServer,
  Candle,
  CandleParams,
  ChangePasswordRequest,
  ClosedPosition,
  Deal,
  HistoryCandle,
  HistoryCandleParams,
  HistoryTick,
  HistoryTickParams,
  Instrument,
  MarginCalcRequest,
  MarginCalcResponse,
  ModifyPendingOrderRequest,
  ModifyPositionRequest,
  OcoPair,
  Order,
  PendingOrder,
  PasswordChangeResponse,
  PlaceOcoRequest,
  PlaceOrderRequest,
  PlacePendingOrderRequest,
  Position,
  ProfitCalcRequest,
  ProfitCalcResponse,
  SetInvestorPasswordRequest,
  Tick,
  WatchlistItem,
} from '../types/api';
