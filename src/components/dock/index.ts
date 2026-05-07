/**
 * Docking Layout Components
 * Professional docking system for trading terminals and IDEs
 */

export { DockContainer, FloatingPanelsLayer, GlobalEdgeIndicators } from './DockContainer';
export { DockPanel } from './DockPanel';
export { DockResizeHandle } from './DockResizeHandle';
export { DropZoneOverlay, GhostPreview, GlobalDropZoneOverlay } from './DropZoneOverlay';

// Re-export types
export type { DockContainerProps } from './DockContainer';
export type { DockPanelProps } from './DockPanel';
export type { DockResizeHandleProps } from './DockResizeHandle';
export type { DropZoneOverlayProps } from './DropZoneOverlay';

// Re-export from services
export {
  DockManager,
  dockManager,
  type DockDirection,
  type DockContainerType,
  type DockPanelConfig,
  type DropZone,
  type DockLayout,
} from '../../services/dockManager';

// Re-export from store
export {
  useDockLayoutStore,
  type DragInfo,
  type DragState,
} from '../../store/useDockLayoutStore';

// Re-export hook
export { useDocking, type UseDockingOptions, type UseDockingReturn } from '../../hooks/useDocking';
