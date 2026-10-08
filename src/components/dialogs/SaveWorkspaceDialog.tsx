import { useUiTranslation } from '../../hooks/useUiTranslation';
/**
 * Save Workspace Dialog
 * Confirmation dialog for saving workspace with overwrite prompt
 */

import { Icon } from '../ui/Icon';
import React, { useState, useRef, useId, useEffect } from 'react';
import { useDialogFocusScope } from '../../hooks/useDialogFocusScope';
import './legacy-action-sheets.css';
import { createPortal } from 'react-dom';
import type { Workspace } from '../../services/api';
import {
    getWorkspaceProfile,
    saveCurrentWorkspaceProfile,
} from '../../services/localWorkspaceProfiles';

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
    accountId = ''
}) => {
    const tr = useUiTranslation();
    const [workspaceName, setWorkspaceName] = useState(existingWorkspace || 'Default');
    const [showOverwriteWarning, setShowOverwriteWarning] = useState(false);
    const [isSaving, setIsSaving] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const dialogRef = useRef<HTMLDivElement>(null);
    const nameRef = useRef<HTMLInputElement>(null);
    const backRef = useRef<HTMLButtonElement>(null);
    const titleId = useId();
    useDialogFocusScope({ isOpen: true, dialogRef, onClose: onCancel, initialFocusRef: nameRef, closeOnEscape: !isSaving });
    useEffect(() => {
        // Replacing the name field must leave focus on a safe action, not the page.
        (showOverwriteWarning ? backRef.current : nameRef.current)?.focus({ preventScroll: true });
    }, [showOverwriteWarning]);

    const handleSave = async () => {
        setError(null);
        const workspaceAccountId = accountId.trim();
        const normalizedWorkspaceName = workspaceName.trim();

        if (!workspaceAccountId) {
            setError('No active trading account is available for this workspace.');
            return;
        }

        let workspaceExists = false;
        try {
            workspaceExists = Boolean(getWorkspaceProfile({
                accountId: workspaceAccountId,
                profileName: normalizedWorkspaceName,
            }));
        } catch (saveError) {
            setError(saveError instanceof Error ? saveError.message : 'The workspace name is not valid.');
            return;
        }

        if (workspaceExists && !showOverwriteWarning) {
            setShowOverwriteWarning(true);
            return;
        }

        await performSave();
    };

    const performSave = async () => {
        setIsSaving(true);
        setError(null);

        try {
            const layout = workspaceData?.layout && typeof workspaceData.layout === 'object'
                ? workspaceData.layout as Record<string, unknown>
                : {};
            const marketWatch = workspaceData?.marketWatch && typeof workspaceData.marketWatch === 'object'
                ? workspaceData.marketWatch as Record<string, unknown>
                : {};
            const orderPanel = workspaceData?.orderPanel && typeof workspaceData.orderPanel === 'object'
                ? workspaceData.orderPanel as Record<string, unknown>
                : {};

            saveCurrentWorkspaceProfile({
                accountId: accountId.trim(),
                profileName: workspaceName.trim(),
                view: {
                    selectedSymbol: typeof marketWatch.selectedSymbol === 'string'
                        ? marketWatch.selectedSymbol
                        : undefined,
                    orderVolume: typeof orderPanel.volume === 'number'
                        ? orderPanel.volume
                        : undefined,
                    dockHeight: typeof layout.dockHeight === 'number'
                        ? layout.dockHeight
                        : undefined,
                },
            });
            onConfirm(workspaceName.trim());
        } catch (saveError: unknown) {
            console.error('[SaveWorkspace] Error:', saveError);
            setError(saveError instanceof Error
                ? saveError.message
                : 'Failed to save workspace. Please try again.');
        } finally {
            setIsSaving(false);
        }
    };

    const handleOverwriteConfirm = async () => {
        await performSave();
    };

    return createPortal(
        <div 
            className="fixed inset-0 bg-black/50 flex items-center justify-center p-2 z-[9999]"
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
                ref={dialogRef}
                role="dialog"
                aria-modal="true"
                aria-labelledby={titleId}
                data-shortcut-scope="local"
                tabIndex={-1}
                className="rtx-action-sheet rtx-legacy-sheet bg-[#131316] [.rtx-advanced-view_&]:bg-white border border-zinc-700 [.rtx-advanced-view_&]:border-gray-200 rounded-lg shadow-2xl w-[420px] max-w-full max-h-[calc(100dvh-16px)] flex flex-col overflow-hidden animate-in fade-in zoom-in-95 duration-150"
                onClick={(e) => e.stopPropagation()}
            >
                {/* Header */}
                <div className="rtx-legacy-sheet__header flex items-center justify-between gap-2 px-4 py-3 shrink-0 border-b border-zinc-700 [.rtx-advanced-view_&]:border-gray-200 bg-[#131316] [.rtx-advanced-view_&]:bg-gray-50 rounded-t-lg">
                    <div className="flex items-center gap-2">
                        <Icon name="save" size="md" className="text-blue-400 [.rtx-advanced-view_&]:text-indigo-600" />
                        <h2 id={titleId} className="text-sm font-semibold text-zinc-100 [.rtx-advanced-view_&]:text-gray-900">
                            {showOverwriteWarning ? tr("Overwrite Workspace") : tr("Save Workspace")}
                        </h2>
                    </div>
                    <button
                        onClick={onCancel}
                        className="text-zinc-400 hover:text-zinc-100 [.rtx-advanced-view_&]:text-gray-500 [.rtx-advanced-view_&]:hover:text-gray-900 transition-colors p-1 hover:bg-zinc-700/50 [.rtx-advanced-view_&]:hover:bg-gray-200 rounded"
                        aria-label={tr("Close")}
                    >
                        <Icon name="x-close" size="md" />
                    </button>
                </div>

                {/* Content */}
                <div className="rtx-legacy-sheet__body p-4 space-y-4 min-h-0 overflow-y-auto">
                    {error && (
                        <div role="alert" className="flex items-start gap-3 p-3 bg-rose-500/10 [.rtx-advanced-view_&]:bg-rose-50 border border-rose-500/30 [.rtx-advanced-view_&]:border-rose-200 rounded">
                            <Icon name="alert-triangle" size="lg" className="text-rose-400 [.rtx-advanced-view_&]:text-rose-600 flex-shrink-0 mt-0.5" />
                            <div className="text-xs space-y-2">
                                <p className="text-rose-200 [.rtx-advanced-view_&]:text-rose-800 font-medium">{tr("Error")}</p>
                                <p className="text-zinc-300 [.rtx-advanced-view_&]:text-rose-700">{tr(error)}</p>
                            </div>
                        </div>
                    )}

                    {!showOverwriteWarning ? (
                        <>
                            <p className="text-xs text-zinc-300 [.rtx-advanced-view_&]:text-gray-600">
                                {tr("Enter a name for your workspace configuration. This will save your current layout, charts, and settings.")}</p>

                            <div>
                                <label htmlFor="workspace-name" className="block text-xs text-zinc-400 [.rtx-advanced-view_&]:text-gray-600 mb-2">
                                    {tr("Workspace Name")}</label>
                                <input
                                    ref={nameRef}
                                    id="workspace-name"
                                    type="text"
                                    value={workspaceName}
                                    onChange={(e) => setWorkspaceName(e.target.value)}
                                    className="w-full bg-[#252528] [.rtx-advanced-view_&]:bg-white border border-zinc-700 [.rtx-advanced-view_&]:border-gray-300 rounded px-3 py-2 text-sm text-zinc-100 [.rtx-advanced-view_&]:text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-500 [.rtx-advanced-view_&]:focus:ring-indigo-500 focus:border-transparent disabled:opacity-50"
                                    placeholder={tr("Enter workspace name")}
                                    disabled={isSaving}
                                    onKeyDown={(e) => {
                                        if (e.key === 'Enter' && !isSaving) handleSave();
                                    }}
                                />
                            </div>
                        </>
                    ) : (
                        <div className="flex items-start gap-3 p-3 bg-amber-500/10 [.rtx-advanced-view_&]:bg-amber-50 border border-amber-500/30 [.rtx-advanced-view_&]:border-amber-200 rounded">
                            <Icon name="alert-triangle" size="lg" className="text-amber-400 [.rtx-advanced-view_&]:text-amber-600 flex-shrink-0 mt-0.5" />
                            <div className="text-xs space-y-2">
                                <p className="text-amber-200 [.rtx-advanced-view_&]:text-amber-800 font-medium">
                                    {tr("Workspace \"")}{workspaceName}{tr("\" already exists")}</p>
                                <p className="text-zinc-300 [.rtx-advanced-view_&]:text-amber-700">
                                    {tr("Do you want to overwrite the existing workspace with your current configuration?")}</p>
                            </div>
                        </div>
                    )}
                </div>

                {/* Footer */}
                <div className="rtx-legacy-sheet__footer flex flex-wrap items-center justify-end gap-2 px-4 py-3 shrink-0 border-t border-zinc-700 [.rtx-advanced-view_&]:border-gray-200 bg-[#252528] [.rtx-advanced-view_&]:bg-gray-50 rounded-b-lg">
                    {!showOverwriteWarning ? (
                        <>
                            <button
                                onClick={onCancel}
                                disabled={isSaving}
                                className="px-4 py-1.5 text-xs text-zinc-300 [.rtx-advanced-view_&]:text-gray-600 hover:text-zinc-100 [.rtx-advanced-view_&]:hover:text-gray-900 hover:bg-zinc-700/50 [.rtx-advanced-view_&]:hover:bg-gray-200 rounded transition-colors disabled:opacity-50"
                            >
                                {tr("Cancel")}</button>
                            <button
                                onClick={handleSave}
                                disabled={!workspaceName.trim() || isSaving}
                                className="rtx-legacy-sheet__primary px-4 py-1.5 text-xs bg-zinc-700 [.rtx-advanced-view_&]:bg-indigo-600 hover:bg-zinc-600 [.rtx-advanced-view_&]:hover:bg-indigo-700 disabled:bg-zinc-700 [.rtx-advanced-view_&]:disabled:bg-indigo-400 disabled:text-zinc-500 [.rtx-advanced-view_&]:disabled:text-indigo-100 text-white rounded transition-colors flex items-center gap-2"
                            >
                                {isSaving ? (
                                    <>
                                        <div className="animate-spin rounded-full h-3 w-3 border-t border-b border-white"></div>
                                        {tr("Saving...")}</>
                                ) : (
                                    <>
                                        <Icon name="save" size="xs" />
                                        {tr("Save")}</>
                                )}
                            </button>
                        </>
                    ) : (
                        <>
                            <button
                                ref={backRef}
                                onClick={() => { setShowOverwriteWarning(false); setError(null); }}
                                disabled={isSaving}
                                className="px-4 py-1.5 text-xs text-zinc-300 [.rtx-advanced-view_&]:text-gray-600 hover:text-zinc-100 [.rtx-advanced-view_&]:hover:text-gray-900 hover:bg-zinc-700/50 [.rtx-advanced-view_&]:hover:bg-gray-200 rounded transition-colors disabled:opacity-50"
                            >
                                {tr("Back")}</button>
                            <button
                                onClick={handleOverwriteConfirm}
                                disabled={isSaving}
                                className="rtx-legacy-sheet__warning px-4 py-1.5 text-xs bg-amber-700 hover:bg-amber-800 text-white rounded transition-colors flex items-center gap-2 disabled:opacity-50"
                            >
                                {isSaving ? (
                                    <>
                                        <div className="animate-spin rounded-full h-3 w-3 border-t border-b border-white"></div>
                                        {tr("Saving...")}</>
                                ) : (
                                    <>
                                        <Icon name="alert-triangle" size="xs" />
                                        {tr("Overwrite")}</>
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

