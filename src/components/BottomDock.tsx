import { useUiTranslation } from '../hooks/useUiTranslation';
import { Icon } from './ui/Icon';
import { isUnavailableDockSection, lockedTerminalTool, unavailableDockSections } from '../config/terminalToolAvailability';
import { ContextMenu, type ContextMenuItemConfig } from './ui/ContextMenu';
import { lazy, memo, Suspense, useState, useEffect, useLayoutEffect, useMemo, useRef, useCallback } from 'react';
import { RetainedLazyFeature } from '../startup/RetainedLazyFeature';
import { useAppStore, type Trade } from '../store/useAppStore';
import { useToolboxTradeData, type ToolboxTradePosition } from '../hooks/useToolboxTradeData';
import { getStoredAccountLogin, type TradeHistoryDataSet } from '../api/tradeGateway';
import { loadTerminalHistory, peekTerminalHistory, resetTerminalHistorySession } from '../services/terminalHistory';
import { useChartSettingsStore } from '../store/useChartSettingsStore';
import { formatPrice, getSymbolDigits } from '../utils/symbolUtils';
import { rememberTradeHistoryPositionLevels } from '../utils/tradeHistoryLevelCache';
import {
    buildExposureSummary,
    formatExposureVolume,
    type ExposureAccountInput,
    type ExposurePositionInput,
} from './BottomDock.exposure';
import { formatPositionProfit, resolveTradeAccountMetrics, resolveTradeProfit, toBackendFinancialNumber } from './BottomDock.trade';
import { useLiveAccountMetrics } from '../hooks/useLiveAccountMetrics';
import { MARKET_ORDER_PLACEMENT_STATE_EVENT } from '../services/marketOrderPlacementEvents';
import { getTerminalShortcutHint, runTerminalShortcutAction } from '../services/shortcutCatalog';
import { acknowledgeBottomDockTab, getRequestedBottomDockTab } from '../services/bottomDockNavigation';
import {
    getCommittedBrokerAccountSessionScope,
    getCommittedBrokerAccountSessionScopeKey,
    onCommittedBrokerAccountSessionScopeChange,
} from '../services/brokerSession';

type TradeModifiedEventDetail = {
    id?: unknown;
    symbol?: unknown;
    sl?: unknown;
    tp?: unknown;
    comment?: unknown;
    sessionScope?: unknown;
};

type ModifyPositionContext = {
    position: any;
    sessionScope: string;
};

const getCurrentBrokerAccountSessionScopeKey = (): string => (
    getCommittedBrokerAccountSessionScopeKey(getCommittedBrokerAccountSessionScope())
);

const normalizeTradeSymbol = (symbol: unknown): string => String(symbol ?? '').trim().toUpperCase();

const LazyHistoryDownloader = lazy(async () => {
    const module = await import('./HistoryDownloader');
    return { default: module.HistoryDownloader };
});

const ModifyPositionDialog = lazy(() => import('./ModifyPositionDialog').then(module => ({ default: module.ModifyPositionDialog })));
const CalendarTab = lazy(() => import('./layout/CalendarTab').then(module => ({ default: module.CalendarTab })));
const CodeBaseTab = lazy(() => import('./layout/ResearchTabs').then(module => ({ default: module.CodeBaseTab })));
const ArticlesTab = lazy(() => import('./layout/ResearchTabs').then(module => ({ default: module.ArticlesTab })));
const ExpertsTab = lazy(() => import('./layout/ResearchTabs').then(module => ({ default: module.ExpertsTab })));
const JournalTab = lazy(() => import('./layout/JournalTab').then(module => ({ default: module.JournalTab })));

// Memoized tab surfaces: hidden tabs must not re-render on live tick bursts,
// otherwise every tab switch waits behind re-painting invisible tables.
const MemoToolboxTab = memo(ToolboxTab);
const MemoExposureTab = memo(ExposureTab);
const MemoHistoryTab = memo(HistoryTab);
const MemoCalendarTab = memo(CalendarTab);
const MemoCodeBaseTab = memo(CodeBaseTab);
const MemoArticlesTab = memo(ArticlesTab);
const MemoExpertsTab = memo(ExpertsTab);
const MemoJournalTab = memo(JournalTab);

// Stable empty reference handed to hidden live tabs so memo() can skip them
// during tick bursts; live data resumes the render that makes them visible.
const HIDDEN_TAB_ROWS: never[] = [];

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
    historyInstrumentCatalog?: readonly unknown[];
}

type TabType = 'Toolbox' | 'Trade' | 'Exposure' | 'History' | 'News' | 'Mailbox' | 'Calendar' | 'Company' | 'Alerts' | 'Articles' | 'Code Base' | 'Experts' | 'Journal' | 'Historical Data';
type TradeSortColumn = 'symbol' | 'ticket' | 'time_create' | 'profit';
type TradeSortDirection = 'asc' | 'desc';
type TradeSortState = { column: TradeSortColumn; direction: TradeSortDirection } | null;
type TradeProfitMode = 'money' | 'points';
type TradeVolumeMode = 'lots' | 'amounts';
type HistoryViewMode = 'positions' | 'deals' | 'orders' | 'orders-and-deals';
type HistoryPeriodFilter = 'all' | 'last-three-months' | 'last-month' | 'custom';
type HistoryVolumeMode = 'lots' | 'amounts';
type HistoryCustomPeriod = { from: string; to: string };
type HistorySymbolFilter =
    | { mode: 'all' }
    | { mode: 'current' }
    | { mode: 'symbol'; symbol: string };
type HistoryColumnKey =
    | 'ticket'
    | 'marketValue'
    | 'commission'
    | 'swap'
    | 'fee'
    | 'changePercent'
    | 'magicNumber'
    | 'comment';
type HistoryColumnVisibility = Record<HistoryColumnKey, boolean>;
type HistoryContextMenuState = { x: number; y: number; trade?: Trade };
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
const HISTORY_COLUMN_STORAGE_KEY = 'rtx5_history_columns_v2';
const HISTORY_VOLUME_MODE_STORAGE_KEY = 'rtx5_history_volume_mode';
const HISTORY_SHOW_MILLISECONDS_STORAGE_KEY = 'rtx5_history_show_milliseconds';
const HISTORY_AUTO_ARRANGE_STORAGE_KEY = 'rtx5_history_auto_arrange';
const HISTORY_GRID_STORAGE_KEY = 'rtx5_history_grid';
// v1 was written as false on every mount by the old Trade-style History menu,
// so it cannot distinguish a user choice from that obsolete default. Start the
// MT5 History behavior on a clean preference key, where Auto Update defaults on.
const HISTORY_SHOW_ON_CHARTS_AUTO_UPDATE_STORAGE_KEY = 'rtx5_history_show_on_charts_auto_update_v2';

const HISTORY_COLUMN_DEFS: Array<{ key: HistoryColumnKey; label: string }> = [
    { key: 'ticket', label: 'Ticket' },
    { key: 'marketValue', label: 'Market Value' },
    { key: 'commission', label: 'Commission' },
    { key: 'swap', label: 'Swap' },
    { key: 'fee', label: 'Fee' },
    { key: 'changePercent', label: 'Change %' },
    { key: 'magicNumber', label: 'Magic Number' },
    { key: 'comment', label: 'Comment' },
];

const DEFAULT_HISTORY_COLUMNS: HistoryColumnVisibility = {
    ticket: true,
    marketValue: false,
    commission: false,
    swap: false,
    fee: false,
    changePercent: true,
    magicNumber: false,
    comment: false,
};

const TRADE_COLUMN_DEFS: TradeColumnDef[] = [
    { key: 'ticket', label: 'Ticket', defaultWidth: 96, minWidth: 70, maxWidth: 180 },
    { key: 'time', label: 'Time', defaultWidth: 150, minWidth: 120, maxWidth: 220 },
    { key: 'side', label: 'Type', defaultWidth: 76, minWidth: 64, maxWidth: 130 },
    { key: 'volume', label: 'Volume', defaultWidth: 74, minWidth: 62, maxWidth: 120 },
    { key: 'priceOpen', label: 'Price Open', defaultWidth: 98, minWidth: 82, maxWidth: 150 },
    { key: 'sl', label: 'S / L', defaultWidth: 92, minWidth: 80, maxWidth: 150 },
    { key: 'tp', label: 'T / P', defaultWidth: 92, minWidth: 80, maxWidth: 150 },
    { key: 'priceCurrent', label: 'Current Price', defaultWidth: 108, minWidth: 90, maxWidth: 160 },
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
    { key: 'freeMargin', label: 'Free margin' },
    { key: 'marginLevel', label: 'Level' },
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

const TABS: { id: TabType; locked?: boolean }[] = [
    { id: 'Trade' },
    { id: 'History' },
    { id: 'Exposure' },
    { id: 'Toolbox' },
    { id: 'Historical Data' },
    { id: 'News', locked: true },
    { id: 'Mailbox', locked: true },
    { id: 'Calendar', locked: true },
    { id: 'Company', locked: true },
    { id: 'Alerts', locked: true },
    { id: 'Articles', locked: true },
    { id: 'Code Base', locked: true },
    { id: 'Experts', locked: true },
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
    sl: 'Stop Loss:',
    tp: 'Take Profit:',
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
    historyInstrumentCatalog,
}: BottomDockProps) {
    const tr = useUiTranslation();
    // Read trading data directly from store — NOT from props
    // This prevents DockWorkspace.renderPanel from needing to re-create when positions change
    const [account, setAccount] = useState<any>(useAppStore.getState().account);
    const [positions, setPositions] = useState<any[]>(useAppStore.getState().positions);
    const toolboxTrade = useToolboxTradeData();
    const bulkCloseCounts = useMemo(() => {
        const openPositions = toolboxTrade.positions ?? [];
        let profitable = 0;
        let losing = 0;
        for (const position of openPositions) {
            const profit = position.profit ?? 0;
            if (profit > 0) profitable += 1;
            else if (profit < 0) losing += 1;
        }
        return { all: openPositions.length, profitable, losing };
    }, [toolboxTrade.positions]);

    // Value-level caches — prevent setState when broker sends new objects with same field values
    const cachedAccountSig = useRef<string>('');
    const cachedPositionsSig = useRef<string>('');

    const accountSig = (a: any) => a ? JSON.stringify(a) : '';
    const positionsSig = (ps: any[]) => ps.map(p => `${p.id}-${p.volume}-${p.sl}-${p.tp}-${p.currentPrice}-${p.unrealizedPnL}`).join('|');

    // Coalesce bursts while leaving room in the quote-to-screen latency budget.
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
            const remaining = 50 - (now - lastFired);
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

    const [activeTab, setActiveTab] = useState<TabType>(() => getRequestedBottomDockTab() ?? 'Trade');
    const [historyMounted, setHistoryMounted] = useState(activeTab === 'History');
    const historyAccountId = useAppStore(state => state.accountId);
    const isTradeSurfaceLive = activeTab === 'Trade';
    const isExposureSurfaceLive = activeTab === 'Exposure';

    const [isResizing, setIsResizing] = useState(false);

    const handleTradeClosePosition = useCallback((id: number, volume?: number) => {
        onClosePosition(id, volume);
    }, [onClosePosition]);

    const handleTradeCloseBulk = useCallback((type: 'ALL' | 'WINNERS' | 'LOSERS', symbol?: string) => {
        onCloseBulk?.(type, symbol);
    }, [onCloseBulk]);

    // Helpers
    const formatMoney = useCallback((val: number | undefined | null) => {
        const v = val ?? 0;
        if (isNaN(v)) return '0.00';
        // MT5 style uses spaces instead of commas for large numbers
        const parts = v.toFixed(2).split('.');
        parts[0] = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, " ");
        return parts.join('.');
    }, []);

    const formatDate = useCallback((dateStr: string) => {
        try {
            return new Date(dateStr).toLocaleString('en-US', {
                year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false
            }).replace(',', '');
        } catch {
            return dateStr;
        }
    }, []);

    // Persist active tab selection
    useEffect(() => {
        localStorage.setItem('bottomdock-active-tab', activeTab);
    }, [activeTab]);

    useEffect(() => {
        if (activeTab === 'History') setHistoryMounted(true);
    }, [activeTab]);

    // Read history with the account session so the History click paints from
    // memory instead of waiting to start three requests.
    useEffect(() => {
        const prefetch = () => {
            const login = Number.parseInt(String(useAppStore.getState().accountId ?? ''), 10);
            if (!Number.isFinite(login) || login <= 0) return;
            void loadTerminalHistory(login, getCurrentBrokerAccountSessionScopeKey()).catch(() => undefined);
        };
        prefetch();
        return onCommittedBrokerAccountSessionScopeChange(() => {
            resetTerminalHistorySession();
            prefetch();
        });
    }, [historyAccountId]);

    useEffect(() => {
        const pendingTab = getRequestedBottomDockTab();
        if (pendingTab) {
            setActiveTab(pendingTab);
            acknowledgeBottomDockTab(pendingTab);
        }
        const handleOpenBottomDockTab = (event: Event) => {
            const requestedTab = (event as CustomEvent<{ tab?: TabType }>).detail?.tab;
            if (!requestedTab || !TABS.some(tab => tab.id === requestedTab) || isUnavailableDockSection(requestedTab)) return;
            setActiveTab(requestedTab);
            acknowledgeBottomDockTab(requestedTab);
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
        // MERGE: origin/main's guard is a superset of HEAD's. Routing through
        // resolveTradeAccountMetrics covers HEAD's `hasBackendEquity === false` and
        // non-finite-equity checks, and additionally rejects a stale broker-scoped
        // snapshot, so a blown-account jump can never fire on another session's equity.
        const eq = resolveTradeAccountMetrics(account).equity;
        if (eq === null) return;

        // If equity drops to 0 or below from a previously positive state, switch instantly
        if (eq <= 0 && prevEquityRef.current !== null && prevEquityRef.current > 0) {
            setActiveTab('Journal');
        }

        prevEquityRef.current = eq;
    }, [account?.equity, account?.hasBackendEquity]);

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
                <div
                    className="h-full min-h-0"
                    hidden={activeTab !== 'Toolbox'}
                    aria-hidden={activeTab !== 'Toolbox'}
                >
                    <RetainedLazyFeature active={activeTab === 'Toolbox'}><MemoToolboxTab /></RetainedLazyFeature>
                </div>
                <div
                    className="h-full min-h-0"
                    hidden={activeTab !== 'Trade'}
                    aria-hidden={activeTab !== 'Trade'}
                >
                    <TradeTab
                        positions={isTradeSurfaceLive ? toolboxTrade.positions ?? [] : HIDDEN_TAB_ROWS}
                        pendingPositions={isTradeSurfaceLive ? toolboxTrade.pendingPositions ?? [] : HIDDEN_TAB_ROWS}
                        account={isTradeSurfaceLive ? toolboxTrade.account : null}
                        onClosePosition={handleTradeClosePosition}
                        onModifyPosition={onModifyPosition}
                        onCloseBulk={handleTradeCloseBulk}
                        formatMoney={formatMoney}
                        loading={isTradeSurfaceLive ? toolboxTrade.loading : false}
                        error={isTradeSurfaceLive ? toolboxTrade.error : null}
                    />
                </div>
                <div
                    className="h-full min-h-0"
                    hidden={activeTab !== 'Exposure'}
                    aria-hidden={activeTab !== 'Exposure'}
                >
                    <RetainedLazyFeature active={activeTab === 'Exposure'}>
                        <MemoExposureTab
                            positions={isExposureSurfaceLive ? positions ?? [] : HIDDEN_TAB_ROWS}
                            formatMoney={formatMoney}
                            account={isExposureSurfaceLive ? account : null}
                        />
                    </RetainedLazyFeature>
                </div>
                <div
                    className="h-full min-h-0"
                    hidden={activeTab !== 'History'}
                    aria-hidden={activeTab !== 'History'}
                >
                    {historyMounted && (
                        <MemoHistoryTab
                            formatMoney={formatMoney}
                            instrumentCatalog={historyInstrumentCatalog}
                        />
                    )}
                </div>

                {/* Implemented Tabs from Phase 13 & 14 */}
                <div
                    className="h-full min-h-0"
                    hidden={activeTab !== 'Calendar'}
                    aria-hidden={activeTab !== 'Calendar'}
                >
                    <RetainedLazyFeature active={activeTab === 'Calendar'}><MemoCalendarTab /></RetainedLazyFeature>
                </div>
                <div
                    className="h-full min-h-0"
                    hidden={activeTab !== 'Code Base'}
                    aria-hidden={activeTab !== 'Code Base'}
                >
                    <RetainedLazyFeature active={activeTab === 'Code Base'}><MemoCodeBaseTab /></RetainedLazyFeature>
                </div>
                <div
                    className="h-full min-h-0"
                    hidden={activeTab !== 'Articles'}
                    aria-hidden={activeTab !== 'Articles'}
                >
                    <RetainedLazyFeature active={activeTab === 'Articles'}><MemoArticlesTab /></RetainedLazyFeature>
                </div>
                <div
                    className="h-full min-h-0"
                    hidden={activeTab !== 'Experts'}
                    aria-hidden={activeTab !== 'Experts'}
                >
                    <RetainedLazyFeature active={activeTab === 'Experts'}><MemoExpertsTab /></RetainedLazyFeature>
                </div>
                <div
                    className="h-full min-h-0"
                    hidden={activeTab !== 'Journal'}
                    aria-hidden={activeTab !== 'Journal'}
                >
                    {activeTab === 'Journal' && <Suspense fallback={null}><MemoJournalTab /></Suspense>}
                </div>
                {activeTab === 'Historical Data' && (
                    <Suspense fallback={<div className="flex h-full items-center justify-center text-xs text-zinc-500">{tr("Opening historical data…")}</div>}>
                        <LazyHistoryDownloader />
                    </Suspense>
                )}

                {/* Placeholder Tabs */}
                {['News', 'Company', 'Mailbox', 'Alerts'].includes(activeTab) && (
                    <PlaceholderTab title={activeTab} />
                )}
            </div>

            {/* Bottom Tabs */}
            <div className="rtx-bottom-dock__tabs relative flex h-[30px] min-h-[30px] max-h-[30px] flex-nowrap items-stretch overflow-hidden bg-[#080c18] border-t border-zinc-700/80 select-none p-0">
                <div className="rtx-dock-tab-scroller flex h-full min-w-0 flex-nowrap items-stretch overflow-x-auto overflow-y-hidden">
                    {TABS.map((tab) => {
                        const unavailableReason = tab.locked && isUnavailableDockSection(tab.id)
                            ? unavailableDockSections[tab.id]
                            : undefined;
                        return (
                            <button
                                key={tab.id}
                                type="button"
                                disabled={Boolean(unavailableReason)}
                                aria-disabled={unavailableReason ? true : undefined}
                                title={tr(unavailableReason || TAB_HOVER_COMMENTS[tab.id])}
                                aria-label={unavailableReason ? tr(tab.id) : tr(TAB_HOVER_COMMENTS[tab.id])}
                                aria-description={tr(unavailableReason || TAB_HOVER_COMMENTS[tab.id])}
                                onClick={() => {
                                    if (unavailableReason) return;
                                    setActiveTab(tab.id);
                                }}
                                className={`rtx-dock-tab inline-flex h-full items-center justify-center gap-1 px-4 text-[12px] font-normal leading-none whitespace-nowrap rounded-none border-r border-zinc-800 border-t transition-colors duration-75 relative
                        ${unavailableReason ? 'rtx-dock-tab--locked cursor-not-allowed' : ''}
                        ${activeTab === tab.id
                                    ? 'active-tab'
                                    : 'border-t-transparent'}`}
                            >
                                {tr(tab.id)}
                                {unavailableReason ? (
                                    <span className="inline-flex shrink-0" aria-hidden="true"><Icon name="lock" size="xs" /></span>
                                ) : null}
                            </button>
                        );
                    })}
                </div>
                <div className="rtx-dock-tab-actions rtx-bulk-close-group flex h-full shrink-0 flex-nowrap items-stretch">
                    <button
                        type="button"
                        title={tr("Close all in-profit positions")}
                        aria-label={tr("Close In-Profit")}
                        onClick={() => handleTradeCloseBulk('WINNERS')}
                        disabled={!onCloseBulk || bulkCloseCounts.profitable === 0}
                        className="rtx-dock-tab rtx-trade-bulk-close rtx-bulk-close rtx-bulk-close--winners inline-flex h-full items-center justify-center px-4 text-[12px] font-normal leading-none whitespace-nowrap rounded-none border-r border-zinc-800 border-t border-t-transparent transition-colors duration-75 relative disabled:cursor-not-allowed"
                    >
                        <span className="rtx-bulk-close__label">{tr("Close In-Profit")}</span>
                    </button>
                    <button
                        type="button"
                        title={tr("Close all in-loss positions")}
                        aria-label={tr("Close In-Loss")}
                        onClick={() => handleTradeCloseBulk('LOSERS')}
                        disabled={!onCloseBulk || bulkCloseCounts.losing === 0}
                        className="rtx-dock-tab rtx-trade-bulk-close rtx-bulk-close rtx-bulk-close--losers inline-flex h-full items-center justify-center px-4 text-[12px] font-normal leading-none whitespace-nowrap rounded-none border-r border-zinc-800 border-t border-t-transparent transition-colors duration-75 relative disabled:cursor-not-allowed"
                    >
                        <span className="rtx-bulk-close__label">{tr("Close In-Loss")}</span>
                    </button>
                    <button
                        type="button"
                        title={tr("Close all open positions")}
                        aria-label={tr("Close All")}
                        onClick={() => handleTradeCloseBulk('ALL')}
                        disabled={!onCloseBulk || bulkCloseCounts.all === 0}
                        className="rtx-dock-tab rtx-trade-bulk-close rtx-bulk-close rtx-bulk-close--all inline-flex h-full items-center justify-center px-4 text-[12px] font-normal leading-none whitespace-nowrap rounded-none border-r border-zinc-800 border-t border-t-transparent transition-colors duration-75 relative disabled:cursor-not-allowed"
                    >
                        <span className="rtx-bulk-close__label">{tr("Close All")}</span>
                    </button>
                </div>
            </div>
        </div>
    );
}

// --- TAB COMPONENTS ---

export function ToolboxTab() {
    const tr = useUiTranslation();
    const tools: Array<{
        category: string;
        items: Array<{
            name: string;
            shortcutId?: Parameters<typeof runTerminalShortcutAction>[0];
            icon: string;
            disabled?: boolean;
            unavailableReason?: string;
        }>;
    }> = [
        {
            category: 'Trading',
            items: [
                { name: 'New Order', shortcutId: 'tools.new-order', icon: 'plus' },
                { name: 'Depth of Market', shortcutId: 'view.depth-of-market', icon: 'box' },
                { name: 'One Click Trading', shortcutId: 'trading.toggle-one-click', icon: 'mouse-pointer' },
                { name: 'Order History', shortcutId: 'trading.order-history', icon: 'history' },
            ]
        },
        {
            category: 'View',
            items: [
                { name: 'Market Watch', shortcutId: 'view.market-watch', icon: 'monitor' },
                { name: 'Data Window', shortcutId: 'view.data-window', icon: 'database' },
                { name: 'Navigator', shortcutId: 'view.navigator', icon: 'compass' },
                { name: 'Terminal', shortcutId: 'view.terminal', icon: 'terminal' },
                { name: 'Strategy Tester', icon: 'activity', ...lockedTerminalTool('strategyTester') },
                { name: 'Toolbox', shortcutId: 'view.toolbox', icon: 'tool' },
            ]
        },
        {
            category: 'Charts',
            items: [
                { name: 'Bar Chart', shortcutId: 'charts.bar-chart', icon: 'bar-chart' },
                { name: 'Candlesticks', shortcutId: 'charts.candlestick', icon: 'candlestick' },
                { name: 'Line Chart', shortcutId: 'charts.line-chart', icon: 'line-chart' },
                { name: 'Area Chart', shortcutId: 'charts.area-chart', icon: 'area-chart' },
                { name: 'Indicators', shortcutId: 'charts.indicator-list', icon: 'line-chart' },
                { name: 'Objects', shortcutId: 'charts.object-list', icon: 'square' },
            ]
        },
        {
            category: 'Tools',
            items: [
                { name: 'History Center', shortcutId: 'tools.history-center', icon: 'database' },
                { name: 'Global Variables', icon: 'globe', ...lockedTerminalTool('globalVariables') },
                { name: 'MetaEditor', icon: 'code', ...lockedTerminalTool('scriptEditor') },
                { name: 'Options', shortcutId: 'tools.options', icon: 'settings' },
            ]
        },
        {
            category: 'Window',
            items: [
                { name: 'Tile Windows', shortcutId: 'window.tile', icon: 'grid' },
                { name: 'Cascade', shortcutId: 'window.cascade', icon: 'layers' },
                { name: 'Tile Horizontally', shortcutId: 'window.tile-horizontal', icon: 'layout' },
                { name: 'Tile Vertically', shortcutId: 'window.tile-vertical', icon: 'layout' },
            ]
        },
        {
            category: 'Help',
            items: [
                { name: 'Help Topics', shortcutId: 'help.shortcuts', icon: 'help-circle' },
                { name: 'Documentation', icon: 'book-open', disabled: true, unavailableReason: 'Documentation is not configured for this deployment' },
                { name: 'Market', icon: 'trending-up', ...lockedTerminalTool('marketplace') },
                { name: 'Signals', icon: 'signal', ...lockedTerminalTool('signalsHub') },
            ]
        },
    ];

    return (
        <div className="h-full w-full overflow-auto bg-[#131316] p-2 sm:p-4">
            <div className="grid gap-3 min-w-0" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 240px), 1fr))' }}>
                {tools.map((section) => (
                    <div key={section.category} className="space-y-2 min-w-0">
                        <h3 className="text-[12px] font-normal text-zinc-400 uppercase tracking-wider border-b border-zinc-700 pb-1 mb-2 truncate">
                            {tr(section.category)}
                        </h3>
                        <div className="space-y-1">
                            {section.items.map((item) => (
                                <button
                                    key={item.name}
                                    disabled={item.disabled}
                                    aria-disabled={item.disabled || undefined}
                                    aria-description={tr(item.unavailableReason)}
                                    className={`w-full flex items-center justify-between px-2 py-1.5 text-[14px] font-normal rounded transition-colors text-left min-w-0 ${item.disabled ? 'text-zinc-400 cursor-not-allowed' : 'text-zinc-300 hover:bg-zinc-700/50 group'}`}
                                    onClick={() => {
                                        if (!item.disabled && item.shortcutId) runTerminalShortcutAction(item.shortcutId);
                                    }}
                                    title={tr(item.unavailableReason || item.name)}
                                >
                                    <span className="flex items-center gap-2 min-w-0 overflow-hidden">
                                        <Icon name={item.icon as any} size="xs" className="text-zinc-500 group-hover:text-zinc-300 flex-shrink-0" />
                                        <span className="group-hover:text-white truncate">{tr(item.name)}</span>
                                    </span>
                                    {item.disabled ? (
                                        <span className="ml-2 flex-shrink-0" aria-hidden="true"><Icon name="lock" size="xs" /></span>
                                    ) : item.shortcutId && getTerminalShortcutHint(item.shortcutId) && (
                                        <span className="text-[12px] font-normal text-zinc-600 font-mono flex-shrink-0 ml-2">{getTerminalShortcutHint(item.shortcutId)}</span>
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

function BlinkingText({
    value,
    formatFn,
    prefix = '',
    suffix = '',
    defaultColor = 'text-zinc-100',
    flashDirection = true,
}: any) {
    const [changeColor, setChangeColor] = useState<string | null>(null);
    const previousValueRef = useRef<number | null>(null);
    const clearTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const numericValue = Number(value);

    useEffect(() => {
        if (!Number.isFinite(numericValue)) return;

        const previousValue = previousValueRef.current;
        if (flashDirection && previousValue !== null && numericValue !== previousValue) {
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
    }, [flashDirection, numericValue]);

    return (
        <span className={`${flashDirection ? (changeColor ?? defaultColor) : defaultColor} px-0.5 rounded-sm inline-block transition-colors duration-150`}>
            {prefix}{formatFn ? formatFn(value) : value}{suffix}
        </span>
    );
}

// Placeholder for an account metric the backend did not report. Rendering a dash keeps the
// footer honest: the terminal has no authoritative value and refuses to invent one.
function UnavailableMetric({ title = 'Not reported by the trading server' }: { title?: string }) {
    const tr = useUiTranslation();
    return (
        <span className="px-0.5 rounded-sm inline-block text-zinc-500" title={tr(title)}>
            {METRIC_UNAVAILABLE}
        </span>
    );
}

// Pass only displayed data and actions. Transport timestamps/status otherwise
// defeat memo() and repaint the entire table when no trade values changed.
const TradeTab = memo(function TradeTab({
    positions,
    pendingPositions = [],
    account,
    onClosePosition,
    onModifyPosition,
    onCloseBulk,
    formatMoney,
    loading,
    error,
}: any) {
    const tr = useUiTranslation();
    const accountId = useAppStore(s => s.accountId);
    const [modifyPositionContext, setModifyPositionContext] = useState<ModifyPositionContext | null>(null);
    const modifyPosition = modifyPositionContext?.position ?? null;
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
    const footerMetricButtonRef = useRef<HTMLButtonElement | null>(null);
    const columnResizeRef = useRef<{ key: TradeColumnWidthKey; startX: number; startWidth: number } | null>(null);

    // Local trade overrides: track modified fields since the Gateway API can lag after modification.
    const [tradeOverrides, setTradeOverrides] = useState<Record<number, { sl: number; tp: number; comment?: string }>>({});

    const openModifyPosition = useCallback((position: any) => {
        setModifyPositionContext({
            position,
            sessionScope: getCurrentBrokerAccountSessionScopeKey(),
        });
    }, []);

    // Position and placement updates arrive directly from useToolboxTradeData;
    // quote ticks do not subscribe this table or delay confirmed trade changes.

    useEffect(() => {
        const handleTradeModified = (event: Event) => {
            const detail = (event as CustomEvent<TradeModifiedEventDetail>).detail;
            const id = Number(detail?.id);
            const symbol = normalizeTradeSymbol(detail?.symbol);
            const sl = Number(detail?.sl);
            const tp = Number(detail?.tp);
            const comment = typeof detail?.comment === 'string' ? detail.comment : undefined;
            const sessionScope = String(detail?.sessionScope ?? '');
            if (
                !Number.isSafeInteger(id)
                || id <= 0
                || !symbol
                || !Number.isFinite(sl)
                || !Number.isFinite(tp)
                || sessionScope !== getCurrentBrokerAccountSessionScopeKey()
            ) return;

            const existingPosition = useAppStore.getState().positions.find(position => (
                position.id === id
                && normalizeTradeSymbol(position.symbol) === symbol
            ));
            if (!existingPosition) return;
            rememberTradeHistoryPositionLevels([
                { ...existingPosition, id, sl, tp, price_sl: sl, price_tp: tp },
            ], useAppStore.getState().accountId);
            setTradeOverrides(prev => ({
                ...prev,
                [id]: { sl, tp, comment: comment ?? prev[id]?.comment },
            }));
        };
        window.addEventListener('rtx:trade-modified', handleTradeModified);
        return () => window.removeEventListener('rtx:trade-modified', handleTradeModified);
    }, []);

    useEffect(() => onCommittedBrokerAccountSessionScopeChange(() => {
        setModifyPositionContext(null);
        setTradeOverrides({});
        setSelectedPositionKey(null);
        setTradeContextMenu(null);
    }), []);

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

    const [isLightSkin, setIsLightSkin] = useState(false);
    useEffect(() => {
        const root = document.documentElement;
        const check = () => setIsLightSkin(root.classList.contains('rtx-skin-untitled-light'));
        check();
        const obs = new MutationObserver(check);
        obs.observe(root, { attributes: true, attributeFilter: ['class'] });
        return () => obs.disconnect();
    }, []);

    // Display backend prices and P/L, with pending SL/TP edits from local overrides.
    const livePositions = useMemo(() => {
        return positions.map((pos: any) => {
            const symbol = pos?.symbol ?? '';
            const openPrice = Number(
                pos?.price_open ?? pos?.open_price ?? pos?.openPrice ?? pos?.entryPrice ?? pos?.chartEntryPrice ?? pos?.price ?? 0
            );
            const livePrice = pos.hasBackendCurrentPrice === false
                ? null
                : toBackendFinancialNumber(pos?.price_current ?? pos?.current_price ?? pos?.currentPrice);

            const openTime = pos?.time_create ?? pos?.openTime ?? pos?.open_time ?? pos?.time ?? pos?.chartEntryTime;
            const volume = Number(pos?.volume_lots ?? pos?.volume ?? pos?.quantity ?? 0);

            // MERGE: HEAD's single-argument call. origin/main additionally threaded the
            // live prices and `{ accountCurrency }` into the resolver, but both branches
            // stripped the local-estimate paths out of resolveTradeProfit, so those inputs
            // no longer influence the result. `profitResolution.value` is null exactly when
            // `source !== 'backend'`, which is origin/main's livePnL derivation.
            const profitResolution = resolveTradeProfit(pos);
            const livePnL = profitResolution.value;

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
                price_open: openPrice,
                open_price: openPrice,
                currentPrice: livePrice,
                price_current: livePrice,
                current_price: livePrice,
                openTime,
                time_create: openTime,
                open_time: openTime,
                sl: Number(sl ?? 0),
                tp: Number(tp ?? 0),
                price_sl: Number(sl ?? 0),
                price_tp: Number(tp ?? 0),
                comment,
                profit: livePnL,
                unrealizedPnL: livePnL ?? pos?.unrealizedPnL,
                livePrice,
                livePnL,
                hasBackendProfit: profitResolution.source === 'backend',
                profitSource: profitResolution.source,
                profitWarnings: profitResolution.warnings,
            };
        });
    }, [positions, tradeOverrides]);

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

    // MERGE (union): Row-level totals. These drive the per-tile Floating P/L, Swap and
    // Commission displays only - they must never feed the account metrics, which are
    // backend-authoritative.
    const totalSwap = useMemo(() => livePositions.reduce((acc, pos) => acc + (Number(pos.swap) || 0), 0), [livePositions]);
    const totalCommission = useMemo(() => livePositions.reduce((acc, pos) => acc + (Number(pos.commission) || 0), 0), [livePositions]);
    // Equity / free margin / margin level come from the backend. When the backend omits one
    // it resolves to null and the footer renders a dash, not a zero. A quiet account keeps its
    // last published figures; the 1s clock only re-checks future-dated snapshots.
    const [metricsNow, setMetricsNow] = useState(Date.now);
    useEffect(() => {
        const timer = window.setInterval(() => setMetricsNow(Date.now()), 1000);
        return () => window.clearInterval(timer);
    }, []);
    // Every account total comes from the backend, including floating P/L, and follows
    // the live position profit stream between backend snapshots.
    const accountMetricResolution = useLiveAccountMetrics(account, livePositions, metricsNow);
    useEffect(() => {
        if (!account?.publicationToken) return;
        let nextFrame = 0;
        const frame = window.requestAnimationFrame(() => {
            nextFrame = window.requestAnimationFrame(() => {
                window.dispatchEvent(new CustomEvent('rtx:account-metrics-rendered', {
                    detail: { publication_token: account.publicationToken, rendered_at: performance.now() },
                }));
            });
        });
        return () => { window.cancelAnimationFrame(frame); window.cancelAnimationFrame(nextFrame); };
    }, [account?.publicationToken, account?.metricsScope]);
    const floatingPnL = accountMetricResolution.floatingPnL;
    // Kept nullable (HEAD) rather than `floatingPnL ?? 0` (origin/main) so the footer can
    // distinguish "backend reported 0" from "backend reported nothing" and render the
    // placeholder instead of a misleading zero.
    const totalLivePnL = floatingPnL;
    const floatingProfitColor = totalLivePnL !== null && totalLivePnL > 0
        ? 'text-[#22c55e]'
        : totalLivePnL !== null && totalLivePnL < 0 ? 'text-[#ff2d2d]' : 'text-zinc-100';
    const floatingProfitLabel = totalLivePnL === null ? METRIC_UNAVAILABLE : formatMoney(totalLivePnL);
    const accountBalance = accountMetricResolution.balance;
    const liveEquity = accountMetricResolution.equity;
    const margin = accountMetricResolution.margin;
    const liveFreeMargin = accountMetricResolution.freeMargin;
    const liveMarginLevel = accountMetricResolution.marginLevel;

    const formatMarginLevel = (value: number | null) => {
        if (value === null) return METRIC_UNAVAILABLE;
        if (value === 0 && margin === 0) return '\u221e';
        return `${value.toFixed(2)}%`;
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
                return getTradeTimeValue(pos.time_create ?? pos.openTime ?? pos.open_time ?? pos.time);
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
                return accountBalance === null ? <UnavailableMetric /> : <BlinkingText value={accountBalance} formatFn={formatMoney} />;
            case 'equity':
                return liveEquity === null
                    ? <UnavailableMetric />
                    : <BlinkingText value={liveEquity} formatFn={formatMoney} />;
            case 'margin':
                return margin === null ? <UnavailableMetric /> : <BlinkingText value={margin} formatFn={formatMoney} />;
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
                value = accountBalance === null ? METRIC_UNAVAILABLE : `${formatMoney(accountBalance)} ${account?.currency || 'USD'}`;
                break;
            case 'equity':
                value = liveEquity === null ? METRIC_UNAVAILABLE : formatMoney(liveEquity);
                break;
            case 'margin':
                value = margin === null ? METRIC_UNAVAILABLE : formatMoney(margin);
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
        return `${tr(TRADE_FOOTER_METRIC_COMMENTS[key])}: ${value}`;
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
    const footerProfitColumnWidth = `${(columnWidths.profit / visibleTradeTableWidth) * 100}%`;
    const footerCloseColumnWidth = `${(columnWidths.close / visibleTradeTableWidth) * 100}%`;

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
        const openPrice = Number(pos.price_open ?? pos.open_price ?? pos.openPrice ?? pos.entryPrice ?? pos.price);
        const currentPrice = Number(pos.price_current ?? pos.current_price ?? pos.currentPrice ?? pos.livePrice);
        if (pos.hasBackendCurrentPrice === false || !Number.isFinite(openPrice) || !Number.isFinite(currentPrice) || openPrice <= 0 || currentPrice <= 0) return null;
        const pointSize = Math.pow(10, -getSymbolDigits(pos.symbol ?? ''));
        const direction = String(pos.side).toUpperCase() === 'BUY' ? 1 : -1;
        const points = ((currentPrice - openPrice) / pointSize) * direction;
        return Number.isFinite(points) ? points : null;
    }, []);

    const formatTradePoints = useCallback((pos: ToolboxTradePosition) => {
        const points = getTradePointsValue(pos);
        if (points === null) return METRIC_UNAVAILABLE;
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
        if (isColumnVisible('time')) columns.push({ label: 'Time', value: pos => formatTradeTime(pos.time_create ?? pos.openTime ?? pos.open_time ?? pos.time) });
        if (isColumnVisible('side')) columns.push({ label: 'Type', value: pos => String(pos.side ?? '').toLowerCase() || '-' });
        if (isColumnVisible('volume')) columns.push({ label: 'Volume', value: pos => formatTradeVolume(pos) });
        if (isColumnVisible('priceOpen')) columns.push({ label: 'Price Open', value: pos => formatTradePrice(pos.price_open ?? pos.open_price ?? pos.openPrice, pos.symbol ?? '') });
        if (isColumnVisible('sl')) columns.push({ label: 'S / L', value: pos => formatTradeLevel(pos.price_sl ?? pos.sl, pos.symbol ?? '') });
        if (isColumnVisible('tp')) columns.push({ label: 'T / P', value: pos => formatTradeLevel(pos.price_tp ?? pos.tp, pos.symbol ?? '') });
        if (isColumnVisible('priceCurrent')) columns.push({ label: 'Current Price', value: pos => formatTradePrice(pos.price_current ?? pos.current_price ?? pos.currentPrice ?? pos.livePrice, pos.symbol ?? '') });
        if (isColumnVisible('swap')) columns.push({ label: 'Swap', value: pos => formatMoney(pos.swap) });
        if (isColumnVisible('accountLogin')) columns.push({ label: 'Account Login', value: pos => pos.account_login ?? '-' });
        if (isColumnVisible('timeUpdate')) columns.push({ label: 'Time Update', value: pos => formatTradeTime(pos.time_update) });
        if (isColumnVisible('comment')) columns.push({ label: 'Comment', value: pos => pos.comment || '-' });
        if (isColumnVisible('profit')) {
            columns.push({
                label: profitMode === 'points' ? 'Profit Points' : 'Profit',
                value: pos => profitMode === 'points'
                    ? formatTradePoints(pos)
                    // MERGE: HEAD's self-contained form. origin/main read the memoized
                    // `pos.profitSource` / `pos.profit` instead; both yield the same output
                    // because livePositions stores `profit: livePnL` (null when unavailable)
                    // alongside `profitSource`. Resolving here keeps the report correct for
                    // any row shape and does not depend on `profitSource` being declared on
                    // ToolboxTradePosition.
                    : resolveTradeProfit(pos).value === null ? METRIC_UNAVAILABLE : formatMoney(resolveTradeProfit(pos).value),
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
                action: () => openModifyPosition(position),
            },
            { divider: true },
            {
                label: 'Bulk Operations',
                submenu: [
                    { label: 'Close All', action: () => onCloseBulk?.('ALL') },
                    { label: 'Close In-Profit', action: () => onCloseBulk?.('WINNERS') },
                    { label: 'Close In-Loss', action: () => onCloseBulk?.('LOSERS') },
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
            aria-label={tr("Resize {{value0}} column", { value0: tr(getTradeColumnDef(key).label) })}
            title={tr("Resize {{value0}} column", { value0: tr(getTradeColumnDef(key).label) })}
            tabIndex={-1}
            className={`absolute right-0 top-0 z-20 h-full w-[5px] translate-x-1/2 cursor-default border-0 bg-transparent p-0 ${resizingColumn === key ? 'bg-sky-400/70' : 'hover:bg-sky-400/50'}`}
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
            key={key}
            className="relative px-1.5 py-[3px] text-center border-r border-zinc-700/70"
            style={{ width: columnWidths[key] }}
            title={tr(TRADE_COLUMN_HOVER_COMMENTS[key])}
            aria-sort={sortState?.column === sortColumn ? (sortState.direction === 'asc' ? 'ascending' : 'descending') : 'none'}
        >
            <button
                type="button"
                title={tr("Sort by {{value0}}", { value0: tr(label) })}
                onClick={() => toggleSort(sortColumn)}
                className="relative flex w-full cursor-default items-center justify-center px-2 text-center hover:text-white"
            >
                <span>{tr(label)}</span>
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
                title={tr(TRADE_COLUMN_HOVER_COMMENTS[column.key])}
            >
                <span className="block px-2">{tr(column.label)}</span>
                {renderColumnResizeHandle(column.key)}
            </th>
        );
    };

    return (
        <div className="rtx-trade-tab h-full cursor-default flex flex-col relative bg-[#131316] overflow-hidden">
            <div className="rtx-trade-scroll flex-1 overflow-auto scrollbar-thin scrollbar-thumb-zinc-700">
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
                            <th className="px-0.5 py-[3px] text-center" style={{ width: columnWidths.close }} aria-label={tr("Close position")} title={tr(TRADE_COLUMN_HOVER_COMMENTS.close)}></th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-zinc-800/90 text-[#d8dde8] text-[13px] leading-[19.5px] font-normal">
                        {displayedLivePositions.length === 0 && (loading || error) && (
                            <tr>
                                <td colSpan={visibleOptionalColumnCount + 2} className="h-16 text-center text-zinc-600 text-xs italic">
                                    {loading ? tr("Loading open positions...") : error}
                                </td>
                            </tr>
                        )}
                        {displayedLivePositions.map((pos: ToolboxTradePosition, i: number) => {
                            const placementState = pos.placementState;
                            const isPendingPlacement = Boolean(
                                placementState
                                && !['filled', 'confirmed'].includes(placementState),
                            );
                            const isTerminalPlacementFailure = placementState === 'rejected' || placementState === 'expired';
                            const isBuy = String(pos.side).toUpperCase() === 'BUY';
                            // MERGE (union): HEAD's derivation plus origin/main's null-safe
                            // points check. `resolveTradeProfit(pos).value` equals
                            // origin/main's `pos.profitSource === 'backend' ? pos.profit : null`
                            // (and also honours the `unrealized_pl` alias and Money payloads).
                            // `profitIsAvailable` is HEAD's and is required by the profit cell
                            // below; origin/main's `pointsValue >= 0` treated a null points
                            // value as positive, which HEAD's `pointsValue !== null &&` fixes.
                            const pnlValue = resolveTradeProfit(pos).value;
                            const pointsValue = getTradePointsValue(pos);
                            const profitIsPositive = profitMode === 'points' ? pointsValue !== null && pointsValue >= 0 : pnlValue !== null && pnlValue >= 0;
                            const profitIsAvailable = profitMode === 'points' ? pointsValue !== null : pnlValue !== null;
                            const positionKey = getPositionKey(pos);
                            const isSelected = selectedPositionKey === positionKey;
                            const symbolLabel = pos.symbol ?? '-';
                            const ticketLabel = isPendingPlacement ? '-' : String(pos.ticket ?? pos.id ?? '-');
                            const openTime = pos.time_create ?? pos.openTime ?? pos.open_time ?? pos.time_open ?? pos.time ?? pos.chartEntryTime;
                            const timeLabel = formatTradeTime(openTime);
                            const sideLabel = String(pos.side ?? '').toLowerCase() || '-';
                            const volumeLabel = String(formatTradeVolume(pos));
                            const rawOpenPrice = Number(pos.price_open ?? pos.open_price ?? pos.openPrice ?? pos.entryPrice ?? pos.chartEntryPrice ?? pos.price);
                            const openPriceLabel = isPendingPlacement
                                ? '…'
                                : formatTradePrice(rawOpenPrice, symbolLabel);
                            const slLabel = formatTradeLevel(pos.price_sl ?? pos.sl, symbolLabel);
                            const tpLabel = formatTradeLevel(pos.price_tp ?? pos.tp, symbolLabel);
                            const rawCurrentPrice = pos.hasBackendCurrentPrice === false
                                ? null
                                : toBackendFinancialNumber(pos.price_current ?? pos.current_price ?? pos.currentPrice);
                            const currentPriceLabel = isPendingPlacement
                                ? '…'
                                : rawCurrentPrice === null ? METRIC_UNAVAILABLE : formatTradePrice(rawCurrentPrice, symbolLabel);
                            const swapLabel = formatMoney(pos.swap);
                            const accountLoginLabel = String(pos.account_login ?? '-');
                            const timeUpdateLabel = formatTradeTime(pos.time_update);
                            const placementError = [pos.placementErrorCode, pos.placementErrorMessage].filter(Boolean).join(': ');
                            const commentLabel = String(placementError || pos.comment || '-');
                            const profitLabel = isPendingPlacement
                                ? '…'
                                // MERGE: origin/main's NaN guard is a strict superset of
                                // HEAD's null check - keep it.
                                : profitMode === 'points'
                                    ? formatTradePoints(pos)
                                    : pnlValue === null || Number.isNaN(pnlValue)
                                        ? METRIC_UNAVAILABLE
                                        : formatPositionProfit(pnlValue);
                            const rowSummary = [
                                symbolLabel,
                                tr(sideLabel),
                                tr('{{value0}} lots', { value0: volumeLabel }),
                            ].join(' · ');
                            const rowComment = isPendingPlacement
                                ? `${rowSummary}${isTerminalPlacementFailure ? `: ${placementError || tr('Order failed')}` : ''}`
                                : `${rowSummary}\n${tr('Ticket: {{value0}}', { value0: ticketLabel })}\n${tr('Modify Position')} · ${tr('Context menu')}`;
                            return (
                                <tr
                                    key={pos.id ?? i}
                                    title={rowComment}
                                    aria-selected={isSelected}
                                    className={`rtx-trade-row h-[30px] ${isSelected ? 'rtx-trade-row--selected' : ''} transition-colors group cursor-default`}
                                    onClick={() => {
                                        if (!isPendingPlacement) setSelectedPositionKey(positionKey);
                                    }}
                                    onDoubleClick={() => {
                                        if (isPendingPlacement) return;
                                        setSelectedPositionKey(positionKey);
                                        openModifyPosition(pos);
                                    }}
                                    onContextMenu={(event) => {
                                        if (isPendingPlacement) return;
                                        handleTradeContextMenu(event, pos);
                                    }}
                                >
                                    {/* symbol */}
                                    <td className="px-1.5 py-[2px] border-r border-zinc-800 text-center font-normal text-zinc-100 whitespace-nowrap" title={tr("Symbol: {{value0}}", { value0: symbolLabel })}>
                                        <span>{symbolLabel}</span>
                                    </td>

                                    {/* ticket */}
                                    {isColumnVisible('ticket') && (
                                        <td className="px-1.5 py-[2px] border-r border-zinc-800 text-center text-zinc-100 font-normal tabular-nums whitespace-nowrap" title={tr("Ticket: {{value0}}", { value0: ticketLabel })}>{ticketLabel}</td>
                                    )}

                                    {/* time_create */}
                                    {isColumnVisible('time') && (
                                        <td className="px-1.5 py-[2px] border-r border-zinc-800 text-center text-zinc-100 whitespace-nowrap" title={tr("Open time: {{value0}}", { value0: timeLabel })}>
                                            {timeLabel}
                                        </td>
                                    )}

                                    {/* side */}
                                    {isColumnVisible('side') && (
                                        <td className={`rtx-trade-side-cell ${isBuy ? 'rtx-trade-side-cell--buy text-[#45bff7]' : 'rtx-trade-side-cell--sell text-[#ff2d2d]'} px-1.5 py-[2px] border-r border-zinc-800 text-center font-normal text-[13px]`} title={tr("Type: {{value0}}", { value0: tr(sideLabel) })}>
                                            <div className="flex items-center justify-center">
                                                <span>{tr(sideLabel)}</span>
                                            </div>
                                        </td>
                                    )}

                                    {/* volume */}
                                    {isColumnVisible('volume') && (
                                        <td className="px-1.5 py-[2px] border-r border-zinc-800 text-center font-normal text-zinc-100 tabular-nums" title={tr("Volume: {{value0}} lots", { value0: volumeLabel })}>
                                            {volumeLabel}
                                        </td>
                                    )}

                                    {/* price_open */}
                                    {isColumnVisible('priceOpen') && (
                                        <td className="px-1.5 py-[2px] border-r border-zinc-800 text-center text-zinc-100 tabular-nums" title={tr("Open price: {{value0}}", { value0: openPriceLabel })}>
                                            {openPriceLabel}
                                        </td>
                                    )}

                                    {/* price_sl */}
                                    {isColumnVisible('sl') && (
                                        <td
                                            className="rtx-trade-sl-cell px-0 py-[2px] border-r border-zinc-800 text-center tabular-nums"
                                            title={`${tr("Stop Loss: {{value0}}", { value0: slLabel })} · ${tr("Modify Position")}`}
                                            onClick={(event) => {
                                                event.stopPropagation();
                                                if (isPendingPlacement) return;
                                                setSelectedPositionKey(positionKey);
                                                // Keyboard activation (detail 0) keeps dialog access without a mouse.
                                                if (event.detail === 0) openModifyPosition(pos);
                                            }}
                                            onDoubleClick={(event) => {
                                                event.stopPropagation();
                                                if (isPendingPlacement) return;
                                                setSelectedPositionKey(positionKey);
                                                openModifyPosition(pos);
                                            }}
                                        >
                                            <button
                                                type="button"
                                                className={`rtx-trade-sl-value w-full cursor-pointer bg-transparent px-1 text-center font-normal ${
                                                    (pos.price_sl ?? pos.sl) > 0 ? 'text-[#ff7676]' : 'text-zinc-100'
                                                }`}
                                                disabled={isPendingPlacement}
                                                aria-label={`${tr("Modify Position")} · ${tr("Stop Loss:")} #${pos.id}`}
                                            >
                                                {slLabel}
                                            </button>
                                        </td>
                                    )}

                                    {/* price_tp */}
                                    {isColumnVisible('tp') && (
                                        <td
                                            className="rtx-trade-tp-cell px-0 py-[2px] border-r border-zinc-800 text-center tabular-nums"
                                            title={`${tr("Take Profit: {{value0}}", { value0: tpLabel })} · ${tr("Modify Position")}`}
                                            onClick={(event) => {
                                                event.stopPropagation();
                                                if (isPendingPlacement) return;
                                                setSelectedPositionKey(positionKey);
                                                // Keyboard activation (detail 0) keeps dialog access without a mouse.
                                                if (event.detail === 0) openModifyPosition(pos);
                                            }}
                                            onDoubleClick={(event) => {
                                                event.stopPropagation();
                                                if (isPendingPlacement) return;
                                                setSelectedPositionKey(positionKey);
                                                openModifyPosition(pos);
                                            }}
                                        >
                                            <button
                                                type="button"
                                                className={`rtx-trade-tp-value w-full cursor-pointer bg-transparent px-1 text-center font-normal ${
                                                    (pos.price_tp ?? pos.tp) > 0 ? 'text-[#34dca0]' : 'text-zinc-100'
                                                }`}
                                                disabled={isPendingPlacement}
                                                aria-label={`${tr("Modify Position")} · ${tr("Take Profit:")} #${pos.id}`}
                                            >
                                                {tpLabel}
                                            </button>
                                        </td>
                                    )}

                                    {/* price_current */}
                                    {isColumnVisible('priceCurrent') && (
                                        <td className="px-1.5 py-[2px] border-r border-zinc-800 text-center text-zinc-100 font-normal tabular-nums" title={tr("Current price: {{value0}}", { value0: currentPriceLabel })}>
                                            {currentPriceLabel}
                                        </td>
                                    )}

                                    {/* swap */}
                                    {isColumnVisible('swap') && (
                                        <td className="px-1.5 py-[2px] border-r border-zinc-800 text-center text-zinc-100 tabular-nums" title={tr("Swap: {{value0}}", { value0: swapLabel })}>{swapLabel}</td>
                                    )}

                                    {/* account_login */}
                                    {isColumnVisible('accountLogin') && (
                                        <td className="px-1.5 py-[2px] border-r border-zinc-800 text-center text-zinc-100 whitespace-nowrap tabular-nums" title={tr("Account login: {{value0}}", { value0: accountLoginLabel })}>
                                            {accountLoginLabel}
                                        </td>
                                    )}

                                    {/* time_update */}
                                    {isColumnVisible('timeUpdate') && (
                                        <td className="px-1.5 py-[2px] border-r border-zinc-800 text-center text-zinc-100 whitespace-nowrap tabular-nums" title={tr("Last update: {{value0}}", { value0: timeUpdateLabel })}>
                                            {timeUpdateLabel}
                                        </td>
                                    )}

                                    {/* comment */}
                                    {isColumnVisible('comment') && (
                                        <td className="px-1.5 py-[2px] border-r border-zinc-800 text-center text-zinc-100 truncate" title={tr("Comment: {{value0}}", { value0: commentLabel })}>
                                            {commentLabel}
                                        </td>
                                    )}

                                    {/* profit */}
                                    {isColumnVisible('profit') && (
                                        // MERGE: HEAD's `profitIsAvailable` is a superset of
                                        // origin/main's `pnlValue === null` - in points mode the
                                        // P/L value can legitimately be null while the points
                                        // value is available, and greying the cell out then
                                        // would be wrong.
                                        <td className={`px-1.5 py-[2px] text-center font-normal tabular-nums ${!profitIsAvailable ? 'text-zinc-500' : profitIsPositive ? 'rtx-trade-profit-value--positive text-[#22c55e]' : 'rtx-trade-profit-value--negative text-[#ff2d2d]'}`} title={`${tr(profitMode === 'points' ? 'Profit Points' : 'Profit')}: ${profitLabel}`}>
                                            {profitLabel}
                                        </td>
                                    )}

                                    {/* Close Button */}
                                    <td className="px-0.5 py-[2px] text-center">
                                        <button
                                            type="button"
                                            aria-label={isPendingPlacement ? tr("Order in progress") : tr("Close position {{value0}}", { value0: pos.ticket ?? pos.id })}
                                            title={isPendingPlacement ? rowComment : tr("Close position {{value0}}", { value0: ticketLabel })}
                                            disabled={isPendingPlacement}
                                            onClick={(event) => {
                                                event.stopPropagation();
                                                if (isPendingPlacement) return;
                                                onClosePosition(pos.id);
                                            }}
                                            className="rtx-trade-close-button mx-auto flex h-[17px] w-[17px] cursor-default items-center justify-center rounded-sm border border-transparent text-[12px] font-normal leading-none text-zinc-400 hover:border-red-500/50 hover:bg-red-950/50 hover:text-red-200 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-red-400 disabled:cursor-default disabled:text-zinc-600 disabled:hover:border-transparent disabled:hover:bg-transparent"
                                        >
                                            {isPendingPlacement ? (isTerminalPlacementFailure ? '!' : '…') : 'x'}
                                        </button>
                                    </td>
                                </tr>
                            );
                        })}
                    </tbody>
                </table>

                {/* Account summary follows the last trade and scrolls with the list. */}
                <div
                    className="rtx-trade-footer bg-[#191a1e] border-t border-zinc-700 w-full text-[13px] font-normal text-zinc-300 tabular-nums"
                    data-metrics-publication-token={account?.publicationToken}
                    data-metrics-calculation-version={account?.calculationVersion}
                    data-metrics-margin-calculation-version={account?.marginCalculationVersion}
                    data-metrics-configuration-version={account?.configurationVersion}
                    data-metrics-status={account?.metricsStatus ?? (liveEquity === null ? 'unavailable' : 'valid')}
                >
                    <div className="rtx-trade-footer-inner flex w-max min-w-full items-center py-1" style={{ minWidth: `max(100%, ${visibleTradeTableWidth}px)` }}>
                        <div className="rtx-trade-footer-metrics flex min-w-0 items-center gap-3 px-1.5">
                            <button
                                ref={footerMetricButtonRef}
                                type="button"
                                className="rtx-trade-footer-status inline-flex h-5 w-5 shrink-0 cursor-default items-center justify-center rounded-[3px] border border-zinc-700/70 bg-zinc-950/35 px-0 text-zinc-400 hover:bg-zinc-800/70 hover:text-zinc-100 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-sky-400"
                                title={tr("Select footer metrics")}
                                aria-label={tr("Footer metrics")}
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
                                    <span className="rtx-trade-metric-label text-zinc-500">{tr(metric.label)}</span>
                                    {renderFooterMetricValue(metric.key)}
                                </span>
                            ))}
                        </div>
                        <div className="min-w-2 flex-1" />
                        {/* MERGE (union): origin/main's calculation-version badge and market-closed
                            indicator, followed by HEAD's single floating-P/L span. HEAD collapsed
                            origin/main's two near-identical branches into one span with conditional
                            class/style, and its `floatingProfitColor` / `floatingProfitLabel` carry
                            the same null handling origin/main inlined in each branch. The badge is
                            diagnostic; without version data it stays hidden instead of rendering
                            "— · margin — · valid" placeholders. */}
                        {Boolean(account?.calculationVersion || account?.marginCalculationVersion) && (
                            <span
                                className="rtx-trade-footer-calc shrink-0 text-zinc-500"
                                title={`Calculation ${account?.calculationVersion || 'unknown'} · margin ${account?.marginCalculationVersion || 'unknown'} · ${account?.metricsStatus || (liveEquity === null ? 'unavailable' : 'valid')}`}
                                data-testid="trade-footer-calculation-badge"
                            >
                                {account?.calculationVersion || '—'}
                                {' · margin '}
                                {account?.marginCalculationVersion || '—'}
                                {' · '}
                                {account?.metricsStatus || (liveEquity === null ? 'unavailable' : 'valid')}
                            </span>
                        )}
                        {account?.marketClosed && <span className="shrink-0 text-zinc-500">Market closed</span>}
                        <span
                            className={`rtx-trade-footer-floating ${isColumnVisible('profit') ? 'rtx-trade-footer-floating--profit justify-center' : 'justify-end'} inline-flex shrink-0 items-center gap-1 whitespace-nowrap text-center font-normal leading-none ${floatingProfitColor}`}
                            style={isColumnVisible('profit') ? { width: footerProfitColumnWidth, flex: `0 0 ${footerProfitColumnWidth}` } : undefined}
                            title={tr("Floating P/L: {{value0}} {{value1}}", { value0: floatingProfitLabel, value1: account?.currency || 'USD' })}
                        >
                            {totalLivePnL === null
                                ? <UnavailableMetric />
                                : <BlinkingText
                                    value={totalLivePnL}
                                    formatFn={formatMoney}
                                    defaultColor={floatingProfitColor}
                                    flashDirection={false}
                                />}
                            <span className="rtx-trade-footer-currency">{account?.currency || 'USD'}</span>
                        </span>
                        <span className="rtx-trade-footer-close-spacer shrink-0" style={{ width: footerCloseColumnWidth, flex: `0 0 ${footerCloseColumnWidth}` }} aria-hidden="true" />
                    </div>
                </div>
                {displayedLivePositions.length === 0 && !loading && !error && (
                    <div
                        className="rtx-trade-empty-state flex h-16 w-max min-w-full items-center justify-center text-center text-xs italic text-zinc-600"
                        style={{ minWidth: `max(100%, ${visibleTradeTableWidth}px)` }}
                    >
                        {tr("No open positions")}</div>
                )}
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
            <RetainedLazyFeature active={modifyPosition !== null}>
            <ModifyPositionDialog
                isOpen={modifyPosition !== null}
                onClosePosition={(id) => onClosePosition(id)}
                onClose={(modifiedSl?: number, modifiedTp?: number, modifiedComment?: string) => {
                    const closingContext = modifyPositionContext;
                    const currentPosition = closingContext
                        ? useAppStore.getState().positions.find(position => (
                            position.id === Number(closingContext.position.id)
                            && normalizeTradeSymbol(position.symbol) === normalizeTradeSymbol(closingContext.position.symbol)
                        ))
                        : null;
                    // Capture modified values in local overrides while the backend refresh catches up.
                    if (
                        closingContext
                        && currentPosition
                        && closingContext.sessionScope === getCurrentBrokerAccountSessionScopeKey()
                        && modifiedSl !== undefined
                        && modifiedTp !== undefined
                    ) {
                        setTradeOverrides(prev => ({
                            ...prev,
                            [closingContext.position.id]: { sl: modifiedSl, tp: modifiedTp, comment: modifiedComment ?? '' }
                        }));
                    }
                    setModifyPositionContext(current => current === closingContext ? null : current);
                }}
                position={modifyPosition}
            />
            </RetainedLazyFeature>
        </div>
    );
});

type ExposureTabProps = {
    positions: ExposurePositionInput[];
    formatMoney: (value: number | undefined | null) => string;
    account: ExposureAccountInput | null;
};

const getAssetBadgeStyle = (asset: string) => {
    const code = asset.toUpperCase();
    if (code === 'USD') return { icon: '$', badgeClass: 'bg-amber-500/15 border-amber-500/40 text-amber-400', textClass: 'text-amber-400' };
    if (code === 'EUR') return { icon: '€', badgeClass: 'bg-sky-500/15 border-sky-500/40 text-sky-400', textClass: 'text-sky-400' };
    if (code === 'GBP') return { icon: '£', badgeClass: 'bg-purple-500/15 border-purple-500/40 text-purple-400', textClass: 'text-purple-400' };
    if (code === 'JPY') return { icon: '¥', badgeClass: 'bg-rose-500/15 border-rose-500/40 text-rose-400', textClass: 'text-rose-400' };
    if (code === 'XAU') return { icon: '🪙', badgeClass: 'bg-yellow-500/20 border-yellow-500/50 text-yellow-300', textClass: 'text-yellow-300' };
    if (code === 'XAG') return { icon: '🥈', badgeClass: 'bg-slate-400/20 border-slate-400/50 text-slate-300', textClass: 'text-slate-300' };
    if (code === 'BTC') return { icon: '₿', badgeClass: 'bg-orange-500/20 border-orange-500/50 text-orange-400', textClass: 'text-orange-400' };
    if (code === 'ETH') return { icon: 'Ξ', badgeClass: 'bg-indigo-500/20 border-indigo-500/50 text-indigo-400', textClass: 'text-indigo-400' };
    return { icon: '$', badgeClass: 'bg-amber-500/15 border-amber-500/40 text-amber-400', textClass: 'text-amber-400' };
};

function ExposureTab({ positions, formatMoney, account }: ExposureTabProps) {
    const tr = useUiTranslation();
    const exposure = useMemo(() => {
        return buildExposureSummary(positions ?? [], account);
    }, [positions, account]);

    const [metricsNow, setMetricsNow] = useState(Date.now);
    useEffect(() => {
        const timer = window.setInterval(() => setMetricsNow(Date.now()), 1000);
        return () => window.clearInterval(timer);
    }, []);
    const { balance: accountBalance, equity: accountEquity, margin: accountMargin,
        freeMargin: accountFreeMargin, marginLevel: accountMarginLevel } = useLiveAccountMetrics(account, positions, metricsNow);
    const formatAccountMetric = (value: number | null) => value === null ? METRIC_UNAVAILABLE : formatMoney(value);

    return (
        <div className="rtx-exposure-tab flex h-full bg-[#0a0b0e] text-[13px] font-normal">
            {/* Table Area */}
            <div className="flex min-w-0 flex-1 flex-col">
                <div className="min-h-0 flex-1 overflow-auto">
                    <table className="w-full min-w-[720px] table-fixed border-collapse text-left">
                        <thead className="sticky top-0 z-10 border-b border-[#20222a] bg-[#0d0f14] text-[11px] font-semibold uppercase tracking-wider text-zinc-400">
                            <tr className="h-[32px]">
                                <th className="w-[140px] border-r border-zinc-800/80 p-1.5 pl-3">{tr("Assets")}</th>
                                <th className="w-[130px] border-r border-zinc-800/80 p-1.5 text-right">{tr("Volume")}</th>
                                <th className="w-[130px] border-r border-zinc-800/80 p-1.5 text-right">{tr("Rate")}</th>
                                <th className="w-[140px] border-r border-zinc-800/80 p-1.5 text-right">{exposure.accountCurrency}</th>
                                <th className="p-1.5 text-center">{tr("Graph")}</th>
                            </tr>
                        </thead>
                        <tbody className="font-mono text-[12.5px] leading-[20px] text-zinc-200">
                            {exposure.rows.length === 0 ? (
                                <tr>
                                    <td colSpan={5} className="h-20 text-center font-sans text-[12px] text-zinc-500">
                                        {tr("No active asset exposure")}</td>
                                </tr>
                            ) : exposure.rows.map((exp, i) => {
                                const isLong = exp.value >= 0;
                                const badge = getAssetBadgeStyle(exp.asset);
                                return (
                                    <tr
                                        key={exp.asset}
                                        className={`h-[34px] border-b border-white/[0.02] transition-colors hover:bg-white/[0.03] ${i % 2 === 0 ? 'bg-[#111318]' : 'bg-[#0e0f14]'
                                            }`}
                                    >
                                        <td className="border-r border-zinc-800/80 p-1.5 pl-3 font-sans font-semibold">
                                            <div className="inline-flex items-center gap-1.5">
                                                <span className={`inline-flex h-[17px] w-[17px] items-center justify-center rounded-[3px] border text-[9.5px] font-bold ${badge.badgeClass}`}>
                                                    {badge.icon}
                                                </span>
                                                <span className={badge.textClass}>{exp.asset}</span>
                                            </div>
                                        </td>
                                        <td className="border-r border-zinc-800/80 p-1.5 text-right font-medium text-zinc-300">
                                            {formatExposureVolume(exp.asset, exp.volume)}
                                        </td>
                                        <td className="border-r border-zinc-800/80 p-1.5 text-right text-zinc-400">
                                            {exp.rate.toFixed(5)}
                                        </td>
                                        <td className={`border-r border-zinc-800/80 p-1.5 text-right font-semibold ${isLong ? 'text-white' : 'text-rose-400'
                                            }`}>
                                            {formatMoney(exp.value)}
                                        </td>
                                        <td className="p-1.5 px-4 align-middle">
                                            <div className="relative h-[13px] w-full min-w-[120px] overflow-hidden rounded-[3px] border border-white/[0.04] bg-[#161820]">
                                                <div
                                                    className={`absolute top-0 h-full rounded-[2px] transition-all duration-300 ${isLong
                                                        ? 'left-0 bg-gradient-to-r from-[#0284c7] to-[#38bdf8] shadow-[0_0_8px_rgba(56,189,248,0.3)]'
                                                        : 'right-0 bg-gradient-to-r from-[#e11d48] to-[#f43f5e] shadow-[0_0_8px_rgba(244,63,94,0.3)]'
                                                        }`}
                                                    style={{ width: `${Math.max(1.5, Math.min(100, exp.graphPercent))}%` }}
                                                />
                                            </div>
                                        </td>
                                    </tr>
                                );
                            })}
                        </tbody>
                    </table>
                </div>

                <div className="rtx-exposure-account-bar">
                    <span className="rtx-exposure-account-metric">
                        <span className="rtx-exposure-account-label">{tr("Balance:")}</span>
                        <span className="rtx-exposure-account-value">{formatAccountMetric(accountBalance)}</span>
                    </span>
                    <span className="rtx-exposure-account-metric">
                        <span className="rtx-exposure-account-label">{tr("Equity:")}</span>
                        <span className="rtx-exposure-account-value">{formatAccountMetric(accountEquity)}</span>
                    </span>
                    <span className="rtx-exposure-account-metric">
                        <span className="rtx-exposure-account-label">{tr("Margin:")}</span>
                        <span className="rtx-exposure-account-value">{formatAccountMetric(accountMargin)}</span>
                    </span>
                    <span className="rtx-exposure-account-metric">
                        <span className="rtx-exposure-account-label">{tr("Free margin:")}</span>
                        <span className="rtx-exposure-account-value">{formatAccountMetric(accountFreeMargin)}</span>
                    </span>
                    <span className="rtx-exposure-account-metric">
                        <span className="rtx-exposure-account-label">{tr("Level:")}</span>
                        <span className="rtx-exposure-account-value">
                            {accountMarginLevel !== null ? `${accountMarginLevel.toFixed(2)}%` : METRIC_UNAVAILABLE}
                        </span>
                    </span>
                </div>
            </div>
        </div>
    );
}

const toLocalDateInputValue = (date: Date): string => {
    const pad = (value: number) => String(value).padStart(2, '0');
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
};

const subtractCalendarMonths = (value: Date, months: number): Date => {
    const result = new Date(value);
    const day = result.getDate();
    result.setDate(1);
    result.setMonth(result.getMonth() - months);
    const finalDay = new Date(result.getFullYear(), result.getMonth() + 1, 0).getDate();
    result.setDate(Math.min(day, finalDay));
    return result;
};

const createDefaultHistoryCustomPeriod = (): HistoryCustomPeriod => {
    const to = new Date();
    const from = subtractCalendarMonths(to, 1);
    return { from: toLocalDateInputValue(from), to: toLocalDateInputValue(to) };
};

const parseLocalDateBoundary = (value: string, endOfDay: boolean): number | null => {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
    if (!match) return null;
    const year = Number(match[1]);
    const month = Number(match[2]) - 1;
    const day = Number(match[3]);
    const date = new Date(year, month, day, endOfDay ? 23 : 0, endOfDay ? 59 : 0, endOfDay ? 59 : 0, endOfDay ? 999 : 0);
    if (date.getFullYear() !== year || date.getMonth() !== month || date.getDate() !== day) return null;
    return date.getTime();
};

const getHistoryRowTime = (trade: Trade): number => {
    const value = Date.parse(trade.closeTime || trade.openTime || '');
    return Number.isFinite(value) ? value : 0;
};

const getHistoryPeriodStart = (period: HistoryPeriodFilter, now: number): number | null => {
    if (period === 'all' || period === 'custom') return null;
    const start = subtractCalendarMonths(new Date(now), period === 'last-three-months' ? 3 : 1);
    start.setHours(0, 0, 0, 0);
    return start.getTime();
};

const EMPTY_HISTORY_DATA_SET: TradeHistoryDataSet = {
    positions: [],
    deals: [],
    orders: [],
    errors: { positions: null, deals: null, orders: null },
};

const HISTORY_ROW_HEIGHT = 30;
const HISTORY_OVERSCAN = 8;
const HISTORY_VIEWPORT_FALLBACK = 360;

type HistoryTabProps = {
    formatMoney: (value: number | undefined | null) => string;
    instrumentCatalog?: readonly unknown[];
};

function HistoryTab({ formatMoney, instrumentCatalog = [] }: HistoryTabProps) {
    const tr = useUiTranslation();
    const accountId = useAppStore((state) => state.accountId);
    const activeChartSymbol = useAppStore((state) => state.selectedSymbol);
    const activeLogin = Number.parseInt(String(accountId ?? getStoredAccountLogin() ?? ''), 10);
    const activeScopeKey = getCurrentBrokerAccountSessionScopeKey();
    const cachedHistory = peekTerminalHistory(activeLogin, activeScopeKey);
    const [historyData, setHistoryData] = useState<TradeHistoryDataSet>(() => cachedHistory?.data ?? EMPTY_HISTORY_DATA_SET);
    const [loading, setLoading] = useState(() => !cachedHistory);
    const [ordersPending, setOrdersPending] = useState(() => cachedHistory?.ordersPending ?? false);
    const [error, setError] = useState<string | null>(null);
    const [historyView, setHistoryView] = useState<HistoryViewMode>('positions');
    const [periodFilter, setPeriodFilter] = useState<HistoryPeriodFilter>('all');
    const [symbolFilter, setSymbolFilter] = useState<HistorySymbolFilter>({ mode: 'all' });
    const [customPeriod, setCustomPeriod] = useState<HistoryCustomPeriod>(createDefaultHistoryCustomPeriod);
    const [customPeriodDraft, setCustomPeriodDraft] = useState<HistoryCustomPeriod>(createDefaultHistoryCustomPeriod);
    const [customPeriodDialogOpen, setCustomPeriodDialogOpen] = useState(false);
    const [customPeriodError, setCustomPeriodError] = useState<string | null>(null);
    const [historyContextMenu, setHistoryContextMenu] = useState<HistoryContextMenuState | null>(null);
    const [selectedTradeKey, setSelectedTradeKey] = useState<string | null>(null);
    const [columnVisibility, setColumnVisibility] = useState<HistoryColumnVisibility>(() => (
        safeReadJson(HISTORY_COLUMN_STORAGE_KEY, DEFAULT_HISTORY_COLUMNS)
    ));
    const [volumeMode, setVolumeMode] = useState<HistoryVolumeMode>(() => (
        safeReadString(HISTORY_VOLUME_MODE_STORAGE_KEY, ['lots', 'amounts'] as const, 'lots')
    ));
    const [showMilliseconds, setShowMilliseconds] = useState(() => (
        safeReadBoolean(HISTORY_SHOW_MILLISECONDS_STORAGE_KEY, false)
    ));
    const [autoArrange, setAutoArrange] = useState(() => (
        safeReadBoolean(HISTORY_AUTO_ARRANGE_STORAGE_KEY, true)
    ));
    const [showGrid, setShowGrid] = useState(() => (
        safeReadBoolean(HISTORY_GRID_STORAGE_KEY, true)
    ));
    const [showOnChartsAutoUpdate, setShowOnChartsAutoUpdate] = useState(() => (
        safeReadBoolean(HISTORY_SHOW_ON_CHARTS_AUTO_UPDATE_STORAGE_KEY, true)
    ));
    const [isLightSkin, setIsLightSkin] = useState(false);
    const historyRequestSerialRef = useRef(0);
    const historyMountedRef = useRef(false);
    const historyScrollRef = useRef<HTMLDivElement>(null);
    const [historyViewport, setHistoryViewport] = useState({ scrollTop: 0, height: HISTORY_VIEWPORT_FALLBACK });

    useEffect(() => {
        historyMountedRef.current = true;
        return () => {
            historyMountedRef.current = false;
            historyRequestSerialRef.current += 1;
        };
    }, []);

    const fetchHistory = useCallback(async (opts?: { force?: boolean; background?: boolean; refresh?: boolean }) => {
        const requestSerial = ++historyRequestSerialRef.current;
        const login = Number.isFinite(activeLogin) && activeLogin > 0 ? activeLogin : null;
        if (!login) {
            setError('No account login found');
            if (!opts?.background) setLoading(false);
            return;
        }
        if (!opts?.background) setLoading(true);
        setError(null);
        const stillCurrent = () => (
            historyMountedRef.current
            && requestSerial === historyRequestSerialRef.current
            && Number.parseInt(String(useAppStore.getState().accountId ?? getStoredAccountLogin() ?? ''), 10) === login
            && getCurrentBrokerAccountSessionScopeKey() === activeScopeKey
        );
        try {
            const data = await loadTerminalHistory(login, activeScopeKey, {
                force: opts?.force,
                refresh: opts?.refresh,
                onUpdate: (next, pending) => {
                    if (!stillCurrent()) return;
                    setHistoryData(next);
                    setOrdersPending(pending);
                    if (!pending || next.positions.length > 0 || next.deals.length > 0 || next.orders.length > 0) {
                        setLoading(false);
                    }
                },
            });
            if (!stillCurrent()) return;
            setHistoryData(data);
            setOrdersPending(false);
        } catch (err: unknown) {
            if (!stillCurrent()) return;
            console.warn('[History] Failed to load:', err);
            setOrdersPending(false);
            if (!opts?.background) setError(err instanceof Error ? err.message : 'Failed to load history');
        } finally {
            if (stillCurrent() && !opts?.background) setLoading(false);
        }
    }, [activeLogin, activeScopeKey]);

    useEffect(() => {
        const cached = peekTerminalHistory(activeLogin, activeScopeKey);
        if (cached) {
            setHistoryData(cached.data);
            setOrdersPending(cached.ordersPending);
            setLoading(false);
        } else {
            setHistoryData(EMPTY_HISTORY_DATA_SET);
            setOrdersPending(false);
        }
        void fetchHistory({ background: Boolean(cached) });
    }, [activeLogin, activeScopeKey, fetchHistory]);

    useEffect(() => {
        const handleCompleted = (event: Event) => {
            const detail = (event as CustomEvent<{ login?: number; ok?: boolean }>).detail;
            if (!detail || detail.ok === false || detail.login !== activeLogin) return;
            void fetchHistory({ background: true, refresh: true });
        };
        window.addEventListener('rtx:trade-history-refresh-completed', handleCompleted);
        return () => window.removeEventListener('rtx:trade-history-refresh-completed', handleCompleted);
    }, [activeLogin, fetchHistory]);

    useEffect(() => onCommittedBrokerAccountSessionScopeChange(() => {
        historyRequestSerialRef.current += 1;
        setHistoryData(EMPTY_HISTORY_DATA_SET);
        setOrdersPending(false);
        setHistoryContextMenu(null);
        setSelectedTradeKey(null);
        setHistoryView('positions');
        setSymbolFilter({ mode: 'all' });
        setPeriodFilter('all');
    }), []);

    useEffect(() => {
        const root = document.documentElement;
        const check = () => setIsLightSkin(root.classList.contains('rtx-skin-untitled-light'));
        check();
        const observer = new MutationObserver(check);
        observer.observe(root, { attributes: true, attributeFilter: ['class'] });
        return () => observer.disconnect();
    }, []);

    useEffect(() => {
        window.localStorage.setItem(HISTORY_COLUMN_STORAGE_KEY, JSON.stringify(columnVisibility));
    }, [columnVisibility]);
    useEffect(() => {
        window.localStorage.setItem(HISTORY_VOLUME_MODE_STORAGE_KEY, volumeMode);
    }, [volumeMode]);
    useEffect(() => {
        window.localStorage.setItem(HISTORY_SHOW_MILLISECONDS_STORAGE_KEY, String(showMilliseconds));
    }, [showMilliseconds]);
    useEffect(() => {
        window.localStorage.setItem(HISTORY_AUTO_ARRANGE_STORAGE_KEY, String(autoArrange));
    }, [autoArrange]);
    useEffect(() => {
        window.localStorage.setItem(HISTORY_GRID_STORAGE_KEY, String(showGrid));
    }, [showGrid]);
    useEffect(() => {
        window.localStorage.setItem(HISTORY_SHOW_ON_CHARTS_AUTO_UPDATE_STORAGE_KEY, String(showOnChartsAutoUpdate));
    }, [showOnChartsAutoUpdate]);

    const historyRows = useMemo(() => {
        const rows = historyView === 'positions'
            ? historyData.positions
            : historyView === 'deals'
                ? historyData.deals
                : historyView === 'orders'
                    ? historyData.orders
                    : [...historyData.orders, ...historyData.deals];
        return [...rows].sort((left, right) => getHistoryRowTime(right) - getHistoryRowTime(left));
    }, [historyData, historyView]);

    const availableSymbols = useMemo(() => {
        const symbols = new Map<string, string>();
        [...historyData.positions, ...historyData.deals, ...historyData.orders].forEach((trade) => {
            const display = String(trade.symbol ?? '').trim();
            const normalized = normalizeTradeSymbol(display);
            if (normalized && !symbols.has(normalized)) symbols.set(normalized, display || normalized);
        });
        return Array.from(symbols.entries())
            .sort((left, right) => left[0].localeCompare(right[0]))
            .map(([normalized, display]) => ({ normalized, display }));
    }, [historyData]);

    const contractSizeBySymbol = useMemo(() => {
        const sizes = new Map<string, number>();
        instrumentCatalog.forEach((instrument) => {
            if (!instrument || typeof instrument !== 'object') return;
            const record = instrument as Record<string, unknown>;
            const specification = record.brokerSpecification && typeof record.brokerSpecification === 'object'
                ? record.brokerSpecification as Record<string, unknown>
                : {};
            const symbol = normalizeTradeSymbol(record.symbol ?? record.name ?? specification.symbol);
            const size = Number(record.contractSize ?? record.contract_size ?? specification.contract_size ?? specification.contractSize);
            if (symbol && Number.isFinite(size) && size > 0) sizes.set(symbol, size);
        });
        return sizes;
    }, [instrumentCatalog]);

    const currentSymbol = normalizeTradeSymbol(activeChartSymbol);
    const matchesCurrentHistoryFilters = useCallback((trade: Trade) => {
        const now = Date.now();
        const periodStart = getHistoryPeriodStart(periodFilter, now);
        const customStart = periodFilter === 'custom' ? parseLocalDateBoundary(customPeriod.from, false) : null;
        const customEnd = periodFilter === 'custom' ? parseLocalDateBoundary(customPeriod.to, true) : null;
        const selectedSymbol = symbolFilter.mode === 'current'
            ? currentSymbol
            : symbolFilter.mode === 'symbol'
                ? normalizeTradeSymbol(symbolFilter.symbol)
                : '';
        const rowSymbol = normalizeTradeSymbol(trade.symbol);
        if (symbolFilter.mode !== 'all' && (!selectedSymbol || rowSymbol !== selectedSymbol)) return false;
        const openTime = Date.parse(trade.openTime || '');
        const closeTime = Date.parse(trade.closeTime || '');
        const isOrderRow = historyView === 'orders' || (historyView === 'orders-and-deals' && trade.historySource === 'order');
        const rowTimes = isOrderRow
            ? [openTime]
            : historyView === 'positions'
                ? [openTime, closeTime]
                : [closeTime, openTime];
        const validRowTimes = rowTimes.filter(time => Number.isFinite(time));
        if (periodFilter === 'custom') {
            return customStart !== null
                && customEnd !== null
                && validRowTimes.some(time => time >= customStart && time <= customEnd);
        }
        return periodStart === null || validRowTimes.some(time => time >= periodStart && time <= now);
    }, [currentSymbol, customPeriod, historyView, periodFilter, symbolFilter]);
    const filteredOrders = useMemo(
        () => historyRows.filter(matchesCurrentHistoryFilters),
        [historyRows, matchesCurrentHistoryFilters],
    );
    const filteredPositionHistory = useMemo(
        () => historyData.positions.filter(matchesCurrentHistoryFilters),
        [historyData.positions, matchesCurrentHistoryFilters],
    );

    const viewError = historyView === 'positions'
        ? historyData.errors.positions
        : historyView === 'deals'
            ? historyData.errors.deals
            : historyView === 'orders'
                ? historyData.errors.orders
                : [historyData.errors.orders, historyData.errors.deals].filter(Boolean).join(' · ') || null;
    const displayError = error ?? viewError;

    const getTradeKey = (trade: Trade) => [
        trade.historySource ?? trade.type,
        trade.positionId ?? '',
        trade.dealTicket ?? trade.orderTicket ?? trade.id,
        trade.openTime,
        trade.closeTime ?? '',
    ].join(':');

    useEffect(() => {
        if (!selectedTradeKey) return;
        if (!filteredOrders.some(order => getTradeKey(order) === selectedTradeKey)) {
            setSelectedTradeKey(null);
            setHistoryContextMenu(null);
        }
    }, [filteredOrders, selectedTradeKey]);

    const formatTs = (value?: string) => {
        if (!value) return '-';
        const date = new Date(value);
        if (Number.isNaN(date.getTime())) return value;
        const pad = (number: number, length = 2) => String(number).padStart(length, '0');
        const milliseconds = showMilliseconds ? `.${pad(date.getMilliseconds(), 3)}` : '';
        return `${date.getFullYear()}.${pad(date.getMonth() + 1)}.${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}${milliseconds}`;
    };

    const formatPriceCell = (value: number | undefined, symbol: string) => {
        const price = Number(value);
        return Number.isFinite(price) && price > 0 ? formatPrice(price, symbol) : '-';
    };

    const formatLevelCell = (value: number | undefined, symbol: string) => {
        const price = Number(value);
        return Number.isFinite(price) && price > 0 ? formatPrice(price, symbol) : '0.00';
    };

    const moneyColor = (value: number | undefined | null) => {
        const numeric = Number(value ?? 0);
        if (numeric > 0) return 'text-[#22c55e]';
        if (numeric < 0) return 'text-[#ff2d2d]';
        return 'text-zinc-100';
    };

    const typeColor = (type: string) => {
        const normalized = (type || '').toLowerCase();
        return normalized.includes('buy') ? 'text-[#45bff7]' : normalized.includes('sell') ? 'text-[#ff2d2d]' : 'text-zinc-100';
    };

    const isColumnVisible = (key: HistoryColumnKey) => columnVisibility[key] !== false;
    const visibleColumnCount = 10 + HISTORY_COLUMN_DEFS.filter(column => isColumnVisible(column.key)).length;
    const toggleColumn = (key: HistoryColumnKey) => {
        setColumnVisibility(current => ({ ...current, [key]: current[key] === false }));
    };

    const getHistoryTicket = (trade: Trade): number | string => {
        if (historyView === 'positions') return trade.positionId ?? trade.id ?? '-';
        if (trade.historySource === 'deal') return trade.dealTicket ?? trade.id ?? '-';
        if (trade.historySource === 'order') return trade.orderTicket ?? trade.id ?? '-';
        return trade.id ?? '-';
    };

    const getHistoryContractSize = (trade: Trade): number | null => {
        const explicit = Number(trade.contractSize);
        if (Number.isFinite(explicit) && explicit > 0) return explicit;
        return contractSizeBySymbol.get(normalizeTradeSymbol(trade.symbol)) ?? null;
    };

    const formatGroupedNumber = (value: number, minimumFractionDigits = 0, maximumFractionDigits = 2): string => (
        value.toLocaleString('en-US', { minimumFractionDigits, maximumFractionDigits }).replace(/,/g, ' ')
    );

    const formatHistoryVolume = (trade: Trade): string => {
        const lots = Number(trade.volume);
        if (!Number.isFinite(lots)) return '-';
        if (volumeMode === 'lots') return formatGroupedNumber(lots, 2, 8);
        const contractSize = getHistoryContractSize(trade);
        return contractSize === null ? '\u2014' : formatGroupedNumber(lots * contractSize, 0, 2);
    };

    const getHistoryMarketValue = (trade: Trade): number | null => {
        const price = Number(trade.openPrice);
        const lots = Number(trade.volume);
        const contractSize = getHistoryContractSize(trade);
        if (!Number.isFinite(price) || price <= 0 || !Number.isFinite(lots) || contractSize === null) return null;
        const value = price * lots * contractSize;
        return Number.isFinite(value) ? value : null;
    };

    const getHistoryChangePercent = (trade: Trade): number | null => {
        const openPrice = Number(trade.openPrice);
        const closePrice = Number(trade.closePrice);
        if (!Number.isFinite(openPrice) || !Number.isFinite(closePrice) || openPrice <= 0 || closePrice <= 0) return null;
        const value = ((closePrice - openPrice) / openPrice) * 100;
        return Number.isFinite(value) ? value : null;
    };

    const formatHistoryPercent = (trade: Trade): string => {
        const value = getHistoryChangePercent(trade);
        return value === null ? '\u2014' : `${value.toFixed(2)} %`;
    };

    const getHistoryRowSymbol = (trade?: Trade): string => {
        const rowSymbol = String(trade?.symbol ?? '').trim();
        if (trade) return rowSymbol;
        if (symbolFilter.mode === 'symbol') return symbolFilter.symbol;
        if (symbolFilter.mode === 'current') return activeChartSymbol;
        return activeChartSymbol || availableSymbols[0]?.display || '';
    };

    const openCustomPeriodDialog = () => {
        setCustomPeriodDraft(customPeriod);
        setCustomPeriodError(null);
        setCustomPeriodDialogOpen(true);
    };

    const applyCustomPeriod = () => {
        const start = parseLocalDateBoundary(customPeriodDraft.from, false);
        const end = parseLocalDateBoundary(customPeriodDraft.to, true);
        if (start === null || end === null || start > end) {
            setCustomPeriodError('Choose a valid date range');
            return;
        }
        setCustomPeriod(customPeriodDraft);
        setPeriodFilter('custom');
        setCustomPeriodDialogOpen(false);
        setCustomPeriodError(null);
    };

    const historyViewLabel = historyView === 'positions'
        ? 'Positions'
        : historyView === 'deals'
            ? 'Deals'
            : historyView === 'orders'
                ? 'Orders'
                : 'Orders & Deals';

    const periodFilterLabel = periodFilter === 'all'
        ? 'All History'
        : periodFilter === 'last-three-months'
            ? 'Last 3 Months'
            : periodFilter === 'last-month'
                ? 'Last Month'
                : `${customPeriod.from} - ${customPeriod.to}`;

    const symbolFilterLabel = symbolFilter.mode === 'all'
        ? 'All Symbols'
        : symbolFilter.mode === 'current'
            ? (currentSymbol || 'Current Symbol')
            : symbolFilter.symbol;

    const downloadTextFile = (content: string, filename: string, type: string) => {
        const url = URL.createObjectURL(new Blob([content], { type }));
        const anchor = document.createElement('a');
        anchor.href = url;
        anchor.download = filename;
        document.body.appendChild(anchor);
        anchor.click();
        anchor.remove();
        window.setTimeout(() => URL.revokeObjectURL(url), 30_000);
    };

    const getHistoryReportColumns = () => [
        { label: 'Time', value: (trade: Trade): string | number => formatTs(trade.openTime) },
        { label: 'Symbol', value: (trade: Trade): string | number => trade.symbol || '-' },
        ...(isColumnVisible('ticket') ? [{ label: 'Ticket', value: (trade: Trade): string | number => getHistoryTicket(trade) }] : []),
        { label: 'Type', value: (trade: Trade): string | number => String(trade.orderType || trade.side || trade.type || '-').toLowerCase() },
        { label: 'Volume', value: (trade: Trade): string | number => formatHistoryVolume(trade) },
        { label: 'Price', value: (trade: Trade): string | number => formatPriceCell(trade.openPrice, trade.symbol) },
        { label: 'S/L', value: (trade: Trade): string | number => formatLevelCell(trade.sl, trade.symbol) },
        { label: 'T/P', value: (trade: Trade): string | number => formatLevelCell(trade.tp, trade.symbol) },
        { label: 'Time', value: (trade: Trade): string | number => formatTs(trade.closeTime) },
        { label: 'Price', value: (trade: Trade): string | number => formatPriceCell(trade.closePrice, trade.symbol) },
        ...(isColumnVisible('marketValue') ? [{ label: 'Market Value', value: (trade: Trade): string | number => {
            const value = getHistoryMarketValue(trade);
            return value === null ? '\u2014' : formatGroupedNumber(value, 2, 2);
        } }] : []),
        ...(isColumnVisible('commission') ? [{ label: 'Commission', value: (trade: Trade): string | number => formatMoney(trade.commission) }] : []),
        ...(isColumnVisible('swap') ? [{ label: 'Swap', value: (trade: Trade): string | number => formatMoney(trade.swap) }] : []),
        ...(isColumnVisible('fee') ? [{ label: 'Fee', value: (trade: Trade): string | number => formatMoney(trade.fee) }] : []),
        { label: 'Profit', value: (trade: Trade): string | number => formatMoney(trade.profit) },
        ...(isColumnVisible('changePercent') ? [{ label: 'Change %', value: (trade: Trade): string | number => formatHistoryPercent(trade) }] : []),
        ...(isColumnVisible('magicNumber') ? [{ label: 'Magic Number', value: (trade: Trade): string | number => trade.magicNumber ?? '-' }] : []),
        ...(isColumnVisible('comment') ? [{ label: 'Comment', value: (trade: Trade): string | number => trade.comment || '-' }] : []),
    ];

    const buildHistoryReportHtml = (title: string) => {
        const columns = getHistoryReportColumns();
        const header = columns.map(column => `<th>${escapeHtml(column.label)}</th>`).join('');
        const body = filteredOrders.map(order => (
            `<tr>${columns.map(column => `<td>${escapeHtml(column.value(order))}</td>`).join('')}</tr>`
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
<div class="summary">${escapeHtml(title)} - ${filteredOrders.length} record(s)</div>
<table><thead><tr>${header}</tr></thead><tbody>${body}</tbody></table>
</body>
</html>`;
    };

    const openHistoryOverview = () => {
        const url = URL.createObjectURL(new Blob([buildHistoryReportHtml('RTX 5 History Overview')], { type: 'text/html' }));
        window.open(url, '_blank', 'noopener,noreferrer');
        window.setTimeout(() => URL.revokeObjectURL(url), 30_000);
    };

    const downloadHistoryHtml = () => {
        downloadTextFile(buildHistoryReportHtml('RTX 5 History Report'), 'rtx5-history-report.html', 'text/html');
    };

    const downloadHistoryXml = () => {
        const columns = getHistoryReportColumns();
        const rows = filteredOrders.map(order => (
            `<Row>${columns.map(column => `<Cell><Data ss:Type="String">${escapeHtml(column.value(order))}</Data></Cell>`).join('')}</Row>`
        )).join('');
        const xml = `<?xml version="1.0"?>
<?mso-application progid="Excel.Sheet"?>
<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet"
 xmlns:o="urn:schemas-microsoft-com:office:office"
 xmlns:x="urn:schemas-microsoft-com:office:excel"
 xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet">
<Worksheet ss:Name="History">
<Table>
<Row>${columns.map(column => `<Cell><Data ss:Type="String">${escapeHtml(column.label)}</Data></Cell>`).join('')}</Row>
${rows}
</Table>
</Worksheet>
</Workbook>`;
        downloadTextFile(xml, 'rtx5-history-report.xml', 'application/vnd.ms-excel');
    };

    const setTradeHistoryForSymbol = (symbol: string, visible: boolean) => {
        if (!symbol) return;
        const store = useChartSettingsStore.getState();
        store.updateSymbolProperty(symbol, 'showTradeHistory', visible);
        store.updateSymbolProperty(symbol, 'showTradeHistoryArrows', visible);
        window.dispatchEvent(new CustomEvent(visible ? 'rtx:refresh-trade-overlay' : 'rtx:flush-trade-overlay', { detail: { symbol } }));
    };

    const deleteAllTradeHistoryFromCharts = () => {
        const store = useChartSettingsStore.getState();
        store.updateGlobalProperty('showTradeHistory', false);
        store.updateGlobalProperty('showTradeHistoryArrows', false);
        const symbols = new Set([
            ...Object.keys(store.symbolProperties),
            ...availableSymbols.map(({ display }) => display),
        ]);
        symbols.forEach(symbol => {
            store.updateSymbolProperty(symbol, 'showTradeHistory', false);
            store.updateSymbolProperty(symbol, 'showTradeHistoryArrows', false);
        });
        setShowOnChartsAutoUpdate(false);
        window.dispatchEvent(new CustomEvent('rtx:flush-trade-overlay'));
    };

    const enableTradeHistoryAutoUpdate = () => {
        const store = useChartSettingsStore.getState();
        store.updateGlobalProperty('showTradeHistory', true);
        store.updateGlobalProperty('showTradeHistoryArrows', true);
        filteredPositionHistory.forEach(order => {
            const symbol = String(order.symbol ?? '').trim();
            if (!symbol) return;
            store.updateSymbolProperty(symbol, 'showTradeHistory', true);
            store.updateSymbolProperty(symbol, 'showTradeHistoryArrows', true);
        });
        setShowOnChartsAutoUpdate(true);
        window.dispatchEvent(new CustomEvent('rtx:refresh-trade-overlay'));
    };

    useEffect(() => {
        if (!showOnChartsAutoUpdate || filteredPositionHistory.length === 0) return;
        const symbols = Array.from(new Set(
            filteredPositionHistory.map(order => String(order.symbol ?? '').trim()).filter(Boolean),
        ));
        const needsChartHistory = symbols.some(symbol => {
            const store = useChartSettingsStore.getState();
            const properties = store.symbolProperties[symbol] ?? store.globalProperties;
            return properties.showTradeHistory !== true || properties.showTradeHistoryArrows !== true;
        });
        // Opening History must not redraw the chart when entry and close
        // markers are already enabled for these symbols.
        if (!needsChartHistory) return;
        const frame = window.requestAnimationFrame(() => {
            const store = useChartSettingsStore.getState();
            symbols.forEach(symbol => {
                const properties = store.symbolProperties[symbol] ?? store.globalProperties;
                if (properties.showTradeHistory !== true) store.updateSymbolProperty(symbol, 'showTradeHistory', true);
                if (properties.showTradeHistoryArrows !== true) store.updateSymbolProperty(symbol, 'showTradeHistoryArrows', true);
            });
            window.dispatchEvent(new CustomEvent('rtx:refresh-trade-overlay'));
        });
        return () => window.cancelAnimationFrame(frame);
    }, [filteredPositionHistory, showOnChartsAutoUpdate]);

    const buildHistoryContextMenuItems = (trade?: Trade): ContextMenuItemConfig[] => {
        const symbol = getHistoryRowSymbol(trade);
        const symbolsSubmenu: ContextMenuItemConfig[] = [
            { label: 'All Symbols', checked: symbolFilter.mode === 'all', action: () => setSymbolFilter({ mode: 'all' }) },
            {
                label: 'Current Symbol',
                checked: symbolFilter.mode === 'current',
                disabled: !currentSymbol,
                action: () => setSymbolFilter({ mode: 'current' }),
            },
            { divider: true },
            ...availableSymbols.map(({ normalized, display }) => ({
                label: display,
                checked: symbolFilter.mode === 'symbol' && normalizeTradeSymbol(symbolFilter.symbol) === normalized,
                action: () => setSymbolFilter({ mode: 'symbol', symbol: display }),
            })),
        ];
        return [
            {
                label: 'New Order',
                shortcut: 'F9',
                icon: <Icon name="plus" size="xs" />,
                disabled: !symbol,
                action: () => window.dispatchEvent(new CustomEvent('openOrderDialog', { detail: { symbol } })),
            },
            { label: 'Positions', checked: historyView === 'positions', action: () => setHistoryView('positions') },
            { label: 'Deals', checked: historyView === 'deals', action: () => setHistoryView('deals') },
            { label: 'Orders', checked: historyView === 'orders', action: () => setHistoryView('orders') },
            { label: 'Orders & Deals', checked: historyView === 'orders-and-deals', action: () => setHistoryView('orders-and-deals') },
            { divider: true },
            { label: 'Symbols', submenu: symbolsSubmenu },
            {
                label: 'Volumes',
                submenu: [
                    { label: 'Lots', checked: volumeMode === 'lots', action: () => setVolumeMode('lots'), autoClose: false },
                    { label: 'Amounts', checked: volumeMode === 'amounts', action: () => setVolumeMode('amounts'), autoClose: false },
                ],
            },
            { divider: true },
            { label: 'All History', checked: periodFilter === 'all', action: () => setPeriodFilter('all') },
            { label: 'Last 3 Months', checked: periodFilter === 'last-three-months', action: () => setPeriodFilter('last-three-months') },
            { label: 'Last Month', checked: periodFilter === 'last-month', action: () => setPeriodFilter('last-month') },
            {
                label: 'Custom Period',
                checked: periodFilter === 'custom',
                icon: <Icon name="settings" size="xs" />,
                action: openCustomPeriodDialog,
            },
            { divider: true },
            {
                label: 'Report',
                submenu: [
                    { label: 'Overview', shortcut: 'Alt+E', action: openHistoryOverview },
                    { label: 'Open XML (MS Office Excel 2007)', action: downloadHistoryXml },
                    { label: 'HTML (Internet Explorer)', action: downloadHistoryHtml },
                ],
            },
            {
                label: 'Show on Charts',
                submenu: [
                    { label: `Add ${symbol} Deals`, disabled: !symbol, action: () => setTradeHistoryForSymbol(symbol, true) },
                    { label: 'Delete All Deals', action: deleteAllTradeHistoryFromCharts },
                    {
                        label: 'Auto Update',
                        checked: showOnChartsAutoUpdate,
                        action: () => {
                            if (showOnChartsAutoUpdate) deleteAllTradeHistoryFromCharts();
                            else enableTradeHistoryAutoUpdate();
                        },
                        autoClose: false,
                    },
                ],
            },
            { label: 'Register as Signal', disabled: true },
            { divider: true },
            {
                label: 'Show Milliseconds',
                checked: showMilliseconds,
                action: () => setShowMilliseconds(current => !current),
                autoClose: false,
            },
            {
                label: 'Auto Arrange',
                checked: autoArrange,
                shortcut: 'A',
                action: () => setAutoArrange(current => !current),
                autoClose: false,
            },
            {
                label: 'Grid',
                checked: showGrid,
                shortcut: 'G',
                action: () => setShowGrid(current => !current),
                autoClose: false,
            },
            { divider: true },
            {
                label: 'Columns',
                submenu: HISTORY_COLUMN_DEFS.map(column => ({
                    label: column.label,
                    checked: isColumnVisible(column.key),
                    action: () => toggleColumn(column.key),
                    autoClose: false,
                })),
            },
        ];
    };

    const handleHistoryContextMenu = (event: React.MouseEvent<HTMLElement>, trade?: Trade) => {
        event.preventDefault();
        event.stopPropagation();
        if (trade) setSelectedTradeKey(getTradeKey(trade));
        setHistoryContextMenu({ x: event.clientX, y: event.clientY, ...(trade ? { trade } : {}) });
    };

    const syncHistoryViewport = useCallback(() => {
        const element = historyScrollRef.current;
        if (!element) return;
        const scrollTop = element.scrollTop;
        const measured = element.clientHeight;
        setHistoryViewport(current => {
            const height = measured > 0 ? measured : current.height;
            if (current.scrollTop === scrollTop && current.height === height) return current;
            return { scrollTop, height };
        });
    }, []);

    useLayoutEffect(() => {
        const element = historyScrollRef.current;
        if (element && element.scrollTop !== 0) element.scrollTop = 0;
        setHistoryViewport(current => current.scrollTop === 0 ? current : { ...current, scrollTop: 0 });
    }, [historyView, periodFilter, symbolFilter, customPeriod]);

    useLayoutEffect(() => {
        syncHistoryViewport();
        const element = historyScrollRef.current;
        if (!element || typeof ResizeObserver === 'undefined') return;
        const observer = new ResizeObserver(() => syncHistoryViewport());
        observer.observe(element);
        return () => observer.disconnect();
    }, [syncHistoryViewport, filteredOrders.length]);

    const historyVirtualWindow = useMemo(() => {
        const count = filteredOrders.length;
        const { scrollTop, height } = historyViewport;
        if (count === 0) {
            return { startIndex: 0, endIndex: 0, topSpacerHeight: 0, bottomSpacerHeight: 0 };
        }
        const rawStart = Math.max(0, Math.floor(scrollTop / HISTORY_ROW_HEIGHT) - HISTORY_OVERSCAN);
        const startIndex = Math.min(rawStart, count - 1);
        const endIndex = Math.min(
            count,
            Math.max(startIndex + 1, Math.ceil((scrollTop + height) / HISTORY_ROW_HEIGHT) + HISTORY_OVERSCAN),
        );
        return {
            startIndex,
            endIndex,
            topSpacerHeight: startIndex * HISTORY_ROW_HEIGHT,
            bottomSpacerHeight: Math.max(0, count - endIndex) * HISTORY_ROW_HEIGHT,
        };
    }, [filteredOrders.length, historyViewport]);
    const visibleHistoryOrders = filteredOrders.slice(historyVirtualWindow.startIndex, historyVirtualWindow.endIndex);
    const historyRowsLoading = filteredOrders.length === 0 && (
        loading || (ordersPending && (historyView === 'orders' || historyView === 'orders-and-deals'))
    );

    const headerDividerClass = showGrid ? 'border-r border-zinc-700/70' : '';
    const cellDividerClass = showGrid ? 'border-r border-zinc-800' : '';
    const rowDividerClass = showGrid ? 'divide-y divide-zinc-800/90' : '';

    return (
        <div className="rtx-history-tab h-full flex flex-col relative bg-[#131316] overflow-hidden">
            <div className="rtx-history-toolbar flex items-center gap-2 px-1.5 py-1 border-b border-zinc-700 bg-[#191a1e] shrink-0 text-[12px] font-normal text-zinc-300 tabular-nums">
                <div className="flex items-center gap-1">
                    {([
                        ['all', 'All History'],
                        ['last-three-months', 'Last 3 Months'],
                        ['last-month', 'Last Month'],
                    ] as const).map(([period, label]) => (
                        <button
                            key={period}
                            type="button"
                            onClick={() => setPeriodFilter(period)}
                            className={`rtx-history-time-btn px-2 py-0.5 text-[12px] font-normal rounded-sm transition-colors ${periodFilter === period ? 'bg-zinc-700/70 text-white' : 'text-zinc-400 hover:text-zinc-200'}`}
                        >
                            {tr(label)}
                        </button>
                    ))}
                    <button
                        type="button"
                        onClick={openCustomPeriodDialog}
                        className={`rtx-history-time-btn px-2 py-0.5 text-[12px] font-normal rounded-sm transition-colors ${periodFilter === 'custom' ? 'bg-zinc-700/70 text-white' : 'text-zinc-400 hover:text-zinc-200'}`}
                    >
                        {tr('Custom Period')}
                    </button>
                </div>
                <div className="flex-1" />
                <span className="text-[12px] font-normal text-zinc-500">{tr(historyViewLabel)} · {tr(symbolFilterLabel)} · {tr(periodFilterLabel)}</span>
                <span className="text-[12px] font-normal text-zinc-500">{filteredOrders.length} {tr(" records")}</span>
                <button
                    type="button"
                    onClick={() => fetchHistory({ force: true })}
                    disabled={loading}
                    className="rtx-history-refresh-btn text-[12px] font-normal px-2 py-0.5 rounded-sm bg-zinc-800 hover:bg-zinc-700 text-zinc-300 flex items-center gap-1 disabled:cursor-wait disabled:opacity-50"
                >
                    <Icon name="refresh" size="xs" className={loading ? 'animate-spin' : ''} />
                    {loading ? tr("Loading…") : tr("Refresh")}
                </button>
            </div>

            {displayError && filteredOrders.length > 0 && (
                <div
                    role="status"
                    className="shrink-0 border-b border-amber-700/50 bg-amber-950/30 px-2 py-1 text-[11px] text-amber-300"
                >
                    {tr('Partial history data')}: {displayError}
                </div>
            )}

            <div
                ref={historyScrollRef}
                className="rtx-trade-scroll flex-1 overflow-auto scrollbar-thin scrollbar-thumb-zinc-700"
                aria-label={tr('History records')}
                onScroll={syncHistoryViewport}
                onContextMenu={(event) => handleHistoryContextMenu(event)}
            >
                <table
                    className="rtx-trade-table rtx-history-table w-full text-center border-collapse"
                    aria-rowcount={filteredOrders.length + 1}
                    data-auto-arrange={autoArrange ? 'true' : 'false'}
                    data-grid={showGrid ? 'true' : 'false'}
                    style={{
                        fontFamily: '"Segoe UI", Tahoma, Arial, sans-serif',
                        fontVariantNumeric: 'tabular-nums',
                        tableLayout: autoArrange ? 'auto' : 'fixed',
                    }}
                >
                    <thead className="rtx-trade-table__head sticky top-0 bg-[#17181c] text-[#c9cfdb] z-10 font-normal text-[12px] leading-[18px] uppercase border-y border-zinc-700/70 select-none shadow-[0_1px_0_0_rgba(255,255,255,0.04)]">
                        <tr className="h-[30px]">
                            <th className={`px-1.5 py-[3px] text-center ${headerDividerClass} w-28`}>{tr("Time")}</th>
                            <th className={`px-1.5 py-[3px] text-center ${headerDividerClass} w-20`}>{tr("Symbol")}</th>
                            {isColumnVisible('ticket') && <th className={`px-1.5 py-[3px] text-center ${headerDividerClass} w-20`}>{tr("Ticket")}</th>}
                            <th className={`px-1.5 py-[3px] text-center ${headerDividerClass} w-14`}>{tr("Type")}</th>
                            <th className={`px-1.5 py-[3px] text-center ${headerDividerClass} w-16`}>{tr(volumeMode === 'lots' ? "Volume" : "Amount")}</th>
                            <th className={`px-1.5 py-[3px] text-center ${headerDividerClass} w-22`}>{tr("Price")}</th>
                            <th className={`px-1.5 py-[3px] text-center ${headerDividerClass} w-20`}>S/L</th>
                            <th className={`px-1.5 py-[3px] text-center ${headerDividerClass} w-20`}>T/P</th>
                            <th className={`px-1.5 py-[3px] text-center ${headerDividerClass} w-28`}>{tr("Time")}</th>
                            <th className={`px-1.5 py-[3px] text-center ${headerDividerClass} w-22`}>{tr("Price")}</th>
                            {isColumnVisible('marketValue') && <th className={`px-1.5 py-[3px] text-center ${headerDividerClass} w-24`}>{tr("Market Value")}</th>}
                            {isColumnVisible('commission') && <th className={`px-1.5 py-[3px] text-center ${headerDividerClass} w-20`}>{tr("Commission")}</th>}
                            {isColumnVisible('swap') && <th className={`px-1.5 py-[3px] text-center ${headerDividerClass} w-20`}>{tr("Swap")}</th>}
                            {isColumnVisible('fee') && <th className={`px-1.5 py-[3px] text-center ${headerDividerClass} w-20`}>{tr("Fee")}</th>}
                            <th className={`px-1.5 py-[3px] text-center ${headerDividerClass} w-20`}>{tr("Profit")}</th>
                            {isColumnVisible('changePercent') && <th className={`px-1.5 py-[3px] text-center ${headerDividerClass} w-20`}>{tr("Change %")}</th>}
                            {isColumnVisible('magicNumber') && <th className={`px-1.5 py-[3px] text-center ${headerDividerClass} w-24`}>{tr("Magic Number")}</th>}
                            {isColumnVisible('comment') && <th className="px-1.5 py-[3px] text-center w-28">{tr("Comment")}</th>}
                        </tr>
                    </thead>
                    <tbody className={`${rowDividerClass} text-[#d8dde8] text-[13px] leading-[19.5px] font-normal`}>
                        {filteredOrders.length === 0 && (
                            <tr>
                                <td colSpan={Math.max(1, visibleColumnCount)} className="h-16 text-center text-zinc-600 text-xs italic">
                                    {historyRowsLoading ? tr("Loading trade history…") : displayError ? displayError : tr("No history records for the selected filters")}
                                </td>
                            </tr>
                        )}
                        {historyVirtualWindow.topSpacerHeight > 0 && (
                            <tr aria-hidden="true" className="rtx-history-spacer-row" style={{ height: historyVirtualWindow.topSpacerHeight }}>
                                <td colSpan={Math.max(1, visibleColumnCount)} style={{ height: historyVirtualWindow.topSpacerHeight, padding: 0, border: 0, lineHeight: 0 }} />
                            </tr>
                        )}
                        {visibleHistoryOrders.map((order, visibleIndex) => {
                            const index = historyVirtualWindow.startIndex + visibleIndex;
                            const sideLabel = String(order.orderType || order.side || order.type || '-').toLowerCase();
                            const tradeKey = getTradeKey(order);
                            const isSelected = tradeKey === selectedTradeKey;
                            const ticket = getHistoryTicket(order);
                            const volumeLabel = formatHistoryVolume(order);
                            const marketValue = getHistoryMarketValue(order);
                            const marketValueLabel = marketValue === null ? '\u2014' : formatGroupedNumber(marketValue, 2, 2);
                            const changePercent = getHistoryChangePercent(order);
                            const changePercentLabel = formatHistoryPercent(order);
                            const profitLabel = formatMoney(order.profit);
                            return (
                                <tr
                                    key={`${tradeKey}-${index}`}
                                    aria-selected={isSelected}
                                    className={`rtx-trade-row rtx-history-row h-[30px] transition-colors cursor-default ${isSelected ? 'rtx-trade-row--selected' : ''}`}
                                    onClick={() => setSelectedTradeKey(tradeKey)}
                                    onContextMenu={(event) => handleHistoryContextMenu(event, order)}
                                >
                                    <td className={`px-1.5 py-[2px] ${cellDividerClass} text-center text-zinc-100 tabular-nums whitespace-nowrap`} title={tr("Open time: {{value0}}", { value0: formatTs(order.openTime) })}>{formatTs(order.openTime)}</td>
                                    <td className={`px-1.5 py-[2px] ${cellDividerClass} text-center font-normal text-zinc-100 whitespace-nowrap`} title={tr("Symbol: {{value0}}", { value0: order.symbol || '-' })}>{order.symbol || '-'}</td>
                                    {isColumnVisible('ticket') && <td className={`px-1.5 py-[2px] ${cellDividerClass} text-center text-zinc-100 tabular-nums whitespace-nowrap`} title={tr("Ticket: {{value0}}", { value0: ticket })}>{ticket}</td>}
                                    <td className={`${typeColor(order.side)} px-1.5 py-[2px] ${cellDividerClass} text-center font-normal text-[13px]`} title={tr("Type: {{value0}}", { value0: tr(sideLabel) })}>
                                        <div className="flex items-center justify-center"><span>{tr(sideLabel)}</span></div>
                                    </td>
                                    <td className={`px-1.5 py-[2px] ${cellDividerClass} text-center font-normal text-zinc-100 tabular-nums`} title={tr(volumeMode === 'lots' ? "Volume: {{value0}}" : "Amount: {{value0}}", { value0: volumeLabel })}>{volumeLabel}</td>
                                    <td className={`px-1.5 py-[2px] ${cellDividerClass} text-center text-zinc-100 tabular-nums`} title={tr("Open price: {{value0}}", { value0: formatPriceCell(order.openPrice, order.symbol) })}>{formatPriceCell(order.openPrice, order.symbol)}</td>
                                    <td className={`px-1.5 py-[2px] ${cellDividerClass} text-center tabular-nums`} title={tr("Stop Loss: {{value0}}", { value0: formatLevelCell(order.sl, order.symbol) })}>
                                        <span className={(order.sl ?? 0) > 0 ? "text-[#ff7676] bg-red-950/20 px-1 rounded-sm font-normal" : "text-zinc-100 font-normal"}>{formatLevelCell(order.sl, order.symbol)}</span>
                                    </td>
                                    <td className={`px-1.5 py-[2px] ${cellDividerClass} text-center tabular-nums`} title={tr("Take Profit: {{value0}}", { value0: formatLevelCell(order.tp, order.symbol) })}>
                                        <span className={(order.tp ?? 0) > 0 ? "text-[#34dca0] bg-emerald-900/20 px-1 rounded-sm font-normal" : "text-zinc-100 font-normal"}>{formatLevelCell(order.tp, order.symbol)}</span>
                                    </td>
                                    <td className={`px-1.5 py-[2px] ${cellDividerClass} text-center text-zinc-100 tabular-nums whitespace-nowrap`} title={tr("Close time: {{value0}}", { value0: formatTs(order.closeTime) })}>{formatTs(order.closeTime)}</td>
                                    <td className={`px-1.5 py-[2px] ${cellDividerClass} text-center text-zinc-100 tabular-nums`} title={tr("Close price: {{value0}}", { value0: formatPriceCell(order.closePrice, order.symbol) })}>{formatPriceCell(order.closePrice, order.symbol)}</td>
                                    {isColumnVisible('marketValue') && <td className={`px-1.5 py-[2px] ${cellDividerClass} text-center text-zinc-100 tabular-nums`} title={tr("Market Value: {{value0}}", { value0: marketValueLabel })}>{marketValueLabel}</td>}
                                    {isColumnVisible('commission') && <td className={`px-1.5 py-[2px] ${cellDividerClass} text-center tabular-nums ${moneyColor(order.commission)}`} title={tr("Commission: {{value0}}", { value0: formatMoney(order.commission) })}>{formatMoney(order.commission)}</td>}
                                    {isColumnVisible('swap') && <td className={`px-1.5 py-[2px] ${cellDividerClass} text-center tabular-nums ${moneyColor(order.swap)}`} title={tr("Swap: {{value0}}", { value0: formatMoney(order.swap) })}>{formatMoney(order.swap)}</td>}
                                    {isColumnVisible('fee') && <td className={`px-1.5 py-[2px] ${cellDividerClass} text-center tabular-nums ${moneyColor(order.fee)}`} title={tr("Fee: {{value0}}", { value0: formatMoney(order.fee) })}>{formatMoney(order.fee)}</td>}
                                    <td className={`px-1.5 py-[2px] ${cellDividerClass} text-center font-normal tabular-nums ${moneyColor(order.profit)}`} title={tr("Profit: {{value0}}", { value0: profitLabel })}>{profitLabel}</td>
                                    {isColumnVisible('changePercent') && <td className={`px-1.5 py-[2px] ${cellDividerClass} text-center tabular-nums ${moneyColor(changePercent)}`} title={tr("Change %: {{value0}}", { value0: changePercentLabel })}>{changePercentLabel}</td>}
                                    {isColumnVisible('magicNumber') && <td className={`px-1.5 py-[2px] ${cellDividerClass} text-center text-zinc-100 tabular-nums`} title={tr("Magic Number: {{value0}}", { value0: order.magicNumber ?? '-' })}>{order.magicNumber ?? '-'}</td>}
                                    {isColumnVisible('comment') && <td className="px-1.5 py-[2px] text-center text-zinc-100 whitespace-nowrap" title={tr("Comment: {{value0}}", { value0: order.comment || '-' })}>{order.comment || '-'}</td>}
                                </tr>
                            );
                        })}
                        {historyVirtualWindow.bottomSpacerHeight > 0 && (
                            <tr aria-hidden="true" className="rtx-history-spacer-row" style={{ height: historyVirtualWindow.bottomSpacerHeight }}>
                                <td colSpan={Math.max(1, visibleColumnCount)} style={{ height: historyVirtualWindow.bottomSpacerHeight, padding: 0, border: 0, lineHeight: 0 }} />
                            </tr>
                        )}
                    </tbody>
                </table>
            </div>

            {historyContextMenu && (
                <ContextMenu
                    variant={isLightSkin ? 'mt5-light' : 'mt5-dark'}
                    density="compact"
                    items={buildHistoryContextMenuItems(historyContextMenu.trade)}
                    position={{ x: historyContextMenu.x, y: historyContextMenu.y }}
                    onClose={() => setHistoryContextMenu(null)}
                />
            )}

            {customPeriodDialogOpen && (
                <div
                    className="rtx-history-period-backdrop fixed inset-0 z-[4100] flex items-center justify-center bg-black/45"
                    onMouseDown={(event) => {
                        if (event.target === event.currentTarget) setCustomPeriodDialogOpen(false);
                    }}
                >
                    <form
                        role="dialog"
                        aria-modal="true"
                        aria-label={tr('Custom history period')}
                        className="rtx-history-period-dialog w-[360px] rounded-sm border border-zinc-600 bg-[#202126] p-4 text-[12px] text-zinc-200 shadow-2xl"
                        onKeyDown={(event) => {
                            if (event.key === 'Escape') setCustomPeriodDialogOpen(false);
                        }}
                        onSubmit={(event) => {
                            event.preventDefault();
                            applyCustomPeriod();
                        }}
                    >
                        <div className="mb-3 text-[13px] font-semibold">{tr('Custom Period')}</div>
                        <div className="grid grid-cols-2 gap-3">
                            <label className="flex flex-col gap-1">
                                <span>{tr('From')}</span>
                                <input
                                    aria-label={tr('From')}
                                    type="date"
                                    value={customPeriodDraft.from}
                                    onChange={(event) => setCustomPeriodDraft(current => ({ ...current, from: event.target.value }))}
                                    className="rtx-history-period-input rounded-sm border border-zinc-600 bg-[#15161a] px-2 py-1.5 text-zinc-100"
                                />
                            </label>
                            <label className="flex flex-col gap-1">
                                <span>{tr('To')}</span>
                                <input
                                    aria-label={tr('To')}
                                    type="date"
                                    value={customPeriodDraft.to}
                                    onChange={(event) => setCustomPeriodDraft(current => ({ ...current, to: event.target.value }))}
                                    className="rtx-history-period-input rounded-sm border border-zinc-600 bg-[#15161a] px-2 py-1.5 text-zinc-100"
                                />
                            </label>
                        </div>
                        {customPeriodError && <div role="alert" className="mt-2 text-[#ff7676]">{tr(customPeriodError)}</div>}
                        <div className="mt-4 flex justify-end gap-2">
                            <button
                                type="button"
                                onClick={() => setCustomPeriodDialogOpen(false)}
                                className="rounded-sm border border-zinc-600 px-3 py-1.5 hover:bg-zinc-700/60"
                            >
                                {tr('Cancel')}
                            </button>
                            <button
                                type="submit"
                                className="rounded-sm bg-[#0078d4] px-3 py-1.5 text-white hover:bg-[#1686d9]"
                            >
                                {tr('Apply')}
                            </button>
                        </div>
                    </form>
                </div>
            )}
        </div>
    );
}




function PlaceholderTab({ title }: { title: string }) {
    const tr = useUiTranslation();
    return (
        <div className="flex-1 flex flex-col items-center justify-center text-zinc-600 bg-[#131316]">
            <Icon name="briefcase" size="xl" className="mb-2 opacity-20" />
            <div className="text-[12px] font-normal">{tr("RTX5 ")}{tr(title)}</div>
            <div className="text-[12px] font-normal">{tr("No active items to display")}</div>
        </div>
    );
}
