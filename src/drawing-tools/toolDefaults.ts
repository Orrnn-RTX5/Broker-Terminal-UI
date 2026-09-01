import type { TrendLineToolId } from './toolCatalog';

export type RegressionSource = 'open' | 'high' | 'low' | 'close' | 'hl2';

export interface TrendToolRuntimeDefaults {
  channelMidpointRatio?: number;
  pitchforkLevels?: readonly number[];
  regressionSource?: RegressionSource;
  regressionUpperDeviation?: number;
  regressionLowerDeviation?: number;
  showRegressionPearson?: boolean;
}

type DrawingTone = 'accent' | 'profit' | 'warning';

const TOOL_TONES: Partial<Record<TrendLineToolId, DrawingTone>> = {
  flat_top_bottom: 'warning',
  disjoint_channel: 'profit',
};

const TOOL_RUNTIME_DEFAULTS: Partial<Record<TrendLineToolId, TrendToolRuntimeDefaults>> = {
  parallel_channel: { channelMidpointRatio: 0.5 },
  regression_trend: {
    regressionSource: 'close',
    regressionUpperDeviation: 2,
    regressionLowerDeviation: 2,
    showRegressionPearson: true,
  },
  pitchfork: { pitchforkLevels: [0, 0.5, 1] },
  schiff_pitchfork: { pitchforkLevels: [0, 0.5, 1] },
  modified_schiff_pitchfork: { pitchforkLevels: [0, 0.5, 1] },
  inside_pitchfork: { pitchforkLevels: [0, 0.5, 1] },
};

export const getTrendToolRuntimeDefaults = (
  toolId: string | undefined,
): TrendToolRuntimeDefaults => {
  const defaults = toolId ? TOOL_RUNTIME_DEFAULTS[toolId as TrendLineToolId] : undefined;
  return {
    ...defaults,
    pitchforkLevels: defaults?.pitchforkLevels ? [...defaults.pitchforkLevels] : undefined,
  };
};

export const resolveTrendToolColor = (
  toolId: string | undefined,
  root: Element = document.documentElement,
): string => {
  const tone = toolId ? TOOL_TONES[toolId as TrendLineToolId] ?? 'accent' : 'accent';
  const token = tone === 'profit'
    ? '--color-profit'
    : tone === 'warning'
      ? '--color-warning'
      : '--drawing-tool-accent';
  const fallback = tone === 'profit'
    ? '#00c896'
    : tone === 'warning'
      ? '#c9963a'
      : '#2962ff';
  return window.getComputedStyle(root).getPropertyValue(token).trim() || fallback;
};
