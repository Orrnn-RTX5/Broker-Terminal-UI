/**
 * Market Watch while the API is unreachable (for example a gateway restart).
 *
 * The panel shows one clear "Reconnecting to server…" state instead of the raw
 * transport error ("Failed to fetch") and an empty list, retries its loads
 * with a capped exponential backoff, and recovers on its own when the API
 * answers again. Errors that are not transport failures stay visible as
 * errors and are not retried by this loop.
 */
import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  brokerCatalogRows,
  getActiveMarketSnapshot,
  marketHooks,
  ResizeObserverStub,
  watchlistState,
} from '../layout/__tests__/MarketWatchPanel.testSupport';
import { useAppStore } from '../../store/useAppStore';
import { commitBrokerAccountSessionScope } from '../../services/brokerSession';
import { resetMarketWatchDisplayMetadataForTests } from '../../store/useMarketWatchDisplayMetadataStore';
import { MarketWatchPanel } from './MarketWatchPanel';

const SYMBOLS = ['XAUUSD', 'BTCUSD', 'EURUSD'];
const RECONNECTING = 'Reconnecting to server…';

const panel = () => (
  <MarketWatchPanel allSymbols={SYMBOLS} selectedSymbol="BTCUSD" onSymbolSelect={() => undefined} />
);

const advance = (ms: number) => act(() => { vi.advanceTimersByTime(ms); });

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal('ResizeObserver', ResizeObserverStub);
  commitBrokerAccountSessionScope({ authenticated: false, brokerId: 'test-broker', serverUrl: 'https://broker.test' });
  resetMarketWatchDisplayMetadataForTests();
  localStorage.removeItem('rtx5_hidden_symbols');
  act(() => {
    useAppStore.setState({ isAuthenticated: false });
    useAppStore.getState().setTicks({});
  });
  marketHooks.activeSymbols = [...SYMBOLS];
  marketHooks.instrumentSymbols = brokerCatalogRows(SYMBOLS);
  marketHooks.authorizedSymbols = [...SYMBOLS];
  marketHooks.authorizedInstruments = [];
  marketHooks.disabledSymbols = [];
  marketHooks.symbolsError = null;
  marketHooks.watchlistError = null;
  marketHooks.reloadActiveSymbols.mockClear();
  marketHooks.reloadInstruments.mockClear();
  marketHooks.reloadWatchlist.mockClear();
  marketHooks.useActiveMarketSymbols.mockReset();
  marketHooks.useActiveMarketSymbols.mockImplementation(getActiveMarketSnapshot);
  marketHooks.useLiveQuotes.mockReset();
  marketHooks.useLiveQuotes.mockReturnValue({ loading: false, error: null });
  watchlistState.watchlists = [];
  watchlistState.activeWatchlistId = '';
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  resetMarketWatchDisplayMetadataForTests();
  commitBrokerAccountSessionScope({ authenticated: false, brokerId: '', serverUrl: '' });
  marketHooks.symbolsError = null;
  marketHooks.watchlistError = null;
  marketHooks.useActiveMarketSymbols.mockImplementation(getActiveMarketSnapshot);
  marketHooks.useLiveQuotes.mockReturnValue({ loading: false, error: null });
});

describe('Market Watch unreachable API', () => {
  it('shows "Reconnecting to server…" instead of "Failed to fetch", retries with backoff, then recovers', () => {
    // Gateway down: the catalog and the feed status both fail at transport level.
    marketHooks.instrumentSymbols = [];
    marketHooks.activeSymbols = [];
    marketHooks.symbolsError = 'Failed to fetch';
    marketHooks.useActiveMarketSymbols.mockImplementation(() => ({
      ...getActiveMarketSnapshot(), symbols: [], error: 'Failed to fetch',
    }));

    const { rerender } = render(panel());

    expect(screen.getByRole('status', { name: RECONNECTING })).toHaveTextContent(RECONNECTING);
    expect(screen.queryByText('Failed to fetch')).not.toBeInTheDocument();
    expect(screen.queryByRole('alert', { name: 'Market Watch errors' })).not.toBeInTheDocument();

    // First retry after 1 s, the next one 2 s later (exponential backoff).
    expect(marketHooks.reloadInstruments).not.toHaveBeenCalled();
    advance(999);
    expect(marketHooks.reloadInstruments).not.toHaveBeenCalled();
    advance(1);
    expect(marketHooks.reloadInstruments).toHaveBeenCalledTimes(1);
    expect(marketHooks.reloadActiveSymbols).toHaveBeenCalledTimes(1);
    expect(marketHooks.reloadWatchlist).toHaveBeenCalledTimes(1);
    advance(1999);
    expect(marketHooks.reloadInstruments).toHaveBeenCalledTimes(1);
    advance(1);
    expect(marketHooks.reloadInstruments).toHaveBeenCalledTimes(2);

    // The API answers again: the next render has data and no transport error.
    marketHooks.instrumentSymbols = brokerCatalogRows(SYMBOLS);
    marketHooks.activeSymbols = [...SYMBOLS];
    marketHooks.symbolsError = null;
    marketHooks.useActiveMarketSymbols.mockImplementation(getActiveMarketSnapshot);
    rerender(panel());

    expect(screen.queryByRole('status', { name: RECONNECTING })).not.toBeInTheDocument();
    expect(screen.queryByRole('alert', { name: 'Market Watch errors' })).not.toBeInTheDocument();
    expect(screen.getByText('EURUSD')).toBeInTheDocument();
    advance(60_000);
    expect(marketHooks.reloadInstruments).toHaveBeenCalledTimes(2);
  });

  it('starts the backoff again from 1 s after a recovery and a new outage', () => {
    marketHooks.symbolsError = 'Failed to fetch';
    const { rerender } = render(panel());
    advance(1000);
    advance(2000);
    expect(marketHooks.reloadInstruments).toHaveBeenCalledTimes(2);

    marketHooks.symbolsError = null;
    rerender(panel());
    marketHooks.symbolsError = 'Failed to fetch';
    rerender(panel());

    advance(999);
    expect(marketHooks.reloadInstruments).toHaveBeenCalledTimes(2);
    advance(1);
    expect(marketHooks.reloadInstruments).toHaveBeenCalledTimes(3);
  });

  it('caps the backoff delay at 30 s', () => {
    marketHooks.symbolsError = 'Failed to fetch';
    render(panel());
    for (const delay of [1000, 2000, 4000, 8000, 16000, 30000, 30000]) advance(delay);
    expect(marketHooks.reloadInstruments).toHaveBeenCalledTimes(7);
    advance(29_999);
    expect(marketHooks.reloadInstruments).toHaveBeenCalledTimes(7);
    advance(1);
    expect(marketHooks.reloadInstruments).toHaveBeenCalledTimes(8);
  });

  it.each([
    'Failed to fetch',
    'NetworkError when attempting to fetch resource.',
    'Load failed',
    'Market data is temporarily unavailable. Retrying…',
  ])('treats the transport failure "%s" from the watchlist or catalog as reconnecting', (message) => {
    marketHooks.watchlistError = message;
    render(panel());
    expect(screen.getByRole('status', { name: RECONNECTING })).toBeInTheDocument();
    expect(screen.queryByText(message)).not.toBeInTheDocument();
    expect(screen.getByText('EURUSD')).toBeInTheDocument();
  });

  it('keeps non-transport errors visible and does not start the reconnect loop for them', () => {
    marketHooks.symbolsError = 'Broker API configuration error (BROKER_SCOPE_UNAVAILABLE): broker market-data scope is unavailable.';
    render(panel());

    expect(screen.getByRole('alert', { name: 'Market Watch errors' })).toHaveTextContent('BROKER_SCOPE_UNAVAILABLE');
    expect(screen.queryByRole('status', { name: RECONNECTING })).not.toBeInTheDocument();
    advance(60_000);
    expect(marketHooks.reloadInstruments).not.toHaveBeenCalled();
  });
});
