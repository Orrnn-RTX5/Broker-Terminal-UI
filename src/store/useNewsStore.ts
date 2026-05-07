/**
 * News Store with Zustand
 * Manages financial news feed (ephemeral, no persistence)
 */

import { create } from 'zustand';
import { devtools } from 'zustand/middleware';

export type NewsImpact = 'high' | 'medium' | 'low';
export type NewsCategory = 'All' | 'Forex' | 'Crypto' | 'Economy' | 'Central Banks';

export interface NewsItem {
  id: string;
  headline: string;
  summary: string;
  source: string;
  impact: NewsImpact;
  category: Exclude<NewsCategory, 'All'>;
  symbols: string[];
  timestamp: Date;
  isRead: boolean;
}

interface NewsState {
  news: NewsItem[];
  activeCategory: NewsCategory;
  setNews: (news: NewsItem[]) => void;
  markAsRead: (id: string) => void;
  markAllAsRead: () => void;
  setActiveCategory: (category: NewsCategory) => void;
  refreshNews: () => void;
  getFilteredNews: () => NewsItem[];
}

// Fetch news from API
async function fetchNews(): Promise<NewsItem[]> {
  try {
    const { apiClient } = await import('../api/client');
    const data = await apiClient.get<any[]>('/api/news');
    return (data || []).map((item: NewsItem) => ({
      ...item,
      timestamp: new Date(item.timestamp),
    }));
  } catch (error) {
    console.error('Failed to fetch news:', error);
    return [];
  }
}

export const useNewsStore = create<NewsState>()(
  devtools(
    (set, get) => ({
      news: [],
      activeCategory: 'All',

      setNews: (news) => set({ news }),

      markAsRead: (id) =>
        set((state) => ({
          news: state.news.map((item) =>
            item.id === id ? { ...item, isRead: true } : item
          ),
        })),

      markAllAsRead: () =>
        set((state) => ({
          news: state.news.map((item) => ({ ...item, isRead: true })),
        })),

      setActiveCategory: (category) => set({ activeCategory: category }),

      refreshNews: async () => {
        const news = await fetchNews();
        set({ news });
      },

      getFilteredNews: () => {
        const { news, activeCategory } = get();
        if (activeCategory === 'All') return news;
        return news.filter((item) => item.category === activeCategory);
      },
    }),
    { name: 'news-store' }
  )
);
