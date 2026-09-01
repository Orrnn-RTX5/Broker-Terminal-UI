import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  destroyTradeWebSocketClient,
  getTradeWebSocketClient,
  initializeTradeWebSocketClient,
  TradeWebSocketClient,
  type TradeSocketOptions,
} from './tradeSocket';
import {
  clearTradeOrderLatencySamples,
  getTradeOrderLatencySamples,
} from '../services/orderLatencyTelemetry';

class FakeWebSocket {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSING = 2;
  static readonly CLOSED = 3;
  static instances: FakeWebSocket[] = [];

  readyState = FakeWebSocket.CONNECTING;
  bufferedAmount = 0;
  sent: string[] = [];
  throwOnSend = false;
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;

  constructor(public readonly url: string) {
    FakeWebSocket.instances.push(this);
  }

  open(): void {
    this.readyState = FakeWebSocket.OPEN;
    this.onopen?.();
  }

  emit(message: unknown): void {
    this.onmessage?.({ data: JSON.stringify(message) });
  }

  send(payload: string): void {
    if (this.throwOnSend) throw new Error('synthetic send failure');
    this.sent.push(payload);
    this.bufferedAmount += payload.length;
  }

  close(): void {
    this.readyState = FakeWebSocket.CLOSED;
    this.onclose?.();
  }
}

type SentMessage = Record<string, unknown>;

const sentMessages = (socket: FakeWebSocket): SentMessage[] =>
  socket.sent.map((payload) => JSON.parse(payload) as SentMessage);

const findSentAction = (socket: FakeWebSocket, action: string): SentMessage => {
  const message = sentMessages(socket).find((candidate) => candidate.action === action);
  if (!message) throw new Error(`Expected ${action} WebSocket message`);
  return message;
};

const marketOrder = {
  account_login: 200002,
  symbol: 'BTCUSD',
  side: 'buy' as const,
  type: 'market' as const,
  volume: 0.01,
  sl: 0,
  tp: 0,
};

const filledData = {
  order_ticket: 880001,
  position_ticket: 990001,
  symbol: 'BTCUSD',
  side: 'buy',
  volume: 0.01,
  price: 65321.45,
  commission: -0.25,
  status: 'filled',
};

const createOpenClient = (options: Partial<TradeSocketOptions> = {}) => {
  const client = new TradeWebSocketClient({
    url: 'wss://fxtrustbrokerbackend.orrnn.com/ws/v2',
    token: 'trader-jwt',
    reconnect: false,
    ...options,
  });
  client.connect();
  const socket = FakeWebSocket.instances[0];
  socket.open();
  // The auth frame is considered flushed before an order-click benchmark.
  socket.bufferedAmount = 0;
  return { client, socket };
};

describe('TradeWebSocketClient market orders', () => {
  beforeEach(() => {
    FakeWebSocket.instances = [];
    localStorage.clear();
    sessionStorage.clear();
    clearTradeOrderLatencySamples();
    vi.stubGlobal('WebSocket', FakeWebSocket as unknown as typeof WebSocket);
  });

  afterEach(() => {
    destroyTradeWebSocketClient();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('omits zero-value protection from place_order and resolves a direct fill', async () => {
    const { client, socket } = createOpenClient();

    const resultPromise = client.placeOrder(marketOrder);
    const request = findSentAction(socket, 'place_order');

    expect(request.request_id).toEqual(expect.any(String));
    expect(request.client_order_id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    );
    expect(request).toEqual({
      action: 'place_order',
      request_id: request.request_id,
      client_order_id: request.client_order_id,
      account_login: marketOrder.account_login,
      symbol: marketOrder.symbol,
      side: marketOrder.side,
      type: marketOrder.type,
      volume: marketOrder.volume,
    });

    socket.emit({
      type: 'order_filled',
      status: 'filled',
      success: true,
      ack_required: true,
      request_id: request.request_id,
      client_order_id: request.client_order_id,
      data: filledData,
    });

    await expect(resultPromise).resolves.toMatchObject({
      type: 'order_filled',
      request_id: request.request_id,
      client_order_id: request.client_order_id,
      data: filledData,
    });
    client.disconnect();
  });

  it.each([
    { label: 'BUY with omitted protection', side: 'buy' as const, sl: undefined, tp: undefined },
    { label: 'SELL with zero protection', side: 'sell' as const, sl: 0, tp: 0 },
    { label: 'BUY with positive protection', side: 'buy' as const, sl: 64_000, tp: 67_000 },
    { label: 'SELL with positive protection', side: 'sell' as const, sl: 67_000, tp: 64_000 },
  ])('serializes $label correctly on the actual WebSocket frame', async ({ side, sl, tp }) => {
    const { client, socket } = createOpenClient();
    const resultPromise = client.placeOrder({
      ...marketOrder,
      side,
      sl,
      tp,
    });
    const request = findSentAction(socket, 'place_order');

    expect(request.side).toBe(side);
    if (sl && sl > 0) expect(request.sl).toBe(sl);
    else expect(request).not.toHaveProperty('sl');
    if (tp && tp > 0) expect(request.tp).toBe(tp);
    else expect(request).not.toHaveProperty('tp');

    socket.emit({
      type: 'order_filled',
      status: 'filled',
      success: true,
      request_id: request.request_id,
      client_order_id: request.client_order_id,
      data: { ...filledData, side },
    });
    await expect(resultPromise).resolves.toMatchObject({
      data: { side },
    });
    client.disconnect();
  });

  it.each([
    { label: 'negative SL', protection: { sl: -1 } },
    { label: 'NaN SL', protection: { sl: Number.NaN } },
    { label: 'non-numeric SL', protection: { sl: '0' as unknown as number } },
    { label: 'negative TP', protection: { tp: -1 } },
    { label: 'infinite TP', protection: { tp: Number.POSITIVE_INFINITY } },
    { label: 'null TP', protection: { tp: null as unknown as number } },
  ])('rejects $label locally before writing a WS order frame', async ({ protection }) => {
    const { client, socket } = createOpenClient();

    await expect(client.placeOrder({
      ...marketOrder,
      ...protection,
    })).rejects.toThrow(/must be zero \(disabled\) or a positive finite number/);
    expect(sentMessages(socket).filter((message) => message.action === 'place_order')).toHaveLength(0);
    client.disconnect();
  });

  it('records each order phase and retains the trimmed submission scope while pending', async () => {
    const { client, socket } = createOpenClient();
    const intentAtMs = performance.now();
    const apiStartedAtMs = performance.now();
    const sessionScope = 'authenticated|200002|broker-a|https://broker.example';
    const timing = {
      intentAtMs,
      apiStartedAtMs,
      sessionScope: `  ${sessionScope}  `,
    };

    const resultPromise = client.placeOrder(marketOrder, undefined, timing);
    timing.sessionScope = 'authenticated|300003|broker-b|https://other.example';
    const request = findSentAction(socket, 'place_order');
    const enqueued = getTradeOrderLatencySamples().find((sample) => sample.phase === 'ws_enqueued');

    expect(enqueued).toMatchObject({
      transport: 'websocket',
      symbol: 'BTCUSD',
      sessionScope,
      payloadBytes: JSON.stringify(request).length,
      bufferedAmountBefore: 0,
    });
    expect(enqueued?.bufferedAmountAfter).toBeGreaterThan(0);
    expect(enqueued?.serializationMs).toBeGreaterThanOrEqual(0);
    expect(enqueued?.sendCallMs).toBeGreaterThanOrEqual(0);
    expect(enqueued?.intentToEnqueueMs).toBeGreaterThanOrEqual(0);
    expect(enqueued?.apiToEnqueueMs).toBeGreaterThanOrEqual(0);

    socket.emit({
      type: 'order_accepted',
      status: 'accepted',
      success: true,
      request_id: request.request_id,
      client_order_id: request.client_order_id,
      accepted_at: Date.now(),
    });
    // A retransmitted acceptance is ignored for settlement and metrics.
    socket.emit({
      type: 'order_accepted',
      status: 'accepted',
      success: true,
      request_id: request.request_id,
      client_order_id: request.client_order_id,
      accepted_at: Date.now(),
    });
    socket.emit({
      type: 'order_filled',
      status: 'filled',
      success: true,
      request_id: request.request_id,
      client_order_id: request.client_order_id,
      data: filledData,
    });

    await expect(resultPromise).resolves.toMatchObject({ data: filledData });
    const samples = getTradeOrderLatencySamples();
    expect(samples.filter((sample) => sample.phase === 'order_accepted')).toHaveLength(1);
    expect(samples.find((sample) => sample.phase === 'order_accepted')?.acceptedRttMs).toBeGreaterThanOrEqual(0);
    expect(samples.find((sample) => sample.phase === 'order_filled')).toMatchObject({
      sessionScope,
      terminalRttMs: expect.any(Number),
      acceptedToTerminalMs: expect.any(Number),
    });
    client.disconnect();
  });

  it('falls back safely when the dedicated order socket is already backpressured', async () => {
    const { client, socket } = createOpenClient({ maxOrderBufferedAmount: 32 });
    socket.bufferedAmount = 33;

    await expect(client.placeOrder(marketOrder)).rejects.toMatchObject({
      name: 'TradeSocketTransportError',
      code: 'WS_BACKPRESSURE',
      retryable: true,
      orderWasSent: false,
    });
    expect(sentMessages(socket).filter((message) => message.action === 'place_order')).toHaveLength(0);
    expect(getTradeOrderLatencySamples()).toContainEqual(expect.objectContaining({
      phase: 'ws_transport_error',
      reason: 'socket_backpressure',
      bufferedAmountBefore: 33,
    }));
    client.disconnect();
  });

  it('cleans up a synchronous WebSocket.send failure as a retryable transport error', async () => {
    const { client, socket } = createOpenClient();
    socket.throwOnSend = true;

    await expect(client.placeOrder(marketOrder)).rejects.toMatchObject({
      name: 'TradeSocketTransportError',
      code: 'WS_SEND_FAILED',
      retryable: true,
      orderWasSent: false,
    });
    expect(getTradeOrderLatencySamples()).toContainEqual(expect.objectContaining({
      phase: 'ws_transport_error',
      reason: 'send_failed',
    }));
    socket.throwOnSend = false;
    client.disconnect();
  });

  it('keeps an accepted order pending and correlates the terminal response by both ids', async () => {
    const { client, socket } = createOpenClient();
    let settled = false;

    const resultPromise = client.placeOrder(marketOrder);
    void resultPromise.then(
      () => { settled = true; },
      () => { settled = true; },
    );
    const request = findSentAction(socket, 'place_order');

    socket.emit({
      type: 'order_accepted',
      status: 'accepted',
      success: true,
      request_id: request.request_id,
      client_order_id: request.client_order_id,
      accepted_at: 1_777_000_000,
    });
    await Promise.resolve();
    expect(settled).toBe(false);

    socket.emit({
      type: 'order_filled',
      status: 'filled',
      success: true,
      request_id: request.request_id,
      client_order_id: '00000000-0000-4000-8000-000000000000',
      data: filledData,
    });
    await Promise.resolve();
    expect(settled).toBe(false);

    socket.emit({
      type: 'order_filled',
      status: 'filled',
      success: true,
      ack_required: true,
      request_id: request.request_id,
      client_order_id: request.client_order_id,
      data: filledData,
    });

    await expect(resultPromise).resolves.toMatchObject({ data: filledData });
    client.disconnect();
  });

  it('settles simultaneous Buy and Sell orders correctly when fills arrive out of order', async () => {
    const { client, socket } = createOpenClient();
    const buyPromise = client.placeOrder({ ...marketOrder, side: 'buy' });
    const sellPromise = client.placeOrder({ ...marketOrder, side: 'sell' });
    const requests = sentMessages(socket).filter(message => message.action === 'place_order');
    const [buyRequest, sellRequest] = requests;

    expect(requests).toHaveLength(2);
    expect(buyRequest.request_id).not.toBe(sellRequest.request_id);
    expect(buyRequest.client_order_id).not.toBe(sellRequest.client_order_id);

    // Deliver the second order first to prove that neither map lookup nor
    // settlement depends on server response order or a socket-global "latest".
    socket.emit({
      type: 'order_filled',
      status: 'filled',
      success: true,
      request_id: sellRequest.request_id,
      client_order_id: sellRequest.client_order_id,
      data: { ...filledData, side: 'sell', order_ticket: 880002, position_ticket: 990002 },
    });
    socket.emit({
      type: 'order_filled',
      status: 'filled',
      success: true,
      request_id: buyRequest.request_id,
      client_order_id: buyRequest.client_order_id,
      data: filledData,
    });

    await expect(sellPromise).resolves.toMatchObject({
      client_order_id: sellRequest.client_order_id,
      data: { side: 'sell', order_ticket: 880002 },
    });
    await expect(buyPromise).resolves.toMatchObject({
      client_order_id: buyRequest.client_order_id,
      data: { side: 'buy', order_ticket: 880001 },
    });
    client.disconnect();
  });

  it('keeps 20 burst orders independently correlated when fills arrive in reverse order', async () => {
    const { client, socket } = createOpenClient();
    const orderPromises = Array.from({ length: 20 }, (_, index) =>
      client.placeOrder({
        ...marketOrder,
        side: index % 2 === 0 ? 'buy' : 'sell',
      }),
    );
    const requests = sentMessages(socket).filter(message => message.action === 'place_order');

    expect(requests).toHaveLength(20);
    expect(new Set(requests.map(request => request.request_id)).size).toBe(20);
    expect(new Set(requests.map(request => request.client_order_id)).size).toBe(20);

    // A real burst can settle in any order. Reverse delivery proves each frame
    // is resolved solely by its request_id + client_order_id pair, with no
    // socket-wide in-flight limit or "latest request" race.
    [...requests].reverse().forEach((request, reverseIndex) => {
      const originalIndex = requests.length - 1 - reverseIndex;
      const side = originalIndex % 2 === 0 ? 'buy' : 'sell';
      socket.emit({
        type: 'order_filled',
        status: 'filled',
        success: true,
        request_id: request.request_id,
        client_order_id: request.client_order_id,
        data: {
          ...filledData,
          side,
          order_ticket: 881000 + originalIndex,
          position_ticket: 991000 + originalIndex,
        },
      });
    });

    const results = await Promise.all(orderPromises);
    expect(results).toHaveLength(20);
    results.forEach((result, index) => {
      expect(result).toMatchObject({
        client_order_id: requests[index].client_order_id,
        data: {
          side: index % 2 === 0 ? 'buy' : 'sell',
          order_ticket: 881000 + index,
        },
      });
    });
    client.disconnect();
  });

  it('rejects a terminal business failure with the backend error message and ids', async () => {
    const { client, socket } = createOpenClient();

    const resultPromise = client.placeOrder(marketOrder);
    const request = findSentAction(socket, 'place_order');

    socket.emit({
      type: 'order_rejected',
      status: 'rejected',
      success: false,
      ack_required: true,
      request_id: request.request_id,
      client_order_id: request.client_order_id,
      error: {
        code: 'SYMBOL_NOT_ALLOWED',
        message: 'XAUUSD is not allowed for this account',
      },
    });

    const rejection = await resultPromise.catch((error: unknown) => error) as Error & {
      code?: string;
      requestId?: string;
      clientOrderId?: string;
      retryable?: boolean;
    };
    expect(rejection).toMatchObject({
      message: 'XAUUSD is not allowed for this account',
      code: 'SYMBOL_NOT_ALLOWED',
      requestId: request.request_id,
      clientOrderId: request.client_order_id,
      retryable: false,
    });
    client.disconnect();
  });

  it('recovers a retryable SERVICE_UNAVAILABLE response through get_order_status', async () => {
    const { client, socket } = createOpenClient();
    let settled = false;

    const resultPromise = client.placeOrder(marketOrder);
    void resultPromise.then(
      () => { settled = true; },
      () => { settled = true; },
    );
    const request = findSentAction(socket, 'place_order');

    socket.emit({
      type: 'order_rejected',
      status: 'rejected',
      success: false,
      ack_required: true,
      request_id: request.request_id,
      client_order_id: request.client_order_id,
      error: {
        code: 'SERVICE_UNAVAILABLE',
        message: 'Execution service is temporarily unavailable',
      },
    });
    await Promise.resolve();

    expect(settled).toBe(false);
    expect(sentMessages(socket).filter((message) => message.action === 'get_order_status')).toEqual([{
      action: 'get_order_status',
      request_id: request.request_id,
      client_order_id: request.client_order_id,
      account_login: 200002,
    }]);

    socket.emit({
      type: 'order_filled',
      status: 'filled',
      success: true,
      ack_required: true,
      request_id: request.request_id,
      client_order_id: request.client_order_id,
      data: filledData,
    });

    await expect(resultPromise).resolves.toMatchObject({ data: filledData });
    client.disconnect();
  });

  it('treats a correlated generic error as transport uncertainty and reconciles once', async () => {
    vi.useFakeTimers();
    const { client, socket } = createOpenClient();

    const resultPromise = client.placeOrder(marketOrder);
    const rejectionPromise = resultPromise.catch((error: unknown) => error) as Promise<Error & {
      code?: string;
      retryable?: boolean;
      clientOrderId?: string;
      orderWasSent?: boolean;
    }>;
    const request = findSentAction(socket, 'place_order');

    socket.emit({
      type: 'error',
      request_id: request.request_id,
      client_order_id: request.client_order_id,
      error: {
        code: 'AUTH_UPSTREAM_FAILURE',
        message: 'Unable to confirm execution state',
      },
    });
    await Promise.resolve();

    expect(sentMessages(socket).filter((message) => message.action === 'get_order_status')).toEqual([{
      action: 'get_order_status',
      request_id: request.request_id,
      client_order_id: request.client_order_id,
      account_login: 200002,
    }]);

    await vi.advanceTimersByTimeAsync(10_000);

    await expect(rejectionPromise).resolves.toMatchObject({
      name: 'TradeSocketTransportError',
      code: 'ORDER_STATUS_TIMEOUT',
      retryable: false,
      orderWasSent: true,
      clientOrderId: request.client_order_id,
    });
    expect(sentMessages(socket).filter((message) => message.action === 'get_order_status')).toHaveLength(1);
    client.disconnect();
  });

  it('queries status once on the first timeout and can still resolve the recovered fill', async () => {
    vi.useFakeTimers();
    const { client, socket } = createOpenClient();

    const resultPromise = client.placeOrder(marketOrder);
    const request = findSentAction(socket, 'place_order');

    await vi.advanceTimersByTimeAsync(10_000);

    const statusRequests = sentMessages(socket).filter((message) => message.action === 'get_order_status');
    expect(statusRequests).toEqual([{
      action: 'get_order_status',
      request_id: request.request_id,
      client_order_id: request.client_order_id,
      account_login: 200002,
    }]);

    socket.emit({
      type: 'order_filled',
      status: 'filled',
      success: true,
      ack_required: true,
      request_id: request.request_id,
      client_order_id: request.client_order_id,
      data: filledData,
    });

    await expect(resultPromise).resolves.toMatchObject({ data: filledData });
    await vi.advanceTimersByTimeAsync(30_000);
    expect(sentMessages(socket).filter((message) => message.action === 'get_order_status')).toHaveLength(1);
    client.disconnect();
  });

  it('keeps the initial timeout absolute even when accepted arrives just before it', async () => {
    vi.useFakeTimers();
    const { client, socket } = createOpenClient({ orderTimeoutMs: 10_000 });

    const resultPromise = client.placeOrder(marketOrder);
    const request = findSentAction(socket, 'place_order');
    await vi.advanceTimersByTimeAsync(9_000);
    socket.emit({
      type: 'order_accepted',
      status: 'accepted',
      success: true,
      request_id: request.request_id,
      client_order_id: request.client_order_id,
    });
    await vi.advanceTimersByTimeAsync(1_000);

    expect(sentMessages(socket).filter((message) => message.action === 'get_order_status')).toHaveLength(1);
    socket.emit({
      type: 'order_filled',
      status: 'filled',
      success: true,
      request_id: request.request_id,
      client_order_id: request.client_order_id,
      data: filledData,
    });
    await expect(resultPromise).resolves.toMatchObject({ data: filledData });
    client.disconnect();
  });

  it('reports an uncertain sent order without allowing another create after status recovery times out', async () => {
    vi.useFakeTimers();
    const { client, socket } = createOpenClient();

    const resultPromise = client.placeOrder(marketOrder);
    const rejectionPromise = resultPromise.catch((error: unknown) => error) as Promise<Error & {
      code?: string;
      retryable?: boolean;
      clientOrderId?: string;
      orderWasSent?: boolean;
    }>;
    const request = findSentAction(socket, 'place_order');

    await vi.advanceTimersByTimeAsync(20_000);

    await expect(rejectionPromise).resolves.toMatchObject({
      name: 'TradeSocketTransportError',
      code: 'ORDER_STATUS_TIMEOUT',
      retryable: false,
      orderWasSent: true,
      clientOrderId: request.client_order_id,
    });
    expect(sentMessages(socket).filter((message) => message.action === 'get_order_status')).toHaveLength(1);
    client.disconnect();
  });

  it('warms the shared authenticated order socket without a component-level connect call', async () => {
    localStorage.setItem('auth_token', 'persisted-trader-jwt');

    initializeTradeWebSocketClient();
    await Promise.resolve();

    expect(FakeWebSocket.instances).toHaveLength(1);
    const socket = FakeWebSocket.instances[0];
    socket.open();

    expect(getTradeWebSocketClient().isReadyForOrders()).toBe(true);
    expect(findSentAction(socket, 'auth')).toEqual({
      action: 'auth',
      token: 'persisted-trader-jwt',
    });
  });
});
