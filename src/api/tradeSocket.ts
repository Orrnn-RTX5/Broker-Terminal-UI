import { RTX5_WS_URL, buildApiV2WsUrl } from '../config/api';
import { getAuthToken } from './client';
import type { Timeframe, TradeSocketChannel, TradeSocketMessage } from '../types/api';

export type TradeSocketState = 'idle' | 'connecting' | 'open' | 'closed' | 'error';
export type TradeSocketHandler<T = unknown> = (message: TradeSocketMessage<T>) => void;

export interface TradeSocketOptions {
  url?: string;
  token?: string;
  reconnect?: boolean;
  reconnectDelayMs?: number;
  maxReconnectDelayMs?: number;
}

const DEFAULT_RECONNECT_DELAY = 1_000;
const DEFAULT_MAX_RECONNECT_DELAY = 15_000;

export class TradeWebSocketClient {
  private ws: WebSocket | null = null;
  private state: TradeSocketState = 'idle';
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectAttempts = 0;
  private readonly channels = new Set<string>();
  private readonly handlers = new Map<string, Set<TradeSocketHandler>>();
  private readonly anyHandlers = new Set<TradeSocketHandler>();
  private readonly stateHandlers = new Set<(state: TradeSocketState) => void>();
  private readonly options: Required<Pick<TradeSocketOptions, 'reconnect' | 'reconnectDelayMs' | 'maxReconnectDelayMs'>> & TradeSocketOptions;

  constructor(options: TradeSocketOptions = {}) {
    this.options = {
      reconnect: true,
      reconnectDelayMs: DEFAULT_RECONNECT_DELAY,
      maxReconnectDelayMs: DEFAULT_MAX_RECONNECT_DELAY,
      ...options,
    };
  }

  get readyState(): number | undefined {
    return this.ws?.readyState;
  }

  get connectionState(): TradeSocketState {
    return this.state;
  }

  connect(token = this.options.token || getAuthToken() || undefined): void {
    if (this.ws && (this.ws.readyState === WebSocket.CONNECTING || this.ws.readyState === WebSocket.OPEN)) {
      return;
    }

    this.setState('connecting');
    const url = this.options.url || (token ? buildApiV2WsUrl(token) : RTX5_WS_URL);
    this.ws = new WebSocket(url);

    this.ws.onopen = () => {
      this.reconnectAttempts = 0;
      this.setState('open');

      if (token) {
        this.send({ action: 'auth', token });
      }

      this.channels.forEach(channel => this.send({ action: 'subscribe', channel, channels: [channel] }));
    };

    this.ws.onmessage = event => {
      const message = this.parseMessage(event.data);
      this.dispatch(message);
    };

    this.ws.onerror = () => {
      this.setState('error');
    };

    this.ws.onclose = () => {
      this.setState('closed');
      this.ws = null;
      this.scheduleReconnect();
    };
  }

  disconnect(): void {
    this.clearReconnectTimer();
    this.options.reconnect = false;
    this.ws?.close();
    this.ws = null;
    this.setState('closed');
  }

  subscribe<T = unknown>(channel: TradeSocketChannel | string, handler?: TradeSocketHandler<T>): () => void {
    const key = String(channel);
    this.channels.add(key);

    if (handler) {
      this.addHandler(key, handler as TradeSocketHandler);
    }

    if (this.ws?.readyState === WebSocket.OPEN) {
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

    if (this.ws?.readyState === WebSocket.OPEN) {
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

  send(message: TradeSocketMessage): void {
    const payload = JSON.stringify(message);
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(payload);
    }
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
