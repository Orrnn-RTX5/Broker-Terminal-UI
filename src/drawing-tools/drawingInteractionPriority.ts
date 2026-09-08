import type { Drawing } from '../services/drawingManager';
import { getTrendLineToolFromDrawing } from './toolCatalog';
import { getBrushShapeTool } from './brushShapeToolCatalog';

/** Anchor tools must retain mouse presses even when movement cancels a chart click. */
export const usesDirectDrawingPointerInput = (drawing: Pick<Drawing, 'type' | 'subtype'> | null | undefined): boolean =>
  Boolean(drawing && (
    getTrendLineToolFromDrawing(drawing.type, drawing.subtype)
    || getBrushShapeTool(drawing)
    || drawing.type === 'freehand'
    || drawing.type === 'fibonacci'
    || drawing.type === 'fib_extension'
    || (drawing.type === 'measure'
      && (drawing.subtype === 'long_position' || drawing.subtype === 'short_position'))
  ));

const getChartWrapper = (container: HTMLElement | null): HTMLElement | null =>
  container?.closest<HTMLElement>('.rtx-chart-wrapper') ?? null;

/** Scope drawing input priority to the panel that accepted the tool command. */
export const setTrendDrawingInputActive = (container: HTMLElement | null, active: boolean): void => {
  const wrapper = getChartWrapper(container);
  if (!wrapper) return;
  if (active) wrapper.dataset.trendDrawingActive = 'true';
  else delete wrapper.dataset.trendDrawingActive;
};

export const isTrendDrawingInputActive = (container: HTMLElement | null): boolean =>
  getChartWrapper(container)?.dataset.trendDrawingActive === 'true';
