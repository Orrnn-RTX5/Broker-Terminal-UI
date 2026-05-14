/**
 * MT5-Style Chart Right-Click Context Menu
 * Full-featured, themed to match project dark theme
 */

import React, { useState, useEffect, useRef, useCallback } from 'react';
import ReactDOM from 'react-dom';
import type { ChartType, Timeframe } from './TradingChart';
import { indicatorManager } from '../services/indicatorManager';
import { useTemplates, useTemplateStore } from '../store/useTemplateStore';
import type { ChartTemplate } from '../store/useTemplateStore';
import {
    CandlestickChart, BarChart2, LineChart, ZoomIn, ZoomOut,
    Grid3X3, RefreshCw, Camera, Settings, ChevronRight,
    Activity, Crosshair, AlignJustify, Volume2, Layers,
    Save, FolderOpen, Trash2, FileText, TrendingUp,
    ArrowUpDown, Type, Shapes, MoveHorizontal, MoveVertical,
} from 'lucide-react';

interface ChartContextMenuProps {
    visible: boolean;
    x: number;
    y: number;
    symbol: string;
    currentChartType: ChartType;
    currentTimeframe: Timeframe;
    oneClickTrading?: boolean;
    showGrid?: boolean;
    showVolumes?: boolean;
    autoScroll?: boolean;
    chartShift?: boolean;
    onChangeChartType: (type: ChartType) => void;
    onChangeTimeframe: (tf: Timeframe) => void;
    onToggleOneClickTrading: () => void;
    onToggleGrid: () => void;
    onToggleVolumes: () => void;
    onToggleAutoScroll: () => void;
    onToggleChartShift: () => void;
    onOpenProperties: () => void;
    onSaveAsPicture: () => void;
    onPrintChart: () => void;
    onRefresh: () => void;
    onZoomIn: () => void;
    onZoomOut: () => void;
    onDeleteIndicators: () => void;
    onOpenNewOrder: () => void;
    onOpenDOM: () => void;
    onOpenTemplateDialog: (mode: 'save' | 'load') => void;
    onClose: () => void;
    onLoadTemplate?: (template: ChartTemplate) => void;
    currentIndicators?: any[];
    currentDrawingTools?: any[];
}

// ─── CSS variables injected once ─────────────────────────────────────────────
const MENU_FONT = "'Inter', 'Segoe UI', system-ui, -apple-system, sans-serif";
const C_BG         = 'var(--ctx-bg, rgba(19, 19, 22, 0.85))';
const C_BORDER     = 'var(--ctx-border, rgba(255, 255, 255, 0.08))';
const C_HOVER      = 'var(--ctx-hover, rgba(255, 255, 255, 0.06))';
const C_ACTIVE_BG  = 'var(--ctx-active-bg, rgb(59, 130, 246))';
const C_ACTIVE_FG  = 'var(--ctx-active-fg, #ffffff)';
const C_ITEM_ACTIVE_BG = 'var(--ctx-item-active-bg, rgba(59, 130, 246, 0.15))';
const C_ITEM_ACTIVE_FG = 'var(--ctx-item-active-fg, #60a5fa)';
const C_TEXT       = 'var(--ctx-text, #e4e4e7)';
const C_MUTED      = 'var(--ctx-muted, #71717a)';
const C_HEADER     = 'var(--ctx-header, #a1a1aa)';
const C_DISABLED   = 'var(--ctx-disabled, rgba(161, 161, 170, 0.3))';

// ─── Keyboard shortcut label ──────────────────────────────────────────────────
const Shortcut = ({ keys }: { keys: string }) => (
    <span style={{
        marginLeft: 'auto',
        paddingLeft: 20,
        fontSize: 11,
        fontFamily: MENU_FONT,
        letterSpacing: '0.03em',
        color: C_HEADER,
        flexShrink: 0,
        opacity: 0.85,
    }}>
        {keys}
    </span>
);

// ─── Separator ────────────────────────────────────────────────────────────────
const MenuSeparator = () => (
    <div style={{ height: 1, background: C_BORDER, margin: '2px 0' }} />
);

// ─── Single menu item ─────────────────────────────────────────────────────────
interface MenuItemProps {
    icon?: React.ReactNode;
    label: string;
    shortcut?: string;
    onClick?: () => void;
    hasSubmenu?: boolean;
    active?: boolean;
    checked?: boolean;
    disabled?: boolean;
    highlight?: boolean; // red highlight like "Sell Limit"
}

const MenuItem = React.forwardRef<HTMLDivElement, MenuItemProps>((
    { icon, label, shortcut, onClick, hasSubmenu, active, checked, disabled }
, ref) => {
    const bg   = active  ? C_ITEM_ACTIVE_BG : 'transparent';
    const fg   = disabled ? C_DISABLED : active ? C_ITEM_ACTIVE_FG : C_TEXT;

    return (
        <div
            ref={ref}
            style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                padding: '3px 14px 3px 12px',
                minHeight: 24,
                fontSize: 12,
                lineHeight: '16px',
                fontFamily: MENU_FONT,
                fontWeight: 450,
                letterSpacing: '0.015em',
                color: fg,
                background: bg,
                cursor: disabled ? 'default' : 'pointer',
                userSelect: 'none',
                pointerEvents: disabled ? 'none' : undefined,
                transition: 'all 0.15s cubic-bezier(0.4, 0, 0.2, 1)',
            }}
            onMouseEnter={e => { if (!active) (e.currentTarget as HTMLDivElement).style.background = C_HOVER; }}
            onMouseLeave={e => { (e.currentTarget as HTMLDivElement).style.background = active ? C_ITEM_ACTIVE_BG : 'transparent'; }}
            onClick={e => { e.stopPropagation(); if (!disabled && onClick) onClick(); }}
        >
            {/* Icon / Checkmark column — fixed 18px */}
            <span style={{ width: 18, height: 18, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', opacity: disabled ? 0.3 : 1 }}>
                {checked !== undefined && !icon ? (
                    checked ? (
                        <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke={C_ITEM_ACTIVE_FG} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                            <polyline points="2 6.5 4.5 9 10 3" />
                        </svg>
                    ) : null
                ) : icon ? icon : null}
            </span>

            <span style={{ flex: 1, whiteSpace: 'nowrap' }}>{label}</span>

            {shortcut && <Shortcut keys={shortcut} />}
            {hasSubmenu && (
                <ChevronRight size={13} style={{ color: C_HEADER, flexShrink: 0, marginLeft: shortcut ? 6 : 'auto', opacity: 0.85 }} />
            )}
        </div>
    );
});
MenuItem.displayName = 'MenuItem';

// ─── Submenu wrapper ──────────────────────────────────────────────────────────
const Submenu = ({ children, label, icon, disabled }: {
    children: React.ReactNode;
    label: string;
    icon?: React.ReactNode;
    disabled?: boolean;
}) => {
    const [open, setOpen] = useState(false);
    const ref = useRef<HTMLDivElement>(null);
    const [submenuStyle, setSubmenuStyle] = useState<React.CSSProperties>({ left: '100%', top: 0 });

    const calcPosition = useCallback(() => {
        if (!ref.current) return;
        const rect = ref.current.getBoundingClientRect();
        const vw = window.innerWidth;
        const vh = window.innerHeight;
        const submenuWidth = 190;
        const submenuHeight = 320;

        let left: string | number = '100%';
        let right: string | number = 'auto';
        let top: number = 0;

        if (rect.right + submenuWidth > vw) { left = 'auto'; right = '100%'; }
        if (rect.top + submenuHeight > vh) { top = Math.max(0, vh - submenuHeight - rect.top); }

        setSubmenuStyle({ left, right, top });
    }, []);

    return (
        <div
            ref={ref}
            style={{ position: 'relative' }}
            onMouseEnter={() => { calcPosition(); setOpen(true); }}
            onMouseLeave={() => setOpen(false)}
        >
            <div
                style={{
                    display: 'flex', alignItems: 'center', gap: 8,
                    padding: '3px 14px 3px 12px', minHeight: 24,
                    fontSize: 12, lineHeight: '16px',
                    fontFamily: MENU_FONT, fontWeight: 450, letterSpacing: '0.015em',
                    color: disabled ? C_DISABLED : open ? C_ACTIVE_FG : C_TEXT,
                    background: open ? C_ACTIVE_BG : 'transparent',
                    cursor: disabled ? 'default' : 'pointer',
                    userSelect: 'none',
                    pointerEvents: disabled ? 'none' : undefined,
                    transition: 'all 0.15s cubic-bezier(0.4, 0, 0.2, 1)',
                }}
            >
                <span style={{ width: 18, height: 18, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    {icon}
                </span>
                <span style={{ flex: 1, whiteSpace: 'nowrap' }}>{label}</span>
                <ChevronRight size={13} style={{ color: open ? C_ACTIVE_FG : C_HEADER, flexShrink: 0, opacity: 0.85 }} />
            </div>

            {open && (
                <div
                    style={{
                        position: 'absolute',
                        zIndex: 10002,
                        padding: '4px 0',
                        minWidth: 200,
                        background: C_BG,
                        backdropFilter: 'blur(16px) saturate(180%)',
                        border: `1px solid ${C_BORDER}`,
                        borderRadius: 8,
                        boxShadow: 'var(--ctx-shadow, 0 12px 40px rgba(0,0,0,0.6))',
                        ...submenuStyle,
                    }}
                >
                    {children}
                </div>
            )}
        </div>
    );
};

// ─── Main Context Menu ────────────────────────────────────────────────────────
export const ChartContextMenu: React.FC<ChartContextMenuProps> = ({
    visible,
    x,
    y,
    symbol,
    currentChartType,
    currentTimeframe,
    oneClickTrading = false,
    showGrid = true,
    showVolumes = true,
    autoScroll = false,
    chartShift = false,
    onChangeChartType,
    onChangeTimeframe,
    onToggleOneClickTrading,
    onToggleGrid,
    onToggleVolumes,
    onToggleAutoScroll,
    onToggleChartShift,
    onOpenProperties,
    onSaveAsPicture,
    onPrintChart,
    onRefresh,
    onZoomIn,
    onZoomOut,
    onDeleteIndicators,
    onOpenNewOrder,
    onOpenDOM,
    onOpenTemplateDialog,
    onClose,
    onLoadTemplate,
    currentIndicators = [],
    currentDrawingTools = [],
}) => {
    const templates = useTemplates();
    const menuRef = useRef<HTMLDivElement>(null);

    // ── Synchronous position clamping (no RAF, no jump) ──
    // Use known approximate menu dimensions so we can clamp in one render pass
    const MENU_W = 228;
    const MENU_H = 460;
    const clampedX = Math.min(x, window.innerWidth  - MENU_W - 4);
    const clampedY = Math.min(y, window.innerHeight - MENU_H - 4);

    // ── Close on Escape ──
    useEffect(() => {
        if (!visible) return;
        const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
        window.addEventListener('keydown', handler);
        return () => window.removeEventListener('keydown', handler);
    }, [visible, onClose]);

    // ── Close on wheel (native window listener) ──
    // IMPORTANT: Must be a native window listener — NOT a React synthetic event on a child element.
    // The chart's wheel handler calls e.stopPropagation() at the window capture level, which
    // prevents the event from reaching any DOM elements below (body/backdrop). But since
    // stopPropagation() does NOT affect OTHER listeners on the SAME element (window),
    // this listener fires regardless — chart scrolls AND the menu closes.
    useEffect(() => {
        if (!visible) return;
        const handler = () => onClose();
        window.addEventListener('wheel', handler, { passive: true, capture: false });
        return () => window.removeEventListener('wheel', handler, { capture: false } as EventListenerOptions);
    }, [visible, onClose]);

    if (!visible) return null;

    const timeframes: Timeframe[] = ['M1', 'M5', 'M15', 'M30', 'H1', 'H4', 'D1', 'W1', 'MN'];

    const indicators = [
        { name: 'Moving Average (SMA)', type: 'sma' },
        { name: 'Exponential MA (EMA)', type: 'ema' },
        { name: 'Bollinger Bands', type: 'bb' },
        { name: 'RSI', type: 'rsi' },
        { name: 'MACD', type: 'macd' },
        { name: 'Stochastic', type: 'stochastic' },
        { name: 'CCI', type: 'cci' },
        { name: 'Momentum', type: 'momentum' },
        { name: 'ATR', type: 'atr' },
        { name: 'Williams %R', type: 'williams' },
    ];

    const drawingTools = [
        { name: 'Trend Line', tool: 'trendline', icon: <MoveHorizontal size={12} /> },
        { name: 'Horizontal Line', tool: 'hline', icon: <MoveHorizontal size={12} /> },
        { name: 'Vertical Line', tool: 'vline', icon: <MoveVertical size={12} /> },
        { name: 'Fibonacci Retracement', tool: 'fibonacci', icon: <Activity size={12} /> },
        { name: 'Equidistant Channel', tool: 'channel', icon: <AlignJustify size={12} /> },
        { name: 'Text / Annotation', tool: 'text', icon: <Type size={12} /> },
        { name: 'Rectangle', tool: 'rectangle', icon: <Shapes size={12} /> },
    ];

    const handleAddIndicator = (type: string) => {
        const id = `${type}-${Date.now()}`;
        indicatorManager.addIndicator({ id, name: type.toUpperCase(), type, parameters: {}, visible: true });
        onClose();
    };

    const handleSelectDrawingTool = (tool: string) => {
        window.dispatchEvent(new CustomEvent('drawing:select-tool', { detail: { tool } }));
        onClose();
    };

    const handleOpenSaveTemplate = () => {
        onOpenTemplateDialog('save');
        onClose();
    };

    const handleOpenLoadTemplate = () => {
        onOpenTemplateDialog('load');
        onClose();
    };

    const handleTemplateLoad = (template: ChartTemplate) => {
        if (onLoadTemplate) onLoadTemplate(template);
    };

    const { deleteTemplate } = useTemplateStore.getState();

    const handleTemplateDelete = (id: string, name: string) => {
        if (confirm(`Delete template "${name}"?`)) {
            deleteTemplate(id);
        }
    };

    const currentConfig = {
        chartType: currentChartType,
        timeframe: currentTimeframe,
        showGrid,
        showVolumes,
        indicators: currentIndicators,
        drawingTools: currentDrawingTools,
        colors: { background: '#0e0e12', grid: '#222226', candle: { up: '#00c896', down: '#ff4d4f', border: '#378658' }, volume: { up: '#00c896', down: '#ff4d4f' } },
    };

    const menuContent = (
        <div
            ref={menuRef}
            style={{
                position: 'fixed',
                zIndex: 10000,
                top: clampedY,
                left: clampedX,
                minWidth: 230,
                padding: '4px 0',
                background: C_BG,
                backdropFilter: 'blur(16px) saturate(180%)',
                border: `1px solid ${C_BORDER}`,
                borderRadius: 10,
                boxShadow: 'var(--ctx-shadow, 0 16px 64px rgba(0,0,0,0.5), 0 0 0 1px rgba(255,255,255,0.08))',
                fontFamily: MENU_FONT,
                overflow: 'visible',
            }}
            onContextMenu={(e) => e.preventDefault()}
        >
            {/* ── Header: symbol name ── */}
            <div style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                padding: '5px 14px 5px 12px',
                fontSize: 10,
                fontWeight: 700,
                letterSpacing: '0.12em',
                textTransform: 'uppercase',
                color: C_HEADER,
                borderBottom: `1px solid ${C_BORDER}`,
                marginBottom: 2,
            }}>
                <div style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--ctx-active-bg, #3b82f6)', boxShadow: '0 0 8px var(--ctx-active-bg, rgba(59,130,246,0.6))' }} />
                {symbol}
            </div>

            {/* ── New Order (highlighted) ── */}
            <MenuItem
                icon={<FileText size={13} strokeWidth={1.5} style={{ color: 'var(--ctx-red, #ff4d4f)' }} />}
                label="New Order"
                shortcut="F9"
                highlight={false}
                onClick={() => { onOpenNewOrder(); onClose(); }}
            />

            {/* ── Trading submenu ── */}
            <Submenu
                label="Trading"
                icon={<TrendingUp size={13} strokeWidth={1.5} style={{ color: 'var(--ctx-blue, #74b9ff)' }} />}
            >
                <MenuItem label="Buy Market" onClick={() => { window.dispatchEvent(new CustomEvent('quickTrade', { detail: { side: 'BUY', symbol } })); onClose(); }} />
                <MenuItem label="Sell Market" onClick={() => { window.dispatchEvent(new CustomEvent('quickTrade', { detail: { side: 'SELL', symbol } })); onClose(); }} />
                <MenuSeparator />
                <MenuItem label="Buy Limit" onClick={() => { onOpenNewOrder(); onClose(); }} />
                <MenuItem label="Sell Limit" onClick={() => { onOpenNewOrder(); onClose(); }} />
                <MenuItem label="Buy Stop" onClick={() => { onOpenNewOrder(); onClose(); }} />
                <MenuItem label="Sell Stop" onClick={() => { onOpenNewOrder(); onClose(); }} />
            </Submenu>

            <MenuSeparator />

            {/* ── Depth of Market ── */}
            <MenuItem
                icon={<ArrowUpDown size={13} strokeWidth={1.5} style={{ color: 'var(--ctx-icon, #8a8a9a)' }} />}
                label="Depth Of Market"
                shortcut="Alt+B"
                onClick={() => { onOpenDOM(); onClose(); }}
            />

            {/* ── One Click Trading ── */}
            <MenuItem
                icon={<Activity size={13} strokeWidth={1.5} style={{ color: oneClickTrading ? 'var(--ctx-blue, #74b9ff)' : 'var(--ctx-icon, #8a8a9a)' }} />}
                label="One Click Trading"
                shortcut="Alt+T"
                checked={oneClickTrading}
                onClick={() => { onToggleOneClickTrading(); onClose(); }}
            />

            <MenuSeparator />

            {/* ── Indicator List ── */}
            <Submenu
                label="Indicator List"
                icon={<svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="var(--ctx-icon, #8a8a9a)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><rect x="1.5" y="2" width="13" height="12" rx="1" /><polyline points="3 11 5 7.5 7.5 9.5 10 5.5 13 7" strokeWidth="1.3" /></svg>}
            >
                {indicators.map((ind) => (
                    <MenuItem
                        key={ind.type}
                        label={ind.name}
                        onClick={() => handleAddIndicator(ind.type)}
                    />
                ))}
            </Submenu>

            {/* ── Drawing Tools (Object List) ── */}
            <Submenu
                label="Object List"
                icon={<svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="var(--ctx-icon, #8a8a9a)" strokeWidth="1.5" strokeLinecap="round"><line x1="2.5" y1="13.5" x2="13.5" y2="2.5" /><circle cx="2.5" cy="13.5" r="1.5" fill="currentColor" stroke="none" /><circle cx="13.5" cy="2.5" r="1.5" fill="currentColor" stroke="none" /></svg>}
            >
                {drawingTools.map((tool) => (
                    <MenuItem
                        key={tool.tool}
                        icon={tool.icon}
                        label={tool.name}
                        onClick={() => handleSelectDrawingTool(tool.tool)}
                    />
                ))}
            </Submenu>

            <MenuSeparator />

            {/* ── Chart Types ── */}
            <MenuItem
                icon={<BarChart2 size={13} strokeWidth={1.5} style={{ color: currentChartType === 'bar' ? 'var(--ctx-blue, #74b9ff)' : 'var(--ctx-icon, #8a8a9a)' }} />}
                label="Bar Chart"
                shortcut="Alt+1"
                checked={currentChartType === 'bar'}
                active={currentChartType === 'bar'}
                onClick={() => { onChangeChartType('bar'); onClose(); }}
            />
            <MenuItem
                icon={<CandlestickChart size={13} strokeWidth={1.5} style={{ color: currentChartType === 'candlestick' ? 'var(--ctx-blue, #74b9ff)' : 'var(--ctx-icon, #8a8a9a)' }} />}
                label="Candlesticks"
                shortcut="Alt+2"
                checked={currentChartType === 'candlestick'}
                active={currentChartType === 'candlestick'}
                onClick={() => { onChangeChartType('candlestick'); onClose(); }}
            />
            <MenuItem
                icon={<LineChart size={13} strokeWidth={1.5} style={{ color: (currentChartType === 'line' || currentChartType === 'area') ? 'var(--ctx-blue, #74b9ff)' : 'var(--ctx-icon, #8a8a9a)' }} />}
                label="Line Chart"
                shortcut="Alt+3"
                checked={currentChartType === 'line' || currentChartType === 'area'}
                active={currentChartType === 'line' || currentChartType === 'area'}
                onClick={() => { onChangeChartType('area'); onClose(); }}
            />

            <MenuSeparator />

            {/* ── Timeframes ── */}
            <Submenu
                label="Timeframes"
                icon={<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="var(--ctx-icon, #8a8a9a)" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10" /><polyline points="12 6 12 12 16 14" /></svg>}
            >
                {timeframes.map((tf) => (
                    <MenuItem
                        key={tf}
                        label={tf}
                        active={currentTimeframe === tf}
                        checked={currentTimeframe === tf}
                        onClick={() => { onChangeTimeframe(tf); onClose(); }}
                    />
                ))}
            </Submenu>

            {/* ── Templates ── */}
            <Submenu
                label="Templates"
                icon={<Layers size={13} strokeWidth={1.5} style={{ color: 'var(--ctx-icon, #8a8a9a)' }} />}
            >
                <MenuItem 
                    icon={
                        <div style={{ width: 14, height: 14, borderRadius: '50%', border: '1.5px solid #3b82f6', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                            <svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="#3b82f6" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="M12 5v14M19 12l-7 7-7-7"/></svg>
                        </div>
                    } 
                    label="Save Template..." 
                    onClick={handleOpenSaveTemplate} 
                />
                <MenuItem 
                    icon={
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#22c55e" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M12 19V5M5 12l7-7 7 7"/></svg>
                    } 
                    label="Load Template..." 
                    onClick={handleOpenLoadTemplate} 
                />
                <Submenu
                    label="Remove Template"
                    disabled={templates.filter(t => !t.isDefault).length === 0}
                >
                    {templates.filter(t => !t.isDefault).map(tpl => (
                        <MenuItem 
                            key={tpl.id} 
                            label={tpl.name} 
                            onClick={() => handleTemplateDelete(tpl.id, tpl.name)} 
                        />
                    ))}
                </Submenu>

                {templates.length > 0 && (
                    <>
                        <MenuSeparator />
                        {templates.map((tpl) => (
                            <MenuItem
                                key={tpl.id}
                                label={tpl.name}
                                onClick={() => { handleTemplateLoad(tpl); onClose(); }}
                            />
                        ))}
                    </>
                )}
            </Submenu>

            {/* ── Refresh ── */}
            <MenuItem
                icon={<RefreshCw size={13} strokeWidth={1.5} style={{ color: 'var(--ctx-icon, #8a8a9a)' }} />}
                label="Refresh"
                onClick={() => { onRefresh(); onClose(); }}
            />

            <MenuSeparator />

            {/* ── Grid ── */}
            <MenuItem
                icon={<Grid3X3 size={13} strokeWidth={1.5} style={{ color: showGrid ? 'var(--ctx-blue, #74b9ff)' : 'var(--ctx-icon, #8a8a9a)' }} />}
                label="Grid"
                shortcut="Ctrl+G"
                checked={showGrid}
                onClick={() => { onToggleGrid(); onClose(); }}
            />

            {/* ── Auto Scroll ── */}
            <MenuItem
                icon={<RefreshCw size={13} strokeWidth={1.5} style={{ color: autoScroll ? 'var(--ctx-blue, #74b9ff)' : 'var(--ctx-icon, #8a8a9a)' }} />}
                label="Auto Scroll"
                checked={autoScroll}
                onClick={() => { onToggleAutoScroll(); onClose(); }}
            />

            {/* ── Chart Shift ── */}
            <MenuItem
                icon={<AlignJustify size={13} strokeWidth={1.5} style={{ color: chartShift ? 'var(--ctx-blue, #74b9ff)' : 'var(--ctx-icon, #8a8a9a)' }} />}
                label="Chart Shift"
                checked={chartShift}
                onClick={() => { onToggleChartShift(); onClose(); }}
            />

            <MenuSeparator />

            {/* ── Volumes ── */}
            <MenuItem
                icon={<Volume2 size={13} strokeWidth={1.5} style={{ color: showVolumes ? 'var(--ctx-blue, #74b9ff)' : 'var(--ctx-icon, #8a8a9a)' }} />}
                label="Volumes"
                shortcut="Ctrl+K"
                checked={showVolumes}
                onClick={() => { onToggleVolumes(); onClose(); }}
            />

            <MenuSeparator />

            {/* ── Zoom ── */}
            <MenuItem
                icon={<ZoomIn size={13} strokeWidth={1.5} style={{ color: 'var(--ctx-icon, #8a8a9a)' }} />}
                label="Zoom In"
                shortcut="+"
                onClick={() => { onZoomIn(); onClose(); }}
            />
            <MenuItem
                icon={<ZoomOut size={13} strokeWidth={1.5} style={{ color: 'var(--ctx-icon, #8a8a9a)' }} />}
                label="Zoom Out"
                shortcut="-"
                onClick={() => { onZoomOut(); onClose(); }}
            />

            {/* ── Delete Indicators Window ── */}
            <MenuItem
                icon={<Trash2 size={13} strokeWidth={1.5} style={{ color: 'var(--ctx-icon, #8a8a9a)' }} />}
                label="Delete Indicators Window"
                disabled={currentIndicators.length === 0}
                onClick={() => { onDeleteIndicators(); onClose(); }}
            />

            <MenuSeparator />

            {/* ── Save as Picture ── */}
            <MenuItem
                icon={<Camera size={13} strokeWidth={1.5} style={{ color: 'var(--ctx-icon, #8a8a9a)' }} />}
                label="Save as Picture"
                onClick={() => { onSaveAsPicture(); onClose(); }}
            />

            {/* ── Properties ── */}
            <MenuItem
                icon={<Settings size={13} strokeWidth={1.5} style={{ color: 'var(--ctx-icon, #8a8a9a)' }} />}
                label="Properties"
                shortcut="F8"
                onClick={() => { onOpenProperties(); onClose(); }}
            />
        </div>
    );

    return (
        <>
            {ReactDOM.createPortal(
                <>
                    {/* Full-screen transparent backdrop — closes on click or scroll outside menu */}
                    <div
                        style={{
                            position: 'fixed', inset: 0,
                            zIndex: 9999,
                            background: 'transparent',
                        }}
                        onMouseDown={onClose}
                        onWheel={(e) => {
                            // Close the menu so the chart can scroll uninterrupted
                            onClose();
                            // Allow the wheel event to propagate to the chart's window handler
                        }}
                        onContextMenu={(e) => e.preventDefault()}
                    />
                    {menuContent}
                </>,
                document.body
            )}
        </>
    );
};
