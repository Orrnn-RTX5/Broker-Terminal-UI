/**
 * Workspace Manager Service
 * Captures, serializes, and manages workspace state with auto-save functionality
 */

import type {
  Workspace,
  ChartState,
  LayoutConfig,
  MarketWatchConfig,
  OrderPanelSettings,
  SaveWorkspaceRequest,
  AutoSaveState,
  ValidationResult,
  WorkspaceError,
  DrawingObject,
  IndicatorConfig,
} from '../types/workspace';

import { workspaceApi } from './workspaceApi';

class WorkspaceManager {
  private currentWorkspace: Workspace | null = null;
  private autoSaveState: AutoSaveState = {
    enabled: true,
    interval: 30000, // 30 seconds
    lastSaved: null,
    hasUnsavedChanges: false,
    saving: false,
    error: null,
  };
  private autoSaveTimer: NodeJS.Timeout | null = null;
  private changeListeners: Set<(hasChanges: boolean) => void> = new Set();
  private stateSnapshot: string | null = null;

  constructor() {
    this.setupAutoSave();
  }

  /**
   * Capture current workspace state from the application
   */
  async captureWorkspaceState(
    name: string,
    description?: string,
    userId?: string
  ): Promise<Workspace> {
    const timestamp = new Date();

    // Capture all chart states
    const charts = this.captureChartStates();

    // Capture layout configuration
    const layout = this.captureLayoutConfig();

    // Capture market watch configuration
    const marketWatch = this.captureMarketWatchConfig();

    // Capture order panel settings
    const orderPanel = this.captureOrderPanelSettings();

    // Generate thumbnail (optional)
    const thumbnail = await this.generateThumbnail();

    const workspace: Workspace = {
      id: this.currentWorkspace?.id || this.generateId(),
      name,
      description,
      userId: userId || 'default',
      charts,
      layout,
      marketWatch,
      orderPanel,
      version: '1.0.0',
      createdAt: this.currentWorkspace?.createdAt || timestamp,
      updatedAt: timestamp,
      thumbnail,
    };

    // Validate workspace
    const validation = this.validateWorkspace(workspace);
    if (!validation.valid) {
      throw new Error(`Workspace validation failed: ${validation.errors.join(', ')}`);
    }

    this.currentWorkspace = workspace;
    this.updateStateSnapshot();

    return workspace;
  }

  /**
   * Capture all chart states from the DOM/store
   */
  private captureChartStates(): ChartState[] {
    const charts: ChartState[] = [];

    // Get all chart containers
    const chartContainers = document.querySelectorAll('[data-chart-id]');

    chartContainers.forEach((container) => {
      const chartId = container.getAttribute('data-chart-id');
      if (!chartId) return;

      // Extract chart data from the chart instance
      const chartData = this.extractChartData(chartId);
      if (chartData) {
        charts.push(chartData);
      }
    });

    return charts;
  }

  /**
   * Extract chart data from a specific chart instance
   */
  private extractChartData(chartId: string): ChartState | null {
    try {
      // This would integrate with your charting library (TradingView, Lightweight Charts, etc.)
      // For now, we'll use a generic approach

      const chartElement = document.querySelector(`[data-chart-id="${chartId}"]`);
      if (!chartElement) return null;

      const symbol = chartElement.getAttribute('data-symbol') || 'EURUSD';
      const timeframe = (chartElement.getAttribute('data-timeframe') || '1m') as ChartState['timeframe'];
      const chartType = (chartElement.getAttribute('data-chart-type') || 'candlestick') as ChartState['chartType'];

      // Extract indicators from chart state
      const indicators = this.extractIndicators(chartId);

      // Extract drawings from chart state
      const drawings = this.extractDrawings(chartId);

      // Extract chart settings
      const settings = this.extractChartSettings(chartId);

      // Get position if it's a floating window
      const position = this.extractWindowPosition(chartElement);

      return {
        id: chartId,
        symbol,
        timeframe,
        chartType,
        indicators,
        drawings,
        settings,
        position,
      };
    } catch (error) {
      console.error(`Failed to extract chart data for ${chartId}:`, error);
      return null;
    }
  }

  /**
   * Extract indicators from chart
   */
  private extractIndicators(chartId: string): IndicatorConfig[] {
    // This would integrate with your indicator manager
    // For now, return empty array or mock data
    const indicatorsData = (window as any).__chartIndicators?.[chartId] || [];
    return indicatorsData;
  }

  /**
   * Extract drawings from chart
   */
  private extractDrawings(chartId: string): DrawingObject[] {
    // This would integrate with your drawing manager
    const drawingsData = (window as any).__chartDrawings?.[chartId] || [];
    return drawingsData;
  }

  /**
   * Extract chart settings
   */
  private extractChartSettings(chartId: string): ChartState['settings'] {
    const settingsData = (window as any).__chartSettings?.[chartId];

    return {
      showGrid: settingsData?.showGrid ?? true,
      showVolume: settingsData?.showVolume ?? true,
      showCrosshair: settingsData?.showCrosshair ?? true,
      priceScale: settingsData?.priceScale || 'AUTO',
      backgroundColor: settingsData?.backgroundColor || '#1a1a1a',
      gridColor: settingsData?.gridColor || '#2a2a2a',
      textColor: settingsData?.textColor || '#d1d4dc',
      candleUpColor: settingsData?.candleUpColor || '#26a69a',
      candleDownColor: settingsData?.candleDownColor || '#ef5350',
      wickColor: settingsData?.wickColor || '#737375',
      showLegend: settingsData?.showLegend ?? true,
      showTimescale: settingsData?.showTimescale ?? true,
      timezone: settingsData?.timezone || 'UTC',
    };
  }

  /**
   * Extract window position for floating windows
   */
  private extractWindowPosition(element: Element): ChartState['position'] | undefined {
    const rect = element.getBoundingClientRect();
    const isFloating = element.classList.contains('floating-window');

    if (!isFloating) return undefined;

    return {
      x: rect.left,
      y: rect.top,
      width: rect.width,
      height: rect.height,
    };
  }

  /**
   * Capture layout configuration
   */
  private captureLayoutConfig(): LayoutConfig {
    const layoutData = (window as any).__layoutConfig || {};

    return {
      version: '1.0.0',
      theme: layoutData.theme || 'dark',
      panels: {
        marketWatch: {
          visible: layoutData.panels?.marketWatch?.visible ?? true,
          collapsed: layoutData.panels?.marketWatch?.collapsed ?? false,
          width: layoutData.panels?.marketWatch?.width || 300,
        },
        orderBook: {
          visible: layoutData.panels?.orderBook?.visible ?? true,
          collapsed: layoutData.panels?.orderBook?.collapsed ?? false,
          width: layoutData.panels?.orderBook?.width || 300,
        },
        timeSales: {
          visible: layoutData.panels?.timeSales?.visible ?? true,
          collapsed: layoutData.panels?.timeSales?.collapsed ?? false,
          width: layoutData.panels?.timeSales?.width || 300,
        },
        orderEntry: {
          visible: layoutData.panels?.orderEntry?.visible ?? true,
          collapsed: layoutData.panels?.orderEntry?.collapsed ?? false,
          height: layoutData.panels?.orderEntry?.height || 250,
        },
        positions: {
          visible: layoutData.panels?.positions?.visible ?? true,
          collapsed: layoutData.panels?.positions?.collapsed ?? false,
          height: layoutData.panels?.positions?.height || 200,
        },
        alerts: {
          visible: layoutData.panels?.alerts?.visible ?? true,
          collapsed: layoutData.panels?.alerts?.collapsed ?? false,
          height: layoutData.panels?.alerts?.height || 150,
        },
        navigator: {
          visible: layoutData.panels?.navigator?.visible ?? true,
          collapsed: layoutData.panels?.navigator?.collapsed ?? false,
          width: layoutData.panels?.navigator?.width || 250,
        },
        toolbars: {
          visible: layoutData.panels?.toolbars?.visible ?? true,
          collapsed: layoutData.panels?.toolbars?.collapsed ?? false,
        },
      },
      windows: layoutData.windows || {},
      splitRatios: layoutData.splitRatios || {
        leftSidebar: 0.2,
        rightSidebar: 0.2,
        bottomPanel: 0.3,
      },
    };
  }

  /**
   * Capture market watch configuration
   */
  private captureMarketWatchConfig(): MarketWatchConfig {
    const marketWatchData = (window as any).__marketWatchConfig || {};

    return {
      symbols: marketWatchData.symbols || ['EURUSD', 'GBPUSD', 'USDJPY'],
      columns: marketWatchData.columns || [],
      sortBy: marketWatchData.sortBy || 'symbol',
      sortDirection: marketWatchData.sortDirection || 'asc',
      favorites: marketWatchData.favorites || [],
      groupBy: marketWatchData.groupBy,
      showSparklines: marketWatchData.showSparklines ?? true,
      updateInterval: marketWatchData.updateInterval || 1000,
    };
  }

  /**
   * Capture order panel settings
   */
  private captureOrderPanelSettings(): OrderPanelSettings {
    const orderPanelData = (window as any).__orderPanelSettings || {};

    return {
      defaultVolume: orderPanelData.defaultVolume || 0.01,
      defaultSlPips: orderPanelData.defaultSlPips || 20,
      defaultTpPips: orderPanelData.defaultTpPips || 40,
      confirmOrders: orderPanelData.confirmOrders ?? true,
      oneClickTrading: orderPanelData.oneClickTrading ?? false,
      showCalculators: orderPanelData.showCalculators ?? true,
      riskPercent: orderPanelData.riskPercent || 1,
    };
  }

  /**
   * Generate thumbnail screenshot
   */
  private async generateThumbnail(): Promise<string | undefined> {
    try {
      // This would use html2canvas or similar to capture the main chart area
      // For now, return undefined
      return undefined;
    } catch (error) {
      console.error('Failed to generate thumbnail:', error);
      return undefined;
    }
  }

  /**
   * Validate workspace before saving
   */
  private validateWorkspace(workspace: Workspace): ValidationResult {
    const errors: string[] = [];
    const warnings: string[] = [];

    if (!workspace.name || workspace.name.trim().length === 0) {
      errors.push('Workspace name is required');
    }

    if (workspace.name && workspace.name.length > 100) {
      errors.push('Workspace name must be 100 characters or less');
    }

    if (!workspace.userId) {
      errors.push('User ID is required');
    }

    if (!workspace.charts || workspace.charts.length === 0) {
      warnings.push('Workspace has no charts');
    }

    if (workspace.charts.length > 20) {
      warnings.push('Workspace has more than 20 charts, performance may be affected');
    }

    // Validate each chart
    workspace.charts.forEach((chart, index) => {
      if (!chart.symbol) {
        errors.push(`Chart ${index + 1} is missing symbol`);
      }
      if (!chart.timeframe) {
        errors.push(`Chart ${index + 1} is missing timeframe`);
      }
    });

    return {
      valid: errors.length === 0,
      errors,
      warnings,
    };
  }

  /**
   * Save workspace to backend
   */
  async saveWorkspace(
    name?: string,
    description?: string,
    overwrite: boolean = true
  ): Promise<void> {
    try {
      this.autoSaveState.saving = true;
      this.autoSaveState.error = null;
      this.notifyChangeListeners(false);

      // Capture current state
      const workspace = await this.captureWorkspaceState(
        name || this.currentWorkspace?.name || 'Untitled Workspace',
        description || this.currentWorkspace?.description
      );

      // Save to backend
      const response = await workspaceApi.saveWorkspace({
        workspace,
        overwrite,
      });

      if (response.success) {
        this.currentWorkspace = workspace;
        this.currentWorkspace.id = response.workspaceId;
        this.autoSaveState.lastSaved = new Date();
        this.autoSaveState.hasUnsavedChanges = false;
        this.updateStateSnapshot();
      } else if (response.conflict) {
        // Handle conflict
        const shouldOverwrite = await this.handleConflict(response.conflictVersion!);
        if (shouldOverwrite) {
          return this.saveWorkspace(name, description, true);
        }
      } else {
        throw new Error(response.message || 'Failed to save workspace');
      }
    } catch (error: any) {
      const workspaceError: WorkspaceError = {
        code: error.statusCode === 401 ? 'UNAUTHORIZED' :
              error.statusCode === 409 ? 'CONFLICT' :
              error.name === 'ApiError' ? 'NETWORK_ERROR' : 'SERVER_ERROR',
        message: error.message,
        details: error,
      };

      this.autoSaveState.error = workspaceError;
      throw error;
    } finally {
      this.autoSaveState.saving = false;
      this.notifyChangeListeners(this.autoSaveState.hasUnsavedChanges);
    }
  }

  /**
   * Load workspace from backend and apply to UI
   */
  async loadWorkspace(workspaceId: string): Promise<void> {
    try {
      const response = await workspaceApi.loadWorkspace(workspaceId);

      if (!response.success || !response.workspace) {
        throw new Error(response.message || 'Failed to load workspace');
      }

      const workspace = response.workspace;

      // Validate loaded workspace
      const validation = this.validateWorkspace(workspace);
      if (!validation.valid) {
        throw new Error(`Invalid workspace data: ${validation.errors.join(', ')}`);
      }

      // Apply workspace to UI
      await this.applyWorkspace(workspace);

      this.currentWorkspace = workspace;
      this.autoSaveState.lastSaved = workspace.updatedAt;
      this.autoSaveState.hasUnsavedChanges = false;
      this.updateStateSnapshot();
    } catch (error: any) {
      console.error('Failed to load workspace:', error);
      throw error;
    }
  }

  /**
   * Apply workspace configuration to the UI
   */
  private async applyWorkspace(workspace: Workspace): Promise<void> {
    // Apply layout configuration
    this.applyLayoutConfig(workspace.layout);

    // Apply market watch configuration
    this.applyMarketWatchConfig(workspace.marketWatch);

    // Apply order panel settings
    this.applyOrderPanelSettings(workspace.orderPanel);

    // Apply charts (this should be done last)
    await this.applyCharts(workspace.charts);
  }

  /**
   * Apply layout configuration
   */
  private applyLayoutConfig(layout: LayoutConfig): void {
    (window as any).__layoutConfig = layout;

    // Trigger layout update event
    window.dispatchEvent(new CustomEvent('workspace:layout-updated', { detail: layout }));
  }

  /**
   * Apply market watch configuration
   */
  private applyMarketWatchConfig(config: MarketWatchConfig): void {
    (window as any).__marketWatchConfig = config;

    // Trigger market watch update event
    window.dispatchEvent(new CustomEvent('workspace:marketwatch-updated', { detail: config }));
  }

  /**
   * Apply order panel settings
   */
  private applyOrderPanelSettings(settings: OrderPanelSettings): void {
    (window as any).__orderPanelSettings = settings;

    // Trigger order panel update event
    window.dispatchEvent(new CustomEvent('workspace:orderpanel-updated', { detail: settings }));
  }

  /**
   * Apply charts
   */
  private async applyCharts(charts: ChartState[]): Promise<void> {
    // Clear existing charts
    window.dispatchEvent(new CustomEvent('workspace:clear-charts'));

    // Apply each chart
    for (const chart of charts) {
      await this.applyChart(chart);
    }
  }

  /**
   * Apply a single chart
   */
  private async applyChart(chart: ChartState): Promise<void> {
    window.dispatchEvent(new CustomEvent('workspace:apply-chart', { detail: chart }));
  }

  /**
   * Handle save conflicts
   */
  private async handleConflict(conflictVersion: Workspace): Promise<boolean> {
    // This would show a dialog to the user
    // For now, always return false (don't overwrite)
    console.warn('Workspace conflict detected:', conflictVersion);
    return false;
  }

  /**
   * Setup auto-save functionality
   */
  private setupAutoSave(): void {
    // Start monitoring for changes
    this.startAutoSaveTimer();

    // Listen for changes
    window.addEventListener('workspace:change', () => {
      this.markAsChanged();
    });

    // Save before unload
    window.addEventListener('beforeunload', (e) => {
      if (this.autoSaveState.hasUnsavedChanges) {
        e.preventDefault();
        e.returnValue = 'You have unsaved changes. Are you sure you want to leave?';
      }
    });
  }

  /**
   * Start auto-save timer
   */
  private startAutoSaveTimer(): void {
    if (this.autoSaveTimer) {
      clearInterval(this.autoSaveTimer);
    }

    this.autoSaveTimer = setInterval(() => {
      if (this.autoSaveState.enabled && this.autoSaveState.hasUnsavedChanges && !this.autoSaveState.saving) {
        this.saveWorkspace().catch(error => {
          console.error('Auto-save failed:', error);
        });
      }
    }, this.autoSaveState.interval);
  }

  /**
   * Mark workspace as changed
   */
  private markAsChanged(): void {
    const currentSnapshot = this.getCurrentStateSnapshot();

    if (currentSnapshot !== this.stateSnapshot) {
      this.autoSaveState.hasUnsavedChanges = true;
      this.notifyChangeListeners(true);
    }
  }

  /**
   * Update state snapshot
   */
  private updateStateSnapshot(): void {
    this.stateSnapshot = this.getCurrentStateSnapshot();
  }

  /**
   * Get current state snapshot for change detection
   */
  private getCurrentStateSnapshot(): string {
    try {
      // Create a lightweight snapshot of key state
      const snapshot = {
        charts: this.captureChartStates().map(c => ({
          id: c.id,
          symbol: c.symbol,
          timeframe: c.timeframe,
          indicatorCount: c.indicators.length,
          drawingCount: c.drawings.length,
        })),
        layout: this.captureLayoutConfig(),
      };
      return JSON.stringify(snapshot);
    } catch (error) {
      return '';
    }
  }

  /**
   * Generate unique ID
   */
  private generateId(): string {
    return `ws_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
  }

  /**
   * Add change listener
   */
  addChangeListener(callback: (hasChanges: boolean) => void): () => void {
    this.changeListeners.add(callback);
    return () => this.changeListeners.delete(callback);
  }

  /**
   * Notify change listeners
   */
  private notifyChangeListeners(hasChanges: boolean): void {
    this.changeListeners.forEach(callback => callback(hasChanges));
  }

  /**
   * Get auto-save state
   */
  getAutoSaveState(): AutoSaveState {
    return { ...this.autoSaveState };
  }

  /**
   * Enable/disable auto-save
   */
  setAutoSaveEnabled(enabled: boolean): void {
    this.autoSaveState.enabled = enabled;
    if (enabled) {
      this.startAutoSaveTimer();
    } else if (this.autoSaveTimer) {
      clearInterval(this.autoSaveTimer);
      this.autoSaveTimer = null;
    }
  }

  /**
   * Set auto-save interval
   */
  setAutoSaveInterval(interval: number): void {
    this.autoSaveState.interval = interval;
    if (this.autoSaveState.enabled) {
      this.startAutoSaveTimer();
    }
  }

  /**
   * Get current workspace
   */
  getCurrentWorkspace(): Workspace | null {
    return this.currentWorkspace;
  }

  /**
   * Cleanup
   */
  destroy(): void {
    if (this.autoSaveTimer) {
      clearInterval(this.autoSaveTimer);
    }
    this.changeListeners.clear();
  }
}

// Export singleton instance
export const workspaceManager = new WorkspaceManager();
export default workspaceManager;
