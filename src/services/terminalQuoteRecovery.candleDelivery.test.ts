import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('./aggregationWorkerManager', () => ({ cancelPendingAggregations: vi.fn(), getWorkerManager: () => ({ aggregateSymbols: vi.fn(async () => []) }) }));
import { QuoteSocketManager } from './quoteSocketManager';
import { processIncomingQuotePayload } from './quotePayloadNormalizer';
import { enqueueLiveTick, flushLiveTicks, resetLiveTickDispatcherForTests, setLiveMarketDataFrozen } from './liveTickDispatcher';
import { useMarketDataStore } from '../store/useMarketDataStore';
import { useAppStore } from '../store/useAppStore';
import { calibrateTerminalQuoteClock, getTerminalQuoteFreshness, resetTerminalQuoteFreshness, subscribeTerminalQuoteFreshness } from './terminalQuoteFreshness';
import { SymbolCandleBuilder } from './candleAggregationService';
import { commitBrokerAccountSessionScope } from './brokerSession';
import { getQuoteDiagnosticDump } from './quoteDiagnostics';

const epoch = Date.UTC(2026, 9, 5, 10, 0, 0);
const financialQuoteEventIdentity = (tick: { source?: string; provider_timestamp?: number; sequence?: string | number }) =>
  tick.sequence === undefined || tick.provider_timestamp === undefined || !tick.source ? undefined
    : JSON.stringify([tick.source, tick.provider_timestamp, String(tick.sequence)]);
const quote = (offset: number, price: number, sequence: string) => ({ symbol: 'BTCUSD', bid: price, ask: price + 1,
  provider_timestamp: epoch + offset, time_ms: epoch + offset, sequence, source: 'cserver', tradable: true, stale: false, source_mismatch: false });
let manager: QuoteSocketManager;
const deliver = (row: unknown) => (manager as unknown as { handleMessage: (data: unknown) => void }).handleMessage(row);

describe('REST evidence must not censor the ordered websocket candle stream', () => {
  beforeEach(() => {
    vi.useFakeTimers(); vi.setSystemTime(epoch + 10000);
    vi.spyOn(performance, 'now').mockReturnValue(10000);
    (window as Window & { __RTX_RUNTIME_CONFIG__?: Record<string, unknown> }).__RTX_RUNTIME_CONFIG__ = { TERMINAL_QUOTE_FRESHNESS: true };
    commitBrokerAccountSessionScope({ authenticated: false, brokerId: 'test-broker', serverUrl: 'https://broker.test' });
    resetLiveTickDispatcherForTests(); resetTerminalQuoteFreshness();
    window.rtxTickCache.clear();
    useMarketDataStore.getState().clearAllData();
    useAppStore.setState({ ticks: {}, tickLookup: {} });
    calibrateTerminalQuoteClock(epoch + 10000, 10000, epoch + 10000, 10000, epoch + 10000);
    manager = new QuoteSocketManager();
  });
  afterEach(() => { manager.destroy(); resetLiveTickDispatcherForTests(); resetTerminalQuoteFreshness();
    delete (window as Window & { __RTX_RUNTIME_CONFIG__?: Record<string, unknown> }).__RTX_RUNTIME_CONFIG__;
    vi.restoreAllMocks(); vi.useRealTimers(); });

  function chart() {
    const builder = new SymbolCandleBuilder('BTCUSD'), rawSequences: string[] = [];
    // Same raw selected-symbol callback and volume contract as the chart runtime.
    // Identical behavior fixture can run against f10, which has only the old
    // raw callback. A missing new API must not be the before-failure reason.
    const compatible = manager as QuoteSocketManager & { onFinancialQuote?: QuoteSocketManager['onQuoteSnapshot'] };
    (compatible.onFinancialQuote ?? manager.onQuoteSnapshot).call(manager, 'BTCUSD', tick => {
      rawSequences.push(String(tick.sequence));
      builder.processTick({ eventIdentity: financialQuoteEventIdentity(tick), symbol: 'BTCUSD', bid: tick.bid, ask: tick.ask,
        timestamp: tick.sourceTimestamp ?? tick.timestamp, volume: 1 });
    });
    return { builder, rawSequences };
  }

  it('control retains highs, lows and exact tick volume when no REST snapshot overtakes the socket', () => {
    const { builder, rawSequences } = chart();
    for (const row of [quote(1000, 100, '1'), quote(2000, 130, '2'), quote(3000, 80, '3'), quote(9000, 102, '4'), quote(10000, 105, '5')]) deliver(row);
    expect(rawSequences).toEqual(['1', '2', '3', '4', '5']);
    expect(builder.getCandles('M1').at(-1)).toMatchObject({ open: 100, high: 130, low: 80, close: 105, volume: 5 });
  });

  it('retains queued same-minute websocket extremes and volume after a newer REST quote restores execution freshness', () => {
    const { builder, rawSequences } = chart();
    deliver(quote(1000, 100, '1'));
    expect(getTerminalQuoteFreshness('BTCUSD').reason).toBe('stale');
    // Exact f10 REST ingress: normalizer -> ordinary real dispatcher.
    const snapshot = processIncomingQuotePayload(quote(9000, 102, '4'))[0];
    expect(enqueueLiveTick('BTCUSD', snapshot, { transport: 'rest', receiptMonoMs: 10000 })).toBe(true);
    expect(getTerminalQuoteFreshness('BTCUSD').live).toBe(true);
    const recoveredFreshness = getTerminalQuoteFreshness('BTCUSD');
    // Chart polling may display the snapshot; it must not count it as a tick.
    const latest = window.rtxTickCache.get('BTCUSD')!;
    if (latest.quoteDeliveryKind !== 'snapshot') builder.processTick({ eventIdentity: financialQuoteEventIdentity(latest), symbol: 'BTCUSD', bid: latest.rawBid ?? latest.bid, ask: latest.rawAsk ?? latest.ask,
      timestamp: latest.sourceTimestamp ?? latest.timestamp, volume: 1 });
    for (const row of [quote(2000, 130, '2'), quote(3000, 80, '3'), quote(9000, 102, '4')]) {
      deliver(row);
      expect(getTerminalQuoteFreshness('BTCUSD')).toEqual(recoveredFreshness);
      expect(window.rtxTickCache.get('BTCUSD')?.bid).toBe(102);
    }
    deliver(quote(10000, 105, '5'));
    expect.soft(rawSequences).toEqual(['1', '2', '3', '4', '5']);
    expect.soft(builder.getCandles('M1').at(-1)).toMatchObject({ open: 100, high: 130, low: 80, close: 105, volume: 5 });
  });

  it('keeps current Market/App display at REST while admitting ordered WS into the coalesced financial buffer', () => {
    chart(); deliver(quote(1000, 100, '1')); flushLiveTicks();
    enqueueLiveTick('BTCUSD', processIncomingQuotePayload(quote(9000, 102, '4'))[0], { transport: 'rest' }); flushLiveTicks();
    expect(useMarketDataStore.getState().symbolData.BTCUSD.tickBuffer).toHaveLength(1);
    for (const row of [quote(2000, 130, '2'), quote(3000, 80, '3')]) {
      deliver(row); flushLiveTicks();
      expect(useMarketDataStore.getState().symbolData.BTCUSD.currentTick?.bid).toBe(102);
      expect(useAppStore.getState().ticks.BTCUSD.bid).toBe(102);
    }
    expect(useMarketDataStore.getState().symbolData.BTCUSD.tickBuffer.map(t => t.bid)).toEqual([100, 130, 80]);
    deliver(quote(9000, 102, '4')); flushLiveTicks();
    expect(useMarketDataStore.getState().symbolData.BTCUSD.tickBuffer.map(t => t.bid)).toEqual([100, 130, 80, 102]);
    expect(window.rtxTickCache.get('BTCUSD')?.quoteDeliveryKind).toBe('event');
  });

  it('retains more than512queued events and rejects stream replay without counting REST twice', () => {
    const { builder, rawSequences } = chart(); deliver(quote(1000, 100, '1'));
    enqueueLiveTick('BTCUSD', processIncomingQuotePayload(quote(9500, 102, '700'))[0], { transport: 'rest' });
    for (let i = 0; i < 600; i++) deliver(quote(2000 + i * 10, i === 20 ? 130 : i === 540 ? 80 : 101, String(i + 2)));
    deliver(quote(9500, 102, '700')); deliver(quote(10000, 105, '701'));
    deliver(quote(2000, 101, '2')); deliver(quote(9500, 102, '700'));
    expect(rawSequences).toHaveLength(603);
    expect(builder.getCandles('M1').at(-1)).toMatchObject({ high: 130, low: 80, close: 105, volume: 603 });
  });

  it('counts distinct same-time same-price sequences once each across raw and polling delivery', () => {
    const { builder, rawSequences } = chart();
    for (const sequence of ['18446744073709551613', '18446744073709551614']) {
      deliver(quote(9000, 100, sequence)); flushLiveTicks();
      const latest = window.rtxTickCache.get('BTCUSD')!;
      builder.processTick({ eventIdentity: financialQuoteEventIdentity(latest), symbol: 'BTCUSD', bid: 100, ask: 101, timestamp: epoch + 9000, volume: 1 });
    }
    expect(rawSequences).toHaveLength(2);
    expect(builder.getCandles('M1').at(-1)?.volume).toBe(2);
    expect(useMarketDataStore.getState().symbolData.BTCUSD.tickBuffer).toHaveLength(2);
  });

  it('a cross-minute REST snapshot cannot roll the financial model past queued prior-minute events', () => {
    vi.setSystemTime(epoch + 70000); vi.mocked(performance.now).mockReturnValue(70000);
    calibrateTerminalQuoteClock(epoch + 70000, 70000, epoch + 70000, 70000, epoch + 70000);
    const { builder } = chart(); deliver(quote(1000, 100, '1'));
    enqueueLiveTick('BTCUSD', processIncomingQuotePayload(quote(69000, 102, '4'))[0], { transport: 'rest' });
    expect(builder.getCandles('M1')).toHaveLength(1);
    deliver(quote(59000, 130, '2')); deliver(quote(61000, 80, '3')); deliver(quote(69000, 102, '4')); deliver(quote(70000, 105, '5'));
    expect(builder.getCandles('M1')).toMatchObject([
      { open: 100, high: 130, low: 100, close: 130, volume: 2 },
      { open: 80, high: 105, low: 80, close: 105, volume: 3 },
    ]);
  });

  it('preserves legacy financial buffering when strict quote freshness is disabled', () => {
    delete (window as Window & { __RTX_RUNTIME_CONFIG__?: Record<string, unknown> }).__RTX_RUNTIME_CONFIG__;
    const { builder } = chart(); deliver(quote(1000, 100, '1')); flushLiveTicks();
    expect(useMarketDataStore.getState().symbolData.BTCUSD.tickBuffer).toHaveLength(1);
    expect(builder.getCandles('M1').at(-1)?.volume).toBe(1);
  });

  it('a freeze between enqueue and flush prevents financial buffer writes', () => {
    chart(); deliver(quote(1000, 100, '1'));
    setLiveMarketDataFrozen('test', 'BTCUSD', true); flushLiveTicks();
    expect(useMarketDataStore.getState().symbolData.BTCUSD).toBeUndefined();
    setLiveMarketDataFrozen('test', 'BTCUSD', false);
  });

  it('normal websocket dispatch has the same first-event stats and buffer as the prior direct store transition', () => {
    chart(); deliver(quote(1000, 100, '1')); flushLiveTicks();
    const routed = useMarketDataStore.getState().symbolData.BTCUSD;
    expect(routed.tickBuffer).toHaveLength(1);
    expect(routed.stats?.volume24h).toBe(0); // original quote carries no traded volume
    expect(routed.stats).not.toBeNull();
    useMarketDataStore.getState().clearAllData();
    useMarketDataStore.getState().updateTick('BTCUSD', routed.currentTick!, { syncAppStore: false });
    const direct = useMarketDataStore.getState().symbolData.BTCUSD;
    expect(routed.stats).toEqual(direct.stats);
    expect(routed.tickBuffer).toEqual(direct.tickBuffer);
  });

  it('honors explicit source mismatch while accepting ordered in-band source switches without resetting sequence', () => {
    const { rawSequences } = chart();
    deliver(quote(1000, 100, '1'));
    deliver({ ...quote(2000, 120, '2'), source: 't4b', source_mismatch: true });
    deliver({ ...quote(3000, 101, '3'), source: 't4b' });
    deliver({ ...quote(4000, 90, '2'), source: 'cserver' });
    expect(rawSequences).toEqual(['1', '3']);
  });

  it('aged and non-tradable legitimate events retain financial history without granting execution permission', () => {
    const { rawSequences } = chart();
    deliver({ ...quote(1000, 100, '1'), stale: true, tradable: false });
    expect(rawSequences).toEqual(['1']);
    expect(getTerminalQuoteFreshness('BTCUSD').live).toBe(false);
  });

  it('a future event rejected by execution while clock is unverified cannot poison financial ordering', () => {
    const { rawSequences } = chart(); deliver(quote(1000, 100, '1'));
    enqueueLiveTick('BTCUSD', processIncomingQuotePayload(quote(9000, 102, '100'))[0], { transport: 'rest' });
    vi.setSystemTime(epoch + 100000); vi.mocked(performance.now).mockReturnValue(100000);
    deliver(quote(3600000, 999, '2'));
    // Queued known-past events remain safe under the previously verified upper bound.
    deliver(quote(2000, 130, '2'));
    calibrateTerminalQuoteClock(epoch + 100000, 100000, epoch + 100000, 100000, epoch + 100000);
    deliver(quote(3000, 80, '3'));
    expect(rawSequences).toEqual(['1', '2', '3']);
  });

  it('invalid/future evidence does not advance financial sequence and a new quote generation accepts a restarted stream', () => {
    const { rawSequences } = chart(); deliver(quote(1000, 100, '1'));
    deliver(quote(9000, -1, '9')); deliver(quote(60000, 999, '9'));
    deliver(quote(2000, 101, '2'));
    resetTerminalQuoteFreshness();
    calibrateTerminalQuoteClock(epoch + 10000, 10000, epoch + 10000, 10000, epoch + 10000);
    deliver(quote(3000, 102, '1'));
    expect(rawSequences).toEqual(['1', '2', '1']);
  });

  it('late raw events do not alter authoritative closed candle ownership', () => {
    const { builder, rawSequences } = chart(); deliver(quote(1000, 100, '1'));
    builder.reconcileServerCandle('M1', { time: epoch / 1000, open: 100, high: 110, low: 90, close: 105, volume: 40 }, true);
    deliver(quote(2000, 150, '2'));
    expect(rawSequences).toEqual(['1', '2']);
    expect(builder.getCandles('M1')[0]).toMatchObject({ high: 110, low: 90, close: 105, volume: 40 });
  });

  it('unsequenced events cannot erase the persistent financial sequence watermark', () => {
    const { rawSequences } = chart();
    deliver(quote(1000, 100, '100'));
    deliver({ ...quote(2000, 101, '101'), sequence: undefined });
    deliver(quote(3000, 102, '99'));
    deliver(quote(4000, 103, '101'));
    expect(rawSequences).toEqual(['100', 'undefined', '101']);
  });
  it('uses the validated provider timestamp for financial candles and buffer despite conflicting aliases', () => {
    const { builder } = chart();
    deliver({ ...quote(9000, 100, '1'), timestamp: epoch + 69000 }); flushLiveTicks();
    expect(builder.getCandles('M1')[0].time).toBe(epoch / 1000);
    const buffered = useMarketDataStore.getState().symbolData.BTCUSD.tickBuffer[0];
    expect(buffered.sourceTimestamp ?? buffered.timestamp).toBe(epoch + 9000);
  });

  it('does not retag any remainder of a captured batch after reentrant quote-session replacement', () => {
    const { rawSequences } = chart(); const latest = vi.fn(); manager.onQuoteSnapshot('BTCUSD', latest);
    let changed = false;
    const unsub = subscribeTerminalQuoteFreshness(() => {
      if (!changed) { changed = true; resetTerminalQuoteFreshness(); }
    });
    try { deliver({ ticks: [quote(9000, 100, '1'), quote(10000, 101, '2')] }); }
    finally { unsub(); }
    flushLiveTicks();
    expect(changed).toBe(true); expect(rawSequences).toEqual([]); expect(latest).not.toHaveBeenCalled();
    expect(window.rtxTickCache.has('BTCUSD')).toBe(false);
    expect(useAppStore.getState().ticks.BTCUSD).toBeUndefined();
    expect(useMarketDataStore.getState().symbolData.BTCUSD?.tickBuffer ?? []).toEqual([]);
  });

  it('stops later financial and display callbacks when an earlier subscriber replaces the session', () => {
    manager.onFinancialQuote('BTCUSD', () => resetTerminalQuoteFreshness());
    const financial = vi.fn(), latest = vi.fn();
    manager.onFinancialQuote('BTCUSD', financial); manager.onQuoteSnapshot('BTCUSD', latest);
    deliver(quote(9000, 100, '1')); flushLiveTicks();
    expect(financial).not.toHaveBeenCalled(); expect(latest).not.toHaveBeenCalled();
    expect(useMarketDataStore.getState().symbolData.BTCUSD?.tickBuffer ?? []).toEqual([]);
  });

  it('stops the captured message if a callback replaces its socket even without a session change', () => {
    manager.onFinancialQuote('BTCUSD', () => {
      (manager as unknown as { ws: unknown }).ws = { close: vi.fn() };
    });
    const financial = vi.fn(); manager.onFinancialQuote('BTCUSD', financial);
    deliver({ ticks: [quote(9000, 100, '1'), quote(10000, 101, '2')] });
    expect(financial).not.toHaveBeenCalled();
    (manager as unknown as { ws: unknown }).ws = null;
  });

  it('defers overtaken history and following financial events until the first calibrated clock restores exact candles', () => {
    resetTerminalQuoteFreshness();
    const { rawSequences, builder } = chart(); deliver(quote(1000, 100, '1'));
    enqueueLiveTick('BTCUSD', processIncomingQuotePayload(quote(9000, 102, '4'))[0], { transport: 'rest' });
    deliver(quote(2000, 130, '2'));
    expect(rawSequences).toEqual(['1']);
    deliver(quote(3000, 80, '3')); deliver(quote(9000, 102, '4')); deliver(quote(10000, 105, '5'));
    expect(rawSequences).toEqual(['1']);
    calibrateTerminalQuoteClock(epoch + 10000, 10000, epoch + 10000, 10000, epoch + 10000);
    expect(rawSequences).toEqual(['1', '2', '3', '4', '5']);
    expect(builder.getCandles('M1')[0]).toMatchObject({ open: 100, high: 130, low: 80, close: 105, volume: 5 });
  });

  it('catchup reclassification preserves every execution veto in the cached snapshot', () => {
    enqueueLiveTick('BTCUSD', processIncomingQuotePayload({ ...quote(9000, 102, '4'), tradable: false })[0], { transport: 'rest' });
    deliver(quote(9000, 102, '4')); flushLiveTicks();
    expect(window.rtxTickCache.get('BTCUSD')).toMatchObject({ quoteDeliveryKind: 'event', tradable: false });
    expect(getTerminalQuoteFreshness('BTCUSD').live).toBe(false);
  });

  it('clears deferred financial ownership on session replacement before a later clock calibration', () => {
    resetTerminalQuoteFreshness();
    const { rawSequences } = chart(); deliver(quote(1000, 100, '1'));
    enqueueLiveTick('BTCUSD', processIncomingQuotePayload(quote(9000, 102, '4'))[0], { transport: 'rest' });
    deliver(quote(2000, 130, '2')); resetTerminalQuoteFreshness();
    calibrateTerminalQuoteClock(epoch + 10000, 10000, epoch + 10000, 10000, epoch + 10000);
    expect(rawSequences).toEqual(['1']);
    deliver(quote(3000, 103, '1')); expect(rawSequences).toEqual(['1', '1']);
  });

  it('disposing the manager prevents a queued financial callback on later calibration', () => {
    resetTerminalQuoteFreshness();
    const { rawSequences } = chart(); deliver(quote(1000, 100, '1'));
    enqueueLiveTick('BTCUSD', processIncomingQuotePayload(quote(9000, 102, '4'))[0], { transport: 'rest' });
    deliver(quote(2000, 130, '2')); manager.destroy();
    calibrateTerminalQuoteClock(epoch + 10000, 10000, epoch + 10000, 10000, epoch + 10000);
    expect(rawSequences).toEqual(['1']);
  });

  it('records expired financial coverage even when no chart recovery listener is mounted', () => {
    resetTerminalQuoteFreshness(); window.__RTX_QUOTE_DIAGNOSTICS_ENABLED__ = true;
    try {
      deliver(quote(1000, 100, '1'));
      enqueueLiveTick('BTCUSD', processIncomingQuotePayload(quote(9000, 102, '4'))[0], { transport: 'rest' });
      deliver(quote(2000, 130, '2'));
      vi.mocked(performance.now).mockReturnValue(130000); vi.setSystemTime(epoch + 130000);
      vi.advanceTimersByTime(120000);
      expect(getQuoteDiagnosticDump().controls).toContainEqual(expect.objectContaining({
        kind: 'financial-gap', phase: 'queue', terminalStatus: 'detected', symbol: 'BTCUSD', reason: 'expired',
        gapFromProviderTimeMs: epoch + 2000, gapToProviderTimeMs: epoch + 2000, rawCoverageComplete: false,
      }));
    } finally { delete window.__RTX_QUOTE_DIAGNOSTICS_ENABLED__; }
  });

});
