import type { ChartCursorMode } from '../store/useChartCursorStore';

export interface CursorToolDefinition {
  id: ChartCursorMode;
  label: string;
}

/**
 * Cursor choices exposed in the flyout. The long-press values toggle follows
 * the choices as a separate setting.
 */
export const CURSOR_TOOLS: readonly CursorToolDefinition[] = [
  { id: 'cross', label: 'Cross' },
  { id: 'dot', label: 'Dot' },
  { id: 'arrow', label: 'Arrow' },
  { id: 'magic', label: 'Magic' },
];

export const getCursorTool = (id: string | null | undefined): CursorToolDefinition | null =>
  CURSOR_TOOLS.find((tool) => tool.id === id) ?? null;
