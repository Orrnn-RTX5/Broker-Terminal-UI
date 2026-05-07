/**
 * Currency Converter Store (Zustand)
 * Manages favorites and last used currency pairs
 */

import { create } from 'zustand';
import { persist } from 'zustand/middleware';

interface CurrencyPair {
  from: string;
  to: string;
}

interface CurrencyState {
  favorites: CurrencyPair[];
  lastUsedPairs: CurrencyPair[];
  multiConvertCurrencies: string[];

  // Actions
  addFavorite: (pair: CurrencyPair) => void;
  removeFavorite: (pair: CurrencyPair) => void;
  isFavorite: (pair: CurrencyPair) => boolean;
  addToLastUsed: (pair: CurrencyPair) => void;
  setMultiConvertCurrencies: (currencies: string[]) => void;
  toggleMultiConvertCurrency: (currency: string) => void;
}

export const useCurrencyStore = create<CurrencyState>()(
  persist(
    (set, get) => ({
      favorites: [],
      lastUsedPairs: [],
      multiConvertCurrencies: ['EUR', 'GBP', 'JPY'],

      addFavorite: (pair) => {
        const { favorites } = get();
        if (!favorites.some(f => f.from === pair.from && f.to === pair.to)) {
          set({ favorites: [...favorites, pair] });
        }
      },

      removeFavorite: (pair) => {
        set((state) => ({
          favorites: state.favorites.filter(
            f => !(f.from === pair.from && f.to === pair.to)
          ),
        }));
      },

      isFavorite: (pair) => {
        const { favorites } = get();
        return favorites.some(f => f.from === pair.from && f.to === pair.to);
      },

      addToLastUsed: (pair) => {
        set((state) => {
          const filtered = state.lastUsedPairs.filter(
            p => !(p.from === pair.from && p.to === pair.to)
          );
          return {
            lastUsedPairs: [pair, ...filtered].slice(0, 10), // Keep last 10
          };
        });
      },

      setMultiConvertCurrencies: (currencies) => {
        set({ multiConvertCurrencies: currencies });
      },

      toggleMultiConvertCurrency: (currency) => {
        set((state) => ({
          multiConvertCurrencies: state.multiConvertCurrencies.includes(currency)
            ? state.multiConvertCurrencies.filter(c => c !== currency)
            : [...state.multiConvertCurrencies, currency],
        }));
      },
    }),
    {
      name: 'rtx5-currency-storage',
    }
  )
);
