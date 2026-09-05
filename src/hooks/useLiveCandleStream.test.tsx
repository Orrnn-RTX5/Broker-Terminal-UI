import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useLiveCandleStream } from './useLiveCandleStream';

const harness = vi.hoisted(() => ({
  subscribe: vi.fn(),
  unsubscribe: vi.fn(),
  reconcileServerCandle: vi.fn(),
  addCompletedCandle: vi.fn(),
  getCandles: vi.fn(() => []),
  processTick: vi.fn(() => new Map()),
  candleCallback: null as ((payload: Record<string, unknown>) => void) | null,
}));

vi.mock('../services/candleSocketManager', () => ({
  getCandleSocketManager: () => ({
    isConnected: () => true,
    subscribe: harness.subscribe,
  }),
}));

vi.mock('../services/candleAggregationService', () => ({
  candleAggregationService: {
    reconcileServerCandle: harness.reconcileServerCandle,
    addCompletedCandle: harness.addCompletedCandle,
    getCandles: harness.getCandles,
    processTick: harness.processTick,
  },
}));

vi.mock('../store/useAppStore', () => ({
  useAppStore: (selector: (state: { isAuthenticated: boolean }) => unknown) => (
    selector({ isAuthenticated: true })
  ),
}));

describe('useLiveCandleStream backend finality', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    harness.candleCallback = null;
    harness.subscribe.mockImplementation((
      _symbol: string,
      _timeframe: string,
      onCandle: (payload: Record<string, unknown>) => void,
    ) => {
      harness.candleCallback = onCandle;
      return { unsubscribe: harness.unsubscribe };
    });
    harness.getCandles.mockReturnValue([]);
  });

  afterEach(() => cleanup());

  it('keeps missing/false finality partial and commits only explicit closed=true', () => {
    const onCandleUpdate = vi.fn();
    const { unmount } = renderHook(() => useLiveCandleStream('EURUSD.r', 'm1', onCandleUpdate));

    const partial = {
      symbol: 'EURUSD.R',
      timeframe: 'M1',
      time: '1788176700123456000',
      open: 1.125,
      high: 1.126,
      low: 1.124,
      close: 1.1255,
      volume: 12,
      closed: false,
    };
    const final = { ...partial, close: 1.1257, closed: true };

    act(() => harness.candleCallback?.(partial));
    act(() => harness.candleCallback?.(final));

    expect(harness.reconcileServerCandle).toHaveBeenNthCalledWith(
      1,
      'EURUSD.r',
      'M1',
      expect.objectContaining({ time: 1_788_176_700, close: 1.1255, isComplete: false }),
      false,
    );
    expect(harness.reconcileServerCandle).toHaveBeenNthCalledWith(
      2,
      'EURUSD.r',
      'M1',
      expect.objectContaining({ time: 1_788_176_700, close: 1.1257, isComplete: true }),
      true,
    );
    expect(harness.addCompletedCandle).not.toHaveBeenCalled();
    expect(onCandleUpdate).toHaveBeenCalledTimes(2);

    unmount();
  });
});
