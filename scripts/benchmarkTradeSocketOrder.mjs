import { performance } from 'node:perf_hooks';
import { createServer } from 'vite';

const requestedIterations = Number.parseInt(process.argv[2] || '50000', 10);
const iterations = Number.isFinite(requestedIterations)
  ? Math.min(250_000, Math.max(1_000, requestedIterations))
  : 50_000;

class BenchmarkWebSocket {
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSED = 3;
  static instance;

  readyState = BenchmarkWebSocket.CONNECTING;
  bufferedAmount = 0;
  lastPayload = '';
  onopen = null;
  onmessage = null;
  onclose = null;
  onerror = null;

  constructor(url) {
    this.url = url;
    BenchmarkWebSocket.instance = this;
  }

  open() {
    this.readyState = BenchmarkWebSocket.OPEN;
    this.onopen?.();
  }

  send(payload) {
    this.lastPayload = payload;
    this.bufferedAmount += Buffer.byteLength(payload, 'utf8');
  }

  emit(message) {
    this.bufferedAmount = 0;
    this.onmessage?.({ data: JSON.stringify(message) });
  }

  close() {
    this.readyState = BenchmarkWebSocket.CLOSED;
    this.onclose?.();
  }
}

const percentile = (sorted, ratio) => {
  const index = Math.max(0, Math.ceil(sorted.length * ratio) - 1);
  return sorted[Math.min(index, sorted.length - 1)];
};

const summarize = (values) => {
  const sorted = [...values].sort((left, right) => left - right);
  const total = sorted.reduce((sum, value) => sum + value, 0);
  return {
    count: sorted.length,
    min: sorted[0],
    mean: total / sorted.length,
    p50: percentile(sorted, 0.50),
    p95: percentile(sorted, 0.95),
    p99: percentile(sorted, 0.99),
    max: sorted[sorted.length - 1],
  };
};

const roundSummary = (summary) => summary && Object.fromEntries(
  Object.entries(summary).map(([key, value]) => [
    key,
    typeof value === 'number' && key !== 'count' ? Number(value.toFixed(6)) : value,
  ]),
);

const measureTimerResolution = (attempts = 100_000) => {
  let previous = performance.now();
  let smallestPositiveDelta = Number.POSITIVE_INFINITY;
  for (let index = 0; index < attempts; index += 1) {
    const current = performance.now();
    const delta = current - previous;
    if (delta > 0 && delta < smallestPositiveDelta) smallestPositiveDelta = delta;
    previous = current;
  }
  return Number.isFinite(smallestPositiveDelta) ? smallestPositiveDelta : null;
};

const vite = await createServer({
  appType: 'custom',
  logLevel: 'error',
  server: { middlewareMode: true },
});

const previousWebSocket = globalThis.WebSocket;
globalThis.WebSocket = BenchmarkWebSocket;

try {
  const [{ TradeWebSocketClient }, telemetry] = await Promise.all([
    vite.ssrLoadModule('/src/api/tradeSocket.ts'),
    vite.ssrLoadModule('/src/services/orderLatencyTelemetry.ts'),
  ]);
  const client = new TradeWebSocketClient({
    url: 'wss://benchmark.invalid/ws/v2',
    token: 'benchmark-token',
    reconnect: false,
  });
  client.connect();
  const socket = BenchmarkWebSocket.instance;
  socket.open();
  socket.bufferedAmount = 0;

  const payload = {
    account_login: 200002,
    symbol: 'BTCUSD',
    side: 'buy',
    type: 'market',
    volume: 0.01,
    sl: 0,
    tp: 0,
  };

  const runIteration = async () => {
    const callStartedAt = performance.now();
    const resultPromise = client.placeOrder(payload);
    const promiseReturnedAt = performance.now();
    const request = JSON.parse(socket.lastPayload);
    socket.emit({
      type: 'order_filled',
      status: 'filled',
      success: true,
      request_id: request.request_id,
      client_order_id: request.client_order_id,
      data: {
        order_ticket: 880001,
        position_ticket: 990001,
        symbol: 'BTCUSD',
        side: 'buy',
        volume: 0.01,
        price: 65_321.45,
        status: 'filled',
      },
    });
    await resultPromise;
    return {
      localCallMs: promiseReturnedAt - callStartedAt,
      syntheticRoundTripMs: performance.now() - callStartedAt,
      payloadBytes: Buffer.byteLength(socket.lastPayload, 'utf8'),
    };
  };

  // Warm V8 and module paths before retaining samples.
  for (let index = 0; index < Math.min(2_000, Math.ceil(iterations / 10)); index += 1) {
    await runIteration();
  }
  telemetry.clearTradeOrderLatencySamples();

  const localCalls = [];
  const syntheticRoundTrips = [];
  let payloadBytes = 0;
  for (let index = 0; index < iterations; index += 1) {
    const result = await runIteration();
    localCalls.push(result.localCallMs);
    syntheticRoundTrips.push(result.syntheticRoundTripMs);
    payloadBytes = result.payloadBytes;
  }

  const output = {
    warning: 'Synthetic local benchmark only; WebSocket.send() enqueue is not network delivery.',
    iterations,
    timerResolutionMs: measureTimerResolution(),
    applicationPayloadBytes: payloadBytes,
    estimatedUncompressedClientFrameBytes: payloadBytes + 8,
    frameSizeWarning: 'Frame estimate includes WebSocket header, extended length, and client mask only; it excludes TLS/TCP/IP overhead.',
    localPlaceOrderCallMs: roundSummary(summarize(localCalls)),
    localPlaceOrderThroughSyntheticFillMs: roundSummary(summarize(syntheticRoundTrips)),
    retainedSendCallMs: roundSummary(
      telemetry.summarizeTradeOrderLatency('sendCallMs', { phase: 'ws_enqueued' }),
    ),
    retainedApiToEnqueueMs: roundSummary(
      telemetry.summarizeTradeOrderLatency('apiToEnqueueMs', { phase: 'ws_enqueued' }),
    ),
  };
  console.log(JSON.stringify(output, null, 2));
  client.disconnect();
} finally {
  globalThis.WebSocket = previousWebSocket;
  await vite.close();
}
