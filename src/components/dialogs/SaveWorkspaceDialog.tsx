/**
 * Save Workspace Dialog
 * Confirmation dialog for saving workspace with overwrite prompt
 */

import { Icon } from '../ui/Icon';
import React, { useState } from 'react';
import { createPortal } from 'react-dom';
import { workspaceApi } from '../../services/api';
import type { Workspace } from '../../services/api';

export interface SaveWorkspaceDialogProps {
    onConfirm: (workspaceName?: string) => void;
    onCancel: () => void;
    existingWorkspace?: string;
    workspaceData?: Partial<Workspace>;
    userId?: string;
    accountId?: string;
}

export const SaveWorkspaceDialog: React.FC<SaveWorkspaceDialogProps> = ({
    onConfirm,
    onCancel,
    existingWorkspace,
    workspaceData,
    userId = '1',
    accountId = '1'
}) => {
    const [workspaceName, setWorkspaceName] = useState(existingWorkspace || 'Default');
    const [showOverwriteWarning, setShowOverwriteWarning] = useState(false);
    const [isSaving, setIsSaving] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const handleSave = async () => {
        setError(null);

        // Check if workspace name already exists locally
        const existingWorkspaces = JSON.parse(localStorage.getItem('workspaces') || '[]');
        const workspaceExists = existingWorkspaces.some((w: any) => w.name === workspaceName);

        if (workspaceExists && !showOverwriteWarning) {
            setShowOverwriteWarning(true);
            return;
        }

        // Perform the save
        await performSave(workspaceExists);
    };

    const performSave = async (overwrite: boolean) => {
        setIsSaving(true);
        setError(null);

        try {
            // Prepare workspace data
            const workspace: Workspace = {
                name: workspaceName,
                userId,
                accountId,
                charts: workspaceData?.charts || JSON.stringify([]),
                layout: workspaceData?.layout || JSON.stringify({}),
                marketWatch: workspaceData?.marketWatch || JSON.stringify({}),
                orderPanel: workspaceData?.orderPanel || JSON.stringify({}),
                version: '1.0.0',
                isDefault: false,
                description: `Workspace saved on ${new Date().toLocaleString()}`,
            };

            // Call API to save workspace
            const response = await workspaceApi.saveWorkspace(workspace, overwrite);

            if (response.success) {
                // Save to localStorage as well for offline access
                const existingWorkspaces = JSON.parse(localStorage.getItem('workspaces') || '[]');
                const updatedWorkspaces = existingWorkspaces.filter((w: any) => w.name !== workspaceName);
                updatedWorkspaces.push({
                    name: workspaceName,
                    workspaceId: response.workspaceId,
                    savedAt: new Date().toISOString(),
                    ...workspaceData
                });
                localStorage.setItem('workspaces', JSON.stringify(updatedWorkspaces));

                // Success callback
                onConfirm(workspaceName);
            } else {
                setError(response.message || 'Failed to save workspace');
            }
        } catch (err: any) {
            console.error('[SaveWorkspace] Error:', err);
            setError(err.message || 'Failed to save workspace. Please try again.');
        } finally {
            setIsSaving(false);
        }
    };

    const handleOverwriteConfirm = async () => {
        await performSave(true);
    };

    return createPortal(
        <div 
            className="fixed inset-0 bg-black/50 flex items-center justify-center z-[9999]" 
            onClick={(e) => {
                e.stopPropagation();
                if (e.target === e.currentTarget) onCancel();
            }}
            onMouseDown={(e) => e.stopPropagation()}
            onTouchStart={(e) => e.stopPropagation()}
            onPointerDown={(e) => e.stopPropagation()}
            onContextMenuCapture={(e) => {
                e.stopPropagation();
                e.preventDefault();
            }}
            onContextMenu={(e) => e.stopPropagation()}
        >
            <div
                className="bg-[#131316] [.rtx-advanced-view_&]:bg-white border border-zinc-700 [.rtx-advanced-view_&]:border-gray-200 rounded-lg shadow-2xl w-[420px] animate-in fade-in zoom-in-95 duration-150"
                onClick={(e) => e.stopPropagation()}
            >
                {/* Header */}
                <div className="flex items-center justify-between px-4 py-3 border-b border-zinc-700 [.rtx-advanced-view_&]:border-gray-200 bg-[#131316] [.rtx-advanced-view_&]:bg-gray-50 rounded-t-lg">
                    <div className="flex items-center gap-2">
                        <Icon name="save" size="md" className="text-blue-400 [.rtx-advanced-view_&]:text-indigo-600" />
                        <h2 className="text-sm font-semibold text-zinc-100 [.rtx-advanced-view_&]:text-gray-900">
                            {showOverwriteWarning ? 'Overwrite Workspace' : 'Save Workspace'}
                        </h2>
                    </div>
                    <button
                        onClick={onCancel}
                        className="text-zinc-400 hover:text-zinc-100 [.rtx-advanced-view_&]:text-gray-500 [.rtx-advanced-view_&]:hover:text-gray-900 transition-colors p-1 hover:bg-zinc-700/50 [.rtx-advanced-view_&]:hover:bg-gray-200 rounded"
                        aria-label="Close"
                    >
                        <Icon name="x-close" size="md" />
                    </button>
                </div>

                {/* Content */}
                <div className="p-4 space-y-4">
                    {error && (
                        <div className="flex items-start gap-3 p-3 bg-rose-500/10 [.rtx-advanced-view_&]:bg-rose-50 border border-rose-500/30 [.rtx-advanced-view_&]:border-rose-200 rounded">
                            <Icon name="alert-triangle" size="lg" className="text-rose-400 [.rtx-advanced-view_&]:text-rose-600 flex-shrink-0 mt-0.5" />
                            <div className="text-xs space-y-2">
                                <p className="text-rose-200 [.rtx-advanced-view_&]:text-rose-800 font-medium">Error</p>
                                <p className="text-zinc-300 [.rtx-advanced-view_&]:text-rose-700">{error}</p>
                            </div>
                        </div>
                    )}

                    {!showOverwriteWarning ? (
                        <>
                            <p className="text-xs text-zinc-300 [.rtx-advanced-view_&]:text-gray-600">
                                Enter a name for your workspace configuration. This will save your current layout,
                                charts, and settings.
                            </p>

                            <div>
                                <label htmlFor="workspace-name" className="block text-xs text-zinc-400 [.rtx-advanced-view_&]:text-gray-600 mb-2">
                                    Workspace Name
                                </label>
                                <input
                                    id="workspace-name"
                                    type="text"
                                    value={workspaceName}
                                    onChange={(e) => setWorkspaceName(e.target.value)}
                                    className="w-full bg-[#252528] [.rtx-advanced-view_&]:bg-white border border-zinc-700 [.rtx-advanced-view_&]:border-gray-300 rounded px-3 py-2 text-sm text-zinc-100 [.rtx-advanced-view_&]:text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-500 [.rtx-advanced-view_&]:focus:ring-indigo-500 focus:border-transparent disabled:opacity-50"
                                    placeholder="Enter workspace name"
                                    autoFocus
                                    disabled={isSaving}
                                    onKeyDown={(e) => {
                                        if (e.key === 'Enter' && !isSaving) handleSave();
                                        if (e.key === 'Escape') onCancel();
                                    }}
                                />
                            </div>
                        </>
                    ) : (
                        <div className="flex items-start gap-3 p-3 bg-amber-500/10 [.rtx-advanced-view_&]:bg-amber-50 border border-amber-500/30 [.rtx-advanced-view_&]:border-amber-200 rounded">
                            <Icon name="alert-triangle" size="lg" className="text-amber-400 [.rtx-advanced-view_&]:text-amber-600 flex-shrink-0 mt-0.5" />
                            <div className="text-xs space-y-2">
                                <p className="text-amber-200 [.rtx-advanced-view_&]:text-amber-800 font-medium">
                                    Workspace "{workspaceName}" already exists
                                </p>
                                <p className="text-zinc-300 [.rtx-advanced-view_&]:text-amber-700">
                                    Do you want to overwrite the existing workspace with your current configuration?
                                </p>
                            </div>
                        </div>
                    )}
                </div>

                {/* Footer */}
                <div className="flex items-center justify-end gap-2 px-4 py-3 border-t border-zinc-700 [.rtx-advanced-view_&]:border-gray-200 bg-[#252528] [.rtx-advanced-view_&]:bg-gray-50 rounded-b-lg">
                    {!showOverwriteWarning ? (
                        <>
                            <button
                                onClick={onCancel}
                                disabled={isSaving}
                                className="px-4 py-1.5 text-xs text-zinc-300 [.rtx-advanced-view_&]:text-gray-600 hover:text-zinc-100 [.rtx-advanced-view_&]:hover:text-gray-900 hover:bg-zinc-700/50 [.rtx-advanced-view_&]:hover:bg-gray-200 rounded transition-colors disabled:opacity-50"
                            >
                                Cancel
                            </button>
                            <button
                                onClick={handleSave}
                                disabled={!workspaceName.trim() || isSaving}
                                className="px-4 py-1.5 text-xs bg-zinc-700 [.rtx-advanced-view_&]:bg-indigo-600 hover:bg-zinc-600 [.rtx-advanced-view_&]:hover:bg-indigo-700 disabled:bg-zinc-700 [.rtx-advanced-view_&]:disabled:bg-indigo-400 disabled:text-zinc-500 [.rtx-advanced-view_&]:disabled:text-indigo-100 text-white rounded transition-colors flex items-center gap-2"
                            >
                                {isSaving ? (
                                    <>
                                        <div className="animate-spin rounded-full h-3 w-3 border-t border-b border-white"></div>
                                        Saving...
                                    </>
                                ) : (
                                    <>
                                        <Icon name="save" size="xs" />
                                        Save
                                    </>
                                )}
                            </button>
                        </>
                    ) : (
                        <>
                            <button
                                onClick={() => { setShowOverwriteWarning(false); setError(null); }}
                                disabled={isSaving}
                                className="px-4 py-1.5 text-xs text-zinc-300 [.rtx-advanced-view_&]:text-gray-600 hover:text-zinc-100 [.rtx-advanced-view_&]:hover:text-gray-900 hover:bg-zinc-700/50 [.rtx-advanced-view_&]:hover:bg-gray-200 rounded transition-colors disabled:opacity-50"
                            >
                                Back
                            </button>
                            <button
                                onClick={handleOverwriteConfirm}
                                disabled={isSaving}
                                className="px-4 py-1.5 text-xs bg-amber-600 hover:bg-amber-700 text-white rounded transition-colors flex items-center gap-2 disabled:opacity-50"
                            >
                                {isSaving ? (
                                    <>
                                        <div className="animate-spin rounded-full h-3 w-3 border-t border-b border-white"></div>
                                        Saving...
                                    </>
                                ) : (
                                    <>
                                        <Icon name="alert-triangle" size="xs" />
                                        Overwrite
                                    </>
                                )}
                            </button>
                        </>
                    )}
                </div>
            </div>
        </div>,
        document.body
    );
};

