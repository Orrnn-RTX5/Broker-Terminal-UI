/**
 * Equity Curve Store (Zustand)
 * Manages time range preferences for equity curve display
 */

import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export type TimeRange = '1W' | '1M' | '3M' | '6M' | '1Y' | 'All';

interface EquityCurveState {
  selectedTimeRange: TimeRange;

  // Actions
  setTimeRange: (range: TimeRange) => void;
}

export const useEquityCurveStore = create<EquityCurveState>()(
  persist(
    (set) => ({
      selectedTimeRange: '3M',

      setTimeRange: (range) => {
        set({ selectedTimeRange: range });
      },
    }),
    {
      name: 'rtx5-equity-curve-storage',
    }
  )
);
