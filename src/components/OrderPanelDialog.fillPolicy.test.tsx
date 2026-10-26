// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useAppStore } from '../store/useAppStore';
import { OrderPanelDialog } from './OrderPanelDialog';

vi.mock('../hooks/useSymbolMarketStatus', () => ({
  useSymbolMarketStatus: () => ({
    symbol: 'XAUUSD',
    status: 'open',
    isOpen: true,
    isTradeBlocked: false,
    label: 'Market Open',
    loading: false,
    error: null,
    refreshedAt: 1,
  }),
}));

vi.mock('../hooks/useLiveMarketData', () => ({
  useLiveOrderBook: () => ({
    bids: [
      { price: 4173.23, volume: 30 },
      { price: 4173.22, volume: 50 },
      { price: 4173.21, volume: 100 },
      { price: 4173.19, volume: 200 },
      { price: 4173.17, volume: 300 },
      { price: 4173.16, volume: 500 },
    ],
    asks: [
      { price: 4173.77, volume: 30 },
      { price: 4173.78, volume: 50 },
      { price: 4173.79, volume: 100 },
      { price: 4173.81, volume: 200 },
      { price: 4173.84, volume: 300 },
      { price: 4173.87, volume: 500 },
    ],
    spread: 0.54,
    timestamp: Date.now(),
  }),
}));

// T3 fill-policy honesty: the gateway has no fill_policy wire field
// (IOC/FOK are refused backend-side), so the dialog must not collect a
// live value — the control stays visible but disabled with this reason.
const UNSUPPORTED_REASON =
  'Fill policy is not supported by the execution venue and is not sent';

describe('OrderPanelDialog fill policy honesty (T3)', () => {
  beforeEach(() => {
    localStorage.setItem('lastLotSize', '0.01');
    useAppStore.getState().reset();
    useAppStore.getState().setTicks({
      XAUUSD: {
        symbol: 'XAUUSD',
        bid: 4173.23,
        ask: 4173.77,
        spread: 0.54,
        timestamp: Date.now(),
        digits: 2,
      },
    });
  });

  afterEach(() => {
    cleanup();
  });

  it('disables the fill policy control with the unsupported-venue reason', () => {
    render(
      <OrderPanelDialog
        isOpen
        onClose={vi.fn()}
        symbol="XAUUSD"
        currentPrice={{ bid: 4173.23, ask: 4173.77 }}
        onSubmitOrder={vi.fn()}
        symbols={['XAUUSD', 'EURUSD']}
      />,
    );

    // User-visible reason text (fails on base: no such helper exists).
    const reason = screen.getByText(UNSUPPORTED_REASON);
    const reasonId = reason.getAttribute('id');
    expect(reasonId).toBeTruthy();

    // Screen-reader select is queried hidden-scoped: at the merge tip it is
    // aria-hidden (deduped against the tablist's aria-label per ds-21 a11y),
    // and the tablist's own aria-label also matches a bare getByLabelText.
    // (ds-21: add `getByRole('tablist', { name: 'Fill policy' })` on your
    // tree to pin the a11y lock alongside these honesty checks.)
    const select = screen.getByLabelText('Fill policy', { selector: 'select' }) as HTMLSelectElement;
    expect(select).toBeDisabled();
    expect(select).toHaveAttribute('title', UNSUPPORTED_REASON);
    expect(select.getAttribute('aria-describedby')).toContain(reasonId!);

    // Every visible fill-policy tab is disabled and points at the same reason.
    for (const name of ['Fill or Kill', 'Immediate or Cancel', 'Return'] as const) {
      const tab = screen.getByRole('tab', { name });
      expect(tab).toBeDisabled();
      expect(tab).toHaveAttribute('title', UNSUPPORTED_REASON);
      expect(tab.getAttribute('aria-describedby')).toContain(reasonId!);
    }
  });

  it('keeps fill policy scoped to Market Execution (pending modes show expiration instead)', () => {
    render(
      <OrderPanelDialog
        isOpen
        onClose={vi.fn()}
        symbol="XAUUSD"
        currentPrice={{ bid: 4173.23, ask: 4173.77 }}
        onSubmitOrder={vi.fn()}
        symbols={['XAUUSD', 'EURUSD']}
      />,
    );

    expect(screen.getByLabelText('Fill policy', { selector: 'select' })).not.toBeNull();

    fireEvent.click(screen.getByTestId('order-mode-limit'));
    expect(screen.queryByLabelText('Fill policy', { selector: 'select' })).toBeNull();
    expect(screen.getByLabelText('Expiration')).not.toBeNull();
  });
});
