import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useTerminalQuoteFreshness } from './useTerminalQuoteFreshness';
import { calibrateTerminalQuoteClock, ingestTerminalQuote, resetTerminalQuoteFreshness } from '../services/terminalQuoteFreshness';

describe('useTerminalQuoteFreshness', () => {
  let mono: number;
  const epoch = 1_800_000_000_000;
  beforeEach(() => {
    mono = 0;
    vi.useFakeTimers();
    vi.spyOn(performance, 'now').mockImplementation(() => mono);
    vi.spyOn(Date, 'now').mockImplementation(() => epoch + mono);
    (window as any).__RTX_RUNTIME_CONFIG__ = { TERMINAL_QUOTE_FRESHNESS: true };
    resetTerminalQuoteFreshness();
    calibrateTerminalQuoteClock(epoch, 0, epoch, 0, epoch);
  });
  afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); delete (window as any).__RTX_RUNTIME_CONFIG__; });
  it('rerenders on expiry within 100ms and immediately on recovery', () => {
    ingestTerminalQuote('XAUUSD', { provider_timestamp: epoch, source: 'lp', sequence: 1, bid: 10, ask: 11 });
    const { result, unmount } = renderHook(() => useTerminalQuoteFreshness('XAUUSD'));
    expect(result.current.live).toBe(true);
    act(() => { mono = 3100; vi.advanceTimersByTime(100); });
    expect(result.current).toMatchObject({ live: false, reason: 'stale' });
    act(() => { ingestTerminalQuote('XAUUSD', { provider_timestamp: epoch + mono, source: 'lp', sequence: 2, bid: 10, ask: 11 }); });
    expect(result.current.live).toBe(true);
    unmount(); expect(vi.getTimerCount()).toBe(0);
  });
  it('does not schedule polling on terminals without the feature flag', () => {
    delete (window as any).__RTX_RUNTIME_CONFIG__;
    const { unmount } = renderHook(() => useTerminalQuoteFreshness('XAUUSD'));
    expect(vi.getTimerCount()).toBe(0);
    unmount();
  });
  it('does not rerender XAUUSD for unrelated symbol quotes', () => {
    ingestTerminalQuote('XAUUSD', { provider_timestamp: epoch, source: 'lp', sequence: 1, bid: 10, ask: 11 });
    let renders = 0;
    const { unmount } = renderHook(() => { renders++; return useTerminalQuoteFreshness('XAUUSD'); });
    const before = renders;
    act(() => {
      for (let sequence = 1; sequence <= 100; sequence++) {
        ingestTerminalQuote('EURUSD', { provider_timestamp: epoch, source: 'lp', sequence, bid: 1, ask: 2 });
      }
    });
    expect(renders).toBe(before);
    unmount();
  });
});
