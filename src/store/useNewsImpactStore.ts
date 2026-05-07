/**
 * News Impact Store (Zustand)
 * Manages favorited economic events
 */

import { create } from 'zustand';
import { persist } from 'zustand/middleware';

interface NewsImpactState {
  favoritedEvents: string[];

  // Actions
  toggleFavorite: (eventType: string) => void;
  isFavorited: (eventType: string) => boolean;
}

export const useNewsImpactStore = create<NewsImpactState>()(
  persist(
    (set, get) => ({
      favoritedEvents: [],

      toggleFavorite: (eventType) => {
        set((state) => ({
          favoritedEvents: state.favoritedEvents.includes(eventType)
            ? state.favoritedEvents.filter(e => e !== eventType)
            : [...state.favoritedEvents, eventType],
        }));
      },

      isFavorited: (eventType) => {
        return get().favoritedEvents.includes(eventType);
      },
    }),
    {
      name: 'rtx5-news-impact-storage',
    }
  )
);
