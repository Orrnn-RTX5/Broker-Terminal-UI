import { create } from 'zustand';
import { persist } from 'zustand/middleware';

/** Pointer modes from the TradingView Cursors flyout. */
export type ChartCursorMode = 'cross' | 'dot' | 'arrow' | 'demonstration' | 'magic' | 'eraser';

export interface ChartCursorState {
  mode: ChartCursorMode;
  /** Floating OHLC tooltip while the chart pointer is held down. Default on, matching TradingView. */
  valuesTooltipOnLongPress: boolean;
  setMode: (mode: ChartCursorMode) => void;
  setValuesTooltipOnLongPress: (enabled: boolean) => void;
}

export const chartCursorShowsCrosshair = (mode: ChartCursorMode): boolean =>
  mode === 'cross' || mode === 'dot';

export const useChartCursorStore = create<ChartCursorState>()(
  persist((set) => ({
    mode: 'arrow',
    valuesTooltipOnLongPress: true,
    setMode: (mode) => set({ mode }),
    setValuesTooltipOnLongPress: (enabled) => set({ valuesTooltipOnLongPress: enabled }),
  }), { name: 'rtx-chart-cursor-mode' }),
);
