// @vitest-environment jsdom

import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { SymbolMarketStatusState } from '../hooks/useSymbolMarketStatus';
import { useAppStore } from '../store/useAppStore';
import { normalizeMarketStatus, type KnownMarketStatus } from '../utils/marketStatus';
import { OrderPanelDialog } from './OrderPanelDialog';

const marketStatusMock = vi.hoisted(() => ({
  current: {
    symbol: 'EURUSD',
    status: 'open',
    isOpen: true,
    isTradeBlocked: false,
    label: 'Market Open',
    loading: false,
    error: null,
    refreshedAt: 1,
  } as SymbolMarketStatusState,
}));

vi.mock('../hooks/useSymbolMarketStatus', () => ({
  useSymbolMarketStatus: () => marketStatusMock.current,
}));

const setMarketStatus = (status: KnownMarketStatus) => {
  marketStatusMock.current = {
    ...normalizeMarketStatus({ symbol: 'EURUSD', status }),
    loading: false,
    error: null,
    refreshedAt: 1,
  };
};

const setupTick = () => {
  useAppStore.getState().reset();
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
};

const renderDialog = () => render(
  <OrderPanelDialog
    isOpen
    onClose={vi.fn()}
    symbol="EURUSD"
    currentPrice={{ bid: 1.085, ask: 1.0852 }}
    onSubmitOrder={vi.fn()}
  />,
);

describe('OrderPanelDialog market status', () => {
  beforeEach(() => {
    setupTick();
    setMarketStatus('open');
  });

  afterEach(() => {
    cleanup();
  });

  it('enables market execution buttons when the market is open', () => {
    renderDialog();

    expect(screen.getByRole('button', { name: /sell by market/i }).disabled).toBe(false);
    expect(screen.getByRole('button', { name: /buy by market/i }).disabled).toBe(false);
  });

  it.each([
    ['closed', 'Market is closed for EURUSD.'],
    ['pre_market', 'EURUSD is in pre-market. Trading is currently disabled.'],
    ['after_hours', 'EURUSD is after hours. Trading is currently disabled.'],
  ] as const)('disables market execution for %s status', (status, message) => {
    setMarketStatus(status);
    renderDialog();

    expect(screen.getByRole('button', { name: /sell by market/i }).disabled).toBe(true);
    expect(screen.getByRole('button', { name: /buy by market/i }).disabled).toBe(true);
    expect(screen.getByText(message)).not.toBeNull();
  });
});
