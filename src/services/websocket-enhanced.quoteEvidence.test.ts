import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('./aggregationWorkerManager', () => ({ cancelPendingAggregations: vi.fn(), getWorkerManager: () => ({ aggregateSymbols: vi.fn(async () => []) }) }));
import { EnhancedWebSocketService, isEnhancedStoreHandledTickFrame, type WebSocketMessage } from './websocket-enhanced';
import { QuoteSocketManager } from './quoteSocketManager';
import { commitBrokerAccountSessionScope } from './brokerSession';
import { flushLiveTicks, resetLiveTickDispatcherForTests } from './liveTickDispatcher';
import { useMarketDataStore } from '../store/useMarketDataStore';
import { useAppStore } from '../store/useAppStore';
import { calibrateTerminalQuoteClock, getTerminalQuoteFreshness, resetTerminalQuoteFreshness } from './terminalQuoteFreshness';
import { SymbolCandleBuilder } from './candleAggregationService';
import { financialQuoteEventIdentity } from './financialQuoteStream';
import { getQuoteDiagnosticDump } from './quoteDiagnostics';

const epoch = Date.UTC(2026, 9, 6, 6, 24, 0);
const runtime = window as Window & { __RTX_RUNTIME_CONFIG__?: Record<string, unknown> };
const quote = (offset = 10000, sequence = '1', bid = 100) => ({ symbol: 'BTCUSD', bid, ask: bid + 1,
  provider_timestamp: epoch + offset, time_ms: epoch + offset, source: 'cserver', sequence,
  stale: false, tradable: true, source_mismatch: false });
let service: EnhancedWebSocketService;
let manager: QuoteSocketManager | undefined;
const deliver = (frame: WebSocketMessage) => (service as unknown as { handleMessage(frame: WebSocketMessage): void }).handleMessage(frame);
const channel = (payload: Record<string, unknown>, envelope: Record<string, unknown> = {}) =>
  deliver({ type: 'channel_message', channel: 'ticks.BTCUSD', data: payload, ...envelope });

describe('enhanced quote transport preserves executable evidence through the real dispatcher', () => {
  beforeEach(() => {
    vi.useFakeTimers(); vi.setSystemTime(epoch + 10000);
    vi.spyOn(performance, 'now').mockImplementation(() => Date.now() - epoch);
    runtime.__RTX_RUNTIME_CONFIG__ = { TERMINAL_QUOTE_FRESHNESS: true };
    window.__RTX_QUOTE_DIAGNOSTICS_ENABLED__ = false;
    commitBrokerAccountSessionScope({ authenticated: false, brokerId: 'test-broker', serverUrl: 'https://broker.test' });
    resetLiveTickDispatcherForTests(); resetTerminalQuoteFreshness();
    window.rtxTickCache.clear(); useMarketDataStore.getState().clearAllData();
    useAppStore.setState({ ticks: {}, tickLookup: {}, isAuthenticated: false, accountId: null });
    calibrateTerminalQuoteClock(epoch + 10000, 10000, epoch + 10000, 10000, epoch + 10000);
    service = new EnhancedWebSocketService('wss://broker.test/ws/v2');
  });
  afterEach(() => {
    service.destroy(); manager?.destroy(); manager = undefined;
    resetLiveTickDispatcherForTests(); resetTerminalQuoteFreshness();
    delete runtime.__RTX_RUNTIME_CONFIG__; delete window.__RTX_QUOTE_DIAGNOSTICS_ENABLED__;
    vi.restoreAllMocks(); vi.useRealTimers();
  });

  it.each(['direct', 'channel'])('accepts fresh original %s evidence and renews it through v2 alone', kind => {
    const send = (row: ReturnType<typeof quote>) => kind === 'direct' ? deliver({ type: 'tick', ...row }) : channel(row);
    send(quote(6000, '9007199254740993'));
    expect(getTerminalQuoteFreshness('BTCUSD').reason).toBe('stale');
    send(quote(10000, '9007199254740994', 102)); flushLiveTicks();
    expect(getTerminalQuoteFreshness('BTCUSD').live).toBe(true);
    expect(useAppStore.getState().ticks.BTCUSD).toMatchObject({ bid: 102, provider_timestamp: epoch + 10000,
      source: 'cserver', sequence: '9007199254740994', stale: false, tradable: true, source_mismatch: false,
      quoteDeliveryKind: 'snapshot' });
    expect(useMarketDataStore.getState().symbolData.BTCUSD.tickBuffer).toHaveLength(0);
  });

  it('routes the gateway envelope without type once before the App wildcard subscriber', () => {
    window.__RTX_QUOTE_DIAGNOSTICS_ENABLED__ = true;
    const observed: boolean[] = [];
    const unsubscribe = service.subscribe('*', frame => {
      // This is the shared predicate used by App to skip its legacy fallback.
      observed.push(isEnhancedStoreHandledTickFrame(frame));
    });
    deliver({ channel: 'ticks.BTCUSD', data: quote(6000, '22706005') });
    expect(getTerminalQuoteFreshness('BTCUSD').reason).toBe('stale');
    deliver({ channel: 'ticks.BTCUSD', data: { ...quote(10000, '22706006'),
      timestamp_ms: epoch + 10000, upstream_source_sequence: '33956028',
      upstream_receive_timestamp: epoch + 10000, upstream_publish_timestamp: epoch + 10000,
      hub_ingest_timestamp: epoch + 10000, hub_publish_timestamp: epoch + 10000 } });
    flushLiveTicks(); unsubscribe();
    expect(observed).toEqual([true, true]);
    expect(getTerminalQuoteFreshness('BTCUSD').live).toBe(true);
    expect(window.rtxTickCache.get('BTCUSD')).toMatchObject({ source: 'cserver', sequence: '22706006',
      provider_timestamp: epoch + 10000, quoteDeliveryKind: 'snapshot' });
    expect(getQuoteDiagnosticDump().quotes.filter(row => row.transport === 'v2' && row.hubSequence === '22706006')).toHaveLength(1);
    expect(useMarketDataStore.getState().symbolData.BTCUSD.tickBuffer).toHaveLength(0);
  });

  it('accepts the captured gateway quote frame without adding a synthetic message type', () => {
    // Exact sanitized quote frame captured from /ws/v2 on 2026-10-06.
    const frame = { channel: 'ticks.BTCUSD', data: {
      upstream_source_sequence: '34022327', upstream_receive_timestamp: 1791269162071,
      upstream_publish_timestamp: 1791269162072, symbol: 'BTCUSD', bid: 85321.04, ask: 85336.04,
      time_ms: 1791269162008, timestamp_ms: 1791269162008, provider_timestamp: 1791269162008,
      hub_ingest_timestamp: 1791269162104, hub_publish_timestamp: 1791269162116,
      tick_id: 'rtx-dlwuro1l4usm-22772197', sequence: '22772197', expected_source: 'cserver',
      source_mismatch: false, stale: false, tradable: true, source: 'cserver',
    } };
    vi.setSystemTime(1791269162200);
    const mono = performance.now();
    calibrateTerminalQuoteClock(Date.now(), mono, Date.now(), mono, Date.now());
    expect(isEnhancedStoreHandledTickFrame(frame)).toBe(true);
    deliver(frame);
    expect(getTerminalQuoteFreshness('BTCUSD')).toMatchObject({ live: true, clockStatus: 'verified' });
    expect(window.rtxTickCache.get('BTCUSD')).toMatchObject({ provider_timestamp: 1791269162008,
      source: 'cserver', sequence: '22772197', quoteDeliveryKind: 'snapshot' });
  });

  it.each(['subscribed', 'unsubscribed', 'error', 'pong', 'update'])('does not claim an explicit %s control envelope as a gateway tick', type => {
    const frame = { type, channel: 'ticks.BTCUSD', data: quote() };
    expect(isEnhancedStoreHandledTickFrame(frame)).toBe(false);
    deliver(frame);
    expect(getTerminalQuoteFreshness('BTCUSD').reason).toBe('unavailable');
  });

  it('keeps unsupported and differently cased channels out of transport ownership', () => {
    for (const channel of ['TICKS.BTCUSD', 'quotes.BTCUSD', 'prices', 'ticks.']) {
      expect(isEnhancedStoreHandledTickFrame({ channel, data: quote() })).toBe(false);
    }
    expect(isEnhancedStoreHandledTickFrame({ channel: 'ticks.BTCUSD', data: { quote: quote() } })).toBe(false);
    expect(isEnhancedStoreHandledTickFrame({ channel: 'ticks.BTCUSD', data: { ...quote(), ask: undefined } })).toBe(false);
  });

  it('uses exact channel identity and envelope provider metadata without inventing an unsuffixed quote', () => {
    const metadata = quote();
    deliver({ type: 'channel_message', channel: 'ticks.BTCUSD.pro', data: { symbol: 'BTCUSD', bid: 100, ask: 101 }, ...metadata });
    expect(getTerminalQuoteFreshness('BTCUSD.PRO').live).toBe(true);
    expect(getTerminalQuoteFreshness('BTCUSD').reason).toBe('unavailable');
    expect(window.rtxTickCache.get('BTCUSD.PRO')?.source).toBe('cserver');
  });

  it.each([
    { provider_timestamp: undefined, time_ms: undefined },
    { provider_timestamp: undefined, time_ms: undefined, sourceTimestamp: undefined },
    { provider_timestamp: epoch + 100000, time_ms: epoch + 100000 },
    { source: undefined }, { ask: undefined }, { bid: undefined },
  ])('does not turn receipt/display time or invalid source/sides into provider evidence: %j', patch => {
    // JSON removes omitted fields, matching the actual wire rather than relying
    // on the normalizer's own-undefined provider timestamp protection.
    const wire = JSON.parse(JSON.stringify({ ...quote(), ...patch, timestamp: epoch + 10000 }));
    channel(wire, { timestamp: epoch + 10000 });
    expect(getTerminalQuoteFreshness('BTCUSD').reason).toBe('unavailable');
    expect(window.rtxTickCache.has('BTCUSD')).toBe(false);
  });

  it.each([
    [{ stale: true }, 'stale'], [{ tradable: false }, 'not-tradable'], [{ source_mismatch: true }, 'source-mismatch'],
  ] as const)('retains restrictive envelope metadata over permissive nested sides: %j', (veto, reason) => {
    channel(quote(), veto);
    expect(getTerminalQuoteFreshness('BTCUSD').reason).toBe(reason);
  });

  it('does not renew a duplicate or allow an older source sequence to replace fresh evidence', () => {
    channel(quote(10000, '10'));
    vi.advanceTimersByTime(3100);
    channel(quote(10000, '10')); channel(quote(13100, '9', 120));
    expect(getTerminalQuoteFreshness('BTCUSD').reason).toBe('stale');
    channel(quote(13100, '11', 120));
    expect(getTerminalQuoteFreshness('BTCUSD').live).toBe(true);
  });

  it('attributes original provider and wire delivery evidence to v2 diagnostics', () => {
    window.__RTX_QUOTE_DIAGNOSTICS_ENABLED__ = true;
    channel({ ...quote(), hub_ingest_timestamp: epoch + 10000, upstream_publish_timestamp: epoch + 9999 });
    const records = getQuoteDiagnosticDump().quotes;
    expect(records.at(-1)).toMatchObject({ symbol: 'BTCUSD', source: 'cserver', transport: 'v2', accepted: true,
      providerTimestamp: epoch + 10000, hubIngestTimestamp: epoch + 10000, upstreamPublishTimestamp: epoch + 9999 });
  });

  it('allows feed financial catchup after a v2 snapshot without losing extrema or counting the snapshot twice', () => {
    manager = new QuoteSocketManager();
    const builder = new SymbolCandleBuilder('BTCUSD');
    const sequences: string[] = [];
    manager.onFinancialQuote('BTCUSD', tick => {
      sequences.push(String(tick.sequence));
      builder.processTick({ eventIdentity: financialQuoteEventIdentity(tick), symbol: tick.symbol,
        bid: tick.bid, ask: tick.ask, timestamp: tick.provider_timestamp!, volume: 1 });
    });
    const feed = (row: ReturnType<typeof quote>) => (manager as unknown as { handleMessage(data: unknown): void }).handleMessage(row);
    feed(quote(1000, '1', 100)); flushLiveTicks();
    channel(quote(9000, '4', 102)); flushLiveTicks();
    expect(getTerminalQuoteFreshness('BTCUSD').live).toBe(true);
    expect(useMarketDataStore.getState().symbolData.BTCUSD.tickBuffer).toHaveLength(1);
    for (const row of [quote(2000, '2', 130), quote(3000, '3', 80), quote(9000, '4', 102), quote(10000, '5', 105)]) {
      feed(row); flushLiveTicks();
    }
    channel(quote(10000, '5', 105)); feed(quote(10000, '5', 105));
    expect(sequences).toEqual(['1', '2', '3', '4', '5']);
    expect(builder.getCandles('M1').at(-1)).toMatchObject({ open: 100, high: 130, low: 80, close: 105, volume: 5 });
    expect(window.rtxTickCache.get('BTCUSD')?.quoteDeliveryKind).toBe('event');
  });
});
