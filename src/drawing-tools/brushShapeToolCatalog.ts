import type { Drawing } from '../services/drawingManager';

export interface BrushShapeTool {
  id: string;
  label: string;
  group: 'Arrows' | 'Shapes';
  requiredPoints: number;
  background?: boolean;
  defaultFill?: boolean;
  minimumPoints?: number;
}

// Add each tool after its TradingView interaction has been observed.
export const BRUSH_SHAPE_TOOLS: readonly BrushShapeTool[] = [
  { id: 'arrow_marker', label: 'Arrow marker', group: 'Arrows', requiredPoints: 2 },
  { id: 'arrow', label: 'Arrow', group: 'Arrows', requiredPoints: 2 },
  { id: 'arrow_mark_up', label: 'Arrow mark up', group: 'Arrows', requiredPoints: 1 },
  { id: 'arrow_mark_down', label: 'Arrow mark down', group: 'Arrows', requiredPoints: 1 },
  { id: 'rectangle', label: 'Rectangle', group: 'Shapes', requiredPoints: 2, background: true },
  { id: 'rotated_rectangle', label: 'Rotated rectangle', group: 'Shapes', requiredPoints: 3, background: true },
  { id: 'path', label: 'Path', group: 'Shapes', requiredPoints: 0, minimumPoints: 2 },
  { id: 'circle', label: 'Circle', group: 'Shapes', requiredPoints: 2, background: true },
  { id: 'ellipse', label: 'Ellipse', group: 'Shapes', requiredPoints: 3, background: true },
  { id: 'polyline', label: 'Polyline', group: 'Shapes', requiredPoints: 0, minimumPoints: 2, background: true, defaultFill: false },
  { id: 'triangle', label: 'Triangle', group: 'Shapes', requiredPoints: 3, background: true },
  { id: 'arc', label: 'Arc', group: 'Shapes', requiredPoints: 3, background: true },
  { id: 'curve', label: 'Curve', group: 'Shapes', requiredPoints: 2 },
  { id: 'double_curve', label: 'Double curve', group: 'Shapes', requiredPoints: 2 },
];
export const getBrushShapeTool = (drawing: Pick<Drawing, 'type' | 'subtype'> | null | undefined) =>
  drawing?.type === 'shapes' ? BRUSH_SHAPE_TOOLS.find(tool => tool.id === drawing.subtype) : undefined;
