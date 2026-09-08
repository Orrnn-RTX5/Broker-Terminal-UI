import type { DrawingType } from '../services/drawingManager';

export const FORECASTING_MEASUREMENT_TOOL_GROUPS = [
  'Forecasting',
  'Volume-based',
  'Measurers',
] as const;

export type ForecastingMeasurementToolGroup =
  typeof FORECASTING_MEASUREMENT_TOOL_GROUPS[number];

export type ForecastingMeasurementToolId =
  | 'long_position'
  | 'short_position'
  | 'position_forecast'
  | 'bars_pattern'
  | 'ghost_feed'
  | 'sector'
  | 'anchored_vwap'
  | 'fixed_range_volume_profile'
  | 'anchored_volume_profile'
  | 'price_range'
  | 'date_range'
  | 'date_and_price_range';

export interface ForecastingMeasurementToolDefinition {
  id: ForecastingMeasurementToolId;
  label: string;
  group: ForecastingMeasurementToolGroup;
  drawingType: Extract<DrawingType, 'measure'>;
  /** Zero marks an open-ended multi-click tool that finishes explicitly. */
  requiredPoints: 0 | 1 | 2 | 3;
}

/**
 * Ordered Forecasting and Measurement menu. Every entry reuses the existing
 * `measure` command path; subtype is the stable identity used by the renderer.
 */
export const FORECASTING_MEASUREMENT_TOOLS:
readonly ForecastingMeasurementToolDefinition[] = [
  {
    id: 'long_position',
    label: 'Long position',
    group: 'Forecasting',
    drawingType: 'measure',
    requiredPoints: 1,
  },
  {
    id: 'short_position',
    label: 'Short position',
    group: 'Forecasting',
    drawingType: 'measure',
    requiredPoints: 1,
  },
  {
    id: 'position_forecast',
    label: 'Position forecast',
    group: 'Forecasting',
    drawingType: 'measure',
    requiredPoints: 2,
  },
  {
    id: 'bars_pattern',
    label: 'Bars pattern',
    group: 'Forecasting',
    drawingType: 'measure',
    requiredPoints: 3,
  },
  {
    id: 'ghost_feed',
    label: 'Ghost feed',
    group: 'Forecasting',
    drawingType: 'measure',
    requiredPoints: 0,
  },
  {
    id: 'sector',
    label: 'Sector',
    group: 'Forecasting',
    drawingType: 'measure',
    requiredPoints: 3,
  },
  {
    id: 'anchored_vwap',
    label: 'Anchored VWAP',
    group: 'Volume-based',
    drawingType: 'measure',
    requiredPoints: 1,
  },
  {
    id: 'fixed_range_volume_profile',
    label: 'Fixed range volume profile',
    group: 'Volume-based',
    drawingType: 'measure',
    requiredPoints: 2,
  },
  {
    id: 'anchored_volume_profile',
    label: 'Anchored volume profile',
    group: 'Volume-based',
    drawingType: 'measure',
    requiredPoints: 1,
  },
  {
    id: 'price_range',
    label: 'Price range',
    group: 'Measurers',
    drawingType: 'measure',
    requiredPoints: 2,
  },
  {
    id: 'date_range',
    label: 'Date range',
    group: 'Measurers',
    drawingType: 'measure',
    requiredPoints: 2,
  },
  {
    id: 'date_and_price_range',
    label: 'Date and price range',
    group: 'Measurers',
    drawingType: 'measure',
    requiredPoints: 2,
  },
] as const;

export const getForecastingMeasurementTool = (
  id: string | undefined,
): ForecastingMeasurementToolDefinition | undefined =>
  FORECASTING_MEASUREMENT_TOOLS.find((tool) => tool.id === id);
