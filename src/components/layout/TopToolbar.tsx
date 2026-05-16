import React, { useEffect, useState, useRef } from 'react';
import ReactDOM from 'react-dom';
import { Icon } from '../ui/Icon';
import type { ChartType, Timeframe } from '../TradingChart';
import {
    FileText, TrendingUp, BarChart2, CandlestickChart, LineChart,
    ZoomIn, ZoomOut, LayoutGrid,
    MousePointer2, Crosshair, ArrowUpDown, MoveHorizontal, MoveVertical,
    Minus, Pencil, Type, Shapes, Camera, Search, User, Shield,
    LogOut, GitCommitHorizontal, AlignCenter, BookMarked, RefreshCw,
    PanelBottomOpen, LayoutPanelTop, SlidersHorizontal
} from 'lucide-react';
import { useToolbarState } from '../../hooks/useToolbarState';
import { useKeyboardShortcuts } from '../../hooks/useKeyboardShortcut';
import { SHORTCUT_CATEGORIES } from '../../services/keyboardShortcutManager';
import { useCommandBus } from '../../hooks/useCommandBus';
import type { Command } from '../../types/commands';
import { NotificationBadge } from '../notifications/NotificationBadge';
import { NotificationCenter } from '../notifications/NotificationCenter';
import { useNotificationStore } from '../../store/useNotificationStore';
import { useAppStore } from '../../store/useAppStore';
import { useLastSymbolStore } from '../../store/useLastSymbolStore';

interface TopToolbarProps {
    chartType: ChartType;
    timeframe: Timeframe;
    onChartTypeChange: (type: ChartType) => void;
    onTimeframeChange: (tf: Timeframe) => void;
    onToggleDOM?: () => void;
    symbol?: string;
    onLoadTemplate?: (template: any) => void;
}

import { MenuBar } from './MenuBar';
import { DrawingsDropdown } from './DrawingsDropdown';
import { ChartTemplateManager } from '../ChartTemplateManager';
import { indicatorManager } from '../../services/indicatorManager';
import { drawingManager } from '../../services/drawingManager';
import { captureFullPage } from '../../services/screenshotService';

export const TopToolbar: React.FC<TopToolbarProps> = ({
    chartType,
    timeframe,
    onChartTypeChange,
    onTimeframeChange,
    onToggleDOM,
    symbol = 'BTCUSD',
    onLoadTemplate
}) => {
    const { state: toolbarState, dispatch: dispatchToolbar } = useToolbarState();
    const { dispatch: dispatchCommand } = useCommandBus();

    // Sync magnet state to drawingManager
    useEffect(() => {
        drawingManager.setMagnetEnabled(toolbarState.magnetEnabled);
    }, [toolbarState.magnetEnabled]);

    // Active tool syncing is handled by TradingChart.tsx via the SELECT_TOOL command bus.
    // Do NOT call drawingManager.startDrawing/cancelDrawing here — it conflicts.

    // Auto-reset to cursor after drawing is completed
    useEffect(() => {
        const handleDrawingSaved = () => {
            dispatchToolbar({ type: 'SELECT_TOOL', tool: 'cursor' });
        };
        window.addEventListener('drawing:saved', handleDrawingSaved);
        return () => window.removeEventListener('drawing:saved', handleDrawingSaved);
    }, [dispatchToolbar]);

    // Register keyboard shortcuts via the centralized manager
    useKeyboardShortcuts([
        {
            id: 'drawing.cursor',
            key: 'Escape',
            description: 'Cancel drawing mode (select cursor tool)',
            category: SHORTCUT_CATEGORIES.CHARTS,
            handler: () => dispatchCommand({ type: 'SELECT_TOOL', payload: { tool: 'cursor' } })
        },
        {
            id: 'chart.zoom-in',
            key: '+',
            description: 'Zoom In',
            category: SHORTCUT_CATEGORIES.CHARTS,
            handler: () => dispatchCommand({ type: 'ZOOM_IN', payload: {} })
        },
        {
            id: 'chart.zoom-in-alt',
            key: '=',
            description: 'Zoom In (Alt)',
            category: SHORTCUT_CATEGORIES.CHARTS,
            handler: () => dispatchCommand({ type: 'ZOOM_IN', payload: {} })
        },
        {
            id: 'chart.zoom-out',
            key: '-',
            description: 'Zoom Out',
            category: SHORTCUT_CATEGORIES.CHARTS,
            handler: () => dispatchCommand({ type: 'ZOOM_OUT', payload: {} })
        },
        {
            id: 'chart.zoom-out-alt',
            key: '_',
            description: 'Zoom Out (Alt)',
            category: SHORTCUT_CATEGORIES.CHARTS,
            handler: () => dispatchCommand({ type: 'ZOOM_OUT', payload: {} })
        },
        {
            id: 'drawing.delete',
            key: 'Delete',
            description: 'Delete selected drawing',
            category: SHORTCUT_CATEGORIES.CHARTS,
            handler: () => dispatchCommand({ type: 'DELETE_SELECTED_DRAWING', payload: {} })
        },
        {
            id: 'drawing.select-all',
            key: 'a',
            ctrl: true,
            description: 'Select all drawings',
            category: SHORTCUT_CATEGORIES.CHARTS,
            handler: () => dispatchCommand({ type: 'SELECT_ALL_DRAWINGS', payload: {} })
        },
        {
            id: 'drawing.crosshair',
            key: 'c',
            description: 'Toggle Crosshair',
            category: SHORTCUT_CATEGORIES.CHARTS,
            handler: () => dispatchCommand({ type: 'TOGGLE_CROSSHAIR', payload: {} })
        },
        {
            id: 'drawing.trendline',
            key: 't',
            description: 'Select Trendline Tool',
            category: SHORTCUT_CATEGORIES.CHARTS,
            handler: () => dispatchCommand({ type: 'SELECT_TOOL', payload: { tool: 'trendline' } })
        },
        {
            id: 'drawing.hline',
            key: 'h',
            description: 'Select Horizontal Line Tool',
            category: SHORTCUT_CATEGORIES.CHARTS,
            handler: () => dispatchCommand({ type: 'SELECT_TOOL', payload: { tool: 'hline' } })
        },
        {
            id: 'drawing.vline',
            key: 'v',
            description: 'Select Vertical Line Tool',
            category: SHORTCUT_CATEGORIES.CHARTS,
            handler: () => dispatchCommand({ type: 'SELECT_TOOL', payload: { tool: 'vline' } })
        },
        {
            id: 'drawing.text',
            key: 'x',
            description: 'Select Text Tool',
            category: SHORTCUT_CATEGORIES.CHARTS,
            handler: () => dispatchCommand({ type: 'SELECT_TOOL', payload: { tool: 'text' } })
        }
    ]);

    // Sync props with toolbar state
    useEffect(() => {
        if (chartType !== toolbarState.chartType) {
            dispatchToolbar({ type: 'SET_CHART_TYPE', chartType: chartType as any });
        }
    }, [chartType, toolbarState.chartType, dispatchToolbar]);

    useEffect(() => {
        if (timeframe !== toolbarState.timeframe) {
            dispatchToolbar({ type: 'SET_TIMEFRAME', timeframe });
        }
    }, [timeframe, toolbarState.timeframe, dispatchToolbar]);

    return (
        <div className="flex flex-col z-50 relative bg-slate-950/20 backdrop-blur-2xl border-b border-white/5 shadow-2xl">
            {/* 1. Header Bar (Topmost) */}
            <HeaderBar
                symbol={symbol}
                timeframe={timeframe}
                server="FlexyMarkets-Server"
            />

            {/* 2. Menu Bar (File, View, etc.) */}
            <MenuBar />

            {/* 3. Main Toolbar (Icons Row) */}
            <MainToolbar
                chartType={chartType}
                timeframe={timeframe}
                onChartTypeChange={onChartTypeChange}
                onTimeframeChange={onTimeframeChange}
                onToggleDOM={onToggleDOM}
                toolbarState={toolbarState}
                dispatchCommand={dispatchCommand}
                dispatchToolbar={dispatchToolbar}
                symbol={symbol}
                onLoadTemplate={onLoadTemplate}
            />

        </div>
    );
};

// --- Sub-Components ---

const HeaderBar = ({ symbol, timeframe, server }: { symbol: string, timeframe: string, server: string }) => {
    const accountId = useAppStore((s) => s.accountId) || '---';
    const [isMaximized, setIsMaximized] = React.useState(false);

    // Sync initial maximize state and subscribe to changes
    React.useEffect(() => {
        const electronWin = (window as any).electron?.window;
        if (!electronWin) return;
        // Get initial state
        electronWin.isMaximized().then(setIsMaximized).catch(() => { });
        // Listen for changes
        const cleanup = electronWin.onMaximizeChange((val: boolean) => setIsMaximized(val));
        return cleanup;
    }, []);

    const handleMinimize = () => (window as any).electron?.window?.minimize();
    const handleMaximize = () => (window as any).electron?.window?.maximize();
    const handleClose = () => (window as any).electron?.window?.close();

    return (
        <div
            className="rtx-header-bar h-9 bg-transparent flex items-center justify-between text-[12px] font-segoe select-none text-slate-300 border-b border-white/10 shadow-[0_4px_30px_rgba(0,0,0,0.1)] backdrop-blur-md"
            style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}
        >
            {/* Left: Standard Title */}
            <div className="flex items-center gap-2 px-2" style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}>
                <img src="./titlebar-icon.png" alt="RTX Logo" className="w-4 h-4 object-contain ml-1 rounded-sm" />
                <span>{accountId} - {server} - Hedge - Flexy Markets Limited - {symbol},{timeframe.toUpperCase()}</span>
            </div>

            {/* Right: Window Controls — no-drag so clicks register */}
            <div
                className="flex items-center gap-0 h-full"
                style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
            >
                {/* Minimize */}
                <button
                    className="h-full px-3 hover:bg-white/20 hover:shadow-[0_0_10px_rgba(255,255,255,0.2)] transition-all duration-300 rounded-sm transition-colors flex items-center justify-center"
                    onClick={handleMinimize}
                    title="Minimize"
                >
                    <Minus size={10} className="text-zinc-400" strokeWidth={1.8} />
                </button>

                {/* Maximize / Restore */}
                <button
                    className="h-full px-3 hover:bg-white/20 hover:shadow-[0_0_10px_rgba(255,255,255,0.2)] transition-all duration-300 rounded-sm transition-colors flex items-center justify-center"
                    onClick={handleMaximize}
                    title={isMaximized ? 'Restore' : 'Maximize'}
                >
                    {isMaximized ? (
                        /* Restore icon: two overlapping squares */
                        <svg width="11" height="11" viewBox="0 0 12 12" fill="none" className="text-zinc-400" stroke="currentColor" strokeWidth="1.5">
                            <rect x="3" y="1" width="8" height="8" rx="1" />
                            <path d="M1 4v6a1 1 0 001 1h6" />
                        </svg>
                    ) : (
                        /* Maximize icon: single square */
                        <svg width="11" height="11" viewBox="0 0 12 12" fill="none" className="text-zinc-400" stroke="currentColor" strokeWidth="1.5">
                            <rect x="1" y="1" width="10" height="10" rx="1" />
                        </svg>
                    )}
                </button>

                {/* Close */}
                <button
                    className="h-full px-4 hover:bg-red-500 hover:shadow-[0_0_15px_rgba(239,68,68,0.6)] transition-all duration-300 rounded-sm hover:text-white transition-colors flex items-center justify-center group"
                    onClick={handleClose}
                    title="Close"
                >
                    <svg width="10" height="10" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" className="text-zinc-400 group-hover:text-white"><path d="M2 2l8 8M10 2l-8 8" /></svg>
                </button>
            </div>

        </div>
    );
};


interface MainToolbarProps extends TopToolbarProps {
    toolbarState: any;
    dispatchCommand: (cmd: Command) => void;
    dispatchToolbar: (action: any) => void;
    symbol: string;
    onLoadTemplate?: (template: any) => void;
}

type AdvancedFontSize = 'small' | 'normal' | 'large';
type AdvancedDensity = 'comfortable' | 'compact';
type AdvancedAccent = 'purple' | 'blue' | 'green' | 'amber';
type AdvancedChartSurface = 'white' | 'soft' | 'paper';

interface AdvancedViewOptions {
    fontSize: AdvancedFontSize;
    density: AdvancedDensity;
    accent: AdvancedAccent;
    chartSurface: AdvancedChartSurface;
    focusChart: boolean;
}

const ADVANCED_OPTIONS_STORAGE_KEY = 'rtx5-advanced-view-options';

const DEFAULT_ADVANCED_OPTIONS: AdvancedViewOptions = {
    fontSize: 'normal',
    density: 'comfortable',
    accent: 'purple',
    chartSurface: 'white',
    focusChart: false,
};

function loadAdvancedOptions(): AdvancedViewOptions {
    try {
        const raw = localStorage.getItem(ADVANCED_OPTIONS_STORAGE_KEY);
        if (!raw) return DEFAULT_ADVANCED_OPTIONS;
        return { ...DEFAULT_ADVANCED_OPTIONS, ...JSON.parse(raw) };
    } catch {
        return DEFAULT_ADVANCED_OPTIONS;
    }
}

const MainToolbar = ({
    chartType,
    timeframe,
    onChartTypeChange,
    onTimeframeChange,
    onToggleDOM,
    toolbarState,
    dispatchCommand,
    dispatchToolbar,
    symbol,
    onLoadTemplate
}: MainToolbarProps) => {

    const handleToolSelect = (toolId: string) => {
        // 1. Update toolbar visual state (button highlights)
        dispatchToolbar({ type: 'SELECT_TOOL', tool: toolId as any });
        // 2. Notify TradingChart via commandBus so it calls drawingManager.startDrawing()
        dispatchCommand({ type: 'SELECT_TOOL', payload: { tool: toolId } } as any);
    };

    // User dropdown state
    const [showUserMenu, setShowUserMenu] = useState(false);
    const [showAdvancedOptions, setShowAdvancedOptions] = useState(false);
    const [showDrawingDropdown, setShowDrawingDropdown] = useState(false);
    const [loggingOut, setLoggingOut] = useState(false);
    const [advancedViewEnabled, setAdvancedViewEnabled] = useState(() => {
        try {
            return localStorage.getItem('rtx5-advanced-view-enabled') === 'true';
        } catch {
            return false;
        }
    });
    const [advancedOptions, setAdvancedOptions] = useState<AdvancedViewOptions>(loadAdvancedOptions);
    const userMenuRef = useRef<HTMLDivElement>(null);
    const dropdownRef = useRef<HTMLDivElement>(null);
    const advancedOptionsRef = useRef<HTMLDivElement>(null);
    const advancedOptionsDropdownRef = useRef<HTMLDivElement>(null);
    const drawingDropdownRef = useRef<HTMLDivElement>(null);
    const accountId = useAppStore((s) => s.accountId) || '---';

    useEffect(() => {
        const root = document.documentElement;
        root.classList.toggle('rtx-advanced-view', advancedViewEnabled);
        root.classList.toggle('rtx-skin-untitled-light', advancedViewEnabled);

        root.classList.remove(
            'rtx-advanced-font-small',
            'rtx-advanced-font-normal',
            'rtx-advanced-font-large',
            'rtx-advanced-density-compact',
            'rtx-advanced-density-comfortable',
            'rtx-advanced-accent-purple',
            'rtx-advanced-accent-blue',
            'rtx-advanced-accent-green',
            'rtx-advanced-accent-amber',
            'rtx-advanced-surface-white',
            'rtx-advanced-surface-soft',
            'rtx-advanced-surface-paper',
            'rtx-advanced-focus-chart'
        );

        if (advancedViewEnabled) {
            root.classList.add(
                `rtx-advanced-font-${advancedOptions.fontSize}`,
                `rtx-advanced-density-${advancedOptions.density}`,
                `rtx-advanced-accent-${advancedOptions.accent}`,
                `rtx-advanced-surface-${advancedOptions.chartSurface}`,
            );
            root.classList.toggle('rtx-advanced-focus-chart', advancedOptions.focusChart);
        }

        try {
            localStorage.setItem('rtx5-advanced-view-enabled', String(advancedViewEnabled));
            localStorage.setItem(ADVANCED_OPTIONS_STORAGE_KEY, JSON.stringify(advancedOptions));
        } catch {
            // Ignore storage failures; the visual toggle should still work for this session.
        }

        return () => {
            root.classList.remove(
                'rtx-advanced-view',
                'rtx-skin-untitled-light',
                'rtx-advanced-font-small',
                'rtx-advanced-font-normal',
                'rtx-advanced-font-large',
                'rtx-advanced-density-compact',
                'rtx-advanced-density-comfortable',
                'rtx-advanced-accent-purple',
                'rtx-advanced-accent-blue',
                'rtx-advanced-accent-green',
                'rtx-advanced-accent-amber',
                'rtx-advanced-surface-white',
                'rtx-advanced-surface-soft',
                'rtx-advanced-surface-paper',
                'rtx-advanced-focus-chart'
            );
        };
    }, [advancedViewEnabled, advancedOptions]);

    // Close dropdown on outside click
    useEffect(() => {
        const handleClickOutside = (e: MouseEvent) => {
            const target = e.target as Node;
            const clickedUserMenu = !!userMenuRef.current?.contains(target) || !!dropdownRef.current?.contains(target);
            const clickedAdvancedOptions = !!advancedOptionsRef.current?.contains(target) || !!advancedOptionsDropdownRef.current?.contains(target);
            const clickedDrawing = !!drawingDropdownRef.current?.contains(target);

            if (!clickedDrawing) setShowDrawingDropdown(false);
            if (!clickedUserMenu && !clickedAdvancedOptions) {
                setShowUserMenu(false);
                setShowAdvancedOptions(false);
            }
        };
        if (showUserMenu || showAdvancedOptions) {
            document.addEventListener('mousedown', handleClickOutside);
        }
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, [showUserMenu, showAdvancedOptions]);

    const updateAdvancedOptions = (patch: Partial<AdvancedViewOptions>) => {
        setAdvancedOptions((current) => ({ ...current, ...patch }));
    };

    const handleLogout = () => {
        // Fire-and-forget the backend logout API (don't wait)
        fetch('https://rtxbackend.tradecopier.org/api/logout', {
            method: 'POST',
            headers: {
                'accept': '*/*',
                'Authorization': `Bearer ${localStorage.getItem('auth_token') || ''}`,
            },
        }).catch(() => { /* ignore */ });

        // Clear all auth state immediately
        useAppStore.getState().logout();
        // Force full page reload to show login
        window.location.reload();
    };

    return (
        <div className="flex items-center bg-[#131316] border-b border-white/10 h-[40px] px-1.5 shadow-sm select-none overflow-x-auto no-scrollbar gap-[2px]">



            {/* New Order & Last Symbol */}
            <MT5Group>

                <button
                    className="flex items-center gap-1.5 px-2.5 h-[32px] rounded-[3px] bg-transparent border border-transparent hover:border-blue-500/20 hover:bg-blue-500/10 text-[12px] text-zinc-300 hover:text-blue-300 transition-all font-segoe"
                    title="New Order (F9)"
                    onClick={() => {
                        window.dispatchEvent(new CustomEvent('openNewOrder'));
                    }}
                >
                    <FileText size={16} strokeWidth={1.5} className="text-blue-400" />
                    <span>New Order</span>
                </button>

                {/* Last Symbol Trader Toggle */}
                <button
                    className={`flex items-center gap-1.5 px-2.5 h-[32px] rounded-[3px] border text-[12px] transition-all font-segoe ${useLastSymbolStore.getState().panelVisible
                        ? 'bg-blue-500/15 border-blue-500/30 text-blue-400 shadow-[0_0_8px_rgba(59,130,246,0.15)]'
                        : 'bg-transparent border-transparent hover:border-blue-500/20 hover:bg-blue-500/10 text-zinc-300 hover:text-blue-300'
                        }`}
                    title="Last Symbol Trader Panel (Shift+B/S/X)"
                    onClick={() => useLastSymbolStore.getState().togglePanel()}
                >
                    <TrendingUp size={16} strokeWidth={1.5} />
                    <span>Last Symbol</span>
                    {useLastSymbolStore.getState().lastSymbol && (
                        <span className={`px-1 py-0.5 rounded text-[9px] font-mono font-bold ${useLastSymbolStore.getState().panelVisible
                            ? 'bg-blue-500/25 text-blue-300'
                            : 'bg-zinc-800 text-zinc-400 group-hover:bg-blue-500/20 group-hover:text-blue-300'
                            }`}>
                            {useLastSymbolStore.getState().lastSymbol}
                        </span>
                    )}
                </button>
            </MT5Group>

            <MT5Divider />

            {/* Group 3: Chart Types */}
            <MT5Group>
                <MT5Btn icon={<BarChart2 size={16} strokeWidth={1.5} />} title="Bar Chart" active={toolbarState.chartType === 'bar'} onClick={() => { onChartTypeChange('bar'); dispatchToolbar({ type: 'SET_CHART_TYPE', chartType: 'bar' }); dispatchCommand({ type: 'SET_CHART_TYPE', payload: { chartType: 'bar' } }); }} />
                <MT5Btn icon={<CandlestickChart size={16} strokeWidth={1.5} />} title="Candlesticks" active={toolbarState.chartType === 'candlestick'} onClick={() => { onChartTypeChange('candlestick'); dispatchToolbar({ type: 'SET_CHART_TYPE', chartType: 'candlestick' }); dispatchCommand({ type: 'SET_CHART_TYPE', payload: { chartType: 'candlestick' } }); }} />
                <MT5Btn icon={<LineChart size={16} strokeWidth={1.5} />} title="Line Chart" active={toolbarState.chartType === 'line' || toolbarState.chartType === 'area'} onClick={() => { onChartTypeChange('area'); dispatchToolbar({ type: 'SET_CHART_TYPE', chartType: 'area' }); dispatchCommand({ type: 'SET_CHART_TYPE', payload: { chartType: 'area' } }); }} />
            </MT5Group>

            <MT5Divider />

            {/* Group 4: Zoom */}
            <MT5Group>
                <MT5Btn icon={<ZoomIn size={16} strokeWidth={1.5} />} title="Zoom In" onClick={() => dispatchCommand({ type: 'ZOOM_IN', payload: {} })} />
                <MT5Btn icon={<ZoomOut size={16} strokeWidth={1.5} />} title="Zoom Out" onClick={() => dispatchCommand({ type: 'ZOOM_OUT', payload: {} })} />
            </MT5Group>

            <MT5Divider />

            {/* Group 5: Tile Windows */}
            <MT5Group>
                <MT5Btn icon={<LayoutPanelTop size={16} strokeWidth={1.5} />} title="Arrange Windows" onClick={() => dispatchCommand({ type: 'TILE_WINDOWS', payload: { mode: 'grid' } })} />
                <MT5Btn icon={<RefreshCw size={16} strokeWidth={1.5} />} title="Reset Layout" onClick={() => window.dispatchEvent(new CustomEvent('resetLayout'))} />
            </MT5Group>

            <MT5Divider />

            {/* Group 6: Chart Shift */}
            <MT5Group>
                <MT5Btn
                    icon={<Icon name="chart-shift" state={toolbarState.chartShiftEnabled ? 'active' : 'default'} />}
                    title="Chart Shift"
                    active={toolbarState.chartShiftEnabled}
                    onClick={() => {
                        dispatchToolbar({ type: 'TOGGLE_CHART_SHIFT' });
                        // Also fire a direct window event for TradingChart
                        window.dispatchEvent(new CustomEvent('rtx:chartShift', { detail: { enabled: !toolbarState.chartShiftEnabled } }));
                    }}
                />
            </MT5Group>

            <MT5Divider />

            {/* Group 7: Indicators */}
            <MT5Group>
                <MT5Btn icon={<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><rect x="1.5" y="2" width="13" height="12" rx="1" /><polyline points="3 11 5 7.5 7.5 9.5 10 5.5 13 7" strokeWidth="1.3" /><circle cx="12.5" cy="3.5" r="1" fill="#fbbf24" stroke="none" /></svg>} title="Indicators List" onClick={() => dispatchCommand({ type: 'OPEN_INDICATOR_LIST', payload: {} })} />
            </MT5Group>

            <MT5Divider />

            {/* Group 8: Timeframes */}
            <div className="flex items-center gap-[1px]">
                {(['M1', 'M5', 'M15', 'M30', 'H1', 'H4', 'D1', 'W1', 'MN'] as string[]).map((tf) => (
                    <button
                        key={tf}
                        onClick={() => {
                            onTimeframeChange(tf as Timeframe);
                            dispatchCommand({ type: 'SET_TIMEFRAME', payload: { timeframe: tf } });
                            window.dispatchEvent(new CustomEvent('change-timeframe', { detail: { timeframe: tf } }));
                        }}
                        className={`px-1.5 py-0.5 text-[11px] font-segoe rounded-[3px] transition-all border ${timeframe.toUpperCase() === tf
                            ? 'bg-blue-500/15 text-blue-400 border-blue-500/30 shadow-[0_0_8px_rgba(59,130,246,0.15)]'
                            : 'text-zinc-400 bg-transparent border-transparent hover:bg-blue-500/10 hover:text-blue-300 hover:border-blue-500/20'
                            }`}
                    >
                        {tf}
                    </button>
                ))}
            </div>

            <MT5Divider />

            {/* Group 9: Drawing Tools — BASIC MODE HIDDEN, ADVANCED MODE ONLY */}
            {/* Drawing tools are accessible in Advanced Mode via the Draw dropdown in the navbar. */}

            <MT5Divider />

            {/* Group 10: Screenshot */}
            <MT5Group>
                <MT5Btn icon={<Camera size={16} strokeWidth={1.5} />} title="Screenshot (Export Chart)" onClick={() => {
                    captureFullPage();
                }} />
            </MT5Group>

            {/* Spacer pushing the rest to the right (if space permits) */}
            <div className="flex-1" />

            {/* Group 10: Far right controls */}
            <MT5Group>
                <MT5Btn icon={<Search size={15} strokeWidth={1.5} />} title="Search" />
                <MT5Btn
                    icon={<LayoutGrid size={15} strokeWidth={1.5} />}
                    title="Advanced View"
                    active={advancedViewEnabled}
                    onClick={() => {
                        setAdvancedViewEnabled((enabled) => {
                            const next = !enabled;
                            if (!next) setShowAdvancedOptions(false);
                            return next;
                        });
                    }}
                />

                {advancedViewEnabled && (
                    <>
                        {/* Focus Chart Toggle inline */}
                        <button
                            className={`ml-2 px-2.5 py-1 text-[11px] font-semibold rounded shadow-sm transition-colors border ${advancedOptions.focusChart
                                ? 'bg-[#7E57C2] text-white border-[#7E57C2]'
                                : 'bg-white text-[#101828] border-[#d0d5dd] hover:bg-[#f9fafb]'
                                }`}
                            onClick={() => updateAdvancedOptions({ focusChart: !advancedOptions.focusChart })}
                            title="Toggle Focus Chart"
                        >
                            Focus Chart
                        </button>

                        {/* Density Native Select inline */}
                        <div className="ml-2 flex items-center bg-white border border-[#d0d5dd] rounded shadow-sm overflow-hidden h-[26px]">
                            <select
                                className="px-2 w-full h-full text-[11px] font-medium text-[#475467] bg-transparent outline-none cursor-pointer hover:bg-[#f9fafb] appearance-none"
                                value={advancedOptions.density}
                                onChange={(e) => updateAdvancedOptions({ density: e.target.value as 'comfortable' | 'compact' })}
                                title="UI Density"
                            >
                                <option value="comfortable">Comfort</option>
                                <option value="compact">Compact</option>
                            </select>
                            <div className="pointer-events-none px-1 text-[#667085]">
                                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m6 9 6 6 6-6" /></svg>
                            </div>
                        </div>

                        {/* Drawing Tools — Direct inline icon buttons, Advanced Mode only */}
                        <div className="ml-2 flex items-center gap-[2px] border border-[#d0d5dd] rounded bg-white shadow-sm px-1">
                            {/* Cursor */}
                            <button
                                onClick={() => handleToolSelect('cursor')}
                                title="Cursor (Esc)"
                                className={`flex items-center justify-center w-[28px] h-[26px] rounded transition-colors ${(toolbarState.activeTool === null || toolbarState.activeTool === 'cursor')
                                        ? 'bg-[#7E57C2] text-white'
                                        : 'text-[#475467] hover:bg-[#F3E5F5] hover:text-[#7E57C2]'
                                    }`}
                            >
                                <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round">
                                    <path d="M3 2L3 13L6.5 10L8.5 14.5L10 13.8L8 9.3L12 9.3Z" fill="currentColor" stroke="currentColor" />
                                </svg>
                            </button>

                            <div className="w-px h-4 bg-[#e5e7eb]" />

                            {/* Trend Line */}
                            <button
                                onClick={() => handleToolSelect('trendline')}
                                title="Trend Line"
                                className={`flex items-center justify-center w-[28px] h-[26px] rounded transition-colors ${toolbarState.activeTool === 'trendline'
                                        ? 'bg-[#7E57C2] text-white'
                                        : 'text-[#475467] hover:bg-[#F3E5F5] hover:text-[#7E57C2]'
                                    }`}
                            >
                                <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round">
                                    <line x1="3" y1="13" x2="13" y2="3" />
                                    <circle cx="3" cy="13" r="1.5" fill="currentColor" />
                                    <circle cx="13" cy="3" r="1.5" fill="currentColor" />
                                </svg>
                            </button>

                            {/* Horizontal Line */}
                            <button
                                onClick={() => handleToolSelect('hline')}
                                title="Horizontal Line"
                                className={`flex items-center justify-center w-[28px] h-[26px] rounded transition-colors ${toolbarState.activeTool === 'hline'
                                        ? 'bg-[#7E57C2] text-white'
                                        : 'text-[#475467] hover:bg-[#F3E5F5] hover:text-[#7E57C2]'
                                    }`}
                            >
                                <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round">
                                    <line x1="2" y1="8" x2="14" y2="8" />
                                    <circle cx="4" cy="8" r="1.5" fill="currentColor" />
                                    <circle cx="12" cy="8" r="1.5" fill="currentColor" />
                                </svg>
                            </button>

                            {/* Vertical Line */}
                            <button
                                onClick={() => handleToolSelect('vline')}
                                title="Vertical Line"
                                className={`flex items-center justify-center w-[28px] h-[26px] rounded transition-colors ${toolbarState.activeTool === 'vline'
                                        ? 'bg-[#7E57C2] text-white'
                                        : 'text-[#475467] hover:bg-[#F3E5F5] hover:text-[#7E57C2]'
                                    }`}
                            >
                                <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round">
                                    <line x1="8" y1="2" x2="8" y2="14" />
                                    <circle cx="8" cy="4" r="1.5" fill="currentColor" />
                                    <circle cx="8" cy="12" r="1.5" fill="currentColor" />
                                </svg>
                            </button>

                            {/* Equidistant Channel */}
                            <button
                                onClick={() => handleToolSelect('channel')}
                                title="Equidistant Channel"
                                className={`flex items-center justify-center w-[28px] h-[26px] rounded transition-colors ${toolbarState.activeTool === 'channel'
                                        ? 'bg-[#7E57C2] text-white'
                                        : 'text-[#475467] hover:bg-[#F3E5F5] hover:text-[#7E57C2]'
                                    }`}
                            >
                                <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round">
                                    <line x1="2" y1="11" x2="11" y2="3" />
                                    <line x1="5" y1="14" x2="14" y2="6" />
                                    <circle cx="2" cy="11" r="1.3" fill="currentColor" />
                                    <circle cx="11" cy="3" r="1.3" fill="currentColor" />
                                </svg>
                            </button>

                            {/* Fibonacci Retracement */}
                            <button
                                onClick={() => handleToolSelect('fibonacci')}
                                title="Fibonacci Retracement"
                                className={`flex items-center justify-center w-[28px] h-[26px] rounded transition-colors ${toolbarState.activeTool === 'fibonacci'
                                        ? 'bg-[#7E57C2] text-white'
                                        : 'text-[#475467] hover:bg-[#F3E5F5] hover:text-[#7E57C2]'
                                    }`}
                            >
                                <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round">
                                    <line x1="1" y1="3" x2="15" y2="3" />
                                    <line x1="1" y1="6.5" x2="15" y2="6.5" />
                                    <line x1="1" y1="10" x2="15" y2="10" />
                                    <line x1="1" y1="13" x2="15" y2="13" />
                                    <line x1="3" y1="13" x2="13" y2="3" />
                                    <circle cx="3" cy="13" r="1.3" fill="currentColor" />
                                    <circle cx="13" cy="3" r="1.3" fill="currentColor" />
                                </svg>
                            </button>
                        </div>

                        {/* Stamps dropdown — beside drawing tools */}
                        <div className="ml-1 flex items-center border border-[#d0d5dd] rounded bg-white shadow-sm overflow-visible">
                            <StampsPopover
                                dispatchCommand={dispatchCommand}
                                dispatchToolbar={dispatchToolbar}
                                activeTool={toolbarState.activeTool}
                            />
                        </div>

                        {/* Clear All Drawings button */}
                        <button
                            onClick={() => {
                                drawingManager.clearAllDrawings();
                                handleToolSelect('cursor');
                            }}
                            title="Clear All Drawings"
                            className="ml-1 flex items-center justify-center w-[28px] h-[26px] rounded border border-[#fda29b] bg-white text-[#d92d20] hover:bg-[#fef3f2] hover:border-[#f97066] transition-colors shadow-sm"
                        >
                            <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                                <polyline points="2 4 4 4 14 4" />
                                <path d="M5 4V2h6v2" />
                                <path d="M6 7v5M10 7v5" />
                                <path d="M3 4l1 9a1 1 0 001 1h6a1 1 0 001-1l1-9" />
                            </svg>
                        </button>
                    </>
                )}

                {/* User Icon with Logout Dropdown */}
                <div className="relative" ref={userMenuRef}>
                    <button
                        onClick={() => {
                            setShowAdvancedOptions(false);
                            setShowUserMenu(!showUserMenu);
                        }}
                        className={`flex items-center justify-center w-[32px] h-[32px] rounded-[3px] transition-all border group relative ${showUserMenu
                            ? 'bg-blue-500/15 border-blue-500/30 text-blue-400 shadow-[0_0_8px_rgba(59,130,246,0.15)]'
                            : 'bg-transparent border-transparent hover:border-blue-500/20 hover:bg-blue-500/10 text-zinc-400 hover:text-blue-300'
                            }`}
                        title="Account"
                    >
                        <User size={16} strokeWidth={1.5} />
                        <div className="absolute -top-1 -right-1 w-3 h-3 bg-red-500 text-white rounded-full flex items-center justify-center text-[7px] font-bold">1</div>
                    </button>

                    {/* Dropdown Menu - rendered via portal to escape overflow clipping */}
                    {showUserMenu && ReactDOM.createPortal(
                        <div
                            ref={dropdownRef}
                            className="fixed w-52 bg-[#1e222d] [.rtx-advanced-view_&]:bg-white border border-zinc-600 [.rtx-advanced-view_&]:border-gray-200 rounded shadow-2xl z-[9999] py-1"
                            style={{
                                top: (userMenuRef.current?.getBoundingClientRect().bottom ?? 0) + 4,
                                right: window.innerWidth - (userMenuRef.current?.getBoundingClientRect().right ?? 0),
                            }}
                        >
                            {/* Account info */}
                            <div className="px-3 py-2 border-b border-zinc-700 [.rtx-advanced-view_&]:border-gray-100">
                                <div className="text-[10px] text-zinc-500 [.rtx-advanced-view_&]:text-gray-500 uppercase tracking-wider mb-1">Account</div>
                                <div className="text-[12px] text-zinc-200 [.rtx-advanced-view_&]:text-gray-900 font-mono font-medium">{accountId}</div>
                            </div>

                            {/* Logout button */}
                            <button
                                onClick={handleLogout}
                                disabled={loggingOut}
                                className="w-full flex items-center gap-2.5 px-3 py-2 text-[12px] text-red-400 [.rtx-advanced-view_&]:text-red-500 hover:bg-red-500 hover:shadow-[0_0_15px_rgba(239,68,68,0.6)] transition-all duration-300 rounded-sm/15 hover:text-red-300 [.rtx-advanced-view_&]:hover:text-red-700 [.rtx-advanced-view_&]:hover:bg-red-50 [.rtx-advanced-view_&]:hover:shadow-none transition-colors disabled:opacity-50"
                            >
                                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                    <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
                                    <polyline points="16 17 21 12 16 7" />
                                    <line x1="21" y1="12" x2="9" y2="12" />
                                </svg>
                                {loggingOut ? 'Logging out...' : 'Log Out'}
                            </button>
                        </div>,
                        document.body
                    )}
                </div>

                <Shield size={15} strokeWidth={1.5} className="text-emerald-500 mx-1" />
                {/* Ping bar block */}
                <div className="w-[40px] h-3.5 border border-zinc-600 ml-1 mt-0.5 relative bg-[#0d0d11]">
                    <div className="absolute top-0 left-0 h-full w-[15%] bg-emerald-500"></div>
                </div>
            </MT5Group>

        </div>
    );
};





const AdvancedOptionRow = ({ label, children }: { label: string; children: React.ReactNode }) => (
    <div className="flex items-center justify-between gap-3 py-1.5">
        <span className="text-[11px] font-medium text-[#475467]">{label}</span>
        {children}
    </div>
);

const SegmentedControl = ({
    value,
    options,
    onChange,
}: {
    value: string;
    options: { value: string; label: string }[];
    onChange: (value: string) => void;
}) => (
    <div className="inline-flex items-center rounded border border-[#d0d5dd] overflow-hidden bg-[#f9fafb]">
        {options.map((option) => (
            <button
                key={option.value}
                onClick={() => onChange(option.value)}
                className={`px-2 py-1 text-[10px] transition-colors border-r border-[#d0d5dd] last:border-r-0 ${value === option.value
                    ? 'bg-white text-[#101828] shadow-sm font-semibold'
                    : 'text-[#667085] hover:bg-white'
                    }`}
            >
                {option.label}
            </button>
        ))}
    </div>
);

const MT5Group = ({ children }: { children: React.ReactNode }) => (
    <div className="flex items-center gap-[2px]">
        {children}
    </div>
);


// ─── Stamps Popover ──────────────────────────────────────────────────────────
const STAMP_OPTIONS = [
    { subtype: 'thumbsUp',       label: 'Thumbs Up' },
    { subtype: 'thumbsDown',     label: 'Thumbs Down' },
    { subtype: 'arrowUp',        label: 'Arrow Up' },
    { subtype: 'arrowDown',      label: 'Arrow Down' },
    { subtype: 'stopSign',       label: 'Stop Sign' },
    { subtype: 'checkSign',      label: 'Check Sign' },
    { subtype: 'buy',            label: 'Buy' },
    { subtype: 'sell',           label: 'Sell' },
    { subtype: 'leftPriceLabel', label: 'Left Price Label' },
    { subtype: 'rightPriceLabel',label: 'Right Price Label' },
];

const StampIcon = ({ subtype, size = 18 }: { subtype: string; size?: number }) => {
    switch (subtype) {
        case 'thumbsUp':
            return <span style={{ fontSize: size - 2, lineHeight: 1 }}>👍</span>;
        case 'thumbsDown':
            return <span style={{ fontSize: size - 2, lineHeight: 1 }}>👎</span>;
        case 'arrowUp':
            return (
                <svg width={size} height={size} viewBox="0 0 16 16" fill="none" stroke="#22c55e" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M8 13V3M3 8l5-5 5 5" />
                </svg>
            );
        case 'arrowDown':
            return (
                <svg width={size} height={size} viewBox="0 0 16 16" fill="none" stroke="#ef4444" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M8 3v10M3 8l5 5 5-5" />
                </svg>
            );
        case 'stopSign':
            return <span style={{ fontSize: size - 2, lineHeight: 1 }}>🛑</span>;
        case 'checkSign':
            return (
                <svg width={size} height={size} viewBox="0 0 16 16" fill="none" stroke="#22c55e" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <circle cx="8" cy="8" r="6" />
                    <path d="M5.5 8.5l2 2 3.5-4" />
                </svg>
            );
        case 'buy':
            return (
                <svg width={size} height={size} viewBox="0 0 16 16">
                    <polygon points="8,2 15,14 1,14" fill="#22c55e" />
                </svg>
            );
        case 'sell':
            return (
                <svg width={size} height={size} viewBox="0 0 16 16">
                    <polygon points="8,14 15,2 1,2" fill="#ef4444" />
                </svg>
            );
        case 'leftPriceLabel':
            return (
                <svg width={size} height={size} viewBox="0 0 18 14">
                    <rect x="0" y="2" width="14" height="10" rx="2" fill="#2563eb" />
                    <polygon points="14,7 18,4 18,10" fill="#2563eb" />
                    <text x="7" y="10" fill="white" fontSize="6" fontFamily="monospace" textAnchor="middle">P</text>
                </svg>
            );
        case 'rightPriceLabel':
            return (
                <svg width={size} height={size} viewBox="0 0 18 14">
                    <rect x="4" y="2" width="14" height="10" rx="2" fill="#2563eb" />
                    <polygon points="4,7 0,4 0,10" fill="#2563eb" />
                    <text x="11" y="10" fill="white" fontSize="6" fontFamily="monospace" textAnchor="middle">P</text>
                </svg>
            );
        default:
            return <span style={{ fontSize: size - 2 }}>?</span>;
    }
};

const StampsPopover: React.FC<{
    dispatchCommand: (cmd: any) => void;
    dispatchToolbar: (action: any) => void;
    activeTool?: string;
}> = ({ dispatchCommand, dispatchToolbar, activeTool }) => {
    const [open, setOpen] = useState(false);
    const [lastSubtype, setLastSubtype] = useState('thumbsUp');
    const ref = useRef<HTMLDivElement>(null);
    const portalRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        if (!open) return;
        const handler = (e: MouseEvent) => {
            if (
                !ref.current?.contains(e.target as Node) &&
                !portalRef.current?.contains(e.target as Node)
            ) {
                setOpen(false);
            }
        };
        document.addEventListener('mousedown', handler);
        return () => document.removeEventListener('mousedown', handler);
    }, [open]);

    const selectStamp = (subtype: string) => {
        setLastSubtype(subtype);
        setOpen(false);
        dispatchToolbar({ type: 'SELECT_TOOL', tool: 'stamp' as any });
        dispatchCommand({ type: 'SELECT_TOOL', payload: { tool: 'stamp', subtype } } as any);
    };

    const isActive = activeTool === 'stamp';
    const opt = STAMP_OPTIONS.find(o => o.subtype === lastSubtype) || STAMP_OPTIONS[0];

    return (
        <div ref={ref} className="relative flex items-center h-[26px]">
            {/* Main button — icon only, re-uses last subtype */}
            <button
                className={`flex items-center justify-center w-[28px] h-full rounded-l transition-colors ${
                    isActive
                        ? 'bg-[#7E57C2] text-white'
                        : 'text-[#475467] hover:bg-[#F3E5F5] hover:text-[#7E57C2]'
                }`}
                title={`Stamp: ${opt.label} — click on chart to place`}
                onClick={() => selectStamp(lastSubtype)}
            >
                <StampIcon subtype={lastSubtype} size={17} />
            </button>

            {/* Chevron — opens picker */}
            <button
                className={`flex items-center justify-center px-1 h-full rounded-r border-l border-[#e5e7eb] transition-colors ${
                    isActive || open
                        ? 'bg-[#7E57C2] text-white border-[#7E57C2]'
                        : 'text-[#667085] hover:bg-[#F3E5F5] hover:text-[#7E57C2]'
                }`}
                title="Choose stamp"
                onClick={() => setOpen(o => !o)}
            >
                <svg width="9" height="9" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
                    <path d="M2 3.5l3 3 3-3" />
                </svg>
            </button>

            {open && ReactDOM.createPortal(
                <div
                    ref={portalRef}
                    className="fixed bg-white border border-[#d0d5dd] rounded shadow-xl z-[9999] p-1.5"
                    style={{
                        top: (ref.current?.getBoundingClientRect().bottom ?? 0) + 4,
                        left: ref.current?.getBoundingClientRect().left ?? 0,
                    }}
                >
                    {/* 5-column icon grid */}
                    <div className="grid grid-cols-5 gap-0.5">
                        {STAMP_OPTIONS.map(o => (
                            <button
                                key={o.subtype}
                                title={o.label}
                                className={`flex items-center justify-center w-8 h-8 rounded transition-colors ${
                                    o.subtype === lastSubtype
                                        ? 'bg-[#F3E5F5] ring-1 ring-[#7E57C2]'
                                        : 'hover:bg-[#f3f4f6]'
                                }`}
                                onClick={() => selectStamp(o.subtype)}
                            >
                                <StampIcon subtype={o.subtype} size={18} />
                            </button>
                        ))}
                    </div>
                </div>,
                document.body
            )}
        </div>
    );
};
const MT5Divider = () => (
    <div className="rtx-mt5-divider mx-[4px] w-[2px] h-6 border-l border-white/10 bg-[#1a1c23] shadow-sm" />
);

interface MT5BtnProps {
    icon: React.ReactNode;
    title: string;
    active?: boolean;
    onClick?: () => void;
}

const MT5Btn = ({ icon, title, active, onClick }: MT5BtnProps) => (
    <button
        onClick={onClick}
        title={title}
        className={`flex items-center justify-center w-[32px] h-[32px] rounded-[3px] transition-all border group
            ${active
                ? 'bg-blue-500/15 border-blue-500/30 shadow-[0_0_8px_rgba(59,130,246,0.15)] text-blue-400'
                : 'bg-transparent border-transparent hover:border-blue-500/20 hover:bg-blue-500/10 text-zinc-400 hover:text-blue-300'
            }
        `}
    >
        {icon}
    </button>
);

// MT5-style tool button with a small ▾ dropdown arrow for sub-type selection
interface MT5DropdownItem {
    label: string;
    icon: React.ReactNode;
    onClick: () => void;
    active?: boolean;
}

interface MT5ToolWithDropdownProps {
    icon: React.ReactNode;
    title: string;
    active?: boolean;
    onMainClick: () => void;
    items: MT5DropdownItem[];
}

const MT5ToolWithDropdown = ({ icon, title, active, onMainClick, items }: MT5ToolWithDropdownProps) => {
    const [open, setOpen] = React.useState(false);
    const btnRef = React.useRef<HTMLButtonElement>(null);
    const [pos, setPos] = React.useState({ top: 0, left: 0 });

    const openDropdown = (e: React.MouseEvent) => {
        e.stopPropagation();
        if (btnRef.current) {
            const rect = btnRef.current.getBoundingClientRect();
            setPos({ top: rect.bottom + 4, left: rect.left });
        }
        setOpen(v => !v);
    };

    // Close on outside click
    React.useEffect(() => {
        if (!open) return;
        const handler = (e: MouseEvent) => {
            const target = e.target as Node;
            if (btnRef.current && !btnRef.current.closest('[data-dropdown-root]')?.contains(target)) {
                setOpen(false);
            }
        };
        document.addEventListener('mousedown', handler, true);
        return () => document.removeEventListener('mousedown', handler, true);
    }, [open]);

    return (
        <div className="relative flex items-center" data-dropdown-root>
            {/* Main tool button */}
            <button
                onClick={onMainClick}
                title={title}
                className={`flex items-center justify-center w-[28px] h-[32px] rounded-l-[3px] transition-all border border-r-0 group
                    ${active
                        ? 'bg-blue-500/15 border-blue-500/30 shadow-[0_0_8px_rgba(59,130,246,0.15)] text-blue-400'
                        : 'bg-transparent border-transparent hover:border-blue-500/20 hover:bg-blue-500/10 text-zinc-400 hover:text-blue-300'
                    }
                `}
            >
                {icon}
            </button>
            {/* Small ▾ dropdown arrow button */}
            <button
                ref={btnRef}
                onClick={openDropdown}
                title={`${title} options`}
                className={`flex items-center justify-center w-[10px] h-[32px] rounded-r-[3px] transition-all border border-l-0 group
                    ${active || open
                        ? 'bg-blue-500/15 border-blue-500/30 text-blue-400'
                        : 'bg-transparent border-transparent hover:border-blue-500/20 hover:bg-blue-500/10 text-zinc-600 hover:text-blue-300'
                    }
                `}
            >
                <svg width="8" height="6" viewBox="0 0 8 6" fill="currentColor"><path d="M0 0 L8 0 L4 5 Z" /></svg>
            </button>

            {/* Dropdown submenu — rendered via portal to escape toolbar overflow clipping */}
            {open && ReactDOM.createPortal(
                <div
                    className="fixed w-52 bg-[#131316] border border-zinc-700/80 rounded shadow-2xl z-[9999] py-1"
                    style={{ top: pos.top, left: pos.left }}
                >
                    {items.map((item) => (
                        <button
                            key={item.label}
                            onClick={() => { item.onClick(); setOpen(false); }}
                            className={`w-full flex items-center gap-3 px-3 py-[7px] text-[11.5px] transition-colors cursor-pointer
                                ${item.active
                                    ? 'bg-blue-500/15 text-blue-300'
                                    : 'text-zinc-300 hover:bg-zinc-800 hover:text-white'
                                }
                            `}
                        >
                            <span className="w-4 flex justify-center text-zinc-400">{item.icon}</span>
                            <span>{item.label}</span>
                            {item.active && <span className="ml-auto text-blue-400">✓</span>}
                        </button>
                    ))}
                </div>,
                document.body
            )}
        </div>
    );
};
