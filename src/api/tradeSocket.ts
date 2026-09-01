import { RTX5_WS_URL, buildApiV2WsUrl } from '../config/api';
import {
  getCommittedBrokerAccountSessionScope,
  getCommittedBrokerAccountSessionScopeKey,
  onSessionChange,
} from '../services/brokerSession';
import {
  recordTradeOrderLatency,
  toTradeOrderTraceId,
  tradeOrderNow,
  type TradeOrderLatencyPhase,
} from '../services/orderLatencyTelemetry';
import type { Timeframe, TradeSocketChannel, TradeSocketMessage } from '../types/api';
import { getAuthToken } from './client';

export type TradeSocketState = 'idle' | 'connecting' | 'open' | 'closed' | 'error';
export type TradeSocketHandler<T = unknown> = (message: TradeSocketMessage<T>) => void;

export interface TradeSocketOptions {
  url?: string;
  token?: string;
  reconnect?: boolean;
  reconnectDelayMs?: number;
  maxReconnectDelayMs?: number;
  orderTimeoutMs?: number;
  maxOrderBufferedAmount?: number;
}

export interface TradeSocketPlaceOrderPayload {
  account_login: number;
  symbol: string;
  side: 'buy' | 'sell';
  type?: 'market';
  volume: number;
  sl?: number;
  tp?: number;
}

export interface TradeSocketOrderFillData {
  order_ticket?: number;
  position_ticket?: number;
  symbol: string;
  side: 'buy' | 'sell';
  volume: number;
  price: number;
  commission?: number;
  status?: string;
  [key: string]: unknown;
}

export interface TradeSocketOrderFilled {
  type: 'order_filled';
  status: 'filled';
  success: true;
  ack_required?: boolean;
  request_id: string;
  client_order_id: string;
  data: TradeSocketOrderFillData;
  [key: string]: unknown;
}

interface PendingOrderRequest {
  resolve: (message: TradeSocketOrderFilled) => void;
  reject: (error: Error) => void;
  clientOrderId: string;
  sessionScope: string;
  accountLogin: number;
  symbol: string;
  timer: ReturnType<typeof setTimeout> | null;
  recoveryAttempted: boolean;
  intentAtMs: number;
  apiStartedAtMs: number;
  sendCompletedAtMs: number;
  acceptedAtMs: number | null;
  statusRecoverySentAtMs: number | null;
  serializationMs: number;
  sendCallMs: number;
  payloadBytes: number;
  bufferedAmountBefore: number;
  bufferedAmountAfter: number;
}

export interface TradeSocketOrderTimingContext {
  intentAtMs?: number;
  apiStartedAtMs?: number;
  sessionScope?: string;
}

interface TradeSocketErrorDetails {
  code?: string;
  requestId?: string;
  clientOrderId?: string;
  orderWasSent?: boolean;
}

export class TradeSocketOrderRejectedError extends Error {
  readonly code?: string;
  readonly requestId?: string;
  readonly clientOrderId?: string;
  readonly retryable = false;

  constructor(message: string, details: TradeSocketErrorDetails = {}) {
    super(message);
    this.name = 'TradeSocketOrderRejectedError';
    this.code = details.code;
    this.requestId = details.requestId;
    this.clientOrderId = details.clientOrderId;
  }
}

export class TradeSocketTransportError extends Error {
  readonly code?: string;
  readonly requestId?: string;
  readonly clientOrderId?: string;
  readonly orderWasSent: boolean;
  readonly retryable: boolean;

  constructor(message: string, details: TradeSocketErrorDetails = {}) {
    super(message);
    this.name = 'TradeSocketTransportError';
    this.code = details.code;
    this.requestId = details.requestId;
    this.clientOrderId = details.clientOrderId;
    this.orderWasSent = details.orderWasSent === true;
    // A create request is safe to move to REST only when the WebSocket frame
    // was definitely never enqueued. Once send() succeeds, an error or timeout
    // means execution is uncertain and creating again could duplicate a trade.
    this.retryable = !this.orderWasSent;
  }
}

const DEFAULT_RECONNECT_DELAY = 1_000;
const DEFAULT_MAX_RECONNECT_DELAY = 15_000;
const DEFAULT_ORDER_TIMEOUT = 10_000;
// The order socket is dedicated and normally has no queued bytes. If it is
// already carrying 16 KiB, REST with the same idempotency key is safer than
// hiding an order behind an unhealthy browser/network queue.
const DEFAULT_MAX_ORDER_BUFFERED_AMOUNT = 16 * 1024;
const WS_CONNECTING = 0;
const WS_OPEN = 1;

const RETRYABLE_ORDER_ERROR_CODES = new Set([
  'SERVICE_UNAVAILABLE',
  'BROKER_UNAVAILABLE',
  'EXECUTION_SERVICE_UNAVAILABLE',
  'GATEWAY_TIMEOUT',
  'REQUEST_TIMEOUT',
  'TRANSPORT_ERROR',
  'CONNECTION_ERROR',
]);

const asRecord = (value: unknown): Record<string, unknown> | undefined =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;

const readNonEmptyString = (value: unknown): string | undefined => {
  const normalized = typeof value === 'string' ? value.trim() : '';
  return normalized || undefined;
};

const readCorrelationId = (value: unknown): string | undefined =>
  typeof value === 'string' && value.trim() ? value : undefined;

const utf8Encoder = typeof TextEncoder !== 'undefined' ? new TextEncoder() : null;

const getUtf8ByteLength = (value: string): number => (
  utf8Encoder ? utf8Encoder.encode(value).byteLength : value.length
);

const readBufferedAmount = (socket: WebSocket | null): number => {
  const amount = Number(socket?.bufferedAmount ?? 0);
  return Number.isFinite(amount) && amount > 0 ? amount : 0;
};

const normalizeEarlierMonotonicTime = (value: unknown, fallback: number): number => {
  const candidate = Number(value);
  return Number.isFinite(candidate) && candidate >= 0 && candidate <= fallback
    ? candidate
    : fallback;
};

const createUuidV4Fallback = (): string => {
  const bytes = new Uint8Array(16);
  if (typeof globalThis.crypto?.getRandomValues === 'function') {
    globalThis.crypto.getRandomValues(bytes);
  } else {
    for (let index = 0; index < bytes.length; index += 1) {
      bytes[index] = Math.floor(Math.random() * 256);
    }
  }

  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
};

export const createTradeOrderUuid = (): string => {
  if (typeof globalThis.crypto?.randomUUID === 'function') {
    return globalThis.crypto.randomUUID();
  }
  return createUuidV4Fallback();
};

const UUID_V4_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export const isTradeOrderUuidV4 = (value: unknown): value is string =>
  typeof value === 'string' && UUID_V4_PATTERN.test(value.trim());

const isRetryableOrderErrorCode = (value: unknown): boolean => {
  const code = String(value ?? '').trim().toUpperCase();
  return RETRYABLE_ORDER_ERROR_CODES.has(code) || code === '503';
};

const readOrderError = (message: TradeSocketMessage): { code?: string; message: string } => {
  const record = message as Record<string, unknown>;
  const error = asRecord(record.error);
  const code = readNonEmptyString(error?.code ?? record.code);
  const detail = readNonEmptyString(error?.message)
    ?? readNonEmptyString(record.message)
    ?? readNonEmptyString(record.error)
    ?? 'Order rejected';
  return { code, message: detail };
};

export class TradeWebSocketClient {
  private ws: WebSocket | null = null;
  private state: TradeSocketState = 'idle';
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectAttempts = 0;
  private activeToken: string | undefined;
  private activeUrl: string | undefined;
  private authFrameSent = false;
  private readonly channels = new Set<string>();
  private readonly handlers = new Map<string, Set<TradeSocketHandler>>();
  private readonly anyHandlers = new Set<TradeSocketHandler>();
  private readonly stateHandlers = new Set<(state: TradeSocketState) => void>();
  private readonly pendingOrders = new Map<string, PendingOrderRequest>();
  private readonly options: Required<Pick<
    TradeSocketOptions,
    'reconnect' | 'reconnectDelayMs' | 'maxReconnectDelayMs' | 'orderTimeoutMs' | 'maxOrderBufferedAmount'
  >> & TradeSocketOptions;

  constructor(options: TradeSocketOptions = {}) {
    this.options = {
      reconnect: true,
      reconnectDelayMs: DEFAULT_RECONNECT_DELAY,
      maxReconnectDelayMs: DEFAULT_MAX_RECONNECT_DELAY,
      orderTimeoutMs: DEFAULT_ORDER_TIMEOUT,
      maxOrderBufferedAmount: DEFAULT_MAX_ORDER_BUFFERED_AMOUNT,
      ...options,
    };
  }

  get readyState(): number | undefined {
    return this.ws?.readyState;
  }

  get connectionState(): TradeSocketState {
    return this.state;
  }

  isConnected(): boolean {
    return this.isReadyForOrders();
  }

  isReadyForOrders(): boolean {
    return this.ws?.readyState === WS_OPEN
      && this.state === 'open'
      && Boolean(this.activeToken)
      && this.authFrameSent;
  }

  usesConnection(token: string, url: string): boolean {
    return this.activeToken === token && this.activeUrl === url;
  }

  connect(token = this.options.token || getAuthToken() || undefined): void {
    if (this.ws && (this.ws.readyState === WS_CONNECTING || this.ws.readyState === WS_OPEN)) {
      return;
    }

    this.clearReconnectTimer();
    this.activeToken = token;
    this.authFrameSent = false;
    this.setState('connecting');
    const url = this.options.url || (token ? buildApiV2WsUrl(token) : RTX5_WS_URL);
    this.activeUrl = url;

    let socket: WebSocket;
    try {
      socket = new WebSocket(url);
    } catch {
      this.setState('error');
      this.scheduleReconnect();
      return;
    }
    this.ws = socket;

    socket.onopen = () => {
      if (this.ws !== socket) return;
      this.reconnectAttempts = 0;

      if (token) {
        this.authFrameSent = this.send({ action: 'auth', token });
        if (!this.authFrameSent) {
          this.setState('error');
          if (typeof socket.close === 'function') socket.close();
          return;
        }
      }

      this.setState('open');
      this.channels.forEach(channel => this.send({ action: 'subscribe', channel, channels: [channel] }));
    };

    socket.onmessage = event => {
      if (this.ws !== socket) return;
      const message = this.parseMessage(event.data);
      this.routePendingOrderMessage(message);
      this.dispatch(message);
    };

    socket.onerror = () => {
      if (this.ws !== socket) return;
      this.setState('error');
      if (typeof socket.close === 'function') socket.close();
    };

    socket.onclose = () => {
      if (this.ws !== socket) return;
      this.ws = null;
      this.authFrameSent = false;
      this.setState('closed');
      this.rejectAllPendingOrders('Trade socket closed before the order completed');
      this.scheduleReconnect();
    };
  }

  disconnect(): void {
    this.clearReconnectTimer();
    this.options.reconnect = false;
    this.rejectAllPendingOrders('Trade socket disconnected before the order completed');
    const socket = this.ws;
    this.ws = null;
    this.authFrameSent = false;
    if (socket && typeof socket.close === 'function') socket.close();
    this.setState('closed');
  }

  subscribe<T = unknown>(channel: TradeSocketChannel | string, handler?: TradeSocketHandler<T>): () => void {
    const key = String(channel);
    this.channels.add(key);

    if (handler) {
      this.addHandler(key, handler as TradeSocketHandler);
    }

    if (this.ws?.readyState === WS_OPEN) {
      this.send({ action: 'subscribe', channel: key, channels: [key] });
    }

    return () => this.unsubscribe(key, handler as TradeSocketHandler | undefined);
  }

  unsubscribe(channel: TradeSocketChannel | string, handler?: TradeSocketHandler): void {
    const key = String(channel);

    if (handler) {
      const handlers = this.handlers.get(key);
      handlers?.delete(handler);
      if (handlers?.size) return;
    }

    this.handlers.delete(key);
    this.channels.delete(key);

    if (this.ws?.readyState === WS_OPEN) {
      this.send({ action: 'unsubscribe', channel: key, channels: [key] });
    }
  }

  onMessage(handler: TradeSocketHandler): () => void {
    this.anyHandlers.add(handler);
    return () => this.anyHandlers.delete(handler);
  }

  onStateChange(handler: (state: TradeSocketState) => void): () => void {
    this.stateHandlers.add(handler);
    handler(this.state);
    return () => this.stateHandlers.delete(handler);
  }

  send(message: TradeSocketMessage): boolean {
    if (this.ws?.readyState !== WS_OPEN) return false;

    try {
      this.ws.send(JSON.stringify(message));
      return true;
    } catch {
      return false;
    }
  }

  placeOrder(
    payload: TradeSocketPlaceOrderPayload,
    clientOrderId = createTradeOrderUuid(),
    timing: TradeSocketOrderTimingContext = {},
  ): Promise<TradeSocketOrderFilled> {
    const localStartedAtMs = tradeOrderNow();
    const intentAtMs = normalizeEarlierMonotonicTime(timing.intentAtMs, localStartedAtMs);
    const apiStartedAtMs = normalizeEarlierMonotonicTime(timing.apiStartedAtMs, localStartedAtMs);
    const requestedSessionScope = typeof timing.sessionScope === 'string'
      ? timing.sessionScope.trim()
      : '';
    const sessionScope = requestedSessionScope
      ? requestedSessionScope
      : getCommittedBrokerAccountSessionScopeKey(getCommittedBrokerAccountSessionScope());
    const accountLogin = Number(payload.account_login);
    const volume = Number(payload.volume);
    const sl = payload.sl === undefined ? 0 : payload.sl;
    const tp = payload.tp === undefined ? 0 : payload.tp;
    const symbol = String(payload.symbol || '').trim().toUpperCase();
    const side = String(payload.side || '').trim().toLowerCase();
    const normalizedClientOrderId = String(clientOrderId || '').trim() || createTradeOrderUuid();
    const requestId = createTradeOrderUuid();

    if (!Number.isFinite(accountLogin) || accountLogin <= 0) {
      return Promise.reject(new Error('Missing account login for WebSocket order'));
    }
    if (!isTradeOrderUuidV4(normalizedClientOrderId)) {
      return Promise.reject(new Error('client_order_id must be a UUID v4'));
    }
    if (!symbol) return Promise.reject(new Error('Missing symbol for WebSocket order'));
    if (side !== 'buy' && side !== 'sell') {
      return Promise.reject(new Error('Side must be buy or sell'));
    }
    if (!Number.isFinite(volume) || volume <= 0) {
      return Promise.reject(new Error('Volume must be greater than zero'));
    }
    if (!Number.isFinite(sl) || sl < 0) {
      return Promise.reject(new Error('SL must be zero (disabled) or a positive finite number'));
    }
    if (!Number.isFinite(tp) || tp < 0) {
      return Promise.reject(new Error('TP must be zero (disabled) or a positive finite number'));
    }
    if (!this.isReadyForOrders()) {
      recordTradeOrderLatency({
        phase: 'ws_transport_error',
        transport: 'websocket',
        traceId: toTradeOrderTraceId(normalizedClientOrderId),
        sessionScope,
        symbol,
        reason: 'socket_not_ready',
        totalMs: tradeOrderNow() - apiStartedAtMs,
      });
      return Promise.reject(new TradeSocketTransportError('Trade socket is not authenticated and open', {
        code: 'WS_NOT_READY',
        requestId,
        clientOrderId: normalizedClientOrderId,
      }));
    }

    // Runtime compatibility for no-protection market orders:
    // the documented WS contract uses 0 as the "disabled" sentinel, but the
    // currently deployed /ws/v2 validator rejects a present zero as non-positive.
    // Omitting only inactive fields matches the already-working REST semantics;
    // real positive SL/TP values are still sent exactly and never fabricated.
    const orderMessage: TradeSocketMessage = {
      action: 'place_order',
      request_id: requestId,
      client_order_id: normalizedClientOrderId,
      account_login: accountLogin,
      symbol,
      side,
      type: 'market',
      volume,
    };
    // Assign optional protection fields without conditional object spreads.
    // This keeps the common no-SL/TP frame allocation-minimal while preserving
    // the deployed-validator compatibility behavior documented above.
    if (sl > 0) orderMessage.sl = sl;
    if (tp > 0) orderMessage.tp = tp;
    const serializationStartedAtMs = tradeOrderNow();
    const serializedOrder = JSON.stringify(orderMessage);
    const serializationMs = tradeOrderNow() - serializationStartedAtMs;
    const socket = this.ws;
    const bufferedAmountBefore = readBufferedAmount(socket);

    if (!socket || socket.readyState !== WS_OPEN || this.ws !== socket) {
      recordTradeOrderLatency({
        phase: 'ws_transport_error',
        transport: 'websocket',
        traceId: toTradeOrderTraceId(normalizedClientOrderId),
        sessionScope,
        symbol,
        reason: 'socket_changed_before_send',
        serializationMs,
        totalMs: tradeOrderNow() - apiStartedAtMs,
        bufferedAmountBefore,
      });
      return Promise.reject(new TradeSocketTransportError('Trade socket changed before the order could be sent', {
        code: 'WS_NOT_READY',
        requestId,
        clientOrderId: normalizedClientOrderId,
      }));
    }

    if (bufferedAmountBefore > this.options.maxOrderBufferedAmount) {
      recordTradeOrderLatency({
        phase: 'ws_transport_error',
        transport: 'websocket',
        traceId: toTradeOrderTraceId(normalizedClientOrderId),
        sessionScope,
        symbol,
        reason: 'socket_backpressure',
        serializationMs,
        totalMs: tradeOrderNow() - apiStartedAtMs,
        bufferedAmountBefore,
      });
      return Promise.reject(new TradeSocketTransportError('Trade socket is backpressured; using the idempotent fallback', {
        code: 'WS_BACKPRESSURE',
        requestId,
        clientOrderId: normalizedClientOrderId,
      }));
    }

    return new Promise<TradeSocketOrderFilled>((resolve, reject) => {
      const pending: PendingOrderRequest = {
        resolve,
        reject,
        clientOrderId: normalizedClientOrderId,
        sessionScope,
        accountLogin,
        symbol,
        timer: null,
        recoveryAttempted: false,
        intentAtMs,
        apiStartedAtMs,
        sendCompletedAtMs: 0,
        acceptedAtMs: null,
        statusRecoverySentAtMs: null,
        serializationMs,
        sendCallMs: 0,
        payloadBytes: 0,
        bufferedAmountBefore,
        bufferedAmountAfter: bufferedAmountBefore,
      };
      this.pendingOrders.set(requestId, pending);

      // Nothing except strict validation/serialization runs between API entry
      // and this call. Timer setup and diagnostics happen only after enqueue.
      const sendStartedAtMs = tradeOrderNow();
      try {
        socket.send(serializedOrder);
      } catch {
        recordTradeOrderLatency({
          phase: 'ws_transport_error',
          transport: 'websocket',
          traceId: toTradeOrderTraceId(normalizedClientOrderId),
          sessionScope,
          symbol,
          reason: 'send_failed',
          serializationMs,
          sendCallMs: tradeOrderNow() - sendStartedAtMs,
          totalMs: tradeOrderNow() - apiStartedAtMs,
          bufferedAmountBefore,
          bufferedAmountAfter: readBufferedAmount(socket),
        });
        this.rejectPendingOrder(requestId, new TradeSocketTransportError('Failed to send the order over the trade socket', {
          code: 'WS_SEND_FAILED',
          requestId,
          clientOrderId: normalizedClientOrderId,
        }));
        return;
      }

      const sendCompletedAtMs = tradeOrderNow();
      pending.sendCompletedAtMs = sendCompletedAtMs;
      pending.sendCallMs = sendCompletedAtMs - sendStartedAtMs;
      pending.payloadBytes = getUtf8ByteLength(serializedOrder);
      pending.bufferedAmountAfter = readBufferedAmount(socket);

      recordTradeOrderLatency({
        phase: 'ws_enqueued',
        transport: 'websocket',
        // Trace formatting is diagnostics-only, so do it after send() returns.
        traceId: toTradeOrderTraceId(normalizedClientOrderId),
        sessionScope,
        symbol,
        payloadBytes: pending.payloadBytes,
        serializationMs,
        sendCallMs: pending.sendCallMs,
        intentToEnqueueMs: sendCompletedAtMs - intentAtMs,
        apiToEnqueueMs: sendCompletedAtMs - apiStartedAtMs,
        totalMs: sendCompletedAtMs - apiStartedAtMs,
        bufferedAmountBefore,
        bufferedAmountAfter: pending.bufferedAmountAfter,
      });
      this.armPendingOrderTimer(requestId, pending);
    });
  }

  getOrderStatus(clientOrderId: string, accountLogin: number, requestId = createTradeOrderUuid()): string {
    const normalizedClientOrderId = String(clientOrderId || '').trim();
    const normalizedAccountLogin = Number(accountLogin);
    if (!normalizedClientOrderId) throw new Error('Missing client_order_id for order status');
    if (!Number.isFinite(normalizedAccountLogin) || normalizedAccountLogin <= 0) {
      throw new Error('Missing account login for order status');
    }
    if (!this.isReadyForOrders() || !this.send({
      action: 'get_order_status',
      request_id: requestId,
      client_order_id: normalizedClientOrderId,
      account_login: normalizedAccountLogin,
    })) {
      throw new TradeSocketTransportError('Failed to request order status over the trade socket', {
        requestId,
        clientOrderId: normalizedClientOrderId,
      });
    }
    return requestId;
  }

  subscribeTicks(symbol: string, handler?: TradeSocketHandler) {
    return this.subscribe(`ticks.${symbol}`, handler);
  }

  subscribeAllTicks(handler?: TradeSocketHandler) {
    return this.subscribe('ticks.all', handler);
  }

  subscribeCandles(symbol: string, timeframe: Timeframe | string, handler?: TradeSocketHandler) {
    return this.subscribe(`candles.${symbol}.${timeframe}`, handler);
  }

  subscribeDepth(symbol: string, handler?: TradeSocketHandler) {
    return this.subscribe(`depth.${symbol}`, handler);
  }

  subscribePositions(login: number | string, handler?: TradeSocketHandler) {
    return this.subscribe(`positions.${login}`, handler);
  }

  subscribeAccount(login: number | string, handler?: TradeSocketHandler) {
    return this.subscribe(`account.${login}`, handler);
  }

  subscribeOrders(login: number | string, handler?: TradeSocketHandler) {
    return this.subscribe(`orders.${login}`, handler);
  }

  subscribeDeals(login: number | string, handler?: TradeSocketHandler) {
    return this.subscribe(`deals.${login}`, handler);
  }

  private recordPendingOrderLatency(
    pending: PendingOrderRequest,
    phase: TradeOrderLatencyPhase,
    reason?: string,
  ): void {
    const recordedAtMs = tradeOrderNow();
    const terminal = phase === 'order_filled'
      || phase === 'order_rejected'
      || phase === 'ws_transport_error';
    recordTradeOrderLatency({
      phase,
      transport: 'websocket',
      traceId: toTradeOrderTraceId(pending.clientOrderId),
      sessionScope: pending.sessionScope,
      symbol: pending.symbol,
      reason,
      ...(phase === 'order_accepted' && pending.sendCompletedAtMs > 0
        ? { acceptedRttMs: recordedAtMs - pending.sendCompletedAtMs }
        : {}),
      ...(terminal && pending.sendCompletedAtMs > 0
        ? { terminalRttMs: recordedAtMs - pending.sendCompletedAtMs }
        : {}),
      ...(terminal && pending.acceptedAtMs !== null
        ? { acceptedToTerminalMs: recordedAtMs - pending.acceptedAtMs }
        : {}),
      ...(terminal && pending.statusRecoverySentAtMs !== null
        ? { statusRttMs: recordedAtMs - pending.statusRecoverySentAtMs }
        : {}),
      totalMs: recordedAtMs - pending.apiStartedAtMs,
    });
  }

  private armPendingOrderTimer(requestId: string, pending: PendingOrderRequest): void {
    this.clearPendingOrderTimer(pending);
    pending.timer = setTimeout(() => {
      if (this.pendingOrders.get(requestId) !== pending) return;
      if (!pending.recoveryAttempted) {
        this.recoverPendingOrder(requestId, pending);
        return;
      }

      this.recordPendingOrderLatency(pending, 'ws_transport_error', 'status_timeout');
      this.rejectPendingOrder(requestId, new TradeSocketTransportError(
        'The order was sent, but its final status could not be confirmed. Do not place it again; check open positions and order history.', {
        code: 'ORDER_STATUS_TIMEOUT',
        requestId,
        clientOrderId: pending.clientOrderId,
        orderWasSent: true,
      }));
    }, this.options.orderTimeoutMs);
  }

  private recoverPendingOrder(requestId: string, pending: PendingOrderRequest): void {
    if (pending.recoveryAttempted || this.pendingOrders.get(requestId) !== pending) return;
    pending.recoveryAttempted = true;
    this.clearPendingOrderTimer(pending);

    try {
      this.getOrderStatus(pending.clientOrderId, pending.accountLogin, requestId);
      pending.statusRecoverySentAtMs = tradeOrderNow();
      this.recordPendingOrderLatency(pending, 'status_recovery_sent', 'status_reconciliation');
      this.armPendingOrderTimer(requestId, pending);
    } catch (error) {
      const transportError = new TradeSocketTransportError(
        'The order was sent, but its final status could not be confirmed. Do not place it again; check open positions and order history.', {
          code: error instanceof TradeSocketTransportError
            ? error.code || 'ORDER_STATUS_RECOVERY_FAILED'
            : 'ORDER_STATUS_RECOVERY_FAILED',
          requestId,
          clientOrderId: pending.clientOrderId,
          orderWasSent: true,
        });
      this.recordPendingOrderLatency(pending, 'ws_transport_error', 'status_recovery_send_failed');
      this.rejectPendingOrder(requestId, transportError);
    }
  }

  private routePendingOrderMessage(message: TradeSocketMessage): void {
    const record = message as Record<string, unknown>;
    const type = String(record.type || '').trim().toLowerCase();
    if (!['order_accepted', 'order_filled', 'order_rejected', 'error'].includes(type)) return;

    const requestId = readCorrelationId(record.request_id);
    const clientOrderId = readCorrelationId(record.client_order_id);
    if (!requestId || !clientOrderId) return;

    const pending = this.pendingOrders.get(requestId);
    if (!pending || pending.clientOrderId !== clientOrderId) return;

    if (type === 'order_accepted') {
      // Acceptance proves durable reservation, but it must not extend the
      // absolute terminal deadline. At that deadline we reconcile status once.
      if (pending.acceptedAtMs !== null) return;
      pending.acceptedAtMs = tradeOrderNow();
      this.recordPendingOrderLatency(pending, 'order_accepted');
      return;
    }

    if (type === 'order_filled') {
      const data = asRecord(record.data);
      if (!data) return;
      this.recordPendingOrderLatency(pending, 'order_filled');
      this.resolvePendingOrder(requestId, message as unknown as TradeSocketOrderFilled);
      return;
    }

    // Only order_rejected is a terminal business decision. A correlated generic
    // error is a transport/execution uncertainty, so reconcile the durable
    // client_order_id. The original create frame was already sent and must never
    // be recreated through REST merely because reconciliation times out.
    if (type === 'error') {
      this.recoverPendingOrder(requestId, pending);
      return;
    }

    const orderError = readOrderError(message);
    if (isRetryableOrderErrorCode(orderError.code)) {
      this.recoverPendingOrder(requestId, pending);
      return;
    }

    this.recordPendingOrderLatency(pending, 'order_rejected', orderError.code || 'order_rejected');
    this.rejectPendingOrder(requestId, new TradeSocketOrderRejectedError(orderError.message, {
      code: orderError.code,
      requestId,
      clientOrderId,
    }));
  }

  private resolvePendingOrder(requestId: string, message: TradeSocketOrderFilled): void {
    const pending = this.pendingOrders.get(requestId);
    if (!pending) return;
    this.pendingOrders.delete(requestId);
    this.clearPendingOrderTimer(pending);
    pending.resolve(message);
  }

  private rejectPendingOrder(requestId: string, error: Error): void {
    const pending = this.pendingOrders.get(requestId);
    if (!pending) return;
    this.pendingOrders.delete(requestId);
    this.clearPendingOrderTimer(pending);
    pending.reject(error);
  }

  private clearPendingOrderTimer(pending: PendingOrderRequest): void {
    if (pending.timer === null) return;
    clearTimeout(pending.timer);
    pending.timer = null;
  }

  private rejectAllPendingOrders(message: string): void {
    for (const [requestId, pending] of this.pendingOrders) {
      this.recordPendingOrderLatency(pending, 'ws_transport_error', 'socket_closed');
      this.rejectPendingOrder(requestId, new TradeSocketTransportError(message, {
        requestId,
        clientOrderId: pending.clientOrderId,
        orderWasSent: true,
      }));
    }
  }

  private addHandler(channel: string, handler: TradeSocketHandler): void {
    const handlers = this.handlers.get(channel) || new Set<TradeSocketHandler>();
    handlers.add(handler);
    this.handlers.set(channel, handlers);
  }

  private parseMessage(data: string): TradeSocketMessage {
    try {
      return JSON.parse(data) as TradeSocketMessage;
    } catch {
      return { type: 'raw', data };
    }
  }

  private dispatch(message: TradeSocketMessage): void {
    const channel = message.channel || this.inferChannel(message);
    if (channel) {
      this.handlers.get(channel)?.forEach(handler => handler(message));
    }

    this.anyHandlers.forEach(handler => handler(message));
  }

  private inferChannel(message: TradeSocketMessage): string | undefined {
    const data = message.data && typeof message.data === 'object' ? message.data as Record<string, unknown> : undefined;
    const payload = message.payload && typeof message.payload === 'object' ? message.payload as Record<string, unknown> : undefined;
    const symbol = typeof message.symbol === 'string'
      ? message.symbol
      : typeof data?.symbol === 'string'
        ? data.symbol
        : typeof payload?.symbol === 'string'
          ? payload.symbol
          : undefined;
    const login = typeof message.login === 'number' || typeof message.login === 'string'
      ? message.login
      : typeof message.account_login === 'number' || typeof message.account_login === 'string'
        ? message.account_login
        : undefined;
    const type = String(message.type || message.action || '').toLowerCase();

    if (type.includes('tick') && symbol) return `ticks.${symbol}`;
    if (type.includes('candle') && symbol) return `candles.${symbol}.${String(message.timeframe || '')}`;
    if ((type.includes('depth') || type.includes('orderbook') || type.includes('order_book')) && symbol) return `depth.${symbol}`;
    if (type.includes('position') && login) return `positions.${login}`;
    if (type.includes('account') && login) return `account.${login}`;
    if (type.includes('order') && login) return `orders.${login}`;
    if (type.includes('deal') && login) return `deals.${login}`;

    return undefined;
  }

  private scheduleReconnect(): void {
    if (!this.options.reconnect) return;

    const delay = Math.min(
      this.options.reconnectDelayMs * 2 ** this.reconnectAttempts,
      this.options.maxReconnectDelayMs
    );
    this.reconnectAttempts += 1;
    this.clearReconnectTimer();
    this.reconnectTimer = setTimeout(() => this.connect(), delay);
  }

  private clearReconnectTimer(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }

  private setState(state: TradeSocketState): void {
    this.state = state;
    this.stateHandlers.forEach(handler => handler(state));
  }
}

let sharedTradeSocket: TradeWebSocketClient | null = null;
let sharedLifecycleInitialized = false;
let sharedLifecycleQueued = false;

const reconcileSharedTradeSocket = (): void => {
  sharedLifecycleQueued = false;
  if (typeof WebSocket === 'undefined') return;

  const token = getAuthToken() || undefined;
  if (!token) {
    destroyTradeWebSocketClient();
    return;
  }

  const url = buildApiV2WsUrl(token);
  if (!url) return;
  if (sharedTradeSocket?.usesConnection(token, url)) {
    if (sharedTradeSocket.readyState !== WS_CONNECTING && sharedTradeSocket.readyState !== WS_OPEN) {
      sharedTradeSocket.connect(token);
    }
    return;
  }

  destroyTradeWebSocketClient();
  sharedTradeSocket = new TradeWebSocketClient({ token, url });
  sharedTradeSocket.connect(token);
};

const queueSharedTradeSocketReconcile = (): void => {
  if (sharedLifecycleQueued) return;
  sharedLifecycleQueued = true;
  queueMicrotask(reconcileSharedTradeSocket);
};

export const initializeTradeWebSocketClient = (): void => {
  if (sharedLifecycleInitialized || typeof window === 'undefined') return;
  sharedLifecycleInitialized = true;
  window.addEventListener('auth:token-updated', queueSharedTradeSocketReconcile);
  // Re-warm a socket that the browser closed while the network or tab was
  // suspended. These listeners never delay a click and do not create a second
  // connection when the existing authenticated socket is still open.
  window.addEventListener('online', queueSharedTradeSocketReconcile);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') queueSharedTradeSocketReconcile();
  });
  onSessionChange(queueSharedTradeSocketReconcile);
  queueSharedTradeSocketReconcile();
};

export const getTradeWebSocketClient = (options?: TradeSocketOptions): TradeWebSocketClient => {
  if (!sharedTradeSocket) {
    sharedTradeSocket = new TradeWebSocketClient(options);
  }
  return sharedTradeSocket;
};

export const destroyTradeWebSocketClient = (): void => {
  sharedTradeSocket?.disconnect();
  sharedTradeSocket = null;
};
