// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  placeMarketOrder: vi.fn(),
  marketClosed: false,
}));

vi.mock('../../services/api', () => ({
  default: { orders: { placeMarketOrder: mocks.placeMarketOrder } },
}));

vi.mock('../../hooks/useSymbolMarketStatus', async () => {
  const { normalizeMarketStatus } = await import('../../utils/marketStatus');
  return {
    useSymbolMarketStatus: (symbol: string) => normalizeMarketStatus({
      symbol,
      status: mocks.marketClosed ? 'closed' : 'open',
    }),
  };
});

import { useAppStore } from '../../store/useAppStore';
import { formatMarketWatchTime } from '../../utils/marketWatchView';
import { MarketWatchTradingView } from './MarketWatchTradingView';

describe('MarketWatchTradingView', () => {
  beforeEach(() => {
    useAppStore.getState().reset();
    useAppStore.setState({
      isAuthenticated: true,
      accountId: '10001',
      authToken: 'market-watch-trading-test-token',
      tokenExpiresAt: Date.now() + 60_000,
    });
    useAppStore.getState().setTicks({
      'EURUSD.RAW': {
        symbol: 'EURUSD.RAW', bid: 1.13025, ask: 1.13045, spread: 0.0002,
        digits: 5, timestamp: Date.now(), sourceTimestamp: 1_790_852_765_000,
      },
      EURUSD: {
        symbol: 'EURUSD', bid: 2.0001, ask: 2.0002, spread: 0.0001,
        digits: 5, timestamp: Date.now(),
      },
    });
    mocks.marketClosed = false;
    mocks.placeMarketOrder.mockReset();
    mocks.placeMarketOrder.mockResolvedValue({ ticket: 123, symbol: 'EURUSD.RAW' });
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('uses broker quote time and unavailable ranges without placing orders on mount', () => {
    render(<MarketWatchTradingView symbols={['EURUSD.RAW']} tradeSymbols={['EURUSD.RAW']} />);
    const card = screen.getByRole('article', { name: 'EURUSD.RAW Trading' });
    expect(card.querySelector('time')?.textContent).toBe(formatMarketWatchTime(1_790_852_765_000, false));
    expect(within(card).getByText('1.13025')).toBeInTheDocument();
    expect(within(card).getByText('1.13045')).toBeInTheDocument();
    const range = card.querySelector('dl');
    expect(range?.querySelectorAll('dd')[0].textContent).toBe('\u2014');
    expect(range?.querySelectorAll('dd')[2].textContent).toBe('\u2014');
    expect(mocks.placeMarketOrder).not.toHaveBeenCalled();
  });

  it('keeps quoted but ineligible symbols read-only, including distinct suffixes', () => {
    render(<MarketWatchTradingView symbols={['EURUSD', 'EURUSD.RAW']} tradeSymbols={['EURUSD.RAW']} />);
    const plain = screen.getByRole('article', { name: 'EURUSD Trading' });
    const suffixed = screen.getByRole('article', { name: 'EURUSD.RAW Trading' });
    expect(within(plain).getByText('BUY').closest('button')).toBeDisabled();
    expect(within(suffixed).getByText('BUY').closest('button')).not.toBeDisabled();
    fireEvent.click(within(plain).getByText('BUY').closest('button')!);
    expect(mocks.placeMarketOrder).not.toHaveBeenCalled();
  });

  it('retains the shared closed-market execution gate', () => {
    mocks.marketClosed = true;
    render(<MarketWatchTradingView symbols={['EURUSD.RAW']} tradeSymbols={['EURUSD.RAW']} />);
    const buy = screen.getByText('BUY').closest('button')!;
    const sell = screen.getByText('SELL').closest('button')!;
    expect(buy).toBeDisabled();
    expect(sell).toBeDisabled();
    fireEvent.click(buy);
    expect(mocks.placeMarketOrder).not.toHaveBeenCalled();
  });

  it('honors the account lot grid and submits only an explicit click through the shared transport', async () => {
    render(<MarketWatchTradingView
      symbols={['EURUSD.RAW']}
      tradeSymbols={['EURUSD.RAW']}
      instrumentCatalog={[
        { symbol: 'EURUSD.RAW', minVolume: 0.01, volumeStep: 0.01 },
        { symbol: 'EURUSD.RAW', minVolume: 0.001, maxVolume: 2, volumeStep: 0.001 },
      ]}
    />);
    const volume = screen.getByRole('spinbutton', { name: 'Lot size' });
    expect(volume).toHaveValue('0.001');
    fireEvent.click(screen.getByRole('button', { name: 'Increase lot size' }));
    expect(volume).toHaveValue('0.002');
    expect(mocks.placeMarketOrder).not.toHaveBeenCalled();
    fireEvent.click(screen.getByText('BUY').closest('button')!);
    await waitFor(() => expect(mocks.placeMarketOrder).toHaveBeenCalledTimes(1));
    expect(mocks.placeMarketOrder).toHaveBeenCalledWith({
      side: 'buy', symbol: 'EURUSD.RAW', volume: 0.002, login: 10001,
    }, expect.objectContaining({ intentAtMs: expect.any(Number) }));
  });

  it('never enables a catalog-disabled symbol or substitutes another symbol quote', () => {
    render(<MarketWatchTradingView
      symbols={['EURUSD.RAW', 'EURUSD.OTHER']}
      tradeSymbols={['EURUSD.RAW', 'EURUSD.OTHER']}
      instrumentCatalog={[{ symbol: 'EURUSD.RAW', tradingEnabled: false }]}
    />);
    const disabled = screen.getByRole('article', { name: 'EURUSD.RAW Trading' });
    const unavailable = screen.getByRole('article', { name: 'EURUSD.OTHER Trading' });
    expect(within(disabled).getByText('BUY').closest('button')).toBeDisabled();
    expect(unavailable).toHaveAttribute('data-has-quote', 'false');
    expect(within(unavailable).getByText('BUY').closest('button')).toBeDisabled();
    expect(unavailable.querySelector('time')?.textContent).toBe('\u2014');
    expect(unavailable.querySelectorAll('dd')[1].textContent).toBe('\u2014');
    expect(mocks.placeMarketOrder).not.toHaveBeenCalled();
  });
});
