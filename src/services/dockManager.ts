/**
 * Dock Manager Service
 * Professional docking layout system for trading terminals
 */

export type DockDirection = 'left' | 'right' | 'top' | 'bottom' | 'center' | 'tab';
export type DockContainerType = 'root' | 'split' | 'tabs' | 'panel';

export interface DropZone {
  id: string;
  direction: DockDirection;
  rect: { x: number; y: number; width: number; height: number };
  targetContainerId: string;
  priority: number;
}

export interface DockPanelConfig {
  id: string;
  title: string;
  icon?: string;
  component: string;
  props?: Record<string, any>;
  minWidth?: number;
  minHeight?: number;
  preferredWidth?: number;
  preferredHeight?: number;
  closable?: boolean;
  floatable?: boolean;
  resizable?: boolean;
  ratio?: number;
}

export interface DockContainer {
  id: string;
  type: DockContainerType;
  direction?: 'horizontal' | 'vertical';
  ratio: number;
  children: (DockContainer | DockPanelConfig)[];
  activeTab?: string;
  isFloating?: boolean;
  position?: { x: number; y: number };
  size?: { width: number; height: number };
}

export interface DockLayout {
  root: DockContainer;
  floatingPanels: DockContainer[];
  version: string;
}

const MIN_PANEL_SIZE = 100;
const DEFAULT_RATIO = 0.5;
const DEFAULT_CHART_TIMEFRAME = 'M5';
const DOCK_LAYOUT_M5_MIGRATION_PREFIX = 'dock-layout-m5-timeframe-v1:';

export class DockManager {
  private layout: DockLayout;
  private listeners: Set<(layout: DockLayout) => void> = new Set();

  constructor(initialLayout?: DockLayout) {
    this.layout = initialLayout || this.createDefaultLayout();
  }

  private createDefaultLayout(): DockLayout {
    // Official MT5 Default Layout:
    // Left: Market Watch (Top) + Navigator (Bottom)
    // Right: Charts (Top) + Toolbox (Bottom)
    return {
      root: {
        id: 'root',
        type: 'split',
        direction: 'horizontal',
        ratio: 1,
        children: [
          // LEFT COLUMN (20% width)
          {
            id: 'left-sidebar',
            type: 'split',
            direction: 'vertical',
            ratio: 0.20,
            children: [
              // Market Watch (Top half of left sidebar)
              {
                id: 'market-watch',
                type: 'panel',
                title: 'Market Watch',
                component: 'MarketWatch',
                ratio: 0.50,
                closable: true,
                floatable: true,
              } as any,
              // Navigator (Bottom half of left sidebar)
              {
                id: 'navigator',
                type: 'panel',
                title: 'Navigator',
                component: 'Navigator',
                ratio: 0.50,
                closable: true,
                floatable: true,
              } as any,
            ]
          },
          // CENTER MAIN COLUMN (80% width)
          {
            id: 'center-main',
            type: 'split',
            direction: 'vertical',
            ratio: 0.80,
            children: [
              // Charts area (75% of center main)
              {
                id: 'chart-default-container',
                type: 'panel',
                title: `Chart,${DEFAULT_CHART_TIMEFRAME}`,
                component: 'Chart',
                props: { timeframe: DEFAULT_CHART_TIMEFRAME },
                ratio: 0.75,
                closable: true,
                floatable: true,
              } as any,
              // Toolbox (25% of center main)
              {
                id: 'toolbox',
                type: 'panel',
                title: 'Toolbox',
                component: 'Terminal',
                ratio: 0.25,
                closable: true,
                floatable: true,
              } as any,
            ]
          }
        ],
      },
      floatingPanels: [],
      version: '2.6',
    };
  }

  getLayout(): DockLayout {
    return JSON.parse(JSON.stringify(this.layout));
  }

  setLayout(layout: DockLayout, silent = false): void {
    this.layout = JSON.parse(JSON.stringify(layout));
    if (!silent) {
      this.notify();
    }
  }

  subscribe(listener: (layout: DockLayout) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private notify(): void {
    const layout = this.getLayout();
    this.listeners.forEach((l) => l(layout));
  }

  resetToDefaultLayout(): void {
    this.layout = this.createDefaultLayout();
    this.notify();
  }

  /**
   * TILE WINDOWS implementation: 
   * Finds all Chart components and recursively removes them from their current container.
   * Then repackages them into a clean tiled grid layout.
   */
  tileWindows(): void {
    const layout = this.getLayout();
    
    // 1. Collect all chart panels and remove them from layout
    const charts: DockPanelConfig[] = [];
    
    const extractCharts = (container: DockContainer) => {
       for (let i = container.children.length - 1; i >= 0; i--) {
         const child = container.children[i];
         if ('children' in child) {
            extractCharts(child as DockContainer);
         } else if ((child as DockPanelConfig).component === 'Chart') {
            charts.push(child as DockPanelConfig);
            container.children.splice(i, 1);
         } else if ((child as DockPanelConfig).component === 'EmptyChartArea') {
            // Remove the empty placeholder since we are re-tiling real charts
            container.children.splice(i, 1);
         }
       }
    };
    
    extractCharts(layout.root);
    for (let i = layout.floatingPanels.length - 1; i >= 0; i--) {
       extractCharts(layout.floatingPanels[i]);
       if (layout.floatingPanels[i].children.length === 0) {
          layout.floatingPanels.splice(i, 1);
       }
    }
    
    // Reverse so the order matches roughly what was collected originally
    charts.reverse();
    
    if (charts.length === 0) {
        this.cleanupEmptyContainers(layout.root);
        this.setLayout(layout);
        return;
    }
    
    // 2. Build grid layout
    let chartsContainer: DockContainer | DockPanelConfig;
    
    if (charts.length === 1) {
       chartsContainer = { ...charts[0], ratio: 1 };
    } else if (charts.length === 2) {
       chartsContainer = {
          id: `grid-${Date.now()}`,
          type: 'split',
          direction: 'horizontal',
          ratio: 0.75,
          children: charts.map(c => ({...c, ratio: 0.5}))
       };
    } else if (charts.length === 3) {
       // MT5 Style: 1 on Left, 2 Stacked on Right
       const rightStack: DockContainer = {
          id: `grid-v-${Date.now()}`,
          type: 'split',
          direction: 'vertical',
          ratio: 0.5,
          children: [
             { ...charts[1], ratio: 0.5 },
             { ...charts[2], ratio: 0.5 }
          ]
       };
       chartsContainer = {
          id: `grid-h-${Date.now()}`,
          type: 'split',
          direction: 'horizontal',
          ratio: 0.75,
          children: [
             { ...charts[0], ratio: 0.5 },
             rightStack
          ]
       };
    } else {
          // Grid layout
          const cols = Math.ceil(Math.sqrt(charts.length));
          const rowsContainer: DockContainer = {
             id: `grid-v-${Date.now()}`,
             type: 'split',
             direction: 'vertical',
             ratio: 0.75,
             children: []
          };
          for (let i = 0; i < charts.length; i += cols) {
             const rowPanel = charts.slice(i, i + cols);
             const rowContainer: DockContainer = {
                 id: `grid-h-${Date.now()}-${i}`,
                 type: 'split',
                 direction: 'horizontal',
                 ratio: 1 / Math.ceil(charts.length / cols),
                 children: rowPanel.map(c => ({...c, ratio: 1/rowPanel.length}))
             };
             rowsContainer.children.push(rowContainer);
          }
          chartsContainer = rowsContainer;
    }
    
    // 3. Clean up the tree from empty containers caused by extraction
    this.cleanupEmptyContainers(layout.root);

    // 4. Determine insertion point
    const centerMain = this.findContainer(layout.root, 'center-main');
    if (centerMain && centerMain.type === 'split' && centerMain.direction === 'vertical') {
       // Find the terminal/toolbox to preserve its custom height
       let preservedToolboxRatio = 0.25;
       // Since charts just got extracted, whatever remains in centerMain (the toolbox) still holds its preserved absolute ratio (ratio sum != 1 anymore)
       if (centerMain.children.length > 0) {
           const bottomChild = centerMain.children[centerMain.children.length - 1] as any;
           if (bottomChild && bottomChild.ratio) {
               preservedToolboxRatio = bottomChild.ratio;
           }
       }
       
       const chartsRatio = 1 - preservedToolboxRatio;
       chartsContainer.ratio = chartsRatio;

       // Center main expected order: charts on top, terminal on bottom
       // We insert charts at the beginning (top) so they don't break the layout.
       centerMain.children.unshift(chartsContainer);
       
       // Ensure ratios are exactly balanced
       if (centerMain.children.length === 2) {
           (centerMain.children[0] as any).ratio = chartsRatio;
           (centerMain.children[1] as any).ratio = preservedToolboxRatio;
       } else {
           this.normalizeRatios(centerMain);
       }
    } else {
       // Fallback to inserting at root level
       // Push adds it to the right/bottom instead of the left/top
       if (layout.root.type === 'split' && layout.root.direction === 'horizontal') {
           layout.root.children.push(chartsContainer);
       } else {
           layout.root.children.push(chartsContainer);
       }
       this.normalizeRatios(layout.root);
    }
    
    this.setLayout(layout);
  }

  /**
   * Dock panel to specific target (can be a container ID or a panel ID)
   */
  dockPanel(
    panelId: string,
    targetId: string,
    direction: DockDirection
  ): void {
    const layout = this.getLayout();

    // Find and remove panel from current location
    const panel = this.removePanelFromLayout(layout, panelId);
    if (!panel) return;

    // Try to find target as a container first
    let target = this.findContainer(layout.root, targetId);
    if (target) {
      this.dockToTarget(layout, panel, target, direction);
    } else {
      // Target might be a panel ID — find its parent container
      const result = this.findPanelAndParent(layout.root, targetId);
      if (result) {
        const { parent, panelIndex } = result;
        this.dockPanelNextTo(parent, panelIndex, panel, direction);
      } else {
        // Last resort: dock to root
        this.addToContainer(layout.root, panel, direction);
      }
    }

    // Clean up any empty containers
    this.cleanupEmptyContainers(layout.root);
    this.setLayout(layout);
  }

  /**
   * Snap a panel to the workspace edge (root-level docking)
   */
  snapToWorkspaceEdge(panelId: string, direction: DockDirection): void {
    const layout = this.getLayout();
    const panel = this.removePanelFromLayout(layout, panelId);
    if (!panel) return;

    this.addToContainer(layout.root, panel, direction);
    this.cleanupEmptyContainers(layout.root);
    this.setLayout(layout);
  }

  /**
   * Remove panel from layout
   */
  removePanel(panelId: string): boolean {
    const layout = this.getLayout();
    
    // Check what kind of panel we are about to remove
    let targetComponent = '';
    const panelResult = this.findPanelAndParent(layout.root, panelId);
    if (panelResult) targetComponent = panelResult.panel.component;

    const removed = this.removePanelFromLayout(layout, panelId);
    if (removed) {
      this.cleanupEmptyContainers(layout.root);

      // Guard: if center-main lost all its charts, protect layout structure
      // by inserting a lightweight empty-chart placeholder to keep Toolbox position fixed.
      const centerMain = this.findContainer(layout.root, 'center-main');
      if (centerMain && centerMain.type === 'split' && centerMain.direction === 'vertical') {
        const hasChart = centerMain.children.some((c: any) => {
          if (c.component === 'Chart' || c.component === 'EmptyChartArea') return true;
          if (c.children) return c.children.some((cc: any) => cc.component === 'Chart' || cc.component === 'EmptyChartArea');
          return false;
        });
        const hasToolbox = centerMain.children.some((c: any) => c.component === 'Terminal');

        // Always insert spacer when no charts/placeholders exist and toolbox is present
        // This keeps the Toolbox locked at its bottom position
        if (!hasChart && hasToolbox) {
          const placeholder: DockPanelConfig = {
            id: `charts-area-${Date.now()}`,
            title: '',
            component: 'EmptyChartArea',
            ratio: 0.75,
            closable: false,
            floatable: false,
          };
          centerMain.children.unshift(placeholder);
          // Ensure Toolbox stays at 25%
          const toolboxChild = centerMain.children[centerMain.children.length - 1] as any;
          if (toolboxChild) toolboxChild.ratio = 0.25;
        }
      }

      this.setLayout(layout);
      return true;
    }
    return false;
  }


  /**
   * Float a docked panel
   */
  floatPanel(panelId: string, position?: { x: number; y: number }): void {
    const layout = this.getLayout();
    const panel = this.removePanelFromLayout(layout, panelId);
    if (!panel) return;

    // Clamp position to viewport
    const viewportWidth = typeof window !== 'undefined' ? window.innerWidth : 1200;
    const viewportHeight = typeof window !== 'undefined' ? window.innerHeight : 800;
    const panelWidth = 400;
    const panelHeight = 300;

    let posX = position?.x ?? 100;
    let posY = position?.y ?? 100;

    // Ensure panel stays within viewport
    posX = Math.max(50, Math.min(posX, viewportWidth - panelWidth + 100));
    posY = Math.max(50, Math.min(posY, viewportHeight - panelHeight + 100));

    const floatingContainer: DockContainer = {
      id: `floating-${Date.now()}`,
      type: 'panel',
      ratio: 1,
      children: [panel],
      isFloating: true,
      position: { x: posX, y: posY },
      size: { width: panelWidth, height: panelHeight },
    };

    layout.floatingPanels.push(floatingContainer);
    this.cleanupEmptyContainers(layout.root);
    this.setLayout(layout);
  }

  /**
   * Update floating panel position
   */
  updateFloatingPosition(panelId: string, position: { x: number; y: number }): void {
    const layout = this.getLayout();
    const floating = layout.floatingPanels.find((p) => p.id === panelId);
    if (floating) {
      // Clamp to viewport
      const viewportWidth = typeof window !== 'undefined' ? window.innerWidth : 1200;
      const viewportHeight = typeof window !== 'undefined' ? window.innerHeight : 800;
      const width = floating.size?.width || 400;
      const height = floating.size?.height || 300;

      floating.position = {
        x: Math.max(50, Math.min(position.x, viewportWidth - width + 100)),
        y: Math.max(50, Math.min(position.y, viewportHeight - height + 100)),
      };
      this.setLayout(layout, true);
    }
  }

  /**
   * Update floating panel size
   */
  updateFloatingSize(panelId: string, size: { width: number; height: number }): void {
    const layout = this.getLayout();
    const floating = layout.floatingPanels.find((p) => p.id === panelId);
    if (floating) {
      floating.size = {
        width: Math.max(200, size.width),
        height: Math.max(150, size.height),
      };
      this.setLayout(layout, true);
    }
  }

  /**
   * Update container size ratio
   */
  updateContainerSize(containerId: string, newRatio: number): void {
    const layout = this.getLayout();

    let item: DockContainer | DockPanelConfig | null = this.findContainer(layout.root, containerId);
    if (!item) {
      const result = this.findPanelAndParent(layout.root, containerId);
      if (result) item = result.panel;
    }

    if (item) {
      item.ratio = Math.max(0.05, Math.min(0.95, newRatio));
      const parent = this.findParent(layout.root, containerId);
      if (parent) {
        this.normalizeRatios(parent);
      }
      this.setLayout(layout, true);
    }
  }

  /**
   * Set active tab
   */
  setActiveTab(tabContainerId: string, panelId: string): void {
    const layout = this.getLayout();
    const container = this.findContainer(layout.root, tabContainerId);
    if (container && container.type === 'tabs') {
      container.activeTab = panelId;
      this.setLayout(layout, true);
    }
  }

  /**
   * Add a new panel to the layout
   */
  addPanel(panel: DockPanelConfig, targetId?: string, direction: DockDirection = 'center'): void {
    const layout = this.getLayout();

    // First try to find targetId as a container  
    let target = targetId ? this.findContainer(layout.root, targetId) : layout.root;

    // If not found as a container, targetId might be a panel ID — find its parent container
    if (!target && targetId) {
      const result = this.findPanelAndParent(layout.root, targetId);
      if (result) {
        if (direction === 'tab' || direction === 'center') {
          this.dockPanelNextTo(result.parent, result.panelIndex, panel, direction);
          this.cleanupEmptyContainers(layout.root);
          this.setLayout(layout);
          return;
        }
        target = result.parent;
      }
    }

    // Final fallback to root
    if (!target) target = layout.root;

    this.dockToTarget(layout, panel, target, direction);

    // If we're adding a real Chart, strip out the empty placeholder
    if (panel.component === 'Chart') {
      const removePlaceholders = (container: DockContainer) => {
        for (let i = container.children.length - 1; i >= 0; i--) {
          const child = container.children[i];
          if ('children' in child) removePlaceholders(child as DockContainer);
          else if ((child as DockPanelConfig).component === 'EmptyChartArea') {
            container.children.splice(i, 1);
          }
        }
      };
      removePlaceholders(layout.root);
    }

    this.cleanupEmptyContainers(layout.root);
    this.setLayout(layout);
  }


  /**
   * Dock a floating panel back to the layout
   */
  dockFloatingPanel(panelId: string, targetId: string, direction: DockDirection = 'center'): void {
    const layout = this.getLayout();

    // Find floating panel
    const floatingIndex = layout.floatingPanels.findIndex((p) =>
      p.children.some((c: any) => c.id === panelId)
    );

    if (floatingIndex === -1) return;

    const floating = layout.floatingPanels[floatingIndex];
    const panel = floating.children.find((c: any) => c.id === panelId) as DockPanelConfig;
    if (!panel) return;

    // Remove from floating
    floating.children = floating.children.filter((c: any) => c.id !== panelId);
    if (floating.children.length === 0) {
      layout.floatingPanels.splice(floatingIndex, 1);
    }

    // Find target and dock
    const target = this.findContainer(layout.root, targetId);
    if (target) {
      this.dockToTarget(layout, panel, target, direction);
    }

    this.cleanupEmptyContainers(layout.root);
    this.setLayout(layout);
  }

  /**
   * Undo last action (stub for compatibility)
   */
  undo(): boolean {
    // History not implemented in simplified version
    return false;
  }

  /**
   * Redo last undone action (stub for compatibility)
   */
  redo(): boolean {
    // History not implemented in simplified version
    return false;
  }

  /**
   * Move panel to tab container
   */
  moveToTab(panelId: string, tabContainerId: string, insertIndex?: number): void {
    const layout = this.getLayout();
    const panel = this.removePanelFromLayout(layout, panelId);
    if (!panel) return;

    const tabContainer = this.findContainer(layout.root, tabContainerId);
    if (tabContainer && tabContainer.type === 'tabs') {
      if (insertIndex !== undefined && insertIndex >= 0) {
        tabContainer.children.splice(insertIndex, 0, panel);
      } else {
        tabContainer.children.push(panel);
      }
      tabContainer.activeTab = panelId;
    }

    this.cleanupEmptyContainers(layout.root);
    this.setLayout(layout);
  }


  /**
   * Check if undo is available (stub for compatibility)
   */
  canUndo(): boolean {
    return false;
  }

  /**
   * Check if redo is available (stub for compatibility)
   */
  canRedo(): boolean {
    return false;
  }

  /**
   * Find drop zone at a specific point (stub for compatibility)
   */
  findDropZoneAtPoint(
    x: number,
    y: number,
    containerRects: Map<string, { x: number; y: number; width: number; height: number }>
  ): DropZone | null {
    // Simple implementation - find which container contains the point
    for (const [containerId, rect] of containerRects.entries()) {
      if (
        x >= rect.x &&
        x <= rect.x + rect.width &&
        y >= rect.y &&
        y <= rect.y + rect.height
      ) {
        // Determine direction based on position within container
        const centerX = rect.x + rect.width / 2;
        const centerY = rect.y + rect.height / 2;

        let direction: DockDirection = 'center';
        if (Math.abs(x - centerX) > Math.abs(y - centerY)) {
          direction = x < centerX ? 'left' : 'right';
        } else {
          direction = y < centerY ? 'top' : 'bottom';
        }

        return {
          id: `${containerId}-${direction}`,
          direction,
          rect,
          targetContainerId: containerId,
          priority: 1,
        };
      }
    }
    return null;
  }

  /**
   * Update a panel's props and title in-place
   */
  updatePanelProps(panelId: string, updates: { props?: Record<string, any>; title?: string }): boolean {
    const layout = this.layout;
    const updated = this.updatePanelInContainer(layout.root, panelId, updates);
    if (updated) {
      this.notify();
      return true;
    }
    // Check floating panels
    for (const floating of layout.floatingPanels) {
      if (this.updatePanelInContainer(floating, panelId, updates)) {
        this.notify();
        return true;
      }
    }
    return false;
  }

  private updatePanelInContainer(container: DockContainer, panelId: string, updates: { props?: Record<string, any>; title?: string }): boolean {
    for (let i = 0; i < container.children.length; i++) {
      const child = container.children[i];
      if ('children' in child) {
        if (this.updatePanelInContainer(child as DockContainer, panelId, updates)) return true;
      } else {
        const panel = child as DockPanelConfig;
        if (panel.id === panelId) {
          if (updates.props) panel.props = { ...panel.props, ...updates.props };
          if (updates.title !== undefined) panel.title = updates.title;
          return true;
        }
      }
    }
    return false;
  }

  /**
   * Save layout to localStorage
   */
  saveToStorage(key: string = 'dock-layout'): void {
    try {
      localStorage.setItem(key, JSON.stringify(this.layout));
    } catch (e) {
      console.warn('[DockManager] Failed to save layout:', e);
    }
  }

  loadFromStorage(key: string = 'dock-layout'): boolean {
    try {
      const stored = localStorage.getItem(key);
      if (stored) {
        const parsed = JSON.parse(stored);
        const defaultLayout = this.createDefaultLayout();

        // Check if layout version matches current defaults, if not discard it
        if (!parsed.version || parsed.version !== defaultLayout.version) {
          console.log(`[DockManager] Outdated layout version ${parsed.version}, resetting to ${defaultLayout.version}`);
          return false;
        }

        this.layout = parsed;

        // Auto-sanitize corrupt symbols that might have infected chart tabs
        const isValidSymbol = (s: any) => typeof s === 'string' && s.length > 0 && s.length <= 20 && /^[A-Za-z0-9._-]+$/.test(s);
        const sanitizeContainer = (container: any) => {
          if (!container || !container.children) return;
          for (let i = container.children.length - 1; i >= 0; i--) {
            const child = container.children[i];
            if (child.children) {
              sanitizeContainer(child);
            } else if (child.component === 'Chart') {
              const sym = child.props?.symbol;
              if (!isValidSymbol(sym)) {
                console.warn(`[DockManager] Auto-purged corrupt chart tab: ${sym}`);
                container.children.splice(i, 1);
              }
            }
          }
        };

        sanitizeContainer(this.layout.root);
        if (this.layout.floatingPanels) {
          this.layout.floatingPanels.forEach(sanitizeContainer);
        }

        const migrationKey = `${DOCK_LAYOUT_M5_MIGRATION_PREFIX}${key}`;
        if (localStorage.getItem(migrationKey) !== '1') {
          const migrateChartPanels = (container: any) => {
            if (!container?.children) return;

            for (const child of container.children) {
              if (child?.children) {
                migrateChartPanels(child);
                continue;
              }

              if (child?.component !== 'Chart') continue;

              const symbol = child.props?.symbol || child.title?.split(',')[0] || '';
              const currentTimeframe = child.props?.timeframe;

              if (!currentTimeframe || currentTimeframe === 'M1') {
                child.props = {
                  ...child.props,
                  timeframe: DEFAULT_CHART_TIMEFRAME,
                };

                if (!child.title || /,M1$/i.test(child.title)) {
                  child.title = symbol
                    ? `${symbol},${DEFAULT_CHART_TIMEFRAME}`
                    : `Chart,${DEFAULT_CHART_TIMEFRAME}`;
                }
              }
            }
          };

          migrateChartPanels(this.layout.root);
          if (this.layout.floatingPanels) {
            this.layout.floatingPanels.forEach(migrateChartPanels);
          }

          localStorage.setItem(migrationKey, '1');
        }

        this.notify();
        return true;
      }
    } catch (e) {
      console.warn('[DockManager] Failed to load layout:', e);
    }
    return false;
  }

  // Private helper methods

  private removePanelFromLayout(layout: DockLayout, panelId: string): DockPanelConfig | null {
    // Search in root
    const fromRoot = this.removeFromContainer(layout.root, panelId);
    if (fromRoot) return fromRoot;

    // Search in floating panels
    for (const floating of layout.floatingPanels) {
      const panel = floating.children.find((c: any) => c.id === panelId) as DockPanelConfig;
      if (panel) {
        floating.children = floating.children.filter((c: any) => c.id !== panelId);
        // Remove empty floating containers
        if (floating.children.length === 0) {
          const idx = layout.floatingPanels.indexOf(floating);
          if (idx > -1) layout.floatingPanels.splice(idx, 1);
        }
        return panel;
      }
    }

    return null;
  }

  private removeFromContainer(container: DockContainer, panelId: string): DockPanelConfig | null {
    for (let i = 0; i < container.children.length; i++) {
      const child = container.children[i];

      if ('children' in child) {
        const found = this.removeFromContainer(child as DockContainer, panelId);
        if (found) return found;
      } else if ((child as DockPanelConfig).id === panelId) {
        const panel = child as DockPanelConfig;
        container.children.splice(i, 1);

        // If this is a tabs container and we just removed the active tab,
        // we need to set a new active tab, or un-tabify if only 1 child remains.
        if (container.type === 'tabs') {
          if (container.activeTab === panelId && container.children.length > 0) {
            // Select the previous tab, or the new first tab if we removed the first one
            const nextIndex = Math.max(0, i - 1);
            container.activeTab = (container.children[nextIndex] as DockPanelConfig).id;
          }
          // If only 1 child is left, it doesn't need to be a 'tabs' container anymore
          if (container.children.length === 1) {
            // We can optionally change it to a 'panel' or 'split' type. Leaving it as tabs
            // is also okay, DockContainer.tsx handles single tabs gracefully.
          }
        }

        return panel;
      }
    }
    return null;
  }

  private findContainer(container: DockContainer, id: string): DockContainer | null {
    if (container.id === id) return container;

    for (const child of container.children) {
      if ('children' in child) {
        const found = this.findContainer(child as DockContainer, id);
        if (found) return found;
      }
    }
    return null;
  }

  private findParent(container: DockContainer, childId: string): DockContainer | null {
    for (const child of container.children) {
      if ('children' in child) {
        if ((child as DockContainer).id === childId) {
          return container;
        }
        const found = this.findParent(child as DockContainer, childId);
        if (found) return found;
      } else if ((child as DockPanelConfig).id === childId) {
        return container;
      }
    }
    return null;
  }

  /**
   * Find a panel config and its parent container by panel ID
   */
  private findPanelAndParent(
    container: DockContainer,
    panelId: string
  ): { parent: DockContainer; panelIndex: number; panel: DockPanelConfig } | null {
    for (let i = 0; i < container.children.length; i++) {
      const child = container.children[i];
      if ('children' in child) {
        const found = this.findPanelAndParent(child as DockContainer, panelId);
        if (found) return found;
      } else if ((child as DockPanelConfig).id === panelId) {
        return { parent: container, panelIndex: i, panel: child as DockPanelConfig };
      }
    }
    return null;
  }

  /**
   * Dock a new panel next to an existing panel in a container
   */
  private dockPanelNextTo(
    parent: DockContainer,
    targetIndex: number,
    newPanel: DockPanelConfig,
    direction: DockDirection
  ): void {
    if (direction === 'center' || direction === 'tab') {
      // Convert to tabs at this position
      const existingPanel = parent.children[targetIndex] as DockPanelConfig;
      const tabContainer: DockContainer = {
        id: `tabs-${Date.now()}`,
        type: 'tabs',
        ratio: existingPanel.ratio || DEFAULT_RATIO,
        children: [existingPanel, newPanel],
        activeTab: newPanel.id,
      };
      parent.children[targetIndex] = tabContainer;
      return;
    }

    const isHorizontal = direction === 'left' || direction === 'right';
    const splitDir: 'horizontal' | 'vertical' = isHorizontal ? 'horizontal' : 'vertical';

    if (parent.type === 'split' && parent.direction === splitDir) {
      // Same direction as parent — just insert as a sibling
      const insertIndex = (direction === 'left' || direction === 'top') ? targetIndex : targetIndex + 1;
      const existingPanel = parent.children[targetIndex] as any;
      const existingRatio = existingPanel.ratio || (1 / parent.children.length);
      // Split the existing panel's ratio
      const halfRatio = existingRatio / 2;
      existingPanel.ratio = halfRatio;
      parent.children.splice(insertIndex, 0, { ...newPanel, ratio: halfRatio });
    } else {
      // Different direction — wrap the target in a new split
      const existingChild = parent.children[targetIndex];
      const existingRatio = (existingChild as any).ratio || DEFAULT_RATIO;

      const newSplit: DockContainer = {
        id: `split-${Date.now()}`,
        type: 'split',
        direction: splitDir,
        ratio: existingRatio,
        children: [],
      };

      if (direction === 'left' || direction === 'top') {
        newSplit.children = [
          { ...newPanel, ratio: 0.5 },
          { ...existingChild, ratio: 0.5 },
        ];
      } else {
        newSplit.children = [
          { ...existingChild, ratio: 0.5 },
          { ...newPanel, ratio: 0.5 },
        ];
      }

      parent.children[targetIndex] = newSplit;
    }
  }

  private cleanupEmptyContainers(container: DockContainer): void {
    for (let i = container.children.length - 1; i >= 0; i--) {
      const child = container.children[i];

      if ('children' in child) {
        const childContainer = child as DockContainer;
        this.cleanupEmptyContainers(childContainer);

        if (childContainer.children.length === 0) {
          container.children.splice(i, 1);
        } else if (
          childContainer.children.length === 1 && 
          childContainer.type === 'split' &&
          !['center-main', 'left-sidebar', 'right-sidebar'].includes(childContainer.id)
        ) {
          // Unwrap single-child splits (except structural layout columns)
          const onlyChild = childContainer.children[0];
          onlyChild.ratio = childContainer.ratio;
          container.children[i] = onlyChild;
        }
      }
    }
  }

  private normalizeRatios(container: DockContainer): void {
    if (container.children.length === 0) return;

    const totalRatio = container.children.reduce((sum, c: any) => sum + (c.ratio || DEFAULT_RATIO), 0);
    const factor = 1 / totalRatio;

    container.children.forEach((child: any) => {
      child.ratio = (child.ratio || DEFAULT_RATIO) * factor;
    });
  }

  private dockToTarget(
    layout: DockLayout,
    panel: DockPanelConfig,
    target: DockContainer,
    direction: DockDirection
  ): void {
    if (direction === 'center' || direction === 'tab') {
      // Convert target to tabs or add to existing tabs
      if (target.type === 'tabs') {
        target.children.push(panel);
        target.activeTab = panel.id;
      } else if (target.type === 'panel') {
        // 'panel' typed containers in our layout have children that are DockPanelConfigs
        const existingChildren = [...target.children];
        target.type = 'tabs';
        target.children = [...existingChildren, panel];
        target.activeTab = panel.id;
      } else if (target.type === 'split') {
        // For a split container, find the first panel child and group them as tabs
        const firstPanelIndex = target.children.findIndex(c => !('children' in c));
        if (firstPanelIndex >= 0) {
          const existingPanel = target.children[firstPanelIndex] as DockPanelConfig;
          const tabContainer: DockContainer = {
            id: `tabs-${Date.now()}`,
            type: 'tabs',
            ratio: existingPanel.ratio || DEFAULT_RATIO,
            children: [existingPanel, panel],
            activeTab: panel.id,
          };
          target.children[firstPanelIndex] = tabContainer;
        } else {
          // No leaf panel found, just add to the split as a new child
          target.children.push({ ...panel, ratio: DEFAULT_RATIO });
          this.normalizeRatios(target);
        }
      }
    } else {
      // Split container
      const parent = this.findParent(layout.root, target.id);
      if (parent) {
        this.splitAtChild(parent, target, panel, direction);
      } else {
        this.addToContainer(layout.root, panel, direction);
      }
    }
  }

  private addToContainer(container: DockContainer, panel: DockPanelConfig, direction: DockDirection): void {
    const isHorizontal = direction === 'left' || direction === 'right';
    const newDirection: 'horizontal' | 'vertical' = isHorizontal ? 'horizontal' : 'vertical';

    if (container.type === 'split' && container.direction === newDirection) {
      const insertIndex = direction === 'left' || direction === 'top' ? 0 : container.children.length;
      container.children.splice(insertIndex, 0, { ...panel, ratio: DEFAULT_RATIO });
      this.normalizeRatios(container);
    } else {
      // Create new split
      const existingChildren = [...container.children];
      const existingRatio = 1 - DEFAULT_RATIO;

      const newSplit: DockContainer = {
        id: `split-${Date.now()}`,
        type: 'split',
        direction: newDirection,
        ratio: container.ratio || 1,
        children: [],
      };

      if (direction === 'left' || direction === 'top') {
        newSplit.children = [
          { ...panel, ratio: DEFAULT_RATIO },
          { ...container, ratio: existingRatio, children: existingChildren },
        ];
      } else {
        newSplit.children = [
          { ...container, ratio: existingRatio, children: existingChildren },
          { ...panel, ratio: DEFAULT_RATIO },
        ];
      }

      Object.assign(container, newSplit);
    }
  }

  private splitAtChild(
    parent: DockContainer,
    target: DockContainer,
    newPanel: DockPanelConfig,
    direction: DockDirection
  ): void {
    const isHorizontal = direction === 'left' || direction === 'right';
    const newDirection: 'horizontal' | 'vertical' = isHorizontal ? 'horizontal' : 'vertical';
    const childIndex = parent.children.findIndex((c: any) => c.id === target.id);

    if (childIndex === -1) return;

    if (parent.direction === newDirection) {
      // Same direction, insert sibling
      const insertIndex = direction === 'left' || direction === 'top' ? childIndex : childIndex + 1;
      parent.children.splice(insertIndex, 0, { ...newPanel, ratio: DEFAULT_RATIO });
      this.normalizeRatios(parent);
    } else {
      // Different direction, wrap target in new split
      const targetChild = parent.children[childIndex];
      const targetRatio = (targetChild as any).ratio || DEFAULT_RATIO;
      const remainingRatio = 1 - DEFAULT_RATIO;

      const newSplit: DockContainer = {
        id: `split-${Date.now()}`,
        type: 'split',
        direction: newDirection,
        ratio: targetRatio,
        children: [],
      };

      if (direction === 'left' || direction === 'top') {
        newSplit.children = [
          { ...newPanel, ratio: DEFAULT_RATIO },
          { ...targetChild, ratio: remainingRatio },
        ];
      } else {
        newSplit.children = [
          { ...targetChild, ratio: remainingRatio },
          { ...newPanel, ratio: DEFAULT_RATIO },
        ];
      }

      parent.children[childIndex] = newSplit;
    }
  }
}

// Export singleton instance
export const dockManager = new DockManager();
export default dockManager;
