import React, { useMemo, useState } from 'react';
import { resolveTickFromLookup, useAppStore } from '../store/useAppStore';
import { useWatchlistStore } from '../store/useWatchlistStore';
import { MarketWatchContextMenu } from './MarketWatchContextMenu';
import { SymbolInfo } from './SymbolInfo';
import { PriceDisplay } from './ui/PriceDisplay';
import { formatPrice as formatPriceUtil } from '../utils/symbolUtils';
import { formatSpreadDisplay } from '../utils/spread';
import { useActiveMarketSymbols, useLiveQuotes, useMarketInstruments, useRemoteWatchlistSync } from '../hooks/useLiveMarketData';
import { useVisibleSymbolRows } from '../hooks/useVisibleSymbolRows';
import { selectDefaultMarketWatchSymbols } from '../utils/marketWatchGroups';
import {
    getMarketWatchDisplayErrors,
    getMarketWatchSymbolLabel,
    resolveMarketWatchSymbolInput,
    searchMarketWatchSymbols,
    shouldUseWatchlistAsMarketWatchSource,
} from '../utils/marketWatchSource';

interface MarketWatchProps {
    onSelectSymbol: (symbol: string) => void;
    selectedSymbol: string;
    watchlist?: string[];
    onOpenOrderEntry?: (symbol: string) => void;
}

interface TickData {
    symbol: string;
    bid: number;
    ask: number;
    spread: number;
    timestamp: number;
    dailyChange?: number;
    high24h?: number;
    low24h?: number;
    bidDirection?: 'up' | 'down' | 'none';
    askDirection?: 'up' | 'down' | 'none';
}

const normalizeSymbol = (value: unknown): string =>
    String(value ?? '').trim().toUpperCase();

const uniqueSymbols = (symbols: unknown[]): string[] =>
    Array.from(new Set(symbols.map(normalizeSymbol).filter(Boolean)));

const getSearchOptionId = (symbol: string): string =>
    `market-watch-search-option-${encodeURIComponent(symbol)}`;

interface ScopedManualSymbols {
    watchlistId: string;
    symbols: string[];
}

export const MarketWatch: React.FC<MarketWatchProps> = ({
    onSelectSymbol,
    selectedSymbol,
    onOpenOrderEntry
}) => {
    // Subscribe to ticks from global store (populated by WebSocket)
    const liveTicks = useAppStore((state) => state.ticks);
    const tickLookup = useAppStore((state) => state.tickLookup);
    const isAuthenticated = useAppStore((state) => state.isAuthenticated);

    // Get symbols from WatchlistStore
    const activeWatchlist = useWatchlistStore((s) => {
        const active = s.watchlists.find((w) => w.id === s.activeWatchlistId);
        return active;
    });
    const {
        loading: watchlistLoading,
        error: watchlistError,
    } = useRemoteWatchlistSync(activeWatchlist?.id);

    const {
        symbols: marketInstruments,
        authorizedSymbols: authenticatedMarketSymbols = [],
        disabledSymbols,
        loading: symbolsLoading,
        error: symbolsError,
    } = useMarketInstruments();
    const {
        symbols: activeMarketSymbols,
        loading: activeSymbolsLoading,
        current: activeSymbolsCurrent,
        error: activeSymbolsError,
    } = useActiveMarketSymbols();

    const [contextMenu, setContextMenu] = useState<{ visible: boolean; x: number; y: number; symbol: string } | null>(null);
    const [columnVisibility, setColumnVisibility] = useState({
        spread: true,
        dailyChange: true,
        highLow: true,
        time: false
    });
    const [symbolInfoDialog, setSymbolInfoDialog] = useState<{ isOpen: boolean; symbol: string }>({ isOpen: false, symbol: '' });
    const [addingSymbol, setAddingSymbol] = useState(false);
    const [addSymbolInput, setAddSymbolInput] = useState('');
    const [highlightedSearchResultIndex, setHighlightedSearchResultIndex] = useState(-1);
    const [manualSymbols, setManualSymbols] = useState<ScopedManualSymbols>({
        watchlistId: activeWatchlist?.id ?? '',
        symbols: [],
    });

    const disabledSymbolSet = useMemo(() => new Set(uniqueSymbols(disabledSymbols)), [disabledSymbols]);
    const catalogSymbols = useMemo(
        () => uniqueSymbols(marketInstruments.map((instrument) => instrument.symbol)),
        [marketInstruments],
    );
    const authorizedSymbols = useMemo(() => isAuthenticated
        ? uniqueSymbols(authenticatedMarketSymbols)
            .filter((symbol) => !disabledSymbolSet.has(symbol))
            .sort((a, b) => a.localeCompare(b))
        : [], [authenticatedMarketSymbols, disabledSymbolSet, isAuthenticated]);
    const quoteEligibleSymbols = catalogSymbols;
    const quoteEligibleSymbolSet = useMemo(
        () => new Set(quoteEligibleSymbols),
        [quoteEligibleSymbols],
    );
    const activeSymbolSet = useMemo(() => new Set(uniqueSymbols(activeMarketSymbols)), [activeMarketSymbols]);
    const actionableSymbolSet = useMemo(() => new Set(
        activeSymbolsCurrent
            ? authorizedSymbols.filter((symbol) => activeSymbolSet.has(symbol))
            : [],
    ), [activeSymbolSet, activeSymbolsCurrent, authorizedSymbols]);
    const searchUniverse = quoteEligibleSymbols;
    const defaultSymbols = useMemo(
        () => selectDefaultMarketWatchSymbols(marketInstruments),
        [marketInstruments],
    );
    const shouldMergePersistedSymbols = shouldUseWatchlistAsMarketWatchSource({
        activeWatchlistId: activeWatchlist?.id,
        activeWatchlistIsDefault: activeWatchlist?.isDefault,
    });
    const persistedSymbols = useMemo(() => shouldMergePersistedSymbols
        ? uniqueSymbols(activeWatchlist?.symbols ?? [])
            .map((symbol) => resolveMarketWatchSymbolInput(quoteEligibleSymbols, symbol) ?? symbol)
        : [], [
        activeWatchlist?.symbols,
        quoteEligibleSymbols,
        shouldMergePersistedSymbols,
    ]);
    const activeManualSymbols = useMemo(
        () => manualSymbols.watchlistId === (activeWatchlist?.id ?? '')
            ? manualSymbols.symbols
            : [],
        [activeWatchlist?.id, manualSymbols.symbols, manualSymbols.watchlistId],
    );
    const symbols = useMemo(
        () => uniqueSymbols([
            ...(shouldMergePersistedSymbols ? persistedSymbols : defaultSymbols),
            ...activeManualSymbols,
        ]),
        [activeManualSymbols, defaultSymbols, persistedSymbols, shouldMergePersistedSymbols],
    );
    const {
        visibleSymbols: visibleRowSymbols,
        setViewportRef: setMarketWatchViewportRef,
        setRowRef: setVisibleMarketWatchRowRef,
    } = useVisibleSymbolRows(symbols);
    const marketWatchRowsKey = symbols.join('\u0000');
    const marketWatchRowRefCallbacks = useMemo(
        () => new Map(
            (marketWatchRowsKey ? marketWatchRowsKey.split('\u0000') : []).map((symbol) => [
                symbol,
                (node: HTMLTableRowElement | null) => setVisibleMarketWatchRowRef(symbol, node),
            ] as const),
        ),
        [marketWatchRowsKey, setVisibleMarketWatchRowRef],
    );
    const subscriptionSymbols = useMemo(() => visibleRowSymbols.filter(
        (symbol) => quoteEligibleSymbolSet.has(symbol),
    ), [quoteEligibleSymbolSet, visibleRowSymbols]);
    const searchResults = useMemo(() => {
        return searchMarketWatchSymbols(searchUniverse, addSymbolInput);
    }, [addSymbolInput, searchUniverse]);
    const activeSearchResultIndex = highlightedSearchResultIndex >= 0
        && highlightedSearchResultIndex < searchResults.length
        ? highlightedSearchResultIndex
        : -1;
    const activeSearchResult = activeSearchResultIndex >= 0
        ? searchResults[activeSearchResultIndex]
        : undefined;
    const { loading: quotesLoading, error: quotesError } = useLiveQuotes(subscriptionSymbols);
    const isSymbolListLoading = symbolsLoading || watchlistLoading || (searchUniverse.length === 0 && activeSymbolsLoading);
    const marketWatchErrors = getMarketWatchDisplayErrors(
        quotesError,
        symbolsError,
        watchlistError,
        searchUniverse.length === 0 ? activeSymbolsError : null,
    );

    // Build display data from live ticks only (no fallback)
    const displayData = useMemo(() => {
        const data: Record<string, TickData> = {};

        symbols.forEach(symbol => {
            const normalized = normalizeSymbol(symbol);
            const tick = resolveTickFromLookup(liveTicks, tickLookup, normalized);

            if (tick && typeof tick.bid === 'number' && typeof tick.ask === 'number') {
                data[symbol] = {
                    symbol: normalized,
                    bid: tick.bid,
                    ask: tick.ask,
                    spread: tick.spread ?? (tick.ask - tick.bid),
                    timestamp: tick.timestamp,
                    dailyChange: tick.dailyChange ?? 0,
                    high24h: tick.high24h ?? tick.high ?? 0,
                    low24h: tick.low24h ?? tick.low ?? 0,
                    bidDirection: tick.bidDirection ?? 'none',
                    askDirection: tick.askDirection ?? 'none',
                };
            } else {
                // No live data yet — show empty placeholder
                data[symbol] = {
                    symbol: normalized,
                    bid: 0,
                    ask: 0,
                    spread: 0,
                    timestamp: 0,
                };
            }
        });

        return data;
    }, [actionableSymbolSet, liveTicks, symbols, tickLookup]);

    const handleContextMenu = (e: React.MouseEvent, symbol: string) => {
        e.preventDefault();
        if (!actionableSymbolSet.has(normalizeSymbol(symbol))) return;
        setContextMenu({
            visible: true,
            x: e.clientX,
            y: e.clientY,
            symbol
        });
    };

    const handleNewOrder = (symbol: string) => {
        if (!actionableSymbolSet.has(normalizeSymbol(symbol))) return;
        if (onOpenOrderEntry) {
            onOpenOrderEntry(symbol);
        } else {
            alert(`Order entry for ${symbol} - not yet implemented`);
        }
    };

    const handleChartWindow = (symbol: string) => {
        if (!actionableSymbolSet.has(normalizeSymbol(symbol))) return;
        onSelectSymbol(symbol);
    };

    const handleTickChart = (symbol: string) => {
        if (!actionableSymbolSet.has(normalizeSymbol(symbol))) return;
        alert(`Tick chart for ${symbol} - not yet implemented`);
    };

    const handleDepthOfMarket = (symbol: string) => {
        if (!actionableSymbolSet.has(normalizeSymbol(symbol))) return;
        const event = new CustomEvent('openDepthOfMarket', { detail: { symbol } });
        window.dispatchEvent(event);
    };

    const handleSymbolSpecification = (symbol: string) => {
        if (!actionableSymbolSet.has(normalizeSymbol(symbol))) return;
        setSymbolInfoDialog({ isOpen: true, symbol });
    };

    const handleToggleColumn = (column: string) => {
        setColumnVisibility(prev => ({
            ...prev,
            [column]: !prev[column as keyof typeof prev]
        }));
    };

    // Format price with proper decimals
    const formatPrice = (price: number, symbol: string) => {
        if (!Number.isFinite(price) || price === 0) return '-';
        return formatPriceUtil(price, symbol);
    };

    const formatSpread = (spread: number, symbol: string, bid?: number, ask?: number) =>
        formatSpreadDisplay(symbol, spread, bid, ask);

    // Format daily change as percentage
    const formatDailyChange = (change: number) => {
        if (!Number.isFinite(change)) return '-';
        const percent = change.toFixed(2);
        return `${percent}%`;
    };

    // Built-in Market Watch rows use the curated core plus one representative
    // per remaining public-catalog group. Custom watchlists persist their subset.
    const handleAddSymbol = () => {
        setAddingSymbol(true);
        setAddSymbolInput('');
        setHighlightedSearchResultIndex(-1);
    };

    const handleSearchResultSelect = (value: string) => {
        const resolvedSymbol = resolveMarketWatchSymbolInput(searchUniverse, value);
        if (!resolvedSymbol || !quoteEligibleSymbolSet.has(resolvedSymbol)) return;

        if (!symbols.includes(resolvedSymbol)) {
            setManualSymbols((current) => {
                const watchlistId = activeWatchlist?.id ?? '';
                const currentSymbols = current.watchlistId === watchlistId ? current.symbols : [];
                return {
                    watchlistId,
                    symbols: currentSymbols.includes(resolvedSymbol)
                        ? currentSymbols
                        : [...currentSymbols, resolvedSymbol],
                };
            });
            if (shouldMergePersistedSymbols && activeWatchlist) {
                useWatchlistStore.getState().addSymbolToWatchlist(activeWatchlist.id, resolvedSymbol);
            }
        }
        onSelectSymbol(resolvedSymbol);
        setAddingSymbol(false);
        setAddSymbolInput('');
        setHighlightedSearchResultIndex(-1);
    };

    const handleAddSymbolConfirm = () => handleSearchResultSelect(addSymbolInput);

    return (
        <>
            <div className="market-watch bg-[#f5f5f5] text-black flex flex-col w-full h-full shadow-sm border-r border-[#cccccc] min-w-0">
                {/* Header */}
                <div className="py-[4px] px-[8px] border-b border-[#a0a0a0] bg-[#e1e6f0] text-black font-sans text-[12px] flex justify-between items-center select-none shadow-sm shrink-0" style={{ fontFamily: 'Tahoma, Arial, sans-serif' }}>
                    <span className="font-semibold flex items-center gap-2">
                        Market Watch
                    </span>
                    <span className="text-gray-600">{symbols.length} symbols</span>
                </div>

                <div
                    ref={setMarketWatchViewportRef}
                    className="flex-1 overflow-y-auto overflow-x-hidden custom-scrollbar bg-white min-w-0"
                >
                    {marketWatchErrors.length > 0 && (
                        <div role="alert" aria-label="Market Watch errors" className="px-2 py-1 text-[11px] text-red-700 bg-red-50 border-b border-red-200">
                            <ul className="m-0 pl-4">
                                {marketWatchErrors.map((message) => <li key={message}>{message}</li>)}
                            </ul>
                        </div>
                    )}
                    {quotesLoading && symbols.length > 0 && Object.keys(liveTicks).length === 0 && (
                        <div className="px-2 py-1 text-[11px] text-gray-500 bg-[#f7f7f7] border-b border-[#dddddd]">
                            Loading quotes...
                        </div>
                    )}
                    <table className="w-full text-[12px] border-collapse bg-white table-fixed" style={{ fontFamily: 'Tahoma, Arial, sans-serif' }}>
                            <colgroup>
                                <col style={{ width: '22%' }} />
                                <col style={{ width: '20%' }} />
                                <col style={{ width: '20%' }} />
                                {columnVisibility.spread && <col style={{ width: '12%' }} />}
                                {columnVisibility.dailyChange && <col style={{ width: '13%' }} />}
                                {columnVisibility.highLow && <col style={{ width: '13%' }} />}
                            </colgroup>
                            <thead className="sticky top-0 bg-[#f0f0f0] z-10 border-b border-[#a0a0a0] select-none text-black">
                                <tr>
                                    <th className="text-left font-normal py-[4px] px-1 border-r border-[#a0a0a0] truncate">Symbol</th>
                                    <th className="text-right font-normal py-[4px] px-1 border-r border-[#a0a0a0] truncate">Bid</th>
                                    <th className="text-right font-normal py-[4px] px-1 border-r border-[#a0a0a0] truncate">Ask</th>
                                    {columnVisibility.spread && <th className="text-right font-normal py-[4px] px-1 border-r border-[#a0a0a0] truncate">SPREAD</th>}
                                    {columnVisibility.dailyChange && <th className="text-right font-normal py-[4px] px-1 border-r border-[#a0a0a0] truncate">Chg%</th>}
                                    {columnVisibility.highLow && <th className="text-right font-normal py-[4px] px-1 truncate">H/L</th>}
                                </tr>
                            </thead>
                            <tbody className="bg-white">
                                {symbols.length === 0 && (
                                    <tr>
                                        <td colSpan={6}>
                                            <div
                                                role="status"
                                                className="flex items-center justify-center h-32 text-gray-500 text-xs px-4 text-center"
                                            >
                                                {isSymbolListLoading ? 'Loading symbols...' : 'No live symbols'}
                                            </div>
                                        </td>
                                    </tr>
                                )}
                                {symbols.map((symbol) => {
                                    const tick = displayData[symbol];
                                    const displaySymbol = getMarketWatchSymbolLabel(symbol, quoteEligibleSymbols);
                                    const isActionable = actionableSymbolSet.has(symbol);

                                    // Default values
                                    const bid = tick?.bid ?? 0;
                                    const ask = tick?.ask ?? 0;
                                    const spread = tick?.spread ?? 0;
                                    const dailyChange = tick?.dailyChange ?? 0;
                                    const high24h = tick?.high24h ?? 0;
                                    const low24h = tick?.low24h ?? 0;
                                    const bidDirection = tick?.bidDirection ?? 'none';
                                    const hasData = bid > 0 || ask > 0;

                                    // Determine colors based on direction
                                    const isUp = bidDirection === 'up';
                                    const isDown = bidDirection === 'down';

                                    // Arrow indicator
                                    const ArrowIcon = () => {
                                        if (!hasData) return <span className="text-gray-400">−</span>;
                                        if (isUp) return <span className="text-[#00aa00] font-bold">▲</span>;
                                        if (isDown) return <span className="text-[#ff0000] font-bold">▼</span>;
                                        return <span className="text-gray-400">−</span>;
                                    };

                                    // Price color - green for up, red for down
                                    const priceColorClass = !hasData
                                        ? 'text-gray-400'
                                        : isUp
                                            ? 'text-[#00aa00]'
                                            : isDown
                                                ? 'text-[#ff0000]'
                                                : 'text-black';

                                    // Daily change color
                                    const changeColorClass = dailyChange > 0
                                        ? 'text-[#00aa00]'
                                        : dailyChange < 0
                                            ? 'text-[#ff0000]'
                                            : 'text-gray-500';

                                    return (
                                        <tr
                                            key={symbol}
                                            ref={marketWatchRowRefCallbacks.get(symbol)}
                                            data-market-watch-symbol={symbol}
                                            onClick={() => {
                                                if (quoteEligibleSymbolSet.has(symbol)) onSelectSymbol(symbol);
                                            }}
                                            onDoubleClick={() => {
                                                if (isActionable) handleNewOrder(symbol);
                                            }}
                                            onContextMenu={(e) => handleContextMenu(e, symbol)}
                                            aria-disabled={!isActionable}
                                            title={!isActionable ? `${displaySymbol} is currently unavailable` : undefined}
                                            className={`${isActionable ? 'cursor-pointer hover:bg-[#e8f0ff]' : 'cursor-not-allowed opacity-60'} border-b border-[#e8e8e8] transition-colors ${selectedSymbol === symbol ? 'bg-[#cce4ff]' : 'bg-white'}`}
                                        >
                                            {/* Symbol with arrow */}
                                            <td className="py-[3px] px-1 border-r border-[#e8e8e8] truncate">
                                                <div className="flex items-center gap-1 min-w-0">
                                                    <span className="text-[10px] shrink-0"><ArrowIcon /></span>
                                                    <span aria-label={displaySymbol} className="text-black font-medium truncate">{displaySymbol}</span>
                                                </div>
                                            </td>

                                            {/* Bid */}
                                            <td className={`text-right py-[3px] px-1 border-r border-[#e8e8e8] font-mono truncate ${priceColorClass}`}>
                                                {hasData ? <PriceDisplay price={bid} symbol={symbol} className={priceColorClass} /> : '-'}
                                            </td>

                                            {/* Ask */}
                                            <td className={`text-right py-[3px] px-1 border-r border-[#e8e8e8] font-mono truncate ${priceColorClass}`}>
                                                {hasData ? <PriceDisplay price={ask} symbol={symbol} className={priceColorClass} /> : '-'}
                                            </td>

                                            {/* Spread */}
                                            {columnVisibility.spread && (
                                                <td className="text-right py-[3px] px-1 border-r border-[#e8e8e8] text-gray-600 font-mono truncate">
                                                    {hasData ? formatSpread(spread, symbol, bid, ask) : '-'}
                                                </td>
                                            )}

                                            {/* Daily Change */}
                                            {columnVisibility.dailyChange && (
                                                <td className={`text-right py-[3px] px-1 border-r border-[#e8e8e8] font-mono truncate ${changeColorClass}`}>
                                                    {hasData ? formatDailyChange(dailyChange) : '-'}
                                                </td>
                                            )}

                                            {/* High/Low */}
                                            {columnVisibility.highLow && (
                                                <td className="text-right py-[3px] px-1 text-gray-600 font-mono text-[10px] truncate">
                                                    {hasData && high24h && low24h
                                                        ? `${formatPrice(high24h, symbol)}/${formatPrice(low24h, symbol)}`
                                                        : '-'
                                                    }
                                                </td>
                                            )}
                                        </tr>
                                    );
                                })}

                                {/* Click to add row */}
                                {addingSymbol ? (
                                    <tr className="border-b border-[#e0e0e0] bg-[#f0f7ff]">
                                        <td colSpan={6} className="py-1.5 px-2">
                                            <div className="flex items-center gap-2">
                                                <input
                                                    autoFocus
                                                    type="text"
                                                    value={addSymbolInput}
                                                    onChange={e => {
                                                        setAddSymbolInput(e.target.value);
                                                        setHighlightedSearchResultIndex(0);
                                                    }}
                                                    onKeyDown={e => {
                                                        if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
                                                            e.preventDefault();
                                                            if (searchResults.length === 0) {
                                                                setHighlightedSearchResultIndex(-1);
                                                                return;
                                                            }

                                                            setHighlightedSearchResultIndex((current) => {
                                                                if (e.key === 'ArrowDown') {
                                                                    return current < 0 || current >= searchResults.length - 1
                                                                        ? 0
                                                                        : current + 1;
                                                                }
                                                                return current <= 0 || current >= searchResults.length
                                                                    ? searchResults.length - 1
                                                                    : current - 1;
                                                            });
                                                        }
                                                        if (e.key === 'Enter') {
                                                            e.preventDefault();
                                                            if (activeSearchResult) {
                                                                handleSearchResultSelect(activeSearchResult);
                                                            } else {
                                                                handleAddSymbolConfirm();
                                                            }
                                                        }
                                                        if (e.key === 'Escape') {
                                                            setAddingSymbol(false);
                                                            setAddSymbolInput('');
                                                            setHighlightedSearchResultIndex(-1);
                                                        }
                                                    }}
                                                    placeholder="e.g. BTCUSD"
                                                    aria-label="Search symbols"
                                                    role="combobox"
                                                    aria-autocomplete="list"
                                                    aria-expanded={Boolean(addSymbolInput.trim())}
                                                    aria-controls="market-watch-search-results"
                                                    aria-activedescendant={activeSearchResult
                                                        ? getSearchOptionId(activeSearchResult)
                                                        : undefined}
                                                    className="flex-1 border border-[#a0a0a0] px-2 py-0.5 text-[12px] text-black rounded outline-none focus:border-blue-500"
                                                    style={{ fontFamily: 'Tahoma, Arial, sans-serif' }}
                                                />
                                                <button type="button" onClick={handleAddSymbolConfirm} className="text-[12px] text-white bg-[#008000] px-2 py-0.5 rounded hover:bg-green-700">Open</button>
                                                <button
                                                    type="button"
                                                    aria-label="Close symbol search"
                                                    onClick={() => {
                                                        setAddingSymbol(false);
                                                        setAddSymbolInput('');
                                                        setHighlightedSearchResultIndex(-1);
                                                    }}
                                                    className="text-[12px] text-gray-500 px-1"
                                                >
                                                    ✕
                                                </button>
                                            </div>
                                            {addSymbolInput.trim() && (
                                                <div id="market-watch-search-results" role="listbox" aria-label="Symbol search results" className="mt-1 max-h-32 overflow-y-auto border border-[#d0d0d0] bg-white">
                                                    {searchResults.length === 0 ? (
                                                        <div className="px-2 py-1 text-[11px] text-gray-500">No matches found</div>
                                                    ) : searchResults.map((symbol, index) => (
                                                        <button
                                                            key={symbol}
                                                            id={getSearchOptionId(symbol)}
                                                            type="button"
                                                            role="option"
                                                            aria-selected={activeSearchResultIndex === index}
                                                            aria-disabled={false}
                                                            aria-label={getMarketWatchSymbolLabel(symbol, searchUniverse)}
                                                            onClick={() => handleSearchResultSelect(symbol)}
                                                            onMouseEnter={() => setHighlightedSearchResultIndex(index)}
                                                            className={`block w-full px-2 py-1 text-left text-[11px] text-black hover:bg-[#e8f0ff] ${activeSearchResultIndex === index ? 'bg-[#e8f0ff]' : ''}`}
                                                        >
                                                            {getMarketWatchSymbolLabel(symbol, searchUniverse)}
                                                        </button>
                                                    ))}
                                                </div>
                                            )}
                                        </td>
                                    </tr>
                                ) : (
                                <tr className="border-b border-[#e0e0e0] bg-white hover:bg-[#e8f0ff]">
                                    <td colSpan={6} className="py-2 px-2">
                                        <div className="flex justify-between items-center">
                                            <button
                                                type="button"
                                                aria-label="Search market symbols"
                                                onClick={handleAddSymbol}
                                                className="text-gray-500 flex items-center gap-2 cursor-pointer"
                                            >
                                                <span className="text-[#008000] text-[14px]">+</span> click to add...
                                            </button>
                                            <span className="text-gray-500 text-[11px]">
                                                {symbols.length} symbols
                                            </span>
                                        </div>
                                    </td>
                                </tr>
                                )}
                            </tbody>
                        </table>
                </div>
            </div>

            {/* Context Menu */}
            {contextMenu && (
                <MarketWatchContextMenu
                    visible={contextMenu.visible}
                    x={contextMenu.x}
                    y={contextMenu.y}
                    symbol={contextMenu.symbol}
                    onNewOrder={handleNewOrder}
                    onChartWindow={handleChartWindow}
                    onTickChart={handleTickChart}
                    onDepthOfMarket={handleDepthOfMarket}
                    onSymbolSpecification={handleSymbolSpecification}
                    onToggleColumn={handleToggleColumn}
                    onClose={() => setContextMenu(null)}
                    columnVisibility={columnVisibility}
                />
            )}

            {/* Symbol Info Dialog */}
            <SymbolInfo
                symbol={symbolInfoDialog.symbol}
                isOpen={symbolInfoDialog.isOpen}
                onClose={() => setSymbolInfoDialog({ isOpen: false, symbol: '' })}
            />
        </>
    );
};

export default MarketWatch;
