import type { DrawingType } from '../services/drawingManager';

export type TrendLineToolGroup = 'Lines' | 'Channels' | 'Pitchforks';

export type TrendLineToolId =
  | 'trendline'
  | 'ray'
  | 'info_line'
  | 'extended_line'
  | 'trend_angle'
  | 'horizontal_line'
  | 'horizontal_ray'
  | 'vertical_line'
  | 'crossline'
  | 'parallel_channel'
  | 'regression_trend'
  | 'flat_top_bottom'
  | 'disjoint_channel'
  | 'pitchfork'
  | 'schiff_pitchfork'
  | 'modified_schiff_pitchfork'
  | 'inside_pitchfork';

export interface TrendLineToolDefinition {
  id: TrendLineToolId;
  label: string;
  group: TrendLineToolGroup;
  drawingType: Extract<DrawingType, 'trendline' | 'hline' | 'vline' | 'channel'>;
  requiredPoints: 1 | 2 | 3;
  shortcut?: string;
}

export const TREND_LINE_TOOL_GROUPS: readonly TrendLineToolGroup[] = [
  'Lines',
  'Channels',
  'Pitchforks',
];

export const TREND_LINE_TOOLS: readonly TrendLineToolDefinition[] = [
  { id: 'trendline', label: 'Trendline', group: 'Lines', drawingType: 'trendline', requiredPoints: 2, shortcut: 'Alt + T' },
  { id: 'ray', label: 'Ray', group: 'Lines', drawingType: 'trendline', requiredPoints: 2 },
  { id: 'info_line', label: 'Info line', group: 'Lines', drawingType: 'trendline', requiredPoints: 2 },
  { id: 'extended_line', label: 'Extended line', group: 'Lines', drawingType: 'trendline', requiredPoints: 2 },
  { id: 'trend_angle', label: 'Trend angle', group: 'Lines', drawingType: 'trendline', requiredPoints: 2 },
  { id: 'horizontal_line', label: 'Horizontal line', group: 'Lines', drawingType: 'hline', requiredPoints: 1, shortcut: 'Alt + H' },
  { id: 'horizontal_ray', label: 'Horizontal ray', group: 'Lines', drawingType: 'hline', requiredPoints: 1, shortcut: 'Alt + J' },
  { id: 'vertical_line', label: 'Vertical line', group: 'Lines', drawingType: 'vline', requiredPoints: 1, shortcut: 'Alt + V' },
  { id: 'crossline', label: 'Crossline', group: 'Lines', drawingType: 'vline', requiredPoints: 1, shortcut: 'Alt + C' },
  { id: 'parallel_channel', label: 'Parallel channel', group: 'Channels', drawingType: 'channel', requiredPoints: 3 },
  { id: 'regression_trend', label: 'Regression trend', group: 'Channels', drawingType: 'channel', requiredPoints: 2 },
  { id: 'flat_top_bottom', label: 'Flat top/bottom', group: 'Channels', drawingType: 'channel', requiredPoints: 3 },
  { id: 'disjoint_channel', label: 'Disjoint channel', group: 'Channels', drawingType: 'channel', requiredPoints: 3 },
  { id: 'pitchfork', label: 'Pitchfork', group: 'Pitchforks', drawingType: 'channel', requiredPoints: 3 },
  { id: 'schiff_pitchfork', label: 'Schiff pitchfork', group: 'Pitchforks', drawingType: 'channel', requiredPoints: 3 },
  { id: 'modified_schiff_pitchfork', label: 'Modified Schiff pitchfork', group: 'Pitchforks', drawingType: 'channel', requiredPoints: 3 },
  { id: 'inside_pitchfork', label: 'Inside pitchfork', group: 'Pitchforks', drawingType: 'channel', requiredPoints: 3 },
] as const;

export const DEFAULT_TREND_LINE_TOOL_ID: TrendLineToolId = 'trendline';

export const getTrendLineTool = (id: string | undefined): TrendLineToolDefinition | undefined =>
  TREND_LINE_TOOLS.find((tool) => tool.id === id);

export const getTrendLineToolFromDrawing = (
  type: DrawingType,
  subtype?: string,
): TrendLineToolDefinition | undefined => {
  const exact = getTrendLineTool(subtype);
  if (exact && exact.drawingType === type) return exact;

  if (type === 'trendline') return getTrendLineTool('trendline');
  if (type === 'hline') return getTrendLineTool('horizontal_line');
  if (type === 'vline') return getTrendLineTool('vertical_line');
  return undefined;
};
