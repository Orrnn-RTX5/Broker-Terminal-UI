import { getActiveChartSource } from './activeChartSource';

export interface ChartCommandTarget {
  targetContextId?: string;
  symbol?: string;
  timeframe?: string;
}

const getNonEmptyString = (value: unknown): string | undefined => {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
};

/** Resolve chart-menu and shortcut actions at click/key time, not render time. */
export const getActiveChartCommandTarget = (
  fallbackSymbol?: string,
  fallbackTimeframe?: string,
): ChartCommandTarget => {
  const activeSource = getActiveChartSource();

  return {
    targetContextId: getNonEmptyString(activeSource?.id),
    symbol: getNonEmptyString(activeSource?.symbol) ?? getNonEmptyString(fallbackSymbol),
    timeframe: getNonEmptyString(activeSource?.timeframe) ?? getNonEmptyString(fallbackTimeframe),
  };
};

const TRADING_CHART_CONTEXT_PREFIX = 'trading-chart:';

export const getPanelIdFromChartContextId = (
  targetContextId: unknown,
): string | undefined => {
  const contextId = getNonEmptyString(targetContextId);
  if (!contextId?.startsWith(TRADING_CHART_CONTEXT_PREFIX)) return undefined;

  return getNonEmptyString(contextId.slice(TRADING_CHART_CONTEXT_PREFIX.length));
};
