/**
 * Canvas Selection Store
 * Professional trading-style canvas selection with drag, resize, crop, and snap
 */

import { create } from 'zustand';
import { devtools } from 'zustand/middleware';

export type SelectionMode = 'idle' | 'selecting' | 'selected' | 'moving' | 'resizing' | 'cropping';
export type ResizeHandle = 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w' | 'nw' | null;

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface SnapZone {
  id: string;
  label: string;
  rect: Rect;
  priority: number;
}

export interface SnapGuide {
  type: 'vertical' | 'horizontal';
  position: number;
  source: 'center' | 'edge' | 'zone';
}

export interface HistoryState {
  rect: Rect | null;
  mode: SelectionMode;
  timestamp: number;
}

interface CanvasSelectionState {
  // Selection State
  mode: SelectionMode;
  selectionRect: Rect | null;
  initialSelectionRect: Rect | null;

  // Interaction State
  resizeHandle: ResizeHandle;
  dragStart: { x: number; y: number } | null;
  dragOffset: { x: number; y: number };

  // Snap System
  snapZones: SnapZone[];
  activeSnapZone: SnapZone | null;
  snapGuides: SnapGuide[];
  snapThreshold: number;
  isSnapped: boolean;

  // Crop State
  cropRect: Rect | null;
  isCropping: boolean;

  // History for Undo/Redo
  history: HistoryState[];
  historyIndex: number;
  maxHistorySize: number;

  // Settings
  maintainAspectRatio: boolean;
  showSnapGuides: boolean;
  showZoneHighlights: boolean;
  animationEnabled: boolean;

  // Actions
  startSelection: (x: number, y: number) => void;
  updateSelection: (x: number, y: number) => void;
  endSelection: () => void;

  startMove: (x: number, y: number) => void;
  updateMove: (x: number, y: number, containerBounds: Rect) => void;
  endMove: () => void;

  startResize: (handle: ResizeHandle, x: number, y: number) => void;
  updateResize: (x: number, y: number, containerBounds: Rect, minSize?: number) => void;
  endResize: () => void;

  startCrop: () => void;
  updateCrop: (rect: Rect) => void;
  applyCrop: () => void;
  cancelCrop: () => void;

  setSnapZones: (zones: SnapZone[]) => void;
  updateSnapGuides: (rect: Rect, containerBounds: Rect) => void;
  clearSnapGuides: () => void;

  undo: () => void;
  redo: () => void;
  canUndo: () => boolean;
  canRedo: () => boolean;
  pushHistory: () => void;

  clearSelection: () => void;
  setSelectionRect: (rect: Rect | null) => void;

  setMaintainAspectRatio: (value: boolean) => void;
  setShowSnapGuides: (value: boolean) => void;
  setShowZoneHighlights: (value: boolean) => void;
  setAnimationEnabled: (value: boolean) => void;
  setSnapThreshold: (value: number) => void;

  // Keyboard Actions
  nudgeSelection: (dx: number, dy: number) => void;
  expandSelection: (dw: number, dh: number) => void;
}

const initialState = {
  mode: 'idle' as SelectionMode,
  selectionRect: null as Rect | null,
  initialSelectionRect: null as Rect | null,
  resizeHandle: null as ResizeHandle,
  dragStart: null as { x: number; y: number } | null,
  dragOffset: { x: 0, y: 0 },
  snapZones: [] as SnapZone[],
  activeSnapZone: null as SnapZone | null,
  snapGuides: [] as SnapGuide[],
  snapThreshold: 10,
  isSnapped: false,
  cropRect: null as Rect | null,
  isCropping: false,
  history: [] as HistoryState[],
  historyIndex: -1,
  maxHistorySize: 50,
  maintainAspectRatio: false,
  showSnapGuides: true,
  showZoneHighlights: true,
  animationEnabled: true,
};

export const useCanvasSelectionStore = create<CanvasSelectionState>()(
  devtools(
    (set, get) => ({
      ...initialState,

      startSelection: (x, y) => set({
        mode: 'selecting',
        dragStart: { x, y },
        selectionRect: { x, y, width: 0, height: 0 },
        initialSelectionRect: { x, y, width: 0, height: 0 },
        activeSnapZone: null,
        isSnapped: false,
      }),

      updateSelection: (x, y) => {
        const { dragStart } = get();
        if (!dragStart) return;

        const width = Math.abs(x - dragStart.x);
        const height = Math.abs(y - dragStart.y);
        const selX = Math.min(x, dragStart.x);
        const selY = Math.min(y, dragStart.y);

        set({
          selectionRect: { x: selX, y: selY, width, height },
        });
      },

      endSelection: () => {
        const { selectionRect, pushHistory } = get();
        if (selectionRect && selectionRect.width > 5 && selectionRect.height > 5) {
          pushHistory();
          set({
            mode: 'selected',
            dragStart: null,
          });
        } else {
          set({
            mode: 'idle',
            selectionRect: null,
            dragStart: null,
          });
        }
      },

      startMove: (x, y) => {
        const { selectionRect, pushHistory } = get();
        if (!selectionRect) return;

        pushHistory();
        set({
          mode: 'moving',
          dragStart: { x, y },
          dragOffset: {
            x: x - selectionRect.x,
            y: y - selectionRect.y,
          },
          initialSelectionRect: { ...selectionRect },
        });
      },

      updateMove: (x, y, containerBounds) => {
        const { dragOffset, snapZones, snapThreshold, updateSnapGuides, showSnapGuides } = get();

        let newX = x - dragOffset.x;
        let newY = y - dragOffset.y;
        let isSnapped = false;
        let activeZone: SnapZone | null = null;

        // Constrain to container
        newX = Math.max(0, Math.min(newX, containerBounds.width - (get().selectionRect?.width || 0)));
        newY = Math.max(0, Math.min(newY, containerBounds.height - (get().selectionRect?.height || 0)));

        // Check snap to zones
        const currentRect = get().selectionRect;
        if (currentRect) {
          const testRect = { ...currentRect, x: newX, y: newY };

          for (const zone of snapZones) {
            const centerX = testRect.x + testRect.width / 2;
            const centerY = testRect.y + testRect.height / 2;
            const zoneCenterX = zone.rect.x + zone.rect.width / 2;
            const zoneCenterY = zone.rect.y + zone.rect.height / 2;

            const distX = Math.abs(centerX - zoneCenterX);
            const distY = Math.abs(centerY - zoneCenterY);

            if (distX < snapThreshold && distY < snapThreshold) {
              newX = zone.rect.x + (zone.rect.width - testRect.width) / 2;
              newY = zone.rect.y + (zone.rect.height - testRect.height) / 2;
              isSnapped = true;
              activeZone = zone;
              break;
            }
          }

          // Update snap guides
          if (showSnapGuides) {
            updateSnapGuides({ ...testRect, x: newX, y: newY }, containerBounds);
          }
        }

        set({
          selectionRect: { ...(get().selectionRect as Rect), x: newX, y: newY },
          isSnapped,
          activeSnapZone: activeZone,
        });
      },

      endMove: () => set({
        mode: 'selected',
        dragStart: null,
        isSnapped: false,
        activeSnapZone: null,
      }),

      startResize: (handle, x, y) => {
        const { selectionRect, pushHistory } = get();
        if (!selectionRect) return;

        pushHistory();
        set({
          mode: 'resizing',
          resizeHandle: handle,
          dragStart: { x, y },
          initialSelectionRect: { ...selectionRect },
        });
      },

      updateResize: (x, y, containerBounds, minSize = 20) => {
        const { resizeHandle, initialSelectionRect, maintainAspectRatio } = get();
        if (!initialSelectionRect || !resizeHandle) return;

        const dx = x - (get().dragStart?.x || x);
        const dy = y - (get().dragStart?.y || y);

        let newX = initialSelectionRect.x;
        let newY = initialSelectionRect.y;
        let newW = initialSelectionRect.width;
        let newH = initialSelectionRect.height;

        // Calculate new dimensions based on resize handle
        if (resizeHandle.includes('e')) {
          newW = Math.max(minSize, initialSelectionRect.width + dx);
        }
        if (resizeHandle.includes('w')) {
          const newWidth = Math.max(minSize, initialSelectionRect.width - dx);
          newX = initialSelectionRect.x + initialSelectionRect.width - newWidth;
          newW = newWidth;
        }
        if (resizeHandle.includes('s')) {
          newH = Math.max(minSize, initialSelectionRect.height + dy);
        }
        if (resizeHandle.includes('n')) {
          const newHeight = Math.max(minSize, initialSelectionRect.height - dy);
          newY = initialSelectionRect.y + initialSelectionRect.height - newHeight;
          newH = newHeight;
        }

        // Maintain aspect ratio if enabled
        if (maintainAspectRatio) {
          const aspect = initialSelectionRect.width / initialSelectionRect.height;
          if (Math.abs(dx) > Math.abs(dy)) {
            newH = newW / aspect;
          } else {
            newW = newH * aspect;
          }
        }

        // Constrain to container
        newX = Math.max(0, Math.min(newX, containerBounds.width - newW));
        newY = Math.max(0, Math.min(newY, containerBounds.height - newH));
        newW = Math.min(newW, containerBounds.width - newX);
        newH = Math.min(newH, containerBounds.height - newY);

        set({
          selectionRect: { x: newX, y: newY, width: newW, height: newH },
        });
      },

      endResize: () => set({
        mode: 'selected',
        resizeHandle: null,
        dragStart: null,
      }),

      startCrop: () => {
        const { selectionRect, pushHistory } = get();
        if (!selectionRect) return;

        pushHistory();
        set({
          mode: 'cropping',
          isCropping: true,
          cropRect: { ...selectionRect },
        });
      },

      updateCrop: (rect) => set({
        cropRect: rect,
      }),

      applyCrop: () => {
        const { cropRect } = get();
        if (cropRect) {
          set({
            selectionRect: cropRect,
            mode: 'selected',
            isCropping: false,
            cropRect: null,
          });
        }
      },

      cancelCrop: () => set({
        mode: 'selected',
        isCropping: false,
        cropRect: null,
      }),

      setSnapZones: (zones) => set({ snapZones: zones }),

      updateSnapGuides: (rect, containerBounds) => {
        const guides: SnapGuide[] = [];
        const centerX = rect.x + rect.width / 2;
        const centerY = rect.y + rect.height / 2;
        const containerCenterX = containerBounds.width / 2;
        const containerCenterY = containerBounds.height / 2;

        // Center alignment guides
        if (Math.abs(centerX - containerCenterX) < 10) {
          guides.push({ type: 'vertical', position: containerCenterX, source: 'center' });
        }
        if (Math.abs(centerY - containerCenterY) < 10) {
          guides.push({ type: 'horizontal', position: containerCenterY, source: 'center' });
        }

        // Edge alignment guides
        if (Math.abs(rect.x) < 10) {
          guides.push({ type: 'vertical', position: 0, source: 'edge' });
        }
        if (Math.abs(rect.x + rect.width - containerBounds.width) < 10) {
          guides.push({ type: 'vertical', position: containerBounds.width, source: 'edge' });
        }
        if (Math.abs(rect.y) < 10) {
          guides.push({ type: 'horizontal', position: 0, source: 'edge' });
        }
        if (Math.abs(rect.y + rect.height - containerBounds.height) < 10) {
          guides.push({ type: 'horizontal', position: containerBounds.height, source: 'edge' });
        }

        set({ snapGuides: guides });
      },

      clearSnapGuides: () => set({ snapGuides: [], isSnapped: false }),

      pushHistory: () => {
        const { selectionRect, mode, history, historyIndex, maxHistorySize } = get();

        const newState: HistoryState = {
          rect: selectionRect ? { ...selectionRect } : null,
          mode,
          timestamp: Date.now(),
        };

        // Remove any future history if we're not at the end
        const newHistory = history.slice(0, historyIndex + 1);
        newHistory.push(newState);

        // Limit history size
        if (newHistory.length > maxHistorySize) {
          newHistory.shift();
        }

        set({
          history: newHistory,
          historyIndex: newHistory.length - 1,
        });
      },

      undo: () => {
        const { historyIndex, history } = get();
        if (historyIndex > 0) {
          const prevState = history[historyIndex - 1];
          set({
            historyIndex: historyIndex - 1,
            selectionRect: prevState.rect ? { ...prevState.rect } : null,
            mode: prevState.mode,
          });
        }
      },

      redo: () => {
        const { historyIndex, history } = get();
        if (historyIndex < history.length - 1) {
          const nextState = history[historyIndex + 1];
          set({
            historyIndex: historyIndex + 1,
            selectionRect: nextState.rect ? { ...nextState.rect } : null,
            mode: nextState.mode,
          });
        }
      },

      canUndo: () => get().historyIndex > 0,
      canRedo: () => get().historyIndex < get().history.length - 1,

      clearSelection: () => set({
        mode: 'idle',
        selectionRect: null,
        initialSelectionRect: null,
        cropRect: null,
        isCropping: false,
        activeSnapZone: null,
        snapGuides: [],
      }),

      setSelectionRect: (rect) => set({
        selectionRect: rect,
        mode: rect ? 'selected' : 'idle',
      }),

      setMaintainAspectRatio: (value) => set({ maintainAspectRatio: value }),
      setShowSnapGuides: (value) => set({ showSnapGuides: value }),
      setShowZoneHighlights: (value) => set({ showZoneHighlights: value }),
      setAnimationEnabled: (value) => set({ animationEnabled: value }),
      setSnapThreshold: (value) => set({ snapThreshold: value }),

      nudgeSelection: (dx, dy) => {
        const { selectionRect, mode } = get();
        if (!selectionRect || mode !== 'selected') return;

        set({
          selectionRect: {
            ...selectionRect,
            x: selectionRect.x + dx,
            y: selectionRect.y + dy,
          },
        });
      },

      expandSelection: (dw, dh) => {
        const { selectionRect, mode } = get();
        if (!selectionRect || mode !== 'selected') return;

        set({
          selectionRect: {
            ...selectionRect,
            width: Math.max(20, selectionRect.width + dw),
            height: Math.max(20, selectionRect.height + dh),
          },
        });
      },
    }),
    { name: 'canvas-selection-store' }
  )
);

// Helper hook for accessing snap zones
export const createDefaultSnapZones = (containerWidth: number, containerHeight: number): SnapZone[] => {
  const zones: SnapZone[] = [
    // Corners
    { id: 'top-left', label: 'Top Left', rect: { x: 0, y: 0, width: containerWidth * 0.3, height: containerHeight * 0.3 }, priority: 1 },
    { id: 'top-right', label: 'Top Right', rect: { x: containerWidth * 0.7, y: 0, width: containerWidth * 0.3, height: containerHeight * 0.3 }, priority: 1 },
    { id: 'bottom-left', label: 'Bottom Left', rect: { x: 0, y: containerHeight * 0.7, width: containerWidth * 0.3, height: containerHeight * 0.3 }, priority: 1 },
    { id: 'bottom-right', label: 'Bottom Right', rect: { x: containerWidth * 0.7, y: containerHeight * 0.7, width: containerWidth * 0.3, height: containerHeight * 0.3 }, priority: 1 },

    // Center
    { id: 'center', label: 'Center', rect: { x: containerWidth * 0.25, y: containerHeight * 0.25, width: containerWidth * 0.5, height: containerHeight * 0.5 }, priority: 2 },

    // Sidebar zones
    { id: 'left-sidebar', label: 'Left Sidebar', rect: { x: 0, y: containerHeight * 0.2, width: containerWidth * 0.25, height: containerHeight * 0.6 }, priority: 1 },
    { id: 'right-sidebar', label: 'Right Sidebar', rect: { x: containerWidth * 0.75, y: containerHeight * 0.2, width: containerWidth * 0.25, height: containerHeight * 0.6 }, priority: 1 },

    // Top/Bottom bars
    { id: 'top-bar', label: 'Top Bar', rect: { x: containerWidth * 0.2, y: 0, width: containerWidth * 0.6, height: containerHeight * 0.2 }, priority: 1 },
    { id: 'bottom-bar', label: 'Bottom Bar', rect: { x: containerWidth * 0.2, y: containerHeight * 0.8, width: containerWidth * 0.6, height: containerHeight * 0.2 }, priority: 1 },
  ];

  return zones;
};
