import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useAppStore } from '../../store/useAppStore';
import { MarketWatchPanel } from './MarketWatchPanel';
import { keyboardShortcutManager } from '../../services/keyboardShortcutManager';
import type { MarketWatchLastPrice } from '../../hooks/useLastMarketWatchQuotes';

const CORE_DEFAULT_SYMBOLS = ['XAUUSD', 'BTCUSD', 'EURUSD'];
const DEFAULT_SYMBOLS = [...CORE_DEFAULT_SYMBOLS, 'GBPUSD', 'USDJPY'];
const DEFAULT_DISPLAY_SYMBOLS = [...CORE_DEFAULT_SYMBOLS];

interface MockMarketInstrument {
  symbol: string;
  name?: string;
  description?: string;
  category?: string;
  digits?: number;
  bid?: number;
  ask?: number;
  contract_size?: number;
  trading_enabled?: boolean;
}

const closedDailyChangeHook = vi.hoisted(() => ({
  values: new Map<string, number>(),
  useHook: vi.fn(),
}));

const lastMarketWatchQuotesHook = vi.hoisted(() => ({
  values: new Map<string, MarketWatchLastPrice>(),
  useHook: vi.fn(),
}));

vi.mock('../../hooks/useLastMarketWatchQuotes', () => ({
  useLastMarketWatchQuotes: (options: unknown) => {
    lastMarketWatchQuotesHook.useHook(options);
    return lastMarketWatchQuotesHook.values;
  },
}));

vi.mock('../../hooks/useClosedMarketDailyChanges', () => ({
  useClosedMarketDailyChanges: (options: unknown) => {
    closedDailyChangeHook.useHook(options);
    return closedDailyChangeHook.values;
  },
}));

vi.mock('../../hooks/useBrokerAccountSessionScope', () => ({
  useBrokerAccountSessionScope: () => 'authenticated|test-account|test-broker|https://broker.test',
}));

const marketHooks = vi.hoisted(() => ({
  activeSymbols: ['BTCUSD', 'XAUUSD', 'GBPUSD', 'SOLUSD', 'EURUSD', 'ETHUSD', '0001.HK'],
  instrumentSymbols: ['BTCUSD', 'XAUUSD', 'GBPUSD', 'SOLUSD', 'EURUSD', 'ETHUSD', '0001.HK'] as Array<
    string | MockMarketInstrument
  >,
  authorizedSymbols: ['BTCUSD', 'XAUUSD', 'GBPUSD', 'SOLUSD', 'EURUSD', 'ETHUSD', '0001.HK'] as string[],
  disabledSymbols: [] as string[],
  activeSymbolsLoading: false,
  activeSymbolsSettled: true,
  activeSymbolsCurrent: true,
  instrumentsLoading: false,
  symbolsError: null as string | null,
  watchlistError: null as string | null,
  reloadActiveSymbols: vi.fn().mockResolvedValue(undefined),
  useActiveMarketSymbols: vi.fn(),
  useLiveQuotes: vi.fn((symbols: string[]) => {
    void symbols;
    return {
      loading: false,
      error: null as string | null,
    };
  }),
}));

vi.mock('../../hooks/useLiveMarketData', () => ({
  useActiveMarketSymbols: marketHooks.useActiveMarketSymbols,
  useLiveQuotes: marketHooks.useLiveQuotes,
  useMarketInstruments: () => ({
    symbols: marketHooks.instrumentSymbols.map((instrument) => (
      typeof instrument === 'string' ? { symbol: instrument } : { ...instrument }
    )),
    authorizedSymbols: marketHooks.authorizedSymbols,
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

const getActiveMarketSnapshot = () => ({
    symbols: marketHooks.activeSymbols,
    loading: marketHooks.activeSymbolsLoading,
    settled: marketHooks.activeSymbolsSettled,
    current: marketHooks.activeSymbolsCurrent,
    error: null,
    reload: marketHooks.reloadActiveSymbols,
});

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

const setMarketCatalog = (
  instruments: Array<string | MockMarketInstrument>,
  authorizedSymbols = instruments.map((instrument) => (
    typeof instrument === 'string' ? instrument : instrument.symbol
  )),
): void => {
  marketHooks.instrumentSymbols = instruments;
  marketHooks.authorizedSymbols = authorizedSymbols;
};

describe('MarketWatchPanel symbol visibility', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    localStorage.removeItem('rtx5_hidden_symbols');
    marketHooks.activeSymbols = [...DEFAULT_SYMBOLS, 'ETHUSD', '0001.HK'];
    marketHooks.instrumentSymbols = [...DEFAULT_SYMBOLS];
    marketHooks.authorizedSymbols = [...DEFAULT_SYMBOLS];
    marketHooks.disabledSymbols = [];
    marketHooks.activeSymbolsLoading = false;
    marketHooks.activeSymbolsSettled = true;
    marketHooks.activeSymbolsCurrent = true;
    marketHooks.instrumentsLoading = false;
    marketHooks.symbolsError = null;
    marketHooks.watchlistError = null;
    marketHooks.reloadActiveSymbols.mockClear();
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
    lastMarketWatchQuotesHook.values.clear();
    lastMarketWatchQuotesHook.useHook.mockClear();
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
    localStorage.removeItem('rtx5_hidden_symbols');
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
      expect(btcCells.at(-1)).toHaveTextContent('0.19%');

      const positiveChange = screen.getByText('0.19%');
      const negativeChange = screen.getByText('-0.36%');
      expect(screen.queryByText('+0.19%')).not.toBeInTheDocument();
      expect(positiveChange).toHaveClass('rtx-market-watch__daily--up');
      expect(positiveChange).toHaveStyle({ color: '#4597ff' });
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

  it('shows the saved closing Daily Change for inactive non-crypto rows', async () => {
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

  it.each([379, 180])('aligns the numeric last close beneath Bid at width %i without fabricating an Ask', (panelWidth) => {
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
      if (panelWidth >= 300) {
        expect(cells).toHaveLength(4);
        const askPrice = row.querySelector('.rtx-market-watch__price--ask');
        expect(askPrice).toHaveClass('rtx-market-watch__price--empty');
        expect(askPrice).toHaveTextContent('\u2014');
        expect(askPrice?.closest('td')).toBe(cells[2]);
        expect(row.querySelector('.rtx-market-watch__daily')?.closest('td')).toBe(cells[3]);
        expect(row.querySelector('.rtx-market-watch__daily')).toHaveTextContent('1.75%');
      } else {
        expect(cells).toHaveLength(2);
        expect(row.querySelector('.rtx-market-watch__price--ask')).toBeNull();
        expect(row.querySelector('.rtx-market-watch__daily')).toBeNull();
      }
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

  it('requests missing visible quotes independently of Daily Change and excludes crypto candles', () => {
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
    lastMarketWatchQuotesHook.values.set('XAUUSD', { kind: 'close', close: 4385.2, asOf: Date.now() - 86_400_000 });
    lastMarketWatchQuotesHook.values.set('EURUSD', { kind: 'quote', bid: 1.17, ask: 1.1702, asOf: Date.now() - 86_400_000 });
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
      expect(writeText.mock.calls[0][0]).toContain('XAUUSD\tLast close: 4385.2\t-\t-');
      expect(writeText.mock.calls[0][0]).toContain('EURUSD\t1.17\t1.1702\t-');
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
      expect(bidPrice).toHaveStyle({ color: '#4597ff' });
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
        fontWeight: '500',
        textAlign: 'left',
        padding: '3px 8px 3px 19px',
      });
      expect(screen.getByRole('columnheader', { name: 'Bid' })).toHaveStyle({ fontSize: '12px', fontWeight: '500', textAlign: 'center' });
      expect(screen.getByRole('columnheader', { name: 'Ask' })).toHaveStyle({ textAlign: 'center' });
      expect(screen.getByRole('columnheader', { name: 'Daily Change' })).toHaveStyle({ textAlign: 'center' });

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
    setMarketCatalog(precisionSymbols);
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
    setMarketCatalog(precisionSymbols);
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
      expect(String(writeText.mock.calls[0][0])).toContain('Symbol\tBid\tAsk\tDaily Change');
      await vi.waitFor(() => expect(feedback).toHaveBeenCalled());
      const [feedbackEvent] = feedback.mock.calls[0];
      expect((feedbackEvent as CustomEvent).detail).toMatchObject({ type: 'success' });
    } finally {
      window.removeEventListener('rtx:order-feedback', feedback);
      if (originalClipboard) {
        Object.defineProperty(navigator, 'clipboard', originalClipboard);
      } else {
        delete (navigator as { clipboard?: unknown }).clipboard;
      }
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

  it('places quote column headers directly after the search divider', () => {
    const { container } = render(
      <MarketWatchPanel
        allSymbols={DEFAULT_SYMBOLS}
        selectedSymbol="BTCUSD"
        onSymbolSelect={vi.fn()}
      />,
    );

    const search = screen.getByRole('combobox', { name: 'Add symbol' });
    const searchSurface = search.closest<HTMLElement>('.rtx-market-watch__search');
    const tableSurface = container.querySelector<HTMLElement>('.rtx-market-watch__table');

    expect(searchSurface?.nextElementSibling).toBe(tableSurface);

    fireEvent.focus(search);
    expect(container.querySelector('.rtx-market-watch__search-table-gap')).not.toBeInTheDocument();
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
    const searchBar = search.closest<HTMLElement>('.rtx-market-watch__search-bar');
    expect(search).toHaveAttribute('aria-expanded', 'false');
    expect(searchBar?.style.height).toBe('42px');
    expect(screen.getByRole('table')).toBeInTheDocument();

    fireEvent.focus(search);

    const groups = screen.getByRole('listbox', { name: 'Symbol groups' });
    const searchSurface = search.closest<HTMLElement>('.rtx-market-watch__search');
    const explorerSurface = groups.closest<HTMLElement>('.rtx-market-watch__symbol-explorer');
    const forexGroup = within(groups).getByRole('option', { name: 'Forex 1 of 3' });
    const forexCount = within(forexGroup).getByText('1/3');
    expect(search).toHaveAttribute('aria-expanded', 'true');
    expect(search).toHaveAttribute('aria-controls', groups.id);
    expect(searchSurface?.style.background).toBe('var(--bg-secondary)');
    expect(searchSurface?.style.borderBottom).toBe('1px solid var(--border-primary)');
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
    expect(search).toHaveValue('');
    expect(screen.getByRole('listbox', { name: 'Crypto symbols' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Back to symbol groups' })).toBeInTheDocument();

    fireEvent.keyDown(search, { key: 'Escape' });
    expect(screen.getByRole('listbox', { name: 'Symbol groups' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Back to symbol groups' })).not.toBeInTheDocument();

    fireEvent.keyDown(search, { key: 'Escape' });
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

  it('exposes keyboard-operable docked search results without a footer add-symbol control', () => {
    const publicCatalog = [...DEFAULT_SYMBOLS, 'ETHUSD'];
    setMarketCatalog(publicCatalog);
    const onSymbolSelect = vi.fn();
    render(
      <MarketWatchPanel
        allSymbols={publicCatalog}
        selectedSymbol="BTCUSD"
        onSymbolSelect={onSymbolSelect}
      />,
    );

    expect(screen.queryByRole('button', { name: 'Focus symbol search' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Add symbol' })).not.toBeInTheDocument();
    expect(screen.queryByText(/\d+ symbols/)).not.toBeInTheDocument();
    const search = screen.getByRole('combobox', { name: 'Add symbol' });
    search.focus();
    expect(search).toHaveFocus();

    fireEvent.keyDown(window, { key: 'u', ctrlKey: true });
    fireEvent.change(search, { target: { value: 'eth' } });

    const listbox = screen.getByRole('listbox', { name: 'Symbol search results' });
    const option = screen.getByRole('option', { name: /ETHUSD/ });
    expect(search).toHaveAttribute('aria-expanded', 'true');
    expect(search).toHaveAttribute('aria-controls', listbox.id);

    fireEvent.keyDown(search, { key: 'ArrowDown' });
    expect(option).toHaveAttribute('aria-selected', 'true');
    expect(search).toHaveAttribute('aria-activedescendant', option.id);

    fireEvent.keyDown(search, { key: 'Enter' });
    expect(onSymbolSelect).toHaveBeenCalledWith('ETHUSD');
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
      expect(screen.getByText(label).closest('[role="menuitem"]')?.querySelector('svg')).not.toBeNull();
    });
    expect(screen.getByText('Hide').closest('[role="menuitem"]')).not.toHaveAttribute('aria-disabled', 'true');
    fireEvent.click(screen.getByText('Hide'));
    expect(getRenderedRowSymbols(container)).toEqual(curatedBuiltIn.filter((symbol) => symbol !== '0001.HK'));
    expect(JSON.parse(localStorage.getItem('rtx5_hidden_symbols') ?? '[]')).toContain('0001.HK');
    expect(watchlistState.removeSymbolFromWatchlist).not.toHaveBeenCalled();
  });

  it('hides and restores all built-in symbols', () => {
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
    expect(getRenderedRowSymbols(container)).toEqual([]);

    fireEvent.click(screen.getByRole('button', { name: 'Show all symbols' }));
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
        selectedSymbol="XAUUSD"
        onSymbolSelect={vi.fn()}
      />,
    );

    fireEvent.contextMenu(screen.getByText('XAUUSD').closest('tr')!);
    fireEvent.click(screen.getByText('Specification'));
    await act(async () => { await vi.dynamicImportSettled(); });

    expect(screen.getByRole('dialog', { name: 'XAUUSD Specification' })).toBeInTheDocument();
    expect(screen.getByText('Gold Spot')).toBeInTheDocument();
    expect(screen.getByText('2400.00')).toBeInTheDocument();
    expect(screen.getByText('2400.20')).toBeInTheDocument();
    expect(alertSpy).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Close symbol specification' }));
    expect(screen.queryByRole('dialog', { name: 'XAUUSD Specification' })).not.toBeInTheDocument();
    alertSpy.mockRestore();
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
