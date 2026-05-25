/**
 * ============================================================================
 * 🚫 AI FENCE: ISOLATED SYSTEM COMPONENT
 * ============================================================================
 * Do not modify, rewrite, or alter this file when processing other features.
 * Drawing tools are self-contained and highly sensitive to state/prop updates.
 * Any adjustments must be done ONLY under explicit drawing-specific requests.
 * ============================================================================
 */

/**
 * MT5-Style Drawing Context Menu
 * Right-click context menu for chart drawing objects
 * Matches MetaTrader 5 UI exactly
 */

import React, { useEffect, useState } from 'react';
import { drawingManager } from '../services/drawingManager';
import type { Drawing, DrawingType } from '../services/drawingManager';

interface DrawingContextMenuProps {
    onClose: () => void;
}

/** Get a human-readable label for a drawing type */
function getDrawingTypeName(type: DrawingType, timeframe: string = 'H1'): string {
    const names: Record<string, string> = {
        trendline: 'Trendline',
        hline: 'Horizontal Line',
        vline: 'Vertical Line',
        text: 'Text',
        channel: 'Channel',
        fibonacci: 'Fibonacci Retracement',
        shapes: 'Shape',
        rectangle: 'Rectangle',
        ellipse: 'Ellipse',
        fib_extension: 'Fibonacci Extension',
        measure: 'Measure',
        freehand: 'Freehand',
        callout: 'Callout',
    };
    return `${timeframe} ${names[type] || type}`;
}

export const DrawingContextMenu: React.FC<DrawingContextMenuProps> = ({ onClose }) => {
    const [menuState, setMenuState] = useState<{ x: number; y: number; drawingId: string } | null>(null);
    const [colorDialogDrawingId, setColorDialogDrawingId] = useState<string | null>(null);
    const [colorInputValue, setColorInputValue] = useState('#8a8a8f');

    useEffect(() => {
        const handleContextMenu = (e: any) => {
            setMenuState({
                x: e.detail.x,
                y: e.detail.y,
                drawingId: e.detail.drawingId
            });
        };

        const handleClickOutside = () => {
            setMenuState(null);
        };

        window.addEventListener('drawing:contextmenu' as any, handleContextMenu);
        window.addEventListener('click', handleClickOutside);
        return () => {
            window.removeEventListener('drawing:contextmenu' as any, handleContextMenu);
            window.removeEventListener('click', handleClickOutside);
        };
    }, []);

    if (!menuState && !colorDialogDrawingId) return null;

    // Inline color property dialog
    if (colorDialogDrawingId) {
        const drawing = drawingManager.getDrawings().find(d => d.id === colorDialogDrawingId);
        return (
            <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[9999]" onClick={() => setColorDialogDrawingId(null)}>
                <div className="bg-[#1a1f2e] border border-[#2d3548] rounded shadow-2xl p-4 min-w-[240px]" onClick={e => e.stopPropagation()}>
                    <div className="text-[12px] text-zinc-300 mb-3 font-medium">Drawing Color</div>
                    <div className="flex items-center gap-3 mb-4">
                        <input
                            type="color"
                            value={colorInputValue}
                            onChange={e => setColorInputValue(e.target.value)}
                            className="w-10 h-8 rounded cursor-pointer border-0"
                        />
                        <input
                            type="text"
                            value={colorInputValue}
                            onChange={e => setColorInputValue(e.target.value)}
                            className="flex-1 bg-[#252b3b] border border-[#3d4558] rounded px-2 py-1 text-[12px] text-zinc-200 outline-none focus:border-blue-500"
                            placeholder="#rrggbb"
                        />
                    </div>
                    <div className="flex gap-2 justify-end">
                        <button
                            onClick={() => setColorDialogDrawingId(null)}
                            className="px-3 py-1.5 text-[11px] bg-zinc-700 text-zinc-300 rounded hover:bg-zinc-600"
                        >Cancel</button>
                        <button
                            onClick={() => {
                                if (drawing) {
                                    drawing.color = colorInputValue;
                                    drawingManager.saveToBackend(drawing);
                                    drawingManager.renderAllDrawings();
                                }
                                setColorDialogDrawingId(null);
                            }}
                            className="px-3 py-1.5 text-[11px] bg-blue-600 text-white rounded hover:bg-blue-700"
                        >Apply</button>
                    </div>
                </div>
            </div>
        );
    }

    if (!menuState) return null;

    const currentDrawing = drawingManager.getDrawings().find(d => d.id === menuState.drawingId);
    const allDrawings = drawingManager.getDrawings();
    const selectedCount = allDrawings.filter(d => d.selected).length;

    // Derive a short ID from the drawing id
    const shortId = currentDrawing?.id ? currentDrawing.id.replace('drawing-', '').slice(-5) : '';
    const drawingLabel = currentDrawing
        ? `${getDrawingTypeName(currentDrawing.type)} ${shortId}`
        : 'Drawing';

    const close = () => {
        setMenuState(null);
        onClose();
    };

    const handleProperties = () => {
        if (!currentDrawing) return close();
        setColorInputValue(currentDrawing.color || '#8a8a8f');
        setColorDialogDrawingId(currentDrawing.id);
        close();
    };

    const handleObjectList = () => {
        // Dispatch event for ObjectList panel (Ctrl+B equivalent)
        window.dispatchEvent(new CustomEvent('open-object-list'));
        close();
    };

    const handleDelete = () => {
        drawingManager.deleteDrawing(menuState.drawingId);
        close();
    };

    const handleDeleteAllArrows = () => {
        drawingManager.deleteByType('shapes');
        close();
    };

    const handleDeleteAllSelected = () => {
        drawingManager.deleteSelected();
        close();
    };

    const handleUnselectAll = () => {
        drawingManager.unselectAll();
        close();
    };

    const handleUnselect = () => {
        if (currentDrawing) {
            drawingManager.unselectDrawing(currentDrawing.id);
        }
        close();
    };

    const handleUndoDelete = () => {
        drawingManager.undo();
        close();
    };

    // Ensure menu doesn't go off-screen
    const menuX = Math.min(menuState.x, window.innerWidth - 240);
    const menuY = Math.min(menuState.y, window.innerHeight - 340);

    return (
        <div
            className="fixed z-[9999]"
            style={{ left: menuX, top: menuY }}
            onClick={(e) => e.stopPropagation()}
        >
            <div
                style={{
                    background: '#1a1f2e',
                    border: '1px solid #2d3548',
                    borderRadius: '2px',
                    boxShadow: '0 4px 24px rgba(0,0,0,0.6), 0 0 1px rgba(255,255,255,0.05)',
                    padding: '3px 0',
                    minWidth: 220,
                    fontFamily: "'Segoe UI', Tahoma, sans-serif",
                    fontSize: 12,
                }}
            >
                {/* Properties */}
                <MenuItem
                    icon={<SettingsIcon />}
                    label={`Properties of ${drawingLabel}`}
                    onClick={handleProperties}
                />

                {/* Object List */}
                <MenuItem
                    icon={<ObjectListIcon />}
                    label="Object List"
                    shortcut="Ctrl+B"
                    onClick={handleObjectList}
                />

                <Separator />

                {/* Delete */}
                <MenuItem
                    icon={<DeleteIcon />}
                    label="Delete"
                    onClick={handleDelete}
                    danger
                />

                {/* Delete All Arrows */}
                <MenuItem
                    icon={<DeleteAllIcon />}
                    label="Delete All Arrows"
                    onClick={handleDeleteAllArrows}
                    danger
                />

                {/* Delete All Selected */}
                <MenuItem
                    icon={<DeleteSelectedIcon />}
                    label="Delete All Selected"
                    shortcut="Delete"
                    onClick={handleDeleteAllSelected}
                    danger
                    disabled={selectedCount === 0}
                />

                <Separator />

                {/* Unselect All */}
                <MenuItem
                    label="Unselect All"
                    onClick={handleUnselectAll}
                />

                {/* Unselect */}
                <MenuItem
                    label="Unselect"
                    onClick={handleUnselect}
                />

                <Separator />

                {/* Undo Delete */}
                <MenuItem
                    icon={<UndoIcon />}
                    label="Undo Delete"
                    shortcut="Ctrl+Z"
                    onClick={handleUndoDelete}
                />
            </div>
        </div>
    );
};

/* ─── Menu Item Component ─── */
interface MenuItemProps {
    icon?: React.ReactNode;
    label: string;
    shortcut?: string;
    onClick: () => void;
    danger?: boolean;
    disabled?: boolean;
}

const MenuItem: React.FC<MenuItemProps> = ({ icon, label, shortcut, onClick, danger, disabled }) => (
    <div
        onClick={(e) => {
            e.stopPropagation();
            if (!disabled) onClick();
        }}
        style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            padding: '5px 12px 5px 8px',
            cursor: disabled ? 'default' : 'pointer',
            opacity: disabled ? 0.4 : 1,
            color: danger ? '#ef6b6b' : '#c8ccd4',
            transition: 'background 0.1s',
        }}
        onMouseEnter={(e) => {
            if (!disabled) e.currentTarget.style.background = '#252b3b';
        }}
        onMouseLeave={(e) => {
            e.currentTarget.style.background = 'transparent';
        }}
    >
        <span style={{ width: 18, height: 18, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
            {icon || null}
        </span>
        <span style={{ flex: 1, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {label}
        </span>
        {shortcut && (
            <span style={{ fontSize: 11, color: '#6b7280', marginLeft: 16, whiteSpace: 'nowrap' }}>
                {shortcut}
            </span>
        )}
    </div>
);

/* ─── Separator ─── */
const Separator = () => (
    <div style={{ height: 1, background: '#2d3548', margin: '3px 8px' }} />
);

/* ─── SVG Icons matching MT5 style ─── */
const SettingsIcon = () => (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="#4a9eff" strokeWidth="1.3">
        <circle cx="8" cy="8" r="2.5" />
        <path d="M8 1v2m0 10v2M1 8h2m10 0h2M3.2 3.2l1.4 1.4m7 7l1.4 1.4m0-9.8l-1.4 1.4m-7 7l-1.4 1.4" />
    </svg>
);

const ObjectListIcon = () => (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="#4a9eff" strokeWidth="1.3">
        <path d="M2 4h12M2 8h12M2 12h8" />
        <circle cx="13" cy="12" r="1.5" fill="#4a9eff" stroke="none" />
    </svg>
);

const DeleteIcon = () => (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="#ef6b6b" strokeWidth="1.3">
        <path d="M4 4l8 8M12 4l-8 8" />
    </svg>
);

const DeleteAllIcon = () => (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="#ef6b6b" strokeWidth="1.3">
        <circle cx="6" cy="6" r="3" />
        <path d="M4.5 4.5l3 3M7.5 4.5l-3 3" />
        <circle cx="10" cy="10" r="3" />
        <path d="M8.5 8.5l3 3M11.5 8.5l-3 3" />
    </svg>
);

const DeleteSelectedIcon = () => (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="#ef6b6b" strokeWidth="1.3">
        <rect x="2" y="2" width="12" height="12" rx="1" strokeDasharray="3 2" />
        <path d="M5 5l6 6M11 5l-6 6" />
    </svg>
);

const UndoIcon = () => (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="#9ca3af" strokeWidth="1.3">
        <path d="M4 7h6a3 3 0 010 6H8" />
        <path d="M7 4L4 7l3 3" />
    </svg>
);
