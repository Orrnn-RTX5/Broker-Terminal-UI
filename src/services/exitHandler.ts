/**
 * Exit Handler Service
 * Manages graceful application shutdown with unsaved changes detection
 */

import { useAppStore } from '../store/useAppStore';

export interface UnsavedChanges {
  hasWorkspaceChanges: boolean;
  hasOpenTrades: boolean;
  hasDraftOrders: boolean;
  openTradesCount: number;
  draftOrdersCount: number;
  workspaceModified: boolean;
}

export interface ExitPreferences {
  dontAskAgain: boolean;
  autoSaveWorkspace: boolean;
}

class ExitHandler {
  private isExiting = false;
  private cleanupTasks: Array<() => Promise<void> | void> = [];
  private preferences: ExitPreferences = {
    dontAskAgain: false,
    autoSaveWorkspace: false,
  };

  constructor() {
    this.loadPreferences();
    this.setupEventListeners();
  }

  /**
   * Load exit preferences from localStorage
   */
  private loadPreferences(): void {
    try {
      const stored = localStorage.getItem('exitPreferences');
      if (stored) {
        this.preferences = JSON.parse(stored);
      }
    } catch (error) {
      console.error('[ExitHandler] Failed to load preferences:', error);
    }
  }

  /**
   * Save exit preferences to localStorage
   */
  savePreferences(preferences: Partial<ExitPreferences>): void {
    this.preferences = { ...this.preferences, ...preferences };
    try {
      localStorage.setItem('exitPreferences', JSON.stringify(this.preferences));
    } catch (error) {
      console.error('[ExitHandler] Failed to save preferences:', error);
    }
  }

  /**
   * Get current exit preferences
   */
  getPreferences(): ExitPreferences {
    return { ...this.preferences };
  }

  /**
   * Setup event listeners for browser/window close
   */
  private setupEventListeners(): void {
    // Browser beforeunload event
    if (typeof window !== 'undefined') {
      window.addEventListener('beforeunload', this.handleBeforeUnload.bind(this));
    }

    // Electron app 'before-quit' event (if available)
    if (typeof window !== 'undefined' && (window as any).electron?.on) {
      (window as any).electron.on('before-quit', this.handleElectronQuit.bind(this));
    }
  }

  /**
   * Handle browser/window beforeunload event
   */
  private handleBeforeUnload(event: BeforeUnloadEvent): void {
    if (this.isExiting) {
      return;
    }

    const unsavedChanges = this.detectUnsavedChanges();

    if (this.hasUnsavedChanges(unsavedChanges) && !this.preferences.dontAskAgain) {
      // Show browser's native confirmation dialog
      event.preventDefault();
      event.returnValue = ''; // Chrome requires returnValue to be set
    }
  }

  /**
   * Handle Electron before-quit event
   */
  private async handleElectronQuit(event: any): Promise<void> {
    if (this.isExiting) {
      return;
    }

    const unsavedChanges = this.detectUnsavedChanges();

    if (this.hasUnsavedChanges(unsavedChanges) && !this.preferences.dontAskAgain) {
      // Prevent quit to show dialog
      event.preventDefault();

      // Show custom dialog (would be implemented in Electron main process)
      const shouldQuit = await this.showExitDialog(unsavedChanges);

      if (shouldQuit) {
        await this.performCleanup();
        // Allow quit
        if ((window as any).electron?.app?.quit) {
          (window as any).electron.app.quit();
        }
      }
    } else {
      await this.performCleanup();
    }
  }

  /**
   * Detect unsaved changes in application
   */
  detectUnsavedChanges(): UnsavedChanges {
    const state = useAppStore.getState();

    // Check for open positions
    const openTrades = state.positions || [];
    const hasOpenTrades = openTrades.length > 0;

    // Check for pending orders
    const draftOrders = state.orders?.filter(o => o.status === 'PENDING') || [];
    const hasDraftOrders = draftOrders.length > 0;

    // Check workspace modifications (check if current layout differs from saved)
    const workspaceModified = this.isWorkspaceModified();

    return {
      hasWorkspaceChanges: workspaceModified,
      hasOpenTrades,
      hasDraftOrders,
      openTradesCount: openTrades.length,
      draftOrdersCount: draftOrders.length,
      workspaceModified,
    };
  }

  /**
   * Check if there are any unsaved changes
   */
  private hasUnsavedChanges(changes: UnsavedChanges): boolean {
    return changes.hasWorkspaceChanges || changes.hasOpenTrades || changes.hasDraftOrders;
  }

  /**
   * Check if workspace has been modified since last save
   */
  private isWorkspaceModified(): boolean {
    try {
      const lastSaved = localStorage.getItem('lastWorkspaceSave');
      const currentState = localStorage.getItem('trading-app-storage');

      if (!lastSaved) {
        // No saved workspace - consider modified if there's any state
        return !!currentState;
      }

      return lastSaved !== currentState;
    } catch (error) {
      console.error('[ExitHandler] Error checking workspace modifications:', error);
      return false;
    }
  }

  /**
   * Show exit confirmation dialog
   * Returns true if should exit, false if canceled
   */
  async showExitDialog(changes: UnsavedChanges): Promise<boolean> {
    // This would trigger a React dialog component
    // For now, return a promise that resolves when user makes choice
    return new Promise((resolve) => {
      // Dispatch custom event that dialog component listens for
      window.dispatchEvent(new CustomEvent('showExitDialog', {
        detail: {
          changes,
          onConfirm: (saveWorkspace: boolean) => {
            if (saveWorkspace) {
              this.saveWorkspace();
            }
            resolve(true);
          },
          onCancel: () => resolve(false),
        }
      }));
    });
  }

  /**
   * Register a cleanup task to run on exit
   */
  registerCleanupTask(task: () => Promise<void> | void): void {
    this.cleanupTasks.push(task);
  }

  /**
   * Perform cleanup operations
   */
  async performCleanup(): Promise<void> {
    if (this.isExiting) {
      return;
    }

    this.isExiting = true;
    console.log('[ExitHandler] Starting cleanup...');

    try {
      // Close WebSocket connections
      await this.closeWebSocketConnections();

      // Cancel pending requests
      await this.cancelPendingRequests();

      // Clear sensitive data
      this.clearSensitiveData();

      // Run registered cleanup tasks
      for (const task of this.cleanupTasks) {
        try {
          await task();
        } catch (error) {
          console.error('[ExitHandler] Cleanup task failed:', error);
        }
      }

      // Auto-save workspace if preference is set
      if (this.preferences.autoSaveWorkspace) {
        this.saveWorkspace();
      }

      console.log('[ExitHandler] Cleanup completed');
    } catch (error) {
      console.error('[ExitHandler] Cleanup failed:', error);
    }
  }

  /**
   * Close WebSocket connections gracefully
   */
  private async closeWebSocketConnections(): Promise<void> {
    try {
      // Access WebSocket instance from global scope or store
      const ws = (window as any).tradingWebSocket;
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.close(1000, 'Application closing');
      }
    } catch (error) {
      console.error('[ExitHandler] Failed to close WebSocket:', error);
    }
  }

  /**
   * Cancel pending HTTP requests
   */
  private async cancelPendingRequests(): Promise<void> {
    // If using AbortController for fetch requests, abort them
    if ((window as any).pendingRequests) {
      for (const controller of (window as any).pendingRequests) {
        controller.abort();
      }
    }
  }

  /**
   * Clear sensitive data from memory and storage
   */
  private clearSensitiveData(): void {
    try {
      // Clear auth token from store
      useAppStore.getState().clearAuth();

      // Clear sensitive items from sessionStorage
      sessionStorage.removeItem('tempAuthToken');
      sessionStorage.removeItem('apiKeys');

      // Note: We keep localStorage for workspace/settings persistence
    } catch (error) {
      console.error('[ExitHandler] Failed to clear sensitive data:', error);
    }
  }

  /**
   * Save current workspace
   */
  private saveWorkspace(): void {
    try {
      const currentState = localStorage.getItem('trading-app-storage');
      if (currentState) {
        localStorage.setItem('lastWorkspaceSave', currentState);
        console.log('[ExitHandler] Workspace saved');
      }
    } catch (error) {
      console.error('[ExitHandler] Failed to save workspace:', error);
    }
  }

  /**
   * Initiate exit sequence (call this from UI)
   */
  async initiateExit(): Promise<boolean> {
    const unsavedChanges = this.detectUnsavedChanges();

    // If no changes or user doesn't want to be asked, exit immediately
    if (!this.hasUnsavedChanges(unsavedChanges) || this.preferences.dontAskAgain) {
      await this.performCleanup();
      return true;
    }

    // Show confirmation dialog
    const shouldExit = await this.showExitDialog(unsavedChanges);

    if (shouldExit) {
      await this.performCleanup();
      return true;
    }

    return false;
  }

  /**
   * Force exit without confirmation (emergency shutdown)
   */
  async forceExit(): Promise<void> {
    await this.performCleanup();

    // For web, redirect to logout/login
    if (typeof window !== 'undefined') {
      window.location.href = '/';
    }
  }

  /**
   * Logout and clear session
   */
  async logout(): Promise<void> {
    await this.performCleanup();

    // Clear all application state
    useAppStore.getState().reset();

    // Redirect to login
    if (typeof window !== 'undefined') {
      window.location.href = '/';
    }
  }
}

// Singleton instance
export const exitHandler = new ExitHandler();
export default exitHandler;
