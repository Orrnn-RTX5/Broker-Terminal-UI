import { useUiTranslation } from '../../hooks/useUiTranslation';
import { getChartPatternTool } from '../../drawing-tools/chartPatternToolCatalog';
import { getPictographStamp } from '../../drawing-tools/pictographCatalog';
import React, {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from 'react';
import { createPortal } from 'react-dom';

import { getTrendLineToolFromDrawing } from '../../drawing-tools/toolCatalog';
import {
  drawingManager,
  type Drawing,
  type DrawingType,
} from '../../services/drawingManager';
import { Icon } from '../ui/Icon';
import './chart-objects-dialog.css';

export interface ChartObjectsDrawingService {
  getDrawings: (targetContextId?: string) => Drawing[];
  selectDrawing: (id: string, multi?: boolean, targetContextId?: string) => boolean;
  unselectDrawing: (id: string, targetContextId?: string) => boolean;
  unselectAll: (targetContextId?: string) => number;
  deleteDrawing: (id: string, targetContextId?: string) => boolean;
  deleteSelected: (targetContextId?: string) => number;
}

export interface ChartObjectsDialogProps {
  isOpen: boolean;
  targetContextId: string | null;
  symbol: string;
  timeframe?: string;
  onClose: () => void;
  /** Injectable for focused tests; production callers should omit this. */
  drawingService?: ChartObjectsDrawingService;
}

const TYPE_LABELS: Record<DrawingType, string> = {
  trendline: 'Trendline',
  hline: 'Horizontal line',
  vline: 'Vertical line',
  text: 'Text',
  channel: 'Channel',
  fibonacci: 'Fibonacci retracement',
  fib_extension: 'Fibonacci extension',
  measure: 'Measure',
  freehand: 'Freehand',
  callout: 'Callout',
  rectangle: 'Rectangle',
  ellipse: 'Ellipse',
  shapes: 'Shape',
  stamp: 'Stamp',
  pattern: 'Chart pattern',
};

const STAMP_LABELS: Record<string, string> = {
  thumbsUp: 'Thumbs up',
  thumbsDown: 'Thumbs down',
  arrowUp: 'Arrow up',
  arrowDown: 'Arrow down',
  stopSign: 'Stop sign',
  checkSign: 'Check sign',
  leftPriceLabel: 'Left price label',
  rightPriceLabel: 'Right price label',
  buy: 'Buy arrow',
  sell: 'Sell arrow',
  arrow: 'Arrow',
};

const humanizeSubtype = (value: string): string => value
  .replace(/[_-]+/g, ' ')
  .replace(/([a-z])([A-Z])/g, '$1 $2')
  .replace(/^./, character => character.toUpperCase());

export const getChartObjectDisplayName = (
  drawing: Pick<Drawing, 'type' | 'subtype'>,
  translate: (label: string) => string = label => label,
): string => {
  const pattern = getChartPatternTool(drawing);
  if (pattern) return translate(pattern.label);
  const trendTool = getTrendLineToolFromDrawing(drawing.type, drawing.subtype);
  if (trendTool) return translate(trendTool.label);
  if (drawing.type === 'stamp' && drawing.subtype) {
    const pictograph = getPictographStamp(drawing.subtype);
    if (pictograph) {
      const kind = pictograph.id.startsWith('emoji:') ? 'Emoji'
        : pictograph.id.startsWith('sticker:') ? 'Sticker' : 'Icon';
      return `${translate(kind)} ${pictograph.glyph}`;
    }
    return translate(STAMP_LABELS[drawing.subtype] ?? humanizeSubtype(drawing.subtype));
  }
  if (drawing.subtype) return translate(humanizeSubtype(drawing.subtype));
  return translate(TYPE_LABELS[drawing.type]);
};

const cloneDrawingForView = (drawing: Drawing): Drawing => ({
  ...drawing,
  points: drawing.points.map(point => ({ ...point })),
  pitchforkLevels: drawing.pitchforkLevels ? [...drawing.pitchforkLevels] : undefined,
});

const shortDrawingId = (id: string): string => {
  const normalized = id.replace(/^drawing-/, '').replace(/^d-/, '');
  return normalized.length > 12 ? normalized.slice(-12) : normalized;
};

const DRAWING_EVENTS = [
  'drawings:changed',
  'drawing:saved',
  'drawing:deleted',
  'drawings:cleared',
  'drawing:selected',
  'drawing:selection-cleared',
] as const;

const getEventContextId = (event: Event): string | undefined => {
  const detail = (event as CustomEvent<{ contextId?: unknown }>).detail;
  return typeof detail?.contextId === 'string' ? detail.contextId : undefined;
};

export const ChartObjectsDialog: React.FC<ChartObjectsDialogProps> = ({
  isOpen,
  targetContextId,
  symbol,
  timeframe,
  onClose,
  drawingService = drawingManager,
}) => {
    const tr = useUiTranslation();
  const [drawings, setDrawings] = useState<Drawing[]>([]);
  const dialogRef = useRef<HTMLDivElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const titleId = useId();
  const descriptionId = useId();

  const refresh = useCallback(() => {
    if (!isOpen || !targetContextId) {
      setDrawings([]);
      return;
    }
    setDrawings(drawingService.getDrawings(targetContextId).map(cloneDrawingForView));
  }, [drawingService, isOpen, targetContextId]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  useEffect(() => {
    if (!isOpen || !targetContextId) return;
    const handleDrawingChange = (event: Event) => {
      const eventContextId = getEventContextId(event);
      if (!eventContextId || eventContextId === targetContextId) refresh();
    };
    DRAWING_EVENTS.forEach(eventName => window.addEventListener(eventName, handleDrawingChange));
    return () => {
      DRAWING_EVENTS.forEach(eventName => window.removeEventListener(eventName, handleDrawingChange));
    };
  }, [isOpen, refresh, targetContextId]);

  useEffect(() => {
    if (!isOpen) return;
    const previouslyFocused = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;
    closeButtonRef.current?.focus();

    const handleKeyDown = (event: KeyboardEvent) => {
      if (shouldIgnoreShortcutEvent(event) || !isShortcutOwnedBy(event, dialogRef.current)) return;
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        onClose();
        return;
      }
      if (event.key !== 'Tab') return;
      const focusable = Array.from(dialogRef.current?.querySelectorAll<HTMLElement>(
        'button:not([disabled]), input:not([disabled]), [href], select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
      ) ?? []);
      if (focusable.length === 0) {
        event.preventDefault();
        return;
      }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener('keydown', handleKeyDown, true);
    return () => {
      document.removeEventListener('keydown', handleKeyDown, true);
      previouslyFocused?.focus();
    };
  }, [isOpen, onClose]);

  const selectedCount = useMemo(
    () => drawings.filter(drawing => drawing.selected).length,
    [drawings],
  );
  const chartLabel = timeframe ? `${symbol} ${timeframe}` : symbol;

  const selectDrawing = (drawing: Drawing, selected: boolean) => {
    if (!targetContextId) return;
    if (selected) drawingService.selectDrawing(drawing.id, true, targetContextId);
    else drawingService.unselectDrawing(drawing.id, targetContextId);
    refresh();
  };

  const selectAll = () => {
    if (!targetContextId) return;
    drawings.forEach(drawing => {
      if (!drawing.selected) drawingService.selectDrawing(drawing.id, true, targetContextId);
    });
    refresh();
  };

  const unselectAll = () => {
    if (!targetContextId) return;
    drawingService.unselectAll(targetContextId);
    refresh();
  };

  const deleteDrawing = (drawing: Drawing) => {
    if (!targetContextId) return;
    drawingService.deleteDrawing(drawing.id, targetContextId);
    refresh();
  };

  const deleteSelected = () => {
    if (!targetContextId) return;
    drawingService.deleteSelected(targetContextId);
    refresh();
  };

  if (!isOpen) return null;

  return createPortal(
    <div
      className="fixed inset-0 z-[10020] flex items-center justify-center bg-black/65 p-4 backdrop-blur-[2px]"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descriptionId}
        data-testid="chart-objects-dialog"
        className="rtx-chart-objects-dialog flex w-full max-w-[780px] flex-col overflow-hidden rounded-md border border-[var(--border-secondary)] bg-[var(--bg-secondary)] text-[var(--text-primary)] shadow-2xl"
        onMouseDown={event => event.stopPropagation()}
      >
        <header className="rtx-chart-objects-dialog__header flex items-start justify-between gap-4 border-b border-[var(--border-primary)] bg-[var(--bg-tertiary)] px-5 py-4">
          <div className="flex min-w-0 items-start gap-3">
            <div className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded border border-[var(--color-info-dim)] bg-[var(--color-info-dim)] text-[var(--color-info)]">
              <Icon name="chart-list" size="sm" />
            </div>
            <div className="min-w-0">
              <h2 id={titleId} className="truncate text-[16px] font-semibold">
                {tr("Objects on ")}{chartLabel || tr('active chart')}
              </h2>
              <p id={descriptionId} className="mt-0.5 text-[12px] text-[var(--text-secondary)]">
                {tr("Select or remove drawings only from this chart.")}</p>
            </div>
          </div>
          <button
            ref={closeButtonRef}
            type="button"
            aria-label={tr("Close chart objects")}
            onClick={onClose}
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg-quaternary)] hover:text-[var(--text-primary)] focus:outline-none focus:ring-1 focus:ring-[var(--color-info)]"
          >
            <Icon name="x-close" size="sm" />
          </button>
        </header>

        <div className="rtx-chart-objects-dialog__toolbar flex flex-wrap items-center justify-between gap-3 border-b border-[var(--border-primary)] bg-[var(--bg-secondary)] px-5 py-3">
          <p className="text-[12px] text-[var(--text-secondary)]" aria-live="polite">
            {drawings.length} {drawings.length === 1 ? tr("object") : tr("objects")} · {selectedCount} {tr(" selected")}</p>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={refresh}
              disabled={!targetContextId}
              className="flex h-8 items-center gap-1.5 rounded border border-[var(--border-secondary)] bg-[var(--bg-quaternary)] px-3 text-[11px] font-medium text-[var(--text-primary)] hover:border-[var(--color-info)] disabled:cursor-not-allowed disabled:opacity-45"
            >
              <Icon name="refresh" size="xs" />
              {tr("Refresh")}</button>
            <button
              type="button"
              onClick={selectAll}
              disabled={!targetContextId || drawings.length === 0 || selectedCount === drawings.length}
              className="h-8 rounded border border-[var(--border-secondary)] bg-[var(--bg-quaternary)] px-3 text-[11px] font-medium text-[var(--text-primary)] hover:border-[var(--color-info)] disabled:cursor-not-allowed disabled:opacity-45"
            >
              {tr("Select all")}</button>
            <button
              type="button"
              onClick={unselectAll}
              disabled={!targetContextId || selectedCount === 0}
              className="h-8 rounded border border-[var(--border-secondary)] bg-[var(--bg-quaternary)] px-3 text-[11px] font-medium text-[var(--text-primary)] hover:border-[var(--color-info)] disabled:cursor-not-allowed disabled:opacity-45"
            >
              {tr("Unselect all")}</button>
          </div>
        </div>

        <div className="rtx-chart-objects-dialog__body">
          {!targetContextId ? (
            <div className="rtx-chart-objects-dialog__empty flex flex-col items-center justify-center gap-2 px-6 text-center text-[12px] text-[var(--text-secondary)]">
              <Icon name="chart-list" size="md" />
              <p>{tr("No active chart context is available.")}</p>
            </div>
          ) : drawings.length === 0 ? (
            <div className="rtx-chart-objects-dialog__empty flex flex-col items-center justify-center gap-2 px-6 text-center text-[12px] text-[var(--text-secondary)]">
              <Icon name="chart-list" size="md" />
              <p>{tr("No drawing objects are attached to ")}{chartLabel || tr('this chart')}.</p>
            </div>
          ) : (
            <table className="w-full border-collapse text-left text-[12px]" aria-label={tr("Drawing objects on {{value0}}", { value0: chartLabel })}>
              <thead className="sticky top-0 z-[1] bg-[var(--bg-tertiary)] text-[10px] uppercase tracking-wide text-[var(--text-secondary)]">
                <tr>
                  <th scope="col" className="w-12 border-b border-[var(--border-primary)] px-4 py-2.5">
                    <span className="sr-only">{tr("Selected")}</span>
                  </th>
                  <th scope="col" className="border-b border-[var(--border-primary)] px-3 py-2.5">{tr("Object")}</th>
                  <th scope="col" className="border-b border-[var(--border-primary)] px-3 py-2.5">{tr("ID")}</th>
                  <th scope="col" className="border-b border-[var(--border-primary)] px-3 py-2.5">{tr("Style")}</th>
                  <th scope="col" className="w-20 border-b border-[var(--border-primary)] px-4 py-2.5 text-right">{tr("Action")}</th>
                </tr>
              </thead>
              <tbody>
                {drawings.map(drawing => {
                  const displayName = getChartObjectDisplayName(drawing, tr);
                  const pictograph = drawing.type === 'stamp' ? getPictographStamp(drawing.subtype) : undefined;
                  return (
                    <tr
                      key={drawing.id}
                      data-selected={drawing.selected ? 'true' : 'false'}
                      className="border-b border-[var(--border-primary)] bg-[var(--bg-secondary)] hover:bg-[var(--bg-tertiary)] data-[selected=true]:bg-[var(--color-info-dim)]"
                    >
                      <td className="px-4 py-3 align-middle">
                        <input
                          type="checkbox"
                          checked={drawing.selected === true}
                          aria-label={tr("Select {{value0}} {{value1}}", { value0: displayName, value1: shortDrawingId(drawing.id) })}
                          onChange={event => selectDrawing(drawing, event.currentTarget.checked)}
                          className="h-3.5 w-3.5 accent-[var(--color-info)]"
                        />
                      </td>
                      <th scope="row" className="px-3 py-3 font-medium text-[var(--text-primary)]">
                        <div>{displayName}</div>
                        <div className="mt-0.5 text-[10px] font-normal text-[var(--text-secondary)]">
                          {drawing.points.length} {drawing.points.length === 1 ? tr("anchor") : tr("anchors")}
                          {drawing.locked ? tr(" · Locked") : ''}
                        </div>
                      </th>
                      <td className="px-3 py-3 font-mono text-[10px] text-[var(--text-secondary)]">
                        {shortDrawingId(drawing.id)}
                      </td>
                      <td className="px-3 py-3 text-[11px] text-[var(--text-secondary)]">
                        {pictograph ? <span>{pictograph.size}{tr("px")}</span> : <span className="inline-flex items-center gap-2">
                          <span
                            aria-hidden="true"
                            className="h-3 w-3 rounded-full border border-white/20"
                            style={{ backgroundColor: drawing.color || '#2196F3' }}
                          />
                          {tr(drawing.lineStyle ?? 'solid')} · {drawing.lineWidth ?? 2}{tr("px")}</span>}
                      </td>
                      <td className="px-4 py-3 text-right">
                        <button
                          type="button"
                          aria-label={tr("Delete {{value0}} {{value1}}", { value0: displayName, value1: shortDrawingId(drawing.id) })}
                          onClick={() => deleteDrawing(drawing)}
                          className="rtx-chart-objects-dialog__delete inline-flex h-7 w-7 items-center justify-center rounded text-rose-400 hover:bg-rose-500/10 hover:text-rose-300 focus:outline-none focus:ring-1 focus:ring-rose-400"
                        >
                          <Icon name="trash" size="xs" />
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>

        <footer className="rtx-chart-objects-dialog__footer flex flex-wrap items-center justify-between gap-3 border-t border-[var(--border-primary)] bg-[var(--bg-tertiary)] px-5 py-3">
          <button
            type="button"
            onClick={deleteSelected}
            disabled={!targetContextId || selectedCount === 0}
            className="rtx-chart-objects-dialog__delete flex h-8 items-center gap-1.5 rounded border border-rose-500/40 bg-rose-500/10 px-3 text-[11px] font-semibold text-rose-300 hover:bg-rose-500/20 disabled:cursor-not-allowed disabled:opacity-45"
          >
            <Icon name="trash" size="xs" />
            {tr("Delete selected (")}{selectedCount})
          </button>
          <button
            type="button"
            onClick={onClose}
            className="h-8 rounded border border-[var(--border-secondary)] bg-[var(--bg-quaternary)] px-4 text-[12px] font-medium text-[var(--text-primary)] transition-colors hover:border-[var(--color-info)] focus:outline-none focus:ring-1 focus:ring-[var(--color-info)]"
          >
            {tr("Close")}</button>
        </footer>
      </div>
    </div>,
    document.body,
  );
};

export default ChartObjectsDialog;
import { isShortcutOwnedBy, shouldIgnoreShortcutEvent } from '../../services/keyboardShortcutManager';
