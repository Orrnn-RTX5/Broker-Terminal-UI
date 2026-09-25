// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  enqueueLiveTick: vi.fn(),
}));

vi.mock('./liveTickDispatcher', () => ({
  enqueueLiveTick: mocks.enqueueLiveTick,
}));

import {
  destroyWebSocketService,
  ENHANCED_WS_OPEN_TIMEOUT_MS,
  ENHANCED_WS_STABLE_OPEN_MS,
  EnhancedWebSocketService,
  getEnhancedWebSocketService,
  isExactAccountStreamChannel,
  isEnhancedStoreHandledTickFrame,
  releaseEnhancedWebSocketService,
  type WebSocketMessage,
} from './websocket-enhanced';
import { emitSessionChange } from './brokerSession';
import { useAppStore } from '../store/useAppStore';

type TestableService = {
  handleMessage: (message: WebSocketMessage) => void;
  sendPing: () => void;
};

class ConnectingWebSocket {
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSING = 2;
  static CLOSED = 3;
  static instances: ConnectingWebSocket[] = [];

  readyState = ConnectingWebSocket.CONNECTING;
  onopen: ((event: Event) => void) | null = null;
  onmessage: ((event: MessageEvent) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;
  onclose: ((event: CloseEvent) => void) | null = null;
  sent: string[] = [];
  closedWith: { code?: number; reason?: string } | null = null;

  constructor(public readonly url: string) {
    ConnectingWebSocket.instances.push(this);
  }

  send(payload: string): void {
    this.sent.push(payload);
  }

  open(): void {
    this.readyState = ConnectingWebSocket.OPEN;
    this.onopen?.(new Event('open'));
  }

  close(code?: number, reason?: string): void {
    this.readyState = ConnectingWebSocket.CLOSED;
    this.closedWith = { code, reason };
  }

  emitClose(code = 1006, reason = 'synthetic close'): void {
    this.readyState = ConnectingWebSocket.CLOSED;
    this.onclose?.({ code, reason } as CloseEvent);
  }
}

const originalVisibilityStateDescriptor = Object.getOwnPropertyDescriptor(document, 'visibilityState');

const setVisibilityState = (state: DocumentVisibilityState): void => {
  Object.defineProperty(document, 'visibilityState', {
    configurable: true,
    value: state,
  });
};

describe('EnhancedWebSocketService tick normalization', () => {
  beforeEach(() => {
    mocks.enqueueLiveTick.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('enqueues a direct tick once without changing repeated BTC prices', () => {
    const service = new EnhancedWebSocketService('wss://example.test/ws/v2');
    const message: WebSocketMessage = {
      type: 'tick',
      symbol: 'BTCUSD',
      bid: 78_900.25,
      ask: 78_912.75,
      daily_change_pct: -0.64,
      timestamp: 1_725_000_000,
    };

    expect(isEnhancedStoreHandledTickFrame(message)).toBe(true);
    (service as unknown as TestableService).handleMessage(message);
    (service as unknown as TestableService).handleMessage(message);

    expect(mocks.enqueueLiveTick).toHaveBeenCalledTimes(2);
    expect(mocks.enqueueLiveTick.mock.calls.map(([, tick]) => ({
      bid: tick.bid,
      ask: tick.ask,
    }))).toEqual([
      { bid: 78_900.25, ask: 78_912.75 },
      { bid: 78_900.25, ask: 78_912.75 },
    ]);
    expect(mocks.enqueueLiveTick.mock.calls[0][1]).toMatchObject({
      dailyChange: -0.64,
      timestamp: 1_725_000_000_000,
      sourceTimestamp: 1_725_000_000_000,
    });

    service.destroy();
  });

  it('normalizes optional quote aliases without fabricating volume', () => {
    const service = new EnhancedWebSocketService('wss://example.test/ws/v2');

    (service as unknown as TestableService).handleMessage({
      type: 'tick',
      symbol: 'XAUUSD',
      bid: 4_411.09,
      ask: 4_411.2,
      high_24h: 4_430.5,
      low_24h: 4_390.25,
      last_price: 4_411.15,
      volume_24h: 12_345,
      liquidity_provider: ' Prime LP ',
      daily_open: 4_400,
      previous_close: 4_398,
      timestamp: 1_725_000_000,
    });

    expect(mocks.enqueueLiveTick).toHaveBeenCalledWith('XAUUSD', expect.objectContaining({
      high24h: 4_430.5,
      low24h: 4_390.25,
      last: 4_411.15,
      volume: 12_345,
      lp: 'Prime LP',
      open: 4_400,
      close: 4_398,
    }));

    mocks.enqueueLiveTick.mockClear();
    (service as unknown as TestableService).handleMessage({
      type: 'tick',
      symbol: 'XAUUSD',
      bid: 4_411.1,
      ask: 4_411.21,
      timestamp: 1_725_000_001,
    });

    expect(mocks.enqueueLiveTick.mock.calls[0][1].volume).toBeUndefined();
    service.destroy();
  });

  it('enqueues a suffixed channel tick exactly once and preserves envelope broker time', () => {
    const service = new EnhancedWebSocketService('wss://example.test/ws/v2');

    (service as unknown as TestableService).handleMessage({
      type: 'channel_message',
      channel: 'ticks.EURUSD.pro',
      timestamp: 1_725_000_000,
      data: {
        // Some gateways return the base alias inside the exact suffixed channel.
        symbol: 'EURUSD',
        bid: 1.10203,
        ask: 1.10215,
        daily_change_pct: 0.08,
      },
    });

    expect(mocks.enqueueLiveTick).toHaveBeenCalledTimes(1);
    expect(mocks.enqueueLiveTick).toHaveBeenCalledWith('EURUSD.PRO', expect.objectContaining({
      symbol: 'EURUSD.PRO',
      bid: 1.10203,
      ask: 1.10215,
      dailyChange: 0.08,
      timestamp: 1_725_000_000_000,
      sourceTimestamp: 1_725_000_000_000,
    }));

    service.destroy();
  });

  it('uses local receipt time without fabricating broker source time', () => {
    vi.spyOn(Date, 'now').mockReturnValue(1_777_000_000_123);
    const service = new EnhancedWebSocketService('wss://example.test/ws/v2');

    (service as unknown as TestableService).handleMessage({
      type: 'tick',
      symbol: 'ETHUSD',
      bid: 4_600.1,
      ask: 4_601.2,
    });

    expect(mocks.enqueueLiveTick).toHaveBeenCalledOnce();
    expect(mocks.enqueueLiveTick.mock.calls[0][1]).toMatchObject({
      timestamp: 1_777_000_000_123,
      sourceTimestamp: undefined,
    });
    service.destroy();
  });

  it.each([
    ['timestamp_us', 1_788_176_700_123_456, 1_788_176_700_123],
    ['time_ns', 1_788_176_701_456_000_000, 1_788_176_701_456],
    ['event_time', '2026-09-04T08:11:40.123Z', 1_788_509_500_123],
  ])('normalizes %s broker source time without changing its identity', (key, value, expected) => {
    const service = new EnhancedWebSocketService('wss://example.test/ws/v2');
    (service as unknown as TestableService).handleMessage({
      type: 'tick',
      symbol: 'NAS100-F',
      bid: 25_100,
      ask: 25_101,
      [key]: value,
    });

    expect(mocks.enqueueLiveTick).toHaveBeenCalledWith('NAS100-F', expect.objectContaining({
      timestamp: expected,
      sourceTimestamp: expected,
    }));
    service.destroy();
  });

  it('leaves legacy and malformed quote frames for App normalization', () => {
    expect(isEnhancedStoreHandledTickFrame({
      type: 'tick', symbol: 'BTCUSD', price: 78_900,
    })).toBe(false);
    expect(isEnhancedStoreHandledTickFrame({
      type: 'channel_message', channel: 'quotes.BTCUSD', data: { bid: 1, ask: 2 },
    })).toBe(false);
    expect(isEnhancedStoreHandledTickFrame({
      type: 'channel_message', channel: 'prices', data: { bid: 1, ask: 2 },
    })).toBe(false);
    expect(isEnhancedStoreHandledTickFrame({
      type: 'update', symbol: 'BTCUSD', bid: 1, ask: 2,
    })).toBe(false);
    expect(isEnhancedStoreHandledTickFrame({
      type: 'channel_message', channel: 'ticks.BTCUSD', data: { bid: 1 },
    })).toBe(false);
  });

  it('accepts account-scoped channels only for the exact active login', () => {
    expect(isExactAccountStreamChannel('positions.200001', 'positions', '200001')).toBe(true);
    expect(isExactAccountStreamChannel('positions.200002', 'positions', '200001')).toBe(false);
    expect(isExactAccountStreamChannel('positions.200001.old', 'positions', '200001')).toBe(false);
    expect(isExactAccountStreamChannel('positions.', 'positions', '200001')).toBe(false);
    expect(isExactAccountStreamChannel('account.200001', 'account', 200001)).toBe(true);
    expect(isExactAccountStreamChannel('account.200002', 'account', 200001)).toBe(false);
  });
});

describe('EnhancedWebSocketService trade state ownership', () => {
  it('forwards backend envelopes without asynchronously overwriting the account consumer', async () => {
    const service = new EnhancedWebSocketService('wss://example.test/ws/v2');
    const consumerAccount = { balance: 500, equity: 523, margin: 10, freeMargin: 513,
      marginLevel: 5230, unrealizedPL: 23, currency: 'EUR', leverage: 200 };
    const consumerPosition = { id: 42, symbol: 'BTCUSD', side: 'BUY' as const, volume: 1,
      openPrice: 100, currentPrice: 123, openTime: '', sl: 0, tp: 0, swap: 0,
      commission: 0, unrealizedPnL: 23, profit: 23, state_version: '90071992547409931' };
    useAppStore.setState({ accountId: '200001', account: null, positions: [] });
    const received: WebSocketMessage[] = [];
    service.subscribe('*', message => {
      received.push(message as WebSocketMessage);
      useAppStore.getState().setAccount(consumerAccount);
      useAppStore.getState().setPositions([consumerPosition]);
    });
    const frames: WebSocketMessage[] = [
      { type: 'channel_message', channel: 'account.200001', data: { balance: 1, equity: 2 } },
      { type: 'channel_message', channel: 'positions.200001', data: { positions: [{ ticket: 99, symbol: 'EURUSD', volume: 1 }] } },
      { channel: 'metrics.200001', data: { type: 'metrics_update', data: { equity: 523 } } },
      { channel: 'positions.200001', data: { type: 'position_update', data: [{ ticket: 42, profit: 23 }] } },
    ];
    for (const frame of frames) (service as unknown as TestableService).handleMessage(frame);
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(received).toEqual(frames);
    expect(useAppStore.getState().account).toEqual(consumerAccount);
    // The store normalizes merged rows (wire aliases, P&L availability); only
    // the consumer's row may be present, carrying the consumer's values.
    expect(useAppStore.getState().positions).toMatchObject([consumerPosition]);
    service.destroy();
    useAppStore.setState({ account: null, positions: [], accountId: null });
  });
});

describe('EnhancedWebSocketService connection startup', () => {
  beforeEach(() => {
    ConnectingWebSocket.instances = [];
    localStorage.clear();
    sessionStorage.clear();
    localStorage.setItem('auth_token', 'test-token');
    setVisibilityState('visible');
    vi.spyOn(Math, 'random').mockReturnValue(0);
    vi.stubGlobal('WebSocket', ConnectingWebSocket);
  });

  afterEach(() => {
    destroyWebSocketService();
    vi.useRealTimers();
    localStorage.clear();
    sessionStorage.clear();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    if (originalVisibilityStateDescriptor) {
      Object.defineProperty(document, 'visibilityState', originalVisibilityStateDescriptor);
    } else {
      delete (document as { visibilityState?: DocumentVisibilityState }).visibilityState;
    }
  });

  it('reuses the socket while the first connection is still in progress', () => {
    const service = new EnhancedWebSocketService('wss://example.test/ws/v2');

    service.connect();
    service.connect();

    expect(ConnectingWebSocket.instances).toHaveLength(1);
    expect(ConnectingWebSocket.instances[0].readyState).toBe(ConnectingWebSocket.CONNECTING);

    service.destroy();
  });

  it('authenticates with the canonical sessionStorage token when localStorage is empty', () => {
    localStorage.removeItem('auth_token');
    sessionStorage.setItem('auth_token', 'session-only-token');
    const service = new EnhancedWebSocketService('wss://example.test/ws/v2');

    service.connect();

    expect(ConnectingWebSocket.instances).toHaveLength(1);
    expect(new URL(ConnectingWebSocket.instances[0].url).searchParams.get('token'))
      .toBe('session-only-token');

    service.destroy();
  });

  it('sends an action-compatible ping without closing an endpoint that never advertised pong support', () => {
    vi.useFakeTimers();
    const service = new EnhancedWebSocketService('wss://example.test/ws/v2');

    service.connect();
    const socket = ConnectingWebSocket.instances[0];
    socket.open();
    (service as unknown as TestableService).sendPing();

    expect(JSON.parse(socket.sent.at(-1) ?? '{}')).toMatchObject({
      action: 'ping',
      type: 'ping',
    });
    vi.advanceTimersByTime(60_000);

    expect(socket.readyState).toBe(ConnectingWebSocket.OPEN);
    expect(socket.closedWith).toBeNull();
    expect(ConnectingWebSocket.instances).toHaveLength(1);

    service.destroy();
  });

  it.each(['action', 'type'] as const)(
    'normalizes a pong carried by the %s field and clears its next deadline',
    (pongField) => {
      vi.useFakeTimers();
      const service = new EnhancedWebSocketService('wss://example.test/ws/v2');

      service.connect();
      const socket = ConnectingWebSocket.instances[0];
      socket.open();

      // First pong proves that this endpoint supports the optional heartbeat.
      (service as unknown as TestableService).sendPing();
      (service as unknown as TestableService).handleMessage({ [pongField]: 'pong' });

      // The next ping now owns a deadline, which either response shape clears.
      (service as unknown as TestableService).sendPing();
      vi.advanceTimersByTime(14_999);
      (service as unknown as TestableService).handleMessage({ [pongField]: 'PONG' });
      vi.advanceTimersByTime(1);

      expect(socket.readyState).toBe(ConnectingWebSocket.OPEN);
      expect(socket.closedWith).toBeNull();

      service.destroy();
    },
  );

  it('closes and reconnects when a pong-capable endpoint later misses its heartbeat deadline', () => {
    vi.useFakeTimers();
    const service = new EnhancedWebSocketService('wss://example.test/ws/v2');
    const states: string[] = [];
    service.onStateChange((state) => states.push(state));

    service.connect();
    const socket = ConnectingWebSocket.instances[0];
    socket.open();
    (service as unknown as TestableService).sendPing();
    (service as unknown as TestableService).handleMessage({ action: 'pong' });
    (service as unknown as TestableService).sendPing();

    vi.advanceTimersByTime(14_999);
    expect(socket.readyState).toBe(ConnectingWebSocket.OPEN);

    vi.advanceTimersByTime(1);
    expect(socket.closedWith).toEqual({
      code: 4000,
      reason: 'WebSocket heartbeat timeout',
    });
    expect(states).toContain('disconnected');
    expect(states).toContain('reconnecting');

    vi.advanceTimersByTime(1_000);
    expect(ConnectingWebSocket.instances).toHaveLength(2);

    service.destroy();
  });

  it('keeps latency unknown until a real ping/pong RTT is measured', () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_788_509_500_000);
    const service = new EnhancedWebSocketService('wss://example.test/ws/v2');

    service.connect();
    ConnectingWebSocket.instances[0].open();
    expect(service.getMetrics()).toMatchObject({ lastLatency: 0, averageLatency: 0 });

    (service as unknown as TestableService).handleMessage({
      type: 'tick', symbol: 'EURUSD', bid: 1.1, ask: 1.2, timestamp: 1_788_509_500,
    });
    expect(service.getMetrics()).toMatchObject({ lastLatency: 0, averageLatency: 0 });

    (service as unknown as TestableService).sendPing();
    vi.advanceTimersByTime(37);
    (service as unknown as TestableService).handleMessage({ action: 'pong', data: { timestamp: 1_788_509_500_000 } });
    expect(service.getMetrics()).toMatchObject({ lastLatency: 37, averageLatency: 37 });
    service.destroy();
  });

  it('suspends a live pong deadline while hidden and resubscribes after foreground', () => {
    vi.useFakeTimers();
    const service = new EnhancedWebSocketService('wss://example.test/ws/v2');
    service.subscribe('ticks.EURUSD.r', vi.fn());
    service.connect();
    const socket = ConnectingWebSocket.instances[0];
    socket.open();

    (service as unknown as TestableService).sendPing();
    (service as unknown as TestableService).handleMessage({ action: 'pong' });
    (service as unknown as TestableService).sendPing();
    setVisibilityState('hidden');
    document.dispatchEvent(new Event('visibilitychange'));
    vi.advanceTimersByTime(60_000);
    expect(socket.readyState).toBe(ConnectingWebSocket.OPEN);

    setVisibilityState('visible');
    document.dispatchEvent(new Event('visibilitychange'));
    expect(ConnectingWebSocket.instances).toHaveLength(2);
    ConnectingWebSocket.instances[1].open();
    expect(ConnectingWebSocket.instances[1].sent.map((message) => JSON.parse(message))).toContainEqual({
      action: 'subscribe',
      channel: 'ticks.EURUSD.r',
      channels: ['ticks.EURUSD.r'],
    });
    service.destroy();
  });

  it('keeps the wildcard listener local and never subscribes the server to every channel', () => {
    const service = new EnhancedWebSocketService('wss://example.test/ws/v2');
    service.connect();
    const socket = ConnectingWebSocket.instances[0];
    socket.open();
    const wildcard = vi.fn();

    const unsubscribeWildcard = service.subscribe('*', wildcard);
    service.subscribe('ticks.EURUSD', vi.fn());
    const sent = socket.sent.map((payload) => JSON.parse(payload));
    expect(sent.some((message) => message.channel === '*' || message.channels?.includes('*'))).toBe(false);
    expect(sent).toContainEqual({ action: 'subscribe', channel: 'ticks.EURUSD', channels: ['ticks.EURUSD'] });

    (service as unknown as TestableService).handleMessage({
      type: 'channel_message', channel: 'state.123', data: { entity: 'groups' },
    } as WebSocketMessage);
    expect(wildcard).toHaveBeenCalled();

    unsubscribeWildcard();
    expect(socket.sent.map((payload) => JSON.parse(payload))
      .some((message) => message.channel === '*')).toBe(false);
    service.destroy();
  });

  it('does not reconnect a destroyed service after later session-change events', () => {
    vi.useFakeTimers();
    const service = new EnhancedWebSocketService('wss://example.test/ws/v2');

    service.connect();
    const ownedSocket = ConnectingWebSocket.instances[0];
    service.destroy();

    emitSessionChange('token_rotation');
    emitSessionChange('login');
    vi.runOnlyPendingTimers();

    expect(ownedSocket.readyState).toBe(ConnectingWebSocket.CLOSED);
    expect(ConnectingWebSocket.instances).toHaveLength(1);
  });

  it('keeps independently URL-keyed services alive at the same time', () => {
    const firstUrl = 'wss://one.example.test/ws/v2';
    const secondUrl = 'wss://two.example.test/ws/v2';
    const first = getEnhancedWebSocketService(firstUrl);
    const second = getEnhancedWebSocketService(secondUrl);

    expect(first).not.toBe(second);
    first.connect();
    const firstSocket = ConnectingWebSocket.instances[0];
    second.connect();

    expect(ConnectingWebSocket.instances).toHaveLength(2);
    expect(firstSocket.readyState).toBe(ConnectingWebSocket.CONNECTING);
    expect(new URL(ConnectingWebSocket.instances[0].url).host).toBe('one.example.test');
    expect(new URL(ConnectingWebSocket.instances[1].url).host).toBe('two.example.test');
    expect(getEnhancedWebSocketService(firstUrl)).toBe(first);
    expect(getEnhancedWebSocketService(secondUrl)).toBe(second);
  });

  it('evicts an abandoned URL-keyed service but preserves a shared consumer', async () => {
    const abandonedUrl = 'wss://abandoned.example.test/ws/v2';
    const sharedUrl = 'wss://shared.example.test/ws/v2';
    const abandoned = getEnhancedWebSocketService(abandonedUrl);
    const shared = getEnhancedWebSocketService(sharedUrl);
    const unsubscribe = shared.subscribe('ticks.EURUSD', vi.fn());

    abandoned.connect();
    shared.connect();
    releaseEnhancedWebSocketService(abandoned);
    releaseEnhancedWebSocketService(shared);
    await Promise.resolve();

    expect(ConnectingWebSocket.instances[0].readyState).toBe(ConnectingWebSocket.CLOSED);
    expect(ConnectingWebSocket.instances[1].readyState).toBe(ConnectingWebSocket.CONNECTING);
    expect(getEnhancedWebSocketService(abandonedUrl)).not.toBe(abandoned);
    expect(getEnhancedWebSocketService(sharedUrl)).toBe(shared);

    unsubscribe();
    releaseEnhancedWebSocketService(shared);
    await Promise.resolve();
    expect(ConnectingWebSocket.instances[1].readyState).toBe(ConnectingWebSocket.CLOSED);
  });

  it('times out and retries a socket that never finishes opening', () => {
    vi.useFakeTimers();
    const service = new EnhancedWebSocketService('wss://example.test/ws/v2');
    const states: string[] = [];
    service.onStateChange((state) => states.push(state));

    service.connect();
    const stalledSocket = ConnectingWebSocket.instances[0];

    vi.advanceTimersByTime(ENHANCED_WS_OPEN_TIMEOUT_MS);

    expect(stalledSocket.readyState).toBe(ConnectingWebSocket.CLOSED);
    expect(states).toContain('disconnected');
    expect(states).toContain('reconnecting');

    vi.advanceTimersByTime(1000);
    expect(ConnectingWebSocket.instances).toHaveLength(2);

    service.destroy();
  });

  it('keeps exponential backoff across short-lived opens and resets it after a stable open', () => {
    vi.useFakeTimers();
    const service = new EnhancedWebSocketService('wss://example.test/ws/v2');

    service.connect();
    ConnectingWebSocket.instances[0].open();
    ConnectingWebSocket.instances[0].emitClose();

    vi.advanceTimersByTime(1000);
    expect(ConnectingWebSocket.instances).toHaveLength(2);

    ConnectingWebSocket.instances[1].open();
    ConnectingWebSocket.instances[1].emitClose();
    vi.advanceTimersByTime(1999);
    expect(ConnectingWebSocket.instances).toHaveLength(2);
    vi.advanceTimersByTime(1);
    expect(ConnectingWebSocket.instances).toHaveLength(3);

    ConnectingWebSocket.instances[2].open();
    vi.advanceTimersByTime(ENHANCED_WS_STABLE_OPEN_MS);
    ConnectingWebSocket.instances[2].emitClose();
    vi.advanceTimersByTime(999);
    expect(ConnectingWebSocket.instances).toHaveLength(3);
    vi.advanceTimersByTime(1);
    expect(ConnectingWebSocket.instances).toHaveLength(4);

    service.destroy();
  });

  it('pauses a pending reconnect while hidden and resumes once visible', () => {
    vi.useFakeTimers();
    const service = new EnhancedWebSocketService('wss://example.test/ws/v2');

    service.connect();
    ConnectingWebSocket.instances[0].open();
    setVisibilityState('hidden');
    document.dispatchEvent(new Event('visibilitychange'));
    ConnectingWebSocket.instances[0].emitClose();

    vi.advanceTimersByTime(60_000);
    expect(ConnectingWebSocket.instances).toHaveLength(1);

    setVisibilityState('visible');
    document.dispatchEvent(new Event('visibilitychange'));
    expect(ConnectingWebSocket.instances).toHaveLength(2);

    service.destroy();
  });

  it('adds bounded jitter to the reconnect delay', () => {
    vi.useFakeTimers();
    vi.spyOn(Math, 'random').mockReturnValue(0.5);
    const service = new EnhancedWebSocketService('wss://example.test/ws/v2');

    service.connect();
    ConnectingWebSocket.instances[0].open();
    ConnectingWebSocket.instances[0].emitClose();

    vi.advanceTimersByTime(1099);
    expect(ConnectingWebSocket.instances).toHaveLength(1);
    vi.advanceTimersByTime(1);
    expect(ConnectingWebSocket.instances).toHaveLength(2);

    service.destroy();
  });
});
