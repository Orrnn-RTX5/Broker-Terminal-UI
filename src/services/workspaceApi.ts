/**
 * Workspace API Service
 * Backend communication for workspace persistence
 */

import type {
  Workspace,
  WorkspaceMetadata,
  SaveWorkspaceRequest,
  SaveWorkspaceResponse,
  LoadWorkspaceResponse,
  ListWorkspacesResponse,
  DeleteWorkspaceResponse,
} from '../types/workspace';
import { FIX_API_URL, normalizeServerUrl } from '../config/api';
import { getServerUrl } from './brokerSession';

const getFixApiBaseUrl = (): string => {
  const brokerServer = normalizeServerUrl(getServerUrl());
  if (brokerServer) {
    return brokerServer.replace(/\/$/, '');
  }

  return normalizeServerUrl(
    FIX_API_URL
    || import.meta.env.VITE_FIX_API_URL as string
    || import.meta.env.VITE_API_URL as string
    || import.meta.env.VITE_BACKEND_URL as string
    || ''
  ).replace(/\/$/, '');
};

const DEFAULT_TIMEOUT = 10000;

class ApiError extends Error {
  statusCode?: number;
  response?: unknown;

  constructor(message: string, statusCode?: number, response?: unknown) {
    super(message);
    this.name = 'ApiError';
    this.statusCode = statusCode;
    this.response = response;
  }
}

/**
 * Fetch with timeout and auth token
 */
async function fetchWithTimeout(
  url: string,
  options: RequestInit = {},
  timeout = DEFAULT_TIMEOUT
): Promise<Response> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeout);

  try {
    // Get auth token from store
    const authToken = localStorage.getItem('authToken');

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      ...(options.headers as Record<string, string>),
    };

    if (authToken) {
      headers['Authorization'] = `Bearer ${authToken}`;
    }

    const response = await fetch(url, {
      ...options,
      signal: controller.signal,
      headers,
    });

    clearTimeout(timeoutId);

    // Handle 401 Unauthorized
    if (response.status === 401) {
      localStorage.removeItem('authToken');
      window.location.href = '/';
      throw new ApiError('Unauthorized - please log in again', 401, response);
    }

    return response;
  } catch (error: any) {
    clearTimeout(timeoutId);
    if (error.name === 'AbortError') {
      throw new ApiError('Request timeout', 408);
    }
    throw error;
  }
}

/**
 * Handle API response
 */
async function handleResponse<T>(response: Response): Promise<T> {
  const contentType = response.headers.get('content-type');
  const isJson = contentType?.includes('application/json');

  if (!response.ok) {
    let errorMessage = `HTTP ${response.status}: ${response.statusText}`;

    if (isJson) {
      const errorData = await response.json();
      errorMessage = errorData.error || errorData.message || errorMessage;
    } else {
      errorMessage = (await response.text()) || errorMessage;
    }

    throw new ApiError(errorMessage, response.status, response);
  }

  if (isJson) {
    return await response.json();
  }

  return {} as T;
}

/**
 * Workspace API endpoints
 */
export const workspaceApi = {
  /**
   * Save workspace to backend
   */
  async saveWorkspace(request: SaveWorkspaceRequest): Promise<SaveWorkspaceResponse> {
    try {
      const response = await fetchWithTimeout(`${getFixApiBaseUrl()}/api/v2/workspaces`, {
        method: 'POST',
        body: JSON.stringify(request),
      });

      return await handleResponse<SaveWorkspaceResponse>(response);
    } catch (error: any) {
      console.error('Failed to save workspace:', error);
      throw error;
    }
  },

  /**
   * Load workspace from backend
   */
  async loadWorkspace(workspaceId: string): Promise<LoadWorkspaceResponse> {
    try {
      const response = await fetchWithTimeout(
        `${getFixApiBaseUrl()}/api/v2/workspaces/${workspaceId}`
      );

      return await handleResponse<LoadWorkspaceResponse>(response);
    } catch (error: any) {
      console.error('Failed to load workspace:', error);
      throw error;
    }
  },

  /**
   * List all workspaces for current user
   */
  async listWorkspaces(userId?: string): Promise<ListWorkspacesResponse> {
    try {
      const queryParams = userId ? `?userId=${userId}` : '';
      const response = await fetchWithTimeout(
        `${getFixApiBaseUrl()}/api/v2/workspaces${queryParams}`
      );

      return await handleResponse<ListWorkspacesResponse>(response);
    } catch (error: any) {
      console.error('Failed to list workspaces:', error);
      throw error;
    }
  },

  /**
   * Delete workspace
   */
  async deleteWorkspace(workspaceId: string): Promise<DeleteWorkspaceResponse> {
    try {
      const response = await fetchWithTimeout(
        `${getFixApiBaseUrl()}/api/v2/workspaces/${workspaceId}`,
        {
          method: 'DELETE',
        }
      );

      return await handleResponse<DeleteWorkspaceResponse>(response);
    } catch (error: any) {
      console.error('Failed to delete workspace:', error);
      throw error;
    }
  },

  /**
   * Update workspace metadata (name, description, tags)
   */
  async updateWorkspaceMetadata(
    workspaceId: string,
    updates: Partial<Pick<Workspace, 'name' | 'description' | 'tags' | 'isDefault'>>
  ): Promise<SaveWorkspaceResponse> {
    try {
        const response = await fetchWithTimeout(
        `${getFixApiBaseUrl()}/api/v2/workspaces/${workspaceId}/metadata`,
        {
          method: 'PATCH',
          body: JSON.stringify(updates),
        }
      );

      return await handleResponse<SaveWorkspaceResponse>(response);
    } catch (error: any) {
      console.error('Failed to update workspace metadata:', error);
      throw error;
    }
  },

  /**
   * Set default workspace for user
   */
  async setDefaultWorkspace(workspaceId: string): Promise<SaveWorkspaceResponse> {
    try {
      const response = await fetchWithTimeout(
        `${getFixApiBaseUrl()}/api/v2/workspaces/${workspaceId}/set-default`,
        {
          method: 'POST',
        }
      );

      return await handleResponse<SaveWorkspaceResponse>(response);
    } catch (error: any) {
      console.error('Failed to set default workspace:', error);
      throw error;
    }
  },

  /**
   * Get default workspace for user
   */
  async getDefaultWorkspace(userId?: string): Promise<LoadWorkspaceResponse> {
    try {
      const queryParams = userId ? `?userId=${userId}` : '';
      const response = await fetchWithTimeout(
        `${getFixApiBaseUrl()}/api/v2/workspaces/default${queryParams}`
      );

      return await handleResponse<LoadWorkspaceResponse>(response);
    } catch (error: any) {
      console.error('Failed to get default workspace:', error);
      throw error;
    }
  },

  /**
   * Duplicate workspace
   */
  async duplicateWorkspace(
    workspaceId: string,
    newName: string
  ): Promise<SaveWorkspaceResponse> {
    try {
      const response = await fetchWithTimeout(
        `${getFixApiBaseUrl()}/api/v2/workspaces/${workspaceId}/duplicate`,
        {
          method: 'POST',
          body: JSON.stringify({ name: newName }),
        }
      );

      return await handleResponse<SaveWorkspaceResponse>(response);
    } catch (error: any) {
      console.error('Failed to duplicate workspace:', error);
      throw error;
    }
  },

  /**
   * Export workspace as JSON
   */
  async exportWorkspace(workspaceId: string): Promise<Workspace> {
    try {
      const response = await fetchWithTimeout(
        `${getFixApiBaseUrl()}/api/v2/workspaces/${workspaceId}/export`
      );

      const result = await handleResponse<{ workspace: Workspace }>(response);
      return result.workspace;
    } catch (error: any) {
      console.error('Failed to export workspace:', error);
      throw error;
    }
  },

  /**
   * Import workspace from JSON
   */
  async importWorkspace(workspaceData: Workspace): Promise<SaveWorkspaceResponse> {
    try {
      const response = await fetchWithTimeout(
        `${getFixApiBaseUrl()}/api/v2/workspaces/import`,
        {
          method: 'POST',
          body: JSON.stringify({ workspace: workspaceData }),
        }
      );

      return await handleResponse<SaveWorkspaceResponse>(response);
    } catch (error: any) {
      console.error('Failed to import workspace:', error);
      throw error;
    }
  },

  /**
   * Search workspaces
   */
  async searchWorkspaces(
    query: string,
    filters?: { tags?: string[]; accountId?: string }
  ): Promise<ListWorkspacesResponse> {
    try {
      const queryParams = new URLSearchParams({ query });
      if (filters?.tags) {
        queryParams.append('tags', filters.tags.join(','));
      }
      if (filters?.accountId) {
        queryParams.append('accountId', filters.accountId);
      }

      const response = await fetchWithTimeout(
        `${getFixApiBaseUrl()}/api/v2/workspaces/search?${queryParams}`
      );

      return await handleResponse<ListWorkspacesResponse>(response);
    } catch (error: any) {
      console.error('Failed to search workspaces:', error);
      throw error;
    }
  },
};

export default workspaceApi;
