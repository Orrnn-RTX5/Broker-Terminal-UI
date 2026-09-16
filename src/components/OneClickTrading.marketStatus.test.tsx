// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const orderMocks = vi.hoisted(() => ({
  placeMarketOrder: vi.fn(),
}));

vi.mock('../services/api', () => ({
  default: { orders: { placeMarketOrder: orderMocks.placeMarketOrder } },
}));

import { useAppStore } from '../store/useAppStore';
import { normalizeMarketStatus, type KnownMarketStatus } from '../utils/marketStatus';
import { OneClickTrading } from './OneClickTrading';

const getTradeButton = (label: 'BUY' | 'SELL'): HTMLButtonElement => {
  const button = screen.getByText(label).closest('button');
  if (!(button instanceof HTMLButtonElement)) {
    throw new Error(`Expected ${label} button`);
  }
  return button;
};

describe('OneClickTrading market status', () => {
  beforeEach(() => {
    useAppStore.getState().reset();
    useAppStore.setState({ isAuthenticated: true, accountId: '200002' });
    orderMocks.placeMarketOrder.mockReset();
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
  });

  afterEach(() => {
    cleanup();
    document.documentElement.classList.remove('rtx-advanced-view', 'rtx-skin-untitled-light');
    vi.restoreAllMocks();
  });

  it('keeps BUY and SELL enabled when the market is open and prices are valid', () => {
    render(
      <OneClickTrading
        symbol="EURUSD"
        timeframe="M5"
        visible
        tradeAllowed
        marketStatus={normalizeMarketStatus({ symbol: 'EURUSD', status: 'open' })}
      />,
    );

    expect(getTradeButton('BUY').disabled).toBe(false);
    expect(getTradeButton('SELL').disabled).toBe(false);
  });

  it('renders the compact SELL, horizontal lot controls, BUY order and preserves the lot step', () => {
    render(
      <OneClickTrading
        symbol="EURUSD"
        timeframe="M5"
        visible
        tradeAllowed
        marketStatus={normalizeMarketStatus({ symbol: 'EURUSD', status: 'open' })}
      />,
    );

    const row = screen.getByTestId('one-click-trading-row');
    const volumeControl = screen.getByTestId('one-click-volume-control');
    const rowChildren = Array.from(row.children);
    const volumeChildren = Array.from(volumeControl.children);
    const decreaseButton = screen.getByRole('button', { name: 'Decrease lot size' });
    const increaseButton = screen.getByRole('button', { name: 'Increase lot size' });
    const volumeInput = screen.getByRole('spinbutton', { name: 'Lot size' });

    expect(row).toHaveStyle({ display: 'flex' });
    expect(row).toHaveStyle({ background: '#111827' });
    expect(volumeControl).toHaveStyle({ flexDirection: 'row' });
    expect(volumeInput).toHaveClass('rtx-oct-lot-input');
    expect(volumeInput.style.borderStyle).toBe('none');
    expect(volumeInput).toHaveStyle({ borderRadius: '0px', appearance: 'none' });
    expect(volumeInput).toHaveStyle({ background: 'transparent', outline: 'none' });
    expect(rowChildren[0]).toHaveAttribute('data-side', 'sell');
    expect(rowChildren[1]).toBe(volumeControl);
    expect(rowChildren[2]).toHaveAttribute('data-side', 'buy');
    expect(volumeChildren).toEqual([decreaseButton, volumeInput, increaseButton]);
    expect(rowChildren[0]).toHaveStyle({ width: 'auto', minWidth: '104px', height: '34px' });
    expect(rowChildren[0]).toHaveStyle({ opacity: '1' });
    expect((rowChildren[0] as HTMLElement).style.background).not.toContain('rgba');
    expect((rowChildren[2] as HTMLElement).style.background).not.toContain('rgba');
    expect((volumeControl as HTMLElement).style.background).not.toContain('rgba');
    expect((volumeControl as HTMLElement).style.background).toContain('linear-gradient');
    expect(volumeControl).toHaveStyle({ width: '110px', height: '34px' });
    expect(volumeInput).toHaveStyle({ width: '48px', height: '24px' });
    expect(volumeInput.style.background).not.toContain('rgba');

    expect(volumeInput).toHaveValue('0.01');
    fireEvent.click(increaseButton);
    expect(volumeInput).toHaveValue('0.02');
    fireEvent.click(decreaseButton);
    expect(volumeInput).toHaveValue('0.01');
    fireEvent.click(decreaseButton);
    expect(volumeInput).toHaveValue('0.01');
  });

  it('opens login for a guest BUY or SELL without sending any order', () => {
    useAppStore.setState({ isAuthenticated: false, accountId: null });
    const requestLogin = vi.fn();
    window.addEventListener('rtx:requestTradeLogin', requestLogin);
    render(<OneClickTrading symbol="EURUSD" timeframe="M5" visible tradeAllowed={false}
      marketStatus={normalizeMarketStatus({ symbol: 'EURUSD', status: 'open' })} />);
    fireEvent.click(getTradeButton('BUY'));
    fireEvent.click(getTradeButton('SELL'));
    expect(requestLogin).toHaveBeenCalledTimes(2);
    expect(orderMocks.placeMarketOrder).not.toHaveBeenCalled();
    window.removeEventListener('rtx:requestTradeLogin', requestLogin);
  });

  it('allows replacing the default lot with 1 or more without retaining the leading zero', async () => {
    const user = userEvent.setup();
    render(
      <OneClickTrading
        symbol="EURUSD"
        timeframe="M5"
        visible
        tradeAllowed
        marketStatus={normalizeMarketStatus({ symbol: 'EURUSD', status: 'open' })}
      />,
    );

    const volumeInput = screen.getByLabelText<HTMLInputElement>('Lot size');

    // FIX regression: the field must preserve the transient empty draft so a
    // trader can replace 0.01 character-by-character instead of being stuck at 0.x.
    await user.clear(volumeInput);
    expect(volumeInput.value).toBe('');
    expect(getTradeButton('BUY').disabled).toBe(false);
    expect(getTradeButton('SELL').disabled).toBe(false);

    await user.type(volumeInput, '1');
    expect(volumeInput.value).toBe('1');
    await user.tab();
    expect(volumeInput.value).toBe('1.00');

    await user.clear(volumeInput);
    await user.type(volumeInput, '1.25');
    expect(volumeInput.value).toBe('1.25');
    await user.tab();
    expect(volumeInput.value).toBe('1.25');
    expect(getTradeButton('BUY').disabled).toBe(false);
    expect(getTradeButton('SELL').disabled).toBe(false);
    expect(orderMocks.placeMarketOrder).not.toHaveBeenCalled();
  });

  it('uses the active broker symbol lot precision instead of forcing two decimals', async () => {
    const user = userEvent.setup();
    render(
      <OneClickTrading
        symbol="EURUSD"
        timeframe="M5"
        visible
        tradeAllowed
        minVolume={0.001}
        maxVolume={2}
        volumeStep={0.001}
        marketStatus={normalizeMarketStatus({ symbol: 'EURUSD', status: 'open' })}
      />,
    );

    const volumeInput = screen.getByLabelText<HTMLInputElement>('Lot size');
    expect(volumeInput.value).toBe('0.001');

    await user.clear(volumeInput);
    await user.type(volumeInput, '1.257');
    await user.tab();
    expect(volumeInput.value).toBe('1.257');

    await user.clear(volumeInput);
    await user.type(volumeInput, '3');
    await user.tab();
    expect(volumeInput.value).toBe('2.000');
    expect(orderMocks.placeMarketOrder).not.toHaveBeenCalled();
  });

  it('submits the committed keyboard-entered lot value', async () => {
    const user = userEvent.setup();
    useAppStore.setState({ isAuthenticated: true, accountId: '200002' });
    orderMocks.placeMarketOrder.mockReturnValue(new Promise(() => {}));

    render(
      <OneClickTrading
        symbol="EURUSD"
        timeframe="M5"
        visible
        tradeAllowed
        marketStatus={normalizeMarketStatus({ symbol: 'EURUSD', status: 'open' })}
      />,
    );

    const volumeInput = screen.getByLabelText<HTMLInputElement>('Lot size');
    await user.clear(volumeInput);
    await user.type(volumeInput, '1.25');
    await user.tab();
    await user.click(getTradeButton('BUY'));

    // FIX regression: execution must use the displayed draft's committed value,
    // never the stale 0.01 numeric state that existed before keyboard editing.
    expect(orderMocks.placeMarketOrder).toHaveBeenCalledWith({
      side: 'buy',
      symbol: 'EURUSD',
      volume: 1.25,
      login: 200002,
    }, { intentAtMs: expect.any(Number) });
  });

  it('uses the roomier OneClickTrading dimensions in advanced light mode', () => {
    document.documentElement.classList.add('rtx-advanced-view', 'rtx-skin-untitled-light');

    render(
      <OneClickTrading
        symbol="EURUSD"
        timeframe="M5"
        visible
        tradeAllowed
        marketStatus={normalizeMarketStatus({ symbol: 'EURUSD', status: 'open' })}
      />,
    );

    const row = screen.getByTestId('one-click-trading-row');
    const volumeControl = screen.getByTestId('one-click-volume-control');
    const rowChildren = Array.from(row.children);

    expect(rowChildren[0]).toHaveStyle({ width: 'auto', minWidth: '110px', height: '34px' });
    expect(volumeControl).toHaveStyle({ width: '114px', height: '34px' });
    expect(rowChildren[2]).toHaveStyle({ width: 'auto', minWidth: '110px', height: '34px' });
  });

  it('keeps stale prices and buttons visible, explains both blocked clicks in a popup, and sends no order', () => {
    useAppStore.getState().setTicks({
      BTCUSD: {
        symbol: 'BTCUSD',
        bid: 79890.57,
        ask: 79905.57,
        spread: 15,
        timestamp: Date.now() - 60_000,
        digits: 2,
      },
    });

    render(
      <OneClickTrading
        symbol="BTCUSD"
        timeframe="M1"
        visible
        tradeAllowed={false}
        marketStatus={normalizeMarketStatus({ symbol: 'BTCUSD', status: 'open' })}
      />,
    );

    const buyButton = getTradeButton('BUY');
    const sellButton = getTradeButton('SELL');
    expect(buyButton).toHaveTextContent('79905.57');
    expect(sellButton).toHaveTextContent('79890.57');
    expect(buyButton.disabled).toBe(false);
    expect(sellButton.disabled).toBe(false);
    expect(buyButton).toHaveStyle({ opacity: '1' });
    expect(sellButton).toHaveStyle({ opacity: '1' });
    expect(screen.queryByRole('alertdialog')).toBeNull();
    for (const button of [buyButton, sellButton]) {
      fireEvent.click(button);
      expect(screen.getByRole('alertdialog')).toHaveTextContent('Cannot place this trade because the quote for BTCUSD is stale. Please wait for a fresh quote and try again.');
      fireEvent.click(screen.getByRole('button', { name: 'OK' }));
      expect(screen.queryByRole('alertdialog')).toBeNull();
    }
    expect(orderMocks.placeMarketOrder).not.toHaveBeenCalled();
  });

  it.each([
    ['BUY', 'buy'],
    ['SELL', 'sell'],
  ] as const)('dispatches an open-market %s click immediately without an HTTP status preflight', (label, side) => {
    useAppStore.setState({ isAuthenticated: true, accountId: '200002' });
    orderMocks.placeMarketOrder.mockReturnValue(new Promise(() => {}));
    const fetchSpy = vi.spyOn(globalThis, 'fetch');

    render(
      <OneClickTrading
        symbol="EURUSD"
        timeframe="M5"
        visible
        tradeAllowed
        marketStatus={normalizeMarketStatus({ symbol: 'EURUSD', status: 'open' })}
      />,
    );

    fireEvent.click(getTradeButton(label));

    expect(orderMocks.placeMarketOrder).toHaveBeenCalledTimes(1);
    expect(orderMocks.placeMarketOrder).toHaveBeenCalledWith({
      side,
      symbol: 'EURUSD',
      volume: 0.01,
      login: 200002,
    }, { intentAtMs: expect.any(Number) });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('can dismiss a stale quote popup and submit after live trading recovers', () => {
    useAppStore.setState({ isAuthenticated: true, accountId: '200002' });
    orderMocks.placeMarketOrder.mockReturnValue(new Promise(() => {}));
    const props = { symbol: 'EURUSD', timeframe: 'M5', visible: true, marketStatus: normalizeMarketStatus({ symbol: 'EURUSD', status: 'open' }) };
    const view = render(<OneClickTrading {...props} tradeAllowed={false} />);
    fireEvent.click(getTradeButton('BUY'));
    expect(screen.getByRole('alertdialog')).toHaveTextContent('quote for EURUSD is stale');
    expect(orderMocks.placeMarketOrder).not.toHaveBeenCalled();
    fireEvent.keyDown(screen.getByRole('button', { name: 'OK' }), { key: 'Escape' });
    expect(screen.queryByRole('alertdialog')).toBeNull();
    view.rerender(<OneClickTrading {...props} tradeAllowed />);
    fireEvent.click(getTradeButton('BUY'));
    expect(orderMocks.placeMarketOrder).toHaveBeenCalledOnce();
  });

  it('shows missing quotes in a popup without sending an order or claiming the quote is stale', () => {
    useAppStore.getState().setTicks({});
    render(<OneClickTrading symbol="EURUSD" timeframe="M1" visible tradeAllowed={false} />);
    fireEvent.click(getTradeButton('SELL'));
    expect(screen.getByRole('alertdialog')).toHaveTextContent('No live quote is available for EURUSD');
    expect(orderMocks.placeMarketOrder).not.toHaveBeenCalled();
  });

  it('keeps BUY and SELL enabled and dispatches all 20 clicks while earlier fills are pending', () => {
    useAppStore.setState({ isAuthenticated: true, accountId: '200002' });
    orderMocks.placeMarketOrder.mockImplementation(() => new Promise(() => {}));

    render(
      <OneClickTrading
        symbol="EURUSD"
        timeframe="M5"
        visible
        tradeAllowed
        marketStatus={normalizeMarketStatus({ symbol: 'EURUSD', status: 'open' })}
      />,
    );

    const buyButton = getTradeButton('BUY');
    const sellButton = getTradeButton('SELL');

    for (let index = 0; index < 20; index += 1) {
      fireEvent.click(index % 2 === 0 ? buyButton : sellButton);
      expect(buyButton.disabled).toBe(false);
      expect(sellButton.disabled).toBe(false);
    }

    expect(orderMocks.placeMarketOrder).toHaveBeenCalledTimes(20);
    expect(orderMocks.placeMarketOrder.mock.calls.map(([order]) => order.side)).toEqual(
      Array.from({ length: 20 }, (_, index) => index % 2 === 0 ? 'buy' : 'sell'),
    );
    expect(buyButton.disabled).toBe(false);
    expect(sellButton.disabled).toBe(false);
  });

  it('shows a backend rejection below the controls and clears it when a newer order fills', async () => {
    useAppStore.setState({ isAuthenticated: true, accountId: '200002' });
    let rejectOlderOrder: ((reason: Error) => void) | undefined;
    let resolveNewerOrder: ((position: Record<string, never>) => void) | undefined;
    orderMocks.placeMarketOrder
      .mockImplementationOnce(() => new Promise((_resolve, reject) => {
        rejectOlderOrder = reject;
      }))
      .mockImplementationOnce(() => new Promise((resolve) => {
        resolveNewerOrder = resolve;
      }));

    render(
      <OneClickTrading
        symbol="EURUSD"
        timeframe="M5"
        visible
        tradeAllowed
        marketStatus={normalizeMarketStatus({ symbol: 'EURUSD', status: 'open' })}
      />,
    );

    const tradingRow = screen.getByTestId('one-click-trading-row');
    fireEvent.click(getTradeButton('BUY'));
    fireEvent.click(getTradeButton('SELL'));

    await act(async () => {
      rejectOlderOrder?.(Object.assign(new Error('Quote is stale for EURUSD'), { code: 'QUOTE_STALE' }));
    });
    const backendError = screen.getByText('Order failed: Quote is stale for EURUSD');
    expect(screen.getByRole('alertdialog')).toHaveTextContent('quote for EURUSD is stale');
    fireEvent.click(screen.getByRole('button', { name: 'OK' }));
    expect(tradingRow.nextElementSibling).toBe(backendError);

    await act(async () => {
      resolveNewerOrder?.({});
    });
    expect(screen.queryByText('Order failed: Quote is stale for EURUSD')).toBeNull();
    expect(getTradeButton('BUY').disabled).toBe(false);
    expect(getTradeButton('SELL').disabled).toBe(false);
  });

  it.each([
    ['closed'],
    ['pre_market'],
    ['after_hours'],
  ] as const)('keeps prices and buttons available but blocks submission for %s status', (
    status: Exclude<KnownMarketStatus, 'open'>,
  ) => {
    render(
      <OneClickTrading
        symbol="EURUSD"
        timeframe="M5"
        visible
        tradeAllowed
        marketStatus={normalizeMarketStatus({ symbol: 'EURUSD', status })}
      />,
    );

    expect(getTradeButton('BUY').disabled).toBe(false);
    expect(getTradeButton('SELL').disabled).toBe(false);
    expect(screen.getByText('Market Closed')).not.toBeNull();
    expect(screen.getByText('BUY')).not.toBeNull();
    expect(screen.getByText('SELL')).not.toBeNull();
    fireEvent.click(getTradeButton('BUY'));
    expect(screen.getByRole('alertdialog')).toHaveTextContent('the market for EURUSD is closed');
    expect(orderMocks.placeMarketOrder).not.toHaveBeenCalled();
  });

  it('keeps BTCUSD BUY and SELL clickable even if backend status says closed', () => {
    useAppStore.getState().setTicks({
      BTCUSD: {
        symbol: 'BTCUSD',
        bid: 77350,
        ask: 77365,
        spread: 15,
        timestamp: Date.now(),
        digits: 2,
      },
    });

    render(
      <OneClickTrading
        symbol="BTCUSD"
        timeframe="M5"
        visible
        tradeAllowed
        marketStatus={normalizeMarketStatus({ symbol: 'BTCUSD', status: 'closed' })}
      />,
    );

    expect(getTradeButton('BUY').disabled).toBe(false);
    expect(getTradeButton('SELL').disabled).toBe(false);
    expect(screen.queryByText('Market Closed')).toBeNull();
  });

  it('uses compact Market Closed copy when status is unavailable', () => {
    render(
      <OneClickTrading
        symbol="EURUSD"
        timeframe="M5"
        visible
        tradeAllowed
        marketStatus={normalizeMarketStatus(null, { symbol: 'EURUSD' })}
      />,
    );

    expect(getTradeButton('BUY').disabled).toBe(false);
    expect(getTradeButton('SELL').disabled).toBe(false);
    expect(screen.getByText('Market Closed')).not.toBeNull();
    expect(screen.queryByText(/Market status unavailable/i)).toBeNull();
  });
});
