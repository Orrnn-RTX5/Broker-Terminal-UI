import type { IChartApi, LogicalRange } from 'lightweight-charts';

export interface ChartScrollRequest {
  direction: 'left' | 'right';
  targetContextId?: string;
  panelId?: string;
}

interface ChartKeyboardScrollOptions {
  getChart: () => IChartApi | null;
  isTarget: (request: ChartScrollRequest) => boolean;
  beforeScroll: () => void;
  onScrolled: (range: LogicalRange) => void;
}

/** Pan the shared candle/volume time scale without changing its zoom level. */
export function bindChartKeyboardScroll(options: ChartKeyboardScrollOptions): () => void {
  const handleScroll = (event: Event) => {
    const request = (event as CustomEvent<ChartScrollRequest>).detail;
    if (!request || (request.direction !== 'left' && request.direction !== 'right') || !options.isTarget(request)) return;
    const chart = options.getChart();
    if (!chart) return;
    try {
      const timeScale = chart.timeScale();
      const range = timeScale.getVisibleLogicalRange();
      if (!range || !Number.isFinite(range.from) || !Number.isFinite(range.to) || range.to <= range.from) return;
      const offset = (range.to - range.from) * 0.1 * (request.direction === 'left' ? -1 : 1);
      const nextRange = { from: range.from + offset, to: range.to + offset } as LogicalRange;
      // Disable follow-live before native range callbacks run, then remember
      // the requested range even when the chart applies it on its next frame.
      options.beforeScroll();
      timeScale.setVisibleLogicalRange(nextRange);
      options.onScrolled(nextRange);
    } catch {
      // The chart may have been disposed during a tab/symbol transition.
    }
  };
  window.addEventListener('chart-scroll', handleScroll);
  return () => window.removeEventListener('chart-scroll', handleScroll);
}
