// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';

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

import { useAppStore, type Position } from '../store/useAppStore';
import { useLastSymbolStore } from '../store/useLastSymbolStore';
import { useSettingsStore } from '../store/useSettingsStore';
import {
  ACK_HISTORY_FALLBACK_MS,
  bindDefaultHistoryFreshnessOwner,
  createHistoryFreshnessOwner,
} from '../app/trading/tradeHistoryFreshness';
import { LastSymbolPanel } from './LastSymbolPanel';

const position = (id: number): Position => ({
  id,
  symbol: 'EURUSD',
  side: 'BUY',
  volume: 0.01,
  openPrice: 1.085,
  currentPrice: 1.0852,
  openTime: '2026-10-22T08:00:00.000Z',
  sl: 0,
  tp: 0,
  swap: 0,
  commission: 0,
  unrealizedPnL: 0.02,
  state_version: '1',
} as Position);

describe('LastSymbolPanel close path history refresh', () => {
  let refresh: Mock<(login: number) => Promise<void>>;
  let unbind: () => void;

  beforeEach(() => {
    localStorage.clear();
    useAppStore.getState().reset();
    useAppStore.setState({ accountId: '200002', isAuthenticated: true, authToken: 'close-path-token' });
    useAppStore.getState().setTicks({
      EURUSD: { symbol: 'EURUSD', bid: 1.085, ask: 1.0852, spread: 0.0002, timestamp: Date.now(), digits: 5 },
    });
    useAppStore.getState().setPositions([position(501)]);
    useLastSymbolStore.setState({ lastSymbol: 'EURUSD', volume: 0.01, autoSLTP: false, useRiskSizing: false });
    act(() => {
      useSettingsStore.setState((s) => ({ trade: { ...s.trade, oneClickTrading: true } }));
    });
    mocks.placeMarketOrder.mockReset();
    mocks.closePosition.mockReset();
    mocks.closePosition.mockResolvedValue(undefined);
    refresh = vi.fn((_login: number) => Promise.resolve());
    unbind = bindDefaultHistoryFreshnessOwner(createHistoryFreshnessOwner(refresh, () => true));
  });

  afterEach(() => {
    cleanup();
    unbind();
    document.body.replaceChildren();
    useSettingsStore.setState((s) => ({ trade: { ...s.trade, oneClickTrading: false } }));
  });

  it('a confirmed close refetches History at once and once more after the fallback delay', async () => {
    render(<LastSymbolPanel />);
    fireEvent.click(screen.getByRole('button', { name: 'Close all EURUSD positions' }));

    await waitFor(() => expect(mocks.closePosition).toHaveBeenCalledWith('501'));
    await waitFor(() => expect(refresh).toHaveBeenCalledTimes(1));
    expect(refresh).toHaveBeenLastCalledWith(200002);

    // Real timers here: waitFor cannot run under fake timers. The fallback is due 1500 ms after the ACK.
    await waitFor(() => expect(refresh).toHaveBeenCalledTimes(2), { timeout: ACK_HISTORY_FALLBACK_MS + 1000 });
    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(refresh).toHaveBeenCalledTimes(2);
  }, 10_000);
});
