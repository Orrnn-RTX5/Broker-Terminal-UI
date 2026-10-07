import { useCallback, useEffect, useState } from 'react';
import type {
  Dispatch,
  MouseEvent as ReactMouseEvent,
  MutableRefObject,
  SetStateAction,
} from 'react';

import { activateActiveChartSource } from '../../../services/activeChartSource';
import { captureFullPage } from '../../../services/screenshotService';
import { commandBus } from '../../../services/commandBus';
import type { IndicatorManager } from '../../../services/indicatorManager';
import { useChartSettingsStore, type ChartProperties } from '../../../store/useChartSettingsStore';
import type { ChartTemplate } from '../../../store/useTemplateStore';
import type { AddChartIndicatorRequest } from '../model/indicatorRequest';
import type { ChartType, Timeframe } from '../../../types/chart';

export interface TradingChartContextMenuState {
  visible: boolean;
  x: number;
  y: number;
}

interface UseTradingChartContextMenuStateResult {
  ctxAutoScroll: boolean;
  ctxChartShift: boolean;
  ctxMenu: TradingChartContextMenuState;
  ctxShowTradeHistory: boolean;
  ctxShowTradeHistoryLine: boolean;
  ctxShowTradeLevels: boolean;
  localChartType: ChartType;
  setCtxAutoScroll: Dispatch<SetStateAction<boolean>>;
  setCtxChartShift: Dispatch<SetStateAction<boolean>>;
  setCtxMenu: Dispatch<SetStateAction<TradingChartContextMenuState>>;
  setCtxShowTradeHistory: Dispatch<SetStateAction<boolean>>;
  setCtxShowTradeHistoryLine: Dispatch<SetStateAction<boolean>>;
  setCtxShowTradeLevels: Dispatch<SetStateAction<boolean>>;
  setLocalChartType: Dispatch<SetStateAction<ChartType>>;
  setTemplateDialogMode: Dispatch<SetStateAction<'save' | 'load'>>;
  setTemplateDialogOpen: Dispatch<SetStateAction<boolean>>;
  templateDialogMode: 'save' | 'load';
  templateDialogOpen: boolean;
}

export function useTradingChartContextMenuState(
  symbol: string,
  chartType: ChartType,
): UseTradingChartContextMenuStateResult {
  const [ctxMenu, setCtxMenu] = useState<TradingChartContextMenuState>({
    visible: false,
    x: 0,
    y: 0,
  });
  const [ctxAutoScroll, setCtxAutoScroll] = useState(() => {
    const state = useChartSettingsStore.getState();
    return state.symbolProperties[symbol]?.chartAutoScroll ?? state.globalProperties.chartAutoScroll;
  });
  const [ctxChartShift, setCtxChartShift] = useState(() => {
    const state = useChartSettingsStore.getState();
    return state.symbolProperties[symbol]?.chartShift ?? state.globalProperties.chartShift;
  });
  const [ctxShowTradeLevels, setCtxShowTradeLevels] = useState(() => {
    const state = useChartSettingsStore.getState();
    return state.symbolProperties[symbol]?.showTradeLevels ?? state.globalProperties.showTradeLevels;
  });
  const [ctxShowTradeHistory, setCtxShowTradeHistory] = useState(() => {
    const state = useChartSettingsStore.getState();
    return state.symbolProperties[symbol]?.showTradeHistoryArrows ?? state.globalProperties.showTradeHistoryArrows;
  });
  const [ctxShowTradeHistoryLine, setCtxShowTradeHistoryLine] = useState(() => {
    const state = useChartSettingsStore.getState();
    return state.symbolProperties[symbol]?.showTradeHistory ?? state.globalProperties.showTradeHistory;
  });
  const [localChartType, setLocalChartType] = useState<ChartType>(chartType);
  const [templateDialogOpen, setTemplateDialogOpen] = useState(false);
  const [templateDialogMode, setTemplateDialogMode] = useState<'save' | 'load'>('save');

  useEffect(() => {
    setLocalChartType(chartType);
  }, [chartType]);

  return {
    ctxAutoScroll,
    ctxChartShift,
    ctxMenu,
    ctxShowTradeHistory,
    ctxShowTradeHistoryLine,
    ctxShowTradeLevels,
    localChartType,
    setCtxAutoScroll,
    setCtxChartShift,
    setCtxMenu,
    setCtxShowTradeHistory,
    setCtxShowTradeHistoryLine,
    setCtxShowTradeLevels,
    setLocalChartType,
    setTemplateDialogMode,
    setTemplateDialogOpen,
    templateDialogMode,
    templateDialogOpen,
  };
}

interface UseTradingChartContextMenuControllerOptions {
  activeChartSourceId: string;
  activeTimeframe: Timeframe;
  addLocalIndicator: (request: AddChartIndicatorRequest) => boolean;
  applyChartTypeInPlace: (type: ChartType) => boolean;
  chartSettingsRef: MutableRefObject<ChartProperties>;
  clearLocalIndicators: () => void;
  loadHistory: (symbol: string, timeframe: Timeframe) => Promise<void>;
  localIndicatorManager: IndicatorManager;
  panelId?: string;
  persistCurrentIndicators: () => void;
  prevTimeframeRef: MutableRefObject<Timeframe>;
  refreshCurrentIndicators: () => void;
  setCtxAutoScroll: Dispatch<SetStateAction<boolean>>;
  setCtxChartShift: Dispatch<SetStateAction<boolean>>;
  setCtxMenu: Dispatch<SetStateAction<TradingChartContextMenuState>>;
  setCtxShowTradeHistory: Dispatch<SetStateAction<boolean>>;
  setCtxShowTradeHistoryLine: Dispatch<SetStateAction<boolean>>;
  setCtxShowTradeLevels: Dispatch<SetStateAction<boolean>>;
  setLocalChartType: Dispatch<SetStateAction<ChartType>>;
  setTemplateDialogMode: Dispatch<SetStateAction<'save' | 'load'>>;
  setTemplateDialogOpen: Dispatch<SetStateAction<boolean>>;
  symbol: string;
  timeframe: Timeframe;
}

export function useTradingChartContextMenuController({
  activeChartSourceId,
  activeTimeframe,
  addLocalIndicator,
  applyChartTypeInPlace,
  chartSettingsRef,
  clearLocalIndicators,
  loadHistory,
  localIndicatorManager,
  panelId,
  persistCurrentIndicators,
  prevTimeframeRef,
  refreshCurrentIndicators,
  setCtxAutoScroll,
  setCtxChartShift,
  setCtxMenu,
  setCtxShowTradeHistory,
  setCtxShowTradeHistoryLine,
  setCtxShowTradeLevels,
  setLocalChartType,
  setTemplateDialogMode,
  setTemplateDialogOpen,
  symbol,
  timeframe,
}: UseTradingChartContextMenuControllerOptions) {
  const handleContextMenu = useCallback((event: ReactMouseEvent) => {
    event.preventDefault();
    activateActiveChartSource(activeChartSourceId);

    let node: HTMLElement | null = event.target as HTMLElement;
    while (node) {
      if (node.hasAttribute('data-id') || node.classList.contains('chart-svg-overlay')) {
        return;
      }
      node = node.parentElement;
    }

    setCtxMenu({ visible: true, x: event.clientX, y: event.clientY });
  }, [activeChartSourceId, setCtxMenu]);

  const closeCtxMenu = useCallback(() => {
    setCtxMenu(previous => ({ ...previous, visible: false }));
  }, [setCtxMenu]);

  const handleCtxChartTypeChange = useCallback((type: ChartType) => {
    applyChartTypeInPlace(type);
    setLocalChartType(type);
    requestAnimationFrame(() => {
      setTimeout(() => {
        commandBus.dispatch({
          type: 'SET_CHART_TYPE',
          payload: { chartType: type, targetContextId: activeChartSourceId },
        });
      }, 0);
    });
  }, [activeChartSourceId, applyChartTypeInPlace, setLocalChartType]);

  const handleCtxTimeframeChange = useCallback((nextTimeframe: Timeframe) => {
    commandBus.dispatch({
      type: 'SET_TIMEFRAME',
      payload: { timeframe: nextTimeframe, targetContextId: activeChartSourceId, panelId },
    });
  }, [activeChartSourceId, panelId]);

  const handleCtxToggleGrid = useCallback(() => {
    const next = !chartSettingsRef.current.showGrid;
    useChartSettingsStore.getState().updateSymbolProperty(symbol, 'showGrid', next);
  }, [chartSettingsRef, symbol]);

  const handleCtxGridTypeChange = useCallback((gridType: ChartProperties['gridType']) => {
    const store = useChartSettingsStore.getState();
    store.updateSymbolProperty(symbol, 'gridType', gridType);
    if (gridType === 'mt5') store.updateSymbolProperty(symbol, 'gridLineStyle', 'dashed');
    store.updateSymbolProperty(symbol, 'showGrid', true);
  }, [symbol]);

  const handleCtxGridLineStyleChange = useCallback((gridLineStyle: ChartProperties['gridLineStyle']) => {
    const store = useChartSettingsStore.getState();
    store.updateSymbolProperty(symbol, 'gridLineStyle', gridLineStyle);
    store.updateSymbolProperty(symbol, 'showGrid', true);
  }, [symbol]);

  const handleCtxToggleVolumes = useCallback(() => {
    const store = useChartSettingsStore.getState();
    const currentProperties = store.symbolProperties[symbol] || store.globalProperties;
    const next = !(currentProperties.showTickVolumes || currentProperties.showRealVolumes);
    store.updateSymbolProperty(symbol, 'showTickVolumes', next);
    store.updateSymbolProperty(symbol, 'showRealVolumes', false);
  }, [symbol]);

  const handleCtxToggleOHLC = useCallback(() => {
    const store = useChartSettingsStore.getState();
    const currentProperties = store.symbolProperties[symbol] || store.globalProperties;
    store.updateSymbolProperty(symbol, 'showOHLC', !currentProperties.showOHLC);
  }, [symbol]);

  const handleCtxToggleAutoScroll = useCallback(() => {
    setCtxAutoScroll(previous => {
      const next = !previous;
      useChartSettingsStore.getState().updateSymbolProperty(symbol, 'chartAutoScroll', next);
      commandBus.dispatch({
        type: 'SET_AUTO_SCROLL',
        payload: { enabled: next, targetContextId: activeChartSourceId },
      });
      return next;
    });
  }, [activeChartSourceId, setCtxAutoScroll, symbol]);

  const handleCtxToggleChartShift = useCallback(() => {
    setCtxChartShift(previous => {
      const next = !previous;
      useChartSettingsStore.getState().updateSymbolProperty(symbol, 'chartShift', next);
      commandBus.dispatch({
        type: 'SET_CHART_SHIFT',
        payload: { enabled: next, targetContextId: activeChartSourceId },
      });
      return next;
    });
  }, [activeChartSourceId, setCtxChartShift, symbol]);

  const handleCtxToggleTradeLevels = useCallback(() => {
    setCtxShowTradeLevels(previous => {
      const next = !previous;
      useChartSettingsStore.getState().updateSymbolProperty(symbol, 'showTradeLevels', next);
      window.dispatchEvent(new CustomEvent('rtx:flush-trade-overlay'));
      return next;
    });
  }, [setCtxShowTradeLevels, symbol]);

  const handleCtxToggleTradeHistory = useCallback(() => {
    setCtxShowTradeHistory(previous => {
      const next = !previous;
      const store = useChartSettingsStore.getState();
      store.updateSymbolProperty(symbol, 'showTradeHistoryArrows', next);
      window.dispatchEvent(new CustomEvent('rtx:flush-trade-overlay'));
      return next;
    });
  }, [setCtxShowTradeHistory, symbol]);

  const handleCtxToggleTradeHistoryLine = useCallback(() => {
    setCtxShowTradeHistoryLine(previous => {
      const next = !previous;
      useChartSettingsStore.getState().updateSymbolProperty(symbol, 'showTradeHistory', next);
      window.dispatchEvent(new CustomEvent('rtx:flush-trade-overlay'));
      return next;
    });
  }, [setCtxShowTradeHistoryLine, symbol]);

  const handleCtxZoomIn = useCallback(() => {
    commandBus.dispatch({ type: 'ZOOM_IN', payload: { targetContextId: activeChartSourceId } });
  }, [activeChartSourceId]);

  const handleCtxZoomOut = useCallback(() => {
    commandBus.dispatch({ type: 'ZOOM_OUT', payload: { targetContextId: activeChartSourceId } });
  }, [activeChartSourceId]);

  const handleOpenTemplateDialog = useCallback((mode: 'save' | 'load') => {
    setTemplateDialogMode(mode);
    setTemplateDialogOpen(true);
  }, [setTemplateDialogMode, setTemplateDialogOpen]);

  const handleLoadTemplate = useCallback((template: ChartTemplate) => {
    setLocalChartType(template.chartType as ChartType);
    commandBus.dispatch({
      type: 'SET_CHART_TYPE',
      payload: { chartType: template.chartType as ChartType, targetContextId: activeChartSourceId },
    });
    commandBus.dispatch({
      type: 'SET_TIMEFRAME',
      payload: { timeframe: template.timeframe, targetContextId: activeChartSourceId, panelId },
    });

    const settingsStore = useChartSettingsStore.getState();
    settingsStore.updateSymbolProperty(symbol, 'showGrid', template.showGrid);
    settingsStore.updateSymbolProperty(symbol, 'gridType', template.gridType === 'scale' || template.gridType === 'mt5' ? template.gridType : 'square');
    const gridLineStyle = template.gridLineStyle === 'solid' ? 'solid' : 'dashed';
    settingsStore.updateSymbolProperty(symbol, 'gridLineStyle', gridLineStyle);
    settingsStore.updateSymbolProperty(symbol, 'showTickVolumes', template.showVolumes);
    settingsStore.updateSymbolProperty(symbol, 'showRealVolumes', false);

    localIndicatorManager.clearAll();
    for (const indicator of template.indicators) {
      addLocalIndicator({
        id: indicator.id,
        name: indicator.name,
        indicatorType: indicator.type,
        params: indicator.parameters,
      });
    }
    refreshCurrentIndicators();
    persistCurrentIndicators();

    // The chart settings effect switches both grid renderers together.
    console.log('[TradingChart] Loading template:', template);
    setTemplateDialogOpen(false);
  }, [
    activeChartSourceId,
    addLocalIndicator,
    localIndicatorManager,
    panelId,
    persistCurrentIndicators,
    refreshCurrentIndicators,
    setLocalChartType,
    setTemplateDialogOpen,
    symbol,
  ]);

  const handleCtxOpenNewOrder = useCallback(() => {
    window.dispatchEvent(new CustomEvent('openNewOrder', {
      detail: { symbol, targetContextId: activeChartSourceId },
    }));
  }, [activeChartSourceId, symbol]);

  const handleCtxOpenDOM = useCallback(() => {
    window.dispatchEvent(new CustomEvent('openDepthOfMarket', { detail: { symbol } }));
  }, [symbol]);

  const handleCtxRefresh = useCallback(() => {
    void loadHistory(symbol, prevTimeframeRef.current || timeframe);
  }, [loadHistory, prevTimeframeRef, symbol, timeframe]);

  const handleCtxSaveAsPicture = useCallback(() => {
    captureFullPage();
  }, []);

  const handleCtxOpenProperties = useCallback(() => {
    window.dispatchEvent(new CustomEvent('openChartProperties', {
      detail: {
        symbol,
        timeframe: activeTimeframe,
        targetContextId: activeChartSourceId,
      },
    }));
  }, [activeChartSourceId, activeTimeframe, symbol]);

  return {
    closeCtxMenu,
    handleContextMenu,
    handleCtxChartTypeChange,
    handleCtxGridTypeChange,
    handleCtxGridLineStyleChange,
    handleCtxDeleteIndicators: clearLocalIndicators,
    handleCtxOpenDOM,
    handleCtxOpenNewOrder,
    handleCtxOpenProperties,
    handleCtxRefresh,
    handleCtxSaveAsPicture,
    handleCtxTimeframeChange,
    handleCtxToggleAutoScroll,
    handleCtxToggleChartShift,
    handleCtxToggleGrid,
    handleCtxToggleOHLC,
    handleCtxToggleTradeHistory,
    handleCtxToggleTradeHistoryLine,
    handleCtxToggleTradeLevels,
    handleCtxToggleVolumes,
    handleCtxZoomIn,
    handleCtxZoomOut,
    handleLoadTemplate,
    handleOpenTemplateDialog,
  };
}
