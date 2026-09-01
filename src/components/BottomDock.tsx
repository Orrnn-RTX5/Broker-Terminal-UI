import { Icon } from './ui/Icon';
import { PriceDisplay } from './ui/PriceDisplay';
import { ContextMenu, type ContextMenuItemConfig } from './ui/ContextMenu';
import { ModifyPositionDialog } from './ModifyPositionDialog';
import { lazy, Suspense, useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { CalendarTab } from './layout/CalendarTab';
import { CodeBaseTab, ArticlesTab, ExpertsTab } from './layout/ResearchTabs';
import { JournalTab } from './layout/JournalTab';
import { useAppStore, type Trade } from '../store/useAppStore';
import { useToolboxTradeData, type ToolboxTradePosition } from '../hooks/useToolboxTradeData';
import { getStoredAccountLogin, tradeGatewayApi } from '../api/tradeGateway';
import { useChartSettingsStore } from '../store/useChartSettingsStore';
import { formatPrice, getSymbolDigits } from '../utils/symbolUtils';
import { rememberTradeHistoryPositionLevels } from '../utils/tradeHistoryLevelCache';
import {
    buildExposureSummary,
    formatExposureVolume,
    type ExposureAccountInput,
    type ExposurePieSegment,
    type ExposurePositionInput,
} from './BottomDock.exposure';
import { resolveTradeAccountMetrics, resolveTradeProfit } from './BottomDock.trade';
import { MARKET_ORDER_PLACEMENT_STATE_EVENT } from '../services/marketOrderPlacementEvents';

const LazyHistoryDownloader = lazy(async () => {
    const module = await import('./HistoryDownloader');
    return { default: module.HistoryDownloader };
});

// Rendered wherever the backend did not report an account metric. Never show "0.00" for a
// value the backend never sent — a false zero reads as a real (and alarming) account state.
const METRIC_UNAVAILABLE = '—';

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
type TradeFooterMetricKey =
    | 'positions'
    | 'balance'
    | 'equity'
    | 'margin'
    | 'freeMargin'
    | 'marginLevel'
    | 'swap'
    | 'commission';

type TradeFooterMetricVisibility = Record<TradeFooterMetricKey, boolean>;
type TradeFooterMetricDef = {
    key: TradeFooterMetricKey;
    label: string;
};

const TRADE_COLUMN_STORAGE_KEY = 'rtx5_trade_columns_v3';
const TRADE_COLUMN_WIDTH_STORAGE_KEY = 'rtx5_trade_column_widths_v1';
const TRADE_PROFIT_MODE_STORAGE_KEY = 'rtx5_trade_profit_mode';
const TRADE_VOLUME_MODE_STORAGE_KEY = 'rtx5_trade_volume_mode';
const TRADE_SHOW_ON_CHARTS_AUTO_UPDATE_STORAGE_KEY = 'rtx5_trade_show_on_charts_auto_update';
const TRADE_FOOTER_METRIC_STORAGE_KEY = 'rtx5_trade_footer_metrics_v1';

const TRADE_COLUMN_DEFS: TradeColumnDef[] = [
    { key: 'ticket', label: 'Ticket', defaultWidth: 96, minWidth: 70, maxWidth: 180 },
    { key: 'time', label: 'Time', defaultWidth: 150, minWidth: 120, maxWidth: 220 },
    { key: 'side', label: 'Type', defaultWidth: 76, minWidth: 64, maxWidth: 130 },
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

const TRADE_FOOTER_METRIC_DEFS: TradeFooterMetricDef[] = [
    { key: 'positions', label: 'Positions' },
    { key: 'balance', label: 'Balance' },
    { key: 'equity', label: 'Equity' },
    { key: 'margin', label: 'Margin' },
    { key: 'freeMargin', label: 'Free Margin' },
    { key: 'marginLevel', label: 'Margin Level' },
    { key: 'swap', label: 'Swap' },
    { key: 'commission', label: 'Commission' },
];

const DEFAULT_TRADE_FOOTER_METRICS: TradeFooterMetricVisibility = {
    positions: false,
    balance: true,
    equity: true,
    margin: true,
    freeMargin: true,
    marginLevel: true,
    swap: false,
    commission: false,
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

const TAB_HOVER_COMMENTS: Record<TabType, string> = {
    Trade: 'Open positions and live account summary',
    History: 'Closed orders and account history',
    Exposure: 'Asset exposure by currency and symbol',
    Toolbox: 'Terminal toolbox commands and utilities',
    'Historical Data': 'Download historical candle data',
    News: 'Market news messages',
    Mailbox: 'Broker mailbox messages',
    Calendar: 'Economic calendar events',
    Company: 'Broker company information',
    Alerts: 'Price and terminal alerts',
    Articles: 'Research articles',
    'Code Base': 'Scripts, indicators, and code resources',
    Experts: 'Expert advisor messages',
    Journal: 'Terminal logs and connection events',
};

const TRADE_COLUMN_HOVER_COMMENTS: Record<TradeColumnWidthKey, string> = {
    symbol: 'Instrument for the open position',
    ticket: 'Unique order or position ticket',
    time: 'Position open time',
    side: 'Order type: buy or sell',
    volume: 'Position volume in lots',
    priceOpen: 'Price at which the position was opened',
    sl: 'Stop Loss level. Double-click a value to modify it',
    tp: 'Take Profit level. Double-click a value to modify it',
    priceCurrent: 'Current market price used for live P/L',
    swap: 'Accumulated overnight swap',
    accountLogin: 'Trading account login',
    timeUpdate: 'Last position update time',
    comment: 'Position comment',
    profit: 'Floating profit or loss for the position',
    close: 'Close this position',
};

const TRADE_FOOTER_METRIC_COMMENTS: Record<TradeFooterMetricKey, string> = {
    positions: 'Number of open positions',
    balance: 'Account balance excluding floating P/L',
    equity: 'Balance plus current floating P/L',
    margin: 'Margin currently used by open positions',
    freeMargin: 'Available margin after used margin',
    marginLevel: 'Equity divided by margin, shown as a percent',
    swap: 'Total swap for open positions',
    commission: 'Total commission for open positions',
};

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

    const accountSig = (a: any) => !a ? '' : `${a.balance}|${a.equity}|${a.margin}|${a.freeMargin}|${a.marginLevel}|${a.unrealizedPL}|${a.currency}|${a.credit ?? a.bonus ?? ''}`;
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
        try {
            const result = onClosePosition(id, volume) as unknown;
            if (result && typeof (result as any).finally === 'function') {
                (result as any).finally(() => refreshTradeSoon());
            } else {
                refreshTradeSoon();
            }
        } catch (error) {
            refreshTradeSoon();
            throw error;
        }
    };

    const handleTradeCloseBulk = (type: 'ALL' | 'WINNERS' | 'LOSERS', symbol?: string) => {
        try {
            const result = onCloseBulk?.(type, symbol) as unknown;
            if (result && typeof (result as any).finally === 'function') {
                (result as any).finally(() => refreshTradeSoon());
            } else {
                refreshTradeSoon();
            }
        } catch (error) {
            refreshTradeSoon();
            throw error;
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

    useEffect(() => {
        const handleOpenBottomDockTab = (event: Event) => {
            const requestedTab = (event as CustomEvent<{ tab?: TabType }>).detail?.tab;
            if (!requestedTab || !TABS.some(tab => tab.id === requestedTab)) return;
            setActiveTab(requestedTab);
        };

        window.addEventListener('rtx:open-bottom-dock-tab', handleOpenBottomDockTab);
        return () => window.removeEventListener('rtx:open-bottom-dock-tab', handleOpenBottomDockTab);
    }, []);

    // Auto-switch to Trade tab when a trade is executed
    useEffect(() => {
        const handleTradeExecution = () => {
            setActiveTab('Trade');
        };
        window.addEventListener('rtx:new-trade-placed', handleTradeExecution);
        window.addEventListener(MARKET_ORDER_PLACEMENT_STATE_EVENT, handleTradeExecution);
        return () => {
            window.removeEventListener('rtx:new-trade-placed', handleTradeExecution);
            window.removeEventListener(MARKET_ORDER_PLACEMENT_STATE_EVENT, handleTradeExecution);
        };
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
                        pendingPositions={toolboxTrade.pendingPositions ?? []}
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
                    <Suspense fallback={<div className="flex h-full items-center justify-center text-xs text-zinc-500">Opening historical data…</div>}>
                        <LazyHistoryDownloader />
                    </Suspense>
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
                        title={TAB_HOVER_COMMENTS[tab.id]}
                        aria-label={TAB_HOVER_COMMENTS[tab.id]}
                        onClick={() => setActiveTab(tab.id)}
                        className={`rtx-dock-tab h-[30px] px-4 text-[12px] font-normal whitespace-nowrap rounded-none border-r border-zinc-800 border-t transition-colors duration-75 relative
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
                { name: 'Area Chart', shortcut: '', icon: 'area-chart' },
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
                        <h3 className="text-[12px] font-normal text-zinc-400 uppercase tracking-wider border-b border-zinc-700 pb-1 mb-2 truncate">
                            {section.category}
                        </h3>
                        <div className="space-y-1">
                            {section.items.map((item) => (
                                <button
                                    key={item.name}
                                    className="w-full flex items-center justify-between px-2 py-1.5 text-[14px] font-normal text-zinc-300 hover:bg-zinc-700/50 rounded transition-colors group text-left min-w-0"
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
                                        <span className="text-[12px] font-normal text-zinc-600 font-mono flex-shrink-0 ml-2">{item.shortcut}</span>
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
    const [changeColor, setChangeColor] = useState<string | null>(null);
    const previousValueRef = useRef<number | null>(null);
    const clearTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const numericValue = Number(value);

    useEffect(() => {
        if (!Number.isFinite(numericValue)) return;

        const previousValue = previousValueRef.current;
        if (previousValue !== null && numericValue !== previousValue) {
            setChangeColor(numericValue > previousValue ? 'text-[#22c55e]' : 'text-[#ff2d2d]');
            if (clearTimerRef.current) {
                clearTimeout(clearTimerRef.current);
            }
            clearTimerRef.current = setTimeout(() => setChangeColor(null), 900);
        }

        previousValueRef.current = numericValue;

        return () => {
            if (clearTimerRef.current) {
                clearTimeout(clearTimerRef.current);
            }
        };
    }, [numericValue]);

    return (
        <span className={`${changeColor ?? defaultColor} px-0.5 rounded-sm inline-block transition-colors duration-150`}>
            {prefix}{formatFn ? formatFn(value) : value}{suffix}
        </span>
    );
}

// Placeholder for an account metric the backend did not report. Rendering a dash keeps the
// footer honest: the terminal has no authoritative value and refuses to invent one.
function UnavailableMetric({ title = 'Not reported by the trading server' }: { title?: string }) {
    return (
        <span className="px-0.5 rounded-sm inline-block text-zinc-500" title={title}>
            {METRIC_UNAVAILABLE}
        </span>
    );
}

function TradeTab({
    positions,
    pendingPositions = [],
    account,
    onClosePosition,
    onModifyPosition,
    onCloseBulk,
    formatMoney,
    formatDate,
    loading,
    error,
}: any) {
    const accountId = useAppStore(s => s.accountId);
    const [editingId, setEditingId] = useState<number | null>(null);
    const [editSL, setEditSL] = useState("");
    const [editTP, setEditTP] = useState("");
    const [modifyPosition, setModifyPosition] = useState<any>(null);
    const [sortState, setSortState] = useState<TradeSortState>(null);
    const [tradeContextMenu, setTradeContextMenu] = useState<{ x: number; y: number; position: ToolboxTradePosition } | null>(null);
    const [footerMetricMenu, setFooterMetricMenu] = useState<{ x: number; y: number } | null>(null);
    const [columnVisibility, setColumnVisibility] = useState<TradeColumnVisibility>(() => safeReadJson(TRADE_COLUMN_STORAGE_KEY, DEFAULT_TRADE_COLUMNS));
    const [columnWidths, setColumnWidths] = useState<TradeColumnWidths>(() => normalizeTradeColumnWidths(safeReadJson(TRADE_COLUMN_WIDTH_STORAGE_KEY, DEFAULT_TRADE_COLUMN_WIDTHS)));
    const [footerMetricVisibility, setFooterMetricVisibility] = useState<TradeFooterMetricVisibility>(() => safeReadJson(TRADE_FOOTER_METRIC_STORAGE_KEY, DEFAULT_TRADE_FOOTER_METRICS));
    const [profitMode, setProfitMode] = useState<TradeProfitMode>(() => safeReadString(TRADE_PROFIT_MODE_STORAGE_KEY, ['money', 'points'] as const, 'money'));
    const [volumeMode, setVolumeMode] = useState<TradeVolumeMode>(() => safeReadString(TRADE_VOLUME_MODE_STORAGE_KEY, ['lots', 'amounts'] as const, 'lots'));
    const [showOnChartsAutoUpdate, setShowOnChartsAutoUpdate] = useState<boolean>(() => safeReadBoolean(TRADE_SHOW_ON_CHARTS_AUTO_UPDATE_STORAGE_KEY, true));
    const [selectedPositionKey, setSelectedPositionKey] = useState<string | null>(null);
    const [resizingColumn, setResizingColumn] = useState<TradeColumnWidthKey | null>(null);
    const tableScrollRef = useRef<HTMLDivElement | null>(null);
    const footerScrollRef = useRef<HTMLDivElement | null>(null);
    const footerMetricButtonRef = useRef<HTMLButtonElement | null>(null);
    const syncingScrollRef = useRef<'table' | 'footer' | null>(null);
    const columnResizeRef = useRef<{ key: TradeColumnWidthKey; startX: number; startWidth: number } | null>(null);

    // Local trade overrides: track modified fields since the Gateway API can lag after modification.
    const [tradeOverrides, setTradeOverrides] = useState<Record<number, { sl: number; tp: number; comment?: string }>>({});

    // Subscribe to positions instead of ticks for highspeed socket data
    // (Handled by the parent component, BottomDock, which passes throttled positions)

    useEffect(() => {
        const handleTradeModified = (e: any) => {
            const { id, sl, tp, comment } = e.detail;
            const existingPosition = useAppStore.getState().positions.find((position) => position.id === Number(id));
            rememberTradeHistoryPositionLevels([
                { ...(existingPosition ?? {}), id, sl, tp, price_sl: sl, price_tp: tp },
            ], useAppStore.getState().accountId);
            setTradeOverrides(prev => ({
                ...prev,
                [id]: { sl, tp, comment: comment ?? prev[id]?.comment },
            }));
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
        window.localStorage.setItem(TRADE_FOOTER_METRIC_STORAGE_KEY, JSON.stringify(footerMetricVisibility));
    }, [footerMetricVisibility]);

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
        rememberTradeHistoryPositionLevels([
            { ...pos, sl: newSL, tp: newTP, price_sl: newSL, price_tp: newTP },
        ], accountId);
        // Also update local overrides
        setTradeOverrides(prev => ({ ...prev, [pos.id]: { sl: newSL, tp: newTP, comment: prev[pos.id]?.comment } }));
        setEditingId(null);
    };

    // Calculate live positions with realtime prices, PnL, and SL/TP from local overrides
    const livePositions = useMemo(() => {
        return positions.map((pos: any) => {
            const symbol = pos?.symbol ?? '';
            const livePrice = Number(pos?.currentPrice ?? 0);
            const profitResolution = resolveTradeProfit(pos, { accountCurrency: account?.currency });
            const livePnL = profitResolution.value;
            const openPrice = Number(pos?.openPrice ?? 0);
            const volume = Number(pos?.volume ?? 0);

            // Apply local overrides while the Gateway API catches up.
            const override = tradeOverrides[pos?.id];
            const sl = override?.sl ?? pos?.price_sl ?? pos?.sl ?? 0;
            const tp = override?.tp ?? pos?.price_tp ?? pos?.tp ?? 0;
            const comment = override?.comment ?? pos?.comment ?? '';

            return {
                ...pos,
                symbol,
                volume,
                openPrice,
                sl: Number(sl ?? 0),
                tp: Number(tp ?? 0),
                price_sl: Number(sl ?? 0),
                price_tp: Number(tp ?? 0),
                comment,
                profit: livePnL,
                unrealizedPnL: livePnL,
                livePrice,
                livePnL,
                profitSource: profitResolution.source,
                profitWarnings: profitResolution.warnings,
            };
        });
    }, [positions, tradeOverrides, account?.currency]);

    const livePositionLevelSignature = useMemo(() => (
        livePositions
            .map((pos: any) => [
                pos?.id ?? '',
                pos?.symbol ?? '',
                pos?.side ?? '',
                pos?.volume ?? '',
                pos?.openPrice ?? pos?.price_open ?? '',
                pos?.openTime ?? pos?.time_create ?? '',
                pos?.price_sl ?? pos?.sl ?? '',
                pos?.price_tp ?? pos?.tp ?? '',
            ].join(':'))
            .join('|')
    ), [livePositions]);

    useEffect(() => {
        rememberTradeHistoryPositionLevels(livePositions, accountId);
    }, [accountId, livePositionLevelSignature]);

    // Row-level totals. These drive the per-tile Floating P/L, Swap and Commission displays
    // only \u2014 they must never feed the account metrics, which are backend-authoritative.
    const totalLivePnL = useMemo(() => livePositions.reduce((acc, pos) => acc + (pos.livePnL || 0), 0), [livePositions]);
    const totalSwap = useMemo(() => livePositions.reduce((acc, pos) => acc + (Number(pos.swap) || 0), 0), [livePositions]);
    const totalCommission = useMemo(() => livePositions.reduce((acc, pos) => acc + (Number(pos.commission) || 0), 0), [livePositions]);
    // Equity / free margin / margin level are shown exactly as the backend reports them. When
    // the backend omits one it resolves to null and the footer renders a dash, not a zero.
    const accountMetricResolution = useMemo(() => resolveTradeAccountMetrics({
        balance: account?.balance,
        equity: account?.equity,
        margin: account?.margin,
        freeMargin: account?.freeMargin,
        marginLevel: account?.marginLevel,
        hasBackendEquity: account?.hasBackendEquity,
        hasBackendFreeMargin: account?.hasBackendFreeMargin,
        hasBackendMarginLevel: account?.hasBackendMarginLevel,
        credit: account?.credit,
        bonus: account?.bonus,
    }), [account]);
    const accountBalance = accountMetricResolution.balance;
    const liveEquity = accountMetricResolution.equity;
    const margin = accountMetricResolution.margin;
    const liveFreeMargin = accountMetricResolution.freeMargin;
    const liveMarginLevel = accountMetricResolution.marginLevel;

    const formatMarginLevel = (value: number | null) => {
        if (value === null) return METRIC_UNAVAILABLE;
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

    const isFooterMetricVisible = useCallback((key: TradeFooterMetricKey) => footerMetricVisibility[key] !== false, [footerMetricVisibility]);

    const toggleFooterMetric = useCallback((key: TradeFooterMetricKey) => {
        setFooterMetricVisibility(prev => ({ ...prev, [key]: prev[key] === false }));
    }, []);

    const resetFooterMetrics = useCallback(() => {
        setFooterMetricVisibility({ ...DEFAULT_TRADE_FOOTER_METRICS });
    }, []);

    const toggleFooterMetricMenu = useCallback((trigger: HTMLButtonElement) => {
        const rect = trigger.getBoundingClientRect();
        setFooterMetricMenu(prev => (
            prev ? null : { x: rect.left, y: rect.bottom + 2 }
        ));
    }, []);

    const footerMetricMenuItems = useMemo<ContextMenuItemConfig[]>(() => [
        { label: 'Reset Metrics', action: resetFooterMetrics, autoClose: false },
        { divider: true, label: '' },
        ...TRADE_FOOTER_METRIC_DEFS.map(metric => ({
            label: metric.label,
            checked: isFooterMetricVisible(metric.key),
            action: () => toggleFooterMetric(metric.key),
            autoClose: false,
        })),
    ], [isFooterMetricVisible, resetFooterMetrics, toggleFooterMetric]);

    const visibleFooterMetrics = useMemo(
        () => TRADE_FOOTER_METRIC_DEFS.filter(metric => isFooterMetricVisible(metric.key)),
        [isFooterMetricVisible]
    );

    const renderFooterMetricValue = (key: TradeFooterMetricKey) => {
        switch (key) {
            case 'positions':
                return <BlinkingText value={livePositions.length} />;
            case 'balance':
                return <BlinkingText value={accountBalance} formatFn={formatMoney} suffix={` ${account?.currency || 'USD'}`} />;
            case 'equity':
                return liveEquity === null
                    ? <UnavailableMetric />
                    : <BlinkingText value={liveEquity} formatFn={formatMoney} />;
            case 'margin':
                return <BlinkingText value={margin} formatFn={formatMoney} />;
            case 'freeMargin':
                return liveFreeMargin === null
                    ? <UnavailableMetric />
                    : <BlinkingText value={liveFreeMargin} formatFn={formatMoney} />;
            case 'marginLevel':
                return liveMarginLevel === null
                    ? <UnavailableMetric />
                    : <BlinkingText value={liveMarginLevel} formatFn={formatMarginLevel} />;
            case 'swap':
                return <BlinkingText value={totalSwap} formatFn={formatMoney} defaultColor={totalSwap < 0 ? 'text-[#f87171]' : 'text-zinc-300'} />;
            case 'commission':
                return <BlinkingText value={totalCommission} formatFn={formatMoney} defaultColor={totalCommission < 0 ? 'text-[#f87171]' : 'text-zinc-300'} />;
            default:
                return null;
        }
    };

    const getFooterMetricComment = (key: TradeFooterMetricKey) => {
        let value = '';
        switch (key) {
            case 'positions':
                value = String(livePositions.length);
                break;
            case 'balance':
                value = `${formatMoney(accountBalance)} ${account?.currency || 'USD'}`;
                break;
            case 'equity':
                value = liveEquity === null ? METRIC_UNAVAILABLE : formatMoney(liveEquity);
                break;
            case 'margin':
                value = formatMoney(margin);
                break;
            case 'freeMargin':
                value = liveFreeMargin === null ? METRIC_UNAVAILABLE : formatMoney(liveFreeMargin);
                break;
            case 'marginLevel':
                value = formatMarginLevel(liveMarginLevel);
                break;
            case 'swap':
                value = formatMoney(totalSwap);
                break;
            case 'commission':
                value = formatMoney(totalCommission);
                break;
        }
        return `${TRADE_FOOTER_METRIC_COMMENTS[key]}: ${value}`;
    };

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
    const displayedLivePositions = useMemo(
        () => [...pendingPositions, ...sortedLivePositions],
        [pendingPositions, sortedLivePositions],
    );

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
        if (isColumnVisible('side')) columns.push({ label: 'Type', value: pos => String(pos.side ?? '').toLowerCase() || '-' });
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
th,td{border:1px solid #bdbdbd;padding:4px 6px;text-align:center;white-space:nowrap}
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

    const ensureTradeLevelsVisibleForLivePositions = useCallback((positions: ToolboxTradePosition[]) => {
        const symbols = Array.from(new Set(
            positions
                .map(position => String(position.symbol ?? '').trim())
                .filter(Boolean),
        ));
        if (symbols.length === 0) return;

        const store = useChartSettingsStore.getState();
        symbols.forEach(symbol => {
            const visible = store.symbolProperties[symbol]?.showTradeLevels ?? store.globalProperties.showTradeLevels;
            if (visible === false) {
                store.updateSymbolProperty(symbol, 'showTradeLevels', true);
            }
        });
    }, []);

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
            ensureTradeLevelsVisibleForLivePositions(livePositions);
            window.dispatchEvent(new CustomEvent('rtx:refresh-trade-overlay'));
        }
    }, [ensureTradeLevelsVisibleForLivePositions, showOnChartsAutoUpdate, livePositions]);

    const renderColumnResizeHandle = (key: TradeColumnWidthKey) => (
        <button
            type="button"
            aria-label={`Resize ${getTradeColumnDef(key).label} column`}
            title={`Resize ${getTradeColumnDef(key).label} column`}
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
    ) => (
        <th
            className="relative px-1.5 py-[3px] text-center border-r border-zinc-700/70"
            style={{ width: columnWidths[key] }}
            title={TRADE_COLUMN_HOVER_COMMENTS[key]}
            aria-sort={sortState?.column === sortColumn ? (sortState.direction === 'asc' ? 'ascending' : 'descending') : 'none'}
        >
            <button
                type="button"
                title={`Sort by ${label}`}
                onClick={() => toggleSort(sortColumn)}
                className="relative flex w-full items-center justify-center px-2 text-center hover:text-white"
            >
                <span>{label}</span>
                <span className="absolute right-0 inline-block w-[8px] text-center text-zinc-500">
                    {sortState?.column === sortColumn ? (sortState.direction === 'asc' ? '^' : 'v') : ''}
                </span>
            </button>
            {renderColumnResizeHandle(key)}
        </th>
    );

    const renderHeader = (column: TradeColumnDef) => {
        return (
            <th
                key={column.key}
                className="relative px-1.5 py-[3px] text-center border-r border-zinc-700/70"
                style={{ width: columnWidths[column.key] }}
                title={TRADE_COLUMN_HOVER_COMMENTS[column.key]}
            >
                <span className="block px-2">{column.label}</span>
                {renderColumnResizeHandle(column.key)}
            </th>
        );
    };

    return (
        <div className="rtx-trade-tab h-full flex flex-col relative bg-[#131316] overflow-hidden">
            <div
                ref={tableScrollRef}
                onScroll={() => syncHorizontalScroll('table')}
                className="rtx-trade-scroll flex-1 overflow-auto scrollbar-thin scrollbar-thumb-zinc-700"
            >
                <table
                    className="rtx-trade-table w-full text-center border-collapse table-fixed"
                    style={{ minWidth: visibleTradeTableWidth, fontFamily: '"Segoe UI", Tahoma, Arial, sans-serif', fontVariantNumeric: 'tabular-nums' }}
                >
                    <colgroup>
                        <col style={{ width: columnWidths.symbol }} />
                        {visibleTradeColumns.map(column => (
                            <col key={column.key} style={{ width: columnWidths[column.key] }} />
                        ))}
                        <col style={{ width: columnWidths.close }} />
                    </colgroup>
                    <thead className="rtx-trade-table__head sticky top-0 bg-[#17181c] text-[#c9cfdb] z-10 font-normal text-[12px] leading-[18px] uppercase border-y border-zinc-700/70 select-none shadow-[0_1px_0_0_rgba(255,255,255,0.04)]">
                        <tr className="h-[30px]">
                            {renderSortableHeader('symbol', 'Symbol', 'symbol')}
                            {visibleTradeColumns.map(column => {
                                if (column.key === 'ticket') return renderSortableHeader('ticket', column.label, 'ticket');
                                if (column.key === 'time') return renderSortableHeader('time', column.label, 'time_create');
                                if (column.key === 'profit') return renderSortableHeader('profit', column.label, 'profit');
                                return renderHeader(column);
                            })}
                            <th className="px-0.5 py-[3px] text-center" style={{ width: columnWidths.close }} aria-label="Close position" title={TRADE_COLUMN_HOVER_COMMENTS.close}></th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-zinc-800/90 text-[#d8dde8] text-[13px] leading-[19.5px] font-normal">
                        {displayedLivePositions.length === 0 && (
                            <tr>
                                <td colSpan={visibleOptionalColumnCount + 2} className="h-16 text-center text-zinc-600 text-xs italic">
                                    {loading ? 'Loading open positions...' : error ? error : 'No open positions'}
                                </td>
                            </tr>
                        )}
                        {displayedLivePositions.map((pos: ToolboxTradePosition, i: number) => {
                            const isPendingPlacement = pos.placementState === 'pending';
                            const isBuy = String(pos.side).toUpperCase() === 'BUY';
                            const pnl = pos.profit ?? pos.unrealizedPnL;
                            const pnlValue = Number(pnl ?? 0);
                            const pointsValue = getTradePointsValue(pos);
                            const profitIsPositive = profitMode === 'points' ? pointsValue >= 0 : pnlValue >= 0;
                            const positionKey = getPositionKey(pos);
                            const isSelected = selectedPositionKey === positionKey;
                            const symbolLabel = pos.symbol ?? '-';
                            const ticketLabel = isPendingPlacement ? 'pending' : String(pos.ticket ?? pos.id ?? '-');
                            const timeLabel = formatTradeTime(pos.time_create);
                            const sideLabel = String(pos.side ?? '').toLowerCase() || '-';
                            const volumeLabel = String(formatTradeVolume(pos));
                            const rawOpenPrice = Number(pos.price_open ?? pos.openPrice);
                            const openPriceLabel = isPendingPlacement
                                ? '…'
                                : formatTradePrice(rawOpenPrice, symbolLabel);
                            const slLabel = formatTradeLevel(pos.price_sl ?? pos.sl, symbolLabel);
                            const tpLabel = formatTradeLevel(pos.price_tp ?? pos.tp, symbolLabel);
                            const rawCurrentPrice = Number(pos.price_current ?? pos.currentPrice);
                            const currentPriceLabel = isPendingPlacement
                                ? '…'
                                : formatTradePrice(rawCurrentPrice, symbolLabel);
                            const swapLabel = formatMoney(pos.swap);
                            const accountLoginLabel = String(pos.account_login ?? '-');
                            const timeUpdateLabel = formatTradeTime(pos.time_update);
                            const commentLabel = String(pos.comment || '-');
                            const profitLabel = isPendingPlacement
                                ? '…'
                                : profitMode === 'points' ? formatTradePoints(pos) : formatMoney(pnlValue);
                            const rowComment = isPendingPlacement
                                ? `${symbolLabel} ${sideLabel} ${volumeLabel} lots is being sent.`
                                : `${symbolLabel} ${sideLabel} ${volumeLabel} lots, ticket ${ticketLabel}. Double-click to modify, right-click for more options.`;
                            return (
                            <tr
                                key={pos.id ?? i}
                                title={rowComment}
                                aria-selected={isSelected}
                                className={`rtx-trade-row h-[30px] ${isSelected ? 'rtx-trade-row--selected' : ''} transition-colors group cursor-pointer`}
                                onClick={() => {
                                    if (!isPendingPlacement) setSelectedPositionKey(positionKey);
                                }}
                                onDoubleClick={() => {
                                    if (isPendingPlacement) return;
                                    setSelectedPositionKey(positionKey);
                                    setModifyPosition(pos);
                                }}
                                onContextMenu={(event) => {
                                    if (isPendingPlacement) return;
                                    handleTradeContextMenu(event, pos);
                                }}
                            >
                                {/* symbol */}
                                <td className="px-1.5 py-[2px] border-r border-zinc-800 text-center font-normal text-zinc-100 whitespace-nowrap" title={`Symbol: ${symbolLabel}`}>
                                    <span>{symbolLabel}</span>
                                </td>

                                {/* ticket */}
                                {isColumnVisible('ticket') && (
                                    <td className="px-1.5 py-[2px] border-r border-zinc-800 text-center text-[#d8dde8] font-normal tabular-nums whitespace-nowrap" title={`Ticket: ${ticketLabel}`}>{ticketLabel}</td>
                                )}

                                {/* time_create */}
                                {isColumnVisible('time') && (
                                    <td className="px-1.5 py-[2px] border-r border-zinc-800 text-center text-[#aeb5c3] whitespace-nowrap" title={`Open time: ${timeLabel}`}>
                                        {timeLabel}
                                    </td>
                                )}

                                {/* side */}
                                {isColumnVisible('side') && (
                                    <td className={`rtx-trade-side-cell ${isBuy ? 'rtx-trade-side-cell--buy text-[#45bff7]' : 'rtx-trade-side-cell--sell text-[#ff2d2d]'} px-1.5 py-[2px] border-r border-zinc-800 text-center font-normal text-[13px]`} title={`Type: ${sideLabel}`}>
                                        <div className="flex items-center justify-center">
                                            <span>{sideLabel}</span>
                                        </div>
                                    </td>
                                )}

                                {/* volume */}
                                {isColumnVisible('volume') && (
                                    <td className="px-1.5 py-[2px] border-r border-zinc-800 text-center font-normal text-zinc-100 tabular-nums" title={`Volume: ${volumeLabel} lots`}>
                                        {volumeLabel}
                                    </td>
                                )}

                                {/* price_open */}
                                {isColumnVisible('priceOpen') && (
                                    <td className="px-1.5 py-[2px] border-r border-zinc-800 text-center text-[#aeb5c3] tabular-nums" title={`Open price: ${openPriceLabel}`}>
                                        {openPriceLabel}
                                    </td>
                                )}

                                {/* price_sl */}
                                {isColumnVisible('sl') && (
                                    <td className="px-1.5 py-[2px] border-r border-zinc-800 text-center tabular-nums" title={`Stop Loss: ${slLabel}. Double-click to modify.`} onDoubleClick={(event) => { event.stopPropagation(); if (!isPendingPlacement) startEditing(pos); }}>
                                        {editingId === pos.id ? (
                                            <input
                                                className="h-[21px] w-full bg-zinc-800 text-white text-center px-1 text-[13px] font-normal outline-none ring-1 ring-sky-500/70"
                                                value={editSL}
                                                onChange={e => setEditSL(e.target.value)}
                                                onBlur={() => saveEdit(pos)}
                                                onKeyDown={e => e.key === 'Enter' && saveEdit(pos)}
                                                onDoubleClick={e => e.stopPropagation()}
                                            />
                                        ) : (
                                            <span className={(pos.price_sl ?? pos.sl) > 0 ? "rtx-trade-sl-value text-[#ff7676] bg-red-950/20 px-1 rounded-sm cursor-pointer font-normal" : "text-zinc-600 cursor-pointer"}>
                                                {slLabel}
                                            </span>
                                        )}
                                    </td>
                                )}

                                {/* price_tp */}
                                {isColumnVisible('tp') && (
                                    <td className="px-1.5 py-[2px] border-r border-zinc-800 text-center tabular-nums" title={`Take Profit: ${tpLabel}. Double-click to modify.`} onDoubleClick={(event) => { event.stopPropagation(); if (!isPendingPlacement) startEditing(pos); }}>
                                        {editingId === pos.id ? (
                                            <input
                                                className="h-[21px] w-full bg-zinc-800 text-white text-center px-1 text-[13px] font-normal outline-none ring-1 ring-sky-500/70"
                                                value={editTP}
                                                onChange={e => setEditTP(e.target.value)}
                                                onBlur={() => saveEdit(pos)}
                                                onKeyDown={e => e.key === 'Enter' && saveEdit(pos)}
                                                onDoubleClick={e => e.stopPropagation()}
                                            />
                                        ) : (
                                            <span className={(pos.price_tp ?? pos.tp) > 0 ? "rtx-trade-tp-value text-[#34dca0] bg-emerald-900/20 px-1 rounded-sm cursor-pointer font-normal" : "text-zinc-600 cursor-pointer"}>
                                                {tpLabel}
                                            </span>
                                        )}
                                    </td>
                                )}

                                {/* price_current */}
                                {isColumnVisible('priceCurrent') && (
                                    <td className="px-1.5 py-[2px] border-r border-zinc-800 text-center text-zinc-100 font-normal tabular-nums" title={`Current price: ${currentPriceLabel}`}>
                                        {currentPriceLabel}
                                    </td>
                                )}

                                {/* swap */}
                                {isColumnVisible('swap') && (
                                    <td className="px-1.5 py-[2px] border-r border-zinc-800 text-center text-[#8d95a3] tabular-nums" title={`Swap: ${swapLabel}`}>{swapLabel}</td>
                                )}

                                {/* account_login */}
                                {isColumnVisible('accountLogin') && (
                                    <td className="px-1.5 py-[2px] border-r border-zinc-800 text-center text-[#aeb5c3] whitespace-nowrap tabular-nums" title={`Account login: ${accountLoginLabel}`}>
                                        {accountLoginLabel}
                                    </td>
                                )}

                                {/* time_update */}
                                {isColumnVisible('timeUpdate') && (
                                    <td className="px-1.5 py-[2px] border-r border-zinc-800 text-center text-[#aeb5c3] whitespace-nowrap tabular-nums" title={`Last update: ${timeUpdateLabel}`}>
                                        {timeUpdateLabel}
                                    </td>
                                )}

                                {/* comment */}
                                {isColumnVisible('comment') && (
                                    <td className="px-1.5 py-[2px] border-r border-zinc-800 text-center text-[#aeb5c3] truncate" title={`Comment: ${commentLabel}`}>
                                        {commentLabel}
                                    </td>
                                )}

                                {/* profit */}
                                {isColumnVisible('profit') && (
                                    <td className={`px-1.5 py-[2px] text-center font-normal tabular-nums ${profitIsPositive ? 'rtx-trade-profit-value--positive text-[#22c55e]' : 'rtx-trade-profit-value--negative text-[#ff2d2d]'}`} title={`${profitMode === 'points' ? 'Profit points' : 'Profit'}: ${profitLabel}`}>
                                        {profitLabel}
                                    </td>
                                )}

                                {/* Close Button */}
                                <td className="px-0.5 py-[2px] text-center">
                                    <button
                                        type="button"
                                        aria-label={isPendingPlacement ? 'Order is being sent' : `Close position ${pos.ticket ?? pos.id}`}
                                        title={isPendingPlacement ? 'Order is being sent' : `Close position ${ticketLabel}`}
                                        disabled={isPendingPlacement}
                                        onClick={(event) => {
                                            event.stopPropagation();
                                            if (isPendingPlacement) return;
                                            onClosePosition(pos.id);
                                        }}
                                        className="rtx-trade-close-button mx-auto flex h-[17px] w-[17px] items-center justify-center rounded-sm border border-transparent text-[12px] font-normal leading-none text-zinc-400 hover:border-red-500/50 hover:bg-red-950/50 hover:text-red-200 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-red-400 disabled:cursor-wait disabled:text-zinc-600 disabled:hover:border-transparent disabled:hover:bg-transparent"
                                    >
                                        {isPendingPlacement ? '…' : 'x'}
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
                className="rtx-trade-footer bg-[#191a1e] border-t border-zinc-700 w-full overflow-x-auto overflow-y-hidden text-[13px] font-normal text-zinc-300 tabular-nums shadow-[inset_0_1px_0_0_rgba(255,255,255,0.05)] scrollbar-thin scrollbar-thumb-zinc-700"
            >
                <div className="rtx-trade-footer-inner flex w-max min-w-full items-center gap-1 px-1.5 py-1" style={{ minWidth: `max(100%, ${visibleTradeTableWidth}px)` }}>
                    <button
                        ref={footerMetricButtonRef}
                        type="button"
                        className="rtx-trade-footer-status inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-[3px] border border-zinc-700/70 bg-zinc-950/35 px-0 text-zinc-400 hover:bg-zinc-800/70 hover:text-zinc-100 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-sky-400"
                        title="Select footer metrics"
                        aria-label="Footer metrics"
                        aria-haspopup="menu"
                        aria-expanded={footerMetricMenu !== null}
                        onClick={(event) => {
                            event.stopPropagation();
                            toggleFooterMetricMenu(event.currentTarget);
                        }}
                    >
                        <Icon name="plus-circle" size="xs" className="text-current shrink-0" />
                    </button>
                    {visibleFooterMetrics.map(metric => (
                        <span key={metric.key} className="rtx-trade-footer-metric" title={getFooterMetricComment(metric.key)}>
                            <span className="rtx-trade-metric-label text-zinc-500">{metric.label}</span>
                            {renderFooterMetricValue(metric.key)}
                        </span>
                    ))}
                    <div className="flex-1 min-w-2"></div>
                    <div className="rtx-trade-footer-actions flex shrink-0 items-center gap-1 pl-0.5">
                    <button
                        type="button"
                        title="Close all profitable positions"
                        onClick={() => onCloseBulk?.('WINNERS')}
                        disabled={!onCloseBulk || livePositions.length === 0}
                        className="rtx-trade-bulk-close rtx-trade-footer-action rtx-trade-footer-action--neutral inline-flex h-5 shrink-0 items-center justify-center whitespace-nowrap rounded-[3px] border border-zinc-700 px-1.5 text-[12px] font-normal leading-none text-zinc-300 hover:bg-zinc-700/60 disabled:cursor-not-allowed disabled:opacity-40"
                    >
                        Close Winners
                    </button>
                    <button
                        type="button"
                        title="Close all losing positions"
                        onClick={() => onCloseBulk?.('LOSERS')}
                        disabled={!onCloseBulk || livePositions.length === 0}
                        className="rtx-trade-footer-action rtx-trade-footer-action--neutral inline-flex h-5 shrink-0 items-center justify-center whitespace-nowrap rounded-[3px] border border-zinc-700 px-1.5 text-[12px] font-normal leading-none text-zinc-300 hover:bg-zinc-700/60 disabled:cursor-not-allowed disabled:opacity-40"
                    >
                        Close Losers
                    </button>
                    <button
                        type="button"
                        title="Close all open positions"
                        onClick={() => onCloseBulk?.('ALL')}
                        disabled={!onCloseBulk || livePositions.length === 0}
                        className="rtx-trade-footer-action rtx-trade-footer-action--danger inline-flex h-5 shrink-0 items-center justify-center whitespace-nowrap rounded-[3px] border border-red-800/70 px-1.5 text-[12px] font-normal leading-none text-red-300 hover:bg-red-950/50 disabled:cursor-not-allowed disabled:opacity-40"
                    >
                        Close All
                    </button>
                    </div>
                    <span className="rtx-trade-footer-floating inline-flex h-5 min-w-[112px] shrink-0 items-center justify-end gap-1 whitespace-nowrap rounded-[3px] border border-zinc-700/70 bg-zinc-950/35 px-1.5 text-right font-normal leading-none" title={`Floating P/L: ${formatMoney(totalLivePnL)}`}>
                        <span className="text-zinc-100">Floating P/L</span>
                        <BlinkingText value={totalLivePnL} formatFn={formatMoney} defaultColor={totalLivePnL > 0 ? "text-[#22c55e]" : totalLivePnL < 0 ? "text-[#ff2d2d]" : "text-[#2563eb]"} />
                    </span>
                </div>
            </div>
            {footerMetricMenu && (
                <ContextMenu
                    variant={isLightSkin ? "mt5-light" : "mt5-dark"}
                    items={footerMetricMenuItems}
                    position={footerMetricMenu}
                    onClose={() => setFooterMetricMenu(null)}
                    ignoredElements={[footerMetricButtonRef.current]}
                />
            )}
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
                onClose={(modifiedSl?: number, modifiedTp?: number, modifiedComment?: string) => {
                    // Capture modified values in local overrides while the backend refresh catches up.
                    if (modifyPosition && modifiedSl !== undefined && modifiedTp !== undefined) {
                        setTradeOverrides(prev => ({
                            ...prev,
                            [modifyPosition.id]: { sl: modifiedSl, tp: modifiedTp, comment: modifiedComment ?? '' }
                        }));
                    }
                    setModifyPosition(null);
                }}
                position={modifyPosition}
            />
        </div>
    );
}

type ExposureTabProps = {
    positions: ExposurePositionInput[];
    formatMoney: (value: number | undefined | null) => string;
    account: ExposureAccountInput | null;
};

const polarToCartesian = (centerX: number, centerY: number, radius: number, angleInDegrees: number) => {
    const angleInRadians = (angleInDegrees - 90) * Math.PI / 180;
    return {
        x: centerX + radius * Math.cos(angleInRadians),
        y: centerY + radius * Math.sin(angleInRadians),
    };
};

const describePieSlice = (
    centerX: number,
    centerY: number,
    radius: number,
    startAngle: number,
    endAngle: number
) => {
    const start = polarToCartesian(centerX, centerY, radius, endAngle);
    const end = polarToCartesian(centerX, centerY, radius, startAngle);
    const largeArcFlag = endAngle - startAngle <= 180 ? '0' : '1';

    return [
        `M ${centerX} ${centerY}`,
        `L ${start.x} ${start.y}`,
        `A ${radius} ${radius} 0 ${largeArcFlag} 0 ${end.x} ${end.y}`,
        'Z',
    ].join(' ');
};

function ExposureTab({ positions, formatMoney, account }: ExposureTabProps) {
    const exposure = useMemo(() => {
        return buildExposureSummary(positions ?? [], account);
    }, [positions, account]);

    const accountBalance = Number(account?.balance ?? 0);
    const accountEquity = Number(account?.equity ?? accountBalance);
    const accountMargin = Number(account?.margin ?? 0);
    const accountFreeMargin = Number(account?.freeMargin ?? account?.free_margin ?? 0);
    const accountMarginLevel = Number(account?.marginLevel ?? account?.margin_level ?? 0);

    const renderLongPositionChart = (segments: ExposurePieSegment[]) => {
        const visibleSegments = segments.filter(segment => segment.percent > 0);
        const centerX = 96;
        const centerY = 76;
        const radius = 58;
        const labelRadius = 74;

        if (visibleSegments.length === 0) {
            return (
                <div className="flex h-[165px] items-center justify-center text-[12px] font-normal text-zinc-500">
                    No long exposure
                </div>
            );
        }

        return (
            <svg viewBox="0 0 192 165" className="h-[165px] w-full" role="img" aria-label="Long positions exposure chart">
                <filter id="exposureGlow" x="-30%" y="-30%" width="160%" height="160%">
                    <feDropShadow dx="0" dy="0" stdDeviation="4" floodColor="#4a73ff" floodOpacity="0.5" />
                </filter>
                {visibleSegments.map((segment) => {
                    if (segment.percent >= 0.999) {
                        return (
                            <circle
                                key={segment.asset}
                                cx={centerX}
                                cy={centerY}
                                r={radius}
                                fill={segment.color}
                                filter="url(#exposureGlow)"
                                stroke="#1a1d2a"
                                strokeWidth="1"
                            />
                        );
                    }

                    return (
                        <path
                            key={segment.asset}
                            d={describePieSlice(centerX, centerY, radius, segment.startAngle, segment.endAngle)}
                            fill={segment.color}
                            filter="url(#exposureGlow)"
                            stroke="#111827"
                            strokeWidth="1"
                        />
                    );
                })}
                {visibleSegments.slice(0, 6).map((segment) => {
                    const midAngle = (segment.startAngle + segment.endAngle) / 2;
                    const edge = polarToCartesian(centerX, centerY, radius, midAngle);
                    const label = polarToCartesian(centerX, centerY, labelRadius, midAngle);
                    const textAnchor = label.x >= centerX ? 'start' : 'end';
                    return (
                        <g key={`${segment.asset}-label`}>
                            <line x1={edge.x} y1={edge.y} x2={label.x} y2={label.y} stroke="#6b7280" strokeWidth="0.8" />
                            <text
                                x={label.x + (label.x >= centerX ? 4 : -4)}
                                y={label.y + 3}
                                fill="#d8deea"
                                fontSize="9"
                                fontFamily="Consolas, monospace"
                                textAnchor={textAnchor}
                            >
                                {segment.asset}
                            </text>
                        </g>
                    );
                })}
            </svg>
        );
    };

    return (
        <div className="rtx-exposure-tab h-full flex bg-[#131316] text-[14px] font-normal">
            {/* Table */}
            <div className="flex min-w-0 flex-1 flex-col border-r border-zinc-700">
                <div className="min-h-0 flex-1 overflow-auto">
                    <table className="w-full min-w-[720px] table-fixed border-collapse text-left">
                        <thead className="sticky top-0 z-10 border-b border-zinc-700/70 bg-[#090d19] text-[12px] font-normal leading-[18px] uppercase tracking-wider text-[#c9d1df]">
                            <tr className="h-[30px]">
                                <th className="w-[120px] border-r border-zinc-800 p-1 pl-2">Assets</th>
                                <th className="w-[130px] border-r border-zinc-800 p-1 text-right">Volume</th>
                                <th className="w-[130px] border-r border-zinc-800 p-1 text-right">Rate</th>
                                <th className="w-[130px] border-r border-zinc-800 p-1 text-right">{exposure.accountCurrency}</th>
                                <th className="p-1 text-center">Graph</th>
                            </tr>
                        </thead>
                        <tbody className="font-mono text-[13px] font-normal leading-[19.5px] text-zinc-200">
                            {exposure.rows.length === 0 ? (
                                <tr>
                                    <td colSpan={5} className="h-16 text-center text-zinc-500">
                                        No exposure
                                    </td>
                                </tr>
                            ) : exposure.rows.map((exp, i) => {
                                const isLong = exp.value >= 0;
                                return (
                                    <tr key={exp.asset} className={`h-[30px] font-normal ${i % 2 === 0 ? 'bg-[#15161b]' : 'bg-[#101116]'}`}>
                                        <td className="border-r border-zinc-800 p-1 pl-2 font-normal text-[#f4c542]">
                                            <span className="mr-1 inline-flex h-[13px] w-[13px] items-center justify-center rounded-[2px] border border-[#ad8a11] bg-[#ffd735] text-[9px] font-black leading-none text-[#574800]">
                                                $
                                            </span>
                                            {exp.asset}
                                        </td>
                                        <td className="border-r border-zinc-800 p-1 text-right">{formatExposureVolume(exp.asset, exp.volume)}</td>
                                        <td className="border-r border-zinc-800 p-1 text-right">{exp.rate.toFixed(5)}</td>
                                        <td className={`border-r border-zinc-800 p-1 text-right ${isLong ? 'text-zinc-100' : 'text-[#ff6670]'}`}>
                                            {formatMoney(exp.value)}
                                        </td>
                                        <td className="p-1 px-4 align-middle">
                                            <div className="relative h-[13px] w-full overflow-hidden rounded-[2px] bg-[#292b31]">
                                                <div
                                                    className={`absolute top-0 h-full ${isLong ? 'left-0 bg-[#3b45ff]' : 'right-0 bg-[#ff3344]'}`}
                                                    style={{ width: `${exp.graphPercent}%` }}
                                                />
                                            </div>
                                        </td>
                                    </tr>
                                );
                            })}
                        </tbody>
                    </table>
                </div>
                <div className="flex h-[30px] shrink-0 items-center gap-2 overflow-hidden border-t border-[#3a3d45] bg-[#2a2d34] px-2 font-mono text-[13px] font-bold leading-[19.5px] text-[#f6f7fb]">
                    <span>Balance: {formatMoney(accountBalance)} {exposure.accountCurrency}</span>
                    <span>Equity: {formatMoney(accountEquity)}</span>
                    <span>Margin: {formatMoney(accountMargin)}</span>
                    <span>Free Margin: {formatMoney(accountFreeMargin)}</span>
                    <span>Margin Level: {Number.isFinite(accountMarginLevel) ? accountMarginLevel.toFixed(2) : '0.00'} %</span>
                </div>
            </div>

            {/* Pie Chart Area */}
            <div className="flex w-[270px] shrink-0 flex-col bg-[#0d0e12] p-3">
                <div className="mb-2 text-center text-[12px] font-normal uppercase tracking-wider text-zinc-400">Long Positions</div>
                <div className="min-h-0 flex-1">
                    {renderLongPositionChart(exposure.longSegments)}
                </div>
                <div className="mt-1 grid grid-cols-1 gap-1 text-[12px] font-normal text-zinc-400">
                    {exposure.longSegments.slice(0, 4).map(segment => (
                        <div key={segment.asset} className="flex items-center justify-between gap-2">
                            <span className="flex min-w-0 items-center gap-1">
                                <span className="h-2 w-2 shrink-0" style={{ backgroundColor: segment.color }} />
                                <span className="truncate">{segment.asset}</span>
                            </span>
                            <span className="font-mono text-zinc-300">{(segment.percent * 100).toFixed(1)}%</span>
                        </div>
                    ))}
                </div>
            </div>
        </div>
    );
}

function HistoryTab({ formatMoney }: { formatMoney: (value: number | undefined | null) => string }) {
    const [orders, setOrders] = useState<Trade[]>([]);
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
        } catch (err: unknown) {
            console.warn('[History] Failed to load:', err);
            setError(err instanceof Error ? err.message : 'Failed to load history');
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

    const formatTs = (value?: string) => {
        if (!value) return '-';
        return new Date(value).toLocaleString('en-US', {
            year: 'numeric', month: '2-digit', day: '2-digit',
            hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false
        }).replace(',', '');
    };

    const formatPriceCell = (value: number | undefined, symbol: string) => (
        Number.isFinite(value) && value !== 0 ? <PriceDisplay price={value} symbol={symbol} /> : '-'
    );

    const formatTradeStatus = (trade: Trade) => {
        if (trade.status) return trade.status;
        if (trade.closeTime) return 'closed';
        return trade.type || '-';
    };

    const moneyColor = (value: number | undefined) => {
        const numeric = Number(value ?? 0);
        if (numeric > 0) return 'text-[#48d37f]';
        if (numeric < 0) return 'text-[#ff4d5b]';
        return 'text-zinc-400';
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
                            className={`rtx-journal-time-btn px-2 py-0.5 text-[12px] font-normal rounded capitalize transition-colors ${filter === f ? 'bg-zinc-600 text-white' : 'text-zinc-400'}`}>
                            {f}
                        </button>
                    ))}
                </div>
                <div className="flex-1" />
                <span className="text-[12px] font-normal text-zinc-500">{filteredOrders.length} records</span>
                <button onClick={fetchHistory} disabled={loading}
                    className="text-[12px] font-normal px-2 py-0.5 rounded bg-zinc-700 hover:bg-zinc-600 text-zinc-300 flex items-center gap-1">
                    <Icon name="refresh" size="xs" className={loading ? 'animate-spin' : ''} />
                    {loading ? 'Loading…' : 'Refresh'}
                </button>
            </div>

            {/* States */}
            {loading && <div className="flex-1 flex items-center justify-center text-zinc-500 text-xs">Loading closed trade history…</div>}
            {!loading && error && (
                <div className="flex-1 flex flex-col items-center justify-center gap-2">
                    <button onClick={fetchHistory} className="text-[12px] font-normal px-3 py-1 bg-zinc-700 rounded hover:bg-zinc-600 text-zinc-300">Retry</button>
                </div>
            )}
            {!loading && !error && filteredOrders.length === 0 && (
                <div className="flex-1 flex items-center justify-center text-zinc-600 text-xs italic">No closed trades for this period</div>
            )}

            {/* Table */}
            {!loading && !error && filteredOrders.length > 0 && (
                <div className="flex-1 overflow-auto scrollbar-thin scrollbar-thumb-zinc-700">
                    <table className="w-full text-left border-collapse">
                        <thead className="sticky top-0 bg-[#131316] text-[#a0a0a0] z-10 font-normal text-[12px] uppercase tracking-normal border-b border-zinc-700/50">
                            <tr className="h-[30px]">
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
                                <th className="p-1 w-20 text-right">Commission</th>
                                <th className="p-1 w-20 text-right">Swap</th>
                                <th className="p-1 w-20 text-right">Profit</th>
                                <th className="p-1 w-20 text-right">Status</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-zinc-800 text-zinc-300 font-mono text-[13px] leading-[19.5px] font-normal">
                            {filteredOrders.map((o, i) => (
                                <tr key={`${o.type}-${o.id}-${i}`}
                                    className="rtx-history-row h-[30px] group transition-all duration-300 ease-in-out">
                                    <td className="p-1 pl-2 border-r border-zinc-800 text-zinc-500">{o.id ?? '-'}</td>
                                    <td className="p-1 border-r border-zinc-800 text-zinc-400 whitespace-nowrap">{formatTs(o.openTime)}</td>
                                    <td className={`p-1 border-r border-zinc-800 font-normal ${typeColor(o.side)}`}>{(o.side || o.type || '-').toUpperCase()}</td>
                                    <td className="p-1 border-r border-zinc-800 text-right font-normal text-zinc-200">
                                        {o.volume != null ? Number(o.volume).toFixed(2) : '-'}
                                    </td>
                                    <td className="p-1 border-r border-zinc-800 font-normal text-zinc-100 pl-3">{o.symbol ?? '-'}</td>
                                    <td className="p-1 border-r border-zinc-800 text-right text-zinc-400">
                                        {formatPriceCell(o.openPrice, o.symbol)}
                                    </td>
                                    <td className="p-1 border-r border-zinc-800 text-right text-zinc-500">
                                        {formatPriceCell(o.sl, o.symbol)}
                                    </td>
                                    <td className="p-1 border-r border-zinc-800 text-right text-zinc-500">
                                        {formatPriceCell(o.tp, o.symbol)}
                                    </td>
                                    <td className="p-1 border-r border-zinc-800 text-right text-zinc-400">{formatTs(o.closeTime)}</td>
                                    <td className="p-1 border-r border-zinc-800 text-right text-zinc-400">
                                        {formatPriceCell(o.closePrice, o.symbol)}
                                    </td>
                                    <td className={`p-1 border-r border-zinc-800 text-right ${moneyColor(o.commission)}`}>{formatMoney(o.commission)}</td>
                                    <td className={`p-1 border-r border-zinc-800 text-right ${moneyColor(o.swap)}`}>{formatMoney(o.swap)}</td>
                                    <td className={`p-1 border-r border-zinc-800 text-right font-normal ${moneyColor(o.profit)}`}>{formatMoney(o.profit)}</td>
                                    <td className="p-1 pr-2 text-right text-zinc-500 capitalize">{formatTradeStatus(o)}</td>
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
            <div className="text-[12px] font-normal">RTX5 {title}</div>
            <div className="text-[12px] font-normal">No active items to display</div>
        </div>
    );
}
