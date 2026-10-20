import { isDesktopBackendTarget } from './config/backendTarget.js';
import { useGuestMarketData } from './hooks/useGuestMarketData';
import { useBrokerAccountSessionScope } from './hooks/useBrokerAccountSessionScope';
import { useGuestChartLoginContinuity } from './hooks/useGuestChartLoginContinuity';
import { getChartMarketSourceIdentity } from './utils/chartLoginTransition';
import { getLogoUrl, useTerminalBrokerInfo } from './hooks/useTerminalTitle';
import { brokerDisplayName } from './services/brokerDisplayName';
import { applyBrokerChrome } from './services/brokerPresentation';
import { ChartSymbolDropdown } from './components/ChartSymbolDropdown';
import { translateUi } from './hooks/useUiTranslation';
import { feedbackLabel, feedbackValue, feedbackSymbol, type UiMessage } from './utils/uiFeedback';
import { lazy, Suspense, useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { WelcomeTerminal } from './startup/WelcomeTerminalEntry';
import { isElectronRuntime } from './config/backendTarget.js';
import {
  completeTradingAuthentication,
  requireNewOrderAuth,
  TRADING_AUTH_REQUEST_EVENT,
  type TradingAuthIntent,
} from './services/tradingAuthGate';

import { DockWorkspace } from './components/dock/DockWorkspace';
import { TerminalViewport } from './components/layout/TerminalViewport';
import { useDockLayoutStore } from './store/useDockLayoutStore';
import { useDrawingSidebarStore } from './store/useDrawingSidebarStore';
import type { ChartType, Timeframe } from './types/chart';
import { DEFAULT_CHART_SYMBOL, DEFAULT_CHART_TIMEFRAME } from './constants/chartDefaults';
import { ErrorBoundary } from './components/ErrorBoundary';
import { OrderPanelDialog } from './components/OrderPanelDialog';
import { AlertsContainer } from './components/AlertsContainer';
import { getPositionCloseScope, markPositionsClosed, unmarkPositionsClosed, useAppStore, type Account, type Position } from './store/useAppStore';
import { useMarketDataStore } from './store/useMarketDataStore';
import { terminateWorker } from './services/aggregationWorkerManager';
import { refreshAllConnections } from './services/connectionRefresh';
import { captureTradeOrderIntent } from './services/orderLatencyTelemetry';
import { WS_ENDPOINTS } from './config/api';
import { useWebSocket } from './hooks/useWebSocket';
import { useActiveMarketSymbols, useMarketInstruments } from './hooks/useLiveMarketData';
import { getCachedSymbolMarketStatus, useSymbolMarketStatus } from './hooks/useSymbolMarketStatus';
import {
  getUniqueSymbolNames as getAllowedSymbolNames,
  normalizeSymbolName,
  pickPreferredChartSymbol,
  resolveAuthorizedChartSymbol,
} from './utils/symbolEligibility';
import {
  isAccountSymbolUniverseActive,
  resolveChartEligibleSymbolNames,
  resolveTradeEligibleSymbolNames,
} from './utils/accountSymbolUniverse';
import {
  buildChartSelectionReconciliationKey,
  getChartSelectionDiagnosticAttributes,
  getChartSelectionReadinessSnapshot,
  shouldMountChartRuntime,
} from './utils/chartSelectionReadiness';
export {
  normalizeRealtimeTick,
  parseTickPayloads,
} from './features/trading/runtime/marketTickNormalization';
import {
  isAuthenticatedSessionHandoffValid,
  type AuthenticatedSessionHandoff,
} from './startup/authenticatedSessionHandoff';
import { TerminalLoadFallback } from './startup/TerminalLoadFallback';
import { TerminalStartupBoundary } from './startup/TerminalStartupBoundary';

import { useLastSymbolStore } from './store/useLastSymbolStore';
import { resolveOpenOrderTargetSymbol, useSettingsStore } from './store/useSettingsStore';
import { useAutoCloseMonitor } from './hooks/useAutoCloseMonitor';
import { api } from './services/api';
import { normalizeBrokerOperationalConfig, type BrokerOperationalConfig } from './services/brokerOperationalConfig';
import { tradingV2Api } from './api/trade';
import { dispatchTradeOverlayCloseState, type TradeOverlayCloseSnapshotPayload } from './services/tradeOverlayHistory';
import { formatOrderError } from './utils/orderError';
import {
  CHART_POSITION_ACTION_EVENT,
  type ChartPositionActionDetail,
} from './utils/chartTradeControls';
import { getSharedChartTrade } from './utils/tradeShareLink';
import { closePositionsLocalFirst } from './services/localFirstCloseCoordinator';
import { getActiveChartSource } from './services/activeChartSource';
import {
  getCommittedBrokerAccountSessionScope,
  getCommittedBrokerAccountSessionScopeKey,
  onCommittedBrokerAccountSessionScopeChange,
} from './services/brokerSession';
import { ORDER_FEEDBACK_EVENT } from './contracts/terminalEvents';
import {
  createSessionScopedTicketKey,
  createTradeOperationContext,
  isSameTradeOperationContext,
  type TradeOperationContext,
} from './features/trading/session/tradeOperationContext';
import {
  getStoredAuthToken,
  getStoredTokenExpiryMs,
  hasTokenExpiryElapsed,
} from './app/session/authSessionStorage';
import { parsePositiveLogin as parsePositiveInt } from './app/session/sessionIdentity';
import { useAppSessionLifecycle } from './app/session/useAppSessionLifecycle';
import {
  type OptimisticCloseReconcileOptions,
  type RefreshPositionsOptions,
  type TradeRestRead,
} from './app/trading/tradeRuntimeContracts';
import {
  backendCloseProfit,
  buildTradeOverlayCloseSnapshots,
  normalizePositions,
  toV2Timeframe,
} from './app/trading/positionRuntime';
import { publishOrderFeedback, type OrderFeedbackDetail } from './app/trading/orderFeedback';
import { useOrderExecution } from './app/trading/useOrderExecution';
import { useTradeRefreshController } from './app/trading/useTradeRefreshController';
import { FloatingTerminalPanels } from './app/ui/FloatingTerminalPanels';
import { useFloatingTerminalPanels } from './app/ui/useFloatingTerminalPanels';
import { useTradeStreamRuntime } from './app/trading/useTradeStreamRuntime';
import { useAccountSnapshotRuntime } from './app/trading/useAccountSnapshotRuntime';
import {
  useTerminalCommandEvents,
  type ChartObjectsTarget,
  type ChartSymbolPickerState,
  type PrintChartRequest,
} from './app/ui/useTerminalCommandEvents';
import { IndicatorNavigatorHost } from './components/IndicatorNavigatorHost';
import { ChartModifyPositionDialogHost } from './components/ChartModifyPositionDialogHost';

// Layout Components
import { TopToolbar } from './components/layout/TopToolbar';
import { AnnotationEditor } from './drawing-tools/AnnotationEditor';
import { AnnotationTableCellEditor } from './drawing-tools/AnnotationTableCellEditor';
import {
  WebDrawingSelectionToolbar,
  WebDrawingToolsRail,
} from './drawing-tools';
import { StatusBar } from './components/layout/StatusBar';
import { UpdateBanner } from './components/layout/UpdateBanner';
import { ConfirmDialog } from './components/ui/ConfirmDialog';
import { useConfirmStore } from './store/useConfirmStore';
import { useChartSettingsStore } from './store/useChartSettingsStore';
import {
  getActiveChartCommandTarget,
  getPanelIdFromChartContextId,
} from './services/chartCommandTarget';
import { applyChartTimeframeCommand } from './services/chartTimeframeCommand';
import { getDockPanelChartType } from './services/chartTypeCommand';
import { changeChartPanelSymbol, findChartPanelById, getChartPanelSymbolUpdates, requestActiveChartSymbolChange } from './services/chartPanelNavigation';
import { hasArrangedChartWindows } from './utils/chartSymbolTabs';

// Services
import { windowManager, type LayoutMode } from './services/windowManager';

// Command Bus
import { CommandBusProvider } from './contexts/CommandBusContext';
import { commandBus } from './services/commandBus';

// Keyboard Shortcuts
import { KeyboardShortcutProvider } from './contexts/KeyboardShortcutContext';
import { GlobalShortcuts } from './components/GlobalShortcuts';

// Notifications
import { useNotifications } from './hooks/useNotifications';
import { ToastContainer } from './components/notifications/Toast';
import { ActionFeedbackToast, resolveActionFeedbackDurationMs, resolveActionFeedbackTone, type ActionFeedbackNotice, type ActionFeedbackType } from './components/notifications/ActionFeedbackToast';
import { getPositionCloseOutcome, type PositionCloseReport } from './components/notifications/positionCloseReport';
import { useCommittedCallback } from './hooks/useCommittedCallback';
import { LazyLastSymbolPanel, LazyAccountPanel,
  LazyChartPropertiesDialog, LazyChartObjectsDialog, LazySaveWorkspaceDialog,
  LazySymbolsDialog, useTerminalFeatureWarmup } from './startup/terminalFeatures';

const TradeAuthDialog = lazy(() => import('./components/TradeAuthDialog').then(module => ({ default: module.TradeAuthDialog })));

const toSettingsChartType = (chartType: ChartType) => {
  if (chartType === 'bar') return 'Bar' as const;
  if (chartType === 'line') return 'Line' as const;
  if (chartType === 'area') return 'Area' as const;
  return 'Candlesticks' as const;
};

const SELECTED_SYMBOL_STORAGE_KEY = 'rtx5_selected_symbol';

interface AppProps {
  initialSessionHandoff?: AuthenticatedSessionHandoff | null;
  onSessionEnded?: () => void;
}

function App({ initialSessionHandoff = null, onSessionEnded }: AppProps = {}) {
  const guestMarketAccess = !isDesktopBackendTarget();
  const drawingSidebarVisible = useDrawingSidebarStore((state) => state.visible);

  // A fresh handoff exists only in memory and only after WelcomeTerminal has
  // validated the response and committed the token. It is never restored from
  // storage, so hard reloads still use the normal server-validation path.
  const [freshSessionHandoff] = useState(() => (
    isAuthenticatedSessionHandoffValid(initialSessionHandoff, {
      storedToken: getStoredAuthToken(),
    }) ? initialSessionHandoff : null
  ));

  // Mount the SL/TP refresh supervisor; broker/backend owns actual stop execution.
  useAutoCloseMonitor(500);

  // Start closed and restore only after a validated token or active authenticated store session.
  const [isAuthenticated, setIsAuthenticated] = useState(() => {
    const state = useAppStore.getState();
    const expiryMs = state.tokenExpiresAt || getStoredTokenExpiryMs();
    return Boolean(
      freshSessionHandoff ||
      state.isAuthenticated &&
      parsePositiveInt(state.accountId || undefined) &&
      !hasTokenExpiryElapsed(expiryMs)
    );
  });
  const guestMode = !isAuthenticated && !isElectronRuntime();
  const [isAutoAuthenticating, setIsAutoAuthenticating] = useState(() => {
    if (isAuthenticated) return false;
    const state = useAppStore.getState();
    const targetLogin = state.accountId
      || localStorage.getItem('rtx_saved_username')
      || localStorage.getItem('rtx_last_login');
    const token = localStorage.getItem('auth_token') || sessionStorage.getItem('auth_token');
    const refreshToken = localStorage.getItem('refresh_token') || sessionStorage.getItem('refresh_token');
    return Boolean(targetLogin && (token || refreshToken));
  });
  const [initialTradeSnapshotSettledFor, setInitialTradeSnapshotSettledFor] = useState('');
  useGuestMarketData(guestMarketAccess && !isAuthenticated && !isAutoAuthenticating);
  const hasInitialAccountSnapshot = useAppStore(state => state.account !== null);
  const [selectedSymbol, setSelectedSymbol] = useState<string>(DEFAULT_CHART_SYMBOL);
  const [positions, setPositions] = useState<Position[]>([]);
  const [, setAccount] = useState<Account | null>(null);
  const [, setLedger] = useState<any[]>([]);
  const [volume, setVolume] = useState(0.01);
  const [chartType, setChartType] = useState<ChartType>(() => {
    const saved = localStorage.getItem('rtx5_chart_type');
    return (saved as ChartType) || 'candlestick';
  });
  const [timeframe, setTimeframe] = useState<Timeframe>(DEFAULT_CHART_TIMEFRAME);
  const [, setBrokerConfig] = useState<BrokerOperationalConfig | null>(null);
  const [dockHeight, setDockHeight] = useState(() => {
    const saved = localStorage.getItem('dockHeight');
    return saved ? parseInt(saved, 10) : 250;
  });
  const [accountId, setAccountId] = useState<string>(() => freshSessionHandoff?.accountId || '');
  const activeAccountDataRef = useRef<number | null>(null);
  const accountIdRef = useRef(accountId);
  const isAuthenticatedRef = useRef(isAuthenticated);
  const lastObservedAuthTokenRef = useRef<string | null>(getStoredAuthToken());
  const sessionRestoreStartedRef = useRef(false);
  const authSessionGenerationRef = useRef(0);
  const lastTradeWsMessageAtRef = useRef(0);
  const positionsStreamVersionRef = useRef(0);
  const serverClosedTicketsRef = useRef<Set<number>>(new Set());
  const tradeDataVersionRef = useRef(0);
  const localTradeDataVersionRef = useRef(0);
  const optimisticClosedTicketsRef = useRef<Set<number>>(new Set());
  const optimisticClosedTicketsScopeRef = useRef(getPositionCloseScope());
  const activeMarketSnapshot = useActiveMarketSymbols();
  const marketInstrumentsSnapshot = useMarketInstruments(!isAutoAuthenticating);
  const {
    symbols: activeMarketSymbols,
    settled: activeMarketSymbolsSettled,
    current: activeMarketSymbolsCurrent,
  } = activeMarketSnapshot;
  const didApplyLiveChartPreferenceRef = useRef(false);
  const dockLayout = useDockLayoutStore(state => state.layout);
  const [restoredLayoutAccountId, setRestoredLayoutAccountId] = useState('');
  const [hasAppliedLiveChartPreference, setHasAppliedLiveChartPreference] = useState(false);
  const [committedChartSelectionKey, setCommittedChartSelectionKey] = useState('');
  const selectedMarketStatus = useSymbolMarketStatus(selectedSymbol, {
    enabled: (isAuthenticated || guestMode) && Boolean(selectedSymbol),
  });


  useEffect(() => {
    didApplyLiveChartPreferenceRef.current = false;
    setHasAppliedLiveChartPreference(false);
    setCommittedChartSelectionKey('');
  }, [accountId, isAuthenticated]);

  const clearLocalAccountState = useCallback(() => {
    activeAccountDataRef.current = null;
    accountIdRef.current = '';
    isAuthenticatedRef.current = false;
    optimisticClosedTicketsRef.current.clear();
    serverClosedTicketsRef.current.clear();
    setAccount(null);
    setPositions([]);
    setLedger([]);
  }, []);

  const { handleLoginSuccess } = useAppSessionLifecycle({
    freshSessionHandoff,
    isAuthenticated,
    setIsAuthenticated,
    setIsAutoAuthenticating,
    accountId,
    setAccountId,
    accountIdRef,
    isAuthenticatedRef,
    lastObservedAuthTokenRef,
    sessionRestoreStartedRef,
    authSessionGenerationRef,
    clearLocalAccountState,
    onSessionEnded,
  });
  const getLiveTradingLogin = useCallback(() => {
    const state = useAppStore.getState();
    if (!isAuthenticatedRef.current && !state.isAuthenticated) return null;

    const authenticatedStoreLogin = state.isAuthenticated
      ? parsePositiveInt(state.accountId || undefined)
      : null;
    return authenticatedStoreLogin || parsePositiveInt(accountIdRef.current || undefined);
  }, []);

  const getAcceptedChannelLogin = useCallback((channel?: string): number | null => {
    if (!isAuthenticatedRef.current) return null;

    const liveLogin = getLiveTradingLogin();
    if (!liveLogin) return null;

    const match = /^(?:account|metrics|positions|orders|deals)\.([1-9]\d*)$/.exec(channel ?? '');
    if (!match || match[1] !== String(liveLogin)) return null;
    return liveLogin;
  }, [getLiveTradingLogin]);

  const captureTradeOperationContext = useCallback((expectedLogin?: number): TradeOperationContext | null => {
    const login = expectedLogin ?? getLiveTradingLogin();
    if (!login || !isAuthenticatedRef.current) return null;
    return createTradeOperationContext(
      getCommittedBrokerAccountSessionScopeKey(getCommittedBrokerAccountSessionScope()),
      login,
      authSessionGenerationRef.current,
    );
  }, [getLiveTradingLogin]);

  const isTradeOperationContextCurrent = useCallback((expected: TradeOperationContext): boolean => {
    const current = captureTradeOperationContext();
    return isSameTradeOperationContext(expected, current);
  }, [captureTradeOperationContext]);

  const markTradeWsMessage = useCallback(() => {
    lastTradeWsMessageAtRef.current = Date.now();
    tradeDataVersionRef.current += 1;
  }, []);

  const syncOptimisticCloseScope = useCallback(() => {
    const currentScope = getPositionCloseScope();
    if (optimisticClosedTicketsScopeRef.current === currentScope) return;
    optimisticClosedTicketsScopeRef.current = currentScope;
    optimisticClosedTicketsRef.current.clear();
    serverClosedTicketsRef.current.clear();
  }, []);

  const markLocalTradeMutation = useCallback((ticketIds: number[] = []) => {
    syncOptimisticCloseScope();
    tradeDataVersionRef.current += 1;
    localTradeDataVersionRef.current += 1;
    ticketIds.forEach((ticketId) => {
      if (Number.isFinite(ticketId)) {
        optimisticClosedTicketsRef.current.add(ticketId);
      }
    });
    // Closing tickets must not be retained on the chart as "recently opened".
    markPositionsClosed(ticketIds);
  }, [syncOptimisticCloseScope]);

  const clearOptimisticClosedTickets = useCallback((ticketIds: number[], expectedScope: number) => {
    if (expectedScope !== getPositionCloseScope()) return;
    syncOptimisticCloseScope();
    ticketIds.forEach((ticketId) => optimisticClosedTicketsRef.current.delete(ticketId));
    unmarkPositionsClosed(ticketIds, expectedScope);
  }, [syncOptimisticCloseScope]);

  const markServerClosedTickets = useCallback((ticketIds: number[] = []) => {
    syncOptimisticCloseScope();
    ticketIds.forEach((ticketId) => {
      if (Number.isFinite(ticketId)) {
        optimisticClosedTicketsRef.current.add(ticketId);
        serverClosedTicketsRef.current.add(ticketId);
      }
    });
    markPositionsClosed(ticketIds);
  }, [syncOptimisticCloseScope]);

  const reconcileOptimisticClosedPositions = useCallback((normalized: Position[], options: OptimisticCloseReconcileOptions = {}) => {
    syncOptimisticCloseScope();
    normalized = normalized.filter(position => !serverClosedTicketsRef.current.has(position.id));
    const optimisticTickets = optimisticClosedTicketsRef.current;
    if (optimisticTickets.size === 0) return normalized;

    if (options.clearConfirmedAbsent) {
      const returnedTickets = new Set(normalized.map((position) => position.id));
      optimisticTickets.forEach((ticketId) => {
        if (!returnedTickets.has(ticketId)) {
          optimisticTickets.delete(ticketId);
        }
      });
    }

    if (optimisticTickets.size === 0) return normalized;
    return normalized.filter((position) => !optimisticTickets.has(position.id));
  }, [syncOptimisticCloseScope]);

  const beginTradeRestRead = useCallback((): TradeRestRead => ({
    startedAt: Date.now(),
    startedVersion: tradeDataVersionRef.current,
    startedLocalMutationVersion: localTradeDataVersionRef.current,
  }), []);

  const isStaleTradeRestRead = useCallback((request: TradeRestRead, options: RefreshPositionsOptions = {}) => {
    if (localTradeDataVersionRef.current > request.startedLocalMutationVersion) return true;
    if (options.allowWsCommit) return false;
    return lastTradeWsMessageAtRef.current > request.startedAt
      || tradeDataVersionRef.current > request.startedVersion;
  }, []);

  // Sync chart type to localStorage so it applies instantly on next chart open
  useEffect(() => {
    localStorage.setItem('rtx5_chart_type', chartType);
  }, [chartType]);

  // Last Symbol Panel visibility (reactive)
  const lastSymbolPanelVisible = useLastSymbolStore((s) => s.panelVisible);

  // On startup, always hide the LastSymbolPanel — panelVisible is no longer persisted.
  // This clears any stale value left in localStorage from a previous session.
  useEffect(() => {
    useLastSymbolStore.getState().setPanelVisible(false);
  }, []);

  // UI State
  const floatingPanels = useFloatingTerminalPanels(selectedSymbol);
  const {
    showDOM,
    setShowDOM,
    domSymbol,
    openDOM,
    setShowDataWindow,
  } = floatingPanels;
  const [showAccountPanel, setShowAccountPanel] = useState(false);
  const [showChartProperties, setShowChartProperties] = useState(false);
  const [chartPropsSymbol, setChartPropsSymbol] = useState('');
  const [chartPropsTimeframe, setChartPropsTimeframe] = useState('M1');
  const [chartPropsContextId, setChartPropsContextId] = useState<string | undefined>(undefined);
  const [chartObjectsTarget, setChartObjectsTarget] = useState<ChartObjectsTarget | null>(null);

  const allowedSymbolNames = useMemo(
    () => getAllowedSymbolNames(marketInstrumentsSnapshot.authorizedSymbols),
    [marketInstrumentsSnapshot.authorizedSymbols],
  );
  const authenticatedCatalogSymbolSet = useMemo(() => new Set(getAllowedSymbolNames([
    ...marketInstrumentsSnapshot.authorizedSymbols,
    ...marketInstrumentsSnapshot.disabledSymbols,
  ])), [marketInstrumentsSnapshot.authorizedSymbols, marketInstrumentsSnapshot.disabledSymbols]);
  const allSymbols = useMemo(() => marketInstrumentsSnapshot.symbols.filter((instrument) => (
    guestMode || authenticatedCatalogSymbolSet.has(normalizeSymbolName(instrument.symbol))
  )), [guestMode, authenticatedCatalogSymbolSet, marketInstrumentsSnapshot.symbols]);
  const hasLoadedSymbols = guestMode
    ? !marketInstrumentsSnapshot.loading && marketInstrumentsSnapshot.symbols.length > 0
    : marketInstrumentsSnapshot.authorizationSettled;
  const isLoadingSymbols = guestMode ? marketInstrumentsSnapshot.loading : isAuthenticated && !marketInstrumentsSnapshot.authorizationSettled;
  const marketCatalogSymbolNames = useMemo(
    () => getAllowedSymbolNames(marketInstrumentsSnapshot.symbols),
    [marketInstrumentsSnapshot.symbols],
  );
  // A logged-in account's universe is its own group catalogue (the hook
  // returns it as `symbols`, empty while loading). Charts never union the
  // public catalogue or raw feed for an account; guests keep that behaviour.
  const accountSymbolUniverseActive = isAccountSymbolUniverseActive(
    isAuthenticated,
    marketInstrumentsSnapshot.accountCatalogStatus,
  );
  const chartEligibleSymbolNames = useMemo(() => resolveChartEligibleSymbolNames({
    accountUniverseActive: accountSymbolUniverseActive,
    accountSymbols: marketCatalogSymbolNames,
    authorizedSymbols: allowedSymbolNames,
    publicSymbols: marketCatalogSymbolNames,
    activeFeedSymbols: activeMarketSymbols,
  }), [accountSymbolUniverseActive, activeMarketSymbols, allowedSymbolNames, marketCatalogSymbolNames]);
  const tradeEligibleSymbolNames = useMemo(() => resolveTradeEligibleSymbolNames({
    isAuthenticated,
    feedCurrent: activeMarketSymbolsCurrent,
    authorizedSymbols: allowedSymbolNames,
    activeFeedSymbols: activeMarketSymbols,
  }), [activeMarketSymbols, activeMarketSymbolsCurrent, allowedSymbolNames, isAuthenticated]);
  const chartEligibleSymbolsKey = chartEligibleSymbolNames.join(',');
  const chartSessionScope = useBrokerAccountSessionScope();
  const guestChartLoginContinuity = useGuestChartLoginContinuity({
    enabled: guestMarketAccess,
    sessionScope: chartSessionScope,
    marketSource: getChartMarketSourceIdentity(),
    guestReady: guestMode && (hasLoadedSymbols || marketCatalogSymbolNames.length > 0),
    accountCatalogPending: marketInstrumentsSnapshot.accountCatalogStatus === 'loading',
    layout: dockLayout,
    chartSymbols: chartEligibleSymbolNames,
    selectedSymbol,
    timeframe,
  });
  const chartEligibleSymbolSet = useMemo(() => new Set(chartEligibleSymbolNames), [chartEligibleSymbolNames]);
  const tradeEligibleSymbolSet = useMemo(() => new Set(tradeEligibleSymbolNames), [tradeEligibleSymbolNames]);
  // While an account catalogue loads, no public/feed symbol may seed chart
  // selection or rewrite saved chart panels.
  const hasLoadedChartSymbols = accountSymbolUniverseActive
    ? chartEligibleSymbolNames.length > 0 || marketInstrumentsSnapshot.authorizationSettled
    : hasLoadedSymbols
      || marketCatalogSymbolNames.length > 0
      || (activeMarketSymbolsCurrent && activeMarketSymbols.length > 0);
  const hasLoadedTradeSymbols = activeMarketSymbolsSettled
    && activeMarketSymbolsCurrent
    && (hasLoadedSymbols || activeMarketSymbols.length > 0);

  const getAllowedSymbol = useCallback((symbol: unknown): string => {
    const normalized = normalizeSymbolName(symbol);
    if (!normalized || !hasLoadedTradeSymbols || tradeEligibleSymbolNames.length === 0) return '';
    return tradeEligibleSymbolSet.has(normalized) ? normalized : '';
  }, [hasLoadedTradeSymbols, tradeEligibleSymbolNames.length, tradeEligibleSymbolSet]);

  const getChartEligibleSymbol = useCallback((symbol: unknown): string => {
    if (!hasLoadedChartSymbols || chartEligibleSymbolNames.length === 0) return '';
    return resolveAuthorizedChartSymbol(symbol, chartEligibleSymbolNames);
  }, [chartEligibleSymbolNames, hasLoadedChartSymbols]);

  // Market Watch replaces the last clicked pane and retains its timeframe/type.
  const handleSymbolSelect = useCallback((symbol: string) => {
    const chartSymbol = getChartEligibleSymbol(symbol);
    if (!chartSymbol) return;
    setSelectedSymbol(chartSymbol);
    requestActiveChartSymbolChange(chartSymbol);
  }, [getChartEligibleSymbol]);

  // A `#share=` deep link opens the shared trade's chart: switch to its
  // symbol and timeframe once the account's symbol list is available. The
  // chart itself draws the shared trade annotation from the same URL payload.
  const sharedTradeLinkAppliedRef = useRef(false);
  useEffect(() => {
    if (sharedTradeLinkAppliedRef.current || !isAuthenticated || !hasLoadedChartSymbols
      || !accountId || restoredLayoutAccountId !== accountId) return;
    const sharedTrade = getSharedChartTrade();
    if (!sharedTrade) return;
    sharedTradeLinkAppliedRef.current = true;
    const validTimeframes: Timeframe[] = ['M1', 'M5', 'M15', 'M30', 'H1', 'H4', 'D1', 'W1', 'MN'];
    if ((validTimeframes as string[]).includes(sharedTrade.timeframe)) {
      setTimeframe(sharedTrade.timeframe as Timeframe);
    }
    handleSymbolSelect(sharedTrade.symbol);
  }, [accountId, handleSymbolSelect, hasLoadedChartSymbols, isAuthenticated, restoredLayoutAccountId]);

  // Multi-Chart State (Now managed by DockManager)
  useEffect(() => {
    // Sync selected symbol to persistence
    if (!hasLoadedChartSymbols) return;
    const normalizedSelectedSymbol = normalizeSymbolName(selectedSymbol);
    if (normalizedSelectedSymbol && chartEligibleSymbolSet.has(normalizedSelectedSymbol)) {
      localStorage.setItem(SELECTED_SYMBOL_STORAGE_KEY, normalizedSelectedSymbol);
    } else {
      localStorage.removeItem(SELECTED_SYMBOL_STORAGE_KEY);
    }
  }, [chartEligibleSymbolSet, hasLoadedChartSymbols, selectedSymbol]);

  useEffect(() => {
    localStorage.setItem('rtx5_timeframe', timeframe);
  }, [timeframe]);

  useEffect(() => {
    localStorage.setItem('rtx5_chart_type', chartType);
  }, [chartType]);

  // Bridge command bus SET_CHART_TYPE / SET_TIMEFRAME to React state
  useEffect(() => {
    const unsub1 = commandBus.subscribe('SET_CHART_TYPE' as any, (payload: any) => {
      const ct = payload?.chartType;
      if (ct && ['candlestick', 'bar', 'line', 'area'].includes(ct)) {
        const runtimeChartType = ct as ChartType;
        const activeTarget = getActiveChartCommandTarget();
        const targetContextId = payload?.targetContextId ?? activeTarget.targetContextId;
        const targetPanelId = getPanelIdFromChartContextId(targetContextId);
        const targetSymbol = payload?.symbol ?? activeTarget.symbol;

        console.log('[App] Command bus SET_CHART_TYPE ->', runtimeChartType, targetContextId ?? 'global');
        if (targetPanelId) {
          useDockLayoutStore.getState().updatePanelProps(targetPanelId, {
            props: { chartType: runtimeChartType },
          });
        } else {
          setChartType(runtimeChartType);
        }

        const settingsStore = useChartSettingsStore.getState();
        if (targetSymbol) {
          settingsStore.updateSymbolProperty(targetSymbol, 'chartType', toSettingsChartType(runtimeChartType));
        } else {
          settingsStore.updateGlobalProperty('chartType', toSettingsChartType(runtimeChartType));
        }
      }
    });
    const unsub2 = commandBus.subscribe('SET_TIMEFRAME' as any, (payload: any) => {
      applyChartTimeframeCommand(payload, setTimeframe);
    });
    return () => { unsub1(); unsub2(); };
  }, []);

  // Order Panel State
  const [orderPanelOpen, setOrderPanelOpen] = useState(false);
  const [orderPanelSymbol, setOrderPanelSymbol] = useState('');
  const [orderPanelPrice, setOrderPanelPrice] = useState({ bid: 0, ask: 0 });
  const [tradeAuthOpen, setTradeAuthOpen] = useState(false);
  const [pendingTradeIntent, setPendingTradeIntent] = useState<TradingAuthIntent | null>(null);

  useEffect(() => {
    (window as Window & { __RTX_APP_ACTIVE__?: boolean }).__RTX_APP_ACTIVE__ = true;
    const handleTradingAuthRequest = (event: Event) => {
      const intent = (event as CustomEvent<TradingAuthIntent>).detail;
      setPendingTradeIntent(intent || null);
      setTradeAuthOpen(true);
    };
    const handleGeneralLoginRequest = () => {
      setPendingTradeIntent(null);
      setTradeAuthOpen(true);
    };
    window.addEventListener(TRADING_AUTH_REQUEST_EVENT, handleTradingAuthRequest);
    window.addEventListener('rtx:openTradeAuth', handleGeneralLoginRequest);
    window.addEventListener('rtx:openLoginDialog', handleGeneralLoginRequest);
    window.addEventListener('rtx:requestTradeLogin', handleGeneralLoginRequest);
    return () => {
      delete (window as Window & { __RTX_APP_ACTIVE__?: boolean }).__RTX_APP_ACTIVE__;
      window.removeEventListener(TRADING_AUTH_REQUEST_EVENT, handleTradingAuthRequest);
      window.removeEventListener('rtx:openTradeAuth', handleGeneralLoginRequest);
      window.removeEventListener('rtx:openLoginDialog', handleGeneralLoginRequest);
      window.removeEventListener('rtx:requestTradeLogin', handleGeneralLoginRequest);
    };
  }, []);

  const handleTradeAuthClose = useCallback(() => {
    setTradeAuthOpen(false);
    setPendingTradeIntent(null);
  }, []);

  const handleTradeAuthenticated = useCallback((nextAccountId: string) => {
    completeTradingAuthentication(nextAccountId, pendingTradeIntent, {
      login: handleLoginSuccess,
      closeDialog: () => setTradeAuthOpen(false),
      clearIntent: () => setPendingTradeIntent(null),
      openOrderDraft: (intent) => {
        localStorage.setItem('lastLotSize', String(intent.volume));
        setOrderPanelSymbol(intent.symbol);
        setOrderPanelPrice({ bid: intent.bid || 0, ask: intent.ask || 0 });
        setOrderPanelOpen(true);
      },
    });
  }, [handleLoginSuccess, pendingTradeIntent]);

  // Layout Management
  const [, setLayoutMode] = useState<LayoutMode>('single');

  const wsRef = useRef<WebSocket | null>(null);
  const reconnectCallbackRef = useRef<(() => void) | null>(null);

  // Notifications
  const { activeToasts } = useNotifications({ wsConnection: wsRef.current });
  // PERFORMANCE FIX: Removed global ticks subscription to prevent root re-renders
  // Access ticks via useAppStore.getState().ticks inside event handlers instead.

  // Persist dock height
  useEffect(() => {
    localStorage.setItem('dockHeight', dockHeight.toString());
  }, [dockHeight]);

  // Persist timeframe selection
  useEffect(() => {
    localStorage.setItem('rtx5_timeframe', timeframe);
  }, [timeframe]);

  // Redundant persistence blocks removed (handled above)

  // Handle Escape key for closing order panel
  useEffect(() => {
    const handleCloseModal = () => {
      if (orderPanelOpen) {
        setOrderPanelOpen(false);
      }
    };

    window.addEventListener('close-modal', handleCloseModal);
    return () => window.removeEventListener('close-modal', handleCloseModal);
  }, [orderPanelOpen]);

  // Menus and registered keyboard shortcuts share the active chart action.
  useEffect(() => {
    const handleCloseActiveChart = () => {
      const activeSource = getActiveChartSource();
      const currentSymbol = activeSource?.symbol || useAppStore.getState().selectedSymbol;
      useDockLayoutStore.getState().closeActiveChart(currentSymbol, getPanelIdFromChartContextId(activeSource?.id) || undefined);
    };

    window.addEventListener('close-active-chart', handleCloseActiveChart);

    return () => {
      window.removeEventListener('close-active-chart', handleCloseActiveChart);
    };
  }, []);

  // Handle global menu actions


  // Subscribe to layout mode changes
  useEffect(() => {
    const unsubscribe = windowManager.subscribe((mode) => {
      setLayoutMode(mode);
    });
    return unsubscribe;
  }, []);

  // Every launch opens the shipped default arrangement on BTCUSD M1 in web
  // and desktop builds. Account switches reset the panes and selection; a
  // same-source guest login keeps the public chart already on the screen.
  // Saved per-account layouts are neither restored nor auto-saved at startup.
  useEffect(() => {
    // A same-source guest login keeps its existing chart hosts and selection.
    // A new launch, account switch or changed broker still opens the defaults.
    if (!guestChartLoginContinuity.preserveGuestLayout) {
      useDockLayoutStore.getState().resetToDefaultLayout();
      setSelectedSymbol(DEFAULT_CHART_SYMBOL);
      setTimeframe(DEFAULT_CHART_TIMEFRAME);
    }

    if (!isAuthenticated || !accountId) {
      setRestoredLayoutAccountId('');
      return;
    }

    setRestoredLayoutAccountId('');
    setRestoredLayoutAccountId(accountId);
  }, [isAuthenticated, accountId]);

  // Broker config — operating values come from the broker's own
  // /api/v2/broker/config document (white-label: no per-broker literals in
  // code). Neutral values apply until the broker config arrives or when it
  // is unavailable.
  useEffect(() => {
    let active = true;
    api.config.getConfig()
      .then((config) => { if (active) setBrokerConfig(normalizeBrokerOperationalConfig(config)); })
      .catch(() => { if (active) setBrokerConfig(normalizeBrokerOperationalConfig(null)); });
    return () => { active = false; };
  }, []);

  const {
    refreshPositions,
    refreshOrdersAndHistory,
  } = useTradeRefreshController({
    getLiveTradingLogin,
    beginTradeRestRead,
    isStaleTradeRestRead,
    reconcileOptimisticClosedPositions,
    accountIdRef,
    isAuthenticatedRef,
    positionsStreamVersionRef,
  });


  const closingTicketsRef = useRef<Set<string>>(new Set());
  const bulkCloseInFlightScopesRef = useRef<Set<string>>(new Set());

  const handleClosePosition = async (
    id: number,
    { showFailureFeedback = true }: { showFailureFeedback?: boolean } = {},
  ): Promise<boolean> => {
    const closeLogin = getLiveTradingLogin();
    const closeSessionScope = getCommittedBrokerAccountSessionScopeKey(
      getCommittedBrokerAccountSessionScope(),
    );
    if (!closeLogin) {
      if (showFailureFeedback) {
        publishOrderFeedback(
          [feedbackLabel('Close position'), feedbackValue(` #${id}: `), feedbackLabel('Failed'), feedbackValue(' — No trading account is selected. Please sign in again.')],
          'error',
        );
      }
      return false;
    }
    const closeTicketKey = createSessionScopedTicketKey(closeSessionScope, id);
    // Guard against double-click: skip if already closing this ticket
    if (closingTicketsRef.current.has(closeTicketKey)) {
      console.log(`[App] Close already in progress for ticket ${id}, skipping duplicate`);
      return false;
    }
    closingTicketsRef.current.add(closeTicketKey);

    const closingPositions = useAppStore.getState().positions.filter((position) => position.id === id) as Position[];
    const closeSnapshots = buildTradeOverlayCloseSnapshots(closingPositions);
    const closeMarkerScope = getPositionCloseScope();
    const isCurrentCloseSession = () => Boolean(
      closeLogin
      && isAuthenticatedRef.current
      && getLiveTradingLogin() === closeLogin
      && getPositionCloseScope() === closeMarkerScope
      && getCommittedBrokerAccountSessionScopeKey(getCommittedBrokerAccountSessionScope()) === closeSessionScope
    );
    const publishSingleCloseFailure = (failureReason: string) => {
      if (!showFailureFeedback) return;
      publishOrderFeedback(
        [feedbackLabel('Close position'), feedbackValue(` #${id}: `), feedbackLabel('Failed'), feedbackValue(failureReason ? ` — ${failureReason}` : '')],
        'error',
      );
    };

    // Give immediate execution feedback without weakening broker truth: hide
    // the pending ticket now, then restore it if the correlated close rejects.
    markLocalTradeMutation([id]);
    dispatchTradeOverlayCloseState([id], 'pending', { snapshots: closeSnapshots });
    useAppStore.getState().setPositions(
      useAppStore.getState().positions.filter((position) => position.id !== id),
      { removedTickets: [id] },
    );

    try {
      await api.positions.closePosition(String(id), { account_login: closeLogin });
      if (!isCurrentCloseSession()) {
        clearOptimisticClosedTickets([id], closeMarkerScope);
        return false;
      }
      // Backend confirmed: convert the optimistic removal into a tombstone so
      // a lagging position snapshot cannot restore the closed ticket.
      useAppStore.getState().setPositions(useAppStore.getState().positions, { closedTickets: [id] });
      dispatchTradeOverlayCloseState([id], 'confirmed', { snapshots: closeSnapshots });
      import('./utils/audio').then(m => m.playSystemSound('close'));
      const loginId = closeLogin;
      refreshPositions(loginId, { allowWsCommit: true });
      refreshOrdersAndHistory(loginId).catch(err => console.error('[Trade] Failed to refresh orders/history after close:', err));
      return true;
    } catch (err: any) {
      console.error('Failed to close position:', err);
      clearOptimisticClosedTickets([id], closeMarkerScope);
      const sessionCurrent = isCurrentCloseSession();
      if (sessionCurrent) {
        dispatchTradeOverlayCloseState([id], 'failed');
        const store = useAppStore.getState();
        const existingTickets = new Set(store.positions.map((position) => position.id));
        const restoredPositions = closingPositions.filter((position) => !existingTickets.has(position.id));
        if (restoredPositions.length > 0) store.setPositions([...store.positions, ...restoredPositions]);
        publishSingleCloseFailure(formatOrderError(err));
        refreshPositions(closeLogin, { allowWsCommit: true });
      }
      return false;
    } finally {
      closingTicketsRef.current.delete(closeTicketKey);
    }
  };

  // ── cTrader-style chart position actions (reverse / double / close) ──
  const chartPositionActionBusyRef = useRef<Set<string>>(new Set());

  const handleReversePosition = async (ticket: number) => {
    const position = (useAppStore.getState().positions as Position[])
      .find((candidate) => Number(candidate.id) === ticket);
    if (!position) return;
    const login = getLiveTradingLogin();
    if (!login) {
      publishOrderFeedback('No trading account is selected. Please sign in again.');
      return;
    }
    const operationContext = captureTradeOperationContext(login);
    if (!operationContext) return;
    const actionKey = createSessionScopedTicketKey(operationContext.sessionScope, ticket);
    if (chartPositionActionBusyRef.current.has(actionKey)) return;
    const intentAtMs = captureTradeOrderIntent();
    const reverseSide = position.side === 'BUY' ? 'sell' : 'buy';
    const { symbol: positionSymbol, volume: positionVolume } = position;
    chartPositionActionBusyRef.current.add(actionKey);
    try {
      const closed = await handleClosePosition(ticket, { showFailureFeedback: false });
      if (!closed) {
        publishOrderFeedback([feedbackLabel('Close position'), feedbackValue(` #${ticket}: `), feedbackLabel('Failed'), feedbackValue(' · '), feedbackLabel(reverseSide === 'buy' ? 'Buy Market' : 'Sell Market'), feedbackValue(': '), feedbackLabel('cancelled')]);
        return;
      }
      await api.orders.placeMarketOrder({
        side: reverseSide,
        symbol: positionSymbol,
        volume: positionVolume,
        login,
      }, { intentAtMs });
      if (!isTradeOperationContextCurrent(operationContext)) return;
      publishOrderFeedback(
        [feedbackLabel('Close position'), feedbackValue(` #${ticket}: `), feedbackLabel('Completed'), feedbackValue(' · '), feedbackLabel(reverseSide.toUpperCase()), feedbackValue(` ${positionVolume} ${positionSymbol}`)],
        'success',
      );
      window.dispatchEvent(new Event('rtx:force-refresh-positions'));
    } catch (err) {
      console.error('[Chart] Reverse position failed:', err);
      publishOrderFeedback([feedbackLabel('Close position'), feedbackValue(` #${ticket}: `), feedbackLabel('Completed'), feedbackValue(' · '), feedbackLabel(reverseSide === 'buy' ? 'Buy Market' : 'Sell Market'), feedbackValue(': '), feedbackLabel('Order failed'), feedbackValue(` — ${formatOrderError(err)}`)]);
      window.dispatchEvent(new Event('rtx:force-refresh-positions'));
    } finally {
      chartPositionActionBusyRef.current.delete(actionKey);
    }
  };

  const handleDoublePosition = async (ticket: number) => {
    const position = (useAppStore.getState().positions as Position[])
      .find((candidate) => Number(candidate.id) === ticket);
    if (!position) return;
    const login = getLiveTradingLogin();
    if (!login) {
      publishOrderFeedback('No trading account is selected. Please sign in again.');
      return;
    }
    const operationContext = captureTradeOperationContext(login);
    if (!operationContext) return;
    const actionKey = createSessionScopedTicketKey(operationContext.sessionScope, ticket);
    if (chartPositionActionBusyRef.current.has(actionKey)) return;
    const intentAtMs = captureTradeOrderIntent();
    chartPositionActionBusyRef.current.add(actionKey);
    try {
      await api.orders.placeMarketOrder({
        side: position.side === 'SELL' ? 'sell' : 'buy',
        symbol: position.symbol,
        volume: position.volume,
        login,
      }, { intentAtMs });
      if (!isTradeOperationContextCurrent(operationContext)) return;
      publishOrderFeedback(
        [feedbackValue(`#${ticket} · `), feedbackLabel(position.side), feedbackValue(` +${position.volume} ${position.symbol} · `), feedbackLabel('Completed')],
        'success',
      );
      window.dispatchEvent(new Event('rtx:force-refresh-positions'));
    } catch (err) {
      console.error('[Chart] Double position failed:', err);
      publishOrderFeedback(formatOrderError(err));
    } finally {
      chartPositionActionBusyRef.current.delete(actionKey);
    }
  };

  const chartPositionActionHandlerRef = useRef<(detail: ChartPositionActionDetail) => void>(() => { });
  chartPositionActionHandlerRef.current = (detail) => {
    const ticket = Number(detail?.ticket);
    if (!Number.isFinite(ticket) || ticket <= 0) return;
    if (detail.action === 'close') {
      void handleClosePosition(ticket);
    } else if (detail.action === 'reverse') {
      void handleReversePosition(ticket);
    } else if (detail.action === 'double') {
      void handleDoublePosition(ticket);
    }
  };

  useEffect(() => {
    const handleChartPositionAction = (event: Event) => {
      chartPositionActionHandlerRef.current((event as CustomEvent<ChartPositionActionDetail>).detail);
    };
    window.addEventListener(CHART_POSITION_ACTION_EVENT, handleChartPositionAction);
    return () => window.removeEventListener(CHART_POSITION_ACTION_EVENT, handleChartPositionAction);
  }, []);

  const handleCancelOrder = async (orderId: string) => {
    if (!(await useConfirmStore.getState().showConfirm(translateUi('Cancel'), `${translateUi('pending order')} #${orderId}?`))) return;
    try {
      const loginId = getLiveTradingLogin();
      if (!loginId) return;

      await api.orders.cancelOrder(orderId);
      const ordersPayload = await api.orders.getPendingOrders(loginId).catch(() => []);
      if (!isAuthenticatedRef.current || getLiveTradingLogin() !== loginId) return;

      useAppStore.getState().setOrders(ordersPayload as any);
    } catch (err) {
      console.error('Failed to cancel order:', err);
    }
  };

  const handleModifyPosition = async (id: number, sl: number, tp: number) => {
    const position = (useAppStore.getState().positions as Position[])
      .find((candidate) => candidate.id === id)
      ?? positions.find((candidate) => candidate.id === id);
    if (!position || !getAllowedSymbol(position.symbol)) return;

    try {
      await tradingV2Api.modifyPosition(id, {
        price_sl: sl,
        price_tp: tp,
      });
      // Refresh positions so chart draws the new SL/TP lines
      refreshPositions(getLiveTradingLogin() || undefined);
    } catch (err: any) {
      console.error('Failed to modify position:', err);
    }
  };

  const handleCloseBulk = async (type: 'ALL' | 'WINNERS' | 'LOSERS', symbol?: string) => {
    const accId = getLiveTradingLogin();
    if (!accId) return;
    const closeMarkerScope = getPositionCloseScope();
    const closeSessionScope = getCommittedBrokerAccountSessionScopeKey(
      getCommittedBrokerAccountSessionScope(),
    );
    if (bulkCloseInFlightScopesRef.current.has(closeSessionScope)) return;

    const localCandidates = normalizePositions(useAppStore.getState().positions).filter((position) => {
      if (!(position.id > 0)) return false;
      if (symbol && position.symbol !== symbol) return false;
      if (type === 'ALL') return true;
      const profit = backendCloseProfit(position);
      if (profit === null) return false;
      return type === 'WINNERS' ? profit > 0 : profit < 0;
    });
    if (localCandidates.length === 0) return;

    bulkCloseInFlightScopesRef.current.add(closeSessionScope);

    const claimedBulkTicketIds: number[] = [];
    const closeSnapshotsByTicket = new Map<number, TradeOverlayCloseSnapshotPayload[]>();
    const closeCandidatesByTicket = new Map<number, Position>();
    try {
      const getCurrentCloseSessionKey = () => {
        if (!isAuthenticatedRef.current || getLiveTradingLogin() !== accId
          || getPositionCloseScope() !== closeMarkerScope) return null;
        return getCommittedBrokerAccountSessionScopeKey(getCommittedBrokerAccountSessionScope());
      };
      const selectMatchingCandidates = (openPositions: readonly Position[]) => openPositions.filter((position) => {
        if (!(position.id > 0)) return false;
        if (symbol && position.symbol !== symbol) return false;
        if (type === 'ALL') return true;
        const profit = backendCloseProfit(position);
        if (profit === null) return false;
        return type === 'WINNERS' ? profit > 0 : profit < 0;
      });

      const closeResult = await closePositionsLocalFirst({
        sessionKey: closeSessionScope,
        getCurrentSessionKey: getCurrentCloseSessionKey,
        localCandidates,
        loadAuthoritativeCandidates: async () => selectMatchingCandidates(normalizePositions(await tradingV2Api
          .getPositions(accId, { limit: 500, offset: 0 })
          .catch(() => api.positions.getPositions(accId) as any))),
        closePosition: (ticketId) => api.positions.closePosition(String(ticketId), { account_login: accId }),
        tryClaimTicket: (ticketId) => {
          const ticketKey = createSessionScopedTicketKey(closeSessionScope, ticketId);
          if (closingTicketsRef.current.has(ticketKey)) return false;
          closingTicketsRef.current.add(ticketKey);
          claimedBulkTicketIds.push(ticketId);
          return true;
        },
        // Remove every claimed row immediately. The close coordinator still
        // waits for correlated backend confirmation and restores rejections.
        onCandidatesStarted: (candidates) => {
          if (getCurrentCloseSessionKey() !== closeSessionScope) return;
          const ticketIds = candidates.map((position) => position.id);
          candidates.forEach((position) => {
            closeCandidatesByTicket.set(position.id, position);
            closeSnapshotsByTicket.set(position.id, buildTradeOverlayCloseSnapshots([position]));
          });
          markLocalTradeMutation(ticketIds);
          dispatchTradeOverlayCloseState(ticketIds, 'pending', {
            snapshots: buildTradeOverlayCloseSnapshots(candidates),
          });
          const ticketSet = new Set(ticketIds);
          useAppStore.getState().setPositions(
            useAppStore.getState().positions.filter((position) => !ticketSet.has(position.id)),
            { removedTickets: ticketIds },
          );
        },
        // Convert each pending row into a durable closed-ticket tombstone as
        // soon as that ticket receives correlated terminal confirmation.
        onTicketConfirmed: (ticketId) => {
          if (getCurrentCloseSessionKey() !== closeSessionScope) return;
          useAppStore.getState().setPositions(useAppStore.getState().positions, { closedTickets: [ticketId] });
          dispatchTradeOverlayCloseState([ticketId], 'confirmed', {
            snapshots: closeSnapshotsByTicket.get(ticketId),
          });
        },
      });

      if (!closeResult.sessionCurrent) {
        clearOptimisticClosedTickets(closeResult.attemptedTicketIds, closeMarkerScope);
        return;
      }

      if (closeResult.attemptedTicketIds.length === 0) {
        if (closeResult.authoritativeSnapshotError) throw closeResult.authoritativeSnapshotError;
        publishOrderFeedback(
          closeResult.skippedTicketIds.length > 0
            ? [feedbackLabel('Close positions'), feedbackValue(': '), feedbackLabel('Closing positions')]
            : [feedbackLabel('Close positions'), feedbackValue(': '), feedbackLabel('No matches found')],
        );
        refreshPositions(accId, { allowWsCommit: true });
        return;
      }

      const { confirmedTicketIds, failedTicketIds, failedReasons } = closeResult;

      if (failedTicketIds.length > 0) {
        const failureMessage = formatOrderError(failedReasons[0]);
        clearOptimisticClosedTickets(failedTicketIds, closeMarkerScope);
        dispatchTradeOverlayCloseState(failedTicketIds, 'failed');
        const store = useAppStore.getState();
        const existingTickets = new Set(store.positions.map((position) => position.id));
        const restoredPositions = failedTicketIds
          .map((ticketId) => closeCandidatesByTicket.get(ticketId))
          .filter((position): position is Position => position !== undefined && !existingTickets.has(position.id));
        if (restoredPositions.length > 0) store.setPositions([...store.positions, ...restoredPositions]);
        console.error(`Bulk close failed for ${failedTicketIds.length} position(s):`, failedReasons[0]);
        publishOrderFeedback(
          [feedbackLabel('Positions'), feedbackValue(': '), feedbackLabel('closed'), feedbackValue(` ${confirmedTicketIds.length}/${closeResult.attemptedTicketIds.length} · `), feedbackLabel('Failed'), feedbackValue(`: ${failedTicketIds.length} — ${failureMessage}`)],
          'error',
        );
      }
      if (closeResult.authoritativeSnapshotError) {
        console.warn('[Trade] Closed visible positions, but authoritative discovery failed:', closeResult.authoritativeSnapshotError);
      }
      refreshPositions(accId, { allowWsCommit: true });
      refreshOrdersAndHistory(accId).catch(err => console.error('[Trade] Failed to refresh orders/history after bulk close:', err));
    } catch (err) {
      console.error('Bulk close failed:', err);
      publishOrderFeedback(formatOrderError(err));
      refreshPositions(getLiveTradingLogin() || undefined, { allowWsCommit: true });
    } finally {
      claimedBulkTicketIds.forEach((ticket) => closingTicketsRef.current.delete(
        createSessionScopedTicketKey(closeSessionScope, ticket),
      ));
      bulkCloseInFlightScopesRef.current.delete(closeSessionScope);
    }
  };

  // Connect to WebSocket using centralized hook with auto-reconnection
  const {
    isConnected,
    connectionState,
    reconnect,
    subscribe
  } = useWebSocket({
    url: WS_ENDPOINTS.general,
    autoConnect: isAuthenticated,
  });
  // T12: FULL reconnect for every caller (toolbar + Network Rescan). Each
  // transport reuses its own existing reconnect/refresh entry point.
  const refreshDesktopConnection = useCallback(() => {
    refreshAllConnections({
      reconnectTradeStream: reconnect,
      reloadMarketSnapshot: () => activeMarketSnapshot.reload(),
    });
  }, [activeMarketSnapshot.reload, reconnect]);
  const previousTradeConnectionStateRef = useRef(connectionState);

  useEffect(() => {
    const previousState = previousTradeConnectionStateRef.current;
    previousTradeConnectionStateRef.current = connectionState;
    if (previousState !== 'connected' && connectionState === 'connected') {
      window.dispatchEvent(new Event('rtx:trade-stream-recovered'));
    }
  }, [connectionState]);

  useAccountSnapshotRuntime({
    isAuthenticated,
    accountId,
    accountIdRef,
    isAuthenticatedRef,
    activeAccountDataRef,
    optimisticClosedTicketsRef,
    serverClosedTicketsRef,
    positionsStreamVersionRef,
    beginTradeRestRead,
    isStaleTradeRestRead,
    reconcileOptimisticClosedPositions,
    refreshOrdersAndHistory,
    refreshPositions,
    setInitialTradeSnapshotSettledFor,
  });


  // NOTE: positions are now written directly to useAppStore in the polling above.
  // No sync useEffect needed — removed to prevent double-write cascade.


  // PERFORMANCE FIX: Removed tick buffer for immediate updates (MT5 parity - <5ms latency)
  // const tickBuffer = useRef<Record<string, Tick>>({});



  // Network Rescan (StatusBar) performs the same FULL reconnect as the toolbar.
  useEffect(() => {
    reconnectCallbackRef.current = refreshDesktopConnection;
  }, [refreshDesktopConnection]);

  // Log connection state changes
  useEffect(() => {
    console.log(`[App] WebSocket connection state: ${connectionState}, isConnected: ${isConnected}`);
  }, [connectionState, isConnected]);

  // Keep only the selected chart's singular v2 channels here. Market Watch owns
  // visible-row quote demand through QuoteSocketManager batch subscriptions.
  useEffect(() => {
    console.log(`[WS Subscription Effect] isAuthenticated=${isAuthenticated}, isConnected=${isConnected}`);
    if (!isAuthenticated || !isConnected) {
      console.log('[WS Subscription Effect] Skipping - not authenticated or not connected');
      return;
    }

    const unsubscribers: Array<() => void> = [];

    // FIX: The rendered/active chart is the subscription authority. The
    // persisted Market Watch selection can legitimately differ after workspace
    // restore, and subscribing that stale value leaves the visible chart on a
    // different symbol from the authenticated market socket.
    const activeChartTarget = getActiveChartCommandTarget(selectedSymbol, timeframe);
    const selected = normalizeSymbolName(activeChartTarget.symbol);
    const selectedTimeframe = activeChartTarget.timeframe || timeframe;
    if (!selected || !chartEligibleSymbolsKey.split(',').includes(selected)) return;

    console.log(`[WS] Syncing selected chart subscriptions for ${selected}`);

    try {
      unsubscribers.push(subscribe(`ticks.${selected}`, () => undefined));
      useMarketDataStore.getState().subscribeSymbol(selected);
      unsubscribers.push(subscribe(`candles.${selected}.${toV2Timeframe(selectedTimeframe)}`, () => undefined));
      unsubscribers.push(subscribe(`depth.${selected}`, () => undefined));

      console.log(`[WS] <<< selected chart v2 subscriptions active for ${selected}`);
    } catch (e) {
      console.error("[WS] Failed to subscribe to v2 market channels:", e);
    }

    return () => {
      unsubscribers.forEach(unsubscribe => unsubscribe());
    };
  }, [
    isAuthenticated,
    isConnected,
    subscribe,
    selectedSymbol,
    timeframe,
    chartEligibleSymbolsKey,
  ]);

  useEffect(() => {
    const loginId = parsePositiveInt(accountId);
    if (!isAuthenticated || !isConnected || !loginId) return;

    const channels = [
      `account.${loginId}`,
      `metrics.${loginId}`,
      `positions.${loginId}`,
      `orders.${loginId}`,
      `deals.${loginId}`,
      `state.${loginId}`,
    ];

    console.log('[WS] Subscribing to account v2 channels:', channels.join(', '));
    const unsubscribers = channels.map(channel => subscribe(channel, () => undefined));
    return () => unsubscribers.forEach(unsubscribe => unsubscribe());
  }, [accountId, isAuthenticated, isConnected, subscribe]);

  const isTradeSessionActive = useCallback(() => isAuthenticatedRef.current, []);
  const incrementPositionsStreamVersion = useCallback(() => {
    positionsStreamVersionRef.current += 1;
  }, []);
  const hasServerClosedTicket = useCallback(
    (ticket: number) => serverClosedTicketsRef.current.has(ticket),
    [],
  );

  useTradeStreamRuntime({
    isAuthenticated,
    subscribe,
    isSessionActive: isTradeSessionActive,
    getAcceptedChannelLogin,
    getLiveTradingLogin,
    incrementPositionsStreamVersion,
    hasServerClosedTicket,
    markServerClosedTickets,
    markTradeWsMessage,
    reconcileOptimisticClosedPositions,
    refreshOrdersAndHistory,
    reloadMarketSymbols: activeMarketSnapshot.reload,
  });
  const {
    placeOrder,
    handleDepthOrder,
    handleOrderPanelSubmit,
  } = useOrderExecution({
    selectedMarketStatus,
    selectedSymbol,
    volume,
    setVolume,
    domSymbol,
    orderPanelSymbol,
    getAllowedSymbol,
    getLiveTradingLogin,
    captureTradeOperationContext,
    isTradeOperationContextCurrent,
    refreshPositions,
    refreshOrdersAndHistory,
  });


  // useMarketInstruments owns the authenticated catalog request. Reuse that
  // result for selection and trading so App does not issue a second identical
  // /instruments request during the login-to-terminal critical path.
  useEffect(() => {
    if (!isAuthenticated || !accountId) {
      didApplyLiveChartPreferenceRef.current = false;
      return;
    }
    if (!marketInstrumentsSnapshot.authorizationSettled || allowedSymbolNames.length === 0) return;

    setSelectedSymbol((previous) => {
      const current = normalizeSymbolName(previous);
      const saved = normalizeSymbolName(localStorage.getItem(SELECTED_SYMBOL_STORAGE_KEY));
      return current || saved || resolveAuthorizedChartSymbol(DEFAULT_CHART_SYMBOL, allowedSymbolNames) || allowedSymbolNames[0] || '';
    });
  }, [
    accountId,
    allowedSymbolNames,
    isAuthenticated,
    marketInstrumentsSnapshot.authorizationSettled,
  ]);

  const chartSelectionReconciliationKey = useMemo(() => buildChartSelectionReconciliationKey({
    sessionKey: accountId,
    selectedSymbol,
    authorizedSymbols: chartEligibleSymbolNames,
    layout: dockLayout,
  }), [accountId, chartEligibleSymbolNames, dockLayout, selectedSymbol]);

  useEffect(() => {
    if (!hasLoadedChartSymbols) return;

    const liveSymbols = activeMarketSymbolsCurrent
      ? (accountSymbolUniverseActive
        ? activeMarketSymbols.filter((symbol) => chartEligibleSymbolSet.has(normalizeSymbolName(symbol)))
        : activeMarketSymbols)
      : [];
    const applyLivePreference = activeMarketSymbolsCurrent && !didApplyLiveChartPreferenceRef.current;
    const fallbackSymbol = pickPreferredChartSymbol(
      chartEligibleSymbolNames,
      liveSymbols,
      selectedSymbol,
      // Keep the startup or restored chart even when another symbol's feed
      // arrives first. Opening this chart creates its own feed demand.
      false,
    ) || getChartEligibleSymbol(selectedSymbol) || chartEligibleSymbolNames[0] || '';

    if (applyLivePreference) {
      didApplyLiveChartPreferenceRef.current = true;
      setHasAppliedLiveChartPreference(true);
    }

    if (fallbackSymbol && fallbackSymbol !== normalizeSymbolName(selectedSymbol)) {
      setSelectedSymbol(fallbackSymbol);
    }
    if (!fallbackSymbol) return;

    const store = useDockLayoutStore.getState();
    const layout = store.layout;
    // Feed status may arrive with only one live instrument before the broker
    // catalog. It can render a preview, but cannot invalidate saved symbols.
    const updates = getChartPanelSymbolUpdates(layout, getChartEligibleSymbol, fallbackSymbol, timeframe,
      marketInstrumentsSnapshot.chartCatalogCurrent === true && isAuthenticated
      && Boolean(accountId) && restoredLayoutAccountId === accountId);

    updates.forEach(update => {
      store.updatePanelProps(update.id, {
        props: update.props,
        title: update.title,
        ...(update.chartSymbolTabs ? { chartSymbolTabs: update.chartSymbolTabs } : {}),
      });
    });

    const preferenceSettled = hasAppliedLiveChartPreference || applyLivePreference;
    if (
      isAuthenticated
      && accountId
      && restoredLayoutAccountId === accountId
      && hasLoadedSymbols
      && preferenceSettled
    ) {
      setCommittedChartSelectionKey(buildChartSelectionReconciliationKey({
        sessionKey: accountId,
        selectedSymbol: fallbackSymbol,
        authorizedSymbols: chartEligibleSymbolNames,
        layout: useDockLayoutStore.getState().layout,
      }));
    }
  }, [
    accountId,
    accountSymbolUniverseActive,
    activeMarketSymbols,
    activeMarketSymbolsCurrent,
    chartSelectionReconciliationKey,
    chartEligibleSymbolNames,
    chartEligibleSymbolSet,
    getChartEligibleSymbol,
    hasAppliedLiveChartPreference,
    hasLoadedChartSymbols,
    hasLoadedSymbols,
    isAuthenticated,
    restoredLayoutAccountId,
    selectedSymbol,
    timeframe,
    marketInstrumentsSnapshot.chartCatalogCurrent,
  ]);

  const chartSelectionReadiness = useMemo(() => getChartSelectionReadinessSnapshot({
    authenticated: isAuthenticated,
    layoutRestored: Boolean(accountId) && restoredLayoutAccountId === accountId,
    catalogSettled: hasLoadedSymbols && !isLoadingSymbols,
    feedPreferenceSettled: activeMarketSymbolsSettled && hasAppliedLiveChartPreference,
    selectedSymbol,
    authorizedSymbols: chartEligibleSymbolNames,
    layout: dockLayout,
    reconciliationKey: chartSelectionReconciliationKey,
    committedReconciliationKey: committedChartSelectionKey,
  }), [
    accountId,
    activeMarketSymbolsSettled,
    chartEligibleSymbolNames,
    chartSelectionReconciliationKey,
    committedChartSelectionKey,
    dockLayout,
    hasAppliedLiveChartPreference,
    hasLoadedSymbols,
    isAuthenticated,
    isLoadingSymbols,
    restoredLayoutAccountId,
    selectedSymbol,
  ]);
  const desktopToolbarSymbol = chartSelectionReadiness.renderedChartSymbol || selectedSymbol;
  // FIX: A restored dock tab is the authoritative active-chart selection. Keep
  // global chart-bound commands and persistence aligned with what is visible.
  useEffect(() => {
    const renderedChartSymbol = normalizeSymbolName(chartSelectionReadiness.renderedChartSymbol);
    if (!renderedChartSymbol || renderedChartSymbol === normalizeSymbolName(selectedSymbol)) return;
    setSelectedSymbol(renderedChartSymbol);
  }, [chartSelectionReadiness.renderedChartSymbol, selectedSymbol]);
  // FIX: During the one reconciliation render, never pair the visible chart
  // symbol with another symbol's cached market-status metadata.
  const desktopToolbarMarketStatus = normalizeSymbolName(selectedMarketStatus.symbol) === normalizeSymbolName(desktopToolbarSymbol)
    ? selectedMarketStatus
    : getCachedSymbolMarketStatus(desktopToolbarSymbol);
  const chartSelectionDiagnosticAttributes = getChartSelectionDiagnosticAttributes(chartSelectionReadiness);
  const chartRuntimeReady = (guestMode ? hasLoadedChartSymbols : shouldMountChartRuntime({
    authenticated: isAuthenticated,
    accountId,
    restoredLayoutAccountId,
    catalogSettled: hasLoadedChartSymbols,
    feedPreferenceSettled: activeMarketSymbolsSettled && hasAppliedLiveChartPreference,
  })) || guestChartLoginContinuity.preserveGuestLayout;
  useTerminalFeatureWarmup(chartRuntimeReady);
  // Stable actions let overlay opens skip the workspace render.
  const workspaceClosePosition = useCommittedCallback(handleClosePosition);
  const workspaceModifyPosition = useCommittedCallback(handleModifyPosition);
  const workspaceCancelOrder = useCommittedCallback((id: string | number) => handleCancelOrder(String(id)));
  const workspaceCloseBulk = useCommittedCallback(handleCloseBulk);
  useEffect(() => {
    return () => {
      terminateWorker();
    };
  }, []);

  const terminalBrokerInfo = useTerminalBrokerInfo();

  useEffect(() => {
    if (!isAuthenticated || !accountId) return;

    const tfLabel: Record<string, string> = {
      '1m': 'M1', '5m': 'M5', '15m': 'M15', '30m': 'M30',
      '1h': 'H1', '4h': 'H4', '1d': 'D1',
    };
    const server = brokerDisplayName(terminalBrokerInfo.serverName, terminalBrokerInfo.brokerName);
    const accountName = window.electron?.window ? terminalBrokerInfo.accountName : '';
    const accountLabel = accountName ? `${accountId} - ${accountName}` : accountId;
    const marginMode = terminalBrokerInfo.marginMode;
    const broker = 'RTX Terminal';
    const tf         = tfLabel[timeframe] ?? timeframe.toUpperCase();
    // FIX: Browser/Electron chrome follows the rendered active dock tab, not a
    // stale Market Watch or pre-restore selection.
    const title      = `${accountLabel} - ${server} - ${marginMode} - ${broker} - ${desktopToolbarSymbol},${tf}`;

    document.title = title;
    window.electron?.window?.setTitle(title);
    applyBrokerChrome({
      brokerId: typeof window === 'undefined' ? '' : String(window.localStorage.getItem('broker_id') || window.localStorage.getItem('rtx_broker_id') || ''),
      brokerName: server,
      logoUrl: getLogoUrl(terminalBrokerInfo.logoUrl, terminalBrokerInfo.logoBaseCandidates),
      themeColor: typeof window === 'undefined' ? '' : String(window.localStorage.getItem('broker_theme_color') || ''),
    });
  }, [isAuthenticated, accountId, desktopToolbarSymbol, timeframe, terminalBrokerInfo.accountName, terminalBrokerInfo.serverName, terminalBrokerInfo.brokerName, terminalBrokerInfo.logoUrl, terminalBrokerInfo.logoBaseCandidates, terminalBrokerInfo.marginMode]);

  // TODO: Replace with API call to /api/notifications
  // Fetch real notifications from backend
  useEffect(() => {
    // Placeholder for real notification fetching
    // fetchNotifications().then(notifications => {
    //   notifications.forEach(notif => addNotification(notif));
    // });
  }, []);

  // ============================================================================
  // ALL HOOKS MUST BE DECLARED BEFORE ANY EARLY RETURNS
  // This fixes: "Rendered more hooks than during the previous render" error
  // ============================================================================

  // Workspace dialog state
  const [showSaveWorkspaceDialog, setShowSaveWorkspaceDialog] = useState(false);
  const [chartSymbolPicker, setChartSymbolPicker] = useState<ChartSymbolPickerState | null>(null);
  useEffect(() => {
    if (chartSymbolPicker && !hasArrangedChartWindows(dockLayout)) setChartSymbolPicker(null);
  }, [chartSymbolPicker, dockLayout]);
  const chartPickerInstruments = useMemo(() => chartEligibleSymbolNames.map(symbol => (
    allSymbols.find(instrument => normalizeSymbolName(typeof instrument === 'object' && instrument ? (instrument as any).symbol ?? (instrument as any).name : instrument) === symbol)
      ?? { symbol }
  )), [allSymbols, chartEligibleSymbolNames]);
  useEffect(() => { setChartSymbolPicker(null); }, [isAuthenticated, accountId]);
  // One feedback toast at a time. Each message gets a fresh id so the toast
  // remounts and restarts its full lifetime; the toast owns its own timer so
  // it can pause while the trader hovers or focuses it.
  const [feedbackToast, setFeedbackToast] = useState<{
    id: number;
    message: UiMessage;
    notice?: ActionFeedbackNotice;
    type: ActionFeedbackType;
    report?: PositionCloseReport;
  } | null>(null);
  const feedbackToastSeqRef = useRef(0);

  const displayToast = useCallback((
    message: UiMessage,
    type: ActionFeedbackType = 'success',
    report?: PositionCloseReport,
    notice?: ActionFeedbackNotice,
  ) => {
    feedbackToastSeqRef.current += 1;
    setFeedbackToast({ id: feedbackToastSeqRef.current, message, notice, type, report });
  }, []);

  const dismissFeedbackToast = useCallback((id: number) => {
    setFeedbackToast((current) => (current?.id === id ? null : current));
  }, []);

  useEffect(() => {
    const handleOrderFeedback = (event: Event) => {
      const detail = (event as CustomEvent<OrderFeedbackDetail>).detail;
      if (!detail?.message) return;
      const completedPositionCloseReport = Boolean(
        detail.report
        && detail.type === 'success'
        && getPositionCloseOutcome(detail.report) === 'completed'
      );
      if (completedPositionCloseReport) return;
      displayToast(
        detail.messageParts ?? detail.message,
        detail.type || 'error',
        // Close execution details are never rendered as a second modal sheet.
        // Errors remain visible as a compact, non-modal action notice.
        undefined,
        detail.notice,
      );
    };

    window.addEventListener(ORDER_FEEDBACK_EVENT, handleOrderFeedback);
    return () => window.removeEventListener(ORDER_FEEDBACK_EVENT, handleOrderFeedback);
  }, [displayToast]);

  // Opening the ticket is a navigation action, so it follows the active chart
  // and chart/catalog eligibility. The stricter live-trading gate remains in
  // handleOrderPanelSubmit, where an order can actually be sent.
  const openOrderPanelForSymbol = useCallback((
    requestedSymbol?: unknown,
    requestedPrice?: { bid: number; ask: number },
  ): boolean => {
    if (!isAuthenticatedRef.current) {
      window.dispatchEvent(new Event('rtx:requestTradeLogin'));
      return false;
    }
    const explicitSymbol = normalizeSymbolName(requestedSymbol);
    const activeChartSymbol = normalizeSymbolName(
      getActiveChartCommandTarget(selectedSymbol, timeframe).symbol,
    );
    // SUI-T8: honor the Options default-symbol mode for ticket opens without
    // an explicit symbol. `automatic` preserves the active-chart behavior;
    // `last-used` prefers the last traded symbol.
    const targetSymbol = resolveOpenOrderTargetSymbol(useSettingsStore.getState().trade, {
      explicitSymbol,
      activeChartSymbol,
      selectedSymbol: normalizeSymbolName(selectedSymbol),
      lastUsedSymbol: useLastSymbolStore.getState().lastSymbol,
    });
    if (!requireNewOrderAuth(targetSymbol)) return false;
    const dialogSymbol = getChartEligibleSymbol(targetSymbol) || getAllowedSymbol(targetSymbol);

    if (!dialogSymbol) {
      publishOrderFeedback([feedbackSymbol(targetSymbol), feedbackValue(' · '), feedbackLabel('New Order'), feedbackValue(': '), feedbackLabel('Unavailable')]);
      return false;
    }

    const tick = useAppStore.getState().ticks[dialogSymbol];
    setOrderPanelSymbol(dialogSymbol);
    setOrderPanelPrice(requestedPrice ?? { bid: tick?.bid || 0, ask: tick?.ask || 0 });
    setOrderPanelOpen(true);
    return true;
  }, [getAllowedSymbol, getChartEligibleSymbol, selectedSymbol, timeframe]);

  // Keyboard shortcut handlers
  const handleOpenOrderPanel = useCallback((symbol: string, price: { bid: number; ask: number }) => {
    openOrderPanelForSymbol(symbol, price);
  }, [openOrderPanelForSymbol]);

  const handleQuickBuy = useCallback(() => {
    if (selectedSymbol) {
      placeOrder('BUY');
    }
  }, [selectedSymbol, placeOrder]);

  const handleQuickSell = useCallback((requestedSymbol?: string) => {
    const targetSymbol = requestedSymbol || getActiveChartCommandTarget().symbol || selectedSymbol;
    if (targetSymbol) {
      placeOrder('SELL', targetSymbol);
    }
  }, [selectedSymbol, placeOrder]);

  const handleOpenDOM = useCallback((symbolOrEvent: string | CustomEvent) => {
    const activeSymbol = getActiveChartCommandTarget().symbol;
    const requestedSymbol = typeof symbolOrEvent === 'string'
      ? symbolOrEvent 
      : (symbolOrEvent.detail?.symbol || activeSymbol || selectedSymbol);
    const hasRequestedSymbol = Boolean(normalizeSymbolName(requestedSymbol));
    const targetSymbol = hasRequestedSymbol ? requestedSymbol : (activeSymbol || selectedSymbol);
    const symbol = getChartEligibleSymbol(targetSymbol) || getAllowedSymbol(targetSymbol);
    if (!symbol) return;
    
    if (showDOM && domSymbol === symbol) {
      setShowDOM(false);
    } else {
      openDOM(symbol);
    }
  }, [domSymbol, getAllowedSymbol, getChartEligibleSymbol, openDOM, selectedSymbol, setShowDOM, showDOM]);

  // Workspace handlers
  const handleSaveWorkspace = useCallback(() => {
    console.log('[App] Save workspace triggered');
    setShowSaveWorkspaceDialog(true);
  }, []);

  const handleConfirmSaveWorkspace = useCallback((workspaceName?: string) => {
    console.log('[App] Workspace saved:', workspaceName);
    setShowSaveWorkspaceDialog(false);
    displayToast([feedbackLabel('Save Workspace'), feedbackValue(`: ${workspaceName ?? ''} · `), feedbackLabel('Completed')], 'success');
  }, [displayToast]);

  const handleOpenDataFolder = useCallback(async () => {
    console.log('[App] Open data folder');
    const openDataFolder = window.electron?.shell?.openDataFolder;
    if (!openDataFolder) {
      displayToast([feedbackLabel('Open Data Folder'), feedbackValue(': '), feedbackLabel('Available in the desktop app')], 'error');
      return;
    }

    try {
      const errorMessage = await openDataFolder();
      if (errorMessage) throw new Error(errorMessage);
    } catch (error) {
      console.error('[App] Failed to open data folder:', error);
      displayToast([feedbackLabel('Open Data Folder'), feedbackValue(': '), feedbackLabel('Failed')], 'error');
    }
  }, [displayToast]);

  const handlePrintChart = useCallback(async (request: PrintChartRequest = {}) => {
    console.log('[App] Print chart - Ctrl+P');
    try {
      // Import dynamically to avoid circular dependencies
      const { chartPrinter } = await import('./services/chartPrinter');

      const chartData = request.chartData || await chartPrinter.captureActiveChartData();

      const preferences = request.preferences
        || chartPrinter.getPreferences(accountId || undefined);
      await chartPrinter.printChart(chartData, preferences);
    } catch (error) {
      console.error('[App] Failed to print:', error);
      displayToast(error instanceof Error ? error.message : 'The chart could not be printed.', 'error');
    }
  }, [accountId, displayToast]);

  const handleToggleFullScreen = useCallback(() => {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen();
    } else {
      document.exitFullscreen();
    }
  }, []);

  useTerminalCommandEvents({
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
  });


  // Web guests keep public charts and quotes. Private account subscriptions
  // above and every trade mutation remain authenticated independently.
  if (!isAuthenticated && !guestMode) {
    if (isAutoAuthenticating) {
      return <TerminalLoadFallback sessionRestorePending />;
    }

    return <WelcomeTerminal onLogin={handleLoginSuccess} />;
  }

  // Consumed by trading components
  // const currentTick = ticks[selectedSymbol];

  return (
    <TerminalStartupBoundary
      dataReady={!marketInstrumentsSnapshot.loading
        && (!isAuthenticated || (hasInitialAccountSnapshot && initialTradeSnapshotSettledFor === accountId))}
      waitForChart={false}
    >
    <CommandBusProvider>
      <KeyboardShortcutProvider>
        <GlobalShortcuts
          onOpenOrderPanel={handleOpenOrderPanel}
          onQuickBuy={handleQuickBuy}
          onQuickSell={handleQuickSell}
          onSaveWorkspace={handleSaveWorkspace}
          onOpenDataFolder={handleOpenDataFolder}
          onPrintChart={handlePrintChart}
          onToggleFullScreen={handleToggleFullScreen}
          onOpenDOM={handleOpenDOM}
          selectedSymbol={selectedSymbol}
          isChartPropertiesOpen={showChartProperties}
          isOrderPanelOpen={orderPanelOpen}
        />
        <TerminalViewport
          className="rtx-app-shell flex flex-col h-screen w-full bg-[#131316] text-zinc-300 overflow-hidden font-sans"
          role="main"
          aria-label="Trading terminal"
          data-rtx-authenticated-shell={isAuthenticated ? 'true' : undefined}
          data-rtx-guest-shell={guestMode ? 'true' : undefined}
          {...chartSelectionDiagnosticAttributes}
        >
          {/* 1. Global Menu & Toolbar */}
          <TopToolbar
            profileSymbols={chartEligibleSymbolNames}
            chartType={chartType}
            timeframe={timeframe}
            onChartTypeChange={setChartType}
            onTimeframeChange={setTimeframe}
            symbol={desktopToolbarSymbol}
            marketStatus={desktopToolbarMarketStatus}
            accountBrokerName={terminalBrokerInfo.brokerName}
            feedStatus={activeMarketSnapshot}
            onRefreshConnection={refreshDesktopConnection}
            desktopDrawingTools={drawingSidebarVisible && Boolean(window.electron?.window) ? (
              <WebDrawingToolsRail selectedSymbol={desktopToolbarSymbol} orientation="horizontal" />
            ) : undefined}
            onLoadTemplate={(template) => {
              // Apply chart settings from template
              if (template.chartType) setChartType(template.chartType);
              if (template.timeframe) setTimeframe(template.timeframe);

              // Emit event for TradingChart to handle grid/volumes/indicators
              const event = new CustomEvent('loadChartTemplate', { detail: template });
              window.dispatchEvent(event);
            }}
          />


          {/* 2. Main Workspace (Full Area Managed by DockManager) */}
          <div className="flex-1 flex overflow-hidden relative">
            <AnnotationEditor />
            <AnnotationTableCellEditor />
            {/* Both runtimes share the full tool set; desktop places it above the workspace. */}
            {drawingSidebarVisible && !window.electron?.window && <WebDrawingToolsRail selectedSymbol={desktopToolbarSymbol} />}
            <WebDrawingSelectionToolbar />
            {/* Center Content: Chart + DOM + Account Panel */}
            <div className="flex-1 flex bg-[#0d0d11] relative min-w-0 overflow-hidden">
              {/* Chart Area */}
              <div className="flex-1 flex flex-col min-w-0 min-h-0 relative">

                <div className="flex-1 w-full h-full relative">
                  <ErrorBoundary>
                    <DockWorkspace
                      globalChartType={chartType}
                      globalTimeframe={timeframe}
                      allSymbols={allSymbols}
                      chartSymbols={chartEligibleSymbolNames}
                      tradeSymbols={tradeEligibleSymbolNames}
                      activeMarketSnapshot={activeMarketSnapshot}
                      marketInstrumentsSnapshot={marketInstrumentsSnapshot}
                      selectedSymbol={selectedSymbol}
                      chartRuntimeEnabled={chartRuntimeReady}
                      retainedGuestCharts={guestChartLoginContinuity.retainedCharts}
                      onSymbolSelect={handleSymbolSelect}
                      onClosePosition={workspaceClosePosition}
                      onModifyPosition={workspaceModifyPosition}
                      onCancelOrder={workspaceCancelOrder}
                      onCloseBulk={workspaceCloseBulk}
                    />
                  </ErrorBoundary>
                </div>
              </div>

              <FloatingTerminalPanels
                panels={floatingPanels}
                onCloseBulk={handleCloseBulk}
                onPlaceOrder={handleDepthOrder}
              />

              {/* Account Panel (Right Side) */}
              {showAccountPanel && (
                <Suspense fallback={null}>
                  <LazyAccountPanel
                    onClose={() => setShowAccountPanel(false)}
                    wsConnection={wsRef.current}
                  />
                </Suspense>
              )}
            </div>
          </div>

          {/* 4. Status Bar */}
          {/* FIX: Status chrome must identify the chart the user can actually see. */}
          <StatusBar
            wsRef={wsRef}
            reconnectCallback={reconnectCallbackRef.current || undefined}
            symbol={desktopToolbarSymbol}
            timeframe={timeframe}
            marketStatus={desktopToolbarMarketStatus}
          />

          {/* OTA Update Banner (fixed overlay, top-right) */}
          <UpdateBanner />

          {/* Headless Components */}
          <AlertsContainer wsConnection={wsRef.current} />

          {/* Order Panel Dialog (F9) */}
          {orderPanelOpen && (
            <ErrorBoundary label="New Order">
              <OrderPanelDialog
                isOpen
                onClose={() => setOrderPanelOpen(false)}
                symbol={orderPanelSymbol || selectedSymbol}
                currentPrice={orderPanelPrice}
                onSubmitOrder={handleOrderPanelSubmit}
                marketStatus={selectedMarketStatus}
                symbols={isAuthenticated ? allowedSymbolNames : undefined}
              />
            </ErrorBoundary>
          )}

          <ChartModifyPositionDialogHost
            onClosePosition={handleClosePosition}
            resolveAllowedSymbol={getAllowedSymbol}
          />

          {tradeAuthOpen && <Suspense fallback={null}><TradeAuthDialog
            isOpen={tradeAuthOpen}
            intent={pendingTradeIntent}
            onClose={handleTradeAuthClose}
            onAuthenticated={handleTradeAuthenticated}
          /></Suspense>}

          {/* Save Workspace Dialog (Ctrl+S) */}
          {showSaveWorkspaceDialog && (
            <Suspense fallback={null}>
            <LazySaveWorkspaceDialog
              onConfirm={handleConfirmSaveWorkspace}
              onCancel={() => setShowSaveWorkspaceDialog(false)}
              workspaceData={{
                charts: [], // charts are in layout now
                layout: { dockHeight },
                marketWatch: { selectedSymbol },
                orderPanel: { volume }
              }}
              userId={accountId}
              accountId={accountId}
            />
            </Suspense>
          )}

          {chartSymbolPicker && (chartSymbolPicker.anchor ? (
            <ChartSymbolDropdown
              symbols={chartEligibleSymbolNames}
              currentSymbol={findChartPanelById(dockLayout, chartSymbolPicker.panelId)?.props?.symbol}
              anchor={chartSymbolPicker.anchor}
              onClose={() => setChartSymbolPicker(null)}
              onSelect={symbol => {
                const sessionScope = getCommittedBrokerAccountSessionScopeKey(getCommittedBrokerAccountSessionScope());
                if (sessionScope !== chartSymbolPicker.sessionScope) return;
                if (changeChartPanelSymbol(chartSymbolPicker.panelId, symbol, chartEligibleSymbolNames, timeframe)) {
                  setSelectedSymbol(normalizeSymbolName(symbol));
                }
              }}
            />
          ) : (
            <Suspense fallback={null}>
            <LazySymbolsDialog
              isOpen
              title="Change chart symbol"
              chartActionLabel="Apply"
              instruments={chartPickerInstruments}
              initialSymbol={findChartPanelById(dockLayout, chartSymbolPicker.panelId)?.props?.symbol}
              onClose={() => setChartSymbolPicker(null)}
              onOpenChart={symbol => {
                const sessionScope = getCommittedBrokerAccountSessionScopeKey(getCommittedBrokerAccountSessionScope());
                if (sessionScope !== chartSymbolPicker.sessionScope) return;
                if (changeChartPanelSymbol(chartSymbolPicker.panelId, symbol, chartEligibleSymbolNames, timeframe)) {
                  setSelectedSymbol(normalizeSymbolName(symbol));
                }
              }}
            />
            </Suspense>
          ))}

          {/* Compact action notices; successful position closes intentionally stay silent. */}
          {feedbackToast && (
            <ActionFeedbackToast
              key={feedbackToast.id}
              durationMs={resolveActionFeedbackDurationMs(feedbackToast.type, feedbackToast.report)}
              message={feedbackToast.message}
              notice={feedbackToast.notice}
              onDismiss={() => dismissFeedbackToast(feedbackToast.id)}
              report={feedbackToast.report}
              tone={resolveActionFeedbackTone(feedbackToast.type, feedbackToast.report)}
            />
          )}

          {/* Last Symbol Trading Panel */}
          {lastSymbolPanelVisible && (
            <Suspense fallback={null}>
              <LazyLastSymbolPanel symbol={desktopToolbarSymbol} />
            </Suspense>
          )}

          {/* Notification Toast Container */}
          <ToastContainer
            avoidActionFeedback={Boolean(feedbackToast && !feedbackToast.report && !feedbackToast.notice)}
            notifications={activeToasts}
          />

          {/* Global Confirm Dialog */}
          <ConfirmDialog />

          {/* Indicator Navigator (Insert > Indicators, toolbar button) */}
          <IndicatorNavigatorHost selectedSymbol={selectedSymbol} timeframe={timeframe} />

          {/* Chart Properties Dialog (F8) */}
          {showChartProperties && (
            <Suspense fallback={null}>
              <LazyChartPropertiesDialog
                isOpen
                onClose={() => setShowChartProperties(false)}
                symbol={chartPropsSymbol}
                timeframe={chartPropsTimeframe as Timeframe}
                targetContextId={chartPropsContextId}
                currentChartType={getDockPanelChartType(dockLayout, chartPropsContextId, chartType)}
                onChartTypeChange={(nextChartType) => {
                  commandBus.dispatch({
                    type: 'SET_CHART_TYPE',
                    payload: {
                      chartType: nextChartType,
                      targetContextId: chartPropsContextId,
                    },
                  });
                }}
              />
            </Suspense>
          )}

          {chartObjectsTarget && (
            <Suspense fallback={null}>
              <LazyChartObjectsDialog
                isOpen
                targetContextId={chartObjectsTarget.targetContextId}
                symbol={chartObjectsTarget.symbol}
                timeframe={chartObjectsTarget.timeframe}
                onClose={() => setChartObjectsTarget(null)}
              />
            </Suspense>
          )}
        </TerminalViewport>
      </KeyboardShortcutProvider>

    </CommandBusProvider>
    </TerminalStartupBoundary>
  );
}

export default App;
