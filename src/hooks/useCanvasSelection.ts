/**
 * useCanvasSelection Hook
 * Provides easy access to canvas selection state and actions
 */

import { useCallback, useEffect, useRef } from 'react';
import {
  useCanvasSelectionStore,
  createDefaultSnapZones,
  type Rect,
  type SnapZone,
} from '../store/useCanvasSelectionStore';

export interface UseCanvasSelectionOptions {
  containerWidth?: number;
  containerHeight?: number;
  customSnapZones?: SnapZone[];
  onSelectionChange?: (rect: Rect | null) => void;
  onSelectionConfirm?: (rect: Rect) => void;
  onSelectionCancel?: () => void;
  enableKeyboardShortcuts?: boolean;
}

export interface UseCanvasSelectionReturn {
  // State
  selectionRect: Rect | null;
  mode: 'idle' | 'selecting' | 'selected' | 'moving' | 'resizing' | 'cropping';
  isSnapped: boolean;
  activeSnapZone: SnapZone | null;
  snapGuides: { type: 'vertical' | 'horizontal'; position: number; source: 'center' | 'edge' | 'zone' }[];
  canUndo: boolean;
  canRedo: boolean;
  isCropping: boolean;
  maintainAspectRatio: boolean;
  showSnapGuides: boolean;
  showZoneHighlights: boolean;

  // Actions
  startSelection: (x: number, y: number) => void;
  updateSelection: (x: number, y: number) => void;
  endSelection: () => void;
  clearSelection: () => void;
  confirmSelection: () => void;

  // Move actions
  startMove: (x: number, y: number) => void;
  updateMove: (x: number, y: number, containerBounds: Rect) => void;
  endMove: () => void;

  // Resize actions
  startResize: (handle: 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w' | 'nw' | null, x: number, y: number) => void;
  updateResize: (x: number, y: number, containerBounds: Rect, minSize?: number) => void;
  endResize: () => void;

  // Crop actions
  startCrop: () => void;
  applyCrop: () => void;
  cancelCrop: () => void;

  // History actions
  undo: () => void;
  redo: () => void;

  // Settings
  setMaintainAspectRatio: (value: boolean) => void;
  setShowSnapGuides: (value: boolean) => void;
  setShowZoneHighlights: (value: boolean) => void;
  setSnapZones: (zones: SnapZone[]) => void;

  // Nudge actions
  nudgeUp: (step?: number) => void;
  nudgeDown: (step?: number) => void;
  nudgeLeft: (step?: number) => void;
  nudgeRight: (step?: number) => void;
  expandWidth: (step?: number) => void;
  expandHeight: (step?: number) => void;
  shrinkWidth: (step?: number) => void;
  shrinkHeight: (step?: number) => void;

  // Utils
  initializeSnapZones: (width: number, height: number, customZones?: SnapZone[]) => void;
  isPointInSelection: (x: number, y: number) => boolean;
  getRelativeCoordinates: (clientX: number, clientY: number, containerElement: HTMLElement) => { x: number; y: number };
}

export const useCanvasSelection = (options: UseCanvasSelectionOptions = {}): UseCanvasSelectionReturn => {
  const {
    containerWidth = 800,
    containerHeight = 600,
    customSnapZones,
    onSelectionChange,
    onSelectionConfirm,
    onSelectionCancel,
    enableKeyboardShortcuts = true,
  } = options;

  const containerRef = useRef<HTMLElement | null>(null);

  // Get state from store
  const store = useCanvasSelectionStore();

  // Initialize snap zones on mount
  useEffect(() => {
    const zones = customSnapZones || createDefaultSnapZones(containerWidth, containerHeight);
    store.setSnapZones(zones);
  }, [containerWidth, containerHeight, customSnapZones]);

  // Notify parent of selection changes
  useEffect(() => {
    onSelectionChange?.(store.selectionRect);
  }, [store.selectionRect, onSelectionChange]);

  // Keyboard shortcuts
  useEffect(() => {
    if (!enableKeyboardShortcuts) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      // Undo/Redo
      if ((e.ctrlKey || e.metaKey) && e.key === 'z') {
        e.preventDefault();
        if (e.shiftKey) {
          store.redo();
        } else {
          store.undo();
        }
        return;
      }

      // Confirm/Cancel
      if (e.key === 'Enter') {
        e.preventDefault();
        if (store.isCropping) {
          store.applyCrop();
        } else if (store.selectionRect) {
          onSelectionConfirm?.(store.selectionRect);
        }
        return;
      }

      if (e.key === 'Escape') {
        e.preventDefault();
        if (store.isCropping) {
          store.cancelCrop();
        } else {
          store.clearSelection();
          onSelectionCancel?.();
        }
        return;
      }

      // Arrow key nudging
      if (store.mode === 'selected' && store.selectionRect) {
        const step = e.shiftKey ? 10 : 1;
        switch (e.key) {
          case 'ArrowUp':
            e.preventDefault();
            store.nudgeSelection(0, -step);
            break;
          case 'ArrowDown':
            e.preventDefault();
            store.nudgeSelection(0, step);
            break;
          case 'ArrowLeft':
            e.preventDefault();
            store.nudgeSelection(-step, 0);
            break;
          case 'ArrowRight':
            e.preventDefault();
            store.nudgeSelection(step, 0);
            break;
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [enableKeyboardShortcuts, store, onSelectionConfirm, onSelectionCancel]);

  // Helper: Initialize snap zones
  const initializeSnapZones = useCallback((width: number, height: number, customZones?: SnapZone[]) => {
    const zones = customZones || createDefaultSnapZones(width, height);
    store.setSnapZones(zones);
  }, [store]);

  // Helper: Check if point is in selection
  const isPointInSelection = useCallback((x: number, y: number): boolean => {
    if (!store.selectionRect) return false;
    const { x: sx, y: sy, width, height } = store.selectionRect;
    return x >= sx && x <= sx + width && y >= sy && y <= sy + height;
  }, [store.selectionRect]);

  // Helper: Get relative coordinates
  const getRelativeCoordinates = useCallback((clientX: number, clientY: number, containerElement: HTMLElement): { x: number; y: number } => {
    const rect = containerElement.getBoundingClientRect();
    return {
      x: clientX - rect.left,
      y: clientY - rect.top,
    };
  }, []);

  // Nudge helpers
  const nudgeUp = useCallback((step = 1) => {
    if (store.mode === 'selected') {
      store.nudgeSelection(0, -step);
    }
  }, [store]);

  const nudgeDown = useCallback((step = 1) => {
    if (store.mode === 'selected') {
      store.nudgeSelection(0, step);
    }
  }, [store]);

  const nudgeLeft = useCallback((step = 1) => {
    if (store.mode === 'selected') {
      store.nudgeSelection(-step, 0);
    }
  }, [store]);

  const nudgeRight = useCallback((step = 1) => {
    if (store.mode === 'selected') {
      store.nudgeSelection(step, 0);
    }
  }, [store]);

  const expandWidth = useCallback((step = 10) => {
    if (store.mode === 'selected') {
      store.expandSelection(step, 0);
    }
  }, [store]);

  const expandHeight = useCallback((step = 10) => {
    if (store.mode === 'selected') {
      store.expandSelection(0, step);
    }
  }, [store]);

  const shrinkWidth = useCallback((step = 10) => {
    if (store.mode === 'selected') {
      store.expandSelection(-step, 0);
    }
  }, [store]);

  const shrinkHeight = useCallback((step = 10) => {
    if (store.mode === 'selected') {
      store.expandSelection(0, -step);
    }
  }, [store]);

  // Confirm selection helper
  const confirmSelection = useCallback(() => {
    if (store.selectionRect) {
      onSelectionConfirm?.(store.selectionRect);
    }
  }, [store.selectionRect, onSelectionConfirm]);

  return {
    // State
    selectionRect: store.selectionRect,
    mode: store.mode,
    isSnapped: store.isSnapped,
    activeSnapZone: store.activeSnapZone,
    snapGuides: store.snapGuides,
    canUndo: store.canUndo(),
    canRedo: store.canRedo(),
    isCropping: store.isCropping,
    maintainAspectRatio: store.maintainAspectRatio,
    showSnapGuides: store.showSnapGuides,
    showZoneHighlights: store.showZoneHighlights,

    // Actions
    startSelection: store.startSelection,
    updateSelection: store.updateSelection,
    endSelection: store.endSelection,
    clearSelection: store.clearSelection,
    confirmSelection,

    // Move actions
    startMove: store.startMove,
    updateMove: store.updateMove,
    endMove: store.endMove,

    // Resize actions
    startResize: store.startResize,
    updateResize: store.updateResize,
    endResize: store.endResize,

    // Crop actions
    startCrop: store.startCrop,
    applyCrop: store.applyCrop,
    cancelCrop: store.cancelCrop,

    // History actions
    undo: store.undo,
    redo: store.redo,

    // Settings
    setMaintainAspectRatio: store.setMaintainAspectRatio,
    setShowSnapGuides: store.setShowSnapGuides,
    setShowZoneHighlights: store.setShowZoneHighlights,
    setSnapZones: store.setSnapZones,

    // Nudge actions
    nudgeUp,
    nudgeDown,
    nudgeLeft,
    nudgeRight,
    expandWidth,
    expandHeight,
    shrinkWidth,
    shrinkHeight,

    // Utils
    initializeSnapZones,
    isPointInSelection,
    getRelativeCoordinates,
  };
};

export default useCanvasSelection;
