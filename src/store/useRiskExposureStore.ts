/**
 * Risk Exposure Store (Zustand)
 * Manages risk exposure view preferences
 */

import { create } from 'zustand';
import { persist } from 'zustand/middleware';

interface RiskExposureState {
  showCorrelationWarnings: boolean;
  riskScoreThreshold: number; // 1-10, alert if above this
  marginWarningThreshold: number; // percentage, alert if above this

  // Actions
  setShowCorrelationWarnings: (show: boolean) => void;
  setRiskScoreThreshold: (threshold: number) => void;
  setMarginWarningThreshold: (threshold: number) => void;
}

export const useRiskExposureStore = create<RiskExposureState>()(
  persist(
    (set) => ({
      showCorrelationWarnings: true,
      riskScoreThreshold: 7,
      marginWarningThreshold: 80,

      setShowCorrelationWarnings: (show) => {
        set({ showCorrelationWarnings: show });
      },

      setRiskScoreThreshold: (threshold) => {
        set({ riskScoreThreshold: threshold });
      },

      setMarginWarningThreshold: (threshold) => {
        set({ marginWarningThreshold: threshold });
      },
    }),
    {
      name: 'rtx5-risk-exposure-storage',
    }
  )
);
