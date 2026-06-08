import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { QuoteSocketManager } from './quoteSocketManager';

const setConnectionState = vi.fn();
const enqueueLiveTick = vi.hoisted(() => vi.fn());
const brokerSessionMock = vi.hoisted(() => ({
  accessToken: 'access-token' as string | null,
  sessionListener: null as null | ((reason: 'token_rotation' | 'login' | 'logout' | 'broker_url_change' | 'account_change') => void),
}));

vi.mock('./brokerSession', () => ({
  buildBrokerWsFeedUri: vi.fn(() => 'wss://broker.example/ws/feed'),
  getAccessToken: vi.fn(() => brokerSessionMock.accessToken),
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

type QuoteSocketManagerInternals = QuoteSocketManager & {
  ws: WebSocket | null;
  handleMessage: (data: unknown) => void;
  sendSubscribe: (symbols?: string[]) => void;
  sendUnsubscribe: (symbols: string[]) => void;
  pendingSubscriptions: Set<string>;
  subscribedSymbols: Set<string>;
};

const internals = (manager: QuoteSocketManager): QuoteSocketManagerInternals =>
  manager as unknown as QuoteSocketManagerInternals;

describe('QuoteSocketManager feed protocol', () => {
  beforeEach(() => {
    FakeWebSocket.instances = [];
    brokerSessionMock.accessToken = 'access-token';
    brokerSessionMock.sessionListener = null;
    setConnectionState.mockClear();
    enqueueLiveTick.mockClear();
    vi.stubGlobal('WebSocket', FakeWebSocket);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('subscribes to demanded symbols when the feed socket opens', () => {
    const manager = new QuoteSocketManager();

    manager.setDemand('watchlist', ['EURUSD', 'XAUUSD']);

    expect(FakeWebSocket.instances).toHaveLength(1);
    const ws = FakeWebSocket.instances[0];

    ws.open();

    expect(ws.sent.map((payload) => JSON.parse(payload))).toEqual([
      {
        type: 'subscribe',
        symbols: ['EURUSD', 'XAUUSD'],
      },
    ]);
    expect(manager.getActiveSymbols()).toEqual(['EURUSD', 'XAUUSD']);

    manager.setDemand('chart', ['GBPUSD']);

    expect(ws.sent.map((payload) => JSON.parse(payload))).toEqual([
      {
        type: 'subscribe',
        symbols: ['EURUSD', 'XAUUSD'],
      },
      {
        type: 'subscribe',
        symbols: ['GBPUSD'],
      },
    ]);
    expect(manager.getActiveSymbols()).toEqual(['EURUSD', 'XAUUSD', 'GBPUSD']);

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
      {
        type: 'subscribe',
        symbols: ['EURUSD', 'XAUUSD'],
      },
      {
        type: 'unsubscribe',
        symbols: ['EURUSD'],
      },
      {
        type: 'subscribe',
        symbols: ['EURUSD'],
      },
    ]);
    expect(manager.getActiveSymbols()).toEqual(['EURUSD', 'XAUUSD']);

    manager.destroy();
  });

  it('sends feed-protocol unsubscribe messages', () => {
    const manager = new QuoteSocketManager();
    const send = vi.fn();

    internals(manager).ws = {
      readyState: WebSocket.OPEN,
      send,
      close: vi.fn(),
    } as unknown as WebSocket;

    internals(manager).sendUnsubscribe(['EURUSD', 'XAUUSD']);

    expect(send).toHaveBeenCalledOnce();
    expect(JSON.parse(send.mock.calls[0][0])).toEqual({
      type: 'unsubscribe',
      symbols: ['EURUSD', 'XAUUSD'],
    });

    manager.destroy();
  });

  it('reconnects a deferred quote socket when login completes the session', () => {
    brokerSessionMock.accessToken = null;
    const manager = new QuoteSocketManager();

    manager.setDemand('watchlist', ['EURUSD']);

    expect(FakeWebSocket.instances).toHaveLength(0);

    brokerSessionMock.accessToken = 'access-token';
    brokerSessionMock.sessionListener?.('login');

    expect(FakeWebSocket.instances).toHaveLength(1);
    expect(FakeWebSocket.instances[0].url).toBe('wss://broker.example/ws/feed');

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
      { type: 'subscribe', symbols: ['EURUSD'] },
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
