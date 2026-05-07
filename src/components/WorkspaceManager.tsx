/**
 * Workspace Manager Component
 * UI for saving, loading, and managing workspaces
 */

import React, { useState, useEffect } from 'react';
import { useWorkspace } from '../hooks/useWorkspace';
import type { WorkspaceMetadata } from '../types/workspace';

interface WorkspaceManagerProps {
  onClose?: () => void;
}

export const WorkspaceManager: React.FC<WorkspaceManagerProps> = ({ onClose }) => {
  const {
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
    createNewWorkspace,
    duplicateWorkspace,
    setDefaultWorkspace,
    clearError,
  } = useWorkspace();

  const [showNewDialog, setShowNewDialog] = useState(false);
  const [showRenameDialog, setShowRenameDialog] = useState(false);
  const [newWorkspaceName, setNewWorkspaceName] = useState('');
  const [newWorkspaceDescription, setNewWorkspaceDescription] = useState('');
  const [selectedWorkspace, setSelectedWorkspace] = useState<WorkspaceMetadata | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [duplicateTarget, setDuplicateTarget] = useState<{ id: string; name: string } | null>(null);
  const [duplicateName, setDuplicateName] = useState('');

  // Filter workspaces based on search
  const filteredWorkspaces = workspaceList.filter(ws =>
    ws.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
    ws.description?.toLowerCase().includes(searchQuery.toLowerCase())
  );

  // Handle save current workspace
  const handleSaveCurrent = async () => {
    try {
      if (currentWorkspace) {
        await saveWorkspace();
        alert('Workspace saved successfully');
      }
    } catch (err: any) {
      alert(`Failed to save workspace: ${err.message}`);
    }
  };

  // Handle create new workspace
  const handleCreateNew = async () => {
    if (!newWorkspaceName.trim()) {
      alert('Workspace name is required');
      return;
    }

    try {
      await createNewWorkspace(newWorkspaceName, newWorkspaceDescription);
      setShowNewDialog(false);
      setNewWorkspaceName('');
      setNewWorkspaceDescription('');
      alert('Workspace created successfully');
    } catch (err: any) {
      alert(`Failed to create workspace: ${err.message}`);
    }
  };

  // Handle load workspace
  const handleLoad = async (workspaceId: string) => {
    try {
      await loadWorkspace(workspaceId);
      alert('Workspace loaded successfully');
      onClose?.();
    } catch (err: any) {
      alert(`Failed to load workspace: ${err.message}`);
    }
  };

  // Handle delete workspace
  const handleDelete = async (workspaceId: string, workspaceName: string) => {
    if (!confirm(`Are you sure you want to delete workspace "${workspaceName}"?`)) {
      return;
    }

    try {
      await deleteWorkspace(workspaceId);
      alert('Workspace deleted successfully');
    } catch (err: any) {
      alert(`Failed to delete workspace: ${err.message}`);
    }
  };

  // Handle duplicate workspace
  const handleDuplicate = async (workspaceId: string, originalName: string) => {
    setDuplicateTarget({ id: workspaceId, name: originalName });
    setDuplicateName(`${originalName} (Copy)`);
  };

  const handleDuplicateConfirm = async () => {
    if (!duplicateTarget || !duplicateName.trim()) return;
    try {
      await duplicateWorkspace(duplicateTarget.id, duplicateName.trim());
      setDuplicateTarget(null);
    } catch (err: any) {
      alert(`Failed to duplicate workspace: ${err.message}`);
    }
  };

  // Handle set default
  const handleSetDefault = async (workspaceId: string) => {
    try {
      await setDefaultWorkspace(workspaceId);
      alert('Default workspace updated');
    } catch (err: any) {
      alert(`Failed to set default workspace: ${err.message}`);
    }
  };

  // Format date
  const formatDate = (date: Date) => {
    return new Date(date).toLocaleString();
  };

  return (
    <div className="workspace-manager">
      <div className="workspace-manager-header">
        <h2>Workspace Manager</h2>
        {onClose && (
          <button className="close-button" onClick={onClose}>×</button>
        )}
      </div>

      {/* Auto-save indicator */}
      {autoSaveState.hasUnsavedChanges && (
        <div className="auto-save-indicator warning">
          Unsaved changes
          {autoSaveState.saving && ' - Saving...'}
        </div>
      )}

      {autoSaveState.lastSaved && !autoSaveState.hasUnsavedChanges && (
        <div className="auto-save-indicator success">
          Last saved: {formatDate(autoSaveState.lastSaved)}
        </div>
      )}

      {error && (
        <div className="error-banner">
          <span>{error.message}</span>
          <button onClick={clearError}>×</button>
        </div>
      )}

      {/* Current workspace section */}
      <div className="current-workspace-section">
        <h3>Current Workspace</h3>
        {currentWorkspace ? (
          <div className="current-workspace-info">
            <div>
              <strong>{currentWorkspace.name}</strong>
              {currentWorkspace.description && (
                <p className="description">{currentWorkspace.description}</p>
              )}
              <p className="meta">
                {currentWorkspace.charts.length} charts |
                Updated: {formatDate(currentWorkspace.updatedAt)}
              </p>
            </div>
            <button
              className="btn-primary"
              onClick={handleSaveCurrent}
              disabled={isSaving}
            >
              {isSaving ? 'Saving...' : 'Save'}
            </button>
          </div>
        ) : (
          <p className="no-workspace">No workspace loaded</p>
        )}
      </div>

      {/* Actions */}
      <div className="workspace-actions">
        <button
          className="btn-primary"
          onClick={() => setShowNewDialog(true)}
        >
          + New Workspace
        </button>
        <input
          type="text"
          className="search-input"
          placeholder="Search workspaces..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
        />
      </div>

      {/* Workspace list */}
      <div className="workspace-list">
        <h3>Saved Workspaces ({filteredWorkspaces.length})</h3>

        {isLoadingList ? (
          <div className="loading">Loading workspaces...</div>
        ) : filteredWorkspaces.length === 0 ? (
          <p className="no-workspaces">
            {searchQuery ? 'No workspaces found' : 'No saved workspaces'}
          </p>
        ) : (
          <div className="workspace-items">
            {filteredWorkspaces.map((ws) => (
              <div
                key={ws.id}
                className={`workspace-item ${ws.isDefault ? 'default' : ''}`}
              >
                <div className="workspace-item-content">
                  <div className="workspace-item-header">
                    <strong>{ws.name}</strong>
                    {ws.isDefault && <span className="badge-default">Default</span>}
                  </div>
                  {ws.description && (
                    <p className="description">{ws.description}</p>
                  )}
                  <div className="workspace-item-meta">
                    <span>{ws.chartCount} charts</span>
                    <span>•</span>
                    <span>{formatDate(ws.updatedAt)}</span>
                  </div>
                  {ws.tags && ws.tags.length > 0 && (
                    <div className="workspace-tags">
                      {ws.tags.map((tag, i) => (
                        <span key={i} className="tag">{tag}</span>
                      ))}
                    </div>
                  )}
                </div>

                <div className="workspace-item-actions">
                  <button
                    className="btn-small"
                    onClick={() => handleLoad(ws.id)}
                    disabled={isLoading}
                  >
                    Load
                  </button>
                  <button
                    className="btn-small"
                    onClick={() => handleDuplicate(ws.id, ws.name)}
                  >
                    Duplicate
                  </button>
                  {!ws.isDefault && (
                    <button
                      className="btn-small"
                      onClick={() => handleSetDefault(ws.id)}
                    >
                      Set Default
                    </button>
                  )}
                  <button
                    className="btn-small btn-danger"
                    onClick={() => handleDelete(ws.id, ws.name)}
                  >
                    Delete
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* New workspace dialog */}
      {showNewDialog && (
        <div className="modal-overlay" onClick={() => setShowNewDialog(false)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <h3>Create New Workspace</h3>
            <div className="form-group">
              <label>Name *</label>
              <input
                type="text"
                value={newWorkspaceName}
                onChange={(e) => setNewWorkspaceName(e.target.value)}
                placeholder="Enter workspace name"
                autoFocus
              />
            </div>
            <div className="form-group">
              <label>Description</label>
              <textarea
                value={newWorkspaceDescription}
                onChange={(e) => setNewWorkspaceDescription(e.target.value)}
                placeholder="Enter description (optional)"
                rows={3}
              />
            </div>
            <div className="modal-actions">
              <button
                className="btn-secondary"
                onClick={() => {
                  setShowNewDialog(false);
                  setNewWorkspaceName('');
                  setNewWorkspaceDescription('');
                }}
              >
                Cancel
              </button>
              <button
                className="btn-primary"
                onClick={handleCreateNew}
                disabled={isSaving || !newWorkspaceName.trim()}
              >
                {isSaving ? 'Creating...' : 'Create'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Duplicate workspace dialog */}
      {duplicateTarget && (
        <div className="modal-overlay" onClick={() => setDuplicateTarget(null)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <h3>Duplicate Workspace</h3>
            <div className="form-group">
              <label>New Name *</label>
              <input
                type="text"
                value={duplicateName}
                onChange={(e) => setDuplicateName(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') handleDuplicateConfirm(); if (e.key === 'Escape') setDuplicateTarget(null); }}
                autoFocus
              />
            </div>
            <div className="modal-actions">
              <button className="btn-secondary" onClick={() => setDuplicateTarget(null)}>Cancel</button>
              <button className="btn-primary" onClick={handleDuplicateConfirm} disabled={!duplicateName.trim()}>
                {isSaving ? 'Duplicating...' : 'Duplicate'}
              </button>
            </div>
          </div>
        </div>
      )}

      <style>{`
        .workspace-manager {
          display: flex;
          flex-direction: column;
          height: 100%;
          background: #1a1a1a;
          color: #e0e0e0;
          padding: 20px;
          overflow: hidden;
        }

        .workspace-manager-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          margin-bottom: 20px;
        }

        .workspace-manager-header h2 {
          margin: 0;
          font-size: 24px;
        }

        .close-button {
          background: none;
          border: none;
          color: #e0e0e0;
          font-size: 32px;
          cursor: pointer;
          padding: 0;
          width: 32px;
          height: 32px;
          line-height: 32px;
        }

        .close-button:hover {
          color: #fff;
        }

        .auto-save-indicator {
          padding: 8px 12px;
          border-radius: 4px;
          margin-bottom: 16px;
          font-size: 13px;
        }

        .auto-save-indicator.warning {
          background: rgba(255, 193, 7, 0.2);
          color: #ffc107;
          border: 1px solid rgba(255, 193, 7, 0.3);
        }

        .auto-save-indicator.success {
          background: rgba(76, 175, 80, 0.2);
          color: #4caf50;
          border: 1px solid rgba(76, 175, 80, 0.3);
        }

        .error-banner {
          background: rgba(244, 67, 54, 0.2);
          color: #f44336;
          border: 1px solid rgba(244, 67, 54, 0.3);
          padding: 12px;
          border-radius: 4px;
          margin-bottom: 16px;
          display: flex;
          justify-content: space-between;
          align-items: center;
        }

        .error-banner button {
          background: none;
          border: none;
          color: #f44336;
          cursor: pointer;
          font-size: 20px;
          padding: 0 8px;
        }

        .current-workspace-section {
          background: #252525;
          padding: 16px;
          border-radius: 8px;
          margin-bottom: 20px;
        }

        .current-workspace-section h3 {
          margin: 0 0 12px 0;
          font-size: 16px;
        }

        .current-workspace-info {
          display: flex;
          justify-content: space-between;
          align-items: flex-start;
          gap: 16px;
        }

        .current-workspace-info strong {
          font-size: 18px;
          display: block;
          margin-bottom: 4px;
        }

        .description {
          color: #999;
          margin: 4px 0;
          font-size: 13px;
        }

        .meta {
          color: #666;
          font-size: 12px;
          margin: 4px 0 0 0;
        }

        .no-workspace {
          color: #666;
          font-style: italic;
        }

        .workspace-actions {
          display: flex;
          gap: 12px;
          margin-bottom: 20px;
        }

        .search-input {
          flex: 1;
          background: #252525;
          border: 1px solid #404040;
          color: #e0e0e0;
          padding: 8px 12px;
          border-radius: 4px;
          font-size: 14px;
        }

        .search-input:focus {
          outline: none;
          border-color: #2196f3;
        }

        .workspace-list {
          flex: 1;
          overflow: hidden;
          display: flex;
          flex-direction: column;
        }

        .workspace-list h3 {
          margin: 0 0 12px 0;
          font-size: 16px;
        }

        .workspace-items {
          flex: 1;
          overflow-y: auto;
          display: flex;
          flex-direction: column;
          gap: 12px;
        }

        .workspace-item {
          background: #252525;
          border: 1px solid #404040;
          border-radius: 8px;
          padding: 16px;
          transition: all 0.2s;
        }

        .workspace-item.default {
          border-color: #2196f3;
        }

        .workspace-item:hover {
          background: #2a2a2a;
          border-color: #505050;
        }

        .workspace-item-content {
          margin-bottom: 12px;
        }

        .workspace-item-header {
          display: flex;
          align-items: center;
          gap: 8px;
          margin-bottom: 4px;
        }

        .badge-default {
          background: #2196f3;
          color: white;
          padding: 2px 8px;
          border-radius: 12px;
          font-size: 11px;
          font-weight: 600;
        }

        .workspace-item-meta {
          display: flex;
          gap: 8px;
          color: #666;
          font-size: 12px;
        }

        .workspace-tags {
          display: flex;
          flex-wrap: wrap;
          gap: 6px;
          margin-top: 8px;
        }

        .tag {
          background: #404040;
          color: #bbb;
          padding: 2px 8px;
          border-radius: 4px;
          font-size: 11px;
        }

        .workspace-item-actions {
          display: flex;
          gap: 8px;
          flex-wrap: wrap;
        }

        .btn-primary, .btn-secondary, .btn-small {
          padding: 8px 16px;
          border: none;
          border-radius: 4px;
          cursor: pointer;
          font-size: 14px;
          transition: all 0.2s;
        }

        .btn-primary {
          background: #2196f3;
          color: white;
        }

        .btn-primary:hover:not(:disabled) {
          background: #1976d2;
        }

        .btn-secondary {
          background: #404040;
          color: #e0e0e0;
        }

        .btn-secondary:hover {
          background: #505050;
        }

        .btn-small {
          background: #404040;
          color: #e0e0e0;
          padding: 6px 12px;
          font-size: 13px;
        }

        .btn-small:hover {
          background: #505050;
        }

        .btn-danger {
          background: #f44336;
          color: white;
        }

        .btn-danger:hover {
          background: #d32f2f;
        }

        button:disabled {
          opacity: 0.5;
          cursor: not-allowed;
        }

        .loading, .no-workspaces {
          text-align: center;
          padding: 40px;
          color: #666;
        }

        .modal-overlay {
          position: fixed;
          top: 0;
          left: 0;
          right: 0;
          bottom: 0;
          background: rgba(0, 0, 0, 0.7);
          display: flex;
          align-items: center;
          justify-content: center;
          z-index: 10000;
        }

        .modal-content {
          background: #1a1a1a;
          border: 1px solid #404040;
          border-radius: 8px;
          padding: 24px;
          max-width: 500px;
          width: 90%;
        }

        .modal-content h3 {
          margin: 0 0 20px 0;
        }

        .form-group {
          margin-bottom: 16px;
        }

        .form-group label {
          display: block;
          margin-bottom: 6px;
          font-size: 14px;
          color: #bbb;
        }

        .form-group input,
        .form-group textarea {
          width: 100%;
          background: #252525;
          border: 1px solid #404040;
          color: #e0e0e0;
          padding: 8px 12px;
          border-radius: 4px;
          font-size: 14px;
          font-family: inherit;
        }

        .form-group input:focus,
        .form-group textarea:focus {
          outline: none;
          border-color: #2196f3;
        }

        .modal-actions {
          display: flex;
          justify-content: flex-end;
          gap: 12px;
          margin-top: 24px;
        }
      `}</style>
    </div>
  );
};

export default WorkspaceManager;
