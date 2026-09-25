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

    expect(screen.getByRole<HTMLButtonElement>('button', { name: /sell by market/i }).disabled).toBe(false);
    expect(screen.getByRole<HTMLButtonElement>('button', { name: /buy by market/i }).disabled).toBe(false);
  });

  it('exposes the themed order surface and live chart accessibly', () => {
    renderDialog();

    const dialog = screen.getByRole('dialog', { name: 'New Order · EURUSD' });
    const chart = screen.getByRole('img', { name: 'Live EURUSD bid and ask tick chart' });

    expect(dialog.className).toContain('rtx-order-dialog');
    expect(dialog.querySelector('.rtx-order-dialog__header')).not.toBeNull();
    expect(dialog.querySelector('.rtx-order-dialog__price-summary')).not.toBeNull();
    expect(chart.getAttribute('data-testid')).toBe('order-mini-tick-chart');
    expect(screen.getByLabelText('EURUSD live bid and ask')).not.toBeNull();
  });

  it.each([
    ['closed', 'Market is closed for EURUSD.'],
    ['pre_market', 'EURUSD is in pre-market. Trading is currently disabled.'],
    ['after_hours', 'EURUSD is after hours. Trading is currently disabled.'],
  ] as const)('disables market execution for %s status', (status, message) => {
    setMarketStatus(status);
    renderDialog();

    expect(screen.getByRole<HTMLButtonElement>('button', { name: /sell by market/i }).disabled).toBe(true);
    expect(screen.getByRole<HTMLButtonElement>('button', { name: /buy by market/i }).disabled).toBe(true);
    expect(screen.getByText(message)).not.toBeNull();
  });
});

describe('OrderPanelDialog symbol dropdown', () => {
  beforeEach(() => {
    setupTick();
    setMarketStatus('open');
    useAppStore.getState().setTicks({
      ...useAppStore.getState().ticks,
      BTCUSD: { symbol: 'BTCUSD', bid: 108000, ask: 108010, spread: 10, timestamp: Date.now(), digits: 2 },
    });
  });

  afterEach(() => {
    cleanup();
  });

  const getSymbolOptions = () => Array.from(
    (screen.getByLabelText('Symbol') as HTMLSelectElement).options,
  ).map((option) => ({ value: option.value, disabled: option.disabled }));

  it('offers only the account symbols instead of every quote in the tick store', () => {
    render(
      <OrderPanelDialog
        isOpen
        onClose={vi.fn()}
        symbol="EURUSD"
        currentPrice={{ bid: 1.085, ask: 1.0852 }}
        onSubmitOrder={vi.fn()}
        symbols={['XAUUSD', 'EURUSD']}
      />,
    );

    expect(getSymbolOptions()).toEqual([
      { value: 'XAUUSD', disabled: false },
      { value: 'EURUSD', disabled: false },
    ]);
  });

  it('keeps the legacy tick-store list for callers without an account catalogue', () => {
    renderDialog();

    expect(getSymbolOptions().map((option) => option.value).sort()).toEqual(['BTCUSD', 'EURUSD']);
  });
});
