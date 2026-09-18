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
  login: async (credentials: AuthLoginRequest, options?: ApiRequestOptions & { persistSession?: boolean }) => {
    const { persistSession = true, ...requestOverrides } = options ?? {};
    const shouldSkipDynamicUrl = (Boolean(options?.baseUrl) || Boolean(options?.skipDynamicUrl)) && !isLocalViteDevServer();
    const payload = normalizeBrokerAuthLoginPayload(credentials);
    const requestOptions = v2Options({
      ...requestOverrides,
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

    if (persistSession) return persistAuth(response);
    const token = response.access_token || response.token;
    return { ...response, access_token: token, token };
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

export interface ClosePositionRequestOptions extends ApiRequestOptions {
  volume?: number;
  client_order_id?: string;
  clientOrderId?: string;
  account_login?: number | string;
  accountLogin?: number | string;
  closeRecoveryAttempts?: number;
  closeRecoveryIntervalMs?: number;
}

export type ClosePositionSecondArg = ClosePositionRequestOptions | number | undefined;

const CLOSE_RECOVERY_DEFAULT_ATTEMPTS = 8;
const CLOSE_RECOVERY_DEFAULT_INTERVAL_MS = 500;
const CLOSE_RECOVERY_MAX_ATTEMPTS = 20;

const toPositiveAccountLogin = (value: unknown): number | undefined => {
  if (typeof value === 'number') {
    return Number.isSafeInteger(value) && value > 0 ? value : undefined;
  }
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!/^\d+$/.test(trimmed)) return undefined;
    const parsed = Number(trimmed);
    return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : undefined;
  }
  return undefined;
};

const resolveExplicitCloseLogin = (primary: unknown, alias: unknown, context: string): number | undefined => {
  if ((primary !== undefined && toPositiveAccountLogin(primary) === undefined) || (alias !== undefined && toPositiveAccountLogin(alias) === undefined)) {
    throw new Error(`Invalid account identity for ${context}`);
  }
  const first = toPositiveAccountLogin(primary);
  const second = toPositiveAccountLogin(alias);
  if (first !== undefined && second !== undefined && first !== second) {
    throw new Error(`Conflicting account identity for ${context} (account_login !== accountLogin); refusing ambiguous close`);
  }
  return first ?? second;
};

const normalizeCloseVolume = (value: unknown): number => {
  if (value === undefined || value === null || value === '') return 0;
  const parsed = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new Error('Close volume must be a finite non-negative number');
  }
  return parsed;
};

const normalizeCloseClientOrderId = (value: unknown): string => {
  const trimmed = String(value ?? '').trim();
  if (!trimmed) return createTradeOrderUuid();
  if (!isTradeOrderUuidV4(trimmed)) throw new Error('client_order_id must be a UUID v4');
  return trimmed;
};

const normalizeRecoveryAttempts = (value: unknown): number => {
  if (value === undefined || value === null || value === '') return CLOSE_RECOVERY_DEFAULT_ATTEMPTS;
  const parsed = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(parsed)) return CLOSE_RECOVERY_DEFAULT_ATTEMPTS;
  return Math.min(Math.max(Math.trunc(parsed), 1), CLOSE_RECOVERY_MAX_ATTEMPTS);
};

const normalizeRecoveryIntervalMs = (value: unknown): number => {
  if (value === undefined || value === null || value === '') return CLOSE_RECOVERY_DEFAULT_INTERVAL_MS;
  const parsed = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(parsed)) return CLOSE_RECOVERY_DEFAULT_INTERVAL_MS;
  return Math.min(Math.max(Math.trunc(parsed), 0), 5_000);
};

const readCommandStatus = (payload: unknown): string => {
  if (payload && typeof payload === 'object' && !Array.isArray(payload) && 'status' in payload && typeof payload.status === 'string') {
    return payload.status.trim().toLowerCase();
  }
  return '';
};

const readCommandType = (payload: unknown): string => {
  if (payload && typeof payload === 'object' && !Array.isArray(payload) && 'type' in payload && typeof payload.type === 'string') {
    return payload.type.trim().toLowerCase();
  }
  return '';
};

const readCommandNestedResult = (payload: unknown): Record<string, unknown> | undefined => {
  if (payload && typeof payload === 'object' && !Array.isArray(payload)) {
    const record = payload as Record<string, unknown>;
    for (const key of ['data', 'result'] as const) {
      const nested = record[key];
      if (nested && typeof nested === 'object' && !Array.isArray(nested)) {
        return nested as Record<string, unknown>;
      }
    }
  }
  return undefined;
};

const readCommandLevels = (payload: unknown): Record<string, unknown>[] => {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return [];
  const nested = readCommandNestedResult(payload);
  return nested ? [payload as Record<string, unknown>, nested] : [payload as Record<string, unknown>];
};

const readCommandClientOrderIds = (payload: unknown): string[] => {
  const ids: string[] = [];
  for (const level of readCommandLevels(payload)) {
    for (const key of ['client_order_id', 'clientOrderId'] as const) {
      const value = level[key];
      if (typeof value === 'string' && value.trim() !== '') ids.push(value.trim());
    }
  }
  return ids;
};

const readCommandTickets = (payload: unknown): string[] => {
  const tickets: string[] = [];
  for (const level of readCommandLevels(payload)) {
    for (const key of ['ticket', 'position_ticket', 'positionTicket', 'position_id', 'positionId'] as const) {
      const value = level[key];
      if (typeof value === 'number' && Number.isSafeInteger(value) && value > 0) tickets.push(String(value));
      else if (typeof value === 'string' && value.trim() !== '') tickets.push(value.trim());
    }
  }
  return tickets;
};

const readCommandAccountLogins = (payload: unknown): number[] => {
  const logins: number[] = [];
  for (const level of readCommandLevels(payload)) {
    for (const key of ['account_login', 'accountLogin', 'login'] as const) {
      const resolved = toPositiveAccountLogin(level[key]);
      if (resolved !== undefined) logins.push(resolved);
    }
  }
  return logins;
};

// Strict success correlation: every echoed client_order_id must equal the
// original intent ID, the requested position ticket must be named at some
// level (top-level or nested data/result), and any echoed account must agree
// with the pinned one. Unrelated or malformed snapshots never confirm.
const isCorrelatedCloseSuccess = (
  payload: unknown,
  clientOrderId: string,
  expectedTicket: string,
  accountLogin: number | undefined,
): boolean => {
  const ids = readCommandClientOrderIds(payload);
  if (ids.length === 0 || ids.some((id) => id !== clientOrderId)) return false;
  if (!readCommandTickets(payload).includes(expectedTicket)) return false;
  if (accountLogin !== undefined && readCommandAccountLogins(payload).some((login) => login !== accountLogin)) return false;
  return true;
};

// Rejection correlation: an echo naming another intent must never fail this
// close. ID-less rejections are attributed by the GET URL lookup itself, and
// rejections carry no position ticket to check.
const isCorrelatedCloseRejection = (
  payload: unknown,
  clientOrderId: string,
  accountLogin: number | undefined,
): boolean => {
  const ids = readCommandClientOrderIds(payload);
  if (ids.some((id) => id !== clientOrderId)) return false;
  if (accountLogin !== undefined && readCommandAccountLogins(payload).some((login) => login !== accountLogin)) return false;
  return true;
};

const extractCloseTerminalDeal = (payload: unknown): Deal =>
  (readCommandNestedResult(payload) ?? payload) as Deal;

const CLOSE_SUCCESS_STATUS: Record<string, true> = {
  filled: true,
  succeeded: true,
  closed: true,
  partial_closed: true,
};

const CLOSE_FAILURE_STATUS: Record<string, true> = {
  rejected: true,
  expired: true,
};

const isCloseAcceptedPayload = (payload: unknown): boolean => {
  const status = readCommandStatus(payload);
  if (status === 'accepted' || status === 'processing' || status === 'pending') return true;
  if (status !== '' && !CLOSE_SUCCESS_STATUS[status] && !CLOSE_FAILURE_STATUS[status]) return true;
  const type = readCommandType(payload);
  if (type === 'position_close_accepted' || type === 'order_accepted') return true;
  return false;
};

const closeRejectionError = (payload: unknown, clientOrderId: string): ApiError => {
  let message = 'Position close was rejected';
  let code = 'ORDER_REJECTED';
  let retryable = false;
  if (payload && typeof payload === 'object' && !Array.isArray(payload) && 'error' in payload) {
    const errorValue = payload.error;
    if (errorValue && typeof errorValue === 'object' && !Array.isArray(errorValue)) {
      if ('message' in errorValue && typeof errorValue.message === 'string') message = errorValue.message;
      if ('code' in errorValue && typeof errorValue.code === 'string') code = errorValue.code;
      if ('retryable' in errorValue) retryable = Boolean(errorValue.retryable);
    }
  }
  if (message === 'Position close was rejected' && payload && typeof payload === 'object' && !Array.isArray(payload)) {
    if ('message' in payload && typeof payload.message === 'string') message = payload.message;
    else if ('status' in payload && typeof payload.status === 'string') message = payload.status;
    if (code === 'ORDER_REJECTED' && 'code' in payload && typeof payload.code === 'string') code = payload.code;
  }
  return new ApiError(
    retryable ? 503 : 400,
    `${message} (client_order_id ${clientOrderId})`,
    { code, client_order_id: clientOrderId, payload },
  );
};


const delayWithAbort = (ms: number, signal?: AbortSignal | null): Promise<void> => {
  if (ms <= 0) return Promise.resolve();
  if (signal?.aborted) return Promise.reject(signal.reason ?? new ApiError(0, 'Request aborted'));
  return new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = (): void => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
      reject(signal?.reason ?? new ApiError(0, 'Request aborted'));
    };
    signal?.addEventListener('abort', onAbort, { once: true });
  });
};


const buildCloseStatusOptions = (
  requestOptions: ApiRequestOptions,
  accountLogin: number | undefined,
): ApiRequestOptions => {
  const shaped: ApiRequestOptions = { ...requestOptions };
  const merged: Record<string, unknown> = {};
  const sourceParams = shaped.params;
  if (sourceParams && typeof sourceParams === 'object') {
    for (const [key, value] of Object.entries(sourceParams)) merged[key] = value;
  }
  delete merged.accountLogin;
  delete merged.login;
  if (accountLogin !== undefined) merged.account_login = accountLogin;
  else delete merged.account_login;
  if (Object.keys(merged).length > 0) shaped.params = merged;
  else delete shaped.params;
  return v2Options(shaped);
};


const pollCloseCommandForTerminal = async (
  clientOrderId: string,
  expectedTicket: string,
  accountLogin: number | undefined,
  requestOptions: ApiRequestOptions,
  attempts: number,
  intervalMs: number,
): Promise<Deal> => {
  const deadline = performance.now() + 30_000;
  let lastAccepted: unknown = null;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const signal = requestOptions.signal;
    if (signal?.aborted) throw signal.reason ?? new ApiError(0, `Close ${clientOrderId} aborted`);
    if (attempt > 0) await delayWithAbort(intervalMs, signal);
    if (signal?.aborted) throw signal.reason ?? new ApiError(0, `Close ${clientOrderId} aborted`);
    const remainingMs = deadline - performance.now();
    if (remainingMs <= 0) break;
    let snapshot: unknown;
    try {
      snapshot = await apiClient.get<Record<string, unknown>>(
        `/order-commands/${encodeURIComponent(clientOrderId)}`,
        buildCloseStatusOptions({ ...requestOptions, timeoutMs: Math.min(requestOptions.timeoutMs ?? 5_000, remainingMs) }, accountLogin),
      );
    } catch (error) {
      if (error instanceof ApiError && (error.status === 401 || error.status === 403)) throw error;
      if (error instanceof ApiError && error.status === 404) {
        throw new ApiError(
          404,
          `Close outcome unknown for client_order_id ${clientOrderId}: order command not found; verify before acting (never resubmitted, not confirmed)`,
          { client_order_id: clientOrderId },
        );
      }
      if (attempt >= attempts - 1) break;
      continue;
    }
    const status = readCommandStatus(snapshot);
    if (CLOSE_SUCCESS_STATUS[status]) {
      // A filled-type snapshot for another intent (or one that never names
      // this position) is unrelated/malformed: keep polling, never confirm.
      if (isCorrelatedCloseSuccess(snapshot, clientOrderId, expectedTicket, accountLogin)) {
        return extractCloseTerminalDeal(snapshot);
      }
      lastAccepted = snapshot;
      continue;
    }
    if (CLOSE_FAILURE_STATUS[status]) {
      if (isCorrelatedCloseRejection(snapshot, clientOrderId, accountLogin)) {
        throw closeRejectionError(snapshot, clientOrderId);
      }
      lastAccepted = snapshot;
      continue;
    }
    lastAccepted = snapshot;
  }
  throw new ApiError(
    0,
    `Close confirmation timed out for client_order_id ${clientOrderId}; outcome unknown — verify GET /order-commands/${clientOrderId} before acting (never resubmitted, not confirmed)`,
    { client_order_id: clientOrderId, lastStatus: lastAccepted },
  );
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

  getOrderCommand: (
    clientOrderId: string,
    options?: ApiRequestOptions & { account_login?: number | string; accountLogin?: number | string },
  ) => {
    const trimmed = String(clientOrderId ?? '').trim();
    if (!trimmed) throw new Error('client_order_id is required for /api/v2/order-commands/{client_order_id}');
    const lookup: ApiRequestOptions & { account_login?: unknown; accountLogin?: unknown } = options ?? {};
    let resolved: number | undefined = toPositiveAccountLogin(lookup.account_login);
    if (resolved === undefined) resolved = toPositiveAccountLogin(lookup.accountLogin);
    if (resolved === undefined) {
      const source = lookup.params;
      if (source && typeof source === 'object') {
        const params: Record<string, unknown> = { ...source };
        if ('account_login' in params) resolved = toPositiveAccountLogin(params.account_login);
        if (resolved === undefined && 'accountLogin' in params) resolved = toPositiveAccountLogin(params.accountLogin);
        if (resolved === undefined && 'login' in params) resolved = toPositiveAccountLogin(params.login);
      }
    }
    if (resolved === undefined) return apiClient.get<Record<string, unknown>>(
      `/order-commands/${encodeURIComponent(trimmed)}`,
      v2Options(options),
    );
    const source = lookup.params;
    const merged: Record<string, unknown> = source && typeof source === 'object' ? { ...source } : {};
    delete merged.accountLogin;
    delete merged.login;
    merged.account_login = resolved;
    return apiClient.get<Record<string, unknown>>(
      `/order-commands/${encodeURIComponent(trimmed)}`,
      v2Options({ ...lookup, params: merged }),
    );
  },

  closePosition: (
    id: number | string,
    volumeOrOptions?: ClosePositionSecondArg,
    maybeOptions?: ClosePositionRequestOptions,
  ): Promise<Deal> => {
    const ticket = requirePositionCloseTicket(id, '/api/v2/positions/{id}/close');
    let volumeInput: unknown;
    let rawOptions: ClosePositionRequestOptions | undefined;
    if (typeof volumeOrOptions === 'number') {
      volumeInput = volumeOrOptions;
      rawOptions = maybeOptions;
    } else if (volumeOrOptions !== undefined && volumeOrOptions !== null && typeof volumeOrOptions === 'object') {
      rawOptions = volumeOrOptions;
      volumeInput = rawOptions.volume;
    } else if (volumeOrOptions === undefined) {
      rawOptions = maybeOptions;
    } else {
      throw new Error('Close volume must be a finite non-negative number');
    }
    const opts: ClosePositionRequestOptions = rawOptions ?? {};
    if (volumeInput === undefined) volumeInput = opts.volume;
    const volume = normalizeCloseVolume(volumeInput);
    const providedId = opts.client_order_id ?? opts.clientOrderId;
    const clientOrderId = normalizeCloseClientOrderId(providedId);
    const explicitAccount = resolveExplicitCloseLogin(opts.account_login, opts.accountLogin, '/api/v2/positions/{id}/close');
    let paramAccount: number | undefined;
    const paramSource = opts.params;
    if (paramSource && typeof paramSource === 'object') {
      const params: Record<string, unknown> = { ...paramSource };
      const paramPair = resolveExplicitCloseLogin(params.account_login, params.accountLogin, '/api/v2/positions/{id}/close');
      const paramLogin = toPositiveAccountLogin(params.login);
      if (paramPair !== undefined && paramLogin !== undefined && paramPair !== paramLogin) {
        throw new Error('Conflicting account identity for /api/v2/positions/{id}/close (params); refusing ambiguous close');
      }
      paramAccount = paramPair ?? paramLogin;
    }
    // No stored-username fallback: without an explicit identity the backend
    // default linked account applies (account_login omitted). Guessing from
    // rtx_saved_username/rtx_last_login risks closing on the wrong account.
    if (explicitAccount !== undefined && paramAccount !== undefined && explicitAccount !== paramAccount) throw new Error("Conflicting account identity in close options and params");
    const accountLogin = explicitAccount ?? paramAccount;
    const attempts = normalizeRecoveryAttempts(opts.closeRecoveryAttempts);
    const intervalMs = normalizeRecoveryIntervalMs(opts.closeRecoveryIntervalMs);
    const restRequest: ClosePositionRequestOptions = { ...opts };
    const rawParams = restRequest.params;
    delete restRequest.volume;
    delete restRequest.client_order_id;
    delete restRequest.clientOrderId;
    delete restRequest.account_login;
    delete restRequest.accountLogin;
    delete restRequest.closeRecoveryAttempts;
    delete restRequest.closeRecoveryIntervalMs;
    delete restRequest.params;
    const postParams: Record<string, unknown> = rawParams && typeof rawParams === 'object' ? { ...rawParams } : {};
    delete postParams.account_login;
    delete postParams.accountLogin;
    delete postParams.login;
    const postOptions = v2Options({
      ...restRequest,
      ...(Object.keys(postParams).length > 0 ? { params: postParams } : {}),
    });
    const statusRequestOptions: ApiRequestOptions = { ...restRequest, ...(rawParams && typeof rawParams === 'object' ? { params: { ...rawParams } } : {}) };
    const endpoint = `/positions/${ticket}/close`;
    const body = { client_order_id: clientOrderId, volume };
    return (async (): Promise<Deal> => {
      let posted: unknown;
      try {
        posted = await apiClient.post<unknown>(endpoint, body, postOptions);
      } catch (error) {
        const ambiguous = error instanceof ApiError && (error.status === 0 || error.status === 503);
        if (!ambiguous) throw error;
        return pollCloseCommandForTerminal(clientOrderId, ticket, accountLogin, statusRequestOptions, attempts, intervalMs);
      }
      const status = readCommandStatus(posted);
      if (CLOSE_FAILURE_STATUS[status]) throw closeRejectionError(posted, clientOrderId);
      if (CLOSE_SUCCESS_STATUS[status]) {
        // A direct success names this intent (original ID + position ticket)
        // or it is not a confirm: fall through to the bounded same-ID poll.
        if (isCorrelatedCloseSuccess(posted, clientOrderId, ticket, accountLogin)) {
          return extractCloseTerminalDeal(posted);
        }
      } else if (isCloseAcceptedPayload(posted)) {
        return pollCloseCommandForTerminal(clientOrderId, ticket, accountLogin, statusRequestOptions, attempts, intervalMs);
      }
      // HTTP 200 without a correlated success status proves nothing about
      // execution: verify via the bounded same-ID status poll, which reports
      // unresolved (never resubmitted, not confirmed) instead of confirming blind.
      return pollCloseCommandForTerminal(clientOrderId, ticket, accountLogin, statusRequestOptions, attempts, intervalMs);
    })();
  },

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
