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

describe('OrderPanelDialog MT5 Desktop layout and behavior', () => {
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

  it('renders MT5 header, contract quantity, fill policy tabs, tick chart, and DOM + One Click Trading', () => {
    render(
      <OrderPanelDialog
        isOpen
        onClose={vi.fn()}
        symbol="XAUUSD"
        currentPrice={{ bid: 4173.23, ask: 4173.77 }}
        onSubmitOrder={vi.fn()}
        symbols={['XAUUSD', 'EURUSD']}
        instruments={[{ symbol: 'XAUUSD', digits: 2, contractSize: 100 }]}
      />,
    );

    expect(screen.getByText('Order: XAUUSD - Gold vs US Dollar')).not.toBeNull();
    // Contract units come from the broker catalog contract size (0.01 x 100).
    expect(screen.getByText('1 XAUUSD')).not.toBeNull();
    expect(screen.getByText('4 173.23 / 4 173.77')).not.toBeNull();
    expect(screen.getByRole('tab', { name: 'Fill or Kill' }).getAttribute('aria-selected')).toBe('true');
    expect(screen.getByRole('tab', { name: 'Immediate or Cancel' }).getAttribute('aria-selected')).toBe('false');
    expect(screen.getByTestId('order-mini-tick-chart')).not.toBeNull();
    expect(screen.getByTestId('order-dom-pane')).not.toBeNull();
    expect(screen.getByTestId('order-dom-oct')).not.toBeNull();
  });

  it('switches between Market Execution, Limit Order, Stop Order, and Stop Limit Order modes', () => {
    const onSubmitOrder = vi.fn();
    render(
      <OrderPanelDialog
        isOpen
        onClose={vi.fn()}
        symbol="XAUUSD"
        currentPrice={{ bid: 4173.23, ask: 4173.77 }}
        onSubmitOrder={onSubmitOrder}
      />,
    );

    // Switch to Limit Order
    fireEvent.click(screen.getByTestId('order-mode-limit'));
    const priceInput = screen.getByLabelText('Price') as HTMLInputElement;
    const stopLimitInput = screen.getByLabelText('Stop Limit price') as HTMLInputElement;
    const expirationSelect = screen.getByLabelText('Expiration') as HTMLSelectElement;
    const expirationDateInput = screen.getByLabelText(/Expiration date/i) as HTMLInputElement;

    expect(priceInput.disabled).toBe(false);
    expect(stopLimitInput.disabled).toBe(true);
    expect(expirationSelect.value).toBe('GTC');
    expect(expirationDateInput.disabled).toBe(true);

    // Pending Sell / Buy buttons in form are disabled while Price is 0.00
    const sellButtons = screen.getAllByRole<HTMLButtonElement>('button', { name: 'Sell' });
    const buyButtons = screen.getAllByRole<HTMLButtonElement>('button', { name: 'Buy' });
    expect(sellButtons[0].disabled).toBe(true);
    expect(buyButtons[0].disabled).toBe(true);

    // Enter a valid price -> form Sell and Buy buttons enable
    fireEvent.change(priceInput, { target: { value: '4170.00' } });
    expect(sellButtons[0].disabled).toBe(false);
    expect(buyButtons[0].disabled).toBe(false);

    // Switch to Stop Limit Order -> Stop Limit price becomes enabled and required
    fireEvent.click(screen.getByTestId('order-mode-stop-limit'));
    expect((screen.getByLabelText('Stop Limit price') as HTMLInputElement).disabled).toBe(false);
    expect(screen.getAllByRole<HTMLButtonElement>('button', { name: 'Buy' })[0].disabled).toBe(true);

    fireEvent.change(screen.getByLabelText('Stop Limit price'), { target: { value: '4171.00' } });
    expect(screen.getAllByRole<HTMLButtonElement>('button', { name: 'Buy' })[0].disabled).toBe(false);

    // Submit Stop Limit Buy order
    fireEvent.click(screen.getAllByRole<HTMLButtonElement>('button', { name: 'Buy' })[0]);
    expect(onSubmitOrder).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'buy',
        symbol: 'XAUUSD',
        volume: 0.01,
        orderType: 'Stop Limit Order',
        price: 4170,
        stopLimitPrice: 4171,
        expiration: 'GTC',
      }),
    );
  });

  it('toggles left sidebar labels, Tick Chart, Depth of Market, and One Click Trading panels', () => {
    render(
      <OrderPanelDialog
        isOpen
        onClose={vi.fn()}
        symbol="XAUUSD"
        currentPrice={{ bid: 4173.23, ask: 4173.77 }}
        onSubmitOrder={vi.fn()}
      />,
    );

    const dialog = screen.getByRole('dialog');
    expect(dialog.getAttribute('data-sidebar-expanded')).toBe('false');

    fireEvent.click(screen.getByTestId('order-toggle-sidebar'));
    expect(dialog.getAttribute('data-sidebar-expanded')).toBe('true');
    expect(screen.getByText('Market Execution')).not.toBeNull();
    expect(screen.getByText('Limit Order')).not.toBeNull();
    expect(screen.getByText('Stop Order')).not.toBeNull();
    expect(screen.getByText('Stop Limit Order')).not.toBeNull();

    // Toggle Tick Chart off and back on
    fireEvent.click(screen.getByTestId('order-toggle-tick-chart'));
    expect(screen.queryByTestId('order-mini-tick-chart')).toBeNull();
    fireEvent.click(screen.getByTestId('order-toggle-tick-chart'));
    expect(screen.getByTestId('order-mini-tick-chart')).not.toBeNull();

    // Toggle One Click Trading off
    fireEvent.click(screen.getByTestId('order-toggle-oct'));
    expect(screen.queryByTestId('order-dom-oct')).toBeNull();

    // Toggle Depth of Market off
    fireEvent.click(screen.getByTestId('order-toggle-dom'));
    expect(screen.queryByTestId('order-dom-pane')).toBeNull();
  });

  it('shows an honest unknown for contract units when the broker catalog has no contract size', () => {
    const { container } = render(
      <OrderPanelDialog
        isOpen
        onClose={vi.fn()}
        symbol="XAUUSD"
        currentPrice={{ bid: 4173.23, ask: 4173.77 }}
        onSubmitOrder={vi.fn()}
      />,
    );

    const units = container.querySelector('.rtx-order-dialog__contract-units');
    expect(units?.textContent).toBe('—');
    // No name-table lot sizes (100 for XAU, 100000 for FX).
    expect(screen.queryByText('1 XAUUSD')).toBeNull();
    expect(screen.queryByText('1 000 XAUUSD')).toBeNull();
  });

  it('renders raw prices (no guessed precision) when no broker digits are known', () => {
    useAppStore.getState().setTicks({
      TESTFIX: {
        symbol: 'TESTFIX',
        bid: 1.2345678,
        ask: 1.2346,
        spread: 0.0000322,
        timestamp: Date.now(),
      },
    });
    expect(() => render(
      <OrderPanelDialog
        isOpen
        onClose={vi.fn()}
        symbol="TESTFIX"
        currentPrice={{ bid: 1.2345678, ask: 1.2346 }}
        onSubmitOrder={vi.fn()}
      />,
    )).not.toThrow();

    // Header quote is the raw broker value: no 5-digit/2-digit default.
    expect(screen.getByText('1.2345678 / 1.2346')).not.toBeNull();
    expect(screen.getByLabelText('Bid 1.2345678, Ask 1.2346')).not.toBeNull();
    // The mocked live book (6 levels) is shown verbatim, unrounded.
    expect(screen.getAllByText('4173.23').length).toBeGreaterThan(0);
  });

  it('uses catalog digits over the tick payload for the header quote', () => {
    render(
      <OrderPanelDialog
        isOpen
        onClose={vi.fn()}
        symbol="XAUUSD"
        currentPrice={{ bid: 4173.23, ask: 4173.77 }}
        onSubmitOrder={vi.fn()}
        instruments={[{ symbol: 'xauusd', digits: 3 }]}
      />,
    );

    expect(screen.getByText('4 173.230 / 4 173.770')).not.toBeNull();
  });

  it('switches from Market to Buy Limit and Sell Limit via the Type selector', () => {
    const onSubmitOrder = vi.fn();
    render(
      <OrderPanelDialog
        isOpen
        onClose={vi.fn()}
        symbol="XAUUSD"
        currentPrice={{ bid: 4173.23, ask: 4173.77 }}
        onSubmitOrder={onSubmitOrder}
      />,
    );

    const typeSelect = screen.getByLabelText('Type') as HTMLSelectElement;
    expect(typeSelect.value).toBe('Market Execution');
    expect(typeSelect.selectedOptions[0]?.textContent).toBe('Market');

    fireEvent.change(typeSelect, { target: { value: 'Buy Limit' } });
    expect(typeSelect.value).toBe('Buy Limit');
    expect(screen.getByRole('dialog').getAttribute('data-side')).toBe('buy');

    const priceInput = screen.getByLabelText('Price') as HTMLInputElement;
    expect(priceInput.value).toBe('4173.77');

    fireEvent.change(priceInput, { target: { value: '4170.00' } });
    fireEvent.click(screen.getAllByRole<HTMLButtonElement>('button', { name: 'Buy' })[0]);
    expect(onSubmitOrder).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'buy',
        symbol: 'XAUUSD',
        volume: 0.01,
        orderType: 'Buy Limit',
        price: 4170,
        expiration: 'GTC',
      }),
    );
  });
});
