import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getTradeWebSocketClient: vi.fn(),
  wsPlaceOrder: vi.fn(),
  restPlaceOrder: vi.fn(),
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
    },
  };
});

import { api } from './api';
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

let tradeSocket: TradeSocketStub;
let onNewTrade: ReturnType<typeof vi.fn>;
let onPlacementState: ReturnType<typeof vi.fn>;

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
    localStorage.clear();
    clearTradeOrderLatencySamples();

    tradeSocket = {
      connectionState: 'open',
      readyState: 1,
      isConnected: () => tradeSocket.connectionState === 'open',
      placeOrder: mocks.wsPlaceOrder,
    };
    mocks.getTradeWebSocketClient.mockReturnValue(tradeSocket);
    vi.spyOn(globalThis.crypto, 'randomUUID').mockReturnValue(CLIENT_ORDER_ID);

    onNewTrade = vi.fn();
    onPlacementState = vi.fn();
    window.addEventListener('rtx:new-trade-placed', onNewTrade);
    window.addEventListener(MARKET_ORDER_PLACEMENT_STATE_EVENT, onPlacementState);
  });

  afterEach(() => {
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
      },
    });
    expect(placementDetails[0].provisionalTicket).toBeLessThan(0);
    expect(placementDetails[1]).toMatchObject({
      status: 'confirmed',
      clientOrderId: CLIENT_ORDER_ID,
      position: result,
    });
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
      expect(events).toEqual(['transport-started', 'pending', 'confirmed']);
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

  it('falls back after a retryable transport failure with the exact same client_order_id', async () => {
    const transportError = Object.assign(new Error('Trade socket closed before the order completed'), {
      name: 'TradeSocketTransportError',
      retryable: true,
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
      'confirmed',
    ]);
    const sessionScope = mocks.wsPlaceOrder.mock.calls[0][2]?.sessionScope;
    expect(sessionScope).toEqual(expect.any(String));
    expect(getTradeOrderLatencySamples()).toEqual(expect.arrayContaining([
      expect.objectContaining({ phase: 'rest_started', reason: 'ws_transport_failure', sessionScope }),
      expect.objectContaining({ phase: 'rest_completed', reason: 'ws_transport_failure', sessionScope, restRttMs: expect.any(Number) }),
    ]));
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
      'failed',
    ]);
  });
});
