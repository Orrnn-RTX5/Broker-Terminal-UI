/**
 * Sentiment Analysis Store with Zustand
 * Manages market sentiment data and indicators
 */

import { create } from 'zustand';
import { devtools } from 'zustand/middleware';

export type SentimentTrend = 'up' | 'down' | 'neutral';
export type NewsSentiment = 'positive' | 'negative' | 'neutral';
export type FearGreedLevel = 'Extreme Fear' | 'Fear' | 'Neutral' | 'Greed' | 'Extreme Greed';

export interface SymbolSentiment {
  symbol: string;
  bullishPercent: number; // 0-100
  bearishPercent: number; // 0-100
  trend: SentimentTrend;
  retailLongPercent: number; // 0-100
  retailShortPercent: number; // 0-100
}

export interface NewsItem {
  id: string;
  headline: string;
  source: string;
  timestamp: Date;
  sentiment: NewsSentiment;
  impactScore: number; // 0-100
}

export interface SentimentIndicators {
  fearGreedIndex: number; // 0-100
  fearGreedLevel: FearGreedLevel;
  vixLevel: number;
  putCallRatio: number;
  netSpeculativePositions: number; // -100 to 100 (negative = net short, positive = net long)
}

interface SentimentState {
  overallSentiment: number; // 0-100 (0 = extreme bearish, 50 = neutral, 100 = extreme bullish)
  symbolSentiments: SymbolSentiment[];
  indicators: SentimentIndicators;
  news: NewsItem[];
  autoRefresh: boolean;
  refreshInterval: number; // seconds
  lastUpdate: Date;

  setAutoRefresh: (enabled: boolean) => void;
  setRefreshInterval: (seconds: number) => void;
  refreshData: () => Promise<void>;
}

function calculateOverallSentiment(symbolSentiments: SymbolSentiment[]): number {
  if (symbolSentiments.length === 0) return 50;

  const avgBullish = symbolSentiments.reduce((sum, s) => sum + s.bullishPercent, 0) / symbolSentiments.length;
  return Math.round(avgBullish * 10) / 10;
}

interface SentimentApiResponse {
  overallSentiment: number;
  symbolSentiments: SymbolSentiment[];
  indicators: SentimentIndicators;
  news: NewsItem[];
}

export const useSentimentStore = create<SentimentState>()(
  devtools(
    (set, get) => ({
      overallSentiment: 50,
      symbolSentiments: [],
      indicators: {
        fearGreedIndex: 50,
        fearGreedLevel: 'Neutral',
        vixLevel: 20,
        putCallRatio: 1.0,
        netSpeculativePositions: 0,
      },
      news: [],
      autoRefresh: true,
      refreshInterval: 30,
      lastUpdate: new Date(),

      setAutoRefresh: (enabled) => set({ autoRefresh: enabled }),
      setRefreshInterval: (seconds) => set({ refreshInterval: seconds }),

      refreshData: async () => {
        try {
          const { apiClient } = await import('../api/client');
          const data = await apiClient.get<SentimentApiResponse>('/api/sentiment');

          set({
            overallSentiment: data.overallSentiment,
            symbolSentiments: data.symbolSentiments,
            indicators: data.indicators,
            news: (data.news || []).map((item) => ({
              ...item,
              timestamp: new Date(item.timestamp),
            })),
            lastUpdate: new Date(),
          });
        } catch (error) {
          console.error('Failed to fetch sentiment data:', error);
        }
      },
    }),
    { name: 'sentiment-store' }
  )
);
