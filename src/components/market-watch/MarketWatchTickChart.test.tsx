// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useAppStore } from '../../store/useAppStore';
import { type Tick, useMarketDataStore } from '../../store/useMarketDataStore';
import { MarketWatchTickChart } from './MarketWatchTickChart';
import { MARKET_WATCH_TICK_CHART_LIMIT } from './tickChartGeometry';

const apiGet = vi.hoisted(() => vi.fn());
vi.mock('../../api/client', () => ({ apiClient: { get: apiGet } }));

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

const tagLabel = (side: 'bid' | 'ask'): string | null | undefined => (
  screen.getByTestId(`market-tick-${side}-tag`).querySelector('text')?.textContent
);

describe('MarketWatchTickChart', () => {
  beforeEach(() => {
    apiGet.mockReset();
    apiGet.mockResolvedValue([]);
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
    expect(screen.queryByRole('img')).not.toBeInTheDocument();
    expect(apiGet).not.toHaveBeenCalled();
  });

  it('draws MT5 step lines for the newest ticks that fit the chart width', () => {
    const tickBuffer = Array.from({ length: MARKET_WATCH_TICK_CHART_LIMIT + 5 }, (_, index): Tick => ({
      symbol: 'EURUSD',
      bid: 1.1 + index / 100_000,
      ask: 1.1002 + index / 100_000,
      spread: 0.0002,
      timestamp: 1_700_000_000_000 + index * 25,
    }));
    setTickBuffer('EURUSD', tickBuffer);

    const { container } = render(
      <MarketWatchTickChart symbol="eurusd" instrumentSources={[{ symbol: 'EURUSD', digits: 5 }]} />,
    );
    const chart = container.querySelector('svg[data-tick-count]');
    const visibleCount = Number(chart?.getAttribute('data-tick-count'));

    expect(visibleCount).toBeGreaterThan(1);
    expect(visibleCount).toBeLessThan(MARKET_WATCH_TICK_CHART_LIMIT);
    expect(screen.getByTestId('market-tick-bid-line')).toHaveAttribute('d', expect.stringMatching(/^M[\d.]+ [\d.]+(H[\d.]+V[\d.]+)+H[\d.]+$/));
    expect(screen.getByTestId('market-tick-ask-line')).toHaveAttribute('d', expect.stringMatching(/^M[\d.]+ [\d.]+(H[\d.]+V[\d.]+)+H[\d.]+$/));
    expect(tagLabel('bid')).toBe('1.12004');
    expect(tagLabel('ask')).toBe('1.12024');
    expect(screen.getByRole('img', { name: new RegExp(`EURUSD live tick chart with ${visibleCount} recent broker quotes`) }))
      .toBeInTheDocument();
    expect(container.querySelector('.rtx-market-tick-chart__symbol')).toHaveTextContent('EURUSD');
    expect(container.querySelector('.rtx-market-tick-chart__axis')?.textContent).toMatch(/2023\.11\.14/);
  });

  it('formats prices with the backend digits, or as sent when the backend has none', () => {
    setTickBuffer('COCOA', [{
      symbol: 'COCOA',
      bid: 321.25,
      ask: 321.5,
      spread: 0.25,
      timestamp: 1_700_000_000_999,
      sourceTimestamp: 1_700_000_000_042,
    }]);

    const { rerender } = render(
      <MarketWatchTickChart symbol="COCOA" instrumentSources={[{ symbol: 'COCOA', digits: 2 }]} />,
    );
    expect(tagLabel('bid')).toBe('321.25');
    expect(tagLabel('ask')).toBe('321.50');

    rerender(<MarketWatchTickChart symbol="COCOA" instrumentSources={[{ symbol: 'COCOA' }]} />);
    expect(tagLabel('ask')).toBe('321.5');
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

  it('puts backend tick history before the live ticks of this session', async () => {
    apiGet.mockResolvedValue([
      { symbol: 'XAUUSD', bid: 4126.2, ask: 4126.6, time: 1_790_000_000 },
      { symbol: 'XAUUSD', bid: 4126.3, ask: 4126.7, time: 1_790_000_001 },
      // Overlaps the live buffer, which stays authoritative.
      { symbol: 'XAUUSD', bid: 9999, ask: 9999.4, time: 1_790_000_005 },
    ]);
    setTickBuffer('XAUUSD', [{
      symbol: 'XAUUSD',
      bid: 4127.43,
      ask: 4127.82,
      spread: 0.39,
      timestamp: 1_790_000_002_000,
    }]);

    const { container } = render(
      <MarketWatchTickChart
        symbol="XAUUSD"
        historyScopeKey="authenticated|1|broker|https://broker.test"
        instrumentSources={[{ symbol: 'XAUUSD', digits: 2 }]}
      />,
    );
    await act(async () => {
      await Promise.resolve();
    });

    expect(apiGet).toHaveBeenCalledWith('/ticks/XAUUSD', expect.objectContaining({
      params: { limit: MARKET_WATCH_TICK_CHART_LIMIT },
      signal: expect.any(AbortSignal),
    }));
    expect(container.querySelector('svg[data-tick-count]')).toHaveAttribute('data-tick-count', '3');
    expect(tagLabel('bid')).toBe('4127.43');
    expect(tagLabel('ask')).toBe('4127.82');
    expect(container.querySelector('.rtx-market-tick-chart__axis')?.textContent).not.toMatch(/9999/);
  });

  it('renders MT5 crosshair lines, Bid / Ask quote pill, and axis tags on hover', () => {
    setTickBuffer('EURUSD', [
      {
        symbol: 'EURUSD',
        bid: 1.11915,
        ask: 1.11916,
        spread: 0.00001,
        timestamp: Date.UTC(2026, 9, 14, 13, 12, 20),
      },
      {
        symbol: 'EURUSD',
        bid: 1.11920,
        ask: 1.11921,
        spread: 0.00001,
        timestamp: Date.UTC(2026, 9, 14, 13, 12, 21),
      },
      {
        symbol: 'EURUSD',
        bid: 1.11925,
        ask: 1.11927,
        spread: 0.00002,
        timestamp: Date.UTC(2026, 9, 14, 13, 12, 22),
      },
    ]);

    const { container } = render(
      <MarketWatchTickChart symbol="EURUSD" instrumentSources={[{ symbol: 'EURUSD', digits: 5 }]} />,
    );
    const svg = container.querySelector('svg[data-tick-count]')!;
    expect(screen.queryByTestId('market-tick-crosshair')).not.toBeInTheDocument();

    fireEvent.mouseMove(svg, { clientX: 120, clientY: 110 });
    expect(screen.getByTestId('market-tick-crosshair')).toBeInTheDocument();
    expect(screen.getByTestId('market-tick-crosshair-x')).toBeInTheDocument();
    expect(screen.getByTestId('market-tick-crosshair-y')).toBeInTheDocument();
    expect(screen.getByTestId('market-tick-crosshair-pill').textContent).toBe('1.11920 / 1.11921');
    expect(screen.getByTestId('market-tick-crosshair-price-tag').textContent).toMatch(/^1\.119\d\d$/);
    expect(screen.getByTestId('market-tick-crosshair-time-tag').textContent).toMatch(/^2026\.10\.14 \d{2}:\d{2}:21$/);

    fireEvent.mouseLeave(svg);
    expect(screen.queryByTestId('market-tick-crosshair')).not.toBeInTheDocument();
  });
});

