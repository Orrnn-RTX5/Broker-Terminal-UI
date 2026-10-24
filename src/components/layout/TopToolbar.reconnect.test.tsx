// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import type { ComponentProps } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { getTradeWebSocketClient } from '../../api/tradeSocket';
import { TopToolbar } from './TopToolbar';
import { chartDataService, ChartDataService } from '../../services/chartDataService';
import { refreshAllConnections } from '../../services/connectionRefresh';
import { getQuoteSocketManager } from '../../services/quoteSocketManager';

const toolbarProps = (
  onRefreshConnection?: () => void,
): ComponentProps<typeof TopToolbar> => ({
  chartType: 'candlestick',
  timeframe: 'M5',
  symbol: 'BTCUSD',
  onChartTypeChange: vi.fn(),
  onTimeframeChange: vi.fn(),
  onRefreshConnection,
  feedStatus: { symbols: [], loading: false, settled: true, current: true, error: null },
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('TopToolbar full reconnect (T12)', () => {
  it('does not render the Refresh connection toolbar icon button', () => {
    render(<TopToolbar {...toolbarProps(vi.fn())} />);

    expect(screen.queryByRole('button', { name: 'Refresh connection' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Refresh unavailable' })).toBeNull();
  });

  it('refreshAllConnections reconnects all transports', () => {
    const reconnectQuotes = vi
      .spyOn(getQuoteSocketManager(), 'reconnect')
      .mockImplementation(() => undefined);
    const refreshCharts = vi
      .spyOn(chartDataService, 'refreshCandleStreams')
      .mockImplementation(() => undefined);
    const connectTradeSocket = vi
      .spyOn(getTradeWebSocketClient(), 'connect')
      .mockImplementation(() => undefined);
    const reconnectTradeStream = vi.fn();
    const reloadMarketSnapshot = vi.fn();

    refreshAllConnections({ reconnectTradeStream, reloadMarketSnapshot });

    expect(reconnectTradeStream).toHaveBeenCalledTimes(1);
    expect(reconnectQuotes).toHaveBeenCalledTimes(1);
    expect(refreshCharts).toHaveBeenCalledTimes(1);
    expect(connectTradeSocket).toHaveBeenCalledTimes(1);
    expect(reloadMarketSnapshot).toHaveBeenCalledTimes(1);
  });

  it('chart refresh entry point is a safe no-op with no live streams', () => {
    expect(() => new ChartDataService().refreshCandleStreams()).not.toThrow();
  });

  it('a throwing trade-stream never blocks the other transports', () => {
    const reconnectQuotes = vi
      .spyOn(getQuoteSocketManager(), 'reconnect')
      .mockImplementation(() => undefined);
    const refreshCharts = vi
      .spyOn(chartDataService, 'refreshCandleStreams')
      .mockImplementation(() => undefined);
    const connectTradeSocket = vi
      .spyOn(getTradeWebSocketClient(), 'connect')
      .mockImplementation(() => undefined);
    const reconnectTradeStream = vi.fn(() => {
      throw new Error('trade stream down');
    });
    const reloadMarketSnapshot = vi.fn();

    expect(() =>
      refreshAllConnections({ reconnectTradeStream, reloadMarketSnapshot }),
    ).not.toThrow();

    expect(reconnectTradeStream).toHaveBeenCalledTimes(1);
    expect(reconnectQuotes).toHaveBeenCalledTimes(1);
    expect(refreshCharts).toHaveBeenCalledTimes(1);
    expect(connectTradeSocket).toHaveBeenCalledTimes(1);
    expect(reloadMarketSnapshot).toHaveBeenCalledTimes(1);
  });
});
