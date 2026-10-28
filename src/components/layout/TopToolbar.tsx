import React, { useEffect, useLayoutEffect, useState, useRef, useSyncExternalStore } from 'react';
import ReactDOM from 'react-dom';
import { Icon } from '../ui/Icon';
import { ChartCommandIcon, type ChartCommandIconName } from './ChartCommandIcon';
import type { ChartType, Timeframe } from '../../types/chart';
import {
    Minus, Square, Copy, RotateCcw, X, History, GitCommitHorizontal, ArrowUpDown, Bug
} from 'lucide-react';
import { useToolbarState } from '../../hooks/useToolbarState';
import { useKeyboardShortcuts } from '../../hooks/useKeyboardShortcut';
import { SHORTCUT_CATEGORIES } from '../../services/keyboardShortcutManager';
import { useCommandBus } from '../../hooks/useCommandBus';
import type { Command } from '../../types/commands';
import { useAppStore } from '../../store/useAppStore';
import { useLastSymbolStore } from '../../store/useLastSymbolStore';
import { lastSymbolFeature } from '../../startup/terminalFeatures';
import { useTerminalBarsStore } from '../../store/useTerminalBarsStore';
import {
    defaultChartProperties,
    useChartSettingsStore,
    type ChartProperties,
} from '../../store/useChartSettingsStore';
import { useDrawingToolPreferencesStore } from '../../store/useDrawingToolPreferencesStore';
import type { NormalizedMarketStatus } from '../../utils/marketStatus';
import { RTX5_API_URL, normalizeBrokerServerUrl, normalizeServerUrl } from '../../config/api';
import { getAccessToken } from '../../services/brokerSession';
import { isConfiguredBrokerEndpoint } from '../../config/backendTarget.js';
import { getActiveChartCommandTarget, getPanelIdFromChartContextId } from '../../services/chartCommandTarget';
import { getActiveChartSourceId, subscribeActiveChartSource } from '../../services/activeChartSource';
import { getDockPanelChartType, findChartPanel } from '../../services/chartTypeCommand';
import { useDockLayoutStore } from '../../store/useDockLayoutStore';
import type { DesktopFeedSnapshot } from './desktopToolbarStatus';

interface TopToolbarProps {
    chartType: ChartType;
    timeframe: Timeframe;
    onChartTypeChange: (type: ChartType) => void;
    onTimeframeChange: (tf: Timeframe) => void;
    onToggleDOM?: () => void;
    symbol: string;
    marketStatus?: NormalizedMarketStatus & { loading?: boolean };
    feedStatus: DesktopFeedSnapshot;
    onRefreshConnection?: () => void;
    onLoadTemplate?: (template: any) => void;
    desktopDrawingTools?: React.ReactNode;
    accountBrokerName?: string;
    profileSymbols?: readonly string[];
}

import { MenuBar } from './MenuBar';
import { useUiTranslation } from '../../hooks/useUiTranslation';
import { TimeframePicker } from './TimeframePicker';
import { DesktopQuickActions, DesktopSymbolSearchButton } from './DesktopQuickActions';
import { drawingManager } from '../../services/drawingManager';
import { captureFullPage } from '../../services/screenshotService';
import {
    clearAdvancedViewRootClasses,
    RTX_ADVANCED_VIEW_CHANGE_EVENT,
    RTX_EXIT_CHART_FOCUS_EVENT,
    readChartFocusPreference,
    persistChartFocusPreference,
    syncAdvancedViewRootClasses,
    type AdvancedViewAccent,
    type AdvancedViewChartSurface,
    type AdvancedViewDensity,
    type AdvancedViewFontSize,
    type AdvancedViewRootOptions,
} from '../../utils/advancedViewRootClasses';
import {
    applyThemeAppearanceToRoot,
    resolveEffectiveThemeMode,
    RTX_THEME_APPEARANCE_CHANGE_EVENT,
    RTX_THEME_APPEARANCE_STORAGE_KEY,
} from '../../utils/themePresets';
import { useThemeAppearanceStore } from '../../store/useThemeAppearanceStore';
import { suppressThemeTransitions } from '../../utils/themeTransitionSuppression';

const subscribeToolbarActiveChartSource = (listener: () => void): (() => void) => {
    return subscribeActiveChartSource(listener);
};

const getLogoutBase = (): string => {
    const fallback = normalizeServerUrl(RTX5_API_URL || '');
    if (typeof window === 'undefined') return fallback;

    const serverUrl = normalizeBrokerServerUrl(localStorage.getItem('server_url') || localStorage.getItem('rtx_broker_server') || '');
    if (serverUrl) return serverUrl;
    if (fallback) return fallback;
    return '';
};

const TRADE_HISTORY_OVERLAY_DIALOG_ID = 'rtx-trade-history-overlay-dialog';
const TRADE_HISTORY_OVERLAY_TITLE_ID = 'rtx-trade-history-overlay-title';
const TRADE_HISTORY_OVERLAY_WIDTH = 288;

const getTradeHistoryOverlayPosition = (anchor: HTMLElement | null): React.CSSProperties => {
    if (typeof window === 'undefined') return {};

    const viewportPadding = 8;
    const anchorRect = anchor?.getBoundingClientRect();
    const availableWidth = Math.max(0, window.innerWidth - viewportPadding * 2);
    const panelWidth = Math.min(TRADE_HISTORY_OVERLAY_WIDTH, availableWidth);
    const maximumLeft = Math.max(viewportPadding, window.innerWidth - panelWidth - viewportPadding);
    const top = (anchorRect?.bottom ?? 0) + 6;

    return {
        top,
        left: Math.max(viewportPadding, Math.min(anchorRect?.left ?? viewportPadding, maximumLeft)),
        maxHeight: Math.max(0, window.innerHeight - top - viewportPadding),
    };
};

export const TopToolbar: React.FC<TopToolbarProps> = ({
    chartType,
    timeframe,
    onChartTypeChange,
    onTimeframeChange,
    onToggleDOM,
    symbol,
    feedStatus,
    onRefreshConnection,
    onLoadTemplate,
    desktopDrawingTools,
    accountBrokerName,
    profileSymbols,
}) => {
    const { state: toolbarState, dispatch: dispatchToolbar, syncState: syncToolbarState } = useToolbarState();
    const { dispatch: dispatchCommand } = useCommandBus();
    const isDesktopShell = typeof window !== 'undefined' && Boolean(window.electron?.window);
    const dockLayout = useDockLayoutStore(state => state.layout);
    const activeChartSourceId = useSyncExternalStore(
        subscribeToolbarActiveChartSource,
        getActiveChartSourceId,
        () => null,
    );

    const magnetMode = useDrawingToolPreferencesStore((state) => state.magnetMode);
    const snapToIndicators = useDrawingToolPreferencesStore((state) => state.snapToIndicators);

    // Sync magnet state to drawingManager
    useEffect(() => {
        drawingManager.setMagnetMode(magnetMode);
    }, [magnetMode]);

    useEffect(() => {
        drawingManager.setSnapToIndicators(snapToIndicators);
    }, [snapToIndicators]);


    useKeyboardShortcuts([
        {
            id: 'drawing.select-all',
            key: 'a',
            ctrl: true,
            description: 'Select all drawings',
            category: SHORTCUT_CATEGORIES.CHARTS,
            handler: () => {
                const target = getActiveChartCommandTarget(symbol, timeframe);
                if (target.targetContextId) {
                    drawingManager.selectAll(target.targetContextId);
                } else {
                    drawingManager.selectAll();
                }
                dispatchCommand({ type: 'SELECT_ALL_DRAWINGS', payload: { ...(target.targetContextId ? { targetContextId: target.targetContextId } : {}) } });
            }
        },
        {
            id: 'drawing.trendline',
            key: 't',
            description: 'Select Trendline Tool',
            category: SHORTCUT_CATEGORIES.CHARTS,
            handler: () => {
                const target = getActiveChartCommandTarget(symbol, timeframe);
                dispatchCommand({ type: 'SELECT_TOOL', payload: { tool: 'trendline', ...(target.targetContextId ? { targetContextId: target.targetContextId } : {}) } });
            }
        },
        {
            id: 'drawing.hline',
            key: 'h',
            description: 'Select Horizontal Line Tool',
            category: SHORTCUT_CATEGORIES.CHARTS,
            handler: () => {
                const target = getActiveChartCommandTarget(symbol, timeframe);
                dispatchCommand({ type: 'SELECT_TOOL', payload: { tool: 'hline', ...(target.targetContextId ? { targetContextId: target.targetContextId } : {}) } });
            }
        },
        {
            id: 'drawing.vline',
            key: 'v',
            description: 'Select Vertical Line Tool',
            category: SHORTCUT_CATEGORIES.CHARTS,
            handler: () => {
                const target = getActiveChartCommandTarget(symbol, timeframe);
                dispatchCommand({ type: 'SELECT_TOOL', payload: { tool: 'vline', ...(target.targetContextId ? { targetContextId: target.targetContextId } : {}) } });
            }
        },
        {
            id: 'drawing.text',
            key: 'x',
            description: 'Select Text Tool',
            category: SHORTCUT_CATEGORIES.CHARTS,
            handler: () => {
                const target = getActiveChartCommandTarget(symbol, timeframe);
                dispatchCommand({ type: 'SELECT_TOOL', payload: { tool: 'text', ...(target.targetContextId ? { targetContextId: target.targetContextId } : {}) } });
            }
        }
    ]);

    useEffect(() => {
        const activeTarget = getActiveChartCommandTarget(symbol, timeframe);
        const panelId = getPanelIdFromChartContextId(activeTarget.targetContextId);
        const activePanel = (dockLayout && panelId) ? findChartPanel(dockLayout, panelId) : undefined;
        const activePanelSymbol = activePanel?.props?.symbol;
        const activeTargetSymbol = activeTarget.symbol;

        const isDifferentWebSymbol = !isDesktopShell
            && Boolean(symbol)
            && symbol !== 'STALE'
            && (
                (activePanelSymbol && activePanelSymbol !== symbol)
                || (activeTargetSymbol && activeTargetSymbol !== symbol)
            );

        if (!isDifferentWebSymbol) {
            const displayedChartType = activePanel?.props?.chartType
                ? (['bar', 'candlestick', 'line', 'area'] as const).includes(activePanel.props.chartType)
                    ? activePanel.props.chartType
                    : chartType
                : (dockLayout ? getDockPanelChartType(dockLayout, activeTarget.targetContextId, chartType) : chartType);
            syncToolbarState({ type: 'SET_CHART_TYPE', chartType: displayedChartType });

            const displayedTimeframe = (activePanel?.props?.timeframe as string) || activeTarget.timeframe || timeframe;
            if (displayedTimeframe) {
                syncToolbarState({ type: 'SET_TIMEFRAME', timeframe: displayedTimeframe });
            }
        } else {
            syncToolbarState({ type: 'SET_CHART_TYPE', chartType });
            if (timeframe) {
                syncToolbarState({ type: 'SET_TIMEFRAME', timeframe });
            }
        }
    }, [chartType, timeframe, symbol, dockLayout, activeChartSourceId, isDesktopShell, syncToolbarState]);

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
                feedStatus={feedStatus}
                onRefreshConnection={onRefreshConnection}
                onLoadTemplate={onLoadTemplate}
                desktopDrawingTools={desktopDrawingTools}
                accountBrokerName={accountBrokerName}
                profileSymbols={profileSymbols}
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
    const focusChart = readChartFocusPreference();
    try {
        const raw = localStorage.getItem(ADVANCED_OPTIONS_STORAGE_KEY);
        if (!raw) return { ...DEFAULT_ADVANCED_OPTIONS, focusChart };
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
            focusChart,
        };
    } catch {
        return { ...DEFAULT_ADVANCED_OPTIONS, focusChart };
    }
}

const MainToolbar = ({
    timeframe,
    onTimeframeChange,
    toolbarState,
    dispatchCommand,
    symbol,
    desktopDrawingTools,
    accountBrokerName,
    profileSymbols,
}: MainToolbarProps) => {

    const isDesktopShell = typeof window !== 'undefined' && Boolean(window.electron?.window);
    const tr = useUiTranslation();

    const [showHistoryOverlayMenu, setShowHistoryOverlayMenu] = useState(false);
    const [, setHistoryOverlayLayoutVersion] = useState(0);
    const [advancedViewEnabled, setAdvancedViewEnabled] = useState(() => {
        try {
            return localStorage.getItem('rtx5-advanced-view-enabled') === 'true';
        } catch {
            return false;
        }
    });
    const [advancedOptions, setAdvancedOptions] = useState<AdvancedViewOptions>(loadAdvancedOptions);
    useEffect(() => {
        const exitFocus = () => setAdvancedOptions(current => current.focusChart
            ? { ...current, focusChart: false }
            : current);
        window.addEventListener(RTX_EXIT_CHART_FOCUS_EVENT, exitFocus);
        return () => window.removeEventListener(RTX_EXIT_CHART_FOCUS_EVENT, exitFocus);
    }, []);
    const historyOverlayRef = useRef<HTMLDivElement>(null);
    const historyOverlayDropdownRef = useRef<HTMLDivElement>(null);
    const accountId = useAppStore((s) => s.accountId) || '';
    const isAuthenticated = useAppStore((s) => s.isAuthenticated);
    const savedAccounts = useAppStore((s) => s.savedAccounts);
    const lastTradedSymbol = useLastSymbolStore((state) => state.lastSymbol);
    const lastSymbol = symbol.trim() || lastTradedSymbol;
    const lastSymbolPanelVisible = useLastSymbolStore((state) => state.panelVisible);
    const timeframesVisible = useTerminalBarsStore(state => state.timeframesVisible);
    const toggleLastSymbolPanel = useLastSymbolStore((state) => state.togglePanel);
    const activeSavedAccount = savedAccounts.find((account) => String(account.login) === accountId);
    const savedAccountCount = new Set(savedAccounts.map((account) => account.login)).size;
    const tradeHistorySettings = useChartSettingsStore((state) => state.symbolProperties[symbol] || state.globalProperties);
    const tradeHistoryLineEnabled = tradeHistorySettings.showTradeHistory !== false;
    const tradeHistoryArrowsEnabled = tradeHistorySettings.showTradeHistoryArrows !== false;
    const tradeHistorySettingsAreDefault = (
        tradeHistoryLineEnabled === defaultChartProperties.showTradeHistory
        && tradeHistoryArrowsEnabled === defaultChartProperties.showTradeHistoryArrows
    );

    const dispatchTargetedChartType = (nextChartType: ChartType) => {
        const { targetContextId } = getActiveChartCommandTarget(symbol, timeframe);
        dispatchCommand({
            type: 'SET_CHART_TYPE',
            payload: { chartType: nextChartType, targetContextId },
        });
    };

    const dispatchTargetedZoom = (type: 'ZOOM_IN' | 'ZOOM_OUT') => {
        const { targetContextId } = getActiveChartCommandTarget(symbol, timeframe);
        dispatchCommand({ type, payload: { targetContextId } });
    };

    const themeSuppressionCleanupRef = useRef<(() => void) | null>(null);
    const previousAdvancedViewEnabledRef = useRef(advancedViewEnabled);

    useLayoutEffect(() => () => {
        themeSuppressionCleanupRef.current?.();
        clearAdvancedViewRootClasses(document.documentElement);
    }, []);

    useEffect(() => {
        const handleThemeAppearanceChange = (event: Event) => {
            const detail = (event as CustomEvent<{ effectiveMode?: 'light' | 'dark' }>).detail;
            if (detail?.effectiveMode) {
                const nextEnabled = detail.effectiveMode === 'light';
                setAdvancedViewEnabled((prev) => (prev === nextEnabled ? prev : nextEnabled));
            }
        };
        window.addEventListener(RTX_THEME_APPEARANCE_CHANGE_EVENT, handleThemeAppearanceChange);

        const mediaQuery = typeof window.matchMedia === 'function'
            ? window.matchMedia('(prefers-color-scheme: light)')
            : null;
        const handleMediaChange = () => {
            const store = useThemeAppearanceStore.getState();
            if (store.themeMode === 'system') {
                store.setThemeMode('system');
            }
        };
        mediaQuery?.addEventListener?.('change', handleMediaChange);

        return () => {
            window.removeEventListener(RTX_THEME_APPEARANCE_CHANGE_EVENT, handleThemeAppearanceChange);
            mediaQuery?.removeEventListener?.('change', handleMediaChange);
        };
    }, []);

    useLayoutEffect(() => () => {
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
        document.documentElement.classList.toggle('theme-light', advancedViewEnabled);
        document.documentElement.classList.toggle('theme-dark', !advancedViewEnabled);
        document.documentElement.setAttribute('data-theme', advancedViewEnabled ? 'light' : 'dark');
        try {
            const store = useThemeAppearanceStore.getState();
            const hasStoredAppearance = Boolean(localStorage.getItem(RTX_THEME_APPEARANCE_STORAGE_KEY));
            const needsLightMigration = hasStoredAppearance && localStorage.getItem('rtx5-main-light-restored-v3') !== '1';
            const hasNonDefaultWebLight = !isDesktopShell && advancedViewEnabled && (
                store.light.preset !== 'default-light'
                || Object.keys(store.light.customOverrides).length > 0
                || store.contrastLevel !== 'default'
            );
            if (needsLightMigration || hasNonDefaultWebLight) {
                localStorage.setItem('rtx5-main-light-restored-v3', '1');
                store.setContrastLevel('default', true);
                store.setLightPreset('default-light', true);
            }
            if (hasStoredAppearance || needsLightMigration || hasNonDefaultWebLight || document.documentElement.hasAttribute('data-theme-preset')) {
                const snapshot = useThemeAppearanceStore.getState().getSnapshot();
                const effectiveMode = resolveEffectiveThemeMode(snapshot.themeMode);
                applyThemeAppearanceToRoot(document.documentElement, {
                    ...snapshot,
                    themeMode: effectiveMode === (advancedViewEnabled ? 'light' : 'dark')
                        ? snapshot.themeMode
                        : (advancedViewEnabled ? 'light' : 'dark'),
                });
            }
        } catch {
            // Storage access is optional
        }
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
            localStorage.setItem('rtx5-theme', advancedViewEnabled ? 'light' : 'dark');
            const { focusChart: _focusChart, ...appearanceOptions } = advancedOptions;
            localStorage.setItem(ADVANCED_OPTIONS_STORAGE_KEY, JSON.stringify(appearanceOptions));
        } catch {
            // Ignore storage failures; the visual toggle should still work for this session.
        }
        persistChartFocusPreference(advancedOptions.focusChart);

        return () => {
            window.cancelAnimationFrame(resizeFrame);
        };
    }, [advancedViewEnabled, advancedOptions]);

    // Close the portalled settings surface on outside interaction or Escape.
    useEffect(() => {
        let viewportFrame = 0;
        const handleClickOutside = (e: MouseEvent) => {
            const target = e.target as Node;
            const clickedHistoryOverlay = !!historyOverlayRef.current?.contains(target) || !!historyOverlayDropdownRef.current?.contains(target);

            if (!clickedHistoryOverlay) setShowHistoryOverlayMenu(false);
        };
        const handleKeyDown = (event: KeyboardEvent) => {
            if (event.key !== 'Escape') return;

            event.preventDefault();
            setShowHistoryOverlayMenu(false);
            historyOverlayRef.current?.querySelector<HTMLButtonElement>('button')?.focus();
        };
        const refreshOverlayPosition = () => {
            window.cancelAnimationFrame(viewportFrame);
            viewportFrame = window.requestAnimationFrame(() => {
                setHistoryOverlayLayoutVersion((version) => version + 1);
            });
        };

        if (showHistoryOverlayMenu) {
            document.addEventListener('mousedown', handleClickOutside);
            document.addEventListener('keydown', handleKeyDown);
            window.addEventListener('resize', refreshOverlayPosition);
            window.addEventListener('scroll', refreshOverlayPosition, true);
        }
        return () => {
            document.removeEventListener('mousedown', handleClickOutside);
            document.removeEventListener('keydown', handleKeyDown);
            window.removeEventListener('resize', refreshOverlayPosition);
            window.removeEventListener('scroll', refreshOverlayPosition, true);
            window.cancelAnimationFrame(viewportFrame);
        };
    }, [showHistoryOverlayMenu]);

    useEffect(() => {
        if (!showHistoryOverlayMenu) return;

        const focusFrame = window.requestAnimationFrame(() => {
            historyOverlayDropdownRef.current
                ?.querySelector<HTMLElement>('input:not(:disabled)')
                ?.focus();
        });

        return () => window.cancelAnimationFrame(focusFrame);
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
        updateTradeHistorySetting('showTradeHistoryArrows', defaultChartProperties.showTradeHistoryArrows);
    };

    const handleLogout = () => {
        // Fire-and-forget the backend logout API (don't wait)
        const logoutBase = getLogoutBase().replace(/\/$/, '');
        const token = getAccessToken();
        if (token && isConfiguredBrokerEndpoint(`${logoutBase}/api/logout`)) fetch(`${logoutBase}/api/logout`, {
            method: 'POST',
            redirect: 'error',
            headers: {
                'accept': '*/*',
                'Authorization': `Bearer ${token}`,
            },
        }).catch(() => { /* ignore */ });

        // Keep the current document alive. App owns the central cleanup and
        // AppShell swaps the authenticated graph for the already-warm login UI.
        window.dispatchEvent(new CustomEvent('rtx:logout'));
    };

    const menuBar = (
        <MenuBar
            advancedViewEnabled={advancedViewEnabled}
            advancedFontSize={advancedOptions.fontSize}
            focusChart={advancedOptions.focusChart}
            activeDrawingTool={toolbarState.activeTool}
            crosshairEnabled={toolbarState.crosshairEnabled}
            chartSymbol={symbol}
            accountId={accountId}
            profileSymbols={profileSymbols}
            onSetAdvancedViewEnabled={setAdvancedViewEnabled}
            onSetAdvancedFontSize={(fontSize) => updateAdvancedOptions({ fontSize })}
            onSetFocusChart={(focusChart) => updateAdvancedOptions({ focusChart })}
            onLogout={isAuthenticated ? handleLogout : undefined}
        />
    );

    const reportBugButton = (
        <button
            type="button"
            className="rtx-toolbar-action rtx-report-bug-button mx-2 shrink-0 gap-1.5 px-2 whitespace-nowrap"
            style={{ height: isDesktopShell ? 19 : 32, WebkitAppRegion: 'no-drag' } as React.CSSProperties}
            title={tr('Report a Bug')}
            aria-label={tr('Report a Bug')}
            aria-haspopup="dialog"
            onClick={() => {
                const target = getActiveChartCommandTarget(symbol, toolbarState.timeframe || timeframe);
                window.dispatchEvent(new CustomEvent('rtx5:open-bug-report', {
                    detail: { symbol: target.symbol, timeframe: target.timeframe },
                }));
            }}
        >
            <Bug size={16} strokeWidth={1.5} aria-hidden="true" />
            <span>{tr('Report a Bug')}</span>
        </button>
    );

    return (
        <div
            className={isDesktopShell
                ? 'rtx-main-toolbar rtx-desktop-main-toolbar flex shrink-0 flex-col select-none'
                : 'rtx-main-toolbar flex h-[40px] items-center bg-[#131316] border-b border-white/10 shadow-sm select-none'}
            style={undefined}
        >
            {isDesktopShell && (
                <div
                    className="rtx-desktop-menu-row flex h-[21px] w-full shrink-0 items-center"
                    style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
                >
                    {menuBar}
                    <div className="ml-auto shrink-0">{reportBugButton}</div>
                </div>
            )}
            {!isDesktopShell && menuBar}
            {!isDesktopShell && <MT5Divider />}
            <div
                className={isDesktopShell
                    ? 'rtx-desktop-command-row flex h-[32px] min-w-0 w-full shrink-0 items-center overflow-hidden'
                    : 'rtx-chart-toolbar-scroll flex min-w-0 flex-1 self-stretch items-center overflow-x-auto px-1.5'}
                tabIndex={isDesktopShell ? undefined : 0}
                role={isDesktopShell ? undefined : 'region'}
                aria-label={isDesktopShell ? undefined : 'Scrollable chart toolbar'}
                style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
            >
                <div className={isDesktopShell
                    ? 'rtx-desktop-command-scroll rtx-chart-toolbar-scroll flex min-w-0 flex-1 self-stretch items-center overflow-x-auto px-1'
                    : 'contents'}
                    tabIndex={isDesktopShell ? 0 : undefined}
                    role={isDesktopShell ? 'region' : undefined}
                    aria-label={isDesktopShell ? 'Scrollable chart toolbar' : undefined}>
                    <div
                        className="rtx-toolbar-command-cluster flex shrink-0 items-center"
                        role="toolbar"
                        aria-label="Chart commands"
                        style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
                    >
                        {/* New Order & Last Symbol */}
                        <MT5Group label="Trading shortcuts" className="rtx-toolbar-group--trading">

                            <button
                                type="button"
                                className="rtx-toolbar-action rtx-toolbar-action--primary text-[13px] font-normal font-segoe"
                                title="New Order (F9)"
                                aria-label={tr("New Order (F9)")}
                                onClick={() => {
                                    window.dispatchEvent(new CustomEvent('openNewOrder', {
                                        detail: { symbol },
                                    }));
                                }}
                            >
                                <span className="rtx-toolbar-action__label">New Order</span>
                            </button>

                            {/* Last Symbol Trader Toggle */}
                            <button
                                type="button"
                                className="rtx-toolbar-action rtx-toolbar-action--last-symbol text-[13px] font-normal font-segoe"
                                title="Last Symbol Trader Panel (Shift+B/S/X)"
                                aria-label={lastSymbol
                                    ? `Last Symbol ${lastSymbol} — Trader Panel (Shift+B/S/X)`
                                    : 'Last Symbol Trader Panel (Shift+B/S/X)'}
                                aria-pressed={lastSymbolPanelVisible}
                                onPointerEnter={() => { void lastSymbolFeature.preload().catch(() => undefined); }}
                                onFocus={() => { void lastSymbolFeature.preload().catch(() => undefined); }}
                                onClick={toggleLastSymbolPanel}
                            >
                                <span className="rtx-toolbar-action__label">Last Symbol</span>
                                {lastSymbol && (
                                    <span className="rtx-toolbar-symbol-badge" aria-hidden="true">
                                        {lastSymbol}
                                    </span>
                                )}
                            </button>
                        </MT5Group>

                        <MT5Divider />

                        {/* Group 3: Chart Types */}
                        <MT5Group label={tr("Chart type")} role="radiogroup">
                            <CommandIconButton icon="bar-chart" title="Bar Chart" active={toolbarState.chartType === 'bar'} selectionRole="radio" onClick={() => dispatchTargetedChartType('bar')} />
                            <CommandIconButton icon="candlestick" title="Candlesticks" active={toolbarState.chartType === 'candlestick'} selectionRole="radio" onClick={() => dispatchTargetedChartType('candlestick')} />
                            <CommandIconButton icon="line-chart" title={tr("Line Chart")} active={toolbarState.chartType === 'line'} selectionRole="radio" onClick={() => dispatchTargetedChartType('line')} />
                            <CommandIconButton icon="area-chart" title={tr("Area Chart")} active={toolbarState.chartType === 'area'} selectionRole="radio" onClick={() => dispatchTargetedChartType('area')} />
                        </MT5Group>

                        <MT5Divider />

                        {/* Group 4: Zoom */}
                        {/* Chart tools: zoom, layout, latest candle, indicators */}
                        <MT5Group label="Chart tools">
                            <CommandIconButton icon="zoom-in" title="Zoom In" onClick={() => dispatchTargetedZoom('ZOOM_IN')} />
                            <CommandIconButton icon="zoom-out" title="Zoom Out" onClick={() => dispatchTargetedZoom('ZOOM_OUT')} />
                            <CommandIconButton icon="grid" title="Arrange Windows" onClick={() => dispatchCommand({ type: 'TILE_WINDOWS', payload: { mode: 'grid' } })} />
                            <CommandIconButton icon="refresh" title="Reset Layout" onClick={() => window.dispatchEvent(new CustomEvent('resetLayout'))} />
                            <CommandIconButton
                                icon="chart-shift"
                                title="Jump to Latest Candle"
                                onClick={() => dispatchCommand({ type: 'JUMP_TO_LATEST_CANDLE', payload: {} })}
                            />
                            <CommandIconButton
                                icon="indicator-list"
                                title="Indicators List"
                                onClick={() => dispatchCommand({ type: 'OPEN_INDICATOR_LIST', payload: {} })}
                            />
                        </MT5Group>

                        <MT5Divider />

                        {/* Screenshot, period separators, and trade-history overlays — three equal command buttons */}
                        <MT5Group label={tr("Chart capture and overlays")}>
                            <CommandIconButton
                                icon="camera"
                                title="Screenshot (Export Chart)"
                                onClick={() => {
                                    captureFullPage();
                                }}
                            />
                            <CommandIconButton
                                icon="period-separator"
                                className="rtx-period-separator-toggle"
                                title={tradeHistorySettings.showPeriodSeparators !== false ? 'Hide Period Separators' : 'Show Period Separators'}
                                active={tradeHistorySettings.showPeriodSeparators !== false}
                                onClick={togglePeriodSeparators}
                            />
                            <div ref={historyOverlayRef} className="relative flex items-center">
                                <CommandIconButton
                                    icon="sliders-horizontal"
                                    className="rtx-trade-history-overlay-button"
                                    title={tr("Trade History Overlays")}
                                    ariaHasPopup="dialog"
                                    ariaExpanded={showHistoryOverlayMenu}
                                    ariaControls={showHistoryOverlayMenu ? TRADE_HISTORY_OVERLAY_DIALOG_ID : undefined}
                                    onClick={() => {
                                        setShowHistoryOverlayMenu((open) => !open);
                                    }}
                                />

                                {showHistoryOverlayMenu && ReactDOM.createPortal(
                                    <div
                                        id={TRADE_HISTORY_OVERLAY_DIALOG_ID}
                                        ref={historyOverlayDropdownRef}
                                        className="rtx-menu-surface rtx-history-overlay-menu fixed z-[9999]"
                                        style={getTradeHistoryOverlayPosition(historyOverlayRef.current)}
                                        role="dialog"
                                        aria-labelledby={TRADE_HISTORY_OVERLAY_TITLE_ID}
                                    >
                                        <div className="rtx-history-overlay-menu__header">
                                            <span className="rtx-history-overlay-menu__header-icon" aria-hidden="true">
                                                <History size={18} strokeWidth={1.75} />
                                            </span>
                                            <span className="rtx-history-overlay-menu__heading">
                                                <span className="rtx-history-overlay-menu__eyebrow">{tr("Chart settings")}</span>
                                                <span id={TRADE_HISTORY_OVERLAY_TITLE_ID} className="rtx-history-overlay-menu__title">{tr("Trade History")}</span>
                                            </span>
                                            <button
                                                type="button"
                                                className="rtx-history-overlay-menu__reset"
                                                onClick={resetTradeHistorySettings}
                                                disabled={tradeHistorySettingsAreDefault}
                                                aria-label={tr("Reset to Defaults")}
                                                title={tr("Reset to Defaults")}
                                            >
                                                <RotateCcw size={13} strokeWidth={1.8} aria-hidden="true" />
                                                <span>{tr("Reset")}</span>
                                            </button>
                                        </div>

                                        <div className="rtx-history-overlay-menu__options" role="group" aria-label={tr("Trade history overlay controls")}>
                                            <TradeHistoryOverlayOption
                                                kind="line"
                                                label={tr("Entry / close line")}
                                                checked={tradeHistoryLineEnabled}
                                                statusLabel={tr(tradeHistoryLineEnabled ? "On" : "Off")}
                                                onChange={(checked) => updateTradeHistorySetting('showTradeHistory', checked)}
                                            />
                                            <TradeHistoryOverlayOption
                                                kind="arrows"
                                                label={tr("Entry / close arrows")}
                                                checked={tradeHistoryArrowsEnabled}
                                                statusLabel={tr(tradeHistoryArrowsEnabled ? "On" : "Off")}
                                                onChange={(checked) => updateTradeHistorySetting('showTradeHistoryArrows', checked)}
                                            />
                                        </div>
                                    </div>,
                                    document.body,
                                )}
                            </div>
                        </MT5Group>

                        {/* Group 8: Horizontal MT-style timeframe strip */}
                        {timeframesVisible && (
                            <>
                                <MT5Divider />
                                <TimeframePicker
                                    timeframe={toolbarState.timeframe || timeframe}
                                    advancedViewEnabled={advancedViewEnabled}
                                    onSelect={(nextTimeframe) => {
                                        onTimeframeChange(nextTimeframe);
                                        const target = getActiveChartCommandTarget(symbol, timeframe);
                                        const panelId = getPanelIdFromChartContextId(target.targetContextId);
                                        dispatchCommand({
                                            type: 'SET_TIMEFRAME',
                                            payload: {
                                                timeframe: nextTimeframe,
                                                ...(target.targetContextId ? { targetContextId: target.targetContextId } : {}),
                                                ...(panelId ? { panelId } : {}),
                                            },
                                        });
                                        window.dispatchEvent(new CustomEvent('change-timeframe', { detail: { timeframe: nextTimeframe } }));
                                    }}
                                />
                            </>
                        )}
                    </div>

                    {/* Keep a usable row end without hiding any toolbar actions. */}
                    <div className="min-w-[24px] flex-1 self-stretch" aria-hidden="true" />
                </div>
                {isDesktopShell && <DesktopSymbolSearchButton />}
                {isDesktopShell && desktopDrawingTools && (
                    <div className="rtx-desktop-inline-drawings">{desktopDrawingTools}</div>
                )}
                {isDesktopShell && (
                    <DesktopQuickActions
                        accountId={accountId}
                        accountName={activeSavedAccount?.name}
                        accountServer={activeSavedAccount?.server}
                        accountBrokerName={accountBrokerName}
                        savedAccountCount={savedAccountCount}
                        onLogout={handleLogout}
                    />
                )}
            </div>
            {!isDesktopShell && reportBugButton}
            {!isDesktopShell && <WindowControls />}
        </div>
    );
};





type TradeHistoryOverlayOptionKind = 'line' | 'arrows';

interface TradeHistoryOverlayOptionProps {
    kind: TradeHistoryOverlayOptionKind;
    label: string;
    checked: boolean;
    statusLabel: string;
    onChange: (checked: boolean) => void;
}

const TradeHistoryOverlayOption = ({
    kind,
    label,
    checked,
    statusLabel,
    onChange,
}: TradeHistoryOverlayOptionProps) => (
    <label className="rtx-history-overlay-menu__option" data-enabled={checked ? 'true' : 'false'}>
        <span className="rtx-history-overlay-menu__preview" aria-hidden="true">
            {kind === 'line' ? (
                <GitCommitHorizontal size={18} strokeWidth={1.75} />
            ) : (
                <ArrowUpDown size={18} strokeWidth={1.75} />
            )}
        </span>
        <span className="rtx-history-overlay-menu__option-copy">
            <span className="rtx-history-overlay-menu__option-label">{label}</span>
            <span className="rtx-history-overlay-menu__option-status">{statusLabel}</span>
        </span>
        <span className="rtx-history-overlay-menu__control">
            <input
                type="checkbox"
                role="switch"
                aria-label={label}
                checked={checked}
                onChange={(event) => onChange(event.currentTarget.checked)}
            />
            <span className="rtx-history-overlay-menu__switch" aria-hidden="true" />
        </span>
    </label>
);


const MT5Group = ({ children, label, role, className }: { children: React.ReactNode; label?: string; role?: 'group' | 'radiogroup'; className?: string }) => (
    <div className={['rtx-toolbar-group', className, 'flex items-center'].filter(Boolean).join(' ')} role={role || (label ? 'group' : undefined)} aria-label={label}>
        {children}
    </div>
);


const MT5Divider = () => (
    <div aria-hidden="true" className="rtx-mt5-divider invisible h-6 w-0 shrink-0" />
);

interface CommandIconButtonProps {
    icon: ChartCommandIconName;
    title: string;
    active?: boolean;
    onClick?: () => void;
    disabled?: boolean;
    selectionRole?: 'radio';
    className?: string;
    ariaHasPopup?: React.AriaAttributes['aria-haspopup'];
    ariaExpanded?: boolean;
    ariaControls?: string;
}

const CommandIconButton = ({ icon, title, active, selectionRole, onClick, disabled, className, ariaHasPopup, ariaExpanded, ariaControls }: CommandIconButtonProps) => (
    <button
        type="button"
        onClick={onClick}
        title={title}
        disabled={disabled}
        role={selectionRole}
        aria-label={title}
        aria-disabled={disabled || undefined}
        aria-checked={selectionRole === 'radio' ? active : undefined}
        aria-pressed={selectionRole ? undefined : active === undefined ? undefined : active}
        aria-haspopup={ariaHasPopup}
        aria-expanded={ariaExpanded}
        aria-controls={ariaControls}
        className={['rtx-toolbar-icon-button', className].filter(Boolean).join(' ')}
    >
        <ChartCommandIcon name={icon} />
    </button>
);
