import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

export const TERMINAL_RESOLUTION_PRESETS = [
  { id: '1280x720', width: 1280, height: 720 },
  { id: '1366x768', width: 1366, height: 768 },
  { id: '1600x900', width: 1600, height: 900 },
  { id: '1920x1080', width: 1920, height: 1080 },
  { id: '2560x1440', width: 2560, height: 1440 },
  { id: '3840x2160', width: 3840, height: 2160 },
] as const;

export type TerminalResolution = 'auto' | typeof TERMINAL_RESOLUTION_PRESETS[number]['id'];
export const DEFAULT_TERMINAL_RESOLUTION: TerminalResolution = 'auto';

const isTerminalResolution = (value: unknown): value is TerminalResolution =>
  value === 'auto' || TERMINAL_RESOLUTION_PRESETS.some(preset => preset.id === value);

export const getTerminalResolutionSize = (resolution: TerminalResolution) =>
  TERMINAL_RESOLUTION_PRESETS.find(preset => preset.id === resolution);

interface TerminalResolutionState {
  resolution: TerminalResolution;
  setResolution: (resolution: TerminalResolution) => void;
}

export const useTerminalResolutionStore = create<TerminalResolutionState>()(persist(set => ({
  resolution: DEFAULT_TERMINAL_RESOLUTION,
  setResolution: resolution => {
    if (isTerminalResolution(resolution)) set({ resolution });
  },
}), {
  name: 'rtx-terminal-resolution',
  storage: createJSONStorage(() => sessionStorage),
  partialize: state => ({ resolution: state.resolution }),
  merge: (persisted, current) => {
    const saved = (persisted as { resolution?: unknown } | null)?.resolution;
    return { ...current, resolution: isTerminalResolution(saved) ? saved : DEFAULT_TERMINAL_RESOLUTION };
  },
}));
