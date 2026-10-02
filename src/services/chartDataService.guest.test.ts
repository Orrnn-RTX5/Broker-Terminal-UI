import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { CANDLE_STREAM_BASE_RECONNECT_DELAY_MS, ChartDataService } from './chartDataService';

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

  emit(message: unknown): void {
    this.onmessage?.({ data: JSON.stringify(message) });
  }

  emitClose(code = 1006, reason = ''): void {
    this.readyState = FakeWebSocket.CLOSED;
    this.onclose?.({ code, reason });
  }

  send(payload: string): void {
    this.sent.push(payload);
  }

  close(code = 1000, reason = ''): void {
    this.readyState = FakeWebSocket.CLOSED;
    this.onclose?.({ code, reason });
  }
}

beforeEach(() => {
  (window as Window & { __RTX_RUNTIME_CONFIG__?: Record<string, unknown> }).__RTX_RUNTIME_CONFIG__ = {
    BACKEND_TARGET: 'web', API_HOST: 'https://broker.example', WS_HOST: 'wss://broker.example',
    BROKER_ID: 'Fixture', DEFAULT_MT5_SERVER: 'Fixture-Live',
  };
  FakeWebSocket.instances = [];
  localStorage.clear();
  sessionStorage.clear();
  vi.stubGlobal('WebSocket', FakeWebSocket);
});

afterEach(() => {
  delete (window as Window & { __RTX_RUNTIME_CONFIG__?: Record<string, unknown> }).__RTX_RUNTIME_CONFIG__;
  vi.unstubAllGlobals();
  vi.useRealTimers();
  localStorage.clear();
  sessionStorage.clear();
});

it('streams guest candles immediately over anonymous WebSocket without an auth frame', () => {
  const fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
  const service = new ChartDataService();
  const onConnected = vi.fn();
  const onCandle = vi.fn();
  const stream = service.subscribeCandles({
    symbol: 'XAUUSD',
    timeframe: 'M1',
    onConnected,
    onCandle,
  });

  expect(FakeWebSocket.instances).toHaveLength(1);
  const socket = FakeWebSocket.instances[0];
  expect(socket.url).toContain('/ws/v2');
  expect(socket.url).not.toContain('token=');

  socket.open();
  expect(socket.sent.map(payload => JSON.parse(payload))).toEqual([
    { action: 'subscribe', channel: 'candles.XAUUSD.M1', channels: ['candles.XAUUSD.M1'] },
  ]);
  expect(onConnected).not.toHaveBeenCalled();

  socket.emit({ type: 'subscribed', channel: 'candles.XAUUSD.M1' });
  socket.emit({
    channel: 'candles.XAUUSD.M1',
    data: { time: 1789479000, open: 1, high: 2, low: 1, close: 2, volume: 10 },
  });

  expect(onConnected).toHaveBeenCalledOnce();
  expect(onCandle).toHaveBeenCalledWith(expect.objectContaining({ close: 2 }));
  expect(fetchMock).not.toHaveBeenCalled();

  stream.close();
  expect(socket.sent.map(payload => JSON.parse(payload)).at(-1)).toEqual({
    action: 'unsubscribe',
    channel: 'candles.XAUUSD.M1',
    channels: ['candles.XAUUSD.M1'],
  });
});

it('retries the anonymous stream after a transient pre-readiness close', async () => {
  vi.useFakeTimers();
  const fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
  const service = new ChartDataService();
  const stream = service.subscribeCandles({ symbol: 'XAUUSD', timeframe: 'M1' });
  const firstSocket = FakeWebSocket.instances[0];

  firstSocket.open();
  firstSocket.emitClose(1006, 'temporary network interruption');

  expect(fetchMock).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(CANDLE_STREAM_BASE_RECONNECT_DELAY_MS - 1);
  expect(FakeWebSocket.instances).toHaveLength(1);
  await vi.advanceTimersByTimeAsync(1);
  expect(FakeWebSocket.instances).toHaveLength(2);
  expect(fetchMock).not.toHaveBeenCalled();

  stream.close();
});

it('falls back to cancellable public REST refreshes when anonymous candles are rejected', async () => {
  vi.useFakeTimers();
  const fetchMock = vi.fn().mockImplementation(async () => new Response(JSON.stringify({
    candles: [{ time: 1789479000, open: 1, high: 2, low: 1, close: 2, volume: 10 }],
  })));
  vi.stubGlobal('fetch', fetchMock);
  const service = new ChartDataService();
  const onCandle = vi.fn();
  const stream = service.subscribeCandles({ symbol: 'XAUUSD', timeframe: 'M1', onCandle });
  const socket = FakeWebSocket.instances[0];

  socket.open();
  socket.emitClose(4401, 'anonymous candles unavailable');
  await vi.advanceTimersByTimeAsync(0);

  expect(onCandle).toHaveBeenCalledWith(expect.objectContaining({ close: 2 }));
  expect(fetchMock).toHaveBeenCalledWith(
    expect.stringContaining('/api/v2/candles/XAUUSD'),
    expect.objectContaining({ credentials: 'omit', headers: { 'X-Broker-ID': 'Fixture' }, redirect: 'error' }),
  );

  await vi.advanceTimersByTimeAsync(3000);
  expect(fetchMock).toHaveBeenCalledTimes(2);
  const signal = fetchMock.mock.calls[0][1].signal as AbortSignal;
  stream.close();
  expect(signal.aborted).toBe(true);
  await vi.advanceTimersByTimeAsync(6000);
  expect(fetchMock).toHaveBeenCalledTimes(2);
});

it('falls back to public REST if an established anonymous stream later loses authorization', async () => {
  vi.useFakeTimers();
  const fetchMock = vi.fn().mockImplementation(async () => new Response(JSON.stringify({
    candles: [{ time: 1789479000, open: 1, high: 2, low: 1, close: 2, volume: 10 }],
  })));
  vi.stubGlobal('fetch', fetchMock);
  const service = new ChartDataService();
  const stream = service.subscribeCandles({ symbol: 'XAUUSD', timeframe: 'M1' });
  const socket = FakeWebSocket.instances[0];

  socket.open();
  socket.emit({ type: 'subscribed', channel: 'candles.XAUUSD.M1' });
  socket.emitClose(4401, 'anonymous candle access expired');
  await vi.advanceTimersByTimeAsync(0);

  expect(fetchMock).toHaveBeenCalledOnce();
  stream.close();
});

it('sends no captured candle credentials when the socket opens after a broker switch', async () => {
  vi.useFakeTimers();
  localStorage.setItem('server_url', 'https://broker.example');
  localStorage.setItem('broker_id', 'Fixture');
  localStorage.setItem('auth_token', 'previous-broker-token');
  const fetchMock = vi.fn(); vi.stubGlobal('fetch', fetchMock);
  const stream = new ChartDataService().subscribeCandles({ symbol: 'XAUUSD', timeframe: 'M1' });
  const captured = FakeWebSocket.instances[0];
  (window as Window & { __RTX_RUNTIME_CONFIG__?: Record<string, unknown> }).__RTX_RUNTIME_CONFIG__!.BROKER_ID = 'NewBroker';
  localStorage.setItem('broker_id', 'NewBroker'); localStorage.setItem('auth_token', 'new-broker-token');
  captured.open();
  await vi.advanceTimersByTimeAsync(5000);
  expect(captured.sent).toEqual([]);
  expect(captured.readyState).toBe(FakeWebSocket.CLOSED);
  expect(FakeWebSocket.instances).toHaveLength(1);
  expect(fetchMock).not.toHaveBeenCalled();
  stream.close();
});

it('discards delayed candle history when the broker changes on the same origin', async () => {
  let complete!: (response: Response) => void;
  const fetchMock = vi.fn(() => new Promise<Response>(resolve => { complete = resolve; }));
  vi.stubGlobal('fetch', fetchMock);
  const history = new ChartDataService().fetchCandles({ symbol: 'XAUUSD', timeframe: 'M1', count: 3 });
  (window as Window & { __RTX_RUNTIME_CONFIG__?: Record<string, unknown> }).__RTX_RUNTIME_CONFIG__!.BROKER_ID = 'NewBroker';
  complete(new Response(JSON.stringify({ candles: [{ time: 1789479000, open: 1, high: 2, low: 1, close: 2, volume: 10 }] })));
  await expect(history).rejects.toMatchObject({ name: 'AbortError' });
  expect(fetchMock).toHaveBeenCalledOnce();
});
