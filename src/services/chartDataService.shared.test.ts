// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ChartDataService, CANDLE_STREAM_BASE_RECONNECT_DELAY_MS, type CandleStreamOptions, type CandleStreamSubscription } from './chartDataService';
import { commitBrokerAccountSessionScope } from './brokerSession';

class FakeWebSocket {
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSED = 3;
  static instances: FakeWebSocket[] = [];
  readyState = FakeWebSocket.CONNECTING;
  sent: string[] = [];
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  onclose: ((event: { code: number; reason: string }) => void) | null = null;
  constructor(public url: string) { FakeWebSocket.instances.push(this); }
  open() { this.readyState = FakeWebSocket.OPEN; this.onopen?.(); }
  emit(data: unknown) { this.onmessage?.({ data: JSON.stringify(data) }); }
  send(data: string) { this.sent.push(data); }
  close(code = 1000, reason = '') { this.readyState = FakeWebSocket.CLOSED; this.onclose?.({ code, reason }); }
}

type RuntimeWindow = Window & { __RTX_RUNTIME_CONFIG__?: Record<string, unknown> };
const subscriptions: CandleStreamSubscription[] = [];
const candle = { time: 1760000400, open: 100, high: 102, low: 99, close: 101, volume: 5 };
const subscribe = (service: ChartDataService, overrides: Partial<CandleStreamOptions> = {}) => {
  const callbacks = { onConnected: vi.fn(), onCandle: vi.fn(), onSnapshot: vi.fn(), onError: vi.fn() };
  const subscription = service.subscribeCandles({ symbol: 'EURUSD.r', timeframe: 'M1', ...callbacks, ...overrides });
  subscriptions.push(subscription);
  return { ...callbacks, ...subscription };
};
const frames = (socket: FakeWebSocket, action: string) => socket.sent.map(data => JSON.parse(data)).filter(data => data.action === action);

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  (window as RuntimeWindow).__RTX_RUNTIME_CONFIG__ = {
    BACKEND_TARGET: 'web', API_HOST: 'https://broker.example', WS_HOST: 'wss://broker.example',
    BROKER_ID: 'Fixture', DEFAULT_MT5_SERVER: 'Fixture-Live',
  };
  localStorage.setItem('broker_id', 'Fixture');
  localStorage.setItem('server_url', 'https://broker.example');
  localStorage.setItem('auth_token', 'token-a');
  commitBrokerAccountSessionScope({ authenticated: true, accountId: '100', brokerId: 'Fixture', serverUrl: 'https://broker.example' });
  FakeWebSocket.instances = [];
  vi.stubGlobal('WebSocket', FakeWebSocket);
});
afterEach(async () => {
  subscriptions.splice(0).forEach(subscription => subscription.close());
  await Promise.resolve();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  commitBrokerAccountSessionScope({ authenticated: false, brokerId: '', serverUrl: '' });
  delete (window as RuntimeWindow).__RTX_RUNTIME_CONFIG__;
});

describe('shared candle stream ownership', () => {
  it('shares an exact protocol channel and retains it until the final pane releases ownership', async () => {
    const service = new ChartDataService();
    const a = subscribe(service);
    const b = subscribe(service, { symbol: 'eurusd.r', timeframe: '1m' });
    expect(FakeWebSocket.instances).toHaveLength(1);
    const socket = FakeWebSocket.instances[0];
    socket.open();
    expect(frames(socket, 'subscribe')).toHaveLength(1);
    socket.emit({ type: 'subscribed', channel: 'candles.EURUSD.R.M1' });
    socket.emit({ channel: 'candles.EURUSD.R.M1', data: { candles: [candle] } });
    expect(a.onConnected).toHaveBeenCalledOnce();
    expect(b.onConnected).toHaveBeenCalledOnce();
    expect(a.onSnapshot).toHaveBeenCalledExactlyOnceWith([candle]);
    expect(b.onSnapshot).toHaveBeenCalledExactlyOnceWith([candle]);

    a.close();
    a.close();
    await Promise.resolve();
    socket.emit({ channel: 'candles.EURUSD.R.M1', data: candle });
    expect(a.onCandle).not.toHaveBeenCalled();
    expect(b.onCandle).toHaveBeenCalledExactlyOnceWith(candle);
    expect(socket.readyState).toBe(FakeWebSocket.OPEN);
    expect(frames(socket, 'unsubscribe')).toHaveLength(0);

    b.close();
    socket.emit({ channel: 'candles.EURUSD.R.M1', data: candle });
    expect(b.onCandle).toHaveBeenCalledOnce();
    await Promise.resolve();
    expect(socket.readyState).toBe(FakeWebSocket.CLOSED);
    expect(frames(socket, 'unsubscribe')).toHaveLength(1);
    subscribe(service);
    expect(FakeWebSocket.instances).toHaveLength(2);
  });

  it('retains one socket through StrictMode cleanup and same-turn reacquisition', async () => {
    const service = new ChartDataService();
    const discarded = subscribe(service);
    discarded.close();
    const retained = subscribe(service);
    await Promise.resolve();
    expect(FakeWebSocket.instances).toHaveLength(1);
    const socket = FakeWebSocket.instances[0];
    socket.open();
    socket.emit({ channel: 'candles.EURUSD.R.M1', data: candle });
    expect(frames(socket, 'subscribe')).toHaveLength(1);
    expect(discarded.onConnected).not.toHaveBeenCalled();
    expect(discarded.onCandle).not.toHaveBeenCalled();
    expect(retained.onConnected).toHaveBeenCalledOnce();
    expect(retained.onCandle).toHaveBeenCalledExactlyOnceWith(candle);
  });

  it('reports current readiness to a late pane without replaying stale candle data', async () => {
    const service = new ChartDataService();
    subscribe(service);
    const socket = FakeWebSocket.instances[0];
    socket.open();
    socket.emit({ channel: 'candles.EURUSD.R.M1', data: candle });
    const late = subscribe(service);
    await Promise.resolve();
    expect(late.onConnected).toHaveBeenCalledOnce();
    expect(late.onCandle).not.toHaveBeenCalled();
    expect(late.onSnapshot).not.toHaveBeenCalled();
    expect(frames(socket, 'subscribe')).toHaveLength(1);
  });

  it('does not report stale readiness while the shared transport is reconnecting', async () => {
    vi.useFakeTimers();
    const service = new ChartDataService();
    const first = subscribe(service);
    const socket = FakeWebSocket.instances[0];
    socket.open();
    socket.emit({ type: 'subscribed', channel: 'candles.EURUSD.R.M1' });
    socket.close(1006);
    const late = subscribe(service);
    await Promise.resolve();
    expect(late.onConnected).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(CANDLE_STREAM_BASE_RECONNECT_DELAY_MS);
    expect(FakeWebSocket.instances).toHaveLength(2);
    const replacement = FakeWebSocket.instances[1];
    replacement.open();
    replacement.emit({ type: 'subscribed', channel: 'candles.EURUSD.R.M1' });
    expect(first.onConnected).toHaveBeenCalledTimes(2);
    expect(late.onConnected).toHaveBeenCalledOnce();
  });

  it('keeps broker symbol suffixes and different protocol timeframes separate', () => {
    const service = new ChartDataService();
    subscribe(service);
    subscribe(service, { symbol: 'EURUSD' });
    subscribe(service, { timeframe: 'M5' });
    expect(FakeWebSocket.instances).toHaveLength(3);
    FakeWebSocket.instances.forEach(socket => socket.open());
    expect(FakeWebSocket.instances.map(socket => frames(socket, 'subscribe')[0].channel))
      .toEqual(['candles.EURUSD.R.M1', 'candles.EURUSD.M1', 'candles.EURUSD.R.M5']);
  });

  it.each(['token', 'account', 'endpoint', 'deployment'] as const)('isolates a changed %s from old callbacks and cleanup', async change => {
    const service = new ChartDataService();
    const old = subscribe(service);
    const staleSocket = FakeWebSocket.instances[0];
    staleSocket.open();
    staleSocket.emit({ type: 'subscribed', channel: 'candles.EURUSD.R.M1' });
    const lateOldOwner = subscribe(service);
    if (change === 'token') localStorage.setItem('auth_token', 'token-b');
    if (change === 'account') commitBrokerAccountSessionScope({ authenticated: true, accountId: '200', brokerId: 'Fixture', serverUrl: 'https://broker.example' });
    if (change === 'endpoint') {
      (window as RuntimeWindow).__RTX_RUNTIME_CONFIG__!.API_HOST = 'https://other.example';
      (window as RuntimeWindow).__RTX_RUNTIME_CONFIG__!.WS_HOST = 'wss://other.example';
    }
    if (change === 'deployment') (window as RuntimeWindow).__RTX_RUNTIME_CONFIG__!.BROKER_ID = 'Other';
    staleSocket.emit({ channel: 'candles.EURUSD.R.M1', data: candle });
    expect(old.onCandle).not.toHaveBeenCalled();
    const current = subscribe(service);
    await Promise.resolve();
    expect(FakeWebSocket.instances).toHaveLength(2);
    expect(staleSocket.readyState).toBe(FakeWebSocket.CLOSED);
    staleSocket.emit({ channel: 'candles.EURUSD.R.M1', data: candle });
    expect(old.onCandle).not.toHaveBeenCalled();
    expect(lateOldOwner.onConnected).not.toHaveBeenCalled();
    expect(current.onCandle).not.toHaveBeenCalled();
    const currentSocket = FakeWebSocket.instances[1];
    currentSocket.open();
    old.close();
    lateOldOwner.close();
    await Promise.resolve();
    currentSocket.emit({ channel: 'candles.EURUSD.R.M1', data: candle });
    expect(currentSocket.readyState).toBe(FakeWebSocket.OPEN);
    expect(current.onCandle).toHaveBeenCalledExactlyOnceWith(candle);
    expect(old.onCandle).not.toHaveBeenCalled();
  });

  it('does not let one pane callback failure prevent sibling delivery', () => {
    const service = new ChartDataService();
    const failed = subscribe(service, { onCandle: () => { throw new Error('pane disposed'); } });
    const sibling = subscribe(service);
    const socket = FakeWebSocket.instances[0];
    socket.open();
    socket.emit({ channel: 'candles.EURUSD.R.M1', data: candle });
    expect(failed.onError).toHaveBeenCalledOnce();
    expect(sibling.onCandle).toHaveBeenCalledExactlyOnceWith(candle);
  });

  it('keeps each pane candle payload independent of sibling mutations', () => {
    const service = new ChartDataService();
    subscribe(service, {
      onCandle: value => { value.close = 999; },
      onSnapshot: values => { values[0].close = 999; values.pop(); },
    });
    const sibling = subscribe(service);
    const socket = FakeWebSocket.instances[0];
    socket.open();
    socket.emit({ channel: 'candles.EURUSD.R.M1', data: candle });
    socket.emit({ channel: 'candles.EURUSD.R.M1', data: { candles: [candle] } });
    expect(sibling.onCandle).toHaveBeenCalledExactlyOnceWith(candle);
    expect(sibling.onSnapshot).toHaveBeenCalledExactlyOnceWith([candle]);
  });
});
