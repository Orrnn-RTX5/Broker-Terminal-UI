import { Icon } from '../ui/Icon';
import React, { useState } from 'react';
import { useTheme } from '../../contexts/ThemeContext';

interface ColorPickerDialogProps {
    isOpen: boolean;
    onClose: () => void;
}

const PRESET_COLORS = [
    '#2196F3', // Blue (default)
    '#8B5CF6', // Purple
    '#10B981', // Emerald
    '#F59E0B', // Amber
    '#EF4444', // Red
    '#EC4899', // Pink
    '#06B6D4', // Cyan
    '#84CC16', // Lime
];

export const ColorPickerDialog: React.FC<ColorPickerDialogProps> = ({ isOpen, onClose }) => {
    const { accentColor, setAccentColor, setTheme } = useTheme();
    const [selectedColor, setSelectedColor] = useState(accentColor);

    if (!isOpen) return null;

    const handleApply = () => {
        setAccentColor(selectedColor);
        setTheme('custom');
        onClose();
    };

    return (
        <div className="fixed inset-0 z-[1100] flex items-center justify-center">
            {/* Backdrop */}
            <div
                className="absolute inset-0 bg-black/60 backdrop-blur-sm"
                onClick={onClose}
            />

            {/* Dialog */}
            <div className="relative bg-[#131316] border border-zinc-700 rounded-lg shadow-2xl w-80 overflow-hidden">
                {/* Header */}
                <div className="flex items-center justify-between px-4 py-3 border-b border-zinc-700">
                    <div className="flex items-center gap-2">
                        <Icon name="palette" size="lg" className="text-zinc-400" />
                        <span className="text-sm font-medium text-zinc-200">Choose Accent Color</span>
                    </div>
                    <button
                        onClick={onClose}
                        className="p-1 rounded hover:bg-zinc-700 text-zinc-400 hover:text-zinc-200 transition-colors"
                    >
                        <Icon name="x-close" size="md" />
                    </button>
                </div>

                {/* Content */}
                <div className="p-4 space-y-4">
                    {/* Color Preview */}
                    <div className="flex items-center gap-3">
                        <div
                            className="w-12 h-12 rounded-lg border-2 border-zinc-600 shadow-inner"
                            style={{ backgroundColor: selectedColor }}
                        />
                        <div>
                            <p className="text-xs text-zinc-400">Selected Color</p>
                            <p className="text-sm font-mono text-zinc-200">{selectedColor.toUpperCase()}</p>
                        </div>
                    </div>

                    {/* Preset Colors */}
                    <div>
                        <p className="text-xs text-zinc-400 mb-2">Preset Colors</p>
                        <div className="grid grid-cols-4 gap-2">
                            {PRESET_COLORS.map((color) => (
                                <button
                                    key={color}
                                    onClick={() => setSelectedColor(color)}
                                    className={`w-10 h-10 rounded-lg border-2 transition-all hover:scale-105 ${selectedColor === color
                                            ? 'border-white shadow-lg'
                                            : 'border-zinc-600 hover:border-zinc-400'
                                        }`}
                                    style={{ backgroundColor: color }}
                                >
                                    {selectedColor === color && (
                                        <Icon name="check" size="md" className="mx-auto text-white drop-shadow-md" />
                                    )}
                                </button>
                            ))}
                        </div>
                    </div>

                    {/* Custom Color Picker */}
                    <div>
                        <p className="text-xs text-zinc-400 mb-2">Custom Color</p>
                        <div className="flex items-center gap-2">
                            <input
                                type="color"
                                value={selectedColor}
                                onChange={(e) => setSelectedColor(e.target.value)}
                                className="w-full h-10 rounded cursor-pointer border border-zinc-600"
                            />
                        </div>
                    </div>
                </div>

                {/* Footer */}
                <div className="flex justify-end gap-2 px-4 py-3 border-t border-zinc-700 bg-zinc-800/50">
                    <button
                        onClick={onClose}
                        className="px-4 py-1.5 text-sm text-zinc-300 hover:text-white hover:bg-zinc-700 rounded transition-colors"
                    >
                        Cancel
                    </button>
                    <button
                        onClick={handleApply}
                        className="px-4 py-1.5 text-sm text-white rounded transition-colors"
                        style={{ backgroundColor: selectedColor }}
                    >
                        Apply Theme
                    </button>
                </div>
            </div>
        </div>
    );
};
