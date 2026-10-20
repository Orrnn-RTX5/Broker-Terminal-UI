import { act, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  getActiveMarketSnapshot,
  getRenderedRowSymbols,
  marketHooks,
  ResizeObserverStub,
  setMarketCatalog,
  watchlistState,
} from '../layout/__tests__/MarketWatchPanel.testSupport';
import { useAppStore } from '../../store/useAppStore';
import { commitBrokerAccountSessionScope } from '../../services/brokerSession';
import { resetMarketWatchDisplayMetadataForTests } from '../../store/useMarketWatchDisplayMetadataStore';
import { MarketWatchPanel } from './MarketWatchPanel';

// T11: Search Symbols "Show symbol" fires `watchlist:addSymbol` on window
// (MenuBar SymbolsDialog onShowSymbol). The Market Watch panel must route that
// event through the existing click-to-add search path (handleSelectSymbol) —
// no parallel add mechanism. Unknown symbols resolve to nothing and are
// ignored gracefully. Catalog-driven: works for any broker symbol.
describe('MarketWatchPanel watchlist:addSymbol (T11 Show symbol)', () => {
  const fireAddSymbol = (symbol: unknown) => {
    act(() => {
      window.dispatchEvent(new CustomEvent('watchlist:addSymbol', { detail: { symbol } }));
    });
  };

  beforeEach(() => {
    vi.useFakeTimers();
    commitBrokerAccountSessionScope({
      authenticated: false,
      brokerId: 'test-broker',
      serverUrl: 'https://broker.test',
    });
    resetMarketWatchDisplayMetadataForTests();
    localStorage.removeItem('rtx5_hidden_symbols');
    setMarketCatalog(['BTCUSD', 'ETHUSD']);
    marketHooks.activeSymbols = ['BTCUSD', 'ETHUSD'];
    marketHooks.activeSymbolsLoading = false;
    marketHooks.activeSymbolsSettled = true;
    marketHooks.activeSymbolsCurrent = true;
    marketHooks.instrumentsLoading = false;
    marketHooks.accountCatalogStatus = undefined;
    marketHooks.symbolsError = null;
    marketHooks.watchlistError = null;
    marketHooks.useActiveMarketSymbols.mockReset();
    marketHooks.useActiveMarketSymbols.mockImplementation(getActiveMarketSnapshot);
    marketHooks.useLiveQuotes.mockClear();
    marketHooks.useLiveQuotes.mockReturnValue({ loading: false, error: null });
    watchlistState.addSymbolToWatchlist.mockReset();
    watchlistState.removeSymbolFromWatchlist.mockReset();
    watchlistState.reorderSymbols.mockReset();
    // Mirror the real store: idempotent append into the active watchlist.
    watchlistState.addSymbolToWatchlist.mockImplementation((watchlistId: string, symbol: string) => {
      watchlistState.watchlists = watchlistState.watchlists.map((watchlist) => (
        watchlist.id === watchlistId && !watchlist.symbols.includes(symbol)
          ? { ...watchlist, symbols: [...watchlist.symbols, symbol] }
          : watchlist
      ));
    });
    act(() => {
      useAppStore.setState({ isAuthenticated: false });
      useAppStore.getState().setTicks({
        BTCUSD: { symbol: 'BTCUSD', bid: 65000, ask: 65001, spread: 1, timestamp: Date.now() },
        ETHUSD: { symbol: 'ETHUSD', bid: 3500, ask: 3501, spread: 1, timestamp: Date.now() },
      });
    });
    vi.stubGlobal('ResizeObserver', ResizeObserverStub);
  });

  afterEach(() => {
    act(() => {
      useAppStore.setState({ isAuthenticated: false });
      useAppStore.getState().setTicks({});
    });
    vi.unstubAllGlobals();
    resetMarketWatchDisplayMetadataForTests();
    commitBrokerAccountSessionScope({ authenticated: false, brokerId: '', serverUrl: '' });
    localStorage.removeItem('rtx5_hidden_symbols');
    vi.useRealTimers();
  });

  it('adds the event symbol through the shared click-to-add path on a custom watchlist', () => {
    watchlistState.activeWatchlistId = 'custom';
    watchlistState.watchlists = [{ id: 'custom', symbols: ['BTCUSD'], isDefault: false }];
    const onSymbolSelect = vi.fn();
    const { container } = render(
      <MarketWatchPanel allSymbols={['BTCUSD', 'ETHUSD']} selectedSymbol="BTCUSD" onSymbolSelect={onSymbolSelect} />,
    );
    expect(getRenderedRowSymbols(container)).toEqual(['BTCUSD']);

    fireAddSymbol('ETHUSD');

    // Shared path effects: persisted via the watchlist store, row visible,
    // and selected exactly like a search click.
    expect(watchlistState.addSymbolToWatchlist).toHaveBeenCalledWith('custom', 'ETHUSD');
    expect(getRenderedRowSymbols(container)).toEqual(['BTCUSD', 'ETHUSD']);
    expect(onSymbolSelect).toHaveBeenCalledWith('ETHUSD');
    expect(screen.getByText('ETHUSD')).toBeInTheDocument();
  });

  it('shows the event symbol on a built-in watchlist where the store-only add is invisible', () => {
    watchlistState.activeWatchlistId = 'majors';
    watchlistState.watchlists = [{ id: 'majors', symbols: [], isDefault: true }];
    const onSymbolSelect = vi.fn();
    const { container } = render(
      <MarketWatchPanel allSymbols={['BTCUSD', 'ETHUSD']} selectedSymbol="BTCUSD" onSymbolSelect={onSymbolSelect} />,
    );
    const before = getRenderedRowSymbols(container);
    expect(before).toContain('BTCUSD');
    expect(before).not.toContain('ETHUSD');

    fireAddSymbol('ethusd');

    // Built-in watchlists render manual symbols, not the persisted list, so
    // the store-only SymbolsDialog add alone is a NO-OP here. The listener
    // must make the symbol visible without touching the persisted list.
    expect(watchlistState.addSymbolToWatchlist).not.toHaveBeenCalled();
    expect(getRenderedRowSymbols(container)).toContain('ETHUSD');
    expect(onSymbolSelect).toHaveBeenCalledWith('ETHUSD');
  });

  it('ignores unknown symbols and malformed events gracefully', () => {
    watchlistState.activeWatchlistId = 'custom';
    watchlistState.watchlists = [{ id: 'custom', symbols: ['BTCUSD'], isDefault: false }];
    const onSymbolSelect = vi.fn();
    const { container } = render(
      <MarketWatchPanel allSymbols={['BTCUSD', 'ETHUSD']} selectedSymbol="BTCUSD" onSymbolSelect={onSymbolSelect} />,
    );
    const before = getRenderedRowSymbols(container);

    expect(() => {
      fireAddSymbol('NOPEXXXX');
      fireAddSymbol('');
      fireAddSymbol(undefined);
      window.dispatchEvent(new CustomEvent('watchlist:addSymbol', { detail: null }));
    }).not.toThrow();

    expect(watchlistState.addSymbolToWatchlist).not.toHaveBeenCalled();
    expect(onSymbolSelect).not.toHaveBeenCalled();
    expect(getRenderedRowSymbols(container)).toEqual(before);
  });
});
