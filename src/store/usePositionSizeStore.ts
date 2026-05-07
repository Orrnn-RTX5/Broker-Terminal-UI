/**
 * Position Size Calculator Store (Zustand)
 * Manages calculation history and saved configurations
 */

import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export interface CalculationHistory {
  id: string;
  timestamp: number;
  symbol: string;
  accountBalance: number;
  riskPercent: number;
  stopLossPips: number;
  positionSize: number;
  monetaryRisk: number;
  reward1to1: number;
  reward1to2: number;
  reward1to3: number;
  marginRequired: number;
}

interface PositionSizeState {
  calculationHistory: CalculationHistory[];

  // Actions
  addCalculation: (calculation: Omit<CalculationHistory, 'id' | 'timestamp'>) => void;
  clearHistory: () => void;
  getHistory: () => CalculationHistory[];
}

export const usePositionSizeStore = create<PositionSizeState>()(
  persist(
    (set, get) => ({
      calculationHistory: [],

      addCalculation: (calculation) => {
        const newCalc: CalculationHistory = {
          ...calculation,
          id: `calc-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
          timestamp: Date.now(),
        };

        set((state) => ({
          calculationHistory: [newCalc, ...state.calculationHistory].slice(0, 10), // Keep last 10
        }));
      },

      clearHistory: () => {
        set({ calculationHistory: [] });
      },

      getHistory: () => {
        return get().calculationHistory;
      },
    }),
    {
      name: 'rtx5-position-size-storage',
    }
  )
);
