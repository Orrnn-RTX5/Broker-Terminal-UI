import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useAppStore } from '../store/useAppStore';
import { MarketWatch } from './MarketWatch';

const DEFAULT_SYMBOLS = ['XAUUSD', 'BTCUSD', 'EURUSD', 'GBPUSD', 'USDJPY'];

const marketHooks = vi.hoisted(() => ({
    activeSymbols: ['XAUUSD', 'BTCUSD', 'EURUSD', 'GBPUSD', 'USDJPY', 'SOLUSD', 'ETHUSD', '0001.HK'],
    instrumentSymbols: ['XAUUSD', 'BTCUSD', 'EURUSD', 'GBPUSD', 'USDJPY', 'SOLUSD', 'ETHUSD', '0001.HK'],
    disabledSymbols: [] as string[],
    instrumentsLoading: false,
    activeSymbolsCurrent: true,
    quoteError: null as string | null,
    useLiveQuotes: vi.fn((symbols: string[]) => {
        void symbols;
        return { loading: false, error: null as string | null };
    }),
}));

const watchlistMutations = vi.hoisted(() => ({
    addSymbolToWatchlist: vi.fn(),
}));

const watchlistState = vi.hoisted(() => ({
    watchlists: [{ id: 'majors', symbols: [] as string[], isDefault: true }],
    activeWatchlistId: 'majors',
    addSymbolToWatchlist: watchlistMutations.addSymbolToWatchlist,
}));

vi.mock('../hooks/useLiveMarketData', () => ({
    useActiveMarketSymbols: () => ({
        symbols: marketHooks.activeSymbols,
        loading: false,
        settled: true,
        current: marketHooks.activeSymbolsCurrent,
        error: null,
        reload: vi.fn(),
    }),
    useLiveQuotes: marketHooks.useLiveQuotes,
    useMarketInstruments: () => ({
        symbols: marketHooks.instrumentSymbols.map((symbol) => ({ symbol })),
        disabledSymbols: marketHooks.disabledSymbols,
        loading: marketHooks.instrumentsLoading,
        error: null,
        reload: vi.fn(),
    }),
    useRemoteWatchlistSync: () => ({ loading: false, error: null, reload: vi.fn() }),
}));

vi.mock('../store/useWatchlistStore', () => {
    const useWatchlistStore = Object.assign(
        (selector: (value: typeof watchlistState) => unknown) => selector(watchlistState),
        { getState: () => watchlistState },
    );

    return { useWatchlistStore };
});

vi.mock('./MarketWatchContextMenu', () => ({ MarketWatchContextMenu: () => null }));
vi.mock('./SymbolInfo', () => ({ SymbolInfo: () => null }));

const getRenderedRowSymbols = (container: HTMLElement): string[] =>
    Array.from(container.querySelectorAll<HTMLTableRowElement>('tbody tr[data-market-watch-symbol]'))
        .map((row) => row.dataset.marketWatchSymbol ?? '');

describe('legacy MarketWatch symbol visibility', () => {
    beforeEach(() => {
        marketHooks.activeSymbols = [...DEFAULT_SYMBOLS, 'ETHUSD', '0001.HK'];
        marketHooks.instrumentSymbols = [...DEFAULT_SYMBOLS, 'ETHUSD', '0001.HK'];
        marketHooks.disabledSymbols = [];
        marketHooks.instrumentsLoading = false;
        marketHooks.activeSymbolsCurrent = true;
        marketHooks.quoteError = null;
        watchlistState.watchlists = [{ id: 'majors', symbols: [], isDefault: true }];
        watchlistState.activeWatchlistId = 'majors';
        marketHooks.useLiveQuotes.mockClear();
        marketHooks.useLiveQuotes.mockImplementation((symbols: string[]) => {
            void symbols;
            return { loading: false, error: marketHooks.quoteError };
        });
        watchlistMutations.addSymbolToWatchlist.mockClear();
        act(() => {
            useAppStore.setState({ isAuthenticated: false });
            useAppStore.getState().setTicks({});
        });
    });

    afterEach(() => {
        act(() => {
            useAppStore.setState({ isAuthenticated: false });
            useAppStore.getState().setTicks({});
        });
    });

    it('uses the full SPREAD column heading', () => {
        render(<MarketWatch selectedSymbol="BTCUSD" onSelectSymbol={vi.fn()} />);

        expect(screen.getByRole('columnheader', { name: 'SPREAD' })).toBeInTheDocument();
        expect(screen.queryByRole('columnheader', { name: 'SPRD' })).not.toBeInTheDocument();
    });

    it('keeps all five authorized defaults visible in product order when feed freshness is partial', () => {
        marketHooks.activeSymbols = ['GBPUSD', 'EURUSD'];
        const { container } = render(
            <MarketWatch
                watchlist={['ETHUSD', '0001.HK']}
                selectedSymbol="BTCUSD"
                onSelectSymbol={vi.fn()}
            />,
        );

        expect(getRenderedRowSymbols(container)).toEqual(DEFAULT_SYMBOLS);
        expect(screen.queryByText('ETHUSD')).not.toBeInTheDocument();
        expect(screen.queryByText('0001.HK')).not.toBeInTheDocument();
        expect(screen.getByText('EURUSD')).toBeInTheDocument();
        expect(screen.queryByText('EUROUSD')).not.toBeInTheDocument();
        expect(marketHooks.useLiveQuotes).toHaveBeenLastCalledWith(DEFAULT_SYMBOLS);
        expect(screen.getByText('BTCUSD').closest('tr')).toHaveAttribute('aria-disabled', 'true');
        expect(screen.getByText('BTCUSD').closest('tr')).toHaveTextContent('-');
        expect(screen.getByText('GBPUSD').closest('tr')).toHaveAttribute('aria-disabled', 'false');
    });

    it('displays and selects canonical EURUSD', () => {
        const onSelectSymbol = vi.fn();
        const { container } = render(
            <MarketWatch selectedSymbol="BTCUSD" onSelectSymbol={onSelectSymbol} />,
        );

        fireEvent.click(screen.getByRole('button', { name: 'Search market symbols' }));
        fireEvent.change(screen.getByRole('combobox', { name: 'Search symbols' }), {
            target: { value: 'eur' },
        });
        fireEvent.click(screen.getByRole('option', { name: 'EURUSD' }));

        expect(onSelectSymbol).toHaveBeenCalledWith('EURUSD');
        expect(getRenderedRowSymbols(container)).toEqual(DEFAULT_SYMBOLS);
        expect(screen.getByText('EURUSD')).toBeInTheDocument();
        expect(screen.queryByText('EUROUSD')).not.toBeInTheDocument();
        expect(marketHooks.useLiveQuotes).toHaveBeenLastCalledWith(DEFAULT_SYMBOLS);
    });

    it('keeps the canonical EURUSD label after reload', () => {
        const firstRender = render(
            <MarketWatch selectedSymbol="BTCUSD" onSelectSymbol={vi.fn()} />,
        );

        expect(getRenderedRowSymbols(firstRender.container)).toEqual(DEFAULT_SYMBOLS);
        expect(screen.getByText('EURUSD')).toBeInTheDocument();
        expect(screen.queryByText('EUROUSD')).not.toBeInTheDocument();

        firstRender.unmount();
        const reloadRender = render(
            <MarketWatch selectedSymbol="BTCUSD" onSelectSymbol={vi.fn()} />,
        );

        expect(getRenderedRowSymbols(reloadRender.container)).toEqual(DEFAULT_SYMBOLS);
        expect(screen.getByText('EURUSD')).toBeInTheDocument();
        expect(screen.queryByText('EUROUSD')).not.toBeInTheDocument();
    });

    it('displays EURUSD while preserving an EUROUSD-only broker identity', () => {
        const brokerSymbols = DEFAULT_SYMBOLS.map((symbol) => symbol === 'EURUSD' ? 'EUROUSD' : symbol);
        marketHooks.activeSymbols = brokerSymbols;
        marketHooks.instrumentSymbols = brokerSymbols;
        const onSelectSymbol = vi.fn();

        const { container } = render(
            <MarketWatch selectedSymbol="BTCUSD" onSelectSymbol={onSelectSymbol} />,
        );
        fireEvent.click(screen.getByRole('button', { name: 'Search market symbols' }));
        fireEvent.change(screen.getByRole('combobox', { name: 'Search symbols' }), {
            target: { value: 'eur' },
        });
        fireEvent.click(screen.getByRole('option', { name: 'EURUSD' }));

        expect(onSelectSymbol).toHaveBeenCalledWith('EUROUSD');
        expect(getRenderedRowSymbols(container)).toEqual(brokerSymbols);
        expect(screen.getByText('EURUSD')).toBeInTheDocument();
        expect(screen.queryByText('EUROUSD')).not.toBeInTheDocument();
        expect(marketHooks.useLiveQuotes).toHaveBeenLastCalledWith(brokerSymbols);
    });

    it('supports keyboard-highlighted search options with matching combobox ARIA state', () => {
        const onSelectSymbol = vi.fn();
        render(<MarketWatch selectedSymbol="BTCUSD" onSelectSymbol={onSelectSymbol} />);

        fireEvent.click(screen.getByRole('button', { name: 'Search market symbols' }));
        const input = screen.getByRole('combobox', { name: 'Search symbols' });
        fireEvent.change(input, { target: { value: 'usd' } });

        const btcOption = screen.getByRole('option', { name: 'BTCUSD' });
        const ethOption = screen.getByRole('option', { name: 'ETHUSD' });
        expect(btcOption).toHaveAttribute('aria-selected', 'true');
        expect(input).toHaveAttribute('aria-activedescendant', btcOption.id);

        fireEvent.keyDown(input, { key: 'ArrowDown' });
        expect(btcOption).toHaveAttribute('aria-selected', 'false');
        expect(ethOption).toHaveAttribute('aria-selected', 'true');
        expect(input).toHaveAttribute('aria-activedescendant', ethOption.id);

        fireEvent.keyDown(input, { key: 'ArrowUp' });
        expect(btcOption).toHaveAttribute('aria-selected', 'true');
        fireEvent.keyDown(input, { key: 'ArrowDown' });
        fireEvent.keyDown(input, { key: 'Enter' });

        expect(onSelectSymbol).toHaveBeenCalledWith('ETHUSD');
        expect(screen.queryByRole('combobox', { name: 'Search symbols' })).not.toBeInTheDocument();
    });

    it('keeps a disabled default visible but unsubscribed, empty, and non-actionable', () => {
        marketHooks.disabledSymbols = ['XAUUSD'];
        const onSelectSymbol = vi.fn();

        const { container } = render(
            <MarketWatch selectedSymbol="BTCUSD" onSelectSymbol={onSelectSymbol} />,
        );

        expect(getRenderedRowSymbols(container)).toEqual(DEFAULT_SYMBOLS);
        expect(marketHooks.useLiveQuotes).toHaveBeenLastCalledWith(
            DEFAULT_SYMBOLS.filter((symbol) => symbol !== 'XAUUSD'),
        );
        const row = screen.getByText('XAUUSD').closest('tr');
        expect(row).toHaveAttribute('aria-disabled', 'true');
        expect(row).toHaveTextContent('-');
        fireEvent.click(row!);
        expect(onSelectSymbol).not.toHaveBeenCalled();
    });

    it('appends a manually selected symbol without replacing or capping the defaults', () => {
        const onSelectSymbol = vi.fn();
        const { container } = render(
            <MarketWatch selectedSymbol="BTCUSD" onSelectSymbol={onSelectSymbol} />,
        );

        expect(screen.queryByText('ETHUSD')).not.toBeInTheDocument();
        fireEvent.click(screen.getByText('click to add...'));
        expect(screen.queryByText('ETHUSD')).not.toBeInTheDocument();

        fireEvent.change(screen.getByLabelText('Search symbols'), { target: { value: 'eth' } });
        fireEvent.click(screen.getByRole('option', { name: 'ETHUSD' }));

        expect(onSelectSymbol).toHaveBeenCalledWith('ETHUSD');
        expect(getRenderedRowSymbols(container)).toEqual([...DEFAULT_SYMBOLS, 'ETHUSD']);
        expect(screen.getByText('ETHUSD')).toBeInTheDocument();
        expect(marketHooks.useLiveQuotes).toHaveBeenLastCalledWith([...DEFAULT_SYMBOLS, 'ETHUSD']);
        expect(watchlistMutations.addSymbolToWatchlist).not.toHaveBeenCalled();
    });

    it('keeps five placeholders and appends the only active non-default symbol', () => {
        marketHooks.activeSymbols = ['ETHUSD'];
        const onSelectSymbol = vi.fn();
        const { container } = render(
            <MarketWatch selectedSymbol="BTCUSD" onSelectSymbol={onSelectSymbol} />,
        );

        expect(getRenderedRowSymbols(container)).toEqual(DEFAULT_SYMBOLS);
        expect(screen.queryByText('ETHUSD')).not.toBeInTheDocument();
        expect(marketHooks.useLiveQuotes).toHaveBeenLastCalledWith(DEFAULT_SYMBOLS);

        fireEvent.click(screen.getByRole('button', { name: 'Search market symbols' }));
        fireEvent.change(screen.getByRole('combobox', { name: 'Search symbols' }), {
            target: { value: 'eth' },
        });

        fireEvent.click(screen.getByRole('option', { name: 'ETHUSD' }));
        expect(onSelectSymbol).toHaveBeenCalledWith('ETHUSD');
        expect(getRenderedRowSymbols(container)).toEqual([...DEFAULT_SYMBOLS, 'ETHUSD']);
        expect(screen.getByText('ETHUSD')).toBeInTheDocument();
        expect(marketHooks.useLiveQuotes).toHaveBeenLastCalledWith([...DEFAULT_SYMBOLS, 'ETHUSD']);
    });

    it('keeps catalog symbols searchable after they leave the active feed list', () => {
        marketHooks.activeSymbols = ['EURUSD'];

        const onSelectSymbol = vi.fn();
        render(<MarketWatch selectedSymbol="EURUSD" onSelectSymbol={onSelectSymbol} />);
        fireEvent.click(screen.getByRole('button', { name: 'Search market symbols' }));
        fireEvent.change(screen.getByRole('combobox', { name: 'Search symbols' }), {
            target: { value: 'gbp' },
        });

        const option = screen.getByRole('option', { name: 'GBPUSD' });
        expect(option).toHaveAttribute('aria-disabled', 'false');
        fireEvent.click(option);
        expect(onSelectSymbol).toHaveBeenCalledWith('GBPUSD');
    });

    it('subscribes public active defaults but keeps them non-actionable while the account catalog is empty', () => {
        marketHooks.activeSymbols = ['xauusd', 'BTCUSD', 'eurusd', 'GBPUSD', 'USDJPY', 'XAUUSD', '0001.HK'];
        marketHooks.instrumentSymbols = [];
        marketHooks.instrumentsLoading = true;
        const onOpenOrderEntry = vi.fn();

        const { container } = render(
            <MarketWatch
                selectedSymbol="BTCUSD"
                onSelectSymbol={vi.fn()}
                onOpenOrderEntry={onOpenOrderEntry}
            />,
        );

        expect(getRenderedRowSymbols(container)).toEqual(DEFAULT_SYMBOLS);
        expect(screen.getByText('EURUSD')).toBeInTheDocument();
        expect(screen.queryByText('EUROUSD')).not.toBeInTheDocument();
        expect(marketHooks.useLiveQuotes).toHaveBeenLastCalledWith(DEFAULT_SYMBOLS);
        expect(container.querySelectorAll('tbody tr[data-market-watch-symbol][aria-disabled="true"]')).toHaveLength(5);
        fireEvent.doubleClick(screen.getByText('XAUUSD').closest('tr')!);
        expect(onOpenOrderEntry).not.toHaveBeenCalled();
    });

    it('does not subscribe unknown defaults when the unauthenticated public feed universe is empty', () => {
        marketHooks.activeSymbols = [];
        marketHooks.instrumentSymbols = [];
        marketHooks.instrumentsLoading = false;

        const { container } = render(
            <MarketWatch selectedSymbol="BTCUSD" onSelectSymbol={vi.fn()} />,
        );

        expect(getRenderedRowSymbols(container)).toEqual(DEFAULT_SYMBOLS);
        expect(marketHooks.useLiveQuotes).toHaveBeenLastCalledWith([]);
        expect(container.querySelectorAll('tbody tr[data-market-watch-symbol][aria-disabled="true"]')).toHaveLength(5);
    });

    it('does not use the public feed as an authenticated catalog fallback', () => {
        act(() => useAppStore.setState({ isAuthenticated: true }));
        marketHooks.activeSymbols = [...DEFAULT_SYMBOLS];
        marketHooks.instrumentSymbols = [];
        marketHooks.instrumentsLoading = true;

        const { container } = render(
            <MarketWatch selectedSymbol="BTCUSD" onSelectSymbol={vi.fn()} />,
        );

        expect(marketHooks.useLiveQuotes).toHaveBeenLastCalledWith([]);
        expect(container.querySelectorAll('tbody tr[data-market-watch-symbol][aria-disabled="true"]')).toHaveLength(5);
    });

    it('renders and subscribes only the persisted symbols for a custom watchlist', () => {
        watchlistState.watchlists = [{
            id: 'custom',
            symbols: ['ETHUSD'],
            isDefault: false,
        }];
        watchlistState.activeWatchlistId = 'custom';

        const { container } = render(
            <MarketWatch selectedSymbol="BTCUSD" onSelectSymbol={vi.fn()} />,
        );

        expect(getRenderedRowSymbols(container)).toEqual(['ETHUSD']);
        expect(marketHooks.useLiveQuotes).toHaveBeenLastCalledWith(['ETHUSD']);
    });

    it('does not leak manual symbols across built-in and custom watchlist switches', () => {
        const { container, rerender } = render(
            <MarketWatch selectedSymbol="BTCUSD" onSelectSymbol={vi.fn()} />,
        );

        fireEvent.click(screen.getByRole('button', { name: 'Search market symbols' }));
        fireEvent.change(screen.getByRole('combobox', { name: 'Search symbols' }), {
            target: { value: 'eth' },
        });
        fireEvent.click(screen.getByRole('option', { name: 'ETHUSD' }));
        expect(getRenderedRowSymbols(container)).toEqual([...DEFAULT_SYMBOLS, 'ETHUSD']);

        watchlistState.watchlists = [{
            id: 'custom',
            symbols: ['0001.HK'],
            isDefault: false,
        }];
        watchlistState.activeWatchlistId = 'custom';
        rerender(<MarketWatch selectedSymbol="0001.HK" onSelectSymbol={vi.fn()} />);

        expect(getRenderedRowSymbols(container)).toEqual(['0001.HK']);
        expect(marketHooks.useLiveQuotes).toHaveBeenLastCalledWith(['0001.HK']);

        fireEvent.click(screen.getByRole('button', { name: 'Search market symbols' }));
        fireEvent.change(screen.getByRole('combobox', { name: 'Search symbols' }), {
            target: { value: 'eth' },
        });
        fireEvent.click(screen.getByRole('option', { name: 'ETHUSD' }));
        expect(getRenderedRowSymbols(container)).toEqual(['0001.HK', 'ETHUSD']);
        expect(watchlistMutations.addSymbolToWatchlist).toHaveBeenLastCalledWith('custom', 'ETHUSD');

        watchlistState.watchlists = [{ id: 'majors', symbols: [], isDefault: true }];
        watchlistState.activeWatchlistId = 'majors';
        rerender(<MarketWatch selectedSymbol="BTCUSD" onSelectSymbol={vi.fn()} />);

        expect(getRenderedRowSymbols(container)).toEqual(DEFAULT_SYMBOLS);
        expect(marketHooks.useLiveQuotes).toHaveBeenLastCalledWith(DEFAULT_SYMBOLS);
    });

    it('keeps quote-freshness failures visible in the legacy error area', () => {
        marketHooks.quoteError = 'Quote is stale for EURUSD';

        render(<MarketWatch selectedSymbol="BTCUSD" onSelectSymbol={vi.fn()} />);

        expect(screen.getByRole('alert', { name: 'Market Watch errors' })).toHaveTextContent('Quote is stale for EURUSD');
    });

    it('keeps unrelated quote errors visible in the legacy error area', () => {
        marketHooks.quoteError = 'Quote service is unavailable';

        render(<MarketWatch selectedSymbol="BTCUSD" onSelectSymbol={vi.fn()} />);

        expect(screen.getByText('Quote service is unavailable')).toBeInTheDocument();
    });
});
