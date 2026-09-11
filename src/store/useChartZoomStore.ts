import { create } from 'zustand';

interface ChartZoomState {
  baselineSpacing: number;
  barSpacing: number;
}

interface ChartZoomStore {
  byContext: Record<string, ChartZoomState>;
  syncSpacing: (contextId: string, barSpacing: number, reset?: boolean) => void;
  clearContext: (contextId: string) => void;
}

export const canZoomChartOut = (zoom: ChartZoomState | undefined): boolean => (
  !!zoom && zoom.barSpacing > zoom.baselineSpacing * (1 + 1e-6)
);

// Viewport state is local to the mounted chart; it is never persisted or shared
// between panels showing the same instrument.
export const useChartZoomStore = create<ChartZoomStore>()((set) => ({
  byContext: {},
  syncSpacing: (contextId, barSpacing, reset = false) => {
    if (!contextId || !Number.isFinite(barSpacing) || barSpacing <= 0) return;
    set((state) => {
      const current = state.byContext[contextId];
      const baselineSpacing = reset || !current ? barSpacing : current.baselineSpacing;
      if (current?.barSpacing === barSpacing && current.baselineSpacing === baselineSpacing) return state;
      return { byContext: { ...state.byContext, [contextId]: { baselineSpacing, barSpacing } } };
    });
  },
  clearContext: (contextId) => set((state) => {
    if (!state.byContext[contextId]) return state;
    const byContext = { ...state.byContext };
    delete byContext[contextId];
    return { byContext };
  }),
}));
