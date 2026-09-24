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
  FakeWebSocket.instances = [];
  localStorage.clear();
  sessionStorage.clear();
  vi.stubGlobal('WebSocket', FakeWebSocket);
});

afterEach(() => {
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
    expect.objectContaining({ credentials: 'omit', headers: undefined }),
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
