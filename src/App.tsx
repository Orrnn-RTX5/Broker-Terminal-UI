import { isDesktopBackendTarget } from './config/backendTarget.js';
import { useGuestMarketData } from './hooks/useGuestMarketData';
import { getLogoUrl, useTerminalBrokerInfo } from './hooks/useTerminalTitle';
import { brokerDisplayName } from './services/brokerDisplayName';
import { applyBrokerChrome } from './services/brokerPresentation';
import { ChartSymbolDropdown, type ChartSymbolAnchor } from './components/ChartSymbolDropdown';
import { translateUi, useUiTranslation } from './hooks/useUiTranslation';
import { feedbackLabel, feedbackValue, feedbackSymbol, formatUiMessage, type UiMessage, type UiMessagePart } from './utils/uiFeedback';
import { lazy, Suspense, useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { extractAccountMetrics, normalizeAccountMetrics } from './services/accountMetrics';
import { WelcomeTerminal } from './startup/WelcomeTerminalEntry';
import { TradeAuthDialog } from './components/TradeAuthDialog';
import { isElectronRuntime } from './config/backendTarget.js';
import {
  completeTradingAuthentication,
  requireTradingAuth,
  requireNewOrderAuth,
  TRADING_AUTH_REQUEST_EVENT,
  type TradingAuthIntent,
} from './services/tradingAuthGate';

import { DockWorkspace } from './components/dock/DockWorkspace';
import { useDockLayoutStore } from './store/useDockLayoutStore';
import { useDrawingSidebarStore } from './store/useDrawingSidebarStore';
import type { ChartType, Timeframe } from './components/TradingChart';
import { DEFAULT_CHART_SYMBOL, DEFAULT_CHART_TIMEFRAME } from './constants/chartDefaults';
import { ErrorBoundary } from './components/ErrorBoundary';
import { OrderPanelDialog } from './components/OrderPanelDialog';
import { AlertsContainer } from './components/AlertsContainer';
import { resolveTickFromLookup, shouldReplaceOpenPositionSnapshot, useAppStore, type Account, type Position } from './store/useAppStore';
import { useMarketDataStore } from './store/useMarketDataStore';
import { terminateWorker } from './services/aggregationWorkerManager';
import { enqueueLiveTick } from './services/liveTickDispatcher';
import { isEnhancedStoreHandledTickFrame } from './services/websocket-enhanced';
import { isTradeSubscriptionControlFrame } from './services/tradeStreamMessage';
import { extractBackendAccountRecord, isBackendAccountForLogin, readBackendNumber } from './services/backendAccountMetrics';
import { applyPositionStreamUpdate, decodePositionStreamMessage } from './services/tradePositionStream';
import { requestPositionSnapshotRevalidation } from './services/positionSnapshotSafety';
import { POSITION_CLOSED_EVENTS, readPositionStreamEvent, readPositionStreamBatch, reconcilePositionStreamBatch } from './services/positionStream';
import { getTradeEntryPriceFromQuote } from './services/chartPriceGuards';
import { getQuoteSocketManager } from './services/quoteSocketManager';
import { captureTradeOrderIntent } from './services/orderLatencyTelemetry';
import { loadSessionTradeSnapshot, seedValidatedSessionAccountSummary } from './services/tradeStartupSnapshot';
import { chartDataService } from './services/chartDataService';
import { resolveOptionalPositionTime, resolvePositionOpenTime } from './services/tradePositionTime';
import { API_BASE_URL, WS_ENDPOINTS, updateDynamicUrls } from './config/api';
import { useWebSocket } from './hooks/useWebSocket';
import { useActiveMarketSymbols, useMarketInstruments } from './hooks/useLiveMarketData';
import { getCachedSymbolMarketStatus, useSymbolMarketStatus } from './hooks/useSymbolMarketStatus';
import {
  buildChartEligibleSymbolNames,
  buildTradeEligibleSymbolNames,
  getUniqueSymbolNames as getAllowedSymbolNames,
  normalizeSymbolName,
  pickPreferredChartSymbol,
  resolveAuthorizedChartSymbol,
} from './utils/symbolEligibility';
import {
  buildChartSelectionReconciliationKey,
  getChartSelectionDiagnosticAttributes,
  getChartSelectionReadinessSnapshot,
  shouldMountChartRuntime,
} from './utils/chartSelectionReadiness';
import { readDailyChangePercent, resolveDailyChangePercent } from './utils/dailyChange';
import {
  isAuthenticatedSessionHandoffValid,
  type AuthenticatedSessionHandoff,
} from './startup/authenticatedSessionHandoff';
import { TerminalLoadFallback } from './startup/TerminalLoadFallback';
import { TerminalStartupBoundary } from './startup/TerminalStartupBoundary';

import { useLastSymbolStore } from './store/useLastSymbolStore';
import { useAutoCloseMonitor } from './hooks/useAutoCloseMonitor';
import { api } from './services/api';
import { tradingV2Api } from './api/trade';
import { collapseDealHistory, tradeGatewayApi } from './api/tradeGateway';
import { readBackendPositionProfit } from './components/BottomDock.trade';
import type { TradeOverlayCloseSnapshotPayload } from './services/tradeOverlayHistory';
import { brokerApi } from './api/brokerApi';
import { formatOrderError } from './utils/orderError';
import { CHART_POSITION_ACTION_EVENT, type ChartPositionActionDetail } from './utils/chartTradeControls';
import { getSharedChartTrade } from './utils/tradeShareLink';
import { closePositionsLocalFirst } from './services/localFirstCloseCoordinator';
import { createUnavailableMarketStatus, getMarketStatusTradeBlockMessage, shouldBlockSymbolTrading } from './utils/marketStatus';
import { getStoredBrokerServer } from './services/brokerServers';
import { getActiveChartSource } from './services/activeChartSource';
import type { ChartPrintData, PrintPreferences } from './services/chartPrinter';
import {
  getCommittedBrokerAccountSessionScope,
  getCommittedBrokerAccountSessionScopeKey,
} from './services/brokerSession';
import type { IndicatorInfo } from './components/IndicatorNavigator';
import type { DepthOrderRequest } from './components/DepthOfMarket';

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
import { BulkCloseConfirmDialog } from './components/ui/BulkCloseConfirmDialog';
import { useConfirmStore } from './store/useConfirmStore';
import { useBulkCloseConfirmStore } from './store/useBulkCloseConfirmStore';
import { useChartSettingsStore } from './store/useChartSettingsStore';
import {
  resolveChartPropertiesTarget,
  type ChartPropertiesEventDetail,
} from './services/chartPropertiesTarget';
import {
  getActiveChartCommandTarget,
  getPanelIdFromChartContextId,
} from './services/chartCommandTarget';
import { applyChartTimeframeCommand } from './services/chartTimeframeCommand';
import { getDockPanelChartType } from './services/chartTypeCommand';
import { activateChartPanel, changeChartPanelSymbol, findChartPanelById, getActiveDockChartPanel, getChartPanels, getChartPanelSymbolUpdates, requestActiveChartSymbolChange } from './services/chartPanelNavigation';
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
import { useNotificationStore } from './store/useNotificationStore';

// Alerts
import { useAlertStore } from './store/useAlertStore';

const LazyLastSymbolPanel = lazy(() => import('./components/LastSymbolPanel').then((module) => ({ default: module.LastSymbolPanel })));
const LazyIndicatorNavigator = lazy(() => import('./components/IndicatorNavigator').then((module) => ({ default: module.IndicatorNavigator })));
const LazyDepthOfMarket = lazy(() => import('./components/DepthOfMarket').then((module) => ({ default: module.DepthOfMarket })));
const LazyDataWindow = lazy(() => import('./components/DataWindow'));
const LazyAccountPanel = lazy(() => import('./components/AccountPanel').then((module) => ({ default: module.AccountPanel })));
const LazyChartPropertiesDialog = lazy(() => import('./components/dialogs/ChartPropertiesDialog').then((module) => ({ default: module.ChartPropertiesDialog })));
const LazyChartObjectsDialog = lazy(() => import('./components/dialogs/ChartObjectsDialog').then((module) => ({ default: module.ChartObjectsDialog })));
const LazySaveWorkspaceDialog = lazy(() => import('./components/dialogs/SaveWorkspaceDialog').then((module) => ({ default: module.SaveWorkspaceDialog })));
const LazySymbolsDialog = lazy(() => import('./components/SymbolsDialog').then((module) => ({ default: module.SymbolsDialog })));

type TradeOverlayCloseDispatcher = typeof import('./services/tradeOverlayHistory')['dispatchTradeOverlayCloseState'];
const dispatchTradeOverlayCloseState: TradeOverlayCloseDispatcher = (...args) => {
  void import('./services/tradeOverlayHistory').then((module) => {
    module.dispatchTradeOverlayCloseState(...args);
  });
};

const ORDER_FEEDBACK_EVENT = 'rtx:order-feedback';

type OrderFeedbackDetail = {
  message: string;
  messageParts?: UiMessagePart[];
  type: 'success' | 'error';
};

const publishOrderFeedback = (
  message: UiMessage,
  type: OrderFeedbackDetail['type'] = 'error',
): void => {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent<OrderFeedbackDetail>(ORDER_FEEDBACK_EVENT, {
    // Keep the string contract for other listeners, and retain source labels
    // separately so an already visible toast can follow a language change.
    detail: { message: formatUiMessage(message), messageParts: typeof message === 'string' ? [feedbackLabel(message)] : message, type },
  }));
};

const setChartVolumeBarsVisible = (visible: boolean, activeSymbol?: string) => {
  const store = useChartSettingsStore.getState();
  if (activeSymbol) {
    store.updateSymbolProperty(activeSymbol, 'showTickVolumes', visible);
    store.updateSymbolProperty(activeSymbol, 'showRealVolumes', false);
    return;
  }

  store.updateGlobalProperty('showTickVolumes', visible);
  store.updateGlobalProperty('showRealVolumes', false);
};

type PrintChartRequest = {
  chartData?: ChartPrintData;
  preferences?: PrintPreferences;
};

const toSettingsChartType = (chartType: ChartType) => {
  if (chartType === 'bar') return 'Bar' as const;
  if (chartType === 'line') return 'Line' as const;
  if (chartType === 'area') return 'Area' as const;
  return 'Candlesticks' as const;
};

// Helper to get auth headers for fetch
const getAuthHeaders = (): Record<string, string> => {
  const token = localStorage.getItem('auth_token');
  return token ? { 'Authorization': `Bearer ${token}` } : {};
};

const parseStoredTokenExpiryMs = (expiresAt: unknown): number | null => {
  if (expiresAt === undefined || expiresAt === null || expiresAt === '') return null;

  if (typeof expiresAt === 'number' && Number.isFinite(expiresAt)) {
    return expiresAt < 100000000000 ? expiresAt * 1000 : expiresAt;
  }

  const raw = String(expiresAt).trim();
  if (/^\d+$/.test(raw)) {
    const numeric = Number(raw);
    return numeric < 100000000000 ? numeric * 1000 : numeric;
  }

  const parsed = Date.parse(raw);
  return Number.isNaN(parsed) ? null : parsed;
};

const getStoredTokenExpiryMs = (): number | null => {
  if (typeof window === 'undefined') return null;
  return parseStoredTokenExpiryMs(localStorage.getItem('token_expires_at'));
};

const getStoredAuthToken = (): string | null => {
  if (typeof window === 'undefined') return null;
  return localStorage.getItem('auth_token') || sessionStorage.getItem('auth_token');
};

const hasTokenExpiryElapsed = (expiresAt: unknown): boolean => {
  const expiryMs = parseStoredTokenExpiryMs(expiresAt);
  return Boolean(expiryMs && expiryMs <= Date.now());
};

const SELECTED_SYMBOL_STORAGE_KEY = 'rtx5_selected_symbol';

interface Tick {
  symbol: string;
  bid: number;
  ask: number;
  spread: number; // Always present - calculated as ask - bid
  timestamp: number;
  prevBid?: number;
  lp?: string;
  dailyChange?: number;
  high24h?: number; // 24-hour high from backend
  low24h?: number;  // 24-hour low from backend
  volume?: number;
  last?: number;
  digits?: number;
}

interface TradeRestRead {
  startedAt: number;
  startedVersion: number;
  startedLocalMutationVersion: number;
}

interface RefreshPositionsOptions {
  allowWsCommit?: boolean;
}

interface PendingPositionsRefresh {
  login: number;
  options?: RefreshPositionsOptions;
}

interface OptimisticCloseReconcileOptions {
  clearConfirmedAbsent?: boolean;
}

interface BrokerConfig {
  brokerName: string;
  priceFeedLP: string;
  executionMode: string;
  defaultLeverage: number;
  marginMode: string;
}

type RawRecord = Record<string, any>;
const WS_DEBUG = false; // Enable to see WebSocket tick data in console

const toNumber = (value: unknown, fallback = 0): number => {
  if (value === null || value === undefined) return fallback;
  // calc-v2 Money objects: { amount: "99997.09", currency: "USD", scale: 2 }
  // String(object) => "[object Object]" => Number NaN => was incorrectly showing balance 0.
  if (typeof value === 'object') {
    const record = value as Record<string, unknown>;
    if (record.amount !== undefined && record.amount !== null) {
      return toNumber(record.amount, fallback);
    }
  }
  const cleanStr = String(value).replace(/,/g, '');
  const n = Number(cleanStr);
  return Number.isFinite(n) ? n : fallback;
};

const parsePositiveInt = (value: string | null | undefined): number | null => {
  if (!value) return null;
  const parsed = Number.parseInt(String(value), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
};

const getErrorMessage = (error: unknown, fallback: string): string => {
  if (error instanceof Error && error.message) return error.message;
  if (typeof error === 'string' && error.trim()) return error;
  return fallback;
};

const mergeOrderHistory = (parts: any[][]): any[] => {
  const seen = new Set<string>();
  return parts
    .flat()
    .filter((trade) => {
      const key = `${trade?.type}:${trade?.id}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .sort((a, b) => Date.parse(b?.closeTime ?? b?.openTime) - Date.parse(a?.closeTime ?? a?.openTime))
    .slice(0, 500);
};

type OrderHistoryRefreshResult = {
  trades: any[];
  warning: string | null;
};

const fetchOrderHistory = async (login: number): Promise<OrderHistoryRefreshResult> => {
  const [closedPositionsResult, dealsResult] = await Promise.allSettled([
    tradeGatewayApi.getClosedPositions(login),
    tradeGatewayApi.getDeals(login),
  ]);

  if (dealsResult.status === 'rejected') {
    throw new Error(getErrorMessage(dealsResult.reason, 'Deals history endpoint failed'));
  }

  const closedPositions = closedPositionsResult.status === 'fulfilled'
    ? closedPositionsResult.value
    : [];
  const closedDeals = collapseDealHistory(dealsResult.value);

  return {
    trades: mergeOrderHistory([closedDeals.length > 0 ? closedDeals : closedPositions]),
    warning: closedPositionsResult.status === 'rejected'
      ? getErrorMessage(closedPositionsResult.reason, 'Closed-position history endpoint failed')
      : null,
  };
};

const toTimestampMs = (value: unknown): number => {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) {
    return Date.now();
  }
  // Normalize seconds precision timestamps to milliseconds
  return numeric < 1_000_000_000_000 ? numeric * 1000 : numeric;
};

const getDefaultSpread = (symbol: string): number => {
  if (symbol.includes('JPY')) return 0.01;
  if (symbol.includes('XAU') || symbol.includes('XAG') || symbol.includes('XPT') || symbol.includes('XPD')) return 0.5;
  if (symbol.includes('BTC')) return 50;       // BTC spread ~$50
  if (symbol.includes('ETH')) return 5;        // ETH spread ~$5
  if (symbol.includes('LTC') || symbol.includes('SOL') || symbol.includes('XRP')) return 0.5;
  return 0.0001;
};

/** Return the correct number of decimal places for a given symbol. */
const getSymbolDigits = (symbol: string): number => {
  if (symbol.includes('JPY')) return 3;
  if (symbol.includes('BTC')) return 2;
  if (symbol.includes('ETH')) return 2;
  if (symbol.includes('LTC') || symbol.includes('SOL') || symbol.includes('XRP') || symbol.includes('BNB') || symbol.includes('DOT') || symbol.includes('ADA')) return 4;
  if (symbol.includes('XAU') || symbol.includes('XAG') || symbol.includes('XPT') || symbol.includes('XPD')) return 2;
  if (symbol.includes('NAS') || symbol.includes('SPX') || symbol.includes('DJ') || symbol.includes('US30') || symbol.includes('US500') || symbol.includes('NDX')) return 2;
  return 5; // Default: standard forex pairs
};

export const normalizeRealtimeTick = (raw: any, previous?: Tick): Tick | null => {
  const rawSymbol = typeof raw?.symbol === 'string' ? raw.symbol : '';
  const symbol = rawSymbol.trim().toUpperCase();
  if (!symbol) {
    if (WS_DEBUG) console.log('[normalizeTick] No symbol in raw data:', raw);
    return null;
  }

  const parsedBid = toNumber(raw?.bid, Number.NaN);
  const parsedAsk = toNumber(raw?.ask, Number.NaN);
  const parsedMid = Number(raw?.price ?? raw?.last ?? raw?.lastPrice ?? raw?.candle?.close);

  if (WS_DEBUG) console.log(`[normalizeTick] ${symbol}: raw bid=${raw?.bid} ask=${raw?.ask} -> parsed bid=${parsedBid} ask=${parsedAsk}`);

  let bid = parsedBid;
  let ask = parsedAsk;

  // Never manufacture BTC/ETH movement when the broker repeats a quote.
  // Synthetic jitter made a stale upstream feed look live even though the
  // backend correctly validates orders against its real execution snapshot.

  if (!Number.isFinite(bid) || !Number.isFinite(ask)) {
    if (!Number.isFinite(parsedMid)) {
      return null;
    }

    const rawSpread = Number(raw?.spread);
    const prevSpread = previous?.spread;
    const spreadForSynthesis = Number.isFinite(rawSpread) && rawSpread >= 0
      ? rawSpread
      : (Number.isFinite(prevSpread) && prevSpread >= 0 ? prevSpread : getDefaultSpread(symbol));

    bid = parsedMid - (spreadForSynthesis / 2);
    ask = parsedMid + (spreadForSynthesis / 2);
  }

  if (!Number.isFinite(bid) || !Number.isFinite(ask)) {
    return null;
  }

  if (ask < bid) {
    const tmp = bid;
    bid = ask;
    ask = tmp;
  }

  const computedSpread = ask - bid;
  const spread = Number.isFinite(Number(raw?.spread)) && Number(raw?.spread) >= 0
    ? Number(raw?.spread)
    : Math.max(0, computedSpread);

  const lp = typeof raw?.lp === 'string' && raw.lp.trim().length > 0 ? raw.lp : 'YOFX';
  const previousClose = raw?.previous_close ?? raw?.previousClose;
  const rawSourceTimestamp = raw?.sourceTimestamp
    ?? raw?.source_timestamp
    ?? raw?.timestamp
    ?? raw?.time
    ?? raw?.candle?.time;
  const normalizedSourceTimestamp = Number.isFinite(Number(rawSourceTimestamp))
    && Number(rawSourceTimestamp) > 0
    ? toTimestampMs(rawSourceTimestamp)
    : undefined;

  const result = {
    symbol,
    bid,
    ask,
    spread,
    // Keep broker event time separate from the local fallback. The shared tick
    // cache uses sourceTimestamp for ordering, so a late receipt-time frame
    // cannot masquerade as a newer executable quote.
    timestamp: normalizedSourceTimestamp ?? Date.now(),
    sourceTimestamp: normalizedSourceTimestamp,
    lp,
    dailyChange: resolveDailyChangePercent(
      readDailyChangePercent(raw) ?? previous?.dailyChange,
      bid,
      previousClose,
    ),
    high24h: toNumber(raw?.high_24h ?? raw?.high24h, previous?.high24h ?? Math.max(bid, ask)),
    low24h: toNumber(raw?.low_24h ?? raw?.low24h, previous?.low24h ?? Math.min(bid, ask)),
    volume: toNumber(raw?.volume_24h ?? raw?.volume ?? raw?.candle?.volume, previous?.volume ?? 0),
    last: (bid + ask) / 2,
    digits: toNumber(raw?.digits, previous?.digits ?? 0) || getSymbolDigits(symbol),
  };

  if (WS_DEBUG) console.log(`[normalizeTick] ${symbol}: SUCCESS bid=${bid} ask=${ask}`);
  return result;
};

export const parseTickPayloads = (input: any): any[] => {
  if (!input) return [];
  if (typeof input === 'string') {
    try {
      const parsed = JSON.parse(input);
      return parseTickPayloads(parsed);
    } catch {
      return [];
    }
  }
  if (Array.isArray(input)) {
    return input.flatMap(parseTickPayloads);
  }
  if (typeof input === 'object') {
    if (typeof input.symbol === 'string') {
      if (WS_DEBUG) console.log('[DEBUG PARSE TICK] found direct tick object', input.symbol);
      return [input];
    }
    if (input.data) return parseTickPayloads(input.data);
    if (input.tick) return parseTickPayloads(input.tick);
    if (input.quote) return parseTickPayloads(input.quote);
    if (input.price) return parseTickPayloads(input.price);
    if (input.payload) return parseTickPayloads(input.payload);
    if (input.message) return parseTickPayloads(input.message);
    if (input.prices) return parseTickPayloads(input.prices);
    if (input.ticks) return parseTickPayloads(input.ticks);
  }
  if (WS_DEBUG) console.log('[DEBUG PARSE TICK] failed to parse input', input);
  return [];
};

const normalizePositions = (payload: unknown): Position[] => {
  const source = Array.isArray(payload)
    ? payload
    : Array.isArray((payload as RawRecord | undefined)?.positions)
      ? (payload as RawRecord).positions
      : [];

  return source.flatMap((raw: RawRecord): Position[] => {
    // Position streams also carry metadata and sparse price/P&L deltas. A row
    // without a real broker ticket must never be assigned an array index: the
    // resulting synthetic `1` flickers in and out whenever a snapshot arrives.
    const parsedId = Number.parseInt(String(
      raw.ticket ?? raw.position_id ?? raw.position_ticket ?? raw.id ?? '',
    ), 10);
    if (!Number.isFinite(parsedId) || parsedId <= 0) return [];

    const openPrice = toNumber(raw.price_open ?? raw.open_price ?? raw.openPrice ?? raw.entryPrice ?? raw.chartEntryPrice ?? raw.price, 0);
    const backendCurrentPrice = readBackendNumber(raw.price_current ?? raw.current_price ?? raw.currentPrice ?? raw.livePrice);
    const currentPrice = backendCurrentPrice ?? 0;
    const rawSide = String(raw.side ?? '').toLowerCase();
    const chartEntryTime = resolveOptionalPositionTime(raw.chartEntryTime ?? raw.chart_entry_time);
    const openTime = resolvePositionOpenTime(raw, chartEntryTime);
    const volume = toNumber(raw.volume_lots ?? raw.quantity ?? raw.volume, 0);
    const backendProfit = readBackendNumber(raw.profit ?? raw.unrealized_pl ?? raw.unrealizedPnL);
    const profit = backendProfit ?? 0;

    return [{
      id: parsedId,
      symbol: String(raw.symbol ?? ''),
      side: rawSide === 'sell' || rawSide === 'short' || Number(raw.action) === 1 ? 'SELL' : 'BUY',
      volume,
      openPrice,
      currentPrice,
      openTime,
      sl: toNumber(raw.price_sl ?? raw.sl, 0),
      tp: toNumber(raw.price_tp ?? raw.tp, 0),
      swap: toNumber(raw.swap, 0),
      commission: toNumber(raw.commission, 0),
      unrealizedPnL: profit,
      hasBackendProfit: raw.hasBackendProfit !== false && raw.pnl_available !== false && backendProfit !== undefined,
      hasBackendCurrentPrice: raw.hasBackendCurrentPrice !== false && raw.pnl_available !== false && backendCurrentPrice !== undefined,
      state_version: raw.state_version_text ?? raw.state_version,
      price_time_msc: raw.price_time_msc,
      pnl_available: raw.pnl_available,
      chartEntryPrice: toNumber(raw.chartEntryPrice, 0) || undefined,
      chartEntryTime,
      open_price: openPrice,
      price_open: openPrice,
      current_price: currentPrice,
      price_current: currentPrice,
      time_create: openTime,
      open_time: openTime,
      time: openTime,
      profit,
      quantity: volume,
    }];
  });
};

const getChartEntryPriceForSymbol = (symbol: string, side: 'BUY' | 'SELL'): number | undefined => {
  const state = useAppStore.getState();
  const tick = resolveTickFromLookup(state.ticks, state.tickLookup, symbol);
  const entryPrice = getTradeEntryPriceFromQuote(tick, side);
  return entryPrice ?? undefined;
};

const upsertImmediatePosition = (position: Position) => {
  const store = useAppStore.getState();
  const positions = store.positions as unknown as Position[];
  const existingIndex = positions.findIndex((existing) => existing.id === position.id);
  const nextPositions = existingIndex >= 0
    ? positions.map((existing, index) => index === existingIndex ? { ...existing, ...position } : existing)
    : [position, ...positions];

  store.setPositions(nextPositions as any);
};

const applyOpenPositionSnapshot = (incoming: Position[]) => {
  const store = useAppStore.getState();
  if (!shouldReplaceOpenPositionSnapshot(incoming, store.positions as unknown as Position[])) {
    return;
  }
  store.setPositions(incoming as any);
};

// Single source of live position profit. normalizePositions already folds
// `pnl_available === false` into `hasBackendProfit`, so an unavailable backend
// P/L resolves to null here instead of a misleading local zero.
const backendCloseProfit = (position: Position): number | null => readBackendPositionProfit(position);

const normalizeCloseSnapshotSide = (side: string): 'BUY' | 'SELL' =>
  String(side ?? '').trim().toUpperCase().includes('SELL') ? 'SELL' : 'BUY';

const getTradeExitPriceFromQuote = (
  tick: Tick | undefined,
  side: 'BUY' | 'SELL',
): number | null => {
  if (!tick) return null;

  const bid = Number(tick.bid);
  const ask = Number(tick.ask);
  const last = Number(tick.last);

  if (side === 'BUY') {
    if (Number.isFinite(bid) && bid > 0) return bid;
    if (Number.isFinite(ask) && ask > 0) return ask;
    return Number.isFinite(last) && last > 0 ? last : null;
  }

  if (Number.isFinite(ask) && ask > 0) return ask;
  if (Number.isFinite(bid) && bid > 0) return bid;
  return Number.isFinite(last) && last > 0 ? last : null;
};

const buildTradeOverlayCloseSnapshots = (positions: readonly Position[]): TradeOverlayCloseSnapshotPayload[] => {
  if (positions.length === 0) return [];

  const { ticks, tickLookup } = useAppStore.getState();
  const closeTime = Date.now();

  return positions.flatMap((position): TradeOverlayCloseSnapshotPayload[] => {
    const side = normalizeCloseSnapshotSide(position.side);
    const tick = resolveTickFromLookup(ticks, tickLookup, position.symbol);
    const entryPrice = Number(position.chartEntryPrice || position.openPrice || 0);
    const entryTime = position.chartEntryTime || position.openTime;
    const exitPrice = getTradeExitPriceFromQuote(tick, side)
      ?? (Number(position.currentPrice) > 0 ? Number(position.currentPrice) : 0);

    if (!position.id || !position.symbol || !(entryPrice > 0) || !entryTime || !(exitPrice > 0)) {
      return [];
    }

    return [{
      ticketId: position.id,
      symbol: position.symbol,
      side,
      volume: position.volume,
      entryPrice,
      entryTime,
      exitPrice,
      exitTime: closeTime,
      currentPrice: exitPrice,
      closeTime,
      profit: backendCloseProfit(position),
    }];
  });
};

// Ayan's scope/token-aware normalizer is the only one that satisfies the
// store's publicationToken/metricsScope gate in useAppStore.setAccount.
const normalizeAccountSummary = normalizeAccountMetrics;

const toV2Timeframe = (value: string | undefined): string => {
  const normalized = String(value || 'M1').trim().toUpperCase();
  const map: Record<string, string> = {
    '1M': 'M1',
    '5M': 'M5',
    '15M': 'M15',
    '30M': 'M30',
    '1H': 'H1',
    '4H': 'H4',
    '1D': 'D1',
    '1W': 'W1',
  };
  return map[normalized] || normalized;
};

const getPositionEventName = (message: any): string => readPositionStreamEvent(message).event;

const getPositionEventTicket = (message: any): number | null => {
  const payload = readPositionStreamEvent(message).position;
  const ticket = Number.parseInt(String(
    payload?.ticket
      ?? payload?.position_id
      ?? payload?.position_ticket
      ?? payload?.id
      ?? message?.ticket
      ?? '',
  ), 10);
  return Number.isFinite(ticket) && ticket > 0 ? ticket : null;
};

interface AppProps {
  initialSessionHandoff?: AuthenticatedSessionHandoff | null;
  onSessionEnded?: () => void;
}

function App({ initialSessionHandoff = null, onSessionEnded }: AppProps = {}) {
  const tr = useUiTranslation();
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
  const [autoAuthError, setAutoAuthError] = useState<string | null>(null);
  const [initialTradeSnapshotSettledFor, setInitialTradeSnapshotSettledFor] = useState('');
  useGuestMarketData(guestMarketAccess && !isAuthenticated && !isAutoAuthenticating);
  const [tokenSessionVersion, setTokenSessionVersion] = useState(0);
  const storeTokenExpiresAt = useAppStore(state => state.tokenExpiresAt);
  const hasInitialAccountSnapshot = useAppStore(state => state.account !== null);
  const [selectedSymbol, setSelectedSymbol] = useState<string>(DEFAULT_CHART_SYMBOL);
  const [positions, setPositions] = useState<Position[]>([]);
  const [account, setAccount] = useState<Account | null>(null);
  const [orders, setOrders] = useState<any[]>([]);
  const [ledger, setLedger] = useState<any[]>([]);
  const [volume, setVolume] = useState(0.01);
  const [chartType, setChartType] = useState<ChartType>(() => {
    const saved = localStorage.getItem('rtx5_chart_type');
    return (saved as ChartType) || 'candlestick';
  });
  const [timeframe, setTimeframe] = useState<Timeframe>(DEFAULT_CHART_TIMEFRAME);
  const [brokerConfig, setBrokerConfig] = useState<BrokerConfig | null>(null);
  const [dockHeight, setDockHeight] = useState(() => {
    const saved = localStorage.getItem('dockHeight');
    return saved ? parseInt(saved, 10) : 250;
  });
  const [accountId, setAccountId] = useState<string>(() => freshSessionHandoff?.accountId || '');
  const activeAccountDataRef = useRef<number | null>(null);
  const accountIdRef = useRef(accountId);
  const isAuthenticatedRef = useRef(isAuthenticated);
  const lastObservedAuthTokenRef = useRef<string | null>(getStoredAuthToken());
  const refreshPositionsInFlightRef = useRef<Promise<void> | null>(null);
  const refreshPositionsPendingRef = useRef<PendingPositionsRefresh | null>(null);
  const refreshHistoryInFlightRef = useRef<Promise<void> | null>(null);
  const historyRefreshTimerRef = useRef<number | null>(null);
  const refreshHistoryPendingLoginRef = useRef<number | null>(null);
  const accountPollInFlightRef = useRef<Promise<void> | null>(null);
  const accountPollInFlightLoginRef = useRef<number | null>(null);
  const sessionRestoreStartedRef = useRef(false);
  const authSessionGenerationRef = useRef(0);
  const lastTradeWsMessageAtRef = useRef(0);
  const positionsStreamVersionRef = useRef(0);
  const serverClosedTicketsRef = useRef<Set<number>>(new Set());
  const tradeDataVersionRef = useRef(0);
  const localTradeDataVersionRef = useRef(0);
  const optimisticClosedTicketsRef = useRef<Set<number>>(new Set());
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

  const [enableHistoricalData] = useState(true);

  accountIdRef.current = accountId;
  isAuthenticatedRef.current = isAuthenticated;

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
    setOrders([]);
    setLedger([]);
  }, []);

  const performSessionExpiredLogout = useCallback((reason = 'session_expired') => {
    console.warn(`[App] Logging out session: ${reason}`);
    authSessionGenerationRef.current += 1;
    lastObservedAuthTokenRef.current = null;
    clearLocalAccountState();
    setIsAuthenticated(false);
    setIsAutoAuthenticating(false);
    setAccountId('');
    useAppStore.getState().logout();
    onSessionEnded?.();
  }, [clearLocalAccountState, onSessionEnded]);

  const validateStoredAuthSession = useCallback((reason = 'auth_token_missing'): boolean => {
    const token = getStoredAuthToken();
    if (token) {
      lastObservedAuthTokenRef.current = token;
      const expiryMs = parseStoredTokenExpiryMs(useAppStore.getState().tokenExpiresAt) || getStoredTokenExpiryMs();
      if (hasTokenExpiryElapsed(expiryMs)) {
        performSessionExpiredLogout('token_expired');
        return false;
      }
      return true;
    }

    const storeState = useAppStore.getState();
    const hadActiveSession = Boolean(
      isAuthenticatedRef.current ||
      storeState.isAuthenticated ||
      lastObservedAuthTokenRef.current
    );

    if (hadActiveSession) {
      performSessionExpiredLogout(reason);
      return false;
    }

    return true;
  }, [performSessionExpiredLogout]);

  const handleLoginSuccess = useCallback((nextAccountId: string) => {
    const loginId = parsePositiveInt(nextAccountId);
    const token = getStoredAuthToken();

    if (!loginId || !token) {
      performSessionExpiredLogout('login_missing_token');
      return;
    }

    lastObservedAuthTokenRef.current = token;
    authSessionGenerationRef.current += 1;
    setIsAuthenticated(true);
    setAccountId(String(loginId));

    const storeState = useAppStore.getState();
    if (!storeState.isAuthenticated || storeState.accountId !== String(loginId)) {
      const refreshToken = localStorage.getItem('refresh_token') || sessionStorage.getItem('refresh_token') || undefined;
      const expiresAt = getStoredTokenExpiryMs() || undefined;
      storeState.setAuthenticated(true, String(loginId), token, refreshToken, expiresAt);
    }

  }, [performSessionExpiredLogout]);

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

  const markTradeWsMessage = useCallback(() => {
    lastTradeWsMessageAtRef.current = Date.now();
    tradeDataVersionRef.current += 1;
  }, []);

  const markLocalTradeMutation = useCallback((ticketIds: number[] = []) => {
    tradeDataVersionRef.current += 1;
    localTradeDataVersionRef.current += 1;
    ticketIds.forEach((ticketId) => {
      if (Number.isFinite(ticketId)) {
        optimisticClosedTicketsRef.current.add(ticketId);
      }
    });
  }, []);

  const markServerClosedTickets = useCallback((ticketIds: number[] = []) => {
    ticketIds.forEach((ticketId) => {
      if (Number.isFinite(ticketId)) {
        optimisticClosedTicketsRef.current.add(ticketId);
        serverClosedTicketsRef.current.add(ticketId);
      }
    });
  }, []);

  const reconcileOptimisticClosedPositions = useCallback((normalized: Position[], options: OptimisticCloseReconcileOptions = {}) => {
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
  }, []);

  const clearOptimisticClosedTickets = useCallback((ticketIds: number[]) => {
    ticketIds.forEach((ticketId) => optimisticClosedTicketsRef.current.delete(ticketId));
  }, []);

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

  // Listen for logout event from toolbar
  useEffect(() => {
    const handleLogoutEvent = () => {
      performSessionExpiredLogout('manual_logout');
    };
    window.addEventListener('rtx:logout', handleLogoutEvent);
    return () => window.removeEventListener('rtx:logout', handleLogoutEvent);
  }, [performSessionExpiredLogout]);

  // Listen for unauthorized/expired session events from API client
  useEffect(() => {
    const handleUnauthorizedEvent = (event: Event) => {
      const staleRequest = (event as CustomEvent<{ staleRequest?: boolean }>).detail?.staleRequest;
      if (staleRequest) {
        console.warn('[App] Ignoring stale unauthorized response for an older session token.');
        return;
      }

      console.warn('[App] Session expired or unauthorized request. Performing global logout.');
      performSessionExpiredLogout((event as CustomEvent<{ reason?: string }>).detail?.reason || 'unauthorized');
    };
    window.addEventListener('auth:unauthorized', handleUnauthorizedEvent as EventListener);
    return () => window.removeEventListener('auth:unauthorized', handleUnauthorizedEvent as EventListener);
  }, [performSessionExpiredLogout]);

  useEffect(() => {
    const handleTokenUpdated = () => {
      setTokenSessionVersion((value) => value + 1);
      validateStoredAuthSession('auth_token_missing');
    };
    window.addEventListener('auth:token-updated', handleTokenUpdated);
    return () => window.removeEventListener('auth:token-updated', handleTokenUpdated);
  }, [validateStoredAuthSession]);

  useEffect(() => {
    const authStorageKeys = new Set(['auth_token', 'refresh_token', 'token_expires_at']);
    const handleStorage = (event: StorageEvent) => {
      if (event.storageArea !== localStorage && event.storageArea !== sessionStorage) return;
      if (event.key && !authStorageKeys.has(event.key)) return;

      setTokenSessionVersion((value) => value + 1);
      validateStoredAuthSession(event.key === 'auth_token' && !event.newValue
        ? 'auth_token_removed'
        : 'auth_storage_changed');
    };

    window.addEventListener('storage', handleStorage);
    return () => window.removeEventListener('storage', handleStorage);
  }, [validateStoredAuthSession]);

  useEffect(() => {
    if (!isAuthenticated) return undefined;

    const intervalId = window.setInterval(() => {
      validateStoredAuthSession('auth_token_removed');
    }, 1000);

    return () => window.clearInterval(intervalId);
  }, [isAuthenticated, tokenSessionVersion, validateStoredAuthSession]);

  useEffect(() => {
    if (!isAuthenticated) return undefined;

    const expiryMs = parseStoredTokenExpiryMs(storeTokenExpiresAt) || getStoredTokenExpiryMs();
    if (!expiryMs) return undefined;

    const delay = expiryMs - Date.now();
    if (delay <= 0) {
      performSessionExpiredLogout('token_expired');
      return undefined;
    }

    const timeoutId = window.setTimeout(
      () => performSessionExpiredLogout('token_expired'),
      Math.min(delay, 2147483647)
    );

    return () => window.clearTimeout(timeoutId);
  }, [isAuthenticated, performSessionExpiredLogout, storeTokenExpiresAt, tokenSessionVersion]);

  // Session restore uses existing token state only; App must not decode or replay saved passwords.
  useEffect(() => {
    // React StrictMode replays mount effects in development. Session restore is
    // one startup transaction and must not validate the same account twice.
    if (sessionRestoreStartedRef.current) return;
    sessionRestoreStartedRef.current = true;

    // Same-document login was already validated by the server and committed
    // before App mounted. Do not start a second restore transaction or flash a
    // restore surface between the real login form and the terminal.
    if (freshSessionHandoff) {
      setIsAutoAuthenticating(false);
      return;
    }

    const restoreSession = async () => {
      const sessionGeneration = authSessionGenerationRef.current;
      setIsAutoAuthenticating(true);
      setAutoAuthError(null);
      updateDynamicUrls();

      const token = localStorage.getItem('auth_token');
      const refreshToken = localStorage.getItem('refresh_token');
      const rememberedLogin = localStorage.getItem('rtx_saved_username') || localStorage.getItem('rtx_last_login');
      localStorage.removeItem('rtx_saved_password');

      // Also check savedAccounts from persisted store for multi-account support
      const storeState = useAppStore.getState();
      const savedAccounts = storeState.savedAccounts || [];
      if (savedAccounts.some((account: any) => account.password)) {
        useAppStore.setState({
          savedAccounts: savedAccounts.map(({ password: _password, ...account }: any) => account)
        } as any);
      }
      const lastAccountId = storeState.accountId;
      const restoredExpiryMs = storeState.tokenExpiresAt || getStoredTokenExpiryMs();
      const restoreScope = getCommittedBrokerAccountSessionScope();
      // Guests can complete another login while the stored account is being
      // validated. Only this original account scope may accept the response
      // or clear authentication on failure. Token refresh within the same
      // restore is allowed; a committed login/logout changes the scope.
      const isCurrentRestore = () => {
        const currentState = useAppStore.getState();
        return getCommittedBrokerAccountSessionScope() === restoreScope
          && currentState.isAuthenticated === storeState.isAuthenticated
          && currentState.accountId === lastAccountId;
      };

      if (hasTokenExpiryElapsed(restoredExpiryMs)) {
        performSessionExpiredLogout('token_expired');
        setIsAutoAuthenticating(false);
        return;
      }

      if (storeState.isAuthenticated) {
        const authenticatedLogin = parsePositiveInt(lastAccountId || undefined);
        if (authenticatedLogin) {
          const restoredAccountId = String(authenticatedLogin);
          setIsAuthenticated(true);
          setAccountId(restoredAccountId);
          console.log('[Session] Restored active authenticated store session for:', restoredAccountId);
          setIsAutoAuthenticating(false);
          return;
        }
      }

      // Determine which login to restore: prefer store's active accountId, then localStorage
      const targetLogin = lastAccountId || rememberedLogin;

      if (!targetLogin || (!token && !refreshToken)) {
        setIsAutoAuthenticating(false);
        return;
      }

      const loginId = targetLogin ? parseInt(String(targetLogin), 10) : null;
      if (!loginId || isNaN(loginId)) {
        setIsAutoAuthenticating(false);
        return;
      }

      try {
        // Saved-password re-login intentionally removed. Validate the current token only.

        // Strategy 2: Fallback — try old token 
        if (token || refreshToken) {
          const accData = await api.account.getAccountSummary(loginId);
          // Both staleness guards are kept: the committed broker-account scope
          // and this shell's auth generation must both still match, and the
          // stored token must still exist before the restore is allowed to
          // commit authentication for the account it started with.
          if (!isCurrentRestore()
            || authSessionGenerationRef.current !== sessionGeneration
            || !getStoredAuthToken()) return;
          const restoredAccountId = accData.id || String(loginId);
          const expiresAtStr = localStorage.getItem('token_expires_at');
          const expiresAt = expiresAtStr ? new Date(expiresAtStr).getTime() : undefined;
          const activeToken = localStorage.getItem('auth_token') || token;
          const activeRefresh = localStorage.getItem('refresh_token') || refreshToken;
          if (!activeToken) {
            throw new Error('Session restore did not produce an access token');
          }

          useAppStore.getState().setAuthTokens(activeToken, activeRefresh || undefined, expiresAt);
          useAppStore.getState().setAuthenticated(true, restoredAccountId, activeToken, activeRefresh || undefined, expiresAt);
          seedValidatedSessionAccountSummary(loginId, accData, activeToken);
          chartDataService.preloadStartupHistory();
          setIsAuthenticated(true);
          setAccountId(restoredAccountId);
          console.log('[Session] Restored via token for:', restoredAccountId);
          return;
        }
      } catch (err: any) {
        if (!isCurrentRestore() || authSessionGenerationRef.current !== sessionGeneration) return;
        console.log('[Session] Restore failed:', err.message);
        performSessionExpiredLogout('restore_failed');
        setAutoAuthError(err.message || 'Session restore failed');
      } finally {
        if (authSessionGenerationRef.current === sessionGeneration) setIsAutoAuthenticating(false);
      }
    };

    restoreSession();
  }, [freshSessionHandoff, performSessionExpiredLogout]);

  // Foreground Focus Handler: Catch window 'visibilitychange' & 'focus' events.
  // Proactively refresh token if needed, trigger immediate WS reconnect & positions refresh.
  useEffect(() => {
    const handleForeground = async () => {
      // Only execute if user is currently authenticated
      if (!isAuthenticatedRef.current) return;
      if (!validateStoredAuthSession('auth_token_removed')) return;
      const sessionGeneration = authSessionGenerationRef.current;

      console.log('[App] App returned to foreground / focus. Checking token status...');
      try {
        // Proactively refresh token if expired or close to expiry (<60s)
        const activeToken = await brokerApi.checkAndProactiveRefresh();
        if (authSessionGenerationRef.current !== sessionGeneration) return;
        if (!activeToken) {
          performSessionExpiredLogout('auth_token_missing');
          return;
        }

        // Dispatch immediate reconnect event to trigger WS reconnect without waiting backoff
        console.log('[App] Dispatching immediate WebSocket reconnection event...');
        window.dispatchEvent(new CustomEvent('rtx:reconnect-ws'));

        // Force a polling sync of all account position data
        console.log('[App] Dispatching immediate position refresh event...');
        window.dispatchEvent(new Event('rtx:force-refresh-positions'));
      } catch (err) {
        if (authSessionGenerationRef.current !== sessionGeneration
          || (err instanceof Error && 'code' in err && err.code === 'SESSION_CHANGED')) return;
        console.error('[App] Failed to refresh token or sync on foreground:', err);
        performSessionExpiredLogout('refresh_failed');
      }
    };

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        handleForeground();
      }
    };

    window.addEventListener('focus', handleForeground);
    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      window.removeEventListener('focus', handleForeground);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [performSessionExpiredLogout, validateStoredAuthSession]);

  // Reactively read store accountId (changes when user clicks account in Navigator)
  const storeAccountId = useAppStore(state => state.accountId);
  const storeIsAuthenticated = useAppStore(state => state.isAuthenticated);

  // Sync store accountId to local state — triggers data re-fetch
  useEffect(() => {
    if (!storeIsAuthenticated || !storeAccountId) {
      if (accountId) {
        console.log('[App] Account cleared via store:', accountId);
        clearLocalAccountState();
        setIsAuthenticated(false);
        setAccountId('');
      }
      return;
    }

    setAccountId((prev) => {
      if (prev !== storeAccountId) {
        console.log('[App] Account switched via store:', prev, '->', storeAccountId);
        setIsAuthenticated(true);
        return storeAccountId;
      }
      return prev;
    });
  }, [storeAccountId, storeIsAuthenticated, accountId, clearLocalAccountState]);

  // UI State
  const [showDOM, setShowDOM] = useState(false);
  const [domSymbol, setDomSymbol] = useState<string>(selectedSymbol);
  const [showAccountPanel, setShowAccountPanel] = useState(false);
  const [showOneClick, setShowOneClick] = useState(false);
  const [domPos, setDomPos] = useState({ x: 620, y: 56 });
  const [domSize, setDomSize] = useState({ w: 520, h: 540 });
  const [showChartProperties, setShowChartProperties] = useState(false);
  const [chartPropsSymbol, setChartPropsSymbol] = useState('');
  const [chartPropsTimeframe, setChartPropsTimeframe] = useState('M1');
  const [chartPropsContextId, setChartPropsContextId] = useState<string | undefined>(undefined);
  const [chartObjectsTarget, setChartObjectsTarget] = useState<{
    targetContextId: string | null;
    symbol: string;
    timeframe?: string;
  } | null>(null);

  // Indicator Navigator state
  const [showIndicatorNavigator, setShowIndicatorNavigator] = useState(false);
  const [indicatorNavCategory, setIndicatorNavCategory] = useState<string | undefined>(undefined);
  const [indicatorTarget, setIndicatorTarget] = useState<{
    targetContextId?: string;
    symbol?: string;
  }>({});

  // Data Window state
  const [showDataWindow, setShowDataWindow] = useState(false);
  const [dataWindowPos, setDataWindowPos] = useState({ x: 620, y: 56 });
  const [dataWindowSize, setDataWindowSize] = useState({ w: 240, h: 290 });

  const domDragRef = useRef<{ startX: number; startY: number; origX: number; origY: number } | null>(null);
  const domResizeRef = useRef<{ startX: number; startY: number; origW: number; origH: number; mode: string } | null>(null);

  const handleDomMouseDown = useCallback((e: MouseEvent | any) => {
    e.preventDefault();
    domDragRef.current = { startX: e.clientX, startY: e.clientY, origX: domPos.x, origY: domPos.y };
    const onMove = (ev: MouseEvent) => {
      if (!domDragRef.current) return;
      const dx = ev.clientX - domDragRef.current.startX;
      const dy = ev.clientY - domDragRef.current.startY;
      setDomPos({ x: domDragRef.current.origX + dx, y: domDragRef.current.origY + dy });
    };
    const onUp = () => {
      domDragRef.current = null;
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  }, [domPos]);

  const handleDomResizeMouseDown = useCallback((e: MouseEvent | any, mode: string) => {
    e.preventDefault();
    e.stopPropagation();
    domResizeRef.current = { startX: e.clientX, startY: e.clientY, origW: domSize.w, origH: domSize.h, mode };
    const onMove = (ev: MouseEvent) => {
      if (!domResizeRef.current) return;
      const dx = ev.clientX - domResizeRef.current.startX;
      const dy = ev.clientY - domResizeRef.current.startY;
      // Capture values synchronously — ref may be null by the time the state updater runs
      const { mode: m, origW, origH } = domResizeRef.current;
      setDomSize(prev => ({
        w: m !== 's' ? Math.max(360, origW + dx) : prev.w,
        h: m !== 'e' ? Math.max(200, origH + dy) : prev.h,
      }));
    };
    const onUp = () => {
      domResizeRef.current = null;
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  }, [domSize]);

  // Data Window drag handler
  const dataWindowDragRef = useRef<{ startX: number; startY: number; origX: number; origY: number } | null>(null);
  const handleDataWindowMouseDown = useCallback((e: MouseEvent | any) => {
    e.preventDefault();
    dataWindowDragRef.current = { startX: e.clientX, startY: e.clientY, origX: dataWindowPos.x, origY: dataWindowPos.y };
    const onMove = (ev: MouseEvent) => {
      if (!dataWindowDragRef.current) return;
      const dx = ev.clientX - dataWindowDragRef.current.startX;
      const dy = ev.clientY - dataWindowDragRef.current.startY;
      setDataWindowPos({ x: dataWindowDragRef.current.origX + dx, y: dataWindowDragRef.current.origY + dy });
    };
    const onUp = () => {
      dataWindowDragRef.current = null;
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  }, [dataWindowPos]);

  // Data Window resize handler — supports all 4 sides + 4 corners
  const dataWindowResizeRef = useRef<{ startX: number; startY: number; origW: number; origH: number; origX: number; origY: number; mode: string } | null>(null);
  const handleDataWindowResizeMouseDown = useCallback((e: MouseEvent | any, mode: string) => {
    e.preventDefault();
    e.stopPropagation();
    dataWindowResizeRef.current = {
      startX: e.clientX, startY: e.clientY,
      origW: dataWindowSize.w, origH: dataWindowSize.h,
      origX: dataWindowPos.x, origY: dataWindowPos.y,
      mode,
    };
    const onMove = (ev: MouseEvent) => {
      const r = dataWindowResizeRef.current;
      if (!r) return;
      const dx = ev.clientX - r.startX;
      const dy = ev.clientY - r.startY;
      const MIN_W = 200, MIN_H = 200;
      setDataWindowSize(prev => ({
        w: (mode.includes('e')) ? Math.max(MIN_W, r.origW + dx)
          : (mode.includes('w')) ? Math.max(MIN_W, r.origW - dx) : prev.w,
        h: (mode.includes('s')) ? Math.max(MIN_H, r.origH + dy)
          : (mode.includes('n')) ? Math.max(MIN_H, r.origH - dy) : prev.h,
      }));
      setDataWindowPos(prev => ({
        x: mode.includes('w') ? r.origX + Math.min(dx, r.origW - MIN_W) : prev.x,
        y: mode.includes('n') ? r.origY + Math.min(dy, r.origH - MIN_H) : prev.y,
      }));
    };
    const onUp = () => {
      dataWindowResizeRef.current = null;
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  }, [dataWindowSize, dataWindowPos]);

  // Helper: find the first Chart panel in the dock layout tree
  const findFirstChartPanel = useCallback((container: any): string | null => {
    if (!container?.children) return null;
    for (const child of container.children) {
      if (child.component === 'Chart') return child.id;
      if (child.children) {
        const found = findFirstChartPanel(child);
        if (found) return found;
      }
    }
    return null;
  }, []);

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
  const publicMarketSymbolNames = useMemo(
    () => getAllowedSymbolNames(marketInstrumentsSnapshot.symbols),
    [marketInstrumentsSnapshot.symbols],
  );
  const chartEligibleSymbolNames = useMemo(() => {
    const chartCatalog = buildChartEligibleSymbolNames(
      [...allowedSymbolNames, ...publicMarketSymbolNames],
      activeMarketSymbols,
    );
    if (chartCatalog.length > 0) return chartCatalog;
    return getAllowedSymbolNames(activeMarketSymbols);
  }, [activeMarketSymbols, allowedSymbolNames, publicMarketSymbolNames]);
  const tradeEligibleSymbolNames = useMemo(() => {
    if (!activeMarketSymbolsCurrent) return [];
    const fromCatalog = buildTradeEligibleSymbolNames(allowedSymbolNames, activeMarketSymbols);
    if (fromCatalog.length > 0) return fromCatalog;
    return getAllowedSymbolNames(activeMarketSymbols);
  }, [activeMarketSymbols, activeMarketSymbolsCurrent, allowedSymbolNames]);
  const chartEligibleSymbolsKey = chartEligibleSymbolNames.join(',');
  const chartEligibleSymbolSet = useMemo(() => new Set(chartEligibleSymbolNames), [chartEligibleSymbolNames]);
  const tradeEligibleSymbolSet = useMemo(() => new Set(tradeEligibleSymbolNames), [tradeEligibleSymbolNames]);
  const hasLoadedChartSymbols = hasLoadedSymbols
    || publicMarketSymbolNames.length > 0
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
    const unsub3 = commandBus.subscribe('OPEN_INDICATOR_LIST' as any, (payload: any) => {
      const activeTarget = getActiveChartCommandTarget();
      setIndicatorNavCategory(payload?.category ?? undefined);
      setIndicatorTarget({
        targetContextId: payload?.targetContextId ?? activeTarget.targetContextId,
        symbol: payload?.symbol ?? activeTarget.symbol,
      });
      setShowIndicatorNavigator(true);
    });
    return () => { unsub1(); unsub2(); unsub3(); };
  }, []);

  // Order Panel State
  const [orderPanelOpen, setOrderPanelOpen] = useState(false);
  const [orderPanelSymbol, setOrderPanelSymbol] = useState('');
  const [orderPanelPrice, setOrderPanelPrice] = useState({ bid: 0, ask: 0 });
  const [tradeAuthOpen, setTradeAuthOpen] = useState(false);
  const [pendingTradeIntent, setPendingTradeIntent] = useState<TradingAuthIntent | null>(null);

  useEffect(() => {
    const handleTradingAuthRequest = (event: Event) => {
      const intent = (event as CustomEvent<TradingAuthIntent>).detail;
      if (!intent) return;
      setPendingTradeIntent(intent);
      setTradeAuthOpen(true);
    };
    window.addEventListener(TRADING_AUTH_REQUEST_EVENT, handleTradingAuthRequest);
    return () => window.removeEventListener(TRADING_AUTH_REQUEST_EVENT, handleTradingAuthRequest);
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
  const { addNotification } = useNotificationStore();

  // Alerts
  const { checkAlerts } = useAlertStore();

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
  // and desktop builds. Reset the actual panes as well as selection so a
  // previous session in this tab cannot carry its chart into the next login.
  // Saved per-account layouts are neither restored nor auto-saved at startup.
  useEffect(() => {
    useDockLayoutStore.getState().resetToDefaultLayout();
    setSelectedSymbol(DEFAULT_CHART_SYMBOL);
    setTimeframe(DEFAULT_CHART_TIMEFRAME);

    if (!isAuthenticated || !accountId) {
      setRestoredLayoutAccountId('');
      return;
    }

    setRestoredLayoutAccountId('');
    setRestoredLayoutAccountId(accountId);
  }, [isAuthenticated, accountId]);

  // Broker config — /api/config is not deployed yet, use defaults directly
  useEffect(() => {
    setBrokerConfig({
      brokerName: 'RTX',
      priceFeedLP: 'YOFX',
      executionMode: 'ABOOK',
      defaultLeverage: 1000,
      defaultBalance: 0,
      marginMode: 'HEDGING',
      maxTicksPerSymbol: 1000,
    } as any);
  }, []);

  const refreshPositions = useCallback(async (login?: number, options: RefreshPositionsOptions = {}) => {
    const requestedLogin = login || getLiveTradingLogin();
    if (!requestedLogin) return;

    if (refreshPositionsInFlightRef.current) {
      refreshPositionsPendingRef.current = { login: requestedLogin, options };
      await refreshPositionsInFlightRef.current;
      return;
    }

    const request = (async () => {
    try {
      const restRead = beginTradeRestRead();
      const positionsVersion = positionsStreamVersionRef.current;
      const posData = await api.positions.getPositions(requestedLogin);
      const activeLogin = parsePositiveInt(useAppStore.getState().accountId || accountIdRef.current || undefined);
      if (!isAuthenticatedRef.current || activeLogin !== requestedLogin) return;
      if (isStaleTradeRestRead(restRead, options)) return;

      const currentPositions = useAppStore.getState().positions;
      const decoded = decodePositionStreamMessage({ data: { positions: posData } });
      const normalized = reconcileOptimisticClosedPositions(decoded
        ? applyPositionStreamUpdate(currentPositions, {
          ...decoded,
          source: 'rest',
          kind: positionsStreamVersionRef.current > positionsVersion ? 'patch' : 'snapshot',
        }, raw => normalizePositions([raw])[0])
        : normalizePositions(posData), { clearConfirmedAbsent: true });
      // Write ONLY to the central store — NOT to local App state.
      // This prevents App.tsx from re-rendering (which caused the blank-display crash
      // after every Buy/Sell). BottomDock reads positions from useAppStore directly.
      applyOpenPositionSnapshot(normalized);
    } catch (err: any) {
      console.warn('[App] refreshPositions failed:', err.message);
    } finally {
      refreshPositionsInFlightRef.current = null;
      const pendingRefresh = refreshPositionsPendingRef.current;
      refreshPositionsPendingRef.current = null;
      if (pendingRefresh) {
        void refreshPositions(pendingRefresh.login, pendingRefresh.options);
      }
    }
    })();

    refreshPositionsInFlightRef.current = request;
    await request;
  }, [beginTradeRestRead, getLiveTradingLogin, isStaleTradeRestRead, reconcileOptimisticClosedPositions]);

  const refreshOrdersAndHistory = useCallback(async (login?: number) => {
    const resolvedLogin = login || getLiveTradingLogin();
    if (!resolvedLogin) return;

    if (refreshHistoryInFlightRef.current) {
      refreshHistoryPendingLoginRef.current = resolvedLogin;
      await refreshHistoryInFlightRef.current;
      return;
    }

    window.dispatchEvent(new CustomEvent('rtx:trade-history-refresh-started', {
      detail: { login: resolvedLogin },
    }));

    const request = (async () => {
      let historyError: unknown = null;
      let historySucceeded = false;
      try {
        const [pendingOrdersResult, orderHistoryResult] = await Promise.allSettled([
          api.orders.getPendingOrders(resolvedLogin),
          fetchOrderHistory(resolvedLogin),
        ]);

        if (!isAuthenticatedRef.current || getLiveTradingLogin() !== resolvedLogin) return;

        const pendingOrders = pendingOrdersResult.status === 'fulfilled'
          ? pendingOrdersResult.value
          : [];

        setOrders(pendingOrders as any);
        useAppStore.getState().setOrders(pendingOrders as any);

        if (orderHistoryResult.status === 'fulfilled') {
          historySucceeded = true;
          useAppStore.getState().setTrades(orderHistoryResult.value.trades as any);
          if (orderHistoryResult.value.warning) {
            historyError = orderHistoryResult.value.warning;
            console.warn('[History] Partially refreshed trade history:', historyError);
            window.dispatchEvent(new CustomEvent('rtx:trade-history-refresh-error', {
              detail: {
                login: resolvedLogin,
                partial: true,
                message: getErrorMessage(historyError, 'Some order history sources failed'),
              },
            }));
          }
        } else {
          historyError = orderHistoryResult.reason;
          console.error('[History] Failed to refresh trade history:', historyError);
          window.dispatchEvent(new CustomEvent('rtx:trade-history-refresh-error', {
            detail: {
              login: resolvedLogin,
              message: getErrorMessage(historyError, 'Failed to refresh order history'),
            },
          }));
        }
      } finally {
        refreshHistoryInFlightRef.current = null;
        window.dispatchEvent(new CustomEvent('rtx:trade-history-refresh-completed', {
          detail: {
            login: resolvedLogin,
            ok: historySucceeded,
            message: historyError ? getErrorMessage(historyError, 'Failed to refresh order history') : null,
          },
        }));

        const pendingLogin = refreshHistoryPendingLoginRef.current;
        refreshHistoryPendingLoginRef.current = null;
        if (pendingLogin) {
          void refreshOrdersAndHistory(pendingLogin);
        }
      }
    })();

    refreshHistoryInFlightRef.current = request;
    await request;
  }, [getLiveTradingLogin]);

  useEffect(() => {
    let refreshTimer: number | null = null;
    let pendingLogin: number | null = null;
    const handleSync = (event: Event) => {
      const eventLogin = parsePositiveInt(String((event as CustomEvent)?.detail?.login ?? ''));
      const requestedLogin = eventLogin || getLiveTradingLogin();
      if (!requestedLogin) return;
      pendingLogin = requestedLogin;
      if (refreshTimer !== null) window.clearTimeout(refreshTimer);
      // A burst can produce one fill event per order. The WS fill is already
      // reflected immediately, so collapse reconciliation-only REST reads into
      // one trailing refresh instead of competing with subsequent clicks.
      refreshTimer = window.setTimeout(() => {
        refreshTimer = null;
        const login = pendingLogin;
        pendingLogin = null;
        if (login) refreshPositions(login, { allowWsCommit: true });
      }, 100);
    };
    window.addEventListener('rtx:force-refresh-positions', handleSync);
    return () => {
      window.removeEventListener('rtx:force-refresh-positions', handleSync);
      if (refreshTimer !== null) window.clearTimeout(refreshTimer);
    };
  }, [getLiveTradingLogin, refreshPositions]);

  useEffect(() => {
    const handleHistoryRefreshRequest = (event: Event) => {
      if (!isAuthenticatedRef.current) return;

      const requestedLogin = parsePositiveInt(String((event as CustomEvent)?.detail?.login ?? ''));
      const liveLogin = getLiveTradingLogin();
      if (!requestedLogin || !liveLogin || requestedLogin !== liveLogin) return;

      refreshOrdersAndHistory(requestedLogin).catch(err => {
        console.error('[History] Failed to refresh orders/history:', err);
      });
    };

    window.addEventListener('rtx:refresh-trade-history-requested', handleHistoryRefreshRequest);
    return () => {
      window.removeEventListener('rtx:refresh-trade-history-requested', handleHistoryRefreshRequest);
    };
  }, [getLiveTradingLogin, refreshOrdersAndHistory]);

  const closingTicketsRef = useRef<Set<number>>(new Set());
  const bulkCloseInFlightRef = useRef(false);

  const handleClosePosition = async (id: number): Promise<boolean> => {
    // Guard against double-click: skip if already closing this ticket
    if (closingTicketsRef.current.has(id)) {
      console.log(`[App] Close already in progress for ticket ${id}, skipping duplicate`);
      return false;
    }
    closingTicketsRef.current.add(id);

    const closeSnapshots = buildTradeOverlayCloseSnapshots(
      useAppStore.getState().positions.filter((position) => position.id === id) as Position[],
    );
    markLocalTradeMutation([id]);
    dispatchTradeOverlayCloseState([id], 'pending', { snapshots: closeSnapshots });
    // Optimistically remove from the app store immediately.
    useAppStore.getState().setPositions(useAppStore.getState().positions.filter(p => p.id !== id));
    // Trigger close sound
    import('./utils/audio').then(m => m.playSystemSound('close'));

    try {
      await api.positions.closePosition(String(id));
      markLocalTradeMutation();
      dispatchTradeOverlayCloseState([id], 'confirmed', { snapshots: closeSnapshots });
      const loginId = getLiveTradingLogin() || undefined;
      refreshPositions(loginId, { allowWsCommit: true });
      if (loginId) {
        refreshOrdersAndHistory(loginId).catch(err => console.error('[Trade] Failed to refresh orders/history after close:', err));
      }
      return true;
    } catch (err: any) {
      clearOptimisticClosedTickets([id]);
      dispatchTradeOverlayCloseState([id], 'failed');
      console.error('Failed to close position:', err);
      refreshPositions(getLiveTradingLogin() || undefined, { allowWsCommit: true });
      return false;
    } finally {
      closingTicketsRef.current.delete(id);
    }
  };

  // ── cTrader-style chart position actions (reverse / double / close) ──
  const chartPositionActionBusyRef = useRef<Set<number>>(new Set());

  const handleReversePosition = async (ticket: number) => {
    if (chartPositionActionBusyRef.current.has(ticket)) return;
    const position = (useAppStore.getState().positions as Position[])
      .find((candidate) => Number(candidate.id) === ticket);
    if (!position) return;
    const login = getLiveTradingLogin();
    if (!login) {
      publishOrderFeedback('No trading account is selected. Please sign in again.');
      return;
    }
    const intentAtMs = captureTradeOrderIntent();
    const reverseSide = position.side === 'BUY' ? 'sell' : 'buy';
    const { symbol: positionSymbol, volume: positionVolume } = position;
    chartPositionActionBusyRef.current.add(ticket);
    try {
      const closed = await handleClosePosition(ticket);
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
      chartPositionActionBusyRef.current.delete(ticket);
    }
  };

  const handleDoublePosition = async (ticket: number) => {
    if (chartPositionActionBusyRef.current.has(ticket)) return;
    const position = (useAppStore.getState().positions as Position[])
      .find((candidate) => Number(candidate.id) === ticket);
    if (!position) return;
    const login = getLiveTradingLogin();
    if (!login) {
      publishOrderFeedback('No trading account is selected. Please sign in again.');
      return;
    }
    const intentAtMs = captureTradeOrderIntent();
    chartPositionActionBusyRef.current.add(ticket);
    try {
      await api.orders.placeMarketOrder({
        side: position.side === 'SELL' ? 'sell' : 'buy',
        symbol: position.symbol,
        volume: position.volume,
        login,
      }, { intentAtMs });
      publishOrderFeedback(
        [feedbackValue(`#${ticket} · `), feedbackLabel(position.side), feedbackValue(` +${position.volume} ${position.symbol} · `), feedbackLabel('Completed')],
        'success',
      );
      window.dispatchEvent(new Event('rtx:force-refresh-positions'));
    } catch (err) {
      console.error('[Chart] Double position failed:', err);
      publishOrderFeedback(formatOrderError(err));
    } finally {
      chartPositionActionBusyRef.current.delete(ticket);
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

      setOrders(ordersPayload);
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
    if (bulkCloseInFlightRef.current) return;

    const previewCandidates = normalizePositions(useAppStore.getState().positions).filter((position) => {
      if (!(position.id > 0)) return false;
      if (symbol && position.symbol !== symbol) return false;
      if (type === 'ALL') return true;
      const profit = backendCloseProfit(position);
      if (profit === null) return false;
      return type === 'WINNERS' ? profit > 0 : profit < 0;
    });
    if (previewCandidates.length === 0) return;
    const combinedProfit = previewCandidates.reduce(
      (total, position) => total + (backendCloseProfit(position) ?? 0),
      0,
    );
    const previewPositions = previewCandidates.map((position) => ({
      id: position.id,
      symbol: position.symbol,
      side: position.side,
      volume: position.volume,
      openPrice: position.openPrice,
      pnl: backendCloseProfit(position) ?? 0,
    }));
    const confirmed = await useBulkCloseConfirmStore.getState().showBulkCloseConfirm({
      type,
      symbol,
      positions: previewPositions,
      combinedPnL: combinedProfit,
    });
    if (!confirmed) return;

    bulkCloseInFlightRef.current = true;

    let optimisticTicketIds: number[] = [];
    let claimedBulkTicketIds: number[] = [];
    try {
      const accId = getLiveTradingLogin();
      if (!accId) return;
      const closeSessionScope = getCommittedBrokerAccountSessionScopeKey(
        getCommittedBrokerAccountSessionScope(),
      );
      const selectMatchingCandidates = (openPositions: readonly Position[]) => openPositions.filter((position) => {
        if (!(position.id > 0)) return false;
        if (symbol && position.symbol !== symbol) return false;
        if (type === 'ALL') return true;
        const profit = backendCloseProfit(position);
        if (profit === null) return false;
        return type === 'WINNERS' ? profit > 0 : profit < 0;
      });

      const localCandidates = selectMatchingCandidates(
        normalizePositions(useAppStore.getState().positions),
      );
      const closeResult = await closePositionsLocalFirst({
        sessionKey: closeSessionScope,
        getCurrentSessionKey: () => {
          if (!isAuthenticatedRef.current || getLiveTradingLogin() !== accId) return null;
          return getCommittedBrokerAccountSessionScopeKey(getCommittedBrokerAccountSessionScope());
        },
        localCandidates,
        loadAuthoritativeCandidates: async () => selectMatchingCandidates(normalizePositions(await tradingV2Api
          .getPositions(accId, { limit: 500, offset: 0 })
          .catch(() => api.positions.getPositions(accId) as any))),
        closePosition: (ticketId) => api.positions.closePosition(String(ticketId)),
        tryClaimTicket: (ticketId) => {
          if (closingTicketsRef.current.has(ticketId)) return false;
          closingTicketsRef.current.add(ticketId);
          claimedBulkTicketIds.push(ticketId);
          return true;
        },
        onCandidatesStarted: (candidates) => {
          const ticketIds = candidates.map((position) => position.id);
          optimisticTicketIds = [...optimisticTicketIds, ...ticketIds];
          markLocalTradeMutation(ticketIds);
          dispatchTradeOverlayCloseState(ticketIds, 'pending', {
            snapshots: buildTradeOverlayCloseSnapshots(candidates),
          });
          const ticketSet = new Set(ticketIds);
          useAppStore.getState().setPositions(
            useAppStore.getState().positions.filter((position) => !ticketSet.has(position.id)),
          );
        },
      });

      if (!closeResult.sessionCurrent) return;

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

      markLocalTradeMutation();
      if (confirmedTicketIds.length > 0) {
        dispatchTradeOverlayCloseState(confirmedTicketIds, 'confirmed');
      }
      if (failedTicketIds.length > 0) {
        clearOptimisticClosedTickets(failedTicketIds);
        dispatchTradeOverlayCloseState(failedTicketIds, 'failed');
        const failureMessage = formatOrderError(failedReasons[0]);
        console.error(`Bulk close failed for ${failedTicketIds.length} position(s):`, failedReasons[0]);
        publishOrderFeedback(
          [feedbackLabel('Positions'), feedbackValue(': '), feedbackLabel('closed'), feedbackValue(` ${confirmedTicketIds.length}/${closeResult.attemptedTicketIds.length} · `), feedbackLabel('Failed'), feedbackValue(`: ${failedTicketIds.length} — ${failureMessage}`)],
        );
      } else {
        publishOrderFeedback(
          [feedbackLabel('Positions'), feedbackValue(': '), feedbackLabel('closed'), feedbackValue(` ${confirmedTicketIds.length}`)],
          'success',
        );
      }
      if (closeResult.authoritativeSnapshotError) {
        console.warn('[Trade] Closed visible positions, but authoritative discovery failed:', closeResult.authoritativeSnapshotError);
      }
      refreshPositions(accId, { allowWsCommit: true });
      refreshOrdersAndHistory(accId).catch(err => console.error('[Trade] Failed to refresh orders/history after bulk close:', err));
    } catch (err) {
      clearOptimisticClosedTickets(optimisticTicketIds);
      dispatchTradeOverlayCloseState(optimisticTicketIds, 'failed');
      console.error('Bulk close failed:', err);
      publishOrderFeedback(formatOrderError(err));
      refreshPositions(getLiveTradingLogin() || undefined, { allowWsCommit: true });
    } finally {
      claimedBulkTicketIds.forEach((ticket) => closingTicketsRef.current.delete(ticket));
      bulkCloseInFlightRef.current = false;
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
  const refreshDesktopConnection = useCallback(() => {
    reconnect();
    getQuoteSocketManager().reconnect();
    void activeMarketSnapshot.reload();
  }, [activeMarketSnapshot.reload, reconnect]);
  const previousTradeConnectionStateRef = useRef(connectionState);

  useEffect(() => {
    const previousState = previousTradeConnectionStateRef.current;
    previousTradeConnectionStateRef.current = connectionState;
    if (previousState !== 'connected' && connectionState === 'connected') {
      window.dispatchEvent(new Event('rtx:trade-stream-recovered'));
    }
  }, [connectionState]);

  // Fetch account and positions once, then only after an actual stream recovery.
  useEffect(() => {
    if (!isAuthenticated || !accountId) return;

    const loginId = parsePositiveInt(accountId);
    if (!loginId) return;
    let setupActive = true;

    const fetchAccountHeartbeat = async (isInitial = false) => {
      if (accountPollInFlightRef.current) {
        const inFlightLogin = accountPollInFlightLoginRef.current;
        await accountPollInFlightRef.current;
        if (inFlightLogin === loginId) {
          if (isInitial && setupActive && isAuthenticatedRef.current && accountIdRef.current === String(loginId)) {
            setInitialTradeSnapshotSettledFor(String(loginId));
          }
          return;
        }
        const activeLogin = parsePositiveInt(useAppStore.getState().accountId || accountIdRef.current || undefined);
        if (!isAuthenticatedRef.current || activeLogin !== loginId) return;
      }

      const request = (async () => {
        try {
        const restRead = beginTradeRestRead();
        const positionsVersion = positionsStreamVersionRef.current;
        const metricsScope = getCommittedBrokerAccountSessionScopeKey(getCommittedBrokerAccountSessionScope());
        const isAccountSwitch = activeAccountDataRef.current !== loginId;
        if (isInitial) {
          console.log('[App] Fetching account data for login:', loginId);
          // Clear stale data — write to store, not local App state
          if (isAccountSwitch) {
            // Clear stale data only when moving to a different account.
            optimisticClosedTicketsRef.current.clear();
            serverClosedTicketsRef.current.clear();
            useAppStore.getState().setAccount(null);
            useAppStore.getState().setPositions([] as any);
            useAppStore.getState().setOrders([] as any);
            useAppStore.getState().setTrades([] as any);
          }
        }

        const {
          accountResult: accResult,
          positionsResult: posResult,
        } = await loadSessionTradeSnapshot(loginId);

        const activeLogin = parsePositiveInt(useAppStore.getState().accountId || accountIdRef.current || undefined);
        if (!isAuthenticatedRef.current || activeLogin !== loginId || metricsScope !== getCommittedBrokerAccountSessionScopeKey(getCommittedBrokerAccountSessionScope())) {
          return;
        }

        const accPayload = accResult.status === 'fulfilled' ? accResult.value : null;
        const posPayload = posResult.status === 'fulfilled' ? posResult.value : null;

        if (isInitial) {
          if (accResult.status === 'rejected') console.error('[REST Error] getAccountSummary failed:', accResult.reason);
          if (posResult.status === 'rejected') console.error('[REST Error] getPositions failed:', posResult.reason);
        }

        if (isStaleTradeRestRead(restRead, isInitial ? { allowWsCommit: true } : undefined)) return;

        // Write account data to the Zustand store directly — NOT to App local state.
        // This prevents App.tsx from re-rendering on every poll (root cause of blank-display crash).
        if (accPayload) {
          // A slower REST response may supply identity and missing metrics, but
          // must never roll back financial values already received over WS:
          // normalizeAccountMetrics enforces that through publication_token
          // monotonicity within this broker-account scope.
          const normalizedAccount = normalizeAccountSummary(accPayload, useAppStore.getState().account, {
            login: loginId,
            scope: metricsScope,
          });
          useAppStore.getState().setAccount(normalizedAccount as any);
        }

        // Extract account name from summary and save to Navigator's savedAccounts
        if (accPayload && loginId) {
          const raw = accPayload as any;
          const accountName = raw?.name || raw?.account_name || raw?.display_name || raw?.user_name || '';
          if (accountName) {
            const appState = useAppStore.getState();
            const existingAccount = appState.savedAccounts.find((account) => account.login === loginId);
            const serverFromPayload = [
              raw?.broker_server,
              raw?.server,
              raw?.server_name,
              raw?.mt5_server,
              raw?.trade_server,
            ].map((server) => typeof server === 'string' ? server.trim() : '').find(Boolean);

            appState.addSavedAccount({
              login: loginId,
              name: accountName,
              server: existingAccount?.server || serverFromPayload || getStoredBrokerServer(),
              isLive: true,
              lastUsed: Date.now(),
            });
            if (isInitial) console.log(`[App] Saved account name for ${loginId}: "${accountName}"`);
          }
        }

        if (posPayload !== null) {
          const currentPositions = useAppStore.getState().positions;
          const decoded = decodePositionStreamMessage({ data: { positions: posPayload } });
          applyOpenPositionSnapshot(reconcileOptimisticClosedPositions(decoded
            ? applyPositionStreamUpdate(currentPositions, {
              ...decoded,
              source: 'rest',
              kind: positionsStreamVersionRef.current > positionsVersion ? 'patch' : 'snapshot',
            }, raw => normalizePositions([raw])[0])
            : normalizePositions(posPayload), { clearConfirmedAbsent: true }));
        }
        activeAccountDataRef.current = loginId;

        if (isInitial) console.log('[App] Account data loaded for login:', loginId);
        } catch (err) {
          if (isInitial) console.error('Failed to fetch account data:', err);
        } finally {
          if (isInitial && setupActive && isAuthenticatedRef.current && accountIdRef.current === String(loginId)) {
            setInitialTradeSnapshotSettledFor(String(loginId));
          }
          if (accountPollInFlightLoginRef.current === loginId) {
            accountPollInFlightRef.current = null;
            accountPollInFlightLoginRef.current = null;
          }
        }
      })();

      accountPollInFlightLoginRef.current = loginId;
      accountPollInFlightRef.current = request;
      await request;
    };

    // The first StrictMode setup is cleaned up before this microtask runs, so
    // only the live effect owns the initial account/history requests.
    queueMicrotask(() => {
      if (!setupActive) return;
      void fetchAccountHeartbeat(true);
      void refreshOrdersAndHistory(loginId).catch(err => {
        console.error('[History] Failed to refresh initial orders/history:', err);
      });
    });

    const handleTradeStreamRecovery = () => {
      void fetchAccountHeartbeat(false);
    };
    window.addEventListener('rtx:trade-stream-recovered', handleTradeStreamRecovery);

    return () => {
      setupActive = false;
      window.removeEventListener('rtx:trade-stream-recovered', handleTradeStreamRecovery);
    };
  }, [beginTradeRestRead, isAuthenticated, accountId, isStaleTradeRestRead, reconcileOptimisticClosedPositions, refreshOrdersAndHistory]);

  // NOTE: positions are now written directly to useAppStore in the polling above.
  // No sync useEffect needed — removed to prevent double-write cascade.


  // PERFORMANCE FIX: Removed tick buffer for immediate updates (MT5 parity - <5ms latency)
  // const tickBuffer = useRef<Record<string, Tick>>({});



  // Update reconnect callback ref for StatusBar
  useEffect(() => {
    reconnectCallbackRef.current = reconnect;
  }, [reconnect]);

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
    ];

    console.log('[WS] Subscribing to account v2 channels:', channels.join(', '));
    const unsubscribers = channels.map(channel => subscribe(channel, () => undefined));
    return () => unsubscribers.forEach(unsubscribe => unsubscribe());
  }, [accountId, isAuthenticated, isConnected, subscribe]);

  // Subscribe to all WebSocket messages
  useEffect(() => {
    if (!isAuthenticated) return;

    console.log('[WS] Subscribing to all market data channels...');

    // Subscribe to wildcard channel to receive all message types
    const unsubscribe = subscribe('*', (message: any) => {
      try {
        const data = message;

        const isTickLikeUpdate = data.type === 'update' && (
          Number.isFinite(Number(data?.bid)) ||
          Number.isFinite(Number(data?.ask)) ||
          Number.isFinite(Number(data?.price)) ||
          Number.isFinite(Number(data?.last)) ||
          Number.isFinite(Number(data?.lastPrice))
        );
        const isLiveQuote = data.channel?.startsWith('quotes.');
        if (data.channel?.startsWith('account.') || data.channel?.startsWith('metrics.')) {
          const acceptedLogin = getAcceptedChannelLogin(data.channel);
          if (!acceptedLogin || !isBackendAccountForLogin(data, acceptedLogin, getCommittedBrokerAccountSessionScope().brokerId)) return;
          const backendAccountRecord = extractBackendAccountRecord(data);
          // Canonical command/account events and subscription acknowledgements
          // carry no metrics. They must not reset the last backend summary.
          if (!backendAccountRecord) return;
          markTradeWsMessage();

          // Live backend account summary stream
          if (WS_DEBUG) console.log('[DEBUG WS ACCOUNT RAW]', data);
          // extractAccountMetrics merges every envelope level, so broker scope
          // metadata (publication_token, calculated_at, source_as_of) survives.
          // The innermost record alone would drop it and defeat token ordering.
          const accData = extractAccountMetrics(data);
          if (WS_DEBUG) console.log('[DEBUG WS ACCOUNT PAYLOAD]', accData);
          const previousAccount = useAppStore.getState().account as Account | null | undefined;
          const next = normalizeAccountSummary(accData, previousAccount, {
            partial: !accData.publication_token,
            login: acceptedLogin,
            scope: getCommittedBrokerAccountSessionScopeKey(getCommittedBrokerAccountSessionScope()),
          });
          if (!isAuthenticatedRef.current || getLiveTradingLogin() !== acceptedLogin) return;
          useAppStore.getState().setAccount(next);
        } else if (data.channel?.startsWith('positions.')) {
          const acceptedLogin = getAcceptedChannelLogin(data.channel);
          if (!acceptedLogin) return;
          const decoded = decodePositionStreamMessage(data);
          if (!decoded) return;
          // A malformed identity must not turn a snapshot into an empty set.
          if (decoded.rows.some(row => row.account_login !== undefined
            && String(row.account_login) !== String(acceptedLogin))) return;
          const brokerId = getCommittedBrokerAccountSessionScope().brokerId;
          if (decoded.rows.some(row => brokerId && row.broker_id !== undefined
            && String(row.broker_id) !== brokerId)) return;
          if (!isAuthenticatedRef.current || getLiveTradingLogin() !== acceptedLogin) return;
          markTradeWsMessage();
          positionsStreamVersionRef.current += 1;
          if (WS_DEBUG) console.log('[DEBUG WS POSITIONS RAW]', data);
          try {
            const batch = readPositionStreamBatch(data);
            const eventName = getPositionEventName(data);
            const ticket = getPositionEventTicket(data);
            if (!isAuthenticatedRef.current || getLiveTradingLogin() !== acceptedLogin) return;
            if (POSITION_CLOSED_EVENTS.has(eventName) && ticket) {
              // Keep optimistic close suppression until REST confirms absence; WS snapshots can lag.
              markServerClosedTickets([ticket]);
              dispatchTradeOverlayCloseState([ticket], 'confirmed');
              useAppStore.getState().setPositions(useAppStore.getState().positions.filter(position => position.id !== ticket));
              refreshOrdersAndHistory(acceptedLogin).catch(err => console.error('[WS POSITIONS HISTORY REFRESH ERROR]', err));
            } else if (batch) {
              const result = reconcilePositionStreamBatch(useAppStore.getState().positions, batch);
              const normalized = reconcileOptimisticClosedPositions(result.positions as Position[]);
              if (!isAuthenticatedRef.current || getLiveTradingLogin() !== acceptedLogin) return;
              useAppStore.getState().setPositions(normalized as any);
              if (result.needsRevalidation) requestPositionSnapshotRevalidation();
            } else {
              const { position } = readPositionStreamEvent(data);
              if (!position) return;
              const result = reconcilePositionStreamBatch(useAppStore.getState().positions, {
                mode: 'delta', positions: [position],
              });
              useAppStore.getState().setPositions(reconcileOptimisticClosedPositions(result.positions as Position[]) as any);
              if (result.needsRevalidation || eventName === 'position_partial_close') requestPositionSnapshotRevalidation();
            }
            // A close can also arrive as a row inside a batch (status/state)
            // with no envelope-level close event. Confirm those for the trade
            // overlay and keep them suppressed until REST agrees, so a lagging
            // snapshot cannot resurrect a position the backend already closed.
            const openTickets = new Set(
              (useAppStore.getState().positions as Position[]).map((position) => position.id),
            );
            const confirmedClosedTickets = decoded.closedTickets.filter((closedTicket) => (
              !serverClosedTicketsRef.current.has(closedTicket) && !openTickets.has(closedTicket)
            ));
            if (confirmedClosedTickets.length) {
              markServerClosedTickets(confirmedClosedTickets);
              dispatchTradeOverlayCloseState(confirmedClosedTickets, 'confirmed');
              void refreshOrdersAndHistory(acceptedLogin).catch(err => console.error('[WS POSITIONS HISTORY REFRESH ERROR]', err));
            }
          } catch (err) {
            console.error('[WS POSITIONS ERROR]', err);
          }
        } else if (data.channel?.startsWith('orders.') || data.channel?.startsWith('deals.')) {
          const loginId = getAcceptedChannelLogin(data.channel);
          if (!loginId || isTradeSubscriptionControlFrame(data)) return;
          markTradeWsMessage();
          // Coalesce fill/order bursts. Immediate REST history on every WS
          // frame contended with market-order execution for the DB pool.
          if (historyRefreshTimerRef.current !== null) window.clearTimeout(historyRefreshTimerRef.current);
          historyRefreshTimerRef.current = window.setTimeout(() => {
            historyRefreshTimerRef.current = null;
            refreshOrdersAndHistory(loginId).catch(err => console.error('[WS HISTORY REFRESH ERROR]', err));
          }, 2000);
        } else if (data.type === 'tick' || isTickLikeUpdate || isLiveQuote || data.channel?.startsWith('ticks.') || data.channel === 'prices') {
          const alreadyEnqueuedBySocketService = isEnhancedStoreHandledTickFrame(data);
          // Wrap live quote data if it comes in raw formats
          const tickPayload: any = (isLiveQuote || data.channel?.startsWith('ticks.') || data.channel === 'prices') && data.data ? data.data : data;

          if (data.channel?.startsWith('ticks.') && tickPayload && !tickPayload.symbol) {
            // FIX: Preserve the complete broker symbol after `ticks.`; splitting
            // truncates valid identities such as 0001.HK and EURUSD.r.
            tickPayload.symbol = data.channel.slice('ticks.'.length);
          }

          // Always log received ticks for debugging
          if (data.type === 'tick' && data.symbol && WS_DEBUG) {
            console.log(`[WS TICK] ${data.symbol} bid=${data.bid} ask=${data.ask}`);
          }

          // EnhancedWebSocketService already normalized these two /ws/v2 tick
          // shapes before broadcasting them to this wildcard listener. Do not
          // enqueue the same quote twice; the duplicate normalization/store
          // work competes with rapid order-click handling on the main thread.
          // Other legacy quote/update shapes still use the App normalizer.
          const payloadItems = alreadyEnqueuedBySocketService
            ? []
            : parseTickPayloads(tickPayload);
          if (!alreadyEnqueuedBySocketService && payloadItems.length === 0) return;

          const currentStore = useAppStore.getState().ticks;

          payloadItems.forEach((tickData: any) => {
            if (!tickData) return;
            if (typeof tickData === 'string') {
              try {
                tickData = JSON.parse(tickData);
              } catch {
                return;
              }
            }
            if (typeof tickData !== 'object') return;

            const rawSymbol = typeof tickData.symbol === 'string' ? tickData.symbol.trim() : '';
            if (!rawSymbol) return;
            const exactSymbol = rawSymbol.toUpperCase();
            // FIX: Treat the broker symbol as an opaque identity. Fan-out to a
            // base/suffix variant can overwrite another executable contract and
            // corrupt its forming candle, price line, PnL, and order price.
            const scopedTickData = { ...tickData, symbol: exactSymbol };
            const normalizedTick = normalizeRealtimeTick(scopedTickData, currentStore[exactSymbol]);
            if (normalizedTick) {
              if (WS_DEBUG) console.log(`[WS] Updating exact store symbol ${normalizedTick.symbol}: bid=${normalizedTick.bid}`);
              enqueueLiveTick(normalizedTick.symbol, normalizedTick);
            } else if (WS_DEBUG) {
              console.log(`[DEBUG WS] normalizeRealtimeTick returned null for ${exactSymbol}`, scopedTickData);
            }
          });

          // Check price alerts only when active alerts exist.
          const alertState = useAlertStore.getState();
          const hasActiveAlerts = alertState.alerts.some(alert => alert.enabled && alert.status === 'active');
          if (!hasActiveAlerts) return;

          const currentPrices = useAppStore.getState().ticks;
          const priceMap: Record<string, { bid: number; ask: number; last?: number }> = {};
          Object.keys(currentPrices).forEach(sym => {
            const t = currentPrices[sym];
            if (!Number.isFinite(t?.bid) || !Number.isFinite(t?.ask)) return;
            priceMap[sym] = {
              bid: t.bid,
              ask: t.ask,
              last: t.last
            };
          });

          const triggeredAlerts = checkAlerts(priceMap);

          // Show notifications for triggered alerts
          triggeredAlerts.forEach(alert => {
            const message = alert.message || `${alert.symbol} ${alert.condition.replace('_', ' ')} ${alert.price.toFixed(5)}`;

            addNotification({
              type: 'trading',
              severity: 'warning',
              title: 'Price Alert Triggered',
              message: message,
            });

            // Play sound if enabled
            if (alert.notifyMethod === 'sound' || alert.notifyMethod === 'both') {
              const audio = new Audio('data:audio/wav;base64,UklGRnoGAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQoGAACBhYqFbF1fdJivrJBhNjVgodDbq2EcBj+a2/LDciUFLIHO8tiJNwgZaLvt559NEAxQp+PwtmMcBjiR1/LMeSwFJHfH8N2QQAoUXrTp66hVFApGn+DyvmwhBTGH0fPTgjMGHm7A7+OZUQ0PVKvn77BfGAg+ltvy0H0pBSl+zPLaizsIGGS56+OZUQ4OUKXi8LaHMwU2jdXzz38qBSl9y/Lai0YIDVmw6+6cUw8LTqPf87acPQU0itbyynspBCt7y+/aijsIGWO56+OaUA0OUKXi8LWHMwU2jdXzz38qBSl9y/Lai0YIDVmw6+6cUw8LTqPf87acPQU0itbyynspBCt7y+/aijsI');
              audio.volume = 0.3;
              audio.play().catch(() => { });
            }
          });
        } else if (data.type === 'update' && data?.candle && typeof data?.symbol === 'string') {
          const candle = data.candle;
          const rawTime = Number(candle?.time ?? candle?.Time ?? data?.time ?? data?.timestamp);
          const normalizedTime = Number.isFinite(rawTime) && rawTime > 0
            ? (rawTime > 1_000_000_000_000 ? Math.floor(rawTime / 1000) : rawTime)
            : Math.floor(Date.now() / 1000);

          useMarketDataStore.getState().updateCandle({
            symbol: data.symbol,
            timeframe: String(data?.timeframe || 'M1'),
            open: toNumber(candle?.open ?? candle?.Open, 0),
            high: toNumber(candle?.high ?? candle?.High, 0),
            low: toNumber(candle?.low ?? candle?.Low, 0),
            close: toNumber(candle?.close ?? candle?.Close, 0),
            volume: toNumber(candle?.volume ?? candle?.Volume, 0),
            time: normalizedTime,
            // FIX: This path receives backend OHLC, not a locally aggregated candle.
            source: 'server',
            sourceTimestamp: toNumber(
              candle?.sourceTimestamp
                ?? candle?.source_timestamp
                ?? candle?.updated_at
                ?? data?.sourceTimestamp
                ?? data?.source_timestamp
                ?? data?.event_timestamp
                ?? data?.server_timestamp,
              Number.NaN,
            ),
          });
        } else if (data.type === 'candle_update') {
          // FIX: Mark raw candle_update frames as authoritative server OHLC.
          useMarketDataStore.getState().updateCandle({
            ...data,
            source: 'server',
            sourceTimestamp: toNumber(
              data?.sourceTimestamp
                ?? data?.source_timestamp
                ?? data?.event_timestamp
                ?? data?.server_timestamp,
              Number.NaN,
            ),
          });
        }
      } catch (e) {
        console.error('[WS] Parse error:', e);
      }
    });

    return () => {
      unsubscribe();
    };
  }, [isAuthenticated, subscribe, getAcceptedChannelLogin, getLiveTradingLogin, markServerClosedTickets, markTradeWsMessage, reconcileOptimisticClosedPositions, refreshOrdersAndHistory, refreshPositions]);

  const ensureMarketOpenForOrder = useCallback((symbol: string): boolean => {
    const normalizedSymbol = normalizeSymbolName(symbol);
    const marketStatus = normalizeSymbolName(selectedMarketStatus.symbol) === normalizedSymbol
      ? selectedMarketStatus
      : getCachedSymbolMarketStatus(normalizedSymbol) ?? createUnavailableMarketStatus(normalizedSymbol);

    if (shouldBlockSymbolTrading(marketStatus, symbol)) {
      publishOrderFeedback(getMarketStatusTradeBlockMessage(marketStatus, symbol));
      return false;
    }
    return true;
  }, [selectedMarketStatus]);

  const placeOrder = useCallback(async (
    side: 'BUY' | 'SELL',
    requestedSymbol?: string,
    requestedVolume?: number,
    protection?: { priceSl?: number; priceTp?: number },
  ) => {
    const authSymbol = normalizeSymbolName(requestedSymbol || selectedSymbol);
    const authTick = useAppStore.getState().ticks[authSymbol];
    if (!requireTradingAuth({
      source: 'quick-trade', side, symbol: authSymbol, volume: requestedVolume ?? volume,
      bid: authTick?.bid, ask: authTick?.ask,
    })) return;
    const intentAtMs = captureTradeOrderIntent();
    try {
      const loginId = getLiveTradingLogin();
      if (!loginId) {
        window.dispatchEvent(new Event('rtx:requestTradeLogin'));
        publishOrderFeedback('No trading account is selected. Please sign in again.');
        return;
      }
      const requestedOrderSymbol = normalizeSymbolName(requestedSymbol || selectedSymbol);
      const submitSymbol = getAllowedSymbol(requestedOrderSymbol);
      if (!submitSymbol) {
        publishOrderFeedback(
          [feedbackSymbol(requestedOrderSymbol), feedbackValue(': '), feedbackLabel('Live tradable quote unavailable - order not sent')],
        );
        return;
      }
      // Market status is kept warm by useSymbolMarketStatus. Do not add a REST
      // preflight to the latency-critical click path; the backend revalidates.
      const marketOpen = ensureMarketOpenForOrder(submitSymbol);
      if (!marketOpen) return;

      const orderPromise = api.orders.placeMarketOrder({
        symbol: submitSymbol,
        side,
        // Depth-of-Market supplies a per-click volume. React state updates are
        // asynchronous, so use that explicit value instead of a stale closure.
        volume: requestedVolume ?? volume,
        login: loginId,
        ...(protection?.priceSl ? { price_sl: protection.priceSl } : {}),
        ...(protection?.priceTp ? { price_tp: protection.priceTp } : {}),
      }, { intentAtMs });
      // Quick actions are intentionally not serialized: each user action gets
      // its own idempotency key and WebSocket pending-map entry.
      const chartEntryPrice = getChartEntryPriceForSymbol(submitSymbol, side);
      const chartEntryTime = new Date().toISOString();
      const result = await orderPromise;
      console.log('[Trade] Order executed via trading API:', result);
      const [immediatePosition] = normalizePositions([{ ...result, chartEntryPrice, chartEntryTime }]);
      if (immediatePosition) {
        upsertImmediatePosition(immediatePosition);
      }
      refreshPositions(loginId);
      refreshOrdersAndHistory(loginId).catch(err => console.error('[Trade] Failed to refresh orders/history:', err));
    } catch (err: any) {
      publishOrderFeedback(formatOrderError(err));
    }
  }, [ensureMarketOpenForOrder, getAllowedSymbol, getLiveTradingLogin, selectedSymbol, volume, refreshPositions, refreshOrdersAndHistory]);

  const handleDepthOrder = useCallback(async (request: DepthOrderRequest) => {
    if (!requireTradingAuth({
      source: 'order-panel', side: request.side, symbol: domSymbol, volume: request.volume,
    })) return;
    setVolume(request.volume);
    console.log(
      `[DOM] ${request.execution === 'limit' ? 'Pending' : 'Market'} order: ${request.side} ${request.volume} @ ${request.price}`,
    );

    if (request.execution === 'market') {
      await placeOrder(request.side, domSymbol, request.volume, {
        priceSl: request.priceSl,
        priceTp: request.priceTp,
      });
      return;
    }

    try {
      const loginId = getLiveTradingLogin();
      if (!loginId) {
        window.dispatchEvent(new Event('rtx:requestTradeLogin'));
        publishOrderFeedback('No trading account is selected. Please sign in again.');
        return;
      }

      const submitSymbol = getAllowedSymbol(normalizeSymbolName(domSymbol));
      if (!submitSymbol) {
        publishOrderFeedback([feedbackSymbol(domSymbol), feedbackValue(': '), feedbackLabel('Live tradable quote unavailable - order not sent')]);
        return;
      }
      if (!Number.isFinite(request.price) || request.price <= 0) {
        publishOrderFeedback([feedbackLabel('Invalid price'), feedbackValue(`: ${request.price} · `), feedbackLabel('Order failed')]);
        return;
      }
      if (!Number.isFinite(request.volume) || request.volume <= 0) {
        publishOrderFeedback([feedbackLabel('Invalid volume'), feedbackValue(`: ${request.volume} · `), feedbackLabel('Order failed')]);
        return;
      }
      if (!ensureMarketOpenForOrder(submitSymbol)) return;

      const side = request.side.toLowerCase() as 'buy' | 'sell';
      await api.orders.placePendingOrder({
        login: loginId,
        symbol: submitSymbol,
        side,
        volume: request.volume,
        type: `${side}_limit`,
        price: request.price,
        ...(request.priceSl ? { price_sl: request.priceSl } : {}),
        ...(request.priceTp ? { price_tp: request.priceTp } : {}),
      });

      publishOrderFeedback(
        [feedbackLabel(request.side === 'BUY' ? 'Buy Limit' : 'Sell Limit'), feedbackValue(` · ${submitSymbol} · `), feedbackLabel('Volume'), feedbackValue(`: ${request.volume} · `), feedbackLabel('Price'), feedbackValue(`: ${request.price} · `), feedbackLabel('request submitted successfully!')],
        'success',
      );
      refreshOrdersAndHistory(loginId).catch((error) => {
        console.error('[DOM] Failed to refresh pending orders/history:', error);
      });
    } catch (error) {
      publishOrderFeedback(formatOrderError(error));
    }
  }, [domSymbol, ensureMarketOpenForOrder, getAllowedSymbol, getLiveTradingLogin, placeOrder, refreshOrdersAndHistory]);

  const handleOrderPanelSubmit = useCallback(async (order: {
    type: 'buy' | 'sell';
    volume: number;
    symbol: string;
  }) => {
    const authSymbol = normalizeSymbolName(order.symbol || orderPanelSymbol);
    const authTick = useAppStore.getState().ticks[authSymbol];
    if (!requireTradingAuth({
      source: 'order-panel', side: order.type.toUpperCase() as 'BUY' | 'SELL', symbol: authSymbol,
      volume: order.volume, bid: authTick?.bid, ask: authTick?.ask,
    })) return;
    const intentAtMs = captureTradeOrderIntent();
    try {
      const side = order.type.toUpperCase() as 'BUY' | 'SELL';
      const requestedOrderPanelSymbol = normalizeSymbolName(order.symbol || orderPanelSymbol);
      const submitSymbol = getAllowedSymbol(requestedOrderPanelSymbol);
      if (!submitSymbol) {
        publishOrderFeedback(
          [feedbackSymbol(requestedOrderPanelSymbol), feedbackValue(': '), feedbackLabel('Live tradable quote unavailable - order not sent')],
        );
        return;
      }
      const loginId = getLiveTradingLogin();
      if (!loginId) {
        window.dispatchEvent(new Event('rtx:requestTradeLogin'));
        publishOrderFeedback('No trading account is selected. Please sign in again.');
        return;
      }
      const marketOpen = ensureMarketOpenForOrder(submitSymbol);
      if (!marketOpen) return;

      const orderPromise = api.orders.placeMarketOrder({
        symbol: submitSymbol,
        side,
        volume: order.volume,
        login: loginId,
      }, { intentAtMs });
      const chartEntryPrice = getChartEntryPriceForSymbol(submitSymbol, side);
      const chartEntryTime = new Date().toISOString();
      const result = await orderPromise;

      console.log('[Trade] Order executed from dialog via trading API:', result);
      const [immediatePosition] = normalizePositions([{ ...result, chartEntryPrice, chartEntryTime }]);
      if (immediatePosition) {
        upsertImmediatePosition(immediatePosition);
      }
      refreshPositions(loginId);
      refreshOrdersAndHistory(loginId).catch(err => console.error('[Trade] Failed to refresh orders/history:', err));
    } catch (err: any) {
      publishOrderFeedback(formatOrderError(err));
    }
  }, [ensureMarketOpenForOrder, getAllowedSymbol, getLiveTradingLogin, orderPanelSymbol, selectedSymbol, refreshPositions, refreshOrdersAndHistory]);

  const closePosition = useCallback(async (tradeId: number, volume?: number) => {
    if (volume !== undefined) {
      console.error('Partial close is unsupported by the trading API');
      return;
    }
    // Trigger close sound
    import('./utils/audio').then(m => m.playSystemSound('close'));
    const closeSnapshots = buildTradeOverlayCloseSnapshots(
      useAppStore.getState().positions.filter((position) => position.id === tradeId) as Position[],
    );
    markLocalTradeMutation([tradeId]);
    dispatchTradeOverlayCloseState([tradeId], 'pending', { snapshots: closeSnapshots });
    useAppStore.getState().setPositions(useAppStore.getState().positions.filter(position => position.id !== tradeId));
    try {
      await api.positions.closePosition(String(tradeId));
      markLocalTradeMutation();
      dispatchTradeOverlayCloseState([tradeId], 'confirmed', { snapshots: closeSnapshots });
      const loginId = getLiveTradingLogin() || undefined;
      refreshPositions(loginId, { allowWsCommit: true }); // fire-and-forget
      if (loginId) {
        refreshOrdersAndHistory(loginId).catch(err => console.error('[Trade] Failed to refresh orders/history after close:', err));
      }
    } catch (err) {
      clearOptimisticClosedTickets([tradeId]);
      dispatchTradeOverlayCloseState([tradeId], 'failed');
      console.error('Close failed:', err);
      refreshPositions(getLiveTradingLogin() || undefined, { allowWsCommit: true });
    }
  }, [clearOptimisticClosedTickets, getLiveTradingLogin, markLocalTradeMutation, refreshOrdersAndHistory, refreshPositions]);

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

    const liveSymbols = activeMarketSymbolsCurrent ? activeMarketSymbols : [];
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
    activeMarketSymbols,
    activeMarketSymbolsCurrent,
    chartSelectionReconciliationKey,
    chartEligibleSymbolNames,
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
  const chartRuntimeReady = guestMode ? hasLoadedChartSymbols : shouldMountChartRuntime({
    authenticated: isAuthenticated,
    accountId,
    restoredLayoutAccountId,
    catalogSettled: hasLoadedChartSymbols,
    feedPreferenceSettled: activeMarketSymbolsSettled && hasAppliedLiveChartPreference,
  });


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
  const [chartSymbolPicker, setChartSymbolPicker] = useState<{ panelId: string; sessionScope: string; anchor?: ChartSymbolAnchor } | null>(null);
  useEffect(() => {
    if (chartSymbolPicker && !hasArrangedChartWindows(dockLayout)) setChartSymbolPicker(null);
  }, [chartSymbolPicker, dockLayout]);
  const chartPickerInstruments = useMemo(() => chartEligibleSymbolNames.map(symbol => (
    allSymbols.find(instrument => normalizeSymbolName(typeof instrument === 'object' && instrument ? (instrument as any).symbol ?? (instrument as any).name : instrument) === symbol)
      ?? { symbol }
  )), [allSymbols, chartEligibleSymbolNames]);
  useEffect(() => { setChartSymbolPicker(null); }, [isAuthenticated, accountId]);
  const [showToast, setShowToast] = useState(false);
  const [toastMessage, setToastMessage] = useState<UiMessage>('');
  const [toastType, setToastType] = useState<'success' | 'error'>('success');
  const toastHideTimerRef = useRef<number | null>(null);

  // Toast notification handler
  const displayToast = useCallback((message: UiMessage, type: 'success' | 'error' = 'success') => {
    setToastMessage(message);
    setToastType(type);
    setShowToast(true);
    if (toastHideTimerRef.current !== null) {
      window.clearTimeout(toastHideTimerRef.current);
    }
    toastHideTimerRef.current = window.setTimeout(() => {
      toastHideTimerRef.current = null;
      setShowToast(false);
    }, 3000);
  }, []);

  useEffect(() => {
    const handleOrderFeedback = (event: Event) => {
      const detail = (event as CustomEvent<OrderFeedbackDetail>).detail;
      if (!detail?.message) return;
      displayToast(detail.messageParts ?? detail.message, detail.type || 'error');
    };

    window.addEventListener(ORDER_FEEDBACK_EVENT, handleOrderFeedback);
    return () => {
      window.removeEventListener(ORDER_FEEDBACK_EVENT, handleOrderFeedback);
      if (toastHideTimerRef.current !== null) {
        window.clearTimeout(toastHideTimerRef.current);
        toastHideTimerRef.current = null;
      }
    };
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
    const targetSymbol = explicitSymbol || activeChartSymbol || normalizeSymbolName(selectedSymbol);
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
      setDomSymbol(symbol);
      setDomPos({ x: 620, y: 56 }); // Enforce fixed MT5 position
      setShowDOM(true);
    }
  }, [getAllowedSymbol, getChartEligibleSymbol, selectedSymbol, showDOM, domSymbol]);

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

  // Consolidated Global Event Listeners - Handles MT5 shortcuts, context menu actions, and workspace management
  useEffect(() => {
    // 1. Workspace & File Handlers
    const handleSaveWorkspaceEvent = () => handleSaveWorkspace();
    const handleOpenDataFolderEvent = () => handleOpenDataFolder();
    const handlePrintChartEvent = (event: Event) => {
      const request = (event as CustomEvent<PrintChartRequest>).detail;
      void handlePrintChart(request || {});
    };
    const handleTileWindows = () => {
      console.log('[App] Tiling chart windows');
      useDockLayoutStore.getState().tileWindows();
    };

    // 2. Chart & Navigation Handlers
    const addChart = (requestedSymbol?: string) => {
      const active = getActiveChartCommandTarget(selectedSymbol, timeframe);
      const symbol = getChartEligibleSymbol(requestedSymbol || active.symbol)
        || getChartEligibleSymbol(selectedSymbol) || chartEligibleSymbolNames[0];
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

    const handleAddChartPanel = () => addChart();

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

    const handleOpenChart = (e: CustomEvent) => {
      const symbol = getChartEligibleSymbol(e.detail?.symbol);
      if (!symbol) return;
      const store = useDockLayoutStore.getState();
      const requestedPanelId = typeof e.detail?.panelId === 'string' ? e.detail.panelId : undefined;
      if (requestedPanelId) {
        if (changeChartPanelSymbol(requestedPanelId, symbol, chartEligibleSymbolNames, timeframe)) setSelectedSymbol(symbol);
        return;
      }
      if (e.detail?.newWindow === true) {
        // Market Watch "Chart Window" opens an independent chart, MT5-style,
        // instead of silently retargeting the already-active pane.
        addChart(symbol);
        return;
      }
      if (e.detail?.newTab === true) {
        // Navigation can reuse a root, tabbed, or floating chart; the + action
        // always creates a new independent chart through the bounded store API.
        const existing = getChartPanels(store.layout).find(panel => normalizeSymbolName(panel.props?.symbol) === symbol);
        if (existing) { activateChartPanel(existing.id); setSelectedSymbol(symbol); return; }
      } else {
        const activePanel = getActiveDockChartPanel();
        if (activePanel && changeChartPanelSymbol(activePanel.id, symbol, chartEligibleSymbolNames, timeframe)) {
          setSelectedSymbol(symbol);
          return;
        }
      }
      addChart(symbol);
    };

    const handleOpenOrderDialog = (event: CustomEvent<{ symbol?: unknown }>) => {
      openOrderPanelForSymbol(event.detail?.symbol);
    };

    const handleOpenNewOrder = (event: Event) => {
      const detail = (event as CustomEvent<{ symbol?: unknown }>).detail;
      openOrderPanelForSymbol(detail?.symbol);
    };

    // 3. UI & Utility Handlers
    const handleToggleAccountPanel = () => setShowAccountPanel(prev => !prev);
    const handleLayoutUndo = () => useDockLayoutStore.getState().undo();
    const handleLayoutRedo = () => useDockLayoutStore.getState().redo();

    const handleChartSymbolChanged = (e: CustomEvent) => {
      const { symbol: sym, timeframe: tf } = e.detail || {};
      const chartSymbol = getChartEligibleSymbol(sym);
      if (sym && chartSymbol) setSelectedSymbol(chartSymbol);
      if (tf) setTimeframe(tf);
    };

    const handleWorkspaceProfileRestored = (e: CustomEvent) => {
      const restoredDockHeight = Number(e.detail?.state?.chartView?.dockHeight);
      if (Number.isFinite(restoredDockHeight) && restoredDockHeight >= 80) {
        setDockHeight(restoredDockHeight);
      }
    };

    const handleTogglePanel = (e: CustomEvent) => {
      const panelType = e.detail;
      const store = useDockLayoutStore.getState();
      const layout = store.layout;

      const findPanel = (container: any): any => {
        if (!container) return null;
        for (const child of container.children || []) {
          if (child.component === panelType) return child;
          if (child.children) {
            const found = findPanel(child);
            if (found) return found;
          }
        }
        return null;
      };

      let exists = findPanel(layout.root);
      if (!exists) {
        for (const floating of layout.floatingPanels) {
          exists = findPanel(floating);
          if (exists) break;
        }
      }

      if (exists) {
        store.removePanel(exists.id);
      } else {
        const idMap: Record<string, any> = {
          'MarketWatch': { id: 'market-watch', title: 'Market Watch', component: 'MarketWatch' },
          'Navigator': { id: 'navigator', title: 'Navigator', component: 'Navigator' },
          'Terminal': { id: 'toolbox', title: 'Toolbox', component: 'Terminal' }
        };
        const config = idMap[panelType];
        if (config) {
          if (panelType === 'Terminal') {
            // Add Toolbox to the bottom of center-main and fix its ratio to 25%
            store.addPanel(
              { ...config, ratio: 0.25, closable: true, floatable: true },
              'center-main',
              'bottom' as any
            );
            // After insertion, clamp the toolbox to 25% of center-main
            setTimeout(() => {
              const l = useDockLayoutStore.getState().layout;
              const findCM = (c: any): any => {
                if (!c) return null;
                if (c.id === 'center-main') return c;
                for (const ch of c.children || []) { const f = findCM(ch); if (f) return f; }
                return null;
              };
              const cm = findCM(l.root);
              if (cm) {
                const kids: any[] = cm.children || [];
                const toolbox = kids.find((k: any) => k.component === 'Terminal');
                if (toolbox) {
                  useDockLayoutStore.getState().updateContainerSize(toolbox.id, 0.25);
                }
              }
            }, 50);
          } else {
            const direction = 'left';
            store.addPanel({
              ...config,
              closable: true,
              floatable: true,
            }, 'root', direction);
          }
        }
      }
    };

    const handleChangeTimeframe = (e: CustomEvent) => {
      const { timeframe: newTimeframe } = e.detail;
      setTimeframe(newTimeframe as Timeframe);
    };

    const handleQuickTrade = (e: CustomEvent) => {
      const { side, symbol: tradeSymbol } = e.detail;
      const allowedSymbol = getAllowedSymbol(tradeSymbol);
      if (tradeSymbol && !allowedSymbol) return;
      if (allowedSymbol) setSelectedSymbol(allowedSymbol);
      placeOrder(side, allowedSymbol || undefined);
    };

    const handleOpenChartProperties = (e: CustomEvent<ChartPropertiesEventDetail>) => {
      setShowChartProperties(prev => {
        if (prev) return false;
        const activeTarget = getActiveChartCommandTarget();
        const target = resolveChartPropertiesTarget(e.detail, {
          symbol: selectedSymbol,
          timeframe,
        });
        setChartPropsSymbol(target.symbol);
        setChartPropsTimeframe(target.timeframe);
        setChartPropsContextId(
          typeof e.detail?.targetContextId === 'string'
            ? e.detail.targetContextId
            : activeTarget.targetContextId,
        );
        return true;
      });
    };

    const handleOpenChartObjects = (event: Event) => {
      const detail = (event as CustomEvent<{
        targetContextId?: unknown;
        symbol?: unknown;
        timeframe?: unknown;
      }>).detail;
      const activeTarget = getActiveChartCommandTarget(selectedSymbol, timeframe);
      const targetContextId = typeof detail?.targetContextId === 'string'
        ? detail.targetContextId
        : activeTarget.targetContextId;
      const symbol = typeof detail?.symbol === 'string' && detail.symbol.trim()
        ? detail.symbol.trim()
        : (activeTarget.symbol || selectedSymbol);
      const targetTimeframe = typeof detail?.timeframe === 'string' && detail.timeframe.trim()
        ? detail.timeframe.trim()
        : activeTarget.timeframe;

      setChartObjectsTarget(current => current
        ? null
        : {
            targetContextId: targetContextId || null,
            symbol,
            timeframe: targetTimeframe,
          });
    };

    // 4. Attach Listeners
    const handleOpenDataWindow = () => setShowDataWindow(prev => !prev);
    window.addEventListener('saveWorkspace', handleSaveWorkspaceEvent);
    window.addEventListener('openDataFolder', handleOpenDataFolderEvent);
    window.addEventListener('printChart', handlePrintChartEvent);
    window.addEventListener('tileWindows', handleTileWindows);
    window.addEventListener('openChart', handleOpenChart as EventListener);
    window.addEventListener('add-chart-panel', handleAddChartPanel);
    window.addEventListener('request-chart-symbol-change', handleRequestChartSymbolChange as EventListener);
    window.addEventListener('openOrderDialog', handleOpenOrderDialog as EventListener);
    window.addEventListener('openNewOrder', handleOpenNewOrder as EventListener);
    window.addEventListener('openDepthOfMarket', handleOpenDOM as EventListener);
    window.addEventListener('openDataWindow', handleOpenDataWindow);
    window.addEventListener('openChartProperties', handleOpenChartProperties as EventListener);
    window.addEventListener('open-object-list', handleOpenChartObjects);
    window.addEventListener('toggleAccountPanel', handleToggleAccountPanel);
    window.addEventListener('layout-undo', handleLayoutUndo);
    window.addEventListener('layout-redo', handleLayoutRedo);
    window.addEventListener('chartSymbolChanged', handleChartSymbolChanged as EventListener);
    window.addEventListener('workspace:profile-restored', handleWorkspaceProfileRestored as EventListener);
    window.addEventListener('togglePanel', handleTogglePanel as EventListener);
    window.addEventListener('change-timeframe', handleChangeTimeframe as EventListener);
    const handleChangeChartType = (e: CustomEvent) => {
      const ct = e.detail?.chartType;
      if (ct && ['candlestick', 'bar', 'line', 'area'].includes(ct)) {
        setChartType(ct as ChartType);
        localStorage.setItem('rtx5_chart_type', ct);
      }
    };
    window.addEventListener('change-chart-type', handleChangeChartType as EventListener);
    window.addEventListener('quickTrade', handleQuickTrade as EventListener);

    return () => {
      window.removeEventListener('saveWorkspace', handleSaveWorkspaceEvent);
      window.removeEventListener('openDataFolder', handleOpenDataFolderEvent);
      window.removeEventListener('printChart', handlePrintChartEvent);
      window.removeEventListener('tileWindows', handleTileWindows);
      window.removeEventListener('openChart', handleOpenChart as EventListener);
      window.removeEventListener('add-chart-panel', handleAddChartPanel);
      window.removeEventListener('request-chart-symbol-change', handleRequestChartSymbolChange as EventListener);
      window.removeEventListener('openOrderDialog', handleOpenOrderDialog as EventListener);
      window.removeEventListener('openNewOrder', handleOpenNewOrder as EventListener);
      window.removeEventListener('openDepthOfMarket', handleOpenDOM as EventListener);
      window.removeEventListener('openDataWindow', handleOpenDataWindow);
      window.removeEventListener('openChartProperties', handleOpenChartProperties as EventListener);
      window.removeEventListener('open-object-list', handleOpenChartObjects);
      window.removeEventListener('toggleAccountPanel', handleToggleAccountPanel);
      window.removeEventListener('layout-undo', handleLayoutUndo);
      window.removeEventListener('layout-redo', handleLayoutRedo);
      window.removeEventListener('chartSymbolChanged', handleChartSymbolChanged as EventListener);
      window.removeEventListener('workspace:profile-restored', handleWorkspaceProfileRestored as EventListener);
      window.removeEventListener('togglePanel', handleTogglePanel as EventListener);
      window.removeEventListener('change-timeframe', handleChangeTimeframe as EventListener);
      window.removeEventListener('change-chart-type', handleChangeChartType as EventListener);
      window.removeEventListener('quickTrade', handleQuickTrade as EventListener);
    };
  }, [
    selectedSymbol, timeframe, chartType, chartEligibleSymbolNames, displayToast, placeOrder, handleOpenDOM,
    handleSaveWorkspace, handleOpenDataFolder, handlePrintChart, getAllowedSymbol, getChartEligibleSymbol,
    openOrderPanelForSymbol
  ]);


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
      waitForChart={chartEligibleSymbolNames.length > 0}
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
        <div
          className="rtx-app-shell flex flex-col h-screen w-full bg-[#131316] text-zinc-300 overflow-hidden font-sans"
          data-rtx-authenticated-shell={isAuthenticated ? 'true' : undefined}
          data-rtx-guest-shell={guestMode ? 'true' : undefined}
          {...chartSelectionDiagnosticAttributes}
        >
          {/* 1. Global Menu & Toolbar */}
          <TopToolbar
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
                      onSymbolSelect={handleSymbolSelect}
                      onClosePosition={handleClosePosition}
                      onModifyPosition={handleModifyPosition}
                      onCancelOrder={(id) => handleCancelOrder(String(id))}
                      onCloseBulk={handleCloseBulk}
                    />
                  </ErrorBoundary>
                </div>
              </div>

              {/* DOM Panel — draggable + resizable floating card */}
              {showDOM && (
                <div
                  className="rtx-dom-dialog absolute z-30 flex flex-col overflow-hidden"
                  style={{
                    left: domPos.x,
                    top: domPos.y,
                    width: domSize.w,
                    height: domSize.h,
                    minWidth: 360,
                    minHeight: 200,
                    borderRadius: 10,
                    boxShadow: '0 8px 32px rgba(0,0,0,0.7), 0 0 0 1px rgba(255,255,255,0.06)',
                    background: '#131316',
                  }}
                >
                  <Suspense fallback={<div className="h-full w-full bg-[#131316]" />}>
                    <LazyDepthOfMarket
                      symbol={domSymbol}
                      onClose={() => setShowDOM(false)}
                      onCloseBulk={handleCloseBulk}
                      onDragHandleMouseDown={handleDomMouseDown}
                      onPlaceOrder={handleDepthOrder}
                    />
                  </Suspense>
                  {/* Right edge resize handle */}
                  <div
                    onMouseDown={(e) => handleDomResizeMouseDown(e, 'e')}
                    style={{
                      position: 'absolute', right: 0, top: 8, bottom: 8,
                      width: 5, cursor: 'ew-resize',
                      background: 'transparent',
                      zIndex: 10,
                    }}
                    className="hover:bg-blue-500/30 rounded transition-colors"
                  />
                  {/* Bottom edge resize handle */}
                  <div
                    onMouseDown={(e) => handleDomResizeMouseDown(e, 's')}
                    style={{
                      position: 'absolute', bottom: 0, left: 8, right: 8,
                      height: 5, cursor: 'ns-resize',
                      background: 'transparent',
                      zIndex: 10,
                    }}
                    className="hover:bg-blue-500/30 rounded transition-colors"
                  />
                  {/* Bottom-right corner resize handle */}
                  <div
                    onMouseDown={(e) => handleDomResizeMouseDown(e, 'se')}
                    style={{
                      position: 'absolute', bottom: 0, right: 0,
                      width: 14, height: 14, cursor: 'nwse-resize',
                      zIndex: 11,
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      borderRadius: '0 0 10px 0',
                    }}
                  >
                    <svg width="8" height="8" viewBox="0 0 8 8" fill="none">
                      <path d="M7 1L1 7M7 4L4 7M7 7L7 7" stroke="#404048" strokeWidth="1.5" strokeLinecap="round"/>
                    </svg>
                  </div>
                </div>
              )}

              {/* Data Window Panel — draggable + resizable floating panel */}
              {showDataWindow && (
                <div
                  className="absolute z-30"
                  style={{
                    left: dataWindowPos.x,
                    top: dataWindowPos.y,
                    width: dataWindowSize.w,
                    height: dataWindowSize.h,
                    minWidth: 200,
                    minHeight: 200,
                    overflow: 'hidden',
                  }}
                >
                  <Suspense fallback={<div className="h-full w-full bg-[#131316]" />}>
                    <LazyDataWindow
                      onClose={() => setShowDataWindow(false)}
                      onDragHandleMouseDown={handleDataWindowMouseDown}
                    />
                  </Suspense>
                  {/* N — top edge */}
                  <div onMouseDown={(e) => handleDataWindowResizeMouseDown(e, 'n')}
                    style={{ position:'absolute', top:0, left:6, right:6, height:5, cursor:'ns-resize', zIndex:20 }} />
                  {/* S — bottom edge */}
                  <div onMouseDown={(e) => handleDataWindowResizeMouseDown(e, 's')}
                    style={{ position:'absolute', bottom:0, left:6, right:6, height:5, cursor:'ns-resize', zIndex:20 }} />
                  {/* W — left edge */}
                  <div onMouseDown={(e) => handleDataWindowResizeMouseDown(e, 'w')}
                    style={{ position:'absolute', top:6, left:0, bottom:6, width:5, cursor:'ew-resize', zIndex:20 }} />
                  {/* E — right edge */}
                  <div onMouseDown={(e) => handleDataWindowResizeMouseDown(e, 'e')}
                    style={{ position:'absolute', top:6, right:0, bottom:6, width:5, cursor:'ew-resize', zIndex:20 }} />
                  {/* NW corner */}
                  <div onMouseDown={(e) => handleDataWindowResizeMouseDown(e, 'nw')}
                    style={{ position:'absolute', top:0, left:0, width:10, height:10, cursor:'nwse-resize', zIndex:21 }} />
                  {/* NE corner */}
                  <div onMouseDown={(e) => handleDataWindowResizeMouseDown(e, 'ne')}
                    style={{ position:'absolute', top:0, right:0, width:10, height:10, cursor:'nesw-resize', zIndex:21 }} />
                  {/* SW corner */}
                  <div onMouseDown={(e) => handleDataWindowResizeMouseDown(e, 'sw')}
                    style={{ position:'absolute', bottom:0, left:0, width:10, height:10, cursor:'nesw-resize', zIndex:21 }} />
                  {/* SE corner — with visual grip dots */}
                  <div onMouseDown={(e) => handleDataWindowResizeMouseDown(e, 'se')}
                    style={{ position:'absolute', bottom:0, right:0, width:14, height:14, cursor:'nwse-resize', zIndex:21, display:'flex', alignItems:'center', justifyContent:'center' }}>
                    <svg width="8" height="8" viewBox="0 0 8 8" fill="none">
                      <path d="M7 1L1 7M7 4L4 7M7 7L7 7" stroke="#505060" strokeWidth="1.5" strokeLinecap="round"/>
                    </svg>
                  </div>
                </div>
              )}

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
          {!window.electron?.window && <StatusBar
            wsRef={wsRef}
            reconnectCallback={reconnectCallbackRef.current || undefined}
            symbol={desktopToolbarSymbol}
            timeframe={timeframe}
            marketStatus={desktopToolbarMarketStatus}
          />} 

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
              />
            </ErrorBoundary>
          )}

          <TradeAuthDialog
            isOpen={tradeAuthOpen}
            intent={pendingTradeIntent}
            onClose={handleTradeAuthClose}
            onAuthenticated={handleTradeAuthenticated}
          />

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

          {/* Non-blocking workspace and order feedback */}
          {showToast && (
            <div
              role="status"
              aria-live="polite"
              className="fixed top-4 right-4 z-[300] animate-in slide-in-from-top-5 fade-in duration-200"
            >
              <div className={`px-4 py-3 rounded-lg shadow-xl border ${toastType === 'success'
                ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-200'
                : 'bg-rose-500/10 border-rose-500/30 text-rose-200'
                }`}>
                <div className="flex items-center gap-2">
                  {toastType === 'success' ? (
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                    </svg>
                  ) : (
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  )}
                  <span className="text-sm font-medium">{formatUiMessage(toastMessage, tr)}</span>
                </div>
              </div>
            </div>
          )}

          {/* Last Symbol Trading Panel */}
          {lastSymbolPanelVisible && (
            <Suspense fallback={null}>
              <LazyLastSymbolPanel />
            </Suspense>
          )}

          {/* Notification Toast Container */}
          <ToastContainer notifications={activeToasts} />

          {/* Global Confirm Dialog */}
          <ConfirmDialog />

          {/* Enterprise Bulk Close Confirm Dialog */}
          <BulkCloseConfirmDialog />

          {/* Indicator Navigator (Insert > Indicators, toolbar button) */}
          {showIndicatorNavigator && (
            <Suspense fallback={null}>
              <LazyIndicatorNavigator
                isOpen
                onClose={() => setShowIndicatorNavigator(false)}
                initialCategory={indicatorNavCategory}
                onAddIndicator={(indicator: IndicatorInfo) => {
                  const activeTarget = getActiveChartCommandTarget(selectedSymbol, timeframe);
                  const targetContextId = indicatorTarget.targetContextId ?? activeTarget.targetContextId;
                  const targetSymbol = indicatorTarget.symbol ?? activeTarget.symbol ?? selectedSymbol;
                  if (indicator.category === 'Volume' && indicator.name === 'Volume') {
                    setChartVolumeBarsVisible(true, targetSymbol || undefined);
                    setShowIndicatorNavigator(false);
                    return;
                  }

                  commandBus.dispatch({
                    type: 'ADD_INDICATOR',
                    payload: {
                      id: indicator.id,
                      name: indicator.name,
                      indicatorType: indicator.id.replace(/-\d+$/, ''),
                      params: indicator.parameters ?? {},
                      targetContextId,
                      symbol: targetSymbol,
                    }
                  });
                  setShowIndicatorNavigator(false);
                }}
              />
            </Suspense>
          )}

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
        </div>
      </KeyboardShortcutProvider>

    </CommandBusProvider>
    </TerminalStartupBoundary>
  );
}

export default App;
