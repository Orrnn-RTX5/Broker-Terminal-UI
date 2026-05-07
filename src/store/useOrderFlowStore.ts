/**
 * Order Flow Store (Zustand)
 * Manages order flow visualization preferences
 */

import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export type TimeframeType = '1m' | '5m' | '15m' | '1h';

interface OrderFlowState {
  selectedSymbol: string;
  timeframe: TimeframeType;
  largeOrderThreshold: number; // volume threshold for large order alerts
  showCumulativeDelta: boolean;
  autoScroll: boolean; // auto-scroll order flow tape

  // Actions
  setSelectedSymbol: (symbol: string) => void;
  setTimeframe: (timeframe: TimeframeType) => void;
  setLargeOrderThreshold: (threshold: number) => void;
  setShowCumulativeDelta: (show: boolean) => void;
  setAutoScroll: (autoScroll: boolean) => void;
}

export const useOrderFlowStore = create<OrderFlowState>()(
  persist(
    (set) => ({
      selectedSymbol: 'EURUSD',
      timeframe: '5m',
      largeOrderThreshold: 5.0, // lots
      showCumulativeDelta: true,
      autoScroll: true,

      setSelectedSymbol: (symbol) => {
        set({ selectedSymbol: symbol });
      },

      setTimeframe: (timeframe) => {
        set({ timeframe });
      },

      setLargeOrderThreshold: (threshold) => {
        set({ largeOrderThreshold: threshold });
      },

      setShowCumulativeDelta: (show) => {
        set({ showCumulativeDelta: show });
      },

      setAutoScroll: (autoScroll) => {
        set({ autoScroll });
      },
    }),
    {
      name: 'rtx5-order-flow-storage',
    }
  )
);
