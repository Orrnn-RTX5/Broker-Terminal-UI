import { useDesktopUpdater } from '../../hooks/useDesktopUpdater';
import { useUiTranslation } from '../../hooks/useUiTranslation';
import React, { lazy, useCallback, useState, useEffect, useLayoutEffect, useRef } from 'react';
import ReactDOM from 'react-dom';
import { Menu as MenuIcon } from 'lucide-react';
import { Icon, type IconName } from '../ui/Icon';
import { RetainedLazyFeature } from '../../startup/RetainedLazyFeature';
import { FileMenu } from './FileMenu';
import { useTranslation } from 'react-i18next';
import { commandBus } from '../../services/commandBus';
import { useChartSettingsStore, type ChartProperties, type ColorScheme } from '../../store/useChartSettingsStore';
import { drawingManager } from '../../services/drawingManager';
import { useDockLayoutStore } from '../../store/useDockLayoutStore';
import type { PayloadFor } from '../../types/commands';
import { STAMP_OPTIONS } from './stampOptions';
import { openWebTrader } from '../../services/webTrader';
import { getActiveChartCommandTarget, getPanelIdFromChartContextId } from '../../services/chartCommandTarget';
import { getChartPanelCount, MAX_CHART_PANELS } from '../../services/dockManager';
import { useDrawingSidebarStore } from '../../store/useDrawingSidebarStore';
import { useTerminalBarsStore } from '../../store/useTerminalBarsStore';
import { lockedTerminalTool, unavailableDockSections } from '../../config/terminalToolAvailability';
import { supportedLanguages } from '../../config/supportedLanguages';
import { changeInterfaceLanguage } from '../../i18n';
import { getTerminalShortcutHint, runTerminalShortcutAction } from '../../services/shortcutCatalog';
import { BUILTIN_WORKSPACE_PROFILE_NAMES, restoreBuiltinWorkspaceProfile } from '../../services/localWorkspaceProfiles';
import { getAppVersion } from '../../config/appVersion';

const OptionsDialog = lazy(() => import('../settings/OptionsDialog').then(module => ({ default: module.OptionsDialog })));
const SymbolsDialog = lazy(() => import('../SymbolsDialog').then(module => ({ default: module.SymbolsDialog })));
const LoginDialog = lazy(() => import('../LoginDialog').then(module => ({ default: module.LoginDialog })));

// Local interface definition to avoid export issues
interface MenuItem {
    label: string;
    shortcut?: string;
    icon?: React.ReactNode;
    children?: MenuItem[];
    checked?: boolean;
    checkRole?: 'checkbox' | 'radio';
    divider?: boolean;
    disabled?: boolean;
    unavailableReason?: string;
    translateLabel?: boolean;
    action?: () => void;
    scrollableChildren?: boolean;
}

interface ApplicationLauncherItem {
    id: string;
    label: string;
    translateLabel?: boolean;
    icon: IconName;
    children?: MenuItem[];
    opensFileMenu?: boolean;
    action?: () => void;
    dividerBefore?: boolean;
    disabled?: boolean;
    unavailableReason?: string;
}

const DESKTOP_MENU_KEYS = ['File', 'View', 'Insert', 'Charts', 'Tools', 'Window', 'Help'] as const;

export interface MenuBarProps {
    advancedViewEnabled?: boolean;
    advancedFontSize?: 'small' | 'normal' | 'large';
    focusChart?: boolean;
    activeDrawingTool?: string | null;
    crosshairEnabled?: boolean;
    chartSymbol?: string;
    accountId?: string;
    onSetAdvancedViewEnabled?: (enabled: boolean) => void;
    onSetAdvancedFontSize?: (fontSize: 'small' | 'normal' | 'large') => void;
    onSetFocusChart?: (enabled: boolean) => void;
    onLogout?: () => void;
}

export const MenuBar = ({
    advancedViewEnabled = false,
    advancedFontSize = 'normal',
    focusChart = false,
    activeDrawingTool = null,
    crosshairEnabled = false,
    chartSymbol,
    accountId,
    onSetAdvancedViewEnabled,
    onSetAdvancedFontSize,
    onSetFocusChart,
    onLogout,
}: MenuBarProps = {}) => {
    const tr = useUiTranslation();
    const desktopUpdater = useDesktopUpdater();
    const { t, i18n } = useTranslation();
    const drawingSidebarVisible = useDrawingSidebarStore((state) => state.visible);
    const statusBarVisible = useTerminalBarsStore(state => state.statusBarVisible);
    const chartsBarVisible = useTerminalBarsStore(state => state.chartsBarVisible);
    const timeframesVisible = useTerminalBarsStore(state => state.timeframesVisible);
    const canArrangeIcons = useDockLayoutStore(state => state.layout.floatingPanels.some(container =>
        container.children.some(child => !('children' in child) && child.minimized === true)));
    const chartCount = useDockLayoutStore(state => getChartPanelCount(state.layout));
    const isElectronDesktop = typeof window !== 'undefined' && Boolean(window.electron?.window);
    const [isMenuOpen, setIsMenuOpen] = useState(false);
    const [activeMenu, setActiveMenu] = useState<string | null>(null);
    const [isOptionsOpen, setIsOptionsOpen] = useState(false);
    const [isSymbolsOpen, setIsSymbolsOpen] = useState(false);
    const [isLoginDialogOpen, setIsLoginDialogOpen] = useState(false);
    const [tradeLoginRequested, setTradeLoginRequested] = useState(false);
    useEffect(() => {
        const openLogin = () => {
            if ((window as Window & { __RTX_APP_ACTIVE__?: boolean }).__RTX_APP_ACTIVE__) return;
            setTradeLoginRequested(true);
            setIsLoginDialogOpen(true);
        };
        window.addEventListener('rtx:requestTradeLogin', openLogin);
        return () => window.removeEventListener('rtx:requestTradeLogin', openLogin);
    }, []);
    const [isFileDialogOpen, setIsFileDialogOpen] = useState(false);
    const menuRef = useRef<HTMLDivElement>(null);
    const menuButtonRef = useRef<HTMLButtonElement>(null);
    const menuPopupRef = useRef<HTMLDivElement>(null);
    const desktopMenuButtonRef = useRef<HTMLButtonElement>(null);
    const desktopMenuButtonRefs = useRef<Array<HTMLButtonElement | null>>([]);
    const [menuPosition, setMenuPosition] = useState({ top: 40, left: 4 });

    const closeMenu = useCallback(() => {
        setIsMenuOpen(false);
        setActiveMenu(null);
    }, []);

    const terminalShortcut = (id: Parameters<typeof runTerminalShortcutAction>[0]): Pick<MenuItem, 'shortcut' | 'action'> => ({
        shortcut: getTerminalShortcutHint(id),
        action: () => { runTerminalShortcutAction(id); closeMenu(); },
    });

    useEffect(() => {
        const openOptions = () => { closeMenu(); setIsOptionsOpen(true); };
        window.addEventListener('open-terminal-options', openOptions);
        return () => window.removeEventListener('open-terminal-options', openOptions);
    }, [closeMenu]);

    // Shared shortcuts and desktop quick actions open the same Symbols dialog.
    useEffect(() => {
        const handleOpenSymbolsDialog = () => setIsSymbolsOpen(true);
        window.addEventListener('openSymbolsDialog', handleOpenSymbolsDialog);
        return () => {
            window.removeEventListener('openSymbolsDialog', handleOpenSymbolsDialog);
        };
    }, []);

    // Close the launcher when clicking outside either the trigger or its portal.
    useEffect(() => {
        const handleClickOutside = (event: MouseEvent) => {
            if (isFileDialogOpen) return;
            const target = event.target as Node;
            if (target instanceof Element && target.closest('[data-rtx-desktop-submenu]')) return;
            if (!menuRef.current?.contains(target) && !menuPopupRef.current?.contains(target)) {
                closeMenu();
            }
        };
        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, [closeMenu, isFileDialogOpen]);

    useEffect(() => {
        if (!isMenuOpen) return;

        const updateMenuPosition = () => {
            const rect = menuButtonRef.current?.getBoundingClientRect();
            if (!rect) return;
            setMenuPosition({
                top: Math.min(rect.bottom + 2, Math.max(4, window.innerHeight - 250)),
                left: Math.max(4, Math.min(rect.left, window.innerWidth - 264)),
            });
        };
        const handleKeyDown = (event: KeyboardEvent) => {
            if (event.key !== 'Escape') return;
            if (isFileDialogOpen) return;
            event.preventDefault();
            closeMenu();
            (menuButtonRef.current || desktopMenuButtonRef.current)?.focus();
        };

        updateMenuPosition();
        window.addEventListener('resize', updateMenuPosition);
        window.addEventListener('scroll', updateMenuPosition, true);
        window.addEventListener('keydown', handleKeyDown);
        return () => {
            window.removeEventListener('resize', updateMenuPosition);
            window.removeEventListener('scroll', updateMenuPosition, true);
            window.removeEventListener('keydown', handleKeyDown);
        };
    }, [closeMenu, isFileDialogOpen, isMenuOpen]);

    const globalChartProperties = useChartSettingsStore(state => state.globalProperties);
    const symbolChartProperties = useChartSettingsStore(state => state.symbolProperties);

    const languageList: MenuItem[] = supportedLanguages.map(({ code, name }) => ({
        label: name,
        translateLabel: false,
        checkRole: 'radio',
        checked: (i18n.resolvedLanguage || i18n.language) === code,
        action: () => {
            void changeInterfaceLanguage(code).catch(() => {
                window.dispatchEvent(new CustomEvent('rtx:order-feedback', {
                    detail: { message: tr('Unable to change language. Please try again.'), type: 'error' },
                }));
            });
        },
    }));

    const resolveChartTarget = () => getActiveChartCommandTarget(chartSymbol);

    const updateActiveChartProperty = <K extends keyof ChartProperties>(
        key: K,
        value: ChartProperties[K],
        symbol = resolveChartTarget().symbol,
    ) => {
        const store = useChartSettingsStore.getState();
        if (symbol) {
            store.updateSymbolProperty(symbol, key, value);
        } else {
            store.updateGlobalProperty(key, value);
        }
    };

    const selectDrawingTool = (tool: PayloadFor<'SELECT_TOOL'>['tool'], subtype?: string) => {
        const { targetContextId } = resolveChartTarget();
        commandBus.dispatch({
            type: 'SELECT_TOOL',
            payload: subtype
                ? { tool, subtype, targetContextId }
                : { tool, targetContextId },
        });
    };

    const openIndicatorList = (category?: string) => {
        const target = resolveChartTarget();
        commandBus.dispatch({
            type: 'OPEN_INDICATOR_LIST',
            payload: {
                ...(category ? { category } : {}),
                targetContextId: target.targetContextId,
                symbol: target.symbol,
            },
        });
        setActiveMenu(null);
    };

    const menuChartTarget = getActiveChartCommandTarget(chartSymbol);
    const menuChartProperties = menuChartTarget.symbol
        ? (symbolChartProperties[menuChartTarget.symbol] || globalChartProperties)
        : globalChartProperties;
    const menuChartType = menuChartProperties.chartType === 'Bar'
        ? 'bar'
        : menuChartProperties.chartType === 'Line'
            ? 'line'
            : menuChartProperties.chartType === 'Area'
                ? 'area'
                : 'candlestick';

    const toggleOneClickTrading = () => {
        runTerminalShortcutAction('trading.toggle-one-click');
    };

    const openShortcutHelp = () => {
        runTerminalShortcutAction('help.shortcuts');
    };

    const fontSizeMenuItem: MenuItem = {
        label: 'Font Size',
        children: (['small', 'normal', 'large'] as const).map((fontSize) => ({
            label: fontSize.charAt(0).toUpperCase() + fontSize.slice(1),
            checked: advancedFontSize === fontSize,
            checkRole: 'radio' as const,
            action: () => onSetAdvancedFontSize?.(fontSize),
        })),
    };

    const focusChartMenuItem: MenuItem = {
        label: 'Focus Chart',
        checked: focusChart,
        checkRole: 'checkbox',
        action: () => onSetFocusChart?.(!focusChart),
    };

    const menuItems: { [key: string]: MenuItem[] } = {
        File: [
            // New Chart was removed on web and desktop: charts open from the
            // searchable Symbols dialog instead of a menu entry.
            { label: t('menu.file.openDeleted'), disabled: true },
            {
                label: t('menu.file.profiles'),
                children: [
                    {
                        label: 'Next',
                        shortcut: 'Shift+F5',
                        action: () => {
                            const active = localStorage.getItem('rtx5_active_profile') || 'Default';
                            const names = BUILTIN_WORKSPACE_PROFILE_NAMES;
                            const idx = names.findIndex(n => n.toLowerCase() === active.toLowerCase());
                            const next = names[(idx + 1) % names.length];
                            const res = restoreBuiltinWorkspaceProfile(next);
                            if (res.status === 'restored') {
                                localStorage.setItem('rtx5_active_profile', next);
                                window.dispatchEvent(new CustomEvent('rtx:order-feedback', {
                                    detail: { message: `Workspace "${next}" restored.`, type: 'success' },
                                }));
                            }
                        },
                    },
                    {
                        label: 'Previous',
                        shortcut: 'Ctrl+F5',
                        action: () => {
                            const active = localStorage.getItem('rtx5_active_profile') || 'Default';
                            const names = BUILTIN_WORKSPACE_PROFILE_NAMES;
                            const idx = names.findIndex(n => n.toLowerCase() === active.toLowerCase());
                            const prev = names[(idx - 1 + names.length) % names.length];
                            const res = restoreBuiltinWorkspaceProfile(prev);
                            if (res.status === 'restored') {
                                localStorage.setItem('rtx5_active_profile', prev);
                                window.dispatchEvent(new CustomEvent('rtx:order-feedback', {
                                    detail: { message: `Workspace "${prev}" restored.`, type: 'success' },
                                }));
                            }
                        },
                    },
                    { divider: true, label: '' },
                    ...BUILTIN_WORKSPACE_PROFILE_NAMES.map(name => ({
                        label: name,
                        action: () => {
                            const res = restoreBuiltinWorkspaceProfile(name);
                            if (res.status === 'restored') {
                                localStorage.setItem('rtx5_active_profile', name);
                                window.dispatchEvent(new CustomEvent('rtx:order-feedback', {
                                    detail: { message: `Workspace "${name}" restored.`, type: 'success' },
                                }));
                            }
                        },
                    })),
                ],
            },
            { label: t('menu.file.close'), ...terminalShortcut('file.close-chart') },
            { divider: true, label: '' },
            { label: t('menu.file.save'), icon: <Icon name="save" size="sm" />, shortcut: 'Ctrl+S' },
            { label: t('menu.file.saveAsPicture'), icon: <Icon name="file-text" size="sm" /> },
            { divider: true, label: '' },
            { label: t('menu.file.openDataFolder'), icon: <Icon name="folder-open" size="sm" />, shortcut: 'Ctrl+Shift+D' },
            { divider: true, label: '' },
            { label: t('menu.file.print'), icon: <Icon name="print" size="sm" />, shortcut: 'Ctrl+P' },
            { label: t('menu.file.printPreview') },
            { label: t('menu.file.printSetup'), icon: <Icon name="settings" size="sm" /> },
            { divider: true, label: '' },
            { label: t('menu.file.openAccount'), icon: <Icon name="user-plus" size="sm" className="text-blue-400" /> },
            { label: t('menu.file.loginTrade'), icon: <Icon name="log-in" size="sm" className="text-blue-400" /> },
            { label: t('menu.file.loginWeb'), icon: <Icon name="globe" size="sm" /> },
            { label: t('menu.file.loginMql5'), icon: <Icon name="help-circle" size="sm" className="text-blue-500" /> },
            { divider: true, label: '' },
            { label: t('menu.file.exit'), icon: <Icon name="log-out" size="sm" className="text-rose-400" />, action: () => alert('Exit clicked') }
        ],
        View: [
            {
                label: 'Theme',
                icon: <Icon name="palette" size="sm" />,
                children: [
                    {
                        label: 'Dark Theme',
                        checked: !advancedViewEnabled,
                        checkRole: 'radio',
                        action: () => onSetAdvancedViewEnabled?.(false),
                    },
                    {
                        label: 'Light Theme',
                        checked: advancedViewEnabled,
                        checkRole: 'radio',
                        action: () => onSetAdvancedViewEnabled?.(true),
                    },
                ],
            },
            { divider: true, label: '' },
            { label: t('menu.view.languages'), children: languageList, scrollableChildren: true },

            { divider: true, label: '' },
            {
                label: t('menu.view.toolbars'),
                children: [
                    { label: 'Standard', icon: <Icon name="box" size="xs" /> },
                    { label: 'Line Studies', checked: drawingSidebarVisible, checkRole: 'checkbox', action: () => useDrawingSidebarStore.getState().toggle() },
                    { label: 'Timeframes', checked: timeframesVisible, checkRole: 'checkbox', action: () => useTerminalBarsStore.getState().toggleTimeframes() },
                ],
            },
            { label: t('menu.view.statusBar'), icon: <Icon name="layout" size="sm" />, checked: statusBarVisible, checkRole: 'checkbox', action: () => useTerminalBarsStore.getState().toggleStatusBar() },
            { label: t('menu.view.chartsBar'), icon: <Icon name="layers" size="sm" />, checked: chartsBarVisible, checkRole: 'checkbox', action: () => useTerminalBarsStore.getState().toggleChartsBar() },
            { divider: true, label: '' },
            { label: 'Search Symbols', shortcut: 'Alt+U', icon: <Icon name="search" size="sm" />, action: () => { setIsSymbolsOpen(true); setActiveMenu(null); } },
            { label: t('menu.view.depthOfMarket'), ...terminalShortcut('view.depth-of-market') },
            { label: t('menu.view.marketWatch'), icon: <Icon name="monitor" size="sm" />, ...terminalShortcut('view.market-watch') },
            { label: t('menu.view.dataWindow'), ...terminalShortcut('view.data-window') },
            { label: t('menu.view.navigator'), ...terminalShortcut('view.navigator') },
            { label: t('menu.view.toolbox'), ...terminalShortcut('view.terminal') },
            { label: t('menu.view.strategyTester'), ...lockedTerminalTool('strategyTester') },
            { divider: true, label: '' },
            { label: t('menu.view.fullScreen'), shortcut: 'F11', action: () => { if (!document.fullscreenElement) { document.documentElement.requestFullscreen().catch(() => { }); } else { document.exitFullscreen().catch(() => { }); } setActiveMenu(null); } }
        ],
        Insert: [
            {
                label: t('menu.insert.indicators'),
                icon: <Icon name="line-chart" size="sm" />,
                children: [
                    { label: 'All Indicators', icon: <Icon name="activity" size="sm" />, action: () => openIndicatorList() },
                    { divider: true, label: '' },
                    { label: 'Trend', icon: <Icon name="trending-up" size="sm" />, action: () => openIndicatorList('Trend') },
                    { label: 'Oscillators', icon: <Icon name="activity" size="sm" />, action: () => openIndicatorList('Oscillators') },
                    { label: 'Volumes', icon: <Icon name="bar-chart-3" size="sm" />, action: () => openIndicatorList('Volume') },
                    { label: 'Bill Williams', icon: <Icon name="zap" size="sm" />, action: () => openIndicatorList('Bill Williams') },
                ]
            },
            {
                label: t('menu.insert.objects'),
                icon: <Icon name="paintbrush" size="sm" />,
                children: [
                    {
                        label: 'Lines',
                        children: [
                            { label: 'Trend Line', shortcut: 'Alt+T', icon: <Icon name="trend-line" size="sm" />, action: () => { commandBus.dispatch({ type: 'SELECT_TOOL', payload: { tool: 'trendline' } }); setActiveMenu(null); } },
                            { label: 'Horizontal Line', shortcut: 'Alt+H', icon: <Icon name="minus" size="sm" />, action: () => { commandBus.dispatch({ type: 'SELECT_TOOL', payload: { tool: 'hline' } }); setActiveMenu(null); } },
                            { label: 'Vertical Line', shortcut: 'Alt+V', icon: <Icon name="v-line" size="sm" />, action: () => { commandBus.dispatch({ type: 'SELECT_TOOL', payload: { tool: 'vline' } }); setActiveMenu(null); } },
                        ]
                    },
                    {
                        label: 'Channels',
                        children: [
                            { label: 'Equidistant Channel', icon: <Icon name="layers" size="sm" />, action: () => { commandBus.dispatch({ type: 'SELECT_TOOL', payload: { tool: 'channel' } }); setActiveMenu(null); } },
                        ]
                    },
                    {
                        label: 'Fibonacci',
                        children: [
                            { label: 'Fibonacci Retracement', icon: <Icon name="fibonacci" size="sm" />, action: () => { commandBus.dispatch({ type: 'SELECT_TOOL', payload: { tool: 'fibonacci' } }); setActiveMenu(null); } },
                            { label: 'Fibonacci Extension', icon: <Icon name="fib-extension" size="sm" />, action: () => { commandBus.dispatch({ type: 'SELECT_TOOL', payload: { tool: 'fib_extension' } }); setActiveMenu(null); } },
                        ]
                    },
                    {
                        label: 'Shapes',
                        children: [
                            { label: 'Rectangle', icon: <Icon name="rectangle" size="sm" />, action: () => { commandBus.dispatch({ type: 'SELECT_TOOL', payload: { tool: 'rectangle' } }); setActiveMenu(null); } },
                            { label: 'Ellipse', icon: <Icon name="ellipse" size="sm" />, action: () => { commandBus.dispatch({ type: 'SELECT_TOOL', payload: { tool: 'ellipse' } }); setActiveMenu(null); } },
                        ]
                    },
                    {
                        label: 'Stamps',
                        icon: <Icon name="thumbs-up" size="sm" />,
                        children: STAMP_OPTIONS.map((stamp) => ({
                            label: stamp.label,
                            icon: <Icon
                                name={stamp.icon}
                                size="sm"
                                className={stamp.subtype === 'buy' ? 'text-emerald-400' : stamp.subtype === 'sell' ? 'text-rose-400' : undefined}
                            />,
                            action: () => selectDrawingTool('stamp', stamp.subtype),
                        })),
                    },
                    { divider: true, label: '' },
                    { label: 'Text', shortcut: 'Alt+X', icon: <Icon name="text" size="sm" />, action: () => { commandBus.dispatch({ type: 'SELECT_TOOL', payload: { tool: 'text' } }); setActiveMenu(null); } },
                    { label: 'Callout', icon: <Icon name="callout" size="sm" />, action: () => { commandBus.dispatch({ type: 'SELECT_TOOL', payload: { tool: 'callout' } }); setActiveMenu(null); } },
                    { label: 'Measure', icon: <Icon name="measure" size="sm" />, action: () => { commandBus.dispatch({ type: 'SELECT_TOOL', payload: { tool: 'measure' } }); setActiveMenu(null); } },
                ]
            },
            { divider: true, label: '' },
            { label: t('menu.insert.experts'), icon: <Icon name="cpu" size="sm" />, action: () => { window.dispatchEvent(new CustomEvent('togglePanel', { detail: 'Navigator' })); setActiveMenu(null); } },
            { label: t('menu.insert.scripts'), icon: <Icon name="code" size="sm" />, action: () => { window.dispatchEvent(new CustomEvent('togglePanel', { detail: 'Navigator' })); setActiveMenu(null); } },
        ],
        Charts: [
            { label: t('menu.charts.depthOfMarket'), icon: <Icon name="box" size="sm" />, ...terminalShortcut('view.depth-of-market') },
            { label: t('menu.charts.indicatorList'), icon: <Icon name="line-chart" size="sm" />, ...terminalShortcut('charts.indicator-list') },
            {
                label: 'Crosshair',
                shortcut: 'C',
                icon: <Icon name="crosshair" size="sm" />,
                checked: crosshairEnabled,
                checkRole: 'checkbox',
                action: () => { const { targetContextId } = resolveChartTarget(); commandBus.dispatch({ type: 'TOGGLE_CROSSHAIR', payload: { targetContextId } }); setActiveMenu(null); },
            },
            {
                label: t('menu.charts.objects'),
                children: [
                    // Management
                    { label: 'Object List', icon: <Icon name="layout-list" size="sm" />, ...terminalShortcut('charts.object-list') },
                    { divider: true, label: '' },

                    // Destructive Actions (Muted Red)
                    { label: 'Delete Last', shortcut: 'Backspace', icon: <Icon name="x-close" size="sm" className="text-rose-400" />, action: () => { drawingManager.deleteLast(resolveChartTarget().targetContextId); setActiveMenu(null); } },
                    { label: 'Delete All Selected', shortcut: 'Del', icon: <Icon name="trash" size="sm" className="text-rose-400" />, action: () => { const { targetContextId } = resolveChartTarget(); commandBus.dispatch({ type: 'DELETE_SELECTED_DRAWING', payload: { targetContextId } }); setActiveMenu(null); } },
                    { label: 'Delete All Arrows', icon: <Icon name="minus" size="sm" className="text-rose-400" />, action: () => { drawingManager.deleteArrows(resolveChartTarget().targetContextId); setActiveMenu(null); } },
                    { label: 'Delete All', icon: <Icon name="trash" size="sm" className="text-rose-500" />, action: () => { drawingManager.clearAllDrawings(true, resolveChartTarget().targetContextId); selectDrawingTool('cursor'); setActiveMenu(null); } },
                    { divider: true, label: '' },

                    // Selection / Undo
                    { label: 'Selection Mode', shortcut: 'Esc', icon: <Icon name="cursor" size="sm" />, checked: activeDrawingTool === null || activeDrawingTool === 'cursor', checkRole: 'radio', action: () => { selectDrawingTool('cursor'); setActiveMenu(null); } },
                    { label: 'Undo Delete', shortcut: 'Ctrl+Z', icon: <Icon name="refresh" size="sm" />, action: () => { const { targetContextId } = resolveChartTarget(); commandBus.dispatch({ type: 'UNDO', payload: { targetContextId } }); setActiveMenu(null); } }
                ]
            },
            { divider: true, label: '' },
            { label: t('menu.charts.barChart'), icon: <Icon name="bar-chart" size="sm" />, checked: menuChartType === 'bar', checkRole: 'radio', ...terminalShortcut('charts.bar-chart') },
            { label: t('menu.charts.candlesticks'), icon: <Icon name="candlestick" size="sm" />, checked: menuChartType === 'candlestick', checkRole: 'radio', ...terminalShortcut('charts.candlestick') },
            { label: t('menu.charts.lineChart'), icon: <Icon name="line-chart" size="sm" />, checked: menuChartType === 'line', checkRole: 'radio', ...terminalShortcut('charts.line-chart') },
            { label: t('menu.charts.areaChart'), icon: <Icon name="area-chart" size="sm" />, checked: menuChartType === 'area', checkRole: 'radio', ...terminalShortcut('charts.area-chart') },
            { divider: true, label: '' },
            { label: t('menu.charts.grid'), shortcut: 'Ctrl+G', icon: <Icon name="grid-3x3" size="sm" />, checked: menuChartProperties.showGrid, checkRole: 'checkbox', action: () => { const target = resolveChartTarget(); const s = useChartSettingsStore.getState(); const current = target.symbol ? (s.symbolProperties[target.symbol] || s.globalProperties) : s.globalProperties; updateActiveChartProperty('showGrid', !current.showGrid, target.symbol); setActiveMenu(null); } },
            { label: t('menu.charts.autoScroll'), icon: <Icon name="auto-scroll" size="sm" />, checked: menuChartProperties.chartAutoScroll, checkRole: 'checkbox', action: () => { const target = resolveChartTarget(); const s = useChartSettingsStore.getState(); const current = target.symbol ? (s.symbolProperties[target.symbol] || s.globalProperties) : s.globalProperties; const enabled = !current.chartAutoScroll; updateActiveChartProperty('chartAutoScroll', enabled, target.symbol); commandBus.dispatch({ type: 'SET_AUTO_SCROLL', payload: { enabled, targetContextId: target.targetContextId } }); setActiveMenu(null); } },
            { label: t('menu.charts.chartShift'), icon: <Icon name="chart-shift" size="sm" />, checked: menuChartProperties.chartShift, checkRole: 'checkbox', action: () => { const target = resolveChartTarget(); const s = useChartSettingsStore.getState(); const current = target.symbol ? (s.symbolProperties[target.symbol] || s.globalProperties) : s.globalProperties; const enabled = !current.chartShift; updateActiveChartProperty('chartShift', enabled, target.symbol); commandBus.dispatch({ type: 'SET_CHART_SHIFT', payload: { enabled, targetContextId: target.targetContextId } }); setActiveMenu(null); } },
            { label: t('menu.charts.volumes'), shortcut: 'Ctrl+K', icon: <Icon name="bar-chart-3" size="sm" />, checked: menuChartProperties.showTickVolumes || menuChartProperties.showRealVolumes, checkRole: 'checkbox', action: () => { const target = resolveChartTarget(); const s = useChartSettingsStore.getState(); const current = target.symbol ? (s.symbolProperties[target.symbol] || s.globalProperties) : s.globalProperties; const visible = !(current.showTickVolumes || current.showRealVolumes); updateActiveChartProperty('showTickVolumes', visible, target.symbol); updateActiveChartProperty('showRealVolumes', false, target.symbol); setActiveMenu(null); } },
            { label: t('menu.charts.ohlc', 'Show OHLC'), shortcut: 'Alt+Shift+L', icon: <Icon name="activity" size="sm" />, checked: menuChartProperties.showOHLC, checkRole: 'checkbox', action: () => { const target = resolveChartTarget(); const s = useChartSettingsStore.getState(); const current = target.symbol ? (s.symbolProperties[target.symbol] || s.globalProperties) : s.globalProperties; updateActiveChartProperty('showOHLC', !current.showOHLC, target.symbol); setActiveMenu(null); } },
            { divider: true, label: '' },
            { label: t('menu.charts.zoomIn'), shortcut: '+', action: () => { const { targetContextId } = resolveChartTarget(); commandBus.dispatch({ type: 'ZOOM_IN', payload: { targetContextId } }); setActiveMenu(null); } },
            { label: t('menu.charts.zoomOut'), shortcut: '-', action: () => { const { targetContextId } = resolveChartTarget(); commandBus.dispatch({ type: 'ZOOM_OUT', payload: { targetContextId } }); setActiveMenu(null); } },
            { divider: true, label: '' },
            { label: t('menu.charts.properties'), shortcut: 'F8', icon: <Icon name="settings" size="sm" />, action: () => { const target = resolveChartTarget(); window.dispatchEvent(new CustomEvent('openChartProperties', { detail: target })); setActiveMenu(null); } }
        ],
        Tools: [
            // Primary Trading
            {
                label: t('menu.tools.newOrder'),
                icon: <Icon name="plus" size="sm" className="text-emerald-500" />,
                ...terminalShortcut('tools.new-order'),
            },
            { divider: true, label: '' },

            // Development & Automation (RTX5 Rebranded)
            {
                label: t('menu.tools.strategyTester'),
                icon: <Icon name="activity" size="sm" />,
                ...lockedTerminalTool('strategyTester'),
            },
            {
                label: t('menu.tools.scriptEditor'),
                icon: <Icon name="credit-card" size="sm" />,
                ...lockedTerminalTool('scriptEditor'),
            },
            {
                label: t('menu.tools.agentsManager'),
                icon: <Icon name="cpu" size="sm" />,
                ...lockedTerminalTool('agentsManager'),
            },
            { divider: true, label: '' },

            // System & Monitoring
            {
                label: t('menu.tools.taskManager'),
                icon: <Icon name="server" size="sm" />,
                ...lockedTerminalTool('taskManager'),
            },
            {
                label: t('menu.tools.globalVariables'),
                icon: <Icon name="globe" size="sm" />,
                ...lockedTerminalTool('globalVariables'),
            },
            { divider: true, label: '' },

            // RTX5 Services
            { label: t('menu.tools.marketplace'), icon: <Icon name="box" size="sm" />, ...lockedTerminalTool('marketplace') },
            { label: t('menu.tools.signalsHub'), icon: <Icon name="activity" size="sm" />, ...lockedTerminalTool('signalsHub') },
            { label: t('menu.tools.cloudHosting'), icon: <Icon name="shield" size="sm" />, ...lockedTerminalTool('cloudHosting') },
            { divider: true, label: '' },

            // Settings
            { label: t('menu.tools.options'), icon: <Icon name="settings" size="sm" />, ...terminalShortcut('tools.options') }
        ],

        Window: [
            { label: 'Add chart', icon: <Icon name="plus" size="sm" />, ...terminalShortcut('window.add-chart'), disabled: chartCount >= MAX_CHART_PANELS, unavailableReason: chartCount >= MAX_CHART_PANELS ? tr('Maximum {{limit}} charts are open', { limit: MAX_CHART_PANELS }) : undefined },
            { label: t('menu.window.tileWindows'), icon: <Icon name="grid" size="sm" />, ...terminalShortcut('window.tile') },
            { label: t('menu.window.cascade'), icon: <Icon name="layers" size="sm" />, ...terminalShortcut('window.cascade') },
            { label: t('menu.window.tileHorizontally'), icon: <Icon name="layout" size="sm" />, ...terminalShortcut('window.tile-horizontal') },
            { label: t('menu.window.tileVertically'), icon: <Icon name="layout" size="sm" />, ...terminalShortcut('window.tile-vertical') },
            { label: t('menu.window.arrangeIcons'), icon: <Icon name="grid" size="sm" />, ...terminalShortcut('window.arrange-icons'), disabled: !canArrangeIcons, unavailableReason: canArrangeIcons ? undefined : 'Minimize a floating window before arranging icons' },
            { divider: true, label: '' },
            { label: 'Reset Windows', icon: <Icon name="refresh" size="sm" className="text-emerald-500" />, ...terminalShortcut('window.reset') },
            { divider: true, label: '' },
            {
                label: t('menu.window.resolution'),
                icon: <Icon name="monitor" size="sm" />,
                disabled: true,
                unavailableReason: 'Display resolution is controlled by your operating system',
            }
        ],
        Help: [
            { label: t('menu.help.helpTopics'), icon: <Icon name="help-circle" size="sm" />, ...terminalShortcut('help.shortcuts') },
            { label: t('menu.help.whatsNew'), icon: <Icon name="zap" size="sm" className="text-yellow-400" /> },
            { label: t('menu.help.telegramChannel'), icon: <Icon name="arrow-right" size="sm" className="text-blue-400" /> },
            { label: t('menu.help.videoGuides'), icon: <Icon name="play" size="sm" />, children: [{ label: 'Getting Started' }, { label: 'Trading' }, { label: 'Analysis' }] },
            { divider: true, label: '' },
            { label: t('menu.help.webTrader'), icon: <Icon name="globe" size="sm" /> },
            { label: t('menu.help.documentation'), icon: <Icon name="book-open" size="sm" />, disabled: true, unavailableReason: 'Documentation is not configured for this deployment' },
            { label: t('menu.help.algoBook'), icon: <Icon name="book-open" size="sm" className="text-amber-400" /> },
            { label: t('menu.help.neuroBook'), icon: <Icon name="cpu" size="sm" className="text-purple-400" /> },
            { label: t('menu.help.articles'), icon: <Icon name="file-text" size="sm" /> },
            { label: t('menu.help.codeBase'), icon: <Icon name="code" size="sm" /> },
            { label: t('menu.help.jobs'), icon: <Icon name="briefcase" size="sm" /> },
            { label: t('menu.help.marketplace'), icon: <Icon name="box" size="sm" />, ...lockedTerminalTool('marketplace') },
            { label: t('menu.help.signals'), icon: <Icon name="signal" size="sm" />, ...lockedTerminalTool('signalsHub') },
            { label: t('menu.help.quotes'), icon: <Icon name="trending-up" size="sm" /> },
            { label: t('menu.help.forum'), icon: <Icon name="callout" size="sm" /> },
            { label: t('menu.help.cloudHosting'), icon: <Icon name="globe" size="sm" className="rtx-menu-icon--neutral" />, ...lockedTerminalTool('cloudHosting') },
            { divider: true, label: '' },
            {
                label: t('menu.help.mobile'),
                icon: <Icon name="smartphone" size="sm" />,
                children: [
                    { label: 'Economic Calendar' },
                    { label: 'RTX5 Messenger' },
                    { label: 'RTX5 for iOS' },
                    { label: 'RTX5 for Android' }
                ]
            },
            { label: t('menu.help.mac'), icon: <Icon name="monitor" size="sm" /> },
            { label: t('menu.help.linux'), icon: <Icon name="terminal" size="sm" /> },
            { divider: true, label: '' },
            {
                label: t('menu.help.checkForUpdates'),
                icon: <Icon name="download" size="sm" className="text-blue-500" />,
                children: [
                    { label: 'Latest Release Version', icon: <Icon name="check-circle" size="xs" className="text-emerald-500" /> },
                    { label: 'Latest Beta Version', icon: <Icon name="alert-triangle" size="xs" className="text-amber-500" /> }
                ]
            },
            { divider: true, label: '' },
            { label: t('menu.help.about'), icon: <Icon name="box" size="sm" /> }
        ]
    };

    const hamburgerViewItems: MenuItem[] = [
        fontSizeMenuItem,
        focusChartMenuItem,
        ...menuItems.View.slice(1),
    ];

    const applyActiveColorTemplate = (scheme: ColorScheme) => {
        const { symbol } = resolveChartTarget();
        const store = useChartSettingsStore.getState();
        if (symbol) {
            store.applySymbolPresetScheme(symbol, scheme);
            return;
        }
        store.applyPresetScheme(scheme);
    };

    const colorTemplateItems: MenuItem[] = (
        ['Green on Black', 'Blue on Black', 'Black on White', 'Yellow on Black'] as const
    ).map((scheme) => ({
        label: scheme,
        checked: menuChartProperties.colorScheme === scheme,
        checkRole: 'radio',
        action: () => applyActiveColorTemplate(scheme),
    }));

    const toggleDrawingTools = () => {
        useDrawingSidebarStore.getState().toggle();
        closeMenu();
    };
    const drawingToolsVisibilityLabel = drawingSidebarVisible ? 'Hide drawing tools' : 'Show drawing tools';

    const desktopMenuItems: Record<(typeof DESKTOP_MENU_KEYS)[number], MenuItem[]> = {
        File: menuItems.File,
        View: [
            menuItems.View[0],
            fontSizeMenuItem,
            focusChartMenuItem,
            ...menuItems.View.slice(1, -2),
            {
                label: 'Economic Calendar',
                icon: <Icon name="calendar" size="sm" />,
                disabled: true,
                unavailableReason: unavailableDockSections.Calendar,
            },
            ...menuItems.View.slice(-2),
            { divider: true, label: '' },
            { label: `Version ${getAppVersion()}`, icon: <Icon name="info" size="sm" />, disabled: true },
            {
                label: desktopUpdater.updateLabel,
                icon: <Icon name="download" size="sm" />,
                disabled: desktopUpdater.updateButtonDisabled,
                unavailableReason: desktopUpdater.hasUpdater ? undefined : 'Updates are available in the installed desktop app',
                action: () => { void desktopUpdater.handleUpdateClick(); },
            },
        ],
        Insert: menuItems.Insert,
        Charts: [
            { label: 'Color Templates', icon: <Icon name="palette" size="sm" />, children: colorTemplateItems },
            { divider: true, label: '' },
            ...menuItems.Charts,
        ],
        Tools: [
            menuItems.Tools[0],
            {
                label: 'One Click Trading',
                shortcut: getTerminalShortcutHint('trading.toggle-one-click'),
                icon: <Icon name="cursor" size="sm" />,
                action: toggleOneClickTrading,
            },
            ...menuItems.Tools.slice(1),
        ],
        Window: menuItems.Window,
        Help: [
            {
                label: 'Shortcuts',
                shortcut: getTerminalShortcutHint('help.shortcuts'),
                icon: <Icon name="help-circle" size="sm" />,
                action: openShortcutHelp,
            },
            { divider: true, label: '' },
            ...menuItems.Help,
        ],
    };

    const fileMenu = (
        <FileMenu
            accountId={accountId}
            onDialogOpenChange={setIsFileDialogOpen}
            onLogout={onLogout ? () => {
                onLogout();
                closeMenu();
            } : undefined}
            onSave={(workspaceName) => {
                window.dispatchEvent(new CustomEvent('rtx:order-feedback', {
                    detail: {
                        message: `Workspace "${workspaceName || 'Default'}" saved.`,
                        type: 'success',
                    },
                }));
                closeMenu();
            }}
            onCloseActiveChart={() => {
                const activeTarget = getActiveChartCommandTarget(chartSymbol);
                const closed = useDockLayoutStore.getState().closeActiveChart(
                    activeTarget.symbol || chartSymbol,
                    getPanelIdFromChartContextId(activeTarget.targetContextId) || undefined,
                );
                window.dispatchEvent(new CustomEvent('rtx:order-feedback', {
                    detail: closed
                        ? { message: 'Chart closed. Use Open Deleted to restore it.', type: 'success' }
                        : { message: 'No chart is available to close.', type: 'error' },
                }));
                closeMenu();
            }}
            onChartRestored={() => {
                window.dispatchEvent(new CustomEvent('rtx:order-feedback', {
                    detail: { message: 'Chart restored.', type: 'success' },
                }));
                closeMenu();
            }}
            onProfileRestored={(profileName) => {
                window.dispatchEvent(new CustomEvent('rtx:order-feedback', {
                    detail: { message: `Workspace "${profileName}" restored.`, type: 'success' },
                }));
                closeMenu();
            }}
            onSaveAsPicture={() => {
                console.log('Save as picture');
            }}
            onOpenDataFolder={isElectronDesktop ? () => {
                console.log('[MenuBar] Open data folder triggered');
                window.dispatchEvent(new CustomEvent('openDataFolder'));
                closeMenu();
            } : undefined}
            onPrint={async (chartData, preferences) => {
                const { chartPrinter } = await import('../../services/chartPrinter');
                await chartPrinter.printChart(chartData, preferences);
                closeMenu();
            }}
            onPrintPreview={() => {
                console.log('Print preview');
            }}
            onPrintSetup={() => {
                console.log('Print setup');
            }}
            onLoginTrade={() => {
                if (typeof window !== 'undefined' && (window as Window & { __RTX_APP_ACTIVE__?: boolean }).__RTX_APP_ACTIVE__) {
                    window.dispatchEvent(new CustomEvent('rtx:openTradeAuth'));
                } else {
                    setTradeLoginRequested(false);
                    setIsLoginDialogOpen(true);
                }
                closeMenu();
            }}
            onLoginWebTrader={async () => {
                closeMenu();
                const result = await openWebTrader();
                window.dispatchEvent(new CustomEvent('rtx:order-feedback', {
                    detail: result.status === 'opened'
                        ? { message: `Opened ${result.brokerName} Web Trader.`, type: 'success' }
                        : { message: result.message, type: 'error' },
                }));
            }}
            onExit={() => {
                if (!isElectronDesktop) onLogout?.();
                closeMenu();
            }}
            hasUnsavedChanges={false}
        />
    );

    const applicationLauncherItems: ApplicationLauncherItem[] = [
        {
            id: 'trading-accounts',
            label: 'Trading accounts',
            icon: 'user',
            opensFileMenu: true,
        },
        {
            id: 'chart-settings',
            label: 'Chart settings',
            icon: 'settings',
            children: [
                { label: 'Chart controls', icon: <Icon name="candlestick" size="sm" />, children: menuItems.Charts },
                { label: 'Insert & drawing tools', icon: <Icon name="paintbrush" size="sm" />, children: menuItems.Insert },
            ],
        },
        {
            id: 'one-click-trading',
            label: 'One Click Trading',
            icon: 'cursor',
            action: () => {
                toggleOneClickTrading();
                closeMenu();
            },
        },
        {
            id: 'drawing-sidebar',
            label: drawingToolsVisibilityLabel,
            icon: 'paintbrush',
            action: toggleDrawingTools,
        },
        {
            id: 'theme',
            label: advancedViewEnabled ? 'Dark Theme' : 'Light Theme',
            icon: 'eye',
            dividerBefore: true,
            action: () => {
                onSetAdvancedViewEnabled?.(!advancedViewEnabled);
                closeMenu();
            },
        },
        {
            id: 'color-templates',
            label: 'Color Templates',
            icon: 'palette',
            children: colorTemplateItems,
        },
        {
            id: 'algo-trading',
            label: 'RTX5 Algo Trading',
            icon: 'code',
            dividerBefore: true,
            children: menuItems.Tools,
        },
        {
            id: 'terminal',
            label: 'RTX5 Terminal',
            icon: 'monitor',
            children: [
                { label: 'View & interface', icon: <Icon name="eye" size="sm" />, children: hamburgerViewItems },
                { label: 'Window layout', icon: <Icon name="layout" size="sm" />, children: menuItems.Window },
                { label: 'Help & resources', icon: <Icon name="help-circle" size="sm" />, children: menuItems.Help },
            ],
        },
        {
            id: 'economic-calendar',
            label: 'Economic Calendar',
            icon: 'calendar',
            dividerBefore: true,
            disabled: true,
            unavailableReason: unavailableDockSections.Calendar,
        },
        {
            id: 'language',
            label: 'Language',
            icon: 'globe',
            dividerBefore: true,
            children: languageList,
        },
        {
            id: 'shortcuts',
            label: 'Shortcuts',
            icon: 'help-circle',
            action: () => {
                openShortcutHelp();
                closeMenu();
            },
        },
        {
            id: 'contact',
            label: 'Contact us',
            icon: 'mail',
            dividerBefore: true,
            children: menuItems.Help,
        },
        {
            id: 'about',
            label: 'About program',
            icon: 'info',
            children: menuItems.Help,
        },
    ];

    useEffect(() => {
        if (!isMenuOpen || isElectronDesktop) return;
        const frame = window.requestAnimationFrame(() => {
            menuPopupRef.current?.querySelector<HTMLButtonElement>('[data-root-menu-item="true"]')?.focus();
        });
        return () => window.cancelAnimationFrame(frame);
    }, [isElectronDesktop, isMenuOpen]);

    return (
        <>
            {React.cloneElement(fileMenu, { shortcutsOnly: true })}
            {isElectronDesktop && (
                <div
                    ref={menuRef}
                    className="rtx-desktop-menu-bar flex h-full w-full min-w-0 items-center gap-px px-1 text-[13px] font-normal"
                    style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
                >
                    <div
                        role="menubar"
                        aria-label={tr("Desktop application menu")}
                        className="rtx-desktop-menu-items flex h-full shrink-0 items-center gap-px"
                        onKeyDown={(event) => {
                            const target = event.target as HTMLButtonElement;
                            if (target.dataset.desktopMenuButton !== 'true') return;

                            const currentIndex = desktopMenuButtonRefs.current.indexOf(target);
                            if (currentIndex < 0) return;

                            let nextIndex: number | null = null;
                            if (event.key === 'ArrowRight') nextIndex = (currentIndex + 1) % DESKTOP_MENU_KEYS.length;
                            if (event.key === 'ArrowLeft') nextIndex = (currentIndex - 1 + DESKTOP_MENU_KEYS.length) % DESKTOP_MENU_KEYS.length;
                            if (event.key === 'Home') nextIndex = 0;
                            if (event.key === 'End') nextIndex = DESKTOP_MENU_KEYS.length - 1;

                            if (nextIndex !== null) {
                                event.preventDefault();
                                desktopMenuButtonRefs.current[nextIndex]?.focus();
                                if (isMenuOpen) setActiveMenu(DESKTOP_MENU_KEYS[nextIndex]);
                                return;
                            }

                            if (!['ArrowDown', 'ArrowUp', 'Enter', ' '].includes(event.key)) return;

                            event.preventDefault();
                            const menuKey = DESKTOP_MENU_KEYS[currentIndex];
                            setActiveMenu(menuKey);
                            setIsMenuOpen(true);
                            window.requestAnimationFrame(() => {
                                const menuItemsForKey = Array.from(
                                    target.parentElement
                                        ?.querySelector<HTMLDivElement>('[role="menu"]')
                                        ?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)') ?? [],
                                );
                                const itemToFocus = event.key === 'ArrowUp'
                                    ? menuItemsForKey[menuItemsForKey.length - 1]
                                    : menuItemsForKey[0];
                                itemToFocus?.focus();
                            });
                        }}
                    >
                        {DESKTOP_MENU_KEYS.map((menuKey, index) => {
                            const isActive = isMenuOpen && activeMenu === menuKey;

                            return (
                                <div key={menuKey} className="relative flex h-full items-center">
                                    <button
                                        ref={(button) => {
                                            desktopMenuButtonRefs.current[index] = button;
                                        }}
                                        type="button"
                                        role="menuitem"
                                        data-desktop-menu-button="true"
                                        aria-haspopup="menu"
                                        aria-expanded={isActive}
                                        onFocus={(event) => {
                                            desktopMenuButtonRef.current = event.currentTarget;
                                        }}
                                        onMouseEnter={(event) => {
                                            if (!isMenuOpen) return;
                                            desktopMenuButtonRef.current = event.currentTarget;
                                            setActiveMenu(menuKey);
                                        }}
                                        onClick={(event) => {
                                            desktopMenuButtonRef.current = event.currentTarget;
                                            if (isActive) {
                                                closeMenu();
                                            } else {
                                                setActiveMenu(menuKey);
                                                setIsMenuOpen(true);
                                            }
                                        }}
                                        className={`rtx-application-menu-trigger flex h-[23px] items-center border border-transparent px-2.5 leading-none outline-none transition-colors ${isActive ? 'is-open' : ''}`}
                                    >
                                        {tr(menuKey)}
                                    </button>

                                    {isActive && (
                                        <div
                                            className={`absolute left-0 top-full z-[10000] mt-px ${menuKey === 'File' ? 'rtx-desktop-file-menu-container' : ''}`}
                                            role="menu"
                                            aria-label={tr("{{value0}} menu", { value0: tr(menuKey) })}
                                        >
                                            {menuKey === 'File' ? (
                                                fileMenu
                                            ) : (
                                                <div className="rtx-menu-surface min-w-[260px] py-1">
                                                    <MenuList items={desktopMenuItems[menuKey]} onClose={closeMenu} />
                                                </div>
                                            )}
                                        </div>
                                    )}
                                </div>
                            );
                        })}
                    </div>

                </div>
            )}

            {!isElectronDesktop && <div
                ref={menuRef}
                className="rtx-menu-launcher flex h-[40px] shrink-0 items-center"
                style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
            >
                <button
                    ref={menuButtonRef}
                    type="button"
                    aria-label={tr("Open application menu")}
                    aria-haspopup="menu"
                    aria-expanded={isMenuOpen}
                    title={tr("Application menu")}
                    onClick={() => {
                        if (isMenuOpen) {
                            closeMenu();
                        } else {
                            setActiveMenu(null);
                            setIsMenuOpen(true);
                        }
                    }}
                    className={`rtx-application-menu-trigger flex h-[36px] w-[56px] items-center justify-center border border-transparent transition-colors outline-none ${isMenuOpen ? 'is-open' : ''}`}
                >
                    <MenuIcon size={23} strokeWidth={1.8} aria-hidden="true" />
                </button>
            </div>}

            {!isElectronDesktop && isMenuOpen && ReactDOM.createPortal(
                <div
                    ref={menuPopupRef}
                    className="rtx-application-menu fixed z-[9999] w-[256px] text-[14px] font-normal"
                    style={{ top: menuPosition.top, left: menuPosition.left }}
                    role="menu"
                    aria-label={tr("Application menu")}
                    onKeyDown={(event) => {
                        const target = event.target as HTMLElement;
                        if (target.dataset.rootMenuItem !== 'true') return;
                        const rootItems = Array.from(menuPopupRef.current?.querySelectorAll<HTMLButtonElement>('[data-root-menu-item="true"]:not(:disabled)') ?? []);
                        const currentIndex = rootItems.indexOf(target as HTMLButtonElement);
                        if (currentIndex < 0) return;

                        let nextIndex: number | null = null;
                        if (event.key === 'ArrowDown') nextIndex = (currentIndex + 1) % rootItems.length;
                        if (event.key === 'ArrowUp') nextIndex = (currentIndex - 1 + rootItems.length) % rootItems.length;
                        if (event.key === 'Home') nextIndex = 0;
                        if (event.key === 'End') nextIndex = rootItems.length - 1;
                        if (nextIndex !== null) {
                            event.preventDefault();
                            rootItems[nextIndex]?.focus();
                            return;
                        }

                        if (event.key === 'ArrowRight') {
                            const key = target.dataset.menuKey;
                            if (!key || target.getAttribute('aria-haspopup') !== 'menu') return;
                            event.preventDefault();
                            setActiveMenu(key);
                            window.requestAnimationFrame(() => {
                                target.parentElement
                                    ?.querySelector<HTMLDivElement>('[role="menu"]')
                                    ?.querySelector<HTMLButtonElement>('button:not(:disabled)')
                                    ?.focus();
                            });
                        }
                        if (event.key === 'ArrowLeft' && activeMenu) {
                            event.preventDefault();
                            setActiveMenu(null);
                        }
                    }}
                >
                    <div className="rtx-application-menu__items">
                        {applicationLauncherItems.map((item, rootIndex) => {
                            const hasSubmenu = Boolean(item.opensFileMenu || item.children);
                            const dividerCount = applicationLauncherItems
                                .slice(0, rootIndex + 1)
                                .filter(candidate => candidate.dividerBefore)
                                .length;

                            return (
                                <React.Fragment key={item.id}>
                                    {item.dividerBefore && (
                                        <div className="rtx-application-menu__divider" role="separator" />
                                    )}
                                    <div className="relative px-1.5">
                                        <button
                                            type="button"
                                            role="menuitem"
                                            disabled={item.disabled}
                                            aria-disabled={item.disabled || undefined}
                                            aria-description={item.unavailableReason ? tr(item.unavailableReason) : undefined}
                                            title={item.unavailableReason ? tr(item.unavailableReason) : undefined}
                                            data-root-menu-item="true"
                                            data-menu-key={item.id}
                                            aria-haspopup={hasSubmenu ? 'menu' : undefined}
                                            aria-expanded={hasSubmenu ? activeMenu === item.id : undefined}
                                            onClick={() => {
                                                if (item.disabled) return;
                                                if (hasSubmenu) {
                                                    setActiveMenu(activeMenu === item.id ? null : item.id);
                                                    return;
                                                }
                                                item.action?.();
                                            }}
                                            className={`rtx-application-menu__root-item ${item.disabled ? 'is-disabled cursor-not-allowed' : ''} ${activeMenu === item.id ? 'is-active' : ''}`}
                                        >
                                            <span className="rtx-application-menu__root-icon" aria-hidden="true">
                                                <Icon name={item.icon} size={18} />
                                            </span>
                                            <span className="min-w-0 flex-1 truncate">{item.translateLabel === false ? item.label : tr(item.label)}</span>
                                            {item.unavailableReason ? (
                                                <span className="rtx-menu-row__lock" aria-hidden="true">
                                                    <Icon name="lock" size="xs" />
                                                </span>
                                            ) : hasSubmenu ? (
                                                <Icon name="chevron-right" size="xs" className="rtx-application-menu__chevron" />
                                            ) : null}
                                        </button>

                                        {activeMenu === item.id && hasSubmenu && (
                                            <div
                                                className="absolute left-full ml-px z-[10000]"
                                                style={{
                                                    top: -(
                                                        rootIndex * 38
                                                        + dividerCount * 5
                                                    ),
                                                }}
                                                role="menu"
                                                aria-label={tr("{{value0}} menu", { value0: item.label })}
                                            >
                                                {item.opensFileMenu ? (
                                                    fileMenu
                                                ) : (
                                                    <div className="rtx-menu-surface min-w-[260px] py-1">
                                                        <MenuList items={item.children || []} onClose={closeMenu} />
                                                    </div>
                                                )}
                                            </div>
                                        )}
                                    </div>
                                </React.Fragment>
                            );
                        })}
                    </div>
                </div>,
                document.body,
            )}

            {/* Options Dialog Modal */}
            <RetainedLazyFeature active={isOptionsOpen}>
            <OptionsDialog isOpen={isOptionsOpen} onClose={() => setIsOptionsOpen(false)} />
            </RetainedLazyFeature>

            {/* Keep account login available when the desktop status bar is absent. */}
            <RetainedLazyFeature active={isLoginDialogOpen}>
            <LoginDialog
                reason={tradeLoginRequested ? 'trade' : undefined}
                isOpen={isLoginDialogOpen}
                onClose={() => setIsLoginDialogOpen(false)}
            />
            </RetainedLazyFeature>

            {/* Symbols Dialog */}
            <RetainedLazyFeature active={isSymbolsOpen}>
            <SymbolsDialog
                isOpen={isSymbolsOpen}
                onClose={() => setIsSymbolsOpen(false)}
                onShowSymbol={(symbol) => {
                    window.dispatchEvent(new CustomEvent('watchlist:addSymbol', { detail: { symbol } }));
                }}
                onOpenChart={(symbol) => {
                    window.dispatchEvent(new CustomEvent('openChart', { detail: { symbol } }));
                }}
            />
            </RetainedLazyFeature>
        </>
    );
};

const MenuList = ({ items, onClose }: { items: MenuItem[]; onClose?: () => void }) => {
    const [openIndex, setOpenIndex] = useState<number | null>(null);

    return (
        <>
            {items.map((item, index) => (
                <MenuItem
                    key={index}
                    item={item}
                    isSubmenuOpen={openIndex === index}
                    onToggleSubmenu={(open) => setOpenIndex(open ? index : null)}
                    onClose={onClose}
                />
            ))}
        </>
    );
};

const MenuItem = ({
    item,
    isSubmenuOpen,
    onToggleSubmenu,
    onClose,
}: {
    item: MenuItem;
    isSubmenuOpen: boolean;
    onToggleSubmenu: (open: boolean) => void;
    onClose?: () => void;
}) => {
    const tr = useUiTranslation();
    const submenuRef = useRef<HTMLDivElement>(null);
    const anchorRef = useRef<HTMLDivElement>(null);
    const desktop = Boolean(window.electron?.window);
    const [position, setPosition] = useState({ left: 0, top: 0 });
    useLayoutEffect(() => {
        if (!desktop || !isSubmenuOpen) return;
        const place = () => {
            const anchor = anchorRef.current?.getBoundingClientRect();
            const submenu = submenuRef.current?.getBoundingClientRect();
            if (!anchor || !submenu) return;
            const left = anchor.right + submenu.width <= window.innerWidth - 8
                ? anchor.right - 2 : Math.max(8, anchor.left - submenu.width + 2);
            setPosition({ left, top: Math.max(8, Math.min(anchor.top, window.innerHeight - submenu.height - 8)) });
        };
        place();
        window.addEventListener('resize', place);
        window.addEventListener('scroll', place, true);
        return () => {
            window.removeEventListener('resize', place);
            window.removeEventListener('scroll', place, true);
        };
    }, [desktop, isSubmenuOpen, item.label]);

    const submenu = item.children && isSubmenuOpen ? (
        <div ref={submenuRef} role="menu" aria-label={tr("{{value0}} menu", { value0: item.label })}
            data-rtx-desktop-submenu={desktop ? 'true' : undefined}
            className={`rtx-menu-surface min-w-[200px] py-1 ${desktop ? 'fixed z-[10010]' : 'absolute left-full top-0 ml-[-2px] z-[101]'} ${item.scrollableChildren ? 'max-h-[400px] overflow-y-auto no-scrollbar' : ''}`}
            style={desktop ? { ...position, maxHeight: Math.min(400, window.innerHeight - 16), maxWidth: 'calc(100vw - 16px)', overflowY: 'auto' } : undefined}>
            <MenuList items={item.children} onClose={onClose} />
        </div>
    ) : null;


    if (item.divider) {
        return <div className="rtx-menu-divider" role="separator" />;
    }

    return (
        <div ref={anchorRef} className="relative px-1">
            <button
                type="button"
                disabled={item.disabled}
                aria-disabled={item.disabled || undefined}
                aria-label={item.translateLabel === false ? item.label : tr(item.label)}
                aria-description={tr(item.unavailableReason)}
                title={tr(item.unavailableReason)}
                role={item.checkRole === 'radio' ? 'menuitemradio' : item.checkRole === 'checkbox' ? 'menuitemcheckbox' : 'menuitem'}
                aria-checked={item.checkRole ? Boolean(item.checked) : undefined}
                aria-haspopup={item.children ? 'menu' : undefined}
                aria-expanded={item.children ? isSubmenuOpen : undefined}
                onClick={() => {
                    if (item.disabled) return;
                    if (item.children) {
                        onToggleSubmenu(!isSubmenuOpen);
                        return;
                    }
                    if (item.action) {
                        item.action();
                        onClose?.();
                    }
                }}
                className={`rtx-menu-row group ${item.disabled ? 'is-disabled cursor-not-allowed' : 'cursor-default'} ${isSubmenuOpen ? 'is-open' : ''}`}
            >
                {/* Icon Area */}
                <div className="rtx-menu-row__icon">
                    {item.icon}
                </div>

                {/* Label */}
                <span className="flex-1 font-segoe">{item.translateLabel === false ? item.label : tr(item.label)}</span>

                {/* Shortcut or Submenu Arrow */}
                {item.unavailableReason ? (
                    <span className="rtx-menu-row__lock" aria-hidden="true">
                        <Icon name="lock" size="xs" />
                    </span>
                ) : item.children ? (
                    <Icon name="chevron-right" size="xs" className="rtx-menu-row__chevron" />
                ) : (
                    <span className="flex items-center gap-2">
                        {item.shortcut && <span className="rtx-menu-row__shortcut pl-4">{item.shortcut}</span>}
                        {item.checkRole && (
                            item.checked
                                ? <Icon name="check-circle" size="xs" className="rtx-menu-row__check" />
                                : <span className="h-3.5 w-3.5" aria-hidden="true" />
                        )}
                    </span>
                )}
            </button>

            {/* Portals escape the desktop root menu's scrolling/clipping boundary. */}
            {desktop && submenu ? ReactDOM.createPortal(submenu, document.body) : submenu}
        </div>
    );
};
