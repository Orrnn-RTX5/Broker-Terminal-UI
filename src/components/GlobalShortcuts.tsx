/**
 * Global Shortcuts Component
 * Registers all MT5-compatible global shortcuts
 */

import { useEffect, useState } from 'react';
import { useKeyboardShortcuts } from '../hooks/useKeyboardShortcut';
import { ShortcutFeedback } from './ShortcutFeedback';
import { ShortcutHelpDialog } from './ShortcutHelpDialog';
import { SHORTCUT_CATEGORIES, keyboardShortcutManager, isShortcutOverlay, type ShortcutDefinition } from '../services/keyboardShortcutManager';
import { TERMINAL_SHORTCUTS, runTerminalShortcutAction } from '../services/shortcutCatalog';
import { commandBus } from '../services/commandBus';
import { getActiveChartSource } from '../services/activeChartSource';
import { getPanelIdFromChartContextId } from '../services/chartCommandTarget';
import { useAppStore } from '../store/useAppStore';
import { useChartSettingsStore } from '../store/useChartSettingsStore';
import { resolveExactBrokerSymbolValue } from '../utils/exactBrokerSymbol';

interface GlobalShortcutsProps {
  onOpenOrderPanel: (symbol: string, price: { bid: number; ask: number }) => void;
  onQuickBuy: () => void;
  onQuickSell: (symbol?: string) => void;
  onSaveWorkspace: () => void;
  onOpenDataFolder: () => void;
  onPrintChart: () => void;
  onToggleFullScreen: () => void;
  onOpenDOM: (symbol: string) => void;
  selectedSymbol: string;
  isChartPropertiesOpen: boolean;
  isOrderPanelOpen: boolean;
}

const setVolumeBarsVisible = (visible: boolean, activeSymbol?: string) => {
  const store = useChartSettingsStore.getState();
  if (activeSymbol) {
    store.updateSymbolProperty(activeSymbol, 'showTickVolumes', visible);
    store.updateSymbolProperty(activeSymbol, 'showRealVolumes', false);
    return;
  }

  store.updateGlobalProperty('showTickVolumes', visible);
  store.updateGlobalProperty('showRealVolumes', false);
};

const setGridVisible = (visible: boolean, activeSymbol?: string) => {
  const store = useChartSettingsStore.getState();
  if (activeSymbol) {
    store.updateSymbolProperty(activeSymbol, 'showGrid', visible);
    return;
  }

  store.updateGlobalProperty('showGrid', visible);
};

const resolveActiveChartTarget = (fallbackSymbol: string) => {
  const source = getActiveChartSource();
  const sourceSymbol = source?.symbol?.trim();
  const sourceTimeframe = source?.timeframe?.trim();

  return {
    symbol: sourceSymbol || fallbackSymbol,
    timeframe: sourceTimeframe || undefined,
    targetContextId: source?.id,
  };
};

export function GlobalShortcuts({
  onOpenOrderPanel,
  onQuickBuy,
  onQuickSell,
  onSaveWorkspace,
  onOpenDataFolder,
  onPrintChart,
  onToggleFullScreen,
  onOpenDOM,
  selectedSymbol,
  isChartPropertiesOpen,
  isOrderPanelOpen
}: GlobalShortcutsProps) {
  const [feedbackText, setFeedbackText] = useState<string | null>(null);
  const [showHelpDialog, setShowHelpDialog] = useState(false);

  useEffect(() => {
    const openHelp = () => setShowHelpDialog(true);
    window.addEventListener('open-shortcut-help', openHelp);
    return () => window.removeEventListener('open-shortcut-help', openHelp);
  }, []);

  const showFeedback = (text: string | null) => {
    setFeedbackText(text);
  };

  // Get the tick for the command target, which may differ from Market Watch.
  const getCurrentTick = (symbol = selectedSymbol) => {
    const ticks = useAppStore.getState().ticks;
    return resolveExactBrokerSymbolValue(ticks, symbol) || { bid: 0, ask: 0 };
  };

  const dispatchDrawingShortcut = (eventName: string) => {
    const targetContextId = getActiveChartSource()?.id;
    window.dispatchEvent(new CustomEvent(eventName, {
      detail: targetContextId ? { targetContextId } : {},
    }));
  };

  const changeTimeframe = (timeframe: string) => {
    const targetContextId = getActiveChartSource()?.id;
    commandBus.dispatch({ type: 'SET_TIMEFRAME', payload: { timeframe, targetContextId, panelId: getPanelIdFromChartContextId(targetContextId) } });
  };

  const existingShortcuts: ShortcutDefinition[] = [
    // File menu shortcuts
    {
      id: 'file.save',
      key: 's',
      ctrl: true,
      description: 'Save workspace',
      category: SHORTCUT_CATEGORIES.FILE,
      priority: 100,
      handler: () => {
        showFeedback('Save Workspace (Ctrl+S)');
        onSaveWorkspace();
      }
    },
    {
      id: 'file.close-chart',
      key: 'q',
      alt: true,
      shift: true,
      description: 'Close active chart',
      category: SHORTCUT_CATEGORIES.FILE,
      priority: 100,
      handler: () => {
        showFeedback('Close Active Chart (Alt+Shift+Q)');
        window.dispatchEvent(new CustomEvent('close-active-chart'));
      }
    },
    {
      id: 'file.open-data-folder',
      key: 'D',
      ctrl: true,
      shift: true,
      description: 'Open data folder',
      category: SHORTCUT_CATEGORIES.FILE,
      priority: 100,
      handler: () => {
        showFeedback('Open Data Folder (Ctrl+Shift+D)');
        onOpenDataFolder();
      }
    },
    {
      id: 'file.print',
      key: 'p',
      ctrl: true,
      description: 'Print chart',
      category: SHORTCUT_CATEGORIES.FILE,
      priority: 100,
      handler: () => {
        showFeedback('Print Chart (Ctrl+P)');
        onPrintChart();
      }
    },

    // View menu shortcuts
    {
      id: 'view.fullscreen',
      key: 'F11',
      description: 'Full Screen',
      category: SHORTCUT_CATEGORIES.VIEW,
      priority: 100,
      allowInInput: true,
      handler: () => {
        showFeedback('Toggle Fullscreen (F11)');
        onToggleFullScreen();
      }
    },
    {
      id: 'view.data-window',
      key: 'd',
      ctrl: true,
      description: 'Data Window',
      category: SHORTCUT_CATEGORIES.VIEW,
      priority: 95,
      handler: () => {
        showFeedback('Data Window (Ctrl+D)');
        window.dispatchEvent(new CustomEvent('openDataWindow'));
      }
    },

    // Tools menu shortcuts
    {
      id: 'tools.new-order',
      key: 'F9',
      description: 'New Order',
      category: SHORTCUT_CATEGORIES.TOOLS,
      priority: 100,
      allowInInput: true,
      handler: () => {
        const target = resolveActiveChartTarget(selectedSymbol);
        if (isOrderPanelOpen) {
          showFeedback(null);
        } else {
          showFeedback(`New Order - ${target.symbol} (F9)`);
        }
        const tick = getCurrentTick(target.symbol);
        onOpenOrderPanel(target.symbol, { bid: tick.bid, ask: tick.ask });
      }
    },

    {
      id: 'view.depth-of-market',
      key: 'b',
      alt: true,
      description: 'Depth of Market',
      category: SHORTCUT_CATEGORIES.VIEW,
      priority: 95,
      handler: () => {
        const target = resolveActiveChartTarget(selectedSymbol);
        showFeedback(`Depth of Market - ${target.symbol} (Alt+B)`);
        onOpenDOM(target.symbol);
      }
    },
    {
      id: 'trading.quick-sell',
      key: 's',
      alt: true,
      description: 'Quick Sell',
      category: SHORTCUT_CATEGORIES.TRADING,
      priority: 95,
      handler: (event) => {
        if (isShortcutOverlay(event)) return;
        const target = resolveActiveChartTarget(selectedSymbol);
        showFeedback(`Quick Sell - ${target.symbol} (Alt+S)`);
        onQuickSell(target.symbol);
      }
    },
    {
      id: 'trading.toggle-one-click',
      key: 't',
      alt: true,
      shift: true,
      description: 'Toggle One-Click Trading (Buy/Sell)',
      category: SHORTCUT_CATEGORIES.TRADING,
      priority: 95,
      handler: () => {
        showFeedback('Toggle One-Click Trading (Alt+Shift+T)');
        window.dispatchEvent(new CustomEvent('toggle-one-click-trading'));
      }
    },

    // Chart type shortcuts — matches context menu (Alt+1=Bar, Alt+2=Candlestick, Alt+3=Line)
    {
      id: 'charts.indicator-list',
      key: 'i',
      ctrl: true,
      description: 'Indicator List',
      category: SHORTCUT_CATEGORIES.CHARTS,
      priority: 92,
      handler: () => {
        const target = resolveActiveChartTarget(selectedSymbol);
        showFeedback('Indicator List (Ctrl+I)');
        commandBus.dispatch({
          type: 'OPEN_INDICATOR_LIST',
          payload: { targetContextId: target.targetContextId },
        });
      }
    },
    {
      id: 'charts.toggle-crosshair',
      key: 'c',
      description: 'Toggle Crosshair',
      category: SHORTCUT_CATEGORIES.CHARTS,
      priority: 92,
      handler: () => {
        const target = resolveActiveChartTarget(selectedSymbol);
        showFeedback('Toggle Crosshair (C)');
        commandBus.dispatch({
          type: 'TOGGLE_CROSSHAIR',
          payload: { targetContextId: target.targetContextId },
        });
      }
    },
    {
      id: 'charts.object-list',
      key: 'b',
      ctrl: true,
      description: 'Object List',
      category: SHORTCUT_CATEGORIES.CHARTS,
      priority: 92,
      handler: () => {
        const target = resolveActiveChartTarget(selectedSymbol);
        showFeedback('Object List (Ctrl+B)');
        window.dispatchEvent(new CustomEvent('open-object-list', {
          detail: {
            symbol: target.symbol,
            timeframe: target.timeframe,
            targetContextId: target.targetContextId,
          },
        }));
      }
    },
    {
      id: 'charts.bar-chart',
      key: '1',
      alt: true,
      description: 'Bar Chart',
      category: SHORTCUT_CATEGORIES.CHARTS,
      priority: 92,
      handler: () => {
        const target = resolveActiveChartTarget(selectedSymbol);
        showFeedback('Bar Chart (Alt+1)');
        commandBus.dispatch({
          type: 'SET_CHART_TYPE',
          payload: { chartType: 'bar', targetContextId: target.targetContextId },
        });
      }
    },
    {
      id: 'charts.candlestick',
      key: '2',
      alt: true,
      description: 'Candlesticks',
      category: SHORTCUT_CATEGORIES.CHARTS,
      priority: 92,
      handler: () => {
        const target = resolveActiveChartTarget(selectedSymbol);
        showFeedback('Candlesticks (Alt+2)');
        commandBus.dispatch({
          type: 'SET_CHART_TYPE',
          payload: { chartType: 'candlestick', targetContextId: target.targetContextId },
        });
      }
    },
    {
      id: 'charts.line-chart',
      key: '3',
      alt: true,
      description: 'Line Chart',
      category: SHORTCUT_CATEGORIES.CHARTS,
      priority: 92,
      handler: () => {
        const target = resolveActiveChartTarget(selectedSymbol);
        showFeedback('Line Chart (Alt+3)');
        commandBus.dispatch({
          type: 'SET_CHART_TYPE',
          payload: { chartType: 'line', targetContextId: target.targetContextId },
        });
      }
    },
    {
      id: 'charts.toggle-grid',
      key: 'g',
      ctrl: true,
      description: 'Toggle Grid',
      category: SHORTCUT_CATEGORIES.CHARTS,
      priority: 92,
      handler: () => {
        showFeedback('Toggle Grid (Ctrl+G)');
        const target = resolveActiveChartTarget(selectedSymbol);
        const store = useChartSettingsStore.getState();
        const current = store.symbolProperties[target.symbol] || store.globalProperties;
        setGridVisible(!current.showGrid, target.symbol);
      }
    },
    {
      id: 'charts.toggle-volumes',
      key: 'k',
      ctrl: true,
      description: 'Toggle Volumes',
      category: SHORTCUT_CATEGORIES.CHARTS,
      priority: 92,
      handler: () => {
        showFeedback('Toggle Volumes (Ctrl+K)');
        const target = resolveActiveChartTarget(selectedSymbol);
        const store = useChartSettingsStore.getState();
        const current = store.symbolProperties[target.symbol] || store.globalProperties;
        setVolumeBarsVisible(!(current.showTickVolumes || current.showRealVolumes), target.symbol);
      }
    },

    // Timeframe shortcuts — Alt+4 through Alt+9 (and extras for common TFs)
    {
      id: 'timeframe.m1',
      key: '4',
      alt: true,
      description: 'Switch to M1',
      category: SHORTCUT_CATEGORIES.CHARTS,
      priority: 90,
      handler: () => {
        showFeedback('Timeframe: M1 (Alt+4)');
        changeTimeframe('M1');
      }
    },
    {
      id: 'timeframe.m5',
      key: '5',
      alt: true,
      description: 'Switch to M5',
      category: SHORTCUT_CATEGORIES.CHARTS,
      priority: 90,
      handler: () => {
        showFeedback('Timeframe: M5 (Alt+5)');
        changeTimeframe('M5');
      }
    },
    {
      id: 'timeframe.m15',
      key: '6',
      alt: true,
      description: 'Switch to M15',
      category: SHORTCUT_CATEGORIES.CHARTS,
      priority: 90,
      handler: () => {
        showFeedback('Timeframe: M15 (Alt+6)');
        changeTimeframe('M15');
      }
    },
    {
      id: 'timeframe.m30',
      key: '7',
      alt: true,
      description: 'Switch to M30',
      category: SHORTCUT_CATEGORIES.CHARTS,
      priority: 90,
      handler: () => {
        showFeedback('Timeframe: M30 (Alt+7)');
        changeTimeframe('M30');
      }
    },
    {
      id: 'timeframe.h1',
      key: '8',
      alt: true,
      description: 'Switch to H1',
      category: SHORTCUT_CATEGORIES.CHARTS,
      priority: 90,
      handler: () => {
        showFeedback('Timeframe: H1 (Alt+8)');
        changeTimeframe('H1');
      }
    },
    {
      id: 'timeframe.h4',
      key: '9',
      alt: true,
      description: 'Switch to H4',
      category: SHORTCUT_CATEGORIES.CHARTS,
      priority: 90,
      handler: () => {
        showFeedback('Timeframe: H4 (Alt+9)');
        changeTimeframe('H4');
      }
    },

    // Chart shortcuts
    {
      id: 'charts.zoom-in',
      key: '+',
      description: 'Zoom In',
      category: SHORTCUT_CATEGORIES.CHARTS,
      priority: 80,
      handler: () => {
        const target = resolveActiveChartTarget(selectedSymbol);
        showFeedback('Zoom In (+)');
        commandBus.dispatch({
          type: 'ZOOM_IN',
          payload: { targetContextId: target.targetContextId },
        });
      }
    },
    {
      id: 'charts.zoom-out',
      key: '-',
      description: 'Zoom Out',
      category: SHORTCUT_CATEGORIES.CHARTS,
      priority: 80,
      handler: () => {
        const target = resolveActiveChartTarget(selectedSymbol);
        showFeedback('Zoom Out (-)');
        commandBus.dispatch({
          type: 'ZOOM_OUT',
          payload: { targetContextId: target.targetContextId },
        });
      }
    },
    {
      id: 'charts.toggle-grid-alt',
      key: 'g',
      alt: true,
      description: 'Toggle Grid',
      category: SHORTCUT_CATEGORIES.CHARTS,
      priority: 90,
      handler: () => {
        showFeedback('Toggle Grid (Alt+G)');
        const target = resolveActiveChartTarget(selectedSymbol);
        const store = useChartSettingsStore.getState();
        const current = store.symbolProperties[target.symbol] || store.globalProperties;
        setGridVisible(!current.showGrid, target.symbol);
      }
    },
    {
      id: 'charts.toggle-volume',
      key: 'l',
      ctrl: true,
      description: 'Toggle Volume',
      category: SHORTCUT_CATEGORIES.CHARTS,
      priority: 90,
      handler: () => {
        showFeedback('Toggle Volume (Ctrl+L)');
        const target = resolveActiveChartTarget(selectedSymbol);
        const store = useChartSettingsStore.getState();
        const current = store.symbolProperties[target.symbol] || store.globalProperties;
        setVolumeBarsVisible(!(current.showTickVolumes || current.showRealVolumes), target.symbol);
      }
    },
    {
      id: 'charts.scroll-left',
      key: 'ArrowLeft',
      description: 'Scroll Chart Left',
      category: SHORTCUT_CATEGORIES.CHARTS,
      priority: 80,
      handler: () => {
        window.dispatchEvent(new CustomEvent('chart-scroll', { detail: { direction: 'left', targetContextId: getActiveChartSource()?.id } }));
      }
    },
    {
      id: 'charts.scroll-right',
      key: 'ArrowRight',
      description: 'Scroll Chart Right',
      category: SHORTCUT_CATEGORIES.CHARTS,
      priority: 80,
      handler: () => {
        window.dispatchEvent(new CustomEvent('chart-scroll', { detail: { direction: 'right', targetContextId: getActiveChartSource()?.id } }));
      }
    },
    {
      id: 'charts.undo-drawing',
      key: 'z',
      ctrl: true,
      description: 'Undo Last Drawing',
      category: SHORTCUT_CATEGORIES.CHARTS,
      priority: 90,
      handler: () => {
        showFeedback('Undo Drawing (Ctrl+Z)');
        dispatchDrawingShortcut('chart-undo-drawing');
      }
    },
    {
      id: 'charts.redo-drawing',
      key: 'y',
      ctrl: true,
      description: 'Redo Last Drawing',
      category: SHORTCUT_CATEGORIES.CHARTS,
      priority: 90,
      handler: () => {
        showFeedback('Redo Drawing (Ctrl+Y)');
        dispatchDrawingShortcut('chart-redo-drawing');
      }
    },
    {
      id: 'charts.delete-drawing',
      key: 'Delete',
      description: 'Delete Selected Drawing',
      category: SHORTCUT_CATEGORIES.CHARTS,
      priority: 90,
      handler: () => {
        showFeedback('Delete Drawing (Delete)');
        dispatchDrawingShortcut('chart-delete-drawing');
      }
    },
    {
      id: 'charts.delete-last-drawing',
      key: 'Backspace',
      description: 'Delete Last Drawing',
      category: SHORTCUT_CATEGORIES.CHARTS,
      priority: 90,
      handler: () => {
        showFeedback('Delete Last Drawing (Backspace)');
        dispatchDrawingShortcut('chart-delete-last-drawing');
      }
    },

    {
      id: 'charts.properties',
      key: 'F8',
      description: 'Chart Properties',
      category: SHORTCUT_CATEGORIES.CHARTS,
      priority: 90,
      handler: () => {
        if (isChartPropertiesOpen) {
          showFeedback(null);
        } else {
          showFeedback('Chart Properties (F8)');
        }
        const target = resolveActiveChartTarget(selectedSymbol);
        window.dispatchEvent(new CustomEvent('openChartProperties', {
          detail: {
            symbol: target.symbol,
            timeframe: target.timeframe,
            targetContextId: target.targetContextId,
          },
        }));
      }
    },

    // Navigation shortcuts
    {
      id: 'navigation.close-modal',
      key: 'Escape',
      description: 'Close Modal',
      category: SHORTCUT_CATEGORIES.NAVIGATION,
      priority: 100,
      allowInInput: true,
      handler: () => {
        const target = resolveActiveChartTarget(selectedSymbol);
        commandBus.dispatch({
          type: 'SELECT_TOOL',
          payload: {
            tool: 'cursor',
            ...(target.targetContextId ? { targetContextId: target.targetContextId } : {}),
          },
        });
        if (showHelpDialog) {
          setShowHelpDialog(false);
        } else {
          window.dispatchEvent(new CustomEvent('close-modal'));
        }
      }
    },

    // Help shortcuts
    {
      id: 'help.shortcuts',
      key: 'F1',
      description: 'Show Keyboard Shortcuts',
      category: SHORTCUT_CATEGORIES.HELP,
      priority: 100,
      allowInInput: true,
      handler: () => {
        showFeedback('Keyboard Shortcuts (F1)');
        setShowHelpDialog(true);
      }
    }
  ];
  const desktop = typeof window !== 'undefined' && Boolean(window.electron);
  const existingIds = new Set(existingShortcuts.map(shortcut => shortcut.id));
  const additions: ShortcutDefinition[] = TERMINAL_SHORTCUTS
    .filter(shortcut => !existingIds.has(shortcut.id))
    .map(shortcut => ({
      ...shortcut,
      priority: 90,
      handler: () => {
        runTerminalShortcutAction(shortcut.id);
        showFeedback(`${shortcut.description} (${keyboardShortcutManager.formatShortcut(shortcut as ShortcutDefinition)})`);
      },
    }));
  const desktopAliases: ShortcutDefinition[] = desktop ? [
    { id: 'view.symbols-desktop', key: 'u', ctrl: true, description: 'Search Symbols', category: 'View', handler: () => runTerminalShortcutAction('view.symbols') },
    { id: 'view.navigator-desktop', key: 'n', ctrl: true, description: 'Navigator', category: 'View', handler: () => runTerminalShortcutAction('view.navigator') },
    { id: 'view.terminal-desktop', key: 't', ctrl: true, description: 'Terminal', category: 'View', handler: () => runTerminalShortcutAction('view.terminal') },
    { id: 'file.close-chart-desktop', key: 'F4', ctrl: true, description: 'Close active chart', category: 'File', handler: () => runTerminalShortcutAction('file.close-chart') },
  ] : [];

  useKeyboardShortcuts([
    ...existingShortcuts.filter(shortcut => desktop || !['file.open-data-folder', 'charts.toggle-volume'].includes(shortcut.id)),
    ...additions,
    ...desktopAliases,
  ], [
    selectedSymbol,
    onOpenOrderPanel,
    onQuickBuy,
    onQuickSell,
    onSaveWorkspace,
    onOpenDataFolder,
    onPrintChart,
    onToggleFullScreen,
    onOpenDOM,
    showHelpDialog,
    isChartPropertiesOpen,
    isOrderPanelOpen
  ]);

  return (
    <>
      <ShortcutFeedback
        shortcutText={feedbackText}
        onClose={() => setFeedbackText(null)}
      />
      <ShortcutHelpDialog
        isOpen={showHelpDialog}
        onClose={() => setShowHelpDialog(false)}
      />
    </>
  );
}
