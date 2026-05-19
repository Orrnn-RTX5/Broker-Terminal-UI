import { Icon } from '../ui/Icon';
import React, { useState } from 'react';
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
  const [saveWorkspace, setSaveWorkspace] = useState(true);
  const [dontAskAgain, setDontAskAgain] = useState(false);

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
      className="fixed inset-0 bg-black/50 flex items-center justify-center z-[9999]"
      onClick={(e) => {
          e.stopPropagation();
          if (e.target === e.currentTarget) onCancel();
      }}
      onMouseDown={(e) => e.stopPropagation()}
      onTouchStart={(e) => e.stopPropagation()}
      onPointerDown={(e) => e.stopPropagation()}
    >
      <div
        className="bg-[#131316] [.rtx-advanced-view_&]:bg-white border border-zinc-700 [.rtx-advanced-view_&]:border-gray-200 rounded-lg shadow-2xl w-[480px] animate-in fade-in zoom-in-95 duration-150"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-zinc-700 [.rtx-advanced-view_&]:border-gray-200 bg-[#131316] [.rtx-advanced-view_&]:bg-gray-50 rounded-t-lg">
          <div className="flex items-center gap-2">
            <Icon name="alert-triangle" size="md" className="text-amber-400 [.rtx-advanced-view_&]:text-amber-500" />
            <h2 className="text-sm font-semibold text-zinc-100 [.rtx-advanced-view_&]:text-gray-900">Confirm Exit</h2>
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
          {/* Warning Message */}
          <div className="flex items-start gap-3 p-3 bg-amber-500/10 [.rtx-advanced-view_&]:bg-amber-50 border border-amber-500/30 [.rtx-advanced-view_&]:border-amber-200 rounded">
            <Icon name="alert-triangle" size="lg" className="text-amber-400 [.rtx-advanced-view_&]:text-amber-600 flex-shrink-0 mt-0.5" />
            <div className="text-xs space-y-1">
              <p className="text-amber-200 [.rtx-advanced-view_&]:text-amber-800 font-medium">
                You have unsaved changes that will be lost if you exit now.
              </p>
              <p className="text-zinc-300 [.rtx-advanced-view_&]:text-amber-700">
                Please review the items below and choose how to proceed.
              </p>
            </div>
          </div>

          {/* Unsaved Items List */}
          {hasChanges && (
            <div className="space-y-2">
              <p className="text-xs font-semibold text-zinc-400 [.rtx-advanced-view_&]:text-gray-600 mb-2">Unsaved Items:</p>

              {changes.hasWorkspaceChanges && (
                <div className="flex items-center gap-2 px-3 py-2 bg-zinc-800/50 [.rtx-advanced-view_&]:bg-gray-100 rounded">
                  <div className="w-2 h-2 rounded-full bg-zinc-400 [.rtx-advanced-view_&]:bg-gray-400" />
                  <span className="text-xs text-zinc-300 [.rtx-advanced-view_&]:text-gray-700">Workspace layout has been modified</span>
                </div>
              )}

              {changes.hasOpenTrades && (
                <div className="flex items-center gap-2 px-3 py-2 bg-zinc-800/50 [.rtx-advanced-view_&]:bg-gray-100 rounded">
                  <div className="w-2 h-2 rounded-full bg-green-500 [.rtx-advanced-view_&]:bg-emerald-500" />
                  <span className="text-xs text-zinc-300 [.rtx-advanced-view_&]:text-gray-700">
                    {changes.openTradesCount} open position{changes.openTradesCount !== 1 ? 's' : ''}
                  </span>
                </div>
              )}

              {changes.hasDraftOrders && (
                <div className="flex items-center gap-2 px-3 py-2 bg-zinc-800/50 [.rtx-advanced-view_&]:bg-gray-100 rounded">
                  <div className="w-2 h-2 rounded-full bg-yellow-500 [.rtx-advanced-view_&]:bg-amber-500" />
                  <span className="text-xs text-zinc-300 [.rtx-advanced-view_&]:text-gray-700">
                    {changes.draftOrdersCount} pending order{changes.draftOrdersCount !== 1 ? 's' : ''}
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
                <span className="text-xs text-zinc-300 [.rtx-advanced-view_&]:text-gray-700">Save workspace before exiting</span>
              </label>
              <p className="text-xs text-zinc-500 [.rtx-advanced-view_&]:text-gray-500 ml-6">
                Your layout, charts, and settings will be restored next time
              </p>
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
              <span className="text-xs text-zinc-300 [.rtx-advanced-view_&]:text-gray-700">Don't ask again (remember my choice)</span>
            </label>
          </div>

          {/* Warning for Open Trades */}
          {changes.hasOpenTrades && (
            <div className="flex items-start gap-2 p-2 bg-red-500/10 [.rtx-advanced-view_&]:bg-red-50 border border-red-500/30 [.rtx-advanced-view_&]:border-red-200 rounded mt-4">
              <Icon name="alert-triangle" size="sm" className="text-red-400 [.rtx-advanced-view_&]:text-red-600 flex-shrink-0 mt-0.5" />
              <p className="text-xs text-red-200 [.rtx-advanced-view_&]:text-red-800">
                Warning: Your open positions will remain active after exit. Make sure to monitor them
                or close them before exiting.
              </p>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-2 px-4 py-3 border-t border-zinc-700 [.rtx-advanced-view_&]:border-gray-200 bg-[#252528] [.rtx-advanced-view_&]:bg-gray-50 rounded-b-lg">
          <button
            onClick={onCancel}
            className="px-4 py-1.5 text-xs text-zinc-300 [.rtx-advanced-view_&]:text-gray-600 hover:text-zinc-100 [.rtx-advanced-view_&]:hover:text-gray-900 hover:bg-zinc-700/50 [.rtx-advanced-view_&]:hover:bg-gray-200 rounded transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleDiscard}
            className="px-4 py-1.5 text-xs bg-zinc-700 [.rtx-advanced-view_&]:bg-gray-300 hover:bg-zinc-600 [.rtx-advanced-view_&]:hover:bg-gray-400 text-white [.rtx-advanced-view_&]:text-gray-900 rounded transition-colors flex items-center gap-2"
          >
            <Icon name="x-close" size="xs" />
            Discard & Exit
          </button>
          <button
            onClick={handleConfirm}
            className="px-4 py-1.5 text-xs bg-zinc-700 [.rtx-advanced-view_&]:bg-indigo-600 hover:bg-zinc-600 [.rtx-advanced-view_&]:hover:bg-indigo-700 text-white rounded transition-colors flex items-center gap-2"
          >
            {saveWorkspace ? (
              <>
                <Icon name="save" size="xs" />
                Save & Exit
              </>
            ) : (
              <>
                <Icon name="log-out" size="xs" />
                Exit
              </>
            )}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
};
