import React, { useState, useEffect, useRef } from 'react';
import { Icon } from '../ui/Icon';
import { OptionsDialog } from '../settings/OptionsDialog';
import { FileMenu } from './FileMenu';
import { useTranslation } from 'react-i18next';
import { useTheme } from '../../contexts/ThemeContext';
import { SymbolsDialog } from '../SymbolsDialog';
import { commandBus } from '../../services/commandBus';
import { useChartSettingsStore } from '../../store/useChartSettingsStore';
import { drawingManager } from '../../services/drawingManager';
import { useAppStore } from '../../store/useAppStore';

// Local interface definition to avoid export issues
interface MenuItem {
    label: string;
    shortcut?: string;
    icon?: React.ReactNode;
    children?: MenuItem[];
    divider?: boolean;
    disabled?: boolean;
    action?: () => void;
    scrollableChildren?: boolean;
}

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

export const MenuBar = () => {
    const { t, i18n } = useTranslation();
    const { theme, setTheme } = useTheme();
    const [activeMenu, setActiveMenu] = useState<string | null>(null);
    const [isOptionsOpen, setIsOptionsOpen] = useState(false);
    const [isSymbolsOpen, setIsSymbolsOpen] = useState(false);
    const menuRef = useRef<HTMLDivElement>(null);

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

    // Close menu when clicking outside
    useEffect(() => {
        const handleClickOutside = (event: MouseEvent) => {
            if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
                setActiveMenu(null);
            }
        };
        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, []);

    // Dynamic Symbol Loading
    const [availableSymbols, setAvailableSymbols] = useState<any[]>([]);
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
                                            action: () => window.dispatchEvent(new CustomEvent('openChart', { detail: { symbol: sym.symbol } }))
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
            { label: t('menu.view.languages'), children: languageList, scrollableChildren: true },

            { divider: true, label: '' },
            { label: t('menu.view.toolbars'), children: [{ label: 'Standard', icon: <Icon name="box" size="xs" /> }, { label: 'Line Studies' }, { label: 'Timeframes' }] },
            { label: t('menu.view.statusBar'), icon: <Icon name="layout" size="sm" /> },
            { label: t('menu.view.chartsBar'), icon: <Icon name="layers" size="sm" /> },
            { divider: true, label: '' },
            { label: t('menu.view.symbols'), shortcut: 'Alt+U', action: () => { setIsSymbolsOpen(true); setActiveMenu(null); } },
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
                label: t('menu.charts.objects'),
                children: [
                    // Management
                    { label: 'Object List', shortcut: 'Ctrl+B', icon: <Icon name="layout-list" size="sm" /> },
                    { divider: true, label: '' },

                    // Destructive Actions (Muted Red)
                    { label: 'Delete Last', shortcut: 'Backspace', icon: <Icon name="x-close" size="sm" className="text-rose-400" />, action: () => { commandBus.dispatch({ type: 'UNDO', payload: {} }); setActiveMenu(null); } },
                    { label: 'Delete All Selected', shortcut: 'Del', icon: <Icon name="trash" size="sm" className="text-rose-400" />, action: () => { commandBus.dispatch({ type: 'DELETE_SELECTED_DRAWING', payload: {} }); setActiveMenu(null); } },
                    { label: 'Delete All Arrows', icon: <Icon name="minus" size="sm" className="text-rose-400" /> },
                    { label: 'Delete All', icon: <Icon name="trash" size="sm" className="text-rose-500" />, action: () => { drawingManager.clearAllDrawings(); setActiveMenu(null); } },
                    { divider: true, label: '' },

                    // Selection / Undo
                    { label: 'Unselect All', icon: <Icon name="cursor" size="sm" /> },
                    { label: 'Undo Delete', shortcut: 'Ctrl+Z', icon: <Icon name="refresh" size="sm" />, action: () => { commandBus.dispatch({ type: 'UNDO', payload: {} }); setActiveMenu(null); } }
                ]
            },
            { divider: true, label: '' },
            { label: t('menu.charts.barChart'), shortcut: 'Alt+1', icon: <Icon name="bar-chart" size="sm" />, action: () => { commandBus.dispatch({ type: 'SET_CHART_TYPE', payload: { chartType: 'bar' } }); setActiveMenu(null); } },
            { label: t('menu.charts.candlesticks'), shortcut: 'Alt+2', icon: <Icon name="candlestick" size="sm" />, action: () => { commandBus.dispatch({ type: 'SET_CHART_TYPE', payload: { chartType: 'candlestick' } }); setActiveMenu(null); } },
            { label: t('menu.charts.lineChart'), shortcut: 'Alt+3', icon: <Icon name="line-chart" size="sm" />, action: () => { commandBus.dispatch({ type: 'SET_CHART_TYPE', payload: { chartType: 'area' } }); setActiveMenu(null); } },
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

    return (
        <>
            <div className="h-6 bg-[#131316] [.rtx-advanced-view_&]:bg-[var(--bg-secondary)] border-b border-[#2a2e39] [.rtx-advanced-view_&]:border-[#e5e7eb] flex items-center px-1 select-none z-50 relative font-segoe" ref={menuRef}>
                {Object.keys(menuItems).map((key) => (
                    <div key={key} className="relative">
                        <button
                            onClick={() => setActiveMenu(activeMenu === key ? null : key)}
                            onMouseEnter={() => activeMenu && setActiveMenu(key)}
                            className={`px-3 py-0.5 text-[14px] font-normal rounded-sm transition-colors cursor-default outline-none flex items-center border border-transparent
                                ${activeMenu === key
                                    ? 'bg-[#2a2e39] [.rtx-advanced-view_&]:bg-[#f3f4f6] text-white [.rtx-advanced-view_&]:text-[#111827] shadow-[inset_0_1px_2px_rgba(0,0,0,0.2)] [.rtx-advanced-view_&]:shadow-sm'
                                    : 'text-zinc-300 [.rtx-advanced-view_&]:text-[#4b5563] hover:bg-white/5 [.rtx-advanced-view_&]:hover:bg-[#f3f4f6] hover:text-white [.rtx-advanced-view_&]:hover:text-[#111827]'}`}
                        >
                            {key}
                        </button>

                        {/* Dropdown */}
                        {activeMenu === key && (
                            <div className="absolute top-full left-0 mt-0 z-[100]">
                                {key === 'File' ? (
                                    <FileMenu
                                        onSave={() => {
                                            console.log('[MenuBar] Save workspace triggered');
                                            // Dispatch custom event for save workspace
                                            window.dispatchEvent(new CustomEvent('saveWorkspace'));
                                            setActiveMenu(null);
                                        }}
                                        onSaveAsPicture={() => {
                                            console.log('Save as picture');
                                            setActiveMenu(null);
                                        }}
                                        onOpenDataFolder={() => {
                                            console.log('[MenuBar] Open data folder triggered');
                                            window.dispatchEvent(new CustomEvent('openDataFolder'));
                                            setActiveMenu(null);
                                        }}
                                        onPrint={() => {
                                            console.log('[MenuBar] Print triggered');
                                            window.dispatchEvent(new CustomEvent('printChart'));
                                            setActiveMenu(null);
                                        }}
                                        onPrintPreview={() => {
                                            console.log('Print preview');
                                            setActiveMenu(null);
                                        }}
                                        onPrintSetup={() => {
                                            console.log('Print setup');
                                            setActiveMenu(null);
                                        }}
                                        onExit={() => {
                                            console.log('Exit');
                                            setActiveMenu(null);
                                        }}
                                        hasUnsavedChanges={false}
                                    />
                                ) : (
                                    <div className="min-w-[240px] bg-[#18181b] [.rtx-advanced-view_&]:bg-white border border-[#2a2e39] [.rtx-advanced-view_&]:border-[#e5e7eb] shadow-2xl py-1">
                                        {menuItems[key].map((item, index) => (
                                            <MenuItem
                                                key={index}
                                                item={item}
                                                onClose={() => setActiveMenu(null)}
                                            />
                                        ))}
                                    </div>
                                )}
                            </div>
                        )}
                    </div>
                ))}
            </div>

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

const MenuItem = ({ item, onClose }: { item: MenuItem; onClose?: () => void }) => {
    if (item.divider) {
        return <div className="h-[1px] bg-zinc-700/50 [.rtx-advanced-view_&]:bg-gray-200 my-1 mx-2"></div>;
    }

    return (
        <div className="relative group px-1 [&:hover>div]:block">
            <button
                disabled={item.disabled}
                onClick={() => {
                    if (item.action) {
                        item.action();
                        onClose?.();
                    }
                }}
                className={`w-full flex items-center gap-3 px-2 py-1.5 text-[14px] font-normal text-left border border-transparent rounded-[2px] transition-colors
                    ${item.disabled ? 'text-zinc-600 [.rtx-advanced-view_&]:text-gray-400 cursor-not-allowed' : 'text-zinc-300 [.rtx-advanced-view_&]:text-[#374151] hover:bg-[#2a2e39] [.rtx-advanced-view_&]:hover:bg-[#f3f4f6] group-hover:bg-[#2a2e39] [.rtx-advanced-view_&]:group-hover:bg-[#f3f4f6] hover:text-white [.rtx-advanced-view_&]:hover:text-[#111827] group-hover:text-white [.rtx-advanced-view_&]:group-hover:text-[#111827] cursor-default group'}`}
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
                    item.shortcut && <span className="text-[12px] font-normal text-zinc-500 [.rtx-advanced-view_&]:text-gray-400 font-segoe pl-4">{item.shortcut}</span>
                )}
            </button>

            {/* Submenu Logic (Hover-based strict) */}
            {item.children && (
                <div className={`absolute left-full top-0 ml-[-2px] mt-0 hidden min-w-[180px] bg-[#18181b] [.rtx-advanced-view_&]:bg-white border border-[#2a2e39] [.rtx-advanced-view_&]:border-[#e5e7eb] shadow-2xl py-1 z-[101]
                    ${item.scrollableChildren ? 'max-h-[400px] overflow-y-auto no-scrollbar' : ''}
                 `}>
                    {item.children.map((subItem, idx) => (
                        <MenuItem
                            key={idx}
                            item={subItem}
                            onClose={onClose}
                        />
                    ))}
                </div>
            )}
        </div>
    );
};
