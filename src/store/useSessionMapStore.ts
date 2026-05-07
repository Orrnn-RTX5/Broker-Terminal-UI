/**
 * Session Heat Map Store (Zustand)
 * Manages selected symbol and timezone preferences for session visualization
 */

import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export type TimezoneType = 'UTC' | 'Local' | 'NY' | 'London' | 'Tokyo';

interface SessionMapState {
  selectedSymbol: string;
  timezone: TimezoneType;

  // Actions
  setSelectedSymbol: (symbol: string) => void;
  setTimezone: (timezone: TimezoneType) => void;
}

export const useSessionMapStore = create<SessionMapState>()(
  persist(
    (set) => ({
      selectedSymbol: 'EURUSD',
      timezone: 'UTC',

      setSelectedSymbol: (symbol) => {
        set({ selectedSymbol: symbol });
      },

      setTimezone: (timezone) => {
        set({ timezone });
      },
    }),
    {
      name: 'rtx5-session-map-storage',
    }
  )
);
