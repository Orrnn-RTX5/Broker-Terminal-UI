/**
 * Data Folder Manager Service
 * Handles access to user data folder with platform detection (web/desktop/Electron)
 */

import { buildApiUrl } from '../config/api';

export interface DataFolderStructure {
  profiles: string;
  templates: string;
  logs: string;
  cache: string;
  indicators: string;
  drawings: string;
  workspaces: string;
}

export interface FileEntry {
  name: string;
  path: string;
  type: 'file' | 'directory';
  size?: number;
  modified?: Date;
}

export type Platform = 'web' | 'desktop' | 'electron';

class DataFolderManager {
  private platform: Platform = 'web';
  private dataFolderPath: string = '';

  constructor() {
    this.detectPlatform();
  }

  /**
   * Detect current platform (web browser, desktop PWA, or Electron)
   */
  private detectPlatform(): void {
    // Check if running in Electron
    if (typeof window !== 'undefined' && (window as any).electron) {
      this.platform = 'electron';
      return;
    }

    // Check if running as PWA/standalone
    if (typeof window !== 'undefined' && window.matchMedia('(display-mode: standalone)').matches) {
      this.platform = 'desktop';
      return;
    }

    // Default to web
    this.platform = 'web';
  }

  /**
   * Get current platform
   */
  getPlatform(): Platform {
    return this.platform;
  }

  /**
   * Get data folder path from backend
   */
  async getDataFolderPath(): Promise<string> {
    if (this.dataFolderPath) {
      return this.dataFolderPath;
    }

    try {
      const response = await fetch(buildApiUrl('/api/user/data-folder'), {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
        },
      });

      if (!response.ok) {
        throw new Error('Failed to get data folder path');
      }

      const data = await response.json();
      this.dataFolderPath = data.path || './user-data';
      return this.dataFolderPath;
    } catch (error) {
      console.error('[DataFolderManager] Error getting data folder path:', error);
      // Fallback to default path
      this.dataFolderPath = './user-data';
      return this.dataFolderPath;
    }
  }

  /**
   * Open data folder in OS file explorer (Electron only)
   */
  async openInExplorer(): Promise<boolean> {
    if (this.platform !== 'electron') {
      console.warn('[DataFolderManager] openInExplorer only works in Electron');
      return false;
    }

    try {
      const path = await this.getDataFolderPath();

      // Call Electron API to open path
      if ((window as any).electron?.shell?.openPath) {
        const result = await (window as any).electron.shell.openPath(path);
        if (result) {
          console.error('[DataFolderManager] Failed to open path:', result);
          return false;
        }
        return true;
      }

      console.error('[DataFolderManager] Electron shell API not available');
      return false;
    } catch (error) {
      console.error('[DataFolderManager] Error opening folder:', error);
      return false;
    }
  }

  /**
   * List files in data folder (or subfolder)
   */
  async listFiles(subfolder?: keyof DataFolderStructure): Promise<FileEntry[]> {
    try {
      const basePath = await this.getDataFolderPath();
      const targetPath = subfolder ? `${basePath}/${subfolder}` : basePath;

      const response = await fetch(buildApiUrl(`/api/user/data-folder/list?path=${encodeURIComponent(targetPath)}`), {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
        },
      });

      if (!response.ok) {
        throw new Error('Failed to list files');
      }

      const data = await response.json();
      return data.files || [];
    } catch (error) {
      console.error('[DataFolderManager] Error listing files:', error);
      return [];
    }
  }

  /**
   * Download a file from data folder
   */
  async downloadFile(filePath: string): Promise<Blob | null> {
    try {
      const response = await fetch(buildApiUrl(`/api/user/data-folder/download?path=${encodeURIComponent(filePath)}`), {
        method: 'GET',
      });

      if (!response.ok) {
        throw new Error('Failed to download file');
      }

      return await response.blob();
    } catch (error) {
      console.error('[DataFolderManager] Error downloading file:', error);
      return null;
    }
  }

  /**
   * Upload a file to data folder
   */
  async uploadFile(file: File, subfolder?: keyof DataFolderStructure): Promise<boolean> {
    try {
      const basePath = await this.getDataFolderPath();
      const targetPath = subfolder ? `${basePath}/${subfolder}` : basePath;

      const formData = new FormData();
      formData.append('file', file);
      formData.append('path', targetPath);

      const response = await fetch(buildApiUrl('/api/user/data-folder/upload'), {
        method: 'POST',
        body: formData,
      });

      if (!response.ok) {
        throw new Error('Failed to upload file');
      }

      return true;
    } catch (error) {
      console.error('[DataFolderManager] Error uploading file:', error);
      return false;
    }
  }

  /**
   * Delete a file from data folder
   */
  async deleteFile(filePath: string): Promise<boolean> {
    try {
      const response = await fetch(buildApiUrl('/api/user/data-folder/delete'), {
        method: 'DELETE',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ path: filePath }),
      });

      if (!response.ok) {
        throw new Error('Failed to delete file');
      }

      return true;
    } catch (error) {
      console.error('[DataFolderManager] Error deleting file:', error);
      return false;
    }
  }

  /**
   * Create directory in data folder
   */
  async createDirectory(dirPath: string): Promise<boolean> {
    try {
      const response = await fetch(buildApiUrl('/api/user/data-folder/mkdir'), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ path: dirPath }),
      });

      if (!response.ok) {
        throw new Error('Failed to create directory');
      }

      return true;
    } catch (error) {
      console.error('[DataFolderManager] Error creating directory:', error);
      return false;
    }
  }

  /**
   * Get folder structure
   */
  getFolderStructure(): DataFolderStructure {
    return {
      profiles: 'profiles',
      templates: 'templates',
      logs: 'logs',
      cache: 'cache',
      indicators: 'indicators',
      drawings: 'drawings',
      workspaces: 'workspaces',
    };
  }
}

// Singleton instance
export const dataFolderManager = new DataFolderManager();
export default dataFolderManager;
