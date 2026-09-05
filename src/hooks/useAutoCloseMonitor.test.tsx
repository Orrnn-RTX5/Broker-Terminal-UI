// @vitest-environment jsdom

import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useAppStore, type Position, type Tick } from '../store/useAppStore';
import { useAutoCloseMonitor } from './useAutoCloseMonitor';

const makePosition = (symbol: string): Position => ({
  id: 730001,
  symbol,
  side: 'BUY',
  volume: 0.01,
  openPrice: 100,
  currentPrice: 100,
  openTime: new Date(0).toISOString(),
  sl: 90,
  tp: 110,
  swap: 0,
  commission: 0,
  unrealizedPnL: 0,
});

const makeTick = (symbol: string, bid: number): Tick => ({
  symbol,
  bid,
  ask: bid + 1,
  spread: 1,
  timestamp: 1,
});

describe('useAutoCloseMonitor exact symbol lookup', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    useAppStore.getState().reset();
  });

  afterEach(() => {
    cleanup();
    vi.clearAllTimers();
    vi.useRealTimers();
    vi.restoreAllMocks();
    useAppStore.getState().reset();
  });

  it('never crosses SL/TP with a quote from a different suffixed contract', () => {
    useAppStore.setState({ positions: [makePosition('XAUUSD')] });
    useAppStore.getState().setTicks({
      'XAUUSD.raw': makeTick('XAUUSD.raw', 120),
    });
    const dispatch = vi.spyOn(window, 'dispatchEvent');
    const hook = renderHook(() => useAutoCloseMonitor(100));

    act(() => vi.advanceTimersByTime(100));

    expect(dispatch.mock.calls.some(([event]) => event.type === 'rtx:force-refresh-positions')).toBe(false);
    hook.unmount();
  });

  it('accepts case/whitespace differences for the same exact contract', () => {
    useAppStore.setState({ positions: [makePosition(' xauusd.raw ')] });
    useAppStore.getState().setTicks({
      'XAUUSD.RAW': makeTick('XAUUSD.RAW', 120),
    });
    const dispatch = vi.spyOn(window, 'dispatchEvent');
    const hook = renderHook(() => useAutoCloseMonitor(100));

    act(() => vi.advanceTimersByTime(100));

    expect(dispatch.mock.calls.some(([event]) => event.type === 'rtx:force-refresh-positions')).toBe(true);
    hook.unmount();
    act(() => vi.advanceTimersByTime(5_000));
  });
});
