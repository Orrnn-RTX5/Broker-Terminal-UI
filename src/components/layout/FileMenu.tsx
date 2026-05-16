/**
 * File Menu Component - MT5 Style
 * Complete File menu dropdown with exact MT5 behavior
 */

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

// Symbol data type from API
interface SymbolData {
    symbol: string;
    name: string;
    category: string;
}

// Menu item interface for building nested structure
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
        <div className="flex flex-col bg-[#131316] [.rtx-advanced-view_&]:bg-white border border-zinc-700 [.rtx-advanced-view_&]:border-gray-200 rounded-md shadow-2xl overflow-hidden" style={{ width: 160, maxHeight: 420 }}>
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
                        className="bg-transparent text-[11px] text-zinc-200 [.rtx-advanced-view_&]:text-gray-900 placeholder-zinc-600 [.rtx-advanced-view_&]:placeholder-gray-400 outline-none w-full"
                        onClick={e => e.stopPropagation()}
                    />
                </div>
            </div>
            {/* Pair list */}
            <div className="overflow-y-auto flex-1 pb-1 px-1" style={{ scrollbarWidth: 'none' }}>
                {filtered.map(grp => (
                    <div key={grp.group}>
                        <div className="px-2 pt-2 pb-0.5 text-[9px] font-bold tracking-widest text-zinc-600 [.rtx-advanced-view_&]:text-gray-500 uppercase">{grp.group}</div>
                        {grp.pairs.map(p => {
                            const isActive = activePair === p.symbol;
                            return (
                                <button
                                    key={p.symbol}
                                    onClick={() => onSelect(p.symbol)}
                                    className={`w-full flex items-center gap-1.5 px-2 py-1 text-[12px] rounded text-left cursor-default transition-colors duration-75 ${
                                        isActive
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
                    <div className="px-3 py-3 text-center text-[11px] text-zinc-600 [.rtx-advanced-view_&]:text-gray-500">No pairs found</div>
                )}
            </div>
        </div>
    );
};

// Recursive menu item renderer (for API-loaded symbols)
const NewChartMenuItemRenderer: React.FC<{ item: NewChartMenuItem; depth: number; activePair?: string; onClose?: () => void }> = ({ item, depth, activePair, onClose }) => {
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
                className={`w-full flex items-center gap-2 px-2 py-1.5 text-[12px] rounded-sm text-left cursor-default group ${
                    isActive ? 'text-emerald-400 [.rtx-advanced-view_&]:text-emerald-600 bg-emerald-500/10 [.rtx-advanced-view_&]:bg-emerald-50' : 'text-zinc-300 [.rtx-advanced-view_&]:text-[#374151] hover:bg-[#2a2e39] [.rtx-advanced-view_&]:hover:bg-[#f3f4f6] hover:text-white [.rtx-advanced-view_&]:hover:text-[#111827]'
                }`}
            >
                <span className="w-3 text-[10px] flex-none">{isActive ? '✓' : ''}</span>
                <span className="flex-1 font-mono">{item.label}</span>
                {hasChildren && <Icon name="chevron-right" size="xs" className="text-zinc-500 [.rtx-advanced-view_&]:text-gray-400 group-hover:text-white [.rtx-advanced-view_&]:group-hover:text-gray-700" />}
            </button>
            {hasChildren && (
                <div className="submenu absolute left-full top-0 -ml-1 hidden min-w-[180px] bg-[#131316] [.rtx-advanced-view_&]:bg-white border border-zinc-700 [.rtx-advanced-view_&]:border-gray-200 rounded-md shadow-xl py-1 z-[102] max-h-[400px] overflow-y-auto no-scrollbar">
                    {item.children!.map((child, idx) => (
                        <NewChartMenuItemRenderer key={idx} item={child} depth={depth + 1} activePair={activePair} onClose={onClose} />
                    ))}
                </div>
            )}
        </div>
    );
};

export interface FileMenuProps {
    onSave?: () => void;
    onSaveAsPicture?: () => void;
    onOpenDataFolder?: () => void;
    onPrint?: () => void;
    onPrintPreview?: () => void;
    onPrintSetup?: () => void;
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
    onExit,
    hasUnsavedChanges = false
}) => {
    const { t } = useTranslation();
    const [showSaveDialog, setShowSaveDialog] = useState(false);
    const [showSavePictureDialog, setShowSavePictureDialog] = useState(false);
    const [showPrintSetupDialog, setShowPrintSetupDialog] = useState(false);
    const [showPrintPreviewDialog, setShowPrintPreviewDialog] = useState(false);
    const [showExitDialog, setShowExitDialog] = useState(false);
    const [showOpenAccountDialog, setShowOpenAccountDialog] = useState(false);
    const [newChartOpen, setNewChartOpen] = useState(false);

    // Dynamic symbol loading for New Chart menu
    const [availableSymbols, setAvailableSymbols] = useState<SymbolData[]>([]);
    const [isLoadingSymbols, setIsLoadingSymbols] = useState(false);

    // Fetch symbols on mount
    useEffect(() => {
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
    }, []);

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
        if (hasUnsavedChanges) {
            setShowSaveDialog(true);
        } else {
            onSave?.();
        }
    };

    const handleSaveAsPicture = () => {
        // Get the active chart canvas from the global window object
        const canvas = (window as any).__activeChartCanvas as HTMLCanvasElement | null;
        const container = (window as any).__activeChartContainer as HTMLElement | null;

        if (!canvas && !container) {
            console.warn('[FileMenu] No active chart canvas or container found for export');
            alert('No chart available to export. Please open a chart first.');
            return;
        }

        setShowSavePictureDialog(true);
        onSaveAsPicture?.();
    };

    const handleOpenDataFolder = () => {
        onOpenDataFolder?.();
        // Open the data folder using electron or browser
        if (window.electron) {
            window.electron.shell.openPath('./data');
        }
    };

    const handlePrint = async () => {
        // Generate chart data for printing
        const data = generateChartPrintData();

        if (onPrint) {
            onPrint();
        } else {
            // Use the chart printer service
            const prefs = chartPrinter.getPreferences();
            await chartPrinter.printChart(data, prefs);
        }
    };

    const handlePrintPreview = () => {
        // Generate chart data for preview
        const data = generateChartPrintData();
        setChartPrintData(data);
        setShowPrintPreviewDialog(true);
    };

    const handlePrintSetup = () => {
        setShowPrintSetupDialog(true);
    };

    const generateChartPrintData = (): ChartPrintData => {
        // Try to capture the chart canvas
        const chartContainer = document.querySelector('.tv-lightweight-charts');
        let chartCanvas: HTMLCanvasElement | undefined;

        if (chartContainer) {
            const canvas = chartContainer.querySelector('canvas');
            if (canvas) {
                // Create a copy of the canvas
                const copiedCanvas = document.createElement('canvas');
                copiedCanvas.width = canvas.width;
                copiedCanvas.height = canvas.height;
                const ctx = copiedCanvas.getContext('2d');
                if (ctx) {
                    ctx.drawImage(canvas, 0, 0);
                    chartCanvas = copiedCanvas;
                }
            }
        }

        return {
            symbol: selectedSymbol || 'BTCUSD',
            timeframe: timeframe || '1m',
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

        // Clear authentication state
        try {
            useAppStore.getState().logout?.();
        } catch (e) {
            console.log('No auth to clear');
        }

        // Try Electron methods first (if running in Electron)
        if ((window as any).electron) {
            try {
                (window as any).electron.app?.quit?.();
                (window as any).electron.ipcRenderer?.send?.('app-quit');
                return;
            } catch (e) {
                console.log('Electron quit failed, trying browser methods');
            }
        }

        // Try window.close() for popup windows
        try {
            window.close();
        } catch (e) {
            console.log('window.close() not available');
        }

        // For main browser window - show confirmation and redirect to blank
        if (!window.closed) {
            const confirmed = window.confirm('Exit RTX Terminal?');
            if (confirmed) {
                // Clear state again just to be safe
                useAppStore.getState().logout?.();

                // Allow state change to propagate and show login screen
                window.location.reload();
            }
        }
    };



    return (
        <>
            <div className="min-w-[240px] bg-[#131316] [.rtx-advanced-view_&]:bg-white border border-zinc-700 [.rtx-advanced-view_&]:border-gray-200 rounded-md shadow-xl py-1">
                {/* New Chart - Click to open pairs panel directly */}
                <div className="relative px-1">
                    <button
                        onClick={() => setNewChartOpen(o => !o)}
                        className={`w-full flex items-center gap-3 px-2 py-1.5 text-[12px] rounded-sm text-left cursor-default group ${
                            newChartOpen ? 'bg-[#2a2e39] [.rtx-advanced-view_&]:bg-[#f3f4f6] text-white [.rtx-advanced-view_&]:text-[#111827]' : 'text-zinc-300 [.rtx-advanced-view_&]:text-[#374151] hover:bg-[#2a2e39] [.rtx-advanced-view_&]:hover:bg-[#f3f4f6] hover:text-white [.rtx-advanced-view_&]:hover:text-[#111827]'
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
                                <div className="w-[200px] bg-[#0f1117] [.rtx-advanced-view_&]:bg-white border border-zinc-700 [.rtx-advanced-view_&]:border-gray-200 rounded-md shadow-2xl px-3 py-3 text-zinc-500 [.rtx-advanced-view_&]:text-gray-500 text-[12px] flex items-center gap-2">
                                    <Icon name="refresh" size="sm" className="animate-spin" />
                                    Connecting to broker...
                                </div>
                            ) : (
                                <YoForexPanel
                                    activePair={selectedSymbol}
                                    onSelect={(sym) => {
                                        window.dispatchEvent(new CustomEvent('openChart', { detail: { symbol: sym, newTab: true } }));
                                    }}
                                />
                            )}
                        </div>
                    )}
                </div>

                {/* Open Deleted */}
                <button
                    disabled
                    className="w-full flex items-center gap-3 px-2 py-1.5 text-[12px] rounded-sm text-left text-zinc-600 [.rtx-advanced-view_&]:text-gray-400 cursor-not-allowed"
                    title="Restore deleted charts"
                >
                    <div className="w-4 flex items-center justify-center">
                    </div>
                    <span className="flex-1">{t('menu.file.openDeleted')}</span>
                </button>

                {/* Profiles submenu */}
                <div className="relative group/profiles px-1 [&:hover>div.submenu]:block">
                    <button
                        className="w-full flex items-center gap-3 px-2 py-1.5 text-[12px] rounded-sm text-left text-zinc-300 hover:bg-[#2a2e39] hover:text-white cursor-default"
                        title="Load profile configurations"
                    >
                        <div className="w-4 flex items-center justify-center">
                        </div>
                        <span className="flex-1">{t('menu.file.profiles')}</span>
                        <Icon name="chevron-right" size="xs" className="text-zinc-500" />
                    </button>
                    <div className="submenu absolute left-full top-0 -ml-1 hidden min-w-[140px] bg-[#131316] border border-zinc-700 rounded-md shadow-xl py-1 z-[101]">
                        {['Default', 'Euro', 'Market'].map(profile => (
                            <button
                                key={profile}
                                className="w-full flex items-center gap-3 px-3 py-1.5 text-[12px] rounded-sm text-left text-zinc-300 hover:bg-[#2a2e39] hover:text-white cursor-default"
                            >
                                {profile}
                            </button>
                        ))}
                    </div>
                </div>

                {/* Close */}
                <button
                    className="w-full flex items-center gap-3 px-2 py-1.5 text-[12px] rounded-sm text-left text-zinc-300 [.rtx-advanced-view_&]:text-[#374151] hover:bg-[#2a2e39] [.rtx-advanced-view_&]:hover:bg-[#f3f4f6] hover:text-white [.rtx-advanced-view_&]:hover:text-[#111827] cursor-default group"
                    title="Close current chart"
                >
                    <div className="w-4 flex items-center justify-center text-zinc-400 group-hover:text-zinc-200">
                    </div>
                    <span className="flex-1">{t('menu.file.close')}</span>
                    <span className="text-[10px] text-zinc-500 font-mono tracking-tighter">Ctrl+F4</span>
                </button>

                <div className="h-[1px] bg-zinc-700/50 [.rtx-advanced-view_&]:bg-gray-200 my-1 mx-2"></div>

                {/* Save */}
                <button
                    onClick={handleSave}
                    className="w-full flex items-center gap-3 px-2 py-1.5 text-[12px] rounded-sm text-left text-zinc-300 [.rtx-advanced-view_&]:text-[#374151] hover:bg-[#2a2e39] [.rtx-advanced-view_&]:hover:bg-[#f3f4f6] hover:text-white [.rtx-advanced-view_&]:hover:text-[#111827] cursor-default group"
                    title="Save workspace configuration"
                >
                    <div className="w-4 flex items-center justify-center text-zinc-400 group-hover:text-zinc-200">
                        <Icon name="save" size="sm" />
                    </div>
                    <span className="flex-1">{t('menu.file.save')}</span>
                    <span className="text-[10px] text-zinc-500 font-mono tracking-tighter">Ctrl+S</span>
                </button>

                {/* Save As Picture */}
                <button
                    onClick={handleSaveAsPicture}
                    className="w-full flex items-center gap-3 px-2 py-1.5 text-[12px] rounded-sm text-left text-zinc-300 [.rtx-advanced-view_&]:text-[#374151] hover:bg-[#2a2e39] [.rtx-advanced-view_&]:hover:bg-[#f3f4f6] hover:text-white [.rtx-advanced-view_&]:hover:text-[#111827] cursor-default group"
                    title="Export chart as image"
                >
                    <div className="w-4 flex items-center justify-center text-zinc-400 group-hover:text-zinc-200">
                        <Icon name="image" size="sm" />
                    </div>
                    <span className="flex-1">{t('menu.file.saveAsPicture')}</span>
                </button>

                <div className="h-[1px] bg-zinc-700/50 [.rtx-advanced-view_&]:bg-gray-200 my-1 mx-2"></div>

                {/* Open Data Folder */}
                <button
                    onClick={handleOpenDataFolder}
                    className="w-full flex items-center gap-3 px-2 py-1.5 text-[12px] rounded-sm text-left text-zinc-300 [.rtx-advanced-view_&]:text-[#374151] hover:bg-[#2a2e39] [.rtx-advanced-view_&]:hover:bg-[#f3f4f6] hover:text-white [.rtx-advanced-view_&]:hover:text-[#111827] cursor-default group"
                    title="Open application data directory"
                >
                    <div className="w-4 flex items-center justify-center text-zinc-400 group-hover:text-zinc-200">
                        <Icon name="folder-open" size="sm" />
                    </div>
                    <span className="flex-1">{t('menu.file.openDataFolder')}</span>
                    <span className="text-[10px] text-zinc-500 font-mono tracking-tighter">Ctrl+Shift+D</span>
                </button>

                <div className="h-[1px] bg-zinc-700/50 [.rtx-advanced-view_&]:bg-gray-200 my-1 mx-2"></div>

                {/* Print */}
                <button
                    onClick={handlePrint}
                    className="w-full flex items-center gap-3 px-2 py-1.5 text-[12px] rounded-sm text-left text-zinc-300 [.rtx-advanced-view_&]:text-[#374151] hover:bg-[#2a2e39] [.rtx-advanced-view_&]:hover:bg-[#f3f4f6] hover:text-white [.rtx-advanced-view_&]:hover:text-[#111827] cursor-default group"
                    title="Print chart"
                >
                    <div className="w-4 flex items-center justify-center text-zinc-400 group-hover:text-zinc-200">
                        <Icon name="print" size="sm" />
                    </div>
                    <span className="flex-1">{t('menu.file.print')}</span>
                    <span className="text-[10px] text-zinc-500 font-mono tracking-tighter">Ctrl+P</span>
                </button>

                {/* Print Preview */}
                <button
                    onClick={handlePrintPreview}
                    className="w-full flex items-center gap-3 px-2 py-1.5 text-[12px] rounded-sm text-left text-zinc-300 [.rtx-advanced-view_&]:text-[#374151] hover:bg-[#2a2e39] [.rtx-advanced-view_&]:hover:bg-[#f3f4f6] hover:text-white [.rtx-advanced-view_&]:hover:text-[#111827] cursor-default group"
                    title="Preview before printing"
                >
                    <div className="w-4 flex items-center justify-center text-zinc-400 group-hover:text-zinc-200">
                        <Icon name="file-text" size="sm" />
                    </div>
                    <span className="flex-1">{t('menu.file.printPreview')}</span>
                </button>

                {/* Print Setup */}
                <button
                    onClick={handlePrintSetup}
                    className="w-full flex items-center gap-3 px-2 py-1.5 text-[12px] rounded-sm text-left text-zinc-300 [.rtx-advanced-view_&]:text-[#374151] hover:bg-[#2a2e39] [.rtx-advanced-view_&]:hover:bg-[#f3f4f6] hover:text-white [.rtx-advanced-view_&]:hover:text-[#111827] cursor-default group"
                    title="Configure print settings"
                >
                    <div className="w-4 flex items-center justify-center text-zinc-400 group-hover:text-zinc-200">
                        <Icon name="settings" size="sm" />
                    </div>
                    <span className="flex-1">{t('menu.file.printSetup')}</span>
                </button>

                <div className="h-[1px] bg-zinc-700/50 [.rtx-advanced-view_&]:bg-gray-200 my-1 mx-2"></div>

                {/* Open an Account */}
                <button
                    onClick={() => setShowOpenAccountDialog(true)}
                    className="w-full flex items-center gap-3 px-2 py-1.5 text-[12px] rounded-sm text-left text-zinc-300 [.rtx-advanced-view_&]:text-[#374151] hover:bg-[#2a2e39] [.rtx-advanced-view_&]:hover:bg-[#f3f4f6] hover:text-white [.rtx-advanced-view_&]:hover:text-[#111827] cursor-default group"
                    title="Register new trading account"
                >
                    <div className="w-4 flex items-center justify-center">
                        <Icon name="user-plus" size="sm" className="text-blue-400" />
                    </div>
                    <span className="flex-1">{t('menu.file.openAccount')}</span>
                </button>

                {/* Login to Trade Account */}
                <button
                    disabled
                    className="w-full flex items-center gap-3 px-2 py-1.5 text-[12px] rounded-sm text-left text-zinc-600 [.rtx-advanced-view_&]:text-gray-400 cursor-not-allowed"
                    title="Connect to trading account"
                >
                    <div className="w-4 flex items-center justify-center">
                        <Icon name="log-in" size="sm" className="text-blue-400/50" />
                    </div>
                    <span className="flex-1">{t('menu.file.loginTrade')}</span>
                </button>

                {/* Login to Web Trader */}
                <button
                    disabled
                    className="w-full flex items-center gap-3 px-2 py-1.5 text-[12px] rounded-sm text-left text-zinc-600 [.rtx-advanced-view_&]:text-gray-400 cursor-not-allowed"
                    title="Access web trading platform"
                >
                    <div className="w-4 flex items-center justify-center">
                        <Icon name="globe" size="sm" />
                    </div>
                    <span className="flex-1">{t('menu.file.loginWeb')}</span>
                </button>

                {/* Login to MQL5.community */}
                <button
                    disabled
                    className="w-full flex items-center gap-3 px-2 py-1.5 text-[12px] rounded-sm text-left text-zinc-600 [.rtx-advanced-view_&]:text-gray-400 cursor-not-allowed"
                    title="Connect to MQL5 community"
                >
                    <div className="w-4 flex items-center justify-center">
                        <Icon name="help-circle" size="sm" className="text-blue-500/50" />
                    </div>
                    <span className="flex-1">{t('menu.file.loginMql5')}</span>
                </button>

                <div className="h-[1px] bg-zinc-700/50 my-1 mx-2"></div>

                {/* Exit */}
                <button
                    onClick={handleExit}
                    className="w-full flex items-center gap-3 px-2 py-1.5 text-[12px] rounded-sm text-left text-zinc-300 [.rtx-advanced-view_&]:text-[#374151] hover:bg-[#2a2e39] [.rtx-advanced-view_&]:hover:bg-[#f3f4f6] hover:text-white [.rtx-advanced-view_&]:hover:text-[#111827] cursor-default group"
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
                    onConfirm={() => {
                        setShowSaveDialog(false);
                        onSave?.();
                    }}
                    onCancel={() => setShowSaveDialog(false)}
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
                    accountId="1"
                />
            )}

            {showPrintPreviewDialog && (
                <PrintPreviewDialog
                    onPrint={handlePrint}
                    onClose={() => setShowPrintPreviewDialog(false)}
                    chartData={chartPrintData || undefined}
                    preferences={printPreferences || undefined}
                />
            )}

            {showSavePictureDialog && (
                <SavePictureDialog
                    isOpen={showSavePictureDialog}
                    onClose={() => setShowSavePictureDialog(false)}
                    chartCanvas={(window as any).__activeChartCanvas || null}
                    chartContainer={(window as any).__activeChartContainer || null}
                    symbol={selectedSymbol || 'EURUSD'}
                    timeframe={timeframe || '5m'}
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
                        if (saveWorkspace) {
                            onSave?.();
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
