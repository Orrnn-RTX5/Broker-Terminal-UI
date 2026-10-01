import type { ChartCursorMode } from '../store/useChartCursorStore';

export interface CursorToolDefinition {
  id: ChartCursorMode;
  label: string;
}

/**
 * Order matches the TradingView Cursors flyout. Eraser sits below a separator.
 * The long-press values toggle is a setting rendered after that, not a pointer.
 */
export const CURSOR_TOOLS: readonly CursorToolDefinition[] = [
  { id: 'cross', label: 'Cross' },
  { id: 'dot', label: 'Dot' },
  { id: 'arrow', label: 'Arrow' },
  { id: 'demonstration', label: 'Demonstration' },
  { id: 'magic', label: 'Magic' },
  { id: 'eraser', label: 'Eraser' },
];

export const getCursorTool = (id: string | null | undefined): CursorToolDefinition | null =>
  CURSOR_TOOLS.find((tool) => tool.id === id) ?? null;
