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
    PanelBottomOpen, LayoutPanelTop
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
            className="h-9 bg-transparent flex items-center justify-between text-[12px] font-segoe select-none text-slate-300 border-b border-white/10 shadow-[0_4px_30px_rgba(0,0,0,0.1)] backdrop-blur-md"
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
                    <svg width="10" height="10" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" className="text-zinc-400 group-hover:text-white"><path d="M2 2l8 8M10 2l-8 8"/></svg>
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
    const [loggingOut, setLoggingOut] = useState(false);
    const [advancedViewEnabled, setAdvancedViewEnabled] = useState(() => {
        try {
            return localStorage.getItem('rtx5-advanced-view-enabled') === 'true';
        } catch {
            return false;
        }
    });
    const userMenuRef = useRef<HTMLDivElement>(null);
    const dropdownRef = useRef<HTMLDivElement>(null);
    const accountId = useAppStore((s) => s.accountId) || '---';

    useEffect(() => {
        const root = document.documentElement;
        root.classList.toggle('rtx-advanced-view', advancedViewEnabled);
        root.classList.toggle('rtx-skin-untitled-light', advancedViewEnabled);

        try {
            localStorage.setItem('rtx5-advanced-view-enabled', String(advancedViewEnabled));
        } catch {
            // Ignore storage failures; the visual toggle should still work for this session.
        }

        return () => {
            root.classList.remove('rtx-advanced-view', 'rtx-skin-untitled-light');
        };
    }, [advancedViewEnabled]);

    // Close dropdown on outside click
    useEffect(() => {
        const handleClickOutside = (e: MouseEvent) => {
            const target = e.target as Node;
            // Check both the button wrapper AND the portal dropdown
            if (
                userMenuRef.current && !userMenuRef.current.contains(target) &&
                dropdownRef.current && !dropdownRef.current.contains(target)
            ) {
                setShowUserMenu(false);
            }
        };
        if (showUserMenu) {
            document.addEventListener('mousedown', handleClickOutside);
        }
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, [showUserMenu]);

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
                <MT5Btn icon={<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><rect x="1.5" y="2" width="13" height="12" rx="1"/><polyline points="3 11 5 7.5 7.5 9.5 10 5.5 13 7" strokeWidth="1.3"/><circle cx="12.5" cy="3.5" r="1" fill="#fbbf24" stroke="none"/></svg>} title="Indicators List" onClick={() => dispatchCommand({ type: 'OPEN_INDICATOR_LIST', payload: {} })} />
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

            {/* Group 9: Drawing Tools */}
            <MT5Group>
                {/* Cursor — deactivates all drawing tools */}
                <MT5Btn 
                    icon={
                        <svg width="18" height="18" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M3 2L3 13L6.5 10L8.5 14.5L10 13.8L8 9.3L12 9.3Z" fill="#0a1120" stroke="currentColor" />
                        </svg>
                    }
                    active={(toolbarState.activeTool === null || toolbarState.activeTool === 'cursor') && !toolbarState.crosshairEnabled} 
                    onClick={() => { 
                        handleToolSelect('cursor'); 
                        if (toolbarState.crosshairEnabled) dispatchToolbar({ type: 'TOGGLE_CROSSHAIR' }); 
                    }} 
                    title="Cursor (Esc)" 
                />

                {/* Crosshair — toggle chart crosshair mode */}
                <MT5Btn 
                    icon={
                        <svg width="18" height="18" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round">
                            <line x1="8" y1="1" x2="8" y2="6" />
                            <line x1="8" y1="10" x2="8" y2="15" />
                            <line x1="1" y1="8" x2="6" y2="8" />
                            <line x1="10" y1="8" x2="15" y2="8" />
                            <circle cx="8" cy="8" r="2" />
                        </svg>
                    }
                    active={toolbarState.crosshairEnabled && (toolbarState.activeTool === null || toolbarState.activeTool === 'cursor')} 
                    onClick={() => { 
                        dispatchToolbar({ type: 'TOGGLE_CROSSHAIR' }); 
                        if (toolbarState.activeTool !== null && toolbarState.activeTool !== 'cursor') handleToolSelect('cursor'); 
                    }} 
                    title="Crosshair" 
                />

                {/* Lines — Vertical Line (last selected shown), dropdown for all 3 */}
                <MT5ToolWithDropdown
                    icon={
                        toolbarState.activeTool === 'hline' ? (
                            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round">
                                <line x1="2" y1="8" x2="14" y2="8"/>
                                <circle cx="4" cy="8" r="1.5" fill="currentColor"/>
                                <circle cx="12" cy="8" r="1.5" fill="currentColor"/>
                            </svg>
                        ) : toolbarState.activeTool === 'trendline' ? (
                            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round">
                                <line x1="3" y1="13" x2="13" y2="3"/>
                                <circle cx="3" cy="13" r="1.5" fill="currentColor"/>
                                <circle cx="13" cy="3" r="1.5" fill="currentColor"/>
                            </svg>
                        ) : (
                            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round">
                                <line x1="8" y1="2" x2="8" y2="14"/>
                                <circle cx="8" cy="5" r="1.5" fill="currentColor"/>
                                <circle cx="8" cy="11" r="1.5" fill="currentColor"/>
                            </svg>
                        )
                    }
                    title={toolbarState.activeTool === 'hline' ? 'Horizontal Line' : toolbarState.activeTool === 'trendline' ? 'Trend Line' : 'Vertical Line'}
                    active={toolbarState.activeTool === 'vline' || toolbarState.activeTool === 'hline' || toolbarState.activeTool === 'trendline'}
                    onMainClick={() => handleToolSelect(
                        (toolbarState.activeTool === 'hline' || toolbarState.activeTool === 'trendline') 
                            ? toolbarState.activeTool 
                            : 'vline'
                    )}
                    items={[
                        { label: 'Vertical Line',   icon: <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3"><line x1="8" y1="2" x2="8" y2="14"/><circle cx="8" cy="5" r="1.5" fill="currentColor"/><circle cx="8" cy="11" r="1.5" fill="currentColor"/></svg>, onClick: () => handleToolSelect('vline'),     active: toolbarState.activeTool === 'vline' },
                        { label: 'Horizontal Line', icon: <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3"><line x1="2" y1="8" x2="14" y2="8"/><circle cx="5" cy="8" r="1.5" fill="currentColor"/><circle cx="11" cy="8" r="1.5" fill="currentColor"/></svg>, onClick: () => handleToolSelect('hline'),     active: toolbarState.activeTool === 'hline' },
                        { label: 'Trend Line',       icon: <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3"><line x1="3" y1="13" x2="13" y2="3"/><circle cx="3" cy="13" r="1.5" fill="currentColor"/><circle cx="13" cy="3" r="1.5" fill="currentColor"/></svg>, onClick: () => handleToolSelect('trendline'), active: toolbarState.activeTool === 'trendline' },
                    ]}
                />

                {/* Channels */}
                <MT5ToolWithDropdown
                    icon={
                        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round">
                            <line x1="2" y1="11" x2="11" y2="3"/>
                            <line x1="5" y1="14" x2="14" y2="6"/>
                            <circle cx="2" cy="11" r="1.4" fill="currentColor"/>
                            <circle cx="11" cy="3" r="1.4" fill="currentColor"/>
                            <circle cx="5" cy="14" r="1.4" fill="currentColor"/>
                        </svg>
                    }
                    title="Channel"
                    active={toolbarState.activeTool === 'channel' || toolbarState.activeTool === 'measure'}
                    onMainClick={() => handleToolSelect(toolbarState.activeTool === 'measure' ? 'measure' : 'channel')}
                    items={[
                        { label: 'Equidistant Channel', icon: <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3"><line x1="2" y1="10" x2="10" y2="2"/><line x1="6" y1="14" x2="14" y2="6"/><circle cx="2" cy="10" r="1.4" fill="currentColor"/><circle cx="10" cy="2" r="1.4" fill="currentColor"/></svg>, onClick: () => handleToolSelect('channel'), active: toolbarState.activeTool === 'channel' },
                        { label: 'Measure',             icon: <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3"><rect x="2" y="5" width="12" height="6" rx="1"/><line x1="5" y1="5" x2="5" y2="11"/><line x1="8" y1="5" x2="8" y2="11"/><line x1="11" y1="5" x2="11" y2="11"/></svg>,                                                                        onClick: () => handleToolSelect('measure'),  active: toolbarState.activeTool === 'measure' },
                    ]}
                />

                {/* Fibonacci */}
                <MT5ToolWithDropdown
                    icon={
                        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round">
                            <line x1="1" y1="3" x2="15" y2="3"/>
                            <line x1="1" y1="6.5" x2="15" y2="6.5"/>
                            <line x1="1" y1="10" x2="15" y2="10"/>
                            <line x1="1" y1="13" x2="15" y2="13"/>
                            <line x1="3" y1="13" x2="13" y2="3"/>
                            <circle cx="3" cy="13" r="1.4" fill="currentColor"/>
                            <circle cx="13" cy="3" r="1.4" fill="currentColor"/>
                        </svg>
                    }
                    title="Fibonacci"
                    active={toolbarState.activeTool === 'fibonacci' || toolbarState.activeTool === 'fib_extension'}
                    onMainClick={() => handleToolSelect(toolbarState.activeTool === 'fib_extension' ? 'fib_extension' : 'fibonacci')}
                    items={[
                        { label: 'Fibonacci Retracement', icon: <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.2"><line x1="1" y1="3" x2="15" y2="3"/><line x1="1" y1="7" x2="15" y2="7"/><line x1="1" y1="13" x2="15" y2="13"/><line x1="3" y1="13" x2="13" y2="3"/><circle cx="3" cy="13" r="1.4" fill="currentColor"/><circle cx="13" cy="3" r="1.4" fill="currentColor"/></svg>, onClick: () => handleToolSelect('fibonacci'),      active: toolbarState.activeTool === 'fibonacci' },
                        { label: 'Fibonacci Extension',   icon: <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.2"><line x1="1" y1="3" x2="15" y2="3"/><line x1="1" y1="6" x2="15" y2="6"/><line x1="1" y1="10" x2="15" y2="10"/><line x1="1" y1="13" x2="15" y2="13"/><line x1="3" y1="3" x2="13" y2="13"/><circle cx="3" cy="3" r="1.4" fill="currentColor"/><circle cx="13" cy="13" r="1.4" fill="currentColor"/></svg>, onClick: () => handleToolSelect('fib_extension'), active: toolbarState.activeTool === 'fib_extension' },
                    ]}
                />

                {/* Text / Annotations */}
                <MT5ToolWithDropdown
                    icon={<Type size={16} strokeWidth={1.5} />}
                    title="Text"
                    active={toolbarState.activeTool === 'text' || toolbarState.activeTool === 'callout'}
                    onMainClick={() => handleToolSelect(toolbarState.activeTool === 'callout' ? 'callout' : 'text')}
                    items={[
                        { label: 'Text',    icon: <Type size={14} strokeWidth={1.5}/>,                                                                                                                                                                                                                                           onClick: () => handleToolSelect('text'),    active: toolbarState.activeTool === 'text' },
                        { label: 'Callout', icon: <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"><rect x="2" y="2" width="10" height="7" rx="1"/><polyline points="4 9 4 13 7 9"/></svg>, onClick: () => handleToolSelect('callout'), active: toolbarState.activeTool === 'callout' },
                    ]}
                />

                {/* Shapes */}
                <MT5ToolWithDropdown
                    icon={<Shapes size={16} strokeWidth={1.5} />}
                    title="Shapes"
                    active={toolbarState.activeTool === 'rectangle' || toolbarState.activeTool === 'ellipse' || toolbarState.activeTool === 'freehand'}
                    onMainClick={() => handleToolSelect(
                        toolbarState.activeTool === 'ellipse' ? 'ellipse' : 
                        toolbarState.activeTool === 'freehand' ? 'freehand' : 'rectangle'
                    )}
                    items={[
                        { label: 'Rectangle', icon: <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5"><rect x="2" y="4" width="12" height="8" rx="1"/></svg>,                                                                                                                  onClick: () => handleToolSelect('rectangle'), active: toolbarState.activeTool === 'rectangle' },
                        { label: 'Ellipse',   icon: <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5"><ellipse cx="8" cy="8" rx="6" ry="4"/></svg>,                                                                                                                             onClick: () => handleToolSelect('ellipse'),   active: toolbarState.activeTool === 'ellipse' },
                        { label: 'Freehand',  icon: <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"><path d="M2 12 C4 8 6 4 8 6 C10 8 12 4 14 4"/></svg>,                                                                                               onClick: () => handleToolSelect('freehand'),  active: toolbarState.activeTool === 'freehand' },
                    ]}
                />
            </MT5Group>

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
                    onClick={() => setAdvancedViewEnabled((enabled) => !enabled)}
                />

                {/* User Icon with Logout Dropdown */}
                <div className="relative" ref={userMenuRef}>
                    <button
                        onClick={() => setShowUserMenu(!showUserMenu)}
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
                            className="fixed w-52 bg-[#1e222d] border border-zinc-600 rounded shadow-2xl z-[9999] py-1"
                            style={{
                                top: (userMenuRef.current?.getBoundingClientRect().bottom ?? 0) + 4,
                                right: window.innerWidth - (userMenuRef.current?.getBoundingClientRect().right ?? 0),
                            }}
                        >
                            {/* Account info */}
                            <div className="px-3 py-2 border-b border-zinc-700">
                                <div className="text-[10px] text-zinc-500 uppercase tracking-wider mb-1">Account</div>
                                <div className="text-[12px] text-zinc-200 font-mono font-medium">{accountId}</div>
                            </div>

                            {/* Logout button */}
                            <button
                                onClick={handleLogout}
                                disabled={loggingOut}
                                className="w-full flex items-center gap-2.5 px-3 py-2 text-[12px] text-red-400 hover:bg-red-500 hover:shadow-[0_0_15px_rgba(239,68,68,0.6)] transition-all duration-300 rounded-sm/15 hover:text-red-300 transition-colors disabled:opacity-50"
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



// --- MT5 Style Utility Components ---

const MT5Group = ({ children }: { children: React.ReactNode }) => (
    <div className="flex items-center gap-[2px]">
        {children}
    </div>
);

const MT5Divider = () => (
    <div className="mx-[4px] w-[2px] h-6 border-l border-white/10 bg-[#1a1c23] shadow-sm" />
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
                <svg width="8" height="6" viewBox="0 0 8 6" fill="currentColor"><path d="M0 0 L8 0 L4 5 Z"/></svg>
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
                                ${ item.active
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
