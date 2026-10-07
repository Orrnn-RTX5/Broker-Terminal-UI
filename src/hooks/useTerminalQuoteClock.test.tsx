import { act, renderHook, cleanup } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useTerminalQuoteClock } from './useTerminalQuoteClock';
import { getTerminalQuoteFreshness, ingestTerminalQuote, resetTerminalQuoteFreshness } from '../services/terminalQuoteFreshness';
import { getQuoteDiagnosticDump } from '../services/quoteDiagnostics';

const mocks = vi.hoisted(() => ({ get: vi.fn(), session: undefined as undefined | (() => void) }));
vi.mock('../api/client', () => ({ apiClient: { get: mocks.get } }));
vi.mock('../config/api', () => ({ API_V2_BASE_URL: 'https://broker.test/api/v2' }));
vi.mock('../services/terminalQuoteClockOwnership', () => ({ getTerminalQuoteClockOwner: () => undefined }));
vi.mock('../services/brokerSession', () => ({
  onSessionChange: (fn: () => void) => { mocks.session = fn; return () => { mocks.session = undefined; }; },
}));
const epoch = 1_800_000_000_000;
const quote = () => ({ bid: 1, ask: 2, provider_timestamp: epoch, sequence: 1, source: 'cserver' });
describe('terminal clock lifecycle', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(epoch);
    vi.spyOn(performance, 'now').mockImplementation(() => Date.now() - epoch + 100);
    (window as Window & { __RTX_RUNTIME_CONFIG__?: Record<string, unknown> }).__RTX_RUNTIME_CONFIG__ = { TERMINAL_QUOTE_FRESHNESS: true };
    resetTerminalQuoteFreshness();
    mocks.get.mockReset().mockResolvedValue({ server_time_ms: epoch });
  });
  afterEach(() => {
    cleanup(); vi.restoreAllMocks(); vi.useRealTimers();
    delete (window as Window & { __RTX_RUNTIME_CONFIG__?: Record<string, unknown> }).__RTX_RUNTIME_CONFIG__;
    delete window.__RTX_QUOTE_DIAGNOSTICS_ENABLED__;
  });
  it('calibrates immediately and refreshes every five seconds with one owner', async () => {
    const view = renderHook(() => useTerminalQuoteClock());
    await act(async () => {});
    ingestTerminalQuote('XAUUSD', quote());
    expect(getTerminalQuoteFreshness('XAUUSD').live).toBe(true);
    expect(mocks.get).toHaveBeenCalledTimes(1);
    expect(mocks.get).toHaveBeenCalledWith('/time', expect.objectContaining({ cache: 'no-store', timeoutMs: 2000 }));
    await act(async () => { vi.advanceTimersByTime(5000); });
    expect(mocks.get).toHaveBeenCalledTimes(2);
    view.unmount();
    await act(async () => { vi.advanceTimersByTime(5000); });
    expect(mocks.get).toHaveBeenCalledTimes(2);
  });
  it('ignores a prior session response even if abort does not stop completion', async () => {
    let complete: (value: unknown) => void = () => {};
    mocks.get.mockReturnValueOnce(new Promise(resolve => { complete = resolve; }))
      .mockImplementation(() => new Promise(() => {}));
    renderHook(() => useTerminalQuoteClock());
    act(() => { mocks.session?.(); });
    ingestTerminalQuote('XAUUSD', quote());
    await act(async () => { complete({ server_time_ms: epoch }); });
    expect(getTerminalQuoteFreshness('XAUUSD')).toMatchObject({ live: false, reason: 'time-unverified' });
  });
  it('invalidates quotes on page resume and requests new clock evidence', async () => {
    renderHook(() => useTerminalQuoteClock());
    await act(async () => {});
    ingestTerminalQuote('XAUUSD', quote());
    expect(getTerminalQuoteFreshness('XAUUSD').live).toBe(true);
    await act(async () => { window.dispatchEvent(new Event('pageshow')); });
    expect(getTerminalQuoteFreshness('XAUUSD').live).toBe(false);
    expect(mocks.get).toHaveBeenCalledTimes(2);
  });
  it('does not fetch or install periodic work for other deployments', async () => {
    (window as Window & { __RTX_RUNTIME_CONFIG__?: Record<string, unknown> }).__RTX_RUNTIME_CONFIG__ = {};
    renderHook(() => useTerminalQuoteClock());
    await act(async () => { vi.advanceTimersByTime(15000); });
    expect(mocks.get).not.toHaveBeenCalled();
  });
  it('retries failed calibration after one second while preserving valid evidence', async () => {
    renderHook(() => useTerminalQuoteClock());
    await act(async () => {});
    ingestTerminalQuote('XAUUSD', quote());
    mocks.get.mockRejectedValueOnce(new Error('network')).mockResolvedValue({server_time_ms:epoch});
    await act(async () => { vi.advanceTimersByTime(5000); });
    ingestTerminalQuote('XAUUSD', {...quote(), sequence:2, provider_timestamp:Date.now()});
    expect(getTerminalQuoteFreshness('XAUUSD').live).toBe(true);
    const calls = mocks.get.mock.calls.length;
    await act(async () => { vi.advanceTimersByTime(999); });
    expect(mocks.get).toHaveBeenCalledTimes(calls);
    await act(async () => { vi.advanceTimersByTime(1); });
    expect(mocks.get).toHaveBeenCalledTimes(calls + 1);
  });
  it('does not overlap refresh events while a request is pending', async () => {
    mocks.get.mockImplementation(() => new Promise(() => {}));
    renderHook(() => useTerminalQuoteClock());
    act(() => {
      window.dispatchEvent(new Event('rtx:quote-clock-refresh'));
      window.dispatchEvent(new Event('rtx:quote-clock-refresh'));
      vi.advanceTimersByTime(1000);
    });
    expect(mocks.get).toHaveBeenCalledTimes(1);
  });
  it('diagnoses and retries a timeout without exposing the error message', async () => {
    window.__RTX_QUOTE_DIAGNOSTICS_ENABLED__ = true;
    mocks.get.mockRejectedValueOnce(new Error('Request timed out after 2 seconds'));
    renderHook(() => useTerminalQuoteClock());
    await act(async () => {});
    const diagnostic = getQuoteDiagnosticDump().controls.at(-1);
    expect(diagnostic).toMatchObject({ kind: 'clock', accepted: false, reason: 'request-timeout' });
    expect(JSON.stringify(diagnostic)).not.toContain('Request timed out');
    await act(async () => { vi.advanceTimersByTime(1000); });
    expect(mocks.get).toHaveBeenCalledTimes(2);
  });
  it('rejects an unbound response after quote generation changes and records the discard', async () => {
    window.__RTX_QUOTE_DIAGNOSTICS_ENABLED__ = true;
    let complete!: (value: unknown) => void;
    mocks.get.mockReturnValueOnce(new Promise(resolve => { complete = resolve; }));
    renderHook(() => useTerminalQuoteClock());
    act(() => { resetTerminalQuoteFreshness(); });
    await act(async () => { complete({ server_time_ms: epoch }); });
    expect(getQuoteDiagnosticDump().controls.at(-1)).toMatchObject({ kind: 'clock', accepted: false, reason: 'unbound-session-changed' });
    ingestTerminalQuote('XAUUSD', quote());
    expect(getTerminalQuoteFreshness('XAUUSD').reason).toBe('time-unverified');
    await act(async () => { vi.advanceTimersByTime(1000); });
    expect(getTerminalQuoteFreshness('XAUUSD').live).toBe(true);
  });
  it('refreshes after a wall clock jump detected by the shared timer', async () => {
    renderHook(() => useTerminalQuoteClock());
    await act(async () => {});
    vi.mocked(performance.now).mockReturnValue(100);
    vi.setSystemTime(epoch + 5000);
    await act(async () => { vi.advanceTimersByTime(100); });
    expect(mocks.get).toHaveBeenCalledTimes(2);
  });
  it('does not request while hidden and invalidates old quote evidence on resume', async () => {
    const visibility = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
    renderHook(() => useTerminalQuoteClock());
    await act(async () => {});
    expect(mocks.get).not.toHaveBeenCalled();
    ingestTerminalQuote('XAUUSD', quote());
    visibility.mockReturnValue('visible');
    await act(async () => { document.dispatchEvent(new Event('visibilitychange')); });
    expect(mocks.get).toHaveBeenCalledTimes(1);
    expect(getTerminalQuoteFreshness('XAUUSD').reason).toBe('unavailable');
  });
  it('reschedules after a bailed tick so the anchor cannot silently expire', async () => {
    const visibility = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');
    renderHook(() => useTerminalQuoteClock());
    await act(async () => {});
    expect(mocks.get).toHaveBeenCalledTimes(1);
    // The tab is hidden when a scheduled tick fires, so that tick bails.
    visibility.mockReturnValue('hidden');
    await act(async () => { vi.advanceTimersByTime(5000); });
    expect(mocks.get).toHaveBeenCalledTimes(1);
    // Recovery must not depend on a visibilitychange event. A bailed tick that
    // stops rescheduling lets the 60-second anchor lapse, and an unverified
    // clock refuses every position close before it is sent.
    visibility.mockReturnValue('visible');
    await act(async () => { vi.advanceTimersByTime(1000); });
    expect(mocks.get).toHaveBeenCalledTimes(2);
  });

});
