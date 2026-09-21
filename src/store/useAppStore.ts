/**
 * Global Application State Management using Zustand
 * Centralized state for trading application
 */

import { create } from 'zustand';
import { devtools, persist } from 'zustand/middleware';
import { useSystemJournalStore } from './useSystemJournalStore';
import { rememberTradeHistoryPositionLevels } from '../utils/tradeHistoryLevelCache';
import {
  commitBrokerAccountSessionScope,
  emitSessionChange,
  getCommittedBrokerAccountSessionScope,
} from '../services/brokerSession';
import {
  areCanonicalUpstreamTicksEqual,
  coalesceFreshestTickEntries,
  compareCanonicalTickFreshness,
} from '../utils/liveTickSemantics';

export interface Tick {
  symbol: string;
  bid: number;
  ask: number;
  spread: number;
  timestamp: number;
  sourceTimestamp?: number;
  lp?: string;
  prevBid?: number;
  prevAsk?: number;
  dailyChange?: number;
  high?: number;
  low?: number;
  high24h?: number;
  low24h?: number;
  volume?: number;
  last?: number;
  open?: number;
  close?: number;
  tickHistory?: number[]; // For tick chart
  digits?: number; // Decimal places for price formatting
  bidDirection?: 'up' | 'down' | 'none';
  askDirection?: 'up' | 'down' | 'none';
}

export type AppTickEntry = readonly [symbol: string, tick: Tick];

export interface Position {
  id: number;
  symbol: string;
  side: 'BUY' | 'SELL';
  volume: number;
  openPrice: number;
  currentPrice: number;
  openTime: string;
  sl: number;
  tp: number;
  swap: number;
  commission: number;
  unrealizedPnL: number;
  hasBackendProfit?: boolean;
  hasBackendCurrentPrice?: boolean;
  state_version?: string | number;
  state_version_text?: string;
  price_time_msc?: string | number;
  pnl_available?: boolean;
  comment?: string;
  // Backend wire-format aliases (snake_case). Optional — preserves existing defensive fallback logic.
  open_price?: number;
  price_open?: number;
  current_price?: number;
  price_current?: number;
  unrealized_pl?: number;
  profit?: number;
  quantity?: number;
  time_create?: string;
  open_time?: string;
  time?: string | number;
  time_update?: string;
  chartEntryPrice?: number;
  chartEntryTime?: string;
}

export const RECENT_OPEN_POSITION_RETENTION_MS = 30_000;

export const isRecentlyAdmittedOpenPosition = (position: Position, now = Date.now()): boolean => {
  const admittedAt = Date.parse(String(position.chartEntryTime ?? ''));
  if (!Number.isFinite(admittedAt)) return false;
  const ageMs = now - admittedAt;
  return ageMs >= 0 && ageMs <= RECENT_OPEN_POSITION_RETENTION_MS;
};

export const shouldReplaceOpenPositionSnapshot = (
  incoming: readonly Position[],
  current: readonly Position[],
  now = Date.now(),
): boolean => (
  incoming.length > 0
  || !current.some((position) => isRecentlyAdmittedOpenPosition(position, now))
);

const isRenderableOpenPosition = (position: Pick<Position, 'symbol' | 'volume' | 'quantity'>): boolean => (
  Boolean(String(position.symbol ?? '').trim())
  && Number(position.volume ?? position.quantity ?? 0) > 0
);

export interface Order {
  id: string;
  symbol: string;
  type: 'LIMIT' | 'STOP' | 'STOP_LIMIT';
  side: 'BUY' | 'SELL';
  volume: number;
  price: number;
  triggerPrice?: number;
  sl?: number;
  tp?: number;
  status: 'PENDING' | 'TRIGGERED' | 'FILLED' | 'CANCELLED';
  createdAt: string;
}

export interface Account {
  balance: number;
  equity: number;
  margin: number;
  freeMargin: number;
  unrealizedPL: number;
  marginLevel: number;
  credit?: number;
  hasBackendBalance?: boolean;
  hasBackendMargin?: boolean;
  hasBackendUnrealizedPL?: boolean;
  hasBackendCredit?: boolean;
  hasBackendEquity?: boolean;
  hasBackendFreeMargin?: boolean;
  hasBackendMarginLevel?: boolean;
  currency: string;
  leverage: number;
}

export interface Trade {
  id: number;
  symbol: string;
  type: string;
  side: string;
  volume: number;
  openPrice: number;
  closePrice?: number;
  openTime: string;
  closeTime?: string;
  profit: number;
  commission: number;
  swap: number;
  sl?: number;
  tp?: number;
  status?: string;
  positionId?: number;
  orderTicket?: number;
  dealTicket?: number;
  entry?: string;
  historySource?: 'closed-position' | 'deal' | 'order';
}

export interface SavedAccount {
  login: number;
  name: string;
  server: string;
  isLive: boolean;
  lastUsed?: number;
}

export interface TradeApiStatus {
  loading: boolean;
  error: string | null;
  lastUpdated: number | null;
  lastStartedAt: number | null;
}

interface AppState {
  // Authentication
  isAuthenticated: boolean;
  accountId: string | null;
  authToken: string | null;
  refreshToken: string | null;
  tokenExpiresAt: number | null;
  isRefreshing: boolean;

  // Market Data
  ticks: Record<string, Tick>;
  tickLookup: Record<string, string>;
  selectedSymbol: string;

  // Trading
  positions: Position[];
  orders: Order[];
  trades: Trade[];

  // Account
  account: Account | null;
  savedAccounts: SavedAccount[];

  // UI State
  isChartMaximized: boolean;
  chartType: 'candlestick' | 'line' | 'area';
  timeframe: '1m' | '5m' | '15m' | '1h' | '4h' | '1d';
  orderVolume: number;

  // WebSocket
  wsConnected: boolean;

  // Trade API REST lifecycle
  tradeApiStatus: TradeApiStatus;

  // Loading States
  isLoadingAccount: boolean;
  isLoadingPositions: boolean;
  isPlacingOrder: boolean;

  // Bootstrap (MT5-style post-login data loading)
  isBootstrapping: boolean;
  bootstrapStep: string;

  // Actions
  setAuthenticated: (
    isAuth: boolean,
    accountId?: string,
    authToken?: string,
    refreshToken?: string,
    expiresAt?: number,
    savedAccount?: SavedAccount,
  ) => void;
  setAuthTokens: (authToken: string, refreshToken?: string, expiresAt?: number) => void;
  setIsRefreshing: (isRefreshing: boolean) => void;
  setAuthToken: (token: string | null) => void;
  clearAuth: () => void;
  logout: () => void;
  setTick: (symbol: string, tick: Tick) => void;
  setTicksBatch: (ticks: readonly AppTickEntry[]) => void;
  setTicks: (ticks: Record<string, Tick>) => void;
  setSelectedSymbol: (symbol: string) => void;
  setPositions: (positions: Position[]) => void;
  setOrders: (orders: Order[]) => void;
  setTrades: (trades: Trade[]) => void;
  setAccount: (account: Account | null) => void;
  addSavedAccount: (account: SavedAccount) => void;
  removeSavedAccount: (login: number) => void;
  setActiveAccount: (login: number) => void;
  setChartMaximized: (isMaximized: boolean) => void;
  setChartType: (type: 'candlestick' | 'line' | 'area') => void;
  setTimeframe: (tf: '1m' | '5m' | '15m' | '1h' | '4h' | '1d') => void;
  setOrderVolume: (volume: number) => void;
  setWsConnected: (connected: boolean) => void;
  setTradeApiStatus: (status: Partial<TradeApiStatus>) => void;
  setLoadingStates: (states: Partial<{
    isLoadingAccount: boolean;
    isLoadingPositions: boolean;
    isPlacingOrder: boolean;
  }>) => void;
  setBootstrapping: (isBootstrapping: boolean, step?: string) => void;
  reset: () => void;
}

const initialState = {
  isAuthenticated: false,
  accountId: null,
  authToken: null,
  refreshToken: null,
  tokenExpiresAt: null,
  isRefreshing: false,
  ticks: {},
  tickLookup: {},
  selectedSymbol: '',
  positions: [],
  orders: [],
  trades: [],
  account: null,
  savedAccounts: [],
  isChartMaximized: false,
  chartType: 'candlestick' as const,
  timeframe: '1m' as const,
  orderVolume: 0.01,
  wsConnected: false,
  tradeApiStatus: {
    loading: false,
    error: null,
    lastUpdated: null,
    lastStartedAt: null,
  },
  isLoadingAccount: false,
  isLoadingPositions: false,
  isPlacingOrder: false,
  isBootstrapping: false,
  bootstrapStep: '',
};

const CREDENTIAL_STORAGE_KEYS = [
  'mt5_credentials',
  'mt5_auto_login',
  'rtx_saved_password',
];

const clearLegacyCredentialStorage = () => {
  if (typeof window === 'undefined') return;
  CREDENTIAL_STORAGE_KEYS.forEach((key) => localStorage.removeItem(key));
};

const dispatchAuthTokenUpdated = () => {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new Event('auth:token-updated'));
};

const sanitizeSavedAccount = (account: SavedAccount | (SavedAccount & { password?: unknown })): SavedAccount | null => {
  if (!account || typeof account !== 'object') return null;
  const { password: _password, ...safeAccount } = account as SavedAccount & { password?: unknown };
  return safeAccount;
};

const sanitizeSavedAccounts = (accounts: unknown): SavedAccount[] => {
  if (!Array.isArray(accounts)) return [];
  return accounts
    .map((account) => sanitizeSavedAccount(account as SavedAccount & { password?: unknown }))
    .filter((account): account is SavedAccount => account !== null);
};

clearLegacyCredentialStorage();

export const normalizeTickLookupKey = (symbol: string | undefined | null): string => (
  String(symbol || '').trim().toUpperCase()
);

export const getTickBaseLookupKey = (symbol: string | undefined | null): string => (
  normalizeTickLookupKey(symbol).split('.')[0]
);

const buildTickLookup = (ticks: Record<string, Tick>): Record<string, string> => {
  const lookup: Record<string, string> = {};

  Object.entries(ticks).forEach(([storeSymbol, tick]) => {
    const normalizedStoreSymbol = normalizeTickLookupKey(storeSymbol);
    const normalizedTickSymbol = normalizeTickLookupKey(tick?.symbol);
    const baseSymbol = getTickBaseLookupKey(normalizedStoreSymbol || normalizedTickSymbol);
    if (!normalizedStoreSymbol && !normalizedTickSymbol) return;

    if (normalizedStoreSymbol) lookup[normalizedStoreSymbol] = storeSymbol;
    if (normalizedTickSymbol) lookup[normalizedTickSymbol] = storeSymbol;

    const currentBaseKey = lookup[baseSymbol];
    const currentBaseTick = currentBaseKey ? ticks[currentBaseKey] : undefined;
    if (baseSymbol && (!currentBaseTick || compareCanonicalTickFreshness(currentBaseTick, tick) > 0)) {
      lookup[baseSymbol] = storeSymbol;
    }
  });

  return lookup;
};

const updateTickLookup = (
  currentLookup: Record<string, string>,
  currentTicks: Record<string, Tick>,
  storeSymbol: string,
  tick: Tick,
  previousLookup: Record<string, string>,
): Record<string, string> => {
  const normalizedStoreSymbol = normalizeTickLookupKey(storeSymbol);
  const normalizedTickSymbol = normalizeTickLookupKey(tick?.symbol);
  const baseSymbol = getTickBaseLookupKey(normalizedStoreSymbol || normalizedTickSymbol);
  if (!normalizedStoreSymbol && !normalizedTickSymbol) return currentLookup;

  let nextLookup = currentLookup;
  const setLookup = (key: string, value: string) => {
    if (nextLookup[key] === value) return;
    // One batch owns one copy. Cloning the growing dictionary for every new
    // symbol makes the initial catalog quote batch quadratic.
    if (nextLookup === previousLookup) nextLookup = { ...previousLookup };
    nextLookup[key] = value;
  };

  if (normalizedStoreSymbol) setLookup(normalizedStoreSymbol, storeSymbol);
  if (normalizedTickSymbol) setLookup(normalizedTickSymbol, storeSymbol);

  const currentBaseKey = baseSymbol ? nextLookup[baseSymbol] : undefined;
  const currentBaseTick = currentBaseKey ? currentTicks[currentBaseKey] : undefined;
  // Equal-time aliases retain the existing base owner so iteration order does
  // not make an unsuffixed lookup flap between broker suffixes.
  if (baseSymbol && (!currentBaseTick || compareCanonicalTickFreshness(currentBaseTick, tick) > 0)) {
    setLookup(baseSymbol, storeSymbol);
  }

  return nextLookup;
};

const upsertSavedAccount = (accounts: unknown, account: SavedAccount): SavedAccount[] => {
  const retained = sanitizeSavedAccounts(accounts);
  const safeAccount = sanitizeSavedAccount(account);
  if (!safeAccount) return retained;

  const nextAccount = { ...safeAccount, lastUsed: Date.now() };
  const existingIndex = retained.findIndex((candidate) => candidate.login === safeAccount.login);
  if (existingIndex < 0) return [...retained, nextAccount];

  return retained.map((candidate, index) => (
    index === existingIndex ? { ...candidate, ...nextAccount } : candidate
  ));
};

const applyAppTickBatch = (
  state: AppState,
  entries: readonly AppTickEntry[],
): AppState | Pick<AppState, 'ticks' | 'tickLookup'> => {
  const latestTicks = coalesceFreshestTickEntries(entries, (symbol, error) => {
    console.error(`[AppStore] Ignoring invalid tick for ${symbol}:`, error);
  });

  let nextTicks = state.ticks;
  let nextLookup = state.tickLookup;
  let changed = false;

  latestTicks.forEach(([symbol, tick]) => {
    const prevTick = nextTicks[symbol];
    const candidate: Tick = { ...tick };
    if (candidate.dailyChange === undefined && prevTick?.dailyChange !== undefined) {
      candidate.dailyChange = prevTick.dailyChange;
    }
    if (candidate.high24h === undefined && prevTick?.high24h !== undefined) {
      candidate.high24h = prevTick.high24h;
    }
    if (candidate.low24h === undefined && prevTick?.low24h !== undefined) {
      candidate.low24h = prevTick.low24h;
    }
    if (candidate.high === undefined && prevTick?.high !== undefined) {
      candidate.high = prevTick.high;
    }
    if (candidate.low === undefined && prevTick?.low !== undefined) {
      candidate.low = prevTick.low;
    }
    if (candidate.lp === undefined && prevTick?.lp !== undefined) {
      candidate.lp = prevTick.lp;
    }
    if (candidate.volume === undefined && prevTick?.volume !== undefined) {
      candidate.volume = prevTick.volume;
    }
    if (candidate.last === undefined && prevTick?.last !== undefined) {
      candidate.last = prevTick.last;
    }
    if (candidate.open === undefined && prevTick?.open !== undefined) {
      candidate.open = prevTick.open;
    }
    if (candidate.close === undefined && prevTick?.close !== undefined) {
      candidate.close = prevTick.close;
    }
    if (candidate.digits === undefined && prevTick?.digits !== undefined) {
      candidate.digits = prevTick.digits;
    }

    const freshness = prevTick ? compareCanonicalTickFreshness(prevTick, candidate) : 1;
    if (freshness < 0) return;
    if (freshness === 0 && areCanonicalUpstreamTicksEqual(prevTick, candidate)) return;

    // A same-time payload is a correction, not another chronological tick.
    // Its direction remains anchored to the last strictly older event.
    const previousBid = freshness === 0 ? prevTick?.prevBid : prevTick?.bid;
    const previousAsk = freshness === 0 ? prevTick?.prevAsk : prevTick?.ask;
    const bidDirection: 'up' | 'down' | 'none' = previousBid === undefined
      ? 'none'
      : candidate.bid > previousBid ? 'up' : candidate.bid < previousBid ? 'down' : 'none';
    const askDirection: 'up' | 'down' | 'none' = previousAsk === undefined
      ? 'none'
      : candidate.ask > previousAsk ? 'up' : candidate.ask < previousAsk ? 'down' : 'none';

    const nextTick: Tick = {
      ...candidate,
      prevBid: previousBid,
      prevAsk: previousAsk,
      bidDirection,
      askDirection,
    };

    if (!changed) nextTicks = { ...state.ticks };
    nextTicks[symbol] = nextTick;
    nextLookup = updateTickLookup(nextLookup, nextTicks, symbol, nextTick, state.tickLookup);
    changed = true;
  });

  return changed ? { ticks: nextTicks, tickLookup: nextLookup } : state;
};

export const selectTickCount = (state: { ticks: Record<string, Tick> }): number => (
  Object.keys(state.ticks).length
);

export const resolveTickFromLookup = (
  ticks: Record<string, Tick>,
  tickLookup: Record<string, string>,
  symbol: string,
): Tick | undefined => {
  const rawSymbol = symbol || '';
  const normalizedSymbol = normalizeTickLookupKey(rawSymbol);
  if (!normalizedSymbol) return undefined;

  const exact = ticks[normalizedSymbol] || ticks[rawSymbol];
  if (exact) return exact;

  // FIX: Stream/execution lookup is exact. A base-symbol fallback can price a
  // position or order for XAUUSD with XAUUSD.raw (or another broker contract).
  const lookupKey = tickLookup[normalizedSymbol];
  const lookupTick = lookupKey ? ticks[lookupKey] : undefined;
  if (!lookupTick) return undefined;
  return normalizeTickLookupKey(lookupKey) === normalizedSymbol
    || normalizeTickLookupKey(lookupTick.symbol) === normalizedSymbol
    ? lookupTick
    : undefined;
};

export const useAppStore = create<AppState>()(
  devtools(
    persist(
      (set) => ({
        ...initialState,

        setAuthenticated: (isAuth, accountId, authToken, refreshToken, expiresAt, savedAccount) => {
          if (isAuth && accountId) {
            // Log successful login to system journal
            useSystemJournalStore.getState().addLog('System', `Login to RTX5 as account ${accountId}`);
          }

          let sessionChangeReason: 'login' | 'account_change' | null = null;
          set((state) => {
            const nextAccountId = accountId || null;
            const authenticatedSessionChanged = isAuth && (
              !state.isAuthenticated
              || state.accountId !== nextAccountId
            );
            // FIX: Account identity is part of market-data ownership even when
            // broker URL and authentication boolean do not change.
            if (authenticatedSessionChanged) {
              sessionChangeReason = state.isAuthenticated ? 'account_change' : 'login';
            }

            return {
              isAuthenticated: isAuth,
              accountId: nextAccountId,
              authToken: authToken || null,
              refreshToken: refreshToken || null,
              tokenExpiresAt: expiresAt || null,
              ...(authenticatedSessionChanged ? {
                account: null,
                positions: [],
                orders: [],
                trades: [],
              } : {}),
              ...(savedAccount ? { savedAccounts: upsertSavedAccount(state.savedAccounts, savedAccount) } : {}),
            };
          });
          commitBrokerAccountSessionScope({
            authenticated: isAuth,
            accountId: accountId || null,
          });
          if (sessionChangeReason) emitSessionChange(sessionChangeReason);
        },

        setAuthTokens: (authToken, refreshToken, expiresAt) => {
          let tokenRotated = false;
          // Write to localStorage so the API client (which reads from localStorage) picks up the new token
          if (typeof window !== 'undefined') {
            if (authToken) localStorage.setItem('auth_token', authToken);
            if (refreshToken) localStorage.setItem('refresh_token', refreshToken);
            if (expiresAt) localStorage.setItem('token_expires_at', new Date(expiresAt).toISOString());
            dispatchAuthTokenUpdated();
          }
          set((state) => {
            tokenRotated = state.authToken !== authToken;
            return {
              authToken,
              refreshToken: refreshToken !== undefined ? refreshToken : state.refreshToken,
              tokenExpiresAt: expiresAt !== undefined ? expiresAt : state.tokenExpiresAt
            };
          });
          // FIX: Token refresh must rotate every socket, not only notify API
          // consumers through the browser event.
          if (tokenRotated) emitSessionChange('token_rotation');
        },

        setIsRefreshing: (isRefreshing) => set({ isRefreshing }),

        setAuthToken: (token) => {
          const previousToken = useAppStore.getState().authToken;
          if (typeof window !== 'undefined') {
            if (token) {
              localStorage.setItem('auth_token', token);
            } else {
              localStorage.removeItem('auth_token');
            }
            dispatchAuthTokenUpdated();
          }
          set({ authToken: token });
          // FIX: The single-token setter participates in the same socket
          // credential lifecycle as the full refresh-token setter.
          if (previousToken !== token) emitSessionChange(token ? 'token_rotation' : 'logout');
        },

        clearAuth: () => {
          if (typeof window !== 'undefined') {
            localStorage.removeItem('auth_token');
            localStorage.removeItem('refresh_token');
            localStorage.removeItem('token_expires_at');
            sessionStorage.removeItem('auth_token');
            sessionStorage.removeItem('refresh_token');
            sessionStorage.removeItem('token_expires_at');
          }
          set({ isAuthenticated: false, accountId: null, authToken: null, refreshToken: null, tokenExpiresAt: null });
          commitBrokerAccountSessionScope({ authenticated: false, accountId: null });
          dispatchAuthTokenUpdated();
          // FIX: ClearAuth is a full session boundary and must invalidate all
          // broker-owned sockets and quote/candle caches.
          emitSessionChange('logout');
        },

        logout: () => {
          // Clear local storage items related to auth session only
          if (typeof window !== 'undefined') {
            localStorage.removeItem('auth_token');
            localStorage.removeItem('refresh_token');
            localStorage.removeItem('token_expires_at');
            sessionStorage.removeItem('auth_token');
            sessionStorage.removeItem('refresh_token');
            sessionStorage.removeItem('token_expires_at');
            localStorage.removeItem('rtx_user');
            localStorage.removeItem('rtx_last_login');
            localStorage.removeItem('rtx_saved_username');
            localStorage.removeItem('rtx_saved_password');
            localStorage.removeItem('feed_broker_token');
            localStorage.removeItem('broker_feed_token');
            localStorage.removeItem('feed_token');
            localStorage.removeItem('ws_feed_token');
            localStorage.removeItem('feed_broker_id');
            sessionStorage.removeItem('feed_broker_token');
            sessionStorage.removeItem('broker_feed_token');
            sessionStorage.removeItem('feed_token');
            sessionStorage.removeItem('ws_feed_token');
            sessionStorage.removeItem('feed_broker_id');
            // NOTE: Do NOT remove 'trading-app-storage' — it holds savedAccounts
          }
          // Reset auth state but KEEP savedAccounts for multi-account switching
          set({
            isAuthenticated: false,
            accountId: null,
            authToken: null,
            refreshToken: null,
            tokenExpiresAt: null,
            account: null,
            positions: [],
            orders: [],
            trades: [],
            tradeApiStatus: initialState.tradeApiStatus,
            // savedAccounts intentionally NOT cleared — they persist across logout
          });
          commitBrokerAccountSessionScope({ authenticated: false, accountId: null });
          dispatchAuthTokenUpdated();
          emitSessionChange('logout');
        },

        setTick: (symbol, tick) => set((state) => applyAppTickBatch(state, [[symbol, tick]])),

        setTicksBatch: (ticks) => set((state) => applyAppTickBatch(state, ticks)),

        setTicks: (ticks) => set({ ticks, tickLookup: buildTickLookup(ticks) }),

        setSelectedSymbol: (symbol) => set({ selectedSymbol: symbol }),

        setPositions: (positions) =>
          set((state) => {
            // Position streams can update on every tick. Index once so a burst
            // of filled orders merges in O(n), instead of doing an O(n) find
            // for every incoming row and blocking the next Buy/Sell click.
            const existingById = new Map(state.positions.map((position) => [position.id, position]));
            const nextPositions = positions.flatMap((incoming): Position[] => {
              const existing = existingById.get(incoming.id);
              if (!existing) {
                // Price/P&L deltas can arrive before the authoritative open-
                // position snapshot. Do not expose those sparse records as
                // blank rows; admit the ticket once symbol and volume exist.
                const incomingId = Number(incoming.id);
                const incomingSymbol = String(incoming.symbol ?? '').trim();
                const incomingVol = Number(incoming.volume ?? incoming.quantity ?? 0);
                if (
                  !Number.isFinite(incomingId)
                  || incomingId <= 0
                  || !incomingSymbol
                  || !Number.isFinite(incomingVol)
                  || incomingVol <= 0
                ) {
                  return [];
                }
                return [incoming];
              }

              // A full update always has non-zero openPrice/open_price and volume/quantity.
              const incomingOpen = Number(incoming.openPrice ?? incoming.open_price ?? 0);
              const incomingVol = Number(incoming.volume ?? incoming.quantity ?? 0);
              const isFullUpdate = incomingOpen > 0 && incomingVol > 0;

              if (isFullUpdate) {
                return [{
                  ...existing,
                  ...incoming,
                  symbol: incoming.symbol || existing.symbol,
                  chartEntryPrice: incoming.chartEntryPrice ?? existing.chartEntryPrice,
                  chartEntryTime: incoming.chartEntryTime ?? existing.chartEntryTime,
                }];
              } else {
                // Partial P&L or quote updates — preserve all other existing properties!
                return [{
                  ...existing,
                  currentPrice: Number(incoming.currentPrice ?? incoming.current_price ?? 0) > 0
                    ? Number(incoming.currentPrice ?? incoming.current_price)
                    : existing.currentPrice,
                  current_price: Number(incoming.currentPrice ?? incoming.current_price ?? 0) > 0
                    ? Number(incoming.currentPrice ?? incoming.current_price)
                    : existing.current_price,
                  unrealizedPnL: incoming.unrealizedPnL !== undefined
                    ? Number(incoming.unrealizedPnL)
                    : (incoming.profit !== undefined ? Number(incoming.profit) : existing.unrealizedPnL),
                  unrealized_pl: incoming.unrealized_pl !== undefined
                    ? Number(incoming.unrealized_pl)
                    : (incoming.profit !== undefined ? Number(incoming.profit) : existing.unrealized_pl),
                  profit: incoming.profit !== undefined ? Number(incoming.profit) : existing.profit,
                  time_update: incoming.time_update || existing.time_update,
                  time_create: incoming.time_create || existing.time_create,
                }];
              }
            });

            rememberTradeHistoryPositionLevels(nextPositions, state.accountId);

            // A lagged REST/WS snapshot can omit a fill that the click path
            // already admitted. Keep that ticket on the chart and in Trade
            // until the broker snapshot catches up or the short retention ends.
            const now = Date.now();
            const nextIds = new Set(nextPositions.map((position) => position.id));
            for (const existing of state.positions) {
              if (nextIds.has(existing.id)) continue;
              if (!isRenderableOpenPosition(existing) || !isRecentlyAdmittedOpenPosition(existing, now)) continue;
              nextPositions.push(existing);
              nextIds.add(existing.id);
            }

            return { positions: nextPositions };
          }),

        setOrders: (orders) => set({ orders }),

        setTrades: (trades) => set({ trades }),

        setAccount: (account) => set({ account }),

        addSavedAccount: (account) =>
          set((state) => ({ savedAccounts: upsertSavedAccount(state.savedAccounts, account) })),

        removeSavedAccount: (login) =>
          set((state) => ({
            savedAccounts: state.savedAccounts.filter((a) => a.login !== login)
          })),

        setActiveAccount: (login) => {
          let accountChanged = false;
          let sessionAuthenticated = false;
          set((state) => {
            const nextAccountId = login.toString();
            accountChanged = state.accountId !== nextAccountId;
            sessionAuthenticated = state.isAuthenticated;
            return {
              accountId: nextAccountId,
              ...(accountChanged ? {
                account: null,
                positions: [],
                orders: [],
                trades: [],
              } : {}),
              savedAccounts: state.savedAccounts.map((a) =>
                a.login === login ? { ...a, lastUsed: Date.now() } : a
              )
            };
          });
          const committedScope = getCommittedBrokerAccountSessionScope();
          commitBrokerAccountSessionScope({
            // FIX: The live store is authoritative here. A stale committed
            // scope must not turn an unauthenticated account selection into a
            // ghost authenticated session.
            authenticated: sessionAuthenticated,
            accountId: sessionAuthenticated ? login.toString() : null,
            brokerId: committedScope.brokerId,
            serverUrl: committedScope.serverUrl,
          });
          // FIX: Notify sockets only after both Zustand and the committed
          // broker/account scope own the new login, and only for a real
          // authenticated identity change. Re-selecting the same account is
          // intentionally silent so it cannot create duplicate reconnects.
          if (accountChanged && sessionAuthenticated) emitSessionChange('account_change');
        },

        setChartMaximized: (isMaximized) => set({ isChartMaximized: isMaximized }),

        setChartType: (type) => set({ chartType: type }),

        setTimeframe: (tf) => set({ timeframe: tf }),

        setOrderVolume: (volume) => set({ orderVolume: volume }),

        setWsConnected: (connected) => set({ wsConnected: connected }),

        setTradeApiStatus: (status) =>
          set((state) => ({
            tradeApiStatus: {
              ...state.tradeApiStatus,
              ...status,
            },
          })),

        setLoadingStates: (states) => set(states),

        setBootstrapping: (isBootstrapping, step = '') =>
          set({ isBootstrapping, bootstrapStep: isBootstrapping ? step : '' }),

        reset: () => set(initialState),
      }),
      {
        name: 'trading-app-storage',
        partialize: (state) => ({
          // ⚠️  isAuthenticated intentionally NOT persisted.
          //     It must always start as false and only become true after
          //     a valid server-side auth check on each app launch.
          accountId: state.accountId,
          selectedSymbol: state.selectedSymbol,
          chartType: state.chartType,
          timeframe: state.timeframe,
          orderVolume: state.orderVolume,
        }),
        merge: (persistedState, currentState) => {
          const persisted = persistedState as Partial<AppState> | undefined;
          clearLegacyCredentialStorage();
          return {
            ...currentState,
            ...persisted,
            savedAccounts: [],
          };
        },
      }
    )
  )
);
// Selector for a single tick
export const useTick = (symbol: string) => useAppStore((state) => {
  return resolveTickFromLookup(state.ticks, state.tickLookup, symbol);
});
