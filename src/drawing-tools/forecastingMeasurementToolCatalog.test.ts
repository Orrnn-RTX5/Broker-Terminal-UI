import { describe, expect, it } from 'vitest';

import {
  FORECASTING_MEASUREMENT_TOOL_GROUPS,
  FORECASTING_MEASUREMENT_TOOLS,
  getForecastingMeasurementTool,
} from './forecastingMeasurementToolCatalog';

const EXPECTED_TOOLS = [
  ['long_position', 'Long position', 'Forecasting', 1],
  ['short_position', 'Short position', 'Forecasting', 1],
  ['position_forecast', 'Position forecast', 'Forecasting', 2],
  ['bars_pattern', 'Bars pattern', 'Forecasting', 3],
  ['ghost_feed', 'Ghost feed', 'Forecasting', 0],
  ['sector', 'Sector', 'Forecasting', 3],
  ['anchored_vwap', 'Anchored VWAP', 'Volume-based', 1],
  ['fixed_range_volume_profile', 'Fixed range volume profile', 'Volume-based', 2],
  ['anchored_volume_profile', 'Anchored volume profile', 'Volume-based', 1],
  ['price_range', 'Price range', 'Measurers', 2],
  ['date_range', 'Date range', 'Measurers', 2],
  ['date_and_price_range', 'Date and price range', 'Measurers', 2],
] as const;

describe('Forecasting and Measurement drawing-tool catalog', () => {
  it('defines the exact 12 tools in the three ordered menu groups', () => {
    expect(FORECASTING_MEASUREMENT_TOOL_GROUPS).toEqual([
      'Forecasting',
      'Volume-based',
      'Measurers',
    ]);
    expect(FORECASTING_MEASUREMENT_TOOLS).toHaveLength(12);
    expect(new Set(FORECASTING_MEASUREMENT_TOOLS.map((tool) => tool.id)).size).toBe(12);
    expect(new Set(FORECASTING_MEASUREMENT_TOOLS.map((tool) => tool.label)).size).toBe(12);
    expect(
      FORECASTING_MEASUREMENT_TOOLS.map((tool) => [
        tool.id,
        tool.label,
        tool.group,
        tool.requiredPoints,
      ]),
    ).toEqual(EXPECTED_TOOLS);
    expect(FORECASTING_MEASUREMENT_TOOLS.filter((tool) => tool.group === 'Forecasting')).toHaveLength(6);
    expect(FORECASTING_MEASUREMENT_TOOLS.filter((tool) => tool.group === 'Volume-based')).toHaveLength(3);
    expect(FORECASTING_MEASUREMENT_TOOLS.filter((tool) => tool.group === 'Measurers')).toHaveLength(3);
  });

  it('routes every entry through measure and marks only Ghost feed as open-ended', () => {
    expect(FORECASTING_MEASUREMENT_TOOLS.every((tool) => tool.drawingType === 'measure')).toBe(true);
    expect(
      FORECASTING_MEASUREMENT_TOOLS
        .filter((tool) => tool.requiredPoints === 0)
        .map((tool) => tool.id),
    ).toEqual(['ghost_feed']);
  });

  it.each(EXPECTED_TOOLS)(
    '%s resolves to its exact label, group, base type, and point count',
    (id, label, group, requiredPoints) => {
      expect(getForecastingMeasurementTool(id)).toEqual({
        id,
        label,
        group,
        drawingType: 'measure',
        requiredPoints,
      });
    },
  );

  it('does not resolve missing or unknown persisted subtypes as catalog entries', () => {
    expect(getForecastingMeasurementTool(undefined)).toBeUndefined();
    expect(getForecastingMeasurementTool('not-a-forecasting-measurement-tool')).toBeUndefined();
  });
});
