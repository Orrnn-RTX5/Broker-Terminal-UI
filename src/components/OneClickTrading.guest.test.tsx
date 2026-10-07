// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { TRADING_AUTH_REQUEST_EVENT, type TradingAuthIntent } from '../services/tradingAuthGate';
import { useAppStore } from '../store/useAppStore';
import { normalizeMarketStatus } from '../utils/marketStatus';
import { OneClickTrading } from './OneClickTrading';

const mocks = vi.hoisted(() => ({ placeMarketOrder: vi.fn() }));

vi.mock('../services/api', () => {
  const api = { orders: { placeMarketOrder: mocks.placeMarketOrder } };
  return { api, default: api };
});

const button = (side: 'BUY' | 'SELL'): HTMLButtonElement => {
  const element = screen.getByText(side).closest('button');
  if (!(element instanceof HTMLButtonElement)) throw new Error(`Expected ${side} button`);
  return element;
};

const renderGuest = ({
  tradeAllowed = false,
  status = 'closed',
  withQuote = true,
}: {
  tradeAllowed?: boolean;
  status?: 'open' | 'closed' | 'unavailable';
  withQuote?: boolean;
} = {}) => {
  if (withQuote) {
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
  }

  return render(
    <OneClickTrading
      symbol="EURUSD"
      timeframe="M5"
      visible
      tradeAllowed={tradeAllowed}
      marketStatus={status === 'unavailable'
        ? normalizeMarketStatus(null, { symbol: 'EURUSD' })
        : normalizeMarketStatus({ symbol: 'EURUSD', status })}
    />,
  );
};

describe('OneClickTrading guest authentication gate', () => {
  let intents: TradingAuthIntent[];
  let listener: EventListener;

  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    useAppStore.getState().reset();
    mocks.placeMarketOrder.mockReset();
    intents = [];
    listener = ((event: CustomEvent<TradingAuthIntent>) => intents.push(event.detail)) as EventListener;
    window.addEventListener(TRADING_AUTH_REQUEST_EVENT, listener);
  });

  afterEach(() => {
    window.removeEventListener(TRADING_AUTH_REQUEST_EVENT, listener);
    cleanup();
  });

  it.each([
    ['BUY', false, 'closed', true],
    ['SELL', false, 'unavailable', true],
    ['BUY', true, 'closed', true],
    ['SELL', true, 'open', false],
  ] as const)('requests central auth for %s before readiness checks', (side, tradeAllowed, status, withQuote) => {
    renderGuest({ tradeAllowed, status, withQuote });
    const initialQuoteStatus = screen.queryByText('Waiting for a valid bid/ask price');

    expect(button(side).disabled).toBe(false);
    expect(button(side).style.cursor).toBe('pointer');
    expect(button(side).style.opacity).toBe('1');
    fireEvent.click(button(side));

    expect(intents).toHaveLength(1);
    expect(intents[0]).toMatchObject({
      source: 'one-click-trading',
      side,
      symbol: 'EURUSD',
    });
    expect(mocks.placeMarketOrder).not.toHaveBeenCalled();
    expect(screen.queryByText('Trading is not enabled for this symbol')).toBeNull();
    expect(screen.queryByText('Waiting for a valid bid/ask price')).toBe(initialQuoteStatus);
  });

  it('supports keyboard activation for both guest trade controls', async () => {
    const user = userEvent.setup();
    renderGuest({ tradeAllowed: false, status: 'unavailable', withQuote: false });

    button('BUY').focus();
    await user.keyboard('{Enter}');
    button('SELL').focus();
    await user.keyboard(' ');

    expect(intents.map((intent) => intent.kind === 'mutation' ? null : intent.side)).toEqual(['BUY', 'SELL']);
    expect(mocks.placeMarketOrder).not.toHaveBeenCalled();
  });

  it('requests auth with invalid volume and performs no mutation side effects', () => {
    renderGuest({ tradeAllowed: true, status: 'open' });
    const volume = screen.getByRole('spinbutton');
    fireEvent.change(volume, { target: { value: '0' } });

    expect(button('BUY').disabled).toBe(false);
    fireEvent.click(button('BUY'));

    expect(intents).toHaveLength(1);
    expect(mocks.placeMarketOrder).not.toHaveBeenCalled();
    expect(screen.queryByText('Volume must be greater than zero')).toBeNull();
  });

  it('disables investor trading even for an open market without opening guest login', () => {
    useAppStore.getState().setAuthenticated(true, '10001', `header.${btoa(JSON.stringify({ investor: true }))}.signature`);
    renderGuest({ tradeAllowed: true, status: 'open' });
    expect(button('BUY')).toBeDisabled();
    expect(button('SELL')).toBeDisabled();
    expect(button('BUY').title).toContain('Read-only investor');
    expect(screen.getByRole('status')).toHaveTextContent('Read-only investor');
    fireEvent.click(button('BUY'));
    expect(intents).toHaveLength(0);
    expect(mocks.placeMarketOrder).not.toHaveBeenCalled();
  });

  it('keeps authenticated closed and disallowed trades blocked without API calls', () => {
    useAppStore.getState().setAuthenticated(
      true,
      '10001',
      'authenticated-test-token',
      'authenticated-test-refresh',
      Date.now() + 60_000,
    );
    renderGuest({ tradeAllowed: false, status: 'closed' });

    expect(button('BUY').disabled).toBe(true);
    expect(button('SELL').disabled).toBe(true);
    expect(button('BUY').style.cursor).toBe('not-allowed');
    expect(button('BUY').style.filter).toBe('brightness(0.78) saturate(0.75)');
    expect(intents).toHaveLength(0);
    expect(mocks.placeMarketOrder).not.toHaveBeenCalled();
  });
});
