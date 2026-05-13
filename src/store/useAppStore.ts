/**
 * Global Application State Management using Zustand
 * Centralized state for trading application
 */

import { create } from 'zustand';
import { devtools, persist } from 'zustand/middleware';
import { useSystemJournalStore } from './useSystemJournalStore';

export interface Tick {
  symbol: string;
  bid: number;
  ask: number;
  spread: number;
  timestamp: number;
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
}

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
}

export interface SavedAccount {
  login: number;
  name: string;
  server: string;
  isLive: boolean;
  lastUsed?: number;
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

  // Loading States
  isLoadingAccount: boolean;
  isLoadingPositions: boolean;
  isPlacingOrder: boolean;

  // Actions
  setAuthenticated: (isAuth: boolean, accountId?: string, authToken?: string, refreshToken?: string, expiresAt?: number) => void;
  setAuthTokens: (authToken: string, refreshToken?: string, expiresAt?: number) => void;
  setIsRefreshing: (isRefreshing: boolean) => void;
  setAuthToken: (token: string | null) => void;
  clearAuth: () => void;
  logout: () => void;
  setTick: (symbol: string, tick: Tick) => void;
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
  setLoadingStates: (states: Partial<{
    isLoadingAccount: boolean;
    isLoadingPositions: boolean;
    isPlacingOrder: boolean;
  }>) => void;
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
  isLoadingAccount: false,
  isLoadingPositions: false,
  isPlacingOrder: false,
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

export const useAppStore = create<AppState>()(
  devtools(
    persist(
      (set) => ({
        ...initialState,

        setAuthenticated: (isAuth, accountId, authToken, refreshToken, expiresAt) => {
          if (isAuth && accountId) {
            // Log successful login to system journal
            useSystemJournalStore.getState().addLog('System', `Login to RTX5 as account ${accountId}`);
          }

          set({
            isAuthenticated: isAuth,
            accountId: accountId || null,
            authToken: authToken || null,
            refreshToken: refreshToken || null,
            tokenExpiresAt: expiresAt || null
          });
        },

        setAuthTokens: (authToken, refreshToken, expiresAt) => {
          // Write to localStorage so the API client (which reads from localStorage) picks up the new token
          if (typeof window !== 'undefined') {
            if (authToken) localStorage.setItem('auth_token', authToken);
            if (refreshToken) localStorage.setItem('refresh_token', refreshToken);
            if (expiresAt) localStorage.setItem('token_expires_at', new Date(expiresAt).toISOString());
          }
          set((state) => ({
            authToken,
            refreshToken: refreshToken !== undefined ? refreshToken : state.refreshToken,
            tokenExpiresAt: expiresAt !== undefined ? expiresAt : state.tokenExpiresAt
          }));
        },

        setIsRefreshing: (isRefreshing) => set({ isRefreshing }),

        setAuthToken: (token) =>
          set({ authToken: token }),

        clearAuth: () =>
          set({ isAuthenticated: false, accountId: null, authToken: null, refreshToken: null, tokenExpiresAt: null }),

        logout: () => {
          // Clear local storage items related to auth session only
          if (typeof window !== 'undefined') {
            localStorage.removeItem('auth_token');
            localStorage.removeItem('refresh_token');
            localStorage.removeItem('token_expires_at');
            localStorage.removeItem('rtx_user');
            localStorage.removeItem('rtx_last_login');
            localStorage.removeItem('rtx_saved_username');
            localStorage.removeItem('rtx_saved_password');
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
            // savedAccounts intentionally NOT cleared — they persist across logout
          });
        },

        setTick: (symbol, tick) =>
          set((state) => {
            const prevTick = state.ticks[symbol];
            let bidDirection: 'up' | 'down' | 'none' = prevTick?.bidDirection || 'none';
            if (prevTick && tick.bid > prevTick.bid) {
              bidDirection = 'up';
            } else if (prevTick && tick.bid < prevTick.bid) {
              bidDirection = 'down';
            }

            let askDirection: 'up' | 'down' | 'none' = prevTick?.askDirection || 'none';
            if (prevTick && tick.ask > prevTick.ask) {
              askDirection = 'up';
            } else if (prevTick && tick.ask < prevTick.ask) {
              askDirection = 'down';
            }

            return {
              ticks: {
                ...state.ticks,
                [symbol]: {
                  // Preserve daily/high/low fields from previous tick if new tick doesn't include them
                  // (broker often sends price-only ticks without dailyChange)
                  dailyChange: prevTick?.dailyChange,
                  high24h:     prevTick?.high24h,
                  low24h:      prevTick?.low24h,
                  high:        prevTick?.high,
                  low:         prevTick?.low,
                  // New tick data overrides everything above
                  ...tick,
                  // Computed fields always override
                  prevBid: prevTick?.bid,
                  prevAsk: prevTick?.ask,
                  bidDirection,
                  askDirection,
                },
              },
            };
          }),

        setTicks: (ticks) => set({ ticks }),

        setSelectedSymbol: (symbol) => set({ selectedSymbol: symbol }),

        setPositions: (positions) => set({ positions }),

        setOrders: (orders) => set({ orders }),

        setTrades: (trades) => set({ trades }),

        setAccount: (account) => set({ account }),

        addSavedAccount: (account) =>
          set((state) => {
            const safeAccount = sanitizeSavedAccount(account);
            if (!safeAccount) return { savedAccounts: sanitizeSavedAccounts(state.savedAccounts) };
            const exists = state.savedAccounts.find((a) => a.login === safeAccount.login);
            if (exists) {
              return {
                savedAccounts: state.savedAccounts.map((a) =>
                  a.login === safeAccount.login ? { ...a, ...safeAccount, lastUsed: Date.now() } : a
                )
              };
            }
            return {
              savedAccounts: [...sanitizeSavedAccounts(state.savedAccounts), { ...safeAccount, lastUsed: Date.now() }]
            };
          }),

        removeSavedAccount: (login) =>
          set((state) => ({
            savedAccounts: state.savedAccounts.filter((a) => a.login !== login)
          })),

        setActiveAccount: (login) =>
          set((state) => ({
            accountId: login.toString(),
            savedAccounts: state.savedAccounts.map((a) =>
              a.login === login ? { ...a, lastUsed: Date.now() } : a
            )
          })),

        setChartMaximized: (isMaximized) => set({ isChartMaximized: isMaximized }),

        setChartType: (type) => set({ chartType: type }),

        setTimeframe: (tf) => set({ timeframe: tf }),

        setOrderVolume: (volume) => set({ orderVolume: volume }),

        setWsConnected: (connected) => set({ wsConnected: connected }),

        setLoadingStates: (states) => set(states),

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
          savedAccounts: sanitizeSavedAccounts(state.savedAccounts),
        }),
        merge: (persistedState, currentState) => {
          const persisted = persistedState as Partial<AppState> | undefined;
          clearLegacyCredentialStorage();
          return {
            ...currentState,
            ...persisted,
            savedAccounts: sanitizeSavedAccounts(persisted?.savedAccounts),
          };
        },
      }
    )
  )
);
// Selector for a single tick
export const useTick = (symbol: string) => useAppStore((state) => {
  const rawSymbol = symbol || '';
  const normalizedSymbol = rawSymbol.trim().toUpperCase();
  const baseSymbol = normalizedSymbol.split('.')[0];

  const exact = state.ticks[normalizedSymbol] || state.ticks[rawSymbol];
  if (exact) return exact;

  const exactCaseInsensitiveKey = Object.keys(state.ticks).find((key) => key.toLowerCase() === normalizedSymbol.toLowerCase());
  if (exactCaseInsensitiveKey) return state.ticks[exactCaseInsensitiveKey];

  // Choose freshest matching variant by timestamp instead of first key match.
  const candidates = Object.entries(state.ticks)
    .filter(([key]) => key.trim().toUpperCase().split('.')[0] === baseSymbol)
    .map(([, tick]) => tick)
    .filter(Boolean);

  if (candidates.length === 0) return undefined;

  return candidates.reduce((latest, current) => {
    const latestTs = Number(latest?.timestamp ?? 0);
    const currentTs = Number(current?.timestamp ?? 0);
    return currentTs >= latestTs ? current : latest;
  });
});
