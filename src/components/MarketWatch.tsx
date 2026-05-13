import React, { useState, useMemo } from 'react';
import { useAppStore } from '../store/useAppStore';
import { useWatchlistStore } from '../store/useWatchlistStore';
import { MarketWatchContextMenu } from './MarketWatchContextMenu';
import { SymbolInfo } from './SymbolInfo';
import { PriceDisplay } from './ui/PriceDisplay';
import { getSymbolDigits, formatPrice as formatPriceUtil } from '../utils/symbolUtils';
import { useLiveQuotes, useMarketInstruments, useRemoteWatchlistSync } from '../hooks/useLiveMarketData';

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

export const MarketWatch: React.FC<MarketWatchProps> = ({
    onSelectSymbol,
    selectedSymbol,
    watchlist,
    onOpenOrderEntry
}) => {
    const normalizeSymbol = (value: string): string => value.trim().toUpperCase();

    // Subscribe to ticks from global store (populated by WebSocket)
    const liveTicks = useAppStore((state) => state.ticks);

    // Get symbols from WatchlistStore
    const activeWatchlist = useWatchlistStore((s) => {
        const active = s.watchlists.find((w) => w.id === s.activeWatchlistId);
        return active;
    });
    const watchlistSymbols = activeWatchlist?.symbols || [];
    const {
        loading: watchlistLoading,
        error: watchlistError,
    } = useRemoteWatchlistSync(activeWatchlist?.id);

    // Use watchlist prop if provided, otherwise use WatchlistStore
    const symbols = watchlist && watchlist.length > 0
        ? watchlist.map((s) => normalizeSymbol(String(s))).filter(Boolean)
        : watchlistSymbols;
    const { loading: quotesLoading, error: quotesError } = useLiveQuotes(symbols);
    const { symbols: availableInstruments, loading: symbolsLoading, error: symbolsError } = useMarketInstruments();

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

    // Build display data from live ticks only (no fallback)
    const displayData = useMemo(() => {
        const data: Record<string, TickData> = {};

        symbols.forEach(symbol => {
            const normalized = normalizeSymbol(symbol);
            const tick = liveTicks[normalized];

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
    }, [liveTicks, symbols]);

    const handleContextMenu = (e: React.MouseEvent, symbol: string) => {
        e.preventDefault();
        setContextMenu({
            visible: true,
            x: e.clientX,
            y: e.clientY,
            symbol
        });
    };

    const handleNewOrder = (symbol: string) => {
        if (onOpenOrderEntry) {
            onOpenOrderEntry(symbol);
        } else {
            alert(`Order entry for ${symbol} - not yet implemented`);
        }
    };

    const handleChartWindow = (symbol: string) => {
        onSelectSymbol(symbol);
    };

    const handleTickChart = (symbol: string) => {
        alert(`Tick chart for ${symbol} - not yet implemented`);
    };

    const handleDepthOfMarket = (symbol: string) => {
        const event = new CustomEvent('openDepthOfMarket', { detail: { symbol } });
        window.dispatchEvent(event);
    };

    const handleSymbolSpecification = (symbol: string) => {
        setSymbolInfoDialog({ isOpen: true, symbol });
    };

    const handleHideSymbol = (symbol: string) => {
        // Remove from active watchlist
        if (activeWatchlist) {
            useWatchlistStore.getState().removeSymbolFromWatchlist(activeWatchlist.id, symbol);
        }
    };

    const handleShowAllSymbols = () => {
        // No-op — user must manually add symbols back
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

    // Format spread in points (pips)
    const formatSpread = (spread: number, symbol: string) => {
        if (!Number.isFinite(spread) || spread === 0) return '-';
        const digits = getSymbolDigits(symbol);
        const multiplier = Math.pow(10, digits);
        const points = Math.round(spread * multiplier); 
        return points.toString();
    };

    // Format daily change as percentage
    const formatDailyChange = (change: number) => {
        if (!Number.isFinite(change)) return '-';
        const percent = change.toFixed(2);
        return `${percent}%`;
    };

    // Add symbol to active watchlist
    const handleAddSymbol = () => {
        setAddingSymbol(true);
        setAddSymbolInput('');
    };

    const handleAddSymbolConfirm = () => {
        const sym = addSymbolInput.trim();
        if (sym && activeWatchlist) {
            const normalized = normalizeSymbol(sym);
            if (normalized && !symbols.includes(normalized)) {
                useWatchlistStore.getState().addSymbolToWatchlist(activeWatchlist.id, normalized);
            }
        }
        setAddingSymbol(false);
        setAddSymbolInput('');
    };

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

                <div className="flex-1 overflow-y-auto overflow-x-hidden custom-scrollbar bg-white min-w-0">
                    {(quotesError || symbolsError || watchlistError) && (
                        <div className="px-2 py-1 text-[11px] text-red-700 bg-red-50 border-b border-red-200">
                            {quotesError || symbolsError || watchlistError}
                        </div>
                    )}
                    {quotesLoading && symbols.length > 0 && Object.keys(liveTicks).length === 0 && (
                        <div className="px-2 py-1 text-[11px] text-gray-500 bg-[#f7f7f7] border-b border-[#dddddd]">
                            Loading quotes...
                        </div>
                    )}
                    {symbols.length === 0 ? (
                        <div className="flex items-center justify-center h-32 text-gray-500 text-xs px-4 text-center">
                            <span>{symbolsLoading || watchlistLoading ? 'Loading symbols...' : 'No symbols subscribed. Click + to add.'}</span>
                        </div>
                    ) : (
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
                                    {columnVisibility.spread && <th className="text-right font-normal py-[4px] px-1 border-r border-[#a0a0a0] truncate">Spr</th>}
                                    {columnVisibility.dailyChange && <th className="text-right font-normal py-[4px] px-1 border-r border-[#a0a0a0] truncate">Chg%</th>}
                                    {columnVisibility.highLow && <th className="text-right font-normal py-[4px] px-1 truncate">H/L</th>}
                                </tr>
                            </thead>
                            <tbody className="bg-white">
                                {symbols.map((symbol) => {
                                    const tick = displayData[symbol];

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
                                            onClick={() => onSelectSymbol(symbol)}
                                            onDoubleClick={() => handleNewOrder(symbol)}
                                            onContextMenu={(e) => handleContextMenu(e, symbol)}
                                            className={`cursor-pointer border-b border-[#e8e8e8] transition-colors hover:bg-[#e8f0ff] ${selectedSymbol === symbol ? 'bg-[#cce4ff]' : 'bg-white'}`}
                                        >
                                            {/* Symbol with arrow */}
                                            <td className="py-[3px] px-1 border-r border-[#e8e8e8] truncate">
                                                <div className="flex items-center gap-1 min-w-0">
                                                    <span className="text-[10px] shrink-0"><ArrowIcon /></span>
                                                    <span className="text-black font-medium truncate">{symbol}</span>
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
                                                    {hasData ? formatSpread(spread, symbol) : '-'}
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
                                                    onChange={e => setAddSymbolInput(e.target.value)}
                                                    onKeyDown={e => {
                                                        if (e.key === 'Enter') handleAddSymbolConfirm();
                                                        if (e.key === 'Escape') { setAddingSymbol(false); setAddSymbolInput(''); }
                                                    }}
                                                    list="market-watch-symbols"
                                                    placeholder="e.g. BTCUSD"
                                                    className="flex-1 border border-[#a0a0a0] px-2 py-0.5 text-[12px] text-black rounded outline-none focus:border-blue-500"
                                                    style={{ fontFamily: 'Tahoma, Arial, sans-serif' }}
                                                />
                                                <datalist id="market-watch-symbols">
                                                    {availableInstruments.map((item) => (
                                                        <option key={item.symbol} value={item.symbol} />
                                                    ))}
                                                </datalist>
                                                <button onClick={handleAddSymbolConfirm} className="text-[12px] text-white bg-[#008000] px-2 py-0.5 rounded hover:bg-green-700">Add</button>
                                                <button onClick={() => { setAddingSymbol(false); setAddSymbolInput(''); }} className="text-[12px] text-gray-500 px-1">✕</button>
                                            </div>
                                        </td>
                                    </tr>
                                ) : (
                                <tr
                                    className="border-b border-[#e0e0e0] bg-white cursor-pointer hover:bg-[#e8f0ff]"
                                    onClick={handleAddSymbol}
                                >
                                    <td colSpan={6} className="py-2 px-2">
                                        <div className="flex justify-between items-center">
                                            <span className="text-gray-500 flex items-center gap-2">
                                                <span className="text-[#008000] text-[14px]">+</span> click to add...
                                            </span>
                                            <span className="text-gray-500 text-[11px]">
                                                {symbols.length} symbols
                                            </span>
                                        </div>
                                    </td>
                                </tr>
                                )}
                            </tbody>
                        </table>
                    )}
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
                    onHideSymbol={handleHideSymbol}
                    onShowAllSymbols={handleShowAllSymbols}
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
