/**
 * Dock Layout Store
 * Zustand store for managing docking layout state
 * Integrates with DockManager for layout operations
 */

import { create } from 'zustand';
import { devtools, persist } from 'zustand/middleware';
import { dockManager, DockLayout, DockPanelConfig, DropZone, DockDirection, MAX_CHART_PANELS, getChartPanelCount, type ChartArrangement, type AddChartPanelOptions, type AddChartPanelResult } from '../services/dockManager';
import { runOutsideChartFocus } from '../utils/advancedViewRootClasses';
import { getCommittedBrokerAccountSessionScope, getCommittedBrokerAccountSessionScopeKey } from '../services/brokerSession';
import { getActiveChartSource } from '../services/activeChartSource';
import { getPanelIdFromChartContextId } from '../services/chartCommandTarget';

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
  recentlyClosedCharts: DockPanelConfig[];

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
  addPanel: (panel: DockPanelConfig, targetId?: string, direction?: DockDirection) => boolean;
  addChartPanel: (options?: AddChartPanelOptions) => AddChartPanelResult;
  getChartCount: () => number;
  canAddChart: () => boolean;
  removePanel: (panelId: string) => void;
  closeActiveChart: (symbol?: string, panelId?: string) => boolean;
  restoreClosedChart: (panelId?: string) => boolean;
  dockPanel: (panelId: string, targetId: string, direction: DockDirection) => void;
  floatPanel: (panelId: string, position?: { x: number; y: number }) => void;
  updateFloatingPosition: (panelId: string, position: { x: number; y: number }) => void;
  updateFloatingSize: (panelId: string, size: { width: number; height: number }) => void;
  moveToTab: (panelId: string, tabContainerId: string, insertIndex?: number) => void;
  updateContainerSize: (containerId: string, ratio: number) => void;
  updatePanelProps: (panelId: string, updates: Partial<Pick<DockPanelConfig, 'props' | 'title' | 'chartSymbolTabs'>>) => void;
  setPanelMinimized: (panelId: string, minimized: boolean) => void;
  bringFloatingToFront: (panelId: string) => void;

  // History Actions
  undo: () => void;
  redo: () => void;
  canUndo: () => boolean;
  canRedo: () => boolean;

  // Persistence
  saveLayout: (userId?: string) => void;
  loadLayout: (userId?: string) => boolean;
  resetToDefaultLayout: () => void;
  resetWindows: () => void;
  arrangeIcons: () => number;
  tileWindows: (mode?: Exclude<ChartArrangement, 'cascade'>) => void;
  stepTileWindows: () => void;
  arrangeCharts: (mode: ChartArrangement) => void;

  // Magnetic Snap Actions
  snapToWorkspaceEdge: (panelId: string, edge: 'top' | 'bottom' | 'left' | 'right' | 'center') => void;
}

const clonePanel = (panel: DockPanelConfig): DockPanelConfig => ({
  ...panel,
  props: panel.props ? { ...panel.props } : undefined,
});

const mergeOverflowCharts = (overflow: DockPanelConfig[], closed: DockPanelConfig[]): DockPanelConfig[] => {
  if (!overflow.length) return closed;
  const overflowIds = new Set(overflow.map(panel => panel.id));
  return [...overflow.map(clonePanel), ...closed.filter(panel => !overflowIds.has(panel.id))].slice(0, 10);
};

const findPanel = (layout: DockLayout, panelId: string): DockPanelConfig | null => {
  const findInContainer = (container: DockLayout['root']): DockPanelConfig | null => {
    for (const child of container.children) {
      if ('children' in child) {
        const nested = findInContainer(child);
        if (nested) return nested;
      } else if (child.id === panelId) {
        return child;
      }
    }
    return null;
  };

  return findInContainer(layout.root)
    || layout.floatingPanels.map(findInContainer).find(Boolean)
    || null;
};

const listChartPanels = (layout: DockLayout): DockPanelConfig[] => {
  const charts: DockPanelConfig[] = [];
  const collect = (container: DockLayout['root']) => {
    container.children.forEach((child) => {
      if ('children' in child) collect(child);
      else if (child.component === 'Chart') charts.push(child);
    });
  };

  collect(layout.root);
  layout.floatingPanels.forEach(collect);
  return charts;
};

const findActiveChart = (layout: DockLayout, symbol?: string): DockPanelConfig | null => {
  const normalizedSymbol = String(symbol || '').trim().toUpperCase();
  const charts = listChartPanels(layout);

  const findActiveInContainer = (container: DockLayout['root']): DockPanelConfig | null => {
    if (container.type === 'tabs' && container.activeTab) {
      const activeChild = container.children.find((child) => child.id === container.activeTab);
      if (activeChild && !('children' in activeChild) && activeChild.component === 'Chart') {
        return activeChild;
      }
    }
    for (const child of container.children) {
      if ('children' in child) {
        const active = findActiveInContainer(child);
        if (active) return active;
      }
    }
    return null;
  };

  const activeChart = layout.floatingPanels.map(findActiveInContainer).find(Boolean)
    || findActiveInContainer(layout.root);
  if (activeChart) return activeChart;

  const symbolMatch = normalizedSymbol
    ? charts.find((panel) =>
      String(panel.props?.symbol || '').trim().toUpperCase() === normalizedSymbol
    )
    : null;

  return symbolMatch
    || charts[0]
    || null;
};

const findChartHostId = (container: DockLayout['root']): string | null => {
  if (
    container.type === 'tabs'
    && container.children.some((child) => !('children' in child) && (child.component === 'Chart' || child.component === 'EmptyChartArea'))
  ) {
    return container.id;
  }
  for (const child of container.children) {
    if ('children' in child) {
      const hostId = findChartHostId(child);
      if (hostId) return hostId;
    }
  }
  return null;
};

let currentSessionLayoutKey: string | undefined;

const useDockLayoutStore = create<DockState>()(
  devtools(
    persist(
      (set, get) => ({
        // Initial State
        layout: dockManager.getLayout(),
        recentlyClosedCharts: [],
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
          dockManager.setLayout(layout, true);
          set({
            layout: dockManager.getLayout(),
            recentlyClosedCharts: mergeOverflowCharts(dockManager.takeOverflowCharts(), get().recentlyClosedCharts),
          });
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
          const added = dockManager.addPanel(panel, targetId, direction);
          if (!added) return false;
          set({ layout: dockManager.getLayout() });
          return true;
        },
        getChartCount: () => getChartPanelCount(get().layout),
        canAddChart: () => getChartPanelCount(get().layout) < MAX_CHART_PANELS,
        addChartPanel: (options) => {
          const result = dockManager.addChartPanel(options);
          if (result.status === 'added') {
            // Grid creation uses layout ratios, not DOM measurements, so return
            // the atomic result synchronously while revealing the divided view.
            runOutsideChartFocus(() => {});
            set({ layout: dockManager.getLayout() });
          }
          return result;
        },

        removePanel: (panelId) => {
          const panel = findPanel(get().layout, panelId);
          const removed = dockManager.removePanel(panelId);
          if (!removed) return;

          const nextState: Partial<DockState> = { layout: dockManager.getLayout() };
          if (panel?.component === 'Chart') {
            nextState.recentlyClosedCharts = [
              clonePanel(panel),
              ...get().recentlyClosedCharts.filter((candidate) => candidate.id !== panel.id),
            ].slice(0, 10);
          }
          set(nextState);
        },

        closeActiveChart: (symbol, panelId) => {
          const panel = panelId !== undefined
            ? findPanel(get().layout, panelId)
            : findActiveChart(get().layout, symbol);
          if (!panel || panel.component !== 'Chart' || panel.closable === false) return false;
          get().removePanel(panel.id);
          return true;
        },

        restoreClosedChart: (panelId) => {
          const closedCharts = get().recentlyClosedCharts;
          const panel = panelId
            ? closedCharts.find((candidate) => candidate.id === panelId)
            : closedCharts[0];
          if (!panel) return false;

          const currentLayout = get().layout;
          const targetId = findChartHostId(currentLayout.root)
            || listChartPanels(currentLayout)[0]?.id
            || 'center-main';
          const restoredPanel = clonePanel({
            ...panel,
            id: `chart-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
          });
          delete restoredPanel.minimized;
          if (!dockManager.addPanel(restoredPanel, targetId, 'tab')) return false;

          const layoutWithChart = dockManager.getLayout();
          const placeholder = (() => {
            const stack = [layoutWithChart.root, ...layoutWithChart.floatingPanels];
            while (stack.length > 0) {
              const container = stack.pop()!;
              for (const child of container.children) {
                if ('children' in child) stack.push(child);
                else if (child.component === 'EmptyChartArea') return child;
              }
            }
            return null;
          })();
          if (placeholder) dockManager.removePanel(placeholder.id);

          set({
            layout: dockManager.getLayout(),
            recentlyClosedCharts: closedCharts.filter((candidate) => candidate.id !== panel.id),
          });

          if (typeof window !== 'undefined' && panel.props?.symbol) {
            window.dispatchEvent(new CustomEvent('chartSymbolChanged', {
              detail: {
                symbol: panel.props.symbol,
                timeframe: panel.props.timeframe,
              },
            }));
          }
          return true;
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
        setPanelMinimized: (panelId, minimized) => {
          dockManager.setPanelMinimized(panelId, minimized);
          set({ layout: dockManager.getLayout() });
        },
        bringFloatingToFront: (panelId) => {
          dockManager.bringFloatingToFront(panelId);
          set({ layout: dockManager.getLayout() });
        },

        // History Actions
        undo: () => {
          runOutsideChartFocus(() => {
            if (dockManager.undo()) set({ layout: dockManager.getLayout() });
          });
        },

        redo: () => {
          runOutsideChartFocus(() => {
            if (dockManager.redo()) set({ layout: dockManager.getLayout() });
          });
        },

        canUndo: () => dockManager.canUndo(),
        canRedo: () => dockManager.canRedo(),

        // Persistence
        saveLayout: (userId?: string) => dockManager.saveToStorage(userId ? `dock-layout-${userId}` : 'dock-layout'),
        loadLayout: (userId?: string) => {
          const layoutKey = userId ? `dock-layout-${userId}` : 'dock-layout';
          // Closed-window snapshots belong to the selected account layout even
          // when that account has no saved workspace to restore yet.
          const sessionLayoutKey = JSON.stringify([
            layoutKey, getCommittedBrokerAccountSessionScopeKey(getCommittedBrokerAccountSessionScope()),
          ]);
          if (sessionLayoutKey !== currentSessionLayoutKey) {
            currentSessionLayoutKey = sessionLayoutKey;
            set({ recentlyClosedCharts: [] });
          }
          const loaded = dockManager.loadFromStorage(layoutKey);
          if (loaded) {
            set({ layout: dockManager.getLayout() });
          }
          return loaded;
        },
        resetToDefaultLayout: () => {
          dockManager.resetToDefaultLayout();
          set({ layout: dockManager.getLayout() });
        },
        tileWindows: (mode = 'grid') => {
          runOutsideChartFocus(() => {
            // Explicit tiling must divide the default one-chart workspace.
            // Once divided, changing the arrangement reuses its existing charts.
            while (dockManager.getChartCount() < 2) {
              if (dockManager.addChartPanel().status !== 'added') break;
            }
            dockManager.arrangeCharts(mode);
            // The manager subscription publishes each committed change.
            // Republishing a cloned layout forces the whole dock through it twice.
          });
        },
        stepTileWindows: () => {
          runOutsideChartFocus(() => {
            dockManager.stepTileWindows();
          });
        },
        resetWindows: () => {
          // Resolve the exact pane before leaving focus mode; several charts
          // may share a symbol while using different timeframes and settings.
          const currentLayout = get().layout;
          const currentCharts = listChartPanels(currentLayout);
          const source = getActiveChartSource();
          const sourcePanelId = getPanelIdFromChartContextId(source?.id);
          const activeChart = currentCharts.find(panel => panel.id === sourcePanelId)
            || findActiveChart(currentLayout, source?.symbol);
          runOutsideChartFocus(() => {
            dockManager.resetWindows(activeChart?.id);
            const layout = dockManager.getLayout();
            const remainingIds = new Set(listChartPanels(layout).map(panel => panel.id));
            const closedCharts = currentCharts.filter(panel => !remainingIds.has(panel.id));
            const closedIds = new Set(closedCharts.map(panel => panel.id));
            set({
              layout,
              recentlyClosedCharts: [
                ...closedCharts.map(clonePanel),
                ...get().recentlyClosedCharts.filter(panel => !closedIds.has(panel.id)),
              ].slice(0, 10),
            });
          });
        },
        arrangeIcons: () => {
          const count = get().layout.floatingPanels.filter(container => container.children.some(child => !('children' in child) && child.minimized)).length;
          runOutsideChartFocus(() => {
            dockManager.arrangeIcons();
            set({ layout: dockManager.getLayout() });
          });
          return count;
        },
        arrangeCharts: (mode) => {
          runOutsideChartFocus(() => {
            dockManager.arrangeCharts(mode);
          });
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
    useDockLayoutStore.setState({
      layout,
      recentlyClosedCharts: mergeOverflowCharts(dockManager.takeOverflowCharts(), useDockLayoutStore.getState().recentlyClosedCharts),
    });
    isUpdating = false;
  }
});

export { useDockLayoutStore };
export default useDockLayoutStore;
