import React, { useCallback, useState, useEffect, useRef } from 'react';
import ReactDOM from 'react-dom';
import { Menu as MenuIcon } from 'lucide-react';
import { Icon } from '../ui/Icon';
import { OptionsDialog } from '../settings/OptionsDialog';
import { FileMenu } from './FileMenu';
import { useTranslation } from 'react-i18next';
import { SymbolsDialog } from '../SymbolsDialog';
import { commandBus } from '../../services/commandBus';
import { useChartSettingsStore } from '../../store/useChartSettingsStore';
import { drawingManager } from '../../services/drawingManager';
import { useAppStore } from '../../store/useAppStore';
import type { PayloadFor } from '../../types/commands';

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
    action?: () => void;
    scrollableChildren?: boolean;
}

interface MenuSymbol {
    name: string;
    symbol?: string;
    category?: string;
}

export interface MenuBarProps {
    advancedViewEnabled?: boolean;
    advancedFontSize?: 'small' | 'normal' | 'large';
    focusChart?: boolean;
    activeDrawingTool?: string | null;
    crosshairEnabled?: boolean;
    accountId?: string;
    onSetAdvancedViewEnabled?: (enabled: boolean) => void;
    onSetAdvancedFontSize?: (fontSize: 'small' | 'normal' | 'large') => void;
    onSetFocusChart?: (enabled: boolean) => void;
    onLogout?: () => void;
}

const STAMP_OPTIONS = [
    { subtype: 'thumbsUp', label: 'Thumbs Up', icon: 'thumbs-up' },
    { subtype: 'thumbsDown', label: 'Thumbs Down', icon: 'thumbs-down' },
    { subtype: 'arrowUp', label: 'Arrow Up', icon: 'arrow-up' },
    { subtype: 'arrowDown', label: 'Arrow Down', icon: 'arrow-down' },
    { subtype: 'stopSign', label: 'Stop Sign', icon: 'stop' },
    { subtype: 'checkSign', label: 'Check Sign', icon: 'check-circle' },
    { subtype: 'leftPriceLabel', label: 'Left Price Label', icon: 'label' },
    { subtype: 'rightPriceLabel', label: 'Right Price Label', icon: 'label' },
    { subtype: 'buy', label: 'Buy', icon: 'arrow-up' },
    { subtype: 'sell', label: 'Sell', icon: 'arrow-down' },
    { subtype: 'arrow', label: 'Arrow', icon: 'arrow-right' },
] as const;

const setVolumeBarsVisible = (visible: boolean, activeSymbol?: string) => {
    const store = useChartSettingsStore.getState();
    store.updateGlobalProperty('showTickVolumes', visible);
    store.updateGlobalProperty('showRealVolumes', false);
    if (activeSymbol) {
        store.updateSymbolProperty(activeSymbol, 'showTickVolumes', visible);
        store.updateSymbolProperty(activeSymbol, 'showRealVolumes', false);
    }
    Object.keys(store.symbolProperties).forEach((symbol) => {
        store.updateSymbolProperty(symbol, 'showTickVolumes', visible);
        store.updateSymbolProperty(symbol, 'showRealVolumes', false);
    });
};

export const MenuBar = ({
    advancedViewEnabled = false,
    advancedFontSize = 'normal',
    focusChart = false,
    activeDrawingTool = null,
    crosshairEnabled = false,
    accountId,
    onSetAdvancedViewEnabled,
    onSetAdvancedFontSize,
    onSetFocusChart,
    onLogout,
}: MenuBarProps = {}) => {
    const { t, i18n } = useTranslation();
    const [isMenuOpen, setIsMenuOpen] = useState(false);
    const [activeMenu, setActiveMenu] = useState<string | null>(null);
    const [isOptionsOpen, setIsOptionsOpen] = useState(false);
    const [isSymbolsOpen, setIsSymbolsOpen] = useState(false);
    const [isFileDialogOpen, setIsFileDialogOpen] = useState(false);
    const menuRef = useRef<HTMLDivElement>(null);
    const menuButtonRef = useRef<HTMLButtonElement>(null);
    const menuPopupRef = useRef<HTMLDivElement>(null);
    const [menuPosition, setMenuPosition] = useState({ top: 40, left: 4 });

    const closeMenu = useCallback(() => {
        setIsMenuOpen(false);
        setActiveMenu(null);
    }, []);

    // Open Symbols dialog via Alt+U
    useEffect(() => {
        const handler = (e: KeyboardEvent) => {
            if (e.altKey && (e.key.toLowerCase() === 'u' || e.code === 'KeyU')) {
                e.preventDefault();
                setIsSymbolsOpen(v => !v);
            }
        };
        window.addEventListener('keydown', handler);
        return () => window.removeEventListener('keydown', handler);
    }, []);

    // Close the launcher when clicking outside either the trigger or its portal.
    useEffect(() => {
        const handleClickOutside = (event: MouseEvent) => {
            if (isFileDialogOpen) return;
            const target = event.target as Node;
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
                left: Math.max(4, Math.min(rect.left, window.innerWidth - 204)),
            });
        };
        const handleKeyDown = (event: KeyboardEvent) => {
            if (event.key !== 'Escape') return;
            if (isFileDialogOpen) return;
            event.preventDefault();
            closeMenu();
            menuButtonRef.current?.focus();
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

    // Dynamic Symbol Loading
    const [availableSymbols, setAvailableSymbols] = useState<MenuSymbol[]>([]);
    const [isLoadingSymbols, setIsLoadingSymbols] = useState(false);
    const isAuthenticated = useAppStore(state => state.isAuthenticated);
    const selectedSymbol = useAppStore(state => state.selectedSymbol);

    useEffect(() => {
        if (!isAuthenticated) {
            setAvailableSymbols([]);
            setIsLoadingSymbols(false);
            return;
        }

        const fetchSymbols = async () => {
            try {
                // Dynamically import API to avoid circular deps if any, or just use global
                // Assuming api is exported from services/api
                const { default: api } = await import('../../services/api');
                setIsLoadingSymbols(true);
                const symbols = await api.market.getSymbols();
                if (symbols && symbols.length > 0) {
                    setAvailableSymbols(symbols);
                }
            } catch (error) {
                console.error('Failed to load menu symbols:', error);
            } finally {
                setIsLoadingSymbols(false);
            }
        };

        fetchSymbols();
    }, [isAuthenticated]);

    const languageList: MenuItem[] = [
        // Western / Latin - Fully Translated
        { label: 'English', action: () => i18n.changeLanguage('en'), icon: <div className={`w-1.5 h-1.5 rounded-full ${i18n.language === 'en' ? 'bg-zinc-600' : 'bg-transparent'}`}></div> },
        { label: 'Deutsch', action: () => i18n.changeLanguage('de'), icon: <div className={`w-1.5 h-1.5 rounded-full ${i18n.language === 'de' ? 'bg-zinc-600' : 'bg-transparent'}`}></div> },
        { label: 'Français', action: () => i18n.changeLanguage('fr'), icon: <div className={`w-1.5 h-1.5 rounded-full ${i18n.language === 'fr' ? 'bg-zinc-600' : 'bg-transparent'}`}></div> },
        { label: 'Español', action: () => i18n.changeLanguage('es'), icon: <div className={`w-1.5 h-1.5 rounded-full ${i18n.language === 'es' ? 'bg-zinc-600' : 'bg-transparent'}`}></div> },
        { label: 'Italiano', action: () => i18n.changeLanguage('it'), icon: <div className={`w-1.5 h-1.5 rounded-full ${i18n.language === 'it' ? 'bg-zinc-600' : 'bg-transparent'}`}></div> },
        { label: 'Português (BR)', action: () => i18n.changeLanguage('pt-BR'), icon: <div className={`w-1.5 h-1.5 rounded-full ${i18n.language === 'pt-BR' ? 'bg-zinc-600' : 'bg-transparent'}`}></div> },
        { label: 'Nederlands', action: () => i18n.changeLanguage('nl'), icon: <div className={`w-1.5 h-1.5 rounded-full ${i18n.language === 'nl' ? 'bg-zinc-600' : 'bg-transparent'}`}></div> },
        { label: 'Polski', action: () => i18n.changeLanguage('pl'), icon: <div className={`w-1.5 h-1.5 rounded-full ${i18n.language === 'pl' ? 'bg-zinc-600' : 'bg-transparent'}`}></div> },
        { label: 'Türkçe', action: () => i18n.changeLanguage('tr'), icon: <div className={`w-1.5 h-1.5 rounded-full ${i18n.language === 'tr' ? 'bg-zinc-600' : 'bg-transparent'}`}></div> },
        { divider: true, label: '' },

        // Cyrillic - Fully Translated
        { label: 'Русский', action: () => i18n.changeLanguage('ru'), icon: <div className={`w-1.5 h-1.5 rounded-full ${i18n.language === 'ru' ? 'bg-zinc-600' : 'bg-transparent'}`}></div> },
        { divider: true, label: '' },

        // Asian - Fully Translated
        { label: '简体中文', action: () => i18n.changeLanguage('zh-CN'), icon: <div className={`w-1.5 h-1.5 rounded-full ${i18n.language === 'zh-CN' ? 'bg-zinc-600' : 'bg-transparent'}`}></div> },
        { label: '繁體中文', action: () => i18n.changeLanguage('zh-TW'), icon: <div className={`w-1.5 h-1.5 rounded-full ${i18n.language === 'zh-TW' ? 'bg-zinc-600' : 'bg-transparent'}`}></div> },
        { label: '日本語', action: () => i18n.changeLanguage('ja'), icon: <div className={`w-1.5 h-1.5 rounded-full ${i18n.language === 'ja' ? 'bg-zinc-600' : 'bg-transparent'}`}></div> },
        { label: '한국어', action: () => i18n.changeLanguage('ko'), icon: <div className={`w-1.5 h-1.5 rounded-full ${i18n.language === 'ko' ? 'bg-zinc-600' : 'bg-transparent'}`}></div> },
        { label: 'Bahasa Indonesia', action: () => i18n.changeLanguage('id'), icon: <div className={`w-1.5 h-1.5 rounded-full ${i18n.language === 'id' ? 'bg-zinc-600' : 'bg-transparent'}`}></div> },
        { label: 'Tiếng Việt', action: () => i18n.changeLanguage('vi'), icon: <div className={`w-1.5 h-1.5 rounded-full ${i18n.language === 'vi' ? 'bg-zinc-600' : 'bg-transparent'}`}></div> },
        { label: 'ภาษาไทย', action: () => i18n.changeLanguage('th'), icon: <div className={`w-1.5 h-1.5 rounded-full ${i18n.language === 'th' ? 'bg-zinc-600' : 'bg-transparent'}`}></div> },
        { divider: true, label: '' },

        // Middle Eastern / Indic - Fully Translated
        { label: 'العربية', action: () => i18n.changeLanguage('ar'), icon: <div className={`w-1.5 h-1.5 rounded-full ${i18n.language === 'ar' ? 'bg-zinc-600' : 'bg-transparent'}`}></div> },
        { label: 'हिंदी', action: () => i18n.changeLanguage('hi'), icon: <div className={`w-1.5 h-1.5 rounded-full ${i18n.language === 'hi' ? 'bg-zinc-600' : 'bg-transparent'}`}></div> }
    ];

    const selectDrawingTool = (tool: PayloadFor<'SELECT_TOOL'>['tool'], subtype?: string) => {
        commandBus.dispatch({
            type: 'SELECT_TOOL',
            payload: subtype ? { tool, subtype } : { tool },
        });
    };

    const menuItems: { [key: string]: MenuItem[] } = {
        File: [
            {
                label: t('menu.file.newChart'),
                icon: <Icon name="plus" size="sm" className="text-emerald-500" />,
                children: isLoadingSymbols
                    ? [{ label: 'Loading...' }]
                    : availableSymbols.length > 0
                        ? (() => {
                            const buildNestedMenu = (symbols: typeof availableSymbols): MenuItem[] => {
                                const root: MenuItem[] = [];
                                const groups: Record<string, typeof availableSymbols> = {};

                                symbols.forEach(sym => {
                                    // If category is empty, it's a root item
                                    if (!sym.category || sym.category.trim() === '') {
                                        root.push({
                                            label: sym.name,
                                            action: () => window.dispatchEvent(new CustomEvent('openChart', { detail: { symbol: sym.symbol ?? sym.name } }))
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
                                    // Recurse
                                    root.push({
                                        label: key,
                                        children: buildNestedMenu(groupSymbols)
                                    });
                                });
                                return root;
                            };
                            return buildNestedMenu(availableSymbols);
                        })()
                        : [
                            // Fallback: YoForex submenu with all major pairs
                            {
                                label: 'YoForex',
                                children: [
                                    'EURUSD', 'GBPUSD', 'USDJPY', 'USDCHF', 'AUDUSD', 'USDCAD', 'NZDUSD',
                                    'EURGBP', 'EURJPY', 'EURCHF', 'EURAUD', 'EURCAD', 'EURNZD',
                                    'GBPJPY', 'GBPCHF', 'GBPAUD', 'GBPCAD', 'GBPNZD',
                                    'AUDJPY', 'AUDCHF', 'AUDCAD', 'AUDNZD',
                                    'CADJPY', 'CADCHF', 'NZDJPY', 'NZDCHF', 'CHFJPY', 'USDNOK'
                                ].map(sym => ({ label: sym, action: () => window.dispatchEvent(new CustomEvent('openChart', { detail: { symbol: sym } })) }))
                            },
                            { label: 'EURUSD', action: () => window.dispatchEvent(new CustomEvent('openChart', { detail: { symbol: 'EURUSD' } })) },
                            { label: 'GBPUSD', action: () => window.dispatchEvent(new CustomEvent('openChart', { detail: { symbol: 'GBPUSD' } })) },
                            { label: 'USDJPY', action: () => window.dispatchEvent(new CustomEvent('openChart', { detail: { symbol: 'USDJPY' } })) },
                            { label: 'XAUUSD', action: () => window.dispatchEvent(new CustomEvent('openChart', { detail: { symbol: 'XAUUSD' } })) },
                            { label: 'BTCUSD', action: () => window.dispatchEvent(new CustomEvent('openChart', { detail: { symbol: 'BTCUSD' } })) },
                        ]
            },
            { label: t('menu.file.openDeleted'), disabled: true },
            { label: t('menu.file.profiles'), children: [{ label: 'Default' }, { label: 'Euro' }, { label: 'Market' }] },
            { label: t('menu.file.close'), shortcut: 'Ctrl+F4', action: () => window.dispatchEvent(new CustomEvent('close-active-chart')) },
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
                    { divider: true, label: '' },
                    {
                        label: 'Font Size',
                        children: (['small', 'normal', 'large'] as const).map((fontSize) => ({
                            label: fontSize.charAt(0).toUpperCase() + fontSize.slice(1),
                            checked: advancedFontSize === fontSize,
                            checkRole: 'radio' as const,
                            action: () => onSetAdvancedFontSize?.(fontSize),
                        })),
                    },
                    {
                        label: 'Focus Chart',
                        checked: focusChart,
                        checkRole: 'checkbox',
                        action: () => onSetFocusChart?.(!focusChart),
                    },
                ],
            },
            { divider: true, label: '' },
            { label: t('menu.view.languages'), children: languageList, scrollableChildren: true },

            { divider: true, label: '' },
            { label: t('menu.view.toolbars'), children: [{ label: 'Standard', icon: <Icon name="box" size="xs" /> }, { label: 'Line Studies' }, { label: 'Timeframes' }] },
            { label: t('menu.view.statusBar'), icon: <Icon name="layout" size="sm" /> },
            { label: t('menu.view.chartsBar'), icon: <Icon name="layers" size="sm" /> },
            { divider: true, label: '' },
            { label: 'Search Symbols', shortcut: 'Alt+U', icon: <Icon name="search" size="sm" />, action: () => { setIsSymbolsOpen(true); setActiveMenu(null); } },
            { label: t('menu.view.depthOfMarket'), shortcut: 'Alt+B', action: () => { window.dispatchEvent(new CustomEvent('openDepthOfMarket')); setActiveMenu(null); } },
            { label: t('menu.view.marketWatch'), shortcut: 'Ctrl+M', icon: <Icon name="monitor" size="sm" />, action: () => { window.dispatchEvent(new CustomEvent('togglePanel', { detail: 'MarketWatch' })); setActiveMenu(null); } },
            { label: t('menu.view.dataWindow'), shortcut: 'Ctrl+D', action: () => { window.dispatchEvent(new CustomEvent('openDataWindow')); setActiveMenu(null); } },
            { label: t('menu.view.navigator'), shortcut: 'Ctrl+N', action: () => { window.dispatchEvent(new CustomEvent('togglePanel', { detail: 'Navigator' })); setActiveMenu(null); } },
            { label: t('menu.view.toolbox'), shortcut: 'Ctrl+T', action: () => { window.dispatchEvent(new CustomEvent('togglePanel', { detail: 'Terminal' })); setActiveMenu(null); } },
            { label: t('menu.view.strategyTester'), shortcut: 'Ctrl+R', action: () => { window.dispatchEvent(new CustomEvent('toolbox-action', { detail: { action: 'strategy-tester' } })); setActiveMenu(null); } },
            { divider: true, label: '' },
            { label: t('menu.view.fullScreen'), shortcut: 'F11', action: () => { if (!document.fullscreenElement) { document.documentElement.requestFullscreen().catch(() => { }); } else { document.exitFullscreen().catch(() => { }); } setActiveMenu(null); } }
        ],
        Insert: [
            {
                label: t('menu.insert.indicators'),
                icon: <Icon name="line-chart" size="sm" />,
                children: [
                    { label: 'All Indicators', icon: <Icon name="activity" size="sm" />, action: () => { commandBus.dispatch({ type: 'OPEN_INDICATOR_LIST', payload: {} }); setActiveMenu(null); } },
                    { divider: true, label: '' },
                    { label: 'Trend', icon: <Icon name="trending-up" size="sm" />, action: () => { commandBus.dispatch({ type: 'OPEN_INDICATOR_LIST', payload: { category: 'Trend' } }); setActiveMenu(null); } },
                    { label: 'Oscillators', icon: <Icon name="activity" size="sm" />, action: () => { commandBus.dispatch({ type: 'OPEN_INDICATOR_LIST', payload: { category: 'Oscillators' } }); setActiveMenu(null); } },
                    { label: 'Volumes', icon: <Icon name="bar-chart-3" size="sm" />, action: () => { commandBus.dispatch({ type: 'OPEN_INDICATOR_LIST', payload: { category: 'Volume' } }); setActiveMenu(null); } },
                    { label: 'Bill Williams', icon: <Icon name="zap" size="sm" />, action: () => { commandBus.dispatch({ type: 'OPEN_INDICATOR_LIST', payload: { category: 'Bill Williams' } }); setActiveMenu(null); } },
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
            { label: t('menu.charts.depthOfMarket'), shortcut: 'Alt+B', icon: <Icon name="box" size="sm" />, action: () => { window.dispatchEvent(new CustomEvent('openDepthOfMarket')); setActiveMenu(null); } },
            { label: t('menu.charts.indicatorList'), shortcut: 'Ctrl+I', icon: <Icon name="line-chart" size="sm" />, action: () => { commandBus.dispatch({ type: 'OPEN_INDICATOR_LIST', payload: {} }); setActiveMenu(null); } },
            {
                label: 'Crosshair',
                shortcut: 'C',
                icon: <Icon name="crosshair" size="sm" />,
                checked: crosshairEnabled,
                checkRole: 'checkbox',
                action: () => { commandBus.dispatch({ type: 'TOGGLE_CROSSHAIR', payload: {} }); setActiveMenu(null); },
            },
            {
                label: t('menu.charts.objects'),
                children: [
                    // Management
                    { label: 'Object List', shortcut: 'Ctrl+B', icon: <Icon name="layout-list" size="sm" /> },
                    { divider: true, label: '' },

                    // Destructive Actions (Muted Red)
                    { label: 'Delete Last', shortcut: 'Backspace', icon: <Icon name="x-close" size="sm" className="text-rose-400" />, action: () => { commandBus.dispatch({ type: 'UNDO', payload: {} }); setActiveMenu(null); } },
                    { label: 'Delete All Selected', shortcut: 'Del', icon: <Icon name="trash" size="sm" className="text-rose-400" />, action: () => { commandBus.dispatch({ type: 'DELETE_SELECTED_DRAWING', payload: {} }); setActiveMenu(null); } },
                    { label: 'Delete All Arrows', icon: <Icon name="minus" size="sm" className="text-rose-400" /> },
                    { label: 'Delete All', icon: <Icon name="trash" size="sm" className="text-rose-500" />, action: () => { drawingManager.clearAllDrawings(); selectDrawingTool('cursor'); setActiveMenu(null); } },
                    { divider: true, label: '' },

                    // Selection / Undo
                    { label: 'Selection Mode', shortcut: 'Esc', icon: <Icon name="cursor" size="sm" />, checked: activeDrawingTool === null || activeDrawingTool === 'cursor', checkRole: 'radio', action: () => { selectDrawingTool('cursor'); setActiveMenu(null); } },
                    { label: 'Undo Delete', shortcut: 'Ctrl+Z', icon: <Icon name="refresh" size="sm" />, action: () => { commandBus.dispatch({ type: 'UNDO', payload: {} }); setActiveMenu(null); } }
                ]
            },
            { divider: true, label: '' },
            { label: t('menu.charts.barChart'), shortcut: 'Alt+1', icon: <Icon name="bar-chart" size="sm" />, action: () => { commandBus.dispatch({ type: 'SET_CHART_TYPE', payload: { chartType: 'bar' } }); setActiveMenu(null); } },
            { label: t('menu.charts.candlesticks'), shortcut: 'Alt+2', icon: <Icon name="candlestick" size="sm" />, action: () => { commandBus.dispatch({ type: 'SET_CHART_TYPE', payload: { chartType: 'candlestick' } }); setActiveMenu(null); } },
            { label: t('menu.charts.lineChart'), shortcut: 'Alt+3', icon: <Icon name="line-chart" size="sm" />, action: () => { commandBus.dispatch({ type: 'SET_CHART_TYPE', payload: { chartType: 'line' } }); setActiveMenu(null); } },
            { label: t('menu.charts.areaChart'), icon: <Icon name="area-chart" size="sm" />, action: () => { commandBus.dispatch({ type: 'SET_CHART_TYPE', payload: { chartType: 'area' } }); setActiveMenu(null); } },
            { divider: true, label: '' },
            { label: t('menu.charts.grid'), shortcut: 'Ctrl+G', icon: <Icon name="grid-3x3" size="sm" />, action: () => { const s = useChartSettingsStore.getState(); s.updateGlobalProperty('showGrid', !s.globalProperties.showGrid); setActiveMenu(null); } },
            { label: t('menu.charts.autoScroll'), icon: <Icon name="auto-scroll" size="sm" />, action: () => { const s = useChartSettingsStore.getState(); s.updateGlobalProperty('chartAutoScroll', !s.globalProperties.chartAutoScroll); setActiveMenu(null); } },
            { label: t('menu.charts.chartShift'), icon: <Icon name="chart-shift" size="sm" />, action: () => { const s = useChartSettingsStore.getState(); const next = !s.globalProperties.chartShift; s.updateGlobalProperty('chartShift', next); window.dispatchEvent(new CustomEvent('rtx:chartShift', { detail: { enabled: next } })); setActiveMenu(null); } },
            { label: t('menu.charts.volumes'), shortcut: 'Ctrl+K', icon: <Icon name="bar-chart-3" size="sm" />, action: () => { const s = useChartSettingsStore.getState(); const current = selectedSymbol ? (s.symbolProperties[selectedSymbol] || s.globalProperties) : s.globalProperties; setVolumeBarsVisible(!(current.showTickVolumes || current.showRealVolumes), selectedSymbol); setActiveMenu(null); } },
            { divider: true, label: '' },
            { label: t('menu.charts.zoomIn'), shortcut: '+', action: () => { commandBus.dispatch({ type: 'ZOOM_IN', payload: {} }); setActiveMenu(null); } },
            { label: t('menu.charts.zoomOut'), shortcut: '-', action: () => { commandBus.dispatch({ type: 'ZOOM_OUT', payload: {} }); setActiveMenu(null); } },
            { divider: true, label: '' },
            { label: t('menu.charts.properties'), shortcut: 'F8', icon: <Icon name="settings" size="sm" />, action: () => { window.dispatchEvent(new CustomEvent('openChartProperties')); setActiveMenu(null); } }
        ],
        Tools: [
            // Primary Trading
            {
                label: t('menu.tools.newOrder'), shortcut: 'F9',
                icon: <Icon name="plus" size="sm" className="text-emerald-500" />,
                action: () => { window.dispatchEvent(new CustomEvent('openNewOrder')); setActiveMenu(null); }
            },
            { divider: true, label: '' },

            // Development & Automation (RTX5 Rebranded)
            {
                label: t('menu.tools.strategyTester'), shortcut: 'Ctrl+R',
                icon: <Icon name="activity" size="sm" />,
                action: () => { window.dispatchEvent(new CustomEvent('toolbox-action', { detail: { action: 'strategy-tester' } })); setActiveMenu(null); }
            },
            {
                label: t('menu.tools.scriptEditor'), shortcut: 'F4',
                icon: <Icon name="credit-card" size="sm" />,
                action: () => { window.dispatchEvent(new CustomEvent('toolbox-action', { detail: { action: 'script-editor' } })); setActiveMenu(null); }
            },
            {
                label: t('menu.tools.agentsManager'), shortcut: 'F6',
                icon: <Icon name="cpu" size="sm" />,
                action: () => { window.dispatchEvent(new CustomEvent('toolbox-action', { detail: { action: 'agents-manager' } })); setActiveMenu(null); }
            },
            { divider: true, label: '' },

            // System & Monitoring
            {
                label: t('menu.tools.taskManager'), shortcut: 'F2',
                icon: <Icon name="server" size="sm" />,
                action: () => { window.dispatchEvent(new CustomEvent('toolbox-action', { detail: { action: 'task-manager' } })); setActiveMenu(null); }
            },
            {
                label: t('menu.tools.globalVariables'), shortcut: 'F3',
                icon: <Icon name="globe" size="sm" />,
                action: () => { window.dispatchEvent(new CustomEvent('toolbox-action', { detail: { action: 'global-variables' } })); setActiveMenu(null); }
            },
            { divider: true, label: '' },

            // RTX5 Services
            { label: t('menu.tools.marketplace'), icon: <Icon name="box" size="sm" className="text-blue-400" /> },
            { label: t('menu.tools.signalsHub'), icon: <Icon name="activity" size="sm" className="text-emerald-400" /> },
            { label: t('menu.tools.cloudHosting'), icon: <Icon name="shield" size="sm" className="text-purple-400" /> },
            { divider: true, label: '' },

            // Settings
            { label: t('menu.tools.options'), shortcut: 'Ctrl+O', icon: <Icon name="settings" size="sm" />, action: () => setIsOptionsOpen(true) }
        ],

        Window: [
            { label: t('menu.window.tileWindows'), shortcut: 'Alt+R', icon: <Icon name="grid" size="sm" />, action: () => { window.dispatchEvent(new CustomEvent('tileWindows')); setActiveMenu(null); } },
            { label: t('menu.window.cascade'), icon: <Icon name="layers" size="sm" /> },
            { label: t('menu.window.tileHorizontally'), icon: <Icon name="layout" size="sm" /> },
            { label: t('menu.window.tileVertically'), icon: <Icon name="layout" size="sm" /> },
            { label: t('menu.window.arrangeIcons'), icon: <Icon name="grid" size="sm" /> },
            { divider: true, label: '' },
            { label: 'Reset Windows', shortcut: 'Ctrl+Shift+R', icon: <Icon name="refresh" size="sm" className="text-emerald-500" />, action: () => { window.dispatchEvent(new CustomEvent('resetLayout')); setActiveMenu(null); } },
            { divider: true, label: '' },
            {
                label: t('menu.window.resolution'),
                icon: <Icon name="monitor" size="sm" />,
                children: [
                    { label: '2160p', shortcut: '3840x2160' },
                    { label: '1440p', shortcut: '2560x1440' },
                    { label: '1080p', shortcut: '1920x1080' },
                    { label: '720p', shortcut: '1280x720' },
                    { label: '480p', shortcut: '854x480' },
                    { label: '360p', shortcut: '640x360' }
                ]
            }
        ],
        Help: [
            { label: t('menu.help.helpTopics'), shortcut: 'F1', icon: <Icon name="help-circle" size="sm" /> },
            { label: t('menu.help.whatsNew'), icon: <Icon name="zap" size="sm" className="text-yellow-400" /> },
            { label: t('menu.help.telegramChannel'), icon: <Icon name="arrow-right" size="sm" className="text-blue-400" /> },
            { label: t('menu.help.videoGuides'), icon: <Icon name="play" size="sm" />, children: [{ label: 'Getting Started' }, { label: 'Trading' }, { label: 'Analysis' }] },
            { divider: true, label: '' },
            { label: t('menu.help.webTrader'), icon: <Icon name="globe" size="sm" /> },
            { label: t('menu.help.documentation'), icon: <Icon name="book-open" size="sm" /> },
            { label: t('menu.help.algoBook'), icon: <Icon name="book-open" size="sm" className="text-amber-400" /> },
            { label: t('menu.help.neuroBook'), icon: <Icon name="cpu" size="sm" className="text-purple-400" /> },
            { label: t('menu.help.articles'), icon: <Icon name="file-text" size="sm" /> },
            { label: t('menu.help.codeBase'), icon: <Icon name="code" size="sm" /> },
            { label: t('menu.help.jobs'), icon: <Icon name="briefcase" size="sm" /> },
            { label: t('menu.help.marketplace'), icon: <Icon name="box" size="sm" className="text-blue-400" /> },
            { label: t('menu.help.signals'), icon: <Icon name="signal" size="sm" className="text-emerald-400" /> },
            { label: t('menu.help.quotes'), icon: <Icon name="trending-up" size="sm" /> },
            { label: t('menu.help.forum'), icon: <Icon name="callout" size="sm" /> },
            { label: t('menu.help.cloudHosting'), icon: <Icon name="globe" size="sm" className="text-zinc-400" /> },
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

    useEffect(() => {
        if (!isMenuOpen) return;
        const frame = window.requestAnimationFrame(() => {
            menuPopupRef.current?.querySelector<HTMLButtonElement>('[data-root-menu-item="true"]')?.focus();
        });
        return () => window.cancelAnimationFrame(frame);
    }, [isMenuOpen]);

    return (
        <>
            <div
                ref={menuRef}
                className="rtx-menu-launcher flex h-[40px] shrink-0 items-center"
                style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
            >
                <button
                    ref={menuButtonRef}
                    type="button"
                    aria-label="Open application menu"
                    aria-haspopup="menu"
                    aria-expanded={isMenuOpen}
                    title="Application menu"
                    onClick={() => {
                        if (isMenuOpen) {
                            closeMenu();
                        } else {
                            setActiveMenu(null);
                            setIsMenuOpen(true);
                        }
                    }}
                    className={`flex h-[36px] w-[40px] items-center justify-center border border-transparent text-zinc-300 transition-colors outline-none hover:bg-[#252932] hover:text-white focus-visible:border-blue-400 [.rtx-advanced-view_&]:text-[#344054] [.rtx-advanced-view_&]:hover:bg-[#f3f4f6] [.rtx-advanced-view_&]:hover:text-[#101828] ${isMenuOpen ? 'bg-[#252932] text-white [.rtx-advanced-view_&]:bg-[#f3f4f6] [.rtx-advanced-view_&]:text-[#101828]' : ''}`}
                >
                    <MenuIcon size={23} strokeWidth={1.8} aria-hidden="true" />
                </button>
            </div>

            {isMenuOpen && ReactDOM.createPortal(
                <div
                    ref={menuPopupRef}
                    className="rtx-application-menu fixed z-[9999] w-[200px] border border-[#3a414f] bg-[#202733] py-1 font-segoe text-[14px] font-normal text-zinc-200 shadow-2xl [.rtx-advanced-view_&]:border-[#d0d5dd] [.rtx-advanced-view_&]:bg-white [.rtx-advanced-view_&]:text-[#344054]"
                    style={{ top: menuPosition.top, left: menuPosition.left }}
                    role="menu"
                    aria-label="Application menu"
                    onKeyDown={(event) => {
                        const target = event.target as HTMLElement;
                        if (target.dataset.rootMenuItem !== 'true') return;
                        const rootItems = Array.from(menuPopupRef.current?.querySelectorAll<HTMLButtonElement>('[data-root-menu-item="true"]') ?? []);
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
                            if (!key) return;
                            event.preventDefault();
                            setActiveMenu(key);
                            window.requestAnimationFrame(() => {
                                menuPopupRef.current
                                    ?.querySelector<HTMLDivElement>(`[aria-label="${key} menu"]`)
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
                    {Object.keys(menuItems).map((key, rootIndex) => (
                        <div key={key} className="relative px-1">
                            <button
                                type="button"
                                role="menuitem"
                                data-root-menu-item="true"
                                data-menu-key={key}
                                aria-haspopup="menu"
                                aria-expanded={activeMenu === key}
                                onClick={() => setActiveMenu(activeMenu === key ? null : key)}
                                className={`flex min-h-[34px] w-full items-center gap-3 px-3 py-1.5 text-left transition-colors outline-none ${activeMenu === key
                                    ? 'bg-[#344154] text-white [.rtx-advanced-view_&]:bg-[#f3f4f6] [.rtx-advanced-view_&]:text-[#101828]'
                                    : 'text-zinc-200 hover:bg-[#2c3544] hover:text-white focus-visible:bg-[#2c3544] [.rtx-advanced-view_&]:text-[#344054] [.rtx-advanced-view_&]:hover:bg-[#f3f4f6] [.rtx-advanced-view_&]:hover:text-[#101828] [.rtx-advanced-view_&]:focus-visible:bg-[#f3f4f6]'}`}
                            >
                                <span className="flex-1">{key}</span>
                                <Icon name="chevron-right" size="xs" className="text-zinc-400 [.rtx-advanced-view_&]:text-[#667085]" />
                            </button>

                            {activeMenu === key && (
                                <div
                                    className="absolute left-full ml-px z-[10000]"
                                    style={{ top: -rootIndex * 34 }}
                                    role="menu"
                                    aria-label={`${key} menu`}
                                >
                                    {key === 'File' ? (
                                        <FileMenu
                                            accountId={accountId}
                                            onDialogOpenChange={setIsFileDialogOpen}
                                            onLogout={onLogout ? () => {
                                                onLogout();
                                                closeMenu();
                                            } : undefined}
                                            onSave={() => {
                                                console.log('[MenuBar] Save workspace triggered');
                                                window.dispatchEvent(new CustomEvent('saveWorkspace'));
                                                closeMenu();
                                            }}
                                            onSaveAsPicture={() => {
                                                console.log('Save as picture');
                                            }}
                                            onOpenDataFolder={() => {
                                                console.log('[MenuBar] Open data folder triggered');
                                                window.dispatchEvent(new CustomEvent('openDataFolder'));
                                                closeMenu();
                                            }}
                                            onPrint={() => {
                                                console.log('[MenuBar] Print triggered');
                                                window.dispatchEvent(new CustomEvent('printChart'));
                                                closeMenu();
                                            }}
                                            onPrintPreview={() => {
                                                console.log('Print preview');
                                            }}
                                            onPrintSetup={() => {
                                                console.log('Print setup');
                                            }}
                                            onExit={() => {
                                                console.log('Exit');
                                                closeMenu();
                                            }}
                                            hasUnsavedChanges={false}
                                        />
                                    ) : (
                                        <div className="min-w-[240px] border border-[#3a414f] bg-[#18181b] py-1 shadow-2xl [.rtx-advanced-view_&]:border-[#e5e7eb] [.rtx-advanced-view_&]:bg-white">
                                            <MenuList items={menuItems[key]} onClose={closeMenu} />
                                        </div>
                                    )}
                                </div>
                            )}
                        </div>
                    ))}
                </div>,
                document.body,
            )}

            {/* Options Dialog Modal */}
            <OptionsDialog isOpen={isOptionsOpen} onClose={() => setIsOptionsOpen(false)} />

            {/* Symbols Dialog */}
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
    const submenuRef = useRef<HTMLDivElement>(null);

    if (item.divider) {
        return <div className="h-[1px] bg-zinc-700/50 [.rtx-advanced-view_&]:bg-gray-200 my-1 mx-2"></div>;
    }

    return (
        <div className="relative px-1">
            <button
                type="button"
                disabled={item.disabled}
                aria-label={item.label}
                role={item.checkRole === 'radio' ? 'menuitemradio' : item.checkRole === 'checkbox' ? 'menuitemcheckbox' : 'menuitem'}
                aria-checked={item.checkRole ? Boolean(item.checked) : undefined}
                aria-haspopup={item.children ? 'menu' : undefined}
                aria-expanded={item.children ? isSubmenuOpen : undefined}
                onClick={() => {
                    if (item.children) {
                        onToggleSubmenu(!isSubmenuOpen);
                        return;
                    }
                    if (item.action) {
                        item.action();
                        onClose?.();
                    }
                }}
                className={`w-full flex items-center gap-3 px-2 py-1.5 text-[14px] font-normal text-left border border-transparent rounded-[2px] transition-colors
                    ${item.disabled ? 'text-zinc-600 [.rtx-advanced-view_&]:text-gray-400 cursor-not-allowed' : 'text-zinc-300 [.rtx-advanced-view_&]:text-[#374151] hover:bg-[#2a2e39] [.rtx-advanced-view_&]:hover:bg-[#f3f4f6] hover:text-white [.rtx-advanced-view_&]:hover:text-[#111827] cursor-default group'}`}
            >
                {/* Icon Area */}
                <div className="flex h-4 w-4 shrink-0 items-center justify-center leading-none text-zinc-400 [.rtx-advanced-view_&]:text-gray-500 group-hover:text-zinc-200 [.rtx-advanced-view_&]:group-hover:text-gray-700 [&_svg]:block [&_svg]:shrink-0">
                    {item.icon}
                </div>

                {/* Label */}
                <span className="flex-1 font-segoe">{item.label}</span>

                {/* Shortcut or Submenu Arrow */}
                {item.children ? (
                    <Icon name="chevron-right" size="xs" className="text-zinc-500 [.rtx-advanced-view_&]:text-gray-400 group-hover:text-white [.rtx-advanced-view_&]:group-hover:text-gray-700" />
                ) : (
                    <span className="flex items-center gap-2">
                        {item.shortcut && <span className="text-[12px] font-normal text-zinc-500 [.rtx-advanced-view_&]:text-gray-400 font-segoe pl-4">{item.shortcut}</span>}
                        {item.checkRole && (
                            item.checked
                                ? <Icon name="check-circle" size="xs" className="text-blue-400 [.rtx-advanced-view_&]:text-[#6941C6]" />
                                : <span className="h-3.5 w-3.5" aria-hidden="true" />
                        )}
                    </span>
                )}
            </button>

            {/* Nested sections are click-driven and sibling-exclusive. */}
            {item.children && isSubmenuOpen && (
                <div ref={submenuRef} role="menu" aria-label={`${item.label} menu`} className={`absolute left-full top-0 ml-[-2px] mt-0 min-w-[180px] bg-[#18181b] [.rtx-advanced-view_&]:bg-white border border-[#2a2e39] [.rtx-advanced-view_&]:border-[#e5e7eb] shadow-2xl py-1 z-[101]
                    ${item.scrollableChildren ? 'max-h-[400px] overflow-y-auto no-scrollbar' : ''}
                 `}>
                    <MenuList items={item.children} onClose={onClose} />
                </div>
            )}
        </div>
    );
};
