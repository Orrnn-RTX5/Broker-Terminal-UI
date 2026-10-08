import { useUiTranslation } from '../../hooks/useUiTranslation';
import { Icon } from '../ui/Icon';
import React, { useState, useRef, useId } from 'react';
import { useDialogFocusScope } from '../../hooks/useDialogFocusScope';
import './legacy-action-sheets.css';
import { createPortal } from 'react-dom';
import type { UnsavedChanges } from '../../services/exitHandler';

export interface ExitConfirmDialogProps {
  isOpen: boolean;
  changes: UnsavedChanges;
  onConfirm: (saveWorkspace: boolean) => void;
  onCancel: () => void;
}

export const ExitConfirmDialog: React.FC<ExitConfirmDialogProps> = ({
  isOpen,
  changes,
  onConfirm,
  onCancel,
}) => {
    const tr = useUiTranslation();
  const [saveWorkspace, setSaveWorkspace] = useState(true);
  const [dontAskAgain, setDontAskAgain] = useState(false);
  const dialogRef = useRef<HTMLDivElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const titleId = useId();
  useDialogFocusScope({ isOpen, dialogRef, onClose: onCancel, initialFocusRef: cancelRef });

  if (!isOpen) return null;

  const hasChanges =
    changes.hasWorkspaceChanges || changes.hasOpenTrades || changes.hasDraftOrders;

  const handleConfirm = () => {
    // Save preference
    if (dontAskAgain) {
      localStorage.setItem(
        'exitPreferences',
        JSON.stringify({
          dontAskAgain: true,
          autoSaveWorkspace: saveWorkspace,
        })
      );
    }

    onConfirm(saveWorkspace);
  };

  const handleDiscard = () => {
    if (dontAskAgain) {
      localStorage.setItem(
        'exitPreferences',
        JSON.stringify({
          dontAskAgain: true,
          autoSaveWorkspace: false,
        })
      );
    }

    onConfirm(false);
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
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        data-shortcut-scope="local"
        tabIndex={-1}
        className="rtx-action-sheet rtx-legacy-sheet bg-[#131316] [.rtx-advanced-view_&]:bg-white border border-zinc-700 [.rtx-advanced-view_&]:border-gray-200 rounded-lg shadow-2xl w-[480px] max-w-full max-h-[calc(100dvh-16px)] flex flex-col overflow-hidden animate-in fade-in zoom-in-95 duration-150"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="rtx-legacy-sheet__header flex items-center justify-between gap-2 px-4 py-3 shrink-0 border-b border-zinc-700 [.rtx-advanced-view_&]:border-gray-200 bg-[#131316] [.rtx-advanced-view_&]:bg-gray-50 rounded-t-lg">
          <div className="flex items-center gap-2">
            <Icon name="alert-triangle" size="md" className="text-amber-400 [.rtx-advanced-view_&]:text-amber-500" />
            <h2 id={titleId} className="text-sm font-semibold text-zinc-100 [.rtx-advanced-view_&]:text-gray-900">{tr("Confirm Exit")}</h2>
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
          {/* Warning Message */}
          <div className="flex items-start gap-3 p-3 bg-amber-500/10 [.rtx-advanced-view_&]:bg-amber-50 border border-amber-500/30 [.rtx-advanced-view_&]:border-amber-200 rounded">
            <Icon name="alert-triangle" size="lg" className="text-amber-400 [.rtx-advanced-view_&]:text-amber-600 flex-shrink-0 mt-0.5" />
            <div className="text-xs space-y-1">
              <p className="text-amber-200 [.rtx-advanced-view_&]:text-amber-800 font-medium">
                {tr("You have unsaved changes that will be lost if you exit now.")}</p>
              <p className="text-zinc-300 [.rtx-advanced-view_&]:text-amber-700">
                {tr("Please review the items below and choose how to proceed.")}</p>
            </div>
          </div>

          {/* Unsaved Items List */}
          {hasChanges && (
            <div className="space-y-2">
              <p className="text-xs font-semibold text-zinc-400 [.rtx-advanced-view_&]:text-gray-600 mb-2">{tr("Unsaved Items:")}</p>

              {changes.hasWorkspaceChanges && (
                <div className="flex items-center gap-2 px-3 py-2 bg-zinc-800/50 [.rtx-advanced-view_&]:bg-gray-100 rounded">
                  <div className="w-2 h-2 rounded-full bg-zinc-400 [.rtx-advanced-view_&]:bg-gray-400" />
                  <span className="text-xs text-zinc-300 [.rtx-advanced-view_&]:text-gray-700">{tr("Workspace layout has been modified")}</span>
                </div>
              )}

              {changes.hasOpenTrades && (
                <div className="flex items-center gap-2 px-3 py-2 bg-zinc-800/50 [.rtx-advanced-view_&]:bg-gray-100 rounded">
                  <div className="w-2 h-2 rounded-full bg-green-500 [.rtx-advanced-view_&]:bg-emerald-500" />
                  <span className="text-xs text-zinc-300 [.rtx-advanced-view_&]:text-gray-700">
                    {changes.openTradesCount} {changes.openTradesCount === 1 ? tr('open position') : tr('open positions')}
                  </span>
                </div>
              )}

              {changes.hasDraftOrders && (
                <div className="flex items-center gap-2 px-3 py-2 bg-zinc-800/50 [.rtx-advanced-view_&]:bg-gray-100 rounded">
                  <div className="w-2 h-2 rounded-full bg-yellow-500 [.rtx-advanced-view_&]:bg-amber-500" />
                  <span className="text-xs text-zinc-300 [.rtx-advanced-view_&]:text-gray-700">
                    {changes.draftOrdersCount} {changes.draftOrdersCount === 1 ? tr('pending order') : tr('pending orders')}
                  </span>
                </div>
              )}
            </div>
          )}

          {/* Save Workspace Option */}
          {changes.hasWorkspaceChanges && (
            <div className="space-y-2">
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={saveWorkspace}
                  onChange={(e) => setSaveWorkspace(e.target.checked)}
                  className="w-4 h-4 rounded border-zinc-600 [.rtx-advanced-view_&]:border-gray-300 bg-zinc-800 [.rtx-advanced-view_&]:bg-white text-blue-600 [.rtx-advanced-view_&]:text-indigo-600 focus:ring-2 focus:ring-blue-500 [.rtx-advanced-view_&]:focus:ring-indigo-500 focus:ring-offset-0"
                />
                <span className="text-xs text-zinc-300 [.rtx-advanced-view_&]:text-gray-700">{tr("Save workspace before exiting")}</span>
              </label>
              <p className="text-xs text-zinc-500 [.rtx-advanced-view_&]:text-gray-500 ml-6">
                {tr("Your layout, charts, and settings will be restored next time")}</p>
            </div>
          )}

          {/* Don't Ask Again Option */}
          <div className="pt-2 border-t border-zinc-700 [.rtx-advanced-view_&]:border-gray-200">
            <label className="flex items-center gap-2 cursor-pointer mt-2">
              <input
                type="checkbox"
                checked={dontAskAgain}
                onChange={(e) => setDontAskAgain(e.target.checked)}
                className="w-4 h-4 rounded border-zinc-600 [.rtx-advanced-view_&]:border-gray-300 bg-zinc-800 [.rtx-advanced-view_&]:bg-white text-blue-600 [.rtx-advanced-view_&]:text-indigo-600 focus:ring-2 focus:ring-blue-500 [.rtx-advanced-view_&]:focus:ring-indigo-500 focus:ring-offset-0"
              />
              <span className="text-xs text-zinc-300 [.rtx-advanced-view_&]:text-gray-700">{tr("Don't ask again (remember my choice)")}</span>
            </label>
          </div>

          {/* Warning for Open Trades */}
          {changes.hasOpenTrades && (
            <div className="flex items-start gap-2 p-2 bg-red-500/10 [.rtx-advanced-view_&]:bg-red-50 border border-red-500/30 [.rtx-advanced-view_&]:border-red-200 rounded mt-4">
              <Icon name="alert-triangle" size="sm" className="text-red-400 [.rtx-advanced-view_&]:text-red-600 flex-shrink-0 mt-0.5" />
              <p className="text-xs text-red-200 [.rtx-advanced-view_&]:text-red-800">
                {tr("Warning: Your open positions will remain active after exit. Make sure to monitor them or close them before exiting.")}</p>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="rtx-legacy-sheet__footer flex flex-wrap items-center justify-end gap-2 px-4 py-3 shrink-0 border-t border-zinc-700 [.rtx-advanced-view_&]:border-gray-200 bg-[#252528] [.rtx-advanced-view_&]:bg-gray-50 rounded-b-lg">
          <button
            ref={cancelRef}
            onClick={onCancel}
            className="px-4 py-1.5 text-xs text-zinc-300 [.rtx-advanced-view_&]:text-gray-600 hover:text-zinc-100 [.rtx-advanced-view_&]:hover:text-gray-900 hover:bg-zinc-700/50 [.rtx-advanced-view_&]:hover:bg-gray-200 rounded transition-colors"
          >
            {tr("Cancel")}</button>
          <button
            onClick={handleDiscard}
            className="rtx-legacy-sheet__discard px-4 py-1.5 text-xs bg-zinc-700 [.rtx-advanced-view_&]:bg-gray-300 hover:bg-zinc-600 [.rtx-advanced-view_&]:hover:bg-gray-400 text-white [.rtx-advanced-view_&]:text-gray-900 rounded transition-colors flex items-center gap-2"
          >
            <Icon name="x-close" size="xs" />
            {tr("Discard & Exit")}</button>
          <button
            onClick={handleConfirm}
            className="rtx-legacy-sheet__danger px-4 py-1.5 text-xs bg-zinc-700 [.rtx-advanced-view_&]:bg-indigo-600 hover:bg-zinc-600 [.rtx-advanced-view_&]:hover:bg-indigo-700 text-white rounded transition-colors flex items-center gap-2"
          >
            {saveWorkspace ? (
              <>
                <Icon name="save" size="xs" />
                {tr("Save & Exit")}</>
            ) : (
              <>
                <Icon name="log-out" size="xs" />
                {tr("Exit")}</>
            )}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
};
