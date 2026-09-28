import { useUiTranslation } from '../hooks/useUiTranslation';
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { drawingManager } from '../services/drawingManager';
import type { Drawing } from './model/drawing';
import { annotationTable } from './annotationToolCatalog';
import { commandBus } from '../services/commandBus';

export interface AnnotationTableCellDetail {
  drawing: Drawing;
  contextId: string;
  row: number;
  column: number;
  x: number;
  y: number;
  width: number;
  height: number;
}

export function AnnotationTableCellEditor() {
    const tr = useUiTranslation();
  const [edit, setEdit] = useState<AnnotationTableCellDetail | null>(null);
  const [value, setValue] = useState('');
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const open = (event: Event) => {
      const detail = (event as CustomEvent<AnnotationTableCellDetail>).detail;
      if (detail.drawing.locked) return;
      setEdit(detail); setValue(annotationTable(detail.drawing.annotation?.tableData)[detail.row]?.[detail.column] ?? '');
    };
    const close = () => setEdit(null);
    window.addEventListener('drawing:edit-table-cell', open);
    window.addEventListener('chartSymbolChanged', close);
    const unsubscribe = commandBus.subscribe('SELECT_TOOL', close);
    return () => { window.removeEventListener('drawing:edit-table-cell', open); window.removeEventListener('chartSymbolChanged', close); unsubscribe(); };
  }, []);
  useEffect(() => { input.current?.focus(); input.current?.select(); }, [edit]);
  if (!edit) return null;
  const commit = (advance = 0) => {
    const drawing = drawingManager.getDrawings(edit.contextId).find(item => item.id === edit.drawing.id);
    if (!drawing || drawing.locked) { setEdit(null); return; }
    const cells = annotationTable(drawing.annotation?.tableData);
    if (!cells[edit.row] || edit.column >= cells[edit.row].length) { setEdit(null); return; }
    cells[edit.row][edit.column] = value;
    drawingManager.updateDrawingProperties(drawing.id, { annotation: { ...drawing.annotation, tableData: cells } }, edit.contextId);
    setEdit(null);
    if (advance) {
      const index = (edit.row * cells[0].length + edit.column + advance + cells.length * cells[0].length) % (cells.length * cells[0].length);
      drawingManager.editTableCell(drawing.id, Math.floor(index / cells[0].length), index % cells[0].length, edit.contextId);
    }
  };
  return createPortal(<input ref={input} aria-label={tr("Table cell {{value0}}, {{value1}}", { value0: edit.row + 1, value1: edit.column + 1 })} value={value}
    onChange={event => setValue(event.target.value)} onPointerDown={event => event.stopPropagation()}
    onBlur={() => commit()} onKeyDown={event => {
      event.stopPropagation();
      if (event.key === 'Escape') { event.preventDefault(); setEdit(null); }
      if (event.key === 'Enter') { event.preventDefault(); commit(); }
      if (event.key === 'Tab') { event.preventDefault(); commit(event.shiftKey ? -1 : 1); }
    }} style={{ position: 'fixed', zIndex: 10021, left: edit.x, top: edit.y, width: edit.width, height: edit.height,
      padding: 6, border: '2px solid #2962ff', borderRadius: 0, outline: 'none', boxSizing: 'border-box',
      background: edit.drawing.fillColor || 'var(--bg-secondary)', color: edit.drawing.annotation?.textColor || edit.drawing.color,
      fontFamily: 'Arial, sans-serif', fontSize: edit.drawing.annotation?.fontSize ?? 14,
      fontWeight: edit.drawing.annotation?.bold ? 700 : 400, fontStyle: edit.drawing.annotation?.italic ? 'italic' : 'normal',
      textAlign: edit.drawing.annotation?.align ?? 'left' }} />, document.body);
}
