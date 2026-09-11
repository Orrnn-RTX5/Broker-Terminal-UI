import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export type MagnetMode = 'off' | 'weak' | 'strong';

export interface DrawingToolPreferencesState {
  keepDrawing: boolean;
  magnetMode: MagnetMode;
  snapToIndicators: boolean;
  setKeepDrawing: (enabled: boolean) => void;
  setMagnetMode: (mode: MagnetMode) => void;
  setSnapToIndicators: (enabled: boolean) => void;
}

export const useDrawingToolPreferencesStore = create<DrawingToolPreferencesState>()(
  persist((set) => ({
    keepDrawing: false,
    magnetMode: 'off',
    snapToIndicators: false,
    setKeepDrawing: (keepDrawing) => set({ keepDrawing }),
    setMagnetMode: (magnetMode) => set({ magnetMode }),
    setSnapToIndicators: (snapToIndicators) => set({ snapToIndicators }),
  }), { name: 'rtx-drawing-tool-preferences' }),
);
