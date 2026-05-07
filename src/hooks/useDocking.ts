/**
 * useDocking Hook
 * Provides easy access to docking functionality
 */

import { useCallback, useEffect, useRef } from 'react';
import { useDockLayoutStore, DragInfo } from '../store/useDockLayoutStore';
import { DockManager, dockManager, DockPanelConfig, DockDirection, DockLayout, DropZone } from '../services/dockManager';

export interface UseDockingOptions {
  onLayoutChange?: (layout: DockLayout) => void;
  onPanelAdd?: (panel: DockPanelConfig) => void;
  onPanelRemove?: (panelId: string) => void;
  onPanelFloat?: (panelId: string) => void;
  onPanelDock?: (panelId: string, targetId: string, direction: DockDirection) => void;
  persistKey?: string;
}

export interface UseDockingReturn {
  // State
  layout: DockLayout;
  isDragging: boolean;
  dragInfo: DragInfo | null;
  activeDropZone: DropZone | null;

  // Panel Management
  addPanel: (panel: DockPanelConfig, targetId?: string, direction?: DockDirection) => void;
  removePanel: (panelId: string) => void;
  dockPanel: (panelId: string, targetId: string, direction: DockDirection) => void;
  floatPanel: (panelId: string, position?: { x: number; y: number }) => void;
  moveToTab: (panelId: string, tabContainerId: string, insertIndex?: number) => void;

  // Drag Operations
  startDrag: (panelId: string, title: string, x: number, y: number, isFloating?: boolean) => void;
  updateDrag: (x: number, y: number) => void;
  endDrag: (targetId?: string, direction?: DockDirection) => void;
  cancelDrag: () => void;

  // History
  undo: () => void;
  redo: () => void;
  canUndo: boolean;
  canRedo: boolean;

  // Persistence
  saveLayout: () => void;
  loadLayout: () => boolean;
  setLayout: (layout: DockLayout) => void;

  // Utilities
  findDropZoneAtPoint: (x: number, y: number, containerRects: Map<string, { x: number; y: number; width: number; height: number }>) => ReturnType<DockManager['findDropZoneAtPoint']>;
}

export const useDocking = (options: UseDockingOptions = {}): UseDockingReturn => {
  const { onLayoutChange, onPanelAdd, onPanelRemove, onPanelFloat, onPanelDock, persistKey } = options;
  const callbacksRef = useRef(options);
  callbacksRef.current = options;

  // Get state from store
  const store = useDockLayoutStore();

  // Notify on layout change
  useEffect(() => {
    onLayoutChange?.(store.layout);
  }, [store.layout, onLayoutChange]);

  // Load saved layout on mount
  useEffect(() => {
    if (persistKey) {
      const loaded = dockManager.loadFromStorage(persistKey);
      if (loaded) {
        store.setLayout(dockManager.getLayout());
      }
    }
  }, [persistKey]);

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Undo/Redo
      if ((e.ctrlKey || e.metaKey) && e.key === 'z') {
        e.preventDefault();
        if (e.shiftKey) {
          store.redo();
        } else {
          store.undo();
        }
      }

      // Cancel drag
      if (e.key === 'Escape' && store.dragState === 'dragging') {
        store.cancelDrag();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [store]);

  // Wrapped actions with callbacks
  const addPanel = useCallback((panel: DockPanelConfig, targetId?: string, direction?: DockDirection) => {
    store.addPanel(panel, targetId, direction);
    onPanelAdd?.(panel);
  }, [store, onPanelAdd]);

  const removePanel = useCallback((panelId: string) => {
    store.removePanel(panelId);
    onPanelRemove?.(panelId);
  }, [store, onPanelRemove]);

  const dockPanel = useCallback((panelId: string, targetId: string, direction: DockDirection) => {
    store.dockPanel(panelId, targetId, direction);
    onPanelDock?.(panelId, targetId, direction);
  }, [store, onPanelDock]);

  const floatPanel = useCallback((panelId: string, position?: { x: number; y: number }) => {
    store.floatPanel(panelId, position);
    onPanelFloat?.(panelId);
  }, [store, onPanelFloat]);

  // Persistence
  const saveLayout = useCallback(() => {
    if (persistKey) {
      dockManager.saveToStorage(persistKey);
    } else {
      dockManager.saveToStorage();
    }
  }, [persistKey]);

  const loadLayout = useCallback(() => {
    const loaded = persistKey
      ? dockManager.loadFromStorage(persistKey)
      : dockManager.loadFromStorage();
    if (loaded) {
      store.setLayout(dockManager.getLayout());
    }
    return loaded;
  }, [persistKey, store]);


  const findDropZoneAtPoint = useCallback((x: number, y: number, containerRects: Map<string, { x: number; y: number; width: number; height: number }>) => {
    return dockManager.findDropZoneAtPoint(x, y, containerRects);
  }, []);

  return {
    // State
    layout: store.layout,
    isDragging: store.dragState === 'dragging',
    dragInfo: store.dragInfo,
    activeDropZone: store.activeDropZone,

    // Panel Management
    addPanel,
    removePanel,
    dockPanel,
    floatPanel,
    moveToTab: store.moveToTab,

    // Drag Operations
    startDrag: store.startDrag,
    updateDrag: store.updateDrag,
    endDrag: store.endDrag,
    cancelDrag: store.cancelDrag,

    // History
    undo: store.undo,
    redo: store.redo,
    canUndo: store.canUndo(),
    canRedo: store.canRedo(),

    // Persistence
    saveLayout,
    loadLayout,
    setLayout: store.setLayout,

    // Utilities
    findDropZoneAtPoint,
  };
};

export default useDocking;
