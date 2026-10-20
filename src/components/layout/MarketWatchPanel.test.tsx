import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  brokerAccountScopeHook,
  brokerCatalogRows,
  closedDailyChangeHook,
  CORE_DEFAULT_SYMBOLS,
  DEFAULT_DISPLAY_SYMBOLS,
  DEFAULT_SYMBOLS,
  deferred,
  getActiveMarketSnapshot,
  getDetailValue,
  getRenderedRowSymbols,
  lastMarketWatchQuotesHook,
  marketHooks,
  ResizeObserverStub,
  setMarketCatalog,
  watchlistState,
  type MockMarketInstrument,
} from './__tests__/MarketWatchPanel.testSupport';
import { useAppStore } from '../../store/useAppStore';
import { useDockLayoutStore } from '../../store/useDockLayoutStore';
import { DockManager } from '../../services/dockManager';
import {
  MARKET_WATCH_EXPORT_HYDRATION_TIMEOUT_MS,
  MarketWatchPanel,
} from './MarketWatchPanel';
import { keyboardShortcutManager } from '../../services/keyboardShortcutManager';
import type { MarketWatchLastPrice } from '../../hooks/useLastMarketWatchQuotes';
import type { MarketWatchExportResult } from '../../utils/marketWatchExport';
import { commitBrokerAccountSessionScope } from '../../services/brokerSession';
import {
  publishMarketWatchDisplayMetadata,
  resetMarketWatchDisplayMetadataForTests,
} from '../../store/useMarketWatchDisplayMetadataStore';

// This panel suite verifies tab ownership and routing. Execution controls in
// the Trading body are covered by their own tests and must not place orders.
vi.mock('../market-watch/MarketWatchTradingView', () => ({
  MarketWatchTradingView: ({ symbols }: { symbols: readonly string[] }) => (
    <div role="region" aria-label="Market Watch Trading test view">{symbols.join(', ')}</div>
  ),
}));

describe('MarketWatchPanel symbol visibility', () => {
  it('releases symbol row focus when a chart canvas prevents pointer focus transfer', () => {
    const onSymbolSelect = vi.fn();
    render(
      <>
        <MarketWatchPanel allSymbols={DEFAULT_SYMBOLS} selectedSymbol="BTCUSD" onSymbolSelect={onSymbolSelect} />
        <canvas aria-label="Chart canvas" onPointerDown={(event) => event.preventDefault()} />
      </>,
    );
    const row = screen.getByText('BTCUSD').closest('tr')!;
    fireEvent.click(row);
    expect(row).toHaveFocus();
    expect(row).toHaveAttribute('aria-selected', 'true');
    onSymbolSelect.mockClear();

    fireEvent.pointerDown(screen.getByLabelText('Chart canvas'));

    expect(row).not.toHaveFocus();
    expect(row).toHaveAttribute('aria-selected', 'true');
    expect(onSymbolSelect).not.toHaveBeenCalled();
    act(() => row.focus());
    expect(row).toHaveFocus();
  });

  it('keeps row focus on its own cells and releases it on empty Market Watch space', () => {
    const { container } = render(
      <MarketWatchPanel allSymbols={DEFAULT_SYMBOLS} selectedSymbol="BTCUSD" onSymbolSelect={vi.fn()} />,
    );
    const row = screen.getByText('BTCUSD').closest('tr')!;
    fireEvent.click(row);
    fireEvent.pointerDown(within(row).getByText('BTCUSD'));
    expect(row).toHaveFocus();

    fireEvent.pointerDown(container.querySelector('.rtx-market-watch__table')!);

    expect(row).not.toHaveFocus();
    expect(row).toHaveAttribute('aria-selected', 'true');
  });

  beforeEach(() => {
    vi.useFakeTimers();
    commitBrokerAccountSessionScope({
      authenticated: false,
      brokerId: 'test-broker',
      serverUrl: 'https://broker.test',
    });
    resetMarketWatchDisplayMetadataForTests();
    localStorage.removeItem('rtx5_hidden_symbols');
    localStorage.removeItem('rtx5_marketwatch_cols');
    localStorage.removeItem('rtx5_marketwatch_options');
    localStorage.removeItem('rtx5_symbol_sets');
    localStorage.removeItem('rtx5_symbol_set_columns');
    marketHooks.activeSymbols = [...DEFAULT_SYMBOLS, 'ETHUSD', '0001.HK'];
    marketHooks.instrumentSymbols = brokerCatalogRows(DEFAULT_SYMBOLS);
    marketHooks.authorizedInstruments = [];
    marketHooks.authorizedSymbols = [...DEFAULT_SYMBOLS];
    marketHooks.disabledSymbols = [];
    marketHooks.activeSymbolsLoading = false;
    marketHooks.activeSymbolsSettled = true;
    marketHooks.activeSymbolsCurrent = true;
    marketHooks.instrumentsLoading = false;
    marketHooks.accountCatalogStatus = undefined;
    marketHooks.symbolsError = null;
    marketHooks.watchlistError = null;
    marketHooks.reloadActiveSymbols.mockClear();
    marketHooks.loadSymbolSpecification.mockReset();
    marketHooks.loadSymbolSpecification.mockResolvedValue(null);
    marketHooks.useActiveMarketSymbols.mockReset();
    marketHooks.useActiveMarketSymbols.mockImplementation(getActiveMarketSnapshot);
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
    closedDailyChangeHook.values.clear();
    closedDailyChangeHook.useHook.mockClear();
    closedDailyChangeHook.hydrate.mockReset();
    closedDailyChangeHook.hydrate.mockImplementation(async () => new Map(closedDailyChangeHook.values));
    lastMarketWatchQuotesHook.values.clear();
    lastMarketWatchQuotesHook.useHook.mockClear();
    lastMarketWatchQuotesHook.hydrate.mockReset();
    lastMarketWatchQuotesHook.hydrate.mockImplementation(async () => new Map(lastMarketWatchQuotesHook.values));
    brokerAccountScopeHook.value = 'authenticated|test-account|test-broker|https://broker.test';
    act(() => {
      useAppStore.setState({ isAuthenticated: false });
      useAppStore.getState().setTicks({
        BTCUSD: { symbol: 'BTCUSD', bid: 65000, ask: 65001, spread: 1, dailyChange: 0.19, timestamp: Date.now() },
        XAUUSD: { symbol: 'XAUUSD', bid: 2400, ask: 2400.2, spread: 0.2, dailyChange: -0.36, timestamp: Date.now() },
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
    resetMarketWatchDisplayMetadataForTests();
    commitBrokerAccountSessionScope({ authenticated: false, brokerId: '', serverUrl: '' });
    localStorage.removeItem('rtx5_hidden_symbols');
    localStorage.removeItem('rtx5_marketwatch_cols');
    localStorage.removeItem('rtx5_marketwatch_options');
    localStorage.removeItem('rtx5_symbol_sets');
    localStorage.removeItem('rtx5_symbol_set_columns');
    vi.useRealTimers();
  });

  it('renders Bid, Ask, and Daily Change without a Spread column in the normal dock width', () => {
    const offsetWidthDescriptor = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'offsetWidth');
    Object.defineProperty(HTMLElement.prototype, 'offsetWidth', {
      configurable: true,
      get: () => 379,
    });

    try {
      render(
        <MarketWatchPanel
          allSymbols={DEFAULT_SYMBOLS}
          selectedSymbol="BTCUSD"
          onSymbolSelect={vi.fn()}
        />,
      );

      expect(screen.getAllByRole('columnheader').map((header) => header.textContent)).toEqual([
        'Symbol',
        'Bid',
        'Ask',
        'Daily Change',
      ]);
      expect(screen.queryByRole('columnheader', { name: 'Spread' })).not.toBeInTheDocument();

      const btcCells = Array.from(screen.getByText('BTCUSD').closest('tr')!.querySelectorAll('td'));
      expect(btcCells.at(-1)).toHaveTextContent('+0.19%');

      const positiveChange = screen.getByText('+0.19%');
      const negativeChange = screen.getByText('-0.36%');
      expect(screen.queryByText('0.19%')).not.toBeInTheDocument();
      expect(positiveChange).toHaveClass('rtx-market-watch__daily--up');
      expect(positiveChange).toHaveStyle({ color: 'var(--color-quote-up)' });
      expect(negativeChange).toHaveClass('rtx-market-watch__daily--down');
      expect(negativeChange).toHaveStyle({ color: '#ff5858' });

      const missingDailyChange = screen.getByText('EURUSD').closest('tr')
        ?.querySelector('.rtx-market-watch__daily');
      expect(missingDailyChange).toHaveTextContent('—');
    } finally {
      if (offsetWidthDescriptor) {
        Object.defineProperty(HTMLElement.prototype, 'offsetWidth', offsetWidthDescriptor);
      } else {
        Reflect.deleteProperty(HTMLElement.prototype, 'offsetWidth');
      }
    }
  });

  it('shows the saved closing Change % for inactive non-crypto rows', async () => {
    const offsetWidthDescriptor = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'offsetWidth');
    Object.defineProperty(HTMLElement.prototype, 'offsetWidth', {
      configurable: true,
      get: () => 379,
    });

    marketHooks.activeSymbols = [];
    closedDailyChangeHook.values.set('XAUUSD', -0.42);
    closedDailyChangeHook.values.set('EURUSD', 0);
    act(() => {
      useAppStore.setState({ isAuthenticated: true });
      useAppStore.getState().setTicks({
        XAUUSD: { symbol: 'XAUUSD', bid: 4431.07, ask: 4431.24, spread: 0.17, timestamp: Date.now() },
        BTCUSD: { symbol: 'BTCUSD', bid: 79609.52, ask: 79624.52, spread: 15, timestamp: Date.now() },
        EURUSD: { symbol: 'EURUSD', bid: 1.1613, ask: 1.16132, spread: 0.00002, timestamp: Date.now() },
      });
    });

    try {
      render(
        <MarketWatchPanel
          allSymbols={DEFAULT_SYMBOLS}
          selectedSymbol="BTCUSD"
          onSymbolSelect={vi.fn()}
        />,
      );

      await act(async () => {
        await Promise.resolve();
      });
      const options = closedDailyChangeHook.useHook.mock.calls.at(-1)?.[0] as {
        symbols?: string[];
      } | undefined;
      expect(options?.symbols).toEqual(expect.arrayContaining(['XAUUSD', 'EURUSD']));
      expect(options?.symbols).not.toContain('BTCUSD');

      const inactiveXauRow = screen.getByText('XAUUSD').closest('tr');
      expect(inactiveXauRow?.querySelector('.rtx-market-watch__daily'))
        .toHaveTextContent('-0.42%');
      for (const valueSelector of [
        '.rtx-market-watch__price--bid',
        '.rtx-market-watch__price--ask',
        '.rtx-market-watch__daily',
      ]) {
        expect(inactiveXauRow?.querySelector(valueSelector)?.closest('td')).toHaveStyle({ opacity: '1' });
      }
      expect(screen.getByText('EURUSD').closest('tr')?.querySelector('.rtx-market-watch__daily'))
        .toHaveTextContent('0.00%');
      expect(screen.getByText('BTCUSD').closest('tr')?.querySelector('.rtx-market-watch__daily'))
        .toHaveTextContent('—');
    } finally {
      if (offsetWidthDescriptor) {
        Object.defineProperty(HTMLElement.prototype, 'offsetWidth', offsetWidthDescriptor);
      } else {
        Reflect.deleteProperty(HTMLElement.prototype, 'offsetWidth');
      }
    }
  });

  it('shows retained bid and ask without enabling New Order for an inactive symbol', () => {
    const width = vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockReturnValue(379);
    marketHooks.activeSymbols = [];
    const asOf = Date.parse('2026-09-18T21:59:00Z');
    lastMarketWatchQuotesHook.values.set('XAUUSD', { kind: 'quote', bid: 4385.2, ask: 4385.4, asOf });
    act(() => {
      useAppStore.setState({ isAuthenticated: true });
      useAppStore.getState().setTicks({});
    });

    try {
      render(<MarketWatchPanel allSymbols={DEFAULT_SYMBOLS} chartSymbols={DEFAULT_SYMBOLS} selectedSymbol="XAUUSD" onSymbolSelect={vi.fn()} />);
      const row = screen.getByText('XAUUSD').closest('tr')!;
      expect(row.querySelector('.rtx-market-watch__price--bid')).toHaveTextContent('4385.20');
      expect(row.querySelector('.rtx-market-watch__price--ask')).toHaveTextContent('4385.40');
      expect(row.querySelector('.rtx-market-watch__price--bid')?.closest('td')).toHaveAttribute('title', 'Last quote · Fri, 18 Sep 2026 21:59:00 UTC');
      expect(row).toHaveClass('rtx-market-watch__row--stale');
      expect(useAppStore.getState().ticks).toEqual({});
      fireEvent.contextMenu(row);
      expect(screen.getByText('New Order').closest('[role="menuitem"]')).toHaveAttribute('aria-disabled', 'true');
    } finally {
      width.mockRestore();
    }
  });

  it.each([379, 180])('keeps configured columns and aligns the numeric last close beneath Bid at width %i', (panelWidth) => {
    const width = vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockReturnValue(panelWidth);
    marketHooks.activeSymbols = [];
    lastMarketWatchQuotesHook.values.set('XAUUSD', {
      kind: 'close', close: 4385.2, asOf: Date.parse('2026-09-18T21:59:00Z'),
    });
    closedDailyChangeHook.values.set('XAUUSD', 1.75);
    act(() => {
      useAppStore.setState({ isAuthenticated: true });
      useAppStore.getState().setTicks({});
    });

    try {
      render(<MarketWatchPanel allSymbols={DEFAULT_SYMBOLS} selectedSymbol="XAUUSD" onSymbolSelect={vi.fn()} />);
      const row = screen.getByText('XAUUSD').closest('tr')!;
      const closeCell = row.querySelector('.rtx-market-watch__last-close')?.closest('td');
      const cells = within(row).getAllByRole('cell');
      expect(within(row).queryByText('Last close')).not.toBeInTheDocument();
      expect(cells[1]).toBe(closeCell);
      expect(closeCell).not.toHaveAttribute('colspan');
      expect(closeCell).toHaveAttribute('title', 'Last close · Fri, 18 Sep 2026 21:59:00 UTC');
      expect(closeCell).toHaveTextContent('4385.20');
      expect(row.querySelector('.rtx-market-watch__price--bid')).toBeNull();
      expect(cells).toHaveLength(4);
      const askPrice = row.querySelector('.rtx-market-watch__price--ask');
      expect(askPrice).toHaveClass('rtx-market-watch__price--empty');
      expect(askPrice).toHaveTextContent('\u2014');
      expect(askPrice?.closest('td')).toBe(cells[2]);
      expect(row.querySelector('.rtx-market-watch__daily')?.closest('td')).toBe(cells[3]);
      expect(row.querySelector('.rtx-market-watch__daily')).toHaveTextContent('1.75%');
      expect(row).toHaveClass('rtx-market-watch__row--stale');
      expect(useAppStore.getState().ticks).toEqual({});
    } finally {
      width.mockRestore();
    }
  });

  it('replaces a last close immediately when a usable current quote arrives', () => {
    const width = vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockReturnValue(379);
    lastMarketWatchQuotesHook.values.set('XAUUSD', { kind: 'close', close: 4385.2, asOf: Date.now() - 86_400_000 });
    act(() => {
      useAppStore.setState({ isAuthenticated: true });
      useAppStore.getState().setTicks({});
    });
    try {
      render(<MarketWatchPanel allSymbols={DEFAULT_SYMBOLS} selectedSymbol="XAUUSD" onSymbolSelect={vi.fn()} />);
      const row = screen.getByText('XAUUSD').closest('tr')!;
      expect(row.querySelector('.rtx-market-watch__last-close')).toHaveTextContent('4385.20');
      expect(within(row).queryByText('Last close')).not.toBeInTheDocument();
      act(() => useAppStore.getState().setTick('XAUUSD', {
        symbol: 'XAUUSD', bid: 4400.1, ask: 4400.3, spread: 0.2, timestamp: Date.now(),
      }));
      expect(row.querySelector('.rtx-market-watch__last-close')).toBeNull();
      expect(row.querySelector('.rtx-market-watch__price--bid')).toHaveTextContent('4400.10');
      expect(row.querySelector('.rtx-market-watch__price--ask')).toHaveTextContent('4400.30');
      expect(lastMarketWatchQuotesHook.useHook.mock.calls.at(-1)?.[0].symbols).not.toContain('XAUUSD');
    } finally {
      width.mockRestore();
    }
  });

  it('requests missing visible quotes independently of Change % and excludes crypto candles', () => {
    marketHooks.activeSymbols = ['EURUSD'];
    act(() => {
      useAppStore.setState({ isAuthenticated: true });
      useAppStore.getState().setTicks({
        XAUUSD: { symbol: 'XAUUSD', bid: 0, ask: 0, spread: 0, dailyChange: 1.75, timestamp: Date.now() },
      });
    });
    render(<MarketWatchPanel allSymbols={DEFAULT_SYMBOLS} selectedSymbol="XAUUSD" onSymbolSelect={vi.fn()} />);
    expect(lastMarketWatchQuotesHook.useHook.mock.calls.at(-1)?.[0]).toEqual({
      enabled: true,
      scopeKey: 'authenticated|test-account|test-broker|https://broker.test',
      symbols: CORE_DEFAULT_SYMBOLS,
      candleSymbols: ['XAUUSD'],
    });
    expect(closedDailyChangeHook.useHook.mock.calls.at(-1)?.[0].symbols).not.toContain('XAUUSD');
  });

  it('uses an anonymous broker scope for guest closed-market recovery without requesting crypto candles', () => {
    brokerAccountScopeHook.value = 'anonymous||orrnn|https://service.orrnn.test';
    marketHooks.activeSymbols = [];
    setMarketCatalog(['XAUUSD', 'BTCUSD']);
    act(() => {
      useAppStore.setState({ isAuthenticated: false });
      useAppStore.getState().setTicks({});
    });

    render(
      <MarketWatchPanel
        allSymbols={['XAUUSD', 'BTCUSD']}
        selectedSymbol="XAUUSD"
        onSymbolSelect={vi.fn()}
      />,
    );

    expect(lastMarketWatchQuotesHook.useHook.mock.calls.at(-1)?.[0]).toEqual({
      enabled: true,
      scopeKey: 'anonymous||orrnn|https://service.orrnn.test',
      symbols: ['XAUUSD', 'BTCUSD'],
      candleSymbols: ['XAUUSD'],
    });
    expect(closedDailyChangeHook.useHook.mock.calls.some(([options]) => {
      const request = options as { enabled?: boolean; scopeKey?: string; symbols?: string[] };
      return request.enabled === true
        && request.scopeKey === 'anonymous||orrnn|https://service.orrnn.test'
        && request.symbols?.includes('XAUUSD')
        && !request.symbols.includes('BTCUSD');
    })).toBe(true);
  });

  it.each([
    { now: '2026-09-18T12:00:00Z', expectedCandles: [] },
    { now: '2026-09-19T12:00:00Z', expectedCandles: ['XAUUSD', 'EURUSD'] },
  ])('limits missing-quote candle requests while feed status is unknown on $now', ({ now, expectedCandles }) => {
    vi.setSystemTime(new Date(now));
    marketHooks.activeSymbolsCurrent = false;
    marketHooks.activeSymbolsSettled = false;
    act(() => {
      useAppStore.setState({ isAuthenticated: true });
      useAppStore.getState().setTicks({});
    });
    render(<MarketWatchPanel allSymbols={DEFAULT_SYMBOLS} selectedSymbol="XAUUSD" onSymbolSelect={vi.fn()} />);
    expect(lastMarketWatchQuotesHook.useHook.mock.calls.at(-1)?.[0].candleSymbols).toEqual(expectedCandles);
  });

  it('exports displayed fallback quotes and labels a candle close without exporting it as an ask', async () => {
    marketHooks.activeSymbols = [];
    watchlistState.activeWatchlistId = 'export-all';
    watchlistState.watchlists = [{
      id: 'export-all',
      symbols: [...CORE_DEFAULT_SYMBOLS, 'GBPUSD'],
      isDefault: false,
    }];
    lastMarketWatchQuotesHook.values.set('XAUUSD', { kind: 'close', close: 4385.2, asOf: Date.now() - 86_400_000 });
    lastMarketWatchQuotesHook.values.set('EURUSD', { kind: 'quote', bid: 1.17, ask: 1.1702, asOf: Date.now() - 86_400_000 });
    lastMarketWatchQuotesHook.hydrate.mockResolvedValue(new Map([
      ['GBPUSD', { kind: 'quote', bid: 1.25, ask: 1.2502, asOf: Date.now() - 86_400_000 }],
    ]));
    closedDailyChangeHook.hydrate.mockResolvedValue(new Map([['GBPUSD', 0.5]]));
    act(() => {
      useAppStore.setState({ isAuthenticated: true });
      useAppStore.getState().setTicks({});
    });
    const originalClipboard = Object.getOwnPropertyDescriptor(navigator, 'clipboard');
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    try {
      render(<MarketWatchPanel allSymbols={DEFAULT_SYMBOLS} selectedSymbol="XAUUSD" onSymbolSelect={vi.fn()} />);
      fireEvent.contextMenu(screen.getByText('XAUUSD').closest('tr')!);
      fireEvent.click(screen.getByText('Export'));
      await vi.waitFor(() => expect(writeText).toHaveBeenCalledTimes(1));
      expect(writeText.mock.calls[0][0]).toContain('XAUUSD\tLast close: 4385.20\t-\t-');
      expect(writeText.mock.calls[0][0]).toContain('EURUSD\t1.17000\t1.17020\t-');
      expect(writeText.mock.calls[0][0]).toContain("GBPUSD\t1.25000\t1.25020\t'+0.50%");
      expect(lastMarketWatchQuotesHook.hydrate).toHaveBeenCalledWith(expect.objectContaining({
        symbols: expect.arrayContaining([...CORE_DEFAULT_SYMBOLS, 'GBPUSD']),
      }));
      expect(closedDailyChangeHook.hydrate).toHaveBeenCalledWith(expect.objectContaining({
        symbols: expect.arrayContaining(['XAUUSD', 'EURUSD', 'GBPUSD']),
      }));
    } finally {
      if (originalClipboard) Object.defineProperty(navigator, 'clipboard', originalClipboard);
      else delete (navigator as { clipboard?: unknown }).clipboard;
    }
  });

  it('cancels an in-flight export when the committed broker-account scope changes', async () => {
    commitBrokerAccountSessionScope({
      authenticated: true,
      accountId: 'test-account',
      brokerId: 'test-broker',
      serverUrl: 'https://broker.test',
    });
    const pendingPrices = deferred<ReadonlyMap<string, MarketWatchLastPrice>>();
    const pendingDailyChanges = deferred<ReadonlyMap<string, number>>();
    let priceSignal: AbortSignal | undefined;
    let dailySignal: AbortSignal | undefined;
    lastMarketWatchQuotesHook.hydrate.mockImplementation((options: { signal?: AbortSignal }) => {
      priceSignal = options.signal;
      return pendingPrices.promise;
    });
    closedDailyChangeHook.hydrate.mockImplementation((options: { signal?: AbortSignal }) => {
      dailySignal = options.signal;
      return pendingDailyChanges.promise;
    });
    marketHooks.activeSymbols = [];
    act(() => {
      useAppStore.setState({ isAuthenticated: true });
      useAppStore.getState().setTicks({});
    });
    const originalClipboard = Object.getOwnPropertyDescriptor(navigator, 'clipboard');
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });

    try {
      render(<MarketWatchPanel allSymbols={DEFAULT_SYMBOLS} selectedSymbol="XAUUSD" onSymbolSelect={vi.fn()} />);
      fireEvent.contextMenu(screen.getByText('XAUUSD').closest('tr')!);
      fireEvent.click(screen.getByText('Export'));
      expect(priceSignal?.aborted).toBe(false);
      expect(dailySignal?.aborted).toBe(false);

      act(() => {
        commitBrokerAccountSessionScope({
          authenticated: true,
          accountId: 'other-account',
          brokerId: 'test-broker',
          serverUrl: 'https://broker.test',
        });
      });
      await act(async () => { await Promise.resolve(); });

      expect(priceSignal?.aborted).toBe(true);
      expect(dailySignal?.aborted).toBe(true);
      expect(writeText).not.toHaveBeenCalled();
      pendingPrices.resolve(new Map([['XAUUSD', {
        kind: 'quote', bid: 1, ask: 2, asOf: Date.now(),
      }]]));
      pendingDailyChanges.resolve(new Map([['XAUUSD', 9]]));
      await act(async () => { await Promise.resolve(); });
      expect(writeText).not.toHaveBeenCalled();
    } finally {
      if (originalClipboard) Object.defineProperty(navigator, 'clipboard', originalClipboard);
      else delete (navigator as { clipboard?: unknown }).clipboard;
    }
  });

  it('cancels export hydration on unmount', async () => {
    const pendingPrices = deferred<ReadonlyMap<string, MarketWatchLastPrice>>();
    const pendingDailyChanges = deferred<ReadonlyMap<string, number>>();
    let priceSignal: AbortSignal | undefined;
    let dailySignal: AbortSignal | undefined;
    lastMarketWatchQuotesHook.hydrate.mockImplementation((options: { signal?: AbortSignal }) => {
      priceSignal = options.signal;
      return pendingPrices.promise;
    });
    closedDailyChangeHook.hydrate.mockImplementation((options: { signal?: AbortSignal }) => {
      dailySignal = options.signal;
      return pendingDailyChanges.promise;
    });
    marketHooks.activeSymbols = [];
    act(() => {
      useAppStore.setState({ isAuthenticated: true });
      useAppStore.getState().setTicks({});
    });
    const originalClipboard = Object.getOwnPropertyDescriptor(navigator, 'clipboard');
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });

    try {
      const { unmount } = render(
        <MarketWatchPanel allSymbols={DEFAULT_SYMBOLS} selectedSymbol="XAUUSD" onSymbolSelect={vi.fn()} />,
      );
      fireEvent.contextMenu(screen.getByText('XAUUSD').closest('tr')!);
      fireEvent.click(screen.getByText('Export'));
      unmount();
      await act(async () => { await Promise.resolve(); });

      expect(priceSignal?.aborted).toBe(true);
      expect(dailySignal?.aborted).toBe(true);
      expect(writeText).not.toHaveBeenCalled();
      pendingPrices.resolve(new Map());
      pendingDailyChanges.resolve(new Map());
    } finally {
      if (originalClipboard) Object.defineProperty(navigator, 'clipboard', originalClipboard);
      else delete (navigator as { clipboard?: unknown }).clipboard;
    }
  });

  it('bounds export hydration time and exports the values already available', async () => {
    const pendingPrices = deferred<ReadonlyMap<string, MarketWatchLastPrice>>();
    const pendingDailyChanges = deferred<ReadonlyMap<string, number>>();
    let priceSignal: AbortSignal | undefined;
    let dailySignal: AbortSignal | undefined;
    lastMarketWatchQuotesHook.hydrate.mockImplementation((options: { signal?: AbortSignal }) => {
      priceSignal = options.signal;
      return pendingPrices.promise;
    });
    closedDailyChangeHook.hydrate.mockImplementation((options: { signal?: AbortSignal }) => {
      dailySignal = options.signal;
      return pendingDailyChanges.promise;
    });
    marketHooks.activeSymbols = [];
    act(() => {
      useAppStore.setState({ isAuthenticated: true });
      useAppStore.getState().setTicks({});
    });
    const originalClipboard = Object.getOwnPropertyDescriptor(navigator, 'clipboard');
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });

    try {
      render(<MarketWatchPanel allSymbols={DEFAULT_SYMBOLS} selectedSymbol="XAUUSD" onSymbolSelect={vi.fn()} />);
      fireEvent.contextMenu(screen.getByText('XAUUSD').closest('tr')!);
      fireEvent.click(screen.getByText('Export'));

      await act(async () => {
        vi.advanceTimersByTime(MARKET_WATCH_EXPORT_HYDRATION_TIMEOUT_MS);
        await Promise.resolve();
        await Promise.resolve();
      });

      expect(priceSignal?.aborted).toBe(true);
      expect(dailySignal?.aborted).toBe(true);
      expect(writeText).toHaveBeenCalledTimes(1);
      expect(String(writeText.mock.calls[0][0])).toContain('Symbol\tBid\tAsk\tChange %');
      pendingPrices.resolve(new Map());
      pendingDailyChanges.resolve(new Map());
    } finally {
      if (originalClipboard) Object.defineProperty(navigator, 'clipboard', originalClipboard);
      else delete (navigator as { clipboard?: unknown }).clipboard;
    }
  });

  it('uses independent MetaTrader direction hooks for bid, ask, and the row arrow', () => {
    const offsetWidthDescriptor = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'offsetWidth');
    Object.defineProperty(HTMLElement.prototype, 'offsetWidth', {
      configurable: true,
      get: () => 379,
    });

    act(() => {
      useAppStore.getState().setTicks({
        BTCUSD: {
          symbol: 'BTCUSD',
          bid: 65000,
          ask: 65001,
          spread: 1,
          dailyChange: 0.19,
          bidDirection: 'up',
          askDirection: 'down',
          timestamp: Date.now(),
        },
      });
    });

    try {
      render(
        <MarketWatchPanel
          allSymbols={['BTCUSD']}
          selectedSymbol="BTCUSD"
          onSymbolSelect={vi.fn()}
        />,
      );

      const row = screen.getByText('BTCUSD').closest('tr')!;
      const bidPrice = row.querySelector('.rtx-market-watch__price--bid');
      const askPrice = row.querySelector('.rtx-market-watch__price--ask');
      expect(bidPrice).toHaveClass('rtx-market-watch__price--up');
      expect(bidPrice).toHaveStyle({ color: 'var(--color-quote-up)' });
      expect(askPrice).toHaveClass('rtx-market-watch__price--down');
      expect(askPrice).toHaveStyle({ color: '#ff5858' });
      expect(row.querySelector('.rtx-market-watch__direction--up')).toBeInTheDocument();
      expect(row.style.borderBottomStyle).toBe('none');
    } finally {
      if (offsetWidthDescriptor) {
        Object.defineProperty(HTMLElement.prototype, 'offsetWidth', offsetWidthDescriptor);
      } else {
        Reflect.deleteProperty(HTMLElement.prototype, 'offsetWidth');
      }
    }
  });

  it('keeps Daily Change visible in a narrower dock and never shows Spread', () => {
    const offsetWidthDescriptor = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'offsetWidth');
    Object.defineProperty(HTMLElement.prototype, 'offsetWidth', {
      configurable: true,
      get: () => 320,
    });

    try {
      render(
        <MarketWatchPanel
          allSymbols={DEFAULT_SYMBOLS}
          selectedSymbol="BTCUSD"
          onSymbolSelect={vi.fn()}
        />,
      );

      expect(screen.getByRole('columnheader', { name: 'Daily Change' })).toBeInTheDocument();
      expect(screen.queryByRole('columnheader', { name: 'Spread' })).not.toBeInTheDocument();
    } finally {
      if (offsetWidthDescriptor) {
        Object.defineProperty(HTMLElement.prototype, 'offsetWidth', offsetWidthDescriptor);
      } else {
        Reflect.deleteProperty(HTMLElement.prototype, 'offsetWidth');
      }
    }
  });

  it('uses the compact reference typography for selected and unselected rows', () => {
    const offsetWidthDescriptor = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'offsetWidth');
    Object.defineProperty(HTMLElement.prototype, 'offsetWidth', {
      configurable: true,
      get: () => 379,
    });

    try {
      render(
        <MarketWatchPanel
          allSymbols={DEFAULT_SYMBOLS}
          selectedSymbol="BTCUSD"
          onSymbolSelect={vi.fn()}
        />,
      );

      expect(screen.getByText('BTCUSD')).toHaveStyle({ fontSize: '13px', fontWeight: '500' });
      expect(screen.getByText('XAUUSD')).toHaveStyle({ fontSize: '13px', fontWeight: '500' });
      expect(screen.getByText('BTCUSD')).toHaveStyle({ color: 'var(--text-primary)' });
      expect(screen.getByText('XAUUSD')).toHaveStyle({ color: 'var(--text-primary)' });
      expect(screen.getByRole('columnheader', { name: 'Symbol' })).toHaveClass('rtx-market-watch__column-heading--symbol');
      expect(screen.getByRole('columnheader', { name: 'Symbol' })).toHaveStyle({
        color: 'var(--text-primary)',
        fontSize: '12px',
        fontWeight: '400',
        textAlign: 'left',
        padding: '0 5px',
      });
      expect(screen.getByRole('columnheader', { name: 'Bid' })).toHaveStyle({ fontSize: '12px', fontWeight: '400', textAlign: 'right' });
      expect(screen.getByRole('columnheader', { name: 'Ask' })).toHaveStyle({ textAlign: 'right' });
      expect(screen.getByRole('columnheader', { name: 'Daily Change' })).toHaveStyle({ textAlign: 'right' });

      const selectedRow = screen.getByText('BTCUSD').closest('tr')!;
      expect(selectedRow.querySelector('.rtx-market-watch__price--bid')?.closest('td')).toHaveStyle({ textAlign: 'center' });
      expect(selectedRow.querySelector('.rtx-market-watch__price--ask')?.closest('td')).toHaveStyle({ textAlign: 'center' });
      expect(selectedRow.querySelector('.rtx-market-watch__daily')?.closest('td')).toHaveStyle({ textAlign: 'center' });
      expect(selectedRow.querySelector('.rtx-market-watch__price--bid')).toHaveStyle({ fontSize: '13px', fontWeight: '500' });
      expect(selectedRow.querySelector('.rtx-market-watch__price--ask')).toHaveStyle({ fontSize: '13px', fontWeight: '500' });
      expect(selectedRow.querySelector('.rtx-market-watch__spread')).not.toBeInTheDocument();
      expect(selectedRow.querySelector('.rtx-market-watch__daily')).toHaveStyle({ fontSize: '13px', fontWeight: '500' });
      expect(selectedRow.querySelector('.price-big')).toBeInTheDocument();
    } finally {
      if (offsetWidthDescriptor) {
        Object.defineProperty(HTMLElement.prototype, 'offsetWidth', offsetWidthDescriptor);
      } else {
        Reflect.deleteProperty(HTMLElement.prototype, 'offsetWidth');
      }
    }
  });

  it('shows the requested Market Watch instruments with exactly two price decimals', () => {
    const precisionSymbols = ['JPN225', 'JPN225-F', 'WHEAT', 'GOLD-PERP', 'NICKEL', 'EURUSD'];
    setMarketCatalog(precisionSymbols.map((symbol) => ({ symbol, digits: symbol === 'EURUSD' ? 5 : 2 })));
    marketHooks.activeSymbols = [...precisionSymbols];
    watchlistState.activeWatchlistId = 'precision';
    watchlistState.watchlists = [{
      id: 'precision',
      symbols: [...precisionSymbols],
      isDefault: false,
    }];
    act(() => {
      useAppStore.getState().setTicks({
        JPN225: { symbol: 'JPN225', bid: 64706.7, ask: 64714.7, spread: 8, timestamp: Date.now() },
        'JPN225-F': { symbol: 'JPN225-F', bid: 66229.5, ask: 66245.5, spread: 16, timestamp: Date.now() },
        WHEAT: { symbol: 'WHEAT', bid: 774.3, ask: 775.1, spread: 0.8, timestamp: Date.now() },
        'GOLD-PERP': { symbol: 'GOLD-PERP', bid: 4433.31, ask: 4433.65, spread: 0.34, timestamp: Date.now() },
        NICKEL: { symbol: 'NICKEL', bid: 16866.28, ask: 16884.22, spread: 17.94, timestamp: Date.now() },
        EURUSD: { symbol: 'EURUSD', bid: 1.16072, ask: 1.16073, spread: 0.00001, timestamp: Date.now() },
      });
    });

    const offsetWidthDescriptor = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'offsetWidth');
    Object.defineProperty(HTMLElement.prototype, 'offsetWidth', {
      configurable: true,
      get: () => 379,
    });

    try {
      render(
        <MarketWatchPanel
          allSymbols={precisionSymbols}
          selectedSymbol="EURUSD"
          onSymbolSelect={vi.fn()}
        />,
      );

      const expectedPrices: Record<string, [string, string]> = {
        JPN225: ['64706.70', '64714.70'],
        'JPN225-F': ['66229.50', '66245.50'],
        WHEAT: ['774.30', '775.10'],
        'GOLD-PERP': ['4433.31', '4433.65'],
        NICKEL: ['16866.28', '16884.22'],
        EURUSD: ['1.16072', '1.16073'],
      };
      Object.entries(expectedPrices).forEach(([symbol, [expectedBid, expectedAsk]]) => {
        const row = screen.getByText(symbol).closest('tr')!;
        expect(row.querySelector('.rtx-market-watch__price--bid')?.textContent).toBe(expectedBid);
        expect(row.querySelector('.rtx-market-watch__price--ask')?.textContent).toBe(expectedAsk);
      });
    } finally {
      if (offsetWidthDescriptor) {
        Object.defineProperty(HTMLElement.prototype, 'offsetWidth', offsetWidthDescriptor);
      } else {
        Reflect.deleteProperty(HTMLElement.prototype, 'offsetWidth');
      }
    }
  });

  it('renders COCOA and MAERSKB.DK bid and ask with exactly two decimal places', () => {
    const precisionSymbols = ['COCOA', 'MAERSKB.DK'];
    setMarketCatalog(precisionSymbols.map((symbol) => ({ symbol, digits: 2 })));
    marketHooks.activeSymbols = [...precisionSymbols];
    watchlistState.activeWatchlistId = 'screenshot-precision';
    watchlistState.watchlists = [{
      id: 'screenshot-precision',
      symbols: [...precisionSymbols],
      isDefault: false,
    }];
    act(() => {
      useAppStore.getState().setTicks({
        COCOA: { symbol: 'COCOA', bid: 6200.1, ask: 6210.1, spread: 10, timestamp: Date.now() },
        'MAERSKB.DK': { symbol: 'MAERSKB.DK', bid: 20980, ask: 21000, spread: 20, timestamp: Date.now() },
      });
    });

    const offsetWidthDescriptor = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'offsetWidth');
    Object.defineProperty(HTMLElement.prototype, 'offsetWidth', {
      configurable: true,
      get: () => 379,
    });

    try {
      render(
        <MarketWatchPanel
          allSymbols={precisionSymbols}
          selectedSymbol="COCOA"
          onSymbolSelect={vi.fn()}
        />,
      );

      const expectedPrices: Record<string, [string, string]> = {
        COCOA: ['6200.10', '6210.10'],
        'MAERSKB.DK': ['20980.00', '21000.00'],
      };
      Object.entries(expectedPrices).forEach(([symbol, [expectedBid, expectedAsk]]) => {
        const row = screen.getByText(symbol).closest('tr')!;
        expect(row.querySelector('.rtx-market-watch__price--bid')?.textContent).toBe(expectedBid);
        expect(row.querySelector('.rtx-market-watch__price--ask')?.textContent).toBe(expectedAsk);
      });
    } finally {
      if (offsetWidthDescriptor) {
        Object.defineProperty(HTMLElement.prototype, 'offsetWidth', offsetWidthDescriptor);
      } else {
        Reflect.deleteProperty(HTMLElement.prototype, 'offsetWidth');
      }
    }
  });

  it('renders prices raw when neither the broker catalog row nor the tick publishes digits', async () => {
    const rawSymbols = ['XAUUSD', 'JPN225'];
    // Real broker rows without precision: nothing may be inferred from the names.
    setMarketCatalog(rawSymbols.map((symbol) => ({ symbol })));
    marketHooks.activeSymbols = [...rawSymbols];
    watchlistState.activeWatchlistId = 'raw-precision';
    watchlistState.watchlists = [{ id: 'raw-precision', symbols: [...rawSymbols], isDefault: false }];
    act(() => {
      useAppStore.getState().setTicks({
        XAUUSD: { symbol: 'XAUUSD', bid: 4385.2, ask: 4385.4, spread: 0.2, timestamp: Date.now() },
        JPN225: { symbol: 'JPN225', bid: 64706.7, ask: 64714.7, spread: 8, timestamp: Date.now() },
      });
    });
    const width = vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockReturnValue(379);
    const originalClipboard = Object.getOwnPropertyDescriptor(navigator, 'clipboard');
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });

    try {
      render(<MarketWatchPanel allSymbols={rawSymbols} selectedSymbol="XAUUSD" onSymbolSelect={vi.fn()} />);

      const expectedPrices: Record<string, [string, string]> = {
        XAUUSD: ['4385.2', '4385.4'],
        JPN225: ['64706.7', '64714.7'],
      };
      Object.entries(expectedPrices).forEach(([symbol, [expectedBid, expectedAsk]]) => {
        const row = screen.getByText(symbol).closest('tr')!;
        expect(row.querySelector('.rtx-market-watch__price--bid')?.textContent).toBe(expectedBid);
        expect(row.querySelector('.rtx-market-watch__price--ask')?.textContent).toBe(expectedAsk);
      });
      expect(screen.getByText('JPN225').closest('tr')).not.toHaveTextContent('64706.70');

      fireEvent.contextMenu(screen.getByText('XAUUSD').closest('tr')!);
      fireEvent.click(screen.getByText('Export'));
      await vi.waitFor(() => expect(writeText).toHaveBeenCalledTimes(1));
      expect(writeText.mock.calls[0][0]).toContain('XAUUSD	4385.2	4385.4	');
      expect(writeText.mock.calls[0][0]).toContain('JPN225	64706.7	64714.7	');
    } finally {
      width.mockRestore();
      if (originalClipboard) Object.defineProperty(navigator, 'clipboard', originalClipboard);
      else delete (navigator as { clipboard?: unknown }).clipboard;
    }
  });

  it('keeps the full active watchlist subscribed as rows enter and leave the viewport', () => {
    const observers: ControlledIntersectionObserver[] = [];

    class ControlledIntersectionObserver {
      readonly observed = new Set<Element>();

      constructor(private readonly callback: IntersectionObserverCallback) {
        observers.push(this);
      }

      observe(target: Element): void {
        this.observed.add(target);
      }

      unobserve(target: Element): void {
        this.observed.delete(target);
      }

      disconnect(): void {
        this.observed.clear();
      }

      emit(entries: Array<{ target: Element; isIntersecting: boolean }>): void {
        this.callback(
          entries.map((entry) => entry as IntersectionObserverEntry),
          this as unknown as IntersectionObserver,
        );
      }
    }

    vi.stubGlobal('IntersectionObserver', ControlledIntersectionObserver);
    const publicCatalog = ['XAUUSD', 'BTCUSD', 'EURUSD'];
    setMarketCatalog(publicCatalog);

    render(
      <MarketWatchPanel
        allSymbols={publicCatalog}
        selectedSymbol="BTCUSD"
        onSymbolSelect={vi.fn()}
      />,
    );

    const observer = observers.at(-1)!;
    const xauRow = screen.getByText('XAUUSD').closest('tr')!;
    const btcRow = screen.getByText('BTCUSD').closest('tr')!;
    const eurRow = screen.getByText('EURUSD').closest('tr')!;
    expect(observer.observed).toEqual(new Set([xauRow, btcRow, eurRow]));
    expect(marketHooks.useLiveQuotes).toHaveBeenLastCalledWith(['XAUUSD', 'BTCUSD', 'EURUSD']);

    act(() => observer.emit([
      { target: btcRow, isIntersecting: true },
      { target: eurRow, isIntersecting: true },
    ]));
    expect(marketHooks.useLiveQuotes).toHaveBeenLastCalledWith(['XAUUSD', 'BTCUSD', 'EURUSD']);

    act(() => observer.emit([
      { target: xauRow, isIntersecting: true },
      { target: btcRow, isIntersecting: false },
    ]));
    expect(marketHooks.useLiveQuotes).toHaveBeenLastCalledWith(['XAUUSD', 'BTCUSD', 'EURUSD']);
  });

  it('keeps curated defaults visible in product order when feed freshness is partial', () => {
    act(() => useAppStore.setState({ isAuthenticated: true }));
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
    expect(marketHooks.useLiveQuotes).toHaveBeenCalledWith(CORE_DEFAULT_SYMBOLS);
    const staleBtcRow = screen.getByText('BTCUSD').closest('tr');
    expect(staleBtcRow).toHaveAttribute('aria-disabled', 'true');
    expect(staleBtcRow).not.toHaveStyle({ opacity: '0.72' });
    expect(staleBtcRow?.querySelector('.rtx-market-watch__symbol')).toHaveStyle({ color: 'var(--text-primary)' });
    expect(staleBtcRow?.querySelector('.rtx-market-watch__price--bid')?.closest('td')).toHaveStyle({ opacity: '1' });
    expect(staleBtcRow).not.toHaveTextContent('STALE');
    expect(staleBtcRow?.querySelector('.rtx-market-watch__status')).toBeNull();
    expect(staleBtcRow).toHaveTextContent('65000');
    expect(screen.getByText('EURUSD').closest('tr')).toHaveAttribute('aria-disabled', 'false');
  });

  it('keeps live-feed chart symbols openable when account trading authorization is narrower', () => {
    act(() => useAppStore.setState({ isAuthenticated: true }));
    setMarketCatalog(CORE_DEFAULT_SYMBOLS, ['XAUUSD']);
    marketHooks.activeSymbols = [...CORE_DEFAULT_SYMBOLS];
    const onSymbolSelect = vi.fn();

    render(
      <MarketWatchPanel
        allSymbols={['XAUUSD']}
        chartSymbols={CORE_DEFAULT_SYMBOLS}
        selectedSymbol="BTCUSD"
        onSymbolSelect={onSymbolSelect}
      />,
    );

    const eurRow = screen.getByText('EURUSD').closest('tr')!;
    const btcRow = screen.getByText('BTCUSD').closest('tr')!;
    expect(eurRow).toHaveAttribute('aria-disabled', 'false');
    expect(btcRow).toHaveAttribute('aria-disabled', 'false');
    expect(eurRow).toHaveAttribute('draggable', 'true');

    fireEvent.click(eurRow);
    fireEvent.click(btcRow);
    expect(onSymbolSelect).toHaveBeenNthCalledWith(1, 'EURUSD');
    expect(onSymbolSelect).toHaveBeenNthCalledWith(2, 'BTCUSD');

    fireEvent.contextMenu(eurRow);
    expect(screen.getByText('New Order').closest('[role="menuitem"]')).toHaveAttribute('aria-disabled', 'true');
    expect(screen.getByText('Chart Window').closest('[role="menuitem"]')).toHaveAttribute('aria-disabled', 'false');
  });

  it('requests an independent chart window from the Chart Window context action', () => {
    act(() => useAppStore.setState({ isAuthenticated: true }));
    setMarketCatalog(CORE_DEFAULT_SYMBOLS, ['XAUUSD']);
    marketHooks.activeSymbols = [...CORE_DEFAULT_SYMBOLS];
    const openChartListener = vi.fn();
    window.addEventListener('openChart', openChartListener);

    render(
      <MarketWatchPanel
        allSymbols={['XAUUSD']}
        chartSymbols={CORE_DEFAULT_SYMBOLS}
        selectedSymbol="BTCUSD"
        onSymbolSelect={vi.fn()}
      />,
    );

    fireEvent.contextMenu(screen.getByText('EURUSD').closest('tr')!);
    fireEvent.click(screen.getByText('Chart Window'));

    expect(openChartListener).toHaveBeenCalledTimes(1);
    const [event] = openChartListener.mock.calls[0];
    expect((event as CustomEvent).detail).toEqual({ symbol: 'EURUSD', newWindow: true });

    window.removeEventListener('openChart', openChartListener);
  });

  it('matches the inspected MT5 root-menu order and keeps unsupported broker features disabled', () => {
    const onSymbolSelect = vi.fn();
    render(
      <MarketWatchPanel
        allSymbols={DEFAULT_SYMBOLS}
        chartSymbols={DEFAULT_SYMBOLS}
        selectedSymbol="BTCUSD"
        onSymbolSelect={onSymbolSelect}
      />,
    );

    const xauRow = screen.getByText('XAUUSD').closest('tr')!;
    fireEvent.contextMenu(xauRow);
    expect(xauRow).toHaveAttribute('aria-selected', 'true');
    expect(onSymbolSelect).not.toHaveBeenCalled();
    const menu = screen.getByRole('menu');
    const labels = within(menu).getAllByRole('menuitem').map((item) => (
      item.querySelector('.flex-1')?.textContent
    ));

    expect(labels).toEqual([
      'New Order',
      'Chart Window',
      'Tick Chart',
      'Depth Of Market',
      'Options Board',
      'Specification',
      'Popup Prices',
      'Hide',
      'Hide All',
      'Show All',
      'Symbols',
      'Sets',
      'Sort',
      'Export',
      'Show Milliseconds',
      'Auto Remove Expired',
      'Auto Arrange',
      'Grid',
      'Columns',
    ]);
    expect(within(menu).getByText('Options Board').closest('[role="menuitem"]')).toHaveAttribute('aria-disabled', 'true');
    expect(within(menu).getByText('Auto Remove Expired').closest('[role="menuitem"]')).toHaveAttribute('aria-disabled', 'true');
  });

  it('uses closed-market Change % fallbacks when sorting Gainers', () => {
    const symbols = ['XAUUSD', 'EURUSD', 'GBPUSD'];
    setMarketCatalog(symbols);
    // Public-catalogue defaults keep one representative per group, so EURUSD
    // would crowd out GBPUSD and leave the sort order unobservable.
    marketHooks.accountCatalogStatus = 'loaded';
    marketHooks.activeSymbols = [];
    closedDailyChangeHook.values.set('XAUUSD', -2);
    closedDailyChangeHook.values.set('EURUSD', 3);
    closedDailyChangeHook.values.set('GBPUSD', 1);
    act(() => {
      useAppStore.setState({ isAuthenticated: true });
      useAppStore.getState().setTicks({});
    });

    const { container } = render(
      <MarketWatchPanel allSymbols={symbols} selectedSymbol="XAUUSD" onSymbolSelect={vi.fn()} />,
    );
    fireEvent.contextMenu(screen.getByText('XAUUSD').closest('tr')!);
    fireEvent.click(screen.getByText('Sort'));
    fireEvent.click(screen.getByText('Gainers'));

    expect(getRenderedRowSymbols(container)).toEqual(['EURUSD', 'GBPUSD', 'XAUUSD']);
    expect(closedDailyChangeHook.useHook.mock.calls.some(([options]) => (
      (options as { enabled?: boolean; symbols?: string[] }).enabled === true
      && (options as { symbols?: string[] }).symbols?.includes('EURUSD')
    ))).toBe(true);
  });

  it('opens New Order on a native-style row double-click for a tradable symbol', () => {
    act(() => useAppStore.setState({ isAuthenticated: true }));
    setMarketCatalog(CORE_DEFAULT_SYMBOLS, CORE_DEFAULT_SYMBOLS);
    marketHooks.activeSymbols = [...CORE_DEFAULT_SYMBOLS];
    const openOrderListener = vi.fn();
    window.addEventListener('openOrderDialog', openOrderListener);

    render(
      <MarketWatchPanel
        allSymbols={CORE_DEFAULT_SYMBOLS}
        chartSymbols={CORE_DEFAULT_SYMBOLS}
        selectedSymbol="XAUUSD"
        onSymbolSelect={vi.fn()}
      />,
    );

    fireEvent.doubleClick(screen.getByText('XAUUSD').closest('tr')!);
    expect(openOrderListener).toHaveBeenCalledTimes(1);
    expect((openOrderListener.mock.calls[0][0] as CustomEvent).detail).toEqual({ symbol: 'XAUUSD' });
    window.removeEventListener('openOrderDialog', openOrderListener);
  });

  it('opens the real tick-buffer view and Popup Prices from their context actions', () => {
    render(
      <MarketWatchPanel
        allSymbols={DEFAULT_SYMBOLS}
        chartSymbols={DEFAULT_SYMBOLS}
        selectedSymbol="XAUUSD"
        onSymbolSelect={vi.fn()}
      />,
    );

    fireEvent.contextMenu(screen.getByText('XAUUSD').closest('tr')!);
    fireEvent.click(screen.getByText('Tick Chart'));
    expect(screen.getByRole('tab', { name: 'Ticks' })).toHaveAttribute('aria-selected', 'true');
    expect(document.querySelector('.rtx-market-tick-chart')).not.toBeNull();

    fireEvent.click(screen.getByRole('tab', { name: 'Symbols' }));
    fireEvent.contextMenu(screen.getByText('XAUUSD').closest('tr')!);
    fireEvent.click(screen.getByText('Popup Prices'));
    expect(screen.getByRole('dialog', { name: 'Popup Prices' })).toBeInTheDocument();
    expect(screen.getByRole('list', { name: 'Symbol prices' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Close Popup Prices' }));
    expect(screen.queryByRole('dialog', { name: 'Popup Prices' })).not.toBeInTheDocument();
  });

  it('keeps all four MT5 view tabs in order and opens Trading for the watched symbols', async () => {
    render(<MarketWatchPanel allSymbols={DEFAULT_SYMBOLS} selectedSymbol="BTCUSD" onSymbolSelect={vi.fn()} />);

    const tabs = screen.getByRole('tablist', { name: 'Market Watch views' });
    expect(within(tabs).getAllByRole('tab').map(tab => tab.textContent)).toEqual([
      'Symbols', 'Details', 'Trading', 'Ticks',
    ]);
    expect(screen.getByRole('tab', { name: 'Symbols' })).toHaveAttribute('aria-selected', 'true');
    const search = screen.getByRole('combobox', { name: 'Add symbol' });
    act(() => search.focus());
    expect(screen.getByRole('listbox', { name: 'Symbol groups' })).toBeInTheDocument();
    expect(tabs).toBeVisible();

    await act(async () => { fireEvent.click(screen.getByRole('tab', { name: 'Trading' })); });

    expect(screen.getByRole('tab', { name: 'Trading' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Market Watch Trading test view' })).toHaveTextContent(CORE_DEFAULT_SYMBOLS.join(', '));
    expect(screen.getByRole('button', { name: 'Close Market Watch' })).toBeVisible();

    fireEvent.click(screen.getByRole('tab', { name: 'Symbols' }));
    expect(screen.getByRole('tab', { name: 'Symbols' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('table')).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Market Watch Trading test view' })).not.toBeInTheDocument();
  });

  it('shows the MT5 Details tab from the live feed tick and the instrument catalog', async () => {
    setMarketCatalog([
      { symbol: 'XAUUSD', description: 'Gold vs US Dollar', digits: 2, tick_size: 0.01, tick_value: 0.1 },
      'BTCUSD',
      { symbol: 'EURUSD', digits: 5 },
    ]);
    marketHooks.activeSymbols = ['XAUUSD', 'BTCUSD'];
    act(() => {
      useAppStore.getState().setTicks({
        XAUUSD: {
          symbol: 'XAUUSD',
          bid: 4150.16,
          ask: 4150.46,
          spread: 0.3,
          timestamp: Date.now(),
          bidHigh: 4277.01,
          bidLow: 4140.53,
          askHigh: 4283.46,
          askLow: 4140.87,
          open: 4274.42,
          close: 4272.74,
          dailyChange: -2.87,
        },
        EURUSD: { symbol: 'EURUSD', bid: 1.1, ask: 1.1001, spread: 0.0001, dailyChange: -0.42, timestamp: Date.now() },
      });
    });

    const { rerender } = render(
      <MarketWatchPanel
        allSymbols={DEFAULT_SYMBOLS}
        chartSymbols={DEFAULT_SYMBOLS}
        selectedSymbol="XAUUSD"
        onSymbolSelect={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole('tab', { name: 'Details' }));

    expect(screen.getByRole('tab', { name: 'Details' })).toHaveAttribute('aria-selected', 'true');
    const symbolLink = screen.getByRole('button', { name: 'XAUUSD, Gold vs US Dollar' });
    expect(symbolLink).toBeInTheDocument();
    expect(symbolLink).not.toHaveAttribute('data-active', 'true');
    expect(screen.getByRole('region', { name: 'XAUUSD Details' })).toBeInTheDocument();
    expect(screen.queryByText('Symbol unavailable')).not.toBeInTheDocument();
    const labels = [
      'Tick Size', 'Tick Value', 'Bid', 'Bid High', 'Bid Low', 'Ask', 'Ask High', 'Ask Low',
      'Change %', 'Open Price', 'Close Price',
    ];
    expect(Object.fromEntries(labels.map((label) => [label, getDetailValue(label)]))).toEqual({
      'Tick Size': '0.01',
      'Tick Value': '0.1',
      Bid: '4150.16',
      'Bid High': '4277.01',
      'Bid Low': '4140.53',
      Ask: '4150.46',
      'Ask High': '4283.46',
      'Ask Low': '4140.87',
      'Change %': '-2.87%',
      'Open Price': '4274.42',
      'Close Price': '4272.74',
    });

    fireEvent.click(symbolLink);
    await act(async () => { await vi.dynamicImportSettled(); });
    expect(symbolLink).toHaveAttribute('data-active', 'true');
    expect(screen.getByRole('dialog', { name: 'XAUUSD Specification' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Close symbol specification' }));

    rerender(
      <MarketWatchPanel
        allSymbols={DEFAULT_SYMBOLS}
        chartSymbols={DEFAULT_SYMBOLS}
        selectedSymbol="EURUSD"
        onSymbolSelect={vi.fn()}
      />,
    );
    expect(screen.getByRole('region', { name: 'EURUSD Details' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'EURUSD, Euro vs US Dollar' })).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('Symbol unavailable');
    expect(screen.getByText('-0.42%')).toHaveAttribute('data-tone', 'down');
    expect(getDetailValue('Bid')).toBe('1.10000');
    expect(getDetailValue('Bid High')).toBe('—');
    expect(getDetailValue('Tick Value')).toBe('—');
  });


  it('prefers the account specification Tick Value while Details is open', async () => {
    act(() => useAppStore.setState({ isAuthenticated: true }));
    setMarketCatalog(
      [{ symbol: 'XAUUSD', tick_size: 0.01, tick_value: 0.1 }, 'BTCUSD', 'EURUSD'],
      CORE_DEFAULT_SYMBOLS,
    );
    marketHooks.activeSymbols = [...CORE_DEFAULT_SYMBOLS];
    marketHooks.loadSymbolSpecification.mockResolvedValue({ symbol: 'XAUUSD', trade_tick_value: 0.12 });

    render(
      <MarketWatchPanel
        allSymbols={CORE_DEFAULT_SYMBOLS}
        chartSymbols={CORE_DEFAULT_SYMBOLS}
        selectedSymbol="XAUUSD"
        onSymbolSelect={vi.fn()}
      />,
    );
    expect(marketHooks.loadSymbolSpecification).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('tab', { name: 'Details' }));
    await act(async () => {
      await Promise.resolve();
    });

    expect(marketHooks.loadSymbolSpecification).toHaveBeenCalledWith('XAUUSD', expect.any(AbortSignal));
    expect(getDetailValue('Tick Value')).toBe('0.12');
    expect(getDetailValue('Tick Size')).toBe('0.01');
  });

  it('opens the MT5 Details context menu on right-click across Details rows and toggles Grid', () => {
    act(() => useAppStore.setState({ isAuthenticated: true }));
    setMarketCatalog(CORE_DEFAULT_SYMBOLS, CORE_DEFAULT_SYMBOLS);
    marketHooks.activeSymbols = [...CORE_DEFAULT_SYMBOLS];

    render(
      <MarketWatchPanel
        allSymbols={CORE_DEFAULT_SYMBOLS}
        chartSymbols={CORE_DEFAULT_SYMBOLS}
        selectedSymbol="XAUUSD"
        onSymbolSelect={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole('tab', { name: 'Details' }));
    const detailsRegion = screen.getByRole('region', { name: 'XAUUSD Details' });
    expect(detailsRegion).toHaveAttribute('data-grid', 'true');

    const bidRow = screen.getByText('Bid', { selector: 'dt' }).closest('.rtx-market-watch-details__row')!;
    const askRow = screen.getByText('Ask', { selector: 'dt' }).closest('.rtx-market-watch-details__row')!;
    const openRow = screen.getByText('Open Price', { selector: 'dt' }).closest('.rtx-market-watch-details__row')!;

    fireEvent.contextMenu(bidRow);
    expect(bidRow).toHaveAttribute('aria-selected', 'true');

    const menu = screen.getByRole('menu');
    const labels = within(menu).getAllByRole('menuitem').map((item) => (
      item.querySelector('.flex-1')?.textContent
    ));
    expect(labels).toEqual([
      'New Order',
      'Chart Window',
      'Tick Chart',
      'Depth Of Market',
      'Specification',
      'Grid',
    ]);

    // Toggle Grid off and back on from the Details context menu
    fireEvent.click(within(menu).getByText('Grid'));
    expect(detailsRegion).toHaveAttribute('data-grid', 'false');
    fireEvent.click(within(menu).getByText('Grid'));
    expect(detailsRegion).toHaveAttribute('data-grid', 'true');

    // Right-clicking another section row selects it and keeps the Details context menu working
    fireEvent.contextMenu(askRow);
    expect(askRow).toHaveAttribute('aria-selected', 'true');
    expect(bidRow).toHaveAttribute('aria-selected', 'false');

    fireEvent.contextMenu(openRow);
    expect(openRow).toHaveAttribute('aria-selected', 'true');
    expect(askRow).toHaveAttribute('aria-selected', 'false');

    // Selecting Tick Chart from the Details context menu switches to the Ticks tab
    fireEvent.click(within(screen.getByRole('menu')).getByText('Tick Chart'));
    expect(screen.getByRole('tab', { name: 'Ticks' })).toHaveAttribute('aria-selected', 'true');
  });

  it('sorts and renders isolated Last-only display metadata without creating quotes', () => {
    const symbols = ['XAUUSD', 'EURUSD', 'GBPUSD'];
    setMarketCatalog(symbols);
    marketHooks.accountCatalogStatus = 'loaded';
    marketHooks.activeSymbols = symbols;
    act(() => {
      useAppStore.setState({ isAuthenticated: true });
      useAppStore.getState().setTicks({});
      publishMarketWatchDisplayMetadata('XAUUSD', {
        last: 2_400,
        dailyChange: -2,
        timestamp: Date.now(),
        sourceTimestamp: Date.now(),
      });
      publishMarketWatchDisplayMetadata('EURUSD', {
        last: 1.1,
        dailyChange: 3,
        timestamp: Date.now(),
        sourceTimestamp: Date.now(),
      });
      publishMarketWatchDisplayMetadata('GBPUSD', {
        last: 1.3,
        dailyChange: 1,
        timestamp: Date.now(),
        sourceTimestamp: Date.now(),
      });
    });

    const { container } = render(
      <MarketWatchPanel allSymbols={symbols} selectedSymbol="XAUUSD" onSymbolSelect={vi.fn()} />,
    );
    fireEvent.contextMenu(screen.getByText('XAUUSD').closest('tr')!);
    fireEvent.click(screen.getByText('Sort'));
    fireEvent.click(screen.getByText('Gainers'));

    expect(getRenderedRowSymbols(container)).toEqual(['EURUSD', 'GBPUSD', 'XAUUSD']);
    expect(screen.getByText('+3.00%')).toBeInTheDocument();
    expect(useAppStore.getState().ticks).toEqual({});
  });

  it('hydrates Popup Prices for off-screen rows only while the popup is open', () => {
    const observers: ControlledIntersectionObserver[] = [];

    class ControlledIntersectionObserver {
      readonly observed = new Set<Element>();

      constructor(private readonly callback: IntersectionObserverCallback) {
        observers.push(this);
      }

      observe(target: Element): void {
        this.observed.add(target);
      }

      unobserve(target: Element): void {
        this.observed.delete(target);
      }

      disconnect(): void {
        this.observed.clear();
      }

      emit(entries: Array<{ target: Element; isIntersecting: boolean }>): void {
        this.callback(
          entries.map((entry) => entry as IntersectionObserverEntry),
          this as unknown as IntersectionObserver,
        );
      }
    }

    vi.stubGlobal('IntersectionObserver', ControlledIntersectionObserver);
    marketHooks.activeSymbols = [];
    lastMarketWatchQuotesHook.values.set('XAUUSD', {
      kind: 'close', close: 4_385.2, asOf: Date.parse('2026-09-18T21:59:00Z'),
    });
    lastMarketWatchQuotesHook.values.set('EURUSD', {
      kind: 'quote', bid: 1.17, ask: 1.1702, asOf: Date.parse('2026-09-18T21:59:00Z'),
    });
    closedDailyChangeHook.values.set('XAUUSD', -0.42);
    closedDailyChangeHook.values.set('EURUSD', 0.75);
    act(() => {
      useAppStore.setState({ isAuthenticated: true });
      useAppStore.getState().setTicks({});
    });

    render(
      <MarketWatchPanel
        allSymbols={DEFAULT_SYMBOLS}
        chartSymbols={DEFAULT_SYMBOLS}
        selectedSymbol="XAUUSD"
        onSymbolSelect={vi.fn()}
      />,
    );

    const observer = observers.at(-1)!;
    const xauRow = screen.getByText('XAUUSD').closest('tr')!;
    act(() => observer.emit([{ target: xauRow, isIntersecting: true }]));
    expect(lastMarketWatchQuotesHook.useHook.mock.calls.at(-1)?.[0].symbols).toEqual(['XAUUSD']);

    fireEvent.contextMenu(xauRow);
    fireEvent.click(screen.getByText('Popup Prices'));

    expect(lastMarketWatchQuotesHook.useHook.mock.calls.at(-1)?.[0]).toMatchObject({
      symbols: CORE_DEFAULT_SYMBOLS,
      candleSymbols: ['XAUUSD', 'EURUSD'],
    });
    expect(closedDailyChangeHook.useHook.mock.calls.some(([options]) => {
      const request = options as { enabled?: boolean; symbols?: string[] };
      return request.enabled === true
        && request.symbols?.includes('XAUUSD')
        && request.symbols.includes('EURUSD');
    })).toBe(true);

    const xauCard = screen.getByRole('listitem', { name: 'XAUUSD quote' });
    expect(within(xauCard).getByText('Last close')).toBeInTheDocument();
    expect(within(xauCard).getByLabelText('Change % -0.42%')).toBeInTheDocument();
    const eurCard = screen.getByRole('listitem', { name: 'EURUSD quote' });
    expect(within(eurCard).getByLabelText('EURUSD Bid 1.17000')).toBeInTheDocument();
    expect(within(eurCard).getByLabelText('Change % +0.75%')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Close Popup Prices' }));
    expect(lastMarketWatchQuotesHook.useHook.mock.calls.at(-1)?.[0].symbols).toEqual(['XAUUSD']);
  });

  it('persists Columns, Show Milliseconds, and named symbol Sets', () => {
    render(
      <MarketWatchPanel
        allSymbols={DEFAULT_SYMBOLS}
        chartSymbols={DEFAULT_SYMBOLS}
        selectedSymbol="XAUUSD"
        onSymbolSelect={vi.fn()}
      />,
    );

    fireEvent.contextMenu(screen.getByText('XAUUSD').closest('tr')!);
    const rootMenu = screen.getByRole('menu');
    fireEvent.click(within(rootMenu).getByText('Columns'));
    const columnsMenu = screen.getAllByRole('menu').at(-1)!;
    fireEvent.click(within(columnsMenu).getByText('Time'));
    expect(screen.getByRole('columnheader', { name: 'Time' })).toBeInTheDocument();
    expect(JSON.parse(localStorage.getItem('rtx5_marketwatch_cols') ?? '[]')).toContain('time');

    fireEvent.click(within(rootMenu).getByText('Show Milliseconds'));
    expect(JSON.parse(localStorage.getItem('rtx5_marketwatch_options') ?? '{}')).toMatchObject({ showMilliseconds: true });

    fireEvent.click(within(rootMenu).getByText('Sets'));
    const setsMenu = screen.getAllByRole('menu').at(-1)!;
    fireEvent.click(within(setsMenu).getByText('Save as'));
    const dialog = screen.getByRole('dialog', { name: 'Save Market Watch set' });
    fireEvent.change(within(dialog).getByLabelText('Set name'), { target: { value: 'Metals and FX' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }));

    expect(JSON.parse(localStorage.getItem('rtx5_symbol_sets') ?? '{}')).toMatchObject({
      'Metals and FX': DEFAULT_DISPLAY_SYMBOLS,
    });
    expect(JSON.parse(localStorage.getItem('rtx5_symbol_set_columns') ?? '{}')['Metals and FX']).toContain('time');
  });

  it('renders the 5-column MT5 Desktop Columns submenu with all 46 options and displays toggled column values', () => {
    const specInstrument = {
      symbol: 'XAUUSD',
      digits: 2,
      tickSize: 0.01,
      tickValue: 1,
      marginInitial: 1000,
    };
    setMarketCatalog([specInstrument], ['XAUUSD']);
    marketHooks.activeSymbols = ['XAUUSD'];
    act(() => {
      useAppStore.getState().setTicks({
        XAUUSD: {
          symbol: 'XAUUSD',
          bid: 2350.25,
          ask: 2350.55,
          spread: 30,
          high: 2360.50,
          low: 2340.10,
          open: 2345.00,
          close: 2344.80,
          timestamp: Date.now(),
        },
      });
    });

    render(
      <MarketWatchPanel
        allSymbols={[specInstrument]}
        chartSymbols={['XAUUSD']}
        selectedSymbol="XAUUSD"
        onSymbolSelect={vi.fn()}
      />,
    );

    fireEvent.contextMenu(screen.getByText('XAUUSD').closest('tr')!);
    const rootMenu = screen.getByRole('menu');
    fireEvent.click(within(rootMenu).getByText('Columns'));
    const columnsMenu = screen.getAllByRole('menu').at(-1)!;

    expect(columnsMenu.querySelector('.rtx-context-menu__columns')).toHaveAttribute('data-column-count', '5');
    const menuItems = within(columnsMenu).getAllByRole('menuitem');
    expect(menuItems).toHaveLength(46);

    fireEvent.click(within(columnsMenu).getByText('Tick Size'));
    fireEvent.click(within(columnsMenu).getByText('Tick Value'));
    fireEvent.click(within(columnsMenu).getByText('Initial margin'));
    fireEvent.click(within(columnsMenu).getByText('Bid High'));
    fireEvent.click(within(columnsMenu).getByText('Open Price'));

    expect(screen.getByRole('columnheader', { name: 'Tick Size' })).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: 'Tick Value' })).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: 'Initial margin' })).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: 'Bid High' })).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: 'Open Price' })).toBeInTheDocument();

    const xauRow = screen.getByText('XAUUSD').closest('tr')!;
    expect(xauRow.querySelector('[data-field="tickSize"]')).toHaveTextContent('0.01');
    expect(xauRow.querySelector('[data-field="tickValue"]')).toHaveTextContent('1');
    expect(xauRow.querySelector('[data-field="initialMargin"]')).toHaveTextContent('1000');
    expect(xauRow.querySelector('[data-field="bidHigh"]')).toHaveTextContent('2360.50');
    expect(xauRow.querySelector('[data-field="openPrice"]')).toHaveTextContent('2345.00');
  });

  it('shows stock-only Fundamental Data while honestly disabling unavailable realtime subscription', () => {
    const stock = { symbol: 'MSFT', description: 'Microsoft Corporation', category: 'Stocks' };
    setMarketCatalog([stock], ['MSFT']);
    marketHooks.activeSymbols = ['MSFT'];
    watchlistState.activeWatchlistId = 'stocks';
    watchlistState.watchlists = [{ id: 'stocks', symbols: ['MSFT'], isDefault: false }];
    render(
      <MarketWatchPanel
        allSymbols={[stock]}
        chartSymbols={['MSFT']}
        selectedSymbol="MSFT"
        onSymbolSelect={vi.fn()}
      />,
    );

    fireEvent.contextMenu(screen.getByText('MSFT').closest('tr')!);
    expect(screen.getByText('Subscribe to Realtime Datafeed').closest('[role="menuitem"]')).toHaveAttribute('aria-disabled', 'true');
    fireEvent.click(screen.getByText('Fundamental Data'));
    const fundamentalMenu = screen.getAllByRole('menu').at(-1)!;
    expect(within(fundamentalMenu).getByText('Yahoo Finance')).toBeInTheDocument();
    expect(within(fundamentalMenu).getByText('SEC EDGAR')).toBeInTheDocument();
    expect(within(fundamentalMenu).getByText('Morningstar')).toBeInTheDocument();
  });

  it('toggles Market Watch table grid lines from the Grid context action', () => {
    act(() => useAppStore.setState({ isAuthenticated: true }));
    setMarketCatalog(CORE_DEFAULT_SYMBOLS, ['XAUUSD']);
    marketHooks.activeSymbols = [...CORE_DEFAULT_SYMBOLS];

    const { container } = render(
      <MarketWatchPanel
        allSymbols={['XAUUSD']}
        chartSymbols={CORE_DEFAULT_SYMBOLS}
        selectedSymbol="BTCUSD"
        onSymbolSelect={vi.fn()}
      />,
    );

    expect(container.querySelector('.rtx-market-watch__grid')).toHaveClass('rtx-market-watch__grid--lines');
    fireEvent.contextMenu(screen.getByText('EURUSD').closest('tr')!);
    fireEvent.click(screen.getByText('Grid'));
    expect(container.querySelector('.rtx-market-watch__grid')).not.toHaveClass('rtx-market-watch__grid--lines');
    fireEvent.click(screen.getByText('Grid'));
    expect(container.querySelector('.rtx-market-watch__grid')).toHaveClass('rtx-market-watch__grid--lines');
  });

  it('exports the Market Watch with visible feedback instead of failing silently', async () => {
    act(() => useAppStore.setState({ isAuthenticated: true }));
    setMarketCatalog(CORE_DEFAULT_SYMBOLS, ['XAUUSD']);
    marketHooks.activeSymbols = [...CORE_DEFAULT_SYMBOLS];
    const originalClipboard = Object.getOwnPropertyDescriptor(navigator, 'clipboard');
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    const feedback = vi.fn();
    window.addEventListener('rtx:order-feedback', feedback);

    try {
      render(
        <MarketWatchPanel
          allSymbols={['XAUUSD']}
          chartSymbols={CORE_DEFAULT_SYMBOLS}
          selectedSymbol="BTCUSD"
          onSymbolSelect={vi.fn()}
        />,
      );

      fireEvent.contextMenu(screen.getByText('EURUSD').closest('tr')!);
      fireEvent.click(screen.getByText('Export'));

      await vi.waitFor(() => expect(writeText).toHaveBeenCalledTimes(1));
      expect(String(writeText.mock.calls[0][0])).toContain('Symbol\tBid\tAsk\tChange %');
      await vi.waitFor(() => expect(feedback).toHaveBeenCalled());
      const [feedbackEvent] = feedback.mock.calls[0];
      expect((feedbackEvent as CustomEvent).detail).toMatchObject({
        type: 'success',
        notice: {
          title: 'Market Watch',
          description: 'Market Watch exported to clipboard (3 symbols)',
          metaLabel: 'Destination',
          meta: 'System clipboard',
          metaIcon: 'copy',
          hint: 'No file was created. Press Ctrl+V to paste into Excel or another app.',
          exportResult: {
            destination: 'clipboard',
            symbolCount: 3,
            columnCount: 4,
            fileName: expect.stringMatching(/^market-watch-\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}\.csv$/),
            csv: expect.stringContaining('Symbol,Bid,Ask,Change %'),
          },
        },
      });
    } finally {
      window.removeEventListener('rtx:order-feedback', feedback);
      if (originalClipboard) {
        Object.defineProperty(navigator, 'clipboard', originalClipboard);
      } else {
        delete (navigator as { clipboard?: unknown }).clipboard;
      }
    }
  });

  it('downloads a CSV and reports the real destination when clipboard access is unavailable', async () => {
    act(() => useAppStore.setState({ isAuthenticated: true }));
    setMarketCatalog(CORE_DEFAULT_SYMBOLS, ['XAUUSD']);
    marketHooks.activeSymbols = [...CORE_DEFAULT_SYMBOLS];

    const originalClipboard = Object.getOwnPropertyDescriptor(navigator, 'clipboard');
    const originalExecCommand = Object.getOwnPropertyDescriptor(document, 'execCommand');
    const originalCreateObjectUrl = Object.getOwnPropertyDescriptor(URL, 'createObjectURL');
    const originalRevokeObjectUrl = Object.getOwnPropertyDescriptor(URL, 'revokeObjectURL');
    const writeText = vi.fn().mockRejectedValue(new Error('Clipboard permission denied'));
    const execCommand = vi.fn().mockReturnValue(false);
    const createObjectURL = vi.fn().mockReturnValue('blob:market-watch-export');
    const revokeObjectURL = vi.fn();
    let downloadedFileName = '';
    const anchorClick = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
      downloadedFileName = this.download;
    });
    const feedback = vi.fn();

    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    Object.defineProperty(document, 'execCommand', { value: execCommand, configurable: true });
    Object.defineProperty(URL, 'createObjectURL', { value: createObjectURL, configurable: true });
    Object.defineProperty(URL, 'revokeObjectURL', { value: revokeObjectURL, configurable: true });
    window.addEventListener('rtx:order-feedback', feedback);

    try {
      render(
        <MarketWatchPanel
          allSymbols={['XAUUSD']}
          chartSymbols={CORE_DEFAULT_SYMBOLS}
          selectedSymbol="BTCUSD"
          onSymbolSelect={vi.fn()}
        />,
      );

      fireEvent.contextMenu(screen.getByText('EURUSD').closest('tr')!);
      fireEvent.click(screen.getByText('Export'));

      await act(async () => {
        await Promise.resolve();
        await Promise.resolve();
      });

      expect(writeText).toHaveBeenCalledTimes(1);
      expect(execCommand).toHaveBeenCalledWith('copy');
      expect(createObjectURL).toHaveBeenCalledWith(expect.any(Blob));
      expect(anchorClick).toHaveBeenCalledTimes(1);
      expect(document.querySelector('a[download^="market-watch-"]')).not.toBeInTheDocument();
      expect(feedback).toHaveBeenCalledTimes(1);
      const [feedbackEvent] = feedback.mock.calls[0];
      const detail = (feedbackEvent as CustomEvent).detail as {
        notice: { meta: string; exportResult: MarketWatchExportResult };
        type: string;
      };
      expect(detail).toMatchObject({
        type: 'success',
        notice: {
          title: 'Market Watch',
          metaLabel: 'Destination',
          meta: expect.stringMatching(/^Browser download: market-watch-\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}\.csv$/),
          metaIcon: 'download',
          exportResult: {
            destination: 'download',
            symbolCount: 3,
            columnCount: 4,
            fileName: expect.stringMatching(/^market-watch-\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}\.csv$/),
            csv: expect.stringContaining('Symbol,Bid,Ask,Change %'),
          },
        },
      });
      expect(downloadedFileName).toBe(detail.notice.exportResult.fileName);
      expect(detail.notice.meta).toBe(`Browser download: ${detail.notice.exportResult.fileName}`);
      expect(detail.notice.exportResult.csv.split('\n')).toHaveLength(detail.notice.exportResult.symbolCount + 1);
      const downloadedBlob = createObjectURL.mock.calls[0][0] as Blob;
      expect(downloadedBlob.type).toBe('text/csv;charset=utf-8');
      expect(downloadedBlob.size).toBe(new Blob([detail.notice.exportResult.csv]).size);

      act(() => vi.advanceTimersByTime(0));
      expect(revokeObjectURL).toHaveBeenCalledWith('blob:market-watch-export');
    } finally {
      window.removeEventListener('rtx:order-feedback', feedback);
      anchorClick.mockRestore();
      if (originalClipboard) Object.defineProperty(navigator, 'clipboard', originalClipboard);
      else delete (navigator as { clipboard?: unknown }).clipboard;
      if (originalExecCommand) Object.defineProperty(document, 'execCommand', originalExecCommand);
      else Reflect.deleteProperty(document, 'execCommand');
      if (originalCreateObjectUrl) Object.defineProperty(URL, 'createObjectURL', originalCreateObjectUrl);
      else Reflect.deleteProperty(URL, 'createObjectURL');
      if (originalRevokeObjectUrl) Object.defineProperty(URL, 'revokeObjectURL', originalRevokeObjectUrl);
      else Reflect.deleteProperty(URL, 'revokeObjectURL');
    }
  });

  it('reports the captured export snapshot when clipboard and CSV download both fail', async () => {
    act(() => useAppStore.setState({ isAuthenticated: true }));
    setMarketCatalog(CORE_DEFAULT_SYMBOLS, ['XAUUSD']);
    marketHooks.activeSymbols = [...CORE_DEFAULT_SYMBOLS];

    const originalClipboard = Object.getOwnPropertyDescriptor(navigator, 'clipboard');
    const originalExecCommand = Object.getOwnPropertyDescriptor(document, 'execCommand');
    const originalCreateObjectUrl = Object.getOwnPropertyDescriptor(URL, 'createObjectURL');
    const writeText = vi.fn().mockRejectedValue(new Error('Clipboard permission denied'));
    const execCommand = vi.fn().mockReturnValue(false);
    const createObjectURL = vi.fn(() => {
      throw new Error('Download blocked');
    });
    const feedback = vi.fn();

    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    Object.defineProperty(document, 'execCommand', { value: execCommand, configurable: true });
    Object.defineProperty(URL, 'createObjectURL', { value: createObjectURL, configurable: true });
    window.addEventListener('rtx:order-feedback', feedback);

    try {
      render(
        <MarketWatchPanel
          allSymbols={['XAUUSD']}
          chartSymbols={CORE_DEFAULT_SYMBOLS}
          selectedSymbol="BTCUSD"
          onSymbolSelect={vi.fn()}
        />,
      );

      fireEvent.contextMenu(screen.getByText('EURUSD').closest('tr')!);
      fireEvent.click(screen.getByText('Export'));

      await act(async () => {
        await Promise.resolve();
        await Promise.resolve();
      });

      expect(feedback).toHaveBeenCalledTimes(1);
      const [feedbackEvent] = feedback.mock.calls[0];
      expect((feedbackEvent as CustomEvent).detail).toMatchObject({
        type: 'error',
        notice: {
          title: 'Market Watch',
          description: 'Market Watch export failed',
          meta: 'Failed',
          metaIcon: 'error',
          exportResult: {
            destination: 'failed',
            symbolCount: 3,
            columnCount: 4,
            fileName: expect.stringMatching(/^market-watch-\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}\.csv$/),
            csv: expect.stringContaining('Symbol,Bid,Ask,Change %'),
          },
        },
      });
    } finally {
      window.removeEventListener('rtx:order-feedback', feedback);
      if (originalClipboard) Object.defineProperty(navigator, 'clipboard', originalClipboard);
      else delete (navigator as { clipboard?: unknown }).clipboard;
      if (originalExecCommand) Object.defineProperty(document, 'execCommand', originalExecCommand);
      else Reflect.deleteProperty(document, 'execCommand');
      if (originalCreateObjectUrl) Object.defineProperty(URL, 'createObjectURL', originalCreateObjectUrl);
      else Reflect.deleteProperty(URL, 'createObjectURL');
    }
  });

  it('uses an injected freshness snapshot without starting a second status owner', () => {
    marketHooks.useActiveMarketSymbols.mockClear();
    const activeMarketSnapshot = {
      ...getActiveMarketSnapshot(),
      symbols: ['GBPUSD', 'EURUSD'],
    };

    render(
      <MarketWatchPanel
        allSymbols={[...DEFAULT_SYMBOLS, 'ETHUSD', '0001.HK']}
        activeMarketSnapshot={activeMarketSnapshot}
        selectedSymbol="BTCUSD"
        onSymbolSelect={vi.fn()}
      />,
    );

    const btcRow = screen.getByText('BTCUSD').closest('tr');
    expect(marketHooks.useActiveMarketSymbols).not.toHaveBeenCalled();
    expect(btcRow).toHaveAttribute('aria-disabled', 'true');
    expect(btcRow).not.toHaveTextContent('STALE');
    expect(btcRow).toHaveTextContent('65000');
  });

  it('places the inline add-symbol input after the quote rows', () => {
    const { container } = render(
      <MarketWatchPanel
        allSymbols={DEFAULT_SYMBOLS}
        selectedSymbol="BTCUSD"
        onSymbolSelect={vi.fn()}
      />,
    );

    const search = screen.getByRole('combobox', { name: 'Add symbol' });
    const table = screen.getByRole('table');
    expect(search).toHaveAttribute('placeholder', 'click to add...');
    expect(table.compareDocumentPosition(search) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(search.closest('.rtx-market-watch__table')).toBe(container.querySelector('.rtx-market-watch__table'));

    fireEvent.focus(search);
    expect(container.querySelector('.rtx-market-watch__search-table-gap')).not.toBeInTheDocument();
  });

  it('keeps the header close independent from symbol search while the explorer is open', () => {
    const savedLayout = useDockLayoutStore.getState().layout;
    useDockLayoutStore.getState().setLayout(new DockManager().getLayout());
    const removePanel = vi.spyOn(useDockLayoutStore.getState(), 'removePanel').mockImplementation(() => undefined);
    const onSymbolSelect = vi.fn();
    try {
      const { container } = render(<MarketWatchPanel allSymbols={DEFAULT_SYMBOLS} selectedSymbol="BTCUSD" onSymbolSelect={onSymbolSelect} />);
      const header = container.querySelector<HTMLElement>('.rtx-market-watch__header')!;
      expect(header).toHaveTextContent('Market Watch');
      const search = screen.getByRole('combobox', { name: 'Add symbol' });
      act(() => search.focus());
      expect(screen.getByRole('listbox', { name: 'Symbol groups' })).toBeInTheDocument();
      const close = within(header).getByRole('button', { name: 'Close Market Watch' });
      expect(close).toBeVisible();

      fireEvent.click(close);

      expect(removePanel).toHaveBeenCalledOnce();
      expect(removePanel).toHaveBeenCalledWith('market-watch');
      // The removal is intercepted above; closing the whole panel must not
      // silently act as the explorer's separate clear/close command.
      expect(screen.getByRole('listbox', { name: 'Symbol groups' })).toBeInTheDocument();
      expect(screen.getByRole('combobox', { name: 'Add symbol' })).toBe(search);
      expect(onSymbolSelect).not.toHaveBeenCalled();
    } finally {
      removePanel.mockRestore();
      useDockLayoutStore.getState().setLayout(savedLayout);
    }
  });

  it('opens symbol groups with visible and total counts when search receives focus', () => {
    const publicCatalog = [...DEFAULT_SYMBOLS, 'ETHUSD', '0001.HK'];
    setMarketCatalog(publicCatalog);
    render(
      <MarketWatchPanel
        allSymbols={publicCatalog}
        selectedSymbol="BTCUSD"
        onSymbolSelect={vi.fn()}
      />,
    );

    const search = screen.getByRole('combobox', { name: 'Add symbol' });
    expect(search).toHaveAttribute('aria-expanded', 'false');
    expect(search).toHaveAttribute('placeholder', 'click to add...');
    expect(screen.getByRole('table')).toBeInTheDocument();

    act(() => search.focus());

    const groups = screen.getByRole('listbox', { name: 'Symbol groups' });
    const searchSurface = search.closest<HTMLElement>('.rtx-market-watch__search');
    const explorerSurface = groups.closest<HTMLElement>('.rtx-market-watch__symbol-explorer');
    const forexGroup = within(groups).getByRole('option', { name: 'Forex 1 of 3' });
    const forexCount = within(forexGroup).getByText('1/3');
    expect(search).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByRole('combobox', { name: 'Add symbol' })).toBe(search);
    expect(search).toHaveFocus();
    expect(search).toHaveAttribute('aria-controls', groups.id);
    expect(searchSurface?.style.background).toBe('var(--bg-secondary)');
    expect(explorerSurface?.style.background).toBe('var(--bg-secondary)');
    expect(forexGroup.style.color).toBe('var(--text-primary)');
    expect(forexCount.style.color).toBe('var(--text-secondary)');
    expect(within(groups).getAllByRole('option').map((option) => option.getAttribute('aria-label'))).toEqual([
      'Forex 1 of 3',
      'Metals 1 of 1',
      'Crypto 1 of 2',
      'Stocks 1 of 1',
    ]);
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
  });

  it('lists configured Market Watch symbols first in row order and marks them as subscribed inside a group', () => {
    const stocks: MockMarketInstrument[] = [
      { symbol: 'AAPL', category: 'Stocks.US', bid: 230, ask: 231 },
      { symbol: 'MSFT', category: 'Stocks.US', bid: 420, ask: 421 },
      { symbol: 'NVDA', category: 'Stocks.US', bid: 180, ask: 181 },
      { symbol: 'TSLA', category: 'Stocks.US', bid: 310, ask: 311 },
    ];
    setMarketCatalog(stocks);
    marketHooks.activeSymbols = stocks.map(({ symbol }) => symbol);
    watchlistState.activeWatchlistId = 'custom';
    watchlistState.watchlists = [{
      id: 'custom',
      symbols: ['MSFT', 'AAPL'],
      isDefault: false,
    }];

    render(
      <MarketWatchPanel
        allSymbols={stocks}
        selectedSymbol="MSFT"
        onSymbolSelect={vi.fn()}
      />,
    );

    const search = screen.getByRole('combobox', { name: 'Add symbol' });
    fireEvent.focus(search);
    fireEvent.click(screen.getByRole('option', { name: 'Stocks 2 of 4' }));

    const group = screen.getByRole('listbox', { name: 'Stocks symbols' });
    const options = within(group).getAllByRole('option');
    expect(options.map((option) => option.getAttribute('aria-label'))).toEqual([
      'MSFT',
      'AAPL',
      'NVDA',
      'TSLA',
    ]);
    expect(options.map((option) => option.getAttribute('data-subscribed'))).toEqual([
      'true',
      'true',
      'false',
      'false',
    ]);
    expect(within(options[0]).getByText('Subscribed')).toHaveClass('rtx-market-watch__subscribed-badge');
    expect(within(options[1]).getByText('Subscribed')).toHaveClass('rtx-market-watch__subscribed-badge');
    expect(within(options[2]).queryByText('Subscribed')).not.toBeInTheDocument();
    expect(within(options[3]).queryByText('Subscribed')).not.toBeInTheDocument();
  });

  it('drills into groups supplied by broker category metadata', () => {
    const brokerInstruments: MockMarketInstrument[] = [
      { symbol: 'EURUSD', category: 'Forex.Majors' },
      { symbol: 'GOLDmicro', category: 'Metals.Spot' },
      { symbol: 'DE40', category: 'Indices.Cash' },
    ];
    setMarketCatalog(brokerInstruments);
    marketHooks.activeSymbols = brokerInstruments.map(({ symbol }) => symbol.toUpperCase());

    render(
      <MarketWatchPanel
        allSymbols={brokerInstruments}
        selectedSymbol="EURUSD"
        onSymbolSelect={vi.fn()}
      />,
    );

    const search = screen.getByRole('combobox', { name: 'Add symbol' });
    fireEvent.focus(search);
    fireEvent.click(screen.getByRole('option', { name: 'Metals 1 of 1' }));

    const back = screen.getByRole('button', { name: 'Back to symbol groups' });
    const metals = screen.getByRole('listbox', { name: 'Metals symbols' });
    expect(back).toHaveTextContent('Metals');
    expect(within(metals).getByRole('option', { name: 'GOLDMICRO' })).toBeInTheDocument();
    expect(within(metals).queryByRole('option', { name: 'DE40' })).not.toBeInTheDocument();

    fireEvent.click(back);
    expect(screen.getByRole('listbox', { name: 'Symbol groups' })).toBeInTheDocument();
  });

  it('shows the broker full name beneath each symbol code', () => {
    const brokerInstruments: MockMarketInstrument[] = [
      { symbol: 'XAUUSD', name: 'Gold vs US Dollar', description: 'XAUUSD', category: 'Metals.Spot' },
    ];
    setMarketCatalog(brokerInstruments);
    marketHooks.activeSymbols = ['XAUUSD'];

    render(
      <MarketWatchPanel
        allSymbols={brokerInstruments}
        selectedSymbol="XAUUSD"
        onSymbolSelect={vi.fn()}
      />,
    );

    const search = screen.getByRole('combobox', { name: 'Add symbol' });
    fireEvent.focus(search);
    fireEvent.click(screen.getByRole('option', { name: 'Metals 1 of 1' }));

    const option = screen.getByRole('option', { name: 'XAUUSD, Gold vs US Dollar' });
    expect(within(option).getByText('XAUUSD')).toHaveClass('rtx-market-watch__symbol');
    expect(within(option).getByText('Gold vs US Dollar')).toHaveClass('rtx-market-watch__symbol-description');
    expect(option.style.height).toBe('48px');
  });

  it('searches the full broker universe instead of staying inside a drilled-down group', () => {
    const matchingSymbols = Array.from(
      { length: 18 },
      (_, index) => `MATCH${String(index + 1).padStart(2, '0')}`,
    );
    const brokerInstruments: MockMarketInstrument[] = matchingSymbols.map((symbol, index) => ({
      symbol,
      category: index % 2 === 0 ? 'Forex.Majors' : 'Metals.Spot',
    }));
    setMarketCatalog(brokerInstruments);
    marketHooks.activeSymbols = [...matchingSymbols];

    render(
      <MarketWatchPanel
        allSymbols={brokerInstruments}
        selectedSymbol="MATCH01"
        onSymbolSelect={vi.fn()}
      />,
    );

    const search = screen.getByRole('combobox', { name: 'Add symbol' });
    fireEvent.focus(search);
    fireEvent.click(screen.getByRole('option', { name: 'Forex 1 of 9' }));
    fireEvent.change(search, { target: { value: 'match' } });

    const results = screen.getByRole('listbox', { name: 'Symbol search results' });
    const firstResult = within(results).getByRole('option', { name: 'MATCH01' });
    expect(firstResult).toHaveAttribute('aria-setsize', '18');
    expect(within(results).getByRole('option', { name: 'MATCH02' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Back to symbol groups' })).not.toBeInTheDocument();
  });

  it('handles Escape in stages from typed search to group to groups to the table', () => {
    const publicCatalog = [...DEFAULT_SYMBOLS, 'ETHUSD', '0001.HK'];
    setMarketCatalog(publicCatalog);
    render(
      <MarketWatchPanel
        allSymbols={publicCatalog}
        selectedSymbol="BTCUSD"
        onSymbolSelect={vi.fn()}
      />,
    );

    const search = screen.getByRole('combobox', { name: 'Add symbol' });
    act(() => search.focus());
    fireEvent.click(screen.getByRole('option', { name: 'Crypto 1 of 2' }));
    fireEvent.change(search, { target: { value: 'eth' } });
    expect(screen.getByRole('listbox', { name: 'Symbol search results' })).toBeInTheDocument();

    fireEvent.keyDown(search, { key: 'Escape' });
    expect(screen.getByRole('combobox', { name: 'Add symbol' })).toBe(search);
    expect(search).toHaveFocus();
    expect(search).toHaveValue('');
    expect(screen.getByRole('listbox', { name: 'Crypto symbols' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Back to symbol groups' })).toBeInTheDocument();

    fireEvent.keyDown(search, { key: 'Escape' });
    expect(screen.getByRole('combobox', { name: 'Add symbol' })).toBe(search);
    expect(search).toHaveFocus();
    expect(screen.getByRole('listbox', { name: 'Symbol groups' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Back to symbol groups' })).not.toBeInTheDocument();

    fireEvent.keyDown(search, { key: 'Escape' });
    expect(screen.getByRole('combobox', { name: 'Add symbol' })).toBe(search);
    expect(search).toHaveAttribute('aria-expanded', 'false');
    expect(search).not.toHaveFocus();
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
    expect(screen.getByRole('table')).toBeInTheDocument();
  });

  it('closes symbol search and restores the table after a successful selection', () => {
    const publicCatalog = [...DEFAULT_SYMBOLS, 'ETHUSD'];
    setMarketCatalog(publicCatalog);
    marketHooks.activeSymbols = [...DEFAULT_SYMBOLS];
    const onSymbolSelect = vi.fn();
    const { container } = render(
      <MarketWatchPanel
        allSymbols={publicCatalog}
        selectedSymbol="BTCUSD"
        onSymbolSelect={onSymbolSelect}
      />,
    );

    const search = screen.getByRole('combobox', { name: 'Add symbol' });
    fireEvent.focus(search);
    fireEvent.change(search, { target: { value: 'eth' } });
    fireEvent.click(screen.getByRole('option', { name: /ETHUSD/ }));

    expect(onSymbolSelect).toHaveBeenCalledWith('ETHUSD');
    expect(search).toHaveValue('');
    expect(search).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
    expect(screen.getByRole('table')).toBeInTheDocument();
    expect(getRenderedRowSymbols(container)).toEqual([...CORE_DEFAULT_SYMBOLS, 'ETHUSD']);
  });

  it('virtualizes a group larger than 15 symbols and reaches its last item after scrolling', () => {
    const forexSymbols = Array.from(
      { length: 24 },
      (_, index) => `FX${String(index + 1).padStart(4, '0')}`,
    );
    const brokerInstruments: MockMarketInstrument[] = forexSymbols.map((symbol) => ({
      symbol,
      category: 'Forex.Majors',
    }));
    setMarketCatalog(brokerInstruments);
    marketHooks.activeSymbols = [...forexSymbols];

    render(
      <MarketWatchPanel
        allSymbols={brokerInstruments}
        selectedSymbol={forexSymbols[0]}
        onSymbolSelect={vi.fn()}
      />,
    );

    const search = screen.getByRole('combobox', { name: 'Add symbol' });
    fireEvent.focus(search);
    fireEvent.click(screen.getByRole('option', { name: 'Forex 1 of 24' }));

    const symbolScroll = screen.getByTestId('market-watch-symbol-scroll');
    const lastSymbol = forexSymbols.at(-1)!;
    expect(within(symbolScroll).queryByRole('option', { name: lastSymbol })).not.toBeInTheDocument();

    Object.defineProperty(symbolScroll, 'clientHeight', { configurable: true, value: 180 });
    symbolScroll.scrollTop = forexSymbols.length * 48;
    fireEvent.scroll(symbolScroll);

    const lastOption = within(symbolScroll).getByRole('option', { name: lastSymbol });
    expect(lastOption).toHaveAttribute('aria-posinset', '24');
    expect(lastOption).toHaveAttribute('aria-setsize', '24');
  });

  it('lets Delete hide a built-in symbol and lets search restore it', () => {
    const onSymbolSelect = vi.fn();
    const { container } = render(
      <MarketWatchPanel
        allSymbols={DEFAULT_SYMBOLS}
        selectedSymbol="EURUSD"
        onSymbolSelect={onSymbolSelect}
      />,
    );

    const selectedRow = screen.getByText('EURUSD').closest('tr')!;
    fireEvent.click(selectedRow);
    fireEvent.keyDown(selectedRow, { key: 'Delete' });
    expect(getRenderedRowSymbols(container)).toEqual(['XAUUSD', 'BTCUSD']);
    expect(JSON.parse(localStorage.getItem('rtx5_hidden_symbols') ?? '[]')).toEqual(['EURUSD']);

    const search = screen.getByRole('combobox', { name: 'Add symbol' });
    fireEvent.change(search, { target: { value: 'eur' } });
    fireEvent.keyDown(search, { key: 'ArrowDown' });
    fireEvent.keyDown(search, { key: 'Enter' });

    expect(onSymbolSelect).toHaveBeenCalledWith('EURUSD');
    expect(getRenderedRowSymbols(container)).toEqual(DEFAULT_DISPLAY_SYMBOLS);
    expect(JSON.parse(localStorage.getItem('rtx5_hidden_symbols') ?? '[]')).toEqual([]);
    expect(screen.queryByText('Hide All')).not.toBeInTheDocument();
  });

  it('owns Delete only for a focused Market Watch row and yields other controls', () => {
    const { container } = render(<MarketWatchPanel allSymbols={DEFAULT_SYMBOLS} selectedSymbol="EURUSD" onSymbolSelect={vi.fn()} />);
    const globalDelete = vi.fn();
    const unregister = keyboardShortcutManager.register({ id: 'test.chart-delete', key: 'Delete', description: 'Delete drawing', handler: globalDelete });
    const dispose = keyboardShortcutManager.initialize();
    const menu = document.createElement('div'); menu.setAttribute('role', 'menu');
    const menuButton = document.createElement('button'); menu.append(menuButton);
    container.querySelector('.rtx-market-watch')!.append(menu);
    try {
      fireEvent.keyDown(document.body, { key: 'Delete' });
      expect(globalDelete).toHaveBeenCalledOnce();
      expect(getRenderedRowSymbols(container)).toEqual(DEFAULT_DISPLAY_SYMBOLS);
      fireEvent.keyDown(menuButton, { key: 'Delete' });
      expect(getRenderedRowSymbols(container)).toEqual(DEFAULT_DISPLAY_SYMBOLS);
      const search = screen.getByRole('combobox', { name: 'Add symbol' });
      fireEvent.keyDown(search, { key: 'Delete' });
      expect(getRenderedRowSymbols(container)).toEqual(DEFAULT_DISPLAY_SYMBOLS);
      const row = screen.getByText('EURUSD').closest('tr')!;
      fireEvent.click(row); expect(row).toHaveFocus();
      fireEvent.keyDown(row, { key: 'Delete', repeat: true });
      expect(getRenderedRowSymbols(container)).toEqual(DEFAULT_DISPLAY_SYMBOLS);
      fireEvent.keyDown(row, { key: 'Delete' });
      expect(getRenderedRowSymbols(container)).toEqual(['XAUUSD', 'BTCUSD']);
      expect(globalDelete).toHaveBeenCalledOnce();
    } finally { dispose(); unregister(); menu.remove(); }
  });

  it('does not override Ctrl+U or trade shortcuts while editing or browsing a local dialog', () => {
    const { container } = render(<MarketWatchPanel allSymbols={DEFAULT_SYMBOLS} selectedSymbol="EURUSD" onSymbolSelect={vi.fn()} />);
    const openOrder = vi.fn(); const openDepth = vi.fn();
    window.addEventListener('openNewOrder', openOrder); window.addEventListener('openDepthOfMarket', openDepth);
    const help = document.createElement('div'); help.setAttribute('role', 'dialog'); help.dataset.shortcutScope = 'local';
    const button = document.createElement('button'); help.append(button); container.querySelector('.rtx-market-watch')!.append(help);
    try {
      const search = screen.getByRole('combobox', { name: 'Add symbol' });
      fireEvent.change(search, { target: { value: 'eth' } });
      fireEvent.keyDown(search, { key: 'u', ctrlKey: true });
      expect(search).toHaveValue('eth');
      for (const target of [search, button, document.body]) {
        fireEvent.keyDown(target, { key: 'F9' });
        fireEvent.keyDown(target, { key: 'b', altKey: true });
      }
      expect(openOrder).not.toHaveBeenCalled(); expect(openDepth).not.toHaveBeenCalled();
    } finally {
      window.removeEventListener('openNewOrder', openOrder); window.removeEventListener('openDepthOfMarket', openDepth); help.remove();
    }
  });

  it('adds symbols through the inline footer with keyboard search and a live visible/total count', () => {
    const publicCatalog = [...DEFAULT_SYMBOLS, 'ETHUSD'];
    setMarketCatalog(publicCatalog);
    const onSymbolSelect = vi.fn();
    const { container } = render(
      <MarketWatchPanel
        allSymbols={publicCatalog}
        selectedSymbol="BTCUSD"
        onSymbolSelect={onSymbolSelect}
      />,
    );

    expect(screen.queryByRole('button', { name: 'Focus symbol search' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Add symbol' })).not.toBeInTheDocument();
    const search = screen.getByRole('combobox', { name: 'Add symbol' });
    expect(search).toHaveAttribute('placeholder', 'click to add...');
    expect(screen.getByText('3 / 6')).toBeInTheDocument();
    act(() => search.focus());
    expect(search).toHaveFocus();

    fireEvent.keyDown(window, { key: 'u', ctrlKey: true });
    fireEvent.change(search, { target: { value: 'eth' } });

    const listbox = screen.getByRole('listbox', { name: 'Symbol search results' });
    const option = screen.getByRole('option', { name: /ETHUSD/ });
    expect(search).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByRole('combobox', { name: 'Add symbol' })).toBe(search);
    expect(search).toHaveFocus();
    expect(search).toHaveAttribute('aria-controls', listbox.id);

    fireEvent.keyDown(search, { key: 'ArrowDown' });
    expect(option).toHaveAttribute('aria-selected', 'true');
    expect(search).toHaveAttribute('aria-activedescendant', option.id);

    fireEvent.keyDown(search, { key: 'Enter' });
    expect(onSymbolSelect).toHaveBeenCalledWith('ETHUSD');
    expect(getRenderedRowSymbols(container)).toEqual([...CORE_DEFAULT_SYMBOLS, 'ETHUSD']);
    expect(screen.getByText('4 / 6')).toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: 'Add symbol' })).toBe(search);
    expect(search).toHaveAttribute('aria-expanded', 'false');
  });

  it('selects a searched public-catalog symbol and appends it to the curated grid subscription', () => {
    const publicCatalog = [...DEFAULT_SYMBOLS, 'ETHUSD'];
    setMarketCatalog(publicCatalog);
    marketHooks.activeSymbols = [...DEFAULT_SYMBOLS];
    const onSymbolSelect = vi.fn();
    const openChartListener = vi.fn();
    window.addEventListener('openChart', openChartListener);
    const { container } = render(
      <MarketWatchPanel
        allSymbols={publicCatalog}
        selectedSymbol="BTCUSD"
        onSymbolSelect={onSymbolSelect}
      />,
    );

    fireEvent.change(screen.getByLabelText('Add symbol'), { target: { value: 'eth' } });
    fireEvent.click(screen.getByText('ETHUSD'));

    expect(onSymbolSelect).toHaveBeenCalledWith('ETHUSD');
    expect(onSymbolSelect).toHaveBeenCalledTimes(1);
    expect(openChartListener).not.toHaveBeenCalled();
    expect(getRenderedRowSymbols(container)).toEqual([...CORE_DEFAULT_SYMBOLS, 'ETHUSD']);
    expect(screen.getByText('ETHUSD')).toBeInTheDocument();
    expect(marketHooks.useLiveQuotes).toHaveBeenCalledWith([...CORE_DEFAULT_SYMBOLS, 'ETHUSD']);
    expect(marketHooks.reloadActiveSymbols).toHaveBeenCalledTimes(1);

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
    const option = screen.getByRole('option', { name: /EURUSD/ });
    fireEvent.click(option);

    expect(onSymbolSelect).toHaveBeenCalledWith('EURUSD');
    expect(onSymbolSelect).toHaveBeenCalledTimes(1);
    expect(openChartListener).not.toHaveBeenCalled();
    expect(getRenderedRowSymbols(container)).toEqual(DEFAULT_DISPLAY_SYMBOLS);
    expect(screen.getByText('EURUSD')).toBeInTheDocument();
    expect(screen.queryByText('EUROUSD')).not.toBeInTheDocument();
    expect(marketHooks.useLiveQuotes).toHaveBeenCalledWith(CORE_DEFAULT_SYMBOLS);

    window.removeEventListener('openChart', openChartListener);
  });

  it('displays EURUSD while preserving an EUROUSD-only broker identity', () => {
    const brokerSymbols = DEFAULT_SYMBOLS.map((symbol) => symbol === 'EURUSD' ? 'EUROUSD' : symbol);
    const brokerDefaultSymbols = CORE_DEFAULT_SYMBOLS.map((symbol) => symbol === 'EURUSD' ? 'EUROUSD' : symbol);
    marketHooks.activeSymbols = brokerSymbols;
    setMarketCatalog(brokerSymbols);
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
    fireEvent.click(screen.getByRole('option', { name: /EURUSD/ }));

    expect(onSymbolSelect).toHaveBeenCalledWith('EUROUSD');
    expect(onSymbolSelect).toHaveBeenCalledTimes(1);
    expect(openChartListener).not.toHaveBeenCalled();
    expect(screen.getByText('EURUSD')).toBeInTheDocument();
    expect(screen.queryByText('EUROUSD')).not.toBeInTheDocument();
    expect(marketHooks.useLiveQuotes).toHaveBeenCalledWith(brokerDefaultSymbols);

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
    expect(btcRow?.querySelector('.rtx-market-watch__status')).toBeNull();
    expect(btcRow).toHaveTextContent('65000');
    expect(container.querySelectorAll('tbody tr[aria-disabled="false"]')).toHaveLength(0);
  });

  it('does not show a loading label beside the symbol while feed status and the catalog settle', () => {
    marketHooks.activeSymbols = [...DEFAULT_SYMBOLS];
    marketHooks.activeSymbolsLoading = false;
    marketHooks.activeSymbolsSettled = false;
    marketHooks.activeSymbolsCurrent = false;
    setMarketCatalog(DEFAULT_SYMBOLS, []);
    marketHooks.instrumentsLoading = true;
    act(() => {
      useAppStore.getState().setTick('BTCUSD', {
        symbol: 'BTCUSD',
        bid: 65000,
        ask: 65001,
        spread: 1,
        dailyChange: 0.19,
        timestamp: Date.now() - (14 * 60 * 60 * 1000),
      });
    });

    const { container } = render(
      <MarketWatchPanel
        allSymbols={[]}
        selectedSymbol="BTCUSD"
        onSymbolSelect={vi.fn()}
      />,
    );

    const btcRow = screen.getByText('BTCUSD').closest('tr');
    expect(btcRow).not.toHaveTextContent('LOADING');
    expect(btcRow?.querySelector('.rtx-market-watch__status')).toBeNull();
    expect(btcRow?.querySelector('td')).toHaveTextContent(/^BTCUSD$/);
    expect(btcRow).toHaveTextContent('65000');
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

  it('keeps an account-disabled public symbol live but non-actionable', () => {
    act(() => useAppStore.setState({ isAuthenticated: true }));
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
    expect(row).not.toHaveTextContent('UNAVAILABLE');
    expect(row).toHaveTextContent('2400');
    expect(marketHooks.useLiveQuotes).toHaveBeenCalledWith(CORE_DEFAULT_SYMBOLS);

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
    expect(row?.querySelector('.rtx-market-watch__status')).toBeNull();
    expect(row).toHaveTextContent('3500');
    fireEvent.click(row!);
    expect(onSymbolSelect).toHaveBeenCalledWith('ETHUSD');
  });

  it('renders and subscribes only the persisted symbols for a custom watchlist', () => {
    setMarketCatalog([...DEFAULT_SYMBOLS, 'ETHUSD']);
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
    expect(marketHooks.useLiveQuotes).toHaveBeenCalledWith(['ETHUSD']);
  });

  it('does not leak manual symbols across built-in and custom watchlist switches', () => {
    const publicCatalog = [...DEFAULT_SYMBOLS, 'ETHUSD', '0001.HK'];
    const curatedBuiltIn = [...CORE_DEFAULT_SYMBOLS, '0001.HK'];
    setMarketCatalog(publicCatalog);
    const props = {
      allSymbols: publicCatalog,
      selectedSymbol: 'BTCUSD',
      onSymbolSelect: vi.fn(),
    };
    const { container, rerender } = render(<MarketWatchPanel {...props} />);

    fireEvent.change(screen.getByLabelText('Add symbol'), { target: { value: 'eth' } });
    fireEvent.click(screen.getByRole('option', { name: /ETHUSD/ }));
    expect(getRenderedRowSymbols(container)).toEqual([...curatedBuiltIn, 'ETHUSD']);

    watchlistState.activeWatchlistId = 'custom';
    watchlistState.watchlists = [{ id: 'custom', symbols: ['0001.HK'], isDefault: false }];
    rerender(<MarketWatchPanel {...props} selectedSymbol="0001.HK" />);

    expect(getRenderedRowSymbols(container)).toEqual(['0001.HK']);
    expect(marketHooks.useLiveQuotes).toHaveBeenCalledWith(['0001.HK']);

    fireEvent.change(screen.getByLabelText('Add symbol'), { target: { value: 'eth' } });
    fireEvent.click(screen.getByRole('option', { name: /ETHUSD/ }));
    expect(getRenderedRowSymbols(container)).toEqual(['0001.HK', 'ETHUSD']);
    expect(watchlistState.addSymbolToWatchlist).toHaveBeenLastCalledWith('custom', 'ETHUSD');

    watchlistState.activeWatchlistId = 'majors';
    watchlistState.watchlists = [{ id: 'majors', symbols: [], isDefault: true }];
    rerender(<MarketWatchPanel {...props} />);

    expect(getRenderedRowSymbols(container)).toEqual(curatedBuiltIn);
    expect(marketHooks.useLiveQuotes).toHaveBeenCalledWith(curatedBuiltIn);
  });

  it('enables Hide for curated defaults, persists it, and gives every action a clear icon', () => {
    const publicCatalog = [...DEFAULT_SYMBOLS, 'ETHUSD', '0001.HK'];
    const curatedBuiltIn = [...CORE_DEFAULT_SYMBOLS, '0001.HK'];
    setMarketCatalog(publicCatalog);
    watchlistState.activeWatchlistId = 'majors';
    watchlistState.watchlists = [{ id: 'majors', symbols: [], isDefault: true }];
    const { container } = render(
      <MarketWatchPanel
        allSymbols={publicCatalog}
        selectedSymbol="BTCUSD"
        onSymbolSelect={vi.fn()}
      />,
    );

    fireEvent.contextMenu(screen.getByText('0001.HK').closest('tr')!);
    const menu = screen.getByRole('menu');
    const iconLabels = [
      'New Order',
      'Chart Window',
      'Depth Of Market',
      'Specification',
      'Hide',
      'Hide All',
      'Show All',
      'Symbols',
      'Export',
    ];
    iconLabels.forEach((label) => {
      expect(within(menu).getByText(label).closest('[role="menuitem"]')?.querySelector('svg')).not.toBeNull();
    });
    expect(screen.getByText('Hide').closest('[role="menuitem"]')).not.toHaveAttribute('aria-disabled', 'true');
    fireEvent.click(screen.getByText('Hide'));
    expect(getRenderedRowSymbols(container)).toEqual(curatedBuiltIn.filter((symbol) => symbol !== '0001.HK'));
    expect(JSON.parse(localStorage.getItem('rtx5_hidden_symbols') ?? '[]')).toContain('0001.HK');
    expect(watchlistState.removeSymbolFromWatchlist).not.toHaveBeenCalled();
  });

  it('hides every hideable built-in symbol, retains symbols used by an open chart, and restores all', () => {
    setMarketCatalog([...DEFAULT_SYMBOLS, '0001.HK']);
    const { container } = render(
      <MarketWatchPanel
        allSymbols={[...DEFAULT_SYMBOLS, '0001.HK']}
        selectedSymbol="XAUUSD"
        onSymbolSelect={vi.fn()}
      />,
    );

    fireEvent.contextMenu(screen.getByText('XAUUSD').closest('tr')!);
    fireEvent.click(screen.getByText('Hide All'));
    expect(getRenderedRowSymbols(container)).toEqual(['BTCUSD']);

    fireEvent.contextMenu(screen.getByText('BTCUSD').closest('tr')!);
    fireEvent.click(screen.getByText('Show All'));
    expect(getRenderedRowSymbols(container)).toEqual([
      ...DEFAULT_DISPLAY_SYMBOLS,
      '0001.HK',
      'GBPUSD',
      'USDJPY',
    ]);
    expect(JSON.parse(localStorage.getItem('rtx5_hidden_symbols') ?? '[]')).toEqual([]);
  });

  it('opens an in-app specification dialog instead of a browser alert', async () => {
    const alertSpy = vi.spyOn(window, 'alert').mockImplementation(() => undefined);
    const onSymbolSelect = vi.fn();
    setMarketCatalog([{
      symbol: 'XAUUSD',
      description: 'Gold Spot',
      category: 'Metals',
      digits: 2,
      contract_size: 100,
      trading_enabled: true,
    }]);
    render(
      <MarketWatchPanel
        allSymbols={[{
          symbol: 'XAUUSD',
          description: 'Gold Spot',
          category: 'Metals',
          digits: 2,
          contract_size: 100,
          trading_enabled: true,
        }]}
        selectedSymbol="BTCUSD"
        onSymbolSelect={onSymbolSelect}
      />,
    );

    const specificationRow = screen.getByText('XAUUSD').closest('tr')!;
    fireEvent.contextMenu(specificationRow);
    expect(specificationRow).toHaveAttribute('aria-selected', 'true');
    expect(onSymbolSelect).not.toHaveBeenCalled();
    fireEvent.click(screen.getByText('Specification'));
    await act(async () => { await vi.dynamicImportSettled(); });

    expect(screen.getByRole('dialog', { name: 'XAUUSD Specification' })).toBeInTheDocument();
    expect(screen.getByText('XAUUSD, Gold Spot')).toBeInTheDocument();
    expect(screen.getByText('Contract size').parentElement?.parentElement).toHaveTextContent('100');
    expect(screen.queryByText('2400.00')).not.toBeInTheDocument();
    expect(screen.queryByText('2400.20')).not.toBeInTheDocument();
    expect(alertSpy).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Close symbol specification' }));
    expect(screen.queryByRole('dialog', { name: 'XAUUSD Specification' })).not.toBeInTheDocument();
    alertSpy.mockRestore();
  });

  it('does not present a public live quote spread as a contract specification', async () => {
    const quoteOnlyInstrument: MockMarketInstrument = {
      symbol: 'XAUUSD',
      bid: 4305.9,
      ask: 4306.7,
      spread: 0.8,
      time: '2026-09-25T10:36:34Z',
      has_quote: true,
    };
    setMarketCatalog([quoteOnlyInstrument]);
    render(
      <MarketWatchPanel
        allSymbols={[quoteOnlyInstrument]}
        selectedSymbol="XAUUSD"
        onSymbolSelect={vi.fn()}
      />,
    );

    fireEvent.contextMenu(screen.getByText('XAUUSD').closest('tr')!);
    fireEvent.click(screen.getByText('Specification'));
    await act(async () => { await vi.dynamicImportSettled(); });

    expect(screen.getByText('Spread').parentElement?.parentElement).toHaveTextContent('0');
    expect(screen.queryByText('0.8')).not.toBeInTheDocument();
  });

  it('prefers the authenticated broker specification over public catalog metadata', async () => {
    const publicInstrument: MockMarketInstrument = {
      symbol: 'XAUUSD',
      description: 'Public Gold',
      category: 'Metals',
      digits: 2,
      contract_size: 100,
      trading_enabled: true,
    };
    setMarketCatalog([publicInstrument]);
    marketHooks.authorizedInstruments = [{
      symbol: 'XAUUSD',
      brokerSpecification: {
        symbol: 'XAUUSD',
        display_name: 'Authenticated Gold Contract',
        specification: {
          contract_size: 250,
          trade_tick_value: 2.5,
        },
      },
    }];
    marketHooks.loadSymbolSpecification.mockResolvedValue({
      symbol: 'XAUUSD',
      display_name: 'Authenticated Gold Contract',
      specification: {
        contract_size: 250,
        trade_tick_value: 2.5,
      },
    });
    act(() => useAppStore.setState({ isAuthenticated: true }));

    render(
      <MarketWatchPanel
        allSymbols={[publicInstrument]}
        selectedSymbol="XAUUSD"
        onSymbolSelect={vi.fn()}
      />,
    );

    fireEvent.contextMenu(screen.getByText('XAUUSD').closest('tr')!);
    fireEvent.click(screen.getByText('Specification'));
    await act(async () => { await vi.dynamicImportSettled(); });

    expect(screen.getByText('XAUUSD, Authenticated Gold Contract')).toBeInTheDocument();
    const contractSizeRow = screen.getByText('Contract size').parentElement?.parentElement;
    expect(contractSizeRow).toHaveTextContent('250');
    expect(contractSizeRow).not.toHaveTextContent('100');
    const tickValueRow = screen.getByText('Tick value').parentElement?.parentElement;
    expect(tickValueRow).toHaveTextContent('2.5');
  });

  it('refreshes the exact clicked specification from the account-scoped backend contract', async () => {
    const catalogInstrument: MockMarketInstrument = {
      symbol: 'XAUUSD',
      description: 'Catalog Gold',
      contract_size: 100,
    };
    setMarketCatalog([catalogInstrument]);
    marketHooks.authorizedInstruments = [catalogInstrument];
    marketHooks.loadSymbolSpecification.mockResolvedValue({
      symbol: 'XAUUSD',
      description: 'Fresh Broker Gold',
      contract_size: 250,
      specification: {
        stops_level: 12,
        execution_mode: 'market',
      },
    });
    act(() => useAppStore.setState({ isAuthenticated: true }));

    render(
      <MarketWatchPanel
        allSymbols={[catalogInstrument]}
        selectedSymbol="XAUUSD"
        onSymbolSelect={vi.fn()}
      />,
    );

    fireEvent.contextMenu(screen.getByText('XAUUSD').closest('tr')!);
    fireEvent.click(screen.getByText('Specification'));
    await act(async () => {
      await vi.dynamicImportSettled();
      await Promise.resolve();
    });

    expect(marketHooks.loadSymbolSpecification).toHaveBeenCalledWith(
      'XAUUSD',
      expect.any(AbortSignal),
    );
    expect(screen.getByText('XAUUSD, Fresh Broker Gold')).toBeInTheDocument();
    expect(screen.getByText('Stops level').parentElement?.parentElement).toHaveTextContent('12');
    expect(screen.getByText('Execution').parentElement?.parentElement).toHaveTextContent('Market');
  });

  it('does not present catalog values as current while the account specification is loading', async () => {
    const catalogInstrument: MockMarketInstrument = {
      symbol: 'XAUUSD',
      description: 'Catalog Gold',
      contract_size: 100,
    };
    setMarketCatalog([catalogInstrument]);
    marketHooks.authorizedInstruments = [catalogInstrument];
    let resolveSpecification: ((value: Readonly<Record<string, unknown>> | null) => void) | undefined;
    marketHooks.loadSymbolSpecification.mockImplementation(() => new Promise((resolve) => {
      resolveSpecification = resolve;
    }));
    act(() => useAppStore.setState({ isAuthenticated: true }));

    render(
      <MarketWatchPanel
        allSymbols={[catalogInstrument]}
        selectedSymbol="XAUUSD"
        onSymbolSelect={vi.fn()}
      />,
    );
    fireEvent.contextMenu(screen.getByText('XAUUSD').closest('tr')!);
    fireEvent.click(screen.getByText('Specification'));
    await act(async () => { await vi.dynamicImportSettled(); });

    expect(screen.getByRole('status')).toHaveTextContent('Loading current specification...');
    expect(screen.queryByText('Contract size')).not.toBeInTheDocument();

    await act(async () => {
      resolveSpecification?.(null);
      await Promise.resolve();
    });
    expect(screen.getByText('Contract size').parentElement?.parentElement).toHaveTextContent('0');
    expect(screen.getByText('Contract size').parentElement?.parentElement).not.toHaveTextContent('100');
  });

  it('aborts an in-flight specification refresh when the dialog closes', async () => {
    setMarketCatalog([{ symbol: 'XAUUSD', contract_size: 100 }]);
    marketHooks.authorizedInstruments = [{ symbol: 'XAUUSD', contract_size: 100 }];
    let resolveSpecification: ((value: Readonly<Record<string, unknown>>) => void) | undefined;
    marketHooks.loadSymbolSpecification.mockImplementation(() => new Promise((resolve) => {
      resolveSpecification = resolve;
    }));
    act(() => useAppStore.setState({ isAuthenticated: true }));

    render(
      <MarketWatchPanel
        allSymbols={[{ symbol: 'XAUUSD', contract_size: 100 }]}
        selectedSymbol="XAUUSD"
        onSymbolSelect={vi.fn()}
      />,
    );
    fireEvent.contextMenu(screen.getByText('XAUUSD').closest('tr')!);
    fireEvent.click(screen.getByText('Specification'));
    await act(async () => { await vi.dynamicImportSettled(); });

    const signal = marketHooks.loadSymbolSpecification.mock.calls[0]?.[1] as AbortSignal;
    expect(signal.aborted).toBe(false);
    fireEvent.click(screen.getByRole('button', { name: 'Close symbol specification' }));
    expect(signal.aborted).toBe(true);

    await act(async () => {
      resolveSpecification?.({ symbol: 'XAUUSD', description: 'Late result' });
      await Promise.resolve();
    });
    expect(screen.queryByTestId('symbol-specification-dialog')).not.toBeInTheDocument();
  });

  it('removes and persists custom-watchlist symbols through Hide and Hide All', () => {
    const publicCatalog = [...DEFAULT_SYMBOLS, 'ETHUSD', '0001.HK'];
    setMarketCatalog(publicCatalog);
    watchlistState.activeWatchlistId = 'custom';
    watchlistState.watchlists = [{
      id: 'custom',
      symbols: ['ETHUSD', '0001.HK'],
      isDefault: false,
    }];
    const { container } = render(
      <MarketWatchPanel
        allSymbols={publicCatalog}
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
      publicCatalog,
    );
    expect(getRenderedRowSymbols(container)).toEqual(publicCatalog);
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
    expect(watchlistState.removeSymbolFromWatchlist).not.toHaveBeenCalled();
    const selectedRow = screen.getByText('ETHUSD').closest('tr')!;
    fireEvent.click(selectedRow);
    fireEvent.keyDown(selectedRow, { key: 'Delete' });
    expect(watchlistState.removeSymbolFromWatchlist).toHaveBeenCalledWith('custom', 'ETHUSD');
  });

  it('uses curated defaults for a built-in watchlist regardless of its persisted subset', () => {
    const publicCatalog = [...DEFAULT_SYMBOLS, 'SOLUSD'];
    watchlistState.activeWatchlistId = 'majors';
    watchlistState.watchlists = [{
      id: 'majors',
      symbols: [...DEFAULT_SYMBOLS, 'SOLUSD'],
      isDefault: true,
    }];
    marketHooks.activeSymbols = [...publicCatalog];
    setMarketCatalog(publicCatalog);

    const { container } = render(
      <MarketWatchPanel
        allSymbols={publicCatalog}
        selectedSymbol="BTCUSD"
        onSymbolSelect={vi.fn()}
      />,
    );

    expect(getRenderedRowSymbols(container)).toEqual(CORE_DEFAULT_SYMBOLS);
    expect(screen.queryByText('SOLUSD')).not.toBeInTheDocument();
    expect(marketHooks.useLiveQuotes).toHaveBeenCalledWith(CORE_DEFAULT_SYMBOLS);
  });

  it('subscribes curated defaults but keeps them non-actionable while the account catalog is empty', () => {
    act(() => useAppStore.setState({ isAuthenticated: true }));
    marketHooks.activeSymbols = ['xauusd', 'BTCUSD', 'eurusd', 'GBPUSD', 'USDJPY', 'XAUUSD', '0001.HK'];
    setMarketCatalog(DEFAULT_SYMBOLS, []);

    const { container } = render(
      <MarketWatchPanel
        allSymbols={[]}
        selectedSymbol="BTCUSD"
        onSymbolSelect={vi.fn()}
      />,
    );

    expect(getRenderedRowSymbols(container)).toEqual(DEFAULT_DISPLAY_SYMBOLS);
    expect(screen.queryByText(/\d+ symbols/)).not.toBeInTheDocument();
    expect(marketHooks.useLiveQuotes).toHaveBeenCalledWith(CORE_DEFAULT_SYMBOLS);
    expect(container.querySelectorAll('tbody tr[aria-disabled="true"]')).toHaveLength(3);

    fireEvent.change(screen.getByLabelText('Add symbol'), { target: { value: '0001' } });
    expect(screen.getByText('No matches found')).toBeInTheDocument();
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

    expect(getRenderedRowSymbols(container)).toEqual([]);
    expect(marketHooks.useLiveQuotes).toHaveBeenCalledWith([]);
    expect(container.querySelectorAll('tbody tr[aria-disabled="true"]')).toHaveLength(0);
    expect(screen.queryByText(/\d+ symbols/)).not.toBeInTheDocument();
  });

  it('keeps curated public defaults streaming while authenticated authorization is still loading', () => {
    act(() => useAppStore.setState({ isAuthenticated: true }));
    marketHooks.activeSymbols = [...DEFAULT_SYMBOLS];
    setMarketCatalog(DEFAULT_SYMBOLS, []);
    marketHooks.instrumentsLoading = true;

    const { container } = render(
      <MarketWatchPanel
        allSymbols={[]}
        selectedSymbol="BTCUSD"
        onSymbolSelect={vi.fn()}
      />,
    );

    expect(getRenderedRowSymbols(container)).toEqual(CORE_DEFAULT_SYMBOLS);
    expect(marketHooks.useLiveQuotes).toHaveBeenCalledWith(CORE_DEFAULT_SYMBOLS);
    expect(container.querySelectorAll('tbody tr[aria-disabled="true"]')).toHaveLength(3);
  });
});
