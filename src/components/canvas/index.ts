/**
 * Canvas Components Export
 */

export { CanvasSelection } from './CanvasSelection';
export { default } from './CanvasSelection';

// Re-export types from store for convenience
export type {
  Rect,
  SnapZone,
  SnapGuide,
  ResizeHandle,
  SelectionMode,
  HistoryState,
} from '../../store/useCanvasSelectionStore';

export { createDefaultSnapZones } from '../../store/useCanvasSelectionStore';
