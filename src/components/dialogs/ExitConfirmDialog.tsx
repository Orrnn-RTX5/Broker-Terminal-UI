/**
 * Exit Confirmation Dialog
 * Shows unsaved changes and options when user attempts to exit
 */

import { Icon } from '../ui/Icon';
import React, { useState } from 'react';
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

  return (
    <div
      className="fixed inset-0 bg-black/50 flex items-center justify-center z-[200]"
      onClick={onCancel}
    >
      <div
        className="bg-[#131316] border border-zinc-700 rounded-lg shadow-2xl w-[480px] animate-in fade-in zoom-in-95 duration-150"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-zinc-700">
          <div className="flex items-center gap-2">
            <Icon name="alert-triangle" size="md" className="text-amber-400" />
            <h2 className="text-sm font-semibold text-zinc-100">Confirm Exit</h2>
          </div>
          <button
            onClick={onCancel}
            className="text-zinc-400 hover:text-zinc-100 transition-colors p-1 hover:bg-zinc-700/50 rounded"
            aria-label="Close"
          >
            <Icon name="x-close" size="md" />
          </button>
        </div>

        {/* Content */}
        <div className="p-4 space-y-4">
          {/* Warning Message */}
          <div className="flex items-start gap-3 p-3 bg-amber-500/10 border border-amber-500/30 rounded">
            <Icon name="alert-triangle" size="lg" className="text-amber-400 flex-shrink-0 mt-0.5" />
            <div className="text-xs space-y-1">
              <p className="text-amber-200 font-medium">
                You have unsaved changes that will be lost if you exit now.
              </p>
              <p className="text-zinc-300">
                Please review the items below and choose how to proceed.
              </p>
            </div>
          </div>

          {/* Unsaved Items List */}
          {hasChanges && (
            <div className="space-y-2">
              <p className="text-xs font-semibold text-zinc-400 mb-2">Unsaved Items:</p>

              {changes.hasWorkspaceChanges && (
                <div className="flex items-center gap-2 px-3 py-2 bg-zinc-800/50 rounded">
                  <div className="w-2 h-2 rounded-full bg-zinc-8000" />
                  <span className="text-xs text-zinc-300">Workspace layout has been modified</span>
                </div>
              )}

              {changes.hasOpenTrades && (
                <div className="flex items-center gap-2 px-3 py-2 bg-zinc-800/50 rounded">
                  <div className="w-2 h-2 rounded-full bg-green-500" />
                  <span className="text-xs text-zinc-300">
                    {changes.openTradesCount} open position{changes.openTradesCount !== 1 ? 's' : ''}
                  </span>
                </div>
              )}

              {changes.hasDraftOrders && (
                <div className="flex items-center gap-2 px-3 py-2 bg-zinc-800/50 rounded">
                  <div className="w-2 h-2 rounded-full bg-yellow-500" />
                  <span className="text-xs text-zinc-300">
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
                  className="w-4 h-4 rounded border-zinc-600 bg-zinc-800 text-blue-600 focus:ring-2 focus:ring-blue-500 focus:ring-offset-0"
                />
                <span className="text-xs text-zinc-300">Save workspace before exiting</span>
              </label>
              <p className="text-xs text-zinc-500 ml-6">
                Your layout, charts, and settings will be restored next time
              </p>
            </div>
          )}

          {/* Don't Ask Again Option */}
          <div className="pt-2 border-t border-zinc-700">
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={dontAskAgain}
                onChange={(e) => setDontAskAgain(e.target.checked)}
                className="w-4 h-4 rounded border-zinc-600 bg-zinc-800 text-blue-600 focus:ring-2 focus:ring-blue-500 focus:ring-offset-0"
              />
              <span className="text-xs text-zinc-300">Don't ask again (remember my choice)</span>
            </label>
          </div>

          {/* Warning for Open Trades */}
          {changes.hasOpenTrades && (
            <div className="flex items-start gap-2 p-2 bg-red-500/10 border border-red-500/30 rounded">
              <Icon name="alert-triangle" size="sm" className="text-red-400 flex-shrink-0 mt-0.5" />
              <p className="text-xs text-red-200">
                Warning: Your open positions will remain active after exit. Make sure to monitor them
                or close them before exiting.
              </p>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-2 px-4 py-3 border-t border-zinc-700 bg-[#252528]">
          <button
            onClick={onCancel}
            className="px-4 py-1.5 text-xs text-zinc-300 hover:text-zinc-100 hover:bg-zinc-700/50 rounded transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleDiscard}
            className="px-4 py-1.5 text-xs bg-zinc-700 hover:bg-zinc-600 text-white rounded transition-colors flex items-center gap-2"
          >
            <Icon name="x-close" size="xs" />
            Discard & Exit
          </button>
          <button
            onClick={handleConfirm}
            className="px-4 py-1.5 text-xs bg-zinc-700 hover:bg-zinc-600 text-white rounded transition-colors flex items-center gap-2"
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
    </div>
  );
};
