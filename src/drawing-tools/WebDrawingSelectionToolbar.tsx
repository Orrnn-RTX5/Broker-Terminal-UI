import { getChartPatternTool } from './chartPatternToolCatalog';
import { Lock, Settings2, Trash2, Unlock } from 'lucide-react';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { drawingManager, type Drawing } from '../services/drawingManager';
import './WebDrawingSelectionToolbar.css';
import { PositionDrawingSettings } from './PositionDrawingSettings';
import { getBrushShapeTool } from './brushShapeToolCatalog';

interface DrawingSelectionDetail {
  drawingId: string;
  contextId?: string;
  type: Drawing['type'];
  subtype?: string;
  color?: string;
  lineWidth?: number;
  lineStyle?: Drawing['lineStyle'];
  fillColor?: string;
  fillOpacity?: number;
  locked?: boolean;
  anchorClientX: number;
  anchorClientY: number;
  annotationClientBounds?: { top: number; bottom: number };
}

interface ToolbarPosition {
  left: number;
  top: number;
}

const VIEWPORT_GAP = 8;
const DRAWING_GAP = 12;

export function WebDrawingSelectionToolbar() {
  const [selection, setSelection] = useState<DrawingSelectionDetail | null>(null);
  const [position, setPosition] = useState<ToolbarPosition | null>(null);
  const toolbarRef = useRef<HTMLDivElement>(null);
  const [settingsDrawing, setSettingsDrawing] = useState<Drawing | null>(null);
  useEffect(() => { setSettingsDrawing(null); }, [selection?.drawingId, selection?.contextId]);

  useEffect(() => {
    const handleSelected = (event: Event) => {
      setSelection((event as CustomEvent<DrawingSelectionDetail>).detail);
    };
    const handleCleared = (event: Event) => {
      const contextId = (event as CustomEvent<{ contextId?: string }>).detail?.contextId;
      setSelection(current => (
        current && contextId && current.contextId && contextId !== current.contextId
          ? current
          : null
      ));
    };
    window.addEventListener('drawing:selected', handleSelected);
    window.addEventListener('drawing:selection-cleared', handleCleared);
    return () => {
      window.removeEventListener('drawing:selected', handleSelected);
      window.removeEventListener('drawing:selection-cleared', handleCleared);
    };
  }, []);

  useLayoutEffect(() => {
    if (!selection) {
      setPosition(null);
      return;
    }

    const updatePosition = () => {
      const toolbar = toolbarRef.current;
      if (!toolbar) return;
      const rect = toolbar.getBoundingClientRect();
      const maximumLeft = Math.max(VIEWPORT_GAP, window.innerWidth - rect.width - VIEWPORT_GAP);
      const left = Math.max(
        VIEWPORT_GAP,
        Math.min(selection.anchorClientX - (rect.width / 2), maximumLeft),
      );
      const aboveAnchor = Math.min(selection.anchorClientY, selection.annotationClientBounds?.top ?? selection.anchorClientY);
      const belowAnchor = Math.max(selection.anchorClientY, selection.annotationClientBounds?.bottom ?? selection.anchorClientY);
      const above = aboveAnchor - rect.height - DRAWING_GAP;
      const below = belowAnchor + DRAWING_GAP;
      const maximumTop = Math.max(VIEWPORT_GAP, window.innerHeight - rect.height - VIEWPORT_GAP);
      const top = above >= VIEWPORT_GAP
        ? above
        : Math.min(below, maximumTop);
      setPosition({ left: Math.round(left), top: Math.round(top) });
    };

    updatePosition();
    window.addEventListener('resize', updatePosition);
    window.addEventListener('scroll', updatePosition, true);
    return () => {
      window.removeEventListener('resize', updatePosition);
      window.removeEventListener('scroll', updatePosition, true);
    };
  }, [selection]);

  if (!selection) return null;
  const backgroundLabel = selection.type === 'freehand' ? 'Brush background' : selection.type === 'pattern' ? 'Pattern background' : 'Shape background';

  const update = (properties: Partial<Drawing>) => {
    drawingManager.updateDrawingProperties(
      selection.drawingId,
      properties,
      selection.contextId,
    );
  };

  return createPortal(
    <>
    <div
      ref={toolbarRef}
      className="web-drawing-selection-toolbar"
      role="toolbar"
      aria-label={`Edit ${getChartPatternTool(selection)?.label || selection.subtype || selection.type}`}
      style={position
        ? { left: position.left, top: position.top }
        : { left: 0, top: 0, visibility: 'hidden' }}
      onPointerDown={event => event.stopPropagation()}
    >
      <label className="web-drawing-selection-toolbar__color" title="Line color">
        <span aria-hidden="true" style={{ background: selection.color || '#2962ff' }} />
        <input
          aria-label="Line color"
          type="color"
          value={selection.color || '#2962ff'}
          onChange={event => update({ color: event.target.value })}
        />
      </label>

      {!['arrow_marker', 'arrow_mark_up', 'arrow_mark_down'].includes(selection.subtype ?? '') && <><select
        aria-label="Line width"
        value={selection.lineWidth || 2}
        onChange={event => update({ lineWidth: Number(event.target.value) })}
      >
        {(selection.subtype === 'highlighter' ? [5, 10, 20, 30, 40] : [1, 2, 3, 4]).map(width => (
          <option key={width} value={width}>{width}px</option>
        ))}
      </select>

      <select
        aria-label="Line style"
        value={selection.lineStyle || 'solid'}
        onChange={event => update({ lineStyle: event.target.value as Drawing['lineStyle'] })}
      >
        <option value="solid">Solid</option>
        <option value="dashed">Dashed</option>
        <option value="dotted">Dotted</option>
      </select>
      </>}

      <span className="web-drawing-selection-toolbar__separator" aria-hidden="true" />

      {selection.subtype === 'highlighter' && <input type="range" aria-label="Highlighter opacity" min="5" max="100"
        value={Math.round((selection.fillOpacity ?? .3) * 100)}
        onChange={event => update({ fillOpacity: Number(event.target.value) / 100 })} style={{ width: 65 }} />}
      {((selection.type === 'freehand' && selection.subtype !== 'highlighter') || getBrushShapeTool(selection)?.background || getChartPatternTool(selection)?.background) && <>
        <label title={backgroundLabel}>
          <input type="checkbox" aria-label={backgroundLabel} checked={Boolean(selection.fillColor)}
            onChange={event => update({ fillColor: event.target.checked ? selection.color || '#2962ff' : '', fillOpacity: selection.fillOpacity ?? .2 })} />
          Background
        </label>
        {selection.fillColor && <>
          <input type="color" aria-label={`${backgroundLabel} color`} value={selection.fillColor}
            onChange={event => update({ fillColor: event.target.value })} />
          <input type="range" aria-label={`${backgroundLabel} opacity`} min="0" max="100" value={Math.round((selection.fillOpacity ?? .2) * 100)}
            onChange={event => update({ fillOpacity: Number(event.target.value) / 100 })} style={{ width: 65 }} />
        </>}
      </>}

      {(selection.subtype === 'long_position' || selection.subtype === 'short_position') && <button
        type="button" aria-label="Position drawing settings" title="Position drawing settings" disabled={selection.locked}
        onClick={() => setSettingsDrawing(drawingManager.getDrawings(selection.contextId).find(drawing => drawing.id === selection.drawingId) ?? null)}
      ><Settings2 aria-hidden="true" size={17} /></button>}

      <button
        type="button"
        aria-label={selection.locked ? 'Unlock drawing' : 'Lock drawing'}
        title={selection.locked ? 'Unlock drawing' : 'Lock drawing'}
        onClick={() => update({ locked: !selection.locked })}
      >
        {selection.locked
          ? <Unlock aria-hidden="true" size={17} strokeWidth={1.6} />
          : <Lock aria-hidden="true" size={17} strokeWidth={1.6} />}
      </button>

      <button
        className="web-drawing-selection-toolbar__delete"
        type="button"
        aria-label="Delete drawing"
        title="Delete drawing"
        onClick={() => drawingManager.deleteDrawing(selection.drawingId, selection.contextId)}
      >
        <Trash2 aria-hidden="true" size={17} strokeWidth={1.6} />
      </button>
    </div>
    {settingsDrawing && <PositionDrawingSettings drawing={settingsDrawing} contextId={selection.contextId} onClose={() => setSettingsDrawing(null)} />}
    </>,
    document.body,
  );
}
