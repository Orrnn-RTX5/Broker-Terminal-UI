import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { WelcomeTerminal } from './components/WelcomeTerminal';

import { TradingChart } from './components/TradingChart';
import { DockWorkspace } from './components/dock/DockWorkspace';
import { useDockLayoutStore } from './store/useDockLayoutStore';
import type { ChartType, Timeframe } from './components/TradingChart';
import { ErrorBoundary } from './components/ErrorBoundary';
import { BottomDock } from './components/BottomDock';
import { AlertsContainer } from './components/AlertsContainer';
import { resolveTickFromLookup, useAppStore } from './store/useAppStore';
import { useMarketDataStore } from './store/useMarketDataStore';
import { useWatchlistStore } from './store/useWatchlistStore';
import { terminateWorker } from './services/aggregationWorkerManager';
import { enqueueLiveTick } from './services/liveTickDispatcher';
import { API_BASE_URL, WS_ENDPOINTS, updateDynamicUrls } from './config/api';
import { useWebSocket } from './hooks/useWebSocket';

import { LastSymbolPanel } from './components/LastSymbolPanel';
import { useLastSymbolStore } from './store/useLastSymbolStore';
import { useAutoCloseMonitor } from './hooks/useAutoCloseMonitor';
import { api } from './services/api';
import { accountV2Api, tradingV2Api } from './api/trade';
import { tradeGatewayApi } from './api/tradeGateway';
import { brokerApi } from './api/brokerApi';
import { OneClickTrading } from './components/OneClickTrading';
import { getStoredBrokerServer } from './services/brokerServers';
import { BootstrapLoader } from './components/BootstrapLoader';
import { IndicatorNavigator } from './components/IndicatorNavigator';
import type { IndicatorInfo } from './components/IndicatorNavigator';

// Layout Components
import { TopToolbar } from './components/layout/TopToolbar';
import { NavigatorPanel } from './components/layout/NavigatorPanel';
import { MarketWatchPanel } from './components/layout/MarketWatchPanel';
import { StatusBar } from './components/layout/StatusBar';
import { UpdateBanner } from './components/layout/UpdateBanner';
import { OrderPanelDialog } from './components/OrderPanelDialog';
import { DepthOfMarket } from './components/DepthOfMarket';
import { DataWindow } from './components/DataWindow';
import { SaveWorkspaceDialog } from './components/dialogs/SaveWorkspaceDialog';
import { AccountPanel } from './components/AccountPanel';
import { ConfirmDialog } from './components/ui/ConfirmDialog';
import { ChartPropertiesDialog } from './components/dialogs/ChartPropertiesDialog';
import { useConfirmStore } from './store/useConfirmStore';

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

const normalizeSymbolName = (value: unknown): string => String(value ?? '').trim().toUpperCase();

const getInstrumentSymbolName = (instrument: unknown): string => {
  if (instrument && typeof instrument === 'object') {
    const record = instrument as Record<string, unknown>;
    return normalizeSymbolName(record.symbol ?? record.name ?? record.id);
  }
  return normalizeSymbolName(instrument);
};

const getAllowedSymbolNames = (symbols: unknown[]): string[] => {
  return Array.from(new Set((Array.isArray(symbols) ? symbols : []).map(getInstrumentSymbolName).filter(Boolean)));
};

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

interface Position {
  id: number;
  symbol: string;
  side: string;
  volume: number;
  openPrice: number;
  currentPrice: number;
  openTime: string;
  sl: number;
  tp: number;
  swap: number;
  commission: number;
  unrealizedPnL: number;
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

interface Account {
  balance: number;
  equity: number;
  margin: number;
  freeMargin: number;
  unrealizedPL: number;
  marginLevel: number;
  currency: string;
  leverage: number;
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
  const results = await Promise.allSettled([
    tradeGatewayApi.getClosedPositions(login),
    tradeGatewayApi.getDeals(login),
    tradeGatewayApi.getOrders(login),
  ]);

  const rejected = results.filter((result): result is PromiseRejectedResult => result.status === 'rejected');
  const fulfilled = results.filter((result): result is PromiseFulfilledResult<any[]> => result.status === 'fulfilled');

  if (fulfilled.length === 0 && rejected.length > 0) {
    throw new Error(rejected.map((result) => getErrorMessage(result.reason, 'history endpoint failed')).join('; '));
  }

  return {
    trades: mergeOrderHistory(fulfilled.map((result) => result.value)),
    warning: rejected.length > 0
      ? rejected.map((result) => getErrorMessage(result.reason, 'history endpoint failed')).join('; ')
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

const normalizeRealtimeTick = (raw: any, previous?: Tick, jitterOverride?: number): Tick | null => {
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

  // Mock jitter for Crypto pairs that receive flat repeated ticks on weekends from YOFX
  // Note: jitter is applied symmetrically around the MID to prevent drift from chart price
  if (previous && bid === previous.bid && ask === previous.ask && (symbol.includes('BTC') || symbol.includes('ETH'))) {
    const mid = (bid + ask) / 2;
    const jitterRange = symbol.includes('BTC') ? 5 : 0.5;
    const jitter = typeof jitterOverride === 'number' ? jitterOverride : ((Math.random() - 0.5) * jitterRange);
    const halfSpread = (ask - bid) / 2;
    bid = mid + jitter - halfSpread;
    ask = mid + jitter + halfSpread;
  }

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

  const result = {
    symbol,
    bid,
    ask,
    spread,
    timestamp: toTimestampMs(raw?.timestamp ?? raw?.time ?? raw?.candle?.time),
    lp,
    dailyChange: toNumber(raw?.daily_change ?? raw?.dailyChange, previous?.dailyChange ?? 0),
    high24h: toNumber(raw?.high_24h ?? raw?.high24h, previous?.high24h ?? Math.max(bid, ask)),
    low24h: toNumber(raw?.low_24h ?? raw?.low24h, previous?.low24h ?? Math.min(bid, ask)),
    volume: toNumber(raw?.volume_24h ?? raw?.volume ?? raw?.candle?.volume, previous?.volume ?? 0),
    last: (bid + ask) / 2,
    digits: toNumber(raw?.digits, previous?.digits ?? 0) || getSymbolDigits(symbol),
  };

  if (WS_DEBUG) console.log(`[normalizeTick] ${symbol}: SUCCESS bid=${bid} ask=${ask}`);
  return result;
};

const parseTickPayloads = (input: any): any[] => {
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

  return source.map((raw: RawRecord, index: number) => {
    const parsedId = Number.parseInt(String(raw.ticket ?? raw.id ?? index + 1), 10);
    const openPrice = toNumber(raw.price_open ?? raw.open_price ?? raw.openPrice ?? raw.price, 0);
    const currentPrice = toNumber(raw.price_current ?? raw.current_price ?? raw.currentPrice, openPrice);
    const rawSide = String(raw.side ?? '').toLowerCase();

    return {
      id: Number.isFinite(parsedId) ? parsedId : index + 1,
      symbol: String(raw.symbol ?? ''),
      side: rawSide === 'sell' || rawSide === 'short' ? 'SELL' : 'BUY',
      volume: toNumber(raw.quantity ?? raw.volume, 0),
      openPrice,
      currentPrice,
      openTime: String(raw.opened_at ?? raw.openTime ?? (raw.time_create ? new Date(toNumber(raw.time_create) * 1000).toISOString() : new Date().toISOString())),
      sl: toNumber(raw.price_sl ?? raw.sl, 0),
      tp: toNumber(raw.price_tp ?? raw.tp, 0),
      swap: toNumber(raw.swap, 0),
      commission: toNumber(raw.commission, 0),
      unrealizedPnL: toNumber(raw.profit ?? raw.unrealized_pl ?? raw.unrealizedPnL, 0),
    };
  });
};

const getLivePositionPnL = (position: Position, tick?: Tick): number => {
  const openPrice = Number(position.openPrice ?? 0);
  const volume = Number(position.volume ?? 0);

  if (!tick || openPrice <= 0) {
    return Number(position.unrealizedPnL ?? 0);
  }

  const symbol = position.symbol ?? '';
  const livePrice = position.side === 'BUY' ? Number(tick.bid) : Number(tick.ask);
  if (!Number.isFinite(livePrice) || livePrice <= 0) {
    return Number(position.unrealizedPnL ?? 0);
  }

  let multiplier = 100000;
  if (symbol.includes('JPY')) multiplier = 1000;
  else if (symbol.startsWith('BTC') || symbol.startsWith('ETH')) multiplier = 1;
  else if (symbol.startsWith('XAU')) multiplier = 100;
  else if (symbol.startsWith('XAG')) multiplier = 5000;

  const priceDiff = position.side === 'BUY' ? (livePrice - openPrice) : (openPrice - livePrice);
  return priceDiff * volume * multiplier;
};

const normalizeAccountSummary = (payload: unknown, prev?: Account | null): Account => {
  const raw = (payload || {}) as RawRecord;

  // Extract with explicit undefined checks so that literal 0s from the server are respected
  // but missing keys properly fall back to previous state.
  const balanceRaw = raw.balance ?? raw.Balance;
  const equityRaw = raw.equity ?? raw.Equity;

  // Heuristic Guard: Prevent dummy all-zero WebSocket payloads from clearing valid REST data.
  if (Number(balanceRaw) === 0 && Number(equityRaw) === 0 && prev && prev.balance > 0) {
    // If the backend broadcasts a 0 balance/equity but we genuinely have a balance, 
    // it's likely a blank initialization schema. Ignore it.
    return prev;
  }

  const balance = balanceRaw !== undefined ? toNumber(balanceRaw, 0) : (prev?.balance ?? 0);
  const equity = equityRaw !== undefined ? toNumber(equityRaw, balance) : (prev?.equity ?? balance);

  const marginRaw = raw.margin ?? raw.margin_used;
  const margin = marginRaw !== undefined ? toNumber(marginRaw, 0) : (prev?.margin ?? 0);

  const freeMarginRaw = raw.freeMargin ?? raw.free_margin ?? raw.margin_available;
  const freeMarginFallback = prev?.freeMargin ?? Math.max(0, equity - margin);
  const freeMargin = freeMarginRaw !== undefined ? toNumber(freeMarginRaw, freeMarginFallback) : freeMarginFallback;

  const profitRaw = raw.profit ?? raw.unrealizedPL ?? raw.unrealized_pl ?? raw.unrealizedPnL;
  const unrealizedPL = profitRaw !== undefined ? toNumber(profitRaw, 0) : (prev?.unrealizedPL ?? 0);

  const levelRaw = raw.marginLevel ?? raw.margin_level;
  const marginLevelFallback = prev?.marginLevel ?? (margin > 0 ? (equity / margin) * 100 : 0);
  const marginLevel = levelRaw !== undefined ? toNumber(levelRaw, marginLevelFallback) : marginLevelFallback;

  const leverageRaw = raw.leverage;
  const leverage = leverageRaw !== undefined ? toNumber(leverageRaw, 100) : (prev?.leverage ?? 100);

  return {
    balance,
    equity,
    margin,
    freeMargin,
    unrealizedPL,
    marginLevel,
    currency: String(raw.currency ?? prev?.currency ?? 'USD'),
    leverage,
  };
};

const extractAccountPayload = (message: any): RawRecord => {
  const candidate = message?.data;

  if (candidate && typeof candidate === 'object' && !Array.isArray(candidate)) {
    if (Object.keys(candidate).length > 0) return candidate as RawRecord;
  }

  if (typeof candidate === 'string') {
    try {
      const parsed = JSON.parse(candidate);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        return parsed as RawRecord;
      }
    } catch {
      // Ignore invalid JSON strings.
    }
  }

  if (message && typeof message === 'object' && !Array.isArray(message)) {
    const rootCandidate = message as RawRecord;
    if (
      rootCandidate.balance !== undefined ||
      rootCandidate.equity !== undefined ||
      rootCandidate.margin !== undefined ||
      rootCandidate.freeMargin !== undefined ||
      rootCandidate.marginLevel !== undefined ||
      rootCandidate.profit !== undefined
    ) {
      return rootCandidate;
    }
  }

  return {};
};

const POSITION_CLOSED_EVENTS = new Set(['close', 'closed', 'sl_hit', 'tp_hit']);
const TRADE_WS_HEARTBEAT_STALE_MS = 10_000;

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

const getPositionEventName = (message: any): string => {
  const raw = message?.event ?? message?.type ?? message?.action ?? message?.data?.event ?? message?.data?.type ?? message?.data?.action ?? message?.data?.reason;
  return String(raw ?? '').trim().toLowerCase();
};

const getPositionEventTicket = (message: any): number | null => {
  const payload = message?.position ?? message?.data?.position ?? message?.data ?? message;
  const ticket = Number.parseInt(String(payload?.ticket ?? payload?.id ?? payload?.position_ticket ?? message?.ticket ?? ''), 10);
  return Number.isFinite(ticket) && ticket > 0 ? ticket : null;
};

function App() {
  const DEFAULT_CHART_TIMEFRAME: Timeframe = 'M5';
  const TIMEFRAME_MIGRATION_KEY = 'rtx5_timeframe_default_v2';

  // Mount the Auto-Close Supervisor (tests tick state against SL/TP repeatedly)
  useAutoCloseMonitor(500);

  // Start closed and restore only after a validated token or active authenticated store session.
  const [isAuthenticated, setIsAuthenticated] = useState(() => {
    const state = useAppStore.getState();
    const expiryMs = state.tokenExpiresAt || getStoredTokenExpiryMs();
    return Boolean(
      state.isAuthenticated &&
      parsePositiveInt(state.accountId || undefined) &&
      !hasTokenExpiryElapsed(expiryMs)
    );
  });
  const [isAutoAuthenticating, setIsAutoAuthenticating] = useState(false);
  const [autoAuthError, setAutoAuthError] = useState<string | null>(null);
  const [tokenSessionVersion, setTokenSessionVersion] = useState(0);
  const storeTokenExpiresAt = useAppStore(state => state.tokenExpiresAt);
  const [selectedSymbol, setSelectedSymbol] = useState<string>('');
  const [positions, setPositions] = useState<Position[]>([]);
  const [account, setAccount] = useState<Account | null>(null);
  const [orders, setOrders] = useState<any[]>([]);
  const [ledger, setLedger] = useState<any[]>([]);
  const [volume, setVolume] = useState(0.01);
  const [orderLoading, setOrderLoading] = useState(false);
  const [chartType, setChartType] = useState<ChartType>(() => {
    const saved = localStorage.getItem('rtx5_chart_type');
    return (saved as ChartType) || 'candlestick';
  });
  const [timeframe, setTimeframe] = useState<Timeframe>(() => {
    const saved = localStorage.getItem('rtx5_timeframe');
    return (saved as Timeframe) || DEFAULT_CHART_TIMEFRAME;
  });
  const [brokerConfig, setBrokerConfig] = useState<BrokerConfig | null>(null);
  const [dockHeight, setDockHeight] = useState(() => {
    const saved = localStorage.getItem('dockHeight');
    return saved ? parseInt(saved, 10) : 250;
  });
  const [accountId, setAccountId] = useState<string>('');
  const activeAccountDataRef = useRef<number | null>(null);
  const accountIdRef = useRef(accountId);
  const isAuthenticatedRef = useRef(isAuthenticated);
  const lastObservedAuthTokenRef = useRef<string | null>(getStoredAuthToken());
  const refreshPositionsInFlightRef = useRef<Promise<void> | null>(null);
  const refreshPositionsPendingRef = useRef<PendingPositionsRefresh | null>(null);
  const refreshHistoryInFlightRef = useRef<Promise<void> | null>(null);
  const refreshHistoryPendingLoginRef = useRef<number | null>(null);
  const accountPollInFlightRef = useRef<Promise<void> | null>(null);
  const lastTradeWsMessageAtRef = useRef(0);
  const tradeDataVersionRef = useRef(0);
  const localTradeDataVersionRef = useRef(0);
  const optimisticClosedTicketsRef = useRef<Set<number>>(new Set());
  const [isLoadingSymbols, setIsLoadingSymbols] = useState(false);
  const [hasLoadedSymbols, setHasLoadedSymbols] = useState(false);
  const [allSymbols, setAllSymbols] = useState<unknown[]>([]);

  const [enableHistoricalData] = useState(true);

  accountIdRef.current = accountId;
  isAuthenticatedRef.current = isAuthenticated;

  const clearLocalAccountState = useCallback(() => {
    activeAccountDataRef.current = null;
    accountIdRef.current = '';
    isAuthenticatedRef.current = false;
    setAccount(null);
    setPositions([]);
    setOrders([]);
    setLedger([]);
    useAppStore.getState().setAccount(null);
    useAppStore.getState().setPositions([] as any);
    useAppStore.getState().setOrders([] as any);
    useAppStore.getState().setTrades([] as any);
  }, []);

  const performSessionExpiredLogout = useCallback((reason = 'session_expired') => {
    console.warn(`[App] Logging out session: ${reason}`);
    lastObservedAuthTokenRef.current = null;
    clearLocalAccountState();
    setIsAuthenticated(false);
    setAccountId('');
    useAppStore.getState().logout();
  }, [clearLocalAccountState]);

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
    setIsAuthenticated(true);
    setAccountId(String(loginId));

    const storeState = useAppStore.getState();
    if (!storeState.isAuthenticated || storeState.accountId !== String(loginId)) {
      const refreshToken = localStorage.getItem('refresh_token') || sessionStorage.getItem('refresh_token') || undefined;
      const expiresAt = getStoredTokenExpiryMs() || undefined;
      storeState.setAuthenticated(true, String(loginId), token, refreshToken, expiresAt);
    }

    import('./services/bootstrapApp')
      .then(({ bootstrapApp }) => bootstrapApp(loginId))
      .catch(console.error);
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

    const channelLogin = parsePositiveInt(channel?.split('.')[1]);
    if (channelLogin && channelLogin !== liveLogin) return null;

    return channelLogin || liveLogin;
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
      }
    });
  }, []);

  const reconcileOptimisticClosedPositions = useCallback((normalized: Position[], options: OptimisticCloseReconcileOptions = {}) => {
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

  useEffect(() => {
    const hasMigrated = localStorage.getItem(TIMEFRAME_MIGRATION_KEY) === '1';
    const savedTimeframe = localStorage.getItem('rtx5_timeframe');

    if (!hasMigrated && (!savedTimeframe || savedTimeframe === 'M1')) {
      localStorage.setItem('rtx5_timeframe', DEFAULT_CHART_TIMEFRAME);
      setTimeframe(DEFAULT_CHART_TIMEFRAME);
    }

    if (!hasMigrated) {
      localStorage.setItem(TIMEFRAME_MIGRATION_KEY, '1');
    }
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
      const requestToken = (event as CustomEvent<{ requestToken?: string | null }>).detail?.requestToken;
      const currentToken = localStorage.getItem('auth_token');
      if (requestToken && currentToken && requestToken !== currentToken) {
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
    const restoreSession = async () => {
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
          setIsAuthenticated(true);
          setAccountId(restoredAccountId);
          console.log('[Session] Restored via token for:', restoredAccountId);
          // Trigger MT5-style boot sequence — fetch all data before showing the UI
          const { bootstrapApp } = await import('./services/bootstrapApp');
          bootstrapApp(loginId).catch(console.error);
          return;
        }
      } catch (err: any) {
        console.log('[Session] Restore failed:', err.message);
        performSessionExpiredLogout('restore_failed');
        setAutoAuthError(err.message || 'Session restore failed');
      } finally {
        setIsAutoAuthenticating(false);
      }
    };

    restoreSession();
  }, [performSessionExpiredLogout]);

  // Foreground Focus Handler: Catch window 'visibilitychange' & 'focus' events.
  // Proactively refresh token if needed, trigger immediate WS reconnect & positions refresh.
  useEffect(() => {
    const handleForeground = async () => {
      // Only execute if user is currently authenticated
      if (!isAuthenticatedRef.current) return;
      if (!validateStoredAuthSession('auth_token_removed')) return;

      console.log('[App] App returned to foreground / focus. Checking token status...');
      try {
        // Proactively refresh token if expired or close to expiry (<60s)
        const activeToken = await brokerApi.checkAndProactiveRefresh();
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

  // Indicator Navigator state
  const [showIndicatorNavigator, setShowIndicatorNavigator] = useState(false);
  const [indicatorNavCategory, setIndicatorNavCategory] = useState<string | undefined>(undefined);

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
        w: m !== 's' ? Math.max(180, origW + dx) : prev.w,
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
      const MIN_W = 180, MIN_H = 200;
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

  const allowedSymbolNames = useMemo(() => getAllowedSymbolNames(allSymbols), [allSymbols]);
  const allowedSymbolsKey = allowedSymbolNames.join(',');
  const allowedSymbolSet = useMemo(() => new Set(allowedSymbolNames), [allowedSymbolNames]);

  const getAllowedSymbol = useCallback((symbol: unknown): string => {
    const normalized = normalizeSymbolName(symbol);
    if (!normalized || !hasLoadedSymbols || allowedSymbolNames.length === 0) return '';
    return allowedSymbolSet.has(normalized) ? normalized : '';
  }, [allowedSymbolNames.length, allowedSymbolSet, hasLoadedSymbols]);

  // Symbol select handler: dispatch openChart event for consistent MT5 behavior
  const handleSymbolSelect = useCallback((symbol: string) => {
    const allowedSymbol = getAllowedSymbol(symbol);
    if (!allowedSymbol) return;
    setSelectedSymbol(allowedSymbol);
    // Dispatch openChart. If the symbol already has a tab, we switch to it.
    // If not, we add it as a new tab.
    window.dispatchEvent(new CustomEvent('openChart', { detail: { symbol: allowedSymbol, newTab: true } }));
  }, [getAllowedSymbol]);

  // Multi-Chart State (Now managed by DockManager)
  useEffect(() => {
    // Sync selected symbol to persistence
    if (!hasLoadedSymbols) return;
    if (selectedSymbol && allowedSymbolSet.has(normalizeSymbolName(selectedSymbol))) {
      localStorage.setItem(SELECTED_SYMBOL_STORAGE_KEY, selectedSymbol);
    } else {
      localStorage.removeItem(SELECTED_SYMBOL_STORAGE_KEY);
    }
  }, [allowedSymbolSet, hasLoadedSymbols, selectedSymbol]);

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
        console.log('[App] Command bus SET_CHART_TYPE ->', ct);
        setChartType(ct as ChartType);
      }
    });
    const unsub2 = commandBus.subscribe('SET_TIMEFRAME' as any, (payload: any) => {
      const tf = payload?.timeframe;
      if (tf) {
        console.log('[App] Command bus SET_TIMEFRAME ->', tf);
        setTimeframe(tf as Timeframe);
      }
    });
    const unsub3 = commandBus.subscribe('OPEN_INDICATOR_LIST' as any, (payload: any) => {
      setIndicatorNavCategory(payload?.category ?? undefined);
      setShowIndicatorNavigator(true);
    });
    return () => { unsub1(); unsub2(); unsub3(); };
  }, []);

  // Order Panel State
  const [orderPanelOpen, setOrderPanelOpen] = useState(false);
  const [orderPanelSymbol, setOrderPanelSymbol] = useState('');
  const [orderPanelPrice, setOrderPanelPrice] = useState({ bid: 0, ask: 0 });

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

  // Handle Close Active Chart (File > Close menu and Ctrl+F4 shortcut)
  useEffect(() => {
    const handleCloseActiveChart = () => {
      // Get active chart id from dockmanager or just close the most recently focused panel
      // For now we'll close the currently selected symbol panel if we can find it in the layout
      const layout = useDockLayoutStore.getState().layout;
      let targetId: string | null = null;

      // Traverse to find a chart with the selected symbol
      const findChart = (container: any) => {
        if (!container.children) return;
        for (const child of container.children) {
          if (child.component === 'Chart' && child.props?.symbol === selectedSymbol) {
            targetId = child.id;
            break;
          }
          if (child.children) {
            findChart(child);
          }
        }
      };

      findChart(layout.root);
      if (!targetId) {
        for (const float of layout.floatingPanels) {
          findChart(float);
        }
      }

      if (targetId) {
        useDockLayoutStore.getState().removePanel(targetId);
      }
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      // Ctrl+F4 - Close active chart
      if (e.ctrlKey && e.key === 'F4') {
        e.preventDefault();
        handleCloseActiveChart();
      }
    };

    window.addEventListener('close-active-chart', handleCloseActiveChart);
    window.addEventListener('keydown', handleKeyDown);

    return () => {
      window.removeEventListener('close-active-chart', handleCloseActiveChart);
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, []); // Empty deps - handler uses functional updates for current state

  // Handle global menu actions


  // Subscribe to layout mode changes
  useEffect(() => {
    const unsubscribe = windowManager.subscribe((mode) => {
      setLayoutMode(mode);
    });
    return unsubscribe;
  }, []);

  // Load and auto-save layout per user
  useEffect(() => {
    if (!isAuthenticated || !accountId) return;

    // Load initial layout for user
    useDockLayoutStore.getState().loadLayout(accountId);

    // Auto save on layout change (debounced implicitly by React renders or user actions)
    const unsub = useDockLayoutStore.subscribe((state, prevState) => {
      if (state.layout !== prevState.layout) {
        useDockLayoutStore.getState().saveLayout(accountId);
      }
    });

    return unsub;
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
      const posData = await api.positions.getPositions(requestedLogin);
      const activeLogin = parsePositiveInt(useAppStore.getState().accountId || accountIdRef.current || undefined);
      if (!isAuthenticatedRef.current || activeLogin !== requestedLogin) return;
      if (isStaleTradeRestRead(restRead, options)) return;

      const normalized = reconcileOptimisticClosedPositions(normalizePositions(posData), { clearConfirmedAbsent: true });
      // Write ONLY to the central store — NOT to local App state.
      // This prevents App.tsx from re-rendering (which caused the blank-display crash
      // after every Buy/Sell). BottomDock reads positions from useAppStore directly.
      useAppStore.getState().setPositions(normalized as any);
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
    const handleSync = (event: Event) => {
      const eventLogin = parsePositiveInt(String((event as CustomEvent)?.detail?.login ?? ''));
      const requestedLogin = eventLogin || getLiveTradingLogin();
      if (!requestedLogin) return;
      refreshPositions(requestedLogin, { allowWsCommit: true });
    };
    window.addEventListener('rtx:force-refresh-positions', handleSync);
    return () => window.removeEventListener('rtx:force-refresh-positions', handleSync);
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

  const handleClosePosition = async (id: number) => {
    // Guard against double-click: skip if already closing this ticket
    if (closingTicketsRef.current.has(id)) {
      console.log(`[App] Close already in progress for ticket ${id}, skipping duplicate`);
      return;
    }
    closingTicketsRef.current.add(id);

    markLocalTradeMutation([id]);
    // Optimistically remove from the app store immediately.
    useAppStore.getState().setPositions(useAppStore.getState().positions.filter(p => p.id !== id));
    // Trigger close sound
    import('./utils/audio').then(m => m.playSystemSound('close'));

    try {
      await api.positions.closePosition(String(id));
      markLocalTradeMutation();
      refreshPositions(getLiveTradingLogin() || undefined, { allowWsCommit: true });
    } catch (err: any) {
      clearOptimisticClosedTickets([id]);
      console.error('Failed to close position:', err);
      refreshPositions(getLiveTradingLogin() || undefined, { allowWsCommit: true });
    } finally {
      closingTicketsRef.current.delete(id);
    }
  };

  const handleCancelOrder = async (orderId: string) => {
    if (!(await useConfirmStore.getState().showConfirm('Confirm Action', 'Cancel this order?'))) return;
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
    if (!confirm(`Close ${type} positions?`)) return;

    let optimisticTicketIds: number[] = [];
    try {
      const accId = parsePositiveInt(accountId);
      if (!accId) return;

      if (type === 'ALL' && !symbol) {
        optimisticTicketIds = useAppStore.getState().positions.map((position) => position.id);
        markLocalTradeMutation(optimisticTicketIds);
        useAppStore.getState().setPositions([]);
        await accountV2Api.closeAllPositions(accId);
      } else {
        const openPositions = normalizePositions(await tradingV2Api.getPositions(accId, { limit: 500, offset: 0 }).catch(() => api.positions.getPositions(accId) as any));
        const { ticks, tickLookup } = useAppStore.getState();
        const candidates = openPositions.filter((position) => {
          if (symbol && position.symbol !== symbol) return false;
          if (type === 'ALL') return true;
          const profit = getLivePositionPnL(position, resolveTickFromLookup(ticks, tickLookup, position.symbol));
          return type === 'WINNERS' ? profit > 0 : profit < 0;
        });

        optimisticTicketIds = candidates.map((position) => position.id);
        markLocalTradeMutation(optimisticTicketIds);
        useAppStore.getState().setPositions(useAppStore.getState().positions.filter((position) => !optimisticTicketIds.includes(position.id)));
        await Promise.all(candidates.map((position) => tradingV2Api.closePosition(position.id)));
      }

      markLocalTradeMutation();
      refreshPositions(accId, { allowWsCommit: true });
    } catch (err) {
      clearOptimisticClosedTickets(optimisticTicketIds);
      console.error('Bulk close failed:', err);
      refreshPositions(parsePositiveInt(accountId) || undefined, { allowWsCommit: true });
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

  // Fetch account and positions from backend + periodic polling
  useEffect(() => {
    if (!isAuthenticated || !accountId) return;

    const loginId = parsePositiveInt(accountId);
    if (!loginId) return;
    let cancelled = false;

    const fetchAccountHeartbeat = async (isInitial = false) => {
      if (accountPollInFlightRef.current) {
        await accountPollInFlightRef.current;
        return;
      }

      const request = (async () => {
        try {
        const restRead = beginTradeRestRead();
        const isAccountSwitch = activeAccountDataRef.current !== loginId;
        if (isInitial) {
          console.log('[App] Fetching account data for login:', loginId);
          // Clear stale data — write to store, not local App state
          if (isAccountSwitch) {
            // Clear stale data only when moving to a different account.
            useAppStore.getState().setAccount(null);
            useAppStore.getState().setPositions([] as any);
            useAppStore.getState().setOrders([] as any);
            useAppStore.getState().setTrades([] as any);
          }
        }

        const [accResult, posResult] = await Promise.allSettled([
          api.account.getAccountSummary(loginId),
          api.positions.getPositions(loginId),
        ]);

        const activeLogin = parsePositiveInt(useAppStore.getState().accountId || accountIdRef.current || undefined);
        if (cancelled || !isAuthenticatedRef.current || activeLogin !== loginId) {
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
          const normalizedAccount = normalizeAccountSummary(accPayload);
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
          useAppStore.getState().setPositions(reconcileOptimisticClosedPositions(normalizePositions(posPayload), { clearConfirmedAbsent: true }) as any);
        }
        activeAccountDataRef.current = loginId;

        if (isInitial) console.log('[App] Account data loaded for login:', loginId);
        } catch (err) {
          if (isInitial) console.error('Failed to fetch account data:', err);
        } finally {
          accountPollInFlightRef.current = null;
        }
      })();

      accountPollInFlightRef.current = request;
      await request;
    };

    // Initial fetch
    void fetchAccountHeartbeat(true);
    void refreshOrdersAndHistory(loginId).catch(err => {
      console.error('[History] Failed to refresh initial orders/history:', err);
    });

    // Poll account/positions only as a fallback heartbeat; order/history refreshes are event/manual driven.
    const pollInterval = setInterval(() => {
      const hasFreshTradeWs = isConnected && Date.now() - lastTradeWsMessageAtRef.current < TRADE_WS_HEARTBEAT_STALE_MS;
      if (hasFreshTradeWs) return;
      void fetchAccountHeartbeat(false);
    }, 3000);

    return () => {
      cancelled = true;
      clearInterval(pollInterval);
    };
  }, [beginTradeRestRead, isAuthenticated, accountId, isConnected, isStaleTradeRestRead, reconcileOptimisticClosedPositions, refreshOrdersAndHistory]);

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

  // Subscribe to market data through swagger v2 action/channel websocket messages.
  useEffect(() => {
    console.log(`[WS Subscription Effect] isAuthenticated=${isAuthenticated}, isConnected=${isConnected}`);
    if (!isAuthenticated || !isConnected) {
      console.log('[WS Subscription Effect] Skipping - not authenticated or not connected');
      return;
    }

    const unsubscribers: Array<() => void> = [];

    const subscribeTimeout = setTimeout(() => {
      const activeWatchlist = useWatchlistStore.getState().getActiveWatchlist();
      const watchlistSymbols = activeWatchlist?.symbols || [];

      const symbolsToSubscribe = [...new Set([...watchlistSymbols, selectedSymbol].filter(Boolean))]
        .map(symbol => String(symbol).trim().toUpperCase())
        .filter(symbol => Boolean(symbol) && allowedSymbolSet.has(symbol));

      console.log(`[WS] Connected! Subscribing to ${symbolsToSubscribe.length} v2 market channels from watchlist: ${activeWatchlist?.name || 'default'}`);

      try {
        symbolsToSubscribe.forEach(symbol => {
          unsubscribers.push(subscribe(`ticks.${symbol}`, () => undefined));
          useMarketDataStore.getState().subscribeSymbol(symbol);
        });

        const selected = normalizeSymbolName(selectedSymbol);
        if (selected && allowedSymbolSet.has(selected)) {
          unsubscribers.push(subscribe(`candles.${selected}.${toV2Timeframe(timeframe as string)}`, () => undefined));
          unsubscribers.push(subscribe(`depth.${selected}`, () => undefined));
        }

        console.log(`[WS] <<< v2 subscriptions active for ${symbolsToSubscribe.length} symbols`);
      } catch (e) {
        console.error("[WS] Failed to subscribe to v2 market channels:", e);
      }
    }, 500);

    return () => {
      clearTimeout(subscribeTimeout);
      unsubscribers.forEach(unsubscribe => unsubscribe());
    };
  }, [
    isAuthenticated,
    isConnected,
    subscribe,
    selectedSymbol,
    timeframe,
    allowedSymbolsKey,
    allowedSymbolSet,
    useWatchlistStore.getState().activeWatchlistId,
    useWatchlistStore.getState().getActiveWatchlist()?.symbols.join(',')
  ]);

  useEffect(() => {
    const loginId = parsePositiveInt(accountId);
    if (!isAuthenticated || !isConnected || !loginId) return;

    const channels = [
      `account.${loginId}`,
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
        if (data.channel?.startsWith('account.')) {
          const acceptedLogin = getAcceptedChannelLogin(data.channel);
          if (!acceptedLogin) return;
          markTradeWsMessage();

          // Live backend account summary stream
          if (WS_DEBUG) console.log('[DEBUG WS ACCOUNT RAW]', data);
          const accData = extractAccountPayload(data);
          if (WS_DEBUG) console.log('[DEBUG WS ACCOUNT PAYLOAD]', accData);
          const previousAccount = useAppStore.getState().account as Account | null | undefined;
          const next = normalizeAccountSummary(accData, previousAccount);
          if (!isAuthenticatedRef.current || getLiveTradingLogin() !== acceptedLogin) return;
          useAppStore.getState().setAccount(next as any);
        } else if (data.channel?.startsWith('positions.')) {
          const acceptedLogin = getAcceptedChannelLogin(data.channel);
          if (!acceptedLogin) return;
          markTradeWsMessage();
          if (WS_DEBUG) console.log('[DEBUG WS POSITIONS RAW]', data);
          try {
            const eventName = getPositionEventName(data);
            const ticket = getPositionEventTicket(data);
            if (!isAuthenticatedRef.current || getLiveTradingLogin() !== acceptedLogin) return;
            if (POSITION_CLOSED_EVENTS.has(eventName) && ticket) {
              // Keep optimistic close suppression until REST confirms absence; WS snapshots can lag.
              markServerClosedTickets([ticket]);
              useAppStore.getState().setPositions(useAppStore.getState().positions.filter(position => position.id !== ticket));
            } else if (data.data?.positions && Array.isArray(data.data.positions)) {
              const normalized = reconcileOptimisticClosedPositions(normalizePositions(data.data.positions));
              if (!isAuthenticatedRef.current || getLiveTradingLogin() !== acceptedLogin) return;
              useAppStore.getState().setPositions(normalized as any);
            } else if (data.data && Array.isArray(data.data)) {
              const normalized = reconcileOptimisticClosedPositions(normalizePositions(data.data));
              if (!isAuthenticatedRef.current || getLiveTradingLogin() !== acceptedLogin) return;
              useAppStore.getState().setPositions(normalized as any);
            } else if (data.position || data.data?.position || data.data) {
              const payload = data.position || data.data?.position || data.data;
              const normalized = normalizePositions([payload])[0];
              if (normalized) {
                if (!isAuthenticatedRef.current || getLiveTradingLogin() !== acceptedLogin) return;
                if (optimisticClosedTicketsRef.current.has(normalized.id)) return;
                const storePositions = useAppStore.getState().positions;
                const storeIndex = storePositions.findIndex(position => position.id === normalized.id);
                const nextStorePositions = storeIndex < 0
                  ? [...storePositions, normalized]
                  : storePositions.map((position, index) => index === storeIndex ? { ...position, ...normalized } : position);
                useAppStore.getState().setPositions(nextStorePositions as any);
              }
            }
          } catch (err) {
            console.error('[WS POSITIONS ERROR]', err);
          }
        } else if (data.channel?.startsWith('orders.')) {
          const loginId = getAcceptedChannelLogin(data.channel);
          if (!loginId) return;
          markTradeWsMessage();
          refreshOrdersAndHistory(loginId).catch(err => console.error('[WS ORDERS REFRESH ERROR]', err));
        } else if (data.channel?.startsWith('deals.')) {
          const loginId = getAcceptedChannelLogin(data.channel);
          if (!loginId) return;
          markTradeWsMessage();
          refreshOrdersAndHistory(loginId).catch(err => console.error('[WS DEALS REFRESH ERROR]', err));
        } else if (data.type === 'tick' || isTickLikeUpdate || isLiveQuote || data.channel?.startsWith('ticks.') || data.channel === 'prices') {
          // Wrap live quote data if it comes in raw formats
          const tickPayload: any = (isLiveQuote || data.channel?.startsWith('ticks.') || data.channel === 'prices') && data.data ? data.data : data;

          if (data.channel?.startsWith('ticks.') && tickPayload && !tickPayload.symbol) {
            tickPayload.symbol = data.channel.split('.')[1];
          }

          // Always log received ticks for debugging
          if (data.type === 'tick' && data.symbol && WS_DEBUG) {
            console.log(`[WS TICK] ${data.symbol} bid=${data.bid} ask=${data.ask}`);
          }

          const payloadItems = parseTickPayloads(tickPayload);
          if (payloadItems.length === 0) return;

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
            const baseSymbol = rawSymbol.split('.')[0];

            // Fast path: if exact symbol exists in store, skip variant resolution
            if (currentStore[rawSymbol] || currentStore[baseSymbol]) {
              const variants: string[] = [];
              if (currentStore[rawSymbol]) variants.push(rawSymbol);
              if (baseSymbol !== rawSymbol && currentStore[baseSymbol]) variants.push(baseSymbol);
              if (variants.length === 0) variants.push(rawSymbol);

              let sharedJitter: number | undefined = undefined;
              if (rawSymbol.includes('BTC') || rawSymbol.includes('ETH')) {
                const jitterRange = rawSymbol.includes('BTC') ? 5 : 0.5;
                sharedJitter = (Math.random() - 0.5) * jitterRange;
              }

              variants.forEach(resolveSymbol => {
                const scopedTickData = { ...tickData, symbol: resolveSymbol };
                const previousTick = currentStore[resolveSymbol];
                const normalizedTick = normalizeRealtimeTick(scopedTickData, previousTick, sharedJitter);
                if (normalizedTick) {
                  enqueueLiveTick(normalizedTick.symbol, {
                    ...normalizedTick,
                    timestamp: normalizedTick.timestamp || Date.now(),
                    lp: normalizedTick.lp || 'YOFX',
                    volume: normalizedTick.volume || 1,
                  });
                  const normalizedBase = normalizedTick.symbol.split('.')[0];
                  if (normalizedBase && normalizedBase !== normalizedTick.symbol) {
                    enqueueLiveTick(normalizedBase, {
                      ...normalizedTick,
                      symbol: normalizedBase,
                      timestamp: normalizedTick.timestamp || Date.now(),
                      lp: normalizedTick.lp || 'YOFX',
                      volume: normalizedTick.volume || 1,
                    });
                  }
                }
              });
              return; // Skip slow variant resolution below
            }

            // Slow path: full variant resolution for symbols with suffixes
            const currentStoreKeys = Object.keys(currentStore);
            const rawLower = rawSymbol.toLowerCase();
            const baseLower = baseSymbol.toLowerCase();

            const variants = currentStoreKeys.filter(key => {
              const keyLower = key.toLowerCase();
              return keyLower === rawLower || keyLower === baseLower || keyLower.startsWith(`${baseLower}.`);
            });

            if (!variants.some(v => v.toLowerCase() === rawLower)) variants.push(rawSymbol);
            if (!variants.some(v => v.toLowerCase() === baseLower)) variants.push(baseSymbol);

            if (variants.length === 0) {
              variants.push(baseSymbol);
            }

            // Calculate a single jitter value for this tick event to ensure all variants are in sync
            let sharedJitter: number | undefined = undefined;
            if (rawSymbol.includes('BTC') || rawSymbol.includes('ETH')) {
              const jitterRange = rawSymbol.includes('BTC') ? 5 : 0.5;
              sharedJitter = (Math.random() - 0.5) * jitterRange;
            }

            variants.forEach(resolveSymbol => {
              // Only update this variant if it's currently tracked in the store OR if it's the exact base symbol
              const shouldUpdate = currentStore[resolveSymbol] || resolveSymbol === rawSymbol || resolveSymbol === baseSymbol;
              if (WS_DEBUG) console.log(`[WS variants] ${resolveSymbol}: shouldUpdate=${shouldUpdate} (inStore=${!!currentStore[resolveSymbol]})`);
              if (shouldUpdate) {
                const scopedTickData = { ...tickData, symbol: resolveSymbol };
                const previousTick = currentStore[resolveSymbol];
                if (WS_DEBUG) console.log(`[WS] Normalizing tick for ${resolveSymbol}:`, scopedTickData);
                const normalizedTick = normalizeRealtimeTick(scopedTickData, previousTick, sharedJitter);

                if (normalizedTick) {
                  if (WS_DEBUG) console.log(`[WS] Updating store for ${normalizedTick.symbol}: bid=${normalizedTick.bid}`);
                  enqueueLiveTick(normalizedTick.symbol, {
                    ...normalizedTick,
                    timestamp: normalizedTick.timestamp || Date.now(),
                    lp: normalizedTick.lp || 'YOFX',
                    volume: normalizedTick.volume || 1,
                  });
                  const normalizedBase = normalizedTick.symbol.split('.')[0];
                  if (normalizedBase && normalizedBase !== normalizedTick.symbol) {
                    enqueueLiveTick(normalizedBase, {
                      ...normalizedTick,
                      symbol: normalizedBase,
                      timestamp: normalizedTick.timestamp || Date.now(),
                      lp: normalizedTick.lp || 'YOFX',
                      volume: normalizedTick.volume || 1,
                    });
                  }
                } else {
                  if (WS_DEBUG) console.log(`[DEBUG WS] normalizeRealtimeTick returned null for ${resolveSymbol}`, scopedTickData);
                }
              }
            });
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
          });
        } else if (data.type === 'candle_update') {
          // Dispatch to market data store
          useMarketDataStore.getState().updateCandle(data);
        }
      } catch (e) {
        console.error('[WS] Parse error:', e);
      }
    });

    return () => {
      unsubscribe();
    };
  }, [isAuthenticated, subscribe, getAcceptedChannelLogin, getLiveTradingLogin, markServerClosedTickets, markTradeWsMessage, reconcileOptimisticClosedPositions, refreshOrdersAndHistory]);

  const placeOrder = useCallback(async (side: 'BUY' | 'SELL') => {
    setOrderLoading(true);
    try {
      const loginId = getLiveTradingLogin();
      if (!loginId) return;

      const result = await api.orders.placeMarketOrder({
        symbol: selectedSymbol,
        side,
        volume,
        login: loginId,
      });
      console.log('[Trade] Order executed via trading API:', result);
      refreshPositions(loginId);
      refreshOrdersAndHistory(loginId).catch(err => console.error('[Trade] Failed to refresh orders/history:', err));
    } catch (err: any) {
      alert('Order failed: ' + err.message);
    } finally {
      setOrderLoading(false);
    }
  }, [getLiveTradingLogin, selectedSymbol, volume, refreshPositions, refreshOrdersAndHistory]);

  const handleOrderPanelSubmit = useCallback(async (order: {
    type: 'buy' | 'sell';
    volume: number;
    symbol: string;
  }) => {
    setOrderLoading(true);
    try {
      const side = order.type.toUpperCase() as 'BUY' | 'SELL';
      const submitSymbol = getAllowedSymbol(order.symbol) || getAllowedSymbol(orderPanelSymbol) || selectedSymbol;
      if (!submitSymbol) return;
      const loginId = getLiveTradingLogin();
      if (!loginId) return;

      const result = await api.orders.placeMarketOrder({
        symbol: submitSymbol,
        side,
        volume: order.volume,
        login: loginId,
      });

      console.log('[Trade] Order executed from dialog via trading API:', result);
      refreshPositions(loginId);
      refreshOrdersAndHistory(loginId).catch(err => console.error('[Trade] Failed to refresh orders/history:', err));
    } catch (err: any) {
      alert('Order failed: ' + err.message);
    } finally {
      setOrderLoading(false);
    }
  }, [getAllowedSymbol, getLiveTradingLogin, orderPanelSymbol, selectedSymbol, refreshPositions, refreshOrdersAndHistory]);

  const closePosition = useCallback(async (tradeId: number, volume?: number) => {
    if (volume !== undefined) {
      console.error('Partial close is unsupported by the trading API');
      return;
    }
    // Trigger close sound
    import('./utils/audio').then(m => m.playSystemSound('close'));
    markLocalTradeMutation([tradeId]);
    useAppStore.getState().setPositions(useAppStore.getState().positions.filter(position => position.id !== tradeId));
    try {
      await api.positions.closePosition(String(tradeId));
      markLocalTradeMutation();
      refreshPositions(getLiveTradingLogin() || undefined, { allowWsCommit: true }); // fire-and-forget
    } catch (err) {
      clearOptimisticClosedTickets([tradeId]);
      console.error('Close failed:', err);
      refreshPositions(getLiveTradingLogin() || undefined, { allowWsCommit: true });
    }
  }, [clearOptimisticClosedTickets, getLiveTradingLogin, markLocalTradeMutation, refreshPositions]);

  // Fetch symbols from backend
  useEffect(() => {
    if (!isAuthenticated) {
      setAllSymbols([]);
      setIsLoadingSymbols(false);
      setHasLoadedSymbols(false);
      return;
    }

    setIsLoadingSymbols(true);
    setHasLoadedSymbols(false);
    api.market.getSymbols()
      .then(data => {
        const symbols = (Array.isArray(data) ? data : []).filter(item => Boolean(getInstrumentSymbolName(item)));
        const nextAllowedSymbols = getAllowedSymbolNames(symbols);
        const nextAllowedSet = new Set(nextAllowedSymbols);
        if (symbols.length > 0) {
          setAllSymbols(symbols);
          useWatchlistStore.getState().sanitizeSymbols(nextAllowedSymbols);
          setSelectedSymbol(prev => {
            const current = normalizeSymbolName(prev);
            if (current && nextAllowedSet.has(current)) return current;

            const saved = normalizeSymbolName(localStorage.getItem(SELECTED_SYMBOL_STORAGE_KEY));
            if (saved && nextAllowedSet.has(saved)) return saved;

            localStorage.removeItem(SELECTED_SYMBOL_STORAGE_KEY);
            return nextAllowedSymbols[0] || '';
          });
        } else {
          setAllSymbols([]);
          setSelectedSymbol('');
          localStorage.removeItem(SELECTED_SYMBOL_STORAGE_KEY);
        }
      })
      .catch(err => {
        console.error('Failed to fetch symbols:', err);
        setAllSymbols([]);
        setSelectedSymbol('');
        localStorage.removeItem(SELECTED_SYMBOL_STORAGE_KEY);
      })
      .finally(() => {
        setHasLoadedSymbols(true);
        setIsLoadingSymbols(false);
      });
  }, [isAuthenticated]);

  useEffect(() => {
    if (!hasLoadedSymbols || allowedSymbolNames.length === 0) return;

    const fallbackSymbol = allowedSymbolSet.has(normalizeSymbolName(selectedSymbol))
      ? normalizeSymbolName(selectedSymbol)
      : allowedSymbolNames[0];
    if (!fallbackSymbol) return;

    const store = useDockLayoutStore.getState();
    const layout = store.layout;
    const updates: Array<{ id: string; props: Record<string, unknown>; title: string }> = [];

    const collectInvalidChartPanels = (container: any) => {
      if (!container?.children) return;
      for (const child of container.children) {
        if (child?.children) {
          collectInvalidChartPanels(child);
          continue;
        }

        if (child?.component !== 'Chart') continue;
        const chartSymbol = normalizeSymbolName(child.props?.symbol ?? child.title?.split(',')[0]);
        if (chartSymbol && allowedSymbolSet.has(chartSymbol)) continue;

        const nextTimeframe = child.props?.timeframe || timeframe;
        updates.push({
          id: child.id,
          props: { ...child.props, symbol: fallbackSymbol, timeframe: nextTimeframe },
          title: `${fallbackSymbol},${nextTimeframe}`,
        });
      }
    };

    collectInvalidChartPanels(layout.root);
    layout.floatingPanels?.forEach(collectInvalidChartPanels);

    updates.forEach(update => {
      store.updatePanelProps(update.id, {
        props: update.props,
        title: update.title,
      });
    });
  }, [allowedSymbolNames, allowedSymbolSet, hasLoadedSymbols, selectedSymbol, timeframe]);


  useEffect(() => {
    return () => {
      terminateWorker();
    };
  }, []);

  // Dynamic window title — mirrors MT5: "AccountID - Server - Hedge/Netting - BrokerName - SYMBOL,TF"
  const brokerConfigRef = useRef<{ brokerName: string; marginMode: string } | null>(null);
  useEffect(() => {
    if (!isAuthenticated) return;
    if (!brokerConfigRef.current) {
      api.config.getConfig()
        .then((cfg) => { brokerConfigRef.current = cfg; })
        .catch(() => { brokerConfigRef.current = { brokerName: 'RTX', marginMode: 'HEDGING' }; });
    }
  }, [isAuthenticated]);

  useEffect(() => {
    if (!isAuthenticated || !accountId) return;

    const tfLabel: Record<string, string> = {
      '1m': 'M1', '5m': 'M5', '15m': 'M15', '30m': 'M30',
      '1h': 'H1', '4h': 'H4', '1d': 'D1',
    };
    const server     = useAppStore.getState().savedAccounts.find((a) => a.login === Number(accountId))?.server
                       || localStorage.getItem('rtx_broker_server') || 'RTX-Server';
    const marginMode = brokerConfigRef.current?.marginMode === 'NETTING' ? 'Netting' : 'Hedge';
    const broker     = brokerConfigRef.current?.brokerName || 'RTX Terminal';
    const tf         = tfLabel[timeframe] ?? timeframe.toUpperCase();
    const title      = `${accountId} - ${server} - ${marginMode} - ${broker} - ${selectedSymbol},${tf}`;

    document.title = title;
    window.electron?.window?.setTitle(title);
  }, [isAuthenticated, accountId, selectedSymbol, timeframe]);

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
  const [showToast, setShowToast] = useState(false);
  const [toastMessage, setToastMessage] = useState('');
  const [toastType, setToastType] = useState<'success' | 'error'>('success');

  // Toast notification handler
  const displayToast = useCallback((message: string, type: 'success' | 'error' = 'success') => {
    setToastMessage(message);
    setToastType(type);
    setShowToast(true);
    setTimeout(() => setShowToast(false), 3000);
  }, []);

  // Keyboard shortcut handlers
  const handleOpenOrderPanel = useCallback((symbol: string, price: { bid: number; ask: number }) => {
    const requestedSymbol = normalizeSymbolName(symbol);
    const allowedSymbol = requestedSymbol ? getAllowedSymbol(requestedSymbol) : selectedSymbol;
    if (!allowedSymbol) return;
    setOrderPanelOpen(prev => {
      if (prev) return false;
      setOrderPanelSymbol(allowedSymbol);
      setOrderPanelPrice(price);
      return true;
    });
  }, [getAllowedSymbol, selectedSymbol]);

  const handleQuickBuy = useCallback(() => {
    if (selectedSymbol && !orderLoading) {
      placeOrder('BUY');
    }
  }, [selectedSymbol, orderLoading, placeOrder]);

  const handleQuickSell = useCallback(() => {
    if (selectedSymbol && !orderLoading) {
      placeOrder('SELL');
    }
  }, [selectedSymbol, orderLoading, placeOrder]);

  const handleOpenDOM = useCallback((symbolOrEvent: string | CustomEvent) => {
    const requestedSymbol = typeof symbolOrEvent === 'string'
      ? symbolOrEvent 
      : (symbolOrEvent.detail?.symbol || selectedSymbol);
    const hasRequestedSymbol = Boolean(normalizeSymbolName(requestedSymbol));
    const symbol = hasRequestedSymbol ? getAllowedSymbol(requestedSymbol) : selectedSymbol;
    if (!symbol) return;
    
    if (showDOM && domSymbol === symbol) {
      setShowDOM(false);
    } else {
      setDomSymbol(symbol);
      setDomPos({ x: 620, y: 56 }); // Enforce fixed MT5 position
      setShowDOM(true);
    }
  }, [getAllowedSymbol, selectedSymbol, showDOM, domSymbol]);

  // Workspace handlers
  const handleSaveWorkspace = useCallback(() => {
    console.log('[App] Save workspace triggered');
    setShowSaveWorkspaceDialog(true);
  }, []);

  const handleConfirmSaveWorkspace = useCallback((workspaceName?: string) => {
    console.log('[App] Workspace saved:', workspaceName);
    setShowSaveWorkspaceDialog(false);
    displayToast(`Workspace "${workspaceName}" saved successfully!`, 'success');
  }, [displayToast]);

  const handleOpenDataFolder = useCallback(() => {
    console.log('[App] Open data folder');
    try {
      // Check if running in Electron environment
      if (window.electron?.shell) {
        window.electron.shell.openPath('./data');
      } else {
        // Fallback for web: Show info message
        const dataPath = window.location.origin + '/data';
        console.log('[App] Data folder location:', dataPath);
        // Create a temporary link to trigger download folder
        const link = document.createElement('a');
        link.href = dataPath;
        link.target = '_blank';
        link.click();
      }
    } catch (error) {
      console.error('[App] Failed to open data folder:', error);
    }
  }, []);

  const handlePrintChart = useCallback(async () => {
    console.log('[App] Print chart - Ctrl+P');
    try {
      // Import dynamically to avoid circular dependencies
      const { chartPrinter } = await import('./services/chartPrinter');

      // Try to capture the chart canvas
      const chartContainer = document.querySelector('.tv-lightweight-charts');
      let chartCanvas: HTMLCanvasElement | undefined;

      if (chartContainer) {
        const canvas = chartContainer.querySelector('canvas');
        if (canvas) {
          const copiedCanvas = document.createElement('canvas');
          copiedCanvas.width = canvas.width;
          copiedCanvas.height = canvas.height;
          const ctx = copiedCanvas.getContext('2d');
          if (ctx) {
            ctx.drawImage(canvas, 0, 0);
            chartCanvas = copiedCanvas;
          }
        }
      }

      const chartData = {
        symbol: selectedSymbol,
        timeframe: timeframe as string || 'M1',
        dateRange: {
          from: new Date(Date.now() - 24 * 60 * 60 * 1000),
          to: new Date(),
        },
        chartCanvas,
        indicators: [],
        drawings: [],
      };

      const preferences = chartPrinter.getPreferences();
      await chartPrinter.printChart(chartData, preferences);
    } catch (error) {
      console.error('[App] Failed to print:', error);
    }
  }, [selectedSymbol, timeframe]);

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
    const handlePrintChartEvent = () => handlePrintChart();
    const handleTileWindows = () => {
      console.log('[App] Tiling chart windows');
      useDockLayoutStore.getState().tileWindows();
    };

    // 2. Chart & Navigation Handlers
    const handleOpenChart = (e: CustomEvent) => {
      const symbol = getAllowedSymbol(e.detail?.symbol);
      if (!symbol) return;
      const newTab = e.detail?.newTab === true;
      const store = useDockLayoutStore.getState();
      const layout = store.layout;
      const currentTimeframe = timeframe;

      const findChartPanel = (container: any): any => {
        if (!container) return null;
        for (const child of (container.children || [])) {
          if (child.component === 'Chart') return child;
          if (child.children) {
            const found = findChartPanel(child);
            if (found) return found;
          }
        }
        return null;
      };

      const findActiveChartPanel = (container: any): any => {
        if (!container) return null;
        if (container.type === 'tabs') {
          const activeId = container.activeTab;
          const activeChild = (container.children || []).find((c: any) => c.id === activeId);
          if (activeChild?.component === 'Chart') return activeChild;
        }
        for (const child of (container.children || [])) {
          if (child.children) {
            const found = findActiveChartPanel(child);
            if (found) return found;
          }
        }
        return null;
      };

      if (newTab) {
        // MT5 behavior: If this symbol is already open as a chart tab, switch to it
        const findChartForSymbol = (container: any): any => {
          if (!container) return null;
          for (const child of (container.children || [])) {
            if (child.component === 'Chart' && child.props?.symbol === symbol) return child;
            if (child.children) {
              const found = findChartForSymbol(child);
              if (found) return found;
            }
          }
          return null;
        };
        const existingChart = findChartForSymbol(layout.root);
        if (existingChart) {
          // Switch to existing tab for this symbol
          const parent = store.layout;
          const findTabsContainer = (container: any): any => {
            if (!container) return null;
            if (container.type === 'tabs' && (container.children || []).some((c: any) => c.id === existingChart.id)) return container;
            for (const child of (container.children || [])) {
              if (child.children) {
                const found = findTabsContainer(child);
                if (found) return found;
              }
            }
            return null;
          };
          const tabsContainer = findTabsContainer(parent.root);
          if (tabsContainer) {
            store.setActiveTab(tabsContainer.id, existingChart.id);
          }
          setSelectedSymbol(symbol);
          window.dispatchEvent(new CustomEvent('chartSymbolChanged', { detail: { symbol } }));
          return;
        }
      } else {
        // newTab: false — just update the active chart
        const targetChart = findActiveChartPanel(layout.root) || findChartPanel(layout.root);
        if (targetChart) {
          store.updatePanelProps(targetChart.id, {
            props: { symbol, timeframe: currentTimeframe },
            title: `${symbol},${currentTimeframe}`,
          });
          setSelectedSymbol(symbol);
          window.dispatchEvent(new CustomEvent('chartSymbolChanged', { detail: { symbol } }));
          return;
        }
      }

      const findChartHostContainer = (container: any): any => {
        if (!container) return null;
        if (container.type === 'tabs' && (container.children || []).some((c: any) => c.component === 'Chart')) return container;
        for (const child of (container.children || [])) {
          if (child.children) {
            const found = findChartHostContainer(child);
            if (found) return found;
          }
        }
        return null;
      };

      const hostContainer = findChartHostContainer(layout.root);
      const activeChart = findActiveChartPanel(layout.root) || findChartPanel(layout.root);

      let targetId = hostContainer?.id;
      if (!targetId && activeChart) targetId = activeChart.id;
      if (!targetId) targetId = 'center-main';

      store.addPanel({
        id: `chart-${Date.now()}`,
        title: `${symbol},${currentTimeframe}`,
        component: 'Chart',
        props: { symbol, timeframe: currentTimeframe },
        closable: true,
        floatable: true,
        resizable: true,
      }, targetId, 'tab' as any);
      setSelectedSymbol(symbol);
    };

    const handleOpenOrderDialog = (e: CustomEvent) => {
      const requestedSymbol = normalizeSymbolName(e.detail?.symbol);
      const symbol = requestedSymbol ? getAllowedSymbol(requestedSymbol) : selectedSymbol;
      if (!symbol) return;
      const tick = useAppStore.getState().ticks[symbol];
      setOrderPanelSymbol(symbol);
      setOrderPanelPrice({ bid: tick?.bid || 0, ask: tick?.ask || 0 });
      setOrderPanelOpen(true);
    };

    const handleOpenNewOrder = () => {
      setOrderPanelOpen(prev => {
        if (prev) return false;
        const tick = useAppStore.getState().ticks[selectedSymbol];
        setOrderPanelSymbol(selectedSymbol);
        setOrderPanelPrice({ bid: tick?.bid || 0, ask: tick?.ask || 0 });
        return true;
      });
    };

    // 3. UI & Utility Handlers
    const handleToggleAccountPanel = () => setShowAccountPanel(prev => !prev);
    const handleLayoutUndo = () => useDockLayoutStore.getState().undo();
    const handleLayoutRedo = () => useDockLayoutStore.getState().redo();

    const handleChartSymbolChanged = (e: CustomEvent) => {
      const { symbol: sym, timeframe: tf } = e.detail || {};
      const allowedSymbol = getAllowedSymbol(sym);
      if (sym && allowedSymbol) setSelectedSymbol(allowedSymbol);
      if (tf) setTimeframe(tf);
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
      placeOrder(side);
    };

    const handleOpenChartProperties = (e: CustomEvent) => {
      setShowChartProperties(prev => {
        if (prev) return false;
        const { symbol } = e.detail || {};
        if (symbol) {
           setChartPropsSymbol(symbol);
        } else {
           setChartPropsSymbol(selectedSymbol);
        }
        setChartPropsTimeframe(timeframe);
        return true;
      });
    };

    // 4. Attach Listeners
    const handleOpenDataWindow = () => setShowDataWindow(prev => !prev);
    window.addEventListener('saveWorkspace', handleSaveWorkspaceEvent);
    window.addEventListener('openDataFolder', handleOpenDataFolderEvent);
    window.addEventListener('printChart', handlePrintChartEvent);
    window.addEventListener('tileWindows', handleTileWindows);
    window.addEventListener('openChart', handleOpenChart as EventListener);
    window.addEventListener('openOrderDialog', handleOpenOrderDialog as EventListener);
    window.addEventListener('openNewOrder', handleOpenNewOrder);
    window.addEventListener('openDepthOfMarket', handleOpenDOM as EventListener);
    window.addEventListener('openDataWindow', handleOpenDataWindow);
    window.addEventListener('openChartProperties', handleOpenChartProperties as EventListener);
    window.addEventListener('toggleAccountPanel', handleToggleAccountPanel);
    window.addEventListener('layout-undo', handleLayoutUndo);
    window.addEventListener('layout-redo', handleLayoutRedo);
    window.addEventListener('chartSymbolChanged', handleChartSymbolChanged as EventListener);
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
      window.removeEventListener('openOrderDialog', handleOpenOrderDialog as EventListener);
      window.removeEventListener('openNewOrder', handleOpenNewOrder);
      window.removeEventListener('openDepthOfMarket', handleOpenDOM as EventListener);
      window.removeEventListener('openDataWindow', handleOpenDataWindow);
      window.removeEventListener('openChartProperties', handleOpenChartProperties as EventListener);
      window.removeEventListener('toggleAccountPanel', handleToggleAccountPanel);
      window.removeEventListener('layout-undo', handleLayoutUndo);
      window.removeEventListener('layout-redo', handleLayoutRedo);
      window.removeEventListener('chartSymbolChanged', handleChartSymbolChanged as EventListener);
      window.removeEventListener('togglePanel', handleTogglePanel as EventListener);
      window.removeEventListener('change-timeframe', handleChangeTimeframe as EventListener);
      window.removeEventListener('change-chart-type', handleChangeChartType as EventListener);
      window.removeEventListener('quickTrade', handleQuickTrade as EventListener);
    };
  }, [
    selectedSymbol, timeframe, placeOrder, handleOpenDOM, 
    handleSaveWorkspace, handleOpenDataFolder, handlePrintChart, getAllowedSymbol
  ]);


  // Consolidated to main view - no extra dashboard routes needed
  // (Auth state handled via overlays below — no early returns needed)

  // Consumed by trading components
  // const currentTick = ticks[selectedSymbol];

  return (
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
        <div className="flex flex-col h-screen w-full bg-[#131316] text-zinc-300 overflow-hidden font-sans">
          {/* 1. Global Menu & Toolbar */}
          <TopToolbar
            chartType={chartType}
            timeframe={timeframe}
            onChartTypeChange={setChartType}
            onTimeframeChange={setTimeframe}
            symbol={selectedSymbol}
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
                      selectedSymbol={selectedSymbol}
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
                    minWidth: 180,
                    minHeight: 200,
                    borderRadius: 10,
                    boxShadow: '0 8px 32px rgba(0,0,0,0.7), 0 0 0 1px rgba(255,255,255,0.06)',
                    background: '#131316',
                  }}
                >
                  <DepthOfMarket
                    symbol={domSymbol}
                    onClose={() => setShowDOM(false)}
                    onCloseBulk={handleCloseBulk}
                    onDragHandleMouseDown={handleDomMouseDown}
                    onPlaceOrder={(side, price, vol) => {
                      setVolume(vol);
                      console.log(`DOM Order: ${side} ${vol} @ ${price}`);
                      placeOrder(side);
                    }}
                  />
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
                    minWidth: 180,
                    minHeight: 200,
                    overflow: 'hidden',
                  }}
                >
                  <DataWindow
                    onClose={() => setShowDataWindow(false)}
                    onDragHandleMouseDown={handleDataWindowMouseDown}
                  />
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
                <AccountPanel
                  onClose={() => setShowAccountPanel(false)}
                  wsConnection={wsRef.current}
                />
              )}
            </div>
          </div>

          {/* 4. Status Bar */}
          <StatusBar wsRef={wsRef} reconnectCallback={reconnectCallbackRef.current || undefined} />

          {/* OTA Update Banner (fixed overlay, top-right) */}
          <UpdateBanner />

          {/* Headless Components */}
          <AlertsContainer wsConnection={wsRef.current} />

          {/* Order Panel Dialog (F9) */}
          <OrderPanelDialog
            isOpen={orderPanelOpen}
            onClose={() => setOrderPanelOpen(false)}
            symbol={orderPanelSymbol || selectedSymbol}
            currentPrice={orderPanelPrice}
            onSubmitOrder={handleOrderPanelSubmit}
          />

          {/* Save Workspace Dialog (Ctrl+S) */}
          {showSaveWorkspaceDialog && (
            <SaveWorkspaceDialog
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
          )}

          {/* Toast Notification (Legacy - for workspace saves) */}
          {showToast && (
            <div className="fixed top-4 right-4 z-[300] animate-in slide-in-from-top-5 fade-in duration-200">
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
                  <span className="text-sm font-medium">{toastMessage}</span>
                </div>
              </div>
            </div>
          )}

          {/* Last Symbol Trading Panel */}
          {lastSymbolPanelVisible && <LastSymbolPanel />}

          {/* Notification Toast Container */}
          <ToastContainer notifications={activeToasts} />

          {/* Global Confirm Dialog */}
          <ConfirmDialog />

          {!isAuthenticated && !isAutoAuthenticating && (
            <WelcomeTerminal onLogin={handleLoginSuccess} />
          )}

          {/* Indicator Navigator (Insert > Indicators, toolbar button) */}
          <IndicatorNavigator
            isOpen={showIndicatorNavigator}
            onClose={() => setShowIndicatorNavigator(false)}
            initialCategory={indicatorNavCategory}
            onAddIndicator={(indicator: IndicatorInfo) => {
              commandBus.dispatch({
                type: 'ADD_INDICATOR',
                payload: { name: indicator.name, params: indicator.parameters ?? {} }
              });
              setShowIndicatorNavigator(false);
            }}
          />

          {/* Chart Properties Dialog (F8) */}
          <ChartPropertiesDialog
             isOpen={showChartProperties}
             onClose={() => setShowChartProperties(false)}
             symbol={chartPropsSymbol}
             timeframe={chartPropsTimeframe as Timeframe}
          />
        </div>
      </KeyboardShortcutProvider>

      {/* MT5-style post-login loading screen — covers UI while fetching account/positions/orders */}
      <BootstrapLoader />
    </CommandBusProvider>
  );
}

export default App;
