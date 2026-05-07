/**
 * Backtest Store (Zustand)
 * Manages strategy tester state
 */

import { create } from 'zustand';

export interface Trade {
    id: number;
    time: string;
    type: 'BUY' | 'SELL';
    symbol: string;
    volume: number;
    price: number;
    sl: number;
    tp: number;
    profit: number;
    balance: number;
}

export interface BacktestResults {
    netProfit: number;
    grossProfit: number;
    grossLoss: number;
    profitFactor: number;
    expectedPayoff: number;
    totalTrades: number;
    winRate: number;
    lossRate: number;
    largestWin: number;
    largestLoss: number;
    averageWin: number;
    averageLoss: number;
    maxConsecutiveWins: number;
    maxConsecutiveLosses: number;
    maxDrawdown: number;
    maxDrawdownPercent: number;
    sharpeRatio: number;
    recoveryFactor: number;
    trades: Trade[];
    equityCurve: { date: string; balance: number }[];
}

interface BacktestState {
    isRunning: boolean;
    progress: number;
    currentDate: string | null;
    estimatedTimeRemaining: number; // seconds
    results: BacktestResults | null;

    // Actions
    startBacktest: () => void;
    stopBacktest: () => void;
    setProgress: (progress: number, currentDate?: string) => void;
    setResults: (results: BacktestResults) => void;
    reset: () => void;
}

export const useBacktestStore = create<BacktestState>((set) => ({
    isRunning: false,
    progress: 0,
    currentDate: null,
    estimatedTimeRemaining: 0,
    results: null,

    startBacktest: () => set({ isRunning: true, progress: 0, results: null }),
    stopBacktest: () => set({ isRunning: false, progress: 0 }),
    setProgress: (progress, currentDate) => set({
        progress,
        currentDate: currentDate || null,
        estimatedTimeRemaining: Math.max(0, Math.round((100 - progress) * 0.05)) // ~5 seconds total
    }),
    setResults: (results) => set({ results, isRunning: false, progress: 100 }),
    reset: () => set({ isRunning: false, progress: 0, results: null, currentDate: null, estimatedTimeRemaining: 0 })
}));
