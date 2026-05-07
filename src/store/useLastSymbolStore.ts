/**
 * Last Symbol Store
 * Tracks the last traded symbol across the entire application.
 * When any trade is placed (OneClick, OrderEntry, etc.), the symbol
 * is stored here so the LastSymbolPanel can execute on it.
 */

import { create } from 'zustand';
import { devtools, persist } from 'zustand/middleware';

export interface LastSymbolState {
    // Core tracking
    lastSymbol: string;
    lastTradeSide: 'BUY' | 'SELL' | null;
    lastTradeTime: number;

    // Panel visibility
    panelVisible: boolean;

    // Trade settings
    volume: number;
    useRiskSizing: boolean;
    riskPercent: number;
    autoSLTP: boolean;
    slPips: number;
    tpPips: number;

    // Actions
    setLastSymbol: (symbol: string, side?: 'BUY' | 'SELL') => void;
    togglePanel: () => void;
    setPanelVisible: (visible: boolean) => void;
    setVolume: (volume: number) => void;
    setUseRiskSizing: (use: boolean) => void;
    setRiskPercent: (percent: number) => void;
    setAutoSLTP: (enabled: boolean) => void;
    setSLPips: (pips: number) => void;
    setTPPips: (pips: number) => void;
}

const initialState = {
    lastSymbol: '',
    lastTradeSide: null as 'BUY' | 'SELL' | null,
    lastTradeTime: 0,
    panelVisible: false,
    volume: 0.01,
    useRiskSizing: false,
    riskPercent: 1.0,
    autoSLTP: false,
    slPips: 30,
    tpPips: 60,
};

export const useLastSymbolStore = create<LastSymbolState>()(
    devtools(
        persist(
            (set) => ({
                ...initialState,

                setLastSymbol: (symbol, side) =>
                    set({
                        lastSymbol: symbol.trim().toUpperCase(),
                        lastTradeSide: side || null,
                        lastTradeTime: Date.now(),
                    }),

                togglePanel: () =>
                    set((state) => ({ panelVisible: !state.panelVisible })),

                setPanelVisible: (visible) =>
                    set({ panelVisible: visible }),

                setVolume: (volume) =>
                    set({ volume: Math.max(0.01, Math.round(volume * 100) / 100) }),

                setUseRiskSizing: (use) =>
                    set({ useRiskSizing: use }),

                setRiskPercent: (percent) =>
                    set({ riskPercent: Math.max(0.1, Math.min(100, percent)) }),

                setAutoSLTP: (enabled) =>
                    set({ autoSLTP: enabled }),

                setSLPips: (pips) =>
                    set({ slPips: Math.max(1, pips) }),

                setTPPips: (pips) =>
                    set({ tpPips: Math.max(1, pips) }),
            }),
            {
                name: 'rtx5-last-symbol',
                partialize: (state) => ({
                    lastSymbol: state.lastSymbol,
                    lastTradeSide: state.lastTradeSide,
                    lastTradeTime: state.lastTradeTime,
                    // panelVisible intentionally NOT persisted — always starts hidden
                    volume: state.volume,
                    useRiskSizing: state.useRiskSizing,
                    riskPercent: state.riskPercent,
                    autoSLTP: state.autoSLTP,
                    slPips: state.slPips,
                    tpPips: state.tpPips,
                }),
            }
        )
    )
);
