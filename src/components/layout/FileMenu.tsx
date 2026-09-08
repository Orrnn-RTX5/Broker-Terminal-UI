import { Icon } from '../ui/Icon';
import React, { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { SaveWorkspaceDialog } from '../dialogs/SaveWorkspaceDialog';
import { PrintSetupDialog } from '../dialogs/PrintSetupDialog';
import { PrintPreviewDialog } from '../dialogs/PrintPreviewDialog';
import { ExitConfirmDialog } from '../dialogs/ExitConfirmDialog';
import { SavePictureDialog } from '../dialogs/SavePictureDialog';
import { OpenAccountDialog } from '../dialogs/OpenAccountDialog';
import { useAppStore } from '../../store/useAppStore';
import { chartPrinter, type PrintPreferences, type ChartPrintData } from '../../services/chartPrinter';
import {
    getActiveChartSource,
    type ResolvedActiveChartSource,
} from '../../services/activeChartSource';
import { useDesktopRelease } from '../../hooks/useDesktopRelease';
import { useDockLayoutStore } from '../../store/useDockLayoutStore';
import {
    listWorkspaceProfiles,
    restoreWorkspaceProfile,
    saveCurrentWorkspaceProfile,
    type WorkspaceProfileSummary,
} from '../../services/localWorkspaceProfiles';
import {
    getDesktopReleaseButtonTitle,
    getDesktopReleaseVersionLabel,
    openDesktopReleaseDownload,
} from '../../services/desktopRelease';

type ElectronRuntime = NonNullable<Window['electron']> & {
    app?: {
        quit?: () => void;
    };
};

interface SymbolData {
    symbol: string;
    name: string;
    category: string;
}

interface NewChartMenuItem {
    label: string;
    symbol?: string;
    children?: NewChartMenuItem[];
}

// Organized symbol catalog for YoForex broker
const YOFOREX_SYMBOLS: { group: string; pairs: { symbol: string; desc: string }[] }[] = [
    {
        group: 'Major Pairs',
        pairs: [
            { symbol: 'EURUSD', desc: 'Euro / US Dollar' },
            { symbol: 'GBPUSD', desc: 'Pound / US Dollar' },
            { symbol: 'USDJPY', desc: 'US Dollar / Yen' },
            { symbol: 'USDCHF', desc: 'US Dollar / Franc' },
            { symbol: 'AUDUSD', desc: 'Aussie / US Dollar' },
            { symbol: 'USDCAD', desc: 'US Dollar / CAD' },
            { symbol: 'NZDUSD', desc: 'Kiwi / US Dollar' },
        ]
    },
    {
        group: 'Cross Pairs',
        pairs: [
            { symbol: 'EURGBP', desc: 'Euro / Pound' },
            { symbol: 'EURJPY', desc: 'Euro / Yen' },
            { symbol: 'EURCHF', desc: 'Euro / Franc' },
            { symbol: 'EURAUD', desc: 'Euro / Aussie' },
            { symbol: 'EURCAD', desc: 'Euro / CAD' },
            { symbol: 'EURNZD', desc: 'Euro / Kiwi' },
            { symbol: 'GBPJPY', desc: 'Pound / Yen' },
            { symbol: 'GBPCHF', desc: 'Pound / Franc' },
            { symbol: 'GBPAUD', desc: 'Pound / Aussie' },
            { symbol: 'GBPCAD', desc: 'Pound / CAD' },
            { symbol: 'GBPNZD', desc: 'Pound / Kiwi' },
            { symbol: 'AUDJPY', desc: 'Aussie / Yen' },
            { symbol: 'AUDCHF', desc: 'Aussie / Franc' },
            { symbol: 'AUDCAD', desc: 'Aussie / CAD' },
            { symbol: 'AUDNZD', desc: 'Aussie / Kiwi' },
            { symbol: 'CADJPY', desc: 'CAD / Yen' },
            { symbol: 'CADCHF', desc: 'CAD / Franc' },
            { symbol: 'NZDJPY', desc: 'Kiwi / Yen' },
            { symbol: 'NZDCHF', desc: 'Kiwi / Franc' },
            { symbol: 'CHFJPY', desc: 'Franc / Yen' },
        ]
    },
    {
        group: 'Metals & Crypto',
        pairs: [
            { symbol: 'XAUUSD', desc: 'Gold / US Dollar' },
            { symbol: 'XAGUSD', desc: 'Silver / US Dollar' },
            { symbol: 'BTCUSD', desc: 'Bitcoin / US Dollar' },
            { symbol: 'ETHUSD', desc: 'Ethereum / US Dollar' },
        ]
    },
];

// YoForex symbol panel – clean pair list only
const YoForexPanel: React.FC<{
    activePair: string;
    onSelect: (sym: string) => void;
}> = ({ activePair, onSelect }) => {
    const [search, setSearch] = React.useState('');

    const filtered = YOFOREX_SYMBOLS.map(grp => ({
        ...grp,
        pairs: grp.pairs.filter(p =>
            p.symbol.toLowerCase().includes(search.toLowerCase())
        )
    })).filter(grp => grp.pairs.length > 0);

    return (
        <div className="rtx-menu-surface flex flex-col overflow-hidden" style={{ width: 180, maxHeight: 420 }}>
            {/* Search */}
            <div className="px-2 pt-2 pb-1 flex-none">
                <div className="flex items-center gap-1.5 bg-[#111] [.rtx-advanced-view_&]:bg-gray-100 border border-zinc-700/60 [.rtx-advanced-view_&]:border-gray-200 rounded px-2 py-1">
                    <svg className="w-3 h-3 text-zinc-500 [.rtx-advanced-view_&]:text-gray-500 flex-none" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                    </svg>
                    <input
                        autoFocus
                        value={search}
                        onChange={e => setSearch(e.target.value)}
                        placeholder="Search..."
                        className="bg-transparent text-[14px] font-normal text-zinc-200 [.rtx-advanced-view_&]:text-gray-900 placeholder-zinc-600 [.rtx-advanced-view_&]:placeholder-gray-400 outline-none w-full"
                        onClick={e => e.stopPropagation()}
                    />
                </div>
            </div>
            {/* Pair list */}
            <div className="overflow-y-auto flex-1 pb-1 px-1" style={{ scrollbarWidth: 'none' }}>
                {filtered.map(grp => (
                    <div key={grp.group}>
                        <div className="px-2 pt-2 pb-0.5 text-[12px] font-medium tracking-widest text-zinc-600 [.rtx-advanced-view_&]:text-gray-500 uppercase">{grp.group}</div>
                        {grp.pairs.map(p => {
                            const isActive = activePair === p.symbol;
                            return (
                                <button
                                    key={p.symbol}
                                    onClick={() => onSelect(p.symbol)}
                                    className={`w-full flex min-h-[30px] items-center gap-1.5 px-2 py-1.5 text-[14px] font-normal rounded text-left cursor-default transition-colors duration-75 ${isActive
                                            ? 'text-emerald-400 [.rtx-advanced-view_&]:text-emerald-600 bg-emerald-500/10 [.rtx-advanced-view_&]:bg-emerald-50'
                                            : 'text-zinc-300 [.rtx-advanced-view_&]:text-[#374151] hover:bg-[#2a2e39] [.rtx-advanced-view_&]:hover:bg-[#f3f4f6] hover:text-white [.rtx-advanced-view_&]:hover:text-[#111827]'
                                        }`}
                                >
                                    <span className={`text-[10px] w-3 flex-none ${isActive ? 'text-emerald-400 [.rtx-advanced-view_&]:text-emerald-600' : 'text-transparent'}`}>✓</span>
                                    <span className="font-mono">{p.symbol}</span>
                                </button>
                            );
                        })}
                    </div>
                ))}
                {filtered.length === 0 && (
                    <div className="px-3 py-3 text-center text-[12px] font-normal text-zinc-600 [.rtx-advanced-view_&]:text-gray-500">No pairs found</div>
                )}
            </div>
        </div>
    );
};

// Recursive menu item renderer (for API-loaded symbols)
const NewChartMenuItemRenderer: React.FC<{ item: NewChartMenuItem; activePair?: string; onClose?: () => void }> = ({ item, activePair, onClose }) => {
    const hasChildren = item.children && item.children.length > 0;
    const isActive = item.symbol && item.symbol === activePair;

    const handleClick = () => {
        if (item.symbol) {
            window.dispatchEvent(new CustomEvent('openChart', { detail: { symbol: item.symbol, newTab: true } }));
            onClose?.();
        }
    };

    return (
        <div className="relative group/sub px-1 [&:hover>div.submenu]:block">
            <button
                onClick={handleClick}
                className={`w-full flex min-h-[30px] items-center gap-2 px-2 py-1.5 text-[14px] font-normal rounded-sm text-left cursor-default group ${isActive ? 'text-emerald-400 [.rtx-advanced-view_&]:text-emerald-600 bg-emerald-500/10 [.rtx-advanced-view_&]:bg-emerald-50' : 'text-zinc-300 [.rtx-advanced-view_&]:text-[#374151] hover:bg-[#2a2e39] [.rtx-advanced-view_&]:hover:bg-[#f3f4f6] hover:text-white [.rtx-advanced-view_&]:hover:text-[#111827]'
                    }`}
            >
                <span className="w-3 text-[10px] flex-none">{isActive ? '✓' : ''}</span>
                <span className="flex-1 font-mono">{item.label}</span>
                {hasChildren && <Icon name="chevron-right" size="xs" className="rtx-menu-icon--neutral" />}
            </button>
            {hasChildren && (
                <div className="rtx-menu-surface submenu absolute left-full top-0 -ml-1 hidden min-w-[200px] py-1 z-[102] max-h-[400px] overflow-y-auto no-scrollbar">
                    {item.children!.map((child, idx) => (
                        <NewChartMenuItemRenderer key={idx} item={child} activePair={activePair} onClose={onClose} />
                    ))}
                </div>
            )}
        </div>
    );
};

export interface FileMenuProps {
    onSave?: (workspaceName?: string) => void;
    onSaveAsPicture?: () => void;
    onOpenDataFolder?: () => void;
    onPrint?: (chartData: ChartPrintData, preferences: PrintPreferences) => void | Promise<void>;
    onPrintPreview?: () => void;
    onPrintSetup?: () => void;
    onCloseActiveChart?: () => void;
    onChartRestored?: () => void;
    onProfileRestored?: (profileName: string) => void;
    onLoginTrade?: () => void;
    onLoginWebTrader?: () => void;
    accountId?: string;
    onLogout?: () => void;
    onDialogOpenChange?: (open: boolean) => void;
    onExit?: () => void;
    hasUnsavedChanges?: boolean;
}

export const FileMenu: React.FC<FileMenuProps> = ({
    onSave,
    onSaveAsPicture,
    onOpenDataFolder,
    onPrint,
    onPrintPreview,
    onPrintSetup,
    onCloseActiveChart,
    onChartRestored,
    onProfileRestored,
    onLoginTrade,
    onLoginWebTrader,
    accountId,
    onLogout,
    onDialogOpenChange,
    onExit,
    hasUnsavedChanges = false
}) => {
    const { t } = useTranslation();
    const [showSaveDialog, setShowSaveDialog] = useState(false);
    const [showSavePictureDialog, setShowSavePictureDialog] = useState(false);
    const [savePictureSource, setSavePictureSource] = useState<ResolvedActiveChartSource | null>(null);
    const [showPrintSetupDialog, setShowPrintSetupDialog] = useState(false);
    const [showPrintPreviewDialog, setShowPrintPreviewDialog] = useState(false);
    const [showExitDialog, setShowExitDialog] = useState(false);
    const [showOpenAccountDialog, setShowOpenAccountDialog] = useState(false);
    const [newChartOpen, setNewChartOpen] = useState(false);
    const [workspaceProfiles, setWorkspaceProfiles] = useState<WorkspaceProfileSummary[]>([]);
    const recentlyClosedCharts = useDockLayoutStore(state => state.recentlyClosedCharts);
    const showDesktopDownload = typeof window !== 'undefined' && !window.electron;
    const desktopReleaseState = useDesktopRelease({ enabled: showDesktopDownload });
    const desktopReleaseVersionLabel = getDesktopReleaseVersionLabel(desktopReleaseState.release);
    const desktopReleaseMetaLabel = desktopReleaseVersionLabel || (desktopReleaseState.status === 'loading' ? 'Latest' : '');

    useEffect(() => {
        const refreshProfiles = () => {
            if (!accountId?.trim()) {
                setWorkspaceProfiles([]);
                return;
            }
            try {
                setWorkspaceProfiles(listWorkspaceProfiles(accountId));
            } catch (error) {
                console.warn('[FileMenu] Could not load workspace profiles:', error);
                setWorkspaceProfiles([]);
            }
        };

        refreshProfiles();
        window.addEventListener('workspace:profile-saved', refreshProfiles);
        return () => window.removeEventListener('workspace:profile-saved', refreshProfiles);
    }, [accountId]);

    useEffect(() => {
        onDialogOpenChange?.(
            showSaveDialog
            || showSavePictureDialog
            || showPrintSetupDialog
            || showPrintPreviewDialog
            || showExitDialog
            || showOpenAccountDialog,
        );
    }, [
        onDialogOpenChange,
        showExitDialog,
        showOpenAccountDialog,
        showPrintPreviewDialog,
        showPrintSetupDialog,
        showSaveDialog,
        showSavePictureDialog,
    ]);

    // Dynamic symbol loading for New Chart menu
    const [availableSymbols, setAvailableSymbols] = useState<SymbolData[]>([]);
    const [isLoadingSymbols, setIsLoadingSymbols] = useState(false);
    const isAuthenticated = useAppStore(state => state.isAuthenticated);

    // Fetch symbols on mount
    useEffect(() => {
        if (!isAuthenticated) {
            setAvailableSymbols([]);
            setIsLoadingSymbols(false);
            return;
        }

        const fetchSymbols = async () => {
            try {
                const { default: api } = await import('../../services/api');
                setIsLoadingSymbols(true);
                const symbols = await api.market.getSymbols();
                if (symbols && symbols.length > 0) {
                    setAvailableSymbols(symbols.map(s => ({
                        symbol: s.id || s.name, // Mapping id or name to symbol
                        name: s.name,
                        category: s.category
                    })));
                }
            } catch (error) {
                console.error('Failed to load menu symbols:', error);
            } finally {
                setIsLoadingSymbols(false);
            }
        };

        fetchSymbols();
    }, [isAuthenticated]);

    // Build nested menu structure from flat symbol list
    const buildNestedMenu = (symbols: SymbolData[]): NewChartMenuItem[] => {
        const root: NewChartMenuItem[] = [];
        const groups: Record<string, SymbolData[]> = {};

        symbols.forEach(sym => {
            // If category is empty, it's a root item
            if (!sym.category || sym.category.trim() === '') {
                root.push({
                    label: sym.name,
                    symbol: sym.symbol
                });
                return;
            }

            const parts = sym.category.split('.');
            const topLevel = parts[0];
            if (!groups[topLevel]) groups[topLevel] = [];

            if (parts.length > 1) {
                groups[topLevel].push({ ...sym, category: parts.slice(1).join('.') });
            } else {
                groups[topLevel].push({ ...sym, category: '' });
            }
        });

        // Add grouped items (folders) after root items
        Object.keys(groups).sort().forEach(key => {
            const groupSymbols = groups[key];
            root.push({
                label: key,
                children: buildNestedMenu(groupSymbols)
            });
        });

        return root;
    };

    const newChartMenuItems = buildNestedMenu(availableSymbols);

    // Get current symbol and timeframe from store
    const selectedSymbol = useAppStore(state => state.selectedSymbol);
    const timeframe = useAppStore(state => state.timeframe);

    // Print state
    const [printPreferences, setPrintPreferences] = useState<PrintPreferences | null>(null);
    const [chartPrintData, setChartPrintData] = useState<ChartPrintData | null>(null);

    const handleSave = () => {
        setShowSaveDialog(true);
    };

    const handleSaveAsPicture = () => {
        const source = getActiveChartSource();
        const canvas = source?.canvas ?? null;
        const container = source?.container ?? null;

        if (!canvas && !container) {
            console.warn('[FileMenu] No active chart canvas or container found for export');
            alert('No chart available to export. Please open a chart first.');
            return;
        }

        setSavePictureSource(source);
        setShowSavePictureDialog(true);
        onSaveAsPicture?.();
    };

    const handleOpenDataFolder = () => {
        onOpenDataFolder?.();
    };

    const handleDownloadDesktop = () => {
        openDesktopReleaseDownload(desktopReleaseState.release);
    };

    const handlePrint = async (chartData?: ChartPrintData) => {
        const data = chartData || generateChartPrintData();
        const preferences = printPreferences || chartPrinter.getPreferences(accountId);

        if (onPrint) {
            await onPrint(data, preferences);
        } else {
            await chartPrinter.printChart(data, preferences);
        }
    };

    const handleCloseActiveChart = () => {
        if (onCloseActiveChart) {
            onCloseActiveChart();
            return;
        }
        useDockLayoutStore.getState().closeActiveChart(selectedSymbol);
    };

    const handleRestoreChart = (panelId: string) => {
        if (useDockLayoutStore.getState().restoreClosedChart(panelId)) {
            onChartRestored?.();
        }
    };

    const handleRestoreProfile = (profileName: string) => {
        if (!accountId?.trim()) return;
        try {
            const result = restoreWorkspaceProfile({ accountId, profileName });
            if (result.status === 'restored') {
                onProfileRestored?.(result.profile.name);
            }
        } catch (error) {
            console.error('[FileMenu] Failed to restore workspace profile:', error);
            window.alert(error instanceof Error ? error.message : 'The workspace profile could not be restored.');
        }
    };

    const handlePrintPreview = () => {
        onPrintPreview?.();
        // Generate chart data for preview
        const data = generateChartPrintData();
        setChartPrintData(data);
        setShowPrintPreviewDialog(true);
    };

    const handlePrintSetup = () => {
        onPrintSetup?.();
        setShowPrintSetupDialog(true);
    };

    const generateChartPrintData = (): ChartPrintData => {
        const activeSource = getActiveChartSource();
        const chartContainer = activeSource?.container
            || document.querySelector('.tv-lightweight-charts');
        let chartCanvas: HTMLCanvasElement | undefined;

        const canvas = activeSource?.canvas || chartContainer?.querySelector('canvas');
        if (canvas) {
            const copiedCanvas = document.createElement('canvas');
            copiedCanvas.width = canvas.width;
            copiedCanvas.height = canvas.height;
            const ctx = copiedCanvas.getContext('2d');
            if (ctx) {
                ctx.drawImage(canvas, 0, 0);
                chartCanvas = copiedCanvas;
            }
        }

        return {
            symbol: activeSource?.symbol || selectedSymbol || 'BTCUSD',
            timeframe: activeSource?.timeframe || timeframe || 'M1',
            dateRange: {
                from: new Date(Date.now() - 24 * 60 * 60 * 1000),
                to: new Date(),
            },
            chartCanvas,
            indicators: [],
            drawings: [],
        };
    };

    const handleExit = () => {
        if (hasUnsavedChanges) {
            setShowExitDialog(true);
        } else {
            performExit();
        }
    };

    const performExit = () => {
        onExit?.();

        const electronRuntime = window.electron as ElectronRuntime | undefined;
        if (electronRuntime) {
            electronRuntime.app?.quit?.();
            electronRuntime.ipcRenderer?.send?.('app-quit');
            return;
        }

        if (!onExit) {
            useAppStore.getState().logout?.();
        }
    };



    return (
        <>
            <div className="rtx-file-menu rtx-menu-surface min-w-[268px] py-1">
                {(accountId || onLogout) && (
                    <>
                        <div
                            className="mx-1 flex min-h-[50px] items-center gap-2 rounded-sm px-2 py-1.5 text-left text-zinc-300 [.rtx-advanced-view_&]:text-[#374151]"
                            aria-label={`Current trading account ${accountId || ''}`.trim()}
                            data-testid="file-menu-account-header"
                            role="presentation"
                        >
                            <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-blue-500/30 bg-blue-500/10 text-blue-400 [.rtx-advanced-view_&]:border-[#d6bbfb] [.rtx-advanced-view_&]:bg-[#f4f3ff] [.rtx-advanced-view_&]:text-[#6941C6]">
                                <Icon name="user" size="sm" />
                            </div>
                            <div className="min-w-0 flex-1">
                                <div className="text-[11px] font-normal text-zinc-500 [.rtx-advanced-view_&]:text-[#667085]">Current account</div>
                                <div className="truncate font-mono text-[13px] font-medium text-zinc-200 [.rtx-advanced-view_&]:text-[#101828]">{accountId || '---'}</div>
                            </div>
                            {onLogout && (
                                <button
                                    type="button"
                                    role="menuitem"
                                    aria-label="Log Out"
                                    title="Log out of the current account"
                                    onClick={onLogout}
                                    className="ml-auto flex h-8 shrink-0 items-center gap-1.5 rounded-sm border border-rose-500/20 px-2 text-[12px] font-medium text-rose-400 hover:border-rose-500/35 hover:bg-rose-500/10 hover:text-rose-300 [.rtx-advanced-view_&]:border-[#fecdca] [.rtx-advanced-view_&]:text-[#b42318] [.rtx-advanced-view_&]:hover:bg-[#fef3f2] [.rtx-advanced-view_&]:hover:text-[#912018]"
                                >
                                    <Icon name="log-out" size="xs" />
                                    <span>Log Out</span>
                                </button>
                            )}
                        </div>
                        <div className="rtx-menu-divider" role="separator"></div>
                    </>
                )}

                {/* New Chart - Click to open pairs panel directly */}
                <div className="relative px-1">
                    <button
                        onClick={() => setNewChartOpen(o => !o)}
                        className={`w-full flex min-h-[30px] items-center gap-3 px-2 py-1.5 text-[14px] font-normal rounded-sm text-left cursor-default group ${newChartOpen ? 'bg-[#2a2e39] [.rtx-advanced-view_&]:bg-[#f3f4f6] text-white [.rtx-advanced-view_&]:text-[#111827]' : 'text-zinc-300 [.rtx-advanced-view_&]:text-[#374151] hover:bg-[#2a2e39] [.rtx-advanced-view_&]:hover:bg-[#f3f4f6] hover:text-white [.rtx-advanced-view_&]:hover:text-[#111827]'
                            }`}
                        title="Open a new chart for a symbol"
                    >
                        <div className="w-4 flex items-center justify-center text-emerald-500">
                            <Icon name="plus-circle" size="sm" />
                        </div>
                        <span className="flex-1">{t('menu.file.newChart')}</span>
                        <span className="text-[10px] text-zinc-500 [.rtx-advanced-view_&]:text-gray-400">{newChartOpen ? '▼' : '▶'}</span>
                    </button>

                    {/* Pairs panel — appears directly to the right, no intermediate submenu */}
                    {newChartOpen && (
                        <div className="absolute left-full top-0 -ml-0.5 z-[101]">
                            {isLoadingSymbols ? (
                                <div className="rtx-menu-surface w-[220px] px-3 py-3 text-zinc-500 [.rtx-advanced-view_&]:text-gray-500 text-[12px] font-normal flex items-center gap-2">
                                    <Icon name="refresh" size="sm" className="animate-spin" />
                                    Connecting to broker...
                                </div>
                            ) : newChartMenuItems.length > 0 ? (
                                <div className="rtx-menu-surface min-w-[200px] py-1 max-h-[420px] overflow-y-auto no-scrollbar">
                                    {newChartMenuItems.map((item, idx) => (
                                        <NewChartMenuItemRenderer
                                            key={idx}
                                            item={item}
                                            activePair={selectedSymbol}
                                            onClose={() => setNewChartOpen(false)}
                                        />
                                    ))}
                                </div>
                            ) : (
                                <YoForexPanel
                                    activePair={selectedSymbol}
                                    onSelect={(sym) => {
                                        window.dispatchEvent(new CustomEvent('openChart', { detail: { symbol: sym, newTab: true } }));
                                        setNewChartOpen(false);
                                    }}
                                />
                            )}
                        </div>
                    )}
                </div>

                {/* Open Deleted */}
                <div className="relative group/deleted px-1 [&:hover>div.submenu]:block">
                    <button
                        disabled={recentlyClosedCharts.length === 0}
                        className={`w-full flex min-h-[30px] items-center gap-3 px-2 py-1.5 text-[14px] font-normal rounded-sm text-left ${recentlyClosedCharts.length > 0
                            ? 'text-zinc-300 [.rtx-advanced-view_&]:text-[#374151] hover:bg-[#2a2e39] [.rtx-advanced-view_&]:hover:bg-[#f3f4f6] hover:text-white [.rtx-advanced-view_&]:hover:text-[#111827] cursor-default'
                            : 'text-zinc-600 [.rtx-advanced-view_&]:text-gray-400 cursor-not-allowed'}`}
                        title={recentlyClosedCharts.length > 0 ? 'Restore a recently closed chart' : 'No recently closed charts'}
                    >
                        <div className="w-4 flex items-center justify-center">
                            <Icon name="history" size="sm" />
                        </div>
                        <span className="flex-1">{t('menu.file.openDeleted')}</span>
                        {recentlyClosedCharts.length > 0 && <Icon name="chevron-right" size="xs" className="rtx-menu-icon--neutral" />}
                    </button>
                    {recentlyClosedCharts.length > 0 && (
                        <div className="rtx-menu-surface submenu absolute left-full top-0 -ml-1 hidden min-w-[190px] max-w-[280px] py-1 z-[101]">
                            {recentlyClosedCharts.map(panel => (
                                <button
                                    key={panel.id}
                                    type="button"
                                    onClick={() => handleRestoreChart(panel.id)}
                                    className="w-full flex min-h-[30px] items-center gap-2 px-3 py-1.5 text-[14px] font-normal rounded-sm text-left text-zinc-300 [.rtx-advanced-view_&]:text-[#374151] hover:bg-[#2a2e39] [.rtx-advanced-view_&]:hover:bg-[#f3f4f6] hover:text-white [.rtx-advanced-view_&]:hover:text-[#111827] cursor-default"
                                    title={`Restore ${panel.title || panel.props?.symbol || 'chart'}`}
                                >
                                    <Icon name="candlestick" size="sm" className="rtx-menu-icon--neutral shrink-0" />
                                    <span className="truncate">{panel.title || String(panel.props?.symbol || 'Chart')}</span>
                                </button>
                            ))}
                        </div>
                    )}
                </div>

                {/* Profiles submenu */}
                <div className="relative group/profiles px-1 [&:hover>div.submenu]:block">
                    <button
                        className="w-full flex min-h-[30px] items-center gap-3 px-2 py-1.5 text-[14px] font-normal rounded-sm text-left text-zinc-300 hover:bg-[#2a2e39] hover:text-white cursor-default"
                        title="Load profile configurations"
                    >
                        <div className="rtx-menu-icon--neutral w-4 flex items-center justify-center">
                            <Icon name="layout" size="sm" />
                        </div>
                        <span className="flex-1">{t('menu.file.profiles')}</span>
                        <Icon name="chevron-right" size="xs" className="rtx-menu-icon--neutral" />
                    </button>
                    <div className="rtx-menu-surface submenu absolute left-full top-0 -ml-1 hidden min-w-[180px] py-1 z-[101]">
                        {workspaceProfiles.map(profile => (
                            <button
                                key={profile.id}
                                type="button"
                                onClick={() => handleRestoreProfile(profile.name)}
                                className="w-full flex min-h-[30px] items-center gap-3 px-3 py-1.5 text-[14px] font-normal rounded-sm text-left text-zinc-300 hover:bg-[#2a2e39] hover:text-white cursor-default"
                                title={`Restore workspace ${profile.name}`}
                            >
                                <Icon name="layout" size="sm" className="rtx-menu-icon--neutral shrink-0" />
                                <span className="truncate">{profile.name}</span>
                            </button>
                        ))}
                        {workspaceProfiles.length === 0 && (
                            <div className="px-3 py-2 text-[12px] text-zinc-500 [.rtx-advanced-view_&]:text-gray-500">
                                Save a workspace to create a profile.
                            </div>
                        )}
                    </div>
                </div>

                {/* Close */}
                <button
                    onClick={handleCloseActiveChart}
                    className="w-full flex min-h-[30px] items-center gap-3 px-2 py-1.5 text-[14px] font-normal rounded-sm text-left text-zinc-300 [.rtx-advanced-view_&]:text-[#374151] hover:bg-[#2a2e39] [.rtx-advanced-view_&]:hover:bg-[#f3f4f6] hover:text-white [.rtx-advanced-view_&]:hover:text-[#111827] cursor-default group"
                    title="Close current chart"
                >
                    <div className="rtx-menu-icon--neutral w-4 flex items-center justify-center">
                        <Icon name="x-close" size="sm" />
                    </div>
                    <span className="flex-1">{t('menu.file.close')}</span>
                    <span className="text-[12px] font-normal text-zinc-500 font-mono tracking-tighter">Ctrl+F4</span>
                </button>

                <div className="rtx-menu-divider" role="separator"></div>

                {/* Save */}
                <button
                    onClick={handleSave}
                    className="w-full flex min-h-[30px] items-center gap-3 px-2 py-1.5 text-[14px] font-normal rounded-sm text-left text-zinc-300 [.rtx-advanced-view_&]:text-[#374151] hover:bg-[#2a2e39] [.rtx-advanced-view_&]:hover:bg-[#f3f4f6] hover:text-white [.rtx-advanced-view_&]:hover:text-[#111827] cursor-default group"
                    title="Save workspace configuration"
                >
                    <div className="rtx-menu-icon--neutral w-4 flex items-center justify-center">
                        <Icon name="save" size="sm" />
                    </div>
                    <span className="flex-1">{t('menu.file.save')}</span>
                    <span className="text-[12px] font-normal text-zinc-500 font-mono tracking-tighter">Ctrl+S</span>
                </button>

                {/* Save As Picture */}
                <button
                    onClick={handleSaveAsPicture}
                    className="w-full flex min-h-[30px] items-center gap-3 px-2 py-1.5 text-[14px] font-normal rounded-sm text-left text-zinc-300 [.rtx-advanced-view_&]:text-[#374151] hover:bg-[#2a2e39] [.rtx-advanced-view_&]:hover:bg-[#f3f4f6] hover:text-white [.rtx-advanced-view_&]:hover:text-[#111827] cursor-default group"
                    title="Export chart as image"
                >
                    <div className="rtx-menu-icon--neutral w-4 flex items-center justify-center">
                        <Icon name="image" size="sm" />
                    </div>
                    <span className="flex-1">{t('menu.file.saveAsPicture')}</span>
                </button>

                <div className="rtx-menu-divider" role="separator"></div>

                {/* Open Data Folder */}
                <button
                    onClick={handleOpenDataFolder}
                    disabled={!onOpenDataFolder}
                    className={`w-full flex min-h-[30px] items-center gap-3 px-2 py-1.5 text-[14px] font-normal rounded-sm text-left group ${onOpenDataFolder
                        ? 'text-zinc-300 [.rtx-advanced-view_&]:text-[#374151] hover:bg-[#2a2e39] [.rtx-advanced-view_&]:hover:bg-[#f3f4f6] hover:text-white [.rtx-advanced-view_&]:hover:text-[#111827] cursor-default'
                        : 'text-zinc-600 [.rtx-advanced-view_&]:text-gray-400 cursor-not-allowed'}`}
                    title={onOpenDataFolder ? 'Open application data directory' : 'Available in the desktop app'}
                >
                    <div className="rtx-menu-icon--neutral w-4 flex items-center justify-center">
                        <Icon name="folder-open" size="sm" />
                    </div>
                    <span className="flex-1">{t('menu.file.openDataFolder')}</span>
                    <span className="text-[12px] font-normal text-zinc-500 font-mono tracking-tighter">Ctrl+Shift+D</span>
                </button>

                {showDesktopDownload && (
                    <button
                        onClick={handleDownloadDesktop}
                        className="w-full flex min-h-[30px] items-center gap-3 px-2 py-1.5 text-[14px] font-normal rounded-sm text-left text-zinc-300 [.rtx-advanced-view_&]:text-[#374151] hover:bg-[#2a2e39] [.rtx-advanced-view_&]:hover:bg-[#f3f4f6] hover:text-white [.rtx-advanced-view_&]:hover:text-[#111827] cursor-default group"
                        title={getDesktopReleaseButtonTitle(desktopReleaseState.release)}
                    >
                        <div className="w-4 flex items-center justify-center text-sky-400 group-hover:text-sky-300 [.rtx-advanced-view_&]:text-sky-600">
                            <Icon name="download" size="sm" />
                        </div>
                        <span className="flex-1">Download Desktop App</span>
                        {desktopReleaseMetaLabel && (
                            <span className="rounded-[3px] border border-zinc-600/70 [.rtx-advanced-view_&]:border-gray-300 bg-zinc-900/70 [.rtx-advanced-view_&]:bg-gray-100 px-1.5 py-[1px] text-[12px] font-normal text-zinc-400 [.rtx-advanced-view_&]:text-gray-600 font-mono leading-none">{desktopReleaseMetaLabel}</span>
                        )}
                    </button>
                )}

                <div className="rtx-menu-divider" role="separator"></div>

                {/* Print */}
                <button
                    onClick={() => { void handlePrint(); }}
                    className="w-full flex min-h-[30px] items-center gap-3 px-2 py-1.5 text-[14px] font-normal rounded-sm text-left text-zinc-300 [.rtx-advanced-view_&]:text-[#374151] hover:bg-[#2a2e39] [.rtx-advanced-view_&]:hover:bg-[#f3f4f6] hover:text-white [.rtx-advanced-view_&]:hover:text-[#111827] cursor-default group"
                    title="Print chart"
                >
                    <div className="rtx-menu-icon--neutral w-4 flex items-center justify-center">
                        <Icon name="print" size="sm" />
                    </div>
                    <span className="flex-1">{t('menu.file.print')}</span>
                    <span className="text-[12px] font-normal text-zinc-500 font-mono tracking-tighter">Ctrl+P</span>
                </button>

                {/* Print Preview */}
                <button
                    onClick={handlePrintPreview}
                    className="w-full flex min-h-[30px] items-center gap-3 px-2 py-1.5 text-[14px] font-normal rounded-sm text-left text-zinc-300 [.rtx-advanced-view_&]:text-[#374151] hover:bg-[#2a2e39] [.rtx-advanced-view_&]:hover:bg-[#f3f4f6] hover:text-white [.rtx-advanced-view_&]:hover:text-[#111827] cursor-default group"
                    title="Preview before printing"
                >
                    <div className="rtx-menu-icon--neutral w-4 flex items-center justify-center">
                        <Icon name="file-text" size="sm" />
                    </div>
                    <span className="flex-1">{t('menu.file.printPreview')}</span>
                </button>

                {/* Print Setup */}
                <button
                    onClick={handlePrintSetup}
                    className="w-full flex min-h-[30px] items-center gap-3 px-2 py-1.5 text-[14px] font-normal rounded-sm text-left text-zinc-300 [.rtx-advanced-view_&]:text-[#374151] hover:bg-[#2a2e39] [.rtx-advanced-view_&]:hover:bg-[#f3f4f6] hover:text-white [.rtx-advanced-view_&]:hover:text-[#111827] cursor-default group"
                    title="Configure print settings"
                >
                    <div className="rtx-menu-icon--neutral w-4 flex items-center justify-center">
                        <Icon name="settings" size="sm" />
                    </div>
                    <span className="flex-1">{t('menu.file.printSetup')}</span>
                </button>

                <div className="rtx-menu-divider" role="separator"></div>

                {/* Open an Account */}
                <button
                    onClick={() => setShowOpenAccountDialog(true)}
                    className="w-full flex min-h-[30px] items-center gap-3 px-2 py-1.5 text-[14px] font-normal rounded-sm text-left text-zinc-300 [.rtx-advanced-view_&]:text-[#374151] hover:bg-[#2a2e39] [.rtx-advanced-view_&]:hover:bg-[#f3f4f6] hover:text-white [.rtx-advanced-view_&]:hover:text-[#111827] cursor-default group"
                    title="Register new trading account"
                >
                    <div className="w-4 flex items-center justify-center">
                        <Icon name="user-plus" size="sm" className="text-blue-400" />
                    </div>
                    <span className="flex-1">{t('menu.file.openAccount')}</span>
                </button>

                {/* Login to Trade Account */}
                <button
                    onClick={onLoginTrade}
                    disabled={!onLoginTrade}
                    className={`w-full flex min-h-[30px] items-center gap-3 px-2 py-1.5 text-[14px] font-normal rounded-sm text-left ${onLoginTrade
                        ? 'text-zinc-300 [.rtx-advanced-view_&]:text-[#374151] hover:bg-[#2a2e39] [.rtx-advanced-view_&]:hover:bg-[#f3f4f6] hover:text-white [.rtx-advanced-view_&]:hover:text-[#111827] cursor-default'
                        : 'text-zinc-600 [.rtx-advanced-view_&]:text-gray-400 cursor-not-allowed'}`}
                    title={onLoginTrade ? 'Connect to another trading account' : 'Trade account login is unavailable'}
                >
                    <div className="w-4 flex items-center justify-center">
                        <Icon name="log-in" size="sm" className={onLoginTrade ? 'text-blue-400' : 'text-blue-400/50'} />
                    </div>
                    <span className="flex-1">{t('menu.file.loginTrade')}</span>
                </button>

                {/* Login to Web Trader */}
                <button
                    onClick={onLoginWebTrader}
                    disabled={!onLoginWebTrader}
                    className={`w-full flex min-h-[30px] items-center gap-3 px-2 py-1.5 text-[14px] font-normal rounded-sm text-left ${onLoginWebTrader
                        ? 'text-zinc-300 [.rtx-advanced-view_&]:text-[#374151] hover:bg-[#2a2e39] [.rtx-advanced-view_&]:hover:bg-[#f3f4f6] hover:text-white [.rtx-advanced-view_&]:hover:text-[#111827] cursor-default'
                        : 'text-zinc-600 [.rtx-advanced-view_&]:text-gray-400 cursor-not-allowed'}`}
                    title={onLoginWebTrader ? 'Open this broker in Web Trader' : 'Web Trader URL is not configured'}
                >
                    <div className="w-4 flex items-center justify-center">
                        <Icon name="globe" size="sm" />
                    </div>
                    <span className="flex-1">{t('menu.file.loginWeb')}</span>
                </button>

                {/* Login to RTX5.community */}
                <button
                    disabled
                    className="w-full flex min-h-[30px] items-center gap-3 px-2 py-1.5 text-[14px] font-normal rounded-sm text-left text-zinc-600 [.rtx-advanced-view_&]:text-gray-400 cursor-not-allowed"
                    title="RTX5 Community is not configured for this deployment"
                >
                    <div className="w-4 flex items-center justify-center">
                        <Icon name="help-circle" size="sm" className="text-blue-500/50" />
                    </div>
                    <span className="flex-1">{t('menu.file.loginMql5')}</span>
                </button>

                <div className="rtx-menu-divider" role="separator"></div>

                {/* Exit */}
                <button
                    onClick={handleExit}
                    className="w-full flex min-h-[30px] items-center gap-3 px-2 py-1.5 text-[14px] font-normal rounded-sm text-left text-zinc-300 [.rtx-advanced-view_&]:text-[#374151] hover:bg-[#2a2e39] [.rtx-advanced-view_&]:hover:bg-[#f3f4f6] hover:text-white [.rtx-advanced-view_&]:hover:text-[#111827] cursor-default group"
                    title="Close application"
                >
                    <div className="w-4 flex items-center justify-center text-rose-400 group-hover:text-rose-300">
                        <Icon name="log-out" size="sm" />
                    </div>
                    <span className="flex-1">{t('menu.file.exit')}</span>
                </button>
            </div>

            {/* Dialogs */}
            {showSaveDialog && (
                <SaveWorkspaceDialog
                    onConfirm={(workspaceName) => {
                        setShowSaveDialog(false);
                        onSave?.(workspaceName);
                    }}
                    onCancel={() => setShowSaveDialog(false)}
                    accountId={accountId}
                />
            )}

            {showPrintSetupDialog && (
                <PrintSetupDialog
                    onConfirm={(preferences) => {
                        setShowPrintSetupDialog(false);
                        setPrintPreferences(preferences);
                        console.log('Print preferences saved:', preferences);
                    }}
                    onCancel={() => setShowPrintSetupDialog(false)}
                    accountId={accountId}
                />
            )}

            {showPrintPreviewDialog && (
                <PrintPreviewDialog
                    onPrint={() => handlePrint(chartPrintData || undefined)}
                    onClose={() => setShowPrintPreviewDialog(false)}
                    chartData={chartPrintData || undefined}
                    preferences={printPreferences || undefined}
                />
            )}

            {showSavePictureDialog && (
                <SavePictureDialog
                    isOpen={showSavePictureDialog}
                    onClose={() => {
                        setShowSavePictureDialog(false);
                        setSavePictureSource(null);
                    }}
                    chartCanvas={savePictureSource?.canvas ?? null}
                    chartContainer={savePictureSource?.container ?? null}
                    symbol={savePictureSource?.symbol || selectedSymbol || 'EURUSD'}
                    timeframe={savePictureSource?.timeframe || timeframe || '5m'}
                />
            )}

            {showExitDialog && (
                <ExitConfirmDialog
                    isOpen={showExitDialog}
                    changes={{
                        hasWorkspaceChanges: hasUnsavedChanges,
                        hasOpenTrades: false,
                        hasDraftOrders: false,
                        openTradesCount: 0,
                        draftOrdersCount: 0,
                        workspaceModified: hasUnsavedChanges,
                    }}
                    onConfirm={(saveWorkspace) => {
                        setShowExitDialog(false);
                        if (saveWorkspace && accountId?.trim()) {
                            try {
                                saveCurrentWorkspaceProfile({
                                    accountId,
                                    profileName: 'Default',
                                });
                            } catch (error) {
                                console.error('[FileMenu] Could not save workspace before exit:', error);
                                window.alert(error instanceof Error
                                    ? error.message
                                    : 'The workspace could not be saved before exit.');
                                return;
                            }
                        }
                        performExit();
                    }}
                    onCancel={() => setShowExitDialog(false)}
                />
            )}

            <OpenAccountDialog
                isOpen={showOpenAccountDialog}
                onClose={() => setShowOpenAccountDialog(false)}
            />
        </>
    );
};
