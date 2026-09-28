import type { ChartProperties } from '../../../store/useChartSettingsStore';

const SUPPORTED_CHART_INDICATOR_TYPES = new Set([
  'ma',
  'sma',
  'ema',
  'rsi',
  'macd',
  'bb',
  'bollinger',
]);

export interface AddChartIndicatorRequest {
  id?: string;
  name: string;
  indicatorType?: string;
  params?: Record<string, unknown>;
}

export const getFixedChartPriceRange = (
  settings: Pick<ChartProperties, 'scaleFix' | 'fixedMinimum' | 'fixedMaximum'>,
): { from: number; to: number } | null => {
  const from = Number(settings.fixedMinimum);
  const to = Number(settings.fixedMaximum);
  return settings.scaleFix && Number.isFinite(from) && Number.isFinite(to) && to > from
    ? { from, to }
    : null;
};

export const resolveChartIndicatorType = (
  request: AddChartIndicatorRequest,
): string | null => {
  const explicitType = request.indicatorType?.trim().toLowerCase();
  if (explicitType && SUPPORTED_CHART_INDICATOR_TYPES.has(explicitType)) return explicitType;

  const idType = request.id?.split('-')[0]?.trim().toLowerCase();
  if (idType && SUPPORTED_CHART_INDICATOR_TYPES.has(idType)) return idType;

  const normalizedName = request.name.trim().toLowerCase();
  if (normalizedName.includes('bollinger')) return 'bb';
  if (normalizedName.includes('exponential') || normalizedName === 'ema') return 'ema';
  if (normalizedName.includes('moving average') || normalizedName === 'ma' || normalizedName.includes('sma')) return 'sma';
  if (normalizedName.includes('relative strength') || normalizedName === 'rsi') return 'rsi';
  if (normalizedName.includes('macd')) return 'macd';
  return null;
};
