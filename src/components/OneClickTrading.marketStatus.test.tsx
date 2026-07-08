// @vitest-environment jsdom

import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

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
