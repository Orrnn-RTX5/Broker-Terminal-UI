import { API_V2_BASE_URL, isLocalViteDevServer } from '../config/api';
import { ApiError, apiClient, removeToken, setRefreshToken, setToken, type ApiRequestOptions } from './client';
import { normalizeBrokerAuthLoginPayload } from './authLoginPayload';
import { normalizeCandleApiQueryParams } from '../utils/candleApi';
import { requirePositionCloseTicket } from './positionClose';
import { createTradeOrderUuid, isTradeOrderUuidV4 } from './tradeSocket';
import type {
  Account,
  AccountMetrics,
  ApiUser,
  AuthLoginRequest,
  AuthTokenResponse,
  BalanceOp,
  Broker,
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
  WatchlistReplaceItem,
} from '../types/api';

export type CloseAllPositionsResponse = {
  closed_count?: number;
  closed?: number;
  message?: string;
};

// Authentication may legitimately outlive the generic API deadline while the
// broker opens the account session. Do not discard a late 200/401 response.
const AUTH_LOGIN_TIMEOUT_MS = 90_000;

const v2Options = (options?: ApiRequestOptions): ApiRequestOptions => ({
  ...options,
  baseUrl: options?.baseUrl || API_V2_BASE_URL,
});

const historyOptions = (options?: ApiRequestOptions): ApiRequestOptions => ({
  ...options,
  baseUrl: options?.baseUrl || API_V2_BASE_URL,
});

const getApiRootBaseUrl = (): string => API_V2_BASE_URL.replace(/\/api\/v2\/?$/, '');

const symbolEndpointOptions = (endpoint: string, options?: ApiRequestOptions): { endpoint: string; options: ApiRequestOptions } => {
  if (endpoint.startsWith('/api/v2')) {
    return {
      endpoint: endpoint.replace(/^\/api\/v2(?=\/|$)/, '') || '/',
      options: v2Options(options),
    };
  }

  return {
    endpoint,
    options: {
      ...options,
      baseUrl: options?.baseUrl || getApiRootBaseUrl(),
    },
  };
};

const extractInstrumentRows = (payload: unknown): Instrument[] => {
  if (Array.isArray(payload)) return payload as Instrument[];
  if (!payload || typeof payload !== 'object') return [];

  const record = payload as Record<string, unknown>;
  if (Array.isArray(record.symbols)) return record.symbols as Instrument[];
  if (Array.isArray(record.instruments)) return record.instruments as Instrument[];
  if (Array.isArray(record.data)) return record.data as Instrument[];
  if (Array.isArray(record.result)) return record.result as Instrument[];
  return [];
};

const normalizeInstrumentRow = (instrument: Instrument): Instrument | null => {
  const symbol = String(instrument.symbol ?? instrument.name ?? instrument.id ?? '').trim();
  if (!symbol) return null;

  return {
    ...instrument,
    symbol,
    name: instrument.name ?? symbol,
    id: instrument.id ?? symbol,
    description: instrument.description ?? symbol,
    category: instrument.category,
    digits: instrument.digits,
    bid: instrument.bid,
    ask: instrument.ask,
    enabled: instrument.enabled ?? instrument.trading_enabled ?? instrument.tradingEnabled ?? true,
  };
};

const SYMBOL_ENDPOINTS = ['/api/v2/instruments', '/api/v1/market/symbols', '/api/v1/market/symbol-list'];

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

type PendingOrderPayload = {
  account_login: number;
  symbol: string;
  side: PlacePendingOrderRequest['side'];
  volume: number;
  type: PlacePendingOrderRequest['type'];
  price: number;
  sl?: number;
  tp?: number;
  expiry?: number;
  comment?: string;
  trailing_stop?: number;
  trailing_step?: number;
  magic?: number;
};

type ModifyPendingOrderPayload = {
  price?: number;
  sl?: number;
  tp?: number;
  expiry?: number;
  comment?: string;
  trailing_stop?: number;
  trailing_step?: number;
};

const normalizePendingOrderRequest = (order: PlacePendingOrderRequest): PendingOrderPayload => ({
  account_login: order.account_login ?? order.login,
  symbol: order.symbol,
  side: order.side,
  volume: order.volume,
  type: order.type,
  price: order.price,
  sl: order.sl ?? order.price_sl,
  tp: order.tp ?? order.price_tp,
  expiry: order.expiry ?? order.expiration,
  comment: order.comment,
  trailing_stop: order.trailing_stop,
  trailing_step: order.trailing_step,
  magic: order.magic,
});

const normalizeModifyPendingOrderRequest = (changes: ModifyPendingOrderRequest): ModifyPendingOrderPayload => ({
  price: changes.price,
  sl: changes.sl ?? changes.price_sl,
  tp: changes.tp ?? changes.price_tp,
  expiry: changes.expiry ?? changes.expiration,
  comment: changes.comment,
  trailing_stop: changes.trailing_stop,
  trailing_step: changes.trailing_step,
});

export const authV2Api = {
  login: async (credentials: AuthLoginRequest, options?: ApiRequestOptions) => {
    const shouldSkipDynamicUrl = (Boolean(options?.baseUrl) || Boolean(options?.skipDynamicUrl)) && !isLocalViteDevServer();
    const payload = normalizeBrokerAuthLoginPayload(credentials);
    const requestOptions = v2Options({
      ...options,
      skipAuth: true,
      skipDynamicUrl: shouldSkipDynamicUrl,
      timeoutMs: options?.timeoutMs ?? AUTH_LOGIN_TIMEOUT_MS,
    });
    const requestLogin = () => apiClient.post<AuthTokenResponse>(
      '/auth/login',
      payload,
      requestOptions,
    );

    let response: AuthTokenResponse;
    try {
      response = await requestLogin();
    } catch (error) {
      // A completed 502 is safe to retry once: it means the broker gateway or
      // local development proxy did not produce an authentication response.
      // Do not retry ambiguous network failures, timeouts, aborts, or rejected
      // credentials because those have different recovery semantics.
      if (!(error instanceof ApiError) || error.status !== 502 || options?.signal?.aborted) {
        throw error;
      }
      response = await requestLogin();
    }

    return persistAuth(response);
  },

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

  getBrokers: (options?: ApiRequestOptions) =>
    apiClient.get<{ brokers: Broker[]; count: number }>('/brokers', v2Options({ ...options, skipAuth: true })),

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

  getAuthorizedInstruments: async (options?: ApiRequestOptions) => {
    const payload = await apiClient.get<unknown>('/instruments', v2Options(options));
    return extractInstrumentRows(payload)
      .map(normalizeInstrumentRow)
      .filter((instrument): instrument is Instrument => Boolean(instrument));
  },

  getInstruments: async (options?: ApiRequestOptions) => {
    let lastError: unknown = null;

    for (const endpoint of SYMBOL_ENDPOINTS) {
      try {
        const request = symbolEndpointOptions(endpoint, options);
        const payload = await apiClient.get<unknown>(request.endpoint, request.options);
        const instruments = extractInstrumentRows(payload);
        const normalized = instruments
          .map(normalizeInstrumentRow)
          .filter((instrument): instrument is Instrument => Boolean(instrument));
        if (normalized.length > 0) return normalized;
        lastError = new ApiError(0, `No symbols returned by ${endpoint}`);
      } catch (error) {
        lastError = error;
      }
    }

    throw lastError instanceof Error ? lastError : new ApiError(0, 'Failed to fetch symbols');
  },

  getQuotes: (symbols?: string[] | string, options?: ApiRequestOptions) =>
    apiClient.get<Tick[]>('/quotes', v2Options({
      ...options,
      params: { ...options?.params, symbols: Array.isArray(symbols) ? symbols.join(',') : symbols },
    })),

  getQuote: (symbol: string, options?: ApiRequestOptions) =>
    apiClient.get<Tick>(`/quotes/${encodeURIComponent(symbol)}`, v2Options(options)),

  getCandles: (symbol: string, params?: CandleParams, options?: ApiRequestOptions) =>
    apiClient.get<Candle[]>(`/candles/${encodeURIComponent(symbol)}`, v2Options({
      ...options,
      params: normalizeCandleApiQueryParams(params),
    })),

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
    apiClient.get<HistoryCandle[]>(`/candles/${encodeURIComponent(symbol)}`, historyOptions({
      ...options,
      params: normalizeCandleApiQueryParams(params),
    })),

  getLatestCandle: async (symbol: string, timeframe?: HistoryCandleParams['timeframe'], options?: ApiRequestOptions) => {
    const candles = await historyV2Api.getCandles(symbol, { timeframe, limit: 5 }, options);
    const latest = Array.isArray(candles) ? candles.at(-1) : undefined;
    if (latest) return latest;
    throw new ApiError(404, 'No candles returned by /api/v2/candles');
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

  placeOrder: (order: PlaceOrderRequest, options?: ApiRequestOptions) => {
    const suppliedClientOrderId = String(order.client_order_id ?? '').trim();
    if (suppliedClientOrderId && !isTradeOrderUuidV4(suppliedClientOrderId)) {
      throw new Error('client_order_id must be a UUID v4');
    }
    return apiClient.post<Position | Record<string, unknown>>('/orders', {
      ...order,
      client_order_id: suppliedClientOrderId || createTradeOrderUuid(),
    }, v2Options(options));
  },

  getOrderCommand: (clientOrderId: string, options?: ApiRequestOptions) =>
    apiClient.get<Record<string, unknown>>(
      `/order-commands/${encodeURIComponent(clientOrderId)}`,
      v2Options(options),
    ),

  closePosition: (id: number | string, options?: ApiRequestOptions) =>
    apiClient.post<Deal>(
      `/positions/${requirePositionCloseTicket(id, '/api/v2/positions/{id}/close')}/close`,
      { mode: 'full' },
      v2Options(options)
    ),

  modifyPosition: (id: number | string, changes: ModifyPositionRequest, options?: ApiRequestOptions) =>
    apiClient.put<Position>(`/positions/${id}`, changes, v2Options(options)),

  getOrders: (login: number | string, params?: { limit?: number }, options?: ApiRequestOptions) =>
    apiClient.get<Order[]>(`/orders/${login}`, v2Options({ ...options, params })),

  placePendingOrder: (order: PlacePendingOrderRequest, options?: ApiRequestOptions) =>
    apiClient.post<PendingOrder>('/orders/pending', normalizePendingOrderRequest(order), v2Options(options)),

  getPendingOrders: (login: number | string, options?: ApiRequestOptions) =>
    apiClient.get<PendingOrder[]>(`/orders/pending/${login}`, v2Options(options)),

  cancelPendingOrder: (ticket: number | string, options?: ApiRequestOptions) =>
    apiClient.delete<{ message?: string }>(`/orders/pending/${ticket}`, v2Options(options)),

  modifyPendingOrder: (ticket: number | string, changes: ModifyPendingOrderRequest, options?: ApiRequestOptions) =>
    apiClient.put<PendingOrder>(`/orders/pending/${ticket}`, normalizeModifyPendingOrderRequest(changes), v2Options(options)),

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

  update: (symbols: readonly string[], options?: ApiRequestOptions) => {
    const items: WatchlistReplaceItem[] = symbols.map((symbol, sort_order) => ({
      symbol,
      sort_order,
    }));

    return apiClient.put<WatchlistItem[]>('/watchlist', items, v2Options(options));
  },

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
  Broker,
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
  WatchlistReplaceItem,
} from '../types/api';
