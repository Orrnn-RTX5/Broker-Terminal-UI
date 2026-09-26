// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useAppStore } from '../../store/useAppStore';
import { resetBrokerServerClock } from '../../services/brokerServerClock';
import { PopupPricesDialog } from './PopupPricesDialog';

describe('PopupPricesDialog', () => {
  beforeEach(() => {
    resetBrokerServerClock();
    useAppStore.getState().setTicks({
      EURUSD: {
        symbol: 'EURUSD',
        bid: 1.08456,
        ask: 1.08474,
        spread: 0.00018,
        timestamp: 1_700_000_000_000,
        dailyChange: 1.25,
        digits: 5,
        lp: 'LP-A',
      },
      USDJPY: {
        symbol: 'USDJPY',
        bid: 149.123,
        ask: 149.137,
        spread: 0.014,
        timestamp: 1_700_000_000_100,
        dailyChange: -0.31,
        digits: 3,
      },
    });
  });

  afterEach(() => {
    cleanup();
    useAppStore.getState().setTicks({});
    vi.restoreAllMocks();
  });

  it('portals deduplicated supplied symbols and renders their available quote fields', () => {
    render(
      <PopupPricesDialog
        isOpen
        symbols={['EURUSD', 'USDJPY', ' eurusd ', '']}
        onClose={vi.fn()}
      />,
    );

    const dialog = screen.getByRole('dialog', { name: 'Popup Prices' });
    const cards = within(dialog).getAllByRole('listitem');
    expect(dialog.parentElement).toBe(document.body.lastElementChild);
    expect(cards).toHaveLength(2);
    expect(within(dialog).getByLabelText('EURUSD Bid 1.08456')).toBeInTheDocument();
    expect(within(dialog).getByLabelText('EURUSD Ask 1.08474')).toBeInTheDocument();
    expect(within(dialog).getByLabelText('Daily Change +1.25%')).toHaveAttribute('data-tone', 'positive');
    expect(within(dialog).getByLabelText('Daily Change -0.31%')).toHaveAttribute('data-tone', 'negative');
    expect(within(dialog).getAllByText('Quote')).toHaveLength(2);
    expect(dialog).not.toHaveAttribute('aria-modal');
  });

  it('mirrors configured Market Watch columns and millisecond precision', () => {
    useAppStore.getState().setTicks({
      EURUSD: {
        symbol: 'EURUSD',
        bid: 1.08456,
        ask: 1.08474,
        spread: 0.00018,
        timestamp: Date.UTC(2026, 0, 2, 3, 4, 5, 42),
        dailyChange: 1.25,
        digits: 5,
        lp: 'LP-A',
      },
    });
    render(
      <PopupPricesDialog
        isOpen
        symbols={['EURUSD']}
        columns={['symbol', 'bid', 'ask', 'time', 'source']}
        showMilliseconds
        onClose={vi.fn()}
      />,
    );

    const dialog = screen.getByRole('dialog', { name: 'Popup Prices' });
    expect(within(dialog).getByText('03:04:05.042')).toBeInTheDocument();
    expect(within(dialog).getByText('LP-A')).toBeInTheDocument();
    expect(within(dialog).queryByText('Daily Change')).not.toBeInTheDocument();
  });

  it('uses retained quotes and closed-market values only when no positive live quote exists', () => {
    const asOf = Date.UTC(2026, 0, 2, 3, 4, 5, 42);
    render(
      <PopupPricesDialog
        isOpen
        symbols={['XAUUSD', 'GBPUSD']}
        columns={['symbol', 'bid', 'ask', 'spread', 'time', 'dailyChange']}
        showMilliseconds
        fallbackPrices={new Map([
          ['XAUUSD', { kind: 'close' as const, close: 4_385.2, asOf }],
          ['GBPUSD', { kind: 'quote' as const, bid: 1.2789, ask: 1.2791, asOf }],
        ])}
        dailyChanges={new Map([['XAUUSD', -0.42]])}
        onClose={vi.fn()}
      />,
    );

    const closeCard = screen.getByRole('listitem', { name: 'XAUUSD quote' });
    expect(within(closeCard).getByText('Last close')).toBeInTheDocument();
    expect(within(closeCard).getByLabelText('XAUUSD Bid 4385.20')).toBeInTheDocument();
    expect(within(closeCard).getByLabelText('XAUUSD Ask unavailable')).toBeInTheDocument();
    expect(within(closeCard).getByLabelText('Daily Change -0.42%')).toHaveAttribute('data-tone', 'negative');
    expect(within(closeCard).getByText('03:04:05.042')).toBeInTheDocument();
    expect(within(closeCard).getByText('Spread').nextElementSibling).toHaveTextContent('—');

    const retainedQuoteCard = screen.getByRole('listitem', { name: 'GBPUSD quote' });
    expect(within(retainedQuoteCard).getByText('Quote')).toBeInTheDocument();
    expect(within(retainedQuoteCard).getByLabelText('GBPUSD Bid 1.27890')).toBeInTheDocument();
    expect(within(retainedQuoteCard).getByLabelText('GBPUSD Ask 1.27910')).toBeInTheDocument();
  });

  it('keeps a positive live quote authoritative over retained fallbacks', () => {
    render(
      <PopupPricesDialog
        isOpen
        symbols={['EURUSD']}
        fallbackPrices={new Map([
          ['EURUSD', { kind: 'close' as const, close: 9.99999, asOf: Date.UTC(2020, 0, 1) }],
        ])}
        dailyChanges={new Map([['EURUSD', -99]])}
        onClose={vi.fn()}
      />,
    );

    const card = screen.getByRole('listitem', { name: 'EURUSD quote' });
    expect(within(card).getByText('Quote')).toBeInTheDocument();
    expect(within(card).queryByText('Last close')).not.toBeInTheDocument();
    expect(within(card).getByLabelText('EURUSD Bid 1.08456')).toBeInTheDocument();
    expect(within(card).getByLabelText('Daily Change +1.25%')).toBeInTheDocument();
  });

  it('closes on Escape and through the explicit window control', () => {
    const onClose = vi.fn();
    render(<PopupPricesDialog isOpen symbols={['EURUSD']} onClose={onClose} />);
    const dialog = screen.getByRole('dialog', { name: 'Popup Prices' });

    fireEvent.keyDown(dialog, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);

    fireEvent.click(within(dialog).getByRole('button', { name: 'Close Popup Prices' }));
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it('maximizes, restores, and supports keyboard resizing', () => {
    render(<PopupPricesDialog isOpen symbols={['EURUSD']} onClose={vi.fn()} />);
    const dialog = screen.getByRole('dialog', { name: 'Popup Prices' });
    const resize = within(dialog).getByRole('button', { name: 'Resize Popup Prices dialog' });
    const initialWidth = Number.parseFloat(dialog.style.width);

    fireEvent.keyDown(resize, { key: 'ArrowRight' });
    expect(Number.parseFloat(dialog.style.width)).toBeGreaterThan(initialWidth);

    fireEvent.click(within(dialog).getByRole('button', { name: 'Maximize Popup Prices' }));
    expect(dialog).toHaveClass('is-maximized');
    expect(dialog).toHaveStyle({ left: '0px', top: '0px', width: `${window.innerWidth}px`, height: `${window.innerHeight}px` });
    expect(within(dialog).queryByRole('button', { name: 'Resize Popup Prices dialog' })).not.toBeInTheDocument();

    fireEvent.click(within(dialog).getByRole('button', { name: 'Restore Popup Prices' }));
    expect(dialog).not.toHaveClass('is-maximized');
    expect(within(dialog).getByRole('button', { name: 'Resize Popup Prices dialog' })).toBeInTheDocument();
  });

  it('keeps an explicit state when no symbols were supplied', () => {
    render(<PopupPricesDialog isOpen symbols={[]} onClose={vi.fn()} />);

    expect(screen.getByRole('status')).toHaveTextContent('No symbols to display');
    expect(screen.queryByRole('list')).not.toBeInTheDocument();
  });
});
