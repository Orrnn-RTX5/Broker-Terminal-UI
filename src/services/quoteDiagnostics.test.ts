import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const epoch = 1_800_000_000_000;
const configWindow = () => window as Window & { __RTX_RUNTIME_CONFIG__?: Record<string, unknown> };

describe('opt-in quote evidence', () => {
  beforeEach(() => {
    vi.resetModules();
    delete window.__RTX_QUOTE_DIAGNOSTICS_ENABLED__;
    delete window.__RTX_QUOTE_DIAGNOSTICS_SYMBOLS__;
    delete configWindow().__RTX_RUNTIME_CONFIG__;
    vi.spyOn(performance, 'now').mockReturnValue(1000);
    vi.spyOn(Date, 'now').mockReturnValue(epoch);
  });
  afterEach(() => {
    delete window.__RTX_QUOTE_DIAGNOSTICS_ENABLED__;
    delete window.__RTX_QUOTE_DIAGNOSTICS_SYMBOLS__;
    delete configWindow().__RTX_RUNTIME_CONFIG__;
    vi.restoreAllMocks();
  });

  it('is off by default, allows an explicit harness override, and never exports arbitrary fields', async () => {
    const d = await import('./quoteDiagnostics');
    d.recordQuoteDiagnostic({ kind: 'quote', symbol: 'BTCUSD' });
    expect(d.getQuoteDiagnosticDump().quotes).toEqual([]);
    configWindow().__RTX_RUNTIME_CONFIG__ = { QUOTE_DIAGNOSTICS: 'true' };
    expect(d.quoteDiagnosticsEnabled()).toBe(true);
    const unsafe = {
      kind: 'quote' as const, symbol: 'BTCUSD', source: 'https://secret.test/?token=secret',
      sourceVersion: 'https://secret.test/?token=secret',
      hubSequence: '18446744073709551615', token: 'secret', sessionScope: 'account-secret',
      reason: 'message with password=secret', providerTimestamp: Infinity,
    };
    d.recordQuoteDiagnostic(unsafe);
    const record = d.getQuoteDiagnosticDump().quotes[0];
    expect(record).toMatchObject({ kind: 'quote', symbol: 'BTCUSD', hubSequence: '18446744073709551615' });
    expect(JSON.stringify(record)).not.toMatch(/secret|token|sessionScope|providerTimestamp/);
    window.__RTX_QUOTE_DIAGNOSTICS_ENABLED__ = false;
    d.recordQuoteDiagnostic({ kind: 'quote', symbol: 'EURUSD' });
    expect(d.getQuoteDiagnosticDump().quotes).toHaveLength(1);
  });

  it('bounds both rings independently and returns detached snapshots', async () => {
    window.__RTX_QUOTE_DIAGNOSTICS_ENABLED__ = true;
    const d = await import('./quoteDiagnostics');
    d.recordQuoteDiagnostic({ kind: 'trade-control', reason: 'symbol-not-eligible', disabled: true });
    for (let i = 0; i < d.QUOTE_DIAGNOSTIC_CAPACITY + 5; i++) d.recordQuoteDiagnostic({ kind: 'quote', hubSequence: String(i) });
    const dump = d.getQuoteDiagnosticDump();
    expect(dump.quotes).toHaveLength(d.QUOTE_DIAGNOSTIC_CAPACITY);
    expect(dump.quotes[0].hubSequence).toBe('5');
    expect(dump.overwrittenQuotes).toBe(5);
    expect(dump.controls).toHaveLength(1);
    (dump.quotes[0] as Record<string, unknown>).source = 'changed';
    expect(d.getQuoteDiagnosticDump().quotes[0]).not.toHaveProperty('source');
    for (let i = 0; i < d.QUOTE_CONTROL_DIAGNOSTIC_CAPACITY + 2; i++) d.recordQuoteDiagnostic({ kind: 'clock', rttMs: i });
    expect(d.getQuoteDiagnosticDump().controls).toHaveLength(d.QUOTE_CONTROL_DIAGNOSTIC_CAPACITY);
    expect(d.getQuoteDiagnosticDump().overwrittenControls).toBe(3);
    expect(Object.keys(window.__RTX_QUOTE_DIAGNOSTICS__!)).toEqual(['dump']);
  });

  it('filters only quote capture by exact symbol while retaining all control evidence', async () => {
    window.__RTX_QUOTE_DIAGNOSTICS_ENABLED__ = true;
    window.__RTX_QUOTE_DIAGNOSTICS_SYMBOLS__ = [' btcusd ', 'EURUSD'];
    const d = await import('./quoteDiagnostics');
    d.recordQuoteDiagnostic({ kind: 'quote', symbol: 'BTCUSD', hubSequence: '1' });
    d.recordQuoteDiagnostic({ kind: 'quote', symbol: 'BTCUSD.r', hubSequence: '2' });
    d.recordQuoteDiagnostic({ kind: 'trade-control', symbol: 'BTCUSD.r', reason: 'stale' });
    expect(d.getQuoteDiagnosticDump()).toMatchObject({ selectedSymbols: ['BTCUSD', 'EURUSD'], filteredQuotes: 1 });
    expect(d.getQuoteDiagnosticDump().quotes).toHaveLength(1);
    expect(d.getQuoteDiagnosticDump().controls).toHaveLength(1);
    window.__RTX_QUOTE_DIAGNOSTICS_SYMBOLS__ = ['XAUUSD'];
    d.recordQuoteDiagnostic({ kind: 'quote', symbol: 'XAUUSD', hubSequence: '3' });
    expect(d.getQuoteDiagnosticDump().quotes).toHaveLength(2);
  });

  it('records quote age, receipt/ingest timing, rejections and clock failures without relaxing guards', async () => {
    window.__RTX_QUOTE_DIAGNOSTICS_ENABLED__ = true;
    configWindow().__RTX_RUNTIME_CONFIG__ = { TERMINAL_QUOTE_FRESHNESS: true };
    const d = await import('./quoteDiagnostics');
    const q = await import('./terminalQuoteFreshness');
    expect(q.calibrateTerminalQuoteClock(epoch, 1000, epoch, 1000, epoch)).toBe(true);
    const quote = { bid: 86000, ask: 86015, source: 'cserver', provider_timestamp: epoch - 5000, sequence: '18446744073709551614' };
    expect(q.ingestTerminalQuote('BTCUSD', quote, undefined, { receiptMonoMs: 990, transport: 'feed' })).toBe(true);
    expect(() => q.assertTerminalMarketOrderQuote('BTCUSD')).toThrow(expect.objectContaining({ code: 'QUOTE_STALE' }));
    expect(q.ingestTerminalQuote('BTCUSD', quote)).toBe(false);
    expect(q.ingestTerminalQuote('BTCUSD', { ...quote, sequence: '18446744073709551615', provider_timestamp: epoch + 10000 })).toBe(false);
    expect(q.calibrateTerminalQuoteClock(epoch, 1000, epoch, 3001, epoch + 2001)).toBe(false);
    const dump = d.getQuoteDiagnosticDump();
    expect(dump.quotes[0]).toMatchObject({ accepted: true, reason: 'accepted', freshnessReason: 'stale',
      source: 'cserver', providerTimestamp: epoch - 5000, hubSequence: '18446744073709551614',
      receiptMonoMs: 990, ingestMonoMs: 1000, transport: 'feed', ageMinMs: 4999, ageMaxMs: 5001 });
    expect(dump.quotes[1]).toMatchObject({ accepted: false, reason: 'duplicate-sequence' });
    expect(dump.quotes[2]).toMatchObject({ accepted: false, reason: 'future-provider-time' });
    expect(dump.controls).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'clock', accepted: false, reason: 'invalid-rtt', rttMs: 2001 }),
      expect.objectContaining({ kind: 'trade-control', phase: 'market-assert', quotePermitsOrder: false }),
    ]));
  });

  it('projects order telemetry without exporting account scope or backend messages', async () => {
    window.__RTX_QUOTE_DIAGNOSTICS_ENABLED__ = true;
    const d = await import('./quoteDiagnostics');
    const orders = await import('./orderLatencyTelemetry');
    orders.recordTradeOrderLatency({ phase: 'placement_terminal', transport: 'websocket', traceId: 'abcdef12',
      terminalStatus: 'rejected', errorCode: 'STALE_QUOTE', errorMessage: 'https://secret.test?token=secret',
      sessionScope: 'account-secret', clientOrderId: 'private-durable-id', totalMs: 12 });
    expect(d.getQuoteDiagnosticDump().controls[0]).toMatchObject({ kind: 'order', traceId: 'abcdef12', errorCode: 'STALE_QUOTE', totalMs: 12 });
    expect(JSON.stringify(d.getQuoteDiagnosticDump())).not.toMatch(/secret|private-durable|sessionScope|errorMessage/);
  });

  it('keeps upstream identity and prices in a diagnostic side channel without changing normalized quote fields', async () => {
    window.__RTX_QUOTE_DIAGNOSTICS_ENABLED__ = true;
    const d = await import('./quoteDiagnostics');
    const { processIncomingQuotePayload } = await import('./quotePayloadNormalizer');
    const sourceVersion = 'legacy-feed-v1:' + 'a'.repeat(64);
    const payload = { symbol: 'BTCUSD', bid: 86000, ask: 86015, provider_timestamp: epoch,
      source: 'cserver', sequence: '99', upstream_source_sequence: '18446744073709551615',
      upstream_receive_timestamp: epoch + 1, upstream_publish_timestamp: epoch + 2,
      hub_ingest_timestamp: epoch + 3, hub_publish_timestamp: epoch + 4,
      broker_id: 'Nexa', source_version: sourceVersion, tick_id: 'quote-17', source_tick_id: 'source-17', token: 'secret' };
    const [tick] = processIncomingQuotePayload(payload);
    expect(tick.sequence).toBe('99');
    expect(tick).not.toHaveProperty('upstream_source_sequence');
    const wire = d.readQuoteWireEvidence(tick);
    expect(wire).toEqual({ rawBid: 86000, rawAsk: 86015, upstreamSourceSequence: '18446744073709551615',
      upstreamReceiveTimestamp: epoch + 1, upstreamPublishTimestamp: epoch + 2,
      hubIngestTimestamp: epoch + 3, hubPublishTimestamp: epoch + 4,
      brokerId: 'Nexa', sourceVersion, tickId: 'quote-17', sourceTickId: 'source-17' });
    const q = await import('./terminalQuoteFreshness');
    q.calibrateTerminalQuoteClock(epoch, 1000, epoch, 1000, epoch);
    q.ingestTerminalQuote(tick.symbol, tick, undefined, wire);
    expect(d.getQuoteDiagnosticDump().quotes.at(-1)).toMatchObject({ hubSequence: '99', upstreamSourceSequence: '18446744073709551615', rawBid: 86000, rawAsk: 86015, browserGeneration: 0 });
    expect(JSON.stringify(d.getQuoteDiagnosticDump())).not.toMatch(/secret|sourceGeneration/);
    expect(d.getQuoteDiagnosticDump().monotonicTimeOriginEpochMs).toBe(performance.timeOrigin);
  });
});
