/**
 * Volatility Analyzer Store (Zustand)
 * Manages symbol and timeframe preferences for volatility analysis
 */

import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export type Timeframe = 'M1' | 'M5' | 'M15' | 'M30' | 'H1' | 'H4' | 'D1';

interface VolatilityState {
  selectedSymbol: string;
  selectedTimeframe: Timeframe;
  riskPercent: number;

  // Actions
  setSymbol: (symbol: string) => void;
  setTimeframe: (timeframe: Timeframe) => void;
  setRiskPercent: (percent: number) => void;
}

export const useVolatilityStore = create<VolatilityState>()(
  persist(
    (set) => ({
      selectedSymbol: 'EURUSD',
      selectedTimeframe: 'H1',
      riskPercent: 2,

      setSymbol: (symbol) => {
        set({ selectedSymbol: symbol });
      },

      setTimeframe: (timeframe) => {
        set({ selectedTimeframe: timeframe });
      },

      setRiskPercent: (percent) => {
        set({ riskPercent: percent });
      },
    }),
    {
      name: 'rtx5-volatility-storage',
    }
  )
);
