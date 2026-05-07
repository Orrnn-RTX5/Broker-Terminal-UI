/**
 * Dock Layout Store
 * Zustand store for managing docking layout state
 * Integrates with DockManager for layout operations
 */

import { create } from 'zustand';
import { devtools, persist } from 'zustand/middleware';
import { DockManager, dockManager, DockLayout, DockPanelConfig, DropZone, DockDirection } from '../services/dockManager';

export type DragState = 'idle' | 'dragging' | 'dropping';

export interface DragInfo {
  panelId: string;
  panelTitle: string;
  startX: number;
  startY: number;
  currentX: number;
  currentY: number;
  offsetX: number;
  offsetY: number;
  isFloating: boolean;
}

export interface DockState {
  // Layout
  layout: DockLayout;

  // Drag State
  dragState: DragState;
  dragInfo: DragInfo | null;
  activeDropZone: DropZone | null;
  dropZones: DropZone[];

  // Hover State
  hoveredContainerId: string | null;
  dropTargetId: string | null;
  compassDir: string | null;

  // Resizing State
  resizingContainerId: string | null;
  resizeDirection: 'horizontal' | 'vertical' | null;

  // UI State
  showDropIndicators: boolean;
  ghostPreview: {
    visible: boolean;
    x: number;
    y: number;
    width: number;
    height: number;
  };

  // Actions
  setLayout: (layout: DockLayout) => void;

  // Drag Actions
  startDrag: (panelId: string, title: string, x: number, y: number, isFloating?: boolean) => void;
  updateDrag: (x: number, y: number) => void;
  updateDropZone: (zone: DropZone | null) => void;
  endDrag: (targetId?: string, direction?: DockDirection) => void;
  cancelDrag: () => void;
  setDropIntent: (targetId: string | null, dir: string | null) => void;

  // Container Actions
  setHoveredContainer: (id: string | null) => void;
  setActiveTab: (containerId: string, panelId: string) => void;

  // Resize Actions
  startResize: (containerId: string, direction: 'horizontal' | 'vertical') => void;
  endResize: () => void;

  // UI Actions
  setShowDropIndicators: (show: boolean) => void;
  setGhostPreview: (preview: DockState['ghostPreview']) => void;

  // Dock Actions
  addPanel: (panel: DockPanelConfig, targetId?: string, direction?: DockDirection) => void;
  removePanel: (panelId: string) => void;
  dockPanel: (panelId: string, targetId: string, direction: DockDirection) => void;
  floatPanel: (panelId: string, position?: { x: number; y: number }) => void;
  updateFloatingPosition: (panelId: string, position: { x: number; y: number }) => void;
  updateFloatingSize: (panelId: string, size: { width: number; height: number }) => void;
  moveToTab: (panelId: string, tabContainerId: string, insertIndex?: number) => void;
  updateContainerSize: (containerId: string, ratio: number) => void;
  updatePanelProps: (panelId: string, updates: { props?: Record<string, any>; title?: string }) => void;

  // History Actions
  undo: () => void;
  redo: () => void;
  canUndo: () => boolean;
  canRedo: () => boolean;

  // Persistence
  saveLayout: (userId?: string) => void;
  loadLayout: (userId?: string) => boolean;
  resetToDefaultLayout: () => void;
  tileWindows: () => void;

  // Magnetic Snap Actions
  snapToWorkspaceEdge: (panelId: string, edge: 'top' | 'bottom' | 'left' | 'right' | 'center') => void;
}

const useDockLayoutStore = create<DockState>()(
  devtools(
    persist(
      (set, get) => ({
        // Initial State
        layout: dockManager.getLayout(),
        dragState: 'idle',
        dragInfo: null,
        activeDropZone: null,
        dropZones: [],
        hoveredContainerId: null,
        dropTargetId: null,
        compassDir: null,
        resizingContainerId: null,
        resizeDirection: null,
        showDropIndicators: true,
        ghostPreview: { visible: false, x: 0, y: 0, width: 0, height: 0 },

        // Layout Actions
        setLayout: (layout) => {
          set({ layout });
          dockManager.setLayout(layout, true);
        },

        // Drag Actions
        startDrag: (panelId, panelTitle, x, y, isFloating = false) => {
          set({
            dragState: 'dragging',
            dragInfo: {
              panelId,
              panelTitle,
              startX: x,
              startY: y,
              currentX: x,
              currentY: y,
              offsetX: 0,
              offsetY: 0,
              isFloating,
            },
            activeDropZone: null,
            ghostPreview: { visible: true, x, y, width: 200, height: 150 },
          });
        },

        updateDrag: (x, y) => {
          const { dragInfo } = get();
          if (!dragInfo) return;

          set({
            dragInfo: {
              ...dragInfo,
              currentX: x,
              currentY: y,
              offsetX: x - dragInfo.startX,
              offsetY: y - dragInfo.startY,
            },
            ghostPreview: {
              ...get().ghostPreview,
              x: x - 100,
              y: y - 75,
            },
          });
        },

        updateDropZone: (zone) => {
          set({ activeDropZone: zone });
        },

        endDrag: (targetId?: string, direction?: DockDirection) => {
          const { dragInfo, activeDropZone } = get();
          if (!dragInfo) return;

          const finalTargetId = targetId || activeDropZone?.targetContainerId;
          const finalDirection = direction || activeDropZone?.direction || 'center';

          if (finalDirection.startsWith('edge-')) {
            // Workspace edge docking
            const edgeDir = finalDirection.replace('edge-', '') as DockDirection;
            dockManager.snapToWorkspaceEdge(dragInfo.panelId, edgeDir);
          } else if (finalTargetId && dragInfo.isFloating) {
            // Dock floating panel
            dockManager.dockFloatingPanel(dragInfo.panelId, finalTargetId, finalDirection);
          } else if (finalTargetId) {
            // Move docked panel
            dockManager.dockPanel(dragInfo.panelId, finalTargetId, finalDirection);
          } else if (!dragInfo.isFloating) {
            // Float the panel if dropped in empty space
            dockManager.floatPanel(dragInfo.panelId, {
              x: dragInfo.currentX - 100,
              y: dragInfo.currentY - 75,
            });
          }

          set({
            dragState: 'idle',
            dragInfo: null,
            activeDropZone: null,
            dropZones: [],
            dropTargetId: null,
            compassDir: null,
            ghostPreview: { visible: false, x: 0, y: 0, width: 0, height: 0 },
          });

          // Update layout from manager
          set({ layout: dockManager.getLayout() });
        },

        cancelDrag: () => {
          set({
            dragState: 'idle',
            dragInfo: null,
            activeDropZone: null,
            dropZones: [],
            dropTargetId: null,
            compassDir: null,
            ghostPreview: { visible: false, x: 0, y: 0, width: 0, height: 0 },
          });
        },

        setDropIntent: (targetId, dir) => {
          set({ dropTargetId: targetId, compassDir: dir });
        },

        // Container Actions
        setHoveredContainer: (id) => set({ hoveredContainerId: id }),

        setActiveTab: (containerId, panelId) => {
          dockManager.setActiveTab(containerId, panelId);
          set({ layout: dockManager.getLayout() });
        },

        // Resize Actions
        startResize: (containerId, direction) => set({
          resizingContainerId: containerId,
          resizeDirection: direction,
        }),

        endResize: () => set({
          resizingContainerId: null,
          resizeDirection: null,
        }),

        // UI Actions
        setShowDropIndicators: (show) => set({ showDropIndicators: show }),
        setGhostPreview: (preview) => set({ ghostPreview: preview }),

        // Dock Actions
        addPanel: (panel, targetId, direction = 'center') => {
          dockManager.addPanel(panel, targetId, direction);
          set({ layout: dockManager.getLayout() });
        },

        removePanel: (panelId) => {
          dockManager.removePanel(panelId);
          set({ layout: dockManager.getLayout() });
        },

        dockPanel: (panelId, targetId, direction) => {
          dockManager.dockPanel(panelId, targetId, direction);
          set({ layout: dockManager.getLayout() });
        },

        floatPanel: (panelId, position) => {
          dockManager.floatPanel(panelId, position);
          set({ layout: dockManager.getLayout() });
        },

        updateFloatingPosition: (panelId, position) => {
          dockManager.updateFloatingPosition(panelId, position);
          set({ layout: dockManager.getLayout() });
        },

        updateFloatingSize: (panelId, size) => {
          dockManager.updateFloatingSize(panelId, size);
          set({ layout: dockManager.getLayout() });
        },

        moveToTab: (panelId, tabContainerId, insertIndex) => {
          dockManager.moveToTab(panelId, tabContainerId, insertIndex);
          set({ layout: dockManager.getLayout() });
        },

        updateContainerSize: (containerId, ratio) => {
          dockManager.updateContainerSize(containerId, ratio);
          set({ layout: dockManager.getLayout() });
        },

        updatePanelProps: (panelId, updates) => {
          dockManager.updatePanelProps(panelId, updates);
          set({ layout: dockManager.getLayout() });
        },

        // History Actions
        undo: () => {
          if (dockManager.undo()) {
            set({ layout: dockManager.getLayout() });
          }
        },

        redo: () => {
          if (dockManager.redo()) {
            set({ layout: dockManager.getLayout() });
          }
        },

        canUndo: () => dockManager.canUndo(),
        canRedo: () => dockManager.canRedo(),

        // Persistence
        saveLayout: (userId?: string) => dockManager.saveToStorage(userId ? `dock-layout-${userId}` : 'dock-layout'),
        loadLayout: (userId?: string) => {
          const loaded = dockManager.loadFromStorage(userId ? `dock-layout-${userId}` : 'dock-layout');
          if (loaded) {
            set({ layout: dockManager.getLayout() });
          }
          return loaded;
        },
        resetToDefaultLayout: () => {
          dockManager.resetToDefaultLayout();
          set({ layout: dockManager.getLayout() });
        },
        tileWindows: () => {
          dockManager.tileWindows();
          set({ layout: dockManager.getLayout() });
        },

        // Magnetic Snap - dock to workspace edge
        snapToWorkspaceEdge: (panelId, edge) => {
          // Use dockPanel to snap to root with specified direction
          if (edge === 'center') {
            dockManager.dockPanel(panelId, 'root', 'center');
          } else {
            dockManager.dockPanel(panelId, 'root', edge);
          }
          set({ layout: dockManager.getLayout() });
        },
      }),
      {
        name: 'dock-layout-storage',
        partialize: (state) => ({
          showDropIndicators: state.showDropIndicators,
        }),
      }
    ),
    { name: 'dock-layout-store' }
  )
);

// Subscribe to dock manager updates
let isUpdating = false;
dockManager.subscribe((layout) => {
  if (!isUpdating) {
    isUpdating = true;
    useDockLayoutStore.setState({ layout });
    isUpdating = false;
  }
});

export { useDockLayoutStore };
export default useDockLayoutStore;
