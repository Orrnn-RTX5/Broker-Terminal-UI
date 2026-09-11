import { useUiTranslation } from '../../hooks/useUiTranslation';
import React from 'react';
import { useConfirmStore } from '../../store/useConfirmStore';

export function ConfirmDialog() {
    const tr = useUiTranslation();
    const { isOpen, title, message, onConfirm, onCancel, closeConfirm } = useConfirmStore();

    if (!isOpen) return null;

    return (
        <div
            className="rtx-confirm-dialog-backdrop fixed inset-0 bg-black/60 flex items-center justify-center z-[200]"
            onClick={(e) => {
                if (e.target === e.currentTarget) {
                    onCancel();
                }
            }}
            onContextMenuCapture={(e) => {
                e.stopPropagation();
                e.preventDefault();
            }}
            onContextMenu={(e) => e.stopPropagation()}
        >
            <div className="rtx-confirm-dialog bg-[#1e222d] border border-zinc-600 rounded shadow-2xl select-none overflow-hidden min-w-[320px] max-w-[90vw] animate-in zoom-in-95 duration-200">

                {/* Title Bar */}
                <div className="rtx-confirm-dialog__header flex items-center justify-between px-4 py-2 bg-[#252a37] border-b border-zinc-600">
                    <span className="text-[13px] text-zinc-200 font-bold">{tr(title)}</span>
                    <button onClick={onCancel} className="text-zinc-400 hover:text-white transition-colors">✕</button>
                </div>

                {/* Content */}
                <div className="rtx-confirm-dialog__content p-5 bg-[#0d0d11] text-[13px] text-zinc-300 whitespace-pre-wrap">
                    {message}
                </div>

                {/* Footer Buttons */}
                <div className="rtx-confirm-dialog__footer flex items-center justify-end px-4 py-3 bg-[#1e222d] border-t border-zinc-600 gap-3">
                    <button
                        onClick={onCancel}
                        className="rtx-confirm-dialog__cancel px-6 py-1.5 rounded text-[12px] font-medium text-zinc-300 hover:bg-zinc-700 hover:text-white transition-colors"
                    >
                        {tr("Cancel")}</button>
                    <button
                        onClick={onConfirm}
                        className="rtx-confirm-dialog__confirm px-6 py-1.5 rounded text-[12px] font-bold text-white bg-gradient-to-b from-blue-500 to-blue-700 hover:from-blue-400 hover:to-blue-600 border border-blue-400/30 shadow-lg transition-colors"
                    >
                        {tr("OK")}</button>
                </div>
            </div>
        </div>
    );
}
