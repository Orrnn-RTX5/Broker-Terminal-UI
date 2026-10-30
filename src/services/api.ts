/**
 * Comprehensive API Service Layer
 * Centralized API communication with type safety and error handling
 * Includes authentication with JWT token management and 401 handling
 */

import { resolveTickFromLookup, useAppStore } from '../store/useAppStore';
import { readBackendNumber } from './backendAccountMetrics';
import { API_V2_BASE_URL, normalizeBrokerServerUrl } from '../config/api';
import {
  getRuntimeConfiguredBrokerId,
  getRuntimeBrokerConfiguration,
  isConfiguredBrokerEndpoint,
  isDesktopBackendTarget,
  normalizeBrokerInfoForTarget,
  resolveBrokerBackendUrl,
  resolveBrokerExtApiUrl,
} from '../config/backendTarget.js';

// ============================================
// API Response Types
// ============================================

export interface ApiResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
  message?: string;
}

export interface BrokerConfig {
  brokerName: string;
  logo_url?: string;
  // Broker-supplied operating values (white-label: any broker's strings, never
  // code literals — see normalizeBrokerOperationalConfig for the neutral read).
  priceFeedLP: string;
  executionMode: string;
  defaultLeverage: number;
  defaultBalance: number;
  marginMode: string;
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

import { ApiError, apiClient, getAuthToken, type ApiRequestContext } from '../api/client';
import * as endpoints from '../api/endpoints';
import type { ClosePositionRequestOptions } from '../api/trade';
import {
  createTradeOrderUuid,
  getTradeWebSocketClient,
  initializeTradeWebSocketClient,
  isTerminalTradeOrderMessage,
  isTradeOrderUuidV4,
  TradeSocketOrderRejectedError,
  TradeSocketTransportError,
  type TradeSocketOrderFilled,
} from '../api/tradeSocket';
import {
  recordTradeOrderLatency,
  toTradeOrderTraceId,
  tradeOrderNow,
  type TradeOrderLatencyTransport,
  type TradeOrderTerminalStatus,
} from './orderLatencyTelemetry';
import {
  MARKET_ORDER_PLACEMENT_STATE_EVENT,
  type MarketOrderPlacementState,
} from './marketOrderPlacementEvents';
import {
  OrderCommandTerminalError,
  pollOrderCommandUntilTerminal,
  type NormalizedOrderCommand,
  type PollOrderCommandOptions,
} from './orderCommandLifecycle';
import { getStoredBrokerServer, resolveLoginBrokerTarget } from './brokerServers';
import { normalizeBrokerOperationalConfig } from './brokerOperationalConfig';
import {
  getCommittedBrokerAccountSessionScope,
  getCommittedBrokerAccountSessionScopeKey,
  getRefreshToken,
  persistBrokerSessionDiscovery,
} from './brokerSession';


initializeTradeWebSocketClient();

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

const normalizeMarketProtection = (value: unknown, label: 'SL' | 'TP'): number => {
  if (value === undefined) return 0;
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    throw new Error(`${label} must be zero (disabled) or a positive finite number`);
  }
  return value;
};

const normalizeSideForApi = (side: unknown): 'buy' | 'sell' => {
  const normalized = String(side || '').trim().toLowerCase();
  if (normalized !== 'buy' && normalized !== 'sell') throw new Error('Side must be buy or sell');
  return normalized;
};

const isRetryableTradeSocketFailure = (error: unknown): boolean => {
  if (error instanceof TradeSocketOrderRejectedError) return false;
  if (error instanceof TradeSocketTransportError) return error.retryable;
  if (!error || typeof error !== 'object') return false;

  const candidate = error as {
    name?: unknown;
    retryable?: unknown;
    orderWasSent?: unknown;
  };
  return candidate.name !== 'TradeSocketOrderRejectedError'
    && candidate.retryable === true
    && candidate.orderWasSent === false;
};

const pickPositiveFiniteNumber = (...values: unknown[]): number => {
  for (const value of values) {
    const parsed = toFiniteNumber(value, 0);
    if (Number.isFinite(parsed) && parsed > 0) return parsed;
  }
  return 0;
};

const mapFilledOrderToPosition = (
  response: TradeSocketOrderFilled,
  fallback: {
    accountLogin: number;
    symbol: string;
    side: 'buy' | 'sell';
    volume: number;
    sl: number;
    tp: number;
  },
): endpoints.Position => {
  const fill = response.data as Record<string, unknown>;
  const ticket = toFiniteNumber(
    fill.position_ticket ?? fill.ticket ?? fill.order_ticket,
    0,
  );
  const volume = toFiniteNumber(fill.volume ?? fill.quantity, fallback.volume);
  const openPrice = pickPositiveFiniteNumber(
    fill.price_open,
    fill.open_price,
    fill.openPrice,
    fill.fill_price,
    fill.price,
    fill.chartEntryPrice,
  );
  const backendCurrentPrice = readBackendNumber(fill.price_current ?? fill.current_price ?? fill.currentPrice);
  const backendProfit = readBackendNumber(fill.profit ?? fill.unrealized_pl ?? fill.unrealized_pnl ?? fill.unrealizedPnL);
  const hasBackendCurrentPrice = fill.pnl_available !== false && fill.hasBackendCurrentPrice !== false && backendCurrentPrice !== undefined;
  const hasBackendProfit = fill.pnl_available !== false && fill.hasBackendProfit !== false && backendProfit !== undefined;
  const currentPrice = hasBackendCurrentPrice ? backendCurrentPrice : 0;

  return {
    ...fill,
    ...(ticket > 0 ? { id: String(ticket), ticket } : {}),
    account_login: toFiniteNumber(fill.account_login, fallback.accountLogin),
    symbol: requireSymbol(fill.symbol ?? fallback.symbol),
    side: normalizeSideForApi(fill.side ?? fallback.side),
    quantity: volume,
    volume,
    open_price: openPrice,
    price_open: openPrice,
    current_price: currentPrice,
    price_current: currentPrice,
    hasBackendCurrentPrice,
    hasBackendProfit,
    price_sl: toFiniteNumber(fill.price_sl ?? fill.sl, fallback.sl),
    price_tp: toFiniteNumber(fill.price_tp ?? fill.tp, fallback.tp),
    sl: toFiniteNumber(fill.sl ?? fill.price_sl, fallback.sl),
    tp: toFiniteNumber(fill.tp ?? fill.price_tp, fallback.tp),
    commission: toFiniteNumber(fill.commission, 0),
  } as endpoints.Position;
};

const readOrderPositionTicket = (value: unknown): number => {
  if (!value || typeof value !== 'object') return 0;
  const record = value as Record<string, unknown>;
  return toFiniteNumber(
    record.position_ticket ?? record.position_id ?? record.ticket ?? record.order_ticket ?? record.id,
    0,
  );
};

const readLegacyRestPosition = (response: unknown): endpoints.Position | null => {
  if (!response || typeof response !== 'object') return null;
  const record = response as Record<string, unknown>;
  const data = record.data && typeof record.data === 'object' && !Array.isArray(record.data)
    ? record.data as Record<string, unknown>
    : undefined;
  const status = String(record.status ?? record.state ?? data?.status ?? data?.state ?? '').trim().toLowerCase();
  if (['accepted', 'processing', 'queued', 'executing', 'rejected', 'expired'].includes(status)) return null;
  const candidate = data?.position && typeof data.position === 'object'
    ? data.position
    : record.position && typeof record.position === 'object'
      ? record.position
      : response;
  return readOrderPositionTicket(candidate) > 0 ? candidate as endpoints.Position : null;
};

const mapRestCommandToPosition = (
  command: NormalizedOrderCommand,
  fallback: {
    accountLogin: number;
    symbol: string;
    side: 'buy' | 'sell';
    volume: number;
    sl: number;
    tp: number;
  },
): endpoints.Position => {
  const fill = command.position;
  if (!fill || readOrderPositionTicket(fill) <= 0) {
    throw new Error('Order command reported filled without a position ticket');
  }
  return mapFilledOrderToPosition({
    type: 'order_filled',
    status: 'filled',
    success: true,
    request_id: command.clientOrderId || '',
    client_order_id: command.clientOrderId || '',
    data: fill as TradeSocketOrderFilled['data'],
  }, fallback);
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

type LooseRecord = Record<string, unknown>;

type NormalizedGatewayPosition = LooseRecord & {
  id: number;
  ticket: number;
  symbol: string;
  side: 'BUY' | 'SELL';
  volume: number;
  quantity: number;
  openPrice: number;
  open_price: number;
  currentPrice: number;
  current_price: number;
  opened_at: string;
  sl: number;
  tp: number;
  swap: number;
  commission: number;
  unrealizedPnL: number;
  unrealized_pl: number;
};

type NormalizedGatewayOrder = LooseRecord & {
  id: string;
  ticket: number;
  symbol: string;
  type: string;
  side: 'BUY' | 'SELL';
  volume: number;
  quantity: number;
  price: number;
  sl: number;
  tp: number;
  status: string;
  created_at: unknown;
  createdAt: unknown;
};

type ExportRow = Record<string, unknown>;

const normalizeGatewayPositionForApp = (raw: LooseRecord, index = 0): NormalizedGatewayPosition => {
  const ticket = toFiniteNumber(raw?.ticket ?? raw?.id, index + 1);
  const openPrice = toFiniteNumber(raw?.price_open ?? raw?.open_price ?? raw?.openPrice ?? raw?.price, 0);
  const backendCurrentPrice = readBackendNumber(raw?.price_current ?? raw?.current_price ?? raw?.currentPrice);
  const backendProfit = readBackendNumber(raw?.profit ?? raw?.unrealized_pl ?? raw?.unrealized_pnl ?? raw?.unrealizedPnL);
  const hasBackendCurrentPrice = raw.pnl_available !== false && raw.hasBackendCurrentPrice !== false && backendCurrentPrice !== undefined;
  const hasBackendProfit = raw.pnl_available !== false && raw.hasBackendProfit !== false && backendProfit !== undefined;
  const currentPrice = hasBackendCurrentPrice ? backendCurrentPrice : 0;
  const side = String(raw?.side ?? '').toLowerCase() === 'sell' ? 'SELL' : 'BUY';
  const unrealizedPnL = hasBackendProfit ? backendProfit : 0;

  return {
    ...raw,
    id: ticket,
    ticket,
    symbol: requireSymbol(raw?.symbol),
    side,
    volume: toFiniteNumber(raw?.volume ?? raw?.quantity, 0),
    quantity: toFiniteNumber(raw?.volume ?? raw?.quantity, 0),
    openPrice,
    open_price: openPrice,
    currentPrice,
    current_price: currentPrice,
    hasBackendCurrentPrice,
    hasBackendProfit,
    opened_at: typeof raw?.opened_at === 'string' ? raw.opened_at : timestampToIso(raw?.time_create),
    sl: toFiniteNumber(raw?.price_sl ?? raw?.sl, 0),
    tp: toFiniteNumber(raw?.price_tp ?? raw?.tp, 0),
    swap: toFiniteNumber(raw?.swap, 0),
    commission: toFiniteNumber(raw?.commission, 0),
    unrealizedPnL,
    unrealized_pl: unrealizedPnL,
  };
};

const normalizeGatewayOrderForApp = (raw: LooseRecord, index = 0): NormalizedGatewayOrder => {
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
    const resolvedExplicitServer = explicitServer ? resolveLoginBrokerTarget(explicitServer) : undefined;
    const loginTarget = {
      displayValue: resolvedExplicitServer?.displayValue || explicitBrokerId || storedTarget.displayValue,
      broker_id: explicitBrokerId || resolvedExplicitServer?.broker_id || storedTarget.broker_id || storedBrokerId || getRuntimeConfiguredBrokerId(),
      server: resolvedExplicitServer?.server || storedTarget.server,
    };
    if (!isDesktopBackendTarget()) {
      const deployment = getRuntimeBrokerConfiguration();
      if (!deployment.valid) throw new Error(`Broker configuration error: ${deployment.errors.join('; ')}`);
      if (explicitBrokerId && explicitBrokerId !== deployment.brokerId) {
        throw new Error('The selected broker does not match this deployment.');
      }
      loginTarget.broker_id = deployment.brokerId;
    }
    const targetBroker = normalizeBrokerInfoForTarget({
      broker_id: loginTarget.broker_id,
      broker_name: loginTarget.displayValue,
      server_url: normalizeLoginOption(loginOptions?.baseUrl) || loginTarget.server || loginTarget.displayValue,
    });
    const normalizedUsername = normalizeLoginOption(username);
    const loginBaseUrl = resolveBrokerExtApiUrl(targetBroker);
    const result = await endpoints.authApi.login(
      { username: normalizedUsername, password, ...(loginTarget.broker_id ? { broker_id: loginTarget.broker_id } : {}) },
      loginBaseUrl ? { baseUrl: normalizeBrokerServerUrl(loginBaseUrl) } : undefined
    );
    const accessToken = result.token || result.access_token;
    const resolvedBrokerId = result.broker_id || loginTarget.broker_id;
    const resolvedBrokerServer = result.server_url || result.backend_url || resolveBrokerBackendUrl(targetBroker) || result.broker_server || loginTarget.displayValue;
    if (!isDesktopBackendTarget() && (resolvedBrokerId !== getRuntimeConfiguredBrokerId()
      || !isConfiguredBrokerEndpoint(resolvedBrokerServer, 'http'))) {
      throw new Error('The login response does not belong to the configured deployment broker.');
    }

    if (typeof window !== 'undefined') {
      persistBrokerSessionDiscovery({
        ...result,
        access_token: accessToken,
        broker_id: resolvedBrokerId,
        server_url: resolvedBrokerServer,
        backend_url: result.backend_url || resolvedBrokerServer,
        market_api_url: result.market_api_url || loginBaseUrl,
      });
    }
    // Bind the broker routing before token events can start account transports.
    if (accessToken) {
      useAppStore.getState().setAuthTokens(
        accessToken,
        result.refresh_token,
        result.expires_at ? new Date(result.expires_at).getTime() : undefined
      );
    }

    return { ...result, access_token: accessToken, broker_id: resolvedBrokerId, broker_server: resolvedBrokerServer };
  },

  async refresh(refreshToken: string): Promise<endpoints.LoginResponse> {
    const brokerId = getRuntimeBrokerConfiguration().brokerId;
    const result = await endpoints.authApi.refresh(refreshToken);
    if (!isDesktopBackendTarget() && (getRefreshToken() !== refreshToken
      || getRuntimeBrokerConfiguration().brokerId !== brokerId
      || (result.broker_id && String(result.broker_id) !== brokerId))) {
      throw new Error('The deployment broker session changed during token refresh.');
    }
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
    return unwrapList(response, 'positions')
      .map((position) => normalizeGatewayPositionForApp(position as unknown as LooseRecord)) as unknown as endpoints.Position[];
  },

  async closePosition(positionId: string, options?: ClosePositionRequestOptions): Promise<void> {
    await endpoints.tradingApi.closePosition(positionId, options);
  },

  async modifyPosition(positionId: string | number, data: endpoints.ModifyPositionRequest): Promise<endpoints.Position> {
    const ticket = Number.parseInt(String(positionId), 10);
    if (!Number.isFinite(ticket) || ticket <= 0) throw new Error('Invalid position ticket');
    return endpoints.tradingApi.modifyPosition(ticket, {
      price_sl: data.price_sl,
      price_tp: data.price_tp,
      comment: data.comment,
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
    const positions = unwrapList(response, 'positions')
      .map((position) => normalizeGatewayPositionForApp(position as unknown as LooseRecord));
    const candidates = positions.filter((position) => {
      if (normalizedSymbol && position.symbol !== normalizedSymbol) return false;
      if (type === 'ALL') return true;
      const profit = toFiniteNumber(position.profit ?? position.unrealized_pl ?? position.unrealizedPnL, 0);
      return type === 'WINNERS' ? profit > 0 : profit < 0;
    });

    await Promise.all(candidates.map((position) => endpoints.tradingApi.closePosition(position.id ?? position.ticket)));

    return {
      closed: candidates.length,
      message: `Closed ${candidates.length} ${type.toLowerCase()} position${candidates.length === 1 ? '' : 's'}`,
    };
  },
};

// ============================================
// Orders API
// ============================================

export interface MarketOrderPlacementOptions {
  /** Monotonic timestamp captured at the first instruction of the user action. */
  intentAtMs?: number;
}

let provisionalMarketOrderSequence = 0;

const createProvisionalMarketOrderTicket = (): number => {
  provisionalMarketOrderSequence = (provisionalMarketOrderSequence + 1) % 1000;
  return -((Date.now() * 1000) + provisionalMarketOrderSequence);
};

export const ordersApi = {
  async placeMarketOrder(
    data: endpoints.CreateOrderRequest,
    options: MarketOrderPlacementOptions = {},
  ): Promise<endpoints.Position> {
    const apiStartedAtMs = tradeOrderNow();
    const sessionScope = getCommittedBrokerAccountSessionScopeKey(
      getCommittedBrokerAccountSessionScope(),
    );
    const requestedIntentAtMs = Number(options.intentAtMs);
    const intentAtMs = Number.isFinite(requestedIntentAtMs)
      && requestedIntentAtMs >= 0
      && requestedIntentAtMs <= apiStartedAtMs
      ? requestedIntentAtMs
      : apiStartedAtMs;
    const accountLogin = resolveTradingLogin(data.login ?? data.account_login);
    const symbol = requireSymbol(data.symbol);
    const side = normalizeSideForApi(data.side);
    const volume = requireVolume(data.volume ?? data.quantity);
    const rawSl = data.price_sl !== undefined ? data.price_sl : data.sl;
    const rawTp = data.price_tp !== undefined ? data.price_tp : data.tp;
    // Keep 0 as the app-level "disabled" value for Position mapping. The
    // WebSocket serializer omits that sentinel on the wire because the current
    // /ws/v2 validator rejects an explicitly present zero.
    const sl = normalizeMarketProtection(rawSl, 'SL');
    const tp = normalizeMarketProtection(rawTp, 'TP');
    // Generate exactly once per user action, or preserve a valid key supplied
    // by an upstream retry. WS recovery and REST fallback must use this same
    // durable key so an uncertain transport outcome cannot duplicate an order.
    const suppliedClientOrderId = typeof data.client_order_id === 'string'
      ? data.client_order_id.trim()
      : '';
    if (suppliedClientOrderId && !isTradeOrderUuidV4(suppliedClientOrderId)) {
      throw new Error('client_order_id must be a UUID v4');
    }
    const clientOrderId = suppliedClientOrderId || createTradeOrderUuid();
    const provisionalTicket = createProvisionalMarketOrderTicket();
    let pendingPlacementDispatched = false;
    let terminalTransport: TradeOrderLatencyTransport = 'rest';

    const recordPlacementTerminal = (
      terminalStatus: TradeOrderTerminalStatus,
      error?: { code?: string; message?: string },
    ): void => {
      const terminalAtMs = tradeOrderNow();
      recordTradeOrderLatency({
        phase: 'placement_terminal',
        transport: terminalTransport,
        traceId: toTradeOrderTraceId(clientOrderId),
        clientOrderId,
        sessionScope,
        symbol,
        side,
        volume,
        terminalStatus,
        ...(error?.code ? { errorCode: error.code } : {}),
        ...(error?.message ? { errorMessage: error.message } : {}),
        // This is the user-visible click-to-result duration. If a caller did
        // not provide an intent timestamp, intentAtMs safely equals API entry.
        totalMs: Math.max(0, terminalAtMs - intentAtMs),
      });
    };

    const dispatchPlacementState = (
      status: MarketOrderPlacementState,
      position?: unknown,
      backendError?: { code?: string; message?: string },
    ) => {
      if (typeof window === 'undefined') return;
      window.dispatchEvent(new CustomEvent(MARKET_ORDER_PLACEMENT_STATE_EVENT, {
        detail: {
          status,
          clientOrderId,
          login: accountLogin,
          sessionScope,
          provisionalTicket,
          ...(position !== undefined ? { position } : {}),
          ...(backendError?.code ? { errorCode: backendError.code } : {}),
          ...(backendError?.message ? { errorMessage: backendError.message } : {}),
        },
      }));
    };

    const dispatchPendingPlacement = () => {
      if (pendingPlacementDispatched) return;
      pendingPlacementDispatched = true;
      const appState = useAppStore.getState();
      const tick = resolveTickFromLookup(appState.ticks, appState.tickLookup, symbol);
      const quotedPrice = side === 'buy' ? Number(tick?.ask) : Number(tick?.bid);
      const optimisticPrice = Number.isFinite(quotedPrice) && quotedPrice > 0 ? quotedPrice : 0;
      dispatchPlacementState('pending', {
        id: provisionalTicket,
        ticket: provisionalTicket,
        account_login: accountLogin,
        client_order_id: clientOrderId,
        placement_state: 'pending',
        symbol,
        side,
        volume,
        price_open: optimisticPrice,
        price_current: optimisticPrice,
        price_sl: sl,
        price_tp: tp,
        profit: 0,
        hasBackendProfit: false,
        hasBackendCurrentPrice: false,
        commission: 0,
        swap: 0,
        time_create: new Date().toISOString(),
        time_update: new Date().toISOString(),
      });
    };

    const settleOrderCommand = async (
      initialResponse: unknown,
      submittedAtMs: number,
      pollImmediately = false,
      subscribeTerminal?: PollOrderCommandOptions['subscribeTerminal'],
    ): Promise<endpoints.Position> => {
      let lastVisibleStatus: string | null = null;
      const command = await pollOrderCommandUntilTerminal({
        clientOrderId,
        initialResponse,
        readStatus: (id) => endpoints.tradingApi.getOrderCommand(id),
        startedAtMs: submittedAtMs,
        pollImmediately,
        subscribeTerminal,
        onStatus: (next) => {
          if (
            (next.status === 'accepted' || next.status === 'processing')
            && next.status !== lastVisibleStatus
          ) {
            lastVisibleStatus = next.status;
            dispatchPlacementState(next.status);
          }
        },
        onPollError: (pollError) => {
          console.warn('[Trade] Order command status read failed; retrying until execute_before:', pollError);
        },
      });
      if (command.status !== 'filled') {
        throw new OrderCommandTerminalError(command, clientOrderId);
      }
      return mapRestCommandToPosition(command, {
        accountLogin,
        symbol,
        side,
        volume,
        sl,
        tp,
      });
    };

    const placeViaRest = async (reason: string): Promise<endpoints.Position> => {
      terminalTransport = 'rest';
      // Keep fallback-only allocations off the successful WebSocket path. The
      // durable UUID was created once above and is reused here verbatim, so a
      // transport-uncertain WS attempt still cannot become a duplicate order.
      const traceId = toTradeOrderTraceId(clientOrderId);
      const restOrder: endpoints.CreateOrderRequest = {
        login: accountLogin,
        client_order_id: clientOrderId,
        symbol,
        side,
        type: 'market',
        volume,
        price_sl: rawSl,
        price_tp: rawTp,
        comment: data.comment,
        trailing_stop: data.trailing_stop,
        trailing_step: data.trailing_step,
        magic: data.magic,
      };
      const restStartedAtMs = tradeOrderNow();
      recordTradeOrderLatency({
        phase: 'rest_started',
        transport: 'rest',
        traceId,
        sessionScope,
        symbol,
        reason,
        totalMs: restStartedAtMs - apiStartedAtMs,
      });
      try {
        const submittedAtMs = Date.now();
        const response = await endpoints.tradingApi.placeOrder(restOrder);
        // Separate the HTTP response from any subsequent command polling.
        // Otherwise a slow status-recovery path looks like a slow POST.
        const restRespondedAtMs = tradeOrderNow();
        recordTradeOrderLatency({
          phase: 'rest_response',
          transport: 'rest',
          traceId,
          sessionScope,
          symbol,
          reason,
          restRttMs: restRespondedAtMs - restStartedAtMs,
          totalMs: restRespondedAtMs - apiStartedAtMs,
        });
        const legacyPosition = readLegacyRestPosition(response);
        let terminalPosition: endpoints.Position;
        if (legacyPosition) {
          terminalPosition = legacyPosition;
        } else {
          terminalPosition = await settleOrderCommand(response, submittedAtMs);
        }
        const restCompletedAtMs = tradeOrderNow();
        recordTradeOrderLatency({
          phase: 'rest_completed',
          transport: 'rest',
          traceId,
          sessionScope,
          symbol,
          reason,
          restRttMs: restCompletedAtMs - restStartedAtMs,
          totalMs: restCompletedAtMs - apiStartedAtMs,
        });
        return terminalPosition;
      } catch (error) {
        const restFailedAtMs = tradeOrderNow();
        recordTradeOrderLatency({
          phase: 'rest_failed',
          transport: 'rest',
          traceId,
          sessionScope,
          symbol,
          reason,
          restRttMs: restFailedAtMs - restStartedAtMs,
          totalMs: restFailedAtMs - apiStartedAtMs,
        });
        throw error;
      }
    };

    const tradeSocket = getTradeWebSocketClient();
    const socketIsReady = typeof tradeSocket.isReadyForOrders === 'function'
      ? tradeSocket.isReadyForOrders()
      : typeof tradeSocket.isConnected === 'function' && tradeSocket.isConnected();
    // These fields are deliberately not added to the fixed WS contract. Route
    // enriched orders through REST instead of silently dropping trade intent.
    const hasRestOnlyFields = data.comment !== undefined
      || data.trailing_stop !== undefined
      || data.trailing_step !== undefined
      || data.magic !== undefined;

    let executionPromise: Promise<endpoints.Position>;
    if (socketIsReady && !hasRestOnlyFields) {
      terminalTransport = 'websocket';
      const wsSubmittedAtMs = Date.now();
      executionPromise = tradeSocket.placeOrder({
          account_login: accountLogin,
          symbol,
          side,
          type: 'market',
          volume,
          sl,
          tp,
        }, clientOrderId, { intentAtMs, apiStartedAtMs, sessionScope })
        .then((filled) => mapFilledOrderToPosition(filled, {
          accountLogin,
          symbol,
          side,
          volume,
          sl,
          tp,
        }))
        .catch((error) => {
          const socketError = error && typeof error === 'object'
            ? error as {
                name?: unknown;
                code?: unknown;
                message?: unknown;
                status?: unknown;
                requestId?: unknown;
                orderWasSent?: unknown;
              }
            : undefined;
          if (
            error instanceof TradeSocketOrderRejectedError
            || socketError?.name === 'TradeSocketOrderRejectedError'
          ) {
            throw new OrderCommandTerminalError({
              status: socketError?.status === 'expired' ? 'expired' : 'rejected',
              terminal: true,
              clientOrderId,
              error: {
                code: typeof socketError?.code === 'string' ? socketError.code : undefined,
                message: typeof socketError?.message === 'string' ? socketError.message : undefined,
              },
              raw: error,
            }, clientOrderId);
          }
          if (socketError?.orderWasSent === true) {
            // The create frame may already have executed. Reconcile the same
            // idempotency key via GET for the remainder of the original
            // command window; never submit a second create request.
            const requestId = socketError.requestId;
            // A failed status read does not stop the server's original order
            // watcher. Keep accepting its correlated terminal frame while GET
            // reconciliation runs; whichever arrives first completes the order.
            const subscribeTerminal: PollOrderCommandOptions['subscribeTerminal'] =
              typeof requestId === 'string' && typeof tradeSocket.onMessage === 'function'
                ? (listener) => tradeSocket.onMessage((message) => {
                    const frame = message as Record<string, unknown>;
                    if (frame.request_id !== requestId || frame.client_order_id !== clientOrderId) return;
                    if (isTerminalTradeOrderMessage(message)) listener(frame);
                  })
                : undefined;
            return settleOrderCommand({
              status: 'processing',
              client_order_id: clientOrderId,
            }, wsSubmittedAtMs, true, subscribeTerminal);
          }
          if (!isRetryableTradeSocketFailure(error)) throw error;
          const fallbackCode = error && typeof error === 'object' && 'code' in error
            ? String((error as { code?: unknown }).code || '').trim().toLowerCase()
            : '';
          return placeViaRest(fallbackCode || 'ws_transport_failure');
        });
    } else {
      executionPromise = placeViaRest(hasRestOnlyFields ? 'unsupported_ws_fields' : 'socket_not_ready');
    }

    // Both transports synchronously enqueue their request before returning a
    // Promise. Publish the provisional row only after that enqueue, so instant
    // Toolbox feedback cannot add latency ahead of the actual order frame.
    dispatchPendingPlacement();

    let result: endpoints.Position;
    try {
      result = await executionPromise;
    } catch (error) {
      const errorRecord = error && typeof error === 'object'
        ? error as { code?: unknown; message?: unknown }
        : undefined;
      const terminalStatus: TradeOrderTerminalStatus = error instanceof OrderCommandTerminalError
        ? error.status
        : 'failed';
      const errorCode = error instanceof OrderCommandTerminalError
        ? error.code
        : typeof errorRecord?.code === 'string'
          ? errorRecord.code
          : undefined;
      const errorMessage = error instanceof OrderCommandTerminalError
        ? error.backendMessage || error.message
        : typeof errorRecord?.message === 'string'
          ? errorRecord.message
          : undefined;
      recordPlacementTerminal(terminalStatus, {
        code: errorCode,
        message: errorMessage,
      });
      if (pendingPlacementDispatched) {
        if (error instanceof OrderCommandTerminalError) {
          dispatchPlacementState(error.status, undefined, {
            code: error.code,
            message: error.backendMessage,
          });
        } else {
          dispatchPlacementState('failed');
        }
      }
      throw error;
    }

    recordPlacementTerminal('filled');
    dispatchPlacementState('filled', result);

    if (typeof window !== 'undefined') {
      // Publish the confirmed fill itself so Toolbox can render the new row in
      // the same task instead of waiting for its next WS packet or REST read.
      // Account + broker scope prevent a late fill from leaking into a newly
      // selected session.
      window.dispatchEvent(new CustomEvent('rtx:new-trade-placed', {
        detail: {
          login: accountLogin,
          clientOrderId,
          position: result,
          provisionalTicket,
          sessionScope,
        },
      }));
    }
    return result;
  },

  async placePendingOrder(data: endpoints.PendingOrderRequest): Promise<endpoints.Order> {
    const type = String(data.type || '').trim().toLowerCase();
    if (!['buy_limit', 'sell_limit', 'buy_stop', 'sell_stop', 'buy_stop_limit', 'sell_stop_limit'].includes(type)) {
      throw new Error('Pending order type must be buy_limit, sell_limit, buy_stop, sell_stop, buy_stop_limit, or sell_stop_limit');
    }
    const isStopLimit = type.endsWith('_stop_limit');
    // Backend wire name is `price_limit` (gateway placePendingOrderWireRequest).
    // No fill_policy is sent: the gateway REST decoder has no fill-policy
    // concept (IOC/FOK explicitly refused), so it would be dropped silently.
    const stopLimitPrice = Number((data as { price_limit?: unknown }).price_limit);
    if (isStopLimit && (!Number.isFinite(stopLimitPrice) || stopLimitPrice <= 0)) {
      throw new Error('Stop limit price must be a positive number for stop limit orders');
    }
    const rawPrice = Number(data.price);
    if (!Number.isFinite(rawPrice) || rawPrice <= 0) {
      throw new Error('Price must be greater than zero');
    }
    const expiry = endpoints.normalizePendingExpiryToEpochSeconds(data.expiration ?? data.expiry);
    const comment = typeof data.comment === 'string' && data.comment.trim() ? data.comment : undefined;
    const result = await endpoints.tradingApi.placePendingOrder({
      login: resolveTradingLogin(data.login ?? data.account_login),
      symbol: requireSymbol(data.symbol),
      side: normalizeSideForApi(data.side),
      volume: requireVolume(data.volume),
      type: type as endpoints.PendingOrderRequest['type'],
      price: rawPrice,
      ...(isStopLimit ? { price_limit: stopLimitPrice } : {}),
      price_sl: data.price_sl ?? data.sl,
      price_tp: data.price_tp ?? data.tp,
      ...(expiry !== undefined ? { expiration: expiry } : {}),
      ...(comment !== undefined ? { comment } : {}),
      client_order_id: data.client_order_id,
      magic: data.magic,
    });
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('rtx:new-trade-placed'));
    }
    return result;
  },

  async getPendingOrders(login?: number): Promise<endpoints.Order[]> {
    const response = await endpoints.tradingApi.getPendingOrders(resolveTradingLogin(login));
    return unwrapList(response, 'orders')
      .map((order) => normalizeGatewayOrderForApp(order as unknown as LooseRecord)) as unknown as endpoints.Order[];
  },

  async cancelOrder(orderId: string, clientOrderId?: string): Promise<void> {
    const ticket = Number.parseInt(String(orderId), 10);
    if (!Number.isFinite(ticket) || ticket <= 0) throw new Error('Invalid pending order ticket');
    await endpoints.tradingApi.cancelOrder(ticket, clientOrderId);
  },

  async modifyPendingOrder(orderId: string | number, data: endpoints.ModifyPendingOrderRequest): Promise<endpoints.Order> {
    const ticket = Number.parseInt(String(orderId), 10);
    if (!Number.isFinite(ticket) || ticket <= 0) throw new Error('Invalid pending order ticket');
    return endpoints.tradingApi.modifyPendingOrder(ticket, {
      price: data.price,
      ...(data.price_limit !== undefined ? { price_limit: data.price_limit } : {}),
      ...(data.time_in_force !== undefined ? { time_in_force: data.time_in_force } : {}),
      ...(data.comment !== undefined ? { comment: data.comment } : {}),
      ...(data.state_version !== undefined ? { state_version: data.state_version } : {}),
      price_sl: data.price_sl ?? data.sl,
      price_tp: data.price_tp ?? data.tp,
      expiration: data.expiration !== undefined ? data.expiration : data.expiry,
      expiry: data.expiry !== undefined ? data.expiry : data.expiration,
      client_order_id: data.client_order_id,
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

  async getTicks(symbol: string): Promise<unknown[]> {
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
      return await apiClient.get<BrokerConfig>('/broker/config', {
        baseUrl: API_V2_BASE_URL,
        skipAuth: true,
      });
    } catch (error) {
      // Some deployments do not expose the v2 broker config yet. Fall back to
      // neutral values — the broker's own config document is the only source
      // of broker-specific values (white-label: no code literals here).
      if (error instanceof ApiError && error.status === 404) {
        return { ...normalizeBrokerOperationalConfig(null) };
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

  async getExecutionMode(): Promise<{ mode: string; description: unknown; priceFeed: string }> {
    return apiClient.get<{ mode: string; description: unknown; priceFeed: string }>('/admin/execution-mode');
  },

  async setExecutionMode(mode: string): Promise<unknown> {
    return apiClient.post<unknown>('/admin/execution-mode', { mode });
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

const requireExportLogin = (accountId: string): number => {
  const parsed = Number.parseInt(String(accountId || ''), 10);
  if (!Number.isFinite(parsed) || parsed <= 0) throw new Error('Missing account login for export request');
  return parsed;
};

const unwrapExportRows = <T,>(payload: T[] | Record<string, unknown>, key: string): T[] => {
  if (Array.isArray(payload)) return payload;
  const rows = (payload as Record<string, unknown>)?.[key];
  return Array.isArray(rows) ? rows as T[] : [];
};

const rowTimeMs = (row: ExportRow): number => {
  const raw = row.time_ms ?? row.time ?? row.created_at ?? row.createdAt ?? row.openTime ?? row.closeTime;
  if (!raw) return 0;
  if (typeof raw === 'string' && Number.isNaN(Number(raw))) return Date.parse(raw);
  const numeric = Number(raw);
  if (!Number.isFinite(numeric)) return 0;
  return numeric > 1_000_000_000_000 ? numeric : numeric * 1000;
};

const filterExportRowsByDate = <T extends ExportRow>(rows: T[], startDate: string, endDate: string): T[] => {
  const from = startDate ? Date.parse(startDate) : 0;
  const to = endDate ? Date.parse(endDate) : 0;
  if (!Number.isFinite(from) && !Number.isFinite(to)) return rows;

  return rows.filter((row) => {
    const time = rowTimeMs(row);
    if (!time) return true;
    if (Number.isFinite(from) && from > 0 && time < from) return false;
    if (Number.isFinite(to) && to > 0 && time > to + 24 * 60 * 60 * 1000 - 1) return false;
    return true;
  });
};

const csvEscape = (value: unknown): string => {
  const text = value == null ? '' : String(value);
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
};

const rowsToCsv = (rows: ExportRow[]): string => {
  const columnSet = new Set<string>();
  rows.forEach((row) => {
    Object.keys(row || {}).forEach((key) => columnSet.add(key));
  });
  const columns = Array.from(columnSet);
  if (columns.length === 0) return '';
  return [
    columns.map(csvEscape).join(','),
    ...rows.map((row) => columns.map((column) => csvEscape(row?.[column])).join(',')),
  ].join('\n');
};

export const analyticsApi = {
  async exportPDF(accountId: string, startDate: string, endDate: string): Promise<Blob> {
    void accountId;
    void startDate;
    void endDate;
    throw new Error('PDF export is unavailable because this broker backend does not expose a PDF export endpoint');
  },

  async exportCSV(accountId: string, startDate: string, endDate: string, dataType: string): Promise<string> {
    const login = requireExportLogin(accountId);
    const normalizedType = String(dataType || '').trim().toLowerCase();
    let rows: ExportRow[];

    if (normalizedType === 'positions') {
      const data = await endpoints.tradingApi.getPositions(login, { limit: 500, offset: 0 });
      rows = unwrapExportRows<ExportRow>(data as ExportRow[] | Record<string, unknown>, 'positions');
    } else if (normalizedType === 'trades') {
      const data = await apiClient.get<ExportRow[] | { deals?: ExportRow[] }>(`/deals/${login}`, {
        baseUrl: API_V2_BASE_URL,
        params: { limit: 500, offset: 0 },
      });
      rows = unwrapExportRows<ExportRow>(data, 'deals');
    } else {
      throw new Error('Performance export is unavailable because this broker backend does not expose a performance export endpoint');
    }

    return rowsToCsv(filterExportRowsByDate(rows, startDate, endDate));
  },

  async getPerformanceReport(accountId: string, startDate: string, endDate: string): Promise<never> {
    void accountId;
    void startDate;
    void endDate;
    throw new Error('Performance export is unavailable because this broker backend does not expose a performance export endpoint');
  },
};

// ============================================
// Workspace API
// ============================================

export interface WorkspaceConfig {
  charts: unknown[];
  layout: unknown;
  marketWatch: unknown;
  orderPanel: unknown;
  version: string;
}

export interface Workspace {
  id?: string;
  name: string;
  description?: string;
  userId: string;
  accountId?: string;
  charts: unknown;
  layout: unknown;
  marketWatch: unknown;
  orderPanel: unknown;
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
    return apiClient.post<SaveWorkspaceResponse>('/workspaces', { workspace, overwrite });
  },

  async loadWorkspace(workspaceId: string): Promise<{ success: boolean; workspace?: Workspace; message?: string }> {
    return apiClient.get<{ success: boolean; workspace?: Workspace; message?: string }>(`/workspaces/${workspaceId}`);
  },

  async listWorkspaces(userId: string, accountId?: string): Promise<{ success: boolean; workspaces: unknown[]; message?: string }> {
    return apiClient.get<{ success: boolean; workspaces: unknown[]; message?: string }>('/workspaces', {
      params: { userId, accountId }
    });
  },

  async deleteWorkspace(workspaceId: string): Promise<{ success: boolean; message?: string }> {
    return apiClient.delete<{ success: boolean; message?: string }>(`/workspaces/${workspaceId}`);
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
  id?: number | string;
  latency_ms?: number;
  client_order_id?: number | string;
  request_id?: number | string;
  order_ticket?: number | string;
  position_ticket?: number | string;
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
}

export interface JournalResponse {
  count: number;
  logs: JournalLogEntry[];
}

export interface JournalRequestOptions {
  signal?: AbortSignal;
}

const isJournalRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value && typeof value === 'object' && !Array.isArray(value));

const normalizeJournalNumber = (value: unknown): number => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

const normalizeJournalText = (value: unknown): string =>
  value === undefined || value === null ? '' : String(value);

const normalizeOptionalJournalLatency = (value: unknown): number | undefined => {
  if (typeof value !== 'number' && typeof value !== 'string') return undefined;
  if (typeof value === 'string' && value.trim() === '') return undefined;

  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : undefined;
};

const normalizeOptionalJournalIdentifier = (value: unknown): number | string | undefined => {
  if (typeof value === 'string') return value;
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
};

type NormalizedTradeJournalTiming = {
  latencyMs: number;
  message: string;
};

const journalDurationToMilliseconds = (value: string, unit: string): number => {
  const duration = Number(value);
  switch (unit.toLowerCase()) {
    case 'ns': return duration / 1_000_000;
    case 'µs':
    case 'μs':
    case 'us': return duration / 1_000;
    case 's': return duration * 1_000;
    default: return duration;
  }
};

const normalizeTradeJournalTiming = (
  typeText: string,
  source: string,
  message: string,
): NormalizedTradeJournalTiming | null => {
  if (typeText.trim().toLowerCase() !== 'trade' || source.trim().toLowerCase() !== 'gateway') {
    return null;
  }

  // Compatibility for the deployed Gateway journal. Match only the known
  // terminal trade formats so unrelated durations (for example quote age in a
  // QUOTE_STALE rejection) can never be mislabeled as order latency.
  const timedTerminal = message.match(
    /^(Order\s+(?:(?:buy|sell)\s+\S+\s+\S+\s+(?:filled|executed|completed|succeeded)|close\s+\S+\s+\S+\s+\S+\s+(?:filled|executed|completed|succeeded))|Position\s+(?:.*?\s+)?opened|Close\s+(?:buy|sell)\s+\S+\s+ticket\s+\S+\s+profit\s+\S+|Modify\s+\S+\s+ticket\s+\S+)\s+in\s+(\d+(?:\.\d+)?)(ns|[µμu]s|ms|s)$/i,
  );
  if (timedTerminal) {
    return {
      message: timedTerminal[1],
      latencyMs: journalDurationToMilliseconds(timedTerminal[2], timedTerminal[3]),
    };
  }

  const timingDetail = message.match(
    /^(Timing\s+(?:(?:buy|sell)\s+\S+\s+\S+|close\s+\S+\s+\S+\s+\S+)):\s+.*\btotal\s+(\d+(?:\.\d+)?)(ns|[µμu]s|ms|s)$/i,
  );
  if (timingDetail) {
    return {
      message: timingDetail[1],
      latencyMs: journalDurationToMilliseconds(timingDetail[2], timingDetail[3]),
    };
  }

  return null;
};

export const normalizeJournalResponse = (rawPayload: unknown): JournalResponse => {
  // Accept both the bare `{ count, logs }` body and a v2 `{ data: { count, logs } }` envelope.
  const payload = isJournalRecord(rawPayload) && !Array.isArray(rawPayload.logs) && isJournalRecord(rawPayload.data)
    ? rawPayload.data
    : rawPayload;
  if (!isJournalRecord(payload) || !Array.isArray(payload.logs)) {
    throw new Error('Invalid Journal API response');
  }

  const logs = payload.logs
    .filter(isJournalRecord)
    .map((log): JournalLogEntry => {
      const id = normalizeOptionalJournalIdentifier(log.id);
      const typeText = normalizeJournalText(log.type_text);
      const source = normalizeJournalText(log.source);
      const message = normalizeJournalText(log.message);
      const compatibleTiming = normalizeTradeJournalTiming(typeText, source, message);
      const latencyMs = normalizeOptionalJournalLatency(log.latency_ms)
        ?? compatibleTiming?.latencyMs;
      const clientOrderId = normalizeOptionalJournalIdentifier(log.client_order_id);
      const requestId = normalizeOptionalJournalIdentifier(log.request_id);
      const orderTicket = normalizeOptionalJournalIdentifier(log.order_ticket);
      const positionTicket = normalizeOptionalJournalIdentifier(log.position_ticket);

      return {
        ...(id !== undefined ? { id } : {}),
        ...(latencyMs !== undefined ? { latency_ms: latencyMs } : {}),
        ...(clientOrderId !== undefined ? { client_order_id: clientOrderId } : {}),
        ...(requestId !== undefined ? { request_id: requestId } : {}),
        ...(orderTicket !== undefined ? { order_ticket: orderTicket } : {}),
        ...(positionTicket !== undefined ? { position_ticket: positionTicket } : {}),
        code: normalizeJournalNumber(log.code),
        code_text: normalizeJournalText(log.code_text),
        type: normalizeJournalNumber(log.type),
        type_text: typeText,
        datetime: normalizeJournalNumber(log.datetime),
        source,
        message: compatibleTiming?.message ?? message,
      };
    });
  const count = Number(payload.count);

  return {
    count: Number.isFinite(count) ? count : logs.length,
    logs,
  };
};

let journalSessionGeneration = 0;
let lastJournalAccessToken: string | null = null;
let lastJournalRefreshToken: string | null = null;
let lastJournalScopeKey = '';

const getStoredJournalRefreshToken = (): string | null => {
  return getRefreshToken();
};

const getJournalRequestContext = (
  apiRootBaseUrl: string,
  accessToken: string | null,
): ApiRequestContext | undefined => {
  if (!accessToken) return undefined;

  const refreshToken = getStoredJournalRefreshToken();
  if (!refreshToken) return undefined;

  const scopeKey = getCommittedBrokerAccountSessionScopeKey(
    getCommittedBrokerAccountSessionScope(),
  );
  if (
    accessToken !== lastJournalAccessToken
    || refreshToken !== lastJournalRefreshToken
    || scopeKey !== lastJournalScopeKey
  ) {
    journalSessionGeneration += 1;
    lastJournalAccessToken = accessToken;
    lastJournalRefreshToken = refreshToken;
    lastJournalScopeKey = scopeKey;
  }

  return Object.freeze({
    key: `journal:${journalSessionGeneration}:${scopeKey}`,
    backendOrigin: apiRootBaseUrl,
    refreshEndpoint: `${API_V2_BASE_URL.replace(/\/$/, '')}/auth/refresh`,
    refreshToken,
  });
};

export const journalApi = {
  async getLogs(
    params: JournalQuery = {},
    options: JournalRequestOptions = {},
  ): Promise<JournalResponse> {
    const apiRootBaseUrl = API_V2_BASE_URL.replace(/\/api\/v2\/?$/, '');
    const accessToken = getAuthToken();
    const payload = await apiClient.get<unknown>('/api/v2/journal', {
      ...(apiRootBaseUrl ? { baseUrl: apiRootBaseUrl, skipDynamicUrl: true } : {}),
      authToken: accessToken,
      requestContext: getJournalRequestContext(apiRootBaseUrl, accessToken),
      signal: options.signal,
      params: {
        mode: params.mode ?? 2,
        type: params.type ?? 0,
      },
      headers: {
        accept: 'application/json',
      },
    });
    return normalizeJournalResponse(payload);
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
