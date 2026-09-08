import type { DrawingType } from '../services/drawingManager';

export const GANN_FIBONACCI_TOOL_GROUPS = ['Fibonacci', 'Gann'] as const;

export type GannFibonacciToolGroup = typeof GANN_FIBONACCI_TOOL_GROUPS[number];

export type GannFibonacciToolId =
  | 'fib_retracement'
  | 'trend_based_fib_extension'
  | 'fib_channel'
  | 'fib_time_zone'
  | 'fib_speed_resistance_fan'
  | 'trend_based_fib_time'
  | 'fib_circles'
  | 'fib_spiral'
  | 'fib_speed_resistance_arcs'
  | 'fib_wedge'
  | 'pitchfan'
  | 'gann_box'
  | 'gann_square_fixed'
  | 'gann_square'
  | 'gann_fan';

export interface GannFibonacciToolDefinition {
  id: GannFibonacciToolId;
  label: string;
  group: GannFibonacciToolGroup;
  drawingType: Extract<DrawingType, 'fibonacci' | 'fib_extension'>;
  requiredPoints: 2 | 3;
  shortcut?: string;
}

/**
 * TradingView's ordered Gann and Fibonacci menu. The five three-anchor tools
 * use the existing `fib_extension` lifecycle; every other variant uses the
 * existing two-anchor `fibonacci` lifecycle. The subtype remains the stable
 * persisted identity for rendering and future settings.
 */
export const GANN_FIBONACCI_TOOLS: readonly GannFibonacciToolDefinition[] = [
  {
    id: 'fib_retracement',
    label: 'Fib retracement',
    group: 'Fibonacci',
    drawingType: 'fibonacci',
    requiredPoints: 2,
    shortcut: 'Alt + F',
  },
  {
    id: 'trend_based_fib_extension',
    label: 'Trend-based fib extension',
    group: 'Fibonacci',
    drawingType: 'fib_extension',
    requiredPoints: 3,
  },
  {
    id: 'fib_channel',
    label: 'Fib channel',
    group: 'Fibonacci',
    drawingType: 'fib_extension',
    requiredPoints: 3,
  },
  {
    id: 'fib_time_zone',
    label: 'Fib time zone',
    group: 'Fibonacci',
    drawingType: 'fibonacci',
    requiredPoints: 2,
  },
  {
    id: 'fib_speed_resistance_fan',
    label: 'Fib speed resistance fan',
    group: 'Fibonacci',
    drawingType: 'fibonacci',
    requiredPoints: 2,
  },
  {
    id: 'trend_based_fib_time',
    label: 'Trend-based fib time',
    group: 'Fibonacci',
    drawingType: 'fib_extension',
    requiredPoints: 3,
  },
  {
    id: 'fib_circles',
    label: 'Fib circles',
    group: 'Fibonacci',
    drawingType: 'fibonacci',
    requiredPoints: 2,
  },
  {
    id: 'fib_spiral',
    label: 'Fib spiral',
    group: 'Fibonacci',
    drawingType: 'fibonacci',
    requiredPoints: 2,
  },
  {
    id: 'fib_speed_resistance_arcs',
    label: 'Fib speed resistance arcs',
    group: 'Fibonacci',
    drawingType: 'fibonacci',
    requiredPoints: 2,
  },
  {
    id: 'fib_wedge',
    label: 'Fib wedge',
    group: 'Fibonacci',
    drawingType: 'fib_extension',
    requiredPoints: 3,
  },
  {
    id: 'pitchfan',
    label: 'Pitchfan',
    group: 'Fibonacci',
    drawingType: 'fib_extension',
    requiredPoints: 3,
  },
  {
    id: 'gann_box',
    label: 'Gann box',
    group: 'Gann',
    drawingType: 'fibonacci',
    requiredPoints: 2,
  },
  {
    id: 'gann_square_fixed',
    label: 'Gann square fixed',
    group: 'Gann',
    drawingType: 'fibonacci',
    requiredPoints: 2,
  },
  {
    id: 'gann_square',
    label: 'Gann square',
    group: 'Gann',
    drawingType: 'fibonacci',
    requiredPoints: 2,
  },
  {
    id: 'gann_fan',
    label: 'Gann fan',
    group: 'Gann',
    drawingType: 'fibonacci',
    requiredPoints: 2,
  },
] as const;

export const getGannFibonacciTool = (
  id: string | undefined,
): GannFibonacciToolDefinition | undefined =>
  GANN_FIBONACCI_TOOLS.find((tool) => tool.id === id);
