// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
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

  it('keeps the last BTCUSD M1 prices visible but disables trading when freshness denies the symbol', () => {
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
    expect(buyButton.disabled).toBe(true);
    expect(sellButton.disabled).toBe(true);
    expect(buyButton).toHaveAttribute('title', 'Live tradable quote unavailable - order not sent');
    expect(sellButton).toHaveAttribute('title', 'Live tradable quote unavailable - order not sent');
    expect(screen.getByText('Live tradable quote unavailable - order not sent')).toBeInTheDocument();
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

  it('clears an older stale-quote banner when a concurrent newer order fills', async () => {
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

    fireEvent.click(getTradeButton('BUY'));
    fireEvent.click(getTradeButton('SELL'));

    await act(async () => {
      rejectOlderOrder?.(Object.assign(new Error('Quote is stale for EURUSD'), { code: 'QUOTE_STALE' }));
    });
    expect(screen.getByText('Order failed: Quote is stale for EURUSD')).not.toBeNull();

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
  ] as const)('keeps prices visible but disables trading for %s status', (
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

    expect(getTradeButton('BUY').disabled).toBe(true);
    expect(getTradeButton('SELL').disabled).toBe(true);
    expect(screen.getByText('Market Closed')).not.toBeNull();
    expect(screen.getByText('BUY')).not.toBeNull();
    expect(screen.getByText('SELL')).not.toBeNull();
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

    expect(getTradeButton('BUY').disabled).toBe(true);
    expect(getTradeButton('SELL').disabled).toBe(true);
    expect(screen.getByText('Market Closed')).not.toBeNull();
    expect(screen.queryByText(/Market status unavailable/i)).toBeNull();
  });
});
