// @vitest-environment jsdom
import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { type Position, useAppStore } from '../../store/useAppStore';
import { useBottomDockStoreBridge } from './useBottomDockStoreBridge';

const position = (symbol: string, side: Position['side']): Position => ({
  id: 42,
  symbol,
  side,
  volume: 1,
  openPrice: 100,
  currentPrice: 101,
  openTime: '2026-01-01T00:00:00.000Z',
  sl: 0,
  tp: 0,
  swap: 0,
  commission: 0,
  unrealizedPnL: 1,
});

describe('useBottomDockStoreBridge', () => {
  afterEach(() => {
    cleanup();
    useAppStore.setState({ positions: [] });
  });

  it('publishes a replacement position when a new session reuses the same ticket and prices', () => {
    useAppStore.setState({ positions: [position('EURUSD', 'BUY')] });
    const view = renderHook(() => useBottomDockStoreBridge());

    act(() => {
      useAppStore.setState({ positions: [position('XAUUSD', 'SELL')] });
    });

    expect(view.result.current.positions[0]).toMatchObject({
      id: 42,
      symbol: 'XAUUSD',
      side: 'SELL',
    });
  });
});
