import { Icon } from './ui/Icon';
import { PriceDisplay } from './ui/PriceDisplay';
import { ModifyPositionDialog } from './ModifyPositionDialog';
import { useState, useEffect, useMemo, useRef } from 'react';
import { CalendarTab } from './layout/CalendarTab';
import { CodeBaseTab, ArticlesTab, ExpertsTab } from './layout/ResearchTabs';
import { JournalTab } from './layout/JournalTab';
import { HistoryDownloader } from './HistoryDownloader';
import { useAppStore } from '../store/useAppStore';
import { useTradeFacingData } from '../hooks/useTradeFacingData';
import { getStoredAccountLogin, tradeGatewayApi } from '../api/tradeGateway';

// BottomDock reads trading data from the store directly to avoid re-rendering
// the chart panel every time positions update (root cause of post-trade crashes).
interface BottomDockProps {
    height?: number | string;
    onHeightChange?: (height: number) => void;
    onClosePosition: (id: number, volume?: number) => void;
    onModifyPosition: (id: number, sl: number, tp: number) => void;
    onCancelOrder?: (id: number) => void;
    onCloseBulk?: (type: 'ALL' | 'WINNERS' | 'LOSERS', symbol?: string) => void;
}

type TabType = 'Toolbox' | 'Trade' | 'Exposure' | 'History' | 'News' | 'Mailbox' | 'Calendar' | 'Company' | 'Alerts' | 'Articles' | 'Code Base' | 'Experts' | 'Journal' | 'Historical Data';

const TABS: { id: TabType; icon?: any }[] = [
    { id: 'Trade' },
    { id: 'History' },
    { id: 'Exposure' },
    { id: 'Toolbox' },
    { id: 'Historical Data' },
    { id: 'News' },
    { id: 'Mailbox' },
    { id: 'Calendar' },
    { id: 'Company' },
    { id: 'Alerts' },
    { id: 'Articles' },
    { id: 'Code Base' },
    { id: 'Experts' },
    { id: 'Journal' },
];

export function BottomDock({
    height,
    onHeightChange,
    onClosePosition,
    onModifyPosition,
    onCloseBulk,
}: BottomDockProps) {
    // Read trading data directly from store — NOT from props
    // This prevents DockWorkspace.renderPanel from needing to re-create when positions change
    const [account, setAccount] = useState<any>(useAppStore.getState().account);
    const [positions, setPositions] = useState<any[]>(useAppStore.getState().positions);
    const history = useAppStore(s => s.trades);
    useTradeFacingData(undefined, 10000);

    // Value-level caches — prevent setState when broker sends new objects with same field values
    const cachedAccountSig = useRef<string>('');
    const cachedPositionsSig = useRef<string>('');

    const accountSig = (a: any) => !a ? '' : `${a.balance}|${a.equity}|${a.margin}|${a.freeMargin}|${a.marginLevel}`;
    const positionsSig = (ps: any[]) => ps.map(p => `${p.id}:${p.side}:${p.volume}:${p.sl}:${p.tp}`).join('|');

    // Subscribe to store — throttle to 500ms so WebSocket bursts don't flicker the UI.
    // Only calls setState when the displayed field values actually changed.
    useEffect(() => {
        let lastFired = 0;
        let pending: ReturnType<typeof setTimeout> | null = null;

        const flush = () => {
            const s = useAppStore.getState();
            const aSig = accountSig(s.account);
            const pSig = positionsSig(s.positions ?? []);
            if (aSig !== cachedAccountSig.current) {
                cachedAccountSig.current = aSig;
                setAccount(s.account);
            }
            if (pSig !== cachedPositionsSig.current) {
                cachedPositionsSig.current = pSig;
                setPositions(s.positions);
            }
        };

        const unsub = useAppStore.subscribe((state, prev) => {
            if (state.account === prev.account && state.positions === prev.positions) return;
            const now = Date.now();
            const remaining = 500 - (now - lastFired);
            if (remaining <= 0) {
                lastFired = now;
                flush();
            } else if (!pending) {
                pending = setTimeout(() => {
                    lastFired = Date.now();
                    pending = null;
                    flush();
                }, remaining);
            }
        });
        return () => {
            unsub();
            if (pending) clearTimeout(pending);
        };
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    const [activeTab, setActiveTab] = useState<TabType>(() => {
        const saved = localStorage.getItem('bottomdock-active-tab');
        // If no saved value or it was the old default 'Toolbox', start on Journal
        if (!saved || saved === 'Toolbox' || saved === 'Journal') return 'Trade';
        return saved as TabType;
    });
    
    const [isResizing, setIsResizing] = useState(false);

    // Helpers
    const formatMoney = (val: number | undefined | null) => {
        const v = val ?? 0;
        if (isNaN(v)) return '0.00';
        // MT5 style uses spaces instead of commas for large numbers
        const parts = v.toFixed(2).split('.');
        parts[0] = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, " ");
        return parts.join('.');
    };

    const formatDate = (dateStr: string) => {
        try {
            return new Date(dateStr).toLocaleString('en-US', {
                year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false
            }).replace(',', '');
        } catch {
            return dateStr;
        }
    };

    // Persist active tab selection
    useEffect(() => {
        localStorage.setItem('bottomdock-active-tab', activeTab);
    }, [activeTab]);

    // Auto-switch to Trade tab when a trade is executed
    useEffect(() => {
        const handleTradeExecution = () => {
            setActiveTab('Trade');
        };
        window.addEventListener('rtx:force-refresh-positions', handleTradeExecution);
        return () => window.removeEventListener('rtx:force-refresh-positions', handleTradeExecution);
    }, []);

    // Auto-switch to Journal if the account equity hits 0 (margin call / account blown)
    const prevEquityRef = useRef<number | null>(null);
    useEffect(() => {
        // Expose a global testing function for the user to simulate blowing up their account manually
        (window as any).testBlowup = () => {
            const currentAccount = useAppStore.getState().account;
            if (currentAccount) {
                useAppStore.getState().setAccount({ ...currentAccount, equity: 0, balance: 0, freeMargin: 0, marginLevel: 0 });
                console.log("💥 Simulated Account Blow Up! Equity is now 0. You should be navigated to the Journal tab.");
            }
        };

        if (!account) return;
        const eq = account.equity;
        
        // If equity drops to 0 or below from a previously positive state, switch instantly
        if (eq <= 0 && prevEquityRef.current !== null && prevEquityRef.current > 0) {
            setActiveTab('Journal');
        }
        
        prevEquityRef.current = eq;
    }, [account?.equity]);

    // Resize Handler
    useEffect(() => {
        const handleMouseMove = (e: MouseEvent) => {
            if (isResizing && onHeightChange) {
                const newHeight = window.innerHeight - e.clientY;
                onHeightChange(Math.max(150, Math.min(newHeight, 800)));
            }
        };
        const handleMouseUp = () => setIsResizing(false);

        if (isResizing) {
            window.addEventListener('mousemove', handleMouseMove);
            window.addEventListener('mouseup', handleMouseUp);
        }
        return () => {
            window.removeEventListener('mousemove', handleMouseMove);
            window.removeEventListener('mouseup', handleMouseUp);
        };
    }, [isResizing, onHeightChange]);

    return (
        <div
            className="rtx-bottom-dock flex-1 bg-[#131316] border-t border-zinc-700 flex flex-col relative font-sans text-[12px] shadow-[0_-4px_6px_-1px_rgba(0,0,0,0.2)] select-none min-h-0"
            style={{ height: height !== undefined ? (typeof height === 'number' ? `${height}px` : height) : '100%', width: '100%', zIndex: 30 }}
        >
            {/* Resize Handle */}
            {onHeightChange && (
                <div
                    className="h-1 cursor-ns-resize hover:bg-emerald-500/50 transition-colors w-full absolute top-0 left-0 z-50"
                    onMouseDown={() => setIsResizing(true)}
                />
            )}

            {/* Content Area */}
            <div className="rtx-bottom-dock__content flex-1 overflow-hidden relative bg-[#131316] tabular-nums flex flex-col">
                {activeTab === 'Toolbox' && (
                    <ToolboxTab />
                )}
                {activeTab === 'Trade' && (
                    <TradeTab
                        positions={positions ?? []}
                        account={account}
                        onClosePosition={onClosePosition}
                        onModifyPosition={onModifyPosition}
                        onCloseBulk={onCloseBulk}
                        formatMoney={formatMoney}
                        formatDate={formatDate}
                    />
                )}
                {activeTab === 'Exposure' && (
                    <ExposureTab positions={positions ?? []} formatMoney={formatMoney} account={account} />
                )}
                {activeTab === 'History' && (
                    <HistoryTab formatMoney={formatMoney} />
                )}

                {/* Implemented Tabs from Phase 13 & 14 */}
                {activeTab === 'Calendar' && (
                    <CalendarTab />
                )}
                {activeTab === 'Code Base' && (
                    <CodeBaseTab />
                )}
                {activeTab === 'Articles' && (
                    <ArticlesTab />
                )}
                {activeTab === 'Experts' && (
                    <ExpertsTab />
                )}
                {activeTab === 'Journal' && (
                    <JournalTab />
                )}
                {activeTab === 'Historical Data' && (
                    <HistoryDownloader />
                )}

                {/* Placeholder Tabs */}
                {['News', 'Company', 'Mailbox', 'Alerts'].includes(activeTab) && (
                    <PlaceholderTab title={activeTab} />
                )}
            </div>

            {/* Bottom Tabs */}
            <div className="rtx-bottom-dock__tabs flex items-center bg-transparent border-t border-white/5 select-none overflow-x-auto scrollbar-thin scrollbar-thumb-white/10 px-2 py-1 gap-1">
                {TABS.map((tab) => (
                    <button
                        key={tab.id}
                        onClick={() => setActiveTab(tab.id)}
                        className={`rtx-dock-tab px-4 py-1.5 text-[11px] font-semibold transition-all duration-300 whitespace-nowrap rounded-md relative overflow-hidden group
                        ${activeTab === tab.id
                                ? 'text-white bg-white/10 shadow-[0_0_15px_rgba(255,255,255,0.1)] border border-white/20 active-tab'
                                : 'text-slate-400 border border-transparent'}`}
                    >
                        {activeTab === tab.id && (
                            <span className="rtx-dock-tab-indicator absolute bottom-0 left-0 w-full h-[2px] bg-gradient-to-r from-blue-400 via-indigo-500 to-purple-500 shadow-[0_-2px_10px_rgba(99,102,241,0.5)]"></span>
                        )}
                        <span className="relative z-10">{tab.id}</span>
                        <div className="absolute inset-0 bg-gradient-to-t from-white/5 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300"></div>
                    </button>
                ))}
            </div>
        </div>
    );
}

// --- TAB COMPONENTS ---

function ToolboxTab() {
    const tools = [
        {
            category: 'Trading',
            items: [
                { name: 'New Order', shortcut: 'F9', icon: 'plus' },
                { name: 'Depth of Market', shortcut: 'Alt+B', icon: 'box' },
                { name: 'One Click Trading', shortcut: '', icon: 'mouse-pointer' },
                { name: 'Order History', shortcut: '', icon: 'history' },
            ]
        },
        {
            category: 'View',
            items: [
                { name: 'Market Watch', shortcut: 'Ctrl+M', icon: 'monitor' },
                { name: 'Data Window', shortcut: 'Ctrl+D', icon: 'database' },
                { name: 'Navigator', shortcut: 'Ctrl+N', icon: 'compass' },
                { name: 'Terminal', shortcut: 'Ctrl+T', icon: 'terminal' },
                { name: 'Strategy Tester', shortcut: 'Ctrl+R', icon: 'activity' },
                { name: 'Toolbox', shortcut: '', icon: 'tool' },
            ]
        },
        {
            category: 'Charts',
            items: [
                { name: 'Bar Chart', shortcut: 'Alt+1', icon: 'bar-chart' },
                { name: 'Candlesticks', shortcut: 'Alt+2', icon: 'candlestick' },
                { name: 'Line Chart', shortcut: 'Alt+3', icon: 'line-chart' },
                { name: 'Indicators', shortcut: 'Ctrl+I', icon: 'line-chart' },
                { name: 'Objects', shortcut: '', icon: 'square' },
            ]
        },
        {
            category: 'Tools',
            items: [
                { name: 'History Center', shortcut: 'F2', icon: 'database' },
                { name: 'Global Variables', shortcut: 'F3', icon: 'globe' },
                { name: 'MetaEditor', shortcut: 'F4', icon: 'code' },
                { name: 'Options', shortcut: 'Ctrl+O', icon: 'settings' },
            ]
        },
        {
            category: 'Window',
            items: [
                { name: 'Tile Windows', shortcut: 'Alt+R', icon: 'grid' },
                { name: 'Cascade', shortcut: '', icon: 'layers' },
                { name: 'Tile Horizontally', shortcut: '', icon: 'layout' },
                { name: 'Tile Vertically', shortcut: '', icon: 'layout' },
            ]
        },
        {
            category: 'Help',
            items: [
                { name: 'Help Topics', shortcut: 'F1', icon: 'help-circle' },
                { name: 'Documentation', shortcut: '', icon: 'book-open' },
                { name: 'Market', shortcut: '', icon: 'trending-up' },
                { name: 'Signals', shortcut: '', icon: 'signal' },
            ]
        },
    ];

    return (
        <div className="h-full w-full overflow-auto bg-[#131316] p-2 sm:p-4">
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-3 min-w-0">
                {tools.map((section) => (
                    <div key={section.category} className="space-y-2 min-w-0">
                        <h3 className="text-[11px] font-bold text-zinc-400 uppercase tracking-wider border-b border-zinc-700 pb-1 mb-2 truncate">
                            {section.category}
                        </h3>
                        <div className="space-y-1">
                            {section.items.map((item) => (
                                <button
                                    key={item.name}
                                    className="w-full flex items-center justify-between px-2 py-1.5 text-[11px] text-zinc-300 hover:bg-zinc-700/50 rounded transition-colors group text-left min-w-0"
                                    onClick={() => {
                                        if (item.name === 'New Order') {
                                            // Same event as TopToolbar & MarketWatch — App.tsx opens the order dialog
                                            window.dispatchEvent(new CustomEvent('openNewOrder'));
                                            return;
                                        }
                                        // Generic dispatch for other toolbox items
                                        const eventName = item.name.toLowerCase().replace(/\s+/g, '-');
                                        window.dispatchEvent(new CustomEvent('toolbox-action', {
                                            detail: { action: eventName, name: item.name }
                                        }));
                                    }}
                                    title={item.name}
                                >
                                    <span className="flex items-center gap-2 min-w-0 overflow-hidden">
                                        <Icon name={item.icon as any} size="xs" className="text-zinc-500 group-hover:text-zinc-300 flex-shrink-0" />
                                        <span className="group-hover:text-white truncate">{item.name}</span>
                                    </span>
                                    {item.shortcut && (
                                        <span className="text-[9px] text-zinc-600 font-mono flex-shrink-0 ml-2">{item.shortcut}</span>
                                    )}
                                </button>
                            ))}
                        </div>
                    </div>
                ))}
            </div>
        </div>
    );
}

function BlinkingText({ value, formatFn, prefix = '', suffix = '', defaultColor = 'text-zinc-100' }: any) {
    // Disabled the blinking/flashing color transition effect as per user request ("this section background blink i dont want")
    return <span className={`${defaultColor} px-0.5 rounded-sm inline-block`}>{prefix}{formatFn ? formatFn(value) : value}{suffix}</span>;
}

function TradeTab({ positions, account, onClosePosition, onModifyPosition, onCloseBulk, formatMoney, formatDate }: any) {
    const [editingId, setEditingId] = useState<number | null>(null);
    const [editSL, setEditSL] = useState("");
    const [editTP, setEditTP] = useState("");
    const [modifyPosition, setModifyPosition] = useState<any>(null);

    // Local SL/TP overrides: track modified values since the Gateway API doesn't return them
    const [slTpOverrides, setSlTpOverrides] = useState<Record<number, { sl: number; tp: number }>>({});

    // Subscribe to tick changes — throttle to 500ms so price rows don't repaint on every quote.
    // Uses functional update to keep the same reference when bid/ask values haven't changed,
    // preventing useMemo from recomputing livePositions unnecessarily.
    const [throttledTicks, setThrottledTicks] = useState<any>(() => useAppStore.getState().ticks);

    useEffect(() => {
        let lastFired = 0;
        let pending: ReturnType<typeof setTimeout> | null = null;

        const flushTicks = () => {
            setThrottledTicks((prev: any) => {
                const next = useAppStore.getState().ticks;
                const symbols = Object.keys(next);
                const changed = symbols.some(sym => {
                    const n = next[sym]; const p = prev[sym];
                    return !p || n.bid !== p.bid || n.ask !== p.ask;
                });
                return changed ? next : prev; // same ref = useMemo won't recompute
            });
        };

        const unsub = useAppStore.subscribe((state, prev) => {
            if (state.ticks === prev.ticks) return;
            const now = Date.now();
            const remaining = 500 - (now - lastFired);
            if (remaining <= 0) {
                lastFired = now;
                flushTicks();
            } else if (!pending) {
                pending = setTimeout(() => {
                    lastFired = Date.now();
                    pending = null;
                    flushTicks();
                }, remaining);
            }
        });
        return () => {
            unsub();
            if (pending) clearTimeout(pending);
        };
    }, []);

    useEffect(() => {
        const handleTradeModified = (e: any) => {
            const { id, sl, tp } = e.detail;
            setSlTpOverrides(prev => ({ ...prev, [id]: { sl, tp } }));
        };
        window.addEventListener('rtx:trade-modified', handleTradeModified);
        return () => window.removeEventListener('rtx:trade-modified', handleTradeModified);
    }, []);

    const startEditing = (pos: any) => {
        setEditingId(pos.id);
        setEditSL(pos.sl || "");
        setEditTP(pos.tp || "");
    };

    const saveEdit = (pos: any) => {
        const newSL = parseFloat(editSL) || 0;
        const newTP = parseFloat(editTP) || 0;
        onModifyPosition(pos.id, newSL, newTP);
        // Also update local overrides
        setSlTpOverrides(prev => ({ ...prev, [pos.id]: { sl: newSL, tp: newTP } }));
        setEditingId(null);
    };

    // Calculate live positions with realtime prices, PnL, and SL/TP from local overrides
    const livePositions = useMemo(() => {
        return positions.map((pos: any) => {
            const symbol = pos?.symbol ?? '';
            const tick = symbol ? throttledTicks[symbol] : undefined;
            let livePrice = Number(pos?.currentPrice ?? 0);
            let livePnL = Number(pos?.unrealizedPnL ?? 0);
            const openPrice = Number(pos?.openPrice ?? 0);
            const volume = Number(pos?.volume ?? 0);

            if (tick && openPrice > 0) {
                livePrice = pos.side === 'BUY' ? tick.bid : tick.ask;

                // PnL Calculation based on specific multipliers
                let multiplier = 100000;
                if (symbol.includes('JPY')) multiplier = 1000;
                else if (symbol.startsWith('BTC') || symbol.startsWith('ETH')) multiplier = 1;
                else if (symbol.startsWith('XAU')) multiplier = 100;
                else if (symbol.startsWith('XAG')) multiplier = 5000;

                const pipDiff = pos.side === 'BUY' ? (livePrice - openPrice) : (openPrice - livePrice);
                livePnL = pipDiff * volume * multiplier;
            }

            // Apply local SL/TP overrides (since Gateway API doesn't return these)
            const override = slTpOverrides[pos?.id];
            const sl = override?.sl ?? pos?.sl ?? 0;
            const tp = override?.tp ?? pos?.tp ?? 0;

            return {
                ...pos,
                symbol,
                volume,
                openPrice,
                sl: Number(sl ?? 0),
                tp: Number(tp ?? 0),
                livePrice,
                livePnL
            };
        });
    }, [positions, throttledTicks, slTpOverrides]);

    // Compute live account totals based on realtime positions
    const totalLivePnL = useMemo(() => livePositions.reduce((acc, pos) => acc + (pos.livePnL || 0), 0), [livePositions]);
    const liveEquity = (account?.balance || 0) + totalLivePnL;

    // Use margin from WebSocket account data (same as balance) — server knows per-symbol margin rates
    const margin = account?.margin || 0;
    // Recompute freeMargin & marginLevel using live equity for real-time accuracy
    const liveFreeMargin = liveEquity - margin;
    const liveMarginLevel = margin > 0 ? (liveEquity / margin) * 100 : 0;

    return (
        <div className="h-full flex flex-col relative bg-[#131316]">
            <div className="flex-1 overflow-auto scrollbar-thin scrollbar-thumb-zinc-700">
                <table className="w-full text-left border-collapse table-fixed">
                    <thead className="sticky top-0 bg-[#131316] text-[#a0a0a0] z-10 font-bold text-[10px] uppercase tracking-widest border-b border-zinc-700/50">
                        <tr>
                            <th className="p-1 pl-2 w-[10%] text-left">Symbol</th>
                            <th className="p-1 w-[9%] text-left">Ticket</th>
                            <th className="p-1 w-[14%] text-left">Time</th>
                            <th className="p-1 w-[6%] text-left">Type</th>
                            <th className="p-1 w-[9%] text-right">Volume</th>
                            <th className="p-1 w-[10%] text-right">Price</th>
                            <th className="p-1 w-[10%] text-right">S / L</th>
                            <th className="p-1 w-[10%] text-right">T / P</th>
                            <th className="p-1 w-[10%] text-right">Price</th>
                            <th className="p-1 pr-4 w-[10%] text-right">Profit</th>
                            <th className="w-8"></th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-zinc-800 text-zinc-300 font-mono text-[11px]">
                        {livePositions.map((pos: any, i: number) => (
                            <tr key={pos.id ?? i} className={`rtx-trade-row ${i % 2 === 0 ? 'bg-[#131316]' : 'bg-[#0f0f12]'} transition-colors group cursor-pointer`} onDoubleClick={() => setModifyPosition(pos)}>
                                <td className="p-1 pl-2 border-r border-zinc-800 font-bold text-zinc-100">{pos.symbol ?? '—'}</td>
                                <td className="p-1 border-r border-zinc-800 text-zinc-500">{pos.id ?? '—'}</td>
                                <td className="p-1 border-r border-zinc-800 text-zinc-400 whitespace-nowrap text-[10px]">{formatDate(pos.openTime ?? new Date().toISOString())}</td>
                                <td className={`p-1 border-r border-zinc-800 font-bold text-[10px] ${pos.side === 'BUY' ? 'text-blue-400' : 'text-red-400'}`}>
                                    <div className="flex items-center gap-1">
                                        {pos.side === 'BUY' ? (
                                            <svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="M12 19V5M5 12l7-7 7 7"/></svg>
                                        ) : (
                                            <svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="M12 5v14M19 12l-7 7-7-7"/></svg>
                                        )}
                                        <span>{pos.side ?? '—'}</span>
                                    </div>
                                </td>
                                <td className="p-1 border-r border-zinc-800 text-right font-medium text-zinc-200">{Number(pos.volume ?? 0).toFixed(2)}</td>
                                <td className="p-1 border-r border-zinc-800 text-right text-zinc-400"><PriceDisplay price={Number(pos.openPrice ?? 0)} symbol={pos.symbol ?? ''} /></td>

                                {/* SL Edit */}
                                <td className="p-1 border-r border-zinc-800 text-right" onDoubleClick={() => startEditing(pos)}>
                                    {editingId === pos.id ? (
                                        <input
                                            className="w-full bg-zinc-800 text-white text-right px-1 text-[10px]"
                                            value={editSL}
                                            onChange={e => setEditSL(e.target.value)}
                                            onBlur={() => saveEdit(pos)}
                                            onKeyDown={e => e.key === 'Enter' && saveEdit(pos)}
                                            autoFocus
                                        />
                                    ) : (
                                        <span className={pos.sl > 0 ? "text-red-300 bg-red-900/20 px-1 rounded-sm" : "text-zinc-600"}>
                                            {pos.sl > 0 ? <PriceDisplay price={Number(pos.sl)} symbol={pos.symbol ?? ''} /> : ''}
                                        </span>
                                    )}
                                </td>

                                {/* TP Edit */}
                                <td className="p-1 border-r border-zinc-800 text-right" onDoubleClick={() => startEditing(pos)}>
                                    {editingId === pos.id ? (
                                        <input
                                            className="w-full bg-zinc-800 text-white text-right px-1 text-[10px]"
                                            value={editTP}
                                            onChange={e => setEditTP(e.target.value)}
                                            onBlur={() => saveEdit(pos)}
                                            onKeyDown={e => e.key === 'Enter' && saveEdit(pos)}
                                        />
                                    ) : (
                                        <span className={pos.tp > 0 ? "text-emerald-300 bg-emerald-900/20 px-1 rounded-sm" : "text-zinc-600"}>
                                            {pos.tp > 0 ? <PriceDisplay price={Number(pos.tp)} symbol={pos.symbol ?? ''} /> : ''}
                                        </span>
                                    )}
                                </td>

                                <td className="p-1 border-r border-zinc-800 text-right">
                                    <BlinkingText value={Number(pos.livePrice ?? 0)} formatFn={(v: number) => <PriceDisplay price={v} symbol={pos.symbol ?? ''} />} defaultColor="text-zinc-300" />
                                </td>
                                <td className={`p-1 text-right font-bold pr-4`}>
                                    <BlinkingText value={Number(pos.livePnL ?? 0)} formatFn={formatMoney} defaultColor={Number(pos.livePnL ?? 0) >= 0 ? 'text-[#4ade80]' : 'text-[#f87171]'} />
                                </td>
                                <td className="p-1 text-center">
                                    <button
                                        onClick={() => onClosePosition(pos.id)}
                                        className="text-zinc-600 hover:text-white hover:bg-zinc-700 w-4 h-4 rounded flex items-center justify-center transition-colors"
                                    >
                                        ×
                                    </button>
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>

            {/* Footer Summary Row (Full Account Info) */}
            <div className="rtx-trade-footer bg-[#191a1e] border-t border-zinc-700 w-full overflow-hidden text-[11px] font-bold text-zinc-300 flex items-center px-2 py-1 gap-3 tabular-nums shadow-[inset_0_1px_0_0_rgba(255,255,255,0.05)]">
                <Icon name="plus-circle" size="xs" className="text-zinc-400 mr-1" />
                <span className="flex gap-1"><span className="rtx-trade-metric-label text-zinc-500">Balance:</span> <BlinkingText value={account?.balance || 0} formatFn={formatMoney} suffix={` ${account?.currency || 'USD'}`} /></span>
                <span className="flex gap-1"><span className="rtx-trade-metric-label text-zinc-500">Equity:</span> <BlinkingText value={liveEquity} formatFn={formatMoney} /></span>
                <span className="flex gap-1"><span className="rtx-trade-metric-label text-zinc-500">Margin:</span> <BlinkingText value={margin} formatFn={formatMoney} /></span>
                <span className="flex gap-1"><span className="rtx-trade-metric-label text-zinc-500">Free Margin:</span> <BlinkingText value={liveFreeMargin} formatFn={formatMoney} /></span>
                <span className="flex gap-1"><span className="rtx-trade-metric-label text-zinc-500">Margin Level:</span> <BlinkingText value={liveMarginLevel} formatFn={formatMoney} suffix=" %" /></span>
                <div className="flex-1"></div>
                <button
                    type="button"
                    onClick={() => onCloseBulk?.('WINNERS')}
                    disabled={!onCloseBulk || livePositions.length === 0}
                    className="rtx-trade-bulk-close px-2 py-0.5 rounded-sm border border-zinc-700 text-zinc-300 hover:bg-zinc-700/60 disabled:opacity-40 disabled:cursor-not-allowed"
                >
                    Close Winners
                </button>
                <button
                    type="button"
                    onClick={() => onCloseBulk?.('LOSERS')}
                    disabled={!onCloseBulk || livePositions.length === 0}
                    className="px-2 py-0.5 rounded-sm border border-zinc-700 text-zinc-300 hover:bg-zinc-700/60 disabled:opacity-40 disabled:cursor-not-allowed"
                >
                    Close Losers
                </button>
                <button
                    type="button"
                    onClick={() => onCloseBulk?.('ALL')}
                    disabled={!onCloseBulk || livePositions.length === 0}
                    className="px-2 py-0.5 rounded-sm border border-red-800/70 text-red-300 hover:bg-red-950/50 disabled:opacity-40 disabled:cursor-not-allowed"
                >
                    Close All
                </button>
                <span className="pr-4 font-bold text-zinc-100"><BlinkingText value={totalLivePnL} formatFn={formatMoney} defaultColor={totalLivePnL >= 0 ? "text-emerald-400" : "text-red-400"} /></span>
            </div>
            {/* Modify Position Dialog */}
            <ModifyPositionDialog
                isOpen={modifyPosition !== null}
                onClose={(modifiedSl?: number, modifiedTp?: number) => {
                    // Capture the modified SL/TP values in local overrides
                    if (modifyPosition && modifiedSl !== undefined && modifiedTp !== undefined) {
                        setSlTpOverrides(prev => ({
                            ...prev,
                            [modifyPosition.id]: { sl: modifiedSl, tp: modifiedTp }
                        }));
                    }
                    setModifyPosition(null);
                }}
                position={modifyPosition}
            />
        </div>
    );
}

function ExposureTab({ positions, formatMoney, account }: any) {
    // Calculate exposure
    const exposure = useMemo(() => {
        const map: Record<string, { volume: number, rate: number, usdValue: number, type: 'Long' | 'Short' | 'Net' }> = {};
        positions.forEach((p: any) => {
            const asset = p.symbol.substring(0, 3); // Simple 3-char assumption for base currency
            if (!map[asset]) map[asset] = { volume: 0, rate: p.currentPrice || 1.0, usdValue: 0, type: 'Net' };
            const isBuy = p.side === 'BUY';
            map[asset].volume += p.volume * (isBuy ? 1 : -1);

            // Calculate USD Value based on current price and standard lot size (100k)
            const positionValue = p.volume * 100000 * (p.currentPrice || 1.0);
            map[asset].usdValue += positionValue * (isBuy ? 1 : -1);

            // Update rate to current price for display
            map[asset].rate = p.currentPrice || 1.0;
        });

        // Add actual base currency exposure
        const baseCur = account?.currency || 'USD';
        const bal = account?.balance || 0;
        if (bal > 0) {
            map[baseCur] = { volume: bal, rate: 1.0, usdValue: bal, type: 'Long' };
        }

        return Object.entries(map).map(([asset, data]) => ({ asset, ...data }));
    }, [positions, account]);

    return (
        <div className="h-full flex bg-[#131316]">
            {/* Table */}
            <div className="flex-1 overflow-auto border-r border-zinc-700">
                <table className="w-full text-left border-collapse">
                    <thead className="sticky top-0 bg-[#131316] text-[#a0a0a0] z-10 font-bold text-[10px] uppercase tracking-widest border-b border-zinc-700/50">
                        <tr>
                            <th className="p-1 pl-2 w-24">Assets</th>
                            <th className="p-1 w-24 text-right">Volume</th>
                            <th className="p-1 w-24 text-right">Rate</th>
                            <th className="p-1 w-24 text-right">USD</th>
                            <th className="p-1 text-center">Graph</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-zinc-800 text-zinc-300 font-mono text-[11px]">
                        {exposure.map((exp: any, i: number) => (
                            <tr key={exp.asset} className={`${i % 2 === 0 ? 'bg-[#131316]' : 'bg-[#0f0f12]'}`}>
                                <td className="p-1 pl-2 border-r border-zinc-800 font-bold text-[#ebc034]">{exp.asset}</td>
                                <td className="p-1 border-r border-zinc-800 text-right">{exp.volume.toFixed(2)}</td>
                                <td className="p-1 border-r border-zinc-800 text-right">{exp.rate.toFixed(5)}</td>
                                <td className="p-1 border-r border-zinc-800 text-right">{formatMoney(exp.usdValue)}</td>
                                <td className="p-1 px-4 align-middle">
                                    <div className="w-full h-3 bg-zinc-800 rounded-sm overflow-hidden flex">
                                        {exp.usdValue > 0 && <div className="h-full bg-zinc-8000" style={{ width: '60%' }}></div>}
                                        {exp.usdValue < 0 && <div className="h-full bg-red-500" style={{ width: '40%' }}></div>}
                                    </div>
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>

            {/* Pie Chart Area */}
            <div className="w-64 bg-[#131316] flex flex-col items-center justify-center p-4">
                <div className="text-[10px] text-zinc-400 mb-2 font-bold uppercase tracking-wider">Long Positions</div>
                <div className="w-32 h-32 rounded-full border-4 border-zinc-600 flex items-center justify-center relative shadow-[0_0_15px_rgba(59,130,246,0.5)]">
                    {/* Placeholder for SVG Pie */}
                    <span className="text-[10px] text-zinc-500">USD</span>
                </div>
            </div>
        </div>
    );
}

function HistoryTab({ formatMoney }: any) {
    const [orders, setOrders] = useState<any[]>([]);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [filter, setFilter] = useState<'today' | 'week' | 'month' | 'all'>('all');

    const fetchHistory = async () => {
        const login = getStoredAccountLogin();
        if (!login) { setError('No account login found'); return; }
        setLoading(true);
        setError(null);
        try {
            const data = await tradeGatewayApi.getOrderHistory(login);
            setOrders(data);
        } catch (err: any) {
            console.warn('[History] Failed to load:', err);
            setError(err?.message || 'Failed to load history');
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => { fetchHistory(); }, []);

    const filteredOrders = useMemo(() => {
        if (filter === 'all') return orders;
        const cutoff = Date.now() - (filter === 'today' ? 86400000 : filter === 'week' ? 7 * 86400000 : 30 * 86400000);
        return orders.filter(o => Date.parse(o.closeTime || o.openTime || '') >= cutoff);
    }, [orders, filter]);

    const formatTs = (value: string) => {
        if (!value) return '-';
        return new Date(value).toLocaleString('en-US', {
            year: 'numeric', month: '2-digit', day: '2-digit',
            hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false
        }).replace(',', '');
    };

    const typeColor = (type: string) => {
        const t = (type || '').toLowerCase();
        return t.includes('buy') ? 'text-blue-400' : t.includes('sell') ? 'text-red-400' : 'text-zinc-400';
    };

    return (
        <div className="h-full flex flex-col bg-[#131316]">
            {/* Toolbar */}
            <div className="flex items-center gap-2 px-2 py-1 border-b border-zinc-700 bg-[#1a1a1a] shrink-0">
                <div className="flex gap-1">
                    {(['today', 'week', 'month', 'all'] as const).map(f => (
                        <button key={f} onClick={() => setFilter(f)}
                            className={`rtx-journal-time-btn px-2 py-0.5 text-[10px] rounded capitalize transition-colors ${filter === f ? 'bg-zinc-600 text-white' : 'text-zinc-400'}`}>
                            {f}
                        </button>
                    ))}
                </div>
                <div className="flex-1" />
                <span className="text-[10px] text-zinc-500">{filteredOrders.length} orders</span>
                <button onClick={fetchHistory} disabled={loading}
                    className="text-[10px] px-2 py-0.5 rounded bg-zinc-700 hover:bg-zinc-600 text-zinc-300 flex items-center gap-1">
                    <Icon name="refresh" size="xs" className={loading ? 'animate-spin' : ''} />
                    {loading ? 'Loading…' : 'Refresh'}
                </button>
            </div>

            {/* States */}
            {loading && <div className="flex-1 flex items-center justify-center text-zinc-500 text-xs">Loading order history…</div>}
            {!loading && error && (
                <div className="flex-1 flex flex-col items-center justify-center gap-2">
                    <button onClick={fetchHistory} className="text-[10px] px-3 py-1 bg-zinc-700 rounded hover:bg-zinc-600 text-zinc-300">Retry</button>
                </div>
            )}
            {!loading && !error && filteredOrders.length === 0 && (
                <div className="flex-1 flex items-center justify-center text-zinc-600 text-xs italic">No order history for this period</div>
            )}

            {/* Table */}
            {!loading && !error && filteredOrders.length > 0 && (
                <div className="flex-1 overflow-auto scrollbar-thin scrollbar-thumb-zinc-700">
                    <table className="w-full text-left border-collapse">
                        <thead className="sticky top-0 bg-[#131316] text-[#a0a0a0] z-10 font-bold text-[10px] uppercase tracking-widest border-b border-zinc-700/50">
                            <tr>
                                <th className="p-1 pl-2 w-20">Ticket</th>
                                <th className="p-1 w-28">Open Time</th>
                                <th className="p-1 w-14">Type</th>
                                <th className="p-1 w-16 text-right">Volume</th>
                                <th className="p-1 w-20 pl-3">Symbol</th>
                                <th className="p-1 w-22 text-right">Open Price</th>
                                <th className="p-1 w-20 text-right">S/L</th>
                                <th className="p-1 w-20 text-right">T/P</th>
                                <th className="p-1 w-28 text-right">Close Time</th>
                                <th className="p-1 w-22 text-right">Close Price</th>
                                <th className="p-1 w-20 text-right">State</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-zinc-800 text-zinc-300 font-mono text-[11px]">
                            {filteredOrders.map((o: any, i: number) => (
                                <tr key={`${o.type}-${o.id}-${i}`}
                                    className="rtx-history-row group transition-all duration-300 ease-in-out">
                                    <td className="p-1 pl-2 border-r border-zinc-800 text-zinc-500">{o.id ?? '-'}</td>
                                    <td className="p-1 border-r border-zinc-800 text-zinc-400 whitespace-nowrap text-[10px]">{formatTs(o.openTime)}</td>
                                    <td className={`p-1 border-r border-zinc-800 font-bold text-[10px] ${typeColor(o.side)}`}>{(o.side || o.type || '-').toUpperCase()}</td>
                                    <td className="p-1 border-r border-zinc-800 text-right font-medium text-zinc-200">
                                        {o.volume != null ? Number(o.volume).toFixed(2) : '-'}
                                    </td>
                                    <td className="p-1 border-r border-zinc-800 font-bold text-zinc-100 pl-3">{o.symbol ?? '-'}</td>
                                    <td className="p-1 border-r border-zinc-800 text-right text-zinc-400">
                                        {o.openPrice ? <PriceDisplay price={o.openPrice} symbol={o.symbol} /> : '-'}
                                    </td>
                                    <td className="p-1 border-r border-zinc-800 text-right text-zinc-500">
                                        -
                                    </td>
                                    <td className="p-1 border-r border-zinc-800 text-right text-zinc-500">
                                        -
                                    </td>
                                    <td className="p-1 border-r border-zinc-800 text-right text-zinc-400 text-[10px]">{formatTs(o.closeTime || o.openTime)}</td>
                                    <td className="p-1 border-r border-zinc-800 text-right text-zinc-400">
                                        {o.closePrice ? <PriceDisplay price={o.closePrice} symbol={o.symbol} /> : '-'}
                                    </td>
                                    <td className="p-1 pr-2 text-right text-zinc-500 text-[10px]">{o.type ?? '-'}</td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            )}
        </div>
    );
}




function PlaceholderTab({ title }: { title: string }) {
    return (
        <div className="flex-1 flex flex-col items-center justify-center text-zinc-600 bg-[#131316]">
            <Icon name="briefcase" size="xl" className="mb-2 opacity-20" />
            <div className="text-xs font-medium">RTX5 {title}</div>
            <div className="text-[10px]">No active items to display</div>
        </div>
    );
}
