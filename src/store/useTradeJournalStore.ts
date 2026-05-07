/**
 * Trade Journal Store (Zustand)
 * Manages journal entries, trade annotations, and tags
 */

import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export type SetupTag = 'breakout' | 'reversal' | 'trend' | 'range' | 'news' | 'scalp' | 'swing';

export interface TradeAnnotation {
  tradeId: number;
  notes: string;
  tags: SetupTag[];
  emotionRating: number; // 1-5 scale
  screenshotUrl?: string;
  preTradePlan?: string;
  postTradeReview?: string;
  lessonsLearned?: string;
}

export interface JournalEntry {
  id: string;
  date: string; // YYYY-MM-DD
  preTradePlan: string;
  postTradeReview: string;
  lessonsLearned: string;
  mood: number; // 1-5 scale
  createdAt: number;
}

interface TradeJournalState {
  annotations: TradeAnnotation[];
  journalEntries: JournalEntry[];

  // Annotations
  addAnnotation: (annotation: TradeAnnotation) => void;
  updateAnnotation: (tradeId: number, updates: Partial<TradeAnnotation>) => void;
  getAnnotation: (tradeId: number) => TradeAnnotation | undefined;

  // Journal Entries
  addJournalEntry: (entry: Omit<JournalEntry, 'id' | 'createdAt'>) => void;
  updateJournalEntry: (id: string, updates: Partial<JournalEntry>) => void;
  deleteJournalEntry: (id: string) => void;
  getEntriesByDate: (date: string) => JournalEntry[];
}

export const useTradeJournalStore = create<TradeJournalState>()(
  persist(
    (set, get) => ({
      annotations: [],
      journalEntries: [],

      addAnnotation: (annotation) => {
        const { annotations } = get();
        const existing = annotations.find(a => a.tradeId === annotation.tradeId);
        if (existing) {
          // Update existing
          set({
            annotations: annotations.map(a =>
              a.tradeId === annotation.tradeId ? annotation : a
            ),
          });
        } else {
          // Add new
          set({ annotations: [...annotations, annotation] });
        }
      },

      updateAnnotation: (tradeId, updates) => {
        set((state) => ({
          annotations: state.annotations.map(a =>
            a.tradeId === tradeId ? { ...a, ...updates } : a
          ),
        }));
      },

      getAnnotation: (tradeId) => {
        const { annotations } = get();
        return annotations.find(a => a.tradeId === tradeId);
      },

      addJournalEntry: (entry) => {
        const newEntry: JournalEntry = {
          ...entry,
          id: `je-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
          createdAt: Date.now(),
        };
        set((state) => ({
          journalEntries: [newEntry, ...state.journalEntries],
        }));
      },

      updateJournalEntry: (id, updates) => {
        set((state) => ({
          journalEntries: state.journalEntries.map(e =>
            e.id === id ? { ...e, ...updates } : e
          ),
        }));
      },

      deleteJournalEntry: (id) => {
        set((state) => ({
          journalEntries: state.journalEntries.filter(e => e.id !== id),
        }));
      },

      getEntriesByDate: (date) => {
        const { journalEntries } = get();
        return journalEntries.filter(e => e.date === date);
      },
    }),
    {
      name: 'rtx5-trade-journal-storage',
    }
  )
);
