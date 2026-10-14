/**
 * Low-overhead market-order latency telemetry.
 *
 * `WebSocket.send()` only enqueues data in the browser. The metrics below keep
 * that local enqueue time separate from server acknowledgement and terminal
 * fill/rejection RTT so the UI never reports an enqueue as a completed trade.
 */

export const TRADE_ORDER_LATENCY_EVENT = 'rtx:trade-order-latency';

export type TradeOrderLatencyTransport = 'websocket' | 'rest';

export type TradeOrderTerminalStatus = 'filled' | 'rejected' | 'expired' | 'failed';

export type TradeOrderLatencyPhase =
  | 'ws_enqueued'
  | 'order_accepted'
  | 'order_filled'
  | 'order_rejected'
  | 'status_recovery_sent'
  | 'ws_transport_error'
  | 'rest_started'
  | 'rest_response'
  | 'rest_completed'
  | 'rest_failed'
  | 'placement_terminal';

export interface TradeOrderLatencySample {
  version: 1;
  sequence: number;
  recordedAtEpochMs: number;
  phase: TradeOrderLatencyPhase;
  transport: TradeOrderLatencyTransport;
  traceId: string;
  /** Exact local correlation key. Retained in memory only for Journal reconciliation. */
  clientOrderId?: string;
  sessionScope?: string;
  symbol?: string;
  side?: 'buy' | 'sell';
  volume?: number;
  terminalStatus?: TradeOrderTerminalStatus;
  errorCode?: string;
  errorMessage?: string;
  reason?: string;
  payloadBytes?: number;
  serializationMs?: number;
  sendCallMs?: number;
  intentToEnqueueMs?: number;
  apiToEnqueueMs?: number;
  acceptedRttMs?: number;
  acceptedToTerminalMs?: number;
  terminalRttMs?: number;
  statusRttMs?: number;
  restRttMs?: number;
  totalMs?: number;
  bufferedAmountBefore?: number;
  bufferedAmountAfter?: number;
}

export interface TradeOrderLatencySummary {
  count: number;
  min: number;
  max: number;
  mean: number;
  p50: number;
  p95: number;
  p99: number;
}

export type TradeOrderLatencyMetric =
  | 'serializationMs'
  | 'sendCallMs'
  | 'intentToEnqueueMs'
  | 'apiToEnqueueMs'
  | 'acceptedRttMs'
  | 'acceptedToTerminalMs'
  | 'terminalRttMs'
  | 'statusRttMs'
  | 'restRttMs'
  | 'totalMs';

type RecordedTradeOrderLatencyInput = Omit<
  TradeOrderLatencySample,
  'version' | 'sequence' | 'recordedAtEpochMs'
>;

const MAX_RETAINED_SAMPLES = 200;
const samples: TradeOrderLatencySample[] = [];
// Journal needs completed attempts even when a burst of enqueue/acknowledgement
// diagnostics has displaced them from the general-purpose sample ring.
const journalSamples: TradeOrderLatencySample[] = [];
let sampleSequence = 0;

/** Monotonic clock for durations; wall-clock time is never used for subtraction. */
export const tradeOrderNow = (): number => (
  typeof globalThis.performance?.now === 'function'
    ? globalThis.performance.now()
    : Date.now()
);

/** Capture this at the first instruction in a click/keyboard trade handler. */
export const captureTradeOrderIntent = (): number => tradeOrderNow();

/** Short local correlation label; avoids exposing complete durable IDs in routine metrics. */
export const toTradeOrderTraceId = (clientOrderId: string): string => {
  const normalized = String(clientOrderId || '').trim();
  return normalized ? normalized.slice(-8) : 'unknown';
};

const percentile = (sorted: number[], value: number): number => {
  if (sorted.length === 0) return 0;
  const index = Math.max(0, Math.ceil(sorted.length * value) - 1);
  return sorted[Math.min(index, sorted.length - 1)];
};

export const getTradeOrderLatencySamples = (): readonly TradeOrderLatencySample[] =>
  samples.slice();

export const getJournalTradeOrderLatencySamples = (): readonly TradeOrderLatencySample[] =>
  journalSamples.slice();

export const clearTradeOrderLatencySamples = (): void => {
  samples.length = 0;
  journalSamples.length = 0;
};

export const summarizeTradeOrderLatency = (
  metric: TradeOrderLatencyMetric,
  filter: Partial<Pick<TradeOrderLatencySample, 'phase' | 'transport'>> = {},
): TradeOrderLatencySummary | null => {
  const values = samples
    .filter(sample => (
      (filter.phase === undefined || sample.phase === filter.phase)
      && (filter.transport === undefined || sample.transport === filter.transport)
    ))
    .map(sample => sample[metric])
    .filter((value): value is number => typeof value === 'number' && Number.isFinite(value))
    .sort((left, right) => left - right);

  if (values.length === 0) return null;
  const total = values.reduce((sum, value) => sum + value, 0);
  return {
    count: values.length,
    min: values[0],
    max: values[values.length - 1],
    mean: total / values.length,
    p50: percentile(values, 0.50),
    p95: percentile(values, 0.95),
    p99: percentile(values, 0.99),
  };
};

export const recordTradeOrderLatency = (
  input: RecordedTradeOrderLatencyInput,
): TradeOrderLatencySample => {
  const sample = Object.freeze({
    ...input,
    version: 1 as const,
    sequence: ++sampleSequence,
    recordedAtEpochMs: Date.now(),
  });

  samples.push(sample);
  if (samples.length > MAX_RETAINED_SAMPLES) {
    samples.splice(0, samples.length - MAX_RETAINED_SAMPLES);
  }

  const isTerminal = sample.phase === 'placement_terminal'
    || (sample.transport === 'websocket'
      && (sample.phase === 'order_filled' || sample.phase === 'order_rejected'))
    || (sample.transport === 'rest'
      && (sample.phase === 'rest_completed' || sample.phase === 'rest_failed'));
  if (isTerminal && sample.sessionScope) {
    journalSamples.push(sample);
    if (journalSamples.length > MAX_RETAINED_SAMPLES) {
      journalSamples.splice(0, journalSamples.length - MAX_RETAINED_SAMPLES);
    }
  }

  // Notify observers in a later task. In particular, a terminal fill/rejection
  // resolves its order Promise in the current task; using a timer instead of a
  // microtask lets that Promise's UI continuation run before any diagnostics
  // listener, even if a development listener is accidentally expensive.
  if (typeof window !== 'undefined' && typeof window.dispatchEvent === 'function') {
    setTimeout(() => {
      window.dispatchEvent(new CustomEvent(TRADE_ORDER_LATENCY_EVENT, { detail: sample }));
    }, 0);
  }
  return sample;
};

export interface TradeOrderLatencyDebugApi {
  getSamples: typeof getTradeOrderLatencySamples;
  clear: typeof clearTradeOrderLatencySamples;
  summarize: typeof summarizeTradeOrderLatency;
}

declare global {
  interface Window {
    __RTX_TRADE_ORDER_LATENCY__?: TradeOrderLatencyDebugApi;
  }
}

if (typeof window !== 'undefined') {
  window.__RTX_TRADE_ORDER_LATENCY__ = Object.freeze({
    getSamples: getTradeOrderLatencySamples,
    clear: clearTradeOrderLatencySamples,
    summarize: summarizeTradeOrderLatency,
  });
}
