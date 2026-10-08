import { useUiTranslation } from '../../hooks/useUiTranslation';
import React, { useId, useRef } from 'react';
import { createPortal } from 'react-dom';
import { useConfirmStore } from '../../store/useConfirmStore';
import { useDialogFocusScope } from '../../hooks/useDialogFocusScope';

export function ConfirmDialog() {
    const tr = useUiTranslation();
    const { isOpen, title, message, confirmLabel, danger, onConfirm, onCancel } = useConfirmStore();
    const dialogRef = useRef<HTMLDivElement>(null);
    const cancelRef = useRef<HTMLButtonElement>(null);
    const titleId = useId();
    const messageId = useId();
    useDialogFocusScope({ isOpen, dialogRef, onClose: onCancel, initialFocusRef: cancelRef });

    if (!isOpen) return null;

    return createPortal(
        <div
            className="rtx-confirm-dialog-backdrop fixed inset-0 bg-black/60 flex items-center justify-center p-4 z-[10060]"
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
            <div ref={dialogRef} tabIndex={-1} role="alertdialog" aria-modal="true" aria-labelledby={titleId} aria-describedby={messageId} className="rtx-confirm-dialog flex flex-col w-full max-w-[420px] max-h-[calc(100dvh-32px)] bg-[#1e222d] border border-zinc-600 rounded shadow-2xl select-none overflow-hidden animate-in zoom-in-95 duration-200">

                {/* Title Bar */}
                <div className="rtx-confirm-dialog__header flex shrink-0 items-center justify-between gap-2 px-4 py-2 bg-[#252a37] border-b border-zinc-600">
                    <span id={titleId} className="min-w-0 break-words text-[13px] text-zinc-200 font-bold">{tr(title)}</span>
                    <button type="button" onClick={onCancel} aria-label={tr('Close dialog')} className="flex h-7 w-7 shrink-0 items-center justify-center text-zinc-400 hover:text-white transition-colors">✕</button>
                </div>

                {/* Content */}
                <div id={messageId} className="rtx-confirm-dialog__content min-h-0 overflow-y-auto break-words p-5 bg-[#0d0d11] text-[13px] text-zinc-300 whitespace-pre-wrap">
                    {message}
                </div>

                {/* Footer Buttons */}
                <div className="rtx-confirm-dialog__footer flex shrink-0 flex-wrap items-center justify-end px-4 py-3 bg-[#1e222d] border-t border-zinc-600 gap-3">
                    <button
                        ref={cancelRef}
                        type="button"
                        onClick={onCancel}
                        className="rtx-confirm-dialog__cancel px-6 py-1.5 rounded text-[12px] font-medium text-zinc-300 hover:bg-zinc-700 hover:text-white transition-colors"
                    >
                        {tr("Cancel")}</button>
                    <button
                        type="button"
                        onClick={onConfirm}
                        className={`rtx-confirm-dialog__confirm${danger ? ' rtx-confirm-dialog__confirm--danger' : ''} px-6 py-1.5 rounded text-[12px] font-bold text-white border shadow-lg transition-colors ${danger
                            ? 'bg-gradient-to-b from-red-500 to-red-700 hover:from-red-400 hover:to-red-600 border-red-400/30'
                            : 'bg-gradient-to-b from-blue-500 to-blue-700 hover:from-blue-400 hover:to-blue-600 border-blue-400/30'
                            }`}
                    >
                        {tr(confirmLabel || "OK")}</button>
                </div>
            </div>
        </div>,
        document.body,
    );
}
