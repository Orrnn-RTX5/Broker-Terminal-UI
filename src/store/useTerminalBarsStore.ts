import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export const useTerminalBarsStore = create<{
  statusBarVisible: boolean;
  chartsBarVisible: boolean;
  timeframesVisible: boolean;
  toggleStatusBar: () => void;
  toggleChartsBar: () => void;
  toggleTimeframes: () => void;
}>()(persist((set) => ({
  statusBarVisible: true,
  chartsBarVisible: true,
  timeframesVisible: true,
  toggleStatusBar: () => set(state => ({ statusBarVisible: !state.statusBarVisible })),
  toggleChartsBar: () => set(state => ({ chartsBarVisible: !state.chartsBarVisible })),
  toggleTimeframes: () => set(state => ({ timeframesVisible: !state.timeframesVisible })),
}), {
  name: 'rtx-terminal-bars',
  partialize: state => ({
    statusBarVisible: state.statusBarVisible,
    chartsBarVisible: state.chartsBarVisible,
    timeframesVisible: state.timeframesVisible,
  }),
}));
