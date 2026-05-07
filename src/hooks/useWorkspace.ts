/**
 * React Hook for Workspace Management
 * Provides workspace state and operations with auto-save
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { workspaceManager } from '../services/workspaceManager';
import { workspaceApi } from '../services/workspaceApi';
import type {
  Workspace,
  WorkspaceMetadata,
  AutoSaveState,
  WorkspaceError,
} from '../types/workspace';

interface UseWorkspaceOptions {
  autoSaveEnabled?: boolean;
  autoSaveInterval?: number;
}

interface UseWorkspaceReturn {
  // Current workspace state
  currentWorkspace: Workspace | null;
  workspaceList: WorkspaceMetadata[];

  // Auto-save state
  autoSaveState: AutoSaveState;

  // Loading states
  isSaving: boolean;
  isLoading: boolean;
  isLoadingList: boolean;

  // Error state
  error: WorkspaceError | null;

  // Operations
  saveWorkspace: (name?: string, description?: string) => Promise<void>;
  loadWorkspace: (workspaceId: string) => Promise<void>;
  deleteWorkspace: (workspaceId: string) => Promise<void>;
  refreshWorkspaceList: () => Promise<void>;
  createNewWorkspace: (name: string, description?: string) => Promise<void>;
  duplicateWorkspace: (workspaceId: string, newName: string) => Promise<void>;
  setDefaultWorkspace: (workspaceId: string) => Promise<void>;

  // Auto-save control
  setAutoSaveEnabled: (enabled: boolean) => void;
  setAutoSaveInterval: (interval: number) => void;

  // Utility
  hasUnsavedChanges: boolean;
  clearError: () => void;
}

export function useWorkspace(options: UseWorkspaceOptions = {}): UseWorkspaceReturn {
  const {
    autoSaveEnabled = true,
    autoSaveInterval = 30000,
  } = options;

  // State
  const [currentWorkspace, setCurrentWorkspace] = useState<Workspace | null>(null);
  const [workspaceList, setWorkspaceList] = useState<WorkspaceMetadata[]>([]);
  const [autoSaveState, setAutoSaveState] = useState<AutoSaveState>(
    workspaceManager.getAutoSaveState()
  );
  const [isSaving, setIsSaving] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [isLoadingList, setIsLoadingList] = useState(false);
  const [error, setError] = useState<WorkspaceError | null>(null);

  // Refs
  const autoSaveStateRef = useRef(autoSaveState);
  autoSaveStateRef.current = autoSaveState;

  // Initialize workspace manager
  useEffect(() => {
    workspaceManager.setAutoSaveEnabled(autoSaveEnabled);
    workspaceManager.setAutoSaveInterval(autoSaveInterval);

    // Listen for auto-save state changes
    const unsubscribe = workspaceManager.addChangeListener((hasChanges) => {
      setAutoSaveState(workspaceManager.getAutoSaveState());
    });

    // Load workspace list on mount
    refreshWorkspaceList();

    return () => {
      unsubscribe();
    };
  }, []);

  // Update auto-save settings when options change
  useEffect(() => {
    workspaceManager.setAutoSaveEnabled(autoSaveEnabled);
  }, [autoSaveEnabled]);

  useEffect(() => {
    workspaceManager.setAutoSaveInterval(autoSaveInterval);
  }, [autoSaveInterval]);

  // Save workspace
  const saveWorkspace = useCallback(async (name?: string, description?: string) => {
    try {
      setIsSaving(true);
      setError(null);

      await workspaceManager.saveWorkspace(name, description);

      const saved = workspaceManager.getCurrentWorkspace();
      setCurrentWorkspace(saved);
      setAutoSaveState(workspaceManager.getAutoSaveState());

      // Refresh list to show updated workspace
      await refreshWorkspaceList();
    } catch (err: any) {
      const workspaceError: WorkspaceError = {
        code: err.statusCode === 401 ? 'UNAUTHORIZED' :
              err.statusCode === 409 ? 'CONFLICT' :
              err.name === 'ApiError' ? 'NETWORK_ERROR' : 'SERVER_ERROR',
        message: err.message || 'Failed to save workspace',
        details: err,
      };
      setError(workspaceError);
      throw err;
    } finally {
      setIsSaving(false);
    }
  }, []);

  // Load workspace
  const loadWorkspace = useCallback(async (workspaceId: string) => {
    try {
      setIsLoading(true);
      setError(null);

      await workspaceManager.loadWorkspace(workspaceId);

      const loaded = workspaceManager.getCurrentWorkspace();
      setCurrentWorkspace(loaded);
      setAutoSaveState(workspaceManager.getAutoSaveState());
    } catch (err: any) {
      const workspaceError: WorkspaceError = {
        code: err.statusCode === 404 ? 'NOT_FOUND' :
              err.statusCode === 401 ? 'UNAUTHORIZED' :
              err.name === 'ApiError' ? 'NETWORK_ERROR' : 'SERVER_ERROR',
        message: err.message || 'Failed to load workspace',
        details: err,
      };
      setError(workspaceError);
      throw err;
    } finally {
      setIsLoading(false);
    }
  }, []);

  // Delete workspace
  const deleteWorkspace = useCallback(async (workspaceId: string) => {
    try {
      setError(null);

      const response = await workspaceApi.deleteWorkspace(workspaceId);

      if (!response.success) {
        throw new Error(response.message || 'Failed to delete workspace');
      }

      // Refresh list
      await refreshWorkspaceList();

      // If deleted workspace was current, clear current
      if (currentWorkspace?.id === workspaceId) {
        setCurrentWorkspace(null);
      }
    } catch (err: any) {
      const workspaceError: WorkspaceError = {
        code: err.statusCode === 404 ? 'NOT_FOUND' :
              err.statusCode === 401 ? 'UNAUTHORIZED' :
              err.name === 'ApiError' ? 'NETWORK_ERROR' : 'SERVER_ERROR',
        message: err.message || 'Failed to delete workspace',
        details: err,
      };
      setError(workspaceError);
      throw err;
    }
  }, [currentWorkspace]);

  // Refresh workspace list
  const refreshWorkspaceList = useCallback(async () => {
    try {
      setIsLoadingList(true);
      setError(null);

      const response = await workspaceApi.listWorkspaces();

      if (response.success) {
        setWorkspaceList(response.workspaces);
      }
    } catch (err: any) {
      const workspaceError: WorkspaceError = {
        code: err.statusCode === 401 ? 'UNAUTHORIZED' :
              err.name === 'ApiError' ? 'NETWORK_ERROR' : 'SERVER_ERROR',
        message: err.message || 'Failed to load workspace list',
        details: err,
      };
      setError(workspaceError);
    } finally {
      setIsLoadingList(false);
    }
  }, []);

  // Create new workspace
  const createNewWorkspace = useCallback(async (name: string, description?: string) => {
    try {
      setIsSaving(true);
      setError(null);

      // Capture current state with new name
      const workspace = await workspaceManager.captureWorkspaceState(name, description);
      workspace.id = ''; // Force new ID

      // Save to backend
      await workspaceManager.saveWorkspace(name, description);

      const saved = workspaceManager.getCurrentWorkspace();
      setCurrentWorkspace(saved);

      // Refresh list
      await refreshWorkspaceList();
    } catch (err: any) {
      const workspaceError: WorkspaceError = {
        code: err.name === 'ApiError' ? 'NETWORK_ERROR' : 'SERVER_ERROR',
        message: err.message || 'Failed to create workspace',
        details: err,
      };
      setError(workspaceError);
      throw err;
    } finally {
      setIsSaving(false);
    }
  }, []);

  // Duplicate workspace
  const duplicateWorkspace = useCallback(async (workspaceId: string, newName: string) => {
    try {
      setError(null);

      const response = await workspaceApi.duplicateWorkspace(workspaceId, newName);

      if (!response.success) {
        throw new Error(response.message || 'Failed to duplicate workspace');
      }

      // Refresh list
      await refreshWorkspaceList();
    } catch (err: any) {
      const workspaceError: WorkspaceError = {
        code: err.statusCode === 404 ? 'NOT_FOUND' :
              err.name === 'ApiError' ? 'NETWORK_ERROR' : 'SERVER_ERROR',
        message: err.message || 'Failed to duplicate workspace',
        details: err,
      };
      setError(workspaceError);
      throw err;
    }
  }, []);

  // Set default workspace
  const setDefaultWorkspace = useCallback(async (workspaceId: string) => {
    try {
      setError(null);

      const response = await workspaceApi.setDefaultWorkspace(workspaceId);

      if (!response.success) {
        throw new Error(response.message || 'Failed to set default workspace');
      }

      // Refresh list to show updated default
      await refreshWorkspaceList();
    } catch (err: any) {
      const workspaceError: WorkspaceError = {
        code: err.statusCode === 404 ? 'NOT_FOUND' :
              err.name === 'ApiError' ? 'NETWORK_ERROR' : 'SERVER_ERROR',
        message: err.message || 'Failed to set default workspace',
        details: err,
      };
      setError(workspaceError);
      throw err;
    }
  }, []);

  // Auto-save control
  const setAutoSaveEnabled = useCallback((enabled: boolean) => {
    workspaceManager.setAutoSaveEnabled(enabled);
    setAutoSaveState(workspaceManager.getAutoSaveState());
  }, []);

  const setAutoSaveInterval = useCallback((interval: number) => {
    workspaceManager.setAutoSaveInterval(interval);
    setAutoSaveState(workspaceManager.getAutoSaveState());
  }, []);

  // Clear error
  const clearError = useCallback(() => {
    setError(null);
  }, []);

  return {
    currentWorkspace,
    workspaceList,
    autoSaveState,
    isSaving,
    isLoading,
    isLoadingList,
    error,
    saveWorkspace,
    loadWorkspace,
    deleteWorkspace,
    refreshWorkspaceList,
    createNewWorkspace,
    duplicateWorkspace,
    setDefaultWorkspace,
    setAutoSaveEnabled,
    setAutoSaveInterval,
    hasUnsavedChanges: autoSaveState.hasUnsavedChanges,
    clearError,
  };
}

export default useWorkspace;
