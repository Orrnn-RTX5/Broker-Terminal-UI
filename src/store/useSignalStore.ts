/**
 * Signal Store with Zustand
 * Manages trading signals from signal providers
 */

import { create } from 'zustand';
import { devtools } from 'zustand/middleware';

export type SignalDirection = 'BUY' | 'SELL';
export type SignalStatus = 'new' | 'active' | 'closed';
export type SignalProvider = 'RTX5 Algo' | 'FX Maestro' | 'CryptoEdge';
export type SymbolGroup = 'All' | 'Forex' | 'Crypto' | 'Metals';

export interface Signal {
  id: string;
  provider: SignalProvider;
  symbol: string;
  symbolGroup: 'Forex' | 'Crypto' | 'Metals';
  direction: SignalDirection;
  entryPrice: number;
  stopLoss: number;
  takeProfit: number;
  confidence: number; // 0-100
  status: SignalStatus;
  timestamp: Date;
  analysis: string;
  indicators: string[];
  suggestedLotSize: number;
  timeframe: string;
  currentPrice?: number;
  closePrice?: number;
  closeTime?: Date;
  pnl?: number;
  duration?: number; // in minutes
}

export interface ProviderStats {
  provider: SignalProvider;
  winRate: number;
  totalSignals: number;
  avgPnLPerSignal: number;
  bestSignal: number;
  worstSignal: number;
  profitFactor: number;
}

interface SignalState {
  signals: Signal[];
  historicalSignals: Signal[];
  selectedProvider: SignalProvider | 'All';
  symbolGroupFilter: SymbolGroup;
  signalTypeFilter: 'All' | SignalDirection;
  timeframeFilter: string;
  autoRefresh: boolean;
  refreshInterval: number; // seconds

  setSelectedProvider: (provider: SignalProvider | 'All') => void;
  setSymbolGroupFilter: (group: SymbolGroup) => void;
  setSignalTypeFilter: (type: 'All' | SignalDirection) => void;
  setTimeframeFilter: (timeframe: string) => void;
  setAutoRefresh: (enabled: boolean) => void;
  setRefreshInterval: (seconds: number) => void;
  getFilteredSignals: () => Signal[];
  getProviderStats: (provider: SignalProvider) => ProviderStats;
  refreshSignals: () => void;
}

export const useSignalStore = create<SignalState>()(
  devtools(
    (set, get) => ({
      signals: [],
      historicalSignals: [],
      selectedProvider: 'All',
      symbolGroupFilter: 'All',
      signalTypeFilter: 'All',
      timeframeFilter: 'All',
      autoRefresh: true,
      refreshInterval: 30,

      setSelectedProvider: (provider) => set({ selectedProvider: provider }),
      setSymbolGroupFilter: (group) => set({ symbolGroupFilter: group }),
      setSignalTypeFilter: (type) => set({ signalTypeFilter: type }),
      setTimeframeFilter: (timeframe) => set({ timeframeFilter: timeframe }),
      setAutoRefresh: (enabled) => set({ autoRefresh: enabled }),
      setRefreshInterval: (seconds) => set({ refreshInterval: seconds }),

      getFilteredSignals: () => {
        const state = get();
        let filtered = state.signals;

        if (state.selectedProvider !== 'All') {
          filtered = filtered.filter((s) => s.provider === state.selectedProvider);
        }

        if (state.symbolGroupFilter !== 'All') {
          filtered = filtered.filter((s) => s.symbolGroup === state.symbolGroupFilter);
        }

        if (state.signalTypeFilter !== 'All') {
          filtered = filtered.filter((s) => s.direction === state.signalTypeFilter);
        }

        if (state.timeframeFilter !== 'All') {
          filtered = filtered.filter((s) => s.timeframe === state.timeframeFilter);
        }

        return filtered;
      },

      getProviderStats: (provider) => {
        const state = get();
        const providerSignals = state.historicalSignals.filter((s) => s.provider === provider);

        const winningSignals = providerSignals.filter((s) => s.pnl && s.pnl > 0);
        const losingSignals = providerSignals.filter((s) => s.pnl && s.pnl <= 0);

        const winRate = providerSignals.length > 0
          ? (winningSignals.length / providerSignals.length) * 100
          : 0;

        const totalPnL = providerSignals.reduce((sum, s) => sum + (s.pnl || 0), 0);
        const avgPnLPerSignal = providerSignals.length > 0 ? totalPnL / providerSignals.length : 0;

        const bestSignal = Math.max(...providerSignals.map((s) => s.pnl || 0), 0);
        const worstSignal = Math.min(...providerSignals.map((s) => s.pnl || 0), 0);

        const grossProfit = winningSignals.reduce((sum, s) => sum + (s.pnl || 0), 0);
        const grossLoss = Math.abs(losingSignals.reduce((sum, s) => sum + (s.pnl || 0), 0));
        const profitFactor = grossLoss > 0 ? grossProfit / grossLoss : grossProfit > 0 ? 99 : 0;

        return {
          provider,
          winRate: Math.round(winRate * 10) / 10,
          totalSignals: providerSignals.length,
          avgPnLPerSignal: Math.round(avgPnLPerSignal * 100) / 100,
          bestSignal: Math.round(bestSignal * 100) / 100,
          worstSignal: Math.round(worstSignal * 100) / 100,
          profitFactor: Math.round(profitFactor * 100) / 100,
        };
      },

      refreshSignals: async () => {
        try {
          const { apiClient } = await import('../api/client');
          const data = await apiClient.get<any>('/api/signals');
          set({
            signals: data?.signals || [],
            historicalSignals: data?.historicalSignals || [],
          });
        } catch (error) {
          console.error('Failed to fetch signals:', error);
        }
      },
    }),
    { name: 'signal-store' }
  )
);
