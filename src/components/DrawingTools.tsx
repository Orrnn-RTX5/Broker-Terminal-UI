/**
 * DrawingTools Component
 * Professional chart drawing tools panel — light theme
 */

import { Icon } from './ui/Icon';
import type { IconName } from './ui/Icon';
import React, { useState, useRef, useCallback, useMemo } from 'react';
import {
  useDrawingStore,
  type DrawingType,
  type LineStyle,
  type Point,
  type Drawing,
} from '../store/useDrawingStore';

// Drawing tool categories for toolbar
const TOOL_CATEGORIES = [
  {
    label: 'Pointer',
    tools: [
      { type: 'cursor' as DrawingType, label: 'Select', icon: 'cursor' as IconName, shortcut: 'V' },
      { type: 'crosshair' as DrawingType, label: 'Crosshair', icon: 'crosshair' as IconName, shortcut: '+' },
      { type: 'zoom-in' as DrawingType, label: 'Zoom In', icon: 'zoom-in' as IconName, shortcut: 'Z' },
      { type: 'zoom-out' as DrawingType, label: 'Zoom Out', icon: 'zoom-out' as IconName, shortcut: '' },
      { type: 'pan' as DrawingType, label: 'Pan', icon: 'pan' as IconName, shortcut: 'P' },
    ],
  },
  {
    label: 'Lines',
    tools: [
      { type: 'trend-line' as DrawingType, label: 'Trend Line', icon: 'trend-line' as IconName, shortcut: 'T' },
      { type: 'horizontal-line' as DrawingType, label: 'Horizontal Line', icon: 'h-line' as IconName, shortcut: 'H' },
      { type: 'vertical-line' as DrawingType, label: 'Vertical Line', icon: 'v-line' as IconName, shortcut: '' },
      { type: 'ray' as DrawingType, label: 'Ray', icon: 'ray' as IconName, shortcut: 'R' },
      { type: 'infinite-line' as DrawingType, label: 'Infinite Line', icon: 'infinite-line' as IconName, shortcut: '' },
    ],
  },
  {
    label: 'Channels',
    tools: [
      { type: 'channel' as DrawingType, label: 'Channel', icon: 'channel' as IconName, shortcut: 'C' },
      { type: 'parallel-channel' as DrawingType, label: 'Parallel Channel', icon: 'parallel-channel' as IconName, shortcut: '' },
      { type: 'pitchfork' as DrawingType, label: 'Pitchfork', icon: 'triangle' as IconName, shortcut: '' },
    ],
  },
  {
    label: 'Fibonacci',
    tools: [
      { type: 'fib-retracement' as DrawingType, label: 'Fib Retracement', icon: 'fibonacci' as IconName, shortcut: 'F' },
      { type: 'fib-extension' as DrawingType, label: 'Fib Extension', icon: 'fib-extension' as IconName, shortcut: 'E' },
    ],
  },
  {
    label: 'Shapes',
    tools: [
      { type: 'rectangle' as DrawingType, label: 'Rectangle', icon: 'rectangle' as IconName, shortcut: '' },
      { type: 'ellipse' as DrawingType, label: 'Ellipse', icon: 'ellipse' as IconName, shortcut: 'O' },
      { type: 'polygon' as DrawingType, label: 'Polygon', icon: 'polygon' as IconName, shortcut: '' },
      { type: 'arrow' as DrawingType, label: 'Arrow', icon: 'move-up-right' as IconName, shortcut: 'A' },
    ],
  },
  {
    label: 'Annotation',
    tools: [
      { type: 'freehand' as DrawingType, label: 'Freehand', icon: 'freehand' as IconName, shortcut: '' },
      { type: 'text-label' as DrawingType, label: 'Text', icon: 'text' as IconName, shortcut: 'L' },
      { type: 'callout' as DrawingType, label: 'Callout', icon: 'callout' as IconName, shortcut: '' },
      { type: 'label' as DrawingType, label: 'Label', icon: 'label' as IconName, shortcut: '' },
    ],
  },
  {
    label: 'Measure',
    tools: [
      { type: 'crosshair-ruler' as DrawingType, label: 'Crosshair Ruler', icon: 'crosshair-ruler' as IconName, shortcut: 'X' },
    ],
  },
];

// Flatten for drawing tool config lookup
const ALL_TOOLS = TOOL_CATEGORIES.flatMap(c => c.tools);

const COLORS = [
  '#16a34a', // green
  '#dc2626', // red
  '#2563eb', // blue
  '#d97706', // amber
  '#7c3aed', // purple
  '#db2777', // pink
  '#7aacca', // cyan
  '#0f172a', // dark
  '#808088', // gray
];

const LINE_STYLES: LineStyle[] = ['solid', 'dashed', 'dotted'];

export function DrawingTools() {
  const {
    drawings,
    selectedDrawingId,
    activeTool,
    templates,
    isDrawing,
    addDrawing,
    updateDrawing,
    deleteDrawing,
    duplicateDrawing,
    setSelectedDrawing,
    setActiveTool,
    setIsDrawing,
    toggleDrawingVisibility,
    toggleDrawingLock,
    bringToFront,
    sendToBack,
    clearAllDrawings,
    undo,
    redo,
    canUndo,
    canRedo,
    saveTemplate,
    loadTemplate,
    deleteTemplate,
  } = useDrawingStore();

  const [showProperties, setShowProperties] = useState(false);
  const [showTemplates, setShowTemplates] = useState(false);
  const [templateName, setTemplateName] = useState('');
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; drawingId: string } | null>(null);
  const [currentPoints, setCurrentPoints] = useState<Point[]>([]);

  const canvasRef = useRef<SVGSVGElement>(null);
  const [svgDimensions] = useState({ width: 800, height: 500 });

  // Selected drawing
  const selectedDrawing = useMemo(
    () => drawings.find(d => d.id === selectedDrawingId),
    [drawings, selectedDrawingId]
  );

  // Handle tool selection
  const handleToolSelect = useCallback((tool: DrawingType) => {
    setActiveTool(activeTool === tool ? null : tool);
    setSelectedDrawing(null);
  }, [activeTool, setActiveTool, setSelectedDrawing]);

  // Handle canvas mouse events
  const handleCanvasMouseDown = useCallback((e: React.MouseEvent<SVGSVGElement>) => {
    if (!activeTool || !canvasRef.current) return;
    // Skip non-drawing tools
    if (['cursor', 'crosshair', 'zoom-in', 'zoom-out', 'pan'].includes(activeTool)) return;

    const rect = canvasRef.current.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    const price = 1.1000 - (y / svgDimensions.height) * 0.02;
    const point: Point = { x, y, price, time: new Date().toISOString() };

    setIsDrawing(true);
    setCurrentPoints([point]);
  }, [activeTool, setIsDrawing, svgDimensions.height]);

  const handleCanvasMouseMove = useCallback((e: React.MouseEvent<SVGSVGElement>) => {
    if (!isDrawing || !canvasRef.current || currentPoints.length === 0) return;

    const rect = canvasRef.current.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const price = 1.1000 - (y / svgDimensions.height) * 0.02;

    const point: Point = { x, y, price, time: new Date().toISOString() };
    setCurrentPoints([currentPoints[0], point]);
  }, [isDrawing, currentPoints, svgDimensions.height]);

  const handleCanvasMouseUp = useCallback(() => {
    if (!isDrawing || !activeTool || currentPoints.length < 2) {
      setIsDrawing(false);
      setCurrentPoints([]);
      return;
    }

    const newDrawing: Omit<Drawing, 'id' | 'zIndex' | 'locked' | 'rotation'> = {
      type: activeTool,
      points: currentPoints,
      color: '#2563eb',
      lineWidth: 2,
      lineStyle: 'solid',
      extendLeft: false,
      extendRight: false,
      showPriceLabels: true,
      visible: true,
      text: activeTool === 'text-label' ? 'New Label' : undefined,
      label: ALL_TOOLS.find(t => t.type === activeTool)?.label,
    };

    addDrawing(newDrawing);
    setIsDrawing(false);
    setCurrentPoints([]);
    setActiveTool(null);
  }, [isDrawing, activeTool, currentPoints, addDrawing, setIsDrawing, setActiveTool]);

  // Context menu
  const handleDrawingRightClick = useCallback((e: React.MouseEvent, drawingId: string) => {
    e.preventDefault();
    setContextMenu({ x: e.clientX, y: e.clientY, drawingId });
  }, []);

  const handleContextMenuAction = useCallback((action: 'edit' | 'duplicate' | 'delete' | 'front' | 'back' | 'lock') => {
    if (!contextMenu) return;

    switch (action) {
      case 'edit':
        setSelectedDrawing(contextMenu.drawingId);
        setShowProperties(true);
        break;
      case 'duplicate':
        duplicateDrawing(contextMenu.drawingId);
        break;
      case 'delete':
        deleteDrawing(contextMenu.drawingId);
        break;
      case 'front':
        bringToFront(contextMenu.drawingId);
        break;
      case 'back':
        sendToBack(contextMenu.drawingId);
        break;
      case 'lock':
        toggleDrawingLock(contextMenu.drawingId);
        break;
    }

    setContextMenu(null);
  }, [contextMenu, setSelectedDrawing, duplicateDrawing, deleteDrawing, bringToFront, sendToBack, toggleDrawingLock]);

  // Render drawing on canvas
  const renderDrawing = useCallback((drawing: Drawing) => {
    if (!drawing.visible || drawing.points.length < 2) return null;

    const [p1, p2] = drawing.points;
    const strokeDasharray =
      drawing.lineStyle === 'dashed' ? '8,4' :
        drawing.lineStyle === 'dotted' ? '2,2' :
          undefined;

    switch (drawing.type) {
      case 'trend-line':
      case 'horizontal-line':
      case 'vertical-line':
      case 'ray':
      case 'infinite-line':
      case 'arrow':
        return (
          <line
            key={drawing.id}
            x1={p1.x}
            y1={p1.y}
            x2={p2.x}
            y2={p2.y}
            stroke={drawing.color}
            strokeWidth={drawing.lineWidth}
            strokeDasharray={strokeDasharray}
            onContextMenu={(e) => handleDrawingRightClick(e, drawing.id)}
            onClick={() => setSelectedDrawing(drawing.id)}
            style={{ cursor: drawing.locked ? 'not-allowed' : 'pointer' }}
          />
        );

      case 'rectangle':
        return (
          <rect
            key={drawing.id}
            x={Math.min(p1.x, p2.x)}
            y={Math.min(p1.y, p2.y)}
            width={Math.abs(p2.x - p1.x)}
            height={Math.abs(p2.y - p1.y)}
            stroke={drawing.color}
            strokeWidth={drawing.lineWidth}
            fill="none"
            strokeDasharray={strokeDasharray}
            onContextMenu={(e) => handleDrawingRightClick(e, drawing.id)}
            onClick={() => setSelectedDrawing(drawing.id)}
            style={{ cursor: 'pointer' }}
          />
        );

      case 'ellipse': {
        const cx = (p1.x + p2.x) / 2;
        const cy = (p1.y + p2.y) / 2;
        const rx = Math.abs(p2.x - p1.x) / 2;
        const ry = Math.abs(p2.y - p1.y) / 2;
        return (
          <ellipse
            key={drawing.id}
            cx={cx}
            cy={cy}
            rx={rx}
            ry={ry}
            stroke={drawing.color}
            strokeWidth={drawing.lineWidth}
            fill="none"
            strokeDasharray={strokeDasharray}
            onContextMenu={(e) => handleDrawingRightClick(e, drawing.id)}
            onClick={() => setSelectedDrawing(drawing.id)}
            style={{ cursor: 'pointer' }}
            transform={drawing.rotation ? `rotate(${drawing.rotation} ${cx} ${cy})` : undefined}
          />
        );
      }

      case 'channel':
      case 'parallel-channel': {
        const offset = 30;
        return (
          <g key={drawing.id}>
            <line
              x1={p1.x} y1={p1.y} x2={p2.x} y2={p2.y}
              stroke={drawing.color} strokeWidth={drawing.lineWidth}
              strokeDasharray={strokeDasharray}
            />
            <line
              x1={p1.x} y1={p1.y + offset} x2={p2.x} y2={p2.y + offset}
              stroke={drawing.color} strokeWidth={drawing.lineWidth}
              strokeDasharray={strokeDasharray}
              onContextMenu={(e) => handleDrawingRightClick(e, drawing.id)}
              onClick={() => setSelectedDrawing(drawing.id)}
              style={{ cursor: 'pointer' }}
            />
          </g>
        );
      }

      case 'fib-retracement': {
        const fibLevels = [0, 0.236, 0.382, 0.5, 0.618, 0.786, 1];
        const height = p2.y - p1.y;
        return (
          <g key={drawing.id}>
            {fibLevels.map((level, idx) => {
              const y = p1.y + height * level;
              return (
                <g key={idx}>
                  <line
                    x1={Math.min(p1.x, p2.x)} y1={y}
                    x2={Math.max(p1.x, p2.x)} y2={y}
                    stroke={drawing.color} strokeWidth={drawing.lineWidth}
                    strokeDasharray={strokeDasharray} opacity={0.7}
                  />
                  {drawing.showPriceLabels && (
                    <text x={Math.max(p1.x, p2.x) + 5} y={y + 4}
                      fill={drawing.color} fontSize="11" fontFamily="monospace"
                    >
                      {(level * 100).toFixed(1)}%
                    </text>
                  )}
                </g>
              );
            })}
            <rect
              x={Math.min(p1.x, p2.x)} y={Math.min(p1.y, p2.y)}
              width={Math.abs(p2.x - p1.x)} height={Math.abs(p2.y - p1.y)}
              fill="none" stroke="transparent" strokeWidth={10}
              onContextMenu={(e) => handleDrawingRightClick(e, drawing.id)}
              onClick={() => setSelectedDrawing(drawing.id)}
              style={{ cursor: 'pointer' }}
            />
          </g>
        );
      }

      case 'text-label':
      case 'callout':
      case 'label':
        return (
          <text
            key={drawing.id}
            x={p1.x} y={p1.y}
            fill={drawing.color} fontSize="14" fontWeight="bold"
            fontFamily="var(--font-sans)"
            onContextMenu={(e) => handleDrawingRightClick(e, drawing.id)}
            onClick={() => setSelectedDrawing(drawing.id)}
            style={{ cursor: 'pointer' }}
          >
            {drawing.text || 'Label'}
          </text>
        );

      default:
        return null;
    }
  }, [handleDrawingRightClick, setSelectedDrawing]);

  // Render current drawing preview
  const renderCurrentDrawing = useCallback(() => {
    if (!isDrawing || currentPoints.length < 2 || !activeTool) return null;
    const [p1, p2] = currentPoints;

    switch (activeTool) {
      case 'trend-line': case 'horizontal-line': case 'vertical-line':
      case 'ray': case 'infinite-line': case 'arrow':
        return (
          <line
            x1={p1.x} y1={p1.y} x2={p2.x} y2={p2.y}
            stroke="#2563eb" strokeWidth={2} strokeDasharray="4,4" opacity={0.6}
          />
        );
      case 'rectangle':
        return (
          <rect
            x={Math.min(p1.x, p2.x)} y={Math.min(p1.y, p2.y)}
            width={Math.abs(p2.x - p1.x)} height={Math.abs(p2.y - p1.y)}
            stroke="#2563eb" strokeWidth={2} fill="none" strokeDasharray="4,4" opacity={0.6}
          />
        );
      case 'ellipse': {
        const cx = (p1.x + p2.x) / 2;
        const cy = (p1.y + p2.y) / 2;
        return (
          <ellipse
            cx={cx} cy={cy}
            rx={Math.abs(p2.x - p1.x) / 2} ry={Math.abs(p2.y - p1.y) / 2}
            stroke="#2563eb" strokeWidth={2} fill="none" strokeDasharray="4,4" opacity={0.6}
          />
        );
      }
      default:
        return null;
    }
  }, [isDrawing, currentPoints, activeTool]);

  return (
    <div className="flex flex-col h-full" style={{ background: 'var(--bg-primary)', color: 'var(--text-primary)' }}>
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-2 border-b" style={{ borderColor: 'var(--border-primary)', background: 'var(--bg-secondary)' }}>
        <div className="flex items-center gap-2">
          <Icon name="palette" size="sm" />
          <h2 className="text-sm font-semibold">Drawing Tools</h2>
        </div>
        <div className="flex items-center gap-2">
          {/* Undo/Redo */}
          <button
            onClick={undo}
            disabled={!canUndo()}
            className="px-2 py-1 text-xs rounded flex items-center gap-1 transition-colors disabled:opacity-30"
            style={{ background: 'var(--bg-tertiary)' }}
            title="Undo (Ctrl+Z)"
          >
            <Icon name="arrow-left" size="sm" />
          </button>
          <button
            onClick={redo}
            disabled={!canRedo()}
            className="px-2 py-1 text-xs rounded flex items-center gap-1 transition-colors disabled:opacity-30"
            style={{ background: 'var(--bg-tertiary)' }}
            title="Redo (Ctrl+Shift+Z)"
          >
            <Icon name="arrow-right" size="sm" />
          </button>
          <div style={{ width: 1, height: 16, background: 'var(--border-primary)' }} />
          <button
            onClick={() => setShowTemplates(!showTemplates)}
            className="px-2 py-1 text-xs rounded flex items-center gap-1 transition-colors"
            style={{ background: 'var(--bg-tertiary)' }}
            title="Templates"
          >
            <Icon name="download" size="sm" />
            Templates
          </button>
          <button
            onClick={() => setShowProperties(!showProperties)}
            className="px-2 py-1 text-xs rounded flex items-center gap-1 transition-colors"
            style={{ background: 'var(--bg-tertiary)' }}
            title="Properties"
          >
            <Icon name="settings" size="sm" />
            Properties
          </button>
          <button
            onClick={clearAllDrawings}
            className="px-2 py-1 text-xs rounded transition-colors"
            style={{ background: 'var(--color-loss-dimmer)', color: 'var(--color-loss)' }}
            title="Clear All"
          >
            <Icon name="trash" size="sm" />
          </button>
        </div>
      </div>

      <div className="flex flex-1 overflow-hidden">
        {/* Left Sidebar — Categorized Toolbar */}
        <div className="w-[72px] overflow-y-auto border-r" style={{ borderColor: 'var(--border-primary)', background: 'var(--bg-secondary)' }}>
          <div className="p-1.5 space-y-2">
            {TOOL_CATEGORIES.map((category) => (
              <div key={category.label}>
                <div className="text-[8px] font-bold uppercase tracking-wider px-1 mb-1" style={{ color: 'var(--text-quaternary)' }}>
                  {category.label}
                </div>
                <div className="space-y-0.5">
                  {category.tools.map((tool) => {
                    const isActive = activeTool === tool.type;
                    return (
                      <button
                        key={tool.type}
                        onClick={() => handleToolSelect(tool.type)}
                        className="w-full p-1.5 rounded flex flex-col items-center justify-center gap-0.5 transition-colors"
                        style={{
                          background: isActive ? 'var(--color-primary)' : 'transparent',
                          color: isActive ? '#fff' : 'var(--text-secondary)',
                        }}
                        title={`${tool.label}${tool.shortcut ? ` (${tool.shortcut})` : ''}`}
                      >
                        <Icon name={tool.icon} size="sm" />
                        <span className="text-[8px] font-medium leading-tight">{tool.shortcut || '·'}</span>
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Main Canvas Area */}
        <div className="flex-1 flex flex-col overflow-hidden">
          <div className="flex-1 overflow-auto p-4" style={{ background: 'var(--bg-primary)' }}>
            <div className="inline-block">
              <svg
                ref={canvasRef}
                width={svgDimensions.width}
                height={svgDimensions.height}
                className="rounded cursor-crosshair"
                style={{ border: '1px solid var(--border-primary)', background: 'var(--bg-secondary)' }}
                onMouseDown={handleCanvasMouseDown}
                onMouseMove={handleCanvasMouseMove}
                onMouseUp={handleCanvasMouseUp}
                onClick={() => !isDrawing && setContextMenu(null)}
              >
                {/* Grid */}
                <defs>
                  <pattern id="grid" width="20" height="20" patternUnits="userSpaceOnUse">
                    <path d="M 20 0 L 0 0 0 20" fill="none" stroke="var(--border-primary)" strokeWidth="0.5" />
                  </pattern>
                </defs>
                <rect width="100%" height="100%" fill="url(#grid)" />

                {/* Mock price levels */}
                {[...Array(6)].map((_, i) => {
                  const y = (i + 1) * (svgDimensions.height / 7);
                  const price = (1.1000 - (y / svgDimensions.height) * 0.02).toFixed(5);
                  return (
                    <g key={i}>
                      <line
                        x1={0} y1={y} x2={svgDimensions.width} y2={y}
                        stroke="var(--border-secondary)" strokeWidth="0.5" strokeDasharray="2,2"
                      />
                      <text x="5" y={y - 3} fill="var(--text-tertiary)" fontSize="10" fontFamily="monospace">
                        {price}
                      </text>
                    </g>
                  );
                })}

                {/* Render all drawings */}
                {drawings
                  .slice()
                  .sort((a, b) => a.zIndex - b.zIndex)
                  .map(renderDrawing)}

                {/* Current drawing preview */}
                {renderCurrentDrawing()}
              </svg>
            </div>
          </div>

          {/* Info Bar */}
          <div className="px-4 py-2 flex items-center justify-between text-xs border-t" style={{ borderColor: 'var(--border-primary)', background: 'var(--bg-secondary)' }}>
            <div className="flex items-center gap-4">
              <span style={{ color: 'var(--text-tertiary)' }}>
                Active Tool: <span style={{ color: 'var(--text-primary)', fontWeight: 600 }}>{activeTool ? ALL_TOOLS.find(t => t.type === activeTool)?.label : 'None'}</span>
              </span>
              <span style={{ color: 'var(--text-tertiary)' }}>
                Drawings: <span style={{ color: 'var(--text-primary)', fontWeight: 600 }}>{drawings.length}</span>
              </span>
            </div>
            <div style={{ color: 'var(--text-quaternary)' }}>
              Click and drag to draw • Right-click for options • Ctrl+Z undo
            </div>
          </div>
        </div>

        {/* Right Sidebar — Drawing List */}
        <div className="w-60 overflow-y-auto border-l" style={{ borderColor: 'var(--border-primary)', background: 'var(--bg-secondary)' }}>
          <div className="p-3">
            <h3 className="text-xs font-semibold mb-2" style={{ color: 'var(--text-tertiary)' }}>DRAWINGS</h3>
            <div className="space-y-1">
              {drawings.length === 0 ? (
                <div className="text-xs text-center py-4" style={{ color: 'var(--text-quaternary)' }}>
                  No drawings yet
                </div>
              ) : (
                drawings
                  .slice()
                  .sort((a, b) => b.zIndex - a.zIndex)
                  .map((drawing) => {
                    const tool = ALL_TOOLS.find(t => t.type === drawing.type);
                    return (
                      <div
                        key={drawing.id}
                        className="flex items-center gap-2 p-2 rounded text-xs cursor-pointer transition-colors"
                        style={{
                          background: selectedDrawingId === drawing.id ? 'var(--color-primary-dim)' : 'var(--bg-tertiary)',
                          border: selectedDrawingId === drawing.id ? '1px solid var(--color-primary)' : '1px solid transparent',
                        }}
                        onClick={() => setSelectedDrawing(drawing.id)}
                      >
                        <Icon name={(tool?.icon || 'layers') as IconName} size="sm" style={{ color: drawing.color }} />
                        <span className="flex-1 truncate">{drawing.label || tool?.label}</span>
                        {drawing.locked && <Icon name="lock" size="xs" style={{ color: 'var(--text-quaternary)' }} />}
                        <button
                          onClick={(e) => { e.stopPropagation(); toggleDrawingVisibility(drawing.id); }}
                          className="p-0.5 rounded transition-colors"
                          title={drawing.visible ? 'Hide' : 'Show'}
                        >
                          <Icon name={drawing.visible ? 'eye' : 'eye-off'} size="xs" />
                        </button>
                        <button
                          onClick={(e) => { e.stopPropagation(); deleteDrawing(drawing.id); }}
                          className="p-0.5 rounded transition-colors"
                          style={{ color: 'var(--color-loss)' }}
                          title="Delete"
                        >
                          <Icon name="trash" size="xs" />
                        </button>
                      </div>
                    );
                  })
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Properties Panel */}
      {showProperties && selectedDrawing && (
        <div className="absolute top-16 right-4 w-72 rounded-lg shadow-xl z-50" style={{ background: 'var(--bg-primary)', border: '1px solid var(--border-primary)' }}>
          <div className="flex items-center justify-between px-4 py-2 rounded-t-lg border-b" style={{ borderColor: 'var(--border-primary)', background: 'var(--bg-secondary)' }}>
            <h3 className="text-sm font-semibold">Drawing Properties</h3>
            <button onClick={() => setShowProperties(false)} className="p-1 rounded transition-colors">
              <Icon name="x-close" size="sm" />
            </button>
          </div>
          <div className="p-4 space-y-4">
            {/* Color */}
            <div>
              <label className="text-xs font-medium mb-2 block" style={{ color: 'var(--text-tertiary)' }}>Color</label>
              <div className="flex gap-2 flex-wrap">
                {COLORS.map((color) => (
                  <button
                    key={color}
                    onClick={() => updateDrawing(selectedDrawing.id, { color })}
                    className="w-7 h-7 rounded"
                    style={{
                      backgroundColor: color,
                      border: selectedDrawing.color === color ? '2px solid var(--text-primary)' : '2px solid var(--border-primary)',
                    }}
                    title={color}
                  />
                ))}
              </div>
            </div>

            {/* Line Style */}
            <div>
              <label className="text-xs font-medium mb-2 block" style={{ color: 'var(--text-tertiary)' }}>Line Style</label>
              <div className="flex gap-2">
                {LINE_STYLES.map((style) => (
                  <button
                    key={style}
                    onClick={() => updateDrawing(selectedDrawing.id, { lineStyle: style })}
                    className="flex-1 px-3 py-2 text-xs rounded transition-colors"
                    style={{
                      background: selectedDrawing.lineStyle === style ? 'var(--color-primary)' : 'var(--bg-tertiary)',
                      color: selectedDrawing.lineStyle === style ? '#fff' : 'var(--text-primary)',
                    }}
                  >
                    {style}
                  </button>
                ))}
              </div>
            </div>

            {/* Line Width */}
            <div>
              <label className="text-xs font-medium mb-2 block" style={{ color: 'var(--text-tertiary)' }}>
                Line Width: {selectedDrawing.lineWidth}px
              </label>
              <input
                type="range" min="1" max="5"
                value={selectedDrawing.lineWidth}
                onChange={(e) => updateDrawing(selectedDrawing.id, { lineWidth: parseInt(e.target.value) })}
                className="w-full"
              />
            </div>

            {/* Rotation (for applicable shapes) */}
            {['ellipse', 'rectangle'].includes(selectedDrawing.type) && (
              <div>
                <label className="text-xs font-medium mb-2 block" style={{ color: 'var(--text-tertiary)' }}>
                  Rotation: {selectedDrawing.rotation}°
                </label>
                <input
                  type="range" min="0" max="360"
                  value={selectedDrawing.rotation}
                  onChange={(e) => updateDrawing(selectedDrawing.id, { rotation: parseInt(e.target.value) })}
                  className="w-full"
                />
              </div>
            )}

            {/* Extend Options */}
            <div className="grid grid-cols-2 gap-2">
              <label className="flex items-center gap-2 text-xs">
                <input type="checkbox" checked={selectedDrawing.extendLeft}
                  onChange={(e) => updateDrawing(selectedDrawing.id, { extendLeft: e.target.checked })}
                  className="rounded"
                />
                Extend Left
              </label>
              <label className="flex items-center gap-2 text-xs">
                <input type="checkbox" checked={selectedDrawing.extendRight}
                  onChange={(e) => updateDrawing(selectedDrawing.id, { extendRight: e.target.checked })}
                  className="rounded"
                />
                Extend Right
              </label>
            </div>

            {/* Lock */}
            <label className="flex items-center gap-2 text-xs">
              <input type="checkbox" checked={selectedDrawing.locked}
                onChange={() => toggleDrawingLock(selectedDrawing.id)}
                className="rounded"
              />
              <Icon name={selectedDrawing.locked ? 'lock' : 'unlock'} size="xs" />
              {selectedDrawing.locked ? 'Locked' : 'Unlocked'}
            </label>

            {/* Price Labels */}
            <label className="flex items-center gap-2 text-xs">
              <input type="checkbox" checked={selectedDrawing.showPriceLabels}
                onChange={(e) => updateDrawing(selectedDrawing.id, { showPriceLabels: e.target.checked })}
                className="rounded"
              />
              Show Price Labels
            </label>

            {/* Text input for text labels */}
            {['text-label', 'callout', 'label'].includes(selectedDrawing.type) && (
              <div>
                <label className="text-xs font-medium mb-2 block" style={{ color: 'var(--text-tertiary)' }}>Text</label>
                <input
                  type="text"
                  value={selectedDrawing.text || ''}
                  onChange={(e) => updateDrawing(selectedDrawing.id, { text: e.target.value })}
                  className="w-full px-3 py-2 rounded text-sm"
                  style={{ background: 'var(--bg-tertiary)', border: '1px solid var(--border-primary)' }}
                  placeholder="Enter text..."
                />
              </div>
            )}
          </div>
        </div>
      )}

      {/* Templates Panel */}
      {showTemplates && (
        <div className="absolute top-16 right-4 w-80 rounded-lg shadow-xl z-50" style={{ background: 'var(--bg-primary)', border: '1px solid var(--border-primary)' }}>
          <div className="flex items-center justify-between px-4 py-2 rounded-t-lg border-b" style={{ borderColor: 'var(--border-primary)', background: 'var(--bg-secondary)' }}>
            <h3 className="text-sm font-semibold">Drawing Templates</h3>
            <button onClick={() => setShowTemplates(false)} className="p-1 rounded transition-colors">
              <Icon name="x-close" size="sm" />
            </button>
          </div>
          <div className="p-4 space-y-4">
            <div>
              <label className="text-xs font-medium mb-2 block" style={{ color: 'var(--text-tertiary)' }}>
                Save Current Drawings as Template
              </label>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={templateName}
                  onChange={(e) => setTemplateName(e.target.value)}
                  placeholder="Template name..."
                  className="flex-1 px-3 py-2 rounded text-sm"
                  style={{ background: 'var(--bg-tertiary)', border: '1px solid var(--border-primary)' }}
                />
                <button
                  onClick={() => { if (templateName.trim()) { saveTemplate(templateName.trim()); setTemplateName(''); } }}
                  disabled={!templateName.trim() || drawings.length === 0}
                  className="px-3 py-2 rounded text-sm flex items-center gap-1 disabled:opacity-30"
                  style={{ background: 'var(--color-primary)', color: '#fff' }}
                >
                  <Icon name="save" size="sm" /> Save
                </button>
              </div>
            </div>

            <div>
              <label className="text-xs font-medium mb-2 block" style={{ color: 'var(--text-tertiary)' }}>
                Saved Templates ({templates.length})
              </label>
              <div className="space-y-2 max-h-64 overflow-y-auto">
                {templates.length === 0 ? (
                  <div className="text-xs text-center py-4" style={{ color: 'var(--text-quaternary)' }}>
                    No templates saved
                  </div>
                ) : (
                  templates.map((template) => (
                    <div key={template.id} className="flex items-center gap-2 p-2 rounded text-xs" style={{ background: 'var(--bg-tertiary)' }}>
                      <div className="flex-1">
                        <div className="font-medium">{template.name}</div>
                        <div style={{ color: 'var(--text-quaternary)' }}>
                          {template.drawings.length} drawing{template.drawings.length !== 1 ? 's' : ''}
                        </div>
                      </div>
                      <button onClick={() => loadTemplate(template.id)}
                        className="px-2 py-1 rounded text-xs" style={{ background: 'var(--color-primary-dim)', color: 'var(--color-primary)' }}>
                        Load
                      </button>
                      <button onClick={() => deleteTemplate(template.id)}
                        className="px-2 py-1 rounded text-xs" style={{ color: 'var(--color-loss)' }}>
                        <Icon name="trash" size="xs" />
                      </button>
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Context Menu */}
      {contextMenu && (
        <div
          className="fixed rounded-lg shadow-xl z-50 py-1"
          style={{
            left: contextMenu.x, top: contextMenu.y,
            background: 'var(--bg-primary)',
            border: '1px solid var(--border-primary)',
            minWidth: 140,
          }}
          onClick={() => setContextMenu(null)}
        >
          <button className="w-full px-3 py-1.5 text-xs text-left flex items-center gap-2 transition-colors hover:bg-[var(--bg-tertiary)]" onClick={() => handleContextMenuAction('edit')}>
            <Icon name="edit" size="xs" /> Edit Properties
          </button>
          <button className="w-full px-3 py-1.5 text-xs text-left flex items-center gap-2 transition-colors hover:bg-[var(--bg-tertiary)]" onClick={() => handleContextMenuAction('duplicate')}>
            <Icon name="copy" size="xs" /> Duplicate
          </button>
          <button className="w-full px-3 py-1.5 text-xs text-left flex items-center gap-2 transition-colors hover:bg-[var(--bg-tertiary)]" onClick={() => handleContextMenuAction('lock')}>
            <Icon name="lock" size="xs" /> Lock / Unlock
          </button>
          <button className="w-full px-3 py-1.5 text-xs text-left flex items-center gap-2 transition-colors hover:bg-[var(--bg-tertiary)]" onClick={() => handleContextMenuAction('front')}>
            <Icon name="layers" size="xs" /> Bring to Front
          </button>
          <button className="w-full px-3 py-1.5 text-xs text-left flex items-center gap-2 transition-colors hover:bg-[var(--bg-tertiary)]" onClick={() => handleContextMenuAction('back')}>
            <Icon name="layers" size="xs" /> Send to Back
          </button>
          <div className="h-px my-1" style={{ background: 'var(--border-primary)' }} />
          <button className="w-full px-3 py-1.5 text-xs text-left flex items-center gap-2 transition-colors hover:bg-[var(--bg-tertiary)]" style={{ color: 'var(--color-loss)' }} onClick={() => handleContextMenuAction('delete')}>
            <Icon name="trash" size="xs" /> Delete
          </button>
        </div>
      )}
    </div>
  );
}
