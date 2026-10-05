import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useActiveMarketSymbols, MARKET_SYMBOLS_REFRESH_REQUESTED_EVENT } from '../features/market-data/useActiveMarketSymbols';
import { calibrateTerminalQuoteClock, getTerminalQuoteFreshness, ingestTerminalQuote, resetTerminalQuoteFreshness, type TerminalQuoteEvidence } from '../services/terminalQuoteFreshness';
import { resolveTradeEligibleSymbolNames } from '../utils/accountSymbolUniverse';
import { emitSessionChange } from '../services/brokerSession';
import { getQuoteDiagnosticDump } from '../services/quoteDiagnostics';

const apiGet = vi.hoisted(() => vi.fn());
vi.mock('../api/client', () => ({ apiClient: { get: apiGet }, ApiError: class ApiError extends Error {} }));
const epoch = Date.UTC(2026, 9, 5, 15);
const status = (patch: Record<string, unknown> = {}) => ({ symbol_status: [{ symbol: 'BTCUSD', has_data: true, fresh: false, stale: true,
  silent: false, tradable: false, source_mismatch: false, source: 'cserver', expected_source: 'cserver', last_tick_ms: epoch - 4000,
  sequence: '9007199254740992', last_tick_age_sec: 4, ...patch }], available_symbols: ['BTCUSD'], silent_symbols: [] });
const flush = async () => act(async () => { await Promise.resolve(); await Promise.resolve(); });
const liveQuote = (patch: Partial<TerminalQuoteEvidence> = {}) => ({ bid: 100, ask: 101, provider_timestamp: epoch - 50,
  sequence: '9007199254740993', source: 'cserver', stale: false, tradable: true, source_mismatch: false, ...patch });
const ingest = (patch: Partial<TerminalQuoteEvidence> = {}) => act(() => { ingestTerminalQuote('BTCUSD', liveQuote(patch)); });
const calibrate = () => { const mono = performance.now(); calibrateTerminalQuoteClock(epoch, mono, epoch, mono, epoch); };

describe('new provider evidence supersedes an older stale-only feed status', () => {
  beforeEach(() => {
    vi.useFakeTimers(); vi.setSystemTime(epoch); apiGet.mockReset();
    localStorage.setItem('broker_id', 'recovery-fixture');
    window.__RTX_RUNTIME_CONFIG__ = { TERMINAL_QUOTE_FRESHNESS: true };
    resetTerminalQuoteFreshness();
    const mono = performance.now();
    expect(calibrateTerminalQuoteClock(epoch, mono, epoch, mono, epoch)).toBe(true);
  });
  afterEach(() => { cleanup(); resetTerminalQuoteFreshness(); vi.useRealTimers(); vi.restoreAllMocks(); delete window.__RTX_RUNTIME_CONFIG__; delete window.__RTX_QUOTE_DIAGNOSTICS_ENABLED__; delete window.__RTX_QUOTE_DIAGNOSTICS_SYMBOLS__; });

  it('restores authorized membership on a newer verified quote while the status refresh is still pending', async () => {
    apiGet.mockResolvedValueOnce(status()).mockImplementation(() => new Promise(() => {}));
    const { result } = renderHook(() => useActiveMarketSymbols()); await flush();
    expect(result.current.current).toBe(true); expect(result.current.symbols).toEqual([]);
    act(() => window.dispatchEvent(new Event(MARKET_SYMBOLS_REFRESH_REQUESTED_EVENT)));
    expect(apiGet).toHaveBeenCalledTimes(2);
    act(() => {
      expect(ingestTerminalQuote('BTCUSD', { bid: 100, ask: 101, provider_timestamp: epoch - 50,
        sequence: '9007199254740993', source: 'cserver', stale: false, tradable: true, source_mismatch: false })).toBe(true);
    });
    expect(getTerminalQuoteFreshness('BTCUSD')).toMatchObject({ live: true, clockStatus: 'verified' });
    expect(resolveTradeEligibleSymbolNames({ isAuthenticated: true, feedCurrent: result.current.current,
      authorizedSymbols: ['BTCUSD'], activeFeedSymbols: result.current.symbols })).toEqual(['BTCUSD']);
    expect(apiGet).toHaveBeenCalledTimes(2);
  });

  it('uses a newer accepted quote even when the older HTTP snapshot arrives afterward', async () => {
    let resolve!: (value: unknown) => void;
    apiGet.mockImplementation(() => new Promise(done => { resolve = done; }));
    const { result } = renderHook(() => useActiveMarketSymbols());
    ingest();
    await act(async () => { resolve(status()); await Promise.resolve(); });
    expect(result.current.symbols).toEqual(['BTCUSD']);
    expect(resolveTradeEligibleSymbolNames({ isAuthenticated: true, feedCurrent: result.current.current,
      authorizedSymbols: ['EURUSD'], activeFeedSymbols: result.current.symbols })).toEqual([]);
  });

  it.each([
    ['old provider', { provider_timestamp: epoch - 5000 }], ['equal provider', { provider_timestamp: epoch - 4000 }],
    ['stale provider', { provider_timestamp: epoch - 3500 }], ['future provider', { provider_timestamp: epoch + 1000 }],
    ['wrong source', { source: 'other' }], ['source veto', { source_mismatch: true }], ['trade veto', { tradable: false }],
    ['stale veto', { stale: true }], ['unknown flags', { tradable: undefined }],
    ['equal sequence', { sequence: '9007199254740992' }], ['older sequence', { sequence: '9007199254740991' }],
    ['missing sequence', { sequence: undefined }],
  ] satisfies Array<[string, Partial<TerminalQuoteEvidence>]>)('does not restore on %s quote evidence', async (_name, patch) => {
    apiGet.mockResolvedValue(status()); const { result } = renderHook(() => useActiveMarketSymbols()); await flush();
    ingest(patch); expect(result.current.symbols).toEqual([]);
  });

  it.each([
    ['missing data', { has_data: false }], ['silent', { silent: true }], ['mismatched source', { source_mismatch: true }],
    ['expected source mismatch', { expected_source: 'other' }], ['unknown veto', { source_mismatch: undefined }],
    ['invalid sequence', { sequence: 'not-a-sequence' }], ['missing provider time', { last_tick_ms: undefined }],
  ])('never supersedes a %s status row', async (_name, patch) => {
    apiGet.mockResolvedValue(status(patch as Record<string, unknown>));
    const { result } = renderHook(() => useActiveMarketSymbols()); await flush(); ingest();
    expect(result.current.symbols).toEqual([]);
  });

  it('requires a verified clock, expires with real quote age, and revokes same-identity vetoes', async () => {
    resetTerminalQuoteFreshness();
    apiGet.mockResolvedValue(status()); const { result } = renderHook(() => useActiveMarketSymbols()); await flush();
    ingest(); expect(result.current.symbols).toEqual([]);
    act(calibrate); expect(result.current.symbols).toEqual(['BTCUSD']);
    ingest({ tradable: false }); expect(result.current.symbols).toEqual([]);
    ingest({ sequence: '9007199254740994', provider_timestamp: epoch - 10 });
    expect(result.current.symbols).toEqual(['BTCUSD']);
    act(() => vi.advanceTimersByTime(3100));
    expect(getTerminalQuoteFreshness('BTCUSD').live).toBe(false);
    expect(result.current.symbols).toEqual([]);
  });

  it.each(['failure', 'non-authoritative', 'explicit-veto'] as const)('revokes recovery after %s status and cannot restore it with another quote', async (next) => {
    apiGet.mockResolvedValueOnce(status()); const { result } = renderHook(() => useActiveMarketSymbols()); await flush();
    ingest(); expect(result.current.symbols).toEqual(['BTCUSD']);
    if (next === 'failure') apiGet.mockRejectedValue(new Error('status unavailable'));
    else apiGet.mockResolvedValue(next === 'non-authoritative' ? {} : status({ source_mismatch: true }));
    act(() => window.dispatchEvent(new Event(MARKET_SYMBOLS_REFRESH_REQUESTED_EVENT))); await flush();
    ingest({ sequence: '9007199254740994', provider_timestamp: epoch - 10 });
    expect(result.current.symbols).toEqual([]);
    if (next !== 'explicit-veto') expect(result.current.current).toBe(false);
  });

  it.each(['auth', 'quote-generation'] as const)('revokes restored membership on %s ownership change', async (change) => {
    apiGet.mockResolvedValue(status()); const { result } = renderHook(() => useActiveMarketSymbols()); await flush();
    ingest(); expect(result.current.symbols).toEqual(['BTCUSD']);
    act(() => { if (change === 'auth') emitSessionChange('account_change'); else { resetTerminalQuoteFreshness(); calibrate(); } });
    expect(result.current.symbols).toEqual([]);
    ingest({ sequence: '9007199254740994', provider_timestamp: epoch - 10 });
    expect(result.current.symbols).toEqual([]);
  });

  it.each(['account', 'broker'] as const)('cannot commit a pending status response after %s ownership changes', async (change) => {
    let resolve!: (value: unknown) => void;
    apiGet.mockImplementation(() => new Promise(done => { resolve = done; }));
    const { result } = renderHook(() => useActiveMarketSymbols());
    act(() => { if (change === 'account') emitSessionChange('account_change'); else localStorage.setItem('broker_id', 'other-broker'); });
    ingest();
    await act(async () => { resolve(status({ fresh: true, stale: false, tradable: true })); await Promise.resolve(); });
    expect(result.current.symbols).toEqual([]); expect(result.current.current).toBe(false);
    expect(result.current.settled).toBe(false);
  });

  it('does not render again for unrelated full-watch ticks or unchanged recovered membership', async () => {
    const rendered = vi.fn(); apiGet.mockResolvedValue(status());
    const { result } = renderHook(() => { rendered(); return useActiveMarketSymbols(); }); await flush(); ingest();
    expect(result.current.symbols).toEqual(['BTCUSD']); const count = rendered.mock.calls.length;
    act(() => {
      for (let i = 0; i < 100; i++) ingestTerminalQuote('EURUSD', liveQuote({ sequence: String(i + 1) }));
      for (let i = 0; i < 20; i++) ingestTerminalQuote('BTCUSD', liveQuote({ sequence: String(9007199254740994n + BigInt(i)) }));
    });
    expect(rendered).toHaveBeenCalledTimes(count);
  });

  it('records the exact superseded status and newer quote identities only when diagnostics are enabled', async () => {
    window.__RTX_QUOTE_DIAGNOSTICS_ENABLED__ = true;
    window.__RTX_QUOTE_DIAGNOSTICS_SYMBOLS__ = ['BTCUSD'];
    const count = getQuoteDiagnosticDump().controls.filter(row => row.reason === 'stale-status-superseded').length;
    apiGet.mockResolvedValue(status()); const { result } = renderHook(() => useActiveMarketSymbols()); await flush(); ingest();
    expect(result.current.symbols).toEqual(['BTCUSD']);
    const records = getQuoteDiagnosticDump().controls.filter(row => row.reason === 'stale-status-superseded');
    expect(records.length - count).toBe(2);
    expect(records.slice(-2)).toMatchObject([
      { phase: 'status', symbol: 'BTCUSD', source: 'cserver', providerTimestamp: epoch - 4000, hubSequence: '9007199254740992' },
      { phase: 'quote', symbol: 'BTCUSD', source: 'cserver', providerTimestamp: epoch - 50, hubSequence: '9007199254740993' },
    ]);
    expect(records.every(row => !('token' in row) && !('account' in row) && !('owner' in row))).toBe(true);
  });

  it('restores an unselected symbol without consuming diagnostic pair capacity', async () => {
    window.__RTX_QUOTE_DIAGNOSTICS_ENABLED__ = true;
    window.__RTX_QUOTE_DIAGNOSTICS_SYMBOLS__ = ['EURUSD'];
    const before = getQuoteDiagnosticDump().controls.filter(row => row.reason === 'stale-status-superseded');
    apiGet.mockResolvedValue(status()); const { result } = renderHook(() => useActiveMarketSymbols()); await flush(); ingest();
    expect(result.current.symbols).toEqual(['BTCUSD']);
    expect(getQuoteDiagnosticDump().controls.filter(row => row.reason === 'stale-status-superseded')).toEqual(before);
  });
});
