import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useAppStore } from '../../store/useAppStore';
import { MarketWatchPanel } from './MarketWatchPanel';

const DEFAULT_SYMBOLS = ['XAUUSD', 'BTCUSD', 'EURUSD', 'GBPUSD', 'USDJPY'];
const DEFAULT_DISPLAY_SYMBOLS = ['XAUUSD', 'BTCUSD', 'EURUSD', 'GBPUSD', 'USDJPY'];

const marketHooks = vi.hoisted(() => ({
  activeSymbols: ['BTCUSD', 'XAUUSD', 'GBPUSD', 'SOLUSD', 'EURUSD', 'ETHUSD', '0001.HK'],
  instrumentSymbols: ['BTCUSD', 'XAUUSD', 'GBPUSD', 'SOLUSD', 'EURUSD', 'ETHUSD', '0001.HK'],
  disabledSymbols: [] as string[],
  activeSymbolsLoading: false,
  activeSymbolsSettled: true,
  activeSymbolsCurrent: true,
  instrumentsLoading: false,
  symbolsError: null as string | null,
  watchlistError: null as string | null,
  reloadActiveSymbols: vi.fn().mockResolvedValue(undefined),
  useLiveQuotes: vi.fn((symbols: string[]) => {
    void symbols;
    return {
      loading: false,
      error: null as string | null,
    };
  }),
}));

vi.mock('../../hooks/useLiveMarketData', () => ({
  useActiveMarketSymbols: () => ({
    symbols: marketHooks.activeSymbols,
    loading: marketHooks.activeSymbolsLoading,
    settled: marketHooks.activeSymbolsSettled,
    current: marketHooks.activeSymbolsCurrent,
    error: null,
    reload: marketHooks.reloadActiveSymbols,
  }),
  useLiveQuotes: marketHooks.useLiveQuotes,
  useMarketInstruments: () => ({
    symbols: marketHooks.instrumentSymbols.map((symbol) => ({ symbol })),
    disabledSymbols: marketHooks.disabledSymbols,
    loading: marketHooks.instrumentsLoading,
    error: marketHooks.symbolsError,
    reload: vi.fn(),
  }),
  useRemoteWatchlistSync: () => ({
    loading: false,
    error: marketHooks.watchlistError,
    reload: vi.fn(),
  }),
}));

const watchlistState = vi.hoisted(() => ({
  watchlists: [] as Array<{ id: string; symbols: string[]; isDefault: boolean }>,
  activeWatchlistId: '',
  addSymbolToWatchlist: vi.fn(),
  removeSymbolFromWatchlist: vi.fn(),
  reorderSymbols: vi.fn(),
}));

vi.mock('../../store/useWatchlistStore', () => ({
  useWatchlistStore: Object.assign(
    (selector: (state: typeof watchlistState) => unknown) => selector(watchlistState),
    { getState: () => watchlistState },
  ),
}));

class ResizeObserverStub {
  observe(): void {}
  disconnect(): void {}
}

const getRenderedRowSymbols = (container: HTMLElement): string[] =>
  Array.from(container.querySelectorAll('tbody .rtx-market-watch__row'))
    .map((row) => row.querySelector('.rtx-market-watch__symbol')?.textContent ?? '');

describe('MarketWatchPanel symbol visibility', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    marketHooks.activeSymbols = [...DEFAULT_SYMBOLS, 'ETHUSD', '0001.HK'];
    marketHooks.instrumentSymbols = [...DEFAULT_SYMBOLS, 'ETHUSD', '0001.HK'];
    marketHooks.disabledSymbols = [];
    marketHooks.activeSymbolsLoading = false;
    marketHooks.activeSymbolsSettled = true;
    marketHooks.activeSymbolsCurrent = true;
    marketHooks.instrumentsLoading = false;
    marketHooks.symbolsError = null;
    marketHooks.watchlistError = null;
    marketHooks.reloadActiveSymbols.mockClear();
    watchlistState.watchlists = [];
    watchlistState.activeWatchlistId = '';
    watchlistState.addSymbolToWatchlist.mockClear();
    watchlistState.removeSymbolFromWatchlist.mockReset();
    watchlistState.reorderSymbols.mockReset();
    watchlistState.removeSymbolFromWatchlist.mockImplementation((watchlistId: string, symbol: string) => {
      watchlistState.watchlists = watchlistState.watchlists.map((watchlist) => (
        watchlist.id === watchlistId
          ? { ...watchlist, symbols: watchlist.symbols.filter((item) => item !== symbol) }
          : watchlist
      ));
    });
    watchlistState.reorderSymbols.mockImplementation((watchlistId: string, symbols: string[]) => {
      watchlistState.watchlists = watchlistState.watchlists.map((watchlist) => (
        watchlist.id === watchlistId ? { ...watchlist, symbols: [...symbols] } : watchlist
      ));
    });
    marketHooks.useLiveQuotes.mockClear();
    marketHooks.useLiveQuotes.mockReturnValue({ loading: false, error: null });
    act(() => {
      useAppStore.setState({ isAuthenticated: false });
      useAppStore.getState().setTicks({
        BTCUSD: { symbol: 'BTCUSD', bid: 65000, ask: 65001, spread: 1, timestamp: Date.now() },
        XAUUSD: { symbol: 'XAUUSD', bid: 2400, ask: 2400.2, spread: 0.2, timestamp: Date.now() },
        GBPUSD: { symbol: 'GBPUSD', bid: 1.3, ask: 1.3001, spread: 0.0001, timestamp: Date.now() },
        SOLUSD: { symbol: 'SOLUSD', bid: 180, ask: 180.1, spread: 0.1, timestamp: Date.now() },
        EURUSD: { symbol: 'EURUSD', bid: 1.1, ask: 1.1001, spread: 0.0001, timestamp: Date.now() },
        USDJPY: { symbol: 'USDJPY', bid: 157.1, ask: 157.11, spread: 0.01, timestamp: Date.now() },
        ETHUSD: { symbol: 'ETHUSD', bid: 3500, ask: 3501, spread: 1, timestamp: Date.now() },
        '0001.HK': { symbol: '0001.HK', bid: 71.11, ask: 71.16, spread: 0.05, timestamp: Date.now() },
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
    vi.useRealTimers();
  });

  it('uses the full SPREAD column heading', () => {
    const offsetWidthDescriptor = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'offsetWidth');
    Object.defineProperty(HTMLElement.prototype, 'offsetWidth', {
      configurable: true,
      get: () => 400,
    });

    try {
      render(
        <MarketWatchPanel
          allSymbols={DEFAULT_SYMBOLS}
          selectedSymbol="BTCUSD"
          onSymbolSelect={vi.fn()}
        />,
      );

      expect(screen.getByRole('columnheader', { name: 'SPREAD' })).toBeInTheDocument();
      expect(screen.queryByRole('columnheader', { name: 'SPRD' })).not.toBeInTheDocument();
    } finally {
      if (offsetWidthDescriptor) {
        Object.defineProperty(HTMLElement.prototype, 'offsetWidth', offsetWidthDescriptor);
      } else {
        delete (HTMLElement.prototype as Partial<HTMLElement>).offsetWidth;
      }
    }
  });

  it('keeps all five authorized defaults visible in product order when feed freshness is partial', () => {
    marketHooks.activeSymbols = ['GBPUSD', 'EURUSD'];
    const { container } = render(
      <MarketWatchPanel
        allSymbols={[...DEFAULT_SYMBOLS, 'ETHUSD', '0001.HK']}
        selectedSymbol="BTCUSD"
        onSymbolSelect={vi.fn()}
      />,
    );

    expect(getRenderedRowSymbols(container)).toEqual(DEFAULT_DISPLAY_SYMBOLS);
    expect(screen.queryByText('ETHUSD')).not.toBeInTheDocument();
    expect(screen.queryByText('0001.HK')).not.toBeInTheDocument();
    expect(marketHooks.useLiveQuotes).toHaveBeenLastCalledWith(DEFAULT_SYMBOLS);
    expect(screen.getByText('BTCUSD').closest('tr')).toHaveAttribute('aria-disabled', 'true');
    expect(screen.getByText('BTCUSD').closest('tr')).toHaveTextContent('STALE');
    expect(screen.getByText('BTCUSD').closest('tr')).toHaveTextContent('65000');
    expect(screen.getByText('GBPUSD').closest('tr')).toHaveAttribute('aria-disabled', 'false');
  });

  it('shows non-default symbols only after a non-empty Ctrl+U search', () => {
    marketHooks.activeSymbols = ['EURUSD'];
    render(
      <MarketWatchPanel
        allSymbols={[...DEFAULT_SYMBOLS, 'ETHUSD', '0001.HK']}
        selectedSymbol="BTCUSD"
        onSymbolSelect={vi.fn()}
      />,
    );

    fireEvent.keyDown(window, { key: 'u', ctrlKey: true });

    expect(screen.getByText('SEARCH RESULTS (0)')).toBeInTheDocument();
    expect(screen.getByText('Type to search…')).toBeInTheDocument();
    expect(screen.queryByText('0001.HK')).not.toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('Add symbol'), { target: { value: 'gbp' } });

    expect(screen.getByText('SEARCH RESULTS (1)')).toBeInTheDocument();
    expect(screen.getAllByText('GBPUSD')).toHaveLength(2);
    expect(screen.getByRole('option', { name: 'GBPUSD' })).toHaveAttribute('aria-disabled', 'false');
    expect(screen.queryByText('ETHUSD')).not.toBeInTheDocument();
  });

  it('does not allow Delete or search interactions to remove a locked default', () => {
    const onSymbolSelect = vi.fn();
    const { container } = render(
      <MarketWatchPanel
        allSymbols={DEFAULT_SYMBOLS}
        selectedSymbol="EURUSD"
        onSymbolSelect={onSymbolSelect}
      />,
    );

    fireEvent.keyDown(window, { key: 'Delete' });
    expect(getRenderedRowSymbols(container)).toEqual(DEFAULT_DISPLAY_SYMBOLS);

    const search = screen.getByRole('combobox', { name: 'Add symbol' });
    fireEvent.change(search, { target: { value: 'eur' } });
    fireEvent.keyDown(search, { key: 'ArrowDown' });
    fireEvent.keyDown(search, { key: 'Enter' });

    expect(onSymbolSelect).toHaveBeenCalledWith('EURUSD');
    expect(getRenderedRowSymbols(container)).toEqual(DEFAULT_DISPLAY_SYMBOLS);
    expect(screen.queryByText('Hide All')).not.toBeInTheDocument();
  });

  it('exposes keyboard-operable docked search results and a real footer button', () => {
    const onSymbolSelect = vi.fn();
    render(
      <MarketWatchPanel
        allSymbols={[...DEFAULT_SYMBOLS, 'ETHUSD']}
        selectedSymbol="BTCUSD"
        onSymbolSelect={onSymbolSelect}
      />,
    );

    const footerAction = screen.getByRole('button', { name: 'Focus symbol search' });
    const search = screen.getByRole('combobox', { name: 'Add symbol' });
    fireEvent.click(footerAction);
    expect(search).toHaveFocus();

    fireEvent.keyDown(window, { key: 'u', ctrlKey: true });
    fireEvent.change(search, { target: { value: 'eth' } });

    const listbox = screen.getByRole('listbox', { name: /SEARCH RESULTS/ });
    const option = screen.getByRole('option', { name: /ETHUSD/ });
    expect(search).toHaveAttribute('aria-expanded', 'true');
    expect(search).toHaveAttribute('aria-controls', listbox.id);

    fireEvent.keyDown(search, { key: 'ArrowDown' });
    expect(option).toHaveAttribute('aria-selected', 'true');
    expect(search).toHaveAttribute('aria-activedescendant', option.id);

    fireEvent.keyDown(search, { key: 'Enter' });
    expect(onSymbolSelect).toHaveBeenCalledWith('ETHUSD');
  });

  it('adds a searched symbol to the rows and quote subscriptions while opening its chart', () => {
    marketHooks.activeSymbols = [...DEFAULT_SYMBOLS];
    const onSymbolSelect = vi.fn();
    const openChartListener = vi.fn();
    window.addEventListener('openChart', openChartListener);
    const { container } = render(
      <MarketWatchPanel
        allSymbols={[...DEFAULT_SYMBOLS, 'ETHUSD']}
        selectedSymbol="BTCUSD"
        onSymbolSelect={onSymbolSelect}
      />,
    );

    fireEvent.change(screen.getByLabelText('Add symbol'), { target: { value: 'eth' } });
    fireEvent.click(screen.getByText('ETHUSD'));

    expect(onSymbolSelect).toHaveBeenCalledWith('ETHUSD');
    expect(openChartListener).toHaveBeenCalledWith(expect.objectContaining({
      detail: { symbol: 'ETHUSD', newTab: true },
    }));
    expect(getRenderedRowSymbols(container)).toEqual([...DEFAULT_DISPLAY_SYMBOLS, 'ETHUSD']);
    expect(screen.getByText('ETHUSD')).toBeInTheDocument();
    expect(marketHooks.useLiveQuotes).toHaveBeenLastCalledWith([...DEFAULT_SYMBOLS, 'ETHUSD']);
    expect(marketHooks.reloadActiveSymbols).toHaveBeenCalledOnce();

    window.removeEventListener('openChart', openChartListener);
  });

  it('displays EURUSD while routing search and chart events to canonical EURUSD', () => {
    const onSymbolSelect = vi.fn();
    const openChartListener = vi.fn();
    window.addEventListener('openChart', openChartListener);

    const { container } = render(
      <MarketWatchPanel
        allSymbols={DEFAULT_SYMBOLS}
        selectedSymbol="BTCUSD"
        onSymbolSelect={onSymbolSelect}
      />,
    );

    const search = screen.getByRole('combobox', { name: 'Add symbol' });
    fireEvent.change(search, { target: { value: 'eur' } });
    const option = screen.getByRole('option', { name: 'EURUSD' });
    fireEvent.click(option);

    expect(onSymbolSelect).toHaveBeenCalledWith('EURUSD');
    expect(openChartListener).toHaveBeenCalledWith(expect.objectContaining({
      detail: { symbol: 'EURUSD', newTab: true },
    }));
    expect(getRenderedRowSymbols(container)).toEqual(DEFAULT_DISPLAY_SYMBOLS);
    expect(screen.getByText('EURUSD')).toBeInTheDocument();
    expect(screen.queryByText('EUROUSD')).not.toBeInTheDocument();
    expect(marketHooks.useLiveQuotes).toHaveBeenLastCalledWith(DEFAULT_SYMBOLS);

    window.removeEventListener('openChart', openChartListener);
  });

  it('displays EURUSD while preserving an EUROUSD-only broker identity', () => {
    const brokerSymbols = DEFAULT_SYMBOLS.map((symbol) => symbol === 'EURUSD' ? 'EUROUSD' : symbol);
    marketHooks.activeSymbols = brokerSymbols;
    marketHooks.instrumentSymbols = brokerSymbols;
    const onSymbolSelect = vi.fn();
    const openChartListener = vi.fn();
    window.addEventListener('openChart', openChartListener);

    render(
      <MarketWatchPanel
        allSymbols={brokerSymbols}
        selectedSymbol="BTCUSD"
        onSymbolSelect={onSymbolSelect}
      />,
    );

    const search = screen.getByRole('combobox', { name: 'Add symbol' });
    fireEvent.change(search, { target: { value: 'eur' } });
    fireEvent.click(screen.getByRole('option', { name: 'EURUSD' }));

    expect(onSymbolSelect).toHaveBeenCalledWith('EUROUSD');
    expect(openChartListener).toHaveBeenCalledWith(expect.objectContaining({
      detail: { symbol: 'EUROUSD', newTab: true },
    }));
    expect(screen.getByText('EURUSD')).toBeInTheDocument();
    expect(screen.queryByText('EUROUSD')).not.toBeInTheDocument();
    expect(marketHooks.useLiveQuotes).toHaveBeenLastCalledWith(brokerSymbols);

    window.removeEventListener('openChart', openChartListener);
  });

  it('keeps cached quotes visible but makes every symbol non-actionable when feed status fails', () => {
    marketHooks.activeSymbols = [...DEFAULT_SYMBOLS];
    marketHooks.activeSymbolsCurrent = false;

    const { container } = render(
      <MarketWatchPanel
        allSymbols={DEFAULT_SYMBOLS}
        selectedSymbol="BTCUSD"
        onSymbolSelect={vi.fn()}
      />,
    );

    const btcRow = screen.getByText('BTCUSD').closest('tr');
    expect(btcRow).toHaveAttribute('aria-disabled', 'true');
    expect(btcRow).toHaveTextContent('UNKNOWN');
    expect(btcRow).toHaveTextContent('65000');
    expect(container.querySelectorAll('tbody tr[aria-disabled="false"]')).toHaveLength(0);
  });

  it('labels rows as loading before feed status and the catalog settle', () => {
    marketHooks.activeSymbols = [...DEFAULT_SYMBOLS];
    marketHooks.activeSymbolsLoading = false;
    marketHooks.activeSymbolsSettled = false;
    marketHooks.activeSymbolsCurrent = false;
    marketHooks.instrumentSymbols = [];
    marketHooks.instrumentsLoading = true;

    const { container } = render(
      <MarketWatchPanel
        allSymbols={[]}
        selectedSymbol="BTCUSD"
        onSymbolSelect={vi.fn()}
      />,
    );

    expect(screen.getByText('BTCUSD').closest('tr')).toHaveTextContent('LOADING');
    expect(container.querySelectorAll('tbody tr[aria-disabled="false"]')).toHaveLength(0);
    expect(screen.queryByText('UNAVAILABLE')).not.toBeInTheDocument();
  });

  it('rejects typed symbols that are absent from the enabled broker catalog', () => {
    const onSymbolSelect = vi.fn();
    const openChartListener = vi.fn();
    window.addEventListener('openChart', openChartListener);
    render(
      <MarketWatchPanel
        allSymbols={DEFAULT_SYMBOLS}
        selectedSymbol="BTCUSD"
        onSymbolSelect={onSymbolSelect}
      />,
    );

    const search = screen.getByRole('combobox', { name: 'Add symbol' });
    fireEvent.change(search, { target: { value: 'AUDUSD' } });
    fireEvent.keyDown(search, { key: 'Enter' });

    expect(onSymbolSelect).not.toHaveBeenCalled();
    expect(openChartListener).not.toHaveBeenCalled();
    window.removeEventListener('openChart', openChartListener);
  });

  it('keeps quote-freshness failures visible in the panel error area', () => {
    marketHooks.useLiveQuotes.mockReturnValue({
      loading: false,
      error: 'Quote is stale for EURUSD',
    });

    render(
      <MarketWatchPanel
        allSymbols={DEFAULT_SYMBOLS}
        selectedSymbol="BTCUSD"
        onSymbolSelect={vi.fn()}
      />,
    );

    expect(screen.getByRole('alert', { name: 'Market Watch errors' })).toHaveTextContent('Quote is stale for EURUSD');
  });

  it('shows every distinct error during concurrent failures', () => {
    marketHooks.symbolsError = 'Failed to load symbols';
    marketHooks.watchlistError = 'Failed to load watchlist';
    marketHooks.useLiveQuotes.mockReturnValue({
      loading: false,
      error: 'Quote is stale for EURUSD',
    });

    render(
      <MarketWatchPanel
        allSymbols={DEFAULT_SYMBOLS}
        selectedSymbol="BTCUSD"
        onSymbolSelect={vi.fn()}
      />,
    );

    expect(screen.getByText('Failed to load symbols')).toBeInTheDocument();
    expect(screen.getByText('Failed to load watchlist')).toBeInTheDocument();
    expect(screen.getByText('Quote is stale for EURUSD')).toBeInTheDocument();
  });

  it('keeps unrelated quote errors visible', () => {
    marketHooks.useLiveQuotes.mockReturnValue({
      loading: false,
      error: 'Quote service is unavailable',
    });

    render(
      <MarketWatchPanel
        allSymbols={DEFAULT_SYMBOLS}
        selectedSymbol="BTCUSD"
        onSymbolSelect={vi.fn()}
      />,
    );

    expect(screen.getByText('Quote service is unavailable')).toBeInTheDocument();
  });

  it('keeps a disabled default visible with its cached price but non-actionable', () => {
    marketHooks.disabledSymbols = ['XAUUSD'];
    const onSymbolSelect = vi.fn();

    render(
      <MarketWatchPanel
        allSymbols={[...DEFAULT_SYMBOLS, 'ETHUSD']}
        selectedSymbol="BTCUSD"
        onSymbolSelect={onSymbolSelect}
      />,
    );

    const row = screen.getByText('XAUUSD').closest('tr');
    expect(row).toHaveAttribute('aria-disabled', 'true');
    expect(row).toHaveTextContent('UNAVAILABLE');
    expect(row).toHaveTextContent('2400');
    expect(marketHooks.useLiveQuotes).toHaveBeenLastCalledWith(
      DEFAULT_SYMBOLS.filter((symbol) => symbol !== 'XAUUSD'),
    );

    fireEvent.click(row!);
    expect(onSymbolSelect).toHaveBeenCalledWith('XAUUSD');
  });

  it('keeps a saved symbol visible with its last quote when the catalog no longer exposes it', () => {
    watchlistState.activeWatchlistId = 'majors';
    watchlistState.watchlists = [{ id: 'majors', symbols: ['ETHUSD'], isDefault: false }];
    marketHooks.instrumentSymbols = [...DEFAULT_SYMBOLS];
    marketHooks.activeSymbols = [...DEFAULT_SYMBOLS];
    const onSymbolSelect = vi.fn();

    render(
      <MarketWatchPanel
        allSymbols={DEFAULT_SYMBOLS}
        selectedSymbol="BTCUSD"
        onSymbolSelect={onSymbolSelect}
      />,
    );

    const row = screen.getByText('ETHUSD').closest('tr');
    expect(row).toHaveAttribute('aria-disabled', 'true');
    expect(row).toHaveTextContent('UNAVAILABLE');
    expect(row).toHaveTextContent('3500');
    fireEvent.click(row!);
    expect(onSymbolSelect).toHaveBeenCalledWith('ETHUSD');
  });

  it('renders and subscribes only the persisted symbols for a custom watchlist', () => {
    watchlistState.activeWatchlistId = 'custom';
    watchlistState.watchlists = [{ id: 'custom', symbols: ['ETHUSD'], isDefault: false }];

    const { container } = render(
      <MarketWatchPanel
        allSymbols={[...DEFAULT_SYMBOLS, 'ETHUSD']}
        selectedSymbol="ETHUSD"
        onSymbolSelect={vi.fn()}
      />,
    );

    expect(getRenderedRowSymbols(container)).toEqual(['ETHUSD']);
    expect(marketHooks.useLiveQuotes).toHaveBeenLastCalledWith(['ETHUSD']);
  });

  it('does not leak manual symbols across built-in and custom watchlist switches', () => {
    const props = {
      allSymbols: [...DEFAULT_SYMBOLS, 'ETHUSD', '0001.HK'],
      selectedSymbol: 'BTCUSD',
      onSymbolSelect: vi.fn(),
    };
    const { container, rerender } = render(<MarketWatchPanel {...props} />);

    fireEvent.change(screen.getByLabelText('Add symbol'), { target: { value: 'eth' } });
    fireEvent.click(screen.getByRole('option', { name: 'ETHUSD' }));
    expect(getRenderedRowSymbols(container)).toEqual([...DEFAULT_SYMBOLS, 'ETHUSD']);

    watchlistState.activeWatchlistId = 'custom';
    watchlistState.watchlists = [{ id: 'custom', symbols: ['0001.HK'], isDefault: false }];
    rerender(<MarketWatchPanel {...props} selectedSymbol="0001.HK" />);

    expect(getRenderedRowSymbols(container)).toEqual(['0001.HK']);
    expect(marketHooks.useLiveQuotes).toHaveBeenLastCalledWith(['0001.HK']);

    fireEvent.change(screen.getByLabelText('Add symbol'), { target: { value: 'eth' } });
    fireEvent.click(screen.getByRole('option', { name: 'ETHUSD' }));
    expect(getRenderedRowSymbols(container)).toEqual(['0001.HK', 'ETHUSD']);
    expect(watchlistState.addSymbolToWatchlist).toHaveBeenLastCalledWith('custom', 'ETHUSD');

    watchlistState.activeWatchlistId = 'majors';
    watchlistState.watchlists = [{ id: 'majors', symbols: [], isDefault: true }];
    rerender(<MarketWatchPanel {...props} />);

    expect(getRenderedRowSymbols(container)).toEqual(DEFAULT_DISPLAY_SYMBOLS);
    expect(marketHooks.useLiveQuotes).toHaveBeenLastCalledWith(DEFAULT_SYMBOLS);
  });

  it('removes a built-in watchlist manual symbol but keeps canonical defaults locked', () => {
    watchlistState.activeWatchlistId = 'majors';
    watchlistState.watchlists = [{ id: 'majors', symbols: [], isDefault: true }];
    const { container } = render(
      <MarketWatchPanel
        allSymbols={[...DEFAULT_SYMBOLS, 'ETHUSD']}
        selectedSymbol="BTCUSD"
        onSymbolSelect={vi.fn()}
      />,
    );

    fireEvent.change(screen.getByLabelText('Add symbol'), { target: { value: 'eth' } });
    fireEvent.click(screen.getByRole('option', { name: 'ETHUSD' }));
    expect(getRenderedRowSymbols(container)).toEqual([...DEFAULT_SYMBOLS, 'ETHUSD']);

    fireEvent.contextMenu(screen.getByText('ETHUSD').closest('tr')!);
    fireEvent.click(screen.getByText('Hide'));
    expect(getRenderedRowSymbols(container)).toEqual(DEFAULT_DISPLAY_SYMBOLS);
    expect(watchlistState.removeSymbolFromWatchlist).not.toHaveBeenCalled();

    fireEvent.contextMenu(screen.getByText('BTCUSD').closest('tr')!);
    expect(screen.getByText('Hide').closest('[role="menuitem"]')).toHaveAttribute('aria-disabled', 'true');
    fireEvent.keyDown(window, { key: 'Delete' });
    expect(getRenderedRowSymbols(container)).toEqual(DEFAULT_DISPLAY_SYMBOLS);
  });

  it('removes and persists custom-watchlist symbols through Hide and Hide All', () => {
    watchlistState.activeWatchlistId = 'custom';
    watchlistState.watchlists = [{
      id: 'custom',
      symbols: ['ETHUSD', '0001.HK'],
      isDefault: false,
    }];
    const { container } = render(
      <MarketWatchPanel
        allSymbols={[...DEFAULT_SYMBOLS, 'ETHUSD', '0001.HK']}
        selectedSymbol="ETHUSD"
        onSymbolSelect={vi.fn()}
      />,
    );

    fireEvent.contextMenu(screen.getByText('ETHUSD').closest('tr')!);
    fireEvent.click(screen.getByText('Hide'));
    expect(watchlistState.removeSymbolFromWatchlist).toHaveBeenCalledWith('custom', 'ETHUSD');
    expect(getRenderedRowSymbols(container)).toEqual(['0001.HK']);

    fireEvent.contextMenu(screen.getByText('0001.HK').closest('tr')!);
    fireEvent.click(screen.getByText('Hide All'));
    expect(watchlistState.reorderSymbols).toHaveBeenCalledWith('custom', []);
    expect(getRenderedRowSymbols(container)).toEqual([]);

    fireEvent.click(screen.getByRole('button', { name: 'Show all symbols' }));
    expect(watchlistState.reorderSymbols).toHaveBeenLastCalledWith(
      'custom',
      ['0001.HK', 'BTCUSD', 'ETHUSD', 'EURUSD', 'GBPUSD', 'USDJPY', 'XAUUSD'],
    );
    expect(getRenderedRowSymbols(container)).toEqual([
      '0001.HK',
      'BTCUSD',
      'ETHUSD',
      'EURUSD',
      'GBPUSD',
      'USDJPY',
      'XAUUSD',
    ]);
  });

  it('ignores the global Delete shortcut from editing controls', () => {
    watchlistState.activeWatchlistId = 'custom';
    watchlistState.watchlists = [{ id: 'custom', symbols: ['ETHUSD'], isDefault: false }];
    const { container } = render(
      <MarketWatchPanel
        allSymbols={[...DEFAULT_SYMBOLS, 'ETHUSD']}
        selectedSymbol="ETHUSD"
        onSymbolSelect={vi.fn()}
      />,
    );

    const textarea = document.createElement('textarea');
    const select = document.createElement('select');
    const editable = document.createElement('div');
    editable.setAttribute('contenteditable', 'true');
    container.append(textarea, select, editable);

    const editingTargets = [
      screen.getByRole('combobox', { name: 'Add symbol' }),
      textarea,
      select,
      editable,
    ];
    editingTargets.forEach((target) => fireEvent.keyDown(target, { key: 'Delete' }));

    expect(watchlistState.removeSymbolFromWatchlist).not.toHaveBeenCalled();
    expect(getRenderedRowSymbols(container)).toEqual(['ETHUSD']);

    fireEvent.keyDown(window, { key: 'Delete' });
    expect(watchlistState.removeSymbolFromWatchlist).toHaveBeenCalledWith('custom', 'ETHUSD');
  });

  it('does not restore SOLUSD from a persisted built-in default watchlist', () => {
    watchlistState.activeWatchlistId = 'majors';
    watchlistState.watchlists = [{
      id: 'majors',
      symbols: [...DEFAULT_SYMBOLS, 'SOLUSD'],
      isDefault: true,
    }];
    marketHooks.activeSymbols = [...DEFAULT_SYMBOLS, 'SOLUSD'];
    marketHooks.instrumentSymbols = [...DEFAULT_SYMBOLS, 'SOLUSD'];

    const { container } = render(
      <MarketWatchPanel
        allSymbols={[...DEFAULT_SYMBOLS, 'SOLUSD']}
        selectedSymbol="BTCUSD"
        onSymbolSelect={vi.fn()}
      />,
    );

    expect(getRenderedRowSymbols(container)).toEqual(DEFAULT_DISPLAY_SYMBOLS);
    expect(screen.queryByText('SOLUSD')).not.toBeInTheDocument();
    expect(marketHooks.useLiveQuotes).toHaveBeenLastCalledWith(DEFAULT_SYMBOLS);
  });

  it('subscribes public active defaults but keeps them non-actionable while the account catalog is empty', () => {
    marketHooks.activeSymbols = ['xauusd', 'BTCUSD', 'eurusd', 'GBPUSD', 'USDJPY', 'XAUUSD', '0001.HK'];
    marketHooks.instrumentSymbols = [];
    marketHooks.instrumentsLoading = true;

    const { container } = render(
      <MarketWatchPanel
        allSymbols={[]}
        selectedSymbol="BTCUSD"
        onSymbolSelect={vi.fn()}
      />,
    );

    expect(getRenderedRowSymbols(container)).toEqual(DEFAULT_DISPLAY_SYMBOLS);
    expect(screen.getByText('5 symbols')).toBeInTheDocument();
    expect(marketHooks.useLiveQuotes).toHaveBeenLastCalledWith(DEFAULT_SYMBOLS);
    expect(container.querySelectorAll('tbody tr[aria-disabled="true"]')).toHaveLength(5);

    fireEvent.change(screen.getByLabelText('Add symbol'), { target: { value: '0001' } });
    expect(screen.getByText('Loading…')).toBeInTheDocument();
  });

  it('does not subscribe unknown defaults when the unauthenticated public feed universe is empty', () => {
    marketHooks.activeSymbols = [];
    marketHooks.instrumentSymbols = [];
    marketHooks.instrumentsLoading = false;

    const { container } = render(
      <MarketWatchPanel
        allSymbols={[]}
        selectedSymbol="BTCUSD"
        onSymbolSelect={vi.fn()}
      />,
    );

    expect(getRenderedRowSymbols(container)).toEqual(DEFAULT_DISPLAY_SYMBOLS);
    expect(marketHooks.useLiveQuotes).toHaveBeenLastCalledWith([]);
    expect(container.querySelectorAll('tbody tr[aria-disabled="true"]')).toHaveLength(5);
  });

  it('does not use the public feed as an authenticated catalog fallback', () => {
    act(() => useAppStore.setState({ isAuthenticated: true }));
    marketHooks.activeSymbols = [...DEFAULT_SYMBOLS];
    marketHooks.instrumentSymbols = [];
    marketHooks.instrumentsLoading = true;

    const { container } = render(
      <MarketWatchPanel
        allSymbols={[]}
        selectedSymbol="BTCUSD"
        onSymbolSelect={vi.fn()}
      />,
    );

    expect(marketHooks.useLiveQuotes).toHaveBeenLastCalledWith([]);
    expect(container.querySelectorAll('tbody tr[aria-disabled="true"]')).toHaveLength(5);
  });
});
