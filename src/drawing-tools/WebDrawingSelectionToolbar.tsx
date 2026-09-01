import { Lock, Trash2, Unlock } from 'lucide-react';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { drawingManager, type Drawing } from '../services/drawingManager';
import './WebDrawingSelectionToolbar.css';

interface DrawingSelectionDetail {
  drawingId: string;
  contextId?: string;
  type: Drawing['type'];
  subtype?: string;
  color?: string;
  lineWidth?: number;
  lineStyle?: Drawing['lineStyle'];
  locked?: boolean;
  anchorClientX: number;
  anchorClientY: number;
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
      const above = selection.anchorClientY - rect.height - DRAWING_GAP;
      const below = selection.anchorClientY + DRAWING_GAP;
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

  const update = (properties: Partial<Drawing>) => {
    drawingManager.updateDrawingProperties(
      selection.drawingId,
      properties,
      selection.contextId,
    );
  };

  return createPortal(
    <div
      ref={toolbarRef}
      className="web-drawing-selection-toolbar"
      role="toolbar"
      aria-label={`Edit ${selection.subtype || selection.type}`}
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

      <select
        aria-label="Line width"
        value={selection.lineWidth || 2}
        onChange={event => update({ lineWidth: Number(event.target.value) })}
      >
        {[1, 2, 3, 4].map(width => (
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

      <span className="web-drawing-selection-toolbar__separator" aria-hidden="true" />

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
    </div>,
    document.body,
  );
}
