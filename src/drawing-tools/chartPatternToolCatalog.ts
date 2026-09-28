import type { Drawing } from './model/drawing';

export const CHART_PATTERN_GROUPS = ['Chart patterns', 'Elliott waves', 'Cycles'] as const;
export interface ChartPatternTool {
  id: string;
  label: string;
  group: typeof CHART_PATTERN_GROUPS[number];
  requiredPoints: number;
  labels?: readonly string[];
  background?: boolean;
}

// Each entry is added after inspecting its TradingView placement recording.
export const CHART_PATTERN_TOOLS: readonly ChartPatternTool[] = [
  { id: 'xabcd_pattern', label: 'XABCD pattern', group: 'Chart patterns', requiredPoints: 5, labels: ['X', 'A', 'B', 'C', 'D'], background: true },
  { id: 'cypher_pattern', label: 'Cypher pattern', group: 'Chart patterns', requiredPoints: 5, labels: ['X', 'A', 'B', 'C', 'D'], background: true },
  { id: 'head_and_shoulders', label: 'Head and shoulders', group: 'Chart patterns', requiredPoints: 7, labels: ['', 'Left Shoulder', '', 'Head', '', 'Right Shoulder', ''], background: true },
  { id: 'abcd_pattern', label: 'ABCD pattern', group: 'Chart patterns', requiredPoints: 4, labels: ['A', 'B', 'C', 'D'] },
  { id: 'triangle_pattern', label: 'Triangle pattern', group: 'Chart patterns', requiredPoints: 4, labels: ['A', 'B', 'C', 'D'], background: true },
  { id: 'three_drives_pattern', label: 'Three drives pattern', group: 'Chart patterns', requiredPoints: 7 },
  { id: 'elliott_impulse', label: 'Elliott impulse wave (1·2·3·4·5)', group: 'Elliott waves', requiredPoints: 6, labels: ['(0)', '(1)', '(2)', '(3)', '(4)', '(5)'] },
  { id: 'elliott_correction', label: 'Elliott correction wave (A·B·C)', group: 'Elliott waves', requiredPoints: 4, labels: ['(0)', '(A)', '(B)', '(C)'] },
  { id: 'elliott_triangle', label: 'Elliott triangle wave (A·B·C·D·E)', group: 'Elliott waves', requiredPoints: 6, labels: ['(0)', '(A)', '(B)', '(C)', '(D)', '(E)'] },
  { id: 'elliott_double_combo', label: 'Elliott double combo wave (W·X·Y)', group: 'Elliott waves', requiredPoints: 4, labels: ['(0)', '(W)', '(X)', '(Y)'] },
  { id: 'elliott_triple_combo', label: 'Elliott triple combo wave (W·X·Y·X·Z)', group: 'Elliott waves', requiredPoints: 6, labels: ['(0)', '(W)', '(X)', '(Y)', '(X)', '(Z)'] },
  { id: 'cyclic_lines', label: 'Cyclic lines', group: 'Cycles', requiredPoints: 2 },
  { id: 'time_cycles', label: 'Time cycles', group: 'Cycles', requiredPoints: 2, background: true },
  { id: 'sine_line', label: 'Sine line', group: 'Cycles', requiredPoints: 2 },
];
export const getChartPatternTool = (drawing: Pick<Drawing, 'type' | 'subtype'> | null | undefined) =>
  drawing?.type === 'pattern' ? CHART_PATTERN_TOOLS.find(tool => tool.id === drawing.subtype) : undefined;
