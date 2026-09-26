// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { useAppStore } from '../../store/useAppStore';
import { type Tick, useMarketDataStore } from '../../store/useMarketDataStore';
import { MarketWatchTickChart } from './MarketWatchTickChart';
import { MARKET_WATCH_TICK_CHART_LIMIT } from './tickChartGeometry';

const setTickBuffer = (symbol: string, tickBuffer: Tick[]) => {
  useMarketDataStore.setState({
    symbolData: {
      [symbol]: {
        currentTick: tickBuffer.at(-1) ?? null,
        previousTick: tickBuffer.at(-2) ?? null,
        stats: null,
        ohlcv1m: [],
        ohlcv5m: [],
        ohlcv15m: [],
        ohlcv1h: [],
        tickBuffer,
        lastAggregation: 0,
      },
    },
  });
};

describe('MarketWatchTickChart', () => {
  beforeEach(() => {
    useMarketDataStore.getState().clearAllData();
    useAppStore.getState().setTicks({});
  });

  afterEach(() => {
    cleanup();
    useMarketDataStore.getState().clearAllData();
    useAppStore.getState().setTicks({});
  });

  it('shows an accessible empty state until the broker publishes ticks', () => {
    render(<MarketWatchTickChart symbol="EURUSD" />);

    expect(screen.getByRole('region', { name: 'EURUSD' })).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('Waiting for live ticks');
    expect(screen.queryByRole('img', { name: /live tick chart/i })).not.toBeInTheDocument();
    expect(screen.getByLabelText('Bid unavailable')).toBeInTheDocument();
    expect(screen.getByLabelText('Ask unavailable')).toBeInTheDocument();
  });

  it('draws real bid and ask paths from only the most recent 2,000 buffered ticks', () => {
    const tickBuffer = Array.from({ length: MARKET_WATCH_TICK_CHART_LIMIT + 5 }, (_, index): Tick => ({
      symbol: 'EURUSD',
      bid: 1.1 + index / 100_000,
      ask: 1.1002 + index / 100_000,
      spread: 0.0002,
      timestamp: 1_700_000_000_000 + index * 25,
    }));
    setTickBuffer('EURUSD', tickBuffer);

    const { container } = render(<MarketWatchTickChart symbol="eurusd" />);
    const chart = container.querySelector('svg[data-tick-count]');

    expect(chart).toHaveAttribute('data-tick-count', String(MARKET_WATCH_TICK_CHART_LIMIT));
    expect(screen.getByTestId('market-tick-bid-line')).toHaveAttribute('d', expect.stringMatching(/^M .+ L /));
    expect(screen.getByTestId('market-tick-ask-line')).toHaveAttribute('d', expect.stringMatching(/^M .+ L /));
    expect(screen.getByLabelText('Bid 1.12004')).toBeInTheDocument();
    expect(screen.getByLabelText('Ask 1.12024')).toBeInTheDocument();
    expect(screen.getByRole('img', { name: /2000 recent broker quotes/i })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Clear' }));
    expect(screen.getByRole('status')).toHaveTextContent('Waiting for live ticks');
  });

  it('uses authoritative source time and broker-provided price precision', () => {
    useAppStore.getState().setTicks({
      COCOA: {
        symbol: 'COCOA',
        bid: 321.25,
        ask: 321.5,
        spread: 0.25,
        timestamp: 1_700_000_000_999,
        digits: 2,
      },
    });
    setTickBuffer('COCOA', [{
      symbol: 'COCOA',
      bid: 321.25,
      ask: 321.5,
      spread: 0.25,
      timestamp: 1_700_000_000_999,
      sourceTimestamp: 1_700_000_000_042,
    }]);

    render(<MarketWatchTickChart symbol="COCOA" />);

    expect(screen.getByLabelText('Bid 321.25')).toBeInTheDocument();
    expect(screen.getByLabelText('Ask 321.50')).toBeInTheDocument();
  });

  it('ignores non-price rows instead of inventing chart values', () => {
    setTickBuffer('XAUUSD', [{
      symbol: 'XAUUSD',
      bid: 0,
      ask: Number.NaN,
      spread: 0,
      timestamp: Date.now(),
    }]);

    render(<MarketWatchTickChart symbol="XAUUSD" />);

    expect(screen.getByRole('status')).toHaveTextContent('Waiting for live ticks');
    expect(screen.queryByTestId('market-tick-bid-line')).not.toBeInTheDocument();
  });
});
