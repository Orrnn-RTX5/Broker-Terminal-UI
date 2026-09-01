import { describe, expect, it } from 'vitest';
import {
  TREND_LINE_TOOL_GROUPS,
  TREND_LINE_TOOLS,
  getTrendLineTool,
  getTrendLineToolFromDrawing,
} from './toolCatalog';

const EXPECTED_TOOLS = [
  ['trendline', 'Lines', 'trendline', 2, 'Alt + T'],
  ['ray', 'Lines', 'trendline', 2, undefined],
  ['info_line', 'Lines', 'trendline', 2, undefined],
  ['extended_line', 'Lines', 'trendline', 2, undefined],
  ['trend_angle', 'Lines', 'trendline', 2, undefined],
  ['horizontal_line', 'Lines', 'hline', 1, 'Alt + H'],
  ['horizontal_ray', 'Lines', 'hline', 1, 'Alt + J'],
  ['vertical_line', 'Lines', 'vline', 1, 'Alt + V'],
  ['crossline', 'Lines', 'vline', 1, 'Alt + C'],
  ['parallel_channel', 'Channels', 'channel', 3, undefined],
  ['regression_trend', 'Channels', 'channel', 2, undefined],
  ['flat_top_bottom', 'Channels', 'channel', 3, undefined],
  ['disjoint_channel', 'Channels', 'channel', 3, undefined],
  ['pitchfork', 'Pitchforks', 'channel', 3, undefined],
  ['schiff_pitchfork', 'Pitchforks', 'channel', 3, undefined],
  ['modified_schiff_pitchfork', 'Pitchforks', 'channel', 3, undefined],
  ['inside_pitchfork', 'Pitchforks', 'channel', 3, undefined],
] as const;

describe('drawing-tool catalog', () => {
  it('defines the exact 17 Lines, Channels, and Pitchforks in menu order', () => {
    expect(TREND_LINE_TOOL_GROUPS).toEqual(['Lines', 'Channels', 'Pitchforks']);
    expect(TREND_LINE_TOOLS).toHaveLength(17);
    expect(new Set(TREND_LINE_TOOLS.map((tool) => tool.id)).size).toBe(17);
    expect(
      TREND_LINE_TOOLS.map((tool) => [
        tool.id,
        tool.group,
        tool.drawingType,
        tool.requiredPoints,
        tool.shortcut,
      ]),
    ).toEqual(EXPECTED_TOOLS);
    expect(TREND_LINE_TOOLS.filter((tool) => tool.group === 'Lines')).toHaveLength(9);
    expect(TREND_LINE_TOOLS.filter((tool) => tool.group === 'Channels')).toHaveLength(4);
    expect(TREND_LINE_TOOLS.filter((tool) => tool.group === 'Pitchforks')).toHaveLength(4);
  });

  it.each(EXPECTED_TOOLS)(
    '%s resolves to %s / %s and requires %i anchor points',
    (id, group, drawingType, requiredPoints, shortcut) => {
      expect(getTrendLineTool(id)).toMatchObject({
        id,
        group,
        drawingType,
        requiredPoints,
        ...(shortcut ? { shortcut } : {}),
      });
      expect(getTrendLineToolFromDrawing(drawingType, id)?.id).toBe(id);
    },
  );

  it('uses stable legacy fallbacks only when no exact subtype is available', () => {
    expect(getTrendLineToolFromDrawing('trendline')?.id).toBe('trendline');
    expect(getTrendLineToolFromDrawing('hline')?.id).toBe('horizontal_line');
    expect(getTrendLineToolFromDrawing('vline')?.id).toBe('vertical_line');
    expect(getTrendLineToolFromDrawing('channel')).toBeUndefined();
    expect(getTrendLineTool('not-a-tool')).toBeUndefined();
  });
});
