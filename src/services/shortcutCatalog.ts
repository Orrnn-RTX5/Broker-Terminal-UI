import { keyboardShortcutManager, type ShortcutDefinition } from './keyboardShortcutManager';
import { commandBus } from './commandBus';
import { getActiveChartSource } from './activeChartSource';
import { getPanelIdFromChartContextId } from './chartCommandTarget';
import { useAppStore } from '../store/useAppStore';
import { useDockLayoutStore } from '../store/useDockLayoutStore';
import { useDrawingSidebarStore } from '../store/useDrawingSidebarStore';
import { openBottomDockTab } from './bottomDockNavigation';
import { resetWorkspaceLayout } from './resetLayout';
import { useChartSettingsStore, type ChartProperties } from '../store/useChartSettingsStore';

export type ShortcutHelpEntry = Pick<ShortcutDefinition,
  'id' | 'key' | 'ctrl' | 'shift' | 'alt' | 'meta' | 'description' | 'category' | 'enabled'
> & { scope?: string; displayKeys?: string[] };

// One source for executable keyboard bindings and the hints displayed in menus.
// Browser-reserved combinations (Ctrl+N/T/W) have usable web alternatives.
export const TERMINAL_SHORTCUTS: ShortcutHelpEntry[] = [
  { id: 'tools.new-order', key: 'F9', description: 'New Order', category: 'Trading' },
  { id: 'view.depth-of-market', key: 'b', alt: true, description: 'Depth of Market', category: 'Trading' },
  { id: 'trading.toggle-one-click', key: 't', alt: true, shift: true, description: 'One Click Trading', category: 'Trading' },
  { id: 'trading.order-history', key: 'o', alt: true, shift: true, description: 'Order History', category: 'Trading' },
  { id: 'view.market-watch', key: 'm', ctrl: true, description: 'Market Watch', category: 'View' },
  { id: 'view.data-window', key: 'd', ctrl: true, description: 'Data Window', category: 'View' },
  { id: 'view.navigator', key: 'n', alt: true, shift: true, description: 'Navigator', category: 'View' },
  { id: 'view.terminal', key: 'w', alt: true, shift: true, description: 'Terminal', category: 'View' },
  { id: 'view.toolbox', key: 'u', alt: true, shift: true, description: 'Toolbox', category: 'View' },
  { id: 'view.symbols', key: 'u', alt: true, description: 'Search Symbols', category: 'View' },
  { id: 'view.drawing-tools', key: 'd', alt: true, shift: true, description: 'Drawing tools', category: 'View' },
  { id: 'drawing.emojis', key: 'e', alt: true, description: 'Emojis', category: 'Drawing tools' },
  { id: 'drawing.stamps', key: 'g', alt: true, shift: true, description: 'Icons and Stamps', category: 'Drawing tools' },
  { id: 'charts.bar-chart', key: '1', alt: true, description: 'Bar Chart', category: 'Charts' },
  { id: 'charts.candlestick', key: '2', alt: true, description: 'Candlesticks', category: 'Charts' },
  { id: 'charts.line-chart', key: '3', alt: true, description: 'Line Chart', category: 'Charts' },
  { id: 'charts.area-chart', key: '0', alt: true, description: 'Area Chart', category: 'Charts' },
  { id: 'charts.indicator-list', key: 'i', ctrl: true, description: 'Indicator List', category: 'Charts' },
  { id: 'charts.object-list', key: 'b', ctrl: true, description: 'Object List', category: 'Charts' },
  { id: 'charts.period-separators', key: 'p', alt: true, shift: true, description: 'Show period separators', category: 'Charts' },
  { id: 'charts.trade-history', key: 'i', alt: true, shift: true, description: 'Show trade history', category: 'Charts' },
  { id: 'charts.ohlc', key: 'l', alt: true, shift: true, description: 'Show OHLC', category: 'Charts' },
  { id: 'charts.auto-scroll', key: 'a', alt: true, shift: true, description: 'Auto Scroll', category: 'Charts' },
  { id: 'charts.chart-shift', key: 'f', alt: true, shift: true, description: 'Chart Shift', category: 'Charts' },
  { id: 'timeframe.d1', key: '4', alt: true, shift: true, description: 'D1', category: 'Timeframes' },
  { id: 'timeframe.w1', key: '5', alt: true, shift: true, description: 'W1', category: 'Timeframes' },
  { id: 'timeframe.mn', key: '6', alt: true, shift: true, description: 'MN', category: 'Timeframes' },
  { id: 'tools.history-center', key: 'F2', description: 'History Center', category: 'Tools' },
  { id: 'tools.options', key: 'o', ctrl: true, description: 'Options', category: 'Tools' },
  { id: 'window.tile', key: 'r', alt: true, description: 'Tile Windows', category: 'Window' },
  { id: 'window.add-chart', key: 'n', ctrl: true, alt: true, description: 'Add chart', category: 'Window' },
  { id: 'window.cascade', key: 'c', alt: true, shift: true, description: 'Cascade', category: 'Window' },
  { id: 'window.tile-horizontal', key: 'h', alt: true, shift: true, description: 'Tile Horizontally', category: 'Window' },
  { id: 'window.tile-vertical', key: 'v', alt: true, shift: true, description: 'Tile Vertically', category: 'Window' },
  { id: 'window.arrange-icons', key: 'm', alt: true, shift: true, description: 'Arrange Icons', category: 'Window', scope: 'When floating windows are minimized' },
  { id: 'window.undo', key: 'z', alt: true, shift: true, description: 'Undo layout', category: 'Window' },
  { id: 'window.redo', key: 'y', alt: true, shift: true, description: 'Redo layout', category: 'Window' },
  { id: 'window.reset', key: 'r', alt: true, shift: true, description: 'Reset Windows', category: 'Window' },
  { id: 'file.close-chart', key: 'q', alt: true, shift: true, description: 'Close active chart', category: 'File' },
  { id: 'file.print-preview', key: 'p', ctrl: true, shift: true, description: 'Print Preview', category: 'File' },
  { id: 'file.save-picture', key: 's', ctrl: true, shift: true, description: 'Save as Picture', category: 'File' },
  { id: 'help.shortcuts', key: 'F1', description: 'Keyboard Shortcuts', category: 'Help' },
];

export const getTerminalShortcutHint = (id: string): string => {
  const shortcut = TERMINAL_SHORTCUTS.find(entry => entry.id === id);
  return shortcut ? keyboardShortcutManager.formatShortcut(shortcut as ShortcutDefinition) : '';
};

export const runTerminalShortcutAction = (id: string): void => {
  const source = getActiveChartSource();
  const target = {
    symbol: source?.symbol || useAppStore.getState().selectedSymbol,
    timeframe: source?.timeframe,
    targetContextId: source?.id,
  };
  const emit = (event: string, detail?: unknown) => window.dispatchEvent(new CustomEvent(event, { detail }));
  const toggleChartProperty = (key: keyof Pick<ChartProperties, 'showPeriodSeparators' | 'showTradeHistory' | 'showOHLC' | 'chartAutoScroll' | 'chartShift'>) => {
    const state = useChartSettingsStore.getState();
    const current = state.symbolProperties[target.symbol] || state.globalProperties;
    const enabled = !current[key];
    state.updateSymbolProperty(target.symbol, key, enabled);
    return enabled;
  };
  const panel = { 'view.market-watch': 'MarketWatch', 'view.navigator': 'Navigator', 'view.terminal': 'Terminal' }[id];
  if (panel) { emit('togglePanel', panel); return; }
  const chartType = { 'charts.bar-chart': 'bar', 'charts.candlestick': 'candlestick', 'charts.line-chart': 'line', 'charts.area-chart': 'area' }[id];
  if (chartType) {
    commandBus.dispatch({ type: 'SET_CHART_TYPE', payload: { chartType: chartType as 'bar' | 'candlestick' | 'line' | 'area', targetContextId: target.targetContextId } });
    return;
  }
  switch (id) {
    case 'tools.new-order': emit('openNewOrder'); break;
    case 'view.depth-of-market': emit('openDepthOfMarket', target); break;
    case 'trading.toggle-one-click': emit('toggle-one-click-trading'); break;
    case 'trading.order-history': openBottomDockTab('History'); break;
    case 'view.toolbox': openBottomDockTab('Toolbox'); break;
    case 'tools.history-center': openBottomDockTab('Historical Data'); break;
    case 'view.data-window': emit('openDataWindow'); break;
    case 'view.symbols': emit('openSymbolsDialog'); break;
    case 'view.drawing-tools': useDrawingSidebarStore.getState().toggle(); break;
    case 'drawing.emojis': useDrawingSidebarStore.getState().openMenu('emojis'); break;
    case 'drawing.stamps': useDrawingSidebarStore.getState().openMenu('stamps'); break;
    case 'charts.indicator-list': commandBus.dispatch({ type: 'OPEN_INDICATOR_LIST', payload: { targetContextId: target.targetContextId } }); break;
    case 'charts.object-list': emit('open-object-list', target); break;
    case 'charts.period-separators': toggleChartProperty('showPeriodSeparators'); break;
    case 'charts.trade-history': toggleChartProperty('showTradeHistory'); emit('rtx:flush-trade-overlay'); break;
    case 'charts.ohlc': toggleChartProperty('showOHLC'); break;
    case 'charts.auto-scroll': commandBus.dispatch({ type: 'SET_AUTO_SCROLL', payload: { enabled: toggleChartProperty('chartAutoScroll'), targetContextId: target.targetContextId } }); break;
    case 'charts.chart-shift': commandBus.dispatch({ type: 'SET_CHART_SHIFT', payload: { enabled: toggleChartProperty('chartShift'), targetContextId: target.targetContextId } }); break;
    case 'timeframe.d1': case 'timeframe.w1': case 'timeframe.mn':
      commandBus.dispatch({ type: 'SET_TIMEFRAME', payload: { timeframe: id.slice('timeframe.'.length).toUpperCase(), targetContextId: target.targetContextId, panelId: getPanelIdFromChartContextId(target.targetContextId) } }); break;
    case 'tools.options': emit('open-terminal-options'); break;
    case 'window.tile': useDockLayoutStore.getState().arrangeCharts('grid'); break;
    case 'window.add-chart': emit('add-chart-panel'); break;
    case 'window.cascade': useDockLayoutStore.getState().arrangeCharts('cascade'); break;
    case 'window.tile-horizontal': useDockLayoutStore.getState().arrangeCharts('horizontal'); break;
    case 'window.tile-vertical': useDockLayoutStore.getState().arrangeCharts('vertical'); break;
    case 'window.arrange-icons': useDockLayoutStore.getState().arrangeIcons(); break;
    case 'window.undo': useDockLayoutStore.getState().undo(); break;
    case 'window.redo': useDockLayoutStore.getState().redo(); break;
    case 'window.reset': resetWorkspaceLayout(); break;
    case 'file.close-chart': emit('close-active-chart'); break;
    case 'file.print-preview': emit('open-print-preview'); break;
    case 'file.save-picture': emit('open-save-picture'); break;
    case 'help.shortcuts': emit('open-shortcut-help'); break;
  }
};

// Gestures and locally scoped interactions cannot be global key registrations.
// Their scope is displayed so a chart gesture is never mistaken for a global action.
const LOCAL_SHORTCUTS: ShortcutHelpEntry[] = [
  { id: 'local.print-preview', key: 'p', ctrl: true, description: 'Print', category: 'File', scope: 'In Print Preview' },
  { id: 'local.print-preview', key: 'p', meta: true, description: 'Print', category: 'File', scope: 'In Print Preview' },
  { id: 'local.measure', key: 'Shift', displayKeys: ['Shift', 'Drag'], description: 'Measure', category: 'Charts', scope: 'On the chart' },
  { id: 'local.finish-drawing', key: 'Enter', description: 'Finish drawing', category: 'Drawing tools', scope: 'While drawing a path or ghost feed' },
  { id: 'local.save-annotation', key: 'Enter', ctrl: true, description: 'Save annotation', category: 'Drawing tools', scope: 'While editing an annotation' },
  { id: 'local.save-annotation', key: 'Enter', meta: true, description: 'Save annotation', category: 'Drawing tools', scope: 'While editing an annotation' },
  { id: 'local.save-table-cell', key: 'Enter', description: 'Save cell', category: 'Drawing tools', scope: 'While editing a table cell' },
  { id: 'local.next-table-cell', key: 'Tab', description: 'Save and move to next cell', category: 'Drawing tools', scope: 'While editing a table cell' },
  { id: 'local.previous-table-cell', key: 'Tab', shift: true, description: 'Save and move to previous cell', category: 'Drawing tools', scope: 'While editing a table cell' },
  { id: 'local.quick-buy', key: 'b', shift: true, description: 'Buy', category: 'Trading', scope: 'While Last Symbol is open' },
  { id: 'local.quick-sell', key: 's', shift: true, description: 'Sell', category: 'Trading', scope: 'While Last Symbol is open' },
  { id: 'local.quick-close', key: 'x', shift: true, description: 'Close positions', category: 'Trading', scope: 'While Last Symbol is open' },
];

export const getShortcutHelpEntries = (registered: ShortcutDefinition[]): ShortcutHelpEntry[] => {
  const entries = registered.map((shortcut): ShortcutHelpEntry => {
    const metadata = TERMINAL_SHORTCUTS.find(entry => entry.id === shortcut.id);
    if (shortcut.id.startsWith('timeframe.')) return { ...shortcut, description: shortcut.id.slice(10).toUpperCase(), category: 'Timeframes' };
    return { ...shortcut, description: metadata?.description || shortcut.description, category: metadata?.category || shortcut.category,
      ...(metadata?.scope ? { scope: metadata.scope } : {}) };
  });
  const seen = new Set<string>();
  return [...entries, ...LOCAL_SHORTCUTS].filter(entry => {
    const key = `${entry.id}:${keyboardShortcutManager.formatShortcut(entry as ShortcutDefinition)}:${entry.scope || ''}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
};
