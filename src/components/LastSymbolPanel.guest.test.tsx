// @vitest-environment jsdom

import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { TRADING_AUTH_REQUEST_EVENT, type TradingAuthIntent } from '../services/tradingAuthGate';
import { useAppStore } from '../store/useAppStore';
import { useLastSymbolStore } from '../store/useLastSymbolStore';
import { LastSymbolPanel } from './LastSymbolPanel';

const mocks = vi.hoisted(() => ({ placeMarketOrder: vi.fn() }));

vi.mock('../services/api', () => ({
  api: {
    orders: { placeMarketOrder: mocks.placeMarketOrder },
    positions: { closePosition: vi.fn() },
  },
}));

vi.mock('../hooks/useSymbolMarketStatus', () => ({
  fetchSymbolMarketStatus: vi.fn(),
  useSymbolMarketStatus: () => ({
    symbol: 'EURUSD',
    status: 'closed',
    isOpen: false,
    isTradeBlocked: true,
    label: 'Market Closed',
    loading: false,
    error: null,
    refreshedAt: Date.now(),
  }),
}));

describe('LastSymbolPanel guest authentication gate', () => {
  let intents: TradingAuthIntent[];
  let listener: EventListener;

  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    useAppStore.getState().reset();
    useLastSymbolStore.setState({
      lastSymbol: 'EURUSD',
      lastTradeSide: null,
      lastTradeTime: 0,
      volume: 0.1,
      useRiskSizing: false,
      autoSLTP: false,
    });
    mocks.placeMarketOrder.mockReset();
    intents = [];
    listener = ((event: CustomEvent<TradingAuthIntent>) => intents.push(event.detail)) as EventListener;
    window.addEventListener(TRADING_AUTH_REQUEST_EVENT, listener);
  });

  afterEach(() => {
    window.removeEventListener(TRADING_AUTH_REQUEST_EVENT, listener);
  });

  it.each(['BUY', 'SELL'] as const)('requests central auth for guest %s before readiness or mutation', (side) => {
    render(<LastSymbolPanel />);

    const control = screen.getByRole('button', { name: new RegExp(`^${side} EURUSD at market$`, 'i') });
    expect(control).toBeEnabled();
    fireEvent.click(control);

    expect(intents).toHaveLength(1);
    expect(intents[0]).toMatchObject({
      source: 'last-symbol-panel',
      side,
      symbol: 'EURUSD',
      volume: 0.1,
    });
    expect(mocks.placeMarketOrder).not.toHaveBeenCalled();
  });
});
