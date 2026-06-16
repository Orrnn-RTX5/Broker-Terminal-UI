import { Icon } from './ui/Icon';
import { PriceDisplay } from './ui/PriceDisplay';
import { ContextMenu, type ContextMenuItemConfig } from './ui/ContextMenu';
import { ModifyPositionDialog } from './ModifyPositionDialog';
import { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { CalendarTab } from './layout/CalendarTab';
import { CodeBaseTab, ArticlesTab, ExpertsTab } from './layout/ResearchTabs';
import { JournalTab } from './layout/JournalTab';
import { HistoryDownloader } from './HistoryDownloader';
import { useAppStore } from '../store/useAppStore';
import { useToolboxTradeData, type ToolboxTradePosition } from '../hooks/useToolboxTradeData';
import { getStoredAccountLogin, tradeGatewayApi } from '../api/tradeGateway';
import { useChartSettingsStore } from '../store/useChartSettingsStore';
import { formatPrice, getSymbolDigits } from '../utils/symbolUtils';

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
type TradeSortColumn = 'symbol' | 'ticket' | 'time_create' | 'profit';
type TradeSortDirection = 'asc' | 'desc';
type TradeSortState = { column: TradeSortColumn; direction: TradeSortDirection } | null;
type TradeProfitMode = 'money' | 'points';
type TradeVolumeMode = 'lots' | 'amounts';
type TradeColumnKey =
    | 'ticket'
    | 'time'
    | 'side'
    | 'volume'
    | 'priceOpen'
    | 'sl'
    | 'tp'
    | 'priceCurrent'
    | 'swap'
    | 'accountLogin'
    | 'timeUpdate'
    | 'comment'
    | 'profit';

type TradeColumnVisibility = Record<TradeColumnKey, boolean>;
type TradeColumnWidthKey = TradeColumnKey | 'symbol' | 'close';
type TradeColumnWidths = Record<TradeColumnWidthKey, number>;
type TradeColumnDef = {
    key: TradeColumnKey;
    label: string;
    defaultWidth: number;
    minWidth: number;
    maxWidth: number;
};

const TRADE_COLUMN_STORAGE_KEY = 'rtx5_trade_columns_v3';
const TRADE_COLUMN_WIDTH_STORAGE_KEY = 'rtx5_trade_column_widths_v1';
const TRADE_PROFIT_MODE_STORAGE_KEY = 'rtx5_trade_profit_mode';
const TRADE_VOLUME_MODE_STORAGE_KEY = 'rtx5_trade_volume_mode';
const TRADE_SHOW_ON_CHARTS_AUTO_UPDATE_STORAGE_KEY = 'rtx5_trade_show_on_charts_auto_update';

const TRADE_COLUMN_DEFS: TradeColumnDef[] = [
    { key: 'ticket', label: 'Ticket', defaultWidth: 96, minWidth: 70, maxWidth: 180 },
    { key: 'time', label: 'Time', defaultWidth: 150, minWidth: 120, maxWidth: 220 },
    { key: 'side', label: 'Side / Type', defaultWidth: 76, minWidth: 64, maxWidth: 130 },
    { key: 'volume', label: 'Volume', defaultWidth: 74, minWidth: 62, maxWidth: 120 },
    { key: 'priceOpen', label: 'Price Open', defaultWidth: 98, minWidth: 82, maxWidth: 150 },
    { key: 'sl', label: 'S / L', defaultWidth: 92, minWidth: 80, maxWidth: 150 },
    { key: 'tp', label: 'T / P', defaultWidth: 92, minWidth: 80, maxWidth: 150 },
    { key: 'priceCurrent', label: 'Price Current', defaultWidth: 108, minWidth: 90, maxWidth: 160 },
    { key: 'swap', label: 'Swap', defaultWidth: 72, minWidth: 62, maxWidth: 120 },
    { key: 'accountLogin', label: 'Account Login', defaultWidth: 108, minWidth: 88, maxWidth: 160 },
    { key: 'timeUpdate', label: 'Time Update', defaultWidth: 150, minWidth: 120, maxWidth: 220 },
    { key: 'comment', label: 'Comment', defaultWidth: 130, minWidth: 90, maxWidth: 260 },
    { key: 'profit', label: 'Profit', defaultWidth: 92, minWidth: 72, maxWidth: 140 },
];

const TRADE_COLUMN_DEF_BY_KEY = TRADE_COLUMN_DEFS.reduce((acc, column) => {
    acc[column.key] = column;
    return acc;
}, {} as Record<TradeColumnKey, TradeColumnDef>);

const ALL_TRADE_COLUMNS: TradeColumnVisibility = TRADE_COLUMN_DEFS.reduce((acc, column) => {
    acc[column.key] = true;
    return acc;
}, {} as TradeColumnVisibility);

const DEFAULT_TRADE_COLUMNS: TradeColumnVisibility = {
    ...ALL_TRADE_COLUMNS,
    swap: false,
    accountLogin: false,
    timeUpdate: false,
    comment: false,
};

const TRADE_FIXED_COLUMN_DEFS: Record<'symbol' | 'close', Omit<TradeColumnDef, 'key'> & { key: 'symbol' | 'close' }> = {
    symbol: { key: 'symbol', label: 'Symbol', defaultWidth: 92, minWidth: 74, maxWidth: 180 },
    close: { key: 'close', label: 'Close', defaultWidth: 22, minWidth: 22, maxWidth: 36 },
};

const DEFAULT_TRADE_COLUMN_WIDTHS: TradeColumnWidths = TRADE_COLUMN_DEFS.reduce((acc, column) => {
    acc[column.key] = column.defaultWidth;
    return acc;
}, {
    symbol: TRADE_FIXED_COLUMN_DEFS.symbol.defaultWidth,
    close: TRADE_FIXED_COLUMN_DEFS.close.defaultWidth,
} as TradeColumnWidths);

const TRADE_DEFAULT_SORT_DIRECTION: Record<TradeSortColumn, TradeSortDirection> = {
    symbol: 'asc',
    ticket: 'desc',
    time_create: 'desc',
    profit: 'desc',
};

const safeReadJson = <T,>(key: string, fallback: T): T => {
    if (typeof window === 'undefined') return fallback;
    try {
        const raw = window.localStorage.getItem(key);
        if (!raw) return fallback;
        return { ...fallback, ...JSON.parse(raw) };
    } catch {
        return fallback;
    }
};

const safeReadString = <T extends string>(key: string, allowed: readonly T[], fallback: T): T => {
    if (typeof window === 'undefined') return fallback;
    try {
        const raw = window.localStorage.getItem(key);
        return allowed.includes(raw as T) ? (raw as T) : fallback;
    } catch {
        return fallback;
    }
};

const safeReadBoolean = (key: string, fallback: boolean): boolean => {
    if (typeof window === 'undefined') return fallback;
    try {
        const raw = window.localStorage.getItem(key);
        if (raw === null) return fallback;
        return raw === 'true';
    } catch {
        return fallback;
    }
};

const getTradeColumnDef = (key: TradeColumnWidthKey) => (
    key === 'symbol' || key === 'close'
        ? TRADE_FIXED_COLUMN_DEFS[key]
        : TRADE_COLUMN_DEF_BY_KEY[key]
);

const clampTradeColumnWidth = (key: TradeColumnWidthKey, width: number): number => {
    const column = getTradeColumnDef(key);
    const safeWidth = Number.isFinite(width) ? width : column.defaultWidth;
    return Math.min(column.maxWidth, Math.max(column.minWidth, Math.round(safeWidth)));
};

const normalizeTradeColumnWidths = (value: Partial<Record<TradeColumnWidthKey, unknown>>): TradeColumnWidths => {
    const widths = { ...DEFAULT_TRADE_COLUMN_WIDTHS };
    (Object.keys(widths) as TradeColumnWidthKey[]).forEach((key) => {
        widths[key] = clampTradeColumnWidth(key, Number(value[key] ?? widths[key]));
    });
    return widths;
};

const escapeHtml = (value: unknown): string => (
    String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;')
);

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
    const toolboxTrade = useToolboxTradeData();

    // Value-level caches — prevent setState when broker sends new objects with same field values
    const cachedAccountSig = useRef<string>('');
    const cachedPositionsSig = useRef<string>('');

    const accountSig = (a: any) => !a ? '' : `${a.balance}|${a.equity}|${a.margin}|${a.freeMargin}|${a.marginLevel}`;
    const positionsSig = (ps: any[]) => ps.map(p => `${p.id}-${p.volume}-${p.sl}-${p.tp}-${p.currentPrice}-${p.unrealizedPnL}`).join('|');

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

    const [activeTab, setActiveTab] = useState<TabType>('Trade');
    
    const [isResizing, setIsResizing] = useState(false);

    const refreshTradeSoon = () => {
        window.setTimeout(() => {
            void toolboxTrade.refresh();
        }, 1500);
    };

    const handleTradeClosePosition = (id: number, volume?: number) => {
        toolboxTrade.removePosition(Number(id));
        const result = onClosePosition(id, volume) as unknown;
        if (result && typeof (result as any).finally === 'function') {
            (result as any).finally(refreshTradeSoon);
        } else {
            refreshTradeSoon();
        }
    };

    const handleTradeCloseBulk = (type: 'ALL' | 'WINNERS' | 'LOSERS', symbol?: string) => {
        if (!symbol) {
            toolboxTrade.removePositionsByMode(type);
        }
        const result = onCloseBulk?.(type, symbol) as unknown;
        if (result && typeof (result as any).finally === 'function') {
            (result as any).finally(refreshTradeSoon);
        } else {
            refreshTradeSoon();
        }
    };

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
        window.addEventListener('rtx:new-trade-placed', handleTradeExecution);
        return () => window.removeEventListener('rtx:new-trade-placed', handleTradeExecution);
    }, []);

    // Auto-switch to Journal if the account equity hits 0 (margin call / account blown)
    const prevEquityRef = useRef<number | null>(null);
    useEffect(() => {
        // Expose a global testing function for the user to simulate blowing up their account manually
        (window as any).testBlowup = () => {
            const currentAccount = useAppStore.getState().account;
            if (currentAccount) {
                useAppStore.getState().setAccount({ ...currentAccount, equity: 0, balance: 0, freeMargin: 0, marginLevel: 0 });
                console.log("0000 Simulated Account Blow Up! Equity is now 0. You should be navigated to the Journal tab.");
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
                        positions={toolboxTrade.positions ?? []}
                        account={toolboxTrade.account}
                        onClosePosition={handleTradeClosePosition}
                        onModifyPosition={onModifyPosition}
                        onCloseBulk={handleTradeCloseBulk}
                        formatMoney={formatMoney}
                        formatDate={formatDate}
                        loading={toolboxTrade.loading}
                        error={toolboxTrade.error}
                        wsState={toolboxTrade.wsState}
                        restBaseUrl={toolboxTrade.restBaseUrl}
                        wsUrl={toolboxTrade.wsUrl}
                        lastRestAt={toolboxTrade.lastRestAt}
                        lastWsAt={toolboxTrade.lastWsAt}
                        onRefresh={toolboxTrade.refresh}
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
            <div className="rtx-bottom-dock__tabs flex items-end bg-[#080c18] border-t border-zinc-700/80 select-none overflow-x-auto scrollbar-thin scrollbar-thumb-zinc-700 px-1 py-0 gap-0">
                {TABS.map((tab) => (
                    <button
                        key={tab.id}
                        onClick={() => setActiveTab(tab.id)}
                        className={`rtx-dock-tab h-[27px] px-4 text-[11px] font-normal whitespace-nowrap rounded-none border-r border-zinc-800 border-t transition-colors duration-75 relative
                        ${activeTab === tab.id
                                ? 'text-white bg-[#131316] border-t-[#8b8f98] border-l border-l-zinc-700 active-tab'
                                : 'text-slate-400 bg-[#090d19] border-t-transparent hover:text-zinc-100 hover:bg-[#111827]'}`}
                    >
                        {tab.id}
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

function TradeTab({
    positions,
    account,
    onClosePosition,
    onModifyPosition,
    onCloseBulk,
    formatMoney,
    formatDate,
    loading,
    error,
}: any) {
    const [editingId, setEditingId] = useState<number | null>(null);
    const [editSL, setEditSL] = useState("");
    const [editTP, setEditTP] = useState("");
    const [modifyPosition, setModifyPosition] = useState<any>(null);
    const [sortState, setSortState] = useState<TradeSortState>(null);
    const [tradeContextMenu, setTradeContextMenu] = useState<{ x: number; y: number; position: ToolboxTradePosition } | null>(null);
    const [columnVisibility, setColumnVisibility] = useState<TradeColumnVisibility>(() => safeReadJson(TRADE_COLUMN_STORAGE_KEY, DEFAULT_TRADE_COLUMNS));
    const [columnWidths, setColumnWidths] = useState<TradeColumnWidths>(() => normalizeTradeColumnWidths(safeReadJson(TRADE_COLUMN_WIDTH_STORAGE_KEY, DEFAULT_TRADE_COLUMN_WIDTHS)));
    const [profitMode, setProfitMode] = useState<TradeProfitMode>(() => safeReadString(TRADE_PROFIT_MODE_STORAGE_KEY, ['money', 'points'] as const, 'money'));
    const [volumeMode, setVolumeMode] = useState<TradeVolumeMode>(() => safeReadString(TRADE_VOLUME_MODE_STORAGE_KEY, ['lots', 'amounts'] as const, 'lots'));
    const [showOnChartsAutoUpdate, setShowOnChartsAutoUpdate] = useState<boolean>(() => safeReadBoolean(TRADE_SHOW_ON_CHARTS_AUTO_UPDATE_STORAGE_KEY, true));
    const [selectedPositionKey, setSelectedPositionKey] = useState<string | null>(null);
    const [resizingColumn, setResizingColumn] = useState<TradeColumnWidthKey | null>(null);
    const tableScrollRef = useRef<HTMLDivElement | null>(null);
    const footerScrollRef = useRef<HTMLDivElement | null>(null);
    const syncingScrollRef = useRef<'table' | 'footer' | null>(null);
    const columnResizeRef = useRef<{ key: TradeColumnWidthKey; startX: number; startWidth: number } | null>(null);

    // Local SL/TP overrides: track modified values since the Gateway API doesn't return them
    const [slTpOverrides, setSlTpOverrides] = useState<Record<number, { sl: number; tp: number }>>({});

    // Subscribe to positions instead of ticks for highspeed socket data
    // (Handled by the parent component, BottomDock, which passes throttled positions)

    useEffect(() => {
        const handleTradeModified = (e: any) => {
            const { id, sl, tp } = e.detail;
            setSlTpOverrides(prev => ({ ...prev, [id]: { sl, tp } }));
        };
        window.addEventListener('rtx:trade-modified', handleTradeModified);
        return () => window.removeEventListener('rtx:trade-modified', handleTradeModified);
    }, []);

    useEffect(() => {
        window.localStorage.setItem(TRADE_COLUMN_STORAGE_KEY, JSON.stringify(columnVisibility));
    }, [columnVisibility]);

    useEffect(() => {
        window.localStorage.setItem(TRADE_COLUMN_WIDTH_STORAGE_KEY, JSON.stringify(columnWidths));
    }, [columnWidths]);

    useEffect(() => {
        window.localStorage.setItem(TRADE_PROFIT_MODE_STORAGE_KEY, profitMode);
    }, [profitMode]);

    useEffect(() => {
        window.localStorage.setItem(TRADE_VOLUME_MODE_STORAGE_KEY, volumeMode);
    }, [volumeMode]);

    useEffect(() => {
        window.localStorage.setItem(TRADE_SHOW_ON_CHARTS_AUTO_UPDATE_STORAGE_KEY, String(showOnChartsAutoUpdate));
    }, [showOnChartsAutoUpdate]);

    const startEditing = (pos: any) => {
        setEditingId(pos.id);
        setEditSL(String((pos.price_sl ?? pos.sl) || ""));
        setEditTP(String((pos.price_tp ?? pos.tp) || ""));
    };

    const [isLightSkin, setIsLightSkin] = useState(false);
    useEffect(() => {
        const root = document.documentElement;
        const check = () => setIsLightSkin(root.classList.contains('rtx-skin-untitled-light'));
        check();
        const obs = new MutationObserver(check);
        obs.observe(root, { attributes: true, attributeFilter: ['class'] });
        return () => obs.disconnect();
    }, []);

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
            const livePrice = Number(pos?.currentPrice ?? 0);
            const livePnL = Number(pos?.unrealizedPnL ?? 0);
            const openPrice = Number(pos?.openPrice ?? 0);
            const volume = Number(pos?.volume ?? 0);

            // Apply local SL/TP overrides (since Gateway API doesn't return these)
            const override = slTpOverrides[pos?.id];
            const sl = override?.sl ?? pos?.price_sl ?? pos?.sl ?? 0;
            const tp = override?.tp ?? pos?.price_tp ?? pos?.tp ?? 0;

            return {
                ...pos,
                symbol,
                volume,
                openPrice,
                sl: Number(sl ?? 0),
                tp: Number(tp ?? 0),
                price_sl: Number(sl ?? 0),
                price_tp: Number(tp ?? 0),
                livePrice,
                livePnL
            };
        });
    }, [positions, slTpOverrides]);

    // Position totals come from rows. Account metrics use REST/WS account/metrics as source of truth.
    const totalLivePnL = useMemo(() => livePositions.reduce((acc, pos) => acc + (pos.livePnL || 0), 0), [livePositions]);
    const totalSwap = useMemo(() => livePositions.reduce((acc, pos) => acc + (Number(pos.swap) || 0), 0), [livePositions]);
    const totalCommission = useMemo(() => livePositions.reduce((acc, pos) => acc + (Number(pos.commission) || 0), 0), [livePositions]);
    const liveEquity = Number.isFinite(Number(account?.equity)) ? Number(account?.equity) : (account?.balance || 0) + totalLivePnL;
    const margin = Number(account?.margin || 0);
    const liveFreeMargin = Number.isFinite(Number(account?.freeMargin)) ? Number(account?.freeMargin) : liveEquity - margin;
    const liveMarginLevel = Number.isFinite(Number(account?.marginLevel)) ? Number(account?.marginLevel) : (margin > 0 ? (liveEquity / margin) * 100 : 0);

    const formatMarginLevel = (value: number) => {
        if (value <= 0 && livePositions.length === 0) return '\u221e';
        return `${formatMoney(value)} %`;
    };

    const formatTradeTime = (value?: number | string | null) => {
        if (value === undefined || value === null || value === '' || value === 0) return '-';
        const textValue = String(value).trim();
        const numericValue = Number(textValue);
        const date = Number.isFinite(numericValue)
            ? new Date(numericValue > 1_000_000_000_000 ? numericValue : numericValue * 1000)
            : new Date(textValue);
        if (Number.isNaN(date.getTime())) return '-';
        const pad = (n: number) => String(n).padStart(2, '0');
        return `${date.getFullYear()}.${pad(date.getMonth() + 1)}.${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
    };

    const formatTradePrice = (value: unknown, symbol: string) => {
        const price = Number(value);
        return Number.isFinite(price) && price > 0 ? formatPrice(price, symbol) : '-';
    };

    const formatTradeLevel = (value: unknown, symbol: string) => {
        const price = Number(value);
        return Number.isFinite(price) && price > 0 ? formatPrice(price, symbol) : '0.00';
    };

    const getTradeTimeValue = useCallback((value?: number | string | null) => {
        if (value === undefined || value === null || value === '' || value === 0) return 0;
        const numericValue = Number(String(value).trim());
        if (Number.isFinite(numericValue)) return numericValue > 1_000_000_000_000 ? numericValue : numericValue * 1000;
        const parsed = new Date(String(value)).getTime();
        return Number.isFinite(parsed) ? parsed : 0;
    }, []);

    const getSortValue = useCallback((pos: ToolboxTradePosition, column: TradeSortColumn): string | number => {
        switch (column) {
            case 'symbol':
                return String(pos.symbol ?? '').toUpperCase();
            case 'ticket':
                return Number(pos.ticket ?? pos.id ?? 0);
            case 'time_create':
                return getTradeTimeValue(pos.time_create);
            case 'profit':
                return Number(pos.profit ?? pos.unrealizedPnL ?? 0);
            default:
                return '';
        }
    }, [getTradeTimeValue]);

    const toggleSort = (column: TradeSortColumn) => {
        setSortState(prev => {
            if (!prev || prev.column !== column) {
                return { column, direction: TRADE_DEFAULT_SORT_DIRECTION[column] };
            }
            return { column, direction: prev.direction === 'asc' ? 'desc' : 'asc' };
        });
    };

    const isColumnVisible = useCallback((key: TradeColumnKey) => columnVisibility[key] !== false, [columnVisibility]);

    const toggleColumn = useCallback((key: TradeColumnKey) => {
        setColumnVisibility(prev => ({ ...prev, [key]: prev[key] === false }));
    }, []);

    const showAllTradeColumns = useCallback(() => {
        setColumnVisibility(ALL_TRADE_COLUMNS);
    }, []);

    const resetTradeColumns = useCallback(() => {
        setColumnVisibility(DEFAULT_TRADE_COLUMNS);
        setColumnWidths(DEFAULT_TRADE_COLUMN_WIDTHS);
    }, []);

    const visibleTradeColumns = useMemo(
        () => TRADE_COLUMN_DEFS.filter(column => isColumnVisible(column.key)),
        [isColumnVisible]
    );

    const visibleTradeTableWidth = useMemo(() => (
        columnWidths.symbol
        + visibleTradeColumns.reduce((total, column) => total + columnWidths[column.key], 0)
        + columnWidths.close
    ), [columnWidths, visibleTradeColumns]);

    const visibleOptionalColumnCount = useMemo(
        () => visibleTradeColumns.length,
        [visibleTradeColumns]
    );

    const startColumnResize = useCallback((event: React.MouseEvent, key: TradeColumnWidthKey) => {
        event.preventDefault();
        event.stopPropagation();
        columnResizeRef.current = {
            key,
            startX: event.clientX,
            startWidth: columnWidths[key],
        };
        setResizingColumn(key);
    }, [columnWidths]);

    useEffect(() => {
        if (!resizingColumn) return undefined;

        const previousCursor = document.body.style.cursor;
        const previousUserSelect = document.body.style.userSelect;
        document.body.style.cursor = 'col-resize';
        document.body.style.userSelect = 'none';

        const handleMouseMove = (event: MouseEvent) => {
            const resizeState = columnResizeRef.current;
            if (!resizeState) return;
            const nextWidth = resizeState.startWidth + event.clientX - resizeState.startX;
            setColumnWidths(prev => ({
                ...prev,
                [resizeState.key]: clampTradeColumnWidth(resizeState.key, nextWidth),
            }));
        };

        const handleMouseUp = () => {
            columnResizeRef.current = null;
            setResizingColumn(null);
        };

        window.addEventListener('mousemove', handleMouseMove);
        window.addEventListener('mouseup', handleMouseUp);
        return () => {
            document.body.style.cursor = previousCursor;
            document.body.style.userSelect = previousUserSelect;
            window.removeEventListener('mousemove', handleMouseMove);
            window.removeEventListener('mouseup', handleMouseUp);
        };
    }, [resizingColumn]);

    const syncHorizontalScroll = useCallback((source: 'table' | 'footer') => {
        if (syncingScrollRef.current) return;
        const sourceElement = source === 'table' ? tableScrollRef.current : footerScrollRef.current;
        const targetElement = source === 'table' ? footerScrollRef.current : tableScrollRef.current;
        if (!sourceElement || !targetElement) return;
        syncingScrollRef.current = source;
        targetElement.scrollLeft = sourceElement.scrollLeft;
        window.requestAnimationFrame(() => {
            syncingScrollRef.current = null;
        });
    }, []);

    const getPositionKey = useCallback((pos: ToolboxTradePosition) => (
        String(pos.id ?? pos.ticket ?? `${pos.symbol ?? ''}-${pos.time_create ?? ''}`)
    ), []);

    const sortedLivePositions = useMemo(() => {
        if (!sortState) return livePositions;
        return [...livePositions].sort((a: ToolboxTradePosition, b: ToolboxTradePosition) => {
            const aValue = getSortValue(a, sortState.column);
            const bValue = getSortValue(b, sortState.column);
            const comparison = typeof aValue === 'string' || typeof bValue === 'string'
                ? String(aValue).localeCompare(String(bValue), undefined, { numeric: true })
                : Number(aValue) - Number(bValue);
            return sortState.direction === 'asc' ? comparison : -comparison;
        });
    }, [livePositions, sortState, getSortValue]);

    useEffect(() => {
        if (!selectedPositionKey) return;
        if (!livePositions.some((position: ToolboxTradePosition) => getPositionKey(position) === selectedPositionKey)) {
            setSelectedPositionKey(null);
        }
    }, [getPositionKey, livePositions, selectedPositionKey]);

    const getTradePointsValue = useCallback((pos: ToolboxTradePosition) => {
        const openPrice = Number(pos.price_open ?? pos.openPrice);
        const currentPrice = Number(pos.price_current ?? pos.currentPrice);
        if (!Number.isFinite(openPrice) || !Number.isFinite(currentPrice) || openPrice <= 0 || currentPrice <= 0) return 0;
        const pointSize = Math.pow(10, -getSymbolDigits(pos.symbol ?? ''));
        const direction = String(pos.side).toUpperCase() === 'BUY' ? 1 : -1;
        const points = ((currentPrice - openPrice) / pointSize) * direction;
        return Number.isFinite(points) ? points : 0;
    }, []);

    const formatTradePoints = useCallback((pos: ToolboxTradePosition) => {
        const points = getTradePointsValue(pos);
        const absPoints = Math.abs(points);
        const fractionDigits = absPoints > 0 && absPoints < 10 ? 1 : 0;
        return points.toLocaleString('en-US', {
            minimumFractionDigits: fractionDigits,
            maximumFractionDigits: 1,
        }).replace(/,/g, ' ');
    }, [getTradePointsValue]);

    const formatTradeVolume = (pos: ToolboxTradePosition) => (
        typeof pos.volume === 'number' ? pos.volume.toFixed(2) : pos.volume ?? '0.00'
    );

    const downloadTextFile = useCallback((content: string, filename: string, type: string) => {
        const url = URL.createObjectURL(new Blob([content], { type }));
        const anchor = document.createElement('a');
        anchor.href = url;
        anchor.download = filename;
        document.body.appendChild(anchor);
        anchor.click();
        anchor.remove();
        window.setTimeout(() => URL.revokeObjectURL(url), 30_000);
    }, []);

    const getVisibleReportColumns = () => {
        const columns: { label: string; value: (pos: ToolboxTradePosition) => string | number }[] = [
            { label: 'Symbol', value: pos => pos.symbol ?? '-' },
        ];
        if (isColumnVisible('ticket')) columns.push({ label: 'Ticket', value: pos => pos.ticket ?? pos.id ?? '-' });
        if (isColumnVisible('time')) columns.push({ label: 'Time', value: pos => formatTradeTime(pos.time_create) });
        if (isColumnVisible('side')) columns.push({ label: 'Side / Type', value: pos => String(pos.side ?? '').toLowerCase() || '-' });
        if (isColumnVisible('volume')) columns.push({ label: 'Volume', value: pos => formatTradeVolume(pos) });
        if (isColumnVisible('priceOpen')) columns.push({ label: 'Price Open', value: pos => formatTradePrice(pos.price_open ?? pos.openPrice, pos.symbol ?? '') });
        if (isColumnVisible('sl')) columns.push({ label: 'S / L', value: pos => formatTradeLevel(pos.price_sl ?? pos.sl, pos.symbol ?? '') });
        if (isColumnVisible('tp')) columns.push({ label: 'T / P', value: pos => formatTradeLevel(pos.price_tp ?? pos.tp, pos.symbol ?? '') });
        if (isColumnVisible('priceCurrent')) columns.push({ label: 'Price Current', value: pos => formatTradePrice(pos.price_current ?? pos.currentPrice, pos.symbol ?? '') });
        if (isColumnVisible('swap')) columns.push({ label: 'Swap', value: pos => formatMoney(pos.swap) });
        if (isColumnVisible('accountLogin')) columns.push({ label: 'Account Login', value: pos => pos.account_login ?? '-' });
        if (isColumnVisible('timeUpdate')) columns.push({ label: 'Time Update', value: pos => formatTradeTime(pos.time_update) });
        if (isColumnVisible('comment')) columns.push({ label: 'Comment', value: pos => pos.comment || '-' });
        if (isColumnVisible('profit')) {
            columns.push({
                label: profitMode === 'points' ? 'Profit Points' : 'Profit',
                value: pos => profitMode === 'points'
                    ? formatTradePoints(pos)
                    : formatMoney(pos.profit ?? pos.unrealizedPnL),
            });
        }
        return columns;
    };

    const buildTradeReportHtml = (title: string) => {
        const columns = getVisibleReportColumns();
        const header = columns.map(column => `<th>${escapeHtml(column.label)}</th>`).join('');
        const body = sortedLivePositions.map(position => (
            `<tr>${columns.map(column => `<td>${escapeHtml(column.value(position))}</td>`).join('')}</tr>`
        )).join('');
        return `<!doctype html>
<html>
<head>
<meta charset="utf-8" />
<title>${escapeHtml(title)}</title>
<style>
body{font-family:Segoe UI,Tahoma,Arial,sans-serif;font-size:12px;color:#111;background:#fff;margin:18px}
table{border-collapse:collapse;width:100%}
th,td{border:1px solid #bdbdbd;padding:4px 6px;text-align:right;white-space:nowrap}
th:first-child,td:first-child{text-align:left}
th{background:#ececec;font-weight:600}
.summary{margin:0 0 12px 0;font-weight:600}
</style>
</head>
<body>
<div class="summary">${escapeHtml(title)} - ${sortedLivePositions.length} position(s)</div>
<table><thead><tr>${header}</tr></thead><tbody>${body}</tbody></table>
</body>
</html>`;
    };

    const openTradeOverview = () => {
        const url = URL.createObjectURL(new Blob([buildTradeReportHtml('RTX 5 Trade Overview')], { type: 'text/html' }));
        window.open(url, '_blank', 'noopener,noreferrer');
        window.setTimeout(() => URL.revokeObjectURL(url), 30_000);
    };

    const downloadTradeHtml = () => {
        downloadTextFile(buildTradeReportHtml('RTX 5 Trade Report'), 'rtx5-trade-report.html', 'text/html');
    };

    const downloadTradeXml = () => {
        const columns = getVisibleReportColumns();
        const rows = sortedLivePositions.map(position => (
            `<Row>${columns.map(column => `<Cell><Data ss:Type="String">${escapeHtml(column.value(position))}</Data></Cell>`).join('')}</Row>`
        )).join('');
        const xml = `<?xml version="1.0"?>
<?mso-application progid="Excel.Sheet"?>
<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet"
 xmlns:o="urn:schemas-microsoft-com:office:office"
 xmlns:x="urn:schemas-microsoft-com:office:excel"
 xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet">
<Worksheet ss:Name="Trade">
<Table>
<Row>${columns.map(column => `<Cell><Data ss:Type="String">${escapeHtml(column.label)}</Data></Cell>`).join('')}</Row>
${rows}
</Table>
</Worksheet>
</Workbook>`;
        downloadTextFile(xml, 'rtx5-trade-report.xml', 'application/vnd.ms-excel');
    };

    const setShowTradeLevelsForSymbol = (symbol: string, visible: boolean) => {
        const store = useChartSettingsStore.getState();
        store.updateSymbolProperty(symbol, 'showTradeLevels', visible);
        window.dispatchEvent(new CustomEvent(visible ? 'rtx:refresh-trade-overlay' : 'rtx:flush-trade-overlay', { detail: { symbol } }));
    };

    const handleTradeContextMenu = (event: React.MouseEvent<HTMLTableRowElement>, position: ToolboxTradePosition) => {
        event.preventDefault();
        event.stopPropagation();
        setSelectedPositionKey(getPositionKey(position));
        setTradeContextMenu({ x: event.clientX, y: event.clientY, position });
    };

    const buildTradeContextMenuItems = (position: ToolboxTradePosition): ContextMenuItemConfig[] => {
        const symbol = String(position.symbol ?? '');
        return [
            {
                label: 'New Order',
                shortcut: 'F9',
                icon: <Icon name="plus" size="xs" />,
                action: () => window.dispatchEvent(new CustomEvent('openOrderDialog', { detail: { symbol } })),
            },
            {
                label: 'Close Position',
                icon: <Icon name="check" size="xs" />,
                action: () => onClosePosition(position.id),
            },
            {
                label: 'Modify or Delete',
                icon: <Icon name="settings" size="xs" />,
                action: () => setModifyPosition(position),
            },
            { divider: true },
            {
                label: 'Bulk Operations',
                submenu: [
                    { label: 'Close All', action: () => onCloseBulk?.('ALL') },
                    { label: 'Close Winners', action: () => onCloseBulk?.('WINNERS') },
                    { label: 'Close Losers', action: () => onCloseBulk?.('LOSERS') },
                    { label: `Close All ${symbol}`, action: () => onCloseBulk?.('ALL', symbol) },
                ],
            },
            { divider: true },
            {
                label: 'Depth of Market',
                shortcut: 'B',
                icon: <Icon name="box" size="xs" />,
                action: () => window.dispatchEvent(new CustomEvent('openDepthOfMarket', { detail: { symbol } })),
            },
            {
                label: 'Open Chart',
                shortcut: 'Space',
                icon: <Icon name="line-chart" size="xs" />,
                action: () => window.dispatchEvent(new CustomEvent('openChart', { detail: { symbol } })),
            },
            { divider: true },
            {
                label: 'Trailing Stop',
                submenu: [
                    { label: 'Delete All', disabled: true },
                    { label: 'None', checked: true, disabled: true },
                    { divider: true },
                    ...[50, 55, 60, 65, 70, 75, 80, 85, 90, 95].map(points => ({
                        label: `${points} points`,
                        disabled: true,
                    })),
                ],
            },
            {
                label: 'Volumes',
                submenu: [
                    {
                        label: 'Lots',
                        checked: volumeMode === 'lots',
                        action: () => setVolumeMode('lots'),
                        autoClose: false,
                    },
                    {
                        label: 'Amounts',
                        disabled: true,
                    },
                ],
            },
            {
                label: 'Profit',
                submenu: [
                    {
                        label: 'as Money',
                        checked: profitMode === 'money',
                        action: () => setProfitMode('money'),
                        autoClose: false,
                    },
                    {
                        label: 'as Points',
                        checked: profitMode === 'points',
                        action: () => setProfitMode('points'),
                        autoClose: false,
                    },
                ],
            },
            { divider: true },
            { label: 'Deposit', icon: <Icon name="download" size="xs" />, disabled: true },
            { label: 'Withdrawal', icon: <Icon name="download" size="xs" />, disabled: true },
            { divider: true },
            {
                label: 'Report',
                submenu: [
                    { label: 'Overview', shortcut: 'Alt+E', action: openTradeOverview },
                    { label: 'Open XML (MS Office Excel 2007)', action: downloadTradeXml },
                    { label: 'HTML (Internet Explorer)', action: downloadTradeHtml },
                ],
            },
            {
                label: 'Show on Charts',
                submenu: [
                    {
                        label: `Add ${symbol} Deals`,
                        action: () => setShowTradeLevelsForSymbol(symbol, true),
                    },
                    {
                        label: 'Delete All Deals',
                        action: () => {
                            useChartSettingsStore.getState().updateGlobalProperty('showTradeLevels', false);
                            window.dispatchEvent(new CustomEvent('rtx:flush-trade-overlay'));
                        },
                    },
                    {
                        label: 'Auto Update',
                        checked: showOnChartsAutoUpdate,
                        action: () => {
                            setShowOnChartsAutoUpdate(prev => {
                                const next = !prev;
                                window.dispatchEvent(new CustomEvent(next ? 'rtx:refresh-trade-overlay' : 'rtx:flush-trade-overlay'));
                                return next;
                            });
                        },
                        autoClose: false,
                    },
                ],
            },
            { label: 'Register as Signal', disabled: true },
            { divider: true },
            { label: 'Show Milliseconds', disabled: true },
            { label: 'Auto Arrange', checked: true, disabled: true, shortcut: 'A' },
            { label: 'Grid', checked: true, disabled: true, shortcut: 'G' },
            { divider: true },
            {
                label: 'Columns',
                submenu: [
                    { label: 'Show All Columns', action: showAllTradeColumns, autoClose: false },
                    { label: 'Reset Columns', action: resetTradeColumns, autoClose: false },
                    { divider: true },
                    ...TRADE_COLUMN_DEFS.map(column => ({
                        label: column.label,
                        checked: isColumnVisible(column.key),
                        action: () => toggleColumn(column.key),
                        autoClose: false,
                    })),
                    { divider: true },
                    { label: 'Market Value', disabled: true },
                    { label: 'Change %', disabled: true },
                    { label: 'Magic Number', disabled: true },
                ],
            },
        ];
    };

    useEffect(() => {
        if (showOnChartsAutoUpdate && livePositions.length > 0) {
            window.dispatchEvent(new CustomEvent('rtx:refresh-trade-overlay'));
        }
    }, [showOnChartsAutoUpdate, livePositions]);

    const renderColumnResizeHandle = (key: TradeColumnWidthKey) => (
        <button
            type="button"
            aria-label={`Resize ${getTradeColumnDef(key).label} column`}
            tabIndex={-1}
            className={`absolute right-0 top-0 z-20 h-full w-[5px] translate-x-1/2 cursor-col-resize border-0 bg-transparent p-0 ${resizingColumn === key ? 'bg-sky-400/70' : 'hover:bg-sky-400/50'}`}
            onMouseDown={(event) => startColumnResize(event, key)}
            onDoubleClick={(event) => {
                event.preventDefault();
                event.stopPropagation();
                setColumnWidths(prev => ({
                    ...prev,
                    [key]: getTradeColumnDef(key).defaultWidth,
                }));
            }}
        />
    );

    const renderSortableHeader = (
        key: TradeColumnWidthKey,
        label: string,
        sortColumn: TradeSortColumn,
        align: 'left' | 'right' = 'left',
    ) => (
        <th
            className={`relative px-1.5 py-[3px] ${key === 'symbol' ? 'pl-2' : ''} ${align === 'right' ? 'text-right' : 'text-left'} border-r border-zinc-700/70`}
            style={{ width: columnWidths[key] }}
            aria-sort={sortState?.column === sortColumn ? (sortState.direction === 'asc' ? 'ascending' : 'descending') : 'none'}
        >
            <button
                type="button"
                onClick={() => toggleSort(sortColumn)}
                className={`flex w-full items-center gap-1 pr-2 hover:text-white ${align === 'right' ? 'justify-end text-right' : 'justify-between text-left'}`}
            >
                <span>{label}</span>
                <span className="inline-block w-[8px] text-center text-zinc-500">
                    {sortState?.column === sortColumn ? (sortState.direction === 'asc' ? '^' : 'v') : ''}
                </span>
            </button>
            {renderColumnResizeHandle(key)}
        </th>
    );

    const renderHeader = (column: TradeColumnDef) => {
        const isLeftAligned = ['side', 'accountLogin', 'timeUpdate', 'comment'].includes(column.key);
        return (
            <th
                key={column.key}
                className={`relative px-1.5 py-[3px] ${isLeftAligned ? 'text-left' : 'text-right'} border-r border-zinc-700/70`}
                style={{ width: columnWidths[column.key] }}
            >
                <span className="block pr-2">{column.label}</span>
                {renderColumnResizeHandle(column.key)}
            </th>
        );
    };

    return (
        <div className="h-full flex flex-col relative bg-[#131316] overflow-hidden">
            <div
                ref={tableScrollRef}
                onScroll={() => syncHorizontalScroll('table')}
                className="flex-1 overflow-auto scrollbar-thin scrollbar-thumb-zinc-700"
            >
                <table
                    className="w-full text-left border-collapse table-fixed"
                    style={{ minWidth: visibleTradeTableWidth, fontFamily: '"Segoe UI", Tahoma, Arial, sans-serif', fontVariantNumeric: 'tabular-nums' }}
                >
                    <colgroup>
                        <col style={{ width: columnWidths.symbol }} />
                        {visibleTradeColumns.map(column => (
                            <col key={column.key} style={{ width: columnWidths[column.key] }} />
                        ))}
                        <col style={{ width: columnWidths.close }} />
                    </colgroup>
                    <thead className="sticky top-0 bg-[#17181c] text-[#c9cfdb] z-10 font-semibold text-[10.5px] leading-[18px] uppercase border-y border-zinc-700/70 select-none shadow-[0_1px_0_0_rgba(255,255,255,0.04)]">
                        <tr>
                            {renderSortableHeader('symbol', 'Symbol', 'symbol')}
                            {visibleTradeColumns.map(column => {
                                if (column.key === 'ticket') return renderSortableHeader('ticket', column.label, 'ticket');
                                if (column.key === 'time') return renderSortableHeader('time', column.label, 'time_create');
                                if (column.key === 'profit') return renderSortableHeader('profit', column.label, 'profit', 'right');
                                return renderHeader(column);
                            })}
                            <th className="px-0.5 py-[3px] text-center" style={{ width: columnWidths.close }} aria-label="Close position"></th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-zinc-800/90 text-[#d8dde8] text-[11px] leading-[18px] font-normal">
                        {livePositions.length === 0 && (
                            <tr>
                                <td colSpan={visibleOptionalColumnCount + 2} className="h-16 text-center text-zinc-600 text-xs italic">
                                    {loading ? 'Loading open positions...' : error ? error : 'No open positions'}
                                </td>
                            </tr>
                        )}
                        {sortedLivePositions.map((pos: ToolboxTradePosition, i: number) => {
                            const isBuy = String(pos.side).toUpperCase() === 'BUY';
                            const pnl = pos.profit ?? pos.unrealizedPnL;
                            const pnlValue = Number(pnl ?? 0);
                            const pointsValue = getTradePointsValue(pos);
                            const profitIsPositive = profitMode === 'points' ? pointsValue >= 0 : pnlValue >= 0;
                            const positionKey = getPositionKey(pos);
                            const isSelected = selectedPositionKey === positionKey;
                            return (
                            <tr
                                key={pos.id ?? i}
                                aria-selected={isSelected}
                                className={`rtx-trade-row h-[22px] ${isSelected ? 'rtx-trade-row--selected bg-[#0b63ce] hover:bg-[#0b63ce]' : `${i % 2 === 0 ? 'bg-[#131316]' : 'bg-[#101116]'} hover:bg-[#1b1d22]`} transition-colors group cursor-pointer`}
                                onClick={() => setSelectedPositionKey(positionKey)}
                                onDoubleClick={() => {
                                    setSelectedPositionKey(positionKey);
                                    setModifyPosition(pos);
                                }}
                                onContextMenu={(event) => handleTradeContextMenu(event, pos)}
                            >
                                {/* symbol */}
                                <td className="px-1.5 py-[2px] pl-2 border-r border-zinc-800 font-semibold text-zinc-100 whitespace-nowrap">
                                    <span className="inline-flex items-center gap-1.5">
                                        <span className={`h-[11px] w-[7px] rounded-[1px] border ${isBuy ? 'border-sky-400 text-sky-300' : 'border-red-400 text-red-300'} flex items-center justify-center text-[8px] leading-none`}>
                                            {isBuy ? '+' : '-'}
                                        </span>
                                        <span>{pos.symbol ?? '-'}</span>
                                    </span>
                                </td>

                                {/* ticket */}
                                {isColumnVisible('ticket') && (
                                    <td className="px-1.5 py-[2px] border-r border-zinc-800 text-[#d8dde8] font-normal tabular-nums whitespace-nowrap">{pos.ticket ?? pos.id}</td>
                                )}

                                {/* time_create */}
                                {isColumnVisible('time') && (
                                    <td className="px-1.5 py-[2px] border-r border-zinc-800 text-[#aeb5c3] whitespace-nowrap text-[11px]">
                                        {formatTradeTime(pos.time_create)}
                                    </td>
                                )}

                                {/* side */}
                                {isColumnVisible('side') && (
                                    <td className={`px-1.5 py-[2px] border-r border-zinc-800 font-semibold ${isBuy ? 'text-[#45bff7]' : 'text-[#ff5f5f]'} text-[11px]`}>
                                        <div className="flex items-center gap-1">
                                            {isBuy ? (
                                                <svg xmlns="http://www.w3.org/2000/svg" width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="M12 19V5M5 12l7-7 7 7"/></svg>
                                            ) : (
                                                <svg xmlns="http://www.w3.org/2000/svg" width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="M12 5v14M19 12l-7 7-7-7"/></svg>
                                            )}
                                            <span>{String(pos.side).toLowerCase()}</span>
                                        </div>
                                    </td>
                                )}

                                {/* volume */}
                                {isColumnVisible('volume') && (
                                    <td className="px-1.5 py-[2px] border-r border-zinc-800 text-right font-semibold text-zinc-100 tabular-nums">
                                        {formatTradeVolume(pos)}
                                    </td>
                                )}

                                {/* price_open */}
                                {isColumnVisible('priceOpen') && (
                                    <td className="px-1.5 py-[2px] border-r border-zinc-800 text-right text-[#aeb5c3] tabular-nums">
                                        {formatTradePrice(pos.price_open ?? pos.openPrice, pos.symbol ?? '')}
                                    </td>
                                )}

                                {/* price_sl */}
                                {isColumnVisible('sl') && (
                                    <td className="px-1.5 py-[2px] border-r border-zinc-800 text-right tabular-nums" onDoubleClick={(event) => { event.stopPropagation(); startEditing(pos); }}>
                                        {editingId === pos.id ? (
                                            <input
                                                className="h-[17px] w-full bg-zinc-800 text-white text-right px-1 text-[11px] outline-none ring-1 ring-sky-500/70"
                                                value={editSL}
                                                onChange={e => setEditSL(e.target.value)}
                                                onBlur={() => saveEdit(pos)}
                                                onKeyDown={e => e.key === 'Enter' && saveEdit(pos)}
                                                onDoubleClick={e => e.stopPropagation()}
                                            />
                                        ) : (
                                            <span className={(pos.price_sl ?? pos.sl) > 0 ? "text-[#ff7676] bg-red-950/20 px-1 rounded-sm cursor-pointer font-semibold" : "text-zinc-600 cursor-pointer"}>
                                                {formatTradeLevel(pos.price_sl ?? pos.sl, pos.symbol ?? '')}
                                            </span>
                                        )}
                                    </td>
                                )}

                                {/* price_tp */}
                                {isColumnVisible('tp') && (
                                    <td className="px-1.5 py-[2px] border-r border-zinc-800 text-right tabular-nums" onDoubleClick={(event) => { event.stopPropagation(); startEditing(pos); }}>
                                        {editingId === pos.id ? (
                                            <input
                                                className="h-[17px] w-full bg-zinc-800 text-white text-right px-1 text-[11px] outline-none ring-1 ring-sky-500/70"
                                                value={editTP}
                                                onChange={e => setEditTP(e.target.value)}
                                                onBlur={() => saveEdit(pos)}
                                                onKeyDown={e => e.key === 'Enter' && saveEdit(pos)}
                                                onDoubleClick={e => e.stopPropagation()}
                                            />
                                        ) : (
                                            <span className={(pos.price_tp ?? pos.tp) > 0 ? "text-[#34dca0] bg-emerald-900/20 px-1 rounded-sm cursor-pointer font-semibold" : "text-zinc-600 cursor-pointer"}>
                                                {formatTradeLevel(pos.price_tp ?? pos.tp, pos.symbol ?? '')}
                                            </span>
                                        )}
                                    </td>
                                )}

                                {/* price_current */}
                                {isColumnVisible('priceCurrent') && (
                                    <td className="px-1.5 py-[2px] border-r border-zinc-800 text-right text-zinc-100 font-semibold tabular-nums">
                                        {formatTradePrice(pos.price_current ?? pos.currentPrice, pos.symbol ?? '')}
                                    </td>
                                )}

                                {/* swap */}
                                {isColumnVisible('swap') && (
                                    <td className="px-1.5 py-[2px] border-r border-zinc-800 text-right text-[#8d95a3] tabular-nums">{formatMoney(pos.swap)}</td>
                                )}

                                {/* account_login */}
                                {isColumnVisible('accountLogin') && (
                                    <td className="px-1.5 py-[2px] border-r border-zinc-800 text-[#aeb5c3] whitespace-nowrap text-[11px] tabular-nums">
                                        {pos.account_login ?? '-'}
                                    </td>
                                )}

                                {/* time_update */}
                                {isColumnVisible('timeUpdate') && (
                                    <td className="px-1.5 py-[2px] border-r border-zinc-800 text-[#aeb5c3] whitespace-nowrap text-[11px] tabular-nums">
                                        {formatTradeTime(pos.time_update)}
                                    </td>
                                )}

                                {/* comment */}
                                {isColumnVisible('comment') && (
                                    <td className="px-1.5 py-[2px] border-r border-zinc-800 text-[#aeb5c3] text-[11px] truncate" title={String(pos.comment ?? '')}>
                                        {pos.comment || '-'}
                                    </td>
                                )}

                                {/* profit */}
                                {isColumnVisible('profit') && (
                                    <td className={`px-1.5 py-[2px] text-right font-semibold tabular-nums ${profitIsPositive ? 'text-[#2563eb]' : 'text-[#ff2d2d]'}`}>
                                        {profitMode === 'points' ? formatTradePoints(pos) : formatMoney(pnlValue)}
                                    </td>
                                )}

                                {/* Close Button */}
                                <td className="px-0.5 py-[2px] text-center">
                                    <button
                                        type="button"
                                        aria-label={`Close position ${pos.ticket ?? pos.id}`}
                                        title="Close position"
                                        onClick={(event) => {
                                            event.stopPropagation();
                                            onClosePosition(pos.id);
                                        }}
                                        className="mx-auto flex h-[17px] w-[17px] items-center justify-center rounded-sm border border-transparent text-[12px] font-semibold leading-none text-zinc-400 hover:border-red-500/50 hover:bg-red-950/50 hover:text-red-200 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-red-400"
                                    >
                                        x
                                    </button>
                                </td>
                            </tr>
                            );
                        })}
                    </tbody>
                </table>
            </div>

            {/* Footer Summary Row (Full Account Info) */}
            <div
                ref={footerScrollRef}
                onScroll={() => syncHorizontalScroll('footer')}
                className="rtx-trade-footer bg-[#191a1e] border-t border-zinc-700 w-full overflow-x-auto text-[11px] font-bold text-zinc-300 tabular-nums shadow-[inset_0_1px_0_0_rgba(255,255,255,0.05)] scrollbar-thin scrollbar-thumb-zinc-700"
            >
                <div className="flex min-w-full items-center gap-3 px-2 py-1" style={{ minWidth: visibleTradeTableWidth }}>
                    <Icon name="plus-circle" size="xs" className="text-zinc-400 mr-1 shrink-0" />
                    <span className="flex gap-1 shrink-0"><span className="rtx-trade-metric-label text-zinc-500">Positions:</span> <span>{livePositions.length}</span></span>
                    <span className="flex gap-1 shrink-0"><span className="rtx-trade-metric-label text-zinc-500">Balance:</span> <BlinkingText value={account?.balance || 0} formatFn={formatMoney} suffix={` ${account?.currency || 'USD'}`} /></span>
                    <span className="flex gap-1 shrink-0"><span className="rtx-trade-metric-label text-zinc-500">Equity:</span> <BlinkingText value={liveEquity} formatFn={formatMoney} /></span>
                    <span className="flex gap-1 shrink-0"><span className="rtx-trade-metric-label text-zinc-500">Margin:</span> <BlinkingText value={margin} formatFn={formatMoney} /></span>
                    <span className="flex gap-1 shrink-0"><span className="rtx-trade-metric-label text-zinc-500">Free Margin:</span> <BlinkingText value={liveFreeMargin} formatFn={formatMoney} /></span>
                    <span className="flex gap-1 shrink-0"><span className="rtx-trade-metric-label text-zinc-500">Margin Level:</span> <span>{formatMarginLevel(liveMarginLevel)}</span></span>
                    <span className="flex gap-1 shrink-0"><span className="rtx-trade-metric-label text-zinc-500">Swap:</span> <span className={totalSwap < 0 ? 'text-[#f87171]' : 'text-zinc-300'}>{formatMoney(totalSwap)}</span></span>
                    <span className="flex gap-1 shrink-0"><span className="rtx-trade-metric-label text-zinc-500">Commission:</span> <span className={totalCommission < 0 ? 'text-[#f87171]' : 'text-zinc-300'}>{formatMoney(totalCommission)}</span></span>
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
                    <span className="flex min-w-[136px] items-center justify-end gap-1 shrink-0 pr-1 text-right font-bold">
                        <span className="text-zinc-500">Floating P/L:</span>
                        <BlinkingText value={totalLivePnL} formatFn={formatMoney} defaultColor={totalLivePnL >= 0 ? "text-[#2563eb]" : "text-[#ff2d2d]"} />
                    </span>
                </div>
            </div>
            {tradeContextMenu && (
                <ContextMenu
                    variant={isLightSkin ? "mt5-light" : "mt5-dark"}
                    items={buildTradeContextMenuItems(tradeContextMenu.position)}
                    position={{ x: tradeContextMenu.x, y: tradeContextMenu.y }}
                    onClose={() => setTradeContextMenu(null)}
                />
            )}
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
