// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const brokerSessionMock = vi.hoisted(() => ({
  accessToken: 'access-token' as string | null,
  ready: true,
  sessionListener: null as null | ((reason: 'token_rotation' | 'login' | 'logout' | 'broker_url_change' | 'account_change') => void),
}));

vi.mock('./brokerSession', () => ({
  buildBrokerWsV2Uri: vi.fn((token?: string | null) => (
    `wss://broker.example/ws/v2${token ? `?token=${token}` : ''}`
  )),
  getAccessToken: vi.fn(() => brokerSessionMock.accessToken),
  isSessionReady: vi.fn(() => brokerSessionMock.ready),
  onSessionChange: vi.fn((listener) => {
    brokerSessionMock.sessionListener = listener;
    return vi.fn();
  }),
}));

import {
  CANDLE_SOCKET_STABLE_OPEN_MS,
  CandleSocketManager,
  type CandlePayload,
} from './candleSocketManager';

class FakeWebSocket {
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSING = 2;
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

  emit(data: unknown): void {
    this.onmessage?.({ data: JSON.stringify(data) });
  }
}

const candle = (time: number, close: number) => ({
  time,
  open: close - 0.0001,
  high: close + 0.0002,
  low: close - 0.0002,
  close,
  volume: 12,
});

const frames = (socket: FakeWebSocket): unknown[] => (
  socket.sent.map((payload) => JSON.parse(payload))
);

describe('CandleSocketManager exact broker symbol routing', () => {
  beforeEach(() => {
    FakeWebSocket.instances = [];
    brokerSessionMock.accessToken = 'access-token';
    brokerSessionMock.ready = true;
    brokerSessionMock.sessionListener = null;
    vi.stubGlobal('WebSocket', FakeWebSocket);
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('preserves punctuated symbols and timeframes in subscriptions and candle routing', () => {
    const manager = new CandleSocketManager();
    const eurusdCandles: CandlePayload[] = [];
    const hongKongCandles: CandlePayload[] = [];

    manager.subscribe('EURUSD.r', 'm5', (next) => eurusdCandles.push(next));
    manager.subscribe('0001.HK', 'h1', (next) => hongKongCandles.push(next));

    expect(FakeWebSocket.instances).toHaveLength(1);
    const socket = FakeWebSocket.instances[0];
    socket.open();

    expect(frames(socket)).toEqual([
      { action: 'subscribe', channel: 'candles.EURUSD.R.M5' },
      { action: 'subscribe', channel: 'ticks.EURUSD.R' },
      { action: 'subscribe', channel: 'candles.0001.HK.H1' },
      { action: 'subscribe', channel: 'ticks.0001.HK' },
    ]);

    socket.emit({
      type: 'channel_message',
      channel: 'candles.EURUSD.R.M5',
      data: candle(1_788_176_700, 1.125),
    });
    socket.emit({
      type: 'channel_message',
      channel: 'candles.0001.HK.H1',
      data: candle(1_788_180_000, 72.4),
    });

    expect(eurusdCandles).toEqual([
      expect.objectContaining({ symbol: 'EURUSD.R', timeframe: 'M5', close: 1.125 }),
    ]);
    expect(hongKongCandles).toEqual([
      expect.objectContaining({ symbol: '0001.HK', timeframe: 'H1', close: 72.4 }),
    ]);

    manager.destroy();
  });

  it('resubscribes exact punctuated symbol channels after session rotation', () => {
    const manager = new CandleSocketManager();

    manager.subscribe('NAS100-F', 'm15');
    manager.subscribe('EURUSD.r', 'h4');
    FakeWebSocket.instances[0].open();

    brokerSessionMock.sessionListener?.('token_rotation');

    expect(FakeWebSocket.instances).toHaveLength(2);
    const replacement = FakeWebSocket.instances[1];
    replacement.open();
    expect(frames(replacement)).toEqual([
      { action: 'subscribe', channel: 'candles.NAS100-F.M15' },
      { action: 'subscribe', channel: 'ticks.NAS100-F' },
      { action: 'subscribe', channel: 'candles.EURUSD.R.H4' },
      { action: 'subscribe', channel: 'ticks.EURUSD.R' },
    ]);

    manager.destroy();
  });

  it('routes direct candle updates by their explicit timeframe', () => {
    const manager = new CandleSocketManager();
    const received: CandlePayload[] = [];

    manager.subscribe('EURUSD.r', 'h4', (next) => received.push(next));
    const socket = FakeWebSocket.instances[0];
    socket.open();
    socket.emit({
      type: 'update',
      symbol: 'EURUSD.r',
      timeframe: 'h4',
      candle: candle(1_788_176_700, 1.125),
    });

    expect(received).toEqual([
      expect.objectContaining({ symbol: 'EURUSD.R', timeframe: 'H4', close: 1.125 }),
    ]);

    manager.destroy();
  });

  it('preserves inner and outer finality aliases and normalizes candle/tick timestamp precision', () => {
    const manager = new CandleSocketManager();
    const received: CandlePayload[] = [];
    const ticks: Array<{ timestamp: number }> = [];

    manager.subscribe('EURUSD.r', 'M1', (next) => received.push(next), (tick) => ticks.push(tick));
    const socket = FakeWebSocket.instances[0];
    socket.open();

    socket.emit({
      type: 'channel_message',
      channel: 'candles.EURUSD.R.M1',
      final: '1',
      data: { ...candle(1_788_176_700_123_456, 1.125), time: 1_788_176_700_123_456 },
    });
    socket.emit({
      type: 'update',
      symbol: 'EURUSD.r',
      timeframe: 'M1',
      completed: 1,
      candle: { ...candle(1_788_176_760, 1.126), isClosed: 'false' },
    });
    socket.emit({
      type: 'channel_message',
      channel: 'ticks.EURUSD.R',
      data: { bid: 1.126, ask: 1.1262, event_time: '2026-09-04T08:11:40.123Z' },
    });

    expect(received).toEqual([
      expect.objectContaining({ time: 1_788_176_700, closed: true }),
      expect.objectContaining({ time: 1_788_176_760, closed: false }),
    ]);
    expect(ticks).toEqual([expect.objectContaining({ timestamp: 1_788_509_500_123 })]);

    manager.destroy();
  });

  it('suspends a pending heartbeat while hidden and resubscribes once visible', () => {
    vi.useFakeTimers();
    let visibilityState: DocumentVisibilityState = 'visible';
    vi.spyOn(document, 'visibilityState', 'get').mockImplementation(() => visibilityState);
    const manager = new CandleSocketManager();

    manager.subscribe('NAS100-F', 'M5');
    const socket = FakeWebSocket.instances[0];
    socket.open();
    vi.advanceTimersByTime(25_000);

    visibilityState = 'hidden';
    document.dispatchEvent(new Event('visibilitychange'));
    vi.advanceTimersByTime(60_000);
    expect(socket.readyState).toBe(FakeWebSocket.OPEN);

    visibilityState = 'visible';
    document.dispatchEvent(new Event('visibilitychange'));
    expect(FakeWebSocket.instances).toHaveLength(2);
    const replacement = FakeWebSocket.instances[1];
    replacement.open();
    expect(frames(replacement)).toEqual([
      { action: 'subscribe', channel: 'candles.NAS100-F.M5' },
      { action: 'subscribe', channel: 'ticks.NAS100-F' },
    ]);

    manager.destroy();
  });

  it('retains exponential backoff across short opens and resets it after a stable open', () => {
    vi.useFakeTimers();
    vi.spyOn(Math, 'random').mockReturnValue(0);
    const manager = new CandleSocketManager();

    manager.subscribe('EURUSD', 'M1');
    const first = FakeWebSocket.instances[0];
    first.open();
    first.close(1006, 'short-lived connection');

    vi.advanceTimersByTime(999);
    expect(FakeWebSocket.instances).toHaveLength(1);
    vi.advanceTimersByTime(1);
    expect(FakeWebSocket.instances).toHaveLength(2);

    const second = FakeWebSocket.instances[1];
    second.open();
    vi.advanceTimersByTime(CANDLE_SOCKET_STABLE_OPEN_MS - 1);
    second.close(1006, 'short-lived connection');

    vi.advanceTimersByTime(1_999);
    expect(FakeWebSocket.instances).toHaveLength(2);
    vi.advanceTimersByTime(1);
    expect(FakeWebSocket.instances).toHaveLength(3);

    const stable = FakeWebSocket.instances[2];
    stable.open();
    vi.advanceTimersByTime(CANDLE_SOCKET_STABLE_OPEN_MS);
    stable.close(1006, 'closed after stable period');

    vi.advanceTimersByTime(999);
    expect(FakeWebSocket.instances).toHaveLength(3);
    vi.advanceTimersByTime(1);
    expect(FakeWebSocket.instances).toHaveLength(4);

    manager.destroy();
  });

  it('adds bounded reconnect jitter of at most twenty percent', () => {
    vi.useFakeTimers();
    vi.spyOn(Math, 'random').mockReturnValue(1);
    const manager = new CandleSocketManager();

    manager.subscribe('EURUSD', 'M1');
    const socket = FakeWebSocket.instances[0];
    socket.open();
    socket.close(1006, 'transport failure');

    vi.advanceTimersByTime(1_199);
    expect(FakeWebSocket.instances).toHaveLength(1);
    vi.advanceTimersByTime(1);
    expect(FakeWebSocket.instances).toHaveLength(2);

    manager.destroy();
  });

  it('pauses a scheduled reconnect while hidden and resumes once visible', () => {
    vi.useFakeTimers();
    vi.spyOn(Math, 'random').mockReturnValue(0);
    let visibilityState: DocumentVisibilityState = 'visible';
    vi.spyOn(document, 'visibilityState', 'get').mockImplementation(() => visibilityState);
    const manager = new CandleSocketManager();

    manager.subscribe('EURUSD', 'M1');
    const socket = FakeWebSocket.instances[0];
    socket.open();
    socket.close(1006, 'transport failure');

    visibilityState = 'hidden';
    document.dispatchEvent(new Event('visibilitychange'));
    vi.advanceTimersByTime(30_000);
    expect(FakeWebSocket.instances).toHaveLength(1);

    visibilityState = 'visible';
    document.dispatchEvent(new Event('visibilitychange'));
    expect(FakeWebSocket.instances).toHaveLength(2);

    manager.destroy();
  });

  it('clears stable-open and reconnect timers when destroyed', () => {
    vi.useFakeTimers();
    vi.spyOn(Math, 'random').mockReturnValue(0);
    const manager = new CandleSocketManager();

    manager.subscribe('EURUSD', 'M1');
    const socket = FakeWebSocket.instances[0];
    socket.open();
    socket.close(1006, 'transport failure');
    manager.destroy();

    vi.advanceTimersByTime(60_000);
    expect(FakeWebSocket.instances).toHaveLength(1);
  });
});
