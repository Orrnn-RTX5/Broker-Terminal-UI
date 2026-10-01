import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';

const mocks = vi.hoisted(() => ({
  getTradeWebSocketClient: vi.fn(),
  wsPlaceOrder: vi.fn(),
  restPlaceOrder: vi.fn(),
  restGetOrderCommand: vi.fn(),
}));

vi.mock('../api/tradeSocket', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../api/tradeSocket')>();
  return {
    ...actual,
    getTradeWebSocketClient: mocks.getTradeWebSocketClient,
  };
});

vi.mock('../api/endpoints', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../api/endpoints')>();
  return {
    ...actual,
    tradingApi: {
      ...actual.tradingApi,
      placeOrder: mocks.restPlaceOrder,
      getOrderCommand: mocks.restGetOrderCommand,
    },
  };
});

import { api } from './api';
import { TradeWebSocketClient } from '../api/tradeSocket';
import {
  clearTradeOrderLatencySamples,
  getTradeOrderLatencySamples,
} from './orderLatencyTelemetry';
import { MARKET_ORDER_PLACEMENT_STATE_EVENT } from './marketOrderPlacementEvents';

const CLIENT_ORDER_ID = '123e4567-e89b-42d3-a456-426614174000';

const inputOrder = {
  login: 200002,
  symbol: 'BTCUSD',
  side: 'buy' as const,
  volume: 0.01,
  price_sl: 0,
  price_tp: 0,
};

const filledData = {
  order_ticket: 880001,
  position_ticket: 990001,
  symbol: 'BTCUSD',
  side: 'buy' as const,
  volume: 0.01,
  price: 65321.45,
  commission: -0.25,
  status: 'filled',
};

const restPosition = {
  id: '990002',
  ticket: 990002,
  account_login: 200002,
  symbol: 'BTCUSD',
  side: 'buy' as const,
  volume: 0.01,
  price_open: 65322,
  commission: -0.25,
};

type TradeSocketStub = {
  connectionState: string;
  readyState: number;
  isConnected: () => boolean;
  placeOrder: typeof mocks.wsPlaceOrder;
};

// Exercise actual protocol routing as well as API recovery without opening a
// network connection or submitting a financial order.
class RecoveryWebSocket {
  readyState = 0;
  bufferedAmount = 0;
  sent: Record<string, unknown>[] = [];
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;

  send(payload: string) { this.sent.push(JSON.parse(payload)); }
  close() { this.readyState = 3; this.onclose?.(); }
  open() { this.readyState = 1; this.onopen?.(); }
  emit(message: unknown) { this.onmessage?.({ data: JSON.stringify(message) }); }
}

let tradeSocket: TradeSocketStub;
let onNewTrade: Mock<(event: Event) => void>;
let onPlacementState: Mock<(event: Event) => void>;

const extractWsClientOrderId = (): unknown => {
  const call = mocks.wsPlaceOrder.mock.calls[0] as unknown[] | undefined;
  const payload = call?.[0] as Record<string, unknown> | undefined;
  return call?.[1] ?? payload?.client_order_id;
};

describe('ordersApi.placeMarketOrder WebSocket-first transport', () => {
  beforeEach(() => {
    mocks.getTradeWebSocketClient.mockReset();
    mocks.wsPlaceOrder.mockReset();
    mocks.restPlaceOrder.mockReset();
    mocks.restGetOrderCommand.mockReset();
    localStorage.clear();
    (window as Window & { __RTX_RUNTIME_CONFIG__?: Record<string, unknown> }).__RTX_RUNTIME_CONFIG__ = {
      BACKEND_TARGET: 'desktop', API_HOST: 'https://broker.example', WS_HOST: 'wss://broker.example',
      BROKER_ID: 'Fixture', DEFAULT_MT5_SERVER: 'Fixture-Live',
    };
    localStorage.setItem('server_url', 'https://broker.example');
    localStorage.setItem('broker_id', 'Fixture');
    clearTradeOrderLatencySamples();

    tradeSocket = {
      connectionState: 'open',
      readyState: 1,
      isConnected: () => tradeSocket.connectionState === 'open',
      placeOrder: mocks.wsPlaceOrder,
    };
    mocks.getTradeWebSocketClient.mockReturnValue(tradeSocket);
    vi.spyOn(globalThis.crypto, 'randomUUID').mockReturnValue(CLIENT_ORDER_ID);

    onNewTrade = vi.fn<(event: Event) => void>();
    onPlacementState = vi.fn<(event: Event) => void>();
    window.addEventListener('rtx:new-trade-placed', onNewTrade);
    window.addEventListener(MARKET_ORDER_PLACEMENT_STATE_EVENT, onPlacementState);
  });

  afterEach(() => {
    delete (window as Window & { __RTX_RUNTIME_CONFIG__?: Record<string, unknown> }).__RTX_RUNTIME_CONFIG__;
    window.removeEventListener('rtx:new-trade-placed', onNewTrade);
    window.removeEventListener(MARKET_ORDER_PLACEMENT_STATE_EVENT, onPlacementState);
    vi.restoreAllMocks();
  });

  it('uses the open trade socket, maps order_filled.data, and preserves the refresh event', async () => {
    mocks.wsPlaceOrder.mockResolvedValue({
      type: 'order_filled',
      status: 'filled',
      success: true,
      ack_required: true,
      request_id: 'req-1',
      client_order_id: CLIENT_ORDER_ID,
      data: filledData,
    });

    const intentAtMs = performance.now();
    const result = await api.orders.placeMarketOrder(inputOrder, { intentAtMs });

    expect(mocks.wsPlaceOrder).toHaveBeenCalledTimes(1);
    expect(mocks.wsPlaceOrder.mock.calls[0][0]).toMatchObject({
      account_login: 200002,
      symbol: 'BTCUSD',
      side: 'buy',
      type: 'market',
      volume: 0.01,
      sl: 0,
      tp: 0,
    });
    expect(extractWsClientOrderId()).toBe(CLIENT_ORDER_ID);
    expect(mocks.wsPlaceOrder.mock.calls[0][2]).toMatchObject({
      intentAtMs,
      apiStartedAtMs: expect.any(Number),
      sessionScope: expect.any(String),
    });
    expect(mocks.restPlaceOrder).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      ticket: 990001,
      account_login: 200002,
      symbol: 'BTCUSD',
      side: 'buy',
      volume: 0.01,
      price_open: 65321.45,
      commission: -0.25,
      price_current: 0,
      hasBackendCurrentPrice: false,
      hasBackendProfit: false,
    });
    expect(onNewTrade).toHaveBeenCalledTimes(1);
    const placedEvent = onNewTrade.mock.calls[0][0] as CustomEvent;
    expect(placedEvent.detail).toMatchObject({
      login: 200002,
      position: result,
      sessionScope: expect.any(String),
    });
    expect(onPlacementState).toHaveBeenCalledTimes(2);
    const placementDetails = onPlacementState.mock.calls.map(([event]) => (event as CustomEvent).detail);
    expect(placementDetails[0]).toMatchObject({
      status: 'pending',
      clientOrderId: CLIENT_ORDER_ID,
      login: 200002,
      provisionalTicket: expect.any(Number),
      position: {
        symbol: 'BTCUSD',
        side: 'buy',
        volume: 0.01,
        placement_state: 'pending',
        hasBackendCurrentPrice: false,
        hasBackendProfit: false,
      },
    });
    expect(placementDetails[0].provisionalTicket).toBeLessThan(0);
    expect(placementDetails[1]).toMatchObject({
      status: 'filled',
      clientOrderId: CLIENT_ORDER_ID,
      position: result,
    });
    expect(getTradeOrderLatencySamples()).toContainEqual(expect.objectContaining({
      phase: 'placement_terminal',
      transport: 'websocket',
      clientOrderId: CLIENT_ORDER_ID,
      terminalStatus: 'filled',
      symbol: 'BTCUSD',
      side: 'buy',
      volume: 0.01,
      totalMs: expect.any(Number),
    }));
  });

  it.each([
    ['zero values', { profit: 0, price_current: 0 }, true],
    ['unavailable values', { profit: 5, price_current: 65330, pnl_available: false }, false],
    ['previous placeholders', { profit: 0, price_current: 0, hasBackendProfit: false, hasBackendCurrentPrice: false }, false],
  ])('keeps filled order %s provenance without deriving a current price', async (_name, display, available) => {
    mocks.wsPlaceOrder.mockResolvedValue({
      type: 'order_filled',
      status: 'filled',
      success: true,
      request_id: 'req-display',
      client_order_id: CLIENT_ORDER_ID,
      data: { ...filledData, state_version: '12345678901234567890', ...display },
    });
    const result = await api.orders.placeMarketOrder(inputOrder);
    expect(result).toMatchObject({
      state_version: '12345678901234567890',
      hasBackendProfit: available,
      hasBackendCurrentPrice: available,
      price_current: 0,
    });
    expect(mocks.restPlaceOrder).not.toHaveBeenCalled();
  });

  it('starts the transport before publishing the immediate pending row', async () => {
    const order = {
      type: 'order_filled',
      status: 'filled',
      success: true,
      request_id: 'req-ordering',
      client_order_id: CLIENT_ORDER_ID,
      data: filledData,
    };
    let resolveFill!: (value: typeof order) => void;
    const fillPromise = new Promise<typeof order>((resolve) => {
      resolveFill = resolve;
    });
    const events: string[] = [];
    mocks.wsPlaceOrder.mockImplementation(() => {
      events.push('transport-started');
      return fillPromise;
    });
    const recordPlacement = (event: Event) => {
      events.push((event as CustomEvent).detail.status);
    };
    window.addEventListener(MARKET_ORDER_PLACEMENT_STATE_EVENT, recordPlacement);

    try {
      const placement = api.orders.placeMarketOrder(inputOrder);
      expect(events).toEqual(['transport-started', 'pending']);

      resolveFill(order);
      await placement;
      expect(events).toEqual(['transport-started', 'pending', 'filled']);
    } finally {
      window.removeEventListener(MARKET_ORDER_PLACEMENT_STATE_EVENT, recordPlacement);
    }
  });

  it('routes SELL through the same open WebSocket order path', async () => {
    mocks.wsPlaceOrder.mockResolvedValue({
      type: 'order_filled',
      status: 'filled',
      success: true,
      request_id: 'req-sell',
      client_order_id: CLIENT_ORDER_ID,
      data: { ...filledData, side: 'sell' },
    });

    await expect(api.orders.placeMarketOrder({
      ...inputOrder,
      side: 'sell',
    })).resolves.toMatchObject({
      side: 'sell',
      ticket: 990001,
    });

    expect(mocks.wsPlaceOrder).toHaveBeenCalledTimes(1);
    expect(mocks.wsPlaceOrder.mock.calls[0][0]).toMatchObject({
      account_login: 200002,
      symbol: 'BTCUSD',
      side: 'sell',
      type: 'market',
      volume: 0.01,
    });
    expect(mocks.restPlaceOrder).not.toHaveBeenCalled();
  });

  it.each([
    ['negative SL', { price_sl: -1 }],
    ['NaN SL', { price_sl: Number.NaN }],
    ['non-numeric SL', { price_sl: '0' as unknown as number }],
    ['negative TP', { price_tp: -1 }],
    ['infinite TP', { price_tp: Number.POSITIVE_INFINITY }],
    ['null TP', { price_tp: null as unknown as number }],
  ])('rejects %s before selecting either transport', async (_label, protection) => {
    await expect(api.orders.placeMarketOrder({
      ...inputOrder,
      ...protection,
    })).rejects.toThrow(/must be zero \(disabled\) or a positive finite number/);

    expect(mocks.wsPlaceOrder).not.toHaveBeenCalled();
    expect(mocks.restPlaceOrder).not.toHaveBeenCalled();
  });

  it('preserves a supplied UUID v4 across the WebSocket path and any retry', async () => {
    const suppliedClientOrderId = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
    mocks.wsPlaceOrder.mockResolvedValue({
      type: 'order_filled',
      status: 'filled',
      success: true,
      request_id: 'req-supplied',
      client_order_id: suppliedClientOrderId,
      data: filledData,
    });

    await api.orders.placeMarketOrder({
      ...inputOrder,
      client_order_id: suppliedClientOrderId,
    });

    expect(extractWsClientOrderId()).toBe(suppliedClientOrderId);
    expect(globalThis.crypto.randomUUID).not.toHaveBeenCalled();
  });

  it('rejects a malformed supplied idempotency key before either transport', async () => {
    await expect(api.orders.placeMarketOrder({
      ...inputOrder,
      client_order_id: 'not-a-uuid',
    })).rejects.toThrow('client_order_id must be a UUID v4');

    expect(mocks.wsPlaceOrder).not.toHaveBeenCalled();
    expect(mocks.restPlaceOrder).not.toHaveBeenCalled();
  });

  it('falls back only when the WebSocket order was definitely not sent, preserving client_order_id', async () => {
    const transportError = Object.assign(new Error('Trade socket changed before the order could be sent'), {
      name: 'TradeSocketTransportError',
      code: 'WS_NOT_READY',
      retryable: true,
      orderWasSent: false,
      clientOrderId: CLIENT_ORDER_ID,
    });
    mocks.wsPlaceOrder.mockRejectedValue(transportError);
    mocks.restPlaceOrder.mockResolvedValue(restPosition);

    await expect(api.orders.placeMarketOrder(inputOrder)).resolves.toEqual(restPosition);

    expect(extractWsClientOrderId()).toBe(CLIENT_ORDER_ID);
    expect(mocks.restPlaceOrder).toHaveBeenCalledTimes(1);
    expect(mocks.restPlaceOrder.mock.calls[0][0]).toMatchObject({
      login: 200002,
      symbol: 'BTCUSD',
      side: 'buy',
      volume: 0.01,
      client_order_id: CLIENT_ORDER_ID,
    });
    expect(onNewTrade).toHaveBeenCalledTimes(1);
    expect(onPlacementState.mock.calls.map(([event]) => (event as CustomEvent).detail.status)).toEqual([
      'pending',
      'filled',
    ]);
    const sessionScope = mocks.wsPlaceOrder.mock.calls[0][2]?.sessionScope;
    expect(sessionScope).toEqual(expect.any(String));
    expect(getTradeOrderLatencySamples()).toEqual(expect.arrayContaining([
      expect.objectContaining({ phase: 'rest_started', reason: 'ws_not_ready', sessionScope }),
      expect.objectContaining({ phase: 'rest_completed', reason: 'ws_not_ready', sessionScope, restRttMs: expect.any(Number) }),
    ]));
  });

  it('reconciles a sent WebSocket timeout through GET without creating the order again', async () => {
    vi.useFakeTimers();
    const uncertainError = Object.assign(new Error(
      'The order was sent, but its final status could not be confirmed.',
    ), {
      name: 'TradeSocketTransportError',
      code: 'ORDER_STATUS_TIMEOUT',
      retryable: false,
      orderWasSent: true,
      clientOrderId: CLIENT_ORDER_ID,
    });
    mocks.wsPlaceOrder.mockRejectedValue(uncertainError);
    mocks.restGetOrderCommand
      .mockResolvedValueOnce({
        status: 'processing',
        client_order_id: CLIENT_ORDER_ID,
      })
      .mockResolvedValueOnce({
        status: 'filled',
        client_order_id: CLIENT_ORDER_ID,
        position: restPosition,
      });

    try {
      const placement = api.orders.placeMarketOrder(inputOrder);
      await vi.advanceTimersByTimeAsync(2_000);
      await expect(placement).resolves.toMatchObject({ ticket: 990002 });

      expect(extractWsClientOrderId()).toBe(CLIENT_ORDER_ID);
      expect(mocks.restPlaceOrder).not.toHaveBeenCalled();
      expect(mocks.restGetOrderCommand).toHaveBeenCalledTimes(2);
      expect(mocks.restGetOrderCommand).toHaveBeenCalledWith(CLIENT_ORDER_ID);
      expect(onNewTrade).toHaveBeenCalledOnce();
      expect(onPlacementState.mock.calls.map(([event]) => (event as CustomEvent).detail.status)).toEqual([
        'pending',
        'processing',
        'filled',
      ]);
    } finally {
      vi.useRealTimers();
    }
  });

  it('preserves the backend rejection from GET after a sent WebSocket timeout without creating again', async () => {
    vi.useFakeTimers();
    const uncertainError = Object.assign(new Error(
      'The order was sent, but its final status could not be confirmed.',
    ), {
      name: 'TradeSocketTransportError',
      code: 'ORDER_STATUS_TIMEOUT',
      retryable: false,
      orderWasSent: true,
      clientOrderId: CLIENT_ORDER_ID,
    });
    mocks.wsPlaceOrder.mockRejectedValue(uncertainError);
    mocks.restGetOrderCommand.mockResolvedValue({
      status: 'rejected',
      client_order_id: CLIENT_ORDER_ID,
      error: {
        code: 'NO_FRESH_QUOTE',
        message: 'No fresh BTCUSD quote is available.',
      },
    });

    try {
      const placement = api.orders.placeMarketOrder(inputOrder);
      const rejection = expect(placement).rejects.toMatchObject({
        status: 'rejected',
        code: 'NO_FRESH_QUOTE',
        backendMessage: 'No fresh BTCUSD quote is available.',
      });
      await vi.advanceTimersByTimeAsync(1_000);
      await rejection;

      expect(extractWsClientOrderId()).toBe(CLIENT_ORDER_ID);
      expect(mocks.restPlaceOrder).not.toHaveBeenCalled();
      expect(mocks.restGetOrderCommand).toHaveBeenCalledOnce();
      expect(mocks.restGetOrderCommand).toHaveBeenCalledWith(CLIENT_ORDER_ID);
      expect(onNewTrade).not.toHaveBeenCalled();
      expect(onPlacementState.mock.calls.map(([event]) => (event as CustomEvent).detail.status)).toEqual([
        'pending',
        'processing',
        'rejected',
      ]);
      expect((onPlacementState.mock.calls.at(-1)?.[0] as CustomEvent).detail).toMatchObject({
        errorCode: 'NO_FRESH_QUOTE',
        errorMessage: 'No fresh BTCUSD quote is available.',
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it('expires sent WebSocket reconciliation at the original 30-second deadline', async () => {
    vi.useFakeTimers();
    const uncertainError = Object.assign(new Error(
      'The order was sent, but its final status could not be confirmed.',
    ), {
      name: 'TradeSocketTransportError',
      code: 'ORDER_STATUS_TIMEOUT',
      retryable: false,
      orderWasSent: true,
      clientOrderId: CLIENT_ORDER_ID,
    });
    mocks.wsPlaceOrder.mockImplementation(() => new Promise((_, reject) => {
      setTimeout(() => reject(uncertainError), 20_000);
    }));
    mocks.restGetOrderCommand.mockResolvedValue({
      status: 'processing',
      client_order_id: CLIENT_ORDER_ID,
    });

    try {
      let settled = false;
      const placement = api.orders.placeMarketOrder(inputOrder);
      const terminal = placement.then(
        () => ({ resolved: true as const }),
        (error: unknown) => ({ resolved: false as const, error }),
      ).finally(() => {
        settled = true;
      });

      await vi.advanceTimersByTimeAsync(29_999);
      expect(settled).toBe(false);
      expect(mocks.restPlaceOrder).not.toHaveBeenCalled();

      await vi.advanceTimersByTimeAsync(1);
      await expect(terminal).resolves.toMatchObject({
        resolved: false,
        error: {
          status: 'expired',
          code: 'ORDER_COMMAND_EXPIRED',
          backendMessage: 'No terminal order result arrived before execute_before.',
        },
      });

      expect(extractWsClientOrderId()).toBe(CLIENT_ORDER_ID);
      expect(mocks.restPlaceOrder).not.toHaveBeenCalled();
      expect(mocks.restGetOrderCommand).toHaveBeenCalledTimes(11);
      expect(mocks.restGetOrderCommand).toHaveBeenCalledWith(CLIENT_ORDER_ID);
      expect(onNewTrade).not.toHaveBeenCalled();
      expect(onPlacementState.mock.calls.map(([event]) => (event as CustomEvent).detail.status)).toEqual([
        'pending',
        'processing',
        'expired',
      ]);
      expect((onPlacementState.mock.calls.at(-1)?.[0] as CustomEvent).detail).toMatchObject({
        errorCode: 'ORDER_COMMAND_EXPIRED',
        errorMessage: 'No terminal order result arrived before execute_before.',
      });
      expect(getTradeOrderLatencySamples()).toContainEqual(expect.objectContaining({
        phase: 'placement_terminal',
        transport: 'websocket',
        clientOrderId: CLIENT_ORDER_ID,
        terminalStatus: 'expired',
        errorCode: 'ORDER_COMMAND_EXPIRED',
        errorMessage: 'No terminal order result arrived before execute_before.',
        totalMs: expect.any(Number),
      }));
    } finally {
      vi.useRealTimers();
    }
  });

  it('uses REST immediately when the trade socket is closed', async () => {
    tradeSocket.connectionState = 'closed';
    tradeSocket.readyState = 3;
    mocks.restPlaceOrder.mockResolvedValue(restPosition);

    await expect(api.orders.placeMarketOrder(inputOrder)).resolves.toEqual(restPosition);

    expect(mocks.wsPlaceOrder).not.toHaveBeenCalled();
    expect(mocks.restPlaceOrder.mock.calls[0][0]).toMatchObject({
      login: 200002,
      client_order_id: CLIENT_ORDER_ID,
    });
    expect(onNewTrade).toHaveBeenCalledTimes(1);
    expect(getTradeOrderLatencySamples()).toEqual(expect.arrayContaining([
      expect.objectContaining({ phase: 'rest_started', reason: 'socket_not_ready' }),
      expect.objectContaining({ phase: 'rest_completed', reason: 'socket_not_ready', restRttMs: expect.any(Number) }),
    ]));
  });

  it('keeps fields outside the fixed WebSocket contract on REST without dropping them', async () => {
    mocks.restPlaceOrder.mockResolvedValue(restPosition);

    const restOnlyOrder = {
      ...inputOrder,
      comment: 'advanced protection',
      trailing_stop: 25,
      trailing_step: 5,
      magic: 8675309,
    };
    await expect(api.orders.placeMarketOrder(restOnlyOrder)).resolves.toEqual(restPosition);

    expect(mocks.wsPlaceOrder).not.toHaveBeenCalled();
    expect(mocks.restPlaceOrder).toHaveBeenCalledTimes(1);
    expect(mocks.restPlaceOrder.mock.calls[0][0]).toMatchObject({
      ...restOnlyOrder,
      client_order_id: CLIENT_ORDER_ID,
    });
    expect(onNewTrade).toHaveBeenCalledTimes(1);
  });

  it('surfaces a terminal business rejection and never retries it through REST', async () => {
    const businessError = Object.assign(new Error('Quote is stale for BTCUSD'), {
      name: 'TradeSocketOrderRejectedError',
      code: 'QUOTE_STALE',
      retryable: false,
      clientOrderId: CLIENT_ORDER_ID,
    });
    mocks.wsPlaceOrder.mockRejectedValue(businessError);

    await expect(api.orders.placeMarketOrder(inputOrder)).rejects.toThrow('Quote is stale for BTCUSD');

    expect(mocks.restPlaceOrder).not.toHaveBeenCalled();
    expect(onNewTrade).not.toHaveBeenCalled();
    expect(onPlacementState.mock.calls.map(([event]) => (event as CustomEvent).detail.status)).toEqual([
      'pending',
      'rejected',
    ]);
    expect((onPlacementState.mock.calls.at(-1)?.[0] as CustomEvent).detail).toMatchObject({
      errorCode: 'QUOTE_STALE',
      errorMessage: 'Quote is stale for BTCUSD',
    });
    expect(getTradeOrderLatencySamples()).toContainEqual(expect.objectContaining({
      phase: 'placement_terminal',
      transport: 'websocket',
      clientOrderId: CLIENT_ORDER_ID,
      terminalStatus: 'rejected',
      errorCode: 'QUOTE_STALE',
      errorMessage: 'Quote is stale for BTCUSD',
      totalMs: expect.any(Number),
    }));
  });

  it('records a terminal latency when the final REST attempt fails', async () => {
    tradeSocket.connectionState = 'closed';
    tradeSocket.readyState = 3;
    mocks.restPlaceOrder.mockRejectedValue(Object.assign(new Error('Gateway unavailable'), {
      code: 'HTTP_503',
    }));

    await expect(api.orders.placeMarketOrder(inputOrder)).rejects.toThrow('Gateway unavailable');

    expect(onPlacementState.mock.calls.map(([event]) => (event as CustomEvent).detail.status)).toEqual([
      'pending',
      'failed',
    ]);
    expect(getTradeOrderLatencySamples()).toContainEqual(expect.objectContaining({
      phase: 'placement_terminal',
      transport: 'rest',
      clientOrderId: CLIENT_ORDER_ID,
      terminalStatus: 'failed',
      errorCode: 'HTTP_503',
      errorMessage: 'Gateway unavailable',
      totalMs: expect.any(Number),
    }));
  });

  it('polls an accepted REST command until filled without publishing a fake position early', async () => {
    vi.useFakeTimers();
    tradeSocket.connectionState = 'closed';
    tradeSocket.readyState = 3;
    mocks.restPlaceOrder.mockResolvedValue({
      status: 'accepted',
      client_order_id: CLIENT_ORDER_ID,
      execute_before: Date.now() + 30_000,
    });
    mocks.restGetOrderCommand
      .mockResolvedValueOnce({
        status: 'processing',
        client_order_id: CLIENT_ORDER_ID,
        execute_before: Date.now() + 30_000,
      })
      .mockResolvedValueOnce({
        status: 'filled',
        client_order_id: CLIENT_ORDER_ID,
        position: restPosition,
      });

    try {
      const placement = api.orders.placeMarketOrder(inputOrder);
      await vi.advanceTimersByTimeAsync(0);
      expect(onNewTrade).not.toHaveBeenCalled();
      expect(onPlacementState.mock.calls.map(([event]) => (event as CustomEvent).detail.status)).toEqual([
        'pending',
        'accepted',
      ]);

      await vi.advanceTimersByTimeAsync(2_000);
      await expect(placement).resolves.toMatchObject({ ticket: 990002 });
      expect(mocks.restPlaceOrder).toHaveBeenCalledOnce();
      expect(mocks.restGetOrderCommand).toHaveBeenCalledTimes(2);
      expect(onNewTrade).toHaveBeenCalledOnce();
      expect(onPlacementState.mock.calls.map(([event]) => (event as CustomEvent).detail.status)).toEqual([
        'pending',
        'accepted',
        'processing',
        'filled',
      ]);
    } finally {
      vi.useRealTimers();
    }
  });

  it('separates the REST response duration from the terminal polling duration', async () => {
    vi.useFakeTimers();
    const startedAt = Date.now();
    vi.spyOn(performance, 'now').mockImplementation(() => Date.now() - startedAt);
    tradeSocket.connectionState = 'closed';
    mocks.restPlaceOrder.mockImplementation(() => new Promise((resolve) => {
      setTimeout(() => resolve({ status: 'accepted', client_order_id: CLIENT_ORDER_ID }), 40);
    }));
    mocks.restGetOrderCommand.mockResolvedValue({
      status: 'filled', client_order_id: CLIENT_ORDER_ID, position: restPosition,
    });

    try {
      const placement = api.orders.placeMarketOrder(inputOrder);
      await vi.advanceTimersByTimeAsync(40);
      expect(getTradeOrderLatencySamples()).toContainEqual(expect.objectContaining({
        phase: 'rest_response', restRttMs: 40,
      }));
      expect(onNewTrade).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(1_000);
      await expect(placement).resolves.toMatchObject({ ticket: 990002 });
      expect(getTradeOrderLatencySamples()).toContainEqual(expect.objectContaining({
        phase: 'rest_completed', restRttMs: 1_040,
      }));
    } finally {
      vi.useRealTimers();
    }
  });

  it('recovers actual backend transport-error frames immediately without a second create', async () => {
    vi.useFakeTimers();
    const socket = new RecoveryWebSocket();
    vi.stubGlobal('WebSocket', class { constructor() { return socket; } });
    const client = new TradeWebSocketClient({
      url: 'wss://test.invalid/ws/v2', token: 'test-token', reconnect: false,
    });
    mocks.getTradeWebSocketClient.mockReturnValue(client);
    mocks.restGetOrderCommand.mockResolvedValue({
      status: 'filled', client_order_id: CLIENT_ORDER_ID, position: restPosition,
    });

    try {
      client.connect();
      socket.open();
      const placement = api.orders.placeMarketOrder(inputOrder);
      const create = socket.sent.find((frame) => frame.action === 'place_order')!;
      expect(create).toBeDefined();
      socket.emit({
        type: 'order_error', request_id: create.request_id,
        client_order_id: CLIENT_ORDER_ID,
        error: { code: 'EXECUTION_UNCERTAIN', message: 'Check command status.' },
      });
      expect(socket.sent.filter((frame) => frame.action === 'get_order_status')).toHaveLength(1);
      socket.emit({
        type: 'order_status_error', request_id: create.request_id,
        client_order_id: CLIENT_ORDER_ID,
        error: { code: 'STATUS_UNAVAILABLE', message: 'Status read failed.' },
      });
      // No advance to the old 10-second timers, or to a one-second GET delay.
      await vi.advanceTimersByTimeAsync(0);
      await expect(placement).resolves.toMatchObject({ ticket: 990002 });
      expect(mocks.restGetOrderCommand).toHaveBeenCalledExactlyOnceWith(CLIENT_ORDER_ID);
      expect(mocks.restPlaceOrder).not.toHaveBeenCalled();
      expect(socket.sent.filter((frame) => frame.action === 'place_order')).toHaveLength(1);
      expect(onNewTrade).toHaveBeenCalledOnce();
    } finally {
      client.disconnect();
      vi.unstubAllGlobals();
      vi.useRealTimers();
    }
  });

  it('ignores retryable rejections and malformed fills during REST recovery until a valid late fill arrives', async () => {
    vi.useFakeTimers();
    const socket = new RecoveryWebSocket();
    vi.stubGlobal('WebSocket', class { constructor() { return socket; } });
    const client = new TradeWebSocketClient({
      url: 'wss://test.invalid/ws/v2', token: 'test-token', reconnect: false,
    });
    mocks.getTradeWebSocketClient.mockReturnValue(client);
    let rejectStatus!: (error: Error) => void;
    mocks.restGetOrderCommand.mockImplementation(() => new Promise((_, reject) => {
      rejectStatus = reject;
    }));

    try {
      client.connect();
      socket.open();
      const placement = api.orders.placeMarketOrder(inputOrder);
      let settled = false;
      void placement.then(() => { settled = true; }, () => { settled = true; });
      const create = socket.sent.find((frame) => frame.action === 'place_order')!;
      socket.emit({
        type: 'order_status_error', request_id: create.request_id,
        client_order_id: CLIENT_ORDER_ID,
        error: { code: 'STATUS_UNAVAILABLE', message: 'Status read failed.' },
      });
      await vi.advanceTimersByTimeAsync(0);
      expect(mocks.restGetOrderCommand).toHaveBeenCalledOnce();

      const fill = {
        type: 'order_filled', status: 'filled', success: true,
        request_id: create.request_id, client_order_id: CLIENT_ORDER_ID, data: filledData,
      };
      socket.emit({ ...fill, request_id: 'unrelated-request' });
      await vi.advanceTimersByTimeAsync(100);
      socket.emit({
        type: 'order_rejected', status: 'rejected',
        request_id: create.request_id, client_order_id: CLIENT_ORDER_ID,
        error: { code: 'SERVICE_UNAVAILABLE', message: 'Execution state is temporarily unavailable.' },
      });
      for (const data of [undefined, null, [], 'invalid', 0]) {
        socket.emit({ ...fill, data });
      }
      await vi.advanceTimersByTimeAsync(0);
      expect(settled).toBe(false);
      expect(mocks.restGetOrderCommand).toHaveBeenCalledOnce();
      expect(onNewTrade).not.toHaveBeenCalled();
      socket.emit(fill);
      await vi.advanceTimersByTimeAsync(0);
      await expect(placement).resolves.toMatchObject({ ticket: 990001, price_open: 65321.45 });
      expect(onNewTrade).toHaveBeenCalledOnce();

      rejectStatus(new Error('late failed status read'));
      socket.emit(fill);
      await vi.advanceTimersByTimeAsync(10_000);
      expect(mocks.restGetOrderCommand).toHaveBeenCalledOnce();
      expect(mocks.restPlaceOrder).not.toHaveBeenCalled();
      expect(onNewTrade).toHaveBeenCalledOnce();
      expect(socket.sent.filter((frame) => frame.action === 'place_order')).toHaveLength(1);
    } finally {
      client.disconnect();
      vi.unstubAllGlobals();
      vi.useRealTimers();
    }
  });

  it('preserves an actual expired WebSocket command without REST retries', async () => {
    vi.useFakeTimers();
    const socket = new RecoveryWebSocket();
    vi.stubGlobal('WebSocket', class { constructor() { return socket; } });
    const client = new TradeWebSocketClient({
      url: 'wss://test.invalid/ws/v2', token: 'test-token', reconnect: false,
    });
    mocks.getTradeWebSocketClient.mockReturnValue(client);

    try {
      client.connect();
      socket.open();
      const placement = api.orders.placeMarketOrder(inputOrder);
      const rejection = expect(placement).rejects.toMatchObject({
        status: 'expired', code: 'ORDER_COMMAND_EXPIRED',
      });
      const create = socket.sent.find((frame) => frame.action === 'place_order')!;
      socket.emit({
        type: 'order_rejected', status: 'expired', request_id: create.request_id,
        client_order_id: CLIENT_ORDER_ID,
        error: { code: 'ORDER_COMMAND_EXPIRED', message: 'Execution deadline elapsed.' },
      });
      await rejection;
      expect(mocks.restPlaceOrder).not.toHaveBeenCalled();
      expect(mocks.restGetOrderCommand).not.toHaveBeenCalled();
      expect((onPlacementState.mock.calls.at(-1)?.[0] as CustomEvent).detail.status).toBe('expired');
      expect(getTradeOrderLatencySamples()).toContainEqual(expect.objectContaining({
        phase: 'placement_terminal', terminalStatus: 'expired',
      }));
    } finally {
      client.disconnect();
      vi.unstubAllGlobals();
      vi.useRealTimers();
    }
  });

  it('keeps the backend rejection code and message on the terminal lifecycle event', async () => {
    vi.useFakeTimers();
    tradeSocket.connectionState = 'closed';
    tradeSocket.readyState = 3;
    mocks.restPlaceOrder.mockResolvedValue({
      status: 'accepted',
      client_order_id: CLIENT_ORDER_ID,
    });
    mocks.restGetOrderCommand.mockResolvedValue({
      status: 'rejected',
      client_order_id: CLIENT_ORDER_ID,
      error: {
        code: 'NO_FRESH_QUOTE',
        message: 'No fresh BTCUSD quote is available.',
      },
    });

    try {
      const placement = api.orders.placeMarketOrder(inputOrder);
      const rejection = expect(placement).rejects.toMatchObject({
        status: 'rejected',
        code: 'NO_FRESH_QUOTE',
        backendMessage: 'No fresh BTCUSD quote is available.',
      });
      await vi.advanceTimersByTimeAsync(1_000);
      await rejection;
      expect(mocks.restPlaceOrder).toHaveBeenCalledOnce();
      expect(onNewTrade).not.toHaveBeenCalled();
      expect((onPlacementState.mock.calls.at(-1)?.[0] as CustomEvent).detail).toMatchObject({
        status: 'rejected',
        errorCode: 'NO_FRESH_QUOTE',
        errorMessage: 'No fresh BTCUSD quote is available.',
      });
      expect(getTradeOrderLatencySamples()).toContainEqual(expect.objectContaining({
        phase: 'placement_terminal',
        transport: 'rest',
        clientOrderId: CLIENT_ORDER_ID,
        terminalStatus: 'rejected',
        errorCode: 'NO_FRESH_QUOTE',
        errorMessage: 'No fresh BTCUSD quote is available.',
        totalMs: expect.any(Number),
      }));
    } finally {
      vi.useRealTimers();
    }
  });
});
