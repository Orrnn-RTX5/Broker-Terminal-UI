import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  getActiveMarketSnapshot,
  getRenderedRowSymbols,
  marketHooks,
  ResizeObserverStub,
  setMarketCatalog,
  watchlistState,
} from './__tests__/MarketWatchPanel.testSupport';
import { useAppStore } from '../../store/useAppStore';
import { MarketWatchPanel } from './MarketWatchPanel';

describe('MarketWatchPanel logged-in account symbol universe', () => {
  beforeEach(() => {
    localStorage.removeItem('rtx5_hidden_symbols');
    marketHooks.activeSymbols = ['BTCUSD', 'XAUUSD', 'EURUSD', 'US30', 'ETHUSD'];
    marketHooks.disabledSymbols = [];
    marketHooks.activeSymbolsLoading = false;
    marketHooks.activeSymbolsSettled = true;
    marketHooks.activeSymbolsCurrent = true;
    marketHooks.instrumentsLoading = false;
    marketHooks.symbolsError = null;
    marketHooks.watchlistError = null;
    marketHooks.useActiveMarketSymbols.mockReset();
    marketHooks.useActiveMarketSymbols.mockImplementation(getActiveMarketSnapshot);
    marketHooks.useLiveQuotes.mockClear();
    marketHooks.useLiveQuotes.mockReturnValue({ loading: false, error: null });
    watchlistState.watchlists = [];
    watchlistState.activeWatchlistId = '';
    watchlistState.addSymbolToWatchlist.mockClear();
    watchlistState.removeSymbolFromWatchlist.mockReset();
    watchlistState.reorderSymbols.mockReset();
    act(() => {
      useAppStore.setState({ isAuthenticated: true });
      useAppStore.getState().setTicks({});
    });
    vi.stubGlobal('ResizeObserver', ResizeObserverStub);
  });

  afterEach(() => {
    marketHooks.accountCatalogStatus = undefined;
    act(() => {
      useAppStore.setState({ isAuthenticated: false });
    });
    vi.unstubAllGlobals();
  });

  const demandedSymbols = (): string[] => marketHooks.useLiveQuotes.mock.calls
    .flatMap(([symbols]) => symbols as string[]);

  it('mounts a bounded viewport while retaining all 561 logical quote subscriptions', () => {
    const symbols = Array.from({ length: 561 }, (_, index) => `SYMBOL${index}`);
    marketHooks.accountCatalogStatus = 'loaded';
    marketHooks.activeSymbols = symbols;
    setMarketCatalog(symbols);
    watchlistState.activeWatchlistId = 'large';
    watchlistState.watchlists = [{ id: 'large', symbols, isDefault: false }];
    const { container } = render(<MarketWatchPanel allSymbols={symbols} selectedSymbol={symbols[0]} onSymbolSelect={vi.fn()} />);
    expect(container.querySelectorAll('.rtx-market-watch__row').length).toBeLessThan(60);
    expect(marketHooks.useLiveQuotes).toHaveBeenLastCalledWith(symbols);
    expect(container.querySelector('table')).toHaveAttribute('aria-rowcount', '562');
    const viewport = container.querySelector('.rtx-market-watch__table')!;
    fireEvent.scroll(viewport, { target: { scrollTop: 20 * 561 } });
    expect(container.querySelector('[data-symbol="SYMBOL560"]')).toBeInTheDocument();
    expect(marketHooks.useLiveQuotes).toHaveBeenLastCalledWith(symbols);
  }, 30_000);

  it('shows a small account catalogue in full, in the backend order, by default', () => {
    marketHooks.accountCatalogStatus = 'loaded';
    setMarketCatalog(['US30', 'GBPUSD', 'XAUUSD', 'EURUSD']);

    const { container } = render(
      <MarketWatchPanel allSymbols={['US30', 'GBPUSD', 'XAUUSD', 'EURUSD']} selectedSymbol="XAUUSD" onSymbolSelect={vi.fn()} />,
    );

    expect(getRenderedRowSymbols(container)).toEqual(['US30', 'GBPUSD', 'XAUUSD', 'EURUSD']);
    demandedSymbols().forEach((symbol) => expect(['US30', 'GBPUSD', 'XAUUSD', 'EURUSD']).toContain(symbol));
  });

  it('filters saved watchlist rows outside the account catalogue without deleting them', () => {
    marketHooks.accountCatalogStatus = 'loaded';
    setMarketCatalog(['EURUSD', 'XAUUSD']);
    watchlistState.activeWatchlistId = 'custom';
    watchlistState.watchlists = [{ id: 'custom', symbols: ['BTCUSD', 'EURUSD', 'ETHUSD'], isDefault: false }];

    const { container } = render(
      <MarketWatchPanel allSymbols={['EURUSD', 'XAUUSD']} selectedSymbol="EURUSD" onSymbolSelect={vi.fn()} />,
    );

    expect(getRenderedRowSymbols(container)).toEqual(['EURUSD']);
    expect(demandedSymbols()).not.toContain('BTCUSD');
    expect(demandedSymbols()).not.toContain('ETHUSD');
    expect(watchlistState.reorderSymbols).not.toHaveBeenCalled();
    expect(watchlistState.removeSymbolFromWatchlist).not.toHaveBeenCalled();
    expect(watchlistState.watchlists[0].symbols).toEqual(['BTCUSD', 'EURUSD', 'ETHUSD']);
  });

  it('shows a loading state instead of any symbol while the account catalogue loads', () => {
    marketHooks.accountCatalogStatus = 'loading';
    marketHooks.instrumentsLoading = true;
    setMarketCatalog([]);
    watchlistState.activeWatchlistId = 'custom';
    watchlistState.watchlists = [{ id: 'custom', symbols: ['BTCUSD', 'EURUSD'], isDefault: false }];

    const { container } = render(
      <MarketWatchPanel allSymbols={[]} selectedSymbol="EURUSD" onSymbolSelect={vi.fn()} />,
    );

    expect(getRenderedRowSymbols(container)).toEqual([]);
    expect(screen.getByText('Loading symbols...')).toBeInTheDocument();
    expect(demandedSymbols()).toEqual([]);
  });

  it('keeps the public catalogue behaviour for guests', () => {
    act(() => {
      useAppStore.setState({ isAuthenticated: false });
    });
    marketHooks.accountCatalogStatus = 'none';
    setMarketCatalog(['BTCUSD', 'EURUSD']);
    watchlistState.activeWatchlistId = 'custom';
    watchlistState.watchlists = [{ id: 'custom', symbols: ['ETHUSD', 'EURUSD'], isDefault: false }];

    const { container } = render(
      <MarketWatchPanel allSymbols={['BTCUSD', 'EURUSD']} selectedSymbol="EURUSD" onSymbolSelect={vi.fn()} />,
    );

    expect(getRenderedRowSymbols(container)).toEqual(['ETHUSD', 'EURUSD']);
  });
});
