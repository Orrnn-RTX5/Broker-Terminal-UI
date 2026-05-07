/**
 * Data Folder Explorer Dialog
 * Virtual file explorer for web platform to browse user data folder
 */

import { Icon } from '../ui/Icon';
import React, { useState, useEffect } from 'react';
import { dataFolderManager, type FileEntry, type DataFolderStructure } from '../../services/dataFolderManager';

export interface DataFolderExplorerProps {
  isOpen: boolean;
  onClose: () => void;
}

export const DataFolderExplorer: React.FC<DataFolderExplorerProps> = ({ isOpen, onClose }) => {
  const [currentPath, setCurrentPath] = useState<keyof DataFolderStructure | null>(null);
  const [files, setFiles] = useState<FileEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedFile, setSelectedFile] = useState<FileEntry | null>(null);
  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(new Set());

  const folderStructure = dataFolderManager.getFolderStructure();

  useEffect(() => {
    if (isOpen) {
      loadFiles();
    }
  }, [isOpen, currentPath]);

  const loadFiles = async () => {
    setLoading(true);
    try {
      const fileList = await dataFolderManager.listFiles(currentPath || undefined);
      setFiles(fileList);
    } catch (error) {
      console.error('[DataFolderExplorer] Failed to load files:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleFolderClick = (folder: keyof DataFolderStructure) => {
    if (currentPath === folder) {
      setCurrentPath(null); // Navigate to root
    } else {
      setCurrentPath(folder);
    }
    setSelectedFile(null);
  };

  const handleFileClick = (file: FileEntry) => {
    setSelectedFile(file);
  };

  const handleDownload = async (file: FileEntry) => {
    try {
      const blob = await dataFolderManager.downloadFile(file.path);
      if (blob) {
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = file.name;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
      }
    } catch (error) {
      console.error('[DataFolderExplorer] Download failed:', error);
      alert('Failed to download file');
    }
  };

  const handleUpload = async () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.multiple = true;

    input.onchange = async (e) => {
      const target = e.target as HTMLInputElement;
      const files = target.files;

      if (files) {
        for (let i = 0; i < files.length; i++) {
          const file = files[i];
          try {
            await dataFolderManager.uploadFile(file, currentPath || undefined);
          } catch (error) {
            console.error('[DataFolderExplorer] Upload failed:', error);
            alert(`Failed to upload ${file.name}`);
          }
        }
        loadFiles(); // Refresh file list
      }
    };

    input.click();
  };

  const handleDelete = async (file: FileEntry) => {
    if (!confirm(`Are you sure you want to delete "${file.name}"?`)) {
      return;
    }

    try {
      const success = await dataFolderManager.deleteFile(file.path);
      if (success) {
        setSelectedFile(null);
        loadFiles();
      } else {
        alert('Failed to delete file');
      }
    } catch (error) {
      console.error('[DataFolderExplorer] Delete failed:', error);
      alert('Failed to delete file');
    }
  };

  const toggleFolder = (folderName: string) => {
    const newExpanded = new Set(expandedFolders);
    if (newExpanded.has(folderName)) {
      newExpanded.delete(folderName);
    } else {
      newExpanded.add(folderName);
    }
    setExpandedFolders(newExpanded);
  };

  const formatFileSize = (bytes?: number): string => {
    if (!bytes) return '-';
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
  };

  const formatDate = (date?: Date): string => {
    if (!date) return '-';
    return new Date(date).toLocaleString();
  };

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 bg-black/50 flex items-center justify-center z-[200]"
      onClick={onClose}
    >
      <div
        className="bg-[#131316] border border-zinc-700 rounded-lg shadow-2xl w-[900px] h-[600px] flex flex-col animate-in fade-in zoom-in-95 duration-150"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-zinc-700">
          <div className="flex items-center gap-2">
            <Icon name="hard-drive" size="md" className="text-blue-400" />
            <h2 className="text-sm font-semibold text-zinc-100">Data Folder Explorer</h2>
            {currentPath && (
              <>
                <Icon name="chevron-right" size="sm" className="text-zinc-500" />
                <span className="text-xs text-zinc-400">{currentPath}</span>
              </>
            )}
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={loadFiles}
              className="text-zinc-400 hover:text-zinc-100 transition-colors p-1 hover:bg-zinc-700/50 rounded"
              title="Refresh"
            >
              <Icon name="refresh" size="sm" />
            </button>
            <button
              onClick={onClose}
              className="text-zinc-400 hover:text-zinc-100 transition-colors p-1 hover:bg-zinc-700/50 rounded"
              aria-label="Close"
            >
              <Icon name="x-close" size="md" />
            </button>
          </div>
        </div>

        {/* Toolbar */}
        <div className="flex items-center gap-2 px-4 py-2 border-b border-zinc-700 bg-[#252528]">
          <button
            onClick={() => setCurrentPath(null)}
            className="px-3 py-1.5 text-xs text-zinc-300 hover:text-zinc-100 hover:bg-zinc-700/50 rounded transition-colors"
            disabled={!currentPath}
          >
            Root
          </button>
          <div className="flex-1" />
          <button
            onClick={handleUpload}
            className="px-3 py-1.5 text-xs bg-zinc-700 hover:bg-zinc-600 text-white rounded transition-colors flex items-center gap-2"
          >
            <Icon name="upload" size="xs" />
            Upload
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 flex overflow-hidden">
          {/* Sidebar - Folder Structure */}
          <div className="w-56 border-r border-zinc-700 overflow-y-auto bg-[#252528]">
            <div className="p-2">
              <div className="text-xs font-semibold text-zinc-400 px-2 py-1 mb-1">
                Folders
              </div>
              {Object.entries(folderStructure).map(([key, value]) => {
                const isExpanded = expandedFolders.has(key);
                const isActive = currentPath === key;

                return (
                  <div key={key}>
                    <button
                      onClick={() => handleFolderClick(key as keyof DataFolderStructure)}
                      className={`w-full flex items-center gap-2 px-2 py-1.5 text-xs rounded transition-colors ${
                        isActive
                          ? 'bg-blue-600 text-white'
                          : 'text-zinc-300 hover:bg-zinc-700/50 hover:text-zinc-100'
                      }`}
                    >
                      <Icon name="folder" size="sm" />
                      <span className="flex-1 text-left">{value}</span>
                    </button>
                  </div>
                );
              })}
            </div>
          </div>

          {/* File List */}
          <div className="flex-1 flex flex-col overflow-hidden">
            {loading ? (
              <div className="flex-1 flex items-center justify-center">
                <div className="text-center">
                  <Icon name="refresh" size="xl" className="animate-spin text-blue-500 mx-auto mb-2" />
                  <p className="text-xs text-zinc-400">Loading files...</p>
                </div>
              </div>
            ) : files.length === 0 ? (
              <div className="flex-1 flex items-center justify-center">
                <div className="text-center">
                  <Icon name="folder" size="xl" className="text-zinc-600 mx-auto mb-2" />
                  <p className="text-sm text-zinc-400">No files found</p>
                  <p className="text-xs text-zinc-500 mt-1">Upload files to get started</p>
                </div>
              </div>
            ) : (
              <div className="flex-1 overflow-y-auto">
                <table className="w-full text-xs">
                  <thead className="sticky top-0 bg-[#252528] border-b border-zinc-700">
                    <tr>
                      <th className="text-left px-4 py-2 text-zinc-400 font-medium">Name</th>
                      <th className="text-left px-4 py-2 text-zinc-400 font-medium">Size</th>
                      <th className="text-left px-4 py-2 text-zinc-400 font-medium">Modified</th>
                      <th className="text-right px-4 py-2 text-zinc-400 font-medium">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {files.map((file, index) => (
                      <tr
                        key={index}
                        onClick={() => handleFileClick(file)}
                        className={`border-b border-zinc-800 cursor-pointer transition-colors ${
                          selectedFile?.path === file.path
                            ? 'bg-blue-600/20'
                            : 'hover:bg-zinc-800/50'
                        }`}
                      >
                        <td className="px-4 py-2">
                          <div className="flex items-center gap-2">
                            {file.type === 'directory' ? (
                              <Icon name="folder" size="sm" className="text-blue-400" />
                            ) : (
                              <Icon name="file-text" size="sm" className="text-zinc-400" />
                            )}
                            <span className="text-zinc-300">{file.name}</span>
                          </div>
                        </td>
                        <td className="px-4 py-2 text-zinc-400">
                          {file.type === 'file' ? formatFileSize(file.size) : '-'}
                        </td>
                        <td className="px-4 py-2 text-zinc-400">
                          {formatDate(file.modified)}
                        </td>
                        <td className="px-4 py-2">
                          <div className="flex items-center justify-end gap-1">
                            {file.type === 'file' && (
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleDownload(file);
                                }}
                                className="p-1 text-zinc-400 hover:text-blue-400 hover:bg-zinc-700/50 rounded transition-colors"
                                title="Download"
                              >
                                <Icon name="download" size="sm" />
                              </button>
                            )}
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                handleDelete(file);
                              }}
                              className="p-1 text-zinc-400 hover:text-red-400 hover:bg-zinc-700/50 rounded transition-colors"
                              title="Delete"
                            >
                              <Icon name="trash" size="sm" />
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-4 py-2 border-t border-zinc-700 bg-[#252528]">
          <div className="text-xs text-zinc-400">
            {files.length} item{files.length !== 1 ? 's' : ''}
            {selectedFile && (
              <span className="ml-2">
                · Selected: <span className="text-zinc-300">{selectedFile.name}</span>
              </span>
            )}
          </div>
          <button
            onClick={onClose}
            className="px-4 py-1.5 text-xs text-zinc-300 hover:text-zinc-100 hover:bg-zinc-700/50 rounded transition-colors"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
};
