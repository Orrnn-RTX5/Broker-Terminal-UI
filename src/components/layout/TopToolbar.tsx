import React, { useEffect, useLayoutEffect, useState, useRef } from 'react';
import ReactDOM from 'react-dom';
import { Icon } from '../ui/Icon';
import type { ChartType, Timeframe } from '../TradingChart';
import {
    FileText, TrendingUp, BarChart2, CandlestickChart, LineChart, AreaChart,
    ZoomIn, ZoomOut, Camera,
    GitCommitHorizontal, RefreshCw,
    LayoutPanelTop, SlidersHorizontal,
    Minus, Square, Copy, X
} from 'lucide-react';
import { useToolbarState } from '../../hooks/useToolbarState';
import { useKeyboardShortcuts } from '../../hooks/useKeyboardShortcut';
import { SHORTCUT_CATEGORIES } from '../../services/keyboardShortcutManager';
import { useCommandBus } from '../../hooks/useCommandBus';
import type { Command } from '../../types/commands';
import { useAppStore } from '../../store/useAppStore';
import { useLastSymbolStore } from '../../store/useLastSymbolStore';
import {
    defaultChartProperties,
    useChartSettingsStore,
    type ChartProperties,
} from '../../store/useChartSettingsStore';
import type { NormalizedMarketStatus } from '../../utils/marketStatus';
import { RTX5_API_URL, normalizeBrokerServerUrl, normalizeServerUrl } from '../../config/api';

interface TopToolbarProps {
    chartType: ChartType;
    timeframe: Timeframe;
    onChartTypeChange: (type: ChartType) => void;
    onTimeframeChange: (tf: Timeframe) => void;
    onToggleDOM?: () => void;
    symbol?: string;
    marketStatus?: NormalizedMarketStatus & { loading?: boolean };
    onLoadTemplate?: (template: any) => void;
}

import { MenuBar } from './MenuBar';
import { TimeframePicker } from './TimeframePicker';
import { ChartTemplateManager } from '../ChartTemplateManager';
import { indicatorManager } from '../../services/indicatorManager';
import { drawingManager } from '../../services/drawingManager';
import { captureFullPage } from '../../services/screenshotService';
import {
    clearAdvancedViewRootClasses,
    RTX_ADVANCED_VIEW_CHANGE_EVENT,
    syncAdvancedViewRootClasses,
    type AdvancedViewAccent,
    type AdvancedViewChartSurface,
    type AdvancedViewDensity,
    type AdvancedViewFontSize,
    type AdvancedViewRootOptions,
} from '../../utils/advancedViewRootClasses';
import { suppressThemeTransitions } from '../../utils/themeTransitionSuppression';

const getLogoutBase = (): string => {
  const fallback = normalizeServerUrl(RTX5_API_URL || import.meta.env.VITE_API_URL || '');
  if (typeof window === 'undefined') return fallback;

  const serverUrl = normalizeBrokerServerUrl(localStorage.getItem('server_url') || localStorage.getItem('rtx_broker_server') || '');
  if (serverUrl) return serverUrl;
  if (fallback) return fallback;
  return '';
};

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


    useEffect(() => {
        const handleDrawingSaved = () => {
            dispatchToolbar({ type: 'SELECT_TOOL', tool: 'cursor' });
            dispatchCommand({ type: 'SELECT_TOOL', payload: { tool: 'cursor' } } as any);
        };
        window.addEventListener('drawing:saved', handleDrawingSaved);
        return () => window.removeEventListener('drawing:saved', handleDrawingSaved);
    }, [dispatchToolbar, dispatchCommand]);


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
        <div className="rtx-top-chrome flex flex-col z-50 relative border-b border-white/5 shadow-2xl">
            {/* Single chrome row: application menu, chart tools, and desktop window controls. */}
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

type ElectronWindowApi = NonNullable<Window['electron']>['window'];

const WindowControls = () => {
    const [electronWindow, setElectronWindow] = useState<ElectronWindowApi | null>(null);
    const [isMaximized, setIsMaximized] = useState(false);

    useEffect(() => {
        const windowApi = window.electron?.window;
        if (!windowApi) return;

        setElectronWindow(windowApi);

        let isActive = true;
        windowApi.isMaximized()
            .then((maximized) => {
                if (isActive) setIsMaximized(maximized);
            })
            .catch(() => {
                if (isActive) setIsMaximized(false);
            });

        const unsubscribe = windowApi.onMaximizeChange((maximized) => {
            setIsMaximized(maximized);
        });

        return () => {
            isActive = false;
            unsubscribe();
        };
    }, []);

    if (!electronWindow) return null;

    const buttonClassName = 'h-[40px] w-11 inline-flex items-center justify-center text-slate-300 transition-colors hover:bg-white/10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-sky-400';

    return (
        <div
            className="rtx-window-controls ml-auto flex h-[40px] shrink-0 items-center"
            style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
        >
            <button
                type="button"
                aria-label="Minimize window"
                title="Minimize"
                className={buttonClassName}
                onClick={() => electronWindow.minimize()}
            >
                <Minus size={14} strokeWidth={1.8} aria-hidden="true" />
            </button>
            <button
                type="button"
                aria-label={isMaximized ? 'Restore window' : 'Maximize window'}
                title={isMaximized ? 'Restore' : 'Maximize'}
                className={buttonClassName}
                onClick={() => electronWindow.maximize()}
            >
                {isMaximized ? (
                    <Copy size={13} strokeWidth={1.8} aria-hidden="true" />
                ) : (
                    <Square size={12} strokeWidth={1.8} aria-hidden="true" />
                )}
            </button>
            <button
                type="button"
                aria-label="Close window"
                title="Close"
                className={`${buttonClassName} hover:bg-red-600 hover:text-white`}
                onClick={() => electronWindow.close()}
            >
                <X size={15} strokeWidth={1.8} aria-hidden="true" />
            </button>
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

type AdvancedFontSize = AdvancedViewFontSize;
type AdvancedDensity = AdvancedViewDensity;
type AdvancedAccent = AdvancedViewAccent;
type AdvancedChartSurface = AdvancedViewChartSurface;
type AdvancedViewOptions = AdvancedViewRootOptions;

const ADVANCED_OPTIONS_STORAGE_KEY = 'rtx5-advanced-view-options';

const DEFAULT_ADVANCED_OPTIONS: AdvancedViewOptions = {
    fontSize: 'normal',
    density: 'comfortable',
    accent: 'purple',
    chartSurface: 'white',
    focusChart: false,
};

const ADVANCED_FONT_SIZES: readonly AdvancedFontSize[] = ['small', 'normal', 'large'];
const ADVANCED_DENSITIES: readonly AdvancedDensity[] = ['comfortable', 'compact'];
const ADVANCED_ACCENTS: readonly AdvancedAccent[] = ['purple', 'blue', 'green', 'amber'];
const ADVANCED_CHART_SURFACES: readonly AdvancedChartSurface[] = ['white', 'soft', 'paper'];

function isStoredOption<T extends string>(value: unknown, options: readonly T[]): value is T {
    return typeof value === 'string' && (options as readonly string[]).includes(value);
}

function loadAdvancedOptions(): AdvancedViewOptions {
    try {
        const raw = localStorage.getItem(ADVANCED_OPTIONS_STORAGE_KEY);
        if (!raw) return DEFAULT_ADVANCED_OPTIONS;
        const parsed = JSON.parse(raw) as Partial<AdvancedViewOptions> | null;
        return {
            fontSize: isStoredOption(parsed?.fontSize, ADVANCED_FONT_SIZES)
                ? parsed.fontSize
                : DEFAULT_ADVANCED_OPTIONS.fontSize,
            density: isStoredOption(parsed?.density, ADVANCED_DENSITIES)
                ? parsed.density
                : DEFAULT_ADVANCED_OPTIONS.density,
            accent: isStoredOption(parsed?.accent, ADVANCED_ACCENTS)
                ? parsed.accent
                : DEFAULT_ADVANCED_OPTIONS.accent,
            chartSurface: isStoredOption(parsed?.chartSurface, ADVANCED_CHART_SURFACES)
                ? parsed.chartSurface
                : DEFAULT_ADVANCED_OPTIONS.chartSurface,
            focusChart: typeof parsed?.focusChart === 'boolean'
                ? parsed.focusChart
                : DEFAULT_ADVANCED_OPTIONS.focusChart,
        };
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

    const [showHistoryOverlayMenu, setShowHistoryOverlayMenu] = useState(false);
    const [advancedViewEnabled, setAdvancedViewEnabled] = useState(() => {
        try {
            return localStorage.getItem('rtx5-advanced-view-enabled') === 'true';
        } catch {
            return false;
        }
    });
    const [advancedOptions, setAdvancedOptions] = useState<AdvancedViewOptions>(loadAdvancedOptions);
    const historyOverlayRef = useRef<HTMLDivElement>(null);
    const historyOverlayDropdownRef = useRef<HTMLDivElement>(null);
    const accountId = useAppStore((s) => s.accountId) || '---';
    const tradeHistorySettings = useChartSettingsStore((state) => state.symbolProperties[symbol] || state.globalProperties);

    const themeSuppressionCleanupRef = useRef<(() => void) | null>(null);
    const previousAdvancedViewEnabledRef = useRef(advancedViewEnabled);

    useLayoutEffect(() => () => {
        themeSuppressionCleanupRef.current?.();
        clearAdvancedViewRootClasses(document.documentElement);
    }, []);

    useLayoutEffect(() => {
        // Suppress CSS transitions before flipping the theme classes so every
        // color snaps in the same paint (see themeTransitionSuppression.ts).
        if (previousAdvancedViewEnabledRef.current !== advancedViewEnabled) {
            previousAdvancedViewEnabledRef.current = advancedViewEnabled;
            themeSuppressionCleanupRef.current?.();
            themeSuppressionCleanupRef.current = suppressThemeTransitions(document.documentElement);
        }
        syncAdvancedViewRootClasses(document.documentElement, advancedViewEnabled, advancedOptions);
        window.dispatchEvent(new CustomEvent(RTX_ADVANCED_VIEW_CHANGE_EVENT, {
            detail: { isAdvancedUntitledLight: advancedViewEnabled },
        }));
    }, [
        advancedViewEnabled,
        advancedOptions.fontSize,
        advancedOptions.density,
        advancedOptions.accent,
        advancedOptions.chartSurface,
        advancedOptions.focusChart,
    ]);

    useEffect(() => {
        const resizeFrame = window.requestAnimationFrame(() => {
            window.dispatchEvent(new Event('resize'));
        });

        try {
            localStorage.setItem('rtx5-advanced-view-enabled', String(advancedViewEnabled));
            localStorage.setItem(ADVANCED_OPTIONS_STORAGE_KEY, JSON.stringify(advancedOptions));
        } catch {
            // Ignore storage failures; the visual toggle should still work for this session.
        }

        return () => {
            window.cancelAnimationFrame(resizeFrame);
        };
    }, [advancedViewEnabled, advancedOptions]);

    // Close dropdown on outside click
    useEffect(() => {
        const handleClickOutside = (e: MouseEvent) => {
            const target = e.target as Node;
            const clickedHistoryOverlay = !!historyOverlayRef.current?.contains(target) || !!historyOverlayDropdownRef.current?.contains(target);

            if (!clickedHistoryOverlay) setShowHistoryOverlayMenu(false);
        };
        if (showHistoryOverlayMenu) {
            document.addEventListener('mousedown', handleClickOutside);
        }
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, [showHistoryOverlayMenu]);

    const updateAdvancedOptions = (patch: Partial<AdvancedViewOptions>) => {
        setAdvancedOptions((current) => ({ ...current, ...patch }));
    };

    const updateTradeHistorySetting = <K extends keyof ChartProperties>(key: K, value: ChartProperties[K]) => {
        const store = useChartSettingsStore.getState();
        store.updateGlobalProperty(key, value);
        store.updateSymbolProperty(symbol, key, value);
        window.dispatchEvent(new CustomEvent('rtx:flush-trade-overlay'));
    };

    const togglePeriodSeparators = () => {
        const nextValue = !(tradeHistorySettings.showPeriodSeparators !== false);
        const store = useChartSettingsStore.getState();
        store.updateGlobalProperty('showPeriodSeparators', nextValue);
        store.updateSymbolProperty(symbol, 'showPeriodSeparators', nextValue);
        setShowHistoryOverlayMenu(false);
    };

    const resetTradeHistorySettings = () => {
        updateTradeHistorySetting('showTradeHistory', defaultChartProperties.showTradeHistory);
        updateTradeHistorySetting('showTradeHistoryBoxes', defaultChartProperties.showTradeHistoryBoxes);
        updateTradeHistorySetting('showTradeHistoryArrows', defaultChartProperties.showTradeHistoryArrows);
        updateTradeHistorySetting('tradeHistoryLineOpacity', defaultChartProperties.tradeHistoryLineOpacity);
        updateTradeHistorySetting('tradeHistoryBoxOpacity', defaultChartProperties.tradeHistoryBoxOpacity);
    };

    const handleLogout = () => {
        // Fire-and-forget the backend logout API (don't wait)
        const logoutBase = getLogoutBase().replace(/\/$/, '');
        fetch(`${logoutBase}/api/logout`, {
            method: 'POST',
            headers: {
                'accept': '*/*',
                'Authorization': `Bearer ${localStorage.getItem('auth_token') || ''}`,
            },
        }).catch(() => { /* ignore */ });

        // Keep the current document alive. App owns the central cleanup and
        // AppShell swaps the authenticated graph for the already-warm login UI.
        window.dispatchEvent(new CustomEvent('rtx:logout'));
    };

    return (
        <div
            className="rtx-main-toolbar flex h-[40px] items-center bg-[#131316] border-b border-white/10 shadow-sm select-none"
            style={window.electron?.window ? ({ WebkitAppRegion: 'drag' } as React.CSSProperties) : undefined}
        >
            <MenuBar
                advancedViewEnabled={advancedViewEnabled}
                advancedFontSize={advancedOptions.fontSize}
                focusChart={advancedOptions.focusChart}
                activeDrawingTool={toolbarState.activeTool}
                crosshairEnabled={toolbarState.crosshairEnabled}
                accountId={accountId}
                onSetAdvancedViewEnabled={setAdvancedViewEnabled}
                onSetAdvancedFontSize={(fontSize) => updateAdvancedOptions({ fontSize })}
                onSetFocusChart={(focusChart) => updateAdvancedOptions({ focusChart })}
                onLogout={handleLogout}
            />
            <MT5Divider />
            <div
                className="flex min-w-0 flex-1 self-stretch items-center overflow-x-auto px-1.5 no-scrollbar"
            >
            <div
                className="flex shrink-0 items-center gap-[2px]"
                style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
            >
            {/* New Order & Last Symbol */}
            <MT5Group>

                <button
                    className="flex items-center gap-1.5 px-2.5 h-[32px] rounded-[3px] bg-transparent border border-transparent hover:border-blue-500/20 hover:bg-blue-500/10 text-[14px] font-normal text-zinc-300 hover:text-blue-300 transition-all font-segoe"
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
                    className={`flex items-center gap-1.5 px-2.5 h-[32px] rounded-[3px] border text-[14px] font-normal transition-all font-segoe ${useLastSymbolStore.getState().panelVisible
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
                <MT5Btn icon={<LineChart size={16} strokeWidth={1.5} />} title="Line Chart" active={toolbarState.chartType === 'line'} onClick={() => { onChartTypeChange('line'); dispatchToolbar({ type: 'SET_CHART_TYPE', chartType: 'line' }); dispatchCommand({ type: 'SET_CHART_TYPE', payload: { chartType: 'line' } }); }} />
                <MT5Btn icon={<AreaChart size={16} strokeWidth={1.5} />} title="Area Chart" active={toolbarState.chartType === 'area'} onClick={() => { onChartTypeChange('area'); dispatchToolbar({ type: 'SET_CHART_TYPE', chartType: 'area' }); dispatchCommand({ type: 'SET_CHART_TYPE', payload: { chartType: 'area' } }); }} />
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

            {/* Group 6: Latest candle */}
            <MT5Group>
                <MT5Btn
                    icon={<Icon name="chart-shift" state="default" />}
                    title="Jump to Latest Candle"
                    onClick={() => dispatchCommand({ type: 'JUMP_TO_LATEST_CANDLE', payload: {} })}
                />
            </MT5Group>

            <MT5Divider />

            {/* Group 7: Indicators */}
            <MT5Group>
                <MT5Btn icon={<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><rect x="1.5" y="2" width="13" height="12" rx="1" /><polyline points="3 11 5 7.5 7.5 9.5 10 5.5 13 7" strokeWidth="1.3" /><circle cx="12.5" cy="3.5" r="1" fill="#fbbf24" stroke="none" /></svg>} title="Indicators List" onClick={() => dispatchCommand({ type: 'OPEN_INDICATOR_LIST', payload: {} })} />
            </MT5Group>

            <MT5Divider />

            {/* Group 8: Horizontal MT-style timeframe strip */}
            <TimeframePicker
                timeframe={timeframe}
                advancedViewEnabled={advancedViewEnabled}
                onSelect={(nextTimeframe) => {
                    onTimeframeChange(nextTimeframe);
                    dispatchCommand({ type: 'SET_TIMEFRAME', payload: { timeframe: nextTimeframe } });
                    window.dispatchEvent(new CustomEvent('change-timeframe', { detail: { timeframe: nextTimeframe } }));
                }}
            />

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

            <MT5Divider />

            {/* Group 11: Trade history overlay controls */}
            <div ref={historyOverlayRef} className="relative flex items-center">
                <button
                    type="button"
                    title={tradeHistorySettings.showPeriodSeparators !== false ? 'Hide Period Separators' : 'Show Period Separators'}
                    aria-label={tradeHistorySettings.showPeriodSeparators !== false ? 'Hide Period Separators' : 'Show Period Separators'}
                    aria-pressed={tradeHistorySettings.showPeriodSeparators !== false}
                    onClick={togglePeriodSeparators}
                    className={`rtx-period-separator-toggle flex h-[32px] w-[32px] items-center justify-center rounded-[3px] border transition-all ${tradeHistorySettings.showPeriodSeparators !== false
                        ? advancedViewEnabled
                            ? 'border-[#7E57C2] bg-[#F3E5F5] text-[#7E57C2]'
                            : 'border-blue-500/30 bg-blue-500/15 text-blue-400 shadow-[0_0_8px_rgba(59,130,246,0.15)]'
                        : advancedViewEnabled
                            ? 'border-transparent bg-transparent text-[#475467] shadow-none hover:border-transparent hover:bg-[#F3E5F5] hover:text-[#7E57C2]'
                            : 'border-transparent bg-transparent text-zinc-400 hover:border-blue-500/20 hover:bg-blue-500/10 hover:text-blue-300'
                        }`}
                >
                    <GitCommitHorizontal size={15} strokeWidth={1.6} />
                </button>

                <button
                    type="button"
                    title="Trade History Overlays"
                    aria-label="Trade History Overlays"
                    aria-haspopup="menu"
                    aria-expanded={showHistoryOverlayMenu}
                    onClick={() => {
                        setShowHistoryOverlayMenu((open) => !open);
                    }}
                    className={`rtx-trade-history-overlay-button flex h-[32px] w-[32px] items-center justify-center rounded-[3px] border transition-all ${showHistoryOverlayMenu
                        ? advancedViewEnabled
                            ? 'border-[#7E57C2] bg-[#7E57C2] text-white'
                            : 'border-blue-500/30 bg-blue-500/15 text-blue-400 shadow-[0_0_8px_rgba(59,130,246,0.15)]'
                        : advancedViewEnabled
                            ? 'border-transparent bg-transparent text-[#475467] shadow-none hover:border-transparent hover:bg-[#F3E5F5] hover:text-[#7E57C2]'
                            : 'border-transparent bg-transparent text-zinc-400 hover:border-blue-500/20 hover:bg-blue-500/10 hover:text-blue-300'
                        }`}
                >
                    <SlidersHorizontal size={15} strokeWidth={1.6} />
                </button>

                {showHistoryOverlayMenu && ReactDOM.createPortal(
                    <div
                        ref={historyOverlayDropdownRef}
                        className="fixed z-[9999] w-[236px] rounded-[5px] border border-zinc-700/80 bg-[#151820] p-3 text-[14px] font-normal text-zinc-200 shadow-2xl shadow-black/50 [.rtx-advanced-view_&]:border-gray-200 [.rtx-advanced-view_&]:bg-white [.rtx-advanced-view_&]:text-gray-800 [.rtx-advanced-view_&]:shadow-xl"
                        style={{
                            top: (historyOverlayRef.current?.getBoundingClientRect().bottom ?? 0) + 5,
                            left: Math.min(
                                historyOverlayRef.current?.getBoundingClientRect().left ?? 0,
                                Math.max(8, window.innerWidth - 244),
                            ),
                        }}
                        role="menu"
                        aria-label="Trade history overlay controls"
                    >
                        <div className="mb-2 flex items-center justify-between border-b border-zinc-700/70 pb-2 [.rtx-advanced-view_&]:border-gray-100">
                            <span className="text-[12px] font-medium uppercase tracking-wide text-zinc-400 [.rtx-advanced-view_&]:text-gray-500">Trade History</span>
                            <button
                                type="button"
                                className="rounded-[3px] border border-zinc-700 px-1.5 py-0.5 text-[12px] font-normal text-zinc-300 hover:border-zinc-500 hover:bg-zinc-800 [.rtx-advanced-view_&]:border-gray-200 [.rtx-advanced-view_&]:text-gray-600 [.rtx-advanced-view_&]:hover:bg-gray-50"
                                onClick={resetTradeHistorySettings}
                            >
                                Reset
                            </button>
                        </div>

                        <label className="mb-2 flex cursor-pointer items-center justify-between gap-3 rounded-[4px] px-1 py-1 hover:bg-white/5 [.rtx-advanced-view_&]:hover:bg-gray-50">
                            <span className="font-normal text-zinc-200 [.rtx-advanced-view_&]:text-gray-800">Lines</span>
                            <input
                                type="checkbox"
                                checked={tradeHistorySettings.showTradeHistory !== false}
                                onChange={(event) => updateTradeHistorySetting('showTradeHistory', event.target.checked)}
                                className="h-3.5 w-3.5 accent-blue-500"
                            />
                        </label>

                        <label className="mb-2 flex cursor-pointer items-center justify-between gap-3 rounded-[4px] px-1 py-1 hover:bg-white/5 [.rtx-advanced-view_&]:hover:bg-gray-50">
                            <span className="font-normal text-zinc-200 [.rtx-advanced-view_&]:text-gray-800">Text boxes</span>
                            <input
                                type="checkbox"
                                checked={tradeHistorySettings.showTradeHistoryBoxes !== false}
                                onChange={(event) => updateTradeHistorySetting('showTradeHistoryBoxes', event.target.checked)}
                                className="h-3.5 w-3.5 accent-blue-500"
                            />
                        </label>

                        <label className="mb-3 flex cursor-pointer items-center justify-between gap-3 rounded-[4px] px-1 py-1 hover:bg-white/5 [.rtx-advanced-view_&]:hover:bg-gray-50">
                            <span className="font-normal text-zinc-200 [.rtx-advanced-view_&]:text-gray-800">Arrows</span>
                            <input
                                type="checkbox"
                                checked={tradeHistorySettings.showTradeHistoryArrows !== false}
                                onChange={(event) => updateTradeHistorySetting('showTradeHistoryArrows', event.target.checked)}
                                className="h-3.5 w-3.5 accent-blue-500"
                            />
                        </label>

                        <div className="space-y-2 rounded-[4px] border border-zinc-800/80 bg-zinc-950/35 p-2 [.rtx-advanced-view_&]:border-gray-100 [.rtx-advanced-view_&]:bg-gray-50">
                            <label className="block">
                                <div className="mb-1 flex items-center justify-between">
                                    <span className="text-[12px] font-normal text-zinc-400 [.rtx-advanced-view_&]:text-gray-600">Lines</span>
                                    <span className="font-mono text-[12px] font-normal text-zinc-300 [.rtx-advanced-view_&]:text-gray-700">{tradeHistorySettings.tradeHistoryLineOpacity}%</span>
                                </div>
                                <input
                                    type="range"
                                    min={0}
                                    max={100}
                                    step={5}
                                    disabled={tradeHistorySettings.showTradeHistory === false}
                                    value={tradeHistorySettings.tradeHistoryLineOpacity}
                                    onChange={(event) => updateTradeHistorySetting('tradeHistoryLineOpacity', Number(event.target.value))}
                                    className="w-full accent-blue-500"
                                />
                            </label>

                            <label className="block">
                                <div className="mb-1 flex items-center justify-between">
                                    <span className="text-[12px] font-normal text-zinc-400 [.rtx-advanced-view_&]:text-gray-600">Boxes</span>
                                    <span className="font-mono text-[12px] font-normal text-zinc-300 [.rtx-advanced-view_&]:text-gray-700">{tradeHistorySettings.tradeHistoryBoxOpacity}%</span>
                                </div>
                                <input
                                    type="range"
                                    min={0}
                                    max={100}
                                    step={5}
                                    disabled={tradeHistorySettings.showTradeHistoryBoxes === false}
                                    value={tradeHistorySettings.tradeHistoryBoxOpacity}
                                    onChange={(event) => updateTradeHistorySetting('tradeHistoryBoxOpacity', Number(event.target.value))}
                                    className="w-full accent-blue-500"
                                />
                            </label>
                        </div>
                    </div>,
                    document.body,
                )}
            </div>
            </div>

            {/* Keep a usable Electron drag surface without moving the fixed hamburger. */}
            <div className="min-w-[24px] flex-1 self-stretch" aria-hidden="true" />

            {/* Search, appearance, drawing, stamps, and account controls now live in the application menu. */}
            </div>
            <WindowControls />
        </div>
    );
};





const MT5Group = ({ children }: { children: React.ReactNode }) => (
    <div className="flex items-center gap-[2px]">
        {children}
    </div>
);


const MT5Divider = () => (
    <div aria-hidden="true" className="rtx-mt5-divider invisible mx-[4px] h-6 w-[2px] shrink-0" />
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
                            className={`w-full flex min-h-[30px] items-center gap-3 px-3 py-1.5 text-[14px] font-normal transition-colors cursor-pointer
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
