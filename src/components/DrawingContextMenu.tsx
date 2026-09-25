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
 *  - Continuous color picker with live drawing preview and color values
 *  - Line style (solid / dashed / dotted)
 *  - Line width (thin=1 / normal=2 / thick=4 presets)
 */

import React, { useEffect, useLayoutEffect, useState, useRef, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { useFloatingPanelDrag } from '../hooks/useFloatingPanelDrag';
import { drawingManager } from '../services/drawingManager';
import type { Drawing, DrawingType } from '../services/drawingManager';
import { DrawingColorPicker } from './ui/DrawingColorPicker';
import './DrawingContextMenu.css';

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
    contextId?: string;
}

type SubPanel = null | 'color' | 'style';

interface DrawingMenuState {
    x: number;
    y: number;
    drawingId: string;
    contextId?: string;
}

export const DrawingContextMenu: React.FC<DrawingContextMenuProps> = ({ onClose, contextId }) => {
    const tr = useUiTranslation();
    const [menuState, setMenuState] = useState<DrawingMenuState | null>(null);
    const [subPanel, setSubPanel] = useState<SubPanel>(null);

    // Local copies of drawing properties for the style sub-panel
    const [localColor, setLocalColor] = useState('#4a9eff');
    const [localStyle, setLocalStyle] = useState<LineStyleOption>('solid');
    const [localWidth, setLocalWidth] = useState<number>(2);
    const menuRef = useRef<HTMLDivElement>(null);
    const { isDragging, dragHandleProps, cancelDrag } = useFloatingPanelDrag(menuRef, (position) => {
        setMenuState(current => current ? { ...current, ...position } : current);
    });
    const pendingColor = useRef<{ drawing: Drawing; originalColor: Drawing['color']; contextId?: string } | null>(null);
    const [viewport, setViewport] = useState(() => ({ width: window.innerWidth, height: window.innerHeight }));
    const [menuHeight, setMenuHeight] = useState(340);

    const commitColor = useCallback(() => {
        const pending = pendingColor.current;
        if (!pending) return;
        pendingColor.current = null;
        const color = pending.drawing.color;
        // Restore the starting color so the normal update records one undo step.
        pending.drawing.color = pending.originalColor;
        drawingManager.updateDrawingProperties(pending.drawing.id, { color }, pending.contextId);
    }, []);

    useEffect(() => {
        const resize = () => setViewport({ width: window.innerWidth, height: window.innerHeight });
        window.addEventListener('resize', resize);
        return () => window.removeEventListener('resize', resize);
    }, []);

    useLayoutEffect(() => {
        if (!menuRef.current) return;
        const measure = () => setMenuHeight(menuRef.current?.getBoundingClientRect().height ?? 340);
        measure();
        if (typeof ResizeObserver === 'undefined') return;
        const observer = new ResizeObserver(measure);
        observer.observe(menuRef.current);
        return () => observer.disconnect();
    }, [menuState, subPanel, viewport]);

    useEffect(() => {
        const handleContextMenu = (event: Event) => {
            const e = event as CustomEvent<DrawingMenuState>;
            cancelDrag();
            commitColor();
            if (contextId && e.detail.contextId !== contextId) {
                setMenuState(null);
                setSubPanel(null);
                return;
            }
            const drawing = drawingManager.getDrawings(e.detail.contextId).find(d => d.id === e.detail.drawingId);
            // Pre-populate local state from the drawing
            setLocalColor(drawing?.color || '#4a9eff');
            setLocalStyle((drawing?.lineStyle as LineStyleOption) || 'solid');
            setLocalWidth(drawing?.lineWidth || 2);
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
                cancelDrag();
                commitColor();
                setMenuState(null);
                setSubPanel(null);
            }
        };

        window.addEventListener('drawing:contextmenu', handleContextMenu);
        window.addEventListener('mousedown', handleClickOutside);
        return () => {
            commitColor();
            window.removeEventListener('drawing:contextmenu', handleContextMenu);
            window.removeEventListener('mousedown', handleClickOutside);
        };
    }, [contextId, commitColor, cancelDrag]);

    if (!menuState) return null;

    const allDrawings = drawingManager.getDrawings(menuState.contextId);
    const currentDrawing = allDrawings.find(d => d.id === menuState.drawingId);
    const selectedCount = allDrawings.filter(d => d.selected).length;

    const shortId = currentDrawing?.id ? currentDrawing.id.replace('d-', '').slice(-5) : '';
    const drawingLabel = currentDrawing
        ? getDrawingTypeName(currentDrawing.type)
        : 'Drawing';

    const close = () => {
        cancelDrag();
        commitColor();
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
        drawingManager.deleteDrawing(menuState.drawingId, menuState.contextId);
        close();
    };

    const handleDeleteSelected = () => {
        drawingManager.deleteSelected(menuState.contextId);
        close();
    };

    const handleDeleteAllShapes = () => {
        drawingManager.getDrawings(menuState.contextId).forEach(drawing => {
            drawingManager.deleteDrawing(drawing.id, menuState.contextId);
        });
        close();
    };

    const handleSelectAll = () => {
        commitColor();
        drawingManager.selectAll(menuState.contextId);
        // Refresh selection-dependent actions while keeping the menu available.
        setMenuState(current => current ? { ...current } : current);
    };

    const handleUnselectAll = () => {
        drawingManager.unselectAll(menuState.contextId);
        close();
    };

    const handleUnselect = () => {
        if (currentDrawing) drawingManager.unselectDrawing(currentDrawing.id, menuState.contextId);
        close();
    };

    const handleUndoDelete = () => {
        drawingManager.undo(menuState.contextId);
        close();
    };

    // ── Screen position clamping ──────────────────────────────────────────────
    const panelWidth = subPanel === 'color' ? 360 : 240;
    const stacked = Boolean(subPanel) && viewport.width < 230 + panelWidth + 18;
    const menuW = Math.min(stacked ? panelWidth : 230 + (subPanel ? panelWidth + 2 : 0), viewport.width - 16);
    const pixelScale = window.devicePixelRatio || 1;
    const menuX = Math.round(Math.max(8, Math.min(menuState.x, viewport.width - menuW - 8)) * pixelScale) / pixelScale;
    const menuY = Math.round(Math.max(8, Math.min(menuState.y, viewport.height - menuHeight - 8)) * pixelScale) / pixelScale;

    const previewColor = (color: string) => {
        if (!currentDrawing) return;
        pendingColor.current ??= { drawing: currentDrawing, originalColor: currentDrawing.color, contextId: menuState.contextId };
        currentDrawing.color = color;
        setLocalColor(color);
        drawingManager.renderAllDrawings();
    };

    const togglePanel = (panel: Exclude<SubPanel, null>) => {
        commitColor();
        setSubPanel(subPanel === panel ? null : panel);
    };

    return createPortal(
        <div
            ref={menuRef}
            data-testid="drawing-context-menu"
            className="drawing-context-menu fixed z-[9999] flex"
            style={{ left: menuX, top: menuY, width: menuW, maxHeight: viewport.height - 16, overflowY: 'auto', flexDirection: stacked ? 'column' : 'row', alignItems: 'flex-start', gap: 2 }}
            onClick={e => e.stopPropagation()}
            onPointerDown={e => e.stopPropagation()}
            onMouseDown={e => e.stopPropagation()}
            onKeyDown={e => { e.stopPropagation(); if (e.key === 'Escape') close(); }}
        >
            {/* ── Primary context menu ─────────────────────────────────────── */}
            <div className="rtx-menu-surface" style={{ ...menuStyle, width: stacked ? '100%' : 230, minWidth: 0, flexShrink: 0 }}>
                {/* Header */}
                <div
                    data-testid="drawing-context-menu-drag-handle"
                    style={{ ...headerStyle, cursor: isDragging ? 'grabbing' : 'grab', touchAction: 'none', userSelect: 'none' }}
                    {...dragHandleProps}
                >
                    <span style={{ color: 'var(--text-primary)', fontSize: 12, fontWeight: 500 }}>{drawingLabel}</span>
                    {shortId && <span style={{ color: 'var(--text-secondary)', fontSize: 12, fontWeight: 400 }}>#{shortId}</span>}
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

                {/* ─── Delete all drawings in this chart ─── */}
                <MenuItem
                    icon={<DeleteAllIcon />}
                    label={tr("Delete All Shapes")}
                    onClick={handleDeleteAllShapes}
                    danger
                />

                <Separator />

                {/* ─── Change Color ─── */}
                <MenuItem
                    icon={<ColorIcon color={localColor} />}
                    label={tr("Change Color")}
                    shortcut="›"
                    onClick={() => togglePanel('color')}
                    active={subPanel === 'color'}
                />

                {/* ─── Line Style ─── */}
                <MenuItem
                    icon={<LineStyleIcon />}
                    label={tr("Line Style & Width")}
                    shortcut="›"
                    onClick={() => togglePanel('style')}
                    active={subPanel === 'style'}
                />

                <Separator />

                {/* ─── Unselect ─── */}
                <MenuItem label={tr("Select All")} onClick={handleSelectAll} />
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
                <div style={{ width: stacked ? '100%' : panelWidth, flexShrink: 0 }}>
                    <DrawingColorPicker
                        key={menuState.drawingId}
                        value={localColor}
                        onChange={previewColor}
                        onChangeComplete={commitColor}
                    />
                </div>
            )}
            {/* ── Line Style Sub-Panel ─────────────────────────────────────── */}
            {subPanel === 'style' && (
                <div className="rtx-menu-surface" style={{ ...subPanelStyle, width: stacked ? '100%' : panelWidth, minWidth: 0, flexShrink: 0, marginLeft: 0 }}>
                    {/* Line Style */}
                    <div style={subHeaderStyle}>{tr("Line Style")}</div>
                    <div style={{ padding: '0 12px 10px', display: 'flex', flexDirection: 'column', gap: 4 }}>
                        {LINE_STYLES.map(opt => (
                            <button
                                key={opt.value}
                                className="drawing-context-menu__option"
                                aria-pressed={localStyle === opt.value}
                                onClick={() => applyChanges({ lineStyle: opt.value })}
                                style={{
                                    display: 'flex',
                                    alignItems: 'center',
                                    gap: 10,
                                    padding: '5px 8px',
                                    borderRadius: 4,
                                    border: localStyle === opt.value
                                        ? '1.5px solid var(--color-primary)'
                                        : '1.5px solid transparent',
                                    background: localStyle === opt.value ? 'var(--ctx-item-active-bg, var(--color-primary-dimmer))' : 'transparent',
                                    cursor: 'pointer',
                                    color: localStyle === opt.value ? 'var(--ctx-item-active-fg, var(--text-primary))' : 'var(--text-secondary)',
                                    width: '100%',
                                    textAlign: 'left',
                                    transition: 'all 0.15s',
                                }}
                                onMouseEnter={e => {
                                    if (localStyle !== opt.value) {
                                        e.currentTarget.style.background = 'var(--bg-quaternary)';
                                    }
                                }}
                                onMouseLeave={e => {
                                    if (localStyle !== opt.value) {
                                        e.currentTarget.style.background = 'transparent';
                                    }
                                }}
                            >
                                <span style={{ color: 'inherit' }}>
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
                                className="drawing-context-menu__option"
                                aria-pressed={localWidth === opt.value}
                                onClick={() => applyChanges({ lineWidth: opt.value })}
                                title={opt.label}
                                style={{
                                    flex: 1,
                                    padding: '7px 4px',
                                    borderRadius: 4,
                                    border: localWidth === opt.value
                                        ? '1.5px solid var(--color-primary)'
                                        : '1.5px solid var(--border-secondary)',
                                    background: localWidth === opt.value ? 'var(--ctx-item-active-bg, var(--color-primary-dimmer))' : 'var(--bg-quaternary)',
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
                                        background: localWidth === opt.value ? 'var(--ctx-item-active-fg, var(--text-primary))' : 'var(--text-secondary)',
                                        borderRadius: opt.value > 1 ? 1 : 0,
                                    }}
                                />
                                <span style={{ fontSize: 12, fontWeight: 400, color: localWidth === opt.value ? 'var(--ctx-item-active-fg, var(--text-primary))' : 'var(--text-secondary)' }}>
                                    {opt.label}
                                </span>
                            </button>
                        ))}
                    </div>

                    {/* Custom width slider */}
                    <div style={{ padding: '0 12px 12px' }}>
                        <div style={{ fontSize: 12, fontWeight: 400, color: 'var(--text-secondary)', marginBottom: 4 }}>
                            {tr("Custom: ")}<span style={{ color: 'var(--text-primary)' }}>{localWidth}{tr("px")}</span>
                        </div>
                        <input
                            className="drawing-context-menu__width-slider"
                            aria-label={tr('Line Width')}
                            type="range"
                            min={1}
                            max={8}
                            step={1}
                            value={localWidth}
                            onChange={e => applyChanges({ lineWidth: parseInt(e.target.value) })}
                            style={{ width: '100%', accentColor: 'var(--color-primary)' }}
                        />
                    </div>
                </div>
            )}
        </div>,
        document.body,
    );
};

// ─── Styles ───────────────────────────────────────────────────────────────────
const menuStyle: React.CSSProperties = {
    background: 'var(--bg-secondary)',
    border: '1px solid var(--border-secondary)',
    borderRadius: 6,
    boxShadow: 'var(--shadow-xl)',
    padding: '4px 0',
    minWidth: 230,
    fontFamily: 'var(--font-sans)',
    fontSize: 14,
    fontWeight: 400,
};

const subPanelStyle: React.CSSProperties = {
    background: 'var(--bg-secondary)',
    border: '1px solid var(--border-secondary)',
    borderRadius: 6,
    boxShadow: 'var(--shadow-xl)',
    minWidth: 220,
    fontFamily: 'var(--font-sans)',
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
    color: 'var(--text-secondary)',
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
            color: active ? 'var(--ctx-item-active-fg, var(--text-primary))' : danger ? 'var(--color-loss)' : 'var(--text-primary)',
            transition: 'background 0.1s',
            background: active ? 'var(--ctx-item-active-bg, var(--color-primary-dimmer))' : 'transparent',
        }}
        onMouseEnter={e => { if (!disabled) e.currentTarget.style.background = 'var(--bg-quaternary)'; }}
        onMouseLeave={e => { e.currentTarget.style.background = active ? 'var(--ctx-item-active-bg, var(--color-primary-dimmer))' : 'transparent'; }}
    >
        <span style={{ width: 18, height: 18, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
            {icon || null}
        </span>
        <span style={{ flex: 1, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {tr(label)}
        </span>
        {shortcut && (
            <span style={{ fontSize: 12, fontWeight: 400, color: 'var(--text-secondary)', marginLeft: 16, whiteSpace: 'nowrap' }}>
                {shortcut}
            </span>
        )}
    </div>
)); };

// ─── Separator ───────────────────────────────────────────────────────────────
const Separator = () => (
    <div style={{ height: 1, background: 'var(--border-primary)', margin: '3px 0' }} />
);

// ─── Check icon ──────────────────────────────────────────────────────────────
const CheckIcon = ({ style }: { style?: React.CSSProperties }) => (
    <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={style}>
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
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round">
        <line x1="2" y1="4" x2="14" y2="4" />
        <line x1="2" y1="8" x2="14" y2="8" strokeDasharray="3 2" />
        <line x1="2" y1="12" x2="14" y2="12" strokeDasharray="1.5 2" />
    </svg>
);

const DeleteThisIcon = () => (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round">
        <polyline points="4 3 4 13 12 13 12 3" />
        <line x1="2" y1="3" x2="14" y2="3" />
        <line x1="6.5" y1="1.5" x2="9.5" y2="1.5" />
        <line x1="7" y1="6" x2="7" y2="11" />
        <line x1="9" y1="6" x2="9" y2="11" />
    </svg>
);

const DeleteAllIcon = () => (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3">
        <circle cx="5.5" cy="5.5" r="3" />
        <path d="M4 4l3 3M7 4l-3 3" strokeLinecap="round" />
        <circle cx="10.5" cy="10.5" r="3" />
        <path d="M9 9l3 3M12 9l-3 3" strokeLinecap="round" />
    </svg>
);

const DeleteSelectedIcon = () => (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3">
        <rect x="2" y="2" width="12" height="12" rx="1" strokeDasharray="3 2" />
        <path d="M5 5l6 6M11 5l-6 6" strokeLinecap="round" />
    </svg>
);

const UndoIcon = () => (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round">
        <path d="M4 7h6a3 3 0 010 6H8" />
        <path d="M7 4L4 7l3 3" />
    </svg>
);
