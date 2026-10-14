import { lazy, memo, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { X } from 'lucide-react';
import { useUiTranslation } from '../hooks/useUiTranslation';
import { Icon } from './ui/Icon';
import { isUnavailableDockSection, unavailableDockSections } from '../config/terminalToolAvailability';
import { RetainedLazyFeature } from '../startup/RetainedLazyFeature';
import { useAppStore } from '../store/useAppStore';
import { useToolboxTradeData } from '../hooks/useToolboxTradeData';
import { loadTerminalHistory, resetTerminalHistorySession } from '../services/terminalHistory';
import { acknowledgeBottomDockTab, getRequestedBottomDockTab } from '../services/bottomDockNavigation';
import { onCommittedBrokerAccountSessionScopeChange } from '../services/brokerSession';
import type {
  CancelOrderAction,
  CloseBulkPositionsAction,
  ClosePositionAction,
  ModifyPositionAction,
} from '../contracts/tradeActions';
import { ExposureTab } from '../features/bottom-dock/exposure/ExposureTab';
import { createPreloadableFeature } from '../startup/createPreloadableFeature';
import { getCurrentBrokerAccountSessionScopeKey } from '../features/bottom-dock/sessionScope';
import { ToolboxTab } from '../features/bottom-dock/toolbox/ToolboxTab';
import { TradeTab } from '../features/bottom-dock/trade/TradeTab';
import { useBottomDockStoreBridge } from '../features/bottom-dock/useBottomDockStoreBridge';
import { resolveTradeAccountMetrics } from './BottomDock.trade';

const LazyHistoryDownloader = lazy(async () => {
  const module = await import('./HistoryDownloader');
  return { default: module.HistoryDownloader };
});

const CalendarTab = lazy(() => import('./layout/CalendarTab').then(module => ({ default: module.CalendarTab })));
const CodeBaseTab = lazy(() => import('./layout/ResearchTabs').then(module => ({ default: module.CodeBaseTab })));
const ArticlesTab = lazy(() => import('./layout/ResearchTabs').then(module => ({ default: module.ArticlesTab })));
const ExpertsTab = lazy(() => import('./layout/ResearchTabs').then(module => ({ default: module.ExpertsTab })));
const JournalTab = lazy(() => import('./layout/JournalTab').then(module => ({ default: module.JournalTab })));
const historyFeature = createPreloadableFeature(() => import('../features/bottom-dock/history/HistoryTab').then(module => ({ default: module.HistoryTab })));

const MemoToolboxTab = memo(ToolboxTab);
const MemoExposureTab = memo(ExposureTab);
const MemoHistoryTab = memo(historyFeature.Component);
const MemoCalendarTab = memo(CalendarTab);
const MemoCodeBaseTab = memo(CodeBaseTab);
const MemoArticlesTab = memo(ArticlesTab);
const MemoExpertsTab = memo(ExpertsTab);
const MemoJournalTab = memo(JournalTab);

const HIDDEN_TAB_ROWS: never[] = [];

interface BottomDockProps {
  height?: number | string;
  onHeightChange?: (height: number) => void;
  onClose?: () => void;
  onClosePosition: ClosePositionAction;
  onModifyPosition: ModifyPositionAction;
  onCancelOrder?: CancelOrderAction;
  onCloseBulk?: CloseBulkPositionsAction;
  historyInstrumentCatalog?: readonly unknown[];
}

type TabType = 'Toolbox' | 'Trade' | 'Exposure' | 'History' | 'News' | 'Mailbox' | 'Calendar' | 'Company' | 'Alerts' | 'Articles' | 'Code Base' | 'Experts' | 'Journal' | 'Historical Data';

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

export function BottomDock({
    height,
    onHeightChange,
    onClose,
    onClosePosition,
    onModifyPosition,
    onCloseBulk,
    historyInstrumentCatalog,
}: BottomDockProps) {
    const tr = useUiTranslation();
    // Read trading data directly from store — NOT from props
    // This prevents DockWorkspace.renderPanel from needing to re-create when positions change
    const { account, positions } = useBottomDockStoreBridge();
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

    // Persist active tab selection
    useEffect(() => {
        localStorage.setItem('bottomdock-active-tab', activeTab);
    }, [activeTab]);

    useEffect(() => {
        if (activeTab === 'History') {
            // History remains mounted after its first activation so its loaded rows stay warm.
            setHistoryMounted(true);
        }
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
            // Navigation requests are external service state consumed on mount.
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
            // The Journal transition deliberately mirrors this externally supplied account state.
            setActiveTab('Journal');
        }

        prevEquityRef.current = eq;
    // Account scope/metadata is resolved inside the effect; these fields are its intended trigger.
    // eslint-disable-next-line react-hooks/exhaustive-deps
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

            {onClose && (
                <div
                    className="rtx-bottom-dock__header dock-panel__header flex h-6 shrink-0 items-center px-1.5 border-b"
                    style={{ background: 'var(--bg-secondary)', borderColor: 'var(--border-primary)' }}
                >
                    <span className="dock-panel__title flex-1 min-w-0 truncate text-xs" style={{ color: 'var(--text-secondary)' }}>{tr("Toolbox")}</span>
                    <button
                        type="button"
                        title={tr("Close")}
                        aria-label={tr("Close Toolbox")}
                        onClick={onClose}
                        className="dock-panel__action dock-panel__action--close flex h-4 w-4 shrink-0 items-center justify-center rounded-sm text-zinc-400 transition-colors hover:bg-red-500/80 hover:text-white focus-visible:outline focus-visible:outline-1 focus-visible:outline-current"
                    >
                        <X className="h-3 w-3" aria-hidden="true" />
                    </button>
                </div>
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
                        <Suspense fallback={null}>
                        <MemoHistoryTab
                            formatMoney={formatMoney}
                            instrumentCatalog={historyInstrumentCatalog}
                            accountBalance={resolveTradeAccountMetrics(toolboxTrade.account ?? account).balance}
                        />
                        </Suspense>
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
                <div className="rtx-bottom-dock__tab-content flex h-full min-w-0 items-stretch overflow-hidden">
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
                                aria-label={unavailableReason ? tr(tab.id) : `${tr(tab.id)} — ${tr(TAB_HOVER_COMMENTS[tab.id])}`}
                                aria-description={tr(unavailableReason || TAB_HOVER_COMMENTS[tab.id])}
                                onMouseEnter={() => { if (tab.id === 'History') void historyFeature.preload().catch(() => undefined); }}
                                onFocus={() => { if (tab.id === 'History') void historyFeature.preload().catch(() => undefined); }}
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
        </div>
    );
}

function PlaceholderTab({ title }: { title: string }) {
    const tr = useUiTranslation();
    return (
        <div
            className="rtx-placeholder-tab flex-1 h-full flex flex-col items-center justify-center select-none px-4"
            style={{
                background: 'var(--bg-secondary, #131316)',
                color: 'var(--text-tertiary, #808088)',
            }}
        >
            <div
                className="flex flex-col items-center justify-center rounded-md px-6 py-4 text-center"
                style={{
                    background: 'var(--bg-tertiary, #191a1e)',
                    border: '1px solid var(--border-primary, #28282e)',
                }}
            >
                <Icon name="briefcase" size="lg" className="mb-2 opacity-35" />
                <div
                    className="text-[13px] leading-[19.5px] font-normal mb-0.5"
                    style={{ color: 'var(--text-primary, #e2e2e8)' }}
                >
                    {tr("RTX5 ")}{tr(title)}
                </div>
                <div
                    className="text-[12px] leading-[18px] font-normal"
                    style={{ color: 'var(--text-tertiary, #808088)' }}
                >
                    {tr("No active items to display")}
                </div>
            </div>
        </div>
    );
}

export { ToolboxTab };
