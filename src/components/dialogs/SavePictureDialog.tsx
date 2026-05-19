import React, { useRef, useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { Icon } from '../ui/Icon';

export interface SavePictureDialogProps {
    isOpen: boolean;
    onClose: () => void;
    chartCanvas?: HTMLCanvasElement | null;
    chartContainer?: HTMLElement | null;
    symbol: string;
    timeframe: string;
}

export const SavePictureDialog: React.FC<SavePictureDialogProps> = ({ isOpen, onClose, chartCanvas, chartContainer, symbol, timeframe }) => {
    if (!isOpen) return null;

    return createPortal(
        <div 
            className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/60 backdrop-blur-sm animate-in fade-in duration-200"
            onClick={(e) => {
                e.stopPropagation();
                if (e.target === e.currentTarget) onClose();
            }}
            onMouseDown={(e) => e.stopPropagation()}
            onTouchStart={(e) => e.stopPropagation()}
            onPointerDown={(e) => e.stopPropagation()}
        >
            <div 
                className="bg-[#131316] [.rtx-advanced-view_&]:bg-white border border-zinc-700 [.rtx-advanced-view_&]:border-gray-200 rounded-lg shadow-2xl w-[400px] animate-in zoom-in-95 duration-200"
                onClick={(e) => e.stopPropagation()}
            >
                <div className="flex items-center justify-between px-4 py-3 border-b border-zinc-700 [.rtx-advanced-view_&]:border-gray-200 bg-[#131316] [.rtx-advanced-view_&]:bg-gray-50 rounded-t-lg">
                    <h3 className="text-sm font-semibold text-zinc-200 [.rtx-advanced-view_&]:text-gray-900">Save Picture</h3>
                    <button onClick={onClose} className="text-zinc-400 hover:text-white [.rtx-advanced-view_&]:hover:text-gray-900 transition-colors">
                        <Icon name="x-close" size="md" />
                    </button>
                </div>
                <div className="p-4 space-y-4 text-sm text-zinc-400 [.rtx-advanced-view_&]:text-gray-600">
                    <p>Image export for {symbol} ({timeframe}) will be implemented soon.</p>
                </div>
                <div className="flex justify-end gap-2 px-4 py-3 border-t border-zinc-700 [.rtx-advanced-view_&]:border-gray-200 bg-[#131316] [.rtx-advanced-view_&]:bg-gray-50 rounded-b-lg">
                    <button onClick={onClose} className="px-3 py-1 bg-zinc-700 [.rtx-advanced-view_&]:bg-gray-200 hover:bg-zinc-600 [.rtx-advanced-view_&]:hover:bg-gray-300 text-white [.rtx-advanced-view_&]:text-gray-800 rounded">Close</button>
                </div>
            </div>
        </div>,
        document.body
    );
};
