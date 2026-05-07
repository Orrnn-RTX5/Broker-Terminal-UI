import React, { useRef, useState, useEffect } from 'react';
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

    return (
        <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/60 backdrop-blur-sm animate-in fade-in duration-200">
            <div className="bg-[#131316] border border-zinc-700 rounded-lg shadow-2xl w-[400px] animate-in zoom-in-95 duration-200">
                <div className="flex items-center justify-between px-4 py-3 border-b border-zinc-700">
                    <h3 className="text-sm font-semibold text-zinc-200">Save Picture</h3>
                    <button onClick={onClose} className="text-zinc-400 hover:text-white transition-colors">
                        <Icon name="x-close" size="md" />
                    </button>
                </div>
                <div className="p-4 space-y-4 text-sm text-zinc-400">
                    <p>Image export for {symbol} ({timeframe}) will be implemented soon.</p>
                </div>
                <div className="flex justify-end gap-2 px-4 py-3 border-t border-zinc-700">
                    <button onClick={onClose} className="px-3 py-1 bg-zinc-700 hover:bg-zinc-600 text-white rounded">Close</button>
                </div>
            </div>
        </div>
    );
};
