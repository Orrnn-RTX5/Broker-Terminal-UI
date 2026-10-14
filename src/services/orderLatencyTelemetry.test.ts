import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  clearTradeOrderLatencySamples,
  getTradeOrderLatencySamples,
  getJournalTradeOrderLatencySamples,
  recordTradeOrderLatency,
  summarizeTradeOrderLatency,
  TRADE_ORDER_LATENCY_EVENT,
} from './orderLatencyTelemetry';

describe('order latency telemetry', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    clearTradeOrderLatencySamples();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('keeps a bounded latest-sample ring and calculates filtered percentiles', () => {
    for (let index = 1; index <= 205; index += 1) {
      recordTradeOrderLatency({
        phase: 'ws_enqueued',
        transport: 'websocket',
        traceId: String(index),
        totalMs: index,
      });
    }

    const samples = getTradeOrderLatencySamples();
    expect(samples).toHaveLength(200);
    expect(samples[0]).toMatchObject({ traceId: '6', totalMs: 6 });
    expect(samples.at(-1)).toMatchObject({ traceId: '205', totalMs: 205 });
    expect(summarizeTradeOrderLatency('totalMs', { phase: 'ws_enqueued' })).toMatchObject({
      count: 200,
      min: 6,
      p50: 105,
      p95: 195,
      p99: 203,
      max: 205,
    });
  });

  it('notifies diagnostics in a later task so Promise UI work runs first', async () => {
    const order: string[] = [];
    const listener = () => order.push('diagnostics');
    window.addEventListener(TRADE_ORDER_LATENCY_EVENT, listener);

    try {
      const sample = recordTradeOrderLatency({
        phase: 'order_filled',
        transport: 'websocket',
        traceId: 'redacted',
        sessionScope: 'authenticated|200002|broker-a|https://broker.example',
        terminalRttMs: 10,
      });
      expect(sample.sessionScope).toBe('authenticated|200002|broker-a|https://broker.example');
      void Promise.resolve().then(() => order.push('promise-ui'));

      await Promise.resolve();
      expect(order).toEqual(['promise-ui']);
      await vi.runAllTimersAsync();
      expect(order).toEqual(['promise-ui', 'diagnostics']);
    } finally {
      window.removeEventListener(TRADE_ORDER_LATENCY_EVENT, listener);
    }
  });

  it('retains bounded terminal timings independently of busy transport diagnostics', () => {
    for (let index = 0; index < 205; index += 1) {
      recordTradeOrderLatency({
        phase: 'placement_terminal',
        transport: 'websocket',
        traceId: `terminal-${index}`,
        sessionScope: 'broker-a:account-a',
        terminalStatus: 'filled',
        totalMs: index,
      });
    }
    for (let index = 0; index < 250; index += 1) {
      recordTradeOrderLatency({
        phase: 'ws_enqueued',
        transport: 'websocket',
        traceId: `enqueue-${index}`,
        sessionScope: 'broker-a:account-a',
      });
    }

    expect(getTradeOrderLatencySamples().every(sample => sample.phase === 'ws_enqueued')).toBe(true);
    const journalSamples = getJournalTradeOrderLatencySamples();
    expect(journalSamples).toHaveLength(200);
    expect(journalSamples[0].traceId).toBe('terminal-5');
    expect(journalSamples.at(-1)?.totalMs).toBe(204);
    clearTradeOrderLatencySamples();
    expect(getJournalTradeOrderLatencySamples()).toEqual([]);
  });
});
