import { getActiveChartSource } from './activeChartSource';

export interface ChartPropertiesTarget {
  symbol: string;
  timeframe: string;
}

export interface ChartPropertiesTargetFallback {
  symbol: string;
  timeframe: string;
}

export interface ChartPropertiesEventDetail {
  symbol?: unknown;
  timeframe?: unknown;
  targetContextId?: unknown;
}

const getNonEmptyString = (value: unknown): string | undefined => {
  if (typeof value !== 'string') return undefined;

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
};

export const resolveChartPropertiesTarget = (
  detail: ChartPropertiesEventDetail | null | undefined,
  fallback: ChartPropertiesTargetFallback,
): ChartPropertiesTarget => {
  const activeSource = getActiveChartSource();

  return {
    symbol: getNonEmptyString(detail?.symbol)
      ?? getNonEmptyString(activeSource?.symbol)
      ?? fallback.symbol,
    timeframe: getNonEmptyString(detail?.timeframe)
      ?? getNonEmptyString(activeSource?.timeframe)
      ?? fallback.timeframe,
  };
};
