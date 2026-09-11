import { useUiTranslation } from '../hooks/useUiTranslation';
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
 * MT5-Style Drawing Context Menu (Enhanced)
 * Right-click context menu for chart drawing objects — with:
 *  - Specific drawing delete (only the right-clicked drawing)
 *  - Color library palette (20 preset colors + custom color input)
 *  - Line style (solid / dashed / dotted)
 *  - Line width (thin=1 / normal=2 / thick=4 presets)
 */

import React, { useEffect, useState, useRef } from 'react';
import { drawingManager } from '../services/drawingManager';
import type { Drawing, DrawingType } from '../services/drawingManager';

// ─── Color Palette ───────────────────────────────────────────────────────────
const COLOR_PALETTE = [
    // Row 1 — blues / cyans
    '#4a9eff', '#2563eb', '#0ea5e9', '#06b6d4', '#22d3ee',
    // Row 2 — greens
    '#22c55e', '#16a34a', '#10b981', '#6ee7b7', '#a3e635',
    // Row 3 — yellows / oranges / reds
    '#f59e0b', '#f97316', '#ef4444', '#dc2626', '#f43f5e',
    // Row 4 — purples / pinks
    '#8b5cf6', '#a855f7', '#ec4899', '#f472b6', '#e879f9',
    // Row 5 — neutrals / whites
    '#ffffff', '#d1d5db', '#9ca3af', '#6b7280', '#374151',
];

// ─── Line Style ───────────────────────────────────────────────────────────────
type LineStyleOption = 'solid' | 'dashed' | 'dotted';

const LINE_STYLES: { value: LineStyleOption; label: string; preview: React.ReactNode }[] = [
    {
        value: 'solid',
        label: 'Solid',
        preview: (
            <svg width="38" height="12" viewBox="0 0 38 12">
                <line x1="1" y1="6" x2="37" y2="6" stroke="currentColor" strokeWidth="2" />
            </svg>
        ),
    },
    {
        value: 'dashed',
        label: 'Dashed',
        preview: (
            <svg width="38" height="12" viewBox="0 0 38 12">
                <line x1="1" y1="6" x2="37" y2="6" stroke="currentColor" strokeWidth="2" strokeDasharray="8 4" />
            </svg>
        ),
    },
    {
        value: 'dotted',
        label: 'Dotted',
        preview: (
            <svg width="38" height="12" viewBox="0 0 38 12">
                <line x1="1" y1="6" x2="37" y2="6" stroke="currentColor" strokeWidth="2" strokeDasharray="3 3" />
            </svg>
        ),
    },
];

// ─── Line Width ───────────────────────────────────────────────────────────────
const LINE_WIDTHS: { value: number; label: string }[] = [
    { value: 1, label: 'Thin' },
    { value: 2, label: 'Normal' },
    { value: 4, label: 'Thick' },
];

// ─── Helpers ─────────────────────────────────────────────────────────────────
function getDrawingTypeName(type: DrawingType): string {
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
        stamp: 'Stamp',
    };
    return names[type] || type;
}

// ─── Main Component ───────────────────────────────────────────────────────────
interface DrawingContextMenuProps {
    onClose: () => void;
}

type SubPanel = null | 'color' | 'style';

export const DrawingContextMenu: React.FC<DrawingContextMenuProps> = ({ onClose }) => {
    const tr = useUiTranslation();
    const [menuState, setMenuState] = useState<{
        x: number;
        y: number;
        drawingId: string;
        contextId?: string;
    } | null>(null);
    const [subPanel, setSubPanel] = useState<SubPanel>(null);

    // Local copies of drawing properties for the style sub-panel
    const [localColor, setLocalColor] = useState('#4a9eff');
    const [localStyle, setLocalStyle] = useState<LineStyleOption>('solid');
    const [localWidth, setLocalWidth] = useState<number>(2);
    const [customColorInput, setCustomColorInput] = useState('#4a9eff');

    const menuRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        const handleContextMenu = (e: any) => {
            const drawing = drawingManager.getDrawings().find(d => d.id === e.detail.drawingId);
            // Pre-populate local state from the drawing
            setLocalColor(drawing?.color || '#4a9eff');
            setLocalStyle((drawing?.lineStyle as LineStyleOption) || 'solid');
            setLocalWidth(drawing?.lineWidth || 2);
            setCustomColorInput(drawing?.color || '#4a9eff');
            setSubPanel(null);
            setMenuState({
                x: e.detail.x,
                y: e.detail.y,
                drawingId: e.detail.drawingId,
                contextId: e.detail.contextId,
            });
        };

        const handleClickOutside = (e: MouseEvent) => {
            if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
                setMenuState(null);
                setSubPanel(null);
            }
        };

        window.addEventListener('drawing:contextmenu' as any, handleContextMenu);
        window.addEventListener('mousedown', handleClickOutside);
        return () => {
            window.removeEventListener('drawing:contextmenu' as any, handleContextMenu);
            window.removeEventListener('mousedown', handleClickOutside);
        };
    }, []);

    if (!menuState) return null;

    const currentDrawing = drawingManager.getDrawings().find(d => d.id === menuState.drawingId);
    const allDrawings = drawingManager.getDrawings();
    const selectedCount = allDrawings.filter(d => d.selected).length;

    const shortId = currentDrawing?.id ? currentDrawing.id.replace('d-', '').slice(-5) : '';
    const drawingLabel = currentDrawing
        ? getDrawingTypeName(currentDrawing.type)
        : 'Drawing';

    const close = () => {
        setMenuState(null);
        setSubPanel(null);
        onClose();
    };

    // ── Apply colour / style changes ──────────────────────────────────────────
    const applyChanges = (opts: { color?: string; lineStyle?: LineStyleOption; lineWidth?: number }) => {
        if (!currentDrawing) return;
        if (opts.color !== undefined) {
            currentDrawing.color = opts.color;
            setLocalColor(opts.color);
            setCustomColorInput(opts.color);
        }
        if (opts.lineStyle !== undefined) {
            currentDrawing.lineStyle = opts.lineStyle;
            setLocalStyle(opts.lineStyle);
        }
        if (opts.lineWidth !== undefined) {
            currentDrawing.lineWidth = opts.lineWidth;
            setLocalWidth(opts.lineWidth);
        }
        drawingManager.persistCurrentContext(menuState.contextId);
        drawingManager.saveToBackend(currentDrawing);
        drawingManager.renderAllDrawings();
    };

    // ── Handlers ──────────────────────────────────────────────────────────────
    const handleDeleteThis = () => {
        drawingManager.deleteDrawing(menuState.drawingId);
        close();
    };

    const handleDeleteSelected = () => {
        drawingManager.deleteSelected();
        close();
    };

    const handleDeleteAllArrows = () => {
        drawingManager.deleteByType('shapes');
        close();
    };

    const handleObjectList = () => {
        window.dispatchEvent(new CustomEvent('open-object-list'));
        close();
    };

    const handleUnselectAll = () => {
        drawingManager.unselectAll();
        close();
    };

    const handleUnselect = () => {
        if (currentDrawing) drawingManager.unselectDrawing(currentDrawing.id);
        close();
    };

    const handleUndoDelete = () => {
        drawingManager.undo();
        close();
    };

    // ── Screen position clamping ──────────────────────────────────────────────
    // Menu width ~240, expanded sub-panel adds ~248 on the right
    const menuW = subPanel ? 488 : 240;
    const menuH = 340;
    const menuX = Math.min(menuState.x, window.innerWidth - menuW - 8);
    const menuY = Math.min(menuState.y, window.innerHeight - menuH - 8);

    return (
        <div
            ref={menuRef}
            className="fixed z-[9999] flex"
            style={{ left: menuX, top: menuY }}
            onClick={e => e.stopPropagation()}
            onMouseDown={e => e.stopPropagation()}
        >
            {/* ── Primary context menu ─────────────────────────────────────── */}
            <div style={menuStyle}>
                {/* Header */}
                <div style={headerStyle}>
                    <span style={{ color: '#4a9eff', fontSize: 12, fontWeight: 500 }}>{drawingLabel}</span>
                    {shortId && <span style={{ color: '#4b5563', fontSize: 12, fontWeight: 400 }}>#{shortId}</span>}
                </div>

                <Separator />

                {/* ─── Delete this specific drawing ─── */}
                <MenuItem
                    icon={<DeleteThisIcon />}
                    label={tr("Delete {{value0}}", { value0: drawingLabel })}
                    onClick={handleDeleteThis}
                    danger
                />

                {/* ─── Delete all selected ─── */}
                <MenuItem
                    icon={<DeleteSelectedIcon />}
                    label={tr("Delete All Selected")}
                    shortcut="Del"
                    onClick={handleDeleteSelected}
                    danger
                    disabled={selectedCount === 0}
                />

                {/* ─── Delete all arrows/shapes ─── */}
                <MenuItem
                    icon={<DeleteAllIcon />}
                    label={tr("Delete All Shapes")}
                    onClick={handleDeleteAllArrows}
                    danger
                />

                <Separator />

                {/* ─── Change Color ─── */}
                <MenuItem
                    icon={<ColorIcon color={localColor} />}
                    label={tr("Change Color")}
                    shortcut="›"
                    onClick={() => setSubPanel(subPanel === 'color' ? null : 'color')}
                    active={subPanel === 'color'}
                />

                {/* ─── Line Style ─── */}
                <MenuItem
                    icon={<LineStyleIcon />}
                    label={tr("Line Style & Width")}
                    shortcut="›"
                    onClick={() => setSubPanel(subPanel === 'style' ? null : 'style')}
                    active={subPanel === 'style'}
                />

                <Separator />

                {/* ─── Object List ─── */}
                <MenuItem
                    icon={<ObjectListIcon />}
                    label={tr("Object List")}
                    shortcut="Ctrl+B"
                    onClick={handleObjectList}
                />

                {/* ─── Unselect ─── */}
                <MenuItem label={tr("Unselect")} onClick={handleUnselect} />
                <MenuItem label={tr("Unselect All")} onClick={handleUnselectAll} />

                <Separator />

                {/* ─── Undo Delete ─── */}
                <MenuItem
                    icon={<UndoIcon />}
                    label={tr("Undo Delete")}
                    shortcut="Ctrl+Z"
                    onClick={handleUndoDelete}
                />
            </div>

            {/* ── Color Sub-Panel ──────────────────────────────────────────── */}
            {subPanel === 'color' && (
                <div style={subPanelStyle}>
                    <div style={subHeaderStyle}>{tr("Color")}</div>

                    {/* Palette grid */}
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5,1fr)', gap: 5, padding: '0 12px 10px' }}>
                        {COLOR_PALETTE.map(color => (
                            <button
                                key={color}
                                onClick={() => applyChanges({ color })}
                                title={color}
                                style={{
                                    width: 26,
                                    height: 26,
                                    borderRadius: 4,
                                    border: localColor === color
                                        ? '2.5px solid #fff'
                                        : '2px solid rgba(255,255,255,0.08)',
                                    background: color,
                                    cursor: 'pointer',
                                    boxShadow: localColor === color ? `0 0 6px ${color}88` : 'none',
                                    transition: 'transform 0.1s',
                                }}
                                onMouseEnter={e => (e.currentTarget.style.transform = 'scale(1.18)')}
                                onMouseLeave={e => (e.currentTarget.style.transform = 'scale(1)')}
                            />
                        ))}
                    </div>

                    {/* Custom colour input */}
                    <div style={{ padding: '0 12px 12px', display: 'flex', gap: 8, alignItems: 'center' }}>
                        <div style={{ position: 'relative', flexShrink: 0 }}>
                            <input
                                type="color"
                                value={customColorInput}
                                onChange={e => {
                                    setCustomColorInput(e.target.value);
                                    applyChanges({ color: e.target.value });
                                }}
                                style={{
                                    width: 32, height: 28,
                                    border: 'none',
                                    borderRadius: 4,
                                    cursor: 'pointer',
                                    background: 'transparent',
                                    padding: 0,
                                }}
                                title={tr("Custom colour")}
                            />
                        </div>
                        <input
                            type="text"
                            value={customColorInput}
                            maxLength={9}
                            onChange={e => {
                                const v = e.target.value;
                                setCustomColorInput(v);
                                if (/^#[0-9a-fA-F]{6}$/.test(v)) {
                                    applyChanges({ color: v });
                                }
                            }}
                            style={{
                                flex: 1,
                                background: '#252b3b',
                                border: '1px solid #2d3548',
                                borderRadius: 4,
                                color: '#c8ccd4',
                                fontSize: 12,
                                fontWeight: 400,
                                padding: '4px 8px',
                                outline: 'none',
                                fontFamily: 'monospace',
                            }}
                            placeholder={tr("#rrggbb")}
                        />
                    </div>

                    {/* Preview swatch */}
                    <div style={{ padding: '0 12px 12px', display: 'flex', alignItems: 'center', gap: 8 }}>
                        <div style={{ width: 60, height: 3, background: localColor, borderRadius: 2, flex: 1 }} />
                        <span style={{ fontSize: 12, fontWeight: 400, color: '#6b7280' }}>{tr("Preview")}</span>
                    </div>
                </div>
            )}

            {/* ── Line Style Sub-Panel ─────────────────────────────────────── */}
            {subPanel === 'style' && (
                <div style={subPanelStyle}>
                    {/* Line Style */}
                    <div style={subHeaderStyle}>{tr("Line Style")}</div>
                    <div style={{ padding: '0 12px 10px', display: 'flex', flexDirection: 'column', gap: 4 }}>
                        {LINE_STYLES.map(opt => (
                            <button
                                key={opt.value}
                                onClick={() => applyChanges({ lineStyle: opt.value })}
                                style={{
                                    display: 'flex',
                                    alignItems: 'center',
                                    gap: 10,
                                    padding: '5px 8px',
                                    borderRadius: 4,
                                    border: localStyle === opt.value
                                        ? '1.5px solid #4a9eff'
                                        : '1.5px solid transparent',
                                    background: localStyle === opt.value ? 'rgba(74,158,255,0.1)' : 'transparent',
                                    cursor: 'pointer',
                                    color: localStyle === opt.value ? '#4a9eff' : '#9ca3af',
                                    width: '100%',
                                    textAlign: 'left',
                                    transition: 'all 0.15s',
                                }}
                                onMouseEnter={e => {
                                    if (localStyle !== opt.value) {
                                        e.currentTarget.style.background = '#252b3b';
                                    }
                                }}
                                onMouseLeave={e => {
                                    if (localStyle !== opt.value) {
                                        e.currentTarget.style.background = 'transparent';
                                    }
                                }}
                            >
                                <span style={{ color: localStyle === opt.value ? '#4a9eff' : '#9ca3af' }}>
                                    {opt.preview}
                                </span>
                                <span style={{ fontSize: 14, fontWeight: 400 }}>{opt.label}</span>
                                {localStyle === opt.value && (
                                    <CheckIcon style={{ marginLeft: 'auto' }} />
                                )}
                            </button>
                        ))}
                    </div>

                    <Separator />

                    {/* Line Width */}
                    <div style={subHeaderStyle}>{tr("Line Width")}</div>
                    <div style={{ padding: '0 12px 10px', display: 'flex', gap: 6 }}>
                        {LINE_WIDTHS.map(opt => (
                            <button
                                key={opt.value}
                                onClick={() => applyChanges({ lineWidth: opt.value })}
                                title={opt.label}
                                style={{
                                    flex: 1,
                                    padding: '7px 4px',
                                    borderRadius: 4,
                                    border: localWidth === opt.value
                                        ? '1.5px solid #4a9eff'
                                        : '1.5px solid #2d3548',
                                    background: localWidth === opt.value ? 'rgba(74,158,255,0.12)' : '#252b3b',
                                    cursor: 'pointer',
                                    display: 'flex',
                                    flexDirection: 'column',
                                    alignItems: 'center',
                                    gap: 5,
                                    transition: 'all 0.15s',
                                }}
                            >
                                {/* Visual width preview */}
                                <div
                                    style={{
                                        width: 34,
                                        height: opt.value,
                                        background: localWidth === opt.value ? '#4a9eff' : '#9ca3af',
                                        borderRadius: opt.value > 1 ? 1 : 0,
                                    }}
                                />
                                <span style={{ fontSize: 12, fontWeight: 400, color: localWidth === opt.value ? '#4a9eff' : '#6b7280' }}>
                                    {opt.label}
                                </span>
                            </button>
                        ))}
                    </div>

                    {/* Custom width slider */}
                    <div style={{ padding: '0 12px 12px' }}>
                        <div style={{ fontSize: 12, fontWeight: 400, color: '#6b7280', marginBottom: 4 }}>
                            {tr("Custom: ")}<span style={{ color: '#c8ccd4' }}>{localWidth}{tr("px")}</span>
                        </div>
                        <input
                            type="range"
                            min={1}
                            max={8}
                            step={1}
                            value={localWidth}
                            onChange={e => applyChanges({ lineWidth: parseInt(e.target.value) })}
                            style={{ width: '100%', accentColor: '#4a9eff' }}
                        />
                    </div>
                </div>
            )}
        </div>
    );
};

// ─── Styles ───────────────────────────────────────────────────────────────────
const menuStyle: React.CSSProperties = {
    background: '#1a1f2e',
    border: '1px solid #2d3548',
    borderRadius: 6,
    boxShadow: '0 8px 32px rgba(0,0,0,0.7), 0 0 1px rgba(255,255,255,0.05)',
    padding: '4px 0',
    minWidth: 230,
    fontFamily: "'Segoe UI', Tahoma, sans-serif",
    fontSize: 14,
    fontWeight: 400,
};

const subPanelStyle: React.CSSProperties = {
    background: '#1a1f2e',
    border: '1px solid #2d3548',
    borderRadius: 6,
    boxShadow: '0 8px 32px rgba(0,0,0,0.7)',
    minWidth: 220,
    fontFamily: "'Segoe UI', Tahoma, sans-serif",
    fontSize: 14,
    fontWeight: 400,
    marginLeft: 2,
    padding: '4px 0',
};

const headerStyle: React.CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '5px 10px 4px',
};

const subHeaderStyle: React.CSSProperties = {
    fontSize: 12,
    fontWeight: 500,
    letterSpacing: '0.08em',
    textTransform: 'uppercase' as const,
    color: '#4b5563',
    padding: '8px 12px 5px',
};

// ─── MenuItem ────────────────────────────────────────────────────────────────
interface MenuItemProps {
    icon?: React.ReactNode;
    label: string;
    shortcut?: string;
    onClick: () => void;
    danger?: boolean;
    disabled?: boolean;
    active?: boolean;
}

const MenuItem: React.FC<MenuItemProps> = ({ icon, label, shortcut, onClick, danger, disabled, active }) => { const tr = useUiTranslation(); return ((
    <div
        onClick={e => { e.stopPropagation(); if (!disabled) onClick(); }}
        style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            padding: '5px 10px 5px 8px',
            minHeight: 30,
            fontWeight: 400,
            cursor: disabled ? 'default' : 'pointer',
            opacity: disabled ? 0.4 : 1,
            color: active ? '#4a9eff' : danger ? '#ef6b6b' : '#c8ccd4',
            transition: 'background 0.1s',
            background: active ? 'rgba(74,158,255,0.08)' : 'transparent',
        }}
        onMouseEnter={e => { if (!disabled) e.currentTarget.style.background = '#252b3b'; }}
        onMouseLeave={e => { e.currentTarget.style.background = active ? 'rgba(74,158,255,0.08)' : 'transparent'; }}
    >
        <span style={{ width: 18, height: 18, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
            {icon || null}
        </span>
        <span style={{ flex: 1, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {tr(label)}
        </span>
        {shortcut && (
            <span style={{ fontSize: 12, fontWeight: 400, color: '#4b5563', marginLeft: 16, whiteSpace: 'nowrap' }}>
                {shortcut}
            </span>
        )}
    </div>
)); };

// ─── Separator ───────────────────────────────────────────────────────────────
const Separator = () => (
    <div style={{ height: 1, background: '#2d3548', margin: '3px 0' }} />
);

// ─── Check icon ──────────────────────────────────────────────────────────────
const CheckIcon = ({ style }: { style?: React.CSSProperties }) => (
    <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="#4a9eff" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={style}>
        <polyline points="2 6.5 4.5 9 10 3" />
    </svg>
);

// ─── SVG Icons ───────────────────────────────────────────────────────────────
const ColorIcon = ({ color }: { color: string }) => (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
        <circle cx="8" cy="8" r="6" fill={color} stroke="rgba(255,255,255,0.2)" strokeWidth="1" />
        <path d="M8 3v2M8 11v2M3 8h2M11 8h2" stroke="rgba(255,255,255,0.5)" strokeWidth="1" strokeLinecap="round" />
    </svg>
);

const LineStyleIcon = () => (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="#9ca3af" strokeWidth="1.3" strokeLinecap="round">
        <line x1="2" y1="4" x2="14" y2="4" />
        <line x1="2" y1="8" x2="14" y2="8" strokeDasharray="3 2" />
        <line x1="2" y1="12" x2="14" y2="12" strokeDasharray="1.5 2" />
    </svg>
);

const DeleteThisIcon = () => (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="#ef6b6b" strokeWidth="1.3" strokeLinecap="round">
        <polyline points="4 3 4 13 12 13 12 3" />
        <line x1="2" y1="3" x2="14" y2="3" />
        <line x1="6.5" y1="1.5" x2="9.5" y2="1.5" />
        <line x1="7" y1="6" x2="7" y2="11" />
        <line x1="9" y1="6" x2="9" y2="11" />
    </svg>
);

const DeleteAllIcon = () => (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="#ef6b6b" strokeWidth="1.3">
        <circle cx="5.5" cy="5.5" r="3" />
        <path d="M4 4l3 3M7 4l-3 3" strokeLinecap="round" />
        <circle cx="10.5" cy="10.5" r="3" />
        <path d="M9 9l3 3M12 9l-3 3" strokeLinecap="round" />
    </svg>
);

const DeleteSelectedIcon = () => (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="#ef6b6b" strokeWidth="1.3">
        <rect x="2" y="2" width="12" height="12" rx="1" strokeDasharray="3 2" />
        <path d="M5 5l6 6M11 5l-6 6" strokeLinecap="round" />
    </svg>
);

const ObjectListIcon = () => (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="#4a9eff" strokeWidth="1.3" strokeLinecap="round">
        <path d="M2 4h12M2 8h12M2 12h8" />
        <circle cx="13" cy="12" r="1.5" fill="#4a9eff" stroke="none" />
    </svg>
);

const UndoIcon = () => (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="#9ca3af" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round">
        <path d="M4 7h6a3 3 0 010 6H8" />
        <path d="M7 4L4 7l3 3" />
    </svg>
);
