import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  QUOTE_SOCKET_HEARTBEAT_INTERVAL_MS,
  QUOTE_SOCKET_MAX_SUBSCRIPTION_RETRIES,
  QUOTE_SOCKET_OPEN_TIMEOUT_MS,
  QUOTE_SOCKET_PONG_TIMEOUT_MS,
  QUOTE_SOCKET_STABLE_OPEN_MS,
  QUOTE_SOCKET_SUBSCRIPTION_ACK_TIMEOUT_MS,
  QuoteSocketManager,
} from './quoteSocketManager';
import {
  registerDailyChangePriceModes,
  resetDailyChangePriceModeRegistryForTests,
} from './dailyChangePriceModeRegistry';

const setConnectionState = vi.fn();
const enqueueLiveTick = vi.hoisted(() => vi.fn());
const brokerSessionMock = vi.hoisted(() => ({
  accessToken: 'access-token' as string | null,
  // Empty when the deployment exposes no broker /ws/feed endpoint.
  feedUri: '' as string,
  sessionListener: null as null | ((reason: 'token_rotation' | 'login' | 'logout' | 'broker_url_change' | 'account_change') => void),
  scope: {
    authenticated: false,
    accountId: null,
    brokerId: 'test-broker',
    serverUrl: 'https://broker.example',
  },
}));

vi.mock('./brokerSession', () => ({
  buildBrokerWsFeedUri: vi.fn(() => brokerSessionMock.feedUri),
  buildBrokerWsV2Uri: vi.fn((token?: string | null) => (
    `wss://broker.example/ws/v2${token ? `?token=${token}` : ''}`
  )),
  getAccessToken: vi.fn(() => brokerSessionMock.accessToken),
  getCommittedBrokerAccountSessionScope: vi.fn(() => brokerSessionMock.scope),
  getCommittedBrokerAccountSessionScopeKey: vi.fn((scope) => [
    scope.authenticated ? 'authenticated' : 'anonymous',
    scope.accountId || '',
    scope.brokerId,
    scope.serverUrl,
  ].join('|')),
  onCommittedBrokerAccountSessionScopeChange: vi.fn(() => vi.fn()),
  onSessionChange: vi.fn((cb) => {
    brokerSessionMock.sessionListener = cb;
    return vi.fn();
  }),
}));

vi.mock('../store/useWebSocketStore', () => ({
  useWebSocketStore: {
    getState: () => ({ setConnectionState }),
  },
}));

vi.mock('./liveTickDispatcher', () => ({
  enqueueLiveTick,
  isLiveMarketDataFrozen: () => false,
}));

class FakeWebSocket {
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSED = 3;

  static instances: FakeWebSocket[] = [];

  readyState = FakeWebSocket.CONNECTING;
  sent: string[] = [];
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  onerror: ((event: unknown) => void) | null = null;
  onclose: ((event: { code: number; reason: string }) => void) | null = null;

  constructor(public url: string) {
    FakeWebSocket.instances.push(this);
  }

  open(): void {
    this.readyState = FakeWebSocket.OPEN;
    this.onopen?.();
  }

  send(payload: string): void {
    this.sent.push(payload);
  }

  close(code = 1000, reason = ''): void {
    this.readyState = FakeWebSocket.CLOSED;
    this.onclose?.({ code, reason });
  }

  emitClose(code = 1006, reason = ''): void {
    this.onclose?.({ code, reason });
  }
}

const originalVisibilityStateDescriptor = Object.getOwnPropertyDescriptor(document, 'visibilityState');

const setVisibilityState = (state: DocumentVisibilityState): void => {
  Object.defineProperty(document, 'visibilityState', {
    configurable: true,
    value: state,
  });
};

type QuoteSocketManagerInternals = Pick<QuoteSocketManager, keyof QuoteSocketManager> & {
  ws: WebSocket | null;
  handleMessage: (data: unknown) => void;
  sendSubscribe: (symbols?: string[]) => void;
  sendUnsubscribe: (symbols: string[]) => void;
  pendingSubscriptions: Set<string>;
  subscribedSymbols: Set<string>;
};

const internals = (manager: QuoteSocketManager): QuoteSocketManagerInternals =>
  manager as unknown as QuoteSocketManagerInternals;

const v2ChannelFrame = (action: 'subscribe' | 'unsubscribe', symbol: string) => {
  const channel = `ticks.${symbol}`;
  return { action, channel, channels: [channel] };
};

describe('QuoteSocketManager public v2 per-symbol protocol', () => {
  beforeEach(() => {
    FakeWebSocket.instances = [];
    brokerSessionMock.accessToken = 'access-token';
    brokerSessionMock.feedUri = '';
    brokerSessionMock.sessionListener = null;
    setConnectionState.mockClear();
    enqueueLiveTick.mockClear();
    resetDailyChangePriceModeRegistryForTests();
    setVisibilityState('visible');
    vi.spyOn(Math, 'random').mockReturnValue(0);
    vi.stubGlobal('WebSocket', FakeWebSocket);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    if (originalVisibilityStateDescriptor) {
      Object.defineProperty(document, 'visibilityState', originalVisibilityStateDescriptor);
    } else {
      delete (document as { visibilityState?: DocumentVisibilityState }).visibilityState;
    }
  });

  it('opens public v2 without a token and sends one exact channel frame per symbol', () => {
    brokerSessionMock.accessToken = null;
    const manager = new QuoteSocketManager();

    manager.setDemand('watchlist', ['EURUSD', 'XAUUSD']);

    expect(FakeWebSocket.instances).toHaveLength(1);
    const ws = FakeWebSocket.instances[0];
    expect(ws.url).toBe('wss://broker.example/ws/v2');

    ws.open();

    expect(ws.sent.map((payload) => JSON.parse(payload))).toEqual([
      v2ChannelFrame('subscribe', 'EURUSD'),
      v2ChannelFrame('subscribe', 'XAUUSD'),
    ]);
    expect(manager.getActiveSymbols()).toEqual(['EURUSD', 'XAUUSD']);

    manager.setDemand('chart', ['GBPUSD']);

    expect(ws.sent.map((payload) => JSON.parse(payload))).toEqual([
      v2ChannelFrame('subscribe', 'EURUSD'),
      v2ChannelFrame('subscribe', 'XAUUSD'),
      v2ChannelFrame('subscribe', 'GBPUSD'),
    ]);
    expect(manager.getActiveSymbols()).toEqual(['EURUSD', 'XAUUSD', 'GBPUSD']);

    manager.destroy();
  });

  it('streams guest prices over the anonymous broker feed without an account session', () => {
    brokerSessionMock.accessToken = null;
    brokerSessionMock.feedUri = 'wss://broker.example/ws/feed';
    const manager = new QuoteSocketManager();
    manager.setDemand('guest-chart', ['BTCUSD']);

    const socket = FakeWebSocket.instances[0];
    expect(socket.url).toBe('wss://broker.example/ws/feed');
    socket.open();
    expect(socket.sent.map((frame) => JSON.parse(frame))).toEqual([
      { type: 'subscribe', symbols: ['BTCUSD'] },
    ]);
    socket.onmessage?.({ data: JSON.stringify({
      type: 'tick', symbol: 'BTCUSD', bid: 76000, ask: 76001, time: 1_788_250_045,
    }) });

    expect(enqueueLiveTick).toHaveBeenCalledWith('BTCUSD', expect.objectContaining({
      bid: 76000, ask: 76001,
    }));
    expect(internals(manager).subscribedSymbols.has('BTCUSD')).toBe(true);
    manager.destroy();
  });

  it('prefers the broker feed whenever a feed endpoint resolves, with no credential gate', () => {
    brokerSessionMock.accessToken = 'access-token';
    brokerSessionMock.feedUri = 'wss://broker.example/ws/feed';
    const manager = new QuoteSocketManager();

    manager.setDemand('watchlist', ['EURUSD']);

    expect(FakeWebSocket.instances[0].url).toBe('wss://broker.example/ws/feed');
    expect(manager.getTransport()).toBe('feed');
    expect(manager.isFallbackActive()).toBe(false);

    manager.destroy();
  });

  it('unsubscribes removed symbols and can resubscribe them later', () => {
    const manager = new QuoteSocketManager();

    manager.setDemand('watchlist', ['EURUSD', 'XAUUSD']);

    expect(FakeWebSocket.instances).toHaveLength(1);
    const ws = FakeWebSocket.instances[0];

    ws.open();

    manager.setDemand('watchlist', ['XAUUSD']);
    manager.setDemand('watchlist', ['EURUSD', 'XAUUSD']);

    expect(ws.sent.map((payload) => JSON.parse(payload))).toEqual([
      v2ChannelFrame('subscribe', 'EURUSD'),
      v2ChannelFrame('subscribe', 'XAUUSD'),
      v2ChannelFrame('unsubscribe', 'EURUSD'),
      v2ChannelFrame('subscribe', 'EURUSD'),
    ]);
    expect(manager.getActiveSymbols()).toEqual(['EURUSD', 'XAUUSD']);

    manager.destroy();
  });

  it('sends one exact unsubscribe frame per symbol', () => {
    const manager = new QuoteSocketManager();
    const send = vi.fn();

    internals(manager).ws = {
      readyState: WebSocket.OPEN,
      send,
      close: vi.fn(),
    } as unknown as WebSocket;

    internals(manager).sendUnsubscribe(['EURUSD', 'XAUUSD']);

    expect(send).toHaveBeenCalledTimes(2);
    expect(send.mock.calls.map(([payload]) => JSON.parse(payload))).toEqual([
      v2ChannelFrame('unsubscribe', 'EURUSD'),
      v2ChannelFrame('unsubscribe', 'XAUUSD'),
    ]);

    manager.destroy();
  });

  it('does not wait for login before opening the public quote socket', () => {
    brokerSessionMock.accessToken = null;
    const manager = new QuoteSocketManager();

    manager.setDemand('watchlist', ['EURUSD']);

    expect(FakeWebSocket.instances).toHaveLength(1);
    expect(FakeWebSocket.instances[0].url).toBe('wss://broker.example/ws/v2');

    manager.destroy();
  });

  it('reuses an in-flight socket across a same-turn demand handoff', () => {
    vi.useFakeTimers();
    const manager = new QuoteSocketManager();

    manager.setDemand('chart:first-pass', ['XAUUSD']);
    const socket = FakeWebSocket.instances[0];

    manager.removeDemand('chart:first-pass');
    manager.setDemand('chart:live-pass', ['XAUUSD']);
    vi.advanceTimersByTime(0);

    expect(FakeWebSocket.instances).toHaveLength(1);
    expect(socket.readyState).toBe(FakeWebSocket.CONNECTING);

    socket.open();
    expect(socket.sent.map((payload) => JSON.parse(payload))).toEqual([
      v2ChannelFrame('subscribe', 'XAUUSD'),
    ]);

    manager.destroy();
  });

  it('replaces a socket that remains stuck in CONNECTING', () => {
    vi.useFakeTimers();
    const manager = new QuoteSocketManager();

    manager.setDemand('watchlist', ['EURUSD']);
    const stalledSocket = FakeWebSocket.instances[0];

    vi.advanceTimersByTime(QUOTE_SOCKET_OPEN_TIMEOUT_MS);

    expect(stalledSocket.readyState).toBe(FakeWebSocket.CLOSED);
    expect(setConnectionState).toHaveBeenCalledWith('disconnected', 'fix_socket');
    expect(setConnectionState).toHaveBeenCalledWith('reconnecting', 'fix_socket');

    vi.advanceTimersByTime(1000);
    expect(FakeWebSocket.instances).toHaveLength(2);

    manager.destroy();
  });

  it('reconnects when an open socket does not answer the heartbeat', () => {
    vi.useFakeTimers();
    const manager = new QuoteSocketManager();

    manager.setDemand('watchlist', ['EURUSD']);
    const socket = FakeWebSocket.instances[0];
    socket.open();
    internals(manager).handleMessage({ type: 'subscribed', channel: 'ticks.EURUSD' });
    socket.sent.length = 0;

    vi.advanceTimersByTime(QUOTE_SOCKET_HEARTBEAT_INTERVAL_MS);
    expect(socket.sent.map((payload) => JSON.parse(payload))).toEqual([
      { type: 'ping', timestamp: expect.any(Number) },
    ]);

    vi.advanceTimersByTime(QUOTE_SOCKET_PONG_TIMEOUT_MS);
    expect(socket.readyState).toBe(FakeWebSocket.CLOSED);
    expect(setConnectionState).toHaveBeenCalledWith('disconnected', 'fix_socket');

    vi.advanceTimersByTime(999);
    expect(FakeWebSocket.instances).toHaveLength(1);
    vi.advanceTimersByTime(1);
    expect(FakeWebSocket.instances).toHaveLength(2);

    manager.destroy();
  });

  it('keeps reconnect backoff across short-lived opens and resets it after a stable open', () => {
    vi.useFakeTimers();
    const manager = new QuoteSocketManager();

    manager.setDemand('watchlist', ['EURUSD']);
    FakeWebSocket.instances[0].open();
    FakeWebSocket.instances[0].emitClose();

    vi.advanceTimersByTime(1000);
    expect(FakeWebSocket.instances).toHaveLength(2);

    FakeWebSocket.instances[1].open();
    FakeWebSocket.instances[1].emitClose();
    vi.advanceTimersByTime(1999);
    expect(FakeWebSocket.instances).toHaveLength(2);
    vi.advanceTimersByTime(1);
    expect(FakeWebSocket.instances).toHaveLength(3);

    FakeWebSocket.instances[2].open();
    vi.advanceTimersByTime(QUOTE_SOCKET_STABLE_OPEN_MS);
    FakeWebSocket.instances[2].emitClose();
    vi.advanceTimersByTime(999);
    expect(FakeWebSocket.instances).toHaveLength(3);
    vi.advanceTimersByTime(1);
    expect(FakeWebSocket.instances).toHaveLength(4);

    manager.destroy();
  });

  it('pauses quote reconnects while hidden and resumes once visible', () => {
    vi.useFakeTimers();
    const manager = new QuoteSocketManager();

    manager.setDemand('watchlist', ['EURUSD']);
    FakeWebSocket.instances[0].open();
    setVisibilityState('hidden');
    document.dispatchEvent(new Event('visibilitychange'));
    FakeWebSocket.instances[0].emitClose();

    vi.advanceTimersByTime(60_000);
    expect(FakeWebSocket.instances).toHaveLength(1);

    setVisibilityState('visible');
    document.dispatchEvent(new Event('visibilitychange'));
    expect(FakeWebSocket.instances).toHaveLength(2);

    manager.destroy();
  });

  it('never attaches the available account token to the public quote URL', () => {
    const manager = new QuoteSocketManager();

    manager.setDemand('watchlist', ['EURUSD']);

    expect(FakeWebSocket.instances).toHaveLength(1);
    expect(FakeWebSocket.instances[0].url).toBe('wss://broker.example/ws/v2');
    expect(FakeWebSocket.instances[0].url).not.toContain('token=');

    manager.destroy();
  });

  it('keeps bulk v2 demand as one exact channel per frame', () => {
    const manager = new QuoteSocketManager();
    const symbols = Array.from({ length: 501 }, (_, index) => `SYM${index}`);

    manager.setDemand('watchlist', symbols);
    expect(FakeWebSocket.instances).toHaveLength(1);
    const socket = FakeWebSocket.instances[0];
    socket.open();
    const frames = socket.sent.map((payload) => JSON.parse(payload));
    expect(frames).toHaveLength(501);
    expect(frames[0]).toEqual(v2ChannelFrame('subscribe', 'SYM0'));
    expect(frames[500]).toEqual(v2ChannelFrame('subscribe', 'SYM500'));
    expect(frames.every((frame, index) => (
      frame.channel === `ticks.SYM${index}`
      && frame.channels.length === 1
      && frame.channels[0] === frame.channel
    ))).toBe(true);

    manager.destroy();
  });

  it('reconciles one subscribed acknowledgement per channel in a batch', () => {
    const manager = new QuoteSocketManager();
    const symbols = ['EURUSD', 'GBPUSD', 'BTCUSD', 'XAUUSD'];

    manager.setDemand('watchlist', symbols);
    FakeWebSocket.instances[0].open();

    expect(internals(manager).pendingSubscriptions.size).toBe(4);
    symbols.forEach((symbol, index) => {
      internals(manager).handleMessage({ type: 'subscribed', channel: `ticks.${symbol}` });
      expect(internals(manager).pendingSubscriptions.size).toBe(3 - index);
      expect(internals(manager).subscribedSymbols.has(symbol)).toBe(true);
    });
    expect(internals(manager).subscribedSymbols.size).toBe(4);

    manager.destroy();
  });

  it('releases all pending entries after an all-or-none batch error', () => {
    const manager = new QuoteSocketManager();

    manager.setDemand('watchlist', ['EURUSD', 'XAUUSD']);
    FakeWebSocket.instances[0].open();
    expect(internals(manager).pendingSubscriptions.size).toBe(2);
    internals(manager).handleMessage({ type: 'error', message: 'Too many channels' });
    expect(internals(manager).pendingSubscriptions.size).toBe(0);
    expect(internals(manager).subscribedSymbols.size).toBe(0);

    manager.destroy();
  });

  it('reconnects the same public v2 origin after a session transition', () => {
    const manager = new QuoteSocketManager();

    manager.setDemand('watchlist', ['EURUSD']);
    brokerSessionMock.sessionListener?.('token_rotation');

    expect(FakeWebSocket.instances).toHaveLength(2);
    expect(FakeWebSocket.instances[1].url).toBe('wss://broker.example/ws/v2');

    manager.destroy();
  });

  it('ignores stale close events from a replaced socket', () => {
    vi.useFakeTimers();
    const manager = new QuoteSocketManager();

    manager.setDemand('watchlist', ['EURUSD']);

    expect(FakeWebSocket.instances).toHaveLength(1);
    const staleSocket = FakeWebSocket.instances[0];
    staleSocket.open();

    brokerSessionMock.sessionListener?.('token_rotation');

    expect(FakeWebSocket.instances).toHaveLength(2);

    setConnectionState.mockClear();
    staleSocket.emitClose(1006, 'late close');
    vi.advanceTimersByTime(1000);

    expect(FakeWebSocket.instances).toHaveLength(2);
    expect(setConnectionState).not.toHaveBeenCalledWith('disconnected', 'fix_socket');
    expect(setConnectionState).not.toHaveBeenCalledWith('reconnecting', 'fix_socket');

    manager.destroy();
  });

  it('enqueues every normalized tick from a raw array payload', () => {
    const manager = new QuoteSocketManager();

    internals(manager).handleMessage([
      { symbol: 'eurusd', bid: 1.1, ask: 1.2, timestamp: 1 },
      { symbol: 'gbpusd', bid: 1.3, ask: 1.4, timestamp: 2 },
    ]);

    expect(enqueueLiveTick).toHaveBeenCalledTimes(2);
    expect(enqueueLiveTick.mock.calls.map(([symbol]) => symbol)).toEqual(['EURUSD', 'GBPUSD']);

    manager.destroy();
  });

  it('normalizes server Daily Change aliases and the previous-close fallback', () => {
    const manager = new QuoteSocketManager();

    internals(manager).handleMessage([
      { symbol: 'eurusd', bid: 100, ask: 101, dailyChange: 0.19, timestamp: 1 },
      { symbol: 'gbpusd', bid: 100, ask: 101, daily_change: -0.36, timestamp: 1 },
      { symbol: 'xauusd', bid: 4604, ask: 4605, daily_change_pct: 0.45, timestamp: 1 },
      { symbol: 'usdjpy', bid: 110, ask: 112, previous_close: 100, timestamp: 1 },
    ]);

    expect(enqueueLiveTick.mock.calls[0][1]).toMatchObject({ dailyChange: 0.19 });
    expect(enqueueLiveTick.mock.calls[1][1]).toMatchObject({ dailyChange: -0.36 });
    expect(enqueueLiveTick.mock.calls[2][1]).toMatchObject({ dailyChange: 0.45 });
    expect(enqueueLiveTick.mock.calls[3][1].dailyChange).toBeCloseTo(10, 10);

    manager.destroy();
  });

  it('uses chart mode and settlement metadata for the Daily Change fallback', () => {
    const manager = new QuoteSocketManager();

    internals(manager).handleMessage([
      {
        symbol: 'future.last',
        bid: 110,
        ask: 111,
        last: 120,
        chart_mode: 1,
        settlement_price: 80,
        previous_close: 100,
        timestamp: 1,
      },
      {
        symbol: 'future.bid',
        bid: 110,
        ask: 111,
        last: 120,
        chartMode: 'SYMBOL_CHART_MODE_BID',
        settlement_price: 0,
        clearingPrice: 88,
        previous_close: 100,
        timestamp: 1,
      },
      {
        symbol: 'future.missing-last',
        bid: 110,
        ask: 111,
        chart_mode: 'last',
        previous_close: 100,
        timestamp: 1,
      },
    ]);

    expect(enqueueLiveTick.mock.calls[0][1].dailyChange).toBeCloseTo(50, 10);
    expect(enqueueLiveTick.mock.calls[1][1].dailyChange).toBeCloseTo(25, 10);
    expect(enqueueLiveTick.mock.calls[2][1].dailyChange).toBeUndefined();

    manager.destroy();
  });

  it('retains Last-only display metadata without guessing an omitted mode or publishing executable quotes', () => {
    const manager = new QuoteSocketManager();
    const rawQuoteListener = vi.fn();
    const anyQuoteListener = vi.fn();
    manager.onQuoteSnapshot('FUTURE.LAST-ONLY', rawQuoteListener);
    manager.onQuoteSnapshot('AMBIGUOUS.LAST-ONLY', rawQuoteListener);
    manager.onAnyQuote(anyQuoteListener);

    internals(manager).handleMessage([
      {
        symbol: 'future.last-only',
        last: 120,
        chart_mode: 'last',
        settlement_price: 80,
        previous_close: 100,
        timestamp: 1,
      },
      {
        symbol: 'ambiguous.last-only',
        last: 120,
        previous_close: 100,
        timestamp: 1,
      },
    ]);

    expect(enqueueLiveTick).toHaveBeenCalledTimes(2);
    expect(enqueueLiveTick).toHaveBeenCalledWith('FUTURE.LAST-ONLY', expect.objectContaining({
      bid: 0,
      ask: 0,
      last: 120,
      dailyChange: 50,
    }));
    expect(enqueueLiveTick).toHaveBeenNthCalledWith(2, 'AMBIGUOUS.LAST-ONLY', expect.objectContaining({
      bid: 0,
      ask: 0,
      last: 120,
      dailyChange: undefined,
      dailyChangeInput: expect.objectContaining({ mode: undefined, previousClose: 100 }),
    }));
    expect(rawQuoteListener).not.toHaveBeenCalled();
    expect(anyQuoteListener).not.toHaveBeenCalled();

    manager.destroy();
  });

  it('uses current-scope catalog mode for Last-only data while raw metadata wins', () => {
    const manager = new QuoteSocketManager();
    const rawQuoteListener = vi.fn();
    const anyQuoteListener = vi.fn();
    manager.onQuoteSnapshot('CATALOG.LAST-ONLY', rawQuoteListener);
    manager.onAnyQuote(anyQuoteListener);
    registerDailyChangePriceModes([
      { symbol: 'catalog.last-only', brokerSpecification: { chart_mode: 1 } },
    ]);

    internals(manager).handleMessage([
      {
        symbol: 'catalog.last-only',
        last: 120,
        previous_close: 100,
        timestamp: 1,
      },
      {
        symbol: 'catalog.last-only',
        last: 130,
        chart_mode: 'future-mode',
        previous_close: 100,
        timestamp: 2,
      },
    ]);

    expect(enqueueLiveTick).toHaveBeenCalledTimes(2);
    expect(enqueueLiveTick).toHaveBeenCalledWith('CATALOG.LAST-ONLY', expect.objectContaining({
      bid: 0,
      ask: 0,
      last: 120,
      dailyChange: 20,
    }));
    expect(enqueueLiveTick).toHaveBeenNthCalledWith(2, 'CATALOG.LAST-ONLY', expect.objectContaining({
      bid: 0,
      ask: 0,
      last: 130,
      dailyChange: undefined,
      dailyChangeInput: expect.objectContaining({ mode: null, previousClose: 100 }),
    }));
    expect(rawQuoteListener).not.toHaveBeenCalled();
    expect(anyQuoteListener).not.toHaveBeenCalled();

    manager.destroy();
  });

  it('resolves wrapped raw chart mode before catalog mode while keeping child mode nearest', () => {
    const manager = new QuoteSocketManager();
    registerDailyChangePriceModes([
      { symbol: 'wrapped.bid', brokerSpecification: { chart_mode: 1 } },
      { symbol: 'wrapped.last', brokerSpecification: { chart_mode: 0 } },
      { symbol: 'child.last', brokerSpecification: { chart_mode: 0 } },
      { symbol: 'child.unknown', brokerSpecification: { chart_mode: 0 } },
    ]);

    internals(manager).handleMessage([
      {
        channel: 'ticks.WRAPPED.BID',
        chart_mode: 0,
        data: { bid: 110, ask: 111, last: 120, previous_close: 100, timestamp: 1 },
      },
      {
        channel: 'ticks.WRAPPED.LAST',
        chart_mode: 1,
        data: { bid: 110, ask: 111, last: 120, previous_close: 100, timestamp: 1 },
      },
      {
        channel: 'ticks.CHILD.LAST',
        chart_mode: 0,
        data: {
          bid: 110,
          ask: 111,
          last: 120,
          chart_mode: 1,
          previous_close: 100,
          timestamp: 1,
        },
      },
      {
        channel: 'ticks.CHILD.UNKNOWN',
        chart_mode: 1,
        data: {
          bid: 110,
          ask: 111,
          last: 120,
          chart_mode: 'future-mode',
          previous_close: 100,
          timestamp: 1,
        },
      },
    ]);

    expect(enqueueLiveTick.mock.calls.map(([, tick]) => tick.dailyChange)).toEqual([10, 20, 20, 10]);

    manager.destroy();
  });

  it('composes wrapped Daily Change metadata without overriding explicit child groups', () => {
    const manager = new QuoteSocketManager();

    internals(manager).handleMessage([
      {
        channel: 'ticks.OUTER.PERCENT',
        daily_change_pct: 0.75,
        data: { bid: 110, ask: 111, previous_close: 100, timestamp: 1 },
      },
      {
        channel: 'ticks.CHILD.PERCENT',
        daily_change_pct: 0.75,
        previous_close: 100,
        data: { bid: 110, ask: 111, dailyChangePct: 'unknown', timestamp: 1 },
      },
      {
        chart_mode: 1,
        last: 120,
        settlement_price: 80,
        previous_close: 100,
        data: { symbol: 'OUTER.BASELINE', bid: 110, ask: 111, timestamp: 1 },
      },
      {
        channel: 'ticks.CHILD.BLOCKS.BASELINE',
        settlement_price: 80,
        previous_close: 100,
        data: { bid: 110, ask: 111, settlementPrice: 'unknown', timestamp: 1 },
      },
      {
        channel: 'ticks.CHILD.BLOCKS.CLOSE',
        previous_close: 100,
        data: { bid: 110, ask: 111, previousClose: 'unknown', timestamp: 1 },
      },
    ]);

    expect(enqueueLiveTick.mock.calls.map(([, tick]) => ({
      dailyChange: tick.dailyChange,
      last: tick.last,
    }))).toEqual([
      { dailyChange: 0.75, last: undefined },
      { dailyChange: 10, last: undefined },
      { dailyChange: 50, last: 120 },
      { dailyChange: 10, last: undefined },
      { dailyChange: undefined, last: undefined },
    ]);

    manager.destroy();
  });

  it('keeps nearest intermediate metadata, broker time, and channel identity through nested arrays', () => {
    const manager = new QuoteSocketManager();

    internals(manager).handleMessage([
      {
        channel: 'ticks.NESTED.PERCENT',
        daily_change_pct: 0.9,
        timestamp: 1_725_000_000,
        data: {
          bid: 90,
          ask: 91,
          daily_change_pct: 0.75,
          timestamp: 1_725_000_001,
          payload: { bid: 110, ask: 111, previous_close: 100 },
        },
      },
      {
        channel: 'ticks.NESTED.BLOCK',
        daily_change_pct: 0.9,
        data: {
          dailyChangePct: 'unknown',
          payload: { bid: 110, ask: 111, previous_close: 100, timestamp: 1_725_000_002 },
        },
      },
      {
        channel: 'ticks.EURUSD.r',
        data: {
          chart_mode: 1,
          last: 120,
          settlement_price: 80,
          ticks: [
            { bid: 110, ask: 111, timestamp: 1_725_000_003 },
            { bid: 112, ask: 113, timestamp: 1_725_000_004 },
          ],
        },
      },
      {
        channel: 'ticks.NESTED.MODE-BLOCK',
        chart_mode: 1,
        data: {
          chart_mode: 'future-mode',
          payload: {
            bid: 110,
            ask: 111,
            last: 120,
            previous_close: 100,
            timestamp: 1_725_000_005,
          },
        },
      },
    ]);

    expect(enqueueLiveTick.mock.calls.map(([symbol, tick]) => ({
      symbol,
      bid: tick.bid,
      dailyChange: tick.dailyChange,
      sourceTimestamp: tick.sourceTimestamp,
    }))).toEqual([
      { symbol: 'NESTED.PERCENT', bid: 110, dailyChange: 0.75, sourceTimestamp: 1_725_000_001_000 },
      { symbol: 'NESTED.BLOCK', bid: 110, dailyChange: 10, sourceTimestamp: 1_725_000_002_000 },
      { symbol: 'EURUSD.R', bid: 110, dailyChange: 50, sourceTimestamp: 1_725_000_003_000 },
      { symbol: 'EURUSD.R', bid: 112, dailyChange: 50, sourceTimestamp: 1_725_000_004_000 },
      { symbol: 'NESTED.MODE-BLOCK', bid: 110, dailyChange: 10, sourceTimestamp: 1_725_000_005_000 },
    ]);

    manager.destroy();
  });

  it('normalizes optional quote metadata aliases without inventing volume', () => {
    const manager = new QuoteSocketManager();

    internals(manager).handleMessage([
      {
        symbol: 'xauusd',
        bid: 4_411.09,
        ask: 4_411.2,
        high_24h: 4_430.5,
        low_24h: 4_390.25,
        last_price: 4_411.15,
        tick_volume: 321,
        provider: 'Prime LP',
        daily_open: 4_400,
        previous_close: 4_398,
        timestamp: 1,
      },
      { symbol: 'eurusd', bid: 1.1, ask: 1.2, timestamp: 2 },
    ]);

    expect(enqueueLiveTick.mock.calls[0][1]).toMatchObject({
      high24h: 4_430.5,
      low24h: 4_390.25,
      last: 4_411.15,
      volume: 321,
      lp: 'Prime LP',
      open: 4_400,
      close: 4_398,
    });
    expect(enqueueLiveTick.mock.calls[1][1].volume).toBeUndefined();

    manager.destroy();
  });

  it('keeps the session Bid and Ask ranges separate for Market Watch Details', () => {
    const manager = new QuoteSocketManager();

    internals(manager).handleMessage([
      {
        symbol: 'xauusd',
        bid: 4_150.16,
        ask: 4_150.46,
        daily_open: 4_274.42,
        previous_close: 4_272.74,
        session: { high_bid: 4_277.01, low_bid: 4_140.53, high_ask: 4_283.46, low_ask: 4_140.87 },
        timestamp: 1,
      },
    ]);

    expect(enqueueLiveTick.mock.calls[0][1]).toMatchObject({
      bidHigh: 4_277.01,
      bidLow: 4_140.53,
      askHigh: 4_283.46,
      askLow: 4_140.87,
      high24h: 4_283.46,
      low24h: 4_140.53,
      open: 4_274.42,
      close: 4_272.74,
    });

    manager.destroy();
  });

  it('preserves source timestamp provenance separately from receipt-time fallback', () => {
    const manager = new QuoteSocketManager();
    const receivedAt = Date.now();

    internals(manager).handleMessage([
      { symbol: 'eurusd', bid: 1.1, ask: 1.2, timestamp: 1_750_000_000 },
      { symbol: 'xauusd', bid: 2400, ask: 2401 },
    ]);

    expect(enqueueLiveTick.mock.calls[0][1]).toMatchObject({
      symbol: 'EURUSD',
      timestamp: 1_750_000_000_000,
      sourceTimestamp: 1_750_000_000_000,
    });
    expect(enqueueLiveTick.mock.calls[1][1]).toMatchObject({
      symbol: 'XAUUSD',
      sourceTimestamp: undefined,
    });
    expect(enqueueLiveTick.mock.calls[1][1].timestamp).toBeGreaterThanOrEqual(receivedAt);

    manager.destroy();
  });

  it('enqueues every normalized tick from a ticks wrapper payload', () => {
    const manager = new QuoteSocketManager();

    internals(manager).handleMessage({
      ticks: [
        { symbol: 'xauusd', bid: 2400, ask: 2401, timestamp: 1 },
        { symbol: 'usdjpy', bid: 156.1, ask: 156.2, timestamp: 2 },
      ],
    });

    expect(enqueueLiveTick).toHaveBeenCalledTimes(2);
    expect(enqueueLiveTick.mock.calls.map(([symbol]) => symbol)).toEqual(['XAUUSD', 'USDJPY']);

    manager.destroy();
  });

  it('enqueues every normalized tick from a data array payload', () => {
    const manager = new QuoteSocketManager();

    internals(manager).handleMessage({
      data: [
        { symbol: 'audusd', bid: 0.66, ask: 0.67, timestamp: 1 },
        { symbol: 'nzdusd', bid: 0.61, ask: 0.62, timestamp: 2 },
      ],
    });

    expect(enqueueLiveTick).toHaveBeenCalledTimes(2);
    expect(enqueueLiveTick.mock.calls.map(([symbol]) => symbol)).toEqual(['AUDUSD', 'NZDUSD']);

    manager.destroy();
  });

  it('enqueues every normalized tick from nested data ticks payloads', () => {
    const manager = new QuoteSocketManager();

    internals(manager).handleMessage({
      data: {
        ticks: [
          { symbol: 'usdcad', bid: 1.36, ask: 1.37, timestamp: 1 },
          { symbol: 'usdchf', bid: 0.9, ask: 0.91, timestamp: 2 },
        ],
      },
    });

    expect(enqueueLiveTick).toHaveBeenCalledTimes(2);
    expect(enqueueLiveTick.mock.calls.map(([symbol]) => symbol)).toEqual(['USDCAD', 'USDCHF']);

    manager.destroy();
  });

  it('uses the channel symbol as a fallback for wrapped quote payloads', () => {
    const manager = new QuoteSocketManager();

    internals(manager).handleMessage({
      channel: 'ticks.eurusd',
      data: {
        bid: 1.1,
        ask: 1.2,
        timestamp: 1,
      },
    });

    expect(enqueueLiveTick).toHaveBeenCalledOnce();
    expect(enqueueLiveTick.mock.calls[0][0]).toBe('EURUSD');
    expect(enqueueLiveTick.mock.calls[0][1]).toMatchObject({
      symbol: 'EURUSD',
      bid: 1.1,
      ask: 1.2,
    });

    manager.destroy();
  });

  it('preserves ancestor channel through nested quote wrappers', () => {
    const manager = new QuoteSocketManager();

    internals(manager).handleMessage({
      channel: 'ticks.eurusd',
      data: {
        payload: {
          bid: 1.1,
          ask: 1.2,
          timestamp: 1,
        },
      },
    });

    expect(enqueueLiveTick).toHaveBeenCalledOnce();
    expect(enqueueLiveTick.mock.calls[0][0]).toBe('EURUSD');
    expect(enqueueLiveTick.mock.calls[0][1]).toMatchObject({
      symbol: 'EURUSD',
      bid: 1.1,
      ask: 1.2,
    });

    manager.destroy();
  });

  it('enqueues normalized ticks from wrapped stringified JSON quote payloads', () => {
    const manager = new QuoteSocketManager();

    internals(manager).handleMessage({
      message: JSON.stringify({
        symbol: 'eurusd',
        bid: 1.1,
        ask: 1.2,
        timestamp: 1,
      }),
    });

    expect(enqueueLiveTick).toHaveBeenCalledOnce();
    expect(enqueueLiveTick.mock.calls[0][0]).toBe('EURUSD');
    expect(enqueueLiveTick.mock.calls[0][1]).toMatchObject({
      symbol: 'EURUSD',
      bid: 1.1,
      ask: 1.2,
    });

    manager.destroy();
  });

  it('preserves ancestor channel through stringified nested array wrappers', () => {
    const manager = new QuoteSocketManager();

    internals(manager).handleMessage({
      channel: 'ticks.eurusd',
      message: JSON.stringify({
        data: {
          payload: [
            {
              bid: 1.1,
              ask: 1.2,
              timestamp: 1,
            },
          ],
        },
      }),
    });

    expect(enqueueLiveTick).toHaveBeenCalledOnce();
    expect(enqueueLiveTick.mock.calls[0][0]).toBe('EURUSD');
    expect(enqueueLiveTick.mock.calls[0][1]).toMatchObject({
      symbol: 'EURUSD',
      bid: 1.1,
      ask: 1.2,
    });

    manager.destroy();
  });

  it('uses the channel symbol for wrapped stringified JSON array payloads', () => {
    const manager = new QuoteSocketManager();

    internals(manager).handleMessage({
      channel: 'ticks.eurusd',
      message: JSON.stringify([
        {
          bid: 1.1,
          ask: 1.2,
          timestamp: 1,
        },
      ]),
    });

    expect(enqueueLiveTick).toHaveBeenCalledOnce();
    expect(enqueueLiveTick.mock.calls[0][0]).toBe('EURUSD');
    expect(enqueueLiveTick.mock.calls[0][1]).toMatchObject({
      symbol: 'EURUSD',
      bid: 1.1,
      ask: 1.2,
    });

    manager.destroy();
  });

  // ─── N3-03 regression: subscribe-state desync on rejected/unconfirmed subscribe ───

  it('retries missing subscription acknowledgements only up to the configured bound', () => {
    vi.useFakeTimers();
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const manager = new QuoteSocketManager();

    manager.setDemand('watchlist', ['EURUSD']);
    const socket = FakeWebSocket.instances[0];
    socket.open();

    vi.advanceTimersByTime(
      QUOTE_SOCKET_SUBSCRIPTION_ACK_TIMEOUT_MS * (QUOTE_SOCKET_MAX_SUBSCRIPTION_RETRIES * 2 + 1),
    );

    const subscribeFrames = () => socket.sent
      .map((payload) => JSON.parse(payload))
      .filter((frame) => frame.action === 'subscribe');
    expect(subscribeFrames()).toEqual(
      Array.from(
        { length: QUOTE_SOCKET_MAX_SUBSCRIPTION_RETRIES + 1 },
        () => v2ChannelFrame('subscribe', 'EURUSD'),
      ),
    );
    expect(internals(manager).pendingSubscriptions.has('EURUSD')).toBe(false);
    expect(consoleError).toHaveBeenCalledWith(
      expect.stringContaining(`after ${QUOTE_SOCKET_MAX_SUBSCRIPTION_RETRIES} retries: EURUSD`),
    );

    vi.advanceTimersByTime(QUOTE_SOCKET_SUBSCRIPTION_ACK_TIMEOUT_MS);
    expect(subscribeFrames()).toHaveLength(QUOTE_SOCKET_MAX_SUBSCRIPTION_RETRIES + 1);

    manager.destroy();
  });

  it('does not mark a symbol confirmed until the server confirms it (allows retry)', () => {
    const manager = new QuoteSocketManager();

    manager.setDemand('watchlist', ['EURUSD']);
    const ws = FakeWebSocket.instances[0];
    ws.open();

    // Optimistic subscribe was sent, but the symbol is only PENDING — not confirmed.
    expect(internals(manager).pendingSubscriptions.has('EURUSD')).toBe(true);
    expect(internals(manager).subscribedSymbols.has('EURUSD')).toBe(false);

    // Server rejects EURUSD by unsubscribing it (or never confirms, then drops it).
    internals(manager).handleMessage({ type: 'unsubscribed', symbols: ['EURUSD'] });
    expect(internals(manager).pendingSubscriptions.has('EURUSD')).toBe(false);
    expect(internals(manager).subscribedSymbols.has('EURUSD')).toBe(false);

    // A later re-add for the same symbol must NOT be silently filtered — it retries.
    ws.sent.length = 0;
    internals(manager).sendSubscribe(['EURUSD']);
    expect(ws.sent.map((p: string) => JSON.parse(p))).toEqual([
      v2ChannelFrame('subscribe', 'EURUSD'),
    ]);

    manager.destroy();
  });

  it('promotes a pending symbol to confirmed on a server subscribed confirmation', () => {
    const manager = new QuoteSocketManager();

    manager.setDemand('watchlist', ['EURUSD']);
    FakeWebSocket.instances[0].open();

    internals(manager).handleMessage({ type: 'subscribed', symbols: ['ticks.eurusd'] });
    expect(internals(manager).subscribedSymbols.has('EURUSD')).toBe(true);
    expect(internals(manager).pendingSubscriptions.has('EURUSD')).toBe(false);

    manager.destroy();
  });

  it('accepts the singular channel used by v2 subscription confirmations', () => {
    const manager = new QuoteSocketManager();

    manager.setDemand('watchlist', ['EURUSD']);
    FakeWebSocket.instances[0].open();

    internals(manager).handleMessage({ type: 'subscribed', channel: 'ticks.EURUSD' });
    expect(internals(manager).subscribedSymbols.has('EURUSD')).toBe(true);
    expect(internals(manager).pendingSubscriptions.has('EURUSD')).toBe(false);

    manager.destroy();
  });

  it('promotes a pending symbol to confirmed when a live tick arrives even without an explicit confirmation', () => {
    const manager = new QuoteSocketManager();

    manager.setDemand('watchlist', ['EURUSD']);
    FakeWebSocket.instances[0].open();

    expect(internals(manager).pendingSubscriptions.has('EURUSD')).toBe(true);

    internals(manager).handleMessage({ symbol: 'eurusd', bid: 1.1, ask: 1.2, timestamp: 1 });

    expect(internals(manager).subscribedSymbols.has('EURUSD')).toBe(true);
    expect(internals(manager).pendingSubscriptions.has('EURUSD')).toBe(false);

    manager.destroy();
  });

  it('does not resend a subscribe while a symbol is still pending confirmation', () => {
    const manager = new QuoteSocketManager();

    manager.setDemand('watchlist', ['EURUSD']);
    const ws = FakeWebSocket.instances[0];
    ws.open();
    ws.sent.length = 0;

    // Re-issuing the same subscribe before confirmation must be a no-op (no dup).
    internals(manager).sendSubscribe(['EURUSD']);
    expect(ws.sent).toHaveLength(0);

    manager.destroy();
  });
});
