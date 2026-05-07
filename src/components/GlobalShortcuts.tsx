/**
 * Global Shortcuts Component
 * Registers all MT5-compatible global shortcuts
 */

import { useEffect, useState } from 'react';
import { useKeyboardShortcuts } from '../hooks/useKeyboardShortcut';
import { ShortcutFeedback } from './ShortcutFeedback';
import { ShortcutHelpDialog } from './ShortcutHelpDialog';
import { SHORTCUT_CATEGORIES } from '../services/keyboardShortcutManager';
import { useAppStore } from '../store/useAppStore';
import { useChartSettingsStore } from '../store/useChartSettingsStore';

interface GlobalShortcutsProps {
  onOpenOrderPanel: (symbol: string, price: { bid: number; ask: number }) => void;
  onQuickBuy: () => void;
  onQuickSell: () => void;
  onSaveWorkspace: () => void;
  onOpenDataFolder: () => void;
  onPrintChart: () => void;
  onToggleFullScreen: () => void;
  onOpenDOM: (symbol: string) => void;
  selectedSymbol: string;
  isChartPropertiesOpen: boolean;
  isOrderPanelOpen: boolean;
}

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

  const showFeedback = (text: string | null) => {
    setFeedbackText(text);
  };

  // Get current tick for selected symbol
  const getCurrentTick = () => {
    const ticks = useAppStore.getState().ticks;
    return ticks[selectedSymbol] || { bid: 0, ask: 0 };
  };

  useKeyboardShortcuts([
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
      key: 'w',
      ctrl: true,
      description: 'Close active chart',
      category: SHORTCUT_CATEGORIES.FILE,
      priority: 100,
      handler: () => {
        showFeedback('Close Active Chart (Ctrl+W)');
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
    {
      id: 'file.exit',
      key: 'F4',
      alt: true,
      description: 'Exit application',
      category: SHORTCUT_CATEGORIES.FILE,
      priority: 100,
      allowInInput: true,
      handler: () => {
        if (confirm('Are you sure you want to exit?')) {
          showFeedback('Exit (Alt+F4)');
          window.close();
        }
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
        if (isOrderPanelOpen) {
          showFeedback(null);
        } else {
          showFeedback(`New Order - ${selectedSymbol} (F9)`);
        }
        const tick = getCurrentTick();
        onOpenOrderPanel(selectedSymbol, { bid: tick.bid, ask: tick.ask });
      }
    },
    {
      id: 'tools.new-order-alt',
      key: 'n',
      ctrl: true,
      description: 'New Order (Alt)',
      category: SHORTCUT_CATEGORIES.TOOLS,
      priority: 100,
      handler: () => {
        const tick = getCurrentTick();
        showFeedback(`New Order - ${selectedSymbol} (Ctrl+N)`);
        onOpenOrderPanel(selectedSymbol, { bid: tick.bid, ask: tick.ask });
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
        showFeedback(`Depth of Market - ${selectedSymbol} (Alt+B)`);
        window.dispatchEvent(new CustomEvent('openDepthOfMarket', { detail: { symbol: selectedSymbol } }));
      }
    },
    {
      id: 'trading.quick-sell',
      key: 's',
      alt: true,
      description: 'Quick Sell',
      category: SHORTCUT_CATEGORIES.TRADING,
      priority: 95,
      handler: () => {
        showFeedback(`Quick Sell - ${selectedSymbol} (Alt+S)`);
        onQuickSell();
      }
    },
    {
      id: 'trading.toggle-one-click',
      key: 't',
      alt: true,
      description: 'Toggle One-Click Trading (Buy/Sell)',
      category: SHORTCUT_CATEGORIES.TRADING,
      priority: 95,
      handler: () => {
        showFeedback('Toggle One-Click Trading (Alt+T)');
        window.dispatchEvent(new CustomEvent('toggle-one-click-trading'));
      }
    },

    // Chart type shortcuts — matches context menu (Alt+1=Bar, Alt+2=Candlestick, Alt+3=Line)
    {
      id: 'charts.bar-chart',
      key: '1',
      alt: true,
      description: 'Bar Chart',
      category: SHORTCUT_CATEGORIES.CHARTS,
      priority: 92,
      handler: () => {
        showFeedback('Bar Chart (Alt+1)');
        window.dispatchEvent(new CustomEvent('change-chart-type', { detail: { chartType: 'bar' } }));
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
        showFeedback('Candlesticks (Alt+2)');
        window.dispatchEvent(new CustomEvent('change-chart-type', { detail: { chartType: 'candlestick' } }));
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
        showFeedback('Line Chart (Alt+3)');
        window.dispatchEvent(new CustomEvent('change-chart-type', { detail: { chartType: 'line' } }));
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
        const store = useChartSettingsStore.getState();
        store.updateGlobalProperty('showGrid', !store.globalProperties.showGrid);
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
        const store = useChartSettingsStore.getState();
        store.updateGlobalProperty('showTickVolumes', !store.globalProperties.showTickVolumes);
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
        window.dispatchEvent(new CustomEvent('change-timeframe', { detail: { timeframe: 'M1' } }));
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
        window.dispatchEvent(new CustomEvent('change-timeframe', { detail: { timeframe: 'M5' } }));
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
        window.dispatchEvent(new CustomEvent('change-timeframe', { detail: { timeframe: 'M15' } }));
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
        window.dispatchEvent(new CustomEvent('change-timeframe', { detail: { timeframe: 'M30' } }));
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
        window.dispatchEvent(new CustomEvent('change-timeframe', { detail: { timeframe: 'H1' } }));
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
        window.dispatchEvent(new CustomEvent('change-timeframe', { detail: { timeframe: 'H4' } }));
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
        showFeedback('Zoom In (+)');
        window.dispatchEvent(new CustomEvent('chart-zoom', { detail: { direction: 'in' } }));
      }
    },
    {
      id: 'charts.zoom-out',
      key: '-',
      description: 'Zoom Out',
      category: SHORTCUT_CATEGORIES.CHARTS,
      priority: 80,
      handler: () => {
        showFeedback('Zoom Out (-)');
        window.dispatchEvent(new CustomEvent('chart-zoom', { detail: { direction: 'out' } }));
      }
    },
    {
      id: 'charts.toggle-grid',
      key: 'g',
      alt: true,
      description: 'Toggle Grid',
      category: SHORTCUT_CATEGORIES.CHARTS,
      priority: 90,
      handler: () => {
        showFeedback('Toggle Grid (Alt+G)');
        window.dispatchEvent(new CustomEvent('chart-toggle-grid'));
      }
    },
    {
      id: 'charts.toggle-grid-ctrl',
      key: 'g',
      ctrl: true,
      description: 'Toggle Grid (Ctrl+G)',
      category: SHORTCUT_CATEGORIES.CHARTS,
      priority: 90,
      handler: () => {
        showFeedback('Toggle Grid (Ctrl+G)');
        window.dispatchEvent(new CustomEvent('chart-toggle-grid'));
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
        window.dispatchEvent(new CustomEvent('chart-toggle-volume'));
      }
    },
    {
      id: 'charts.toggle-volume-k',
      key: 'k',
      ctrl: true,
      description: 'Toggle Volume (Ctrl+K)',
      category: SHORTCUT_CATEGORIES.CHARTS,
      priority: 90,
      handler: () => {
        showFeedback('Toggle Volume (Ctrl+K)');
        window.dispatchEvent(new CustomEvent('chart-toggle-volume'));
      }
    },
    {
      id: 'charts.scroll-left',
      key: 'ArrowLeft',
      description: 'Scroll Chart Left',
      category: SHORTCUT_CATEGORIES.CHARTS,
      priority: 80,
      handler: () => {
        window.dispatchEvent(new CustomEvent('chart-scroll', { detail: { direction: 'left' } }));
      }
    },
    {
      id: 'charts.scroll-right',
      key: 'ArrowRight',
      description: 'Scroll Chart Right',
      category: SHORTCUT_CATEGORIES.CHARTS,
      priority: 80,
      handler: () => {
        window.dispatchEvent(new CustomEvent('chart-scroll', { detail: { direction: 'right' } }));
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
        showFeedback('Undo Drawing / Layout (Ctrl+Z)');
        window.dispatchEvent(new CustomEvent('chart-undo-drawing'));
        window.dispatchEvent(new CustomEvent('layout-undo'));
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
        showFeedback('Redo Drawing / Layout (Ctrl+Y)');
        window.dispatchEvent(new CustomEvent('chart-redo-drawing'));
        window.dispatchEvent(new CustomEvent('layout-redo'));
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
        window.dispatchEvent(new CustomEvent('chart-delete-drawing'));
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
        window.dispatchEvent(new CustomEvent('openChartProperties'));
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
