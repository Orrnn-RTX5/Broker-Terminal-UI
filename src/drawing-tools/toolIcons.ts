import {
  AlignHorizontalSpaceAround,
  ArrowRight,
  BetweenHorizontalStart,
  ChartNoAxesCombined,
  Crosshair,
  GitFork,
  Minus,
  MoveDiagonal2,
  Network,
  Rows3,
  Ruler,
  SeparatorVertical,
  Spline,
  Waypoints,
  createLucideIcon,
  type LucideIcon,
} from 'lucide-react';
import type { TrendLineToolId } from './toolCatalog';

const TrendlineIcon = createLucideIcon('Trendline', [
  ['line', { x1: '5.5', y1: '18.5', x2: '18.5', y2: '5.5', key: 'segment' }],
  ['circle', { cx: '4', cy: '20', r: '2', key: 'start' }],
  ['circle', { cx: '20', cy: '4', r: '2', key: 'end' }],
]);

const RayIcon = createLucideIcon('Ray', [
  ['path', { d: 'M5.5 18.5 10.5 13.5M13.5 10.5 22 2', key: 'ray' }],
  ['circle', { cx: '4', cy: '20', r: '2', key: 'origin' }],
  ['circle', { cx: '12', cy: '12', r: '2', key: 'direction' }],
]);

const InfoLineIcon = createLucideIcon('InfoLine', [
  ['line', { x1: '5.5', y1: '18.5', x2: '18.5', y2: '5.5', key: 'segment' }],
  ['circle', { cx: '4', cy: '20', r: '2', key: 'start' }],
  ['circle', { cx: '20', cy: '4', r: '2', key: 'end' }],
  ['rect', { x: '14', y: '15', width: '8', height: '6', rx: '0.5', key: 'panel' }],
]);

export const DRAWING_TOOL_ICONS: Record<TrendLineToolId, LucideIcon> = {
  trendline: TrendlineIcon,
  ray: RayIcon,
  info_line: InfoLineIcon,
  extended_line: MoveDiagonal2,
  trend_angle: Ruler,
  horizontal_line: Minus,
  horizontal_ray: ArrowRight,
  vertical_line: SeparatorVertical,
  crossline: Crosshair,
  parallel_channel: BetweenHorizontalStart,
  regression_trend: ChartNoAxesCombined,
  flat_top_bottom: AlignHorizontalSpaceAround,
  disjoint_channel: Rows3,
  pitchfork: GitFork,
  schiff_pitchfork: Waypoints,
  modified_schiff_pitchfork: Network,
  inside_pitchfork: Spline,
};
