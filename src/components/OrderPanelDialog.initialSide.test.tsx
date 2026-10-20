// @vitest-environment jsdom

// SUI-T10 side preselection (ITEM 2): the order dialog should preselect the
// side implied by the chart entry point via an optional `initialSide` prop.
// Written FIRST against a06f0b36: these fail on base (no `initialSide` prop,
// no `data-side` / `aria-pressed` preselection) and pass once the dialog
// defaults its Buy/Sell submit path to the provided side.
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useAppStore } from '../store/useAppStore';
import { OrderPanelDialog } from './OrderPanelDialog';

vi.mock('../hooks/useSymbolMarketStatus', () => ({
  useSymbolMarketStatus: () => ({
    symbol: 'EURUSD',
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
  useLiveOrderBook: () => null,
}));

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

describe('OrderPanelDialog initialSide preselection (SUI-T10)', () => {
  beforeEach(() => {
    localStorage.setItem('lastLotSize', '0.01');
    setupTick();
  });

  afterEach(() => {
    cleanup();
    useAppStore.getState().reset();
  });

  it('preselects the BUY submit path when initialSide="BUY"', () => {
    const onSubmitOrder = vi.fn();
    render(
      <OrderPanelDialog
        isOpen
        onClose={vi.fn()}
        symbol="EURUSD"
        currentPrice={{ bid: 1.085, ask: 1.0852 }}
        onSubmitOrder={onSubmitOrder}
        initialSide="BUY"
      />,
    );

    const dialog = screen.getByRole('dialog');
    expect(dialog.getAttribute('data-side')).toBe('buy');

    const buyButton = screen.getByRole<HTMLButtonElement>('button', { name: /buy by market/i });
    const sellButton = screen.getByRole<HTMLButtonElement>('button', { name: /sell by market/i });
    expect(buyButton.getAttribute('aria-pressed')).toBe('true');
    expect(sellButton.getAttribute('aria-pressed')).toBe('false');

    // Both choices stay functional.
    expect(buyButton.disabled).toBe(false);
    expect(sellButton.disabled).toBe(false);

    fireEvent.click(buyButton);
    expect(onSubmitOrder).toHaveBeenCalledWith(expect.objectContaining({ type: 'buy' }));
  });

  it('preselects the SELL submit path when initialSide="SELL"', () => {
    const onSubmitOrder = vi.fn();
    render(
      <OrderPanelDialog
        isOpen
        onClose={vi.fn()}
        symbol="EURUSD"
        currentPrice={{ bid: 1.085, ask: 1.0852 }}
        onSubmitOrder={onSubmitOrder}
        initialSide="SELL"
      />,
    );

    const dialog = screen.getByRole('dialog');
    expect(dialog.getAttribute('data-side')).toBe('sell');

    const buyButton = screen.getByRole<HTMLButtonElement>('button', { name: /buy by market/i });
    const sellButton = screen.getByRole<HTMLButtonElement>('button', { name: /sell by market/i });
    expect(sellButton.getAttribute('aria-pressed')).toBe('true');
    expect(buyButton.getAttribute('aria-pressed')).toBe('false');

    expect(buyButton.disabled).toBe(false);
    expect(sellButton.disabled).toBe(false);

    fireEvent.click(sellButton);
    expect(onSubmitOrder).toHaveBeenCalledWith(expect.objectContaining({ type: 'sell' }));
  });

  it('keeps both choices functional so the user can switch from the preselected side', () => {
    const onSubmitOrder = vi.fn();
    render(
      <OrderPanelDialog
        isOpen
        onClose={vi.fn()}
        symbol="EURUSD"
        currentPrice={{ bid: 1.085, ask: 1.0852 }}
        onSubmitOrder={onSubmitOrder}
        initialSide="BUY"
      />,
    );

    // Preselected BUY, but pressing Sell still submits the sell path.
    fireEvent.click(screen.getByRole('button', { name: /sell by market/i }));
    expect(onSubmitOrder).toHaveBeenCalledWith(expect.objectContaining({ type: 'sell' }));
  });

  it('ignores invalid initialSide values fail-closed (default flow)', () => {
    const onSubmitOrder = vi.fn();
    render(
      <OrderPanelDialog
        isOpen
        onClose={vi.fn()}
        symbol="EURUSD"
        currentPrice={{ bid: 1.085, ask: 1.0852 }}
        onSubmitOrder={onSubmitOrder}
        initialSide={'SIDEWAYS' as unknown as 'BUY'}
      />,
    );

    const dialog = screen.getByRole('dialog');
    expect(dialog.getAttribute('data-side')).toBeNull();

    const buyButton = screen.getByRole<HTMLButtonElement>('button', { name: /buy by market/i });
    const sellButton = screen.getByRole<HTMLButtonElement>('button', { name: /sell by market/i });
    expect(buyButton.getAttribute('aria-pressed')).toBe('false');
    expect(sellButton.getAttribute('aria-pressed')).toBe('false');
    expect(buyButton.disabled).toBe(false);
    expect(sellButton.disabled).toBe(false);

    fireEvent.click(buyButton);
    expect(onSubmitOrder).toHaveBeenCalledWith(expect.objectContaining({ type: 'buy' }));
  });

  it('leaves behavior unchanged when initialSide is absent', () => {
    render(
      <OrderPanelDialog
        isOpen
        onClose={vi.fn()}
        symbol="EURUSD"
        currentPrice={{ bid: 1.085, ask: 1.0852 }}
        onSubmitOrder={vi.fn()}
      />,
    );

    const dialog = screen.getByRole('dialog');
    expect(dialog.getAttribute('data-side')).toBeNull();

    const buyButton = screen.getByRole<HTMLButtonElement>('button', { name: /buy by market/i });
    const sellButton = screen.getByRole<HTMLButtonElement>('button', { name: /sell by market/i });
    expect(buyButton.getAttribute('aria-pressed')).toBe('false');
    expect(sellButton.getAttribute('aria-pressed')).toBe('false');
    expect(buyButton.disabled).toBe(false);
    expect(sellButton.disabled).toBe(false);
  });
});
