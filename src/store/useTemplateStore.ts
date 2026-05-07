/**
 * Chart Template Store with Zustand + Persist
 * Manages chart configuration templates with automatic persistence
 * Similar to MT5 chart templates functionality
 */

import { create } from 'zustand';
import { devtools, persist } from 'zustand/middleware';
import type { ChartType, Timeframe } from '../components/TradingChart';

// Template interface matching chart configuration
export interface ChartTemplate {
  id: string;
  name: string;
  chartType: ChartType;
  timeframe: Timeframe;
  showGrid: boolean;
  showVolumes: boolean;
  indicators: Array<{
    id: string;
    name: string;
    type: string;
    parameters: Record<string, any>;
    visible: boolean;
  }>;
  drawingTools: Array<{
    id: string;
    type: string;
    data: any;
  }>;
  colors: {
    background: string;
    grid: string;
    candle: {
      up: string;
      down: string;
      border: string;
    };
    volume: {
      up: string;
      down: string;
    };
  };
  createdAt: number;
  isDefault?: boolean;
}

interface TemplateState {
  templates: ChartTemplate[];

  // Actions
  saveTemplate: (template: Omit<ChartTemplate, 'id' | 'createdAt'>) => ChartTemplate;
  loadTemplate: (id: string) => ChartTemplate | null;
  deleteTemplate: (id: string) => void;
  updateTemplate: (id: string, updates: Partial<ChartTemplate>) => void;
  listTemplates: () => ChartTemplate[];
  getTemplateById: (id: string) => ChartTemplate | null;
  resetToDefaults: () => void;
}

// Built-in default templates (MT5-inspired)
const defaultTemplates: ChartTemplate[] = [
  {
    id: 'default',
    name: 'Default',
    chartType: 'candlestick',
    timeframe: 'M1',
    showGrid: true,
    showVolumes: true,
    indicators: [],
    drawingTools: [],
    colors: {
      background: '#000000',
      grid: '#2b2b2b',
      candle: {
        up: '#26a69a',
        down: '#ef5350',
        border: '#378658',
      },
      volume: {
        up: '#26a69a',
        down: '#ef5350',
      },
    },
    createdAt: Date.now(),
    isDefault: true,
  },
  {
    id: 'clean-chart',
    name: 'Clean Chart',
    chartType: 'candlestick',
    timeframe: 'H1',
    showGrid: false,
    showVolumes: false,
    indicators: [],
    drawingTools: [],
    colors: {
      background: '#000000',
      grid: '#2b2b2b',
      candle: {
        up: '#00ff00',
        down: '#ff0000',
        border: '#378658',
      },
      volume: {
        up: '#26a69a',
        down: '#ef5350',
      },
    },
    createdAt: Date.now(),
    isDefault: true,
  },
  {
    id: 'technical-analysis',
    name: 'Technical Analysis',
    chartType: 'candlestick',
    timeframe: 'H4',
    showGrid: true,
    showVolumes: true,
    indicators: [
      {
        id: 'sma-20',
        name: 'SMA(20)',
        type: 'sma',
        parameters: { period: 20, color: '#2962ff' },
        visible: true,
      },
      {
        id: 'ema-50',
        name: 'EMA(50)',
        type: 'ema',
        parameters: { period: 50, color: '#f23645' },
        visible: true,
      },
      {
        id: 'rsi-14',
        name: 'RSI(14)',
        type: 'rsi',
        parameters: { period: 14, overbought: 70, oversold: 30 },
        visible: true,
      },
    ],
    drawingTools: [],
    colors: {
      background: '#000000',
      grid: '#2b2b2b',
      candle: {
        up: '#26a69a',
        down: '#ef5350',
        border: '#378658',
      },
      volume: {
        up: '#26a69a',
        down: '#ef5350',
      },
    },
    createdAt: Date.now(),
    isDefault: true,
  },
];

export const useTemplateStore = create<TemplateState>()(
  devtools(
    persist(
      (set, get) => ({
        templates: defaultTemplates,

        saveTemplate: (template) => {
          const newTemplate: ChartTemplate = {
            ...template,
            id: `template-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
            createdAt: Date.now(),
            isDefault: false,
          };

          set((state) => ({
            templates: [...state.templates, newTemplate],
          }));

          return newTemplate;
        },

        loadTemplate: (id) => {
          const state = get();
          return state.templates.find((t) => t.id === id) || null;
        },

        deleteTemplate: (id) => {
          set((state) => {
            // Prevent deletion of default templates
            const template = state.templates.find((t) => t.id === id);
            if (template?.isDefault) {
              console.warn('Cannot delete default templates');
              return state;
            }

            return {
              templates: state.templates.filter((t) => t.id !== id),
            };
          });
        },

        updateTemplate: (id, updates) => {
          set((state) => {
            // Prevent updating default templates
            const template = state.templates.find((t) => t.id === id);
            if (template?.isDefault) {
              console.warn('Cannot update default templates');
              return state;
            }

            return {
              templates: state.templates.map((t) =>
                t.id === id ? { ...t, ...updates } : t
              ),
            };
          });
        },

        listTemplates: () => {
          return get().templates;
        },

        getTemplateById: (id) => {
          return get().templates.find((t) => t.id === id) || null;
        },

        resetToDefaults: () => {
          set({ templates: defaultTemplates });
        },
      }),
      {
        name: 'rtx5-chart-templates',
        // Persist all templates
        partialize: (state) => ({
          templates: state.templates,
        }),
      }
    )
  )
);

// Selectors
export const useTemplates = () => useTemplateStore((state) => state.templates);
export const useDefaultTemplates = () =>
  useTemplateStore((state) => state.templates.filter((t) => t.isDefault));
export const useCustomTemplates = () =>
  useTemplateStore((state) => state.templates.filter((t) => !t.isDefault));
