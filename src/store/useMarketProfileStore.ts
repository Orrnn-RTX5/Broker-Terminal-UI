/**
 * Market Profile Store (Zustand)
 * Manages Market Profile, TPO, and Volume Profile visualization settings
 */

import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export type ProfileType = 'volume' | 'tpo' | 'market';
export type SessionType = 'asian' | 'london' | 'newyork' | 'fullday';
export type ProfileMode = 'developing' | 'settled';

interface MarketProfileState {
  selectedSymbol: string;
  profileType: ProfileType;
  session: SessionType;
  profileMode: ProfileMode;
  showPOC: boolean;
  showValueArea: boolean;
  showInitialBalance: boolean;
  showTPOLetters: boolean;
  priceLevels: number;

  // Actions
  setSelectedSymbol: (symbol: string) => void;
  setProfileType: (type: ProfileType) => void;
  setSession: (session: SessionType) => void;
  setProfileMode: (mode: ProfileMode) => void;
  togglePOC: () => void;
  toggleValueArea: () => void;
  toggleInitialBalance: () => void;
  toggleTPOLetters: () => void;
  setPriceLevels: (levels: number) => void;
}

export const useMarketProfileStore = create<MarketProfileState>()(
  persist(
    (set) => ({
      selectedSymbol: 'EURUSD',
      profileType: 'volume',
      session: 'fullday',
      profileMode: 'settled',
      showPOC: true,
      showValueArea: true,
      showInitialBalance: true,
      showTPOLetters: true,
      priceLevels: 30,

      setSelectedSymbol: (symbol) => {
        set({ selectedSymbol: symbol });
      },

      setProfileType: (type) => {
        set({ profileType: type });
      },

      setSession: (session) => {
        set({ session });
      },

      setProfileMode: (mode) => {
        set({ profileMode: mode });
      },

      togglePOC: () => {
        set((state) => ({ showPOC: !state.showPOC }));
      },

      toggleValueArea: () => {
        set((state) => ({ showValueArea: !state.showValueArea }));
      },

      toggleInitialBalance: () => {
        set((state) => ({ showInitialBalance: !state.showInitialBalance }));
      },

      toggleTPOLetters: () => {
        set((state) => ({ showTPOLetters: !state.showTPOLetters }));
      },

      setPriceLevels: (levels) => {
        set({ priceLevels: levels });
      },
    }),
    {
      name: 'rtx5-market-profile-storage',
    }
  )
);
