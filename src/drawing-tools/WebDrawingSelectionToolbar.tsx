import { useUiTranslation } from '../hooks/useUiTranslation';
import { getChartPatternTool } from './chartPatternToolCatalog';
import { Lock, Settings2, Trash2, Unlock } from 'lucide-react';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { drawingManager, type Drawing } from '../services/drawingManager';
import './WebDrawingSelectionToolbar.css';
import { PositionDrawingSettings } from './PositionDrawingSettings';
import { getBrushShapeTool } from './brushShapeToolCatalog';
import { getAnnotationTool } from './annotationToolCatalog';
import { getPictographStamp } from './pictographCatalog';

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
  annotation?: Drawing['annotation'];
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
    const tr = useUiTranslation();
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
  const pictograph = selection.type === 'stamp' ? getPictographStamp(selection.subtype) : undefined;
  const selectionLabel = pictograph
    ? `${tr(pictograph.id.startsWith('emoji:') ? 'Emoji' : pictograph.id.startsWith('sticker:') ? 'Sticker' : 'Icon')} ${pictograph.glyph}`
    : tr(getAnnotationTool(selection)?.label || getChartPatternTool(selection)?.label || selection.subtype || selection.type);
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
      aria-label={tr("Edit {{value0}}", { value0: selectionLabel })}
      style={position
        ? { left: position.left, top: position.top }
        : { left: 0, top: 0, visibility: 'hidden' }}
      onPointerDown={event => event.stopPropagation()}
    >
      {!pictograph && <label className="web-drawing-selection-toolbar__color" title={tr("Line color")}>
        <span aria-hidden="true" style={{ background: selection.color || '#2962ff' }} />
        <input
          aria-label={tr("Line color")}
          type="color"
          value={selection.color || '#2962ff'}
          onChange={event => update({ color: event.target.value })}
        />
      </label>}

      {selection.type === 'text' && !['flag', 'image', 'post', 'idea'].includes(selection.subtype ?? '') && <select aria-label={tr("Annotation font size")}
        disabled={selection.locked} value={selection.annotation?.fontSize ?? 14}
        onChange={event => update({ annotation: { ...selection.annotation, fontSize: Number(event.target.value) } })}>
        {[10, 12, 14, 16, 18, 20, 24, 28, 32, 40, 48, 64].map(size => <option key={size} value={size}>{size}</option>)}
      </select>}
      {!pictograph && selection.type !== 'text' && !['arrow_marker', 'arrow_mark_up', 'arrow_mark_down'].includes(selection.subtype ?? '') && <><select
        aria-label={tr("Line width")}
        value={selection.lineWidth || 2}
        onChange={event => update({ lineWidth: Number(event.target.value) })}
      >
        {(selection.subtype === 'highlighter' ? [5, 10, 20, 30, 40] : [1, 2, 3, 4]).map(width => (
          <option key={width} value={width}>{width}{tr("px")}</option>
        ))}
      </select>

      <select
        aria-label={tr("Line style")}
        value={selection.lineStyle || 'solid'}
        onChange={event => update({ lineStyle: event.target.value as Drawing['lineStyle'] })}
      >
        <option value="solid">{tr("Solid")}</option>
        <option value="dashed">{tr("Dashed")}</option>
        <option value="dotted">{tr("Dotted")}</option>
      </select>
      </>}

      {!pictograph && <span className="web-drawing-selection-toolbar__separator" aria-hidden="true" />}

      {selection.type === 'text' && <button type="button" aria-label={tr("Edit annotation")} title={tr("Edit annotation")}
        disabled={selection.locked} onClick={() => drawingManager.editAnnotation(selection.drawingId, selection.contextId)}>
        <Settings2 aria-hidden="true" size={17} />
      </button>}

      {selection.subtype === 'highlighter' && <input type="range" aria-label={tr("Highlighter opacity")} min="5" max="100"
        value={Math.round((selection.fillOpacity ?? .3) * 100)}
        onChange={event => update({ fillOpacity: Number(event.target.value) / 100 })} style={{ width: 65 }} />}
      {((selection.type === 'freehand' && selection.subtype !== 'highlighter') || getBrushShapeTool(selection)?.background || getChartPatternTool(selection)?.background) && <>
        <label title={backgroundLabel}>
          <input type="checkbox" aria-label={backgroundLabel} checked={Boolean(selection.fillColor)}
            onChange={event => update({ fillColor: event.target.checked ? selection.color || '#2962ff' : '', fillOpacity: selection.fillOpacity ?? .2 })} />
          {tr("Background")}</label>
        {selection.fillColor && <>
          <input type="color" aria-label={tr("{{value0}} color", { value0: backgroundLabel })} value={selection.fillColor}
            onChange={event => update({ fillColor: event.target.value })} />
          <input type="range" aria-label={tr("{{value0}} opacity", { value0: backgroundLabel })} min="0" max="100" value={Math.round((selection.fillOpacity ?? .2) * 100)}
            onChange={event => update({ fillOpacity: Number(event.target.value) / 100 })} style={{ width: 65 }} />
        </>}
      </>}

      {(selection.subtype === 'long_position' || selection.subtype === 'short_position') && <button
        type="button" aria-label={tr("Position drawing settings")} title={tr("Position drawing settings")} disabled={selection.locked}
        onClick={() => setSettingsDrawing(drawingManager.getDrawings(selection.contextId).find(drawing => drawing.id === selection.drawingId) ?? null)}
      ><Settings2 aria-hidden="true" size={17} /></button>}

      <button
        type="button"
        aria-label={selection.locked ? tr("Unlock drawing") : tr("Lock drawing")}
        title={selection.locked ? tr("Unlock drawing") : tr("Lock drawing")}
        onClick={() => update({ locked: !selection.locked })}
      >
        {selection.locked ? <Unlock aria-hidden="true" size={17} strokeWidth={1.6} /> : <Lock aria-hidden="true" size={17} strokeWidth={1.6} />}
      </button>

      <button
        className="web-drawing-selection-toolbar__delete"
        type="button"
        aria-label={tr("Delete drawing")}
        title={tr("Delete drawing")}
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
