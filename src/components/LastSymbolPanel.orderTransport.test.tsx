// @vitest-environment jsdom

import { cleanup, fireEvent, render, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  placeMarketOrder: vi.fn(),
  closePosition: vi.fn(),
}));

vi.mock('../services/api', () => ({
  api: {
    orders: { placeMarketOrder: mocks.placeMarketOrder },
    positions: { closePosition: mocks.closePosition },
  },
}));

vi.mock('../hooks/useSymbolMarketStatus', () => ({
  useSymbolMarketStatus: (symbol: string) => ({
    symbol,
    status: 'open',
    isOpen: true,
    label: 'Market Open',
    reason: '',
  }),
}));

import { useAppStore } from '../store/useAppStore';
import { useLastSymbolStore } from '../store/useLastSymbolStore';
import { LastSymbolPanel } from './LastSymbolPanel';

describe('LastSymbolPanel market-order transport', () => {
  beforeEach(() => {
    localStorage.clear();
    useAppStore.getState().reset();
    useAppStore.setState({ accountId: '200002' });
    useAppStore.getState().setTicks({
      EURUSD: {
        symbol: 'EURUSD',
        bid: 1.085,
        ask: 1.0852,
        spread: 0.0002,
        timestamp: Date.now(),
        digits: 5,
      },
    });
    useLastSymbolStore.setState({
      lastSymbol: 'EURUSD',
      volume: 0.01,
      autoSLTP: false,
      useRiskSizing: false,
    });
    mocks.placeMarketOrder.mockReset();
    mocks.placeMarketOrder.mockResolvedValue({ ticket: 990001 });
    mocks.closePosition.mockReset();
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('omits the former cosmetic comment so a standard click remains WS-eligible', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    render(<LastSymbolPanel />);

    fireEvent.keyDown(window, { key: 'B', shiftKey: true });

    await waitFor(() => expect(mocks.placeMarketOrder).toHaveBeenCalledTimes(1));
    const [order, timing] = mocks.placeMarketOrder.mock.calls[0];
    expect(order).toMatchObject({
      symbol: 'EURUSD',
      side: 'buy',
      volume: 0.01,
      login: 200002,
    });
    expect(order).not.toHaveProperty('comment');
    expect(timing).toEqual({ intentAtMs: expect.any(Number) });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('dispatches all 20 quick orders without waiting for an earlier terminal fill', async () => {
    mocks.placeMarketOrder.mockImplementation(() => new Promise(() => {}));
    render(<LastSymbolPanel />);

    for (let index = 0; index < 20; index += 1) {
      fireEvent.keyDown(window, { key: index % 2 === 0 ? 'B' : 'S', shiftKey: true });
    }

    await waitFor(() => expect(mocks.placeMarketOrder).toHaveBeenCalledTimes(20));
    expect(mocks.placeMarketOrder.mock.calls.map(([order]) => order.side)).toEqual(
      Array.from({ length: 20 }, (_, index) => index % 2 === 0 ? 'buy' : 'sell'),
    );
  });
});
