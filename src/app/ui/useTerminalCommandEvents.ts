import { useEffect, type Dispatch, type SetStateAction } from 'react';
import type { ChartSymbolAnchor } from '../../components/ChartSymbolDropdown';
import type { ChartType, Timeframe } from '../../types/chart';
import type { DockContainer, DockPanelConfig } from '../../services/dockManager';
import { useDockLayoutStore } from '../../store/useDockLayoutStore';
import { openBottomDockTab, type BottomDockNavigationTab } from '../../services/bottomDockNavigation';
import { getActiveChartCommandTarget } from '../../services/chartCommandTarget';
import { getDockPanelChartType } from '../../services/chartTypeCommand';
import {
  activateChartPanel,
  changeChartPanelSymbol,
  findChartPanelById,
  getActiveDockChartPanel,
  getChartPanels,
} from '../../services/chartPanelNavigation';
import { getCommittedBrokerAccountSessionScope, getCommittedBrokerAccountSessionScopeKey } from '../../services/brokerSession';
import { resolveChartPropertiesTarget, type ChartPropertiesEventDetail } from '../../services/chartPropertiesTarget';
import type { ChartPrintData, PrintPreferences } from '../../services/chartPrinter';
import { hasArrangedChartWindows } from '../../utils/chartSymbolTabs';
import { normalizeSymbolName } from '../../utils/symbolEligibility';
import { resolveQuickTradeRoute, selectOneClickTrading, useSettingsStore } from '../../store/useSettingsStore';
import { translateUi } from '../../hooks/useUiTranslation';
import type { UiMessage } from '../../utils/uiFeedback';
import type { ActionFeedbackType } from '../../components/notifications/ActionFeedbackToast';

export interface PrintChartRequest {
  chartData?: ChartPrintData;
  preferences?: PrintPreferences;
}

export interface ChartSymbolPickerState {
  panelId: string;
  anchor?: ChartSymbolAnchor;
  sessionScope: string;
}

export interface ChartObjectsTarget {
  targetContextId: string | null;
  symbol: string;
  timeframe?: string;
}

interface UseTerminalCommandEventsOptions {
  selectedSymbol: string;
  setSelectedSymbol: Dispatch<SetStateAction<string>>;
  timeframe: Timeframe;
  setTimeframe: Dispatch<SetStateAction<Timeframe>>;
  chartType: ChartType;
  setChartType: Dispatch<SetStateAction<ChartType>>;
  chartEligibleSymbolNames: string[];
  displayToast: (message: UiMessage, type?: ActionFeedbackType) => void;
  placeOrder: (side: 'BUY' | 'SELL', symbol?: string) => void | Promise<unknown>;
  handleOpenDOM: (symbolOrEvent: string | CustomEvent) => void;
  handleSaveWorkspace: () => void;
  handleOpenDataFolder: () => void | Promise<void>;
  handlePrintChart: (request?: PrintChartRequest) => void | Promise<void>;
  getAllowedSymbol: (symbol: unknown) => string;
  getChartEligibleSymbol: (symbol: unknown) => string;
  openOrderPanelForSymbol: (symbol: unknown) => void;
  setShowDataWindow: Dispatch<SetStateAction<boolean>>;
  setShowAccountPanel: Dispatch<SetStateAction<boolean>>;
  setDockHeight: Dispatch<SetStateAction<number>>;
  setChartSymbolPicker: Dispatch<SetStateAction<ChartSymbolPickerState | null>>;
  setShowChartProperties: Dispatch<SetStateAction<boolean>>;
  setChartPropsSymbol: Dispatch<SetStateAction<string>>;
  setChartPropsTimeframe: Dispatch<SetStateAction<string>>;
  setChartPropsContextId: Dispatch<SetStateAction<string | undefined>>;
  setChartObjectsTarget: Dispatch<SetStateAction<ChartObjectsTarget | null>>;
}

const findPanel = (container: DockContainer, component: string): DockPanelConfig | null => {
  for (const child of container.children) {
    if ('component' in child && child.component === component) return child;
    if ('children' in child) {
      const found = findPanel(child, component);
      if (found) return found;
    }
  }
  return null;
};

const findContainer = (container: DockContainer, id: string): DockContainer | null => {
  if (container.id === id) return container;
  for (const child of container.children) {
    if (!('children' in child)) continue;
    const found = findContainer(child, id);
    if (found) return found;
  }
  return null;
};

export const useTerminalCommandEvents = ({
  selectedSymbol,
  setSelectedSymbol,
  timeframe,
  setTimeframe,
  chartType,
  setChartType,
  chartEligibleSymbolNames,
  displayToast,
  placeOrder,
  handleOpenDOM,
  handleSaveWorkspace,
  handleOpenDataFolder,
  handlePrintChart,
  getAllowedSymbol,
  getChartEligibleSymbol,
  openOrderPanelForSymbol,
  setShowDataWindow,
  setShowAccountPanel,
  setDockHeight,
  setChartSymbolPicker,
  setShowChartProperties,
  setChartPropsSymbol,
  setChartPropsTimeframe,
  setChartPropsContextId,
  setChartObjectsTarget,
}: UseTerminalCommandEventsOptions): void => {
  useEffect(() => {
    const handlePrintChartEvent = (event: Event) => {
      const request = (event as CustomEvent<PrintChartRequest>).detail;
      void handlePrintChart(request || {});
    };
    const addChart = (requestedSymbol?: string) => {
      const active = getActiveChartCommandTarget(selectedSymbol, timeframe);
      const symbol = getChartEligibleSymbol(requestedSymbol || active.symbol)
        || getChartEligibleSymbol(selectedSymbol)
        || chartEligibleSymbolNames[0];
      if (!symbol) return;
      const result = useDockLayoutStore.getState().addChartPanel({
        symbol,
        timeframe: active.timeframe || timeframe,
        chartType: getDockPanelChartType(useDockLayoutStore.getState().layout, active.targetContextId, chartType),
      });
      if (result.status === 'limit-reached') {
        displayToast(translateUi('Maximum {{limit}} charts are open', { limit: result.limit }), 'error');
        return;
      }
      setSelectedSymbol(symbol);
    };
    const handleRequestChartSymbolChange = (event: CustomEvent<{ panelId?: unknown; anchor?: ChartSymbolAnchor }>) => {
      if (!hasArrangedChartWindows(useDockLayoutStore.getState().layout)) return;
      const panel = findChartPanelById(useDockLayoutStore.getState().layout, event.detail?.panelId);
      if (!panel) return;
      activateChartPanel(panel.id);
      setChartSymbolPicker({
        panelId: panel.id,
        anchor: event.detail?.anchor,
        sessionScope: getCommittedBrokerAccountSessionScopeKey(getCommittedBrokerAccountSessionScope()),
      });
    };
    const handleOpenChart = (event: CustomEvent<{ symbol?: unknown; panelId?: unknown; newWindow?: boolean; newTab?: boolean }>) => {
      const symbol = getChartEligibleSymbol(event.detail?.symbol);
      if (!symbol) return;
      const store = useDockLayoutStore.getState();
      const requestedPanelId = typeof event.detail?.panelId === 'string' ? event.detail.panelId : undefined;
      if (requestedPanelId) {
        if (changeChartPanelSymbol(requestedPanelId, symbol, chartEligibleSymbolNames, timeframe)) setSelectedSymbol(symbol);
        return;
      }
      if (event.detail?.newWindow === true) {
        addChart(symbol);
        return;
      }
      if (event.detail?.newTab === true) {
        const existing = getChartPanels(store.layout).find((panel) => normalizeSymbolName(panel.props?.symbol) === symbol);
        if (existing) {
          activateChartPanel(existing.id);
          setSelectedSymbol(symbol);
          return;
        }
      } else {
        const activePanel = getActiveDockChartPanel();
        if (activePanel && changeChartPanelSymbol(activePanel.id, symbol, chartEligibleSymbolNames, timeframe)) {
          setSelectedSymbol(symbol);
          return;
        }
      }
      addChart(symbol);
    };
    const handleChartSymbolChanged = (event: CustomEvent<{ symbol?: unknown; timeframe?: Timeframe }>) => {
      const chartSymbol = getChartEligibleSymbol(event.detail?.symbol);
      if (chartSymbol) setSelectedSymbol(chartSymbol);
      if (event.detail?.timeframe) setTimeframe(event.detail.timeframe);
    };
    const handleWorkspaceProfileRestored = (event: CustomEvent<{ state?: { chartView?: { dockHeight?: unknown } } }>) => {
      const restoredDockHeight = Number(event.detail?.state?.chartView?.dockHeight);
      if (Number.isFinite(restoredDockHeight) && restoredDockHeight >= 80) setDockHeight(restoredDockHeight);
    };
    const handleTogglePanel = (event: CustomEvent<string>) => {
      const panelType = event.detail;
      // SUI-T15: Insert > Experts/Scripts reveal their bottom-dock tab through
      // the existing dock navigation and never add or remove the Navigator.
      const expertsScriptsTab: Record<string, BottomDockNavigationTab> = {
        Experts: 'Experts',
        Scripts: 'Code Base',
      };
      const expertsScriptsTarget = expertsScriptsTab[panelType];
      if (expertsScriptsTarget) {
        openBottomDockTab(expertsScriptsTarget);
        return;
      }
      const store = useDockLayoutStore.getState();
      const layout = store.layout;
      const existing = findPanel(layout.root, panelType)
        || layout.floatingPanels.map((container) => findPanel(container, panelType)).find(Boolean);
      if (existing) {
        store.removePanel(existing.id);
        return;
      }

      const panelByType: Record<string, DockPanelConfig> = {
        MarketWatch: { id: 'market-watch', title: 'Market Watch', component: 'MarketWatch' },
        Navigator: { id: 'navigator', title: 'Navigator', component: 'Navigator' },
        Terminal: { id: 'toolbox', title: 'Toolbox', component: 'Terminal' },
      };
      const config = panelByType[panelType];
      if (!config) return;
      if (panelType === 'Terminal') {
        store.addPanel({ ...config, ratio: 0.25, closable: true, floatable: true }, 'center-main', 'bottom');
        window.setTimeout(() => {
          const centerMain = findContainer(useDockLayoutStore.getState().layout.root, 'center-main');
          const toolbox = centerMain?.children.find((child) => 'component' in child && child.component === 'Terminal');
          if (toolbox) useDockLayoutStore.getState().updateContainerSize(toolbox.id, 0.25);
        }, 50);
      } else {
        store.addPanel({ ...config, closable: true, floatable: true }, 'root', 'left');
      }
    };
    const handleQuickTrade = (event: CustomEvent<{ side: 'BUY' | 'SELL'; symbol?: unknown }>) => {
      const allowedSymbol = getAllowedSymbol(event.detail?.symbol);
      if (event.detail?.symbol && !allowedSymbol) return;
      if (allowedSymbol) setSelectedSymbol(allowedSymbol);
      // SUI-T8: the Options one-click setting gates the instant path. When it
      // is OFF, route to the New Order ticket instead of placing immediately.
      if (resolveQuickTradeRoute(selectOneClickTrading(useSettingsStore.getState())) === 'confirm') {
        openOrderPanelForSymbol(allowedSymbol || event.detail?.symbol);
        return;
      }
      void placeOrder(event.detail?.side, allowedSymbol || undefined);
    };
    const handleOpenChartProperties = (event: CustomEvent<ChartPropertiesEventDetail>) => {
      setShowChartProperties((visible) => {
        if (visible) return false;
        const activeTarget = getActiveChartCommandTarget();
        const target = resolveChartPropertiesTarget(event.detail, { symbol: selectedSymbol, timeframe });
        setChartPropsSymbol(target.symbol);
        setChartPropsTimeframe(target.timeframe);
        setChartPropsContextId(typeof event.detail?.targetContextId === 'string'
          ? event.detail.targetContextId
          : activeTarget.targetContextId);
        return true;
      });
    };
    const handleOpenChartObjects = (event: Event) => {
      const detail = (event as CustomEvent<{ targetContextId?: unknown; symbol?: unknown; timeframe?: unknown }>).detail;
      const activeTarget = getActiveChartCommandTarget(selectedSymbol, timeframe);
      const targetContextId = typeof detail?.targetContextId === 'string' ? detail.targetContextId : activeTarget.targetContextId;
      const symbol = typeof detail?.symbol === 'string' && detail.symbol.trim()
        ? detail.symbol.trim()
        : (activeTarget.symbol || selectedSymbol);
      const targetTimeframe = typeof detail?.timeframe === 'string' && detail.timeframe.trim()
        ? detail.timeframe.trim()
        : activeTarget.timeframe;
      setChartObjectsTarget((current) => current ? null : {
        targetContextId: targetContextId || null,
        symbol,
        timeframe: targetTimeframe,
      });
    };
    const handleChangeChartType = (event: CustomEvent<{ chartType?: ChartType }>) => {
      const nextChartType = event.detail?.chartType;
      if (!nextChartType || !['candlestick', 'bar', 'line', 'area'].includes(nextChartType)) return;
      setChartType(nextChartType);
      localStorage.setItem('rtx5_chart_type', nextChartType);
    };

    const listeners: Array<[string, EventListener]> = [
      ['saveWorkspace', () => handleSaveWorkspace()],
      ['openDataFolder', () => { void handleOpenDataFolder(); }],
      ['printChart', handlePrintChartEvent],
      ['tileWindows', () => useDockLayoutStore.getState().tileWindows()],
      ['openChart', handleOpenChart as EventListener],
      ['add-chart-panel', () => addChart()],
      ['request-chart-symbol-change', handleRequestChartSymbolChange as EventListener],
      ['openOrderDialog', ((event: CustomEvent<{ symbol?: unknown }>) => openOrderPanelForSymbol(event.detail?.symbol)) as EventListener],
      ['openNewOrder', ((event: CustomEvent<{ symbol?: unknown }>) => openOrderPanelForSymbol(event.detail?.symbol)) as EventListener],
      ['openDepthOfMarket', handleOpenDOM as EventListener],
      ['openDataWindow', () => setShowDataWindow((visible) => !visible)],
      ['openChartProperties', handleOpenChartProperties as EventListener],
      ['open-object-list', handleOpenChartObjects],
      ['toggleAccountPanel', () => setShowAccountPanel((visible) => !visible)],
      ['layout-undo', () => useDockLayoutStore.getState().undo()],
      ['layout-redo', () => useDockLayoutStore.getState().redo()],
      ['chartSymbolChanged', handleChartSymbolChanged as EventListener],
      ['workspace:profile-restored', handleWorkspaceProfileRestored as EventListener],
      ['togglePanel', handleTogglePanel as EventListener],
      ['change-timeframe', ((event: CustomEvent<{ timeframe: Timeframe }>) => setTimeframe(event.detail.timeframe)) as EventListener],
      ['change-chart-type', handleChangeChartType as EventListener],
      ['quickTrade', handleQuickTrade as EventListener],
    ];
    listeners.forEach(([name, listener]) => window.addEventListener(name, listener));
    return () => listeners.forEach(([name, listener]) => window.removeEventListener(name, listener));
  }, [
    chartEligibleSymbolNames,
    chartType,
    displayToast,
    getAllowedSymbol,
    getChartEligibleSymbol,
    handleOpenDOM,
    handleOpenDataFolder,
    handlePrintChart,
    handleSaveWorkspace,
    openOrderPanelForSymbol,
    placeOrder,
    selectedSymbol,
    setChartObjectsTarget,
    setChartPropsContextId,
    setChartPropsSymbol,
    setChartPropsTimeframe,
    setChartSymbolPicker,
    setChartType,
    setDockHeight,
    setSelectedSymbol,
    setShowAccountPanel,
    setShowChartProperties,
    setShowDataWindow,
    setTimeframe,
    timeframe,
  ]);
};
