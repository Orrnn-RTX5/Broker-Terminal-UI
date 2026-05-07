/**
 * Chart Template Store
 * Zustand store with persist middleware for saving/loading chart configurations
 */

import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export interface ChartTemplate {
  id: string;
  name: string;
  symbol: string;
  timeframe: 'M1' | 'M5' | 'M15' | 'M30' | 'H1' | 'H4' | 'D1' | 'W1' | 'MN';
  chartType: 'candlestick' | 'heikinAshi' | 'bar' | 'line' | 'area';
  showVolume: boolean;
  showGrid: boolean;
  indicators: any[]; // Indicator configurations
  drawingTools: any[]; // Drawing tool configurations
  colors?: {
    upColor?: string;
    downColor?: string;
    backgroundColor?: string;
    gridColor?: string;
  };
  createdAt: number;
  updatedAt: number;
}

interface ChartTemplateState {
  templates: ChartTemplate[];
  activeTemplateId: string | null;

  // Actions
  saveTemplate: (template: Omit<ChartTemplate, 'id' | 'createdAt' | 'updatedAt'>) => ChartTemplate;
  loadTemplate: (id: string) => ChartTemplate | null;
  deleteTemplate: (id: string) => void;
  renameTemplate: (id: string, newName: string) => void;
  duplicateTemplate: (id: string) => ChartTemplate | null;
  setActiveTemplate: (id: string | null) => void;
  getTemplateList: () => ChartTemplate[];
  importTemplates: (templates: ChartTemplate[]) => void;
  exportTemplates: () => { version: number; templates: ChartTemplate[] };
}

export const useChartTemplateStore = create<ChartTemplateState>()(
  persist(
    (set, get) => ({
      templates: [],
      activeTemplateId: null,

      saveTemplate: (template) => {
        const newTemplate: ChartTemplate = {
          ...template,
          id: `template_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
          createdAt: Date.now(),
          updatedAt: Date.now(),
        };

        set((state) => ({
          templates: [...state.templates, newTemplate],
        }));

        return newTemplate;
      },

      loadTemplate: (id) => {
        const template = get().templates.find((t) => t.id === id);
        if (template) {
          set({ activeTemplateId: id });
          return template;
        }
        return null;
      },

      deleteTemplate: (id) => {
        set((state) => ({
          templates: state.templates.filter((t) => t.id !== id),
          activeTemplateId: state.activeTemplateId === id ? null : state.activeTemplateId,
        }));
      },

      renameTemplate: (id, newName) => {
        set((state) => ({
          templates: state.templates.map((t) =>
            t.id === id
              ? { ...t, name: newName, updatedAt: Date.now() }
              : t
          ),
        }));
      },

      duplicateTemplate: (id) => {
        const template = get().templates.find((t) => t.id === id);
        if (!template) return null;

        const duplicated: ChartTemplate = {
          ...template,
          id: `template_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
          name: `${template.name} (Copy)`,
          createdAt: Date.now(),
          updatedAt: Date.now(),
        };

        set((state) => ({
          templates: [...state.templates, duplicated],
        }));

        return duplicated;
      },

      setActiveTemplate: (id) => {
        set({ activeTemplateId: id });
      },

      getTemplateList: () => {
        return get().templates;
      },

      importTemplates: (templates) => {
        set((state) => {
          // Merge with existing templates, avoiding ID conflicts
          const existingIds = new Set(state.templates.map((t) => t.id));
          const newTemplates = templates.map((t) => {
            if (existingIds.has(t.id)) {
              // Regenerate ID if conflict
              return {
                ...t,
                id: `template_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
                updatedAt: Date.now(),
              };
            }
            return t;
          });

          return {
            templates: [...state.templates, ...newTemplates],
          };
        });
      },

      exportTemplates: () => {
        return {
          version: 1,
          templates: get().templates,
        };
      },
    }),
    {
      name: 'chart-templates-storage', // LocalStorage key
      version: 1,
    }
  )
);
